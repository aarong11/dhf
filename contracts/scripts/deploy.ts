// Deploys the full ECCA contract suite to cortex-evm and writes deployments.json.
// Run: pnpm --filter @ecca/contracts run deploy:local

import hre from 'hardhat';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { defineChain } from 'viem';
import { createPublicClient, createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { getContract } from 'viem';

const DEPLOY_DIR = join(__dirname, '..', 'deployments');

const cortexChain = defineChain({
  id: Number(process.env.CORTEX_CHAIN_ID ?? 131072),
  name: 'Cortex EVM',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: [process.env.CORTEX_RPC ?? 'http://cortex-evm:8545'] },
  },
});

const PK = (process.env.OPERATOR_PRIVATE_KEY ?? '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80') as `0x${string}`;

async function main() {
  const account = privateKeyToAccount(PK);
  const transport = http(process.env.CORTEX_RPC ?? 'http://cortex-evm:8545');

  const publicClient = createPublicClient({ chain: cortexChain, transport });
  const walletClient = createWalletClient({ account, chain: cortexChain, transport });

  console.log(`[deployer] ${account.address}`);

  // In --dev mode, geth has a pre-funded dev account. Fund our deployer from it.
  const balance = await publicClient.getBalance({ address: account.address });
  if (balance === 0n) {
    console.log('[deployer] Zero balance — funding from geth dev account...');
    const rpcUrl = process.env.CORTEX_RPC ?? 'http://cortex-evm:8545';
    // Get the dev account (first in eth_accounts)
    const accts = await publicClient.request({ method: 'eth_accounts' as any }) as string[];
    if (accts.length === 0) throw new Error('No dev accounts found on geth');
    const devAccount = accts[0];
    console.log(`[deployer] Dev account: ${devAccount}`);
    // Send 10000 ETH from dev account to deployer
    const txHash = await publicClient.request({
      method: 'eth_sendTransaction' as any,
      params: [{
        from: devAccount as `0x${string}`,
        to: account.address as `0x${string}`,
        value: ('0x' + (10000n * 10n ** 18n).toString(16)) as `0x${string}`,
      }],
    });
    console.log(`[deployer] Funding tx: ${txHash}`);
    await publicClient.waitForTransactionReceipt({ hash: txHash as `0x${string}` });
    const newBalance = await publicClient.getBalance({ address: account.address });
    console.log(`[deployer] New balance: ${newBalance}`);
  } else {
    console.log(`[deployer] Balance: ${balance}`);
  }

  // Helper to deploy a contract by name
  async function deploy(name: string, args: any[] = []) {
    const artifact = await hre.artifacts.readArtifact(name);
    const hash = await walletClient.deployContract({
      abi: artifact.abi,
      bytecode: artifact.bytecode as `0x${string}`,
      args,
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (!receipt.contractAddress) throw new Error(`Failed to deploy ${name}`);
    console.log(`${name}: ${receipt.contractAddress}`);
    return getContract({
      address: receipt.contractAddress,
      abi: artifact.abi,
      client: { public: publicClient, wallet: walletClient },
    });
  }

  // 1. StackIdentity
  const stackIdentity = await deploy('StackIdentity');

  // 2. Five bandwidth tokens
  const compute = await deploy('ComputeToken', [stackIdentity.address]);
  const memT    = await deploy('MemoryToken',  [stackIdentity.address]);
  const syncT   = await deploy('SyncToken',    [stackIdentity.address]);
  const routing = await deploy('RoutingToken', [stackIdentity.address]);
  const residue = await deploy('ResidueToken', [stackIdentity.address]);

  // 3. Treasury (owns mint authority for tokens)
  const treasury = await deploy('QuellistTreasury', [
    compute.address, memT.address, syncT.address, routing.address, residue.address,
  ]);

  // Hand minter rights to treasury for each token
  for (const t of [compute, memT, syncT, routing, residue]) {
    const hash = await (t as any).write.setMinter([treasury.address]);
    await publicClient.waitForTransactionReceipt({ hash });
  }

  // 4. Routers + registries
  const router = await deploy('NeedlecastRouter', [stackIdentity.address]);
  {
    const hash = await (stackIdentity as any).write.setRouter([router.address, true]);
    await publicClient.waitForTransactionReceipt({ hash });
  }

  const sleeveReg = await deploy('SleeveRegistry', [stackIdentity.address]);

  const residueReg = await deploy('ResidueRegistry', [residue.address, stackIdentity.address]);
  {
    const hash = await (residue as any).write.setMinter([residueReg.address]);
    await publicClient.waitForTransactionReceipt({ hash });
  }

  const epochAnchor = await deploy('EpochAnchor');

  // 5. TripartiteGame — provably-fair multilateral resource allocation.
  //    Wires compute / memory / routing tokens into a single referee that
  //    enforces per-party, per-epoch caps for cooperative-game scenarios.
  const tripartite = await deploy('TripartiteGame', [
    compute.address, memT.address, routing.address, stackIdentity.address,
  ]);

  // Persist for off-chain services
  mkdirSync(DEPLOY_DIR, { recursive: true });
  const out = {
    chainId: Number(process.env.CORTEX_CHAIN_ID ?? 131072),
    deployer: account.address,
    StackIdentity: stackIdentity.address,
    ComputeToken: compute.address,
    MemoryToken: memT.address,
    SyncToken: syncT.address,
    RoutingToken: routing.address,
    ResidueToken: residue.address,
    QuellistTreasury: treasury.address,
    NeedlecastRouter: router.address,
    SleeveRegistry: sleeveReg.address,
    ResidueRegistry: residueReg.address,
    EpochAnchor: epochAnchor.address,
    TripartiteGame: tripartite.address,
  };
  writeFileSync(join(DEPLOY_DIR, 'cortex.json'), JSON.stringify(out, null, 2));
  console.log(`\nWrote ${join(DEPLOY_DIR, 'cortex.json')}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
