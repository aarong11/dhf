## Plan: ECCA Stack v3 — Production Distributed Cognitive OS

A full production rebuild of ECCA as **20+ docker services** orchestrated by docker-compose (laptop-runnable) + Helm charts for distributed deploy, built on **C-strategy hybrid forks** of geth, kubo, and btcd with focused ECCA patches. Theory.md is canonical — tokens are control variables, MEV becomes a coordination repair mechanism. The v2 simulation in ecca-stack is preserved as reference semantics.

---

# 🪙 TOKEN SYSTEM EXTENSION (ADDED SPEC — DO NOT MODIFY EXISTING TEXT)

## Token Architecture Overview

The system introduces **five core cognitive-economic tokens** that act as *control variables for distributed identity, memory, and synchronization*. These tokens are **not currency**, but **runtime governance parameters for system coherence**.

Each token is bound to the **StackIdentity NFT (ERC-721)** and is globally interpreted across all subsystems (EVM, PoW, IPFS-DAG, and sleeve runtime layers).

Tokens interact multiplicatively across subsystems, meaning:

> no token operates in isolation; all tokens modify system-wide synchronization constraints.

---

## 🪙 1. ComputeToken (EXECUTION BANDWIDTH TOKEN)

### Role:

Controls execution throughput across:

* `cortex-evm`
* `sleeve-runtime-ai`
* `dhf-compositor`

### System Effect:

* increases/decreases per-stack instruction throughput
* directly affects cognitive step-rate
* governs how many parallel reasoning threads a sleeve may maintain

### Game-theoretic effect:

* high ComputeToken → fast divergence from canonical state (higher MEV opportunity)
* low ComputeToken → slower but more globally coherent execution

### Sync interaction:

* negatively correlates with SyncToken stability
* increases drift probability if unbalanced

---

## 🪙 2. MemoryToken (RECONSTRUCTION DEPTH TOKEN)

### Role:

Controls access depth into:

* `hippocampus-dag`
* `memory-reconciler`
* `needlecast-router`

### System Effect:

* determines how deep into CID graphs a stack can reconstruct
* controls historical state visibility window
* defines maximum entropy reduction depth during memory recomposition

### Game-theoretic effect:

* high MemoryToken → informational advantage (historical arbitrage)
* low MemoryToken → partial or lossy reconstruction (increased uncertainty)

### Sync interaction:

* amplifies impact of SyncToken (deep memory + strong sync = canonical dominance)

---

## 🪙 3. SyncToken (TEMPORAL COHERENCE TOKEN)

### Role:

Controls participation in:

* `medulla-pow`
* `epoch-anchor`
* `thalamus-router`

### System Effect:

* determines weight in consensus formation
* defines influence over canonical timeline selection
* regulates cross-chain state reconciliation authority

### Game-theoretic effect:

* high SyncToken → ability to define “truth ordering”
* low SyncToken → susceptibility to reordering by higher-weight stacks

### Sync interaction:

* is the primary stabilizer of system-wide coherence
* reduces MEV-residue formation when concentrated

---

## 🪙 4. RoutingToken (INFORMATION VISIBILITY TOKEN)

### Role:

Controls propagation priority across:

* `axonal-bus`
* `hippocampus-dag`
* `synapse-api`

### System Effect:

* determines how quickly state updates propagate
* affects DHT visibility in IPFS layer
* modifies probability of inclusion in coordination sets

### Game-theoretic effect:

* high RoutingToken → early knowledge advantage (latency arbitrage)
* low RoutingToken → delayed state awareness (staleness exposure)

### Sync interaction:

* introduces asymmetry in system-wide perception timing
* primary driver of MEV-like “information edge”

---

## 🪙 5. ResidueToken (COORDINATION REPAIR INCENTIVE TOKEN)

### Role:

Issued and consumed by:

* `residue-collector`
* `thalamus-router`
* `memory-reconciler`

### System Effect:

* rewards detection and resolution of synchronization inconsistencies
* governs MEV-like coordination residue settlement
* incentivizes restoration of canonical state after divergence

### Game-theoretic effect:

* aligns selfish optimization with global coherence repair
* transforms MEV from extraction into correction mechanism

### Sync interaction:

* acts as *anti-drift stabilizer*
* increases long-term system coherence under adversarial latency

---

# 🔗 TOKEN INTERACTION MODEL (GLOBAL SYSTEM BEHAVIOR)

Tokens interact as a **coupled constraint system**:

* ComputeToken ↑ → drift ↑ → ResidueToken opportunities ↑
* MemoryToken ↑ → reconstruction advantage ↑ → Sync pressure ↑
* SyncToken ↑ → system coherence ↑ → ResidueToken yield ↓ (stability effect)
* RoutingToken ↑ → information asymmetry ↑ → MEV residue formation ↑
* ResidueToken ↑ → system correction rate ↑ → long-term coherence ↑

