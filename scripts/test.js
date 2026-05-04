// scripts/test.js — minimal assertions covering the core simulation invariants.

const assert = require('assert');
const { DHFStack, registerStack } = require('../dhs-core');
const { spawnSleeve } = require('../sleeves');
const { needlecast, freeze, reconstruct } = require('../needlecasting');
const { network } = require('../mining-network');
const { engine } = require('../coordination-engine');
const { dag } = require('../memory-ipfs');
const { merkleRoot, sha256hex, encrypt, decrypt, epochKey, sign, verify, genIdentityKeypair } = require('../crypto');

let n = 0, fail = 0;
function t(name, fn) {
  n++;
  try { fn(); console.log(`  ok   ${name}`); }
  catch (e) { fail++; console.log(`  FAIL ${name}\n        ${e.message}`); }
}

console.log('\nECCA stack — core invariants');
console.log('────────────────────────────');

t('crypto: encrypt/decrypt round-trip', () => {
  const k = epochKey('s', 1);
  const ct = encrypt('hello', k);
  assert.strictEqual(decrypt(ct, k), 'hello');
});

t('crypto: ed25519 sign/verify', () => {
  const kp = genIdentityKeypair();
  const sig = sign(kp.priv, 'msg');
  assert.ok(verify(kp.pub, 'msg', sig));
  assert.ok(!verify(kp.pub, 'tampered', sig));
});

t('crypto: merkle root deterministic', () => {
  assert.strictEqual(merkleRoot(['a', 'b', 'c']), merkleRoot(['a', 'b', 'c']));
});

t('memory DAG: store + reconstruct', () => {
  const s = registerStack(new DHFStack({ name: 'A', kind: 'ai' }));
  s.remember('m1');
  s.remember('m2');
  s.remember('m3');
  const r = s.recall(8);
  assert.ok(r.fragments.length >= 3, `got ${r.fragments.length}`);
  assert.ok(r.fidelity > 0.5);
});

t('sleeves: shared identity, divergent local state', () => {
  const s = registerStack(new DHFStack({ name: 'Twin', kind: 'human' }));
  const a = spawnSleeve({ stackId: s.id, embodiment_type: 'human' });
  const b = spawnSleeve({ stackId: s.id, embodiment_type: 'ai' });
  a.perceive('only-A');
  assert.notStrictEqual(a.driftScore(), b.driftScore());
  assert.strictEqual(a.stack_id, b.stack_id);
});

t('needlecasting: A→B reconstructs A\'s state in B', () => {
  const s = registerStack(new DHFStack({ name: 'NC', kind: 'human' }));
  const a = spawnSleeve({ stackId: s.id, embodiment_type: 'human' });
  const b = spawnSleeve({ stackId: s.id, embodiment_type: 'ai' });
  a.perceive('memory-1');
  a.perceive('memory-2');
  const beforeB = JSON.stringify(b.local_state.thoughts);
  const r = needlecast(a.id, b.id);
  assert.strictEqual(r.ok, true, r.reason);
  assert.notStrictEqual(JSON.stringify(b.local_state.thoughts), beforeB);
  assert.ok(r.fidelity > 0);
});

t('needlecasting: cross-stack forbidden', () => {
  const s1 = registerStack(new DHFStack({ name: 'X' }));
  const s2 = registerStack(new DHFStack({ name: 'Y' }));
  const a = spawnSleeve({ stackId: s1.id, embodiment_type: 'human' });
  const b = spawnSleeve({ stackId: s2.id, embodiment_type: 'human' });
  const r = needlecast(a.id, b.id);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'cross_stack_needlecasting_forbidden');
});

t('needlecasting: tampered signature rejected', () => {
  const s = registerStack(new DHFStack({ name: 'T' }));
  const a = spawnSleeve({ stackId: s.id, embodiment_type: 'human' });
  const b = spawnSleeve({ stackId: s.id, embodiment_type: 'ai' });
  a.perceive('x');
  const env = freeze(a.id);
  env.signature = '00'.repeat(64);
  const r = reconstruct(b.id, env);
  assert.strictEqual(r.ok, false);
});

t('mining: block extends chain & advances epochs probabilistically', () => {
  const before = network.chain.length;
  const block = network.mineBlock('test-pool');
  assert.strictEqual(network.chain.length, before + 1);
  assert.ok(block.hash.startsWith('0'.repeat(network.difficulty)));
});

t('coordination: cross-chain root is deterministic per-state', () => {
  const r1 = engine.tick();
  const r2 = engine.tick();
  assert.strictEqual(r1.cross, r2.cross);
});

console.log(`\n${n - fail}/${n} passed${fail ? `  (${fail} failed)` : ''}`);
process.exit(fail ? 1 : 0);
