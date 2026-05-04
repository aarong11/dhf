// ecca-stack/crypto/index.js
// Cryptographic primitives for the ECCA stack.
// Uses Node's built-in crypto so the simulation runs zero-dep.

const crypto = require('crypto');

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest();
}

function sha256hex(data) {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(typeof data === 'string' ? data : JSON.stringify(data));
  return sha256(buf).toString('hex');
}

/**
 * CID = "ecca://" + sha256(content)  (IPFS-like content addressing)
 */
function cid(content) {
  return 'ecca://' + sha256hex(content);
}

/**
 * Epoch-derived symmetric key.
 * key = HKDF-ish: sha256(stackId || epoch || masterSecret)
 */
function epochKey(stackId, epoch, masterSecret = 'ECCA_GENESIS') {
  return sha256(Buffer.concat([
    Buffer.from(stackId),
    Buffer.from(String(epoch)),
    Buffer.from(masterSecret),
  ]));
}

function encrypt(plaintext, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(Buffer.from(plaintext)), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    iv: iv.toString('hex'),
    tag: tag.toString('hex'),
    ct: enc.toString('hex'),
  };
}

function decrypt(payload, key) {
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(payload.iv, 'hex')
  );
  decipher.setAuthTag(Buffer.from(payload.tag, 'hex'));
  const dec = Buffer.concat([
    decipher.update(Buffer.from(payload.ct, 'hex')),
    decipher.final(),
  ]);
  return dec.toString('utf8');
}

/**
 * Build a Merkle root from a list of leaves (strings or buffers).
 * Returns hex string.
 */
function merkleRoot(leaves) {
  if (!leaves.length) return sha256hex('');
  let layer = leaves.map((l) => sha256(Buffer.from(typeof l === 'string' ? l : JSON.stringify(l))));
  while (layer.length > 1) {
    const next = [];
    for (let i = 0; i < layer.length; i += 2) {
      const a = layer[i];
      const b = layer[i + 1] || layer[i];
      next.push(sha256(Buffer.concat([a, b])));
    }
    layer = next;
  }
  return layer[0].toString('hex');
}

/**
 * Generate a keypair for a Stack identity (Ed25519).
 */
function genIdentityKeypair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  return {
    pub: publicKey.export({ type: 'spki', format: 'pem' }),
    priv: privateKey.export({ type: 'pkcs8', format: 'pem' }),
  };
}

function sign(privPem, message) {
  const priv = crypto.createPrivateKey(privPem);
  return crypto.sign(null, Buffer.from(message), priv).toString('hex');
}

function verify(pubPem, message, sigHex) {
  try {
    const pub = crypto.createPublicKey(pubPem);
    return crypto.verify(null, Buffer.from(message), pub, Buffer.from(sigHex, 'hex'));
  } catch {
    return false;
  }
}

module.exports = {
  sha256hex,
  cid,
  epochKey,
  encrypt,
  decrypt,
  merkleRoot,
  genIdentityKeypair,
  sign,
  verify,
};