---

# 🧠 NFT BINDING MODEL (STACK IDENTITY COHERENCE LAYER)

Each `StackIdentity (ERC-721)` NFT:

* holds all five token balances
* defines token interaction coefficients per stack
* enforces global constraint policy for token effects

### NFT-level properties:

* **Coherence Profile Vector (CPV)**:
  defines how strongly each token influences a stack

* **Epoch Binding Curve**:
  modifies token effects over time

* **Drift Resistance Factor**:
  determines tolerance to desynchronization

---

# ⏱ SYNCHRONIZATION EFFECTS ACROSS STACK

Token distribution determines:

### 1. EVM execution speed (cortex-evm)

### 2. PoW timing authority (medulla-pow)

### 3. memory reconstruction fidelity (hippocampus-dag)

### 4. sleeve continuity stability (sleeve-runtime)

### 5. cross-chain ordering authority (thalamus-router)

---

# 🧩 MEMORY-HARD COORDINATION PROPERTY (UPDATED WITH TOKENS)

System now explicitly enforces:

> it is computationally and temporally infeasible to simultaneously maximize:

* ComputeToken utilization (EVM execution)
* SyncToken authority (PoW timing dominance)
* MemoryToken depth (DAG reconstruction)

This creates a **multi-axis resource constraint system**, where:

* specialization emerges naturally
* synchronization becomes economically expensive
* MEV-like residues are structurally unavoidable

---

# ⚡ MEV-RESIDUE SYSTEM (TOKEN-DRIVEN EXTENSION)

Residual states now explicitly depend on token imbalance:

* high RoutingToken + low SyncToken → stale ordering caches
* high ComputeToken + low MemoryToken → speculative execution divergence
* high MemoryToken + low SyncToken → historically accurate but non-canonical state branches

These become:

> **Coordination Residue Events (CREs)**

CREs are resolved via:

* ResidueToken issuance
* cross-stack reconciliation
* canonical state recomposition

---

## (REST OF ORIGINAL PLAN UNCHANGED BELOW)

### Naming convention (neuro × crypto × Altered Carbon)

| Service                | Neuro             | Crypto               | Cyberpunk / AC                            |
| ---------------------- | ----------------- | -------------------- | ----------------------------------------- |
| `cortex-evm`           | Prefrontal cortex | EVM execution        | Synaptic Stack                            |
| `medulla-pow`          | Brain stem        | Bitcoin-fork PoW     | Cortical Anchor Chain                     |
| `hippocampus-dag`      | Hippocampus       | IPFS-fork DAG        | DHF Memory Lattice                        |
| `thalamus-router`      | Thalamus          | Cross-chain coord    | Corpus Callosum Bridge                    |
| `synapse-api`          | Synapse           | REST/GQL/WS gateway  | Envoy Interface                           |
| `needlecast-router`    | Axonal cast       | State-transfer       | Needlecaster                              |
| `quellist-treasury`    | Reward circuit    | Token issuer         | Quellist Treasury *(Quellcrist Falconer)* |
| `residue-collector`    | Pattern resolver  | MEV residue worker   | Coordination Reaper                       |
| `drift-detector`       | Cerebellum        | Sleeve drift monitor | Coherence Sentinel                        |
| `dhf-compositor`       | Default-mode net  | Reconstruction svc   | DHF Compositor                            |
| `axonal-bus`           | Axon              | NATS event bus       | Axonal Bus                                |
| `cortical-registry-db` | Substantia nigra  | PostgreSQL           | Stack Registry                            |
| `working-memory-cache` | Working memory    | Redis                | Working Cache                             |

---

### Steps

**Phase 0 — Foundation**: pnpm/Turborepo monorepo `ecca-stack-v3/`, `/proto/` for gRPC contracts, GHCR CI.

**Phase 1 — Chain forks (parallel, hybrid C)**:

* `medulla-pow` — patched **btcd** (Go primary + wire-compatible Rust alt) with `OP_COHERENCE_ROOT` opcode and **Synaptic Field MMR** in block headers (modified memory structure: 256-deep MMR over coherence roots)
* `hippocampus-dag` — patched **kubo** (Go primary + rust-libp2p alt) with epoch-tagged CIDs (multicodec `0xECCA`), blockstore indexed by `(epoch, stackId, cid)` for O(log n) epoch-window scans, token-gated DHT records
* `cortex-evm` — patched **geth** (Clique PoA in compose) with `isCoherent()` and `verifyMerkleShard()` precompiles, per-stack state-trie subtrees for cognitive locality

**Phase 2 — Contracts**: `StackIdentity` (ERC-721), 4× `BandwidthToken` (ERC-20), `QuellistTreasury`, `NeedlecastRouter`, `ResidueRegistry`, `SleeveRegistry`, `EpochAnchor`. Hardhat + Foundry dual setup.

