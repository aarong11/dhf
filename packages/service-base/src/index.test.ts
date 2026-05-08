import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  createService, createLogger, listen, wireShutdown, daemon,
  type ServiceConfig,
} from './index.js';

// ─── createLogger ──────────────────────────────────────────────────────────
describe('createLogger', () => {
  it('returns a pino logger with the given name', () => {
    const log = createLogger('test-svc');
    assert.ok(log);
    assert.equal(typeof log.info, 'function');
    assert.equal(typeof log.error, 'function');
    assert.equal(typeof log.warn, 'function');
  });
});

// ─── createService ─────────────────────────────────────────────────────────
describe('createService', () => {
  it('creates a Fastify instance', async () => {
    const app = await createService({ name: 'unit-test' });
    assert.ok(app);
    assert.equal(typeof app.listen, 'function');
    assert.equal(typeof app.close, 'function');
    await app.close();
  });

  it('registers /healthz endpoint', async () => {
    const app = await createService({ name: 'health-test' });
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.payload);
    assert.equal(body.ok, true);
    assert.equal(body.name, 'health-test');
    assert.ok(body.ts > 0);
    await app.close();
  });

  it('registers /readyz endpoint', async () => {
    const app = await createService({ name: 'ready-test' });
    const res = await app.inject({ method: 'GET', url: '/readyz' });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.payload);
    assert.equal(body.ready, true);
    await app.close();
  });

  it('uses cors by default', async () => {
    const app = await createService({ name: 'cors-test' });
    // Send a normal GET with an Origin header — CORS plugin adds access-control headers
    const res = await app.inject({
      method: 'GET', url: '/healthz',
      headers: { origin: 'http://example.com' },
    });
    assert.equal(res.statusCode, 200);
    assert.ok(res.headers['access-control-allow-origin'], 'Should set CORS headers');
    await app.close();
  });

  it('can disable cors', async () => {
    const app = await createService({ name: 'no-cors', cors: false });
    assert.ok(app);
    await app.close();
  });
});

// ─── listen ────────────────────────────────────────────────────────────────
describe('listen', () => {
  it('binds to a port', async () => {
    const app = await createService({ name: 'listen-test' });
    await listen(app, 0); // Port 0 = random available port
    const addr = app.server.address();
    assert.ok(addr);
    assert.ok(typeof addr === 'object' && addr.port > 0);
    await app.close();
  });
});

// ─── wireShutdown ──────────────────────────────────────────────────────────
describe('wireShutdown', () => {
  it('registers signal handlers without error', async () => {
    const app = await createService({ name: 'shutdown-test' });
    assert.doesNotThrow(() => wireShutdown(app));
    await app.close();
  });

  it('accepts an extra cleanup callback', async () => {
    const app = await createService({ name: 'shutdown-extra' });
    let called = false;
    wireShutdown(app, async () => { called = true; });
    // We don't actually send SIGTERM in tests, just verify it registers
    assert.ok(!called); // not called yet
    await app.close();
  });
});

// ─── daemon ────────────────────────────────────────────────────────────────
describe('daemon', () => {
  it('is a function', () => {
    assert.equal(typeof daemon, 'function');
  });
});
