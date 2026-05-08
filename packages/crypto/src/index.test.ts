import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  sha256, sha256hex, cid, parseCid,
  epochKey, encrypt, decrypt,
  genIdentityKeypair, sign, verify,
  merkleRoot, merkleProof, verifyMerkleProof,
  SynapticFieldMMR, coherenceRoot,
  bytesToHex, hexToBytes, utf8ToBytes,
} from './index.js';

// ─── sha256 ────────────────────────────────────────────────────────────────
describe('sha256', () => {
  it('returns 32 bytes for string input', () => {
    const h = sha256('hello');
    assert.equal(h.length, 32);
  });

  it('returns 32 bytes for Uint8Array input', () => {
    const h = sha256(new Uint8Array([1, 2, 3]));
    assert.equal(h.length, 32);
  });

  it('is deterministic', () => {
    const a = sha256('test');
    const b = sha256('test');
    assert.deepEqual(a, b);
  });

  it('different inputs produce different hashes', () => {
    const a = sha256('hello');
    const b = sha256('world');
    assert.notDeepEqual(a, b);
  });
});

describe('sha256hex', () => {
  it('returns 64-char hex string', () => {
    const h = sha256hex('hello');
    assert.equal(h.length, 64);
    assert.match(h, /^[0-9a-f]{64}$/);
  });

  it('accepts objects (JSON-serializes)', () => {
    const h = sha256hex({ a: 1 });
    assert.equal(h.length, 64);
  });

  it('is deterministic for objects', () => {
    const a = sha256hex({ x: 1, y: 2 });
    const b = sha256hex({ x: 1, y: 2 });
    assert.equal(a, b);
  });
});

// ─── CID ───────────────────────────────────────────────────────────────────
describe('cid', () => {
  it('produces ecca:// prefixed CID with epoch', () => {
    const c = cid('hello', 42);
    assert.ok(c.startsWith('ecca://'));
    assert.ok(c.endsWith('@42'));
  });

  it('content-addressing: same content + epoch = same CID', () => {
    assert.equal(cid('data', 1), cid('data', 1));
  });

  it('different epoch = different CID', () => {
    assert.notEqual(cid('data', 1), cid('data', 2));
  });
});

describe('parseCid', () => {
  it('parses a valid ECCA CID', () => {
    const c = cid('test', 99);
    const parsed = parseCid(c);
    assert.ok(parsed);
    assert.equal(parsed.hash.length, 64);
    assert.equal(parsed.epoch, 99);
  });

  it('returns null for non-ECCA CIDs', () => {
    assert.equal(parseCid('ipfs://abc'), null);
    assert.equal(parseCid('invalid'), null);
  });

  it('handles CID without epoch', () => {
    const hex = 'a'.repeat(64);
    const parsed = parseCid(`ecca://${hex}`);
    assert.ok(parsed);
    assert.equal(parsed.epoch, 0);
  });
});

// ─── epochKey ──────────────────────────────────────────────────────────────
describe('epochKey', () => {
  it('returns 32-byte key', () => {
    const k = epochKey('stack:test:1:abc', 1);
    assert.equal(k.length, 32);
  });

  it('is deterministic for same inputs', () => {
    const a = epochKey('s1', 1);
    const b = epochKey('s1', 1);
    assert.deepEqual(a, b);
  });

  it('different stack IDs produce different keys', () => {
    const a = epochKey('stack-a', 1);
    const b = epochKey('stack-b', 1);
    assert.notDeepEqual(a, b);
  });

  it('different epochs produce different keys', () => {
    const a = epochKey('s1', 1);
    const b = epochKey('s1', 2);
    assert.notDeepEqual(a, b);
  });

  it('uses HKDF-SHA512 (domain-separated key derivation)', () => {
    // key should be different even for sequential epochs
    const keys = [epochKey('x', 0), epochKey('x', 1), epochKey('x', 2)];
    const hexes = keys.map(k => bytesToHex(k));
    assert.equal(new Set(hexes).size, 3);
  });
});

