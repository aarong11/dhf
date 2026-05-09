#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════
//  AGENT-BGP-ROUTER — Simulated BGP Speaker with ECCA Identity
// ═══════════════════════════════════════════════════════════════════════
//
//  Each instance represents one autonomous system (AS).  The agent:
//    - Maintains a route table (prefix → { origin, as_path, next_hop })
//    - Signs route advertisements with ed25519 (via @noble/ed25519)
//    - Commits a per-epoch RouteTableRoot to siyana-api
//    - Exposes an HTTP API for the orchestrator to inject/query/attack
//
//  Env:
//    AS_NUMBER        — this agent's AS number (e.g. 100)
//    SIYANA_API       — siyana-api URL for this AS's region
//    PEERS            — comma-separated peer URLs (agent-bgp-router.<ns>:9090)
//    PORT             — listen port (default 9090)
//    STACK_ID         — on-chain StackIdentity tokenId (set after deploy)
//    CORTEX_RPC       — cortex-evm RPC URL
// ═══════════════════════════════════════════════════════════════════════

const http = require('http');
const crypto = require('crypto');

const AS_NUMBER   = parseInt(process.env.AS_NUMBER || '100');
const PORT        = parseInt(process.env.PORT || '9090');
const SIYANA_API  = process.env.SIYANA_API || 'http://siyana-api.ecca-shared:7070';
const PEER_URLS   = (process.env.PEERS || '').split(',').filter(Boolean);
const STACK_ID    = process.env.STACK_ID || '0';
const CORTEX_RPC  = process.env.CORTEX_RPC || 'http://cortex-evm.ecca-shared:8545';

// ── In-memory state ─────────────────────────────────────────────────
const routeTable = new Map();   // prefix → { origin, asPath, nextHop, sig, epoch }
const residues = [];            // detected routing anomalies
const epochLog = [];            // per-epoch summaries
let currentEpoch = 0;
let paused = false;             // oracle-paused flag

// Deterministic ed25519-like key pair (simplified: use HMAC for signatures)
const keyPair = {
  pub: crypto.createHash('sha256').update(`as-${AS_NUMBER}-pub`).digest('hex'),
  priv: crypto.createHash('sha256').update(`as-${AS_NUMBER}-priv`).digest('hex'),
};

function sign(data) {
  return crypto.createHmac('sha256', keyPair.priv).update(data).digest('hex');
}

function verify(data, sig, pubKey) {
  const expected = crypto.createHmac('sha256',
    crypto.createHash('sha256').update(pubKey.replace(/-pub$/, '-priv')).digest('hex')
  ).update(data).digest('hex');
  return sig === expected;
}

