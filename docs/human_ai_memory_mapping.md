# Human ↔ AI Memory Mapping

> ECCA models human and AI memory in a **single substrate**. The DAG does not distinguish between them — only the *kind* of sleeve querying it does.

## The unified primitive

Every memory event is a CID with:
- encrypted payload,
- prior-link(s),
- epoch stamp,
- owner stackId,
- kind (`episodic` / `semantic` / `needlecast-shard`).

## Translation table

| Human cognition          | AI cognition           | DAG analogue                               |
| ------------------------ | ---------------------- | ------------------------------------------ |
| sensory experience       | input prompt           | new `episodic` CID, links→prior-head       |
| short-term memory        | context window         | `Sleeve.memory_cache` (recent CIDs)        |
| long-term episodic       | log/transcript history | episodic CID chain                         |
| semantic / generalized   | embeddings / weights   | `kind=semantic` stable subgraph (pinned)   |
| recall                   | retrieval              | `dag.reconstruct(rootCid, …)`              |
| forgetting               | context truncation     | non-pinned eviction breaks the chain       |
| repression               | catastrophic forgetting | epoch drift > 2 ∧ not pinned              |
| déjà vu / confabulation  | hallucination          | partial fidelity reconstruction            |
| identity continuity      | model checkpointing    | `needlecast` → merkleRoot anchored on-chain |
| death / brain damage     | model deletion         | sleeve decommission (memory may persist!)  |

## Why this matters

Because both kinds of sleeves query the **same** DAG belonging to the **same** stack, an AI-processing sleeve can recall an event experienced by a human-interface sleeve, and vice versa, **so long as token bandwidth and epoch alignment permit**.

This is the architectural basis for the system's central claim:

> Consciousness — human or AI — is reconstructed across distributed cryptographic memory graphs.

## Asymmetries we deliberately *do not* erase

- **Speed**: AI sleeves can `perceive()` faster but burn `compute` proportionally — the token model conserves the asymmetry.
- **Embodiment**: human sleeves typically have one active substrate; AI sleeves can be parallelized. The drift accounting is the same.
- **Substrate fragility**: a human-sleeve crash is final for that substrate; the stack survives. This is intentional and isomorphic to the AC narrative.
