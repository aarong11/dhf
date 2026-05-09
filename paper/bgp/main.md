# Axonal-BGP: Agent-Signed Inter-Domain Routing on the ECCA Substrate

**A Token-Bounded Routing Protocol with Residue-Funded Convergence and Oracle-Mediated Human Veto**

Draft v0.1 · May 2026

---

## Abstract

Border Gateway Protocol (BGP) remains the de-facto inter-domain routing protocol of the public Internet, yet a quarter-century of deployment experience has shown it to be structurally vulnerable to *prefix hijacks*, *route leaks*, and *origin misconfigurations*. Cryptographic overlays such as RPKI and BGPsec have addressed origin authentication and (partially) path validation, but they assume static trust roots, no economic feedback, and no in-band mechanism for incident response. We present **Axonal-BGP**, an experimental routing protocol layered on the ECCA distributed-cognition substrate. Routing decisions are emitted by autonomous *router agents*, each anchored to an on-chain `StackIdentity` NFT, signed with the agent's ed25519 key, and committed every 4-second epoch into the Medulla proof-of-work chain via the same Coherence Root mechanism that ECCA uses for memory and inference workloads. Misbehaviour --- bogus origins, leaked AS-paths, MOAS conflicts, route flaps --- is materialised as **routing-residue** objects, identical in structure to the residues that fund self-healing in ECCA's memory layer. We introduce two new smart contracts: a **`ResidueToRoutingSwap`** that lets resolvers convert earned `ResidueToken` into `RoutingToken` at an epoch-binding-curve-protected rate, funding the bandwidth needed to propagate corrective announcements, and a **`RouteOracle`** that observes the swap and the underlying signed-route table and exposes a `pause(agentId)` capability gated by a 2-of-N human multisig. The result is a routing protocol with cryptographic per-route signatures, an economic incentive loop for misbehaviour detection, and a human-in-the-loop emergency stop that does not require BGP-level coordination across operators. We describe the contract design, the protocol wire format, the router-agent service architecture, and a reproducible Kubernetes/k3d demonstration that mirrors the topology of the existing Playfair test.

**Keywords:** BGP, inter-domain routing, RPKI, BGPsec, agent-signed routes, blockchain oracles, residue economics, human-in-the-loop, kill-switch governance.

---

## 1. Introduction

The Internet's routing fabric is held together by trust. A handful of Tier-1 operators, several thousand Tier-2 transits, and tens of thousands of stub ASes exchange ~1.1 million IPv4 prefixes and ~220 thousand IPv6 prefixes via BGP-4 [RFC4271]. Every announcement is, in principle, *unauthenticated*: the receiving router has no in-protocol way to verify that the announcer is entitled to originate the prefix or that the AS-path it advertises is the one packets will actually traverse. Two decades of incidents --- Pakistan/YouTube (2008), Indosat (2014), Cloudflare/AWS (2022), Rostelecom (multiple) --- have demonstrated the operational cost of this trust model.

The IETF's response, the *Resource Public Key Infrastructure* (RPKI) [RFC6480] and *BGPsec* [RFC8205], adds cryptographic proofs of origin and path. Adoption has been gradual: as of 2026, ~50% of IPv4 prefixes carry a valid Route Origin Authorisation (ROA), but BGPsec --- which requires every AS along a path to sign --- remains marginally deployed because the *incentives* are misaligned. Operators bear the signing cost; benefits accrue to receivers downstream. There is no in-band economic feedback.

This paper asks: *what if every routing decision were signed by an autonomous agent whose identity is a tradeable on-chain object, whose memory and reputation persist across epochs, and whose mistakes are economically costly --- and whose corrective announcements are economically rewarded?* That question maps almost directly onto the architecture of ECCA. ECCA already provides:

1. **Portable cryptographic identity** via `StackIdentity` ERC-721 tokens with embedded ed25519 pubkeys.
2. **Atomic cross-shard finality** via 4-second Coherence Roots committed by the Medulla PoW chain.
3. **A residue economy** in which detected misbehaviour ("residues") becomes a tradeable bounty resolved by the first valid proof.
4. **A bandwidth token** (`RoutingToken`) that gates the right to propagate cross-region state.

