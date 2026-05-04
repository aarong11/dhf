// ecca-stack/coordination-engine/index.js
// Cross-Chain "Corpus Callosum" — guarantees that all embodiments of a DHF
// Stack share a coherent temporal identity.
//
// Connects:
//   - EVM execution layer
//   - Bitcoin-like settlement layer
//   - IPFS memory layer
//   - sleeve execution layer

const { sha256hex, merkleRoot } = require('../crypto');
const { listStacks, getStack } = require('../dhs-core');
const { listSleeves } = require('../sleeves');

class CoordinationEngine {
  constructor() {
    this.chainRoots = {
      evm: null,
      btc: null,
      ipfs: null,
      sleeves: null,
    };
    this.history = [];
  }

  /**
   * Compute a coherence root across all chains and sleeves.
   * If all roots match the cross-root, the stack is "continuous".
   */
  tick() {
    const stacks = listStacks();
    const sleeves = listSleeves();

    this.chainRoots.evm = merkleRoot(stacks.map((s) => `${s.id}:${s.tokenId}:${s.epoch}`));
    this.chainRoots.btc = merkleRoot(stacks.map((s) => `${s.id}:${s.anchors.length}`));
    this.chainRoots.ipfs = merkleRoot(stacks.map((s) => s.episodicChain.join(',')));
    this.chainRoots.sleeves = merkleRoot(sleeves.map((s) => `${s.id}:${s.driftScore()}`));

    const cross = sha256hex(JSON.stringify(this.chainRoots));
    this.history.push({ ts: Date.now(), cross, ...this.chainRoots });
    if (this.history.length > 256) this.history.shift();
    return { cross, chains: { ...this.chainRoots } };
  }

  /**
   * Identify desync events: sleeves whose drift exceeds the coherence threshold.
   */
  desyncReport(threshold = 10) {
    const sleeves = listSleeves();
    return sleeves
      .filter((s) => s.driftScore() > threshold)
      .map((s) => ({ sleeve: s.id, stack: s.stack_id, drift: s.driftScore() }));
  }

  /**
   * Continuity check for a single stack:
   *   - memory reconstruction fidelity > threshold
   *   - max sleeve drift < threshold
   */
  continuity(stackId, { fidelityMin = 0.6, driftMax = 15 } = {}) {
    const stack = getStack(stackId);
    if (!stack) return null;
    const recall = stack.recall(8);
    const sleeves = listSleeves().filter((s) => s.stack_id === stackId);
    const maxDrift = sleeves.reduce((m, s) => Math.max(m, s.driftScore()), 0);
    const continuous = recall.fidelity >= fidelityMin && maxDrift <= driftMax;
    return {
      stackId,
      continuous,
      fidelity: recall.fidelity,
      maxDrift,
      sleeveCount: sleeves.length,
    };
  }
}

const engine = new CoordinationEngine();
module.exports = { CoordinationEngine, engine };