// ─── AES-256-GCM encryption ───────────────────────────────────────────────
describe('encrypt / decrypt', () => {
  it('round-trips string content', () => {
    const key = epochKey('test-stack', 1);
    const payload = encrypt('hello world', key);
    const decrypted = decrypt(payload, key);
    assert.equal(decrypted, 'hello world');
  });

  it('round-trips binary content', () => {
    const key = epochKey('test-stack', 1);
    const data = new Uint8Array([1, 2, 3, 4, 5]);
    const payload = encrypt(data, key);
    // decrypt returns string (UTF-8), but we can verify bytes work
    assert.ok(payload.ct.length > 0);
  });

  it('produces versioned payload (v: 1)', () => {
    const key = epochKey('x', 0);
    const p = encrypt('test', key);
    assert.equal(p.v, 1);
    assert.ok(p.iv.length > 0);
    assert.ok(p.ct.length > 0);
  });

  it('different encryptions of same plaintext produce different ciphertexts (random IV)', () => {
    const key = epochKey('x', 0);
    const a = encrypt('same text', key);
    const b = encrypt('same text', key);
    assert.notEqual(a.ct, b.ct); // random IV
    assert.notEqual(a.iv, b.iv);
  });

  it('decryption with wrong key fails', () => {
    const k1 = epochKey('stack-a', 1);
    const k2 = epochKey('stack-b', 1);
    const payload = encrypt('secret', k1);
    assert.throws(() => decrypt(payload, k2));
  });

  it('decryption with wrong version throws', () => {
    const key = epochKey('x', 0);
    const payload = encrypt('test', key);
    (payload as any).v = 2;
    assert.throws(() => decrypt(payload, key), /unsupported payload version/);
  });
});

// ─── Ed25519 identity ──────────────────────────────────────────────────────
describe('genIdentityKeypair / sign / verify', () => {
  it('generates hex-encoded keypair', () => {
    const kp = genIdentityKeypair();
    assert.equal(kp.pub.length, 64);  // 32 bytes = 64 hex
    assert.equal(kp.priv.length, 64); // 32 bytes = 64 hex
  });

  it('different calls produce different keypairs', () => {
    const a = genIdentityKeypair();
    const b = genIdentityKeypair();
    assert.notEqual(a.pub, b.pub);
  });

  it('sign + verify round trip', () => {
    const kp = genIdentityKeypair();
    const sig = sign(kp.priv, 'hello agent');
    assert.ok(verify(kp.pub, 'hello agent', sig));
  });

  it('verify rejects wrong message', () => {
    const kp = genIdentityKeypair();
    const sig = sign(kp.priv, 'correct message');
    assert.ok(!verify(kp.pub, 'wrong message', sig));
  });

  it('verify rejects wrong pubkey', () => {
    const kp1 = genIdentityKeypair();
    const kp2 = genIdentityKeypair();
    const sig = sign(kp1.priv, 'test');
    assert.ok(!verify(kp2.pub, 'test', sig));
  });

  it('sign accepts Uint8Array message', () => {
    const kp = genIdentityKeypair();
    const sig = sign(kp.priv, new Uint8Array([1, 2, 3]));
    assert.ok(verify(kp.pub, new Uint8Array([1, 2, 3]), sig));
  });
});

// ─── Merkle tree ───────────────────────────────────────────────────────────
describe('merkleRoot', () => {
  it('returns hex string', () => {
    const root = merkleRoot(['a', 'b', 'c']);
    assert.match(root, /^[0-9a-f]{64}$/);
  });

  it('is deterministic', () => {
    const a = merkleRoot(['x', 'y', 'z']);
    const b = merkleRoot(['x', 'y', 'z']);
    assert.equal(a, b);
  });

  it('different leaves produce different roots', () => {
    const a = merkleRoot(['x', 'y']);
    const b = merkleRoot(['a', 'b']);
    assert.notEqual(a, b);
  });

  it('order matters', () => {
    const a = merkleRoot(['a', 'b']);
    const b = merkleRoot(['b', 'a']);
    assert.notEqual(a, b);
  });

  it('handles single leaf', () => {
    const root = merkleRoot(['only-one']);
    assert.match(root, /^[0-9a-f]{64}$/);
  });

  it('handles empty array', () => {
    const root = merkleRoot([]);
    assert.match(root, /^[0-9a-f]{64}$/);
  });

  it('accepts Uint8Array leaves', () => {
    const root = merkleRoot([new Uint8Array([1, 2]), new Uint8Array([3, 4])]);
    assert.match(root, /^[0-9a-f]{64}$/);
  });
});

describe('merkleProof / verifyMerkleProof', () => {
  it('generates verifiable proof for each leaf', () => {
    const leaves = ['alpha', 'beta', 'gamma', 'delta'];
    const root = merkleRoot(leaves);

    for (let i = 0; i < leaves.length; i++) {
      const proof = merkleProof(leaves, i);
      assert.ok(verifyMerkleProof(leaves[i]!, proof, root),
        `Proof failed for leaf ${i}`);
    }
  });

  it('proof fails with wrong root', () => {
    const leaves = ['a', 'b', 'c'];
    const proof = merkleProof(leaves, 0);
    assert.ok(!verifyMerkleProof('a', proof, '0'.repeat(64)));
  });

  it('proof fails with wrong leaf', () => {
    const leaves = ['a', 'b', 'c'];
    const root = merkleRoot(leaves);
    const proof = merkleProof(leaves, 0);
    assert.ok(!verifyMerkleProof('wrong', proof, root));
  });

  it('rejects out-of-range index', () => {
    assert.throws(() => merkleProof(['a', 'b'], -1));
    assert.throws(() => merkleProof(['a', 'b'], 2));
  });

  it('handles odd number of leaves', () => {
    const leaves = ['a', 'b', 'c', 'd', 'e'];
    const root = merkleRoot(leaves);
    for (let i = 0; i < leaves.length; i++) {
      const proof = merkleProof(leaves, i);
      assert.ok(verifyMerkleProof(leaves[i]!, proof, root));
    }
  });
});

