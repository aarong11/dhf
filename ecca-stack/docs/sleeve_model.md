# Sleeve Model

> A **Sleeve** is a temporary instantiation of a DHF Stack in a computational substrate.

## Definition

```text
Sleeve = {
  stack_id,
  local_state,       // ephemeral cognitive activity (thoughts, last I/O)
  token_weights,     // per-sleeve allocation slice of the stack's bandwidth
  memory_cache,      // recently materialized CIDs
  sync_window,       // { lastSync, drift, epoch }
  embodiment_type    // human | ai | mining | memory
}
```

Multiple sleeves can exist for one stack **simultaneously**. They share identity (the NFT anchor + the canonical DAG) but **diverge in `local_state`**. Divergence accumulates as **cognitive drift**.

## Substrate types

| Type     | Substrate                  | Role                                       |
| -------- | -------------------------- | ------------------------------------------ |
| `human`  | UI / VR / CLI              | human-interface embodiment                 |
| `ai`     | LLM-agent runtime          | AI processing embodiment                   |
| `mining` | PoW node                   | participates in mining-network             |
| `memory` | IPFS storage node          | replicates DAG fragments                   |

## Drift

```
drift_score(sleeve) = local_writes_since_last_sync + (canonical_epoch - sleeve.epoch) × 5
```

A sleeve `sync()` resets drift but consumes a `SyncToken`.

## Cognitive bandwidth

Every `perceive()` call burns **ComputeToken**. Every `recall()` is gated by **MemoryToken** depth. Every `sync()` burns **SyncToken**. **RoutingToken** controls inter-sleeve visibility (currently advisory — see `coordination-engine`).

## Lifecycle

```
spawnSleeve ──► perceive* ──► (drift accumulates)
                              ├──► sync       (re-align with stack.epoch)
                              ├──► needlecast (transfer state to another sleeve)
                              └──► decommission
```

Decommissioning a sleeve does **not** destroy memory — those CIDs remain in the DAG. The sleeve was only a temporary substrate.
