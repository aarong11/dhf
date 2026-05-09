#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════
//  Playfair Report Generator
//  Reads playfair-results.json → produces HTML in the ECCA cyberpunk style
// ═══════════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');

const [,, inputFile, ...outFiles] = process.argv;

if (!inputFile) {
  console.error('Usage: node generate-playfair-report.js <results.json> [out1.html] [out2.html]');
  process.exit(1);
}

if (!fs.existsSync(inputFile)) {
  console.error(`Input file not found: ${inputFile}`);
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(inputFile, 'utf8'));
const { meta, regions, agents, needlecasts, residues, audits, scenarios, summary, perEpochTimeline } = data;

function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

// Region colors
const REGION_COLORS = {
  storage:   { primary: '#00ff88', bg: 'rgba(0,255,136,0.06)', border: 'rgba(0,255,136,0.2)' },
  compute:   { primary: '#00f0ff', bg: 'rgba(0,240,255,0.06)', border: 'rgba(0,240,255,0.2)' },
  bandwidth: { primary: '#ff00e6', bg: 'rgba(255,0,230,0.06)', border: 'rgba(255,0,230,0.2)' },
};

// ─── Generate agent cards ────────────────────────────────────────────
let agentCards = '';
for (const [name, agent] of Object.entries(agents)) {
  const rc = REGION_COLORS[agent.currentRegion] || REGION_COLORS.compute;
  const migrated = agent.homeRegion !== agent.currentRegion;
  agentCards += `
<div class="agent-card" style="border-left: 3px solid ${rc.primary}; background: ${rc.bg};">
  <div class="agent-header">
    <span class="agent-name" style="color: ${rc.primary}">${esc(name)}</span>
    <span class="agent-kind">${esc(agent.sleeveKind)}</span>
  </div>
  <div class="agent-desc">${esc(agent.description)}</div>
  <div class="agent-stats">
    <div class="agent-stat"><span class="stat-n">${agent.totalPerceived}</span><span class="stat-l">perceived</span></div>
    <div class="agent-stat"><span class="stat-n">${agent.totalStored}</span><span class="stat-l">stored</span></div>
    <div class="agent-stat"><span class="stat-n">${agent.totalRouted}</span><span class="stat-l">routed</span></div>
    <div class="agent-stat"><span class="stat-n">${agent.totalSynced}</span><span class="stat-l">synced</span></div>
  </div>
  <div class="agent-tokens">
    <span class="token compute">⚡ ${Math.round(agent.tokenUsage.compute)}</span>
    <span class="token storage">💾 ${Math.round(agent.tokenUsage.storage)}</span>
    <span class="token bandwidth">📡 ${Math.round(agent.tokenUsage.bandwidth)}</span>
  </div>
  <div class="agent-region">
    ${migrated ? `<span class="migration">⚡ ${esc(agent.homeRegion)} → ${esc(agent.currentRegion)}</span>` : `<span>📍 ${esc(agent.currentRegion)}</span>`}
    <span class="drift ${agent.finalDrift > 10 ? 'high' : agent.finalDrift > 5 ? 'medium' : 'low'}">drift: ${agent.finalDrift}</span>
  </div>
  <div class="agent-cpv">CPV: [${Object.values(agent.cpv).map(v => v.toFixed(1)).join(', ')}]</div>
</div>`;
}

// ─── Generate timeline sparkline (ASCII) ────────────────────────────
let timelineRows = '';
if (perEpochTimeline) {
  const maxP = Math.max(...perEpochTimeline.map(e => e.perceptions), 1);
  for (const ep of perEpochTimeline) {
    const barLen = Math.round((ep.perceptions / maxP) * 30);
    const bar = '█'.repeat(barLen) + '░'.repeat(30 - barLen);
    const fairIcon = ep.fair ? '✓' : '✗';
    const routeIcon = ep.routes > 0 ? ` ⚡${ep.routes}` : '';
    const residueIcon = ep.residues > 0 ? ` ⚠${ep.residues}` : '';
    timelineRows += `<div class="tl-row"><span class="tl-epoch">${String(ep.epoch).padStart(3)}</span> <span class="tl-bar">${bar}</span> <span class="tl-info">p:${ep.perceptions} s:${ep.stores}${routeIcon}${residueIcon} ${fairIcon}</span></div>\n`;
  }
}

