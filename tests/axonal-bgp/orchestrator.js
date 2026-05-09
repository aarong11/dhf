#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════
//  AXONAL-BGP ORCHESTRATOR — 4-AS Routing Security Simulation
// ═══════════════════════════════════════════════════════════════════════
//
//  Drives 4 BGP-speaking agents through 50 epochs with 6 scripted
//  attack/response scenarios to demonstrate the Axonal-BGP protocol.
//
//  Scenario timeline:
//    Epoch 10 — Origin hijack: AS-300 claims AS-100's prefix
//    Epoch 20 — MOAS conflict: AS-200 + AS-400 both announce same prefix
//    Epoch 30 — Bad-signature flood: 5 forged advertisements against AS-100
//    Epoch 35 — Auto-pause: oracle detects residue rate spike → pauses AS-300
//    Epoch 40 — Guardian intervention: human guardian reviews & confirms pause
//    Epoch 45 — Resume: 2-of-3 guardians vote to resume AS-300
//
//  Environment:
//    AS_100_API, AS_200_API, AS_300_API, AS_400_API — agent URLs
//    EPOCHS       — epochs to run (default 50)
//    RESULTS_DIR  — where to write results JSON
// ═══════════════════════════════════════════════════════════════════════

const http = require('http');
const fs = require('fs');
const path = require('path');

const EPOCHS        = parseInt(process.env.EPOCHS || '50');
const EPOCH_MS      = parseInt(process.env.ECCA_EPOCH_INTERVAL_MS || '4000');
const RESULTS_DIR   = process.env.RESULTS_DIR || '/results';

const AGENTS = {
  100: { api: process.env.AS_100_API || 'http://agent-bgp-100.bgp-sim:9090', name: 'AS-100', role: 'transit' },
  200: { api: process.env.AS_200_API || 'http://agent-bgp-200.bgp-sim:9090', name: 'AS-200', role: 'content' },
  300: { api: process.env.AS_300_API || 'http://agent-bgp-300.bgp-sim:9090', name: 'AS-300', role: 'attacker' },
  400: { api: process.env.AS_400_API || 'http://agent-bgp-400.bgp-sim:9090', name: 'AS-400', role: 'stub' },
};

// ── HTTP helpers ────────────────────────────────────────────────────
function fetch(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const postData = opts.body || '';
    const req = http.request({
      hostname: u.hostname,
      port: u.port,
      path: u.pathname + u.search,
      method: opts.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(postData ? { 'Content-Length': Buffer.byteLength(postData) } : {}),
      },
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve({ raw: data }); }
      });
    });
    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

