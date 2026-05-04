# Failure Modes

> When ECCA's invariants break, the system does not crash — identity **fragments**.

## Failure taxonomy

### F1. Cognitive drift overrun

- **Trigger**: `Sleeve.driftScore() > driftMax` (default `15`).
- **Signal**: WebSocket event `cross-chain:desync`, REST `GET /coordination/desync`.
- **Recovery**: `POST /sleeves/sync` (consumes a `SyncToken`). If `SyncToken` is exhausted, the sleeve must be needlecast or decommissioned.

### F2. Memory chain breakage

- **Trigger**: A non-pinned CID is forgotten (`dag.forget`) while still referenced.
- **Symptom**: `recall.fidelity` drops; `broken[]` populated.
- **Recovery**: re-pin from a memory sleeve, or accept partial reconstruction.

### F3. Epoch drift

- **Trigger**: `|sleeve.epoch - n.epoch| > 2` and `n.pinned = false`.
- **Symptom**: decryption succeeds but those fragments are excluded from recall.
- **Recovery**: `Sleeve.sync()` to pull canonical epoch; pin critical memories in advance.

### F4. Bandwidth exhaustion

| Token       | Symptom                                              |
| ----------- | ---------------------------------------------------- |
| `compute`   | `perceive()` returns `compute_token_exhausted`       |
| `memory`    | deep recall returns broken paths                     |
| `sync`      | drift grows unbounded                                |
| `routing`   | desync alerts not propagated                         |

### F5. Needlecast tampering

- **Signature invalid** → `signature_invalid` (envelope dropped).
- **Merkle mismatch** → `merkle_mismatch` (shards substituted).
- **Cross-stack** → `cross_stack_needlecasting_forbidden`.
- **Identity mismatch** → `identity_mismatch`.

### F6. Cross-chain desync

- **Trigger**: `evm`, `btc-like`, `ipfs`, or `sleeves` sub-roots diverge from prior coherence root.
- **Signal**: `engine.tick().cross` changes between consecutive ticks without a state-changing operation.
- **Recovery**: mining-network produces a new epoch anchor; coordination engine re-derives the cross root.

## Identity fragmentation

When multiple failures co-occur (e.g. drift + epoch desync + bandwidth exhaustion), a single stack may present **inconsistent recollections across its sleeves**. The system does **not** force a winner — it surfaces the divergence as a continuity violation:

```js
GET /stacks/:id/continuity
→ { continuous: false, fidelity: 0.42, maxDrift: 27, sleeveCount: 3 }
```

Resolution is a **policy decision**, not a system invariant: a UI may choose to consolidate via majority-needlecast, prefer the pinned chain, or accept the fragmentation as a feature.
