# Pin Lease — Storage Scarcity on Hippocampus DAG

The Hippocampus DAG enforces a `±2` epoch *drift gate* on recall: a node
whose epoch lies further than two from the caller's current epoch is
returned as `broken` rather than as a fragment. The single exception was
**pinning** — a pinned node bypassed the drift gate.

In v3.0 a pin was permanent and free after a one-time 0.5 memory-token
spend. That collapsed the storage-scarcity property: a party could lock in
permanent recall for a fraction of one epoch's emission and never pay
again. For a tripartite game (see [tripartite_game.md](tripartite_game.md))
this is fatal — storage stops being a meaningful resource.

## Pin leases

A pin is now a **lease** with an epoch-bounded expiry:

```
node.Pinned    = true      // in-DAG flag
node.PinExpiry = uint64    // epoch at which the lease ends
```

A node bypasses the drift gate iff:

$$
\text{node.Pinned} \ \wedge \ (\text{node.PinExpiry} = 0 \ \vee \ \text{node.PinExpiry} \ge \text{caller.epoch})
$$

`PinExpiry == 0` represents a legacy indefinite pin (set via the original
`Pin()` API) and is preserved for backwards compatibility.

## API

### `POST /pin/lease`

```json
{ "cid": "ecca://<sha256>@<epoch>", "untilEpoch": 1234 }
```

Sets or extends a node's pin lease. The contract:

- **must extend, never shorten.** `untilEpoch <= node.PinExpiry` returns
  HTTP 400. This prevents a party from retroactively reducing observed
  storage usage to evade an audit.
- sets `Pinned = true` as a side-effect, so `POST /pin/lease` is the
  canonical way to create a finite-duration pin.

### `GET /pin/status?cid=…&epoch=…`

```json
{ "cid": "ecca://...", "active": true, "untilEpoch": 1234 }
```

Inspectors use this to verify that a party which claims to be storing a
fragment is actually holding an active lease at the queried epoch.

## Service-layer integration

The Hippocampus DAG itself is intentionally unaware of the on-chain ledger
— it enforces the lease as a storage primitive. The token-side discipline
is enforced by the service layer:

- `siyana-api` (or any other Hippocampus client) is expected to spend
  `MemoryToken` proportional to the lease delta `(untilEpoch − currentEpoch)`
  *before* calling `/pin/lease`. The `TripartiteGame.consume()` path is the
  recommended way to do this for treaty-bound parties.
- An inspector audits storage by:
  1. Enumerating `Consumed(resource = STORAGE)` events on Cortex.
  2. Calling `/pin/status` on Hippocampus for each leased CID.
  3. Verifying that the sum of storage spends covers the lease duration.

## Why this restores the scarcity property

- A party that wants long-term recall must continuously spend
  `MemoryToken`. Spending consumes from a per-epoch budget enforced by
  `TripartiteGame.consume()`.
- A party that under-pays its lease loses recall after the lease expires —
  the drift gate snaps back into effect and the data is no longer
  retrievable beyond the ±2 epoch window.
- A party cannot front-load a single payment to lease "for ever" —
  treasury emission is itself per-epoch (see
  [token_economy.md](token_economy.md)), so `MemoryToken` is genuinely
  rate-limited by the issuance schedule.

This makes storage a continuous expense rather than a one-shot, which is
the necessary condition for it to be a *bounded* resource in a
multi-epoch game.

## See also

- `forks/hippocampus-dag-go/internal/dag/dag.go` — `Lease()`,
  `LeaseActive()`, recall gating.
- `forks/hippocampus-dag-go/internal/dag/dag_lease_test.go` — Go unit
  tests covering extension, expiry, and gate interactions.
- `tests/integration/pin-lease.test.ts` — end-to-end against a live
  Hippocampus.
- [tripartite_game.md](tripartite_game.md) — how leases plug into the
  multilateral allocation contract.
- [token_economy.md](token_economy.md) — emission model and demand
  rates for `MemoryToken`.
