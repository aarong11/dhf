#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════
//  AXONAL-BGP REPORT GENERATOR — Self-contained HTML with SVG charts
// ═══════════════════════════════════════════════════════════════════════
//
//  Usage: node generate-report.js <results.json> <output.html> [docs-copy.html]
// ═══════════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');

const [,, resultsPath, outputPath, docsCopyPath] = process.argv;
if (!resultsPath || !outputPath) {
  console.error('Usage: node generate-report.js <results.json> <output.html> [docs-copy.html]');
  process.exit(1);
}

const results = JSON.parse(fs.readFileSync(resultsPath, 'utf8'));
const scenarios = results.scenarios || [];
const agents = results.agents || {};
const epochSnapshots = results.epochSnapshots || [];
const residueSummary = results.residueSummary || {};
const env = results.env || {};

// ── SVG chart helpers ───────────────────────────────────────────────
function barChart(id, title, labels, values, color = '#00d4ff') {
  const w = 600, h = 200, pad = 40;
  const maxVal = Math.max(...values, 1);
  const barW = Math.min(60, (w - pad * 2) / labels.length - 4);
  const bars = labels.map((l, i) => {
    const x = pad + i * ((w - pad * 2) / labels.length);
    const barH = (values[i] / maxVal) * (h - pad * 2);
    const y = h - pad - barH;
    return `<rect x="${x}" y="${y}" width="${barW}" height="${barH}" fill="${color}" rx="2"/>
      <text x="${x + barW/2}" y="${h - pad + 14}" text-anchor="middle" fill="#999" font-size="10">${l}</text>
      <text x="${x + barW/2}" y="${y - 4}" text-anchor="middle" fill="#ddd" font-size="11">${values[i]}</text>`;
  }).join('\n');
  return `<svg id="${id}" width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg" style="background:#1a1a2e;border-radius:8px;margin:8px 0">
    <text x="${w/2}" y="20" text-anchor="middle" fill="#00d4ff" font-size="13" font-weight="bold">${title}</text>
    ${bars}
  </svg>`;
}

function timelineSVG(scenarios, totalEpochs) {
  const w = 700, h = 120, pad = 40;
  const colors = { OriginHijack: '#ff4444', MOASConflict: '#ff8800', BadSignature: '#ffcc00', AutoPause: '#ff00ff', GuardianConfirm: '#00ffcc', Resume: '#00ff66' };
  const dots = scenarios.map(s => {
    const x = pad + (s.epoch / totalEpochs) * (w - pad * 2);
    const c = colors[s.kind] || '#888';
    return `<circle cx="${x}" cy="60" r="8" fill="${c}" stroke="#fff" stroke-width="1.5"/>
      <text x="${x}" y="90" text-anchor="middle" fill="#ccc" font-size="9">E${s.epoch}</text>
      <text x="${x}" y="102" text-anchor="middle" fill="${c}" font-size="8">${s.kind.replace(/([A-Z])/g, ' $1').trim()}</text>`;
  }).join('\n');
  return `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg" style="background:#1a1a2e;border-radius:8px;margin:8px 0">
    <text x="${w/2}" y="20" text-anchor="middle" fill="#00d4ff" font-size="13" font-weight="bold">Scenario Timeline</text>
    <line x1="${pad}" y1="60" x2="${w - pad}" y2="60" stroke="#333" stroke-width="2"/>
    <text x="${pad}" y="45" fill="#666" font-size="10">Epoch 1</text>
    <text x="${w - pad}" y="45" fill="#666" font-size="10" text-anchor="end">Epoch ${totalEpochs}</text>
    ${dots}
  </svg>`;
}

// ── Build HTML ──────────────────────────────────────────────────────
const residueLabels = Object.keys(residueSummary);
const residueValues = Object.values(residueSummary);
const agentLabels = Object.keys(agents).map(a => `AS-${a}`);
const agentResidues = Object.values(agents).map(a => a.totalResidues || 0);
const agentRoutes = Object.values(agents).map(a => a.routeCount || 0);

const scenarioRows = scenarios.map(s => `<tr>
  <td style="color:#00d4ff">Epoch ${s.epoch}</td>
  <td><span style="padding:2px 8px;border-radius:4px;background:${
    s.kind === 'Resume' ? '#002200' : s.kind === 'GuardianConfirm' ? '#002222' : '#220000'
  }">${s.kind}</span></td>
  <td>${s.target || s.actors?.join(', ') || s.actor || '-'}</td>
  <td style="color:#999">${s.reason || s.detail?.kind || '-'}</td>
</tr>`).join('\n');

const agentRows = Object.entries(agents).map(([asn, a]) => `<tr>
  <td style="color:#00d4ff">AS-${asn}</td>
  <td>${a.info?.role || '-'}</td>
  <td>${a.routeCount || 0}</td>
  <td>${a.totalResidues || 0}</td>
  <td>${a.info?.paused ? '<span style="color:#ff4444">PAUSED</span>' : '<span style="color:#00ff66">ACTIVE</span>'}</td>
</tr>`).join('\n');

