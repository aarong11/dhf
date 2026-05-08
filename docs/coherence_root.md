# Coherence Root

The **Coherence Root** is a 32-byte hash committed once per epoch into medulla-pow's block header. It binds the four shard roots into a single point of truth.

## Construction

```
crossRoot = sha256( "ecca-coh-v1" ‖ evmRoot ‖ btcRoot ‖ ipfsRoot ‖ sleevesRoot )
```

where each shard root is a per-epoch Merkle root over the shard's events:

- **evmRoot**: `merkleRoot([txHash for tx in epoch where contract ∈ ECCA_CONTRACTS])`
- **btcRoot**: reserved (unused in v3; kept for cross-network bridge in v3.1) → 32 zero bytes
- **ipfsRoot**: `merkleRoot([sha256(cid) for write in epoch])`
- **sleevesRoot**: `merkleRoot([sha256(type ‖ id) for sleeve event in epoch])`

## Verification

A verifier with the medulla anchor `(blockHash, epoch, crossRoot, evmRoot, ipfsRoot, sleevesRoot)` can prove:

- a specific cortex-evm tx was included in epoch `e` via Merkle proof against `evmRoot`
- a specific hippocampus write was anchored via Merkle proof against `ipfsRoot`
- a specific sleeve event existed via proof against `sleevesRoot`

All three proofs share the same root commitment. **One PoW finality finalizes three shards simultaneously.**

## Anti-Equivocation

The thalamus-router signs each `submitcoherenceroot` RPC with its operator key. Two distinct tuples for the same epoch from the same operator → automatic `routing-equivocation` residue with full operator slash via `QuellistTreasury`.

## Cross-Epoch Continuity (v3.1)

The `EpochAnchor` contract on Cortex enforces additional consistency
checks before recording a bridger's anchor:

- `medullaHeight` must strictly increase across epochs — guards against a
  bridger replaying an anchor sourced from a stale or forked PoW tip.
- `verifyContinuity(epoch)` returns whether the `synapticFieldRoot`
  recorded for `epoch` is a witness-consistent extension of the previous
  epoch's anchor. Equality across epochs implies a stalled Medulla and is
  observably suspect to inspectors.
- `verifyShardInclusion(epoch, shard, leaf, siblings, indexBits)` is the
  Merkle-proof verifier any inspector can call to prove that a specific
  Cortex tx, Hippocampus write, or sleeve event was included in the set
  anchored at `epoch`. This is the audit primitive that turns the
  coherence root into a *re-derivable* commitment rather than a trusted
  one.

These three together let an inspector start from the medulla-pow tip and
verify, with no service trust, that:

1. The on-chain anchors form an unbroken increasing-height chain.
2. The synaptic-field MMR root advanced (i.e. the chain is alive, not
   stalled).
3. A specific event of interest was provably included in the anchored
   set for a given epoch.

This is the substrate the `TripartiteGame` audit primitive
(`verifyAllocationFair`) builds on top of for cooperative-game scenarios
— see [tripartite_game.md](tripartite_game.md).

See [synaptic_field_mmr.md](synaptic_field_mmr.md), [coordination_residues.md](coordination_residues.md).
