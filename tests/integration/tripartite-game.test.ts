// Tripartite-game end-to-end — runs against a live cortex-evm chain.
// Requires: `docker compose up -d` then `pnpm contracts:deploy`.
//
// Validates that on-chain TripartiteGame enforces per-party, per-epoch caps
// for compute / storage / bandwidth, and that any party can re-derive
// allocation fairness from chain state alone.

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  createPublicClient, createWalletClient, http, defineChain, keccak256, toHex, parseEther,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import {
  STACK_IDENTITY_ABI, BANDWIDTH_TOKEN_ABI, TRIPARTITE_GAME_ABI, TripartiteResource,
} from '@ecca/chain';

const RPC = process.env.CORTEX_RPC ?? 'http://localhost:8545';
const DEPLOYMENTS = process.env.DEPLOYMENTS_FILE
  ?? join(process.cwd(), '..', 'contracts', 'deployments', 'cortex.json');

// Hardhat / dev-mode default keys — three parties + a referee + an inspector.
const KEYS = {
  referee:   '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
  partyA:    '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
  partyB:    '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cde8b0c1',
  partyC:    '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6',
  inspector: '0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a',
} as const;

const chain = defineChain({
  id: Number(process.env.CORTEX_CHAIN_ID ?? 131072),
  name: 'Cortex EVM (test)',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
});

function loadDeployments() {
  return JSON.parse(readFileSync(DEPLOYMENTS, 'utf8')) as Record<string, string>;
}
function wallet(pk: `0x${string}`) {
  return createWalletClient({ account: privateKeyToAccount(pk), chain, transport: http(RPC) });
}
function pub() {
  return createPublicClient({ chain, transport: http(RPC) });
}

