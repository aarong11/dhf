// Pin-lease end-to-end — runs against a live docker compose stack.
// Requires: `docker compose up -d`.
//
// Validates that the Hippocampus DAG enforces lease expiry when reading
// memory: a leased fragment is recoverable while the lease covers the
// caller's current epoch, and falls back into the ±2 epoch drift gate
// once the lease expires.

import { describe, it, expect } from 'vitest';

const HIPPO = process.env.HIPPOCAMPUS_URL ?? 'http://localhost:5001';

async function jpost(path: string, body: any) {
  const r = await fetch(HIPPO + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${path} → ${r.status} ${await r.text()}`);
  return r.json();
}
async function jget(path: string) {
  const r = await fetch(HIPPO + path);
  if (!r.ok) throw new Error(`${path} → ${r.status}`);
  return r.json();
}

describe('hippocampus pin lease — storage scarcity primitive', () => {
  const STACK = 'stack:test:lease:' + Math.random().toString(16).slice(2, 8);

  async function putNode(epoch: number, label: string) {
    const res: any = await jpost('/dag/put', {
      stackId: STACK,
      epoch,
      ciphertext: { iv: 'aa', ct: Buffer.from(label).toString('hex'), v: 1 },
      links: [],
      kind: 'episodic',
      pinned: false,
    });
    return res.cid as string;
  }
  async function recall(rootCid: string, epoch: number) {
    return jpost('/dhf/recall', {
      rootCid, stackId: STACK, epoch, depth: 4, memoryToken: 100,
    }) as Promise<any>;
  }

  it('an unleased node beyond ±2 epochs is broken', async () => {
    const cid = await putNode(1, 'cold');
    const r = await recall(cid, 100);
    expect(r.fragments).toHaveLength(0);
    expect(r.broken.length).toBeGreaterThan(0);
  });

  it('a lease keeps the node recoverable while its epoch is covered', async () => {
    const cid = await putNode(1, 'leased');
    const lease: any = await jpost('/pin/lease', { cid, untilEpoch: 50 });
    expect(lease.ok).toBe(true);
    expect(lease.untilEpoch).toBe(50);
    const r = await recall(cid, 50);
    expect(r.fragments).toHaveLength(1);
    expect(r.fidelity).toBe(1);
  });

  it('the same node falls back to drift-broken after the lease expires', async () => {
    const cid = await putNode(1, 'expires');
    await jpost('/pin/lease', { cid, untilEpoch: 5 });
    const r = await recall(cid, 1000);
    expect(r.fragments).toHaveLength(0);
    expect(r.broken.length).toBeGreaterThan(0);
    expect(r.broken[0]).toContain('epoch_drift');
  });

  it('lease can only be extended, not shortened', async () => {
    const cid = await putNode(1, 'extend');
    await jpost('/pin/lease', { cid, untilEpoch: 100 });
    // Attempt to shorten — server returns 400.
    const r = await fetch(HIPPO + '/pin/lease', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cid, untilEpoch: 50 }),
    });
    expect(r.status).toBe(400);
  });

  it('pin/status reports active vs expired relative to a query epoch', async () => {
    const cid = await putNode(1, 'status-check');
    await jpost('/pin/lease', { cid, untilEpoch: 25 });
    const within: any = await jget(`/pin/status?cid=${encodeURIComponent(cid)}&epoch=10`);
    expect(within.active).toBe(true);
    expect(within.untilEpoch).toBe(25);
    const beyond: any = await jget(`/pin/status?cid=${encodeURIComponent(cid)}&epoch=999`);
    expect(beyond.active).toBe(false);
  });

  it('lease does not bypass the stack-mismatch gate', async () => {
    const cid = await putNode(1, 'wrong-stack');
    await jpost('/pin/lease', { cid, untilEpoch: 1000 });
    const r: any = await jpost('/dhf/recall', {
      rootCid: cid, stackId: STACK + ':OTHER', epoch: 1, depth: 4, memoryToken: 100,
    });
    expect(r.fragments).toHaveLength(0);
    expect(r.broken[0]).toContain('stack_mismatch');
  });
});
