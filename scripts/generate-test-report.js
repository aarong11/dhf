#!/usr/bin/env node
// ─── ECCA // Unit Test Report Generator ─────────────────────────────────────
// Reads .test-results.json (produced by run-unit-tests.sh) and generates
// unit-test-report.html in the same visual style as e2e-report.html.
// ────────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const RESULTS_FILE = path.join(ROOT, '.test-results.json');
const OUT_FILE = path.join(ROOT, 'unit-test-report.html');
const DOCS_FILE = path.join(ROOT, 'docs', 'unit-test-report.html');

if (!fs.existsSync(RESULTS_FILE)) {
  console.error('No .test-results.json found — run run-unit-tests.sh first.');
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(RESULTS_FILE, 'utf8'));
const { suites = [], totalPass = 0, totalFail = 0, totalTests = 0, ts = '' } = data;
const passRate = totalTests > 0 ? Math.round((totalPass / totalTests) * 100) : 0;
const allPass = totalFail === 0;

// Suite metadata: what each package does, which services call it, where to verify
const SUITE_META = {
  '@ecca/proto': {
    icon: '📜',
    what: 'Token taxonomy (5 cognitive tokens), event schemas (12 event types), zod validators, NATS stream config, ECCA constants.',
    how: 'Zod schema parsing, round-trip validation, boundary checks (negative values, out-of-range coefficients), discriminated union matching.',
    why: 'Every service imports @ecca/proto — if these schemas break, all 24 services fail to communicate. This is the type contract.',
    when: 'On every build. These types are checked at compile time AND runtime (zod parsing on NATS messages).',
    services: ['siyana-api', 'thalamus-router', 'dhf-compositor', 'needlecast-router-svc', 'quellist-treasury-svc', 'bandwidth-faucet', 'sleeve-runtime', 'workers/runner'],
    verify: 'packages/proto/src/tokens.ts, packages/proto/src/events.ts, packages/proto/src/index.ts',
  },
  '@ecca/crypto': {
    icon: '🔐',
    what: 'SHA-256, HKDF-SHA512 key derivation, AES-256-GCM authenticated encryption, Ed25519 signatures, RFC-6962 Merkle trees, Synaptic Field MMR, coherence root hashing.',
    how: 'Round-trip encrypt/decrypt, signature verify, Merkle proof verification for all leaf positions, MMR append determinism, cross-chain coherence root field coverage.',
    why: 'Cryptographic primitives underpin every security guarantee: memory encryption, identity verification, cross-chain consistency proofs, and on-chain anchor hashing.',
    when: 'On build. These are pure functions with no I/O — fastest test suite. Run them on every commit.',
    services: ['siyana-api (encrypt/decrypt memories)', 'thalamus-router (coherenceRoot, merkleRoot)', 'dhf-compositor (decrypt fragments)', 'workers/runner (sha256hex for residue IDs)'],
    verify: 'packages/crypto/src/index.ts — all exports from @noble/hashes, @noble/ciphers, @noble/curves',
  },
  '@ecca/chain': {
    icon: '⛓️',
    what: 'Cortex EVM chain config, viem client factories, 7 canonical contract ABIs (StackIdentity, BandwidthToken, ResidueRegistry, NeedlecastRouter, QuellistTreasury, TripartiteGame, EpochAnchor), Hippocampus DAG client, Medulla PoW JSON-RPC client.',
    how: 'Chain ID validation, native currency config, ABI shape verification (specific function presence), client construction with private key, method existence checks.',
    why: 'These clients are the only bridge between TypeScript services and the three blockchains. Wrong ABIs = silent failures when calling contracts.',
    when: 'On build. ABI tests catch mismatches between contracts/src/*.sol and the viem ABI constants immediately.',
    services: ['siyana-api (cortex for NFT minting)', 'thalamus-router (medulla + cortex)', 'workers/runner (medulla + hippocampus)', 'needlecast-router-svc (cortex)'],
    verify: 'packages/chain/src/cortex.ts, packages/chain/src/hippocampus.ts, packages/chain/src/medulla.ts',
  },
  '@ecca/service-base': {
    icon: '🏗️',
    what: 'Fastify server bootstrap, /healthz and /readyz probe endpoints, CORS configuration, graceful SIGTERM/SIGINT shutdown, daemon mode for workers.',
    how: 'Fastify inject() to test HTTP endpoints without binding a port, CORS header verification, signal handler registration, listen on port 0 (OS-assigned).',
    why: 'Every TypeScript service (siyana-api, thalamus-router, etc.) and every worker uses createService() or daemon(). If bootstrap breaks, nothing starts.',
    when: 'On build. Fast tests (~100ms) that verify the foundation all services stand on.',
    services: ['ALL services use createService()', 'ALL workers use daemon()'],
    verify: 'packages/service-base/src/index.ts — createService(), listen(), wireShutdown(), daemon(), createLogger()',
  },
  '@ecca/semantic-address': {
    icon: '🧭',
    what: '5-facet semantic grammar (domain > entity > relation > temporal > qualifier), deterministic normalization, 32-byte address derivation, partial prefix matching, address book with prefix queries, NLP description parser.',
    how: 'Normalization order independence, case/whitespace invariance, multi-value sorting, depth encoding, prefix matching across different grammar levels, book query narrowing (domain→entity→relation).',
    why: 'Semantic addresses enable content-based routing in the hippocampus DAG. Without correct prefix derivation, memory recall returns wrong neighborhoods.',
    when: 'On build. Pure functions — tests verify the addressing invariants that the entire memory system depends on.',
    services: ['agent-runtime (memory addressing)', 'hippocampus-dag (prefix-based storage)', 'siyana-api (recall routing)'],
    verify: 'packages/semantic-address/src/grammar.ts, derive.ts, address.ts, book.ts',
  },
  'contracts': {
    icon: '📝',
    what: 'StackIdentity NFT minting/CPV/EBC, BandwidthToken mint/spend/authorize/transferStack, EpochAnchor commitAnchor/verifyContinuity/verifyShardInclusion, TripartiteGame openGame/registerParty/consume/audit, ResidueRegistry detect/submitProof, NeedlecastRouter route, QuellistTreasury issue/claim, SleeveRegistry register/decommission.',
    how: 'Hardhat local EVM with viem test helpers. Each contract gets a loadFixture deployment, then exercises every public function including access control, edge cases, and event emission.',
    why: 'Smart contracts are immutable once deployed. Bugs here cannot be patched — they require migration. 100% coverage of authorization, caps, and lifecycle transitions is critical.',
    when: 'Before every deploy. Run with `npx hardhat test` in contracts/. Uses in-memory Hardhat Network (no Docker needed).',
    services: ['cortex-evm (on-chain execution)', 'siyana-api (calls StackIdentity, BandwidthToken)', 'thalamus-router (calls EpochAnchor)', 'quellist-treasury-svc (calls QuellistTreasury)'],
    verify: 'contracts/src/*.sol — 7 Solidity files. contracts/test/*.test.ts — 7 test files.',
  },
};

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function generateHTML() {
  let phases = '';
  suites.forEach((suite, idx) => {
    const num = String(idx + 1).padStart(2, '0');
    const meta = SUITE_META[suite.filter] || SUITE_META[suite.name] || {};
    const icon = meta.icon || '🧪';
    const suitePass = suite.fail === 0;

    let body = '';

    // Description block
    body += `<p class="phase-desc">${esc(suite.desc)}</p>`;

    // What / How / Why / When detail boxes
    if (meta.what) {
      body += `<div class="detail-box detail-what"><span class="detail-label">WHAT IS TESTED</span>${esc(meta.what)}</div>`;
    }
    if (meta.how) {
      body += `<div class="detail-box detail-how"><span class="detail-label">HOW IT WORKS</span>${esc(meta.how)}</div>`;
    }
    if (meta.why) {
      body += `<div class="detail-box detail-why"><span class="detail-label">WHY IT MATTERS</span>${esc(meta.why)}</div>`;
    }
    if (meta.when) {
      body += `<div class="detail-box detail-when"><span class="detail-label">WHEN TO RUN</span>${esc(meta.when)}</div>`;
    }

    // Services that depend on this
    if (meta.services && meta.services.length) {
      body += `<div class="svc-grid">`;
      for (const svc of meta.services) {
        body += `<div class="service-tag"><span class="svc-name">${esc(svc)}</span></div>`;
      }
      body += `</div>`;
    }

    // Where to verify
    if (meta.verify) {
      body += `<div class="verify-box"><span class="detail-label">WHERE TO LOOK</span><code>${esc(meta.verify)}</code></div>`;
    }

    // Individual test results
    body += `<div class="test-list">`;
    if (suite.tests && suite.tests.length) {
      for (const t of suite.tests) {
        const cls = t.status === 'pass' ? 'pass' : 'fail';
        const indicator = t.status === 'pass' ? '&#x2713;' : '&#x2717;';
        const dur = t.duration > 0 ? ` <span class="test-dur">(${t.duration.toFixed(1)}ms)</span>` : '';
        body += `<div class="test ${cls}"><span class="indicator">${indicator}</span> ${esc(t.name)}${dur}</div>`;
      }
    } else {
      // No individual test data — show summary
      for (let i = 0; i < suite.pass; i++) {
        body += `<div class="test pass"><span class="indicator">&#x2713;</span> test ${i + 1}</div>`;
      }
      for (let i = 0; i < suite.fail; i++) {
        body += `<div class="test fail"><span class="indicator">&#x2717;</span> failed test ${i + 1}</div>`;
      }
    }
    body += `</div>`;

    // Suite summary bar
    const durStr = suite.duration > 0 ? `${(suite.duration / 1000).toFixed(2)}s` : '';
    body += `<div class="suite-summary ${suitePass ? 'pass' : 'fail'}">`;
    body += `<span>${suite.pass}/${suite.total} passed</span>`;
    if (durStr) body += `<span class="suite-dur">${durStr}</span>`;
    body += `</div>`;

    phases += `
<section class="phase" id="suite-${num}">
<div class="phase-header" onclick="this.parentElement.classList.toggle('collapsed')">
  <span class="phase-num">${num}</span>
  <h2>${icon} ${esc(suite.name)}</h2>
  <span class="phase-status ${suitePass ? 'pass' : 'fail'}">${suite.pass}/${suite.total}</span>
  <span class="phase-toggle">&#x25BC;</span>
</div>
<div class="phase-body">${body}</div>
</section>`;
  });

  // Lifecycle grid
  const lifecycleItems = [
    { icon: '📜', label: 'Proto Types', desc: `${suites.find(s=>s.filter==='@ecca/proto')?.pass||0} schemas validated` },
    { icon: '🔐', label: 'Cryptography', desc: `${suites.find(s=>s.filter==='@ecca/crypto')?.pass||0} primitives verified` },
    { icon: '⛓️', label: 'Chain Clients', desc: `${suites.find(s=>s.filter==='@ecca/chain')?.pass||0} ABIs + clients checked` },
    { icon: '🏗️', label: 'Service Base', desc: `${suites.find(s=>s.filter==='@ecca/service-base')?.pass||0} bootstrap tests` },
    { icon: '🧭', label: 'Addressing', desc: `${suites.find(s=>s.filter==='@ecca/semantic-address')?.pass||0} address ops verified` },
    { icon: '📝', label: 'Contracts', desc: `${suites.find(s=>s.name==='contracts')?.pass||0} Solidity tests` },
  ];

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>ECCA // Unit &amp; Contract Test Report</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500;700&family=Orbitron:wght@400;700;900&display=swap');

:root {
  --bg-deep: #030308;
  --bg-panel: #0a0a14;
  --bg-card: #0f0f1a;
  --bg-code: #080812;
  --neon-cyan: #00f0ff;
  --neon-magenta: #ff00e6;
  --neon-green: #00ff88;
  --neon-red: #ff0055;
  --neon-yellow: #ffcc00;
  --neon-purple: #b347ff;
  --neon-blue: #4488ff;
  --text: #c8c8d4;
  --text-dim: #5a5a6e;
  --border: #1a1a2e;
  --glow-cyan: 0 0 10px #00f0ff44, 0 0 40px #00f0ff22;
  --glow-green: 0 0 10px #00ff8844, 0 0 40px #00ff8822;
  --glow-red: 0 0 10px #ff005544, 0 0 40px #ff005522;
  --glow-magenta: 0 0 10px #ff00e644, 0 0 40px #ff00e622;
}

* { margin: 0; padding: 0; box-sizing: border-box; }

body {
  background: var(--bg-deep);
  color: var(--text);
  font-family: 'JetBrains Mono', monospace;
  font-size: 13px;
  line-height: 1.6;
  min-height: 100vh;
  overflow-x: hidden;
}

body::before {
  content: '';
  position: fixed;
  top: 0; left: 0; right: 0; bottom: 0;
  background: repeating-linear-gradient(
    0deg, transparent, transparent 2px,
    rgba(0, 240, 255, 0.008) 2px, rgba(0, 240, 255, 0.008) 4px
  );
  pointer-events: none;
  z-index: 9999;
}

body::after {
  content: '';
  position: fixed;
  top: 0; left: 0; right: 0; bottom: 0;
  background-image:
    linear-gradient(rgba(0, 240, 255, 0.03) 1px, transparent 1px),
    linear-gradient(90deg, rgba(0, 240, 255, 0.03) 1px, transparent 1px);
  background-size: 50px 50px;
  pointer-events: none;
  z-index: -1;
}

.header {
  background: linear-gradient(180deg, var(--bg-panel) 0%, var(--bg-deep) 100%);
  border-bottom: 1px solid var(--neon-cyan);
  padding: 2.5rem 2rem 2rem;
  text-align: center;
  position: relative;
  box-shadow: 0 4px 60px rgba(0, 240, 255, 0.1);
}

.header::before {
  content: '';
  position: absolute;
  bottom: -1px;
  left: 0; right: 0;
  height: 2px;
  background: linear-gradient(90deg, transparent, var(--neon-cyan), var(--neon-magenta), var(--neon-cyan), transparent);
  animation: borderGlow 3s ease-in-out infinite;
}

@keyframes borderGlow {
  0%, 100% { opacity: 0.6; }
  50% { opacity: 1; }
}

@keyframes flicker {
  0%, 19%, 21%, 23%, 25%, 54%, 56%, 100% { opacity: 1; }
  20%, 24%, 55% { opacity: 0.6; }
}

.header h1 {
  font-family: 'Orbitron', sans-serif;
  font-size: 2.5rem;
  font-weight: 900;
  letter-spacing: 0.4em;
  background: linear-gradient(135deg, var(--neon-cyan), var(--neon-magenta));
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  margin-bottom: 0.5rem;
  animation: flicker 4s infinite;
}

.header .subtitle {
  font-size: 0.75rem;
  color: var(--text-dim);
  letter-spacing: 0.2em;
  text-transform: uppercase;
}

.header .timestamp {
  margin-top: 0.6rem;
  font-size: 0.7rem;
  color: var(--neon-cyan);
  opacity: 0.7;
  font-family: 'JetBrains Mono', monospace;
}

.stats-bar {
  display: flex;
  justify-content: center;
  gap: 3rem;
  padding: 1.5rem 2rem;
  background: var(--bg-panel);
  border-bottom: 1px solid var(--border);
  flex-wrap: wrap;
}

.stat { text-align: center; }

.stat-value {
  font-family: 'Orbitron', sans-serif;
  font-size: 2.2rem;
  font-weight: 700;
}

.stat-value.pass-count { color: var(--neon-green); text-shadow: var(--glow-green); }
.stat-value.fail-count { color: var(--neon-red); text-shadow: var(--glow-red); }
.stat-value.total-count { color: var(--neon-cyan); text-shadow: var(--glow-cyan); }
.stat-value.suite-count { color: var(--neon-purple); }

.stat-label {
  font-size: 0.6rem;
  text-transform: uppercase;
  letter-spacing: 0.25em;
  color: var(--text-dim);
  margin-top: 0.3rem;
}

.progress-container { padding: 0 2rem; margin: 1.2rem auto; max-width: 960px; }

.progress-bar {
  height: 4px;
  background: var(--bg-card);
  border-radius: 2px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  border-radius: 2px;
  transition: width 0.5s ease;
}

.progress-fill.all-pass {
  background: linear-gradient(90deg, var(--neon-green), var(--neon-cyan));
  box-shadow: 0 0 12px var(--neon-green);
}

.progress-fill.has-fails {
  background: linear-gradient(90deg, var(--neon-green), var(--neon-red));
  box-shadow: 0 0 12px var(--neon-red);
}

.nav-links {
  display: flex;
  justify-content: center;
  gap: 1rem;
  padding: 0.8rem 2rem;
  background: var(--bg-panel);
  border-bottom: 1px solid var(--border);
  flex-wrap: wrap;
}

.nav-links a {
  font-size: 0.7rem;
  color: var(--text-dim);
  text-decoration: none;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  padding: 0.3rem 0.6rem;
  border-radius: 3px;
  transition: all 0.2s;
}

.nav-links a:hover, .nav-links a.active {
  color: var(--neon-cyan);
  background: rgba(0, 240, 255, 0.06);
}

.content { max-width: 960px; margin: 2rem auto; padding: 0 1.5rem; }

.phase {
  margin-bottom: 1.5rem;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-card);
  overflow: hidden;
  transition: border-color 0.3s, box-shadow 0.3s;
}