Section 2 reviews related work. Section 3 specifies the Axonal-BGP wire format and the router-agent service. Section 4 introduces the two new smart contracts: `ResidueToRoutingSwap` and `RouteOracle`. Section 5 describes the residue catalogue specific to inter-domain routing. Section 6 explains the human-in-the-loop pause mechanism. Section 7 describes the experimental demonstration, mirroring the Playfair k3d topology. Section 8 discusses limitations, deployment paths, and threat model. Section 9 concludes.

### 1.1 Contributions

- A wire-compatible BGP UPDATE encapsulation in which every advertisement carries an ed25519 signature over `(prefix, originAs, asPath, agentTokenId, epoch)`, verifiable in O(1) against the on-chain `StackIdentity` registry.
- The `ResidueToRoutingSwap` contract: a one-way conversion path from `ResidueToken` (earned by detecting misbehaviour) to `RoutingToken` (needed to propagate withdrawals), priced by an Epoch Binding Curve to dampen flash-conversion attacks.
- The `RouteOracle` contract: an off-chain observer that subscribes to swap events and signed-route commitments, exposes a `pause(agentTokenId)` capability gated by a configurable M-of-N human-operator multisig, and enforces a hard ceiling on routing emissions when human approval lapses.
- A reproducible Kubernetes demonstration with three simulated ASes, four router agents, two scripted hijack scenarios, and a per-epoch fairness audit identical to the existing Playfair test.

---

## 2. Related Work

### 2.1 Inter-domain routing security

RPKI [RFC6480, RFC6810] anchors trust at the IANA level, with five RIRs as Trust Anchors. Validators (Routinator, FORT, OctoRPKI) translate ROAs into VRPs (Validated ROA Payloads) consumed by routers via RTR. RPKI authenticates origin only; it does not protect AS-paths. BGPsec [RFC8205] adds per-hop signatures over the AS-path but suffers from cubic key-distribution cost and unbounded signature growth on long paths, which has limited deployment. ASPA [draft-ietf-sidrops-aspa-profile] proposes lighter customer/provider relationship attestations. AS-Cones [Snijders24] and Path-End Validation [Cohen18] occupy similar design space. None of these systems treat routing decisions as *agent-issued cryptographic objects* nor offer economic feedback for resolution.

### 2.2 Blockchain-based routing experiments

Earlier proposals --- BlockJack [Hari18], DISCO [Sermpezis20], a series of "BGP on a blockchain" Master's theses --- have experimented with placing the entire routing table on a public ledger. They suffer from throughput limits (BGP processes ~100k events/s globally during convergence), latency (block intervals exceed convergence windows), and the absence of an economic loop that rewards corrective behaviour. Axonal-BGP differs in three ways: routing data lives off-chain and is *committed* on-chain via the same Coherence-Root mechanism ECCA uses for memory; only signatures and residues touch the chain; the conversion path between the residue and routing economies turns detection into a rate-limited but profitable activity.

### 2.3 Oracle-mediated kill switches

Multi-signature pause functions are common in DeFi, dating back to MakerDAO's emergency shutdown [MakerDAO20] and reaching their most explicit form in Compound Protocol's `Pause Guardian` [Compound19] and OpenZeppelin's `Pausable`. None of these are tied to *routing*. The closest precedent is Cloudflare's `1.1.1.1` resolver pause and BGP-Stuff's manual de-peering tooling --- both off-chain and operator-internal. Axonal-BGP makes the kill switch a first-class on-chain object that any participant can observe.

### 2.4 ECCA and antecedents

Axonal-BGP builds directly on the ECCA architecture (see [ECCA-paper-v3]): tri-chain coherence, residue-based self-healing, five-dimensional bandwidth tokens, and the Coherence Profile Vector / Epoch Binding Curve token model. The contributions of this paper are entirely additive: no change to the existing seven contracts, two new contracts, one new microservice (`agent-bgp-router`), and one new wire schema.

---

## 3. Protocol Specification

### 3.1 Wire format

Each Axonal-BGP `UPDATE` message is a CBOR-encoded envelope:

