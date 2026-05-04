# ECCA STACK v2 — DHF-Compatible Embodied Cognitive System

> Consciousness (human or AI) is not stored — it is **reconstructed** across distributed cryptographic memory graphs, synchronized through temporal anchors and embodied through interchangeable execution substrates ("sleeves").

This repository is a **research-grade simulation** of identity persistence across bodies and substrates, modeled on the *Altered Carbon* DHF/Stack/Sleeve metaphor and implemented as a working distributed cognitive OS.

## Quick start

```bash
cd ecca-stack
npm install
npm run demo     # runs an end-to-end simulation: spawn stack → spawn sleeves → needlecast → reconstruct
npm start        # starts the REST + WebSocket API on http://localhost:7070
```

Open `frontend/index.html` in a browser (or visit `http://localhost:7070/`) to see the live cognitive dashboard.

## Layout

```
/ecca-stack
  /contracts            Solidity contracts (StackIdentity, ComputeToken, ...)
  /dhs-core             DHFStack model (identity + memory + tokens + embodiment)
  /sleeves              Embodiment runtime (sleeve instances)
  /needlecasting        Cryptographic state-transfer protocol
  /memory-ipfs          IPFS-like encrypted CID DAG
  /coordination-engine  Cross-chain "corpus callosum" sync layer
  /mining-network       Temporal-consistency proof engine
  /crypto               Encryption, Merkle, epoch keys
  /api                  Express + WebSocket server
  /frontend             Live dashboard
  /docs                 Theory & specification
  /scripts              Demo + test runners
```

See [docs/dhf_overview.md](docs/dhf_overview.md) for the full theory.

## Core principle

A "mind" is not stored. It is **continuously reassembled from encrypted distributed state**.