**Phase 3 — TS service mesh** (Fastify + BullMQ + NATS + Prisma + viem):

* *Core orchestration*: `synapse-api`, `thalamus-router`, `dhf-compositor`, `needlecast-router-svc`
* *Sleeve fleet (HPA-scalable)*: `sleeve-runtime-{human,ai,mining,memory}` — AI sleeve pluggable OpenAI/Anthropic/Ollama
* *Workers*: `epoch-anchor`, `drift-detector`, `residue-collector`, `memory-reconciler`, `pinning-service`, `bandwidth-meter`
* *Treasury*: `quellist-treasury-svc`, `bandwidth-faucet`

**Phase 4 — Data plane**: PostgreSQL 16 (registry), Redis 7 (hot cache + queues), NATS JetStream (axonal-bus), MinIO (shard vault), optional Neo4j (semantic graph), Prometheus+Grafana, Loki, Jaeger.

**Phase 5 — APIs**: REST + GraphQL (Mercurius) + WebSocket on `synapse-api`; chain RPCs passed through (`:8545`, `:8332`, `:5001/:8080`); OpenAPI 3.1 + GraphQL schema + AsyncAPI auto-generated.

**Phase 6 — Docs (20 documents)**: existing v2 docs + `architecture.md`, `chain_forks.md`, `coherence_root.md`, `synaptic_field_mmr.md`, `coordination_residues.md`, `token_economy.md` (port of theory.md), `incentive_loop.md`, `deployment.md`, `api_reference.md`, `runbook.md`, `security_model.md`, `glossary.md`.

**Phase 7 — Compose & K8s**: `docker-compose.yml` (laptop, ~22 services), `docker-compose.distributed.yml` (Swarm overlay, replicas), `/deploy/k8s/` Helm charts grouped by chains/data/orchestration/sleeves/workers/observability.

**Phase 8 — Verification**: end-to-end re-sleeving across hosts (fidelity ≥ 0.95), reorg recovery, bandwidth exhaustion, full MEV-residue cycle, drift saturation, token gating; k6 load tests; pumba chaos; v2 test-vector compat replay.

### Build dependency graph

* **P1 (blocking)**: Phase 0 → minimal Phase 4 (postgres+redis+nats up)
* **P2 (parallel)**: Phase 1A medulla, 1B hippocampus, 1C cortex Go forks; Phase 2 contracts (mock-deployed)
* **P3 (after P2)**: Phase 3.1 core orchestration services
* **P4 (parallel after P3)**: Phase 3.2 sleeves, 3.3 workers, 3.4 treasury, Phase 1 Rust alt impls
* **P5 (after P4)**: Phase 5 API wiring, Phase 6 docs, Phase 7 distributed deploys, Phase 8 verification

### Verification

1. `docker compose up -d` boots all 22 services to healthy state
2. v2 test vectors replay green via `compat-runner`
3. End-to-end re-sleeving across two physically distinct hosts in `docker-compose.distributed.yml` produces fidelity ≥ 0.95
4. Induced medulla-pow reorg crossing an anchor recovers canonical state via `memory-reconciler`
5. `ResidueRegistry` pays out to first valid resolution proof in induced desync test
6. Drained `ComputeToken` causes `perceive()` to be throttled, exhaustion event fires
7. k6: synapse-api sustains 1k RPS with p95 < 250ms
8. Chaos: `pumba` kills 30% of sleeves; drift-detector + auto-needlecast restores continuity

### Decisions

* **Fork strategy**: Hybrid C — patched upstream (btcd, kubo, geth) with focused patch sets; both Go (canonical runtime) and Rust (wire-compatible peer) impls for medulla + hippocampus
* **Languages**: TS for all non-chain services + Solidity contracts; Go canonical for chains, Rust as alt peer
* **Runtime target**: laptop docker-compose first; Swarm + K8s manifests for distribution
* **Theory.md is binding**: tokens = control variables (not currency); MEV = coordination repair mechanism
* **In scope**: all 22 services Dockerized + healthy; real protocol code in all forks; full token+treasury+residue suite; full observability stack; 20-doc spec
* **Deferred**: third-party crypto audit; long-running multi-thousand-agent sim runs; production Vault secrets; LLM fine-tuning; mobile/VR sleeve clients; cross-cloud Terraform

### Further considerations

1. **Rust impls — launch-blocking or compat-only?** *Recommendation:* Go canonical for compose; Rust impls run in CI as alternative peers proving protocol portability — they are not on the hot path for `docker compose up`.
2. **AI sleeve LLM provider — default?** *Recommendation:* pluggable via env (`OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `OLLAMA_URL`); compose default = local Ollama so laptop runs fully offline.
3. **Residue payout model — auction or first-valid-proof?** *Recommendation:* per theory.md §8 framing, **proportional first-valid-proof** so incentives reward repair speed, not extraction. Configurable on `ResidueRegistry`.

---