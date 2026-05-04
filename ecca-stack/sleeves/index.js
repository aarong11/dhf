// ecca-stack/sleeves/index.js
// Sleeve = a temporary instantiation of a DHFStack in a computational substrate.
//
// Multiple sleeves can exist simultaneously for the same stack; they share
// identity (via NFT anchor / DAG) but diverge in local_state. Divergence is
// tracked as "cognitive drift".
//
// Sleeve types:
//   - human    : Human Interface Sleeve (UI / VR / CLI)
//   - ai       : AI Processing Sleeve (LLM-agent runtime)
//   - mining   : PoW participation node
//   - memory   : IPFS storage node

const { sha256hex } = require('../crypto');
const { getStack } = require('../dhs-core');
const { dag } = require('../memory-ipfs');

let _sleeveCounter = 0;
const sleeves = new Map();

class Sleeve {
  constructor({ stackId, embodiment_type = 'human' }) {
    const stack = getStack(stackId);
    if (!stack) throw new Error(`Unknown stack: ${stackId}`);
    _sleeveCounter += 1;

    this.id = `sleeve:${embodiment_type}:${_sleeveCounter}:${sha256hex(stackId + Date.now()).slice(0, 8)}`;
    this.stack_id = stackId;
    this.embodiment_type = embodiment_type;

    // Local state diverges from the canonical DAG until next sync.
    this.local_state = {
      thoughts: [],         // ephemeral cognitive activity
      lastInput: null,
      lastOutput: null,
    };

    // Per-sleeve view of token weights (allocation slice).
    this.token_weights = {
      compute: stack.tokens.compute / 4,
      memory: stack.tokens.memory / 4,
      sync: stack.tokens.sync / 4,
      routing: stack.tokens.routing / 4,
    };

    this.memory_cache = []; // recent CIDs the sleeve has materialized
    this.sync_window = { lastSync: Date.now(), drift: 0, epoch: stack.epoch };
    this.alive = true;

    stack.sleeves.add(this.id);
    sleeves.set(this.id, this);

    // Register as IPFS replication peer if it's a memory sleeve
    if (embodiment_type === 'memory') dag.registerPeer(this.id);
  }

  /** A sleeve "thinks" / acts: appends an episodic memory to the shared DAG. */
  perceive(input) {
    const stack = getStack(this.stack_id);
    if (!stack) return null;

    // Compute token throttles processing rate
    if (this.token_weights.compute < 1) {
      return { error: 'compute_token_exhausted' };
    }
    this.token_weights.compute -= 0.5;

    this.local_state.lastInput = input;
    const thought = `[${this.embodiment_type}@${this.id.slice(-6)}] ${input}`;
    this.local_state.thoughts.push(thought);
    this.local_state.lastOutput = thought;

    // Persist to canonical DAG via the stack
    const cidStr = stack.remember(thought);
    this.memory_cache.push(cidStr);
    if (this.memory_cache.length > 16) this.memory_cache.shift();

    // Drift accumulates while local_state diverges from sync_window
    this.sync_window.drift += 1;
    return { thought, cid: cidStr };
  }

  /** Force this sleeve to re-align with the canonical stack epoch and DAG. */
  sync() {
    const stack = getStack(this.stack_id);
    if (!stack) return null;
    if (this.token_weights.sync < 1) {
      return { error: 'sync_token_exhausted', drift: this.sync_window.drift };
    }
    this.token_weights.sync -= 1;
    this.sync_window.drift = 0;
    this.sync_window.lastSync = Date.now();
    this.sync_window.epoch = stack.epoch;
    return { ok: true, epoch: stack.epoch };
  }

  /** Reconstruct memory from the sleeve's point of view. */
  recall(depth = 6) {
    const stack = getStack(this.stack_id);
    if (!stack) return null;
    const head = this.memory_cache[this.memory_cache.length - 1] || stack.episodicChain[stack.episodicChain.length - 1];
    if (!head) return { fragments: [], broken: [], fidelity: 1 };
    return dag.reconstruct({
      rootCid: head,
      stackId: stack.id,
      epoch: this.sync_window.epoch,
      tokens: { ...stack.tokens, memory: this.token_weights.memory * 4 },
      depth,
    });
  }

  /** Cognitive drift = local divergence from the canonical sync window. */
  driftScore() {
    const stack = getStack(this.stack_id);
    const epochDelta = stack ? stack.epoch - this.sync_window.epoch : 0;
    return this.sync_window.drift + epochDelta * 5;
  }

  serialize() {
    return {
      stack_id: this.stack_id,
      local_state: this.local_state,
      token_weights: this.token_weights,
      memory_cache: this.memory_cache,
      sync_window: this.sync_window,
      embodiment_type: this.embodiment_type,
    };
  }

  decommission() {
    const stack = getStack(this.stack_id);
    if (stack) stack.sleeves.delete(this.id);
    this.alive = false;
  }

  state() {
    return {
      id: this.id,
      stack_id: this.stack_id,
      embodiment_type: this.embodiment_type,
      alive: this.alive,
      drift: this.driftScore(),
      tokens: this.token_weights,
      epoch: this.sync_window.epoch,
      thoughts: this.local_state.thoughts.slice(-3),
      cacheSize: this.memory_cache.length,
    };
  }
}

function spawnSleeve(opts) { return new Sleeve(opts); }
function getSleeve(id) { return sleeves.get(id); }
function listSleeves() { return [...sleeves.values()].filter((s) => s.alive); }

module.exports = { Sleeve, spawnSleeve, getSleeve, listSleeves, sleeves };