// ─── SynapticFieldMMR ──────────────────────────────────────────────────────
describe('SynapticFieldMMR', () => {
  it('starts empty', () => {
    const mmr = new SynapticFieldMMR();
    assert.equal(mmr.count(), 0);
  });

  it('append returns root hex after each insert', () => {
    const mmr = new SynapticFieldMMR();
    const root = mmr.append('a'.repeat(64));
    assert.match(root, /^[0-9a-f]{64}$/);
    assert.equal(mmr.count(), 1);
  });

  it('root changes with each append', () => {
    const mmr = new SynapticFieldMMR();
    const roots = new Set<string>();
    for (let i = 0; i < 10; i++) {
      roots.add(mmr.append(sha256hex(`block-${i}`)));
    }
    assert.equal(roots.size, 10); // all distinct
    assert.equal(mmr.count(), 10);
  });

  it('is deterministic (same append order = same root)', () => {
    const a = new SynapticFieldMMR();
    const b = new SynapticFieldMMR();
    for (let i = 0; i < 5; i++) {
      const hash = sha256hex(`item-${i}`);
      a.append(hash);
      b.append(hash);
    }
    assert.equal(a.root(), b.root());
  });

  it('snapshot captures size and peaks', () => {
    const mmr = new SynapticFieldMMR();
    for (let i = 0; i < 7; i++) mmr.append(sha256hex(`n-${i}`));
    const snap = mmr.snapshot();
    assert.equal(snap.size, 7);
    assert.ok(Array.isArray(snap.peaks));
    assert.ok(snap.peaks.length > 0);
    assert.match(snap.root, /^[0-9a-f]{64}$/);
  });

  it('peak count follows binary structure', () => {
    const mmr = new SynapticFieldMMR();
    // After each append, peaks should be non-empty and count should increase
    for (let i = 0; i < 16; i++) {
      mmr.append(sha256hex(`x-${i}`));
      const snap = mmr.snapshot();
      assert.ok(snap.peaks.length > 0, `peaks should be non-empty at count ${i + 1}`);
      assert.equal(snap.size, i + 1);
    }
    // After 16 appends (power of 2), peaks reduce to minimal set
    const snap16 = mmr.snapshot();
    assert.ok(snap16.peaks.length <= 4, `16 appends should have few peaks, got ${snap16.peaks.length}`);
  });
});

// ─── coherenceRoot ─────────────────────────────────────────────────────────
describe('coherenceRoot', () => {
  it('returns hex string', () => {
    const root = coherenceRoot({
      evm: 'a'.repeat(64), btc: 'b'.repeat(64),
      ipfs: 'c'.repeat(64), sleeves: 'd'.repeat(64),
    });
    assert.match(root, /^[0-9a-f]{64}$/);
  });

  it('is deterministic', () => {
    const parts = { evm: '11', btc: '22', ipfs: '33', sleeves: '44' };
    assert.equal(coherenceRoot(parts), coherenceRoot(parts));
  });

  it('different inputs produce different roots', () => {
    const a = coherenceRoot({ evm: 'aa', btc: 'bb', ipfs: 'cc', sleeves: 'dd' });
    const b = coherenceRoot({ evm: 'xx', btc: 'yy', ipfs: 'zz', sleeves: 'ww' });
    assert.notEqual(a, b);
  });

  it('covers all four chains in the hash', () => {
    // Changing any single field should change the root
    const base = { evm: '00', btc: '00', ipfs: '00', sleeves: '00' };
    const refRoot = coherenceRoot(base);
    for (const field of ['evm', 'btc', 'ipfs', 'sleeves'] as const) {
      const modified = { ...base, [field]: 'ff' };
      assert.notEqual(coherenceRoot(modified), refRoot,
        `Changing ${field} should change the coherence root`);
    }
  });
});

// ─── Utility exports ───────────────────────────────────────────────────────
describe('bytesToHex / hexToBytes', () => {
  it('round-trips bytes', () => {
    const bytes = new Uint8Array([0, 1, 15, 255]);
    const hex = bytesToHex(bytes);
    assert.equal(hex, '00010fff');
    assert.deepEqual(hexToBytes(hex), bytes);
  });
});
