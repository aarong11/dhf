import { expect } from 'chai';
import hre from 'hardhat';
import { loadFixture } from '@nomicfoundation/hardhat-toolbox-viem/network-helpers';
import { getAddress, parseEther, keccak256, toHex } from 'viem';

async function deployOracleFixture() {
  const [owner, guardian1, guardian2, guardian3, outsider] = await hre.viem.getWalletClients();
  const publicClient = await hre.viem.getPublicClient();

  // Deploy StackIdentity + tokens for swap
  const stackIdentity = await hre.viem.deployContract('StackIdentity');
  const residueToken  = await hre.viem.deployContract('ResidueToken', [stackIdentity.address]);
  const routingToken  = await hre.viem.deployContract('RoutingToken', [stackIdentity.address]);
  const swap          = await hre.viem.deployContract('ResidueToRoutingSwap', [residueToken.address, routingToken.address]);

  // Deploy oracle (2-of-3 guardians)
  const guardianAddrs = [
    guardian1.account.address,
    guardian2.account.address,
    guardian3.account.address,
  ];
  const oracle = await hre.viem.deployContract('RouteOracle', [
    swap.address,
    guardianAddrs,
    2n, // 2-of-3 threshold for resume
  ]);

  // Wire swap ← oracle
  await swap.write.setRouteOracle([oracle.address]);

  // Mint an agent stack (pubkey is dynamic bytes)
  const cpv = [200000n, 200000n, 200000n, 200000n, 200000n] as const;
  await stackIdentity.write.mintStack([
    '0xaabbccddaabbccddaabbccddaabbccddaabbccddaabbccddaabbccddaabbccdd',
    [...cpv],
    50000n,
    100000n,
  ]);
  const agentTokenId = 1n;

  return { oracle, swap, stackIdentity, owner, guardian1, guardian2, guardian3, outsider, publicClient, agentTokenId };
}

describe('RouteOracle', function () {
  describe('emergency pause', function () {
    it('allows a single guardian to pause an agent', async function () {
      const { oracle, guardian1, agentTokenId } = await loadFixture(deployOracleFixture);
      const oracleAsG1 = await hre.viem.getContractAt('RouteOracle', oracle.address, { client: { wallet: guardian1 } });

      await oracleAsG1.write.emergencyPause([agentTokenId, 'suspicious hijack']);
      const paused = await oracle.read.agentPaused([agentTokenId]);
      expect(paused).to.be.true;
    });

    it('rejects non-guardian callers', async function () {
      const { oracle, outsider, agentTokenId } = await loadFixture(deployOracleFixture);
      const oracleAsOutsider = await hre.viem.getContractAt('RouteOracle', oracle.address, { client: { wallet: outsider } });

      await expect(
        oracleAsOutsider.write.emergencyPause([agentTokenId, 'attempt'])
      ).to.be.rejectedWith('not guardian');
    });
  });

  describe('resume (M-of-N)', function () {
    it('requires threshold approvals to resume', async function () {
      const { oracle, guardian1, guardian2, agentTokenId, publicClient } = await loadFixture(deployOracleFixture);

      // First pause the agent
      const oracleAsG1 = await hre.viem.getContractAt('RouteOracle', oracle.address, { client: { wallet: guardian1 } });
      await oracleAsG1.write.emergencyPause([agentTokenId, 'test pause']);
      expect(await oracle.read.agentPaused([agentTokenId])).to.be.true;

      // Guardian 1 approves resume
      await oracleAsG1.write.approveResume([agentTokenId]);

      // Not enough yet — 1 of 2 threshold
      await expect(
        oracleAsG1.write.executeResume([agentTokenId])
      ).to.be.rejectedWith('below threshold');

      // Guardian 2 approves resume
      const oracleAsG2 = await hre.viem.getContractAt('RouteOracle', oracle.address, { client: { wallet: guardian2 } });
      await oracleAsG2.write.approveResume([agentTokenId]);

      // Now execute (2-of-3 reached)
      const hash = await oracleAsG1.write.executeResume([agentTokenId]);
      await publicClient.waitForTransactionReceipt({ hash });

      expect(await oracle.read.agentPaused([agentTokenId])).to.be.false;
    });

    it('prevents double-execution', async function () {
      const { oracle, guardian1, guardian2, agentTokenId } = await loadFixture(deployOracleFixture);
      const oracleAsG1 = await hre.viem.getContractAt('RouteOracle', oracle.address, { client: { wallet: guardian1 } });
      const oracleAsG2 = await hre.viem.getContractAt('RouteOracle', oracle.address, { client: { wallet: guardian2 } });

      await oracleAsG1.write.emergencyPause([agentTokenId, 'test']);
      await oracleAsG1.write.approveResume([agentTokenId]);
      await oracleAsG2.write.approveResume([agentTokenId]);
      await oracleAsG1.write.executeResume([agentTokenId]);

      await expect(
        oracleAsG1.write.executeResume([agentTokenId])
      ).to.be.rejectedWith('already executed');
    });
  });

  describe('auto-pause heuristics', function () {
    it('auto-pauses on residue rate spike', async function () {
      const { oracle, agentTokenId } = await loadFixture(deployOracleFixture);

      // Default threshold: 5 residues in 10 epochs
      for (let i = 0; i < 5; i++) {
        await oracle.write.observeResidue([agentTokenId, 100n]);
      }

      const paused = await oracle.read.agentPaused([agentTokenId]);
      expect(paused).to.be.true;
    });

    it('auto-pauses on swap burst', async function () {
      const { oracle, agentTokenId } = await loadFixture(deployOracleFixture);

      // Burst of 100 ether in one epoch
      await oracle.write.observeSwap([agentTokenId, parseEther('100'), 50n]);

      const paused = await oracle.read.agentPaused([agentTokenId]);
      expect(paused).to.be.true;
    });

    it('resets residue counter after observation window', async function () {
      const { oracle, agentTokenId } = await loadFixture(deployOracleFixture);

      // 3 residues at epoch 10
      for (let i = 0; i < 3; i++) {
        await oracle.write.observeResidue([agentTokenId, 10n]);
      }
      expect(await oracle.read.agentPaused([agentTokenId])).to.be.false;

      // 2 more at epoch 25 (>10 epochs later → counter resets, total now 2 not 5)
      await oracle.write.observeResidue([agentTokenId, 25n]);
      await oracle.write.observeResidue([agentTokenId, 25n]);
      expect(await oracle.read.agentPaused([agentTokenId])).to.be.false;
    });
  });

  describe('swap halt', function () {
    it('guardian can halt the swap via oracle', async function () {
      const { oracle, swap, guardian1 } = await loadFixture(deployOracleFixture);
      const oracleAsG1 = await hre.viem.getContractAt('RouteOracle', oracle.address, { client: { wallet: guardian1 } });

      await oracleAsG1.write.haltSwap();
      const paused = await swap.read.paused();
      expect(paused).to.be.true;
    });
  });

  describe('guardian management', function () {
    it('owner can change guardian set', async function () {
      const { oracle, outsider } = await loadFixture(deployOracleFixture);
      await oracle.write.setGuardians([[outsider.account.address], 1n]);

      const count = await oracle.read.guardianCount();
      expect(count).to.equal(1n);
    });
  });
});