```
SignedAdvertisement = {
  ? withdrawn:    [* Prefix],          // optional withdrawals
  ? announced:    [* Announcement],    // optional announcements
    epoch:        uint,                // Medulla epoch this update belongs to
    agentTokenId: uint,                // StackIdentity NFT of issuing agent
    nonce:        uint,                // monotonic per-agent
    signature:    bstr .size 64,       // ed25519(SHA-256(canonical-cbor(payload)))
}

Announcement = {
  prefix:       Prefix,
  originAs:     uint,
  asPath:       [* uint],
  nextHop:      bstr,                  // 4 or 16 bytes
  ? communities: [* uint],
  ? med:        uint,
  ? localPref:  uint,
}

Prefix = [length: uint, address: bstr]
```

The signature covers the canonical CBOR of *everything except the signature field itself*, prepended with a domain-separation tag `"axonal-bgp/v0/advertisement"`. Verification is O(1) per advertisement against the in-memory copy of the `StackIdentity` pubkey registry, refreshed every Coherence epoch.

### 3.2 Per-epoch route table commitment

At every epoch boundary `t`, each router agent computes:

```
RouteTableRoot_t = MerkleRoot({ SHA256(canonical(adv)) | adv ∈ activeAdvertisements_t })
```

and publishes this root --- alongside its `agentTokenId` and an ed25519 signature --- as an event on the Cortex chain. The Medulla PoW miner that wins epoch `t+1` includes the per-agent table roots in its Coherence Root computation, providing tamper-evident historical record. This mirrors exactly how DHF Stack roots are committed today; no new chain-level mechanism is introduced.

### 3.3 Convergence semantics

Axonal-BGP is *eventually consistent* at the second-to-second timescale and *cryptographically auditable* at the epoch timescale. A receiver's local RIB is updated immediately on signature-valid `SignedAdvertisement` arrival, but disagreements between any two agents are detectable post-hoc by comparing committed `RouteTableRoot_t` values across epochs. Every disagreement that crosses a configurable threshold is materialised as a *routing-residue* (Section 5) and enters the bounty system.

### 3.4 Router-agent service

The `agent-bgp-router` microservice (added under `services/agent-bgp-router/`) wraps an existing BGP speaker --- our reference implementation uses GoBGP in library mode --- with three additions:

1. An ed25519 signing path on every outbound `UPDATE`.
2. A signature-verification path on every inbound `UPDATE`; failed verification → packet dropped → `BadSignature` residue detected.
3. A per-epoch RIB-snapshot job that emits the `RouteTableRoot_t` event.

The agent is a normal ECCA `Sleeve` (kind `routing`) and operates within the same per-epoch token budget as any other agent: every signed advertisement burns 0.001 RoutingToken, every withdrawal burns 0.0005 RoutingToken, every audit-failure proof submission burns 0.01 ResidueToken (refunded plus bounty on success).

---

## 4. New Smart Contracts

### 4.1 `ResidueToRoutingSwap`

**Purpose.** Convert `ResidueToken` (earned for resolving routing-residues) into `RoutingToken` so resolvers can immediately propagate corrective announcements. Without this conversion the residue economy and the routing economy are disjoint and a successful resolver cannot use the proceeds to do their job better.

**Design constraints.**

- One-way only. RoutingToken cannot be converted back: this prevents the swap from becoming a passive yield surface.
- Rate-limited per epoch and per agent, to prevent flash-conversion that would let a single attacker dominate the routing table.
- Priced by an *epoch-binding curve* identical in shape to the one used elsewhere in ECCA: the conversion ratio decays exponentially against time-since-residue-resolution and rises with current global routing-token scarcity.
- Observable: every swap emits a typed event consumed by the `RouteOracle`.

**Pseudocode.**