.phase:hover {
  border-color: var(--neon-cyan);
  box-shadow: 0 0 30px rgba(0, 240, 255, 0.06);
}

.phase.collapsed .phase-body { display: none; }
.phase.collapsed .phase-toggle { transform: rotate(-90deg); }

.phase-header {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 1rem 1.5rem;
  cursor: pointer;
  border-bottom: 1px solid var(--border);
  background: linear-gradient(90deg, rgba(0, 240, 255, 0.03), transparent);
  user-select: none;
}

.phase-header:hover { background: linear-gradient(90deg, rgba(0, 240, 255, 0.07), transparent); }

.phase-num {
  font-family: 'Orbitron', sans-serif;
  font-size: 0.7rem;
  font-weight: 700;
  color: var(--neon-magenta);
  background: rgba(255, 0, 230, 0.1);
  border: 1px solid rgba(255, 0, 230, 0.3);
  border-radius: 4px;
  padding: 0.25rem 0.6rem;
  min-width: 2.2rem;
  text-align: center;
}

.phase-header h2 {
  flex: 1;
  font-size: 0.85rem;
  font-weight: 500;
  color: var(--neon-cyan);
  letter-spacing: 0.05em;
}

.phase-status {
  font-family: 'Orbitron', sans-serif;
  font-size: 0.7rem;
  font-weight: 700;
  padding: 0.2rem 0.6rem;
  border-radius: 3px;
}