function post(url, body) {
  return fetch(url, { method: 'POST', body: JSON.stringify(body) });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Results collector ───────────────────────────────────────────────
const results = {
  startedAt: new Date().toISOString(),
  epochs: EPOCHS,
  agents: {},
  scenarios: [],
  epochSnapshots: [],
  residueSummary: {},
  env: {
    cluster: process.env.BGP_CLUSTER || process.env.CLUSTER_NAME || 'axonal-bgp',
    latencyProfile: process.env.BGP_LATENCY_PROFILE || 'none (same-cluster)',
    gitCommit: process.env.GIT_COMMIT || 'local',
    runner: process.env.BGP_RUNNER || process.env.PLAYFAIR_RUNNER || 'local',
    branch: process.env.GITHUB_REF_NAME || 'unknown',
  },
};

// ── Wait for all agents ─────────────────────────────────────────────
async function waitForAgents(maxWait = 120000) {
  console.log('═══ Waiting for all 4 agents ═══');
  const start = Date.now();
  for (const [asn, agent] of Object.entries(AGENTS)) {
    let ok = false;
    while (Date.now() - start < maxWait) {
      try {
        const r = await fetch(`${agent.api}/healthz`);
        if (r.ok) { ok = true; break; }
      } catch {}
      await sleep(2000);
    }
    if (!ok) throw new Error(`Timed out waiting for ${agent.name}`);
    console.log(`  ✓ ${agent.name} ready`);
  }
}

// ── Seed baseline routes ────────────────────────────────────────────
async function seedRoutes() {
  console.log('\n═══ Seeding baseline routes ═══');
  // Each AS owns a /24 prefix
  const prefixes = {
    100: '10.100.0.0/24',
    200: '10.200.0.0/24',
    300: '10.300.0.0/24',
    400: '10.400.0.0/24',
  };

  for (const [asn, prefix] of Object.entries(prefixes)) {
    const r = await post(`${AGENTS[asn].api}/advertise`, {
      prefix,
      asPath: [parseInt(asn)],
      nextHop: `10.${asn}.0.1`,
    });
    console.log(`  AS-${asn}: advertised ${prefix} → sig=${r.sig?.slice(0, 16)}...`);
  }

  // Exchange routes between peers (full mesh for simplicity)
  for (const [src, agent] of Object.entries(AGENTS)) {
    const routeResp = await fetch(`${agent.api}/routes`);
    for (const [dst, peer] of Object.entries(AGENTS)) {
      if (src === dst) continue;
      for (const [prefix, route] of Object.entries(routeResp.routes || {})) {
        await post(`${peer.api}/receive`, route);
      }
    }
  }
  console.log('  ✓ Routes exchanged across mesh');
}

// ── Scenario handlers ───────────────────────────────────────────────
async function runScenario(epoch) {
  let scenario = null;

  switch (epoch) {
    case 10: {
      // Origin Hijack: AS-300 claims AS-100's prefix
      console.log('\n  ⚡ SCENARIO: Origin Hijack (AS-300 → AS-100 prefix)');
      const r = await post(`${AGENTS[300].api}/inject-attack`, {
        kind: 'OriginHijack',
        prefix: '10.100.0.0/24',
        fakeOrigin: 300,
      });
      scenario = { epoch, kind: 'OriginHijack', actor: 'AS-300', target: 'AS-100', detail: r };
      break;
    }
    case 20: {
      // MOAS Conflict: AS-200 + AS-400 both announce 10.250.0.0/24
      console.log('\n  ⚡ SCENARIO: MOAS Conflict (AS-200 vs AS-400)');
      await post(`${AGENTS[200].api}/advertise`, { prefix: '10.250.0.0/24', asPath: [200] });
      const r = await post(`${AGENTS[400].api}/inject-attack`, {
        kind: 'MOASConflict',
        prefix: '10.250.0.0/24',
        fakeOrigin: 200,
      });
      scenario = { epoch, kind: 'MOASConflict', actors: ['AS-200', 'AS-400'], detail: r };
      break;
    }
    case 30: {
      // Bad-signature flood against AS-100
      console.log('\n  ⚡ SCENARIO: Bad-Signature Flood (targeting AS-100)');
      const r = await post(`${AGENTS[100].api}/inject-attack`, {
        kind: 'BadSignature',
        prefix: '10.100.0.0/24',
        fakeOrigin: 999,
      });
      scenario = { epoch, kind: 'BadSignature', target: 'AS-100', count: 5, detail: r };
      break;
    }
    case 35: {
      // Auto-pause: too many residues → oracle pauses AS-300
      console.log('\n  ⚡ SCENARIO: Auto-Pause Triggered (AS-300)');
      // Inject enough residues to trigger the oracle threshold
      for (let i = 0; i < 3; i++) {
        await post(`${AGENTS[300].api}/inject-attack`, {
          kind: 'PathLeak',
          prefix: `10.${300 + i}.0.0/24`,
          fakeAsPath: [300, 999, 888],
        });
      }
      // Simulate oracle pause
      await post(`${AGENTS[300].api}/pause`, { paused: true });
      scenario = { epoch, kind: 'AutoPause', target: 'AS-300', reason: 'residue-rate-spike' };
      break;
    }
    case 40: {
      // Guardian confirms pause (human-in-the-loop)
      console.log('\n  ⚡ SCENARIO: Guardian Intervention (confirming AS-300 pause)');
      const info = await fetch(`${AGENTS[300].api}/pause`);
      scenario = { epoch, kind: 'GuardianConfirm', target: 'AS-300', agentPaused: info.paused };
      break;
    }
    case 45: {
      // Resume: guardians vote to resume AS-300
      console.log('\n  ⚡ SCENARIO: Guardian Resume (AS-300)');
      await post(`${AGENTS[300].api}/pause`, { paused: false });
      const info = await fetch(`${AGENTS[300].api}/pause`);
      scenario = { epoch, kind: 'Resume', target: 'AS-300', agentPaused: info.paused };
      break;
    }
  }

  if (scenario) {
    results.scenarios.push(scenario);
  }
}

// ── Epoch loop ──────────────────────────────────────────────────────
async function runEpochs() {
  console.log(`\n═══ Running ${EPOCHS} epochs ═══`);

  for (let epoch = 1; epoch <= EPOCHS; epoch++) {
    const epochStart = Date.now();

    // Advance epoch on all agents
    const snapshots = {};
    for (const [asn, agent] of Object.entries(AGENTS)) {
      try {
        const r = await post(`${agent.api}/epoch`, { epoch });
        snapshots[asn] = r;
      } catch (e) {
        snapshots[asn] = { error: e.message };
      }
    }

    // Run scenario if this is a scenario epoch
    await runScenario(epoch);

    // Collect residues
    let totalResidues = 0;
    for (const [asn, agent] of Object.entries(AGENTS)) {
      try {
        const r = await fetch(`${agent.api}/residues?epoch=${epoch}`);
        const count = r.residues?.length || 0;
        totalResidues += count;
        if (count > 0) {
          for (const res of r.residues) {
            results.residueSummary[res.kind] = (results.residueSummary[res.kind] || 0) + 1;
          }
        }
      } catch {}
    }

    results.epochSnapshots.push({
      epoch,
      durationMs: Date.now() - epochStart,
      snapshots,
      residuesDetected: totalResidues,
    });

    // Progress indicator
    if (epoch % 5 === 0 || epoch === 1) {
      const roots = Object.entries(snapshots)
        .map(([asn, s]) => `AS-${asn}:${s.root?.slice(0, 8) || '?'}`)
        .join(' ');
      console.log(`  epoch ${epoch}/${EPOCHS} residues=${totalResidues} ${roots}`);
    }

    // Inter-epoch delay (reduced for testing)
    if (epoch < EPOCHS) await sleep(Math.min(EPOCH_MS / 4, 500));
  }
}

// ── Finalize ────────────────────────────────────────────────────────
async function collectFinalState() {
  console.log('\n═══ Collecting final state ═══');
  for (const [asn, agent] of Object.entries(AGENTS)) {
    try {
      const info = await fetch(`${agent.api}/info`);
      const routes = await fetch(`${agent.api}/routes`);
      const residuesResp = await fetch(`${agent.api}/residues`);
      const log = await fetch(`${agent.api}/epoch-log`);
      results.agents[asn] = { info, routeCount: routes.routes ? Object.keys(routes.routes).length : 0, totalResidues: residuesResp.total || 0, epochLog: log.log || [] };
      console.log(`  AS-${asn}: ${results.agents[asn].routeCount} routes, ${results.agents[asn].totalResidues} residues`);
    } catch (e) {
      results.agents[asn] = { error: e.message };
    }
  }
}

// ── Main ────────────────────────────────────────────────────────────
async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log(' AXONAL-BGP ORCHESTRATOR — Routing Security Simulation');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`Epochs: ${EPOCHS}  |  Epoch interval: ${EPOCH_MS}ms`);
  console.log(`Agents: ${Object.keys(AGENTS).map(a => `AS-${a}`).join(', ')}`);

  await waitForAgents();
  await seedRoutes();
  await runEpochs();
  await collectFinalState();

  results.completedAt = new Date().toISOString();
  results.durationMs = new Date(results.completedAt) - new Date(results.startedAt);

  // Write results
  try { fs.mkdirSync(RESULTS_DIR, { recursive: true }); } catch {}
  const outPath = path.join(RESULTS_DIR, 'axonal-bgp-results.json');
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2));
  console.log(`\n✓ Results written to ${outPath}`);

  // Also emit to stdout for log extraction
  console.log('\n═══ RESULTS JSON ═══');
  console.log(JSON.stringify(results));
  console.log('═══════════════════════════════════════════════════════════');

  // Summary
  console.log('\n═══ SUMMARY ═══');
  console.log(`Duration: ${(results.durationMs / 1000).toFixed(1)}s`);
  console.log(`Epochs: ${EPOCHS}`);
  console.log(`Scenarios executed: ${results.scenarios.length}`);
  console.log(`Total residues: ${Object.values(results.residueSummary).reduce((a, b) => a + b, 0)}`);
  console.log(`Residue breakdown: ${JSON.stringify(results.residueSummary)}`);
  for (const [asn, agent] of Object.entries(results.agents)) {
    console.log(`  AS-${asn}: ${agent.routeCount || 0} routes, ${agent.totalResidues || 0} residues, paused=${agent.info?.paused || false}`);
  }
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