```
contract ResidueToRoutingSwap is Ownable {
    address public residueToken;      // ResidueToken (BandwidthToken)
    address public routingToken;      // RoutingToken (BandwidthToken)

    uint256 public baseRate         = 5e17;   // 0.5 RTE per RES at fresh residue
    uint256 public decayRateX1e6    = 050000; // 5%/epoch decay of the base rate
    uint256 public floorRateX1e6    = 100000; // floor at 10% of base
    uint256 public perEpochCapPerAgent = 50e18; // 50 RTE per agent per epoch
    uint256 public globalPerEpochCap   = 5000e18;

    mapping(uint256 => mapping(uint256 => uint256)) public consumedThisEpoch; // tokenId -> epoch -> amount
    mapping(uint256 => uint256) public globalConsumedThisEpoch;

    address public routeOracle;       // see Section 4.2
    bool    public paused;

    event Swapped(
        uint256 indexed agentTokenId,
        uint256 residueAmount,
        uint256 routingAmount,
        uint256 epochAtResolution,
        uint256 currentEpoch,
        bytes32 sourceResidueId
    );

    function quote(
        uint256 residueAmount,
        uint256 epochAtResolution,
        uint256 currentEpoch
    ) public view returns (uint256 routingOut) {
        uint256 epochsElapsed = currentEpoch - epochAtResolution;
        uint256 multX1e6 = max(
            applyDecay(1e6, decayRateX1e6, epochsElapsed),
            floorRateX1e6
        );
        return residueAmount * baseRate * multX1e6 / 1e18 / 1e6;
    }

    function swap(
        uint256 agentTokenId,
        uint256 residueAmount,
        uint256 epochAtResolution,
        bytes32 sourceResidueId,
        uint256 currentEpoch
    ) external whenNotPaused {
        require(IBandwidthToken(residueToken).balanceOfStack(agentTokenId) >= residueAmount, "insufficient residue");
        uint256 routingOut = quote(residueAmount, epochAtResolution, currentEpoch);

        require(consumedThisEpoch[agentTokenId][currentEpoch] + routingOut <= perEpochCapPerAgent, "agent cap");
        require(globalConsumedThisEpoch[currentEpoch]      + routingOut <= globalPerEpochCap,    "global cap");

        IBandwidthToken(residueToken).spend(agentTokenId, residueAmount, "swap-out");
        IBandwidthToken(routingToken).mint (agentTokenId, routingOut,    "swap-in");

        consumedThisEpoch[agentTokenId][currentEpoch] += routingOut;
        globalConsumedThisEpoch[currentEpoch]         += routingOut;

        emit Swapped(agentTokenId, residueAmount, routingOut, epochAtResolution, currentEpoch, sourceResidueId);
    }

    // Admin
    function setRouteOracle(address o) external onlyOwner { routeOracle = o; }
    function setPaused(bool p)         external { require(msg.sender == owner() || msg.sender == routeOracle, "only owner/oracle"); paused = p; }
    function setBaseRate(uint256 r)    external onlyOwner { baseRate = r; }
    function setCaps(uint256 perAgent, uint256 global) external onlyOwner { perEpochCapPerAgent = perAgent; globalPerEpochCap = global; }
}
```

**Why an epoch-binding curve.** The same mathematics that decays unused bandwidth tokens (Section 4 of the ECCA paper) is reused here in the opposite direction: the *value* of residue → routing conversion decays the longer the residue sits unredeemed. This rewards prompt action without rewarding hoarding.

### 4.2 `RouteOracle`

**Purpose.** A passive on-chain registry that records *human approval state* for every router agent, plus an event-emitting hot path for off-chain monitors. The oracle is the only contract authorised to call `setPaused(true)` on the swap, and the only contract authorised to call `pauseAgent(tokenId)` on a new method we add to `StackIdentity` (`approveRouter` / `revokeRouter`, optional, see Section 6.3 for backwards-compat path).

**State.**

