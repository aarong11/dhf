// ecca-stack/mining-network/index.js
// "DHF Time Engine" — mining is redefined as the generation of TEMPORAL
// CONSISTENCY PROOFS for DHF stacks.
//
// Miners produce:
//   - epoch anchors
//   - synchronization proofs
//   - state validity hashes
//
// Mining pools coordinate DHF synchronization windows and resolve memory
// ordering conflicts.

const crypto = require('crypto');
const { sha256hex } = require('../crypto');
const { listStacks } = require('../dhs-core');
const { engine } = require('../coordination-engine');

class MiningNetwork {
  constructor() {
    this.pools = new Map(); // poolId → { miners: Set, blocks: [] }
    this.chain = [];        // [{ index, prevHash, hash, nonce, root, ts, epoch, difficulty }]
    this.difficulty = 3;    // leading-zero hex chars
  }

  registerPool(poolId) {
    if (!this.pools.has(poolId)) this.pools.set(poolId, { miners: new Set(), blocks: [] });
    return this.pools.get(poolId);
  }

  joinPool(poolId, sleeveId) {
    const p = this.registerPool(poolId);
    p.miners.add(sleeveId);
  }

  /**
   * Produce a temporal-consistency proof.
   * The block "root" is the cross-chain root from the coordination engine,
   * binding mining to identity coherence.
   */
  mineBlock(poolId = 'genesis-pool') {
    const pool = this.registerPool(poolId);
    const cross = engine.tick();
    const prev = this.chain[this.chain.length - 1];
    const prevHash = prev ? prev.hash : '0'.repeat(64);
    const epoch = (prev ? prev.epoch : 0) + 1;

    let nonce = 0;
    let hash;
    const target = '0'.repeat(this.difficulty);
    while (true) {
      hash = sha256hex(`${prevHash}|${cross.cross}|${epoch}|${nonce}`);
      if (hash.startsWith(target)) break;
      nonce += 1;
      if (nonce > 1_000_000) break; // safety
    }

    const block = {
      index: this.chain.length,
      prevHash,
      hash,
      nonce,
      root: cross.cross,
      chains: cross.chains,
      ts: Date.now(),
      epoch,
      difficulty: this.difficulty,
      pool: poolId,
    };
    this.chain.push(block);
    pool.blocks.push(block.index);

    // Advancing an epoch triggers epoch-anchor creation for all stacks.
    // (Stacks may locally advance to align their cognitive epoch.)
    for (const s of listStacks()) {
      // Not all stacks advance every block — coherence is partial.
      if (Math.random() < 0.7) s.advanceEpoch();
    }

    return block;
  }

  state() {
    return {
      height: this.chain.length,
      head: this.chain[this.chain.length - 1] || null,
      pools: [...this.pools.entries()].map(([id, p]) => ({
        id,
        miners: p.miners.size,
        blocks: p.blocks.length,
      })),
      difficulty: this.difficulty,
    };
  }
}

const network = new MiningNetwork();
module.exports = { MiningNetwork, network };
