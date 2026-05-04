# Needlecasting Specification

> Cryptographically verified transfer of a DHF Stack's local state between sleeves.
> **Identity is not moved — it is reconstructed in a new substrate.**

## Protocol

```text
Needlecast(Sleeve_A → Sleeve_B):

  1. Freeze       : snapshot = serialize(Sleeve_A)
  2. Shard        : shards = partition(snapshot)            // typed fragments
  3. Encrypt      : c_i = AES-256-GCM(shard_i, K_epoch)     // K_epoch = HKDF(stackId, epoch, master)
  4. Pin in DAG   : cid_i = put(c_i)  with pinned=true
  5. Commit       : root = merkle(cid_1 .. cid_n)
  6. Sign         : σ = Ed25519_sign(stack.priv, stackId | epoch | root)
  7. Anchor       : record(stack, { root, epoch, σ }) on EVM + BTC-like + IPFS
  8. Reconstruct  : at Sleeve_B:
                    a. verify Ed25519(stack.pub, stackId|epoch|root, σ)
                    b. recompute merkle(cid_1..cid_n) == root
                    c. for each cid_i: decrypt(get(cid_i), K_epoch)
                    d. hydrate Sleeve_B.local_state from typed shards
```

## Failure modes

| Failure                              | Detection step | Result               |
| ------------------------------------ | -------------- | -------------------- |
| Identity mismatch (different stack)  | step 8a (pre)  | `identity_mismatch`  |
| Signature tampering                  | step 8a        | `signature_invalid`  |
| Shard substitution                   | step 8b        | `merkle_mismatch`    |
| Epoch drift > 2 (not pinned)         | step 8c        | partial fidelity     |
| Insufficient `MemoryToken` at dest   | step 8c        | partial fidelity     |
| Cross-stack needlecast               | precondition   | `cross_stack_needlecasting_forbidden` |

## Key property

> **Identity is reconstructed, not moved.**
> Sleeve A is unaffected by the needlecast — both A and B may continue to exist as parallel embodiments of the same stack. Cognitive divergence between them is an accepted property of the system, tracked as drift and surfaced as `cross-chain:desync` events.

## Reference implementation

See [needlecasting/index.js](../needlecasting/index.js): `freeze()`, `anchor()`, `reconstruct()`, `needlecast()`.
