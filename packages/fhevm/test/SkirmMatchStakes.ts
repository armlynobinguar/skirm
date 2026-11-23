import { FhevmType } from "@fhevm/hardhat-plugin";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import { ethers, fhevm } from "hardhat";

import type { ConfidentialSkirmCredits, SkirmMatch } from "../types";

const UNIT = 10n ** 6n; // cSKIRM has 6 decimals
const FAUCET = 1_000n * UNIT;
const MIN_STAKE = 10n * UNIT;
const FEE_BPS = 250; // 2.5% of the matched pot
const LOCK_WINDOW = 10n * 60n;
const SETTLE_TIMEOUT = 24n * 60n * 60n;
const LOG_HASH = ethers.keccak256(ethers.toUtf8Bytes("final log head"));

const Status = { Open: 1n, Locked: 2n, Revealed: 4n, Forfeited: 5n, Cancelled: 6n, Settled: 7n };
const NO_SIDE = 255;

const matchKey = (offchainId: string) => ethers.keccak256(ethers.toUtf8Bytes(offchainId));

describe("SkirmMatch stakes", function () {
  let owner: HardhatEthersSigner;
  let alice: HardhatEthersSigner;
  let bob: HardhatEthersSigner;
  let eve: HardhatEthersSigner;
  let server: HardhatEthersSigner;
  let treasury: HardhatEthersSigner;
  let credits: ConfidentialSkirmCredits;
  let creditsAddress: string;
  let game: SkirmMatch;
  let gameAddress: string;
  const id = matchKey("staked-match");

  /** Seals a fixed loadout for `side` with an encrypted `stake` in the same input proof. */
  async function seal(player: HardhatEthersSigner, side: number, stake: bigint, matchId = id) {
    const input = fhevm.createEncryptedInput(gameAddress, player.address);
    for (let i = 0; i < 9; i++) input.add8(i % 3);
    input.add64(stake);
    const enc = await input.encrypt();
    const h = enc.handles;
    return game
      .connect(player)
      .submitLoadout(matchId, side, [h[0]!, h[1]!, h[2]!], [h[3]!, h[4]!, h[5]!], [h[6]!, h[7]!, h[8]!], h[9]!, enc.inputProof);
  }

  /** Makes the game a cSKIRM operator for `player` (the one-time approval the web asks for). */
  async function approve(player: HardhatEthersSigner) {
    const until = (await time.latest()) + 3600;
    await (await credits.connect(player).setOperator(gameAddress, until)).wait();
  }

  async function balanceOf(player: HardhatEthersSigner): Promise<bigint> {
    const handle = await credits.confidentialBalanceOf(player.address);
    if (handle === ethers.ZeroHash) return 0n;
    return fhevm.userDecryptEuint(FhevmType.euint64, handle, creditsAddress, player);
  }

  const decrypt64 = (handle: string, who: HardhatEthersSigner) => fhevm.userDecryptEuint(FhevmType.euint64, handle, gameAddress, who);

  async function revealAndFinalize(matchId = id) {
    await (await game.reveal(matchId)).wait();
    const res = await fhevm.publicDecrypt([...(await game.revealHandles(matchId))]);
    return game.finalizeReveal(matchId, res.abiEncodedClearValues, res.decryptionProof);
  }

  /** Both approve and seal their stakes, then the reveal is finalized. */
  async function playUntilRevealed(stakeA: bigint, stakeB: bigint, matchId = id) {
    await approve(alice);
    await approve(bob);
    await seal(alice, 0, stakeA, matchId);
    await seal(bob, 1, stakeB, matchId);
    return (await revealAndFinalize(matchId)).wait();
  }

  before(async function () {
    [owner, alice, bob, eve, server, treasury] = await ethers.getSigners();
  });

  beforeEach(async function () {
    if (!fhevm.isMock) {
      console.warn("SkirmMatch stake tests need the FHEVM mock (hardhat network)");
      this.skip();
    }
    credits = await (await ethers.getContractFactory("ConfidentialSkirmCredits")).deploy(owner.address, FAUCET, 0n);
    creditsAddress = await credits.getAddress();
    game = await (await ethers.getContractFactory("SkirmMatch")).deploy(creditsAddress, server.address, treasury.address, FEE_BPS);
    gameAddress = await game.getAddress();
    for (const p of [alice, bob]) await (await credits.connect(p).claimFaucet()).wait();
    await game.connect(alice).createMatch(id, alice.address, bob.address, LOCK_WINDOW, MIN_STAKE);
  });

  describe("deployment", function () {
    it("records the token, operator, treasury and fee, and validates them", async function () {
      expect(await game.credits()).to.eq(creditsAddress);
      expect(await game.operator()).to.eq(server.address);
      expect(await game.treasury()).to.eq(treasury.address);
      expect(await game.feeBps()).to.eq(BigInt(FEE_BPS));
      const factory = await ethers.getContractFactory("SkirmMatch");
      await expect(factory.deploy(ethers.ZeroAddress, server.address, treasury.address, 0)).to.be.revertedWithCustomError(game, "ZeroAddress");
      await expect(factory.deploy(creditsAddress, ethers.ZeroAddress, treasury.address, 0)).to.be.revertedWithCustomError(game, "ZeroAddress");
      await expect(factory.deploy(creditsAddress, server.address, treasury.address, 1001)).to.be.revertedWithCustomError(game, "InvalidFee");
    });

    it("lets only the owner change the operator and the fee", async function () {
      await expect(game.connect(eve).setOperator(eve.address)).to.be.revertedWithCustomError(game, "OwnableUnauthorizedAccount");
      await expect(game.connect(eve).setFee(eve.address, 0)).to.be.revertedWithCustomError(game, "OwnableUnauthorizedAccount");
      await expect(game.setOperator(eve.address)).to.emit(game, "OperatorSet").withArgs(eve.address);
      await expect(game.setFee(eve.address, 100)).to.emit(game, "FeeSet").withArgs(eve.address, 100);
      await expect(game.setFee(eve.address, 1001)).to.be.revertedWithCustomError(game, "InvalidFee");
    });
  });

  describe("staking on seal", function () {
    it("pulls the encrypted stake through operator approval; only the staker can read it", async function () {
      await approve(alice);
      await expect(seal(alice, 0, 100n * UNIT)).to.emit(game, "StakeLocked");
      expect(await balanceOf(alice)).to.eq(FAUCET - 100n * UNIT);

      const e = await game.escrow(id);
      expect(e.minStake).to.eq(MIN_STAKE);
      expect(e.matchFeeBps).to.eq(BigInt(FEE_BPS));
      expect(await decrypt64(e.staked[0], alice)).to.eq(100n * UNIT);
      expect(await fhevm.userDecryptEbool(e.stakeOk[0], gameAddress, alice)).to.eq(true);
      // The rival and a spectator see a handle, never the amount.
      await expect(decrypt64(e.staked[0], bob)).to.be.rejected;
      await expect(decrypt64(e.staked[0], eve)).to.be.rejected;
      await expect(fhevm.userDecryptEbool(e.stakeOk[0], gameAddress, bob)).to.be.rejected;
    });

    it("reverts a staked seal without operator approval", async function () {
      await expect(seal(alice, 0, 100n * UNIT)).to.be.revertedWithCustomError(credits, "ERC7984UnauthorizedSpender");
    });

    it("treats a stake above the balance as not locked, revealing only the flag", async function () {
      await approve(alice);
      await approve(bob);
      // Bob asks for more than he holds: ERC-7984 moves 0 and the seal still goes through.
      await seal(alice, 0, 50n * UNIT);
      await expect(seal(bob, 1, 5_000n * UNIT)).to.not.be.reverted;
      const e = await game.escrow(id);
      expect(await decrypt64(e.staked[1], bob)).to.eq(0n);
      expect(await balanceOf(bob)).to.eq(FAUCET);

      const tx = await revealAndFinalize();
      await expect(tx).to.emit(game, "StakeChecked").withArgs(id, 0, true);
      await expect(tx).to.emit(game, "StakeChecked").withArgs(id, 1, false);
      expect((await game.escrow(id)).stakeOkClear).to.deep.eq([true, false]);
      // The amounts stay sealed after the reveal: only the yes/no flag became public.
      await expect(fhevm.publicDecrypt([e.staked[0]])).to.be.rejected;

      // Bob does not count as locked: whoever wins, the pot is 0 and both get their stake back.
      await (await game.connect(server).settle(id, 1, LOG_HASH)).wait();
      expect(await balanceOf(alice)).to.eq(FAUCET);
      expect(await balanceOf(bob)).to.eq(FAUCET);
    });

    it("treats a stake under the minimum as not locked and refunds it", async function () {
      await playUntilRevealed(5n * UNIT, 40n * UNIT);
      expect((await game.escrow(id)).stakeOkClear).to.deep.eq([false, true]);
      await (await game.connect(server).settle(id, 0, LOG_HASH)).wait();
      expect(await balanceOf(alice)).to.eq(FAUCET);
      expect(await balanceOf(bob)).to.eq(FAUCET);
    });
  });

  describe("settle", function () {
    it("pays the matched pot to the winner minus the fee, and the loser's excess back", async function () {
      await playUntilRevealed(100n * UNIT, 150n * UNIT);
      await expect(game.connect(server).settle(id, 0, LOG_HASH)).to.emit(game, "MatchSettled").withArgs(id, 0, LOG_HASH);

      // Matched pot 2 x 100, fee 2.5% of it = 5. Alice: 100 + 100 - 5; Bob: 150 - 100 back.
      expect(await balanceOf(alice)).to.eq(FAUCET + 95n * UNIT);
      expect(await balanceOf(bob)).to.eq(FAUCET - 100n * UNIT);
      expect(await balanceOf(treasury)).to.eq(5n * UNIT);
      expect(await balanceOf(eve)).to.eq(0n);

      const e = await game.escrow(id);
      expect(await decrypt64(e.paid[0], alice)).to.eq(195n * UNIT);
      expect(await decrypt64(e.paid[1], bob)).to.eq(50n * UNIT);
      // Each payout only decrypts for its recipient.
      await expect(decrypt64(e.paid[0], bob)).to.be.rejected;
      await expect(decrypt64(e.paid[1], eve)).to.be.rejected;
      await expect(decrypt64(e.matched, alice)).to.be.rejected;
    });

    it("refunds both stakes on a draw", async function () {
      await playUntilRevealed(100n * UNIT, 30n * UNIT);
      await (await game.connect(server).settle(id, NO_SIDE, LOG_HASH)).wait();
      expect(await balanceOf(alice)).to.eq(FAUCET);
      expect(await balanceOf(bob)).to.eq(FAUCET);
      expect(await balanceOf(treasury)).to.eq(0n);
    });

    it("stores the anchored log hash and the result", async function () {
      await playUntilRevealed(20n * UNIT, 20n * UNIT);
      const tx = await game.connect(server).settle(id, 1, LOG_HASH);
      const s = await game.settlement(id);
      expect(s.logHash).to.eq(LOG_HASH);
      expect(s.winner).to.eq(1n);
      expect(s.settledAt).to.eq(BigInt((await ethers.provider.getBlock(tx.blockNumber!))!.timestamp));
      const m = await game.getMatch(id);
      expect(m.status).to.eq(Status.Settled);
      expect(m.winner).to.eq(1n);
    });

    it("reverts for anyone but the operator", async function () {
      await playUntilRevealed(20n * UNIT, 20n * UNIT);
      for (const who of [alice, bob, eve, owner]) {
        await expect(game.connect(who).settle(id, 0, LOG_HASH)).to.be.revertedWithCustomError(game, "NotOperator").withArgs(who.address);
      }
    });

    it("reverts a second settlement", async function () {
      await playUntilRevealed(20n * UNIT, 20n * UNIT);
      await (await game.connect(server).settle(id, 0, LOG_HASH)).wait();
      await expect(game.connect(server).settle(id, 1, LOG_HASH)).to.be.revertedWithCustomError(game, "WrongStatus").withArgs(Status.Settled);
      expect((await game.settlement(id)).winner).to.eq(0n);
    });

    it("reverts before the reveal, on a bad winner and on an empty log hash", async function () {
      await approve(alice);
      await seal(alice, 0, 20n * UNIT);
      await expect(game.connect(server).settle(id, 0, LOG_HASH)).to.be.revertedWithCustomError(game, "WrongStatus").withArgs(Status.Open);
      await approve(bob);
      await seal(bob, 1, 20n * UNIT);
      await (await revealAndFinalize()).wait();
      await expect(game.connect(server).settle(id, 2, LOG_HASH)).to.be.revertedWithCustomError(game, "InvalidWinner").withArgs(2);
      await expect(game.connect(server).settle(id, 0, ethers.ZeroHash)).to.be.revertedWithCustomError(game, "InvalidLogHash");
    });

    it("anchors the log hash of an unstaked match without moving tokens", async function () {
      const free = matchKey("friendly");
      await game.connect(alice).createMatch(free, alice.address, bob.address, LOCK_WINDOW, 0n);
      await seal(alice, 0, 100n * UNIT, free); // no approval needed: the stake input is ignored
      await seal(bob, 1, 0n, free);
      await (await revealAndFinalize(free)).wait();
      expect((await game.escrow(free)).stakeOkClear).to.deep.eq([true, true]);
      await expect(game.connect(server).settle(free, 0, LOG_HASH)).to.not.emit(game, "StakePaid");
      expect((await game.settlement(free)).logHash).to.eq(LOG_HASH);
      expect(await balanceOf(alice)).to.eq(FAUCET);
    });
  });

  describe("forfeit and cancel", function () {
    it("gives the locked side the pot (its own stake) on a forfeit", async function () {
      await approve(bob);
      await seal(bob, 1, 80n * UNIT);
      expect(await balanceOf(bob)).to.eq(FAUCET - 80n * UNIT);
      await time.increase(LOCK_WINDOW + 1n);
      await expect(game.connect(eve).forfeit(id)).to.emit(game, "StakePaid");
      expect(await balanceOf(bob)).to.eq(FAUCET);
      expect(await decrypt64((await game.escrow(id)).paid[1], bob)).to.eq(80n * UNIT);
    });

    it("cancels a match with no seal without moving tokens", async function () {
      await time.increase(LOCK_WINDOW + 1n);
      await expect(game.forfeit(id)).to.emit(game, "MatchCancelled").and.to.not.emit(game, "StakePaid");
    });

    it("refunds both stakes when nobody settles in time", async function () {
      await playUntilRevealed(100n * UNIT, 60n * UNIT);
      await expect(game.connect(eve).refundUnsettled(id)).to.be.revertedWithCustomError(game, "SettleStillOpen");
      await time.increase(LOCK_WINDOW + SETTLE_TIMEOUT + 1n);
      await expect(game.connect(eve).refundUnsettled(id)).to.emit(game, "MatchCancelled").withArgs(id);
      expect((await game.getMatch(id)).status).to.eq(Status.Cancelled);
      expect(await balanceOf(alice)).to.eq(FAUCET);
      expect(await balanceOf(bob)).to.eq(FAUCET);
      await expect(game.connect(server).settle(id, 0, LOG_HASH)).to.be.revertedWithCustomError(game, "WrongStatus").withArgs(Status.Cancelled);
      await expect(game.refundUnsettled(id)).to.be.revertedWithCustomError(game, "WrongStatus").withArgs(Status.Cancelled);
    });
  });
});