// ─── Generate needlecast log ─────────────────────────────────────────
let ncLog = '';
for (const nc of needlecasts) {
  const fromColor = REGION_COLORS[nc.fromRegion]?.primary || '#fff';
  const toColor = REGION_COLORS[nc.toRegion]?.primary || '#fff';
  ncLog += `<div class="nc-entry">
    <span class="nc-epoch">E${nc.epoch}</span>
    <span class="nc-agent">${esc(nc.agent)}</span>
    <span style="color:${fromColor}">${esc(nc.fromRegion)}</span>
    <span class="nc-arrow">→</span>
    <span style="color:${toColor}">${esc(nc.toRegion)}</span>
    <span class="nc-cost">${nc.cost} RTE, ${nc.shardCount} shards</span>
  </div>`;
}

// ─── Generate scenario log ──────────────────────────────────────────
let scenarioLog = '';
for (const s of scenarios) {
  scenarioLog += `<div class="scenario-entry"><span class="sc-epoch">E${s.epoch}</span> <span class="sc-type">${esc(s.type)}</span> ${esc(s.description)}</div>`;
}

// ─── Region comparison cards ─────────────────────────────────────────
let regionCards = '';
for (const [key, region] of Object.entries(regions)) {
  const rc = REGION_COLORS[key];
  const agentsInRegion = Object.entries(agents).filter(([,a]) => a.currentRegion === key);
  regionCards += `
<div class="region-card" style="border-top: 3px solid ${rc.primary};">
  <div class="region-name" style="color: ${rc.primary}">${esc(region.name)}</div>
  <div class="region-profile">
    <span>Compute: <strong>${esc(region.profile.computeCost)}</strong></span>
    <span>Storage: <strong>${esc(region.profile.storageCost)}</strong></span>
    <span>Bandwidth: <strong>${esc(region.profile.bandwidthCost)}</strong></span>
  </div>
  <div class="region-budgets">Budget: C=${region.budgets.compute} S=${region.budgets.storage} B=${region.budgets.bandwidth}</div>
  <div class="region-agents">${agentsInRegion.length} agents currently here</div>
</div>`;
}