.phase-status.pass {
  color: var(--neon-green);
  background: rgba(0, 255, 136, 0.08);
  border: 1px solid rgba(0, 255, 136, 0.3);
}

.phase-status.fail {
  color: var(--neon-red);
  background: rgba(255, 0, 85, 0.08);
  border: 1px solid rgba(255, 0, 85, 0.3);
}

.phase-toggle { color: var(--text-dim); font-size: 0.8rem; transition: transform 0.2s; }

.phase-body { padding: 1.2rem 1.5rem; }

.phase-desc {
  color: var(--text-dim);
  font-size: 0.72rem;
  margin-bottom: 1rem;
  padding: 0.8rem 1rem;
  border-left: 3px solid var(--neon-purple);
  background: rgba(179, 71, 255, 0.04);
  border-radius: 0 4px 4px 0;
  line-height: 1.8;
}

.detail-box {
  font-size: 0.72rem;
  margin: 0.6rem 0;
  padding: 0.7rem 1rem;
  border-radius: 4px;
  line-height: 1.7;
  border-left: 3px solid;
}

.detail-label {
  display: block;
  font-family: 'Orbitron', sans-serif;
  font-size: 0.55rem;
  font-weight: 700;
  letter-spacing: 0.15em;
  margin-bottom: 0.3rem;
}

