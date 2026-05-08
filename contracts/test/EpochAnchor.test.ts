import { expect } from "chai";
import hre from "hardhat";
import { keccak256, toHex } from "viem";
import { loadFixture } from "@nomicfoundation/hardhat-toolbox-viem/network-helpers";

/**
 * EpochAnchor — "The bridge between worlds — anchoring time itself."
 *
 * In Altered Carbon, the needle is the beam that carries consciousness across
 * vast distances. The EpochAnchor serves a similar role for coherence: it
 * receives anchor commits from the medulla-pow mining network and stores the
 * rolling Synaptic-Field MMR root. Each epoch is a heartbeat of the system —
 * a synchronization point across all chains.
 */
describe("EpochAnchor — Cross-Chain Temporal Anchoring", function () {
  async function deployEpochAnchorFixture() {
    const [owner, bridger, miner, unauthorized] =
      await hre.viem.getWalletClients();

    const epochAnchor = await hre.viem.deployContract("EpochAnchor");
    const publicClient = await hre.viem.getPublicClient();

    return { epochAnchor, owner, bridger, miner, unauthorized, publicClient };
  }

  // Coherence roots — think of them as memory hashes across dimensional layers
  const CROSS_ROOT = keccak256(toHex("cross-root:epoch-1:all-chains-aligned"));
  const EVM_ROOT = keccak256(toHex("evm-root:cortex-state-hash"));
  const IPFS_ROOT = keccak256(toHex("ipfs-root:hippocampus-dag-head"));
  const SLEEVES_ROOT = keccak256(toHex("sleeves-root:all-active-sleeves"));
  const SYNAPTIC_ROOT = keccak256(toHex("synaptic-field:mmr-rolling-root"));

  describe("Bridger Authorization — Who can commit anchors", function () {
    it("should allow owner to authorize a bridger — the needle operator", async function () {
      const { epochAnchor, bridger } = await loadFixture(deployEpochAnchorFixture);

      await epochAnchor.write.setBridger([bridger.account.address, true]);
      expect(await epochAnchor.read.bridgers([bridger.account.address])).to.be.true;
    });

    it("should allow owner to revoke bridger — decommissioning the needle", async function () {
      const { epochAnchor, bridger } = await loadFixture(deployEpochAnchorFixture);

      await epochAnchor.write.setBridger([bridger.account.address, true]);
      await epochAnchor.write.setBridger([bridger.account.address, false]);
      expect(await epochAnchor.read.bridgers([bridger.account.address])).to.be.false;
    });

    it("should reject non-owner from setting bridger — CTAC-only authority", async function () {
      const { epochAnchor, miner, bridger } = await loadFixture(deployEpochAnchorFixture);

      const minerAnchor = await hre.viem.getContractAt("EpochAnchor", epochAnchor.address, {
        client: { wallet: miner },
      });
      await expect(
        minerAnchor.write.setBridger([bridger.account.address, true])
      ).to.be.rejected;
    });
  });

  describe("Anchor Commits — Heartbeats of cross-chain coherence", function () {
    it("should commit an epoch anchor with all coherence roots", async function () {
      const { epochAnchor, bridger } = await loadFixture(deployEpochAnchorFixture);

      await epochAnchor.write.setBridger([bridger.account.address, true]);

      const bridgerAnchor = await hre.viem.getContractAt("EpochAnchor", epochAnchor.address, {
        client: { wallet: bridger },
      });
      await bridgerAnchor.write.commitAnchor([
        1n, CROSS_ROOT, EVM_ROOT, IPFS_ROOT, SLEEVES_ROOT, SYNAPTIC_ROOT, 100n,
      ]);

      const anchor = await epochAnchor.read.byEpoch([1n]);
      expect(anchor[0]).to.equal(CROSS_ROOT); // crossRoot
      expect(anchor[1]).to.equal(EVM_ROOT); // evmRoot
      expect(anchor[2]).to.equal(IPFS_ROOT); // ipfsRoot
      expect(anchor[3]).to.equal(SLEEVES_ROOT); // sleevesRoot
      expect(anchor[4]).to.equal(SYNAPTIC_ROOT); // synapticFieldRoot
      expect(anchor[5]).to.equal(100n); // medullaHeight
    });

    it("should advance the head epoch pointer — time marches forward", async function () {
      const { epochAnchor, bridger } = await loadFixture(deployEpochAnchorFixture);

      await epochAnchor.write.setBridger([bridger.account.address, true]);

      const bridgerAnchor = await hre.viem.getContractAt("EpochAnchor", epochAnchor.address, {
        client: { wallet: bridger },
      });
      await bridgerAnchor.write.commitAnchor([
        1n, CROSS_ROOT, EVM_ROOT, IPFS_ROOT, SLEEVES_ROOT, SYNAPTIC_ROOT, 100n,
      ]);

      expect(await epochAnchor.read.head()).to.equal(1n);
    });

    it("should allow multiple epoch commits in sequence — building the timeline", async function () {
      const { epochAnchor, bridger } = await loadFixture(deployEpochAnchorFixture);

      await epochAnchor.write.setBridger([bridger.account.address, true]);

      const bridgerAnchor = await hre.viem.getContractAt("EpochAnchor", epochAnchor.address, {
        client: { wallet: bridger },
      });

      const root2 = keccak256(toHex("cross-root:epoch-2"));
      const root3 = keccak256(toHex("cross-root:epoch-3"));

      await bridgerAnchor.write.commitAnchor([
        1n, CROSS_ROOT, EVM_ROOT, IPFS_ROOT, SLEEVES_ROOT, SYNAPTIC_ROOT, 100n,
      ]);
      await bridgerAnchor.write.commitAnchor([
        2n, root2, EVM_ROOT, IPFS_ROOT, SLEEVES_ROOT, SYNAPTIC_ROOT, 200n,
      ]);
      await bridgerAnchor.write.commitAnchor([
        3n, root3, EVM_ROOT, IPFS_ROOT, SLEEVES_ROOT, SYNAPTIC_ROOT, 300n,
      ]);

      expect(await epochAnchor.read.head()).to.equal(3n);

      const anchor3 = await epochAnchor.read.byEpoch([3n]);
      expect(anchor3[0]).to.equal(root3);
      expect(anchor3[5]).to.equal(300n);
    });

    it("should reject epoch regression — no time travel allowed", async function () {
      const { epochAnchor, bridger } = await loadFixture(deployEpochAnchorFixture);

      await epochAnchor.write.setBridger([bridger.account.address, true]);

      const bridgerAnchor = await hre.viem.getContractAt("EpochAnchor", epochAnchor.address, {
        client: { wallet: bridger },
      });
      await bridgerAnchor.write.commitAnchor([
        5n, CROSS_ROOT, EVM_ROOT, IPFS_ROOT, SLEEVES_ROOT, SYNAPTIC_ROOT, 500n,
      ]);

      await expect(
        bridgerAnchor.write.commitAnchor([
          3n, CROSS_ROOT, EVM_ROOT, IPFS_ROOT, SLEEVES_ROOT, SYNAPTIC_ROOT, 300n,
        ])
      ).to.be.rejectedWith("epoch regression");
    });

    it("should reject same epoch re-commit — each heartbeat is unique", async function () {
      const { epochAnchor, bridger } = await loadFixture(deployEpochAnchorFixture);

      await epochAnchor.write.setBridger([bridger.account.address, true]);

      const bridgerAnchor = await hre.viem.getContractAt("EpochAnchor", epochAnchor.address, {
        client: { wallet: bridger },
      });
      await bridgerAnchor.write.commitAnchor([
        1n, CROSS_ROOT, EVM_ROOT, IPFS_ROOT, SLEEVES_ROOT, SYNAPTIC_ROOT, 100n,
      ]);

      await expect(
        bridgerAnchor.write.commitAnchor([
          1n, CROSS_ROOT, EVM_ROOT, IPFS_ROOT, SLEEVES_ROOT, SYNAPTIC_ROOT, 100n,
        ])
      ).to.be.rejectedWith("epoch regression");
    });

    it("should reject commit from non-bridger — unauthorized needle transmission", async function () {
      const { epochAnchor, unauthorized } = await loadFixture(deployEpochAnchorFixture);

      const badAnchor = await hre.viem.getContractAt("EpochAnchor", epochAnchor.address, {
        client: { wallet: unauthorized },
      });
      await expect(
        badAnchor.write.commitAnchor([
          1n, CROSS_ROOT, EVM_ROOT, IPFS_ROOT, SLEEVES_ROOT, SYNAPTIC_ROOT, 100n,
        ])
      ).to.be.rejectedWith("not bridger");
    });

    it("should record timestamp — when the anchor was committed to the chain", async function () {
      const { epochAnchor, bridger } = await loadFixture(deployEpochAnchorFixture);

      await epochAnchor.write.setBridger([bridger.account.address, true]);

      const bridgerAnchor = await hre.viem.getContractAt("EpochAnchor", epochAnchor.address, {
        client: { wallet: bridger },
      });
      await bridgerAnchor.write.commitAnchor([
        1n, CROSS_ROOT, EVM_ROOT, IPFS_ROOT, SLEEVES_ROOT, SYNAPTIC_ROOT, 100n,
      ]);

      const anchor = await epochAnchor.read.byEpoch([1n]);
      expect(anchor[6]).to.be.greaterThan(0n); // ts > 0
    });
  });

  describe("Epoch State Queries — Reading the timeline", function () {
    it("should return zero-state for uncommitted epochs", async function () {
      const { epochAnchor } = await loadFixture(deployEpochAnchorFixture);

      const anchor = await epochAnchor.read.byEpoch([999n]);
      expect(anchor[0]).to.equal("0x0000000000000000000000000000000000000000000000000000000000000000");
      expect(anchor[5]).to.equal(0n);
    });

    it("should start with head at 0 — no epochs committed yet", async function () {
      const { epochAnchor } = await loadFixture(deployEpochAnchorFixture);
      expect(await epochAnchor.read.head()).to.equal(0n);
    });
  });

  describe("Medulla-Height Continuity — No anchors from forked or rewound chains", function () {
    it("should reject an anchor whose medullaHeight is not strictly greater", async function () {
      const { epochAnchor, bridger } = await loadFixture(deployEpochAnchorFixture);
      await epochAnchor.write.setBridger([bridger.account.address, true]);
      const ba = await hre.viem.getContractAt("EpochAnchor", epochAnchor.address, {
        client: { wallet: bridger },
      });
      await ba.write.commitAnchor([
        1n, CROSS_ROOT, EVM_ROOT, IPFS_ROOT, SLEEVES_ROOT, SYNAPTIC_ROOT, 100n,
      ]);
      // Epoch advances but medullaHeight stays the same — looks like a
      // bridger replaying a stale PoW tip.
      await expect(
        ba.write.commitAnchor([
          2n, CROSS_ROOT, EVM_ROOT, IPFS_ROOT, SLEEVES_ROOT, SYNAPTIC_ROOT, 100n,
        ]),
      ).to.be.rejectedWith("medulla height regression");
    });

    it("should track lastMedullaHeight across commits", async function () {
      const { epochAnchor, bridger } = await loadFixture(deployEpochAnchorFixture);
      await epochAnchor.write.setBridger([bridger.account.address, true]);
      const ba = await hre.viem.getContractAt("EpochAnchor", epochAnchor.address, {
        client: { wallet: bridger },
      });
      await ba.write.commitAnchor([
        1n, CROSS_ROOT, EVM_ROOT, IPFS_ROOT, SLEEVES_ROOT, SYNAPTIC_ROOT, 100n,
      ]);
      expect(await epochAnchor.read.lastMedullaHeight()).to.equal(100n);
      await ba.write.commitAnchor([
        2n, CROSS_ROOT, EVM_ROOT, IPFS_ROOT, SLEEVES_ROOT, SYNAPTIC_ROOT, 137n,
      ]);
      expect(await epochAnchor.read.lastMedullaHeight()).to.equal(137n);
    });
  });

  describe("Synaptic-Root Continuity — Cross-epoch witness consistency", function () {
    async function commitChain() {
      const ctx = await loadFixture(deployEpochAnchorFixture);
      await ctx.epochAnchor.write.setBridger([ctx.bridger.account.address, true]);
      const ba = await hre.viem.getContractAt("EpochAnchor", ctx.epochAnchor.address, {
        client: { wallet: ctx.bridger },
      });
      await ba.write.commitAnchor([
        1n, CROSS_ROOT, EVM_ROOT, IPFS_ROOT, SLEEVES_ROOT,
        keccak256(toHex("synaptic:1")), 100n,
      ]);
      await ba.write.commitAnchor([
        2n, keccak256(toHex("cross:2")), EVM_ROOT, IPFS_ROOT, SLEEVES_ROOT,
        keccak256(toHex("synaptic:2")), 200n,
      ]);
      return ctx;
    }

    it("verifyContinuity returns (true, true) when both anchors exist and roots advanced", async function () {
      const { epochAnchor } = await commitChain();
      const [exists, extended] = await epochAnchor.read.verifyContinuity([2n]);
      expect(exists).to.be.true;
      expect(extended).to.be.true;
    });

    it("verifyContinuity returns (false, false) for the genesis epoch", async function () {
      const { epochAnchor } = await commitChain();
      const [exists, extended] = await epochAnchor.read.verifyContinuity([0n]);
      expect(exists).to.be.false;
      expect(extended).to.be.false;
    });

    it("verifyContinuity returns (false, false) for an epoch with no prior anchor", async function () {
      const { epochAnchor, bridger } = await loadFixture(deployEpochAnchorFixture);
      await epochAnchor.write.setBridger([bridger.account.address, true]);
      const ba = await hre.viem.getContractAt("EpochAnchor", epochAnchor.address, {
        client: { wallet: bridger },
      });
      // Skip epoch 1: commit straight at epoch 5
      await ba.write.commitAnchor([
        5n, CROSS_ROOT, EVM_ROOT, IPFS_ROOT, SLEEVES_ROOT, SYNAPTIC_ROOT, 100n,
      ]);
      const [exists, extended] = await epochAnchor.read.verifyContinuity([5n]);
      expect(exists).to.be.false;
      expect(extended).to.be.false;
    });
  });

  describe("Shard Inclusion Proofs — Inspectors prove a specific event was anchored", function () {
    // 4-leaf evm shard:  L0 L1 L2 L3
    //                    \/    \/
    //                    H01    H23
    //                      \    /
    //                        ROOT
    const L0 = keccak256(toHex("tx:0xdead"));
    const L1 = keccak256(toHex("tx:0xbeef"));
    const L2 = keccak256(toHex("tx:0xcafe"));
    const L3 = keccak256(toHex("tx:0xface"));

    function pair(left: `0x${string}`, right: `0x${string}`): `0x${string}` {
      // Mirrors `keccak256(abi.encodePacked(left, right))` — viem keccak256
      // accepts a concatenated hex string.
      return keccak256(("0x" + left.slice(2) + right.slice(2)) as `0x${string}`);
    }

    async function deployWithShard() {
      const ctx = await loadFixture(deployEpochAnchorFixture);
      await ctx.epochAnchor.write.setBridger([ctx.bridger.account.address, true]);
      const ba = await hre.viem.getContractAt("EpochAnchor", ctx.epochAnchor.address, {
        client: { wallet: ctx.bridger },
      });
      const H01 = pair(L0, L1);
      const H23 = pair(L2, L3);
      const evmRoot = pair(H01, H23);
      await ba.write.commitAnchor([
        1n, CROSS_ROOT, evmRoot, IPFS_ROOT, SLEEVES_ROOT, SYNAPTIC_ROOT, 100n,
      ]);
      return { ...ctx, evmRoot, H01, H23 };
    }

    it("verifyShardInclusion accepts a valid Merkle proof for L0", async function () {
      const { epochAnchor, H23 } = await deployWithShard();
      // L0 is at index 0: siblings = [L1, H23], indexBits = 0b00
      const ok = await epochAnchor.read.verifyShardInclusion([1n, 0, L0, [L1, H23], 0n]);
      expect(ok).to.be.true;
    });

    it("verifyShardInclusion accepts a valid Merkle proof for L3 (right-right path)", async function () {
      const { epochAnchor, H01 } = await deployWithShard();
      // L3 is at index 3: siblings = [L2, H01], indexBits = 0b11 = 3
      const ok = await epochAnchor.read.verifyShardInclusion([1n, 0, L3, [L2, H01], 3n]);
      expect(ok).to.be.true;
    });

    it("verifyShardInclusion rejects a forged proof", async function () {
      const { epochAnchor, H23 } = await deployWithShard();
      const forged = keccak256(toHex("tx:0xnope"));
      const ok = await epochAnchor.read.verifyShardInclusion([1n, 0, forged, [L1, H23], 0n]);
      expect(ok).to.be.false;
    });

    it("verifyShardInclusion returns false for an unknown epoch", async function () {
      const { epochAnchor } = await deployWithShard();
      const ok = await epochAnchor.read.verifyShardInclusion([999n, 0, L0, [L1, L2], 0n]);
      expect(ok).to.be.false;
    });

    it("verifyShardInclusion returns false for a bad shard id", async function () {
      const { epochAnchor } = await deployWithShard();
      const ok = await epochAnchor.read.verifyShardInclusion([1n, 9, L0, [L1, L2], 0n]);
      expect(ok).to.be.false;
    });
  });
});