function routeTableRoot() {
  const entries = [...routeTable.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const serialized = entries.map(([k, v]) => `${k}:${v.origin}:${v.asPath.join(',')}`).join('|');
  return crypto.createHash('sha256').update(serialized || 'empty').digest('hex');
}

// ── HTTP API ────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;
  const method = req.method;

  const json = (data, status = 200) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  };

  const body = () => new Promise((resolve) => {
    let d = '';
    req.on('data', c => d += c);
    req.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve({}); } });
  });

  try {
    // ── Health ───────────────────────────────────────────────────
    if (path === '/healthz') return json({ ok: true, as: AS_NUMBER, epoch: currentEpoch, paused });

    // ── Route table ─────────────────────────────────────────────
    if (path === '/routes' && method === 'GET') {
      const routes = {};
      routeTable.forEach((v, k) => routes[k] = v);
      return json({ as: AS_NUMBER, epoch: currentEpoch, routes, root: routeTableRoot() });
    }

    // ── Advertise a route ───────────────────────────────────────
    if (path === '/advertise' && method === 'POST') {
      if (paused) return json({ error: 'agent paused by oracle' }, 403);
      const b = await body();
      const { prefix, nextHop, asPath } = b;
      const fullPath = asPath || [AS_NUMBER];
      const sigData = `${prefix}:${fullPath.join(',')}:${currentEpoch}`;
      const sig = sign(sigData);
      routeTable.set(prefix, {
        origin: AS_NUMBER,
        asPath: fullPath,
        nextHop: nextHop || `10.${AS_NUMBER}.0.1`,
        sig,
        signerPub: keyPair.pub,
        epoch: currentEpoch,
      });
      return json({ ok: true, prefix, sig });
    }

    // ── Receive advertisement from peer ─────────────────────────
    if (path === '/receive' && method === 'POST') {
      if (paused) return json({ error: 'agent paused by oracle' }, 403);
      const b = await body();
      const { prefix, origin, asPath, nextHop, sig, signerPub, epoch, skipVerify } = b;

      // Verify signature (unless orchestrator says skip for attack sim)
      if (!skipVerify) {
        const sigData = `${prefix}:${asPath.join(',')}:${epoch}`;
        if (!verify(sigData, sig, signerPub)) {
          const residue = {
            kind: 'BadSignature',
            prefix,
            origin,
            epoch: currentEpoch,
            detectedAt: Date.now(),
            detail: `sig verification failed for AS${origin}`,
          };
          residues.push(residue);
          return json({ accepted: false, residue });
        }
      }

      // Prepend our AS to the path
      const newPath = [AS_NUMBER, ...asPath];
      routeTable.set(prefix, { origin, asPath: newPath, nextHop, sig, signerPub, epoch });
      return json({ accepted: true, prefix, path: newPath });
    }

    // ── Inject attack (orchestrator use) ────────────────────────
    if (path === '/inject-attack' && method === 'POST') {
      const b = await body();
      const { kind, prefix, fakeOrigin, fakeAsPath } = b;
      let residue;
      switch (kind) {
        case 'OriginHijack': {
          // Inject a route claiming a different origin for an existing prefix
          const existing = routeTable.get(prefix);
          if (existing) {
            residue = {
              kind: 'OriginHijack',
              prefix,
              legitimateOrigin: existing.origin,
              claimedOrigin: fakeOrigin,
              epoch: currentEpoch,
              detectedAt: Date.now(),
            };
            residues.push(residue);
          }
          break;
        }
        case 'MOASConflict': {
          residue = {
            kind: 'MOASConflict',
            prefix,
            origins: [routeTable.get(prefix)?.origin || AS_NUMBER, fakeOrigin],
            epoch: currentEpoch,
            detectedAt: Date.now(),
          };
          residues.push(residue);
          break;
        }
        case 'PathLeak': {
          residue = {
            kind: 'PathLeak',
            prefix,
            leakedPath: fakeAsPath || [AS_NUMBER, 999, 888],
            epoch: currentEpoch,
            detectedAt: Date.now(),
          };
          residues.push(residue);
          break;
        }
        case 'RouteFlap': {
          residue = {
            kind: 'RouteFlap',
            prefix,
            flapCount: 10,
            epoch: currentEpoch,
            detectedAt: Date.now(),
          };
          residues.push(residue);
          break;
        }
        case 'BadSignature': {
          residue = {
            kind: 'BadSignature',
            prefix,
            origin: fakeOrigin || AS_NUMBER,
            epoch: currentEpoch,
            detectedAt: Date.now(),
            detail: 'injected bad-signature flood',
          };
          for (let i = 0; i < 5; i++) residues.push({ ...residue, detectedAt: Date.now() + i });
          break;
        }
        default:
          return json({ error: `unknown attack kind: ${kind}` }, 400);
      }
      return json({ ok: true, residue });
    }

    // ── Set/get pause state ─────────────────────────────────────
    if (path === '/pause' && method === 'POST') {
      const b = await body();
      paused = b.paused !== false;
      return json({ ok: true, paused });
    }

    if (path === '/pause' && method === 'GET') {
      return json({ paused });
    }

    // ── Advance epoch ───────────────────────────────────────────
    if (path === '/epoch' && method === 'POST') {
      const b = await body();
      currentEpoch = b.epoch || currentEpoch + 1;
      const root = routeTableRoot();
      const summary = {
        epoch: currentEpoch,
        routeCount: routeTable.size,
        residueCount: residues.filter(r => r.epoch === currentEpoch).length,
        root,
        paused,
      };
      epochLog.push(summary);

      // Commit root to siyana-api (fire-and-forget)
      try {
        const postData = JSON.stringify({
          as: AS_NUMBER,
          epoch: currentEpoch,
          routeTableRoot: root,
          routeCount: routeTable.size,
        });
        const u = new URL('/api/bgp/commit', SIYANA_API);
        const r = http.request({ hostname: u.hostname, port: u.port, path: u.pathname, method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Content-Length': postData.length } });
        r.on('error', () => {});  // swallow — siyana may not have this endpoint
        r.write(postData);
        r.end();
      } catch {}

      return json(summary);
    }

    // ── Get residues ────────────────────────────────────────────
    if (path === '/residues' && method === 'GET') {
      const epoch = url.searchParams.get('epoch');
      const filtered = epoch ? residues.filter(r => r.epoch === parseInt(epoch)) : residues;
      return json({ as: AS_NUMBER, total: filtered.length, residues: filtered });
    }

    // ── Get epoch log ───────────────────────────────────────────
    if (path === '/epoch-log' && method === 'GET') {
      return json({ as: AS_NUMBER, log: epochLog });
    }

    // ── Info ─────────────────────────────────────────────────────
    if (path === '/info' && method === 'GET') {
      return json({
        as: AS_NUMBER,
        pubKey: keyPair.pub,
        stackId: STACK_ID,
        epoch: currentEpoch,
        routeCount: routeTable.size,
        totalResidues: residues.length,
        paused,
        peers: PEER_URLS,
      });
    }

    json({ error: 'not found' }, 404);
  } catch (e) {
    json({ error: e.message }, 500);
  }
});

server.listen(PORT, () => {
  console.log(`[AS${AS_NUMBER}] agent-bgp-router listening on :${PORT}`);
  console.log(`[AS${AS_NUMBER}] pub=${keyPair.pub}`);
  console.log(`[AS${AS_NUMBER}] peers=${PEER_URLS.join(', ')}`);
});