.detail-what { border-color: var(--neon-cyan); background: rgba(0, 240, 255, 0.03); }
.detail-what .detail-label { color: var(--neon-cyan); }

.detail-how { border-color: var(--neon-green); background: rgba(0, 255, 136, 0.03); }
.detail-how .detail-label { color: var(--neon-green); }

.detail-why { border-color: var(--neon-magenta); background: rgba(255, 0, 230, 0.03); }
.detail-why .detail-label { color: var(--neon-magenta); }

.detail-when { border-color: var(--neon-yellow); background: rgba(255, 204, 0, 0.03); }
.detail-when .detail-label { color: var(--neon-yellow); }

.verify-box {
  font-size: 0.72rem;
  margin: 0.6rem 0;
  padding: 0.7rem 1rem;
  border-left: 3px solid var(--neon-blue);
  background: rgba(68, 136, 255, 0.03);
  border-radius: 0 4px 4px 0;
}

.verify-box .detail-label { color: var(--neon-blue); }
.verify-box code { color: var(--neon-cyan); font-size: 0.68rem; }

.svc-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin: 0.8rem 0;
}

.service-tag {
  display: inline-flex;
  align-items: center;
  padding: 0.35rem 0.8rem;
  background: rgba(0, 240, 255, 0.03);
  border: 1px solid rgba(0, 240, 255, 0.15);
  border-radius: 4px;
  font-size: 0.68rem;
}

