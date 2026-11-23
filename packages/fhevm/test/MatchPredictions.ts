import { FhevmType } from "@fhevm/hardhat-plugin";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import type { ContractTransactionResponse, TransactionReceipt } from "ethers";
import { ethers, fhevm } from "hardhat";

import { predictionPayout } from "../../shared/src/match-predictions";
import type { ConfidentialSkirmCredits, MatchPredictions, SkirmMatch } from "../types";

const UNIT = 10n ** 6n; // cSKIRM has 6 decimals
const FAUCET = 1_000n * UNIT;
const FEE_BPS = 500; // 5% of the winnings
const WINDOW = 10n * 60n;
const RESOLVE_TIMEOUT = 24n * 60n * 60n;
const NO_SIDE = 255;
const Status = { None: 0n, Open: 1n, Closed: 2n, Revealed: 3n, Resolved: 4n, Void: 5n };
const LOG_HASH = ethers.keccak256(ethers.toUtf8Bytes("final log head"));

const matchKey = (offchainId: string) => ethers.keccak256(ethers.toUtf8Bytes(offchainId));
const KEY = matchKey("mat_live_1");
const A = false; // encrypted side: false backs team A
const B = true; //                 true backs team B

/** Gas and HCU per call, printed after the suite (the numbers in the README come from here). */
const report = new Map<string, { gas: bigint; hcu: number; depth: number; n: number }>();

async function measure(label: string, tx: Promise<ContractTransactionResponse>): Promise<TransactionReceipt> {
  const receipt = (await (await tx).wait())!;
  const hcu = fhevm.computeTransactionHCU(receipt);
  const prev = report.get(label);
  const gas = receipt.gasUsed;
  if (!prev || gas > prev.gas) report.set(label, { gas, hcu: hcu.globalHCU, depth: hcu.maxHCUDepth, n: (prev?.n ?? 0) + 1 });
  else prev.n++;
  return receipt;
}

