// ecca-stack/needlecasting/index.js
// Needlecasting — cryptographically verified transfer of DHFStack state
// between sleeves.
//
// Identity is NOT moved. State is encrypted, anchored, and reconstructed in
// a new substrate.
//
// Mechanism:
//   1. Source sleeve freezes a snapshot of local_state.
//   2. Snapshot is encrypted with an epoch-derived key.
//   3. Encrypted shards are committed to the memory DAG.
//   4. A Merkle root over shards is anchored on-chain (cross-chain anchor).
//   5. Destination sleeve reconstructs by walking the CID graph under
//      (epoch, token, identity-signature) constraints.

const { merkleRoot, sign, verify, sha256hex } = require('../crypto');
const { getStack } = require('../dhs-core');
const { getSleeve } = require('../sleeves');
const { dag } = require('../memory-ipfs');

/**
 * Freeze the source sleeve's local state into an encrypted shard set,
 * commit shard CIDs into the DAG, and produce a Merkle root.
 */
function freeze(sourceSleeveId) {
  const src = getSleeve(sourceSleeveId);
  if (!src) throw new Error('source sleeve not found');
  const stack = getStack(src.stack_id);
  if (!stack) throw new Error('stack not found');

  const snapshot = src.serialize();
  // Shard the snapshot into typed fragments so reconstruction is partial-tolerant.
  const shards = [
    { name: 'thoughts', payload: JSON.stringify(snapshot.local_state.thoughts) },
    { name: 'tokens', payload: JSON.stringify(snapshot.token_weights) },
    { name: 'memory_cache', payload: JSON.stringify(snapshot.memory_cache) },
    { name: 'sync_window', payload: JSON.stringify(snapshot.sync_window) },
    { name: 'embodiment_type', payload: String(snapshot.embodiment_type) },
  ];

  const cids = shards.map((s) =>
    dag.put({
      stackId: stack.id,
      epoch: stack.epoch,
      plaintext: JSON.stringify(s),
      links: [],
      kind: 'needlecast-shard',
      owner: stack.id,
      pinned: true, // pin so it survives forgetting until reconstructed
    })
  );

  const root = merkleRoot(cids);
  const epoch = stack.epoch;

  // Identity-signed envelope binds the snapshot to the stack's NFT identity.
  const envelopeMsg = `${stack.id}|${epoch}|${root}`;
  const signature = sign(stack.identity.priv, envelopeMsg);

  return { shardCids: cids, merkleRoot: root, epoch, signature, envelopeMsg, stackId: stack.id };
}

/**
 * Anchor the frozen envelope on-chain (mock cross-chain anchor record).
 */
function anchor(stackId, envelope) {
  const stack = getStack(stackId);
  if (!stack) throw new Error('stack not found');
  const record = {
    merkleRoot: envelope.merkleRoot,
    epoch: envelope.epoch,
    ts: Date.now(),
    signature: envelope.signature,
    fromSleeve: envelope.fromSleeve || null,
    toSleeve: envelope.toSleeve || null,
    chains: ['evm', 'btc-like', 'ipfs'], // mock cross-chain commit
  };
  stack.anchors.push(record);
  return record;
}

/**
 * Reconstruct: hydrate destination sleeve from the encrypted envelope.
 */
function reconstruct(destSleeveId, envelope) {
  const dst = getSleeve(destSleeveId);
  if (!dst) throw new Error('destination sleeve not found');
  const stack = getStack(dst.stack_id);
  if (!stack) throw new Error('stack not found');
  if (stack.id !== envelope.stackId) {
    return { ok: false, reason: 'identity_mismatch' };
  }

  // Verify identity-bound envelope signature
  const sigOk = verify(stack.identity.pub, envelope.envelopeMsg, envelope.signature);
  if (!sigOk) return { ok: false, reason: 'signature_invalid' };

  // Verify Merkle root by re-hashing pinned shard CIDs
  const recomputed = merkleRoot(envelope.shardCids);
  if (recomputed !== envelope.merkleRoot) return { ok: false, reason: 'merkle_mismatch' };

  // Walk + decrypt each shard under (epoch, tokens) constraints
  const fragments = [];
  for (const cidStr of envelope.shardCids) {
    const r = dag.reconstruct({
      rootCid: cidStr,
      stackId: stack.id,
      epoch: envelope.epoch,
      tokens: stack.tokens,
      depth: 1,
    });
    fragments.push(...r.fragments);
  }

  // Hydrate destination sleeve's local_state from shards.
  for (const f of fragments) {
    let parsed;
    try { parsed = JSON.parse(f.plaintext); } catch { continue; }
    if (!parsed?.name) continue;
    switch (parsed.name) {
      case 'thoughts':
        dst.local_state.thoughts = JSON.parse(parsed.payload); break;
      case 'tokens':
        dst.token_weights = JSON.parse(parsed.payload); break;
      case 'memory_cache':
        dst.memory_cache = JSON.parse(parsed.payload); break;
      case 'sync_window':
        dst.sync_window = JSON.parse(parsed.payload);
        dst.sync_window.lastSync = Date.now();
        dst.sync_window.drift = 0; break;
      case 'embodiment_type':
        // do not override the destination embodiment type (a new substrate)
        break;
    }
  }

  const fidelity = fragments.length / Math.max(1, envelope.shardCids.length);
  return { ok: true, fidelity, fragments: fragments.length };
}

/**
 * One-shot needlecast: freeze → anchor → reconstruct.
 */
function needlecast(fromSleeveId, toSleeveId) {
  const src = getSleeve(fromSleeveId);
  const dst = getSleeve(toSleeveId);
  if (!src || !dst) throw new Error('sleeve missing');
  if (src.stack_id !== dst.stack_id) {
    return { ok: false, reason: 'cross_stack_needlecasting_forbidden' };
  }
  const envelope = freeze(fromSleeveId);
  envelope.fromSleeve = fromSleeveId;
  envelope.toSleeve = toSleeveId;
  const anchorRec = anchor(src.stack_id, envelope);
  const recon = reconstruct(toSleeveId, envelope);
  return {
    ok: recon.ok,
    from: fromSleeveId,
    to: toSleeveId,
    merkleRoot: envelope.merkleRoot,
    epoch: envelope.epoch,
    fidelity: recon.fidelity,
    anchor: anchorRec,
    reason: recon.reason,
  };
}

module.exports = { freeze, anchor, reconstruct, needlecast };