.svc-name { font-weight: 700; color: var(--neon-cyan); }

.test-list { margin: 1rem 0; }

.test {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.35rem 0.8rem;
  margin: 0.15rem 0;
  border-radius: 4px;
  font-size: 0.72rem;
  transition: background 0.2s;
}

.test.pass {
  background: rgba(0, 255, 136, 0.03);
  border-left: 3px solid var(--neon-green);
}
.test.pass:hover { background: rgba(0, 255, 136, 0.07); }

.test.fail {
  background: rgba(255, 0, 85, 0.05);
  border-left: 3px solid var(--neon-red);
}
.test.fail:hover { background: rgba(255, 0, 85, 0.09); }

.test .indicator { font-weight: 700; font-size: 1rem; }
.test.pass .indicator { color: var(--neon-green); text-shadow: var(--glow-green); }
.test.fail .indicator { color: var(--neon-red); text-shadow: var(--glow-red); }

.test-dur { color: var(--text-dim); font-size: 0.6rem; margin-left: 0.3rem; }

.suite-summary {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.6rem 1rem;
  margin-top: 0.8rem;
  border-radius: 4px;
  font-size: 0.75rem;
  font-weight: 700;
}

.suite-summary.pass {
  background: rgba(0, 255, 136, 0.06);
  color: var(--neon-green);
  border: 1px solid rgba(0, 255, 136, 0.2);
}

