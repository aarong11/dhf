# Token Bandwidth Model

> Tokens regulate **how much "attention bandwidth" a DHF Stack can allocate** across sleeves and memory graphs.

## The four bandwidth tokens

| Token          | Regulates                                  | Spent by                                |
| -------------- | ------------------------------------------ | --------------------------------------- |
| `ComputeToken` | cognitive processing rate                  | `Sleeve.perceive()`                     |
| `MemoryToken`  | recall depth                               | `dag.reconstruct()` (depth gate)        |
| `SyncToken`    | embodiment coherence stability             | `Sleeve.sync()` / `needlecast()`        |
| `RoutingToken` | inter-node visibility                      | cross-chain coordination broadcasts     |

## Allocation across sleeves

When a sleeve is spawned, it receives a **fractional slice** (currently `1/4`) of the stack's token balance for each resource. Sleeves spend **their own slice**; the canonical stack balance is unchanged.

This means: spawning more sleeves does **not** increase total cognitive bandwidth — it **divides** it. The model resists "free embodiment".

## Recall depth gate

```
depth_d_authorized ⇔  tokens.memory ≥ d
```

A stack with `MemoryToken = 4` cannot recall events older than 4 hops along its episodic chain — the older fragments exist on the DAG but cannot be decrypted at runtime.

## On-chain mirror

`contracts/BandwidthToken.sol` is an ERC-20-shaped template instantiated four times (one per resource). The `spend(amount, reason)` method emits `BandwidthSpent(sleeve, amount, reason)` so off-chain replicas can trace which sleeve consumed which bandwidth.

## Failure mode: bandwidth exhaustion

| Token exhausted | Symptom                                                      |
| --------------- | ------------------------------------------------------------ |
| `compute`       | `perceive()` returns `{ error: 'compute_token_exhausted' }`  |
| `memory`        | recall fidelity drops; old fragments report "broken"         |
| `sync`          | sleeve cannot re-align — drift grows unbounded               |
| `routing`       | cross-chain desync alerts go unbroadcast                     |
