import { FhevmType } from "@fhevm/hardhat-plugin";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import { ethers, fhevm } from "hardhat";

import type { SkirmMatch } from "../types";

const LOCK_WINDOW = 10n * 60n; // ten minutes

/** Status enum values, as the contract numbers them. */
const Status = { None: 0n, Open: 1n, Locked: 2n, Revealing: 3n, Revealed: 4n, Forfeited: 5n, Cancelled: 6n };

interface Loadout {
  agents: [number, number, number];
  skills: [number, number, number];
  tiers: [number, number, number];
}

const LOADOUT_A: Loadout = { agents: [2, 5, 0], skills: [0b11, 0b1, 0], tiers: [1, 2, 0] };
const LOADOUT_B: Loadout = { agents: [1, 3, 4], skills: [0b1, 0b101, 0b10], tiers: [0, 1, 1] };

const matchKey = (offchainId: string) => ethers.keccak256(ethers.toUtf8Bytes(offchainId));

describe("SkirmMatch", function () {
  let alice: HardhatEthersSigner;
  let bob: HardhatEthersSigner;
  let eve: HardhatEthersSigner;
  let game: SkirmMatch;
  let gameAddress: string;
  const id = matchKey("6f9c2a5e-3d41-4b8e-9a77-0c1d2e3f4a5b");

  /** Encrypts a loadout for `player` and submits it for `side`. */
  async function seal(player: HardhatEthersSigner, side: number, l: Loadout, matchId = id) {
    const input = fhevm.createEncryptedInput(gameAddress, player.address);
    for (const v of [...l.agents, ...l.skills, ...l.tiers]) input.add8(v);
    input.add64(0);
    const enc = await input.encrypt();
    const h = enc.handles;
    return game
      .connect(player)
      .submitLoadout(matchId, side, [h[0]!, h[1]!, h[2]!], [h[3]!, h[4]!, h[5]!], [h[6]!, h[7]!, h[8]!], h[9]!, enc.inputProof);
  }

  async function decryptAs(player: HardhatEthersSigner, handle: string): Promise<bigint> {
    return fhevm.userDecryptEuint(FhevmType.euint8, handle, gameAddress, player);
  }

  /** Runs reveal + relayer public decryption + finalizeReveal. */
  async function revealAndFinalize(matchId = id) {
    await (await game.reveal(matchId)).wait();
    const handles = await game.revealHandles(matchId);
    const res = await fhevm.publicDecrypt([...handles]);
    return game.finalizeReveal(matchId, res.abiEncodedClearValues, res.decryptionProof);
  }

  before(async function () {
    [alice, bob, eve] = await ethers.getSigners();
  });

  beforeEach(async function () {
    if (!fhevm.isMock) {
      console.warn("SkirmMatch tests need the FHEVM mock (hardhat network)");
      this.skip();
    }
    // Unstaked matches (minStake 0) never touch the token; the stake escrow has its own suite.
    const credits = await (await ethers.getContractFactory("ConfidentialSkirmCredits")).deploy(alice.address, 0n, 0n);
    const factory = await ethers.getContractFactory("SkirmMatch");
    game = await factory.deploy(await credits.getAddress(), eve.address, ethers.ZeroAddress, 0);
    gameAddress = await game.getAddress();
  });

  describe("createMatch", function () {
    it("records both players, the deadline and the open status", async function () {
      const tx = await game.connect(alice).createMatch(id, alice.address, bob.address, LOCK_WINDOW, 0n);
      const deadline = BigInt(await time.latest()) + LOCK_WINDOW;
      await expect(tx).to.emit(game, "MatchCreated").withArgs(id, alice.address, bob.address, deadline);

      const m = await game.getMatch(id);
      expect(m.players).to.deep.eq([alice.address, bob.address]);
      expect(m.lockDeadline).to.eq(deadline);
      expect(m.status).to.eq(Status.Open);
      expect(m.locked).to.deep.eq([false, false]);
      expect(m.winner).to.eq(await game.NO_SIDE());
    });

    it("rejects a duplicate id, a bad window and fixed seats the creator is not in", async function () {
      await game.connect(alice).createMatch(id, alice.address, bob.address, LOCK_WINDOW, 0n);
      await expect(game.connect(bob).createMatch(id, alice.address, bob.address, LOCK_WINDOW, 0n))
        .to.be.revertedWithCustomError(game, "MatchExists")
        .withArgs(id);

      const other = matchKey("other");
      await expect(game.connect(eve).createMatch(other, alice.address, bob.address, LOCK_WINDOW, 0n)).to.be.revertedWithCustomError(
        game,
        "InvalidPlayers",
      );
      await expect(game.connect(alice).createMatch(other, alice.address, alice.address, LOCK_WINDOW, 0n)).to.be.revertedWithCustomError(
        game,
        "InvalidPlayers",
      );
      await expect(game.connect(alice).createMatch(other, alice.address, bob.address, 10n, 0n))
        .to.be.revertedWithCustomError(game, "InvalidLockWindow")
        .withArgs(10n);
    });
  });

  describe("submitLoadout", function () {
    beforeEach(async function () {
      await game.connect(alice).createMatch(id, alice.address, bob.address, LOCK_WINDOW, 0n);
    });

    it("stores encrypted handles and marks the side locked", async function () {
      await expect(seal(alice, 0, LOADOUT_A)).to.emit(game, "LoadoutSealed").withArgs(id, 0, alice.address);
      const m = await game.getMatch(id);
      expect(m.locked).to.deep.eq([true, false]);
      expect(m.status).to.eq(Status.Open);

      const handles = await game.sealedLoadout(id, 0);
      for (const h of handles) expect(h).to.not.eq(ethers.ZeroHash);
      // The plaintext is nowhere in the public state: only the revealed view, still zero.
      const revealed = await game.revealedLoadout(id, 0);
      expect(revealed.agents).to.deep.eq([0n, 0n, 0n]);
    });

    it("lets the player user-decrypt its own loadout but not the rival's before reveal", async function () {
      await seal(alice, 0, LOADOUT_A);
      await seal(bob, 1, LOADOUT_B);
      const aliceHandles = await game.sealedLoadout(id, 0);
      const bobHandles = await game.sealedLoadout(id, 1);

      // One at a time: the mock coprocessor does not support concurrent decrypt requests.
      const mine: bigint[] = [];
      for (const h of aliceHandles) mine.push(await decryptAs(alice, h));
      expect(mine.map(Number)).to.deep.eq([...LOADOUT_A.agents, ...LOADOUT_A.skills, ...LOADOUT_A.tiers]);

      await expect(decryptAs(alice, bobHandles[0]!)).to.be.rejected;
      await expect(decryptAs(bob, aliceHandles[0]!)).to.be.rejected;
      await expect(decryptAs(eve, aliceHandles[0]!)).to.be.rejected;
    });

    it("reverts a second submission for the same side", async function () {
      await seal(alice, 0, LOADOUT_A);
      await expect(seal(alice, 0, LOADOUT_B)).to.be.revertedWithCustomError(game, "AlreadySealed").withArgs(0);
    });

    it("reverts a submission from someone who is not that side's player", async function () {
      await expect(seal(eve, 0, LOADOUT_A)).to.be.revertedWithCustomError(game, "NotPlayer").withArgs(eve.address);
      await expect(seal(alice, 1, LOADOUT_A)).to.be.revertedWithCustomError(game, "NotPlayer").withArgs(alice.address);
      await expect(seal(alice, 2, LOADOUT_A)).to.be.revertedWithCustomError(game, "InvalidSide").withArgs(2);
    });

    it("reverts an encrypted input made for another sender", async function () {
      const input = fhevm.createEncryptedInput(gameAddress, eve.address);
      for (let i = 0; i < 9; i++) input.add8(1);
      input.add64(0);
      const enc = await input.encrypt();
      const h = enc.handles;
      await expect(
        game.connect(alice).submitLoadout(id, 0, [h[0]!, h[1]!, h[2]!], [h[3]!, h[4]!, h[5]!], [h[6]!, h[7]!, h[8]!], h[9]!, enc.inputProof),
      ).to.be.reverted;
    });

    it("reverts after the lock deadline", async function () {
      await time.increase(LOCK_WINDOW + 1n);
      await expect(seal(alice, 0, LOADOUT_A)).to.be.revertedWithCustomError(game, "LockClosed");
    });

    it("moves to Locked once both sides sealed", async function () {
      await seal(alice, 0, LOADOUT_A);
      await expect(seal(bob, 1, LOADOUT_B)).to.emit(game, "BothLocked").withArgs(id);
      expect((await game.getMatch(id)).status).to.eq(Status.Locked);
    });
  });

  describe("open seats", function () {
    it("gives each open seat to its first submitter, never both to one account", async function () {
      await game.connect(eve).createMatch(id, ethers.ZeroAddress, ethers.ZeroAddress, LOCK_WINDOW, 0n);
      await seal(alice, 0, LOADOUT_A);
      await expect(seal(alice, 1, LOADOUT_B)).to.be.revertedWithCustomError(game, "NotPlayer");
      await seal(bob, 1, LOADOUT_B);
      expect((await game.getMatch(id)).players).to.deep.eq([alice.address, bob.address]);
    });
  });

  describe("reveal", function () {
    beforeEach(async function () {
      await game.connect(alice).createMatch(id, alice.address, bob.address, LOCK_WINDOW, 0n);
    });

    it("reverts before both sides locked", async function () {
      await expect(game.reveal(id)).to.be.revertedWithCustomError(game, "WrongStatus").withArgs(Status.Open);
      await seal(alice, 0, LOADOUT_A);
      await expect(game.reveal(id)).to.be.revertedWithCustomError(game, "WrongStatus").withArgs(Status.Open);
      await expect(game.reveal(matchKey("nope"))).to.be.revertedWithCustomError(game, "UnknownMatch");
    });

    it("stores and emits the correct plaintexts once both locked", async function () {
      await seal(alice, 0, LOADOUT_A);
      await seal(bob, 1, LOADOUT_B);

      // Anyone can trigger the reveal.
      await expect(game.connect(eve).reveal(id)).to.emit(game, "RevealRequested");
      expect((await game.getMatch(id)).status).to.eq(Status.Revealing);

      const handles = await game.revealHandles(id);
      expect(handles.length).to.eq(21);
      const res = await fhevm.publicDecrypt([...handles]);
      const tx = game.connect(eve).finalizeReveal(id, res.abiEncodedClearValues, res.decryptionProof);
      await expect(tx).to.emit(game, "LoadoutRevealed").withArgs(id, 0, LOADOUT_A.agents, LOADOUT_A.skills, LOADOUT_A.tiers);
      await expect(tx).to.emit(game, "LoadoutRevealed").withArgs(id, 1, LOADOUT_B.agents, LOADOUT_B.skills, LOADOUT_B.tiers);

      expect((await game.getMatch(id)).status).to.eq(Status.Revealed);
      const a = await game.revealedLoadout(id, 0);
      const b = await game.revealedLoadout(id, 1);
      expect(a.agents.map(Number)).to.deep.eq(LOADOUT_A.agents);
      expect(a.skills.map(Number)).to.deep.eq(LOADOUT_A.skills);
      expect(a.tiers.map(Number)).to.deep.eq(LOADOUT_A.tiers);
      expect(b.agents.map(Number)).to.deep.eq(LOADOUT_B.agents);
      expect(b.skills.map(Number)).to.deep.eq(LOADOUT_B.skills);
      expect(b.tiers.map(Number)).to.deep.eq(LOADOUT_B.tiers);

      // After the reveal the rival's picks are public: a third party can decrypt them too.
      expect(await fhevm.publicDecryptEuint(FhevmType.euint8, handles[9]!)).to.eq(BigInt(LOADOUT_B.agents[0]));
    });

    it("rejects clear values that do not match the KMS proof", async function () {
      await seal(alice, 0, LOADOUT_A);
      await seal(bob, 1, LOADOUT_B);
      await (await game.reveal(id)).wait();
      const handles = await game.revealHandles(id);
      const res = await fhevm.publicDecrypt([...handles]);
      const forged = ethers.AbiCoder.defaultAbiCoder().encode(["uint256[21]"], [Array.from({ length: 21 }, () => 1n)]);
      await expect(game.finalizeReveal(id, forged, res.decryptionProof)).to.be.reverted;
      expect((await game.getMatch(id)).status).to.eq(Status.Revealing);
    });

    it("cannot be revealed or finalized twice", async function () {
      await seal(alice, 0, LOADOUT_A);
      await seal(bob, 1, LOADOUT_B);
      await (await revealAndFinalize()).wait();
      await expect(game.reveal(id)).to.be.revertedWithCustomError(game, "WrongStatus").withArgs(Status.Revealed);
    });
  });

  describe("forfeit", function () {
    beforeEach(async function () {
      await game.connect(alice).createMatch(id, alice.address, bob.address, LOCK_WINDOW, 0n);
    });

    it("reverts while the lock is still open", async function () {
      await seal(alice, 0, LOADOUT_A);
      await expect(game.forfeit(id)).to.be.revertedWithCustomError(game, "LockStillOpen");
    });

    it("awards the match to the only side that locked once the deadline passed", async function () {
      await seal(bob, 1, LOADOUT_B);
      await time.increase(LOCK_WINDOW + 1n);
      await expect(game.connect(eve).forfeit(id)).to.emit(game, "MatchForfeited").withArgs(id, 1);
      const m = await game.getMatch(id);
      expect(m.status).to.eq(Status.Forfeited);
      expect(m.winner).to.eq(1n);
      // The forfeiting side's loadout never gets revealed.
      await expect(game.reveal(id)).to.be.revertedWithCustomError(game, "WrongStatus").withArgs(Status.Forfeited);
    });

    it("cancels the match when neither side locked", async function () {
      await time.increase(LOCK_WINDOW + 1n);
      await expect(game.forfeit(id)).to.emit(game, "MatchCancelled").withArgs(id);
      expect((await game.getMatch(id)).status).to.eq(Status.Cancelled);
    });

    it("does not apply once both sides locked", async function () {
      await seal(alice, 0, LOADOUT_A);
      await seal(bob, 1, LOADOUT_B);
      await time.increase(LOCK_WINDOW + 1n);
      await expect(game.forfeit(id)).to.be.revertedWithCustomError(game, "WrongStatus").withArgs(Status.Locked);
    });
  });
  describe("randomness", function () {
    const DROP_INTERVAL = 60n;

    beforeEach(async function () {
      await game.connect(alice).createMatch(id, alice.address, bob.address, LOCK_WINDOW, 0n);
    });

    /** Both seal, reveal and finalize; resolves to the finalize receipt. */
    async function startMatch(matchId = id) {
      await seal(alice, 0, LOADOUT_A, matchId);
      await seal(bob, 1, LOADOUT_B, matchId);
      return (await revealAndFinalize(matchId)).wait();
    }

    /** revealDrop + relayer public decryption + finalizeDrop for one slot. */
    async function revealDrop(slot: number, matchId = id) {
      await (await game.connect(eve).revealDrop(matchId, slot)).wait();
      const r = await game.randomness(matchId);
      const res = await fhevm.publicDecrypt([r.dropHandles[slot]!]);
      return game.connect(eve).finalizeDrop(matchId, slot, res.abiEncodedClearValues, res.decryptionProof);
    }

    it("draws the seed and drop values only once both loadouts are sealed", async function () {
      await seal(alice, 0, LOADOUT_A);
      let r = await game.randomness(id);
      expect(r.seedHandle).to.eq(ethers.ZeroHash);
      for (const h of r.dropHandles) expect(h).to.eq(ethers.ZeroHash);

      await expect(seal(bob, 1, LOADOUT_B)).to.emit(game, "RandomnessDrawn");
      r = await game.randomness(id);
      expect(r.seedHandle).to.not.eq(ethers.ZeroHash);
      for (const h of r.dropHandles) expect(h).to.not.eq(ethers.ZeroHash);
      expect(new Set(r.dropHandles).size).to.eq(3);
      expect(r.seed).to.eq(0n);
      expect(r.startedAt).to.eq(0n);
    });

    it("keeps the seed and drops sealed from players and outsiders before the reveal", async function () {
      await seal(alice, 0, LOADOUT_A);
      await seal(bob, 1, LOADOUT_B);
      const r = await game.randomness(id);
      for (const who of [alice, bob, eve]) {
        await expect(fhevm.userDecryptEuint(FhevmType.euint64, r.seedHandle, gameAddress, who)).to.be.rejected;
        await expect(fhevm.userDecryptEuint(FhevmType.euint16, r.dropHandles[0]!, gameAddress, who)).to.be.rejected;
      }
      await expect(fhevm.publicDecrypt([r.seedHandle])).to.be.rejected;
      await expect(fhevm.publicDecrypt([r.dropHandles[0]!])).to.be.rejected;
    });

    it("reveals the seed with the loadouts, checked against the KMS proof", async function () {
      await seal(alice, 0, LOADOUT_A);
      await seal(bob, 1, LOADOUT_B);
      await (await game.reveal(id)).wait();
      const handles = await game.revealHandles(id);
      const r = await game.randomness(id);
      expect(handles[18]).to.eq(r.seedHandle);

      const res = await fhevm.publicDecrypt([...handles]);
      const clear = ethers.AbiCoder.defaultAbiCoder().decode(["uint256[21]"], res.abiEncodedClearValues)[0] as bigint[];
      const tx = await game.finalizeReveal(id, res.abiEncodedClearValues, res.decryptionProof);
      const startedAt = BigInt(await time.latest());
      await expect(tx).to.emit(game, "SeedRevealed").withArgs(id, clear[18], startedAt);

      const after = await game.randomness(id);
      expect(after.seed).to.eq(clear[18]);
      expect(after.startedAt).to.eq(startedAt);
      // Anyone can re-check the published seed against the handle.
      expect(await fhevm.publicDecryptEuint(FhevmType.euint64, r.seedHandle)).to.eq(after.seed);
      // The drops stay sealed while the seed is public.
      await expect(fhevm.publicDecrypt([r.dropHandles[0]!])).to.be.rejected;
    });

    it("rejects a forged seed under a valid proof", async function () {
      await seal(alice, 0, LOADOUT_A);
      await seal(bob, 1, LOADOUT_B);
      await (await game.reveal(id)).wait();
      const handles = await game.revealHandles(id);
      const res = await fhevm.publicDecrypt([...handles]);
      const coder = ethers.AbiCoder.defaultAbiCoder();
      const clear = [...(coder.decode(["uint256[21]"], res.abiEncodedClearValues)[0] as bigint[])];
      clear[18] = (clear[18]! + 1n) % 2n ** 64n;
      await expect(game.finalizeReveal(id, coder.encode(["uint256[21]"], [clear]), res.decryptionProof)).to.be.reverted;
      expect((await game.randomness(id)).seed).to.eq(0n);
    });

    it("opens the drops in order and never before they are due", async function () {
      await expect(game.revealDrop(id, 0)).to.be.revertedWithCustomError(game, "WrongStatus").withArgs(Status.Open);
      await startMatch();
      const { startedAt } = await game.randomness(id);
      expect(await game.dropDueAt(id, 0)).to.eq(startedAt + DROP_INTERVAL);
      expect(await game.dropDueAt(id, 2)).to.eq(startedAt + 3n * DROP_INTERVAL);

      await expect(game.revealDrop(id, 0))
        .to.be.revertedWithCustomError(game, "DropNotDue")
        .withArgs(0, startedAt + DROP_INTERVAL);
      await time.increaseTo(startedAt + 3n * DROP_INTERVAL);
      // Even once all are due, slot 1 waits for slot 0.
      await expect(game.revealDrop(id, 1)).to.be.revertedWithCustomError(game, "DropOutOfOrder").withArgs(1, 0);
      await expect(game.revealDrop(id, 3)).to.be.revertedWithCustomError(game, "InvalidDrop").withArgs(3);

      const values: bigint[] = [];
      for (let slot = 0; slot < 3; slot++) {
        const tx = await revealDrop(slot);
        const r = await game.randomness(id);
        values.push(r.drops[slot]!);
        await expect(tx).to.emit(game, "DropRevealed").withArgs(id, slot, r.drops[slot]);
        expect(r.dropsRevealed).to.eq(BigInt(slot + 1));
        expect(await fhevm.publicDecryptEuint(FhevmType.euint16, r.dropHandles[slot]!)).to.eq(r.drops[slot]);
      }
      await expect(game.revealDrop(id, 2)).to.be.revertedWithCustomError(game, "DropOutOfOrder");
    });

    it("does not open the next drop while the previous one is only requested", async function () {
      await startMatch();
      const { startedAt } = await game.randomness(id);
      await time.increaseTo(startedAt + 2n * DROP_INTERVAL);
      await (await game.revealDrop(id, 0)).wait();
      await expect(game.revealDrop(id, 1)).to.be.revertedWithCustomError(game, "DropOutOfOrder").withArgs(1, 0);
      await expect(game.revealDrop(id, 0)).to.be.revertedWithCustomError(game, "DropOutOfOrder").withArgs(0, 0);
    });

    it("rejects a forged drop value", async function () {
      await startMatch();
      const { startedAt } = await game.randomness(id);
      await time.increaseTo(startedAt + DROP_INTERVAL);
      await (await game.revealDrop(id, 0)).wait();
      const r = await game.randomness(id);
      const res = await fhevm.publicDecrypt([r.dropHandles[0]!]);
      const coder = ethers.AbiCoder.defaultAbiCoder();
      const real = coder.decode(["uint256"], res.abiEncodedClearValues)[0] as bigint;
      const forged = coder.encode(["uint256"], [(real + 1n) % 65536n]);
      await expect(game.finalizeDrop(id, 0, forged, res.decryptionProof)).to.be.reverted;
      await expect(game.finalizeDrop(id, 1, res.abiEncodedClearValues, res.decryptionProof)).to.be.revertedWithCustomError(
        game,
        "DropOutOfOrder",
      );
      expect((await game.randomness(id)).dropsRevealed).to.eq(0n);
    });

    it("draws a different seed for every match", async function () {
      const other = matchKey("second-match");
      await game.connect(alice).createMatch(other, alice.address, bob.address, LOCK_WINDOW, 0n);
      await startMatch();
      await startMatch(other);
      const a = await game.randomness(id);
      const b = await game.randomness(other);
      expect(a.seedHandle).to.not.eq(b.seedHandle);
      expect(a.seed).to.not.eq(b.seed);
    });
  });
});
