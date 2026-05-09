import { expect } from 'chai';
import hre from 'hardhat';
import { loadFixture } from '@nomicfoundation/hardhat-toolbox-viem/network-helpers';
import { getAddress, parseEther, keccak256, toHex } from 'viem';

async function deploySwapFixture() {
  const [owner, guardian1, guardian2, guardian3] = await hre.viem.getWalletClients();
  const publicClient = await hre.viem.getPublicClient();

  // Deploy StackIdentity for token ownership
  const stackIdentity = await hre.viem.deployContract('StackIdentity');

  // Deploy two BandwidthTokens: residue + routing
  const residueToken = await hre.viem.deployContract('ResidueToken', [stackIdentity.address]);
  const routingToken = await hre.viem.deployContract('RoutingToken', [stackIdentity.address]);

  // Deploy swap
  const swap = await hre.viem.deployContract('ResidueToRoutingSwap', [
    residueToken.address,
    routingToken.address,
  ]);

  // Grant swap minter role on routing token
  await routingToken.write.setMinter([swap.address]);
  // Grant swap spend-authorization on residueToken for the agent stack
  // (done after minting the stack below)

  // Mint a stack for testing (pubkey is dynamic bytes)
  const cpv = [200000n, 200000n, 200000n, 200000n, 200000n] as const;
  await stackIdentity.write.mintStack([
    '0xaabbccddaabbccddaabbccddaabbccddaabbccddaabbccddaabbccddaabbccdd',
    [...cpv],
    50000n,
    100000n,
  ]);
  const agentTokenId = 1n;

  // Seed residue tokens to the agent
  await residueToken.write.mint([agentTokenId, parseEther('1000'), keccak256(toHex('seed'))]);

  // Authorize the swap contract as a spender on residueToken for this stack
  await residueToken.write.authorizeSleeve([agentTokenId, swap.address, true]);

  return { swap, residueToken, routingToken, stackIdentity, owner, guardian1, guardian2, guardian3, publicClient, agentTokenId };
}

describe('ResidueToRoutingSwap', function () {
  it('quotes correctly at epoch of resolution', async function () {
    const { swap } = await loadFixture(deploySwapFixture);
    // At epoch 10, resolved at epoch 10 → elapsed=0 → full baseRate (0.5)
    const out = await swap.read.quote([parseEther('100'), 10n, 10n]);
    expect(out).to.equal(parseEther('50')); // 100 * 0.5 = 50
  });

  it('decays quote with elapsed epochs', async function () {
    const { swap } = await loadFixture(deploySwapFixture);
    // resolved at epoch 10, converted at epoch 20 → 10 epochs elapsed
    const fresh = await swap.read.quote([parseEther('100'), 10n, 10n]);
    const stale = await swap.read.quote([parseEther('100'), 10n, 20n]);
    expect(stale).to.be.lessThan(fresh);
    expect(stale).to.be.greaterThan(0n);
  });

  it('respects floor rate', async function () {
    const { swap } = await loadFixture(deploySwapFixture);
    // Very stale: 200 epochs elapsed
    const out = await swap.read.quote([parseEther('100'), 10n, 210n]);
    // floor = 10% of base = 0.1 × 100 = 10
    expect(out).to.equal(parseEther('10'));
  });

  it('performs a swap and emits event', async function () {
    const { swap, residueToken, routingToken, agentTokenId, publicClient } = await loadFixture(deploySwapFixture);
    const residueId = keccak256(toHex('res-001'));

    const balBefore = await routingToken.read.balanceOfStack([agentTokenId]);
    expect(balBefore).to.equal(0n);

    const hash = await swap.write.swap([agentTokenId, parseEther('100'), 10n, residueId, 10n]);
    await publicClient.waitForTransactionReceipt({ hash });

    const balAfter = await routingToken.read.balanceOfStack([agentTokenId]);
    expect(balAfter).to.equal(parseEther('50')); // 100 * 0.5
  });

  it('enforces per-agent epoch cap', async function () {
    const { swap, agentTokenId } = await loadFixture(deploySwapFixture);
    const residueId = keccak256(toHex('res-big'));

    // Default cap is 50 RTE per agent per epoch.  Swapping 200 RES @ 0.5 = 100 RTE → should fail
    await expect(
      swap.write.swap([agentTokenId, parseEther('200'), 10n, residueId, 10n])
    ).to.be.rejectedWith('agent epoch cap');
  });

  it('reverts when paused', async function () {
    const { swap, agentTokenId } = await loadFixture(deploySwapFixture);
    await swap.write.setPaused([true]);

    await expect(
      swap.write.swap([agentTokenId, parseEther('10'), 10n, keccak256(toHex('x')), 10n])
    ).to.be.rejectedWith('swap paused');
  });

  it('allows oracle to pause', async function () {
    const { swap, guardian1 } = await loadFixture(deploySwapFixture);
    await swap.write.setRouteOracle([guardian1.account.address]);

    // Oracle (guardian1) calls setPaused
    const swapAsOracle = await hre.viem.getContractAt('ResidueToRoutingSwap', swap.address, { client: { wallet: guardian1 } });
    await swapAsOracle.write.setPaused([true]);

    const p = await swap.read.paused();
    expect(p).to.be.true;
  });
});