.suite-summary.fail {
  background: rgba(255, 0, 85, 0.06);
  color: var(--neon-red);
  border: 1px solid rgba(255, 0, 85, 0.2);
}

.suite-dur { font-weight: 400; font-size: 0.65rem; color: var(--text-dim); }

.result-banner {
  margin: 2.5rem 0;
  padding: 2.5rem;
  text-align: center;
  border-radius: 10px;
  border: 1px solid;
  position: relative;
  overflow: hidden;
}

.result-banner::before {
  content: '';
  position: absolute;
  top: -50%; left: -50%; right: -50%; bottom: -50%;
  background: conic-gradient(from 0deg, transparent, rgba(0, 255, 136, 0.03), transparent, rgba(0, 240, 255, 0.03), transparent);
  animation: spin 10s linear infinite;
}

@keyframes spin { 100% { transform: rotate(360deg); } }

.result-banner.all-pass {
  background: rgba(0, 255, 136, 0.02);
  border-color: var(--neon-green);
  box-shadow: 0 0 60px rgba(0, 255, 136, 0.1), inset 0 0 60px rgba(0, 255, 136, 0.02);
}

.result-banner.has-fails {
  background: rgba(255, 0, 85, 0.02);
  border-color: var(--neon-red);
  box-shadow: 0 0 60px rgba(255, 0, 85, 0.1), inset 0 0 60px rgba(255, 0, 85, 0.02);
}

.result-banner h2 {
  font-family: 'Orbitron', sans-serif;
  font-size: 1.6rem;
  margin-bottom: 0.6rem;
  position: relative;
  z-index: 1;
}

.result-banner.all-pass h2 { color: var(--neon-green); text-shadow: var(--glow-green); }
.result-banner.has-fails h2 { color: var(--neon-red); text-shadow: var(--glow-red); }

