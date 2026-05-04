// ecca-stack/memory-ipfs/index.js
// IPFS-like encrypted CID DAG for ECCA cognitive memory.
//
// Memory is NOT a stored dataset — it's a reconstructive graph.
//   - episodic memory  = CID chains (linked by `prev`)
//   - semantic memory  = stable subgraphs (multiple inbound edges, pinned)
//   - recall           = traversal under (epoch, token, sleeve) constraints
//   - forgetting       = a broken CID dependency in the chain
//
// Retrieval requires:
//   1) epoch alignment
//   2) token-weight authorization
//   3) a valid reconstruction path (every linked CID resolvable)

const { cid, encrypt, decrypt, epochKey } = require('../crypto');

class MemoryDAG {
  constructor() {
    /** CID → { ciphertext, links[], epoch, kind, owner, pinned } */
    this.nodes = new Map();
    /** replication: nodeId → Set<CID> (mock peers) */
    this.peers = new Map();
  }

  registerPeer(peerId) {
    if (!this.peers.has(peerId)) this.peers.set(peerId, new Set());
  }

  /**
   * Store an encrypted memory fragment.
   * @returns CID
   */
  put({ stackId, epoch, plaintext, links = [], kind = 'episodic', owner = stackId, pinned = false }) {
    const key = epochKey(stackId, epoch);
    const ciphertext = encrypt(plaintext, key);
    const node = { ciphertext, links, epoch, kind, owner, pinned, stackId };
    const id = cid({ ciphertext, links, epoch, owner, kind });
    this.nodes.set(id, node);
    return id;
  }

  pin(cidStr) {
    const n = this.nodes.get(cidStr);
    if (n) n.pinned = true;
  }

  /**
   * Reconstruct (decrypt + traverse) starting from a CID.
   * Enforces: epoch alignment, token authorization, valid path.
   *
   * @param {object} req
   * @param {string} req.rootCid
   * @param {string} req.stackId
   * @param {number} req.epoch          - sleeve's current epoch
   * @param {object} req.tokens         - { memory, compute, sync, routing }
   * @param {number} [req.depth=8]      - max traversal depth
   */
  reconstruct({ rootCid, stackId, epoch, tokens, depth = 8 }) {
    const out = [];
    const visited = new Set();
    const broken = [];

    const walk = (id, d) => {
      if (d < 0 || visited.has(id)) return;
      visited.add(id);
      const n = this.nodes.get(id);
      if (!n) {
        broken.push(id);
        return;
      }
      // Token authorization: recall depth requires MemoryToken
      const reqDepth = (8 - d);
      if ((tokens?.memory ?? 0) < reqDepth) {
        broken.push(`${id}#insufficient_memory_token`);
        return;
      }
      // Epoch alignment: drift > 2 epochs corrupts decryption
      const drift = Math.abs(epoch - n.epoch);
      if (drift > 2 && !n.pinned) {
        broken.push(`${id}#epoch_drift_${drift}`);
        return;
      }
      try {
        const k = epochKey(stackId, n.epoch);
        const plaintext = decrypt(n.ciphertext, k);
        out.push({ cid: id, kind: n.kind, epoch: n.epoch, plaintext, drift });
      } catch (e) {
        broken.push(`${id}#decrypt_fail`);
        return;
      }
      for (const link of n.links) walk(link, d - 1);
    };

    walk(rootCid, depth);

    const fidelity = out.length / Math.max(1, out.length + broken.length);
    return { fragments: out, broken, fidelity };
  }

  has(cidStr) {
    return this.nodes.has(cidStr);
  }

  size() {
    return this.nodes.size;
  }

  /**
   * Replicate a CID to a mock peer (distributed node replication).
   */
  replicate(cidStr, peerId) {
    this.registerPeer(peerId);
    if (this.nodes.has(cidStr)) this.peers.get(peerId).add(cidStr);
  }

  /**
   * Simulate forgetting: drop a non-pinned node, breaking dependent chains.
   */
  forget(cidStr) {
    const n = this.nodes.get(cidStr);
    if (!n || n.pinned) return false;
    this.nodes.delete(cidStr);
    return true;
  }

  snapshot() {
    return {
      nodes: this.nodes.size,
      pinned: [...this.nodes.values()].filter((n) => n.pinned).length,
      peers: this.peers.size,
    };
  }
}

// Singleton DAG (the "network")
const dag = new MemoryDAG();

module.exports = { MemoryDAG, dag };
