# DHF Overview

> **DHF Stack** — *Distributed Human Format Stack*: an entity (human or AI) modeled as a distributed cryptographic state machine.

## A "mind" is not stored

It is **continuously reassembled** from encrypted distributed state.

## The four layers

| Layer            | Purpose                                  | Implementation                       |
| ---------------- | ---------------------------------------- | ------------------------------------ |
| Identity Anchor  | persistence across embodiments           | ERC-721 `StackIdentity` + Ed25519 keypair |
| Memory Graph     | reconstructive cognitive substrate       | encrypted CID DAG (`memory-ipfs`)    |
| Token Bandwidth  | regulates cognitive attention            | `BandwidthToken` × 4 (Compute/Memory/Sync/Routing) |
| Embodiment Layer | substrate-specific runtime instances     | `Sleeve` (Node process / browser / container) |

## Lifecycle

```
mintStack ─► remember ─► spawnSleeve ─► perceive
                │                          │
                ▼                          ▼
       (DAG of encrypted CIDs)      (local divergent state)
                │                          │
                └────── needlecast ────────┘
                          │
                          ▼
              merkleRoot anchored cross-chain
                          │
                          ▼
        destination sleeve reconstructs state
```

## What "continuity" means here

A stack is *continuous* iff:

1. **memory reconstruction fidelity** ≥ threshold,
2. **maximum sleeve drift** ≤ threshold,
3. **cross-chain coherence root** is consistent across `evm`, `btc-like`, `ipfs`, `sleeves`.

Violation does not destroy the stack — it **fragments** identity across sleeves. See [failure_modes.md](failure_modes.md).
