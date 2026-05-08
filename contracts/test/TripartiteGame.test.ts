import { expect } from "chai";
import hre from "hardhat";
import { toHex, keccak256, parseEther } from "viem";
import { loadFixture } from "@nomicfoundation/hardhat-toolbox-viem/network-helpers";

/**
 * TripartiteGame — "Three eyes on the table — none can blink first."
 *
 * In the world of Altered Carbon, treaties between Methuselah factions are
 * unenforceable without a notary that cannot be bribed. The TripartiteGame
 * contract is that notary: it gives N parties a hard, observable cap on the
 * three resources that matter — compute, storage, bandwidth — and lets any
 * inspector re-derive whether anyone cheated, from on-chain state alone.
 *
 * The classical motivating scenario is a multilateral weapons-inspection
 * regime: three signatories each get a fixed budget of inspection-cycles
 * (compute), evidence-archival (storage), and inter-party transmission
 * (bandwidth). The treaty holds iff `verifyAllocationFair(epoch)` is true.
 */
describe("TripartiteGame — Provably-Fair Multilateral Resource Allocation", function () {
  const GAME_ID = keccak256(toHex("treaty:demilitarised-zone-7:2384"));
  const REASON_INSPECT = keccak256(toHex("inspect.cycle"));
  const REASON_ARCHIVE = keccak256(toHex("archive.evidence"));
  const REASON_RELAY = keccak256(toHex("relay.signal"));

  // Resource enum mirrors TripartiteGame.RES_*
  const COMPUTE = 0;
  const STORAGE = 1;
  const BANDWIDTH = 2;

  async function deployTripartiteFixture() {
    const [referee, partyA, partyB, partyC, inspector, intruder] =
      await hre.viem.getWalletClients();

    // 1. StackIdentity, then the three resource-bearing tokens we care about.
    const stack = await hre.viem.deployContract("StackIdentity");
    const compute = await hre.viem.deployContract("ComputeToken", [stack.address]);
    const memory = await hre.viem.deployContract("MemoryToken", [stack.address]);
    const routing = await hre.viem.deployContract("RoutingToken", [stack.address]);

    // 2. The referee deploys the game contract.
    const game = await hre.viem.deployContract("TripartiteGame", [
      compute.address, memory.address, routing.address, stack.address,
    ]);

    // Grant the game permission to burn (= spend) tokens by routing minter
    // through it would be wrong; instead we keep the referee as minter and
    // stack-owners authorise the game contract as a sleeve on each token.

    // 3. Each party mints a stack identity (NFT).
    const cpv: [bigint, bigint, bigint, bigint, bigint] =
      [1_000_000n, 1_000_000n, 1_000_000n, 1_000_000n, 1_000_000n];
    const mintStack = async (wallet: typeof partyA, fingerprint: number) => {
      const sid = await hre.viem.getContractAt("StackIdentity", stack.address, {
        client: { wallet },
      });
      await sid.write.mintStack([
        toHex(new Uint8Array(32).fill(fingerprint)), cpv, 100_000n, 200_000n,
      ]);
    };
    await mintStack(partyA, 0xAA);
    await mintStack(partyB, 0xBB);
    await mintStack(partyC, 0xCC);
    // tokenIds: 1, 2, 3

    // 4. Pre-fund each party with bandwidth and authorise the game contract
    //    to spend on their behalf.
    const fund = async (
      tokenId: bigint, owner: typeof partyA,
      computeAmt: bigint, storageAmt: bigint, bandwidthAmt: bigint,
    ) => {
      await compute.write.mint([tokenId, computeAmt, REASON_INSPECT]);
      await memory.write.mint([tokenId, storageAmt, REASON_ARCHIVE]);
      await routing.write.mint([tokenId, bandwidthAmt, REASON_RELAY]);
      const ownerCompute = await hre.viem.getContractAt("ComputeToken", compute.address, {
        client: { wallet: owner },
      });
      const ownerMemory = await hre.viem.getContractAt("MemoryToken", memory.address, {
        client: { wallet: owner },
      });
      const ownerRouting = await hre.viem.getContractAt("RoutingToken", routing.address, {
        client: { wallet: owner },
      });
      await ownerCompute.write.authorizeSleeve([tokenId, game.address, true]);
      await ownerMemory .write.authorizeSleeve([tokenId, game.address, true]);
      await ownerRouting.write.authorizeSleeve([tokenId, game.address, true]);
    };
    // Generous funding so per-epoch caps (not balance) are the binding constraint.
    await fund(1n, partyA, parseEther("10000"), parseEther("10000"), parseEther("10000"));
    await fund(2n, partyB, parseEther("10000"), parseEther("10000"), parseEther("10000"));
    await fund(3n, partyC, parseEther("10000"), parseEther("10000"), parseEther("10000"));

    const publicClient = await hre.viem.getPublicClient();
    return { game, stack, compute, memory, routing,
             referee, partyA, partyB, partyC, inspector, intruder, publicClient };
  }

  // ─── Game lifecycle ────────────────────────────────────────────────────

  describe("Game Lifecycle — Treaty opening and party registration", function () {
    it("should let the referee open a new game", async function () {
      const { game } = await loadFixture(deployTripartiteFixture);
      await game.write.openGame([GAME_ID]);
      expect(await game.read.games([GAME_ID])).to.be.true;
    });

    it("should reject double-open of the same game", async function () {
      const { game } = await loadFixture(deployTripartiteFixture);
      await game.write.openGame([GAME_ID]);
      await expect(game.write.openGame([GAME_ID])).to.be.rejectedWith("game exists");
    });

    it("should reject openGame from non-referee — no rogue notary", async function () {
      const { game, intruder } = await loadFixture(deployTripartiteFixture);
      const rogue = await hre.viem.getContractAt("TripartiteGame", game.address, {
        client: { wallet: intruder },
      });
      await expect(rogue.write.openGame([GAME_ID])).to.be.rejected;
    });

    it("should let each party register itself with a per-epoch budget", async function () {
      const { game, partyA } = await loadFixture(deployTripartiteFixture);
      await game.write.openGame([GAME_ID]);
      const aGame = await hre.viem.getContractAt("TripartiteGame", game.address, {
        client: { wallet: partyA },
      });
      await aGame.write.registerParty([
        GAME_ID, 1n, keccak256(toHex("party-A")),
        parseEther("100"), parseEther("50"), parseEther("75"),
      ]);
      const [c, s, b] = await game.read.budgetOf([GAME_ID, 1n]);
      expect(c).to.equal(parseEther("100"));
      expect(s).to.equal(parseEther("50"));
      expect(b).to.equal(parseEther("75"));
    });

    it("should reject registration by non-stack-owner — only the bearer", async function () {
      const { game, partyA, partyB } = await loadFixture(deployTripartiteFixture);
      await game.write.openGame([GAME_ID]);
      // partyB tries to register stack 1 (owned by partyA)
      const bGame = await hre.viem.getContractAt("TripartiteGame", game.address, {
        client: { wallet: partyB },
      });
      await expect(
        bGame.write.registerParty([
          GAME_ID, 1n, keccak256(toHex("imposter")),
          parseEther("1"), parseEther("1"), parseEther("1"),
        ]),
      ).to.be.rejectedWith("not stack owner");
    });

    it("should reject double-registration of the same party", async function () {
      const { game, partyA } = await loadFixture(deployTripartiteFixture);
      await game.write.openGame([GAME_ID]);
      const aGame = await hre.viem.getContractAt("TripartiteGame", game.address, {
        client: { wallet: partyA },
      });
      const label = keccak256(toHex("party-A"));
      await aGame.write.registerParty([GAME_ID, 1n, label,
        parseEther("100"), parseEther("50"), parseEther("75")]);
      await expect(
        aGame.write.registerParty([GAME_ID, 1n, label,
          parseEther("999"), parseEther("999"), parseEther("999")]),
      ).to.be.rejectedWith("already registered");
    });

    it("should expose the full party roster to inspectors", async function () {
      const { game, partyA, partyB, partyC } = await loadFixture(deployTripartiteFixture);
      await game.write.openGame([GAME_ID]);
      for (const [w, id, name] of [[partyA, 1n, "A"], [partyB, 2n, "B"], [partyC, 3n, "C"]] as const) {
        const w_ = await hre.viem.getContractAt("TripartiteGame", game.address, { client: { wallet: w } });
        await w_.write.registerParty([GAME_ID, id, keccak256(toHex(name)),
          parseEther("100"), parseEther("100"), parseEther("100")]);
      }
      const roster = await game.read.rosterOf([GAME_ID]);
      expect(roster.length).to.equal(3);
      expect(roster[0]).to.equal(1n);
      expect(roster[1]).to.equal(2n);
      expect(roster[2]).to.equal(3n);
    });
  });

  // ─── Spending ──────────────────────────────────────────────────────────

  async function openWithThreeParties() {
    const ctx = await loadFixture(deployTripartiteFixture);
    await ctx.game.write.openGame([GAME_ID]);
    for (const [w, id, name] of [
      [ctx.partyA, 1n, "A"], [ctx.partyB, 2n, "B"], [ctx.partyC, 3n, "C"],
    ] as const) {
      const w_ = await hre.viem.getContractAt("TripartiteGame", ctx.game.address, { client: { wallet: w } });
      await w_.write.registerParty([GAME_ID, id, keccak256(toHex(name)),
        parseEther("100"), parseEther("50"), parseEther("75")]);
    }
    return ctx;
  }

  describe("Resource Consumption — Per-epoch hard caps", function () {
    it("should let a registered party consume compute within its budget", async function () {
      const { game, partyA, compute } = await openWithThreeParties();
      const aGame = await hre.viem.getContractAt("TripartiteGame", game.address, { client: { wallet: partyA } });
      await aGame.write.consume([GAME_ID, 1n, 1n, COMPUTE, parseEther("30"), REASON_INSPECT]);
      // consumed mapping order is (gameId, epoch, tokenId, resource)
      expect(await game.read.consumed([GAME_ID, 1n, 1n, COMPUTE]))
        .to.equal(parseEther("30"));
      // Underlying ComputeToken was actually burned:
      expect(await compute.read.balanceOfStack([1n]))
        .to.equal(parseEther("10000") - parseEther("30"));
    });

    it("should let consumption accumulate up to the per-epoch cap", async function () {
      const { game, partyA } = await openWithThreeParties();
      const aGame = await hre.viem.getContractAt("TripartiteGame", game.address, { client: { wallet: partyA } });
      await aGame.write.consume([GAME_ID, 1n, 1n, COMPUTE, parseEther("60"), REASON_INSPECT]);
      await aGame.write.consume([GAME_ID, 1n, 1n, COMPUTE, parseEther("40"), REASON_INSPECT]);
      expect(await game.read.consumed([GAME_ID, 1n, 1n, COMPUTE]))
        .to.equal(parseEther("100"));
    });

    it("should revert when a single consume exceeds the per-epoch budget", async function () {
      const { game, partyA } = await openWithThreeParties();
      const aGame = await hre.viem.getContractAt("TripartiteGame", game.address, { client: { wallet: partyA } });
      await expect(
        aGame.write.consume([GAME_ID, 1n, 1n, COMPUTE, parseEther("101"), REASON_INSPECT]),
      ).to.be.rejectedWith("exceeds per-epoch budget");
    });

    it("should revert when accumulated consumption tips over the cap", async function () {
      const { game, partyA } = await openWithThreeParties();
      const aGame = await hre.viem.getContractAt("TripartiteGame", game.address, { client: { wallet: partyA } });
      await aGame.write.consume([GAME_ID, 1n, 1n, STORAGE, parseEther("40"), REASON_ARCHIVE]);
      await expect(
        aGame.write.consume([GAME_ID, 1n, 1n, STORAGE, parseEther("11"), REASON_ARCHIVE]),
      ).to.be.rejectedWith("exceeds per-epoch budget");
    });

    it("should reset budgets per epoch — same cap applies in the next epoch", async function () {
      const { game, partyA } = await openWithThreeParties();
      const aGame = await hre.viem.getContractAt("TripartiteGame", game.address, { client: { wallet: partyA } });
      // Spend full budget at epoch 1
      await aGame.write.consume([GAME_ID, 1n, 1n, BANDWIDTH, parseEther("75"), REASON_RELAY]);
      // Epoch 2: full budget available again
      await aGame.write.consume([GAME_ID, 1n, 2n, BANDWIDTH, parseEther("75"), REASON_RELAY]);
      // consumed mapping order is (gameId, epoch, tokenId, resource)
      expect(await game.read.consumed([GAME_ID, 1n, 1n, BANDWIDTH])).to.equal(parseEther("75"));
      expect(await game.read.consumed([GAME_ID, 2n, 1n, BANDWIDTH])).to.equal(parseEther("75"));
    });

    it("should reject consume from a party that never registered", async function () {
      const { game, partyA } = await loadFixture(deployTripartiteFixture);
      await game.write.openGame([GAME_ID]);
      const aGame = await hre.viem.getContractAt("TripartiteGame", game.address, { client: { wallet: partyA } });
      await expect(
        aGame.write.consume([GAME_ID, 1n, 1n, COMPUTE, parseEther("1"), REASON_INSPECT]),
      ).to.be.rejectedWith("not registered");
    });

    it("should reject consume against an unknown game id", async function () {
      const { game, partyA } = await openWithThreeParties();
      const aGame = await hre.viem.getContractAt("TripartiteGame", game.address, { client: { wallet: partyA } });
      const bogus = keccak256(toHex("not-a-treaty"));
      await expect(
        aGame.write.consume([bogus, 1n, 1n, COMPUTE, parseEther("1"), REASON_INSPECT]),
      ).to.be.rejectedWith("no game");
    });

    it("should reject consume with an out-of-range resource enum", async function () {
      const { game, partyA } = await openWithThreeParties();
      const aGame = await hre.viem.getContractAt("TripartiteGame", game.address, { client: { wallet: partyA } });
      await expect(
        aGame.write.consume([GAME_ID, 1n, 1n, 9, parseEther("1"), REASON_INSPECT]),
      ).to.be.rejectedWith("bad resource");
    });

    it("should burn the underlying BandwidthToken on every consume", async function () {
      const { game, partyA, memory, routing } = await openWithThreeParties();
      const aGame = await hre.viem.getContractAt("TripartiteGame", game.address, { client: { wallet: partyA } });
      await aGame.write.consume([GAME_ID, 1n, 1n, STORAGE,   parseEther("10"), REASON_ARCHIVE]);
      await aGame.write.consume([GAME_ID, 1n, 1n, BANDWIDTH, parseEther("20"), REASON_RELAY]);
      expect(await memory .read.balanceOfStack([1n])).to.equal(parseEther("10000") - parseEther("10"));
      expect(await routing.read.balanceOfStack([1n])).to.equal(parseEther("10000") - parseEther("20"));
    });

    it("should fail if the underlying BandwidthToken balance is insufficient", async function () {
      const { game, partyA, compute } = await openWithThreeParties();
      // Drain compute outside the game so the on-chain balance is < per-epoch cap
      const aCompute = await hre.viem.getContractAt("ComputeToken", compute.address, { client: { wallet: partyA } });
      await aCompute.write.spend([1n, parseEther("9999"), REASON_INSPECT]); // leaves 1 token
      const aGame = await hre.viem.getContractAt("TripartiteGame", game.address, { client: { wallet: partyA } });
      await expect(
        aGame.write.consume([GAME_ID, 1n, 1n, COMPUTE, parseEther("50"), REASON_INSPECT]),
      ).to.be.rejectedWith("insufficient bandwidth");
    });
  });

  // ─── Audit / verification ──────────────────────────────────────────────

  describe("Audit — Inspectors verify allocation fairness from on-chain state", function () {
    it("verifyAllocationFair returns true when no party exceeds its cap", async function () {
      const { game, partyA, partyB, partyC } = await openWithThreeParties();
      const epoch = 7n;
      for (const [w, id] of [[partyA, 1n], [partyB, 2n], [partyC, 3n]] as const) {
        const w_ = await hre.viem.getContractAt("TripartiteGame", game.address, { client: { wallet: w } });
        await w_.write.consume([GAME_ID, id, epoch, COMPUTE,   parseEther("40"), REASON_INSPECT]);
        await w_.write.consume([GAME_ID, id, epoch, STORAGE,   parseEther("20"), REASON_ARCHIVE]);
        await w_.write.consume([GAME_ID, id, epoch, BANDWIDTH, parseEther("30"), REASON_RELAY]);
      }
      expect(await game.read.verifyAllocationFair([GAME_ID, epoch])).to.be.true;
    });

    it("verifyAllocationFair returns true even with all parties at the exact cap", async function () {
      const { game, partyA, partyB, partyC } = await openWithThreeParties();
      const epoch = 5n;
      for (const [w, id] of [[partyA, 1n], [partyB, 2n], [partyC, 3n]] as const) {
        const w_ = await hre.viem.getContractAt("TripartiteGame", game.address, { client: { wallet: w } });
        await w_.write.consume([GAME_ID, id, epoch, COMPUTE,   parseEther("100"), REASON_INSPECT]);
        await w_.write.consume([GAME_ID, id, epoch, STORAGE,   parseEther("50"),  REASON_ARCHIVE]);
        await w_.write.consume([GAME_ID, id, epoch, BANDWIDTH, parseEther("75"),  REASON_RELAY]);
      }
      expect(await game.read.verifyAllocationFair([GAME_ID, epoch])).to.be.true;
    });

    it("auditEpoch emits AllocationVerified(true) and returns true on a fair epoch", async function () {
      const { game, publicClient, partyA } = await openWithThreeParties();
      const aGame = await hre.viem.getContractAt("TripartiteGame", game.address, { client: { wallet: partyA } });
      await aGame.write.consume([GAME_ID, 1n, 3n, COMPUTE, parseEther("10"), REASON_INSPECT]);
      const hash = await game.write.auditEpoch([GAME_ID, 3n]);
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      const events = await game.getEvents.AllocationVerified(undefined, { fromBlock: 0n });
      const ev = events.find(e => e.transactionHash === receipt.transactionHash);
      expect(ev).to.not.be.undefined;
      expect(ev!.args.fair).to.be.true;
    });

    it("remainingBudget reports the unspent allowance per resource", async function () {
      const { game, partyA } = await openWithThreeParties();
      const aGame = await hre.viem.getContractAt("TripartiteGame", game.address, { client: { wallet: partyA } });
      await aGame.write.consume([GAME_ID, 1n, 4n, COMPUTE, parseEther("33"), REASON_INSPECT]);
      expect(await game.read.remainingBudget([GAME_ID, 1n, 4n, COMPUTE]))
        .to.equal(parseEther("100") - parseEther("33"));
      expect(await game.read.remainingBudget([GAME_ID, 1n, 4n, STORAGE]))
        .to.equal(parseEther("50"));
      expect(await game.read.remainingBudget([GAME_ID, 1n, 4n, BANDWIDTH]))
        .to.equal(parseEther("75"));
    });

    it("remainingBudget for an unregistered party is 0", async function () {
      const { game } = await openWithThreeParties();
      expect(await game.read.remainingBudget([GAME_ID, 999n, 1n, COMPUTE])).to.equal(0n);
    });

    it("any inspector address can read verifyAllocationFair — view is permissionless", async function () {
      const { game, partyA, inspector } = await openWithThreeParties();
      const aGame = await hre.viem.getContractAt("TripartiteGame", game.address, { client: { wallet: partyA } });
      await aGame.write.consume([GAME_ID, 1n, 11n, BANDWIDTH, parseEther("75"), REASON_RELAY]);
      const inspectorView = await hre.viem.getContractAt("TripartiteGame", game.address, {
        client: { wallet: inspector },
      });
      expect(await inspectorView.read.verifyAllocationFair([GAME_ID, 11n])).to.be.true;
    });
  });

  // ─── Provable-fairness end-to-end ──────────────────────────────────────

  describe("Provable Fairness — The treaty property end-to-end", function () {
    it("emits a Consumed event for every spend so inspectors can re-derive the ledger", async function () {
      const { game, publicClient, partyA, partyB } = await openWithThreeParties();
      const a = await hre.viem.getContractAt("TripartiteGame", game.address, { client: { wallet: partyA } });
      const b = await hre.viem.getContractAt("TripartiteGame", game.address, { client: { wallet: partyB } });
      await a.write.consume([GAME_ID, 1n, 1n, COMPUTE,   parseEther("10"), REASON_INSPECT]);
      await b.write.consume([GAME_ID, 2n, 1n, BANDWIDTH, parseEther("15"), REASON_RELAY]);
      // getEvents defaults to the latest block — scan from genesis instead.
      const evs = await game.getEvents.Consumed(undefined, { fromBlock: 0n });
      expect(evs.length).to.be.greaterThanOrEqual(2);
      const got = evs.map(e => `${e.args.tokenId}/${e.args.resource}/${e.args.amount}`).sort();
      expect(got).to.include(`1/${COMPUTE}/${parseEther("10")}`);
      expect(got).to.include(`2/${BANDWIDTH}/${parseEther("15")}`);
    });

    it("makes overspend impossible: the cap is a hard property, not a guideline", async function () {
      // The contract enforces the cap inside `consume`. Any attempt to step
      // outside it reverts. There is no path through the contract that can
      // mutate `consumed` without first passing the cap check.
      const { game, partyA } = await openWithThreeParties();
      const aGame = await hre.viem.getContractAt("TripartiteGame", game.address, { client: { wallet: partyA } });
      await aGame.write.consume([GAME_ID, 1n, 99n, COMPUTE, parseEther("100"), REASON_INSPECT]);
      // Any further consume in the same epoch must revert.
      await expect(
        aGame.write.consume([GAME_ID, 1n, 99n, COMPUTE, 1n, REASON_INSPECT]),
      ).to.be.rejectedWith("exceeds per-epoch budget");
      // verifyAllocationFair STILL returns true because the contract refused
      // the bad spend — which is the whole point.
      expect(await game.read.verifyAllocationFair([GAME_ID, 99n])).to.be.true;
    });

    it("supports many epochs of activity and remains auditable for each", async function () {
      const { game, partyA, partyB, partyC } = await openWithThreeParties();
      for (let e = 1n; e <= 5n; ++e) {
        for (const [w, id] of [[partyA, 1n], [partyB, 2n], [partyC, 3n]] as const) {
          const w_ = await hre.viem.getContractAt("TripartiteGame", game.address, { client: { wallet: w } });
          await w_.write.consume([GAME_ID, id, e, COMPUTE,   parseEther("10"), REASON_INSPECT]);
          await w_.write.consume([GAME_ID, id, e, STORAGE,   parseEther("5"),  REASON_ARCHIVE]);
          await w_.write.consume([GAME_ID, id, e, BANDWIDTH, parseEther("7"),  REASON_RELAY]);
        }
        expect(await game.read.verifyAllocationFair([GAME_ID, e])).to.be.true;
      }
    });
  });
});
