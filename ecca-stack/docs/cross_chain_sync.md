# Cross-Chain Sync (Corpus Callosum Layer)

> The **coordination engine** is the corpus callosum of the ECCA stack: it
> binds four heterogeneous chains into a single coherent temporal identity.

## Connected layers

| Sub-root  | Source                                  | Captures                                  |
| --------- | --------------------------------------- | ----------------------------------------- |
| `evm`     | `StackIdentity` (NFT) state             | identity + epoch per stack                |
| `btc`     | settlement-layer anchor count           | finality-grade history per stack          |
| `ipfs`    | DAG episodic-chain digest               | memory state per stack                    |
| `sleeves` | live sleeve-set drift digest            | embodiment coherence                      |

```
chainRoots = { evm, btc, ipfs, sleeves }
crossRoot  = sha256(JSON.stringify(chainRoots))
```

The mining network's `mineBlock()` binds **`block.root = crossRoot`**, so PoW is not "computing arbitrary hashes" — it is producing **temporal-consistency proofs** for the cognitive system.

## Tick cadence

- The API server emits `coordination:tick` over WebSocket every 4s.
- A `mineBlock` call also forces a tick.
- Clients can request a tick via `GET /coordination/tick`.

## Continuity invariant

A stack is *continuous* iff:

```
recall(stack).fidelity ≥ fidelityMin   (default 0.6)
∧ max(sleeve.driftScore for sleeve in stack.sleeves) ≤ driftMax  (default 15)
```

The cross-chain root **is not** part of the per-stack continuity check directly — but a divergence between consecutive `crossRoot` values without a state-changing operation indicates **substrate desync** (chain layers disagree about the same stacks).

## Conflict resolution

When `ipfs` and `sleeves` sub-roots disagree on a stack's most-recent memory:

1. Mining network resolves ordering by including the disputed CIDs in the next block's coherence root.
2. The "winning" chain is the one whose sub-root the next valid block commits to.
3. Sleeves whose `local_state` reflected the losing branch experience a measurable drift increase — which they may resolve via `sync()` or `needlecast()`.

This is the system's analogue of **memory ordering conflict resolution** in human cognition: discrepant recall is not an error; it is a normal state that gets reconciled by attention (mining) over time.
