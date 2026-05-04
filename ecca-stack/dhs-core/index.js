// ecca-stack/dhs-core/index.js
// DHFStack — the core entity model.
// A Stack = Identity Anchor (NFT-like) + Memory Graph (DAG) + Token Bandwidth + Sleeves.
//
// Identity is NOT moved between sleeves; it is reconstructed from the DAG.

const { genIdentityKeypair, sha256hex } = require('../crypto');
const { dag } = require('../memory-ipfs');

let _stackCounter = 0;

class DHFStack {
  constructor({ name, kind = 'human' /* 'human' | 'ai' */ }) {
    _stackCounter += 1;
    this.id = `stack:${kind}:${_stackCounter}:${sha256hex(name + Date.now()).slice(0, 12)}`;
    this.name = name;
    this.kind = kind;

    // Identity Anchor (off-chain mirror of StackIdentity NFT)
    this.identity = genIdentityKeypair();
    this.tokenId = _stackCounter; // mirrors ERC721 tokenId

    // Token Bandwidth Layer (ERC20 mirror)
    this.tokens = {
      compute: 100,   // cognitive processing rate
      memory: 100,    // recall depth
      sync: 100,      // embodiment coherence stability
      routing: 100,   // inter-node visibility
    };

    // Sleeves (embodiments)
    this.sleeves = new Set(); // sleeve ids

    // Cognitive memory graph: episodic head per stack
    /** array of CIDs in temporal order; head is the most recent episodic memory. */
    this.episodicChain = [];

    // Cross-chain anchors produced by needlecasting events
    this.anchors = []; // { merkleRoot, epoch, fromSleeve, toSleeve, ts }

    // Genesis epoch
    this.epoch = 0;
  }

  /** Append an episodic memory fragment to the DAG and link it to prior memory. */
  remember(plaintext, { kind = 'episodic', pin = false } = {}) {
    const links = this.episodicChain.length ? [this.episodicChain[this.episodicChain.length - 1]] : [];
    const cidStr = dag.put({
      stackId: this.id,
      epoch: this.epoch,
      plaintext,
      links,
      kind,
      owner: this.id,
      pinned: pin,
    });
    this.episodicChain.push(cidStr);
    if (pin) dag.pin(cidStr);
    return cidStr;
  }

  /** Reconstruct memory from the head of the episodic chain. */
  recall(depth = 6) {
    const head = this.episodicChain[this.episodicChain.length - 1];
    if (!head) return { fragments: [], broken: [], fidelity: 1 };
    return dag.reconstruct({
      rootCid: head,
      stackId: this.id,
      epoch: this.epoch,
      tokens: this.tokens,
      depth,
    });
  }

  /** Advance the cognitive epoch (called by mining-network on temporal proofs). */
  advanceEpoch() {
    this.epoch += 1;
  }

  state() {
    return {
      id: this.id,
      name: this.name,
      kind: this.kind,
      tokenId: this.tokenId,
      epoch: this.epoch,
      tokens: { ...this.tokens },
      sleeves: [...this.sleeves],
      memory: {
        chainLength: this.episodicChain.length,
        head: this.episodicChain[this.episodicChain.length - 1] || null,
      },
      anchors: this.anchors.length,
      identityPub: this.identity.pub.split('\n').slice(1, -2).join('').slice(0, 32) + '…',
    };
  }
}

// Registry
const stacks = new Map();
function registerStack(stack) { stacks.set(stack.id, stack); return stack; }
function getStack(id) { return stacks.get(id); }
function listStacks() { return [...stacks.values()]; }

module.exports = { DHFStack, registerStack, getStack, listStacks, stacks };