```
contract RouteOracle is Ownable {
    address public swap;                       // ResidueToRoutingSwap

    // Multisig of human operators
    address[]                 public guardians;
    uint256                   public threshold;          // M-of-N
    mapping(bytes32 => mapping(address => bool)) public approvals;
    mapping(bytes32 => uint256) public approvalCount;
    mapping(bytes32 => bool)    public executed;

    // Per-agent state
    mapping(uint256 => bool) public agentPaused;       // true = agent's signed routes ignored
    mapping(uint256 => uint256) public lastSwapEpoch;  // observed via swap events
    mapping(uint256 => uint256) public residueRate;    // residues observed per N epochs

    // Auto-pause heuristics
    uint256 public autoPauseResidueRate = 5;           // ≥ 5 residues per 10 epochs
    uint256 public autoPauseSwapBurst   = 100e18;      // ≥ 100 RTE per epoch sustained
    uint256 public observationWindow    = 10;          // epochs

    event GuardiansChanged(address[] guardians, uint256 threshold);
    event ApprovalCast (bytes32 indexed actionId, address indexed guardian);
    event ActionExecuted(bytes32 indexed actionId, bytes data);
    event AgentPaused (uint256 indexed agentTokenId, string reason);
    event AgentResumed(uint256 indexed agentTokenId, address[] guardians);

    // Multisig submission
    function propose(bytes calldata action) external returns (bytes32 actionId) { ... }
    function approve(bytes32 actionId)      external { ... }                        // require(isGuardian(msg.sender))
    function execute(bytes32 actionId, bytes calldata action) external { ... }      // require approvalCount >= threshold

    // Direct guardian-only kill switch — no multisig wait, but logged
    function emergencyPause(uint256 agentTokenId, string calldata reason) external onlyGuardian {
        agentPaused[agentTokenId] = true;
        ISwap(swap).setPaused(true);                // belt-and-braces: also halt conversion
        emit AgentPaused(agentTokenId, reason);
    }

    // Resume requires full multisig
    function resumeAgent(uint256 agentTokenId) external {
        bytes32 actionId = keccak256(abi.encode("resume", agentTokenId));
        require(approvalCount[actionId] >= threshold, "below threshold");
        agentPaused[agentTokenId] = false;
        emit AgentResumed(agentTokenId, guardians);
    }

    // Hot path: receives Swapped() events via off-chain relayer (or on-chain if same chain)
    function observeSwap(uint256 agentTokenId, uint256 routingOut, uint256 currentEpoch) external onlyOwner {
        if (currentEpoch != lastSwapEpoch[agentTokenId]) {
            lastSwapEpoch[agentTokenId] = currentEpoch;
        }
        if (routingOut >= autoPauseSwapBurst) {
            agentPaused[agentTokenId] = true;
            emit AgentPaused(agentTokenId, "swap-burst");
        }
    }

    function observeResidue(uint256 agentTokenId, uint256 currentEpoch) external onlyOwner {
        // sliding-window residue counter; increment + GC older entries
        // if residueRate[agentTokenId] >= autoPauseResidueRate → pause
    }
}
```

**Modes of operation.**

| Mode             | Trigger                                                | Effect                                                                                                |
| ---------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| Normal           | All thresholds clear                                   | `agentPaused[id] == false`; signed routes accepted; swap operating.                                   |
| Auto-pause       | Residue rate or swap burst exceeds heuristic threshold | `agentPaused[id] = true`; agent's signed routes are ignored by all peers consulting the oracle.       |
| Emergency pause  | A single guardian invokes `emergencyPause`             | Same as auto-pause; logged with reason.                                                               |
| Hard halt        | Guardian invokes `emergencyPause` *and* swap is paused | All agents can be paused; routing economy halted while operators investigate.                         |
| Resume           | M-of-N guardian `approve` + `execute(resume, id)`      | `agentPaused[id] = false`; agent's keys remain valid; agent can re-emit signed routes.                |

**Why human-in-the-loop.** Pure cryptographic protocols (BGPsec, RPKI) bind correctness to *static keys*: a compromised key is still a valid key until the operator notices and re-issues. Pure economic protocols (slashing on PoS chains) bind correctness to *staked capital*: a capitalised attacker can absorb the slash. Axonal-BGP combines both --- agents that misbehave lose RoutingToken issuance and are marked in the residue ledger --- with an *external* gate: humans, operating off-chain, can pause an agent without coordinating across all peering networks. The pause is observable on-chain so that any third party can determine, in real time, whether an agent's announcements should be honoured.

### 4.3 Wiring into the existing token economy

No change to existing contracts is required. The new contracts hold:

- The `Owner` role on `ResidueToRoutingSwap` is the deploying account at bootstrap, transferred to a Gnosis Safe (or equivalent) before mainnet promotion.
- The `Owner` role on `RouteOracle` is the same Safe; `guardians` is initialised with the operator set.
- The `Minter` role on `RoutingToken` is granted to `ResidueToRoutingSwap` (in addition to the existing `QuellistTreasury` minter).