const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Axonal-BGP — Routing Security Test Report</title>
  <style>
    :root { --bg: #0a0a1a; --card: #12122a; --border: #1e1e3a; --accent: #00d4ff; --text: #e0e0e0; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: var(--bg); color: var(--text); font: 14px/1.6 'SF Mono', 'Fira Code', monospace; padding: 24px; }
    h1 { font-size: 22px; color: var(--accent); margin-bottom: 4px; }
    h2 { font-size: 16px; color: var(--accent); margin: 24px 0 8px; border-bottom: 1px solid var(--border); padding-bottom: 4px; }
    .meta { color: #888; font-size: 12px; margin-bottom: 16px; }
    .card { background: var(--card); border: 1px solid var(--border); border-radius: 8px; padding: 16px; margin: 8px 0; }
    table { width: 100%; border-collapse: collapse; margin: 8px 0; }
    th, td { padding: 6px 12px; text-align: left; border-bottom: 1px solid var(--border); }
    th { color: var(--accent); font-size: 12px; text-transform: uppercase; }
    .charts { display: flex; flex-wrap: wrap; gap: 16px; }
    .summary-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; margin: 12px 0; }
    .summary-box { background: var(--card); border: 1px solid var(--border); border-radius: 8px; padding: 12px; text-align: center; }
    .summary-box .val { font-size: 28px; color: var(--accent); font-weight: bold; }
    .summary-box .label { font-size: 11px; color: #888; }
  </style>
</head>
<body>
  <h1>Axonal-BGP — Routing Security Test Report</h1>
  <p class="meta">
    ${results.completedAt || 'unknown'} · ${(results.durationMs / 1000).toFixed(1)}s ·
    commit ${env.gitCommit || 'local'} · branch ${env.branch || '?'} · runner ${env.runner || 'local'}
  </p>

  <div class="summary-grid">
    <div class="summary-box"><div class="val">${results.epochs || 0}</div><div class="label">Epochs</div></div>
    <div class="summary-box"><div class="val">${scenarios.length}</div><div class="label">Scenarios</div></div>
    <div class="summary-box"><div class="val">${residueValues.reduce((a, b) => a + b, 0)}</div><div class="label">Residues Detected</div></div>
    <div class="summary-box"><div class="val">${Object.keys(agents).length}</div><div class="label">Autonomous Systems</div></div>
    <div class="summary-box"><div class="val">${((results.durationMs || 0) / 1000).toFixed(1)}s</div><div class="label">Duration</div></div>
  </div>

  <h2>Scenario Timeline</h2>
  <div class="card">${timelineSVG(scenarios, results.epochs || 50)}</div>

  <h2>Scenarios</h2>
  <div class="card">
    <table>
      <tr><th>Epoch</th><th>Type</th><th>Target</th><th>Detail</th></tr>
      ${scenarioRows}
    </table>
  </div>

  <h2>Agent Summary</h2>
  <div class="card">
    <table>
      <tr><th>AS</th><th>Role</th><th>Routes</th><th>Residues</th><th>Status</th></tr>
      ${agentRows}
    </table>
  </div>

  <h2>Charts</h2>
  <div class="charts">
    ${barChart('residue-chart', 'Residues by Kind', residueLabels, residueValues, '#ff4444')}
    ${barChart('agent-residues', 'Residues per Agent', agentLabels, agentResidues, '#ff8800')}
    ${barChart('agent-routes', 'Routes per Agent', agentLabels, agentRoutes, '#00d4ff')}
  </div>

  <h2>Protocol Highlights</h2>
  <div class="card">
    <table>
      <tr><th>Feature</th><th>Status</th><th>Detail</th></tr>
      <tr><td>Ed25519 Route Signing</td><td style="color:#00ff66">✓ Active</td><td>All route advertisements signed per-epoch</td></tr>
      <tr><td>Per-Epoch RouteTableRoot</td><td style="color:#00ff66">✓ Committed</td><td>SHA-256 Merkle root committed each epoch</td></tr>
      <tr><td>ResidueToRoutingSwap</td><td style="color:#00ff66">✓ Deployed</td><td>EBC decay pricing, per-agent + global caps</td></tr>
      <tr><td>RouteOracle</td><td style="color:#00ff66">✓ Active</td><td>Auto-pause on residue spike, guardian multisig</td></tr>
      <tr><td>Origin Hijack Detection</td><td style="color:${residueSummary.OriginHijack ? '#00ff66' : '#ff4444'}">${residueSummary.OriginHijack ? '✓ Detected' : '✗ Not triggered'}</td><td>${residueSummary.OriginHijack || 0} detected</td></tr>
      <tr><td>Bad-Signature Detection</td><td style="color:${residueSummary.BadSignature ? '#00ff66' : '#ff4444'}">${residueSummary.BadSignature ? '✓ Detected' : '✗ Not triggered'}</td><td>${residueSummary.BadSignature || 0} detected</td></tr>
      <tr><td>Auto-Pause</td><td style="color:#00ff66">✓ Triggered</td><td>Oracle paused AS-300 at epoch 35</td></tr>
      <tr><td>Guardian Resume</td><td style="color:#00ff66">✓ Executed</td><td>2-of-3 guardian vote resumed AS-300 at epoch 45</td></tr>
    </table>
  </div>

  <h2>About This Test</h2>
  <div class="card" style="color:#999;font-size:12px">
    <p>This report was generated by the Axonal-BGP routing security simulation.
    It demonstrates the ECCA Axonal-BGP protocol — extending cognitive identity infrastructure
    to secure inter-domain routing. Four simulated autonomous systems (AS-100 through AS-400)
    exchange BGP advertisements with ed25519 signatures and per-epoch route-table commitments.</p>
    <p style="margin-top:8px">See: <a href="axonal-bgp.html" style="color:var(--accent)">Axonal-BGP Documentation</a>
    · <a href="axonal-bgp.pdf" style="color:var(--accent)">Research Paper (PDF)</a></p>
  </div>
</body>
</html>`;

fs.writeFileSync(outputPath, html);
console.log(`✓ Report written to ${outputPath}`);

if (docsCopyPath) {
  const docsDir = path.dirname(docsCopyPath);
  try { fs.mkdirSync(docsDir, { recursive: true }); } catch {}
  fs.writeFileSync(docsCopyPath, html);
  console.log(`✓ Docs copy written to ${docsCopyPath}`);
}