describe("MatchPredictions", function () {
  let owner: HardhatEthersSigner;
  let server: HardhatEthersSigner;
  let treasury: HardhatEthersSigner;
  let alice: HardhatEthersSigner;
  let bob: HardhatEthersSigner;
  let carol: HardhatEthersSigner;
  let dave: HardhatEthersSigner;
  let eve: HardhatEthersSigner;
  let credits: ConfidentialSkirmCredits;
  let creditsAddress: string;
  let game: SkirmMatch;
  let gameAddress: string;
  let market: MatchPredictions;
  let address: string;

  async function balanceOf(who: HardhatEthersSigner): Promise<bigint> {
    const handle = await credits.confidentialBalanceOf(who.address);
    if (handle === ethers.ZeroHash) return 0n;
    return fhevm.userDecryptEuint(FhevmType.euint64, handle, creditsAddress, who);
  }

  async function approve(who: HardhatEthersSigner, to = address) {
    const until = (await time.latest()) + 7 * 24 * 3600;
    await (await credits.connect(who).setOperator(to, until)).wait();
  }

  async function open(key = KEY) {
    const closesAt = BigInt(await time.latest()) + WINDOW;
    await measure("openMarket", market.connect(server).openMarket(key, closesAt));
    return closesAt;
  }

  function predictTx(who: HardhatEthersSigner, backsB: boolean, amount: bigint, key = KEY) {
    return fhevm
      .createEncryptedInput(address, who.address)
      .addBool(backsB)
      .add64(amount)
      .encrypt()
      .then((enc) => market.connect(who).predict(key, enc.handles[0]!, enc.handles[1]!, enc.inputProof));
  }

  const predict = (who: HardhatEthersSigner, backsB: boolean, amount: bigint, key = KEY) =>
    measure("predict", predictTx(who, backsB, amount, key));

  async function closeAndReveal(key = KEY) {
    await measure("close (operator, early tick)", market.connect(server).close(key));
    const res = await fhevm.publicDecrypt([...(await market.totalHandles(key))]);
    await measure("revealTotals", market.revealTotals(key, res.abiEncodedClearValues, res.decryptionProof));
  }

  async function claim(who: HardhatEthersSigner, key = KEY): Promise<bigint> {
    const s = (await market.getMarket(key)).status;
    await measure(s === Status.Void ? "claim (void refund)" : "claim (resolved)", market.connect(who).claim(key));
    const [, , payout] = await market.predictionOf(key, who.address);
    return fhevm.userDecryptEuint(FhevmType.euint64, payout, address, who);
  }

  before(async function () {
    [owner, server, treasury, alice, bob, carol, dave, eve] = await ethers.getSigners();
  });

  beforeEach(async function () {
    if (!fhevm.isMock) {
      console.warn("MatchPredictions tests need the FHEVM mock (hardhat network)");
      this.skip();
    }
    credits = await (await ethers.getContractFactory("ConfidentialSkirmCredits")).deploy(owner.address, FAUCET, 0n);
    creditsAddress = await credits.getAddress();
    game = await (await ethers.getContractFactory("SkirmMatch")).deploy(creditsAddress, server.address, ethers.ZeroAddress, 0);
    gameAddress = await game.getAddress();
    market = await (await ethers.getContractFactory("MatchPredictions")).deploy(creditsAddress, gameAddress, server.address, treasury.address, FEE_BPS);
    address = await market.getAddress();
    for (const p of [alice, bob, carol, dave]) {
      await (await credits.connect(p).claimFaucet()).wait();
      await approve(p);
    }
  });

  after(function () {
    if (report.size === 0) return;
    console.log("\n    MatchPredictions gas / HCU (FHEVM mock, worst case seen):");
    for (const [label, r] of report) {
      console.log(`      ${label.padEnd(30)} gas ${r.gas.toString().padStart(9)}   HCU ${String(r.hcu).padStart(9)}   depth ${String(r.depth).padStart(8)}`);
    }
  });

  describe("deployment", function () {
    it("records the token, match contract, operator and fee terms, and validates them", async function () {
      expect(await market.credits()).to.eq(creditsAddress);
      expect(await market.skirmMatch()).to.eq(gameAddress);
      expect(await market.operator()).to.eq(server.address);
      expect(await market.treasury()).to.eq(treasury.address);
      expect(await market.feeBps()).to.eq(BigInt(FEE_BPS));
      const f = await ethers.getContractFactory("MatchPredictions");
      await expect(f.deploy(ethers.ZeroAddress, gameAddress, server.address, treasury.address, 0)).to.be.revertedWithCustomError(market, "ZeroAddress");
      await expect(f.deploy(creditsAddress, gameAddress, ethers.ZeroAddress, treasury.address, 0)).to.be.revertedWithCustomError(market, "ZeroAddress");
      await expect(f.deploy(creditsAddress, gameAddress, server.address, treasury.address, 1001)).to.be.revertedWithCustomError(market, "InvalidFee");
    });

    it("lets only the owner change the operator and the fee", async function () {
      await expect(market.connect(eve).setOperator(eve.address)).to.be.revertedWithCustomError(market, "OwnableUnauthorizedAccount");
      await expect(market.connect(eve).setFee(eve.address, 0)).to.be.revertedWithCustomError(market, "OwnableUnauthorizedAccount");
      await expect(market.setOperator(ethers.ZeroAddress)).to.be.revertedWithCustomError(market, "ZeroAddress");
      await expect(market.setOperator(eve.address)).to.emit(market, "OperatorSet").withArgs(eve.address);
      await expect(market.setFee(eve.address, 100)).to.emit(market, "FeeSet").withArgs(eve.address, 100);
      await expect(market.setFee(eve.address, 1001)).to.be.revertedWithCustomError(market, "InvalidFee");
    });
  });

  describe("openMarket", function () {
    it("opens a market for the operator only, once, with a sane close time", async function () {
      const now = BigInt(await time.latest());
      await expect(market.connect(eve).openMarket(KEY, now + WINDOW)).to.be.revertedWithCustomError(market, "NotOperator");
      await expect(market.connect(server).openMarket(ethers.ZeroHash, now + WINDOW)).to.be.revertedWithCustomError(market, "InvalidMatchKey");
      await expect(market.connect(server).openMarket(KEY, now)).to.be.revertedWithCustomError(market, "InvalidCloseTime");
      await expect(market.connect(server).openMarket(KEY, now + 2n * 86_400n)).to.be.revertedWithCustomError(market, "InvalidCloseTime");
      const closesAt = await open();
      const m = await market.getMarket(KEY);
      expect(m.status).to.eq(Status.Open);
      expect(m.closesAt).to.eq(closesAt);
      expect(m.winner).to.eq(BigInt(NO_SIDE));
      expect(m.feeBps).to.eq(BigInt(FEE_BPS));
      await expect(market.connect(server).openMarket(KEY, closesAt)).to.be.revertedWithCustomError(market, "MarketExists");
    });
  });

  describe("predict", function () {
    beforeEach(async function () {
      await open();
    });

    it("escrows the stake and keeps the side and amount sealed, readable by the predictor only", async function () {
      await expect(predictTx(alice, B, 40n * UNIT)).to.emit(market, "Predicted");
      expect(await balanceOf(alice)).to.eq(FAUCET - 40n * UNIT);
      expect((await market.getMarket(KEY)).predictors).to.eq(1n);
      const [side, stake, payout, claimed] = await market.predictionOf(KEY, alice.address);
      expect(await fhevm.userDecryptEbool(side, address, alice)).to.eq(true);
      expect(await fhevm.userDecryptEuint(FhevmType.euint64, stake, address, alice)).to.eq(40n * UNIT);
      expect(payout).to.eq(ethers.ZeroHash);
      expect(claimed).to.eq(false);
      // Nobody else can read it, the operator included.
      await expect(fhevm.userDecryptEbool(side, address, bob)).to.be.rejected;
      await expect(fhevm.userDecryptEuint(FhevmType.euint64, stake, address, server)).to.be.rejected;
    });

    it("keeps the totals hidden while betting is open: nobody can decrypt them", async function () {
      await predict(alice, A, 10n * UNIT);
      await predict(bob, B, 20n * UNIT);
      const [ha, hb] = await market.totalHandles(KEY);
      await expect(fhevm.publicDecrypt([ha!, hb!])).to.be.rejected;
      for (const who of [alice, bob, server, owner]) {
        await expect(fhevm.userDecryptEuint(FhevmType.euint64, ha!, address, who)).to.be.rejected;
      }
      // Revealing needs a closed market (and a real KMS proof).
      await expect(market.revealTotals(KEY, "0x", "0x")).to.be.revertedWithCustomError(market, "WrongStatus").withArgs(Status.Open);
    });

    it("stakes 0 on an insufficient balance, and caps a stake at MAX_STAKE", async function () {
      await predict(alice, A, FAUCET + 1n);
      const [, stake] = await market.predictionOf(KEY, alice.address);
      expect(await fhevm.userDecryptEuint(FhevmType.euint64, stake, address, alice)).to.eq(0n);
      expect(await balanceOf(alice)).to.eq(FAUCET);

      // A stake above the cap moves the cap at most: give eve a bigger balance on a fresh token.
      const cap = await market.MAX_STAKE();
      credits = await (await ethers.getContractFactory("ConfidentialSkirmCredits")).deploy(owner.address, cap * 2n, 0n);
      creditsAddress = await credits.getAddress();
      market = await (await ethers.getContractFactory("MatchPredictions")).deploy(creditsAddress, gameAddress, server.address, treasury.address, FEE_BPS);
      address = await market.getAddress();
      await (await credits.connect(eve).claimFaucet()).wait();
      await approve(eve);
      await open();
      await predict(eve, B, cap * 2n);
      const [, capped] = await market.predictionOf(KEY, eve.address);
      expect(await fhevm.userDecryptEuint(FhevmType.euint64, capped, address, eve)).to.eq(cap);
      expect(await balanceOf(eve)).to.eq(cap);
    });

    it("refuses a second prediction, a player of the sealed match, and an unapproved transfer", async function () {
      await predict(alice, A, 10n * UNIT);
      await expect(predictTx(alice, B, 10n * UNIT)).to.be.revertedWithCustomError(market, "AlreadyPredicted");

      const key = matchKey("sealed_with_players");
      await game.connect(carol).createMatch(key, carol.address, dave.address, 600n, 0n);
      await open(key);
      await expect(predictTx(carol, A, 1n, key)).to.be.revertedWithCustomError(market, "PlayerCannotPredict").withArgs(carol.address);
      await expect(predictTx(dave, B, 1n, key)).to.be.revertedWithCustomError(market, "PlayerCannotPredict").withArgs(dave.address);

      await (await credits.connect(eve).claimFaucet()).wait();
      await expect(predictTx(eve, A, 1n)).to.be.reverted; // not a cSKIRM operator for eve
    });

    it("refuses an unknown market, and predictions after close or past closesAt", async function () {
      await expect(predictTx(alice, A, 1n, matchKey("nope"))).to.be.revertedWithCustomError(market, "UnknownMarket");
      await predict(alice, A, 1n);
      await (await market.connect(server).close(KEY)).wait();
      await expect(predictTx(bob, B, 1n)).to.be.revertedWithCustomError(market, "WrongStatus").withArgs(Status.Closed);

      const late = matchKey("late");
      const closesAt = await open(late);
      await time.increaseTo(closesAt);
      await expect(predictTx(bob, B, 1n, late)).to.be.revertedWithCustomError(market, "BettingClosed");
    });
  });

  describe("close and reveal", function () {
    it("lets the operator close early and anyone once closesAt has passed", async function () {
      const closesAt = await open();
      await predict(alice, A, 1n);
      await expect(market.connect(eve).close(KEY)).to.be.revertedWithCustomError(market, "StillOpen");
      await time.increaseTo(closesAt);
      await expect(market.connect(eve).close(KEY)).to.emit(market, "MarketClosed");
      await expect(market.connect(eve).close(KEY)).to.be.revertedWithCustomError(market, "WrongStatus");
    });

    it("voids an empty market at close", async function () {
      await open();
      await expect(market.connect(server).close(KEY)).to.emit(market, "MarketVoided").withArgs(KEY);
      expect((await market.getMarket(KEY)).status).to.eq(Status.Void);
    });

    it("reveals the two totals with a KMS proof, and rejects a forged one", async function () {
      await open();
      await predict(alice, A, 10n * UNIT);
      await predict(bob, B, 20n * UNIT);
      await predict(carol, A, 30n * UNIT);
      await (await market.connect(server).close(KEY)).wait();
      const res = await fhevm.publicDecrypt([...(await market.totalHandles(KEY))]);
      const coder = ethers.AbiCoder.defaultAbiCoder();
      const forged = coder.encode(["uint256", "uint256"], [20n * UNIT, 40n * UNIT]);
      await expect(market.revealTotals(KEY, forged, res.decryptionProof)).to.be.reverted;
      await expect(market.revealTotals(KEY, res.abiEncodedClearValues, "0x")).to.be.reverted;
      await expect(market.connect(eve).revealTotals(KEY, res.abiEncodedClearValues, res.decryptionProof))
        .to.emit(market, "TotalsRevealed")
        .withArgs(KEY, 40n * UNIT, 20n * UNIT);
      const m = await market.getMarket(KEY);
      expect([m.totalA, m.totalB]).to.deep.eq([40n * UNIT, 20n * UNIT]);
      expect(m.status).to.eq(Status.Revealed);
      // Each predictor's own side and stake stay sealed: only the totals were opened.
      const [side, stake] = await market.predictionOf(KEY, alice.address);
      await expect(fhevm.publicDecrypt([side])).to.be.rejected;
      await expect(fhevm.publicDecrypt([stake])).to.be.rejected;
    });
  });

  describe("resolve and claim", function () {
    const stakes = { alice: 100n * UNIT, bob: 200n * UNIT, carol: 300n * UNIT, dave: 50n * UNIT };

    beforeEach(async function () {
      await open();
      await predict(alice, A, stakes.alice);
      await predict(bob, B, stakes.bob);
      await predict(carol, A, stakes.carol);
      await predict(dave, B, stakes.dave);
    });

    it("pays winners pro rata, the fee to the treasury, and losers 0", async function () {
      await closeAndReveal();
      await expect(market.connect(eve).resolve(KEY, 0)).to.be.revertedWithCustomError(market, "NotOperator");
      await expect(market.connect(server).resolve(KEY, 2)).to.be.revertedWithCustomError(market, "InvalidWinner");
      await expect(measure("resolve (operator)", market.connect(server).resolve(KEY, 0)))
        .to.emit(market, "MarketResolved");
      const m = await market.getMarket(KEY);
      expect(m.status).to.eq(Status.Resolved);
      expect(m.winner).to.eq(0n);

      const winning = stakes.alice + stakes.carol;
      const losing = stakes.bob + stakes.dave;
      const expA = predictionPayout(stakes.alice, true, winning, losing, FEE_BPS);
      const expC = predictionPayout(stakes.carol, true, winning, losing, FEE_BPS);
      expect(await claim(alice)).to.eq(expA.payout);
      expect(await claim(carol)).to.eq(expC.payout);
      expect(await claim(bob)).to.eq(0n);
      expect(await claim(dave)).to.eq(0n);
      expect(await balanceOf(alice)).to.eq(FAUCET - stakes.alice + expA.payout);
      expect(await balanceOf(carol)).to.eq(FAUCET - stakes.carol + expC.payout);
      expect(await balanceOf(bob)).to.eq(FAUCET - stakes.bob);
      expect(await balanceOf(treasury)).to.eq(expA.fee + expC.fee);
      // The pool is fully paid out (rounding dust at most stays in the contract).
      expect(await balanceOf(alice) + (await balanceOf(bob)) + (await balanceOf(carol)) + (await balanceOf(dave)) + (await balanceOf(treasury))).to.be.lte(4n * FAUCET);
    });

    it("reverts a double claim, a non-predictor and a claim before resolution", async function () {
      await expect(market.connect(alice).claim(KEY)).to.be.revertedWithCustomError(market, "WrongStatus").withArgs(Status.Open);
      await closeAndReveal();
      await (await market.connect(server).resolve(KEY, 1)).wait();
      await (await market.connect(bob).claim(KEY)).wait();
      await expect(market.connect(bob).claim(KEY)).to.be.revertedWithCustomError(market, "AlreadyClaimed");
      await expect(market.connect(eve).claim(KEY)).to.be.revertedWithCustomError(market, "NotAPredictor");
      expect((await market.predictionOf(KEY, bob.address)).claimed).to.eq(true);
    });

    it("refunds everyone on a draw", async function () {
      await closeAndReveal();
      await expect(measure("resolve (draw → void)", market.connect(server).resolve(KEY, NO_SIDE))).to.emit(market, "MarketVoided");
      for (const [who, stake] of [[alice, stakes.alice], [bob, stakes.bob], [carol, stakes.carol], [dave, stakes.dave]] as const) {
        expect(await claim(who)).to.eq(stake);
        expect(await balanceOf(who)).to.eq(FAUCET);
      }
      expect(await balanceOf(treasury)).to.eq(0n);
    });

    it("voids a market whose winning side nobody backed", async function () {
      const key = matchKey("one_sided");
      await open(key);
      await predict(alice, A, 5n * UNIT, key);
      await closeAndReveal(key);
      await expect(market.connect(server).resolve(key, 1)).to.emit(market, "MarketVoided").withArgs(key);
      expect(await claim(alice, key)).to.eq(5n * UNIT);
    });

    it("lets anyone void a market nobody resolved after the timeout", async function () {
      await closeAndReveal();
      await expect(market.connect(eve).voidStale(KEY)).to.be.revertedWithCustomError(market, "NotStale");
      await time.increase(WINDOW + RESOLVE_TIMEOUT);
      await expect(market.connect(eve).voidStale(KEY)).to.emit(market, "MarketVoided");
      expect(await claim(carol)).to.eq(stakes.carol);
      await expect(market.connect(server).resolve(KEY, 0)).to.be.revertedWithCustomError(market, "WrongStatus").withArgs(Status.Void);
    });
  });

  describe("winner from SkirmMatch", function () {
    const SEALED = matchKey("mat_sealed_1");
    let playerA: HardhatEthersSigner;
    let playerB: HardhatEthersSigner;

    async function seal(player: HardhatEthersSigner, side: number) {
      const input = fhevm.createEncryptedInput(gameAddress, player.address);
      for (let i = 0; i < 9; i++) input.add8(i % 3);
      input.add64(0n);
      const enc = await input.encrypt();
      const h = enc.handles;
      await (
        await game.connect(player).submitLoadout(SEALED, side, [h[0]!, h[1]!, h[2]!], [h[3]!, h[4]!, h[5]!], [h[6]!, h[7]!, h[8]!], h[9]!, enc.inputProof)
      ).wait();
    }

    beforeEach(async function () {
      [, , , , , , , , playerA, playerB] = await ethers.getSigners();
      for (const p of [playerA!, playerB!]) {
        await (await credits.connect(p).claimFaucet()).wait();
        await approve(p, gameAddress);
      }
      await (await game.connect(playerA).createMatch(SEALED, playerA.address, playerB.address, 600n, 0n)).wait();
      await seal(playerA, 0);
      await seal(playerB, 1);
      await (await game.reveal(SEALED)).wait();
      const res = await fhevm.publicDecrypt([...(await game.revealHandles(SEALED))]);
      await (await game.finalizeReveal(SEALED, res.abiEncodedClearValues, res.decryptionProof)).wait();
      await open(SEALED);
      await predict(alice, A, 100n * UNIT, SEALED);
      await predict(bob, B, 100n * UNIT, SEALED);
      await closeAndReveal(SEALED);
    });

    it("waits for the settlement, then takes SkirmMatch's winner over the operator's (anyone can resolve)", async function () {
      await expect(market.connect(server).resolve(SEALED, 0)).to.be.revertedWithCustomError(market, "MatchNotSettled");
      await (await game.connect(server).settle(SEALED, 1, LOG_HASH)).wait();
      // The operator claims A won; the chain says B: B it is, and no operator is needed.
      await expect(measure("resolve (from SkirmMatch)", market.connect(eve).resolve(SEALED, 0)))
        .to.emit(market, "MarketResolved")
        .withArgs(SEALED, 1, true);
      expect(await claim(bob, SEALED)).to.eq(predictionPayout(100n * UNIT, true, 100n * UNIT, 100n * UNIT, FEE_BPS).payout);
      expect(await claim(alice, SEALED)).to.eq(0n);
    });

    it("voids on a draw settled in SkirmMatch", async function () {
      await (await game.connect(server).settle(SEALED, NO_SIDE, LOG_HASH)).wait();
      await expect(market.connect(eve).resolve(SEALED, 0)).to.emit(market, "MarketVoided");
      expect(await claim(alice, SEALED)).to.eq(100n * UNIT);
    });
  });
});