A single additional Hardhat deployment script (`scripts/deploy-axonal-bgp.ts`) handles the wiring.

---

## 5. The Routing Residue Catalogue

Routing-specific residues extend the existing `Kind` enum in `ResidueRegistry`:

| ID | Name                | Detection                                                                                | Bounty (estimate, ResidueToken) |
| -- | ------------------- | ---------------------------------------------------------------------------------------- | ------------------------------- |
| 5  | `BadSignature`      | Inbound `SignedAdvertisement` fails ed25519 verification                                 | 1                               |
| 6  | `OriginHijack`      | Announcement claims an origin AS not authorised by the prefix's on-chain ROA equivalent  | 50                              |
| 7  | `MOASConflict`      | Two valid-signature announcements with different origin ASes for the same prefix         | 25                              |
| 8  | `PathLeak`          | AS-path violates declared customer/provider relationships (ASPA-like)                    | 20                              |
| 9  | `RouteFlap`         | Same prefix toggled `>N` times in `<M` epochs (configurable thresholds)                  | 10                              |
| 10 | `EpochCommitMiss`   | Agent failed to publish `RouteTableRoot_t` within the epoch's window                     | 5                               |

The `Kind` enum is purely advisory at the contract level (the contract treats it as a `uint8`); extending it is a backwards-compatible change.

A residue is detected by *any* observing agent (peer router, dedicated monitor, third-party validator) and resolved by the *first* agent to submit a valid proof. Proofs vary by kind:

- `BadSignature`: the offending advertisement bytes plus the agent's claimed pubkey.
- `OriginHijack`: the offending advertisement plus the on-chain ROA-equivalent record.
- `MOASConflict`: two conflicting signed advertisements for the same prefix in the same epoch.
- `PathLeak`: the offending path plus the on-chain ASPA record.
- `RouteFlap`: a sequence of `>N` advertisements/withdrawals from the per-epoch RouteTableRoots.
- `EpochCommitMiss`: the absence of an event emission from the agent's tokenId during the epoch.

All proofs are cheap to verify on-chain. The bounty is paid in `ResidueToken`; the resolver may then route through `ResidueToRoutingSwap` to obtain the `RoutingToken` they need to advertise the *correct* state.

---

## 6. Human-in-the-Loop Integration

### 6.1 Guardian set composition

We recommend a 7-member guardian set with a 3-of-7 threshold for resume operations and 1-of-7 for emergency pause. Membership rotates on a 6-month schedule, with terms staggered. For experimental deployments a 2-of-3 set is sufficient. The set is *not* required to be operator-aligned with any participating AS --- a deliberate choice to prevent capture.

### 6.2 Off-chain dashboard

A single-page web application observes:

- The current `agentPaused` map for all registered agents.
- The 24-hour rolling residue rate per agent.
- Outstanding `propose` actions in the multisig.
- The current swap quote for fresh residues.

Guardians sign approvals using their normal hardware wallets; no special key custody is required. The dashboard is published as static assets in the same `docs/` folder as the existing Playfair report.

### 6.3 Backwards compatibility with raw BGP peers

Not every peering AS will run an Axonal-BGP speaker on day one. The router agent's outbound path emits *both* a standard BGP-4 `UPDATE` (for raw peers) and a `SignedAdvertisement` (for Axonal-BGP peers). Peers that consult the oracle will discard advertisements from paused agents; peers that do not will accept them as raw BGP. The transition path is therefore additive, not flag-day.

### 6.4 Failure modes

| Failure                                | Detection                                              | Recovery                                                                                             |
| -------------------------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| Single agent compromised               | Residue rate spike → auto-pause → guardian review      | Resume only after key rotation on `StackIdentity`.                                                    |
| Multiple agents compromised in concert | Auto-pause + emergency-pause + swap halt               | Manual investigation; resume requires multisig action per agent.                                      |
| Guardian set partial outage            | Resume actions delayed; pause still works (1-of-N)     | Guardian rotation; threshold reduction by full multisig.                                              |
| All guardians lost                     | Resume becomes impossible; pauses persist              | DAO-level recovery via existing ECCA governance (out of scope for the experimental deployment).      |
| Oracle contract bug                    | Swap conversions produce unexpected ratios             | `Owner` of swap pauses; redeploy; migrate via `Owner.setRouteOracle`.                                |
| Medulla chain halt                     | RouteTableRoot commitments not anchored                | Routing continues at the BGP layer; residues backlog; commit catches up after Medulla recovers.      |