.result-banner p { color: var(--text-dim); font-size: 0.75rem; position: relative; z-index: 1; }

.lifecycle-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 0.8rem;
  margin: 2rem 0;
}

.lifecycle-item {
  padding: 1rem;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 6px;
  font-size: 0.72rem;
  transition: border-color 0.2s, transform 0.2s;
}

.lifecycle-item:hover { border-color: var(--neon-cyan); transform: translateY(-2px); }
.lifecycle-item.lc-pass { border-left: 3px solid var(--neon-green); }
.lifecycle-item .lc-label { color: var(--neon-cyan); font-weight: 700; display: block; margin-bottom: 0.3rem; font-size: 0.75rem; }
.lifecycle-item .lc-desc { color: var(--text-dim); }

.footer {
  text-align: center;
  padding: 2.5rem;
  color: var(--text-dim);
  font-size: 0.6rem;
  letter-spacing: 0.15em;
  border-top: 1px solid var(--border);
  margin-top: 3rem;
}

::-webkit-scrollbar { width: 6px; height: 6px; }
::-webkit-scrollbar-track { background: var(--bg-deep); }
::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }
::-webkit-scrollbar-thumb:hover { background: var(--neon-cyan); }

@media (max-width: 600px) {
  .header h1 { font-size: 1.4rem; letter-spacing: 0.15em; }
  .stats-bar { gap: 1.5rem; }
  .stat-value { font-size: 1.5rem; }
  .content { padding: 0 0.8rem; }
  .lifecycle-grid { grid-template-columns: 1fr; }
}
</style>
</head>
<body>
<div class="header">
  <h1>ECCA // UNIT</h1>
  <div class="subtitle">Unit &amp; Contract Test Report &mdash; Package-Level Verification</div>
  <div class="timestamp">${esc(ts)}</div>
</div>
<div class="stats-bar">
  <div class="stat"><div class="stat-value pass-count">${totalPass}</div><div class="stat-label">Passed</div></div>
  <div class="stat"><div class="stat-value fail-count">${totalFail}</div><div class="stat-label">Failed</div></div>
  <div class="stat"><div class="stat-value total-count">${totalTests}</div><div class="stat-label">Total</div></div>
  <div class="stat"><div class="stat-value suite-count">${suites.length}</div><div class="stat-label">Suites</div></div>
</div>
<div class="progress-container">
  <div class="progress-bar"><div class="progress-fill ${allPass ? 'all-pass' : 'has-fails'}" style="width: ${passRate}%"></div></div>
</div>
<div class="nav-links">
  <a href="e2e-report.html">E2E Report</a>
  <a href="unit-test-report.html" class="active">Unit Tests</a>
  <a href="docs/index.html">Docs</a>
  <a href="docs/developer.html">Developer Guide</a>
  <a href="docs/architecture.html">Architecture</a>
</div>
<div class="content">
${phases}
<div class="result-banner ${allPass ? 'all-pass' : 'has-fails'}">
  <h2>${allPass ? 'ALL SYSTEMS NOMINAL' : 'COHERENCE BREACH DETECTED'}</h2>
  <p>${allPass
    ? `${totalPass} assertions passed across ${suites.length} test suites &mdash; all packages verified`
    : `${totalFail} assertion(s) failed across ${suites.length} suites &mdash; coordination residue generated`}</p>
</div>
<div class="lifecycle-grid">
${lifecycleItems.map(item => `  <div class="lifecycle-item lc-pass"><span class="lc-label">${item.icon} ${esc(item.label)}</span><span class="lc-desc">${esc(item.desc)}</span></div>`).join('\n')}
</div>
</div>
<div class="footer">
  ECCA STACK v3 &mdash; DISTRIBUTED HUMAN FRAMEWORK &mdash; UNIT TEST REPORT<br>
  <span style="opacity:0.5">Generated by run-unit-tests.sh // All memory is sacred</span>
</div>
</body>
</html>`;

  return html;
}

const html = generateHTML();
fs.writeFileSync(OUT_FILE, html);
fs.writeFileSync(DOCS_FILE, html);
console.log(`  Generated: ${OUT_FILE}`);
console.log(`  Generated: ${DOCS_FILE}`);
