import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  cortexChain,
  cortexPublic,
  cortexWallet,
  STACK_IDENTITY_ABI,
  BANDWIDTH_TOKEN_ABI,
  RESIDUE_REGISTRY_ABI,
  NEEDLECAST_ROUTER_ABI,
  QUELLIST_TREASURY_ABI,
  TRIPARTITE_GAME_ABI,
  EPOCH_ANCHOR_ABI,
  TripartiteResource,
} from './cortex.js';

import { HippocampusClient } from './hippocampus.js';
import { MedullaClient, type CoherenceAnchor } from './medulla.js';

// ─── Cortex chain config ──────────────────────────────────────────────────
describe('cortexChain', () => {
  it('has chain ID 131072', () => {
    assert.equal(cortexChain.id, 131072);
  });

  it('has native currency Siyana (SYN)', () => {
    assert.equal(cortexChain.nativeCurrency.symbol, 'SYN');
    assert.equal(cortexChain.nativeCurrency.decimals, 18);
  });

  it('has a default RPC URL', () => {
    assert.ok(cortexChain.rpcUrls.default.http.length > 0);
  });
});

// ─── Client factory functions ─────────────────────────────────────────────
describe('cortexPublic', () => {
  it('returns a PublicClient with the cortex chain', () => {
    const client = cortexPublic();
    assert.ok(client);
    assert.equal(client.chain?.id, 131072);
  });
});

describe('cortexWallet', () => {
  it('returns a WalletClient with an account', () => {
    const pk = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
    const client = cortexWallet(pk as `0x${string}`);
    assert.ok(client);
    assert.ok(client.account);
    assert.equal(client.chain?.id, 131072);
  });
});

// ─── ABI presence and shape ───────────────────────────────────────────────
describe('Canonical ABIs', () => {
  const abiSuites: [string, readonly any[]][] = [
    ['STACK_IDENTITY_ABI', STACK_IDENTITY_ABI],
    ['BANDWIDTH_TOKEN_ABI', BANDWIDTH_TOKEN_ABI],
    ['RESIDUE_REGISTRY_ABI', RESIDUE_REGISTRY_ABI],
    ['NEEDLECAST_ROUTER_ABI', NEEDLECAST_ROUTER_ABI],
    ['QUELLIST_TREASURY_ABI', QUELLIST_TREASURY_ABI],
    ['TRIPARTITE_GAME_ABI', TRIPARTITE_GAME_ABI],
    ['EPOCH_ANCHOR_ABI', EPOCH_ANCHOR_ABI],
  ];

  for (const [name, abi] of abiSuites) {
    it(`${name} is a non-empty array`, () => {
      assert.ok(Array.isArray(abi));
      assert.ok(abi.length > 0, `${name} should have entries`);
    });
  }

  it('STACK_IDENTITY_ABI has mintStack function', () => {
    const fn = STACK_IDENTITY_ABI.find((e: any) => e.name === 'mintStack');
    assert.ok(fn, 'mintStack should exist in ABI');
  });

  it('BANDWIDTH_TOKEN_ABI has spend function', () => {
    const fn = BANDWIDTH_TOKEN_ABI.find((e: any) => e.name === 'spend');
    assert.ok(fn, 'spend should exist in ABI');
  });

  it('EPOCH_ANCHOR_ABI has commitAnchor function', () => {
    const fn = EPOCH_ANCHOR_ABI.find((e: any) => e.name === 'commitAnchor');
    assert.ok(fn, 'commitAnchor should exist in ABI');
  });

  it('TRIPARTITE_GAME_ABI has all game functions', () => {
    const fns = ['openGame', 'registerParty', 'consume', 'verifyAllocationFair', 'auditEpoch'];
    for (const name of fns) {
      const fn = TRIPARTITE_GAME_ABI.find((e: any) => e.name === name);
      assert.ok(fn, `${name} should exist in TRIPARTITE_GAME_ABI`);
    }
  });
});

// ─── TripartiteResource enum ──────────────────────────────────────────────
describe('TripartiteResource', () => {
  it('maps Compute to 0', () => assert.equal(TripartiteResource.Compute, 0));
  it('maps Storage to 1', () => assert.equal(TripartiteResource.Storage, 1));
  it('maps Bandwidth to 2', () => assert.equal(TripartiteResource.Bandwidth, 2));
});

// ─── HippocampusClient ───────────────────────────────────────────────────
describe('HippocampusClient', () => {
  it('constructs with default URL', () => {
    const client = new HippocampusClient();
    assert.ok(client);
  });

  it('constructs with custom URL', () => {
    const client = new HippocampusClient('http://custom:5001');
    assert.ok(client);
  });

  it('has all required methods', () => {
    const client = new HippocampusClient();
    assert.equal(typeof client.put, 'function');
    assert.equal(typeof client.get, 'function');
    assert.equal(typeof client.pin, 'function');
    assert.equal(typeof client.lease, 'function');
    assert.equal(typeof client.pinStatus, 'function');
    assert.equal(typeof client.recall, 'function');
  });
});

// ─── MedullaClient ────────────────────────────────────────────────────────
describe('MedullaClient', () => {
  it('constructs with default URL', () => {
    const client = new MedullaClient();
    assert.ok(client);
  });

  it('constructs with custom URL', () => {
    const client = new MedullaClient('http://custom:8332');
    assert.ok(client);
  });

  it('has all required methods', () => {
    const client = new MedullaClient();
    assert.equal(typeof client.getInfo, 'function');
    assert.equal(typeof client.getEpochAnchor, 'function');
    assert.equal(typeof client.getLatestAnchor, 'function');
    assert.equal(typeof client.submitCoherenceRoot, 'function');
    assert.equal(typeof client.getSynapticProof, 'function');
    assert.equal(typeof client.joinPool, 'function');
    assert.equal(typeof client.mineBlock, 'function');
  });
});