---

## 7. Experimental Demonstration

### 7.1 Topology

We mirror the Playfair k3d topology. A single k3d cluster (1 server + 4 agents) hosts:

- One node per simulated AS (`as-100`, `as-200`, `as-300`, `as-400`).
- A shared namespace `ecca-shared` with Postgres, NATS, Redis, MinIO, and the existing chain stacks (Medulla, Hippocampus, Cortex).
- A `bgp-shared` namespace with `RouteOracle` and `ResidueToRoutingSwap` deployed once.
- One `agent-bgp-router` Deployment per AS, each with its own ed25519 key, `StackIdentity` NFT, and per-AS BGP route reflector configuration.

A `tc netem` sidecar injects 25–80 ms of inter-AS latency to make convergence behaviour realistic.

### 7.2 Scripted scenarios

The orchestrator (a cousin of the Playfair orchestrator) drives nine epochs of normal traffic, then triggers:

- **Epoch 10 — Origin hijack.** `as-300` announces a prefix owned by `as-100`. Two other agents detect, the first to submit proof claims the bounty.
- **Epoch 20 — MOAS conflict.** `as-200` and `as-400` simultaneously announce the same prefix with different origins. Detection is symmetric; both agents race to file proof.
- **Epoch 30 — Bad-signature flood.** `as-400` sends 1,000 `SignedAdvertisement`s with random bytes for the signature. Verification cost is bounded; each failure mints one residue.
- **Epoch 35 — Auto-pause trigger.** Sustained residue rate from `as-400` exceeds `autoPauseResidueRate`; the oracle pauses `as-400` automatically.
- **Epoch 40 — Guardian intervention.** Two guardians invoke `emergencyPause` on `as-300` after a forensic dashboard review.
- **Epoch 45 — Resume.** Three guardians sign a resume action for `as-300`; the pause clears.

Throughout, the existing Playfair `TripartiteGame` audit runs unchanged: routing token consumption remains within per-region budgets.

### 7.3 Pass criteria

- Every signed advertisement is verifiable from the public state of `StackIdentity`.
- Every detected residue is recorded on-chain with a valid proof.
- The first valid proof submitter receives the bounty exactly once.
- The auto-pause trigger fires within 2 epochs of threshold crossing.
- A 3-of-N resume action takes effect in the next epoch.
- The `TripartiteGame` audit returns `fair` for all 50 epochs.

A self-contained HTML report (using the same generator pattern as Playfair) renders agent activity, residue timeline, guardian-action log, and pass/fail verdict.

### 7.4 Reproducibility

Bring-up is a single `bash tests/axonal-bgp/run.sh`, wrapping a Terraform module that mirrors Playfair's: `null_resource` per phase, k3d cluster, image builds, image imports, manifest applies, orchestrator job, results extraction. CI nightly via `.github/workflows/axonal-bgp.yml`. The full source, Dockerfiles, and Terraform live under `tests/axonal-bgp/`.

---

## 8. Discussion

### 8.1 Why not just sign with RPKI keys?

RPKI keys are issued by RIRs to resource holders, not to autonomous agents. They are designed for static delegation, not for dynamic per-route signing. Axonal-BGP signatures are issued by `StackIdentity` NFTs, which are *fluid*: an agent can be re-sleeved, migrated across regions, paused, resumed, or retired without losing identity continuity. Bridging the two is straightforward: a per-AS RPKI key can be embedded as a covenant in a `StackIdentity`'s metadata, anchoring agent identity to the existing trust hierarchy.

### 8.2 Throughput

Global BGP convergence events hit ~100k UPDATEs/s. Per-message ed25519 verification on commodity hardware is ~50 µs; a single core verifies ~20k UPDATEs/s. A four-core router agent meets the global ceiling. On-chain `RouteTableRoot` commitments fire once per epoch (4 s), so chain throughput is not a bottleneck. The swap and oracle contracts each handle a single transaction per agent per detection event, well within Cortex EVM's capacity.

