// ecca-stack/api/server.js
// REST + WebSocket "Cognitive Sync Engine" for the ECCA stack.

const path = require('path');
const http = require('http');
const express = require('express');
const cors = require('cors');
const { WebSocketServer } = require('ws');

const { DHFStack, registerStack, getStack, listStacks } = require('../dhs-core');
const { spawnSleeve, getSleeve, listSleeves } = require('../sleeves');
const { needlecast } = require('../needlecasting');
const { dag } = require('../memory-ipfs');
const { engine } = require('../coordination-engine');
const { network } = require('../mining-network');

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, '..', 'frontend')));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });
const broadcast = (event, payload) => {
  const msg = JSON.stringify({ event, payload, ts: Date.now() });
  wss.clients.forEach((c) => { if (c.readyState === 1) c.send(msg); });
};

// --- STACKS --------------------------------------------------------------

app.post('/stacks', (req, res) => {
  const { name = 'unnamed', kind = 'human' } = req.body || {};
  const s = registerStack(new DHFStack({ name, kind }));
  broadcast('stack:created', s.state());
  res.json(s.state());
});

app.get('/stacks', (_req, res) => res.json(listStacks().map((s) => s.state())));

app.get('/stacks/:id', (req, res) => {
  const s = getStack(req.params.id);
  if (!s) return res.status(404).json({ error: 'not found' });
  res.json(s.state());
});

app.get('/stacks/:id/sleeves', (req, res) => {
  res.json(listSleeves().filter((sl) => sl.stack_id === req.params.id).map((sl) => sl.state()));
});

app.post('/stacks/:id/needlecast', (req, res) => {
  const { from, to } = req.body || {};
  if (!from || !to) return res.status(400).json({ error: 'from and to sleeve ids required' });
  try {
    const r = needlecast(from, to);
    broadcast('needlecast', r);
    res.json(r);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.post('/stacks/:id/remember', (req, res) => {
  const s = getStack(req.params.id);
  if (!s) return res.status(404).json({ error: 'not found' });
  const cidStr = s.remember(String(req.body?.text ?? ''), { pin: !!req.body?.pin });
  broadcast('memory:write', { stackId: s.id, cid: cidStr });
  res.json({ cid: cidStr });
});

app.get('/stacks/:id/recall', (req, res) => {
  const s = getStack(req.params.id);
  if (!s) return res.status(404).json({ error: 'not found' });
  res.json(s.recall(parseInt(req.query.depth, 10) || 6));
});

app.get('/stacks/:id/continuity', (req, res) => {
  res.json(engine.continuity(req.params.id));
});

// --- MEMORY --------------------------------------------------------------

app.get('/memory/:cid', (req, res) => {
  const id = decodeURIComponent(req.params.cid);
  const exists = dag.has(id);
  res.json({ cid: id, exists, dag: dag.snapshot() });
});

app.post('/memory/reconstruct', (req, res) => {
  const { rootCid, stackId, epoch, tokens, depth } = req.body || {};
  if (!rootCid || !stackId) return res.status(400).json({ error: 'rootCid + stackId required' });
  const s = getStack(stackId);
  if (!s) return res.status(404).json({ error: 'stack not found' });
  const r = dag.reconstruct({
    rootCid,
    stackId,
    epoch: epoch ?? s.epoch,
    tokens: tokens ?? s.tokens,
    depth: depth ?? 6,
  });
  broadcast('memory:reconstruct', { stackId, rootCid, fidelity: r.fidelity });
  res.json(r);
});

// --- SLEEVES -------------------------------------------------------------

app.get('/sleeves', (_req, res) => res.json(listSleeves().map((s) => s.state())));

app.post('/sleeves/spawn', (req, res) => {
  const { stackId, embodiment_type = 'human' } = req.body || {};
  if (!stackId) return res.status(400).json({ error: 'stackId required' });
  try {
    const sl = spawnSleeve({ stackId, embodiment_type });
    broadcast('sleeve:spawn', sl.state());
    res.json(sl.state());
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.post('/sleeves/sync', (req, res) => {
  const { id } = req.body || {};
  const sl = getSleeve(id);
  if (!sl) return res.status(404).json({ error: 'not found' });
  const r = sl.sync();
  broadcast('sleeve:sync', { id, ...r });
  res.json(r);
});

app.post('/sleeves/perceive', (req, res) => {
  const { id, input } = req.body || {};
  const sl = getSleeve(id);
  if (!sl) return res.status(404).json({ error: 'not found' });
  const r = sl.perceive(String(input ?? ''));
  broadcast('sleeve:drift', { id, drift: sl.driftScore() });
  res.json(r);
});

app.delete('/sleeves/:id', (req, res) => {
  const sl = getSleeve(req.params.id);
  if (!sl) return res.status(404).json({ error: 'not found' });
  sl.decommission();
  broadcast('sleeve:decommission', { id: sl.id });
  res.json({ ok: true });
});

// --- EPOCHS --------------------------------------------------------------

app.get('/epochs/current', (_req, res) => {
  const head = network.chain[network.chain.length - 1];
  res.json({
    epoch: head ? head.epoch : 0,
    head,
    coherence: engine.tick(),
  });
});

// --- MINING --------------------------------------------------------------

app.get('/mining/pools', (_req, res) => res.json(network.state()));

app.post('/mining/block', (req, res) => {
  const { pool = 'genesis-pool' } = req.body || {};
  const block = network.mineBlock(pool);
  broadcast('epoch:transition', block);
  res.json(block);
});

app.post('/mining/join', (req, res) => {
  const { pool = 'genesis-pool', sleeve } = req.body || {};
  if (!sleeve) return res.status(400).json({ error: 'sleeve required' });
  network.joinPool(pool, sleeve);
  res.json({ ok: true });
});

// --- COORDINATION --------------------------------------------------------

app.get('/coordination/desync', (_req, res) => res.json(engine.desyncReport()));
app.get('/coordination/tick', (_req, res) => res.json(engine.tick()));

// --- ROOT ----------------------------------------------------------------

app.get('/', (_req, res) => res.sendFile(path.join(__dirname, '..', 'frontend', 'index.html')));

// --- Periodic background pulses ------------------------------------------

setInterval(() => {
  const desync = engine.desyncReport();
  if (desync.length) broadcast('cross-chain:desync', desync);
  broadcast('coordination:tick', engine.tick());
}, 4000);

const PORT = process.env.PORT || 7070;
server.listen(PORT, () => {
  console.log(`[ECCA] cognitive sync engine listening on http://localhost:${PORT}`);
  console.log(`[ECCA] WebSocket  ws://localhost:${PORT}/ws`);
});

module.exports = { app, server, broadcast };