const allFair = summary.allEpochsFair;

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>ECCA // Playfair — Tripartite Game Report</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500;700&family=Orbitron:wght@400;700;900&display=swap');
:root {
  --bg-deep: #030308; --bg-panel: #0a0a14; --bg-card: #0f0f1a;
  --neon-cyan: #00f0ff; --neon-magenta: #ff00e6; --neon-green: #00ff88;
  --neon-red: #ff0055; --neon-yellow: #ffcc00; --neon-purple: #b347ff;
  --text: #c8c8d4; --text-dim: #5a5a6e; --border: #1a1a2e;
}
* { margin: 0; padding: 0; box-sizing: border-box; }
body { background: var(--bg-deep); color: var(--text); font-family: 'JetBrains Mono', monospace; font-size: 13px; line-height: 1.6; }
body::before { content: ''; position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,240,255,0.008) 2px, rgba(0,240,255,0.008) 4px); pointer-events: none; z-index: 9999; }
.header { background: linear-gradient(180deg, var(--bg-panel), var(--bg-deep)); border-bottom: 1px solid var(--neon-cyan); padding: 2.5rem 2rem 2rem; text-align: center; }
.header h1 { font-family: 'Orbitron', sans-serif; font-size: 2.2rem; font-weight: 900; letter-spacing: 0.3em; background: linear-gradient(135deg, var(--neon-cyan), var(--neon-magenta)); -webkit-background-clip: text; -webkit-text-fill-color: transparent; margin-bottom: 0.4rem; }
.header .sub { font-size: 0.72rem; color: var(--text-dim); letter-spacing: 0.15em; text-transform: uppercase; }
.header .ts { margin-top: 0.5rem; font-size: 0.65rem; color: var(--neon-cyan); opacity: 0.7; }
.stats-bar { display: flex; justify-content: center; gap: 2.5rem; padding: 1.5rem; background: var(--bg-panel); border-bottom: 1px solid var(--border); flex-wrap: wrap; }
.stat { text-align: center; }
.stat-value { font-family: 'Orbitron', sans-serif; font-size: 2rem; font-weight: 700; }
.stat-value.green { color: var(--neon-green); } .stat-value.cyan { color: var(--neon-cyan); }
.stat-value.magenta { color: var(--neon-magenta); } .stat-value.yellow { color: var(--neon-yellow); }
.stat-value.purple { color: var(--neon-purple); }
.stat-label { font-size: 0.55rem; text-transform: uppercase; letter-spacing: 0.2em; color: var(--text-dim); margin-top: 0.2rem; }
.content { max-width: 1000px; margin: 2rem auto; padding: 0 1.5rem; }
h2 { font-family: 'Orbitron', sans-serif; font-size: 1rem; font-weight: 700; color: var(--neon-cyan); margin: 2.5rem 0 1rem; letter-spacing: 0.1em; border-bottom: 1px solid var(--border); padding-bottom: 0.5rem; }
.region-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1rem; margin: 1rem 0; }
.region-card { background: var(--bg-card); border: 1px solid var(--border); border-radius: 8px; padding: 1rem; }
.region-name { font-family: 'Orbitron', sans-serif; font-size: 0.85rem; font-weight: 700; margin-bottom: 0.5rem; }
.region-profile { display: flex; flex-direction: column; gap: 0.2rem; font-size: 0.72rem; color: var(--text-dim); }
.region-profile strong { color: var(--text); }
.region-budgets { font-size: 0.7rem; color: var(--neon-yellow); margin-top: 0.5rem; }
.region-agents { font-size: 0.68rem; color: var(--text-dim); margin-top: 0.3rem; }
.agent-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 1rem; margin: 1rem 0; }
.agent-card { background: var(--bg-card); border: 1px solid var(--border); border-radius: 8px; padding: 1rem; }
.agent-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.4rem; }
.agent-name { font-family: 'Orbitron', sans-serif; font-size: 0.8rem; font-weight: 700; }
.agent-kind { font-size: 0.6rem; text-transform: uppercase; letter-spacing: 0.1em; color: var(--text-dim); background: rgba(255,255,255,0.05); padding: 0.2rem 0.5rem; border-radius: 3px; }
.agent-desc { font-size: 0.7rem; color: var(--text-dim); margin-bottom: 0.6rem; line-height: 1.5; }
.agent-stats { display: flex; gap: 0.8rem; margin-bottom: 0.5rem; }
.agent-stat { text-align: center; }
.stat-n { display: block; font-family: 'Orbitron', sans-serif; font-size: 1.1rem; font-weight: 700; color: var(--neon-cyan); }
.stat-l { font-size: 0.5rem; text-transform: uppercase; letter-spacing: 0.1em; color: var(--text-dim); }
.agent-tokens { display: flex; gap: 0.5rem; margin-bottom: 0.4rem; }
.token { font-size: 0.68rem; padding: 0.2rem 0.5rem; border-radius: 3px; background: rgba(255,255,255,0.03); }
.token.compute { color: var(--neon-cyan); } .token.storage { color: var(--neon-green); } .token.bandwidth { color: var(--neon-magenta); }
.agent-region { display: flex; justify-content: space-between; font-size: 0.68rem; margin-bottom: 0.3rem; }
.migration { color: var(--neon-yellow); }
.drift.low { color: var(--neon-green); } .drift.medium { color: var(--neon-yellow); } .drift.high { color: var(--neon-red); }
.agent-cpv { font-size: 0.6rem; color: var(--text-dim); font-family: 'JetBrains Mono', monospace; }
.timeline { background: var(--bg-card); border: 1px solid var(--border); border-radius: 8px; padding: 1rem; overflow-x: auto; margin: 1rem 0; max-height: 600px; overflow-y: auto; }
.tl-row { white-space: nowrap; font-size: 0.68rem; line-height: 1.3; }
.tl-epoch { color: var(--neon-magenta); } .tl-bar { color: var(--neon-cyan); opacity: 0.7; } .tl-info { color: var(--text-dim); }
.nc-log, .scenario-log { margin: 1rem 0; }
.nc-entry, .scenario-entry { padding: 0.4rem 0.8rem; margin: 0.2rem 0; background: var(--bg-card); border-radius: 4px; font-size: 0.72rem; display: flex; gap: 0.6rem; align-items: center; flex-wrap: wrap; }
.nc-epoch, .sc-epoch { font-family: 'Orbitron', sans-serif; font-size: 0.6rem; color: var(--neon-magenta); min-width: 2.5rem; }
.nc-agent { color: var(--neon-cyan); font-weight: 700; } .nc-arrow { color: var(--text-dim); } .nc-cost { color: var(--neon-yellow); font-size: 0.65rem; margin-left: auto; }
.sc-type { font-weight: 700; color: var(--neon-yellow); text-transform: uppercase; font-size: 0.6rem; background: rgba(255,204,0,0.1); padding: 0.1rem 0.4rem; border-radius: 3px; }
.result-banner { margin: 2rem 0; padding: 2rem; text-align: center; border-radius: 10px; border: 1px solid; }
.result-banner.pass { background: rgba(0,255,136,0.02); border-color: var(--neon-green); }
.result-banner.fail { background: rgba(255,0,85,0.02); border-color: var(--neon-red); }
.result-banner h2 { font-family: 'Orbitron', sans-serif; font-size: 1.4rem; border: none; padding: 0; margin: 0 0 0.5rem; }
.result-banner.pass h2 { color: var(--neon-green); } .result-banner.fail h2 { color: var(--neon-red); }
.result-banner p { color: var(--text-dim); font-size: 0.75rem; }
.nav-links { display: flex; justify-content: center; gap: 1rem; padding: 0.8rem; background: var(--bg-panel); border-bottom: 1px solid var(--border); flex-wrap: wrap; }
.nav-links a { font-size: 0.65rem; color: var(--text-dim); text-decoration: none; letter-spacing: 0.1em; text-transform: uppercase; padding: 0.3rem 0.6rem; border-radius: 3px; }
.nav-links a:hover, .nav-links a.active { color: var(--neon-cyan); background: rgba(0,240,255,0.06); }
.footer { text-align: center; padding: 2rem; color: var(--text-dim); font-size: 0.55rem; letter-spacing: 0.15em; border-top: 1px solid var(--border); margin-top: 3rem; }
@media (max-width: 700px) { .region-grid { grid-template-columns: 1fr; } .agent-grid { grid-template-columns: 1fr; } }
</style>
</head>
<body>
<div class="header">
  <h1>PLAYFAIR</h1>
  <div class="sub">Tripartite Game Report &mdash; 3-Region Asynchronous Agent Test</div>
  <div class="ts">${esc(meta.startTime)} &mdash; ${Math.round(meta.durationMs / 1000)}s runtime</div>