describe('tripartite-game — provably-fair multilateral allocation', () => {
  let dep: Record<string, string>;
  let pc: ReturnType<typeof pub>;
  let GAME_ID: `0x${string}`;
  let tokenIds: { A: bigint; B: bigint; C: bigint };

  beforeAll(async () => {
    dep = loadDeployments();
    pc = pub();
    GAME_ID = keccak256(toHex(`treaty:e2e:${Date.now()}`));

    // Fund the three party wallets from the dev account if needed.
    const accts = await pc.request({ method: 'eth_accounts' as any }) as string[];
    const dev = accts[0] as `0x${string}`;
    for (const pk of [KEYS.partyA, KEYS.partyB, KEYS.partyC, KEYS.inspector]) {
      const acct = privateKeyToAccount(pk as `0x${string}`);
      const bal = await pc.getBalance({ address: acct.address });
      if (bal < parseEther('1')) {
        const h = await pc.request({
          method: 'eth_sendTransaction' as any,
          params: [{
            from: dev, to: acct.address as `0x${string}`,
            value: ('0x' + (10n * 10n ** 18n).toString(16)) as `0x${string}`,
          }],
        });
        await pc.waitForTransactionReceipt({ hash: h as `0x${string}` });
      }
    }

    // Mint a stack NFT for each party. nextTokenId starts where deploy left it.
    const startId = await pc.readContract({
      address: dep.StackIdentity as `0x${string}`,
      abi: STACK_IDENTITY_ABI,
      functionName: 'nextTokenId',
    }) as bigint;
    tokenIds = { A: startId, B: startId + 1n, C: startId + 2n };

    const cpv: [bigint, bigint, bigint, bigint, bigint] =
      [1_000_000n, 1_000_000n, 1_000_000n, 1_000_000n, 1_000_000n];
    let i = 0;
    for (const pk of [KEYS.partyA, KEYS.partyB, KEYS.partyC]) {
      const w = wallet(pk as `0x${string}`);
      const fingerprint = [0xAA, 0xBB, 0xCC][i++];
      const h = await w.writeContract({
        address: dep.StackIdentity as `0x${string}`,
        abi: STACK_IDENTITY_ABI,
        functionName: 'mintStack',
        args: [toHex(new Uint8Array(32).fill(fingerprint)), cpv, 100_000n, 200_000n],
        chain, account: w.account!,
      });
      await pc.waitForTransactionReceipt({ hash: h });
    }

    // Mint generous bandwidth to each tokenId from the deployer (treasury minter).
    const ref = wallet(KEYS.referee);
    for (const tid of [tokenIds.A, tokenIds.B, tokenIds.C]) {
      // Treasury owns minter on tokens — call treasury.issue
      // kind: 0=compute, 1=memory, 3=routing
      for (const kind of [0, 1, 3]) {
        const h = await ref.writeContract({
          address: dep.QuellistTreasury as `0x${string}`,
          abi: [
            { type: 'function', name: 'issue', stateMutability: 'nonpayable',
              inputs: [{ type: 'uint256' }, { type: 'uint8' }, { type: 'uint256' }, { type: 'bytes32' }],
              outputs: [] },
          ] as const,
          functionName: 'issue',
          args: [tid, kind, parseEther('10000'), keccak256(toHex('seed'))],
          chain, account: ref.account!,
        });
        await pc.waitForTransactionReceipt({ hash: h });
      }
    }

    // Each party authorises the TripartiteGame contract as a sleeve on each token.
    const tokenAddrs: Record<string, string> = {
      compute: dep.ComputeToken, memory: dep.MemoryToken, routing: dep.RoutingToken,
    };
    let p = 0;
    for (const pk of [KEYS.partyA, KEYS.partyB, KEYS.partyC]) {
      const w = wallet(pk as `0x${string}`);
      const tid = [tokenIds.A, tokenIds.B, tokenIds.C][p++];
      for (const ta of Object.values(tokenAddrs)) {
        const h = await w.writeContract({
          address: ta as `0x${string}`,
          abi: BANDWIDTH_TOKEN_ABI,
          functionName: 'authorizeSleeve',
          args: [tid, dep.TripartiteGame as `0x${string}`, true],
          chain, account: w.account!,
        });
        await pc.waitForTransactionReceipt({ hash: h });
      }
    }

    // Referee opens the game, each party self-registers a budget.
    {
      const h = await ref.writeContract({
        address: dep.TripartiteGame as `0x${string}`,
        abi: TRIPARTITE_GAME_ABI,
        functionName: 'openGame',
        args: [GAME_ID],
        chain, account: ref.account!,
      });
      await pc.waitForTransactionReceipt({ hash: h });
    }
    p = 0;
    for (const pk of [KEYS.partyA, KEYS.partyB, KEYS.partyC]) {
      const w = wallet(pk as `0x${string}`);
      const tid = [tokenIds.A, tokenIds.B, tokenIds.C][p];
      const label = keccak256(toHex(`party-${'ABC'[p]}`));
      const h = await w.writeContract({
        address: dep.TripartiteGame as `0x${string}`,
        abi: TRIPARTITE_GAME_ABI,
        functionName: 'registerParty',
        args: [GAME_ID, tid, label, parseEther('100'), parseEther('50'), parseEther('75')],
        chain, account: w.account!,
      });
      await pc.waitForTransactionReceipt({ hash: h });
      p++;
    }
  }, 120_000);

  it('all three parties consume within their per-epoch budget — fair', async () => {
    const epoch = 1n;
    let p = 0;
    for (const pk of [KEYS.partyA, KEYS.partyB, KEYS.partyC]) {
      const w = wallet(pk as `0x${string}`);
      const tid = [tokenIds.A, tokenIds.B, tokenIds.C][p++];
      for (const [resource, amt] of [
        [TripartiteResource.Compute,   parseEther('40')],
        [TripartiteResource.Storage,   parseEther('20')],
        [TripartiteResource.Bandwidth, parseEther('30')],
      ] as const) {
        const h = await w.writeContract({
          address: dep.TripartiteGame as `0x${string}`,
          abi: TRIPARTITE_GAME_ABI,
          functionName: 'consume',
          args: [GAME_ID, tid, epoch, resource, amt, keccak256(toHex(`op:${resource}`))],
          chain, account: w.account!,
        });
        await pc.waitForTransactionReceipt({ hash: h });
      }
    }
    const fair = await pc.readContract({
      address: dep.TripartiteGame as `0x${string}`,
      abi: TRIPARTITE_GAME_ABI,
      functionName: 'verifyAllocationFair',
      args: [GAME_ID, epoch],
    });
    expect(fair).toBe(true);
  });

  it('overspend is rejected at the contract layer — cap is a hard property', async () => {
    const epoch = 2n;
    const w = wallet(KEYS.partyA);
    // Burn the full compute budget for the epoch.
    {
      const h = await w.writeContract({
        address: dep.TripartiteGame as `0x${string}`,
        abi: TRIPARTITE_GAME_ABI,
        functionName: 'consume',
        args: [GAME_ID, tokenIds.A, epoch, TripartiteResource.Compute,
               parseEther('100'), keccak256(toHex('full'))],
        chain, account: w.account!,
      });
      await pc.waitForTransactionReceipt({ hash: h });
    }
    // Any further compute consume in epoch 2 must revert.
    let reverted = false;
    try {
      await w.writeContract({
        address: dep.TripartiteGame as `0x${string}`,
        abi: TRIPARTITE_GAME_ABI,
        functionName: 'consume',
        args: [GAME_ID, tokenIds.A, epoch, TripartiteResource.Compute,
               1n, keccak256(toHex('over'))],
        chain, account: w.account!,
      });
    } catch {
      reverted = true;
    }
    expect(reverted).toBe(true);
    // Allocation still fair because the contract refused the overspend.
    const fair = await pc.readContract({
      address: dep.TripartiteGame as `0x${string}`,
      abi: TRIPARTITE_GAME_ABI,
      functionName: 'verifyAllocationFair',
      args: [GAME_ID, epoch],
    });
    expect(fair).toBe(true);
  });

  it('an inspector with no special authority can audit the ledger', async () => {
    // The inspector wallet has zero allowance, no role, no stack — but the
    // audit views are public.
    const inspector = wallet(KEYS.inspector);
    const epoch = 1n;
    const fair = await pc.readContract({
      address: dep.TripartiteGame as `0x${string}`,
      abi: TRIPARTITE_GAME_ABI,
      functionName: 'verifyAllocationFair',
      args: [GAME_ID, epoch],
      account: inspector.account!,
    });
    expect(fair).toBe(true);

    const roster = await pc.readContract({
      address: dep.TripartiteGame as `0x${string}`,
      abi: TRIPARTITE_GAME_ABI,
      functionName: 'rosterOf',
      args: [GAME_ID],
    }) as bigint[];
    expect(roster).toContain(tokenIds.A);
    expect(roster).toContain(tokenIds.B);
    expect(roster).toContain(tokenIds.C);
  });
});
