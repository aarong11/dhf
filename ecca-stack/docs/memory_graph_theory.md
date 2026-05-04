# Memory Graph Theory

> Memory in ECCA is a **distributed reconstructive graph**, not a stored dataset.

## Structure

```
node = {
  ciphertext  : AES-256-GCM payload,
  links[]     : prior CIDs,
  epoch       : write epoch,
  kind        : episodic | semantic | needlecast-shard,
  owner       : stackId,
  pinned      : bool
}

CID = sha256(ciphertext || links || epoch || owner || kind)
```

## Recall = traversal under constraints

A read of root CID `r` succeeds for `(stackId, epoch, tokens)` iff for every visited node `n`:

1. `n` exists in the DAG (else: **broken chain**),
2. `tokens.memory ≥ depth_from_root(n)` (token gating),
3. `|epoch - n.epoch| ≤ 2` **or** `n.pinned` (epoch alignment),
4. `decrypt(n.ciphertext, K(stackId, n.epoch))` succeeds.

```
fidelity = recovered / (recovered + broken)
```

## Mapping to human cognition

| Cognitive concept       | DAG analogue                         |
| ----------------------- | ------------------------------------ |
| episodic memory         | linear CID chain (`prev` link)       |
| semantic memory         | stable subgraph (multiple inbound, pinned) |
| recall                  | traversal under (epoch, token) gates |
| forgetting              | non-pinned node evicted → chain breaks |
| repression / suppression | epoch drift > 2 + not pinned        |
| reconstruction errors   | partial fidelity from broken paths   |

## Mapping to AI cognition

| AI concept        | DAG analogue                        |
| ----------------- | ----------------------------------- |
| embeddings        | compressed memory shards            |
| logs              | episodic CID chains                 |
| long-term memory  | pinned IPFS fragments               |
| context window    | `memory_cache` per sleeve           |
| retrieval-augment | token-gated traversal of `kind=semantic` |

The same graph is queried by both human-interface and AI-processing sleeves of the same stack — this is the unified memory model.

## Replication

Memory sleeves register with the DAG as peers. `dag.replicate(cid, peerId)` copies a CID into a peer's set. In a real deployment this maps to libp2p / IPFS bitswap; here it is a mock so the simulation is observable in-process.
