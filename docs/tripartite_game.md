# Tripartite Game — Provably Fair Multilateral Resource Allocation

The **TripartiteGame** is the on-chain referee that turns the three ECCA chains
into a usable substrate for cooperative games where N parties must operate
under hard, observable caps on three classes of scarce resource:

| Resource    | Backed by      | Chain-level scarcity                          |
|-------------|----------------|-----------------------------------------------|
| **Compute**   | `ComputeToken`   | PoW mining on **medulla-pow** (50M hash attempts/block, 4 s retarget) |
| **Storage**   | `MemoryToken`    | Epoch-window + pin-lease on **hippocampus-dag** (see [pin_lease.md](pin_lease.md)) |
| **Bandwidth** | `RoutingToken`   | EVM gas + per-epoch budget enforcement on **cortex-evm** |

Three is the structural minimum for a multilateral observation treaty —
fewer collapses to bilateral, more is a generalisation. The contract is
deployed at `TripartiteGame` (see `contracts/deployments/cortex.json`).

## Motivating scenario — weapons inspection

Three signatories agree to inspect a demilitarised zone. Each signatory
gets a fixed budget of:

- **inspection cycles** (compute) — cryptographic operations against sensor
  outputs,
- **evidence archival** (storage) — pinning of recorded measurements in the
  Hippocampus DAG,
- **inter-party transmission** (bandwidth) — broadcasts to the other
  signatories via Cortex.

The treaty holds iff *no signatory exceeds its per-epoch budget for any
resource at any epoch*. Anyone — a fourth-party inspector, a journalist,
the public — can re-derive that fact from on-chain state alone.

## Lifecycle

1. **Open.** The appointed referee (contract owner) opens a game with a
   unique `gameId`:

   ```solidity
   game.openGame(keccak256("treaty:dmz-7:2384"));
   ```

2. **Register.** Each party self-registers its `StackIdentity` NFT with a
   per-epoch budget tuple `(compute, storage, bandwidth)`. Only the NFT
   bearer can register their own stack:

   ```solidity
   game.registerParty(gameId, tokenId, label,
                      computeBudget, storageBudget, bandwidthBudget);
   ```

3. **Authorise.** Each party authorises the `TripartiteGame` contract as a
   sleeve on the three underlying `BandwidthToken` contracts so the game can
   burn their tokens during `consume()`.

4. **Consume.** The only legal path to spending bandwidth in the game:

   ```solidity
   game.consume(gameId, tokenId, epoch, resource, amount, reason);
   ```

   The call:
   - enforces the per-epoch cap (revert on overspend),
   - atomically burns the underlying `BandwidthToken` supply (real scarcity
     sink — the units cannot reappear elsewhere),
   - emits a labelled `Consumed` event for inspectors.

5. **Audit.** Anyone reads:

   ```solidity
   bool fair = game.verifyAllocationFair(gameId, epoch);
   ```

   `auditEpoch(gameId, epoch)` is a state-mutating wrapper that emits the
   audit decision into the EVM log for treaty record-keeping.

## The provable-fairness property

For game `G` at epoch `e`, let `consumed[G][e][p][r]` be the total
consumption recorded for party `p` on resource `r`, and `budget[G][p][r]`
be its per-epoch cap. The contract guarantees:

$$
\forall p \in \text{roster}(G),\ \forall r \in \{\text{compute, storage, bandwidth}\}:
\quad \text{consumed}[G][e][p][r] \le \text{budget}[G][p][r]
$$

*by construction* — every state transition that increases `consumed` first
checks the cap and reverts on violation. There is no admin path,
multisig, or off-chain hook that can mutate consumption otherwise.

Any inspector with read access to Cortex can:

1. Replay the `Consumed` event log to reconstruct `consumed[G][e][p][r]`.
2. Read `budgetOf(G, tokenId)` to retrieve `budget[G][p][r]`.
3. Verify the inequality above for every `(p, r, e)` triple of interest.

Equivalently they can call `verifyAllocationFair(G, e)` directly; the view
function does the same check against in-storage state.

## What this gives you that the prior architecture didn't

| Property                                | Before                               | After                                                   |
|-----------------------------------------|--------------------------------------|---------------------------------------------------------|
| Spend recorded on-chain                 | No (Postgres row per spend)          | Yes (`Consumed` event, public)                          |
| Cap enforced on-chain                   | No (off-chain `if` in service code)  | Yes (`require` inside `consume()`)                      |
| Spend backed by real token burn         | No (Prisma decrement)                | Yes (`BandwidthToken.spend()` is called atomically)     |
| Cap is per-party, per-epoch             | Implicit, soft                       | Explicit, hard                                          |
| Inspector audit needs no service trust  | No (services could mis-report)       | Yes (read-only view over Cortex state)                  |
| Three resource classes simultaneously   | Partial (token kinds existed, weren't gated) | Yes — first-class `(compute, storage, bandwidth)` tuple |

## Limitations and v3.1 roadmap

The contract guarantees that *no* recorded action exceeds its budget. It
does **not** yet guarantee that *every relevant action a party performs*
is routed through `consume()`. Two complementary closures are scheduled
for v3.1:

- **Cortex paymaster**: every transaction targeting an ECCA contract must
  carry a routing-token receipt, enforced by a custom mempool gate.
- **Hippocampus admission control**: `dag/put` will require a memory-token
  receipt before accepting writes, and `pin/lease` already does so via
  the lease-extension semantics described in [pin_lease.md](pin_lease.md).

Until those land, the contract's guarantee is "for actions performed
through the game referee, the cap is hard." That is sufficient for any
game whose rules require parties to actually use the referee — which is
the natural design for a treaty.

## See also

- [token_economy.md](token_economy.md) — the underlying bandwidth-token
  model.
- [pin_lease.md](pin_lease.md) — storage-scarcity primitive on Hippocampus.
- [coherence_root.md](coherence_root.md) — cross-chain commitments that
  inspectors use to anchor the audit trail.
- `contracts/src/TripartiteGame.sol` — the contract.
- `contracts/test/TripartiteGame.test.ts` — full property tests.
- `tests/integration/tripartite-game.test.ts` — end-to-end on a live cortex.
