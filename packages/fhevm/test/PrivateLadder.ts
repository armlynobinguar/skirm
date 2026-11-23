import { FhevmType } from "@fhevm/hardhat-plugin";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import type { ContractTransactionResponse, TransactionReceipt } from "ethers";
import { ethers, fhevm } from "hardhat";

import {
  LADDER_BAND,
  LADDER_CEILING,
  LADDER_DITHER,
  LADDER_FLOOR,
  LADDER_START_DITHER,
  LADDER_START_RATING,
  LADDER_START_TIER,
  LADDER_STEPS,
  LADDER_TIERS,
  ladderBand,
  ladderTierIndex,
} from "../../shared/src/private-ladder";
import type { ConfidentialSkirmCredits, PrivateLadderHarness, SkirmMatch } from "../types";

const WINDOW = 200;
const NO_SIDE = 255;
const LOG_HASH = ethers.keccak256(ethers.toUtf8Bytes("final log head"));
const matchKey = (offchainId: string) => ethers.keccak256(ethers.toUtf8Bytes(offchainId));
let nextMatch = 0;
const freshKey = () => matchKey(`mat_ranked_${++nextMatch}`);

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

describe("PrivateLadder", function () {
  let owner: HardhatEthersSigner;
  let server: HardhatEthersSigner;
  let alice: HardhatEthersSigner;
  let bob: HardhatEthersSigner;
  let carol: HardhatEthersSigner;
  let eve: HardhatEthersSigner;
  let ladder: PrivateLadderHarness;
  let address: string;

  /** The player's own rating, decrypted with its own key. */
  async function ratingOf(who: HardhatEthersSigner): Promise<number> {
    return Number(await fhevm.userDecryptEuint(FhevmType.euint16, await ladder.ratingOf(who.address), address, who));
  }

  /** Public-decrypts the pending tier and submits it with the KMS proof. */
  async function revealTier(who: HardhatEthersSigner): Promise<number> {
    const res = await fhevm.publicDecrypt([await ladder.tierHandle(who.address)]);
    await measure("revealTier", ladder.connect(eve).revealTier(who.address, res.abiEncodedClearValues, res.decryptionProof));
    return Number((await ladder.playerOf(who.address)).tier);
  }

  const register = (who: HardhatEthersSigner) => measure("register", ladder.connect(who).register());

  const win = (w: HardhatEthersSigner, l: HardhatEthersSigner, key = freshKey()) =>
    measure("report (win/loss)", ladder.connect(server).report(key, w.address, l.address, 0));

  before(async function () {
    [owner, server, alice, bob, carol, eve] = await ethers.getSigners();
  });

  beforeEach(async function () {
    if (!fhevm.isMock) {
      console.warn("PrivateLadder tests need the FHEVM mock (hardhat network)");
      this.skip();
    }
    ladder = await (await ethers.getContractFactory("PrivateLadderHarness")).deploy(ethers.ZeroAddress, server.address, WINDOW);
    address = await ladder.getAddress();
  });

  after(function () {
    if (report.size === 0) return;
    console.log("\n    PrivateLadder gas / HCU (FHEVM mock, worst case seen):");
    for (const [label, r] of report) {
      console.log(`      ${label.padEnd(30)} gas ${r.gas.toString().padStart(9)}   HCU ${String(r.hcu).padStart(9)}   depth ${String(r.depth).padStart(8)}`);
    }
  });

  describe("deployment", function () {
    it("records the match contract, operator and window, and validates them", async function () {
      expect(await ladder.skirmMatch()).to.eq(ethers.ZeroAddress);
      expect(await ladder.operator()).to.eq(server.address);
      expect(await ladder.matchWindow()).to.eq(BigInt(WINDOW));
      const f = await ethers.getContractFactory("PrivateLadder");
      await expect(f.deploy(ethers.ZeroAddress, ethers.ZeroAddress, WINDOW)).to.be.revertedWithCustomError(ladder, "ZeroAddress");
      await expect(f.deploy(ethers.ZeroAddress, server.address, 24)).to.be.revertedWithCustomError(ladder, "InvalidWindow");
      await expect(f.deploy(ethers.ZeroAddress, server.address, 1001)).to.be.revertedWithCustomError(ladder, "InvalidWindow");
    });

    it("matches the shared constants and the off-chain tier thresholds", async function () {
      expect(Number(await ladder.START_RATING())).to.eq(LADDER_START_RATING);
      expect(Number(await ladder.START_DITHER())).to.eq(LADDER_START_DITHER);
      expect(Number(await ladder.FLOOR())).to.eq(LADDER_FLOOR);
      expect(Number(await ladder.CEILING())).to.eq(LADDER_CEILING);
      expect(Number(await ladder.BAND())).to.eq(LADDER_BAND);
      expect(Number(await ladder.DITHER())).to.eq(LADDER_DITHER);
      expect(Number(await ladder.STEP_FAVOURED())).to.eq(LADDER_STEPS.favoured);
      expect(Number(await ladder.STEP_EVEN())).to.eq(LADDER_STEPS.even);
      expect(Number(await ladder.STEP_UNDERDOG())).to.eq(LADDER_STEPS.underdog);
      expect(Number(await ladder.START_TIER())).to.eq(LADDER_START_TIER);
      const onChain = await Promise.all([ladder.SILVER(), ladder.GOLD(), ladder.PLATINUM(), ladder.DIAMOND(), ladder.MASTER()]);
      expect(onChain.map(Number)).to.deep.eq(LADDER_TIERS.slice(1).map((t) => t.min));
    });

    it("lets only the owner change the operator and the window", async function () {
      await expect(ladder.connect(eve).setOperator(eve.address)).to.be.revertedWithCustomError(ladder, "OwnableUnauthorizedAccount");
      await expect(ladder.connect(eve).setMatchWindow(300)).to.be.revertedWithCustomError(ladder, "OwnableUnauthorizedAccount");
      await expect(ladder.setOperator(ethers.ZeroAddress)).to.be.revertedWithCustomError(ladder, "ZeroAddress");
      await expect(ladder.setMatchWindow(10)).to.be.revertedWithCustomError(ladder, "InvalidWindow");
      await expect(ladder.setOperator(eve.address)).to.emit(ladder, "OperatorSet").withArgs(eve.address);
      await expect(ladder.setMatchWindow(300)).to.emit(ladder, "MatchWindowSet").withArgs(300);
    });
  });

  describe("register", function () {
    it("gives a hidden starting rating near 1200 that only the player can decrypt", async function () {
      await expect(ladder.connect(alice).register()).to.emit(ladder, "Registered");
      const p = await ladder.playerOf(alice.address);
      expect(p.registered).to.eq(true);
      expect(Number(p.tier)).to.eq(LADDER_START_TIER);
      expect(p.tierPending).to.eq(false);
      const r = await ratingOf(alice);
      expect(r).to.be.gte(LADDER_START_RATING).and.lt(LADDER_START_RATING + LADDER_START_DITHER);
      const handle = await ladder.ratingOf(alice.address);
      for (const who of [bob, server, owner]) {
        await expect(fhevm.userDecryptEuint(FhevmType.euint16, handle, address, who)).to.be.rejected;
      }
      await expect(fhevm.publicDecrypt([handle])).to.be.rejected;
      await expect(ladder.connect(alice).register()).to.be.revertedWithCustomError(ladder, "AlreadyRegistered");
    });

    it("dithers the start, so a rating cannot be replayed from public reports", async function () {
      const starts = new Set<number>();
      for (const who of [alice, bob, carol, eve, owner]) {
        await register(who);
        starts.add(await ratingOf(who));
      }
      // Five draws from 64 values: all equal would mean no dither (probability 64^-4).
      expect(starts.size).to.be.gt(1);
    });
  });

  describe("report", function () {
    beforeEach(async function () {
      await register(alice);
      await register(bob);
    });

    it("moves the winner up and the loser down by the same banded step", async function () {
      const [a0, b0] = [await ratingOf(alice), await ratingOf(bob)];
      const key = freshKey();
      await expect(win(alice, bob, key)).to.emit(ladder, "Reported").withArgs(key, alice.address, bob.address, 0, false);
      const [a1, b1] = [await ratingOf(alice), await ratingOf(bob)];
      const step = a1 - a0;
      expect(b0 - b1).to.eq(step);
      expect(ladderBand(a0, b0)).to.eq("even"); // both start within 64
      expect(step).to.be.gte(LADDER_STEPS.even).and.lt(LADDER_STEPS.even + LADDER_DITHER);
      expect(await ladder.reported(key)).to.eq(true);
      expect((await ladder.playerOf(alice.address)).matches).to.eq(1n);
    });

    it("takes winnerSide 1 as b's win, and a draw changes nothing", async function () {
      const [a0, b0] = [await ratingOf(alice), await ratingOf(bob)];
      await measure("report (draw)", ladder.connect(server).report(freshKey(), alice.address, bob.address, NO_SIDE));
      expect([await ratingOf(alice), await ratingOf(bob)]).to.deep.eq([a0, b0]);
      expect((await ladder.playerOf(alice.address)).tierPending).to.eq(false);
      await (await ladder.connect(server).report(freshKey(), alice.address, bob.address, 1)).wait();
      expect(await ratingOf(alice)).to.be.lt(a0);
      expect(await ratingOf(bob)).to.be.gt(b0);
    });

    it("gives a favoured winner a small step and an upset a big one", async function () {
      await ladder.setRatingForTest(alice.address, 1600);
      await ladder.setRatingForTest(bob.address, 1400);
      await win(alice, bob);
      const fav = (await ratingOf(alice)) - 1600;
      expect(fav).to.be.gte(LADDER_STEPS.favoured).and.lt(LADDER_STEPS.favoured + LADDER_DITHER);
      expect(1400 - (await ratingOf(bob))).to.eq(fav);

      await ladder.setRatingForTest(alice.address, 1600);
      await ladder.setRatingForTest(bob.address, 1400);
      await win(bob, alice);
      const upset = (await ratingOf(bob)) - 1400;
      expect(upset).to.be.gte(LADDER_STEPS.underdog).and.lt(LADDER_STEPS.underdog + LADDER_DITHER);
      expect(1600 - (await ratingOf(alice))).to.eq(upset);
    });

    it("clamps at the floor and the ceiling", async function () {
      await ladder.setRatingForTest(alice.address, LADDER_CEILING - 2);
      await ladder.setRatingForTest(bob.address, LADDER_FLOOR + 3);
      await win(alice, bob);
      expect(await ratingOf(alice)).to.eq(LADDER_CEILING);
      expect(await ratingOf(bob)).to.eq(LADDER_FLOOR);
      await win(alice, bob);
      expect(await ratingOf(alice)).to.eq(LADDER_CEILING);
      expect(await ratingOf(bob)).to.eq(LADDER_FLOOR);
    });

    it("refuses a non-operator, a repeated match key and bad arguments", async function () {
      await expect(ladder.connect(eve).report(freshKey(), alice.address, bob.address, 0)).to.be.revertedWithCustomError(ladder, "NotOperator");
      await expect(ladder.connect(alice).report(freshKey(), alice.address, bob.address, 0)).to.be.revertedWithCustomError(ladder, "NotOperator");
      const key = freshKey();
      await win(alice, bob, key);
      await expect(ladder.connect(server).report(key, alice.address, bob.address, 0)).to.be.revertedWithCustomError(ladder, "AlreadyReported");
      await expect(ladder.connect(server).report(key, alice.address, bob.address, NO_SIDE)).to.be.revertedWithCustomError(ladder, "AlreadyReported");
      await expect(ladder.connect(server).report(ethers.ZeroHash, alice.address, bob.address, 0)).to.be.revertedWithCustomError(ladder, "InvalidMatchKey");
      await expect(ladder.connect(server).report(freshKey(), alice.address, alice.address, 0)).to.be.revertedWithCustomError(ladder, "SamePlayer");
      await expect(ladder.connect(server).report(freshKey(), alice.address, carol.address, 0)).to.be.revertedWithCustomError(ladder, "NotRegistered");
      await expect(ladder.connect(server).report(freshKey(), alice.address, bob.address, 2)).to.be.revertedWithCustomError(ladder, "InvalidWinner");
    });
  });

  describe("tier", function () {
    beforeEach(async function () {
      await register(alice);
      await register(bob);
    });

    it("reveals a tier change with a KMS proof, and only the tier", async function () {
      await ladder.setRatingForTest(alice.address, 1295);
      await ladder.setRatingForTest(bob.address, 1290);
      expect(await revealTier(alice)).to.eq(1); // Silver
      await expect(win(alice, bob)).to.emit(ladder, "TierPending");
      const p = await ladder.playerOf(alice.address);
      expect(p.tierPending).to.eq(true);
      expect(Number(p.tier)).to.eq(1); // the old tier until revealed
      expect(await revealTier(alice)).to.eq(ladderTierIndex(await ratingOf(alice)));
      expect(Number((await ladder.playerOf(alice.address)).tier)).to.eq(2); // Gold
      expect((await ladder.playerOf(alice.address)).tierPending).to.eq(false);
      // The rating behind it stays private.
      await expect(fhevm.publicDecrypt([await ladder.ratingOf(alice.address)])).to.be.rejected;
      // Nothing left to reveal.
      await expect(ladder.revealTier(alice.address, "0x", "0x")).to.be.revertedWithCustomError(ladder, "NoTierPending");
    });

    it("computes every tier from its thresholds", async function () {
      for (const r of [100, 1099, 1100, 1299, 1300, 1500, 1699, 1700, 1899, 1900, 3000]) {
        await ladder.setRatingForTest(alice.address, r);
        expect(await revealTier(alice), `rating ${r}`).to.eq(ladderTierIndex(r));
      }
    });

    it("rejects a forged tier and a proof for another handle", async function () {
      await ladder.setRatingForTest(alice.address, 1500);
      const res = await fhevm.publicDecrypt([await ladder.tierHandle(alice.address)]);
      const forged = ethers.AbiCoder.defaultAbiCoder().encode(["uint256"], [5]);
      await expect(ladder.revealTier(alice.address, forged, res.decryptionProof)).to.be.reverted;
      await ladder.setRatingForTest(bob.address, 1600); // same tier, another handle (trivial encryptions of one value share a handle)
      await expect(ladder.revealTier(bob.address, res.abiEncodedClearValues, res.decryptionProof)).to.be.reverted;
      await (await ladder.revealTier(alice.address, res.abiEncodedClearValues, res.decryptionProof)).wait();
      expect(Number((await ladder.playerOf(alice.address)).tier)).to.eq(3); // Platinum
    });
  });

  describe("isCloseMatch", function () {
    beforeEach(async function () {
      await register(alice);
      await register(bob);
      await register(carol);
    });

    async function close(a: HardhatEthersSigner, b: HardhatEthersSigner): Promise<boolean> {
      await measure("isCloseMatch", ladder.connect(server).isCloseMatch(a.address, b.address));
      const handle = await ladder.closeCheck(b.address, a.address);
      return fhevm.userDecryptEbool(handle, address, server);
    }

    it("tells the operator yes or no, never the ratings", async function () {
      await ladder.setRatingForTest(alice.address, 1400);
      await ladder.setRatingForTest(bob.address, 1599);
      await ladder.setRatingForTest(carol.address, 1600);
      expect(await close(alice, bob)).to.eq(true); // gap 199
      expect(await close(alice, carol)).to.eq(false); // gap 200
      expect(await close(carol, alice)).to.eq(false);
      expect(await close(bob, carol)).to.eq(true);
      // The operator cannot read the ratings behind the answer.
      for (const who of [alice, bob]) {
        await expect(fhevm.userDecryptEuint(FhevmType.euint16, await ladder.ratingOf(who.address), address, server)).to.be.rejected;
      }
      // Players cannot read the answer.
      const handle = await ladder.closeCheck(alice.address, bob.address);
      await expect(fhevm.userDecryptEbool(handle, address, alice)).to.be.rejected;
    });

    it("is operator only, between two distinct registered players", async function () {
      await expect(ladder.connect(alice).isCloseMatch(alice.address, bob.address)).to.be.revertedWithCustomError(ladder, "NotOperator");
      await expect(ladder.connect(server).isCloseMatch(alice.address, alice.address)).to.be.revertedWithCustomError(ladder, "SamePlayer");
      await expect(ladder.connect(server).isCloseMatch(alice.address, eve.address)).to.be.revertedWithCustomError(ladder, "NotRegistered");
      await expect(ladder.connect(server).isCloseMatch(alice.address, bob.address)).to.emit(ladder, "CloseChecked");
    });
  });

  describe("sealed matches (winner from SkirmMatch)", function () {
    let credits: ConfidentialSkirmCredits;
    let game: SkirmMatch;
    let gameAddress: string;
    const SEALED = matchKey("mat_sealed_ladder");

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
      credits = await (await ethers.getContractFactory("ConfidentialSkirmCredits")).deploy(owner.address, 0n, 0n);
      game = await (await ethers.getContractFactory("SkirmMatch")).deploy(await credits.getAddress(), server.address, ethers.ZeroAddress, 0);
      gameAddress = await game.getAddress();
      ladder = await (await ethers.getContractFactory("PrivateLadderHarness")).deploy(gameAddress, server.address, WINDOW);
      address = await ladder.getAddress();
      await register(alice);
      await register(bob);
      await (await game.connect(alice).createMatch(SEALED, alice.address, bob.address, 600n, 0n)).wait();
      await seal(alice, 0);
      await seal(bob, 1);
      await (await game.reveal(SEALED)).wait();
      const res = await fhevm.publicDecrypt([...(await game.revealHandles(SEALED))]);
      await (await game.finalizeReveal(SEALED, res.abiEncodedClearValues, res.decryptionProof)).wait();
    });

    it("waits for the settlement, then takes its winner (anyone can report)", async function () {
      await expect(ladder.connect(eve).report(SEALED, alice.address, bob.address, 0)).to.be.revertedWithCustomError(ladder, "MatchNotSettled");
      await (await game.connect(server).settle(SEALED, 1, LOG_HASH)).wait();
      await expect(ladder.connect(eve).report(SEALED, bob.address, alice.address, 0)).to.be.revertedWithCustomError(ladder, "WrongPlayers");
      const [a0, b0] = [await ratingOf(alice), await ratingOf(bob)];
      // The caller claims A won; the chain says B.
      await expect(measure("report (from SkirmMatch)", ladder.connect(eve).report(SEALED, alice.address, bob.address, 0)))
        .to.emit(ladder, "Reported")
        .withArgs(SEALED, alice.address, bob.address, 1, true);
      expect(await ratingOf(alice)).to.be.lt(a0);
      expect(await ratingOf(bob)).to.be.gt(b0);
      await expect(ladder.connect(server).report(SEALED, alice.address, bob.address, 1)).to.be.revertedWithCustomError(ladder, "AlreadyReported");
    });
  });
});