</div>
<div class="stats-bar">
  <div class="stat"><div class="stat-value green">${summary.totalPerceptions}</div><div class="stat-label">Perceptions</div></div>
  <div class="stat"><div class="stat-value cyan">${summary.totalStores}</div><div class="stat-label">Stored</div></div>
  <div class="stat"><div class="stat-value magenta">${summary.totalRoutes}</div><div class="stat-label">Routes</div></div>
  <div class="stat"><div class="stat-value yellow">${summary.regionMigrations}</div><div class="stat-label">Migrations</div></div>
  <div class="stat"><div class="stat-value purple">${meta.epochs}</div><div class="stat-label">Epochs</div></div>
  <div class="stat"><div class="stat-value ${allFair ? 'green' : 'magenta'}">${allFair ? 'FAIR' : 'UNFAIR'}</div><div class="stat-label">Verdict</div></div>
</div>
<div class="nav-links">
  <a href="e2e-report.html">E2E Report</a>
  <a href="unit-test-report.html">Unit Tests</a>
  <a href="playfair-report.html" class="active">Playfair</a>
  <a href="blog-variable-bitrate-worlds.html">Blog</a>
  <a href="changelog.html">Changelog</a>
  <a href="index.html">Docs</a>
</div>
<div class="content">

<h2>REGIONS</h2>
<div class="region-grid">${regionCards}</div>

<h2>AGENTS</h2>
<div class="agent-grid">${agentCards}</div>

<h2>EPOCH TIMELINE</h2>
<div class="timeline">${timelineRows}</div>

<h2>SCENARIO EVENTS</h2>
<div class="scenario-log">${scenarioLog || '<div style="color:var(--text-dim);padding:0.5rem;">No scripted events</div>'}</div>

<h2>NEEDLECAST LOG</h2>
<div class="nc-log">${ncLog || '<div style="color:var(--text-dim);padding:0.5rem;">No needlecasts</div>'}</div>

<div class="result-banner ${allFair ? 'pass' : 'fail'}">
  <h2>${allFair ? 'ALL EPOCHS VERIFIED FAIR' : 'ALLOCATION VIOLATIONS DETECTED'}</h2>
  <p>${meta.agentCount} agents across ${meta.regionCount} regions over ${meta.epochs} epochs &mdash;
  ${summary.totalPerceptions} perceptions, ${summary.regionMigrations} cross-region migrations,
  ${summary.totalResidues} residues (${summary.residuesResolved} resolved)</p>
</div>
</div>
<div class="footer">ECCA STACK v3 &mdash; PLAYFAIR TRIPARTITE GAME REPORT &mdash; ALL MEMORY IS SACRED</div>
</body>
</html>`;

const outputs = outFiles.length ? outFiles : [inputFile.replace('.json', '.html')];
for (const outFile of outputs) {
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, html);
  console.log(`  Generated: ${outFile}`);
}