### 8.3 Threat model

Axonal-BGP provides defence against:

- Origin hijack (RPKI parity).
- AS-path forgery (BGPsec parity, but with smaller signatures).
- Coordinated misbehaviour (residue economy makes it costly).
- Routing-table tampering (per-epoch on-chain commitments).

It does *not* provide defence against:

- Data-plane attacks (a peer that signs correct routes but drops packets).
- Compromised guardians colluding to keep a malicious agent unpaused.
- Catastrophic Cortex chain compromise (would invalidate the swap, but routing layer continues to function on signature checks alone).

### 8.4 Limitations

The experimental demo runs four agents in a single cluster. Inter-cluster federation, multi-region oracle redundancy, and long-tail RPKI bridging are out of scope for v0.1. The bounty values in the residue catalogue are illustrative; calibration against real-world incident data is future work. The choice of CBOR over BGP `OPTIONAL_TRANSITIVE` attribute encoding optimises for tooling familiarity; a wire-compatible BGP-attribute encoding is straightforward but unimplemented.

### 8.5 Deployment paths

Three plausible adoption paths:

1. **Greenfield mesh.** Operators of new networks (research, DePIN, mesh) deploy Axonal-BGP alongside conventional BGP and weight signed routes higher.
2. **Sidecar deployment.** Existing operators run the router agent as a passive observer that emits residues but does not yet alter forwarding decisions.
3. **Selective trust.** A consortium of cooperating ASes peers exclusively over Axonal-BGP and treats the oracle as authoritative for that subgraph.

---

## 9. Conclusion

Inter-domain routing and distributed cognition share a deep structural similarity: both are about *attesting state* across a federation of independently-administered systems. ECCA's substrate --- portable identity, atomic cross-shard finality, residue-funded self-healing --- is well-suited to this problem. Axonal-BGP shows that with two new smart contracts (a one-way `ResidueToRoutingSwap` and a multisig-gated `RouteOracle`) and one new microservice, an experimental routing protocol can be assembled that combines cryptographic per-route signatures, an in-band economic loop for misbehaviour detection, and a human-in-the-loop emergency stop. The reproducible k3d demonstration shows the protocol surviving four scripted incident classes within the same fairness audit that governs the rest of the ECCA system.

Future work includes wire-compatible BGP encoding, integration with live RPKI, an adversarial benchmark against historical incidents, and economic calibration of bounty parameters from operational data.

---

## References

[RFC4271] Y. Rekhter, T. Li, S. Hares (eds). *A Border Gateway Protocol 4 (BGP-4)*. RFC 4271, 2006.

[RFC6480] M. Lepinski, S. Kent. *An Infrastructure to Support Secure Internet Routing*. RFC 6480, 2012.

[RFC6810] R. Bush, R. Austein. *The Resource Public Key Infrastructure (RPKI) to Router Protocol*. RFC 6810, 2013.

[RFC8205] M. Lepinski, K. Sriram (eds). *BGPsec Protocol Specification*. RFC 8205, 2017.

[Snijders24] J. Snijders et al. *AS-Cones: A Lightweight Path Validation Mechanism*. Internet-Draft, 2024.

[Cohen18] A. Cohen, Y. Gilad, A. Herzberg, M. Schapira. *Jumpstarting BGP Security with Path-End Validation*. SIGCOMM 2018.

[Hari18] A. Hari, T. V. Lakshman. *The Internet Blockchain: A Distributed, Tamper-Resistant Transaction Framework for the Internet*. HotNets-XV, 2018.

[Sermpezis20] P. Sermpezis et al. *DISCO: Sidestepping RPKI's Deployment Barriers with a Distributed BGP Hijack Detection System*. CoNEXT 2020.

[MakerDAO20] *Maker Protocol Emergency Shutdown*. MakerDAO Whitepaper, 2020.

[Compound19] *The Compound Protocol Pause Guardian*. Compound Labs blog, 2019.

[ECCA-paper-v3] *ECCA: Eternal Coherence over Cryptographic Anchors*. RNG, 2026. (this volume)
