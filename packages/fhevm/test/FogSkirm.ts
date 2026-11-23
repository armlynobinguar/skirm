import { FhevmType } from "@fhevm/hardhat-plugin";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import type { ContractTransactionResponse, TransactionReceipt } from "ethers";
import { ethers, fhevm } from "hardhat";

import {
  FOG_NO_TILE,
  fogInitialState,
  fogSenses,
  fogTile,
  replayFogGame,
  resolveFogRound,
  verifyFogGame,
  type FogState,
} from "../../shared/src/fog-skirm";
import type { FogSkirm } from "../types";

const WINDOW = 5n * 60n;
const Status = { None: 0n, Waiting: 1n, Playing: 2n, Ended: 3n, Cancelled: 4n };
const End = { None: 0n, Delivered: 1n, MaxRounds: 2n, Timeout: 3n };
const [STAY, N, E, S, W] = [0, 1, 2, 3, 4];

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

describe("FogSkirm", function () {
  let alice: HardhatEthersSigner;
  let bob: HardhatEthersSigner;
  let eve: HardhatEthersSigner;
  let game: FogSkirm;
  let address: string;

  async function encryptTraps(player: HardhatEthersSigner, traps: [number, number]) {
    const input = fhevm.createEncryptedInput(address, player.address);
    input.add8(traps[0]).add8(traps[1]);
    return input.encrypt();
  }

  async function create(traps: [number, number], opponent = ethers.ZeroAddress, window = WINDOW): Promise<bigint> {
    const id = await game.nextGameId();
    const enc = await encryptTraps(alice, traps);
    await measure("createGame", game.connect(alice).createGame(opponent, window, enc.handles[0]!, enc.handles[1]!, enc.inputProof));
    return id;
  }

  async function join(id: bigint, traps: [number, number], who = bob) {
    const enc = await encryptTraps(who, traps);
    return measure("joinGame", game.connect(who).joinGame(id, enc.handles[0]!, enc.handles[1]!, enc.inputProof));
  }

  function sendMove(id: bigint, player: HardhatEthersSigner, dir: number) {
    const input = fhevm.createEncryptedInput(address, player.address);
    input.add8(dir);
    return input.encrypt().then((enc) => game.connect(player).submitMove(id, enc.handles[0]!, enc.inputProof));
  }

  async function finalize(id: bigint) {
    const handles = await game.roundHandles(id);
    const res = await fhevm.publicDecrypt([...handles]);
    const [, , winner] = ethers.AbiCoder.defaultAbiCoder().decode(["uint256", "uint256", "uint256"], res.abiEncodedClearValues);
    const ends = winner !== 0n || (await game.getGame(id)).round === (await game.MAX_ROUNDS());
    const label = ends ? "finalizeRound (ends, opens board)" : "finalizeRound";
    return measure(label, game.finalizeRound(id, res.abiEncodedClearValues, res.decryptionProof));
  }

  /** One full round: both moves (the second resolves) and the KMS-checked outcome. */
  async function round(id: bigint, d0: number, d1: number) {
    await measure("submitMove (first)", sendMove(id, alice, d0));
    await measure("submitMove (second, resolves)", sendMove(id, bob, d1));
    await finalize(id);
    const g = await game.getGame(id);
    return game.outcome(id, g.roundsPlayed);
  }

  const dec8 = (h: string) => fhevm.debugger.decryptEuint(FhevmType.euint8, h);
  const decAs = (who: HardhatEthersSigner, h: string) => fhevm.userDecryptEuint(FhevmType.euint8, h, address, who);
  const decBoolAs = (who: HardhatEthersSigner, h: string) => fhevm.userDecryptEbool(h, address, who);

  /** The hidden vial column, read with the mock's debugger (no ACL holder can). */
  async function vialCol(id: bigint): Promise<number> {
    const filter = game.filters.GameJoined(id);
    const [ev] = await game.queryFilter(filter);
    return Number(await dec8(ev!.args.vialHandle));
  }

  before(async function () {
    [alice, bob, eve] = await ethers.getSigners();
  });

  beforeEach(async function () {
    if (!fhevm.isMock) {
      console.warn("FogSkirm tests need the FHEVM mock (hardhat network)");
      this.skip();
    }
    game = await (await ethers.getContractFactory("FogSkirm")).deploy();
    address = await game.getAddress();
  });

  after(function () {
    if (report.size === 0) return;
    console.log("\n    FogSkirm gas / HCU (FHEVM mock, worst case seen):");
    for (const [label, r] of report) {
      console.log(`      ${label.padEnd(34)} gas ${r.gas.toString().padStart(9)}   HCU ${String(r.hcu).padStart(9)}   depth ${String(r.depth).padStart(8)}`);
    }
  });

  describe("lobby", function () {
    it("creates a game, lets the invited player join and starts round 1", async function () {
      const id = await create([10, 11], bob.address);
      let g = await game.getGame(id);
      expect(g.status).to.eq(Status.Waiting);
      expect(g.players).to.deep.eq([alice.address, bob.address]);
      await expect(join(id, [5, 6], eve)).to.be.revertedWithCustomError(game, "NotPlayer").withArgs(eve.address);

      const enc = await encryptTraps(bob, [5, 6]);
      const tx = game.connect(bob).joinGame(id, enc.handles[0]!, enc.handles[1]!, enc.inputProof);
      await expect(tx).to.emit(game, "GameJoined");
      g = await game.getGame(id);
      expect(g.status).to.eq(Status.Playing);
      expect(g.round).to.eq(1n);
      expect(g.deadline).to.eq(BigInt(await time.latest()) + WINDOW);
      await expect(join(id, [5, 6])).to.be.revertedWithCustomError(game, "WrongStatus").withArgs(Status.Playing);
    });

    it("rejects a bad window, playing yourself, joining your own game and unknown ids", async function () {
      const enc = await encryptTraps(alice, [10, 11]);
      await expect(game.connect(alice).createGame(ethers.ZeroAddress, 10n, enc.handles[0]!, enc.handles[1]!, enc.inputProof))
        .to.be.revertedWithCustomError(game, "InvalidMoveWindow")
        .withArgs(10n);
      await expect(game.connect(alice).createGame(alice.address, WINDOW, enc.handles[0]!, enc.handles[1]!, enc.inputProof))
        .to.be.revertedWithCustomError(game, "InvalidOpponent")
        .withArgs(alice.address);
      const id = await create([10, 11]);
      await expect(join(id, [5, 6], alice)).to.be.revertedWithCustomError(game, "NotPlayer");
      await expect(join(99n, [5, 6])).to.be.revertedWithCustomError(game, "UnknownGame").withArgs(99n);
    });

    it("lets only the creator cancel, and only before anyone joins", async function () {
      const id = await create([10, 11]);
      await expect(game.connect(bob).cancelGame(id)).to.be.revertedWithCustomError(game, "NotPlayer");
      await expect(game.connect(alice).cancelGame(id)).to.emit(game, "GameCancelled").withArgs(id);
      await expect(join(id, [5, 6])).to.be.revertedWithCustomError(game, "WrongStatus").withArgs(Status.Cancelled);
    });
  });

  describe("hidden state", function () {
    it("keeps traps readable by their planter only and makes an out-of-band trap inert", async function () {
      const id = await create([12, 3]); // 3 is on side 0's own half: inert
      await join(id, [7, 14]);
      const a = await game.playerView(id, 0);
      const b = await game.playerView(id, 1);
      expect(await decAs(alice, a.trapsPlaced[0])).to.eq(12n);
      expect(await decAs(alice, a.trapsPlaced[1])).to.eq(BigInt(FOG_NO_TILE));
      expect(await decAs(bob, b.trapsPlaced[1])).to.eq(14n);
      await expect(decAs(bob, a.trapsPlaced[0])).to.be.rejected;
      await expect(decAs(alice, b.trapsLive[0])).to.be.rejected;
      await expect(decAs(eve, a.trapsLive[0])).to.be.rejected;
    });

    it("draws the vial in the middle row where no one can read it until the end", async function () {
      const id = await create([10, 11]);
      await join(id, [5, 6]);
      const [ev] = await game.queryFilter(game.filters.GameJoined(id));
      const handle = ev!.args.vialHandle;
      expect(Number(await dec8(handle))).to.be.within(0, 4);
      for (const who of [alice, bob, eve]) await expect(decAs(who, handle)).to.be.rejected;
      await expect(fhevm.publicDecrypt([handle])).to.be.rejected;
    });

    it("gives each player its own scout and sense pings, decryptable by that player only", async function () {
      const id = await create([10, 11]);
      await join(id, [5, 6]);
      const col = await vialCol(id);
      const expected = fogSenses(fogInitialState([[10, 11], [5, 6]], col));
      const a = await game.playerView(id, 0);
      const b = await game.playerView(id, 1);
      expect(await decAs(alice, a.tile)).to.eq(2n);
      expect(await decAs(bob, b.tile)).to.eq(22n);
      expect(Number(await decAs(alice, a.senseVial))).to.eq(expected.vial[0]);
      expect(Number(await decAs(bob, b.senseVial))).to.eq(expected.vial[1]);
      expect(Number(await decAs(alice, a.senseRival))).to.eq(expected.rival);
      expect(Number(await decAs(bob, b.senseRival))).to.eq(expected.rival);
      expect(await decBoolAs(alice, a.carrying)).to.eq(false);

      await expect(decAs(bob, a.senseVial)).to.be.rejected;
      await expect(decAs(alice, b.senseVial)).to.be.rejected;
      await expect(decAs(bob, a.tile)).to.be.rejected;
      await expect(decAs(eve, a.senseRival)).to.be.rejected;
      await expect(fhevm.publicDecrypt([a.tile])).to.be.rejected;
    });
  });

  describe("rounds", function () {
    let id: bigint;
    beforeEach(async function () {
      id = await create([10, 11]);
      await join(id, [7, 6]); // bob's trap on (1, 2): alice's first step south
    });

    it("treats an off-board move or an unknown code as staying put", async function () {
      await round(id, N, 7); // alice north from row 0, bob sends garbage
      const a = await game.playerView(id, 0);
      const b = await game.playerView(id, 1);
      expect(await decAs(alice, a.tile)).to.eq(2n);
      expect(await decAs(bob, b.tile)).to.eq(22n);
      await round(id, W, S); // alice west to (0, 1), bob south off the board
      expect(await decAs(alice, (await game.playerView(id, 0)).tile)).to.eq(1n);
      expect(await decAs(bob, (await game.playerView(id, 1)).tile)).to.eq(22n);
    });

    it("sends a scout that lands on a rival trap home and spends the trap", async function () {
      const o = await round(id, S, STAY);
      expect(o.trapHit).to.eq(true);
      expect(o.vialTaken).to.eq(false);
      expect(o.winner).to.eq(0n);
      const a = await game.playerView(id, 0);
      expect(await decAs(alice, a.tile)).to.eq(2n);
      expect(await decBoolAs(alice, a.hit)).to.eq(true);
      const b = await game.playerView(id, 1);
      expect(await decAs(bob, b.trapsLive[0])).to.eq(BigInt(FOG_NO_TILE));
      expect(await decAs(bob, b.trapsPlaced[0])).to.eq(7n);
      expect(await decBoolAs(bob, b.hit)).to.eq(false);
      // The spent trap is safe now.
      expect((await round(id, S, STAY)).trapHit).to.eq(false);
      expect(await decAs(alice, (await game.playerView(id, 0)).tile)).to.eq(7n);
    });

    it("rejects moves out of turn, twice in a round and from outsiders", async function () {
      const waiting = await create([10, 11]);
      await expect(sendMove(waiting, alice, S)).to.be.revertedWithCustomError(game, "NotYourTurn");

      await expect(sendMove(id, eve, S)).to.be.revertedWithCustomError(game, "NotPlayer").withArgs(eve.address);
      await sendMove(id, alice, S);
      await expect(sendMove(id, alice, E)).to.be.revertedWithCustomError(game, "AlreadyMoved").withArgs(0);
      await expect(game.finalizeRound(id, "0x", "0x")).to.be.revertedWithCustomError(game, "NotAwaitingReveal");
      await sendMove(id, bob, N);
      // Resolved, waiting for the public outcome: nobody moves until it is finalized.
      await expect(sendMove(id, alice, S)).to.be.revertedWithCustomError(game, "NotYourTurn");
      await expect(sendMove(id, bob, S)).to.be.revertedWithCustomError(game, "NotYourTurn");
      await finalize(id);
      await expect(sendMove(id, alice, S)).to.not.be.reverted;
    });

    it("reveals the round outcome only with a valid KMS proof", async function () {
      await sendMove(id, alice, S);
      const resolved = await (await sendMove(id, bob, N)).wait();
      const handles = await game.roundHandles(id);
      expect(resolved!.logs.some((l) => game.interface.parseLog(l)?.name === "RoundResolved")).to.eq(true);

      const res = await fhevm.publicDecrypt([...handles]);
      const forged = ethers.AbiCoder.defaultAbiCoder().encode(["uint256", "uint256", "uint256"], [0n, 1n, 1n]);
      await expect(game.finalizeRound(id, forged, res.decryptionProof)).to.be.reverted;
      await expect(game.finalizeRound(id, res.abiEncodedClearValues, "0x")).to.be.reverted;

      await expect(game.connect(eve).finalizeRound(id, res.abiEncodedClearValues, res.decryptionProof))
        .to.emit(game, "RoundRevealed")
        .withArgs(id, 1, true, false, 0);
      const g = await game.getGame(id);
      expect(g.round).to.eq(2n);
      expect(g.roundsPlayed).to.eq(1n);
      expect(g.moved).to.deep.eq([false, false]);
      // Moves stay private after the round: only the round outcome went public.
      const [m0] = (await game.revealHandles(id)).slice(7);
      await expect(fhevm.publicDecrypt([m0!])).to.be.rejected;
    });
  });

  describe("a full game", function () {
    it("plays to a delivery, reveals the whole board and verifies the replay against the chain", async function () {
      const traps: [[number, number], [number, number]] = [
        [15, 16],
        [5, 9],
      ];
      const id = await create(traps[0]);
      await join(id, traps[1]);
      const col = await vialCol(id);

      // Alice: down to the vial row through col 2 (tile 7 is free), across to the vial, home.
      // Bob walks into her trap at 16 on round 2, then waits.
      const path: [number, number][] = [
        [S, N],
        [S, W],
      ];
      const across = col > 2 ? E : W;
      for (let i = 0; i < Math.abs(col - 2); i++) path.push([across, STAY]);
      // Bob's traps sit on 5 (1, 0) and 9 (1, 4): from an edge column, step in before heading north.
      const back = col === 4 ? [W, N, N] : col === 0 ? [E, N, N] : [N, N];
      if (col === 2) path.push([STAY, STAY]); // already picked up on arrival; keep the round count simple
      for (const d of back) path.push([d, STAY]);

      let state: FogState = fogInitialState(traps, col);
      let last;
      for (const [d0, d1] of path) {
        last = await round(id, d0, d1);
        const step = resolveFogRound(state, [d0, d1]);
        state = step.state;
        expect({ trapHit: last.trapHit, vialTaken: last.vialTaken, winner: Number(last.winner) }).to.deep.eq(step.outcome);
        if (last.winner !== 0n) break;
      }
      expect(last!.winner).to.eq(1n);

      const g = await game.getGame(id);
      expect(g.status).to.eq(Status.Ended);
      expect(g.winner).to.eq(1n);
      expect(g.endReason).to.eq(End.Delivered);
      await expect(sendMove(id, alice, S)).to.be.revertedWithCustomError(game, "NotYourTurn");

      // Everything is publicly decryptable now; a forged reveal is rejected.
      const handles = [...(await game.revealHandles(id))];
      expect(handles).to.have.length(7 + 2 * Number(g.roundsPlayed));
      const res = await fhevm.publicDecrypt(handles);
      const words = ethers.AbiCoder.defaultAbiCoder().decode(Array(handles.length).fill("uint256"), res.abiEncodedClearValues);
      const tampered = ethers.AbiCoder.defaultAbiCoder().encode(
        Array(handles.length).fill("uint256"),
        words.map((w: bigint, i: number) => (i === 4 ? (w + 1n) % 5n : w)),
      );
      await expect(game.finalizeGameReveal(id, tampered, res.decryptionProof)).to.be.reverted;
      await measure("finalizeGameReveal", game.finalizeGameReveal(id, res.abiEncodedClearValues, res.decryptionProof));
      await expect(game.finalizeGameReveal(id, res.abiEncodedClearValues, res.decryptionProof)).to.be.revertedWithCustomError(
        game,
        "AlreadyRevealed",
      );

      const r = await game.replay(id);
      expect(r.traps.map((t) => t.map(Number))).to.deep.eq(traps);
      expect(Number(r.vialCol)).to.eq(col);
      const outcomes = [];
      for (let i = 1; i <= Number(g.roundsPlayed); i++) {
        const o = await game.outcome(id, i);
        outcomes.push({ trapHit: o.trapHit, vialTaken: o.vialTaken, winner: Number(o.winner) as 0 | 1 | 2 });
      }
      const input = {
        traps: [r.traps[0]!.map(Number), r.traps[1]!.map(Number)] as [number[], number[]],
        vialCol: Number(r.vialCol),
        moves: r.moves.map((m) => [Number(m[0]), Number(m[1])] as [number, number]),
      };
      const checks = verifyFogGame(input, {
        outcomes,
        winner: 1,
        endReason: "delivered",
        finalTiles: [Number(r.finalTiles[0]), Number(r.finalTiles[1])],
      });
      expect(checks.filter((c) => !c.ok)).to.deep.eq([]);
      expect(fogTile(replayFogGame(input).final.pos[0])).to.eq(Number(r.finalTiles[0]));
    });

    it("ends in a draw after the last round with no delivery", async function () {
      const id = await create([10, 11]);
      await join(id, [5, 6]);
      const max = Number(await game.MAX_ROUNDS());
      for (let i = 0; i < max; i++) await round(id, STAY, STAY);
      const g = await game.getGame(id);
      expect(g.status).to.eq(Status.Ended);
      expect(g.winner).to.eq(0n);
      expect(g.endReason).to.eq(End.MaxRounds);
      expect(g.roundsPlayed).to.eq(BigInt(max));
      const res = await fhevm.publicDecrypt([...(await game.revealHandles(id))]);
      await measure("finalizeGameReveal (10 rounds)", game.finalizeGameReveal(id, res.abiEncodedClearValues, res.decryptionProof));
      expect((await game.replay(id)).moves).to.have.length(max);
    });
  });

  describe("timeouts", function () {
    let id: bigint;
    beforeEach(async function () {
      id = await create([10, 11]);
      await join(id, [5, 6]);
    });

    it("gives the win to the only player who moved before the deadline", async function () {
      await sendMove(id, alice, S);
      await expect(game.connect(alice).claimTimeout(id)).to.be.revertedWithCustomError(game, "DeadlineNotReached");
      await time.increase(WINDOW + 1n);
      await expect(sendMove(id, bob, N)).to.not.be.reverted; // late, but still in: resolves the round
      await expect(game.claimTimeout(id)).to.be.revertedWithCustomError(game, "WrongStatus");
      await finalize(id);

      await sendMove(id, bob, N);
      await time.increase(WINDOW + 1n);
      await expect(game.connect(bob).claimTimeout(id)).to.emit(game, "GameEnded").withArgs(id, 2, End.Timeout, 1);
      const g = await game.getGame(id);
      expect(g.status).to.eq(Status.Ended);
      expect(g.winner).to.eq(2n);
      // The finalized round is opened for verification; the unanswered move is not part of it.
      expect(await game.revealHandles(id)).to.have.length(9);
    });

    it("is a draw when neither player moved", async function () {
      await time.increase(WINDOW + 1n);
      await game.connect(eve).claimTimeout(id);
      const g = await game.getGame(id);
      expect(g.winner).to.eq(0n);
      expect(g.endReason).to.eq(End.Timeout);
    });
  });

  describe("rules module", function () {
    it("matches the contract round by round on a random game (packages/shared fog-skirm.ts)", async function () {
      // Deterministic PRNG so a failure reproduces.
      let seed = 0x5eed;
      const rnd = (n: number) => {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        return seed % n;
      };
      const traps: [[number, number], [number, number]] = [
        [10 + rnd(12), 10 + rnd(10)], // sometimes out of band (20, 21): inert
        [5 + rnd(10), rnd(25)],
      ];
      const id = await create(traps[0]);
      await join(id, traps[1]);
      let state = fogInitialState(traps, await vialCol(id));
      // Bias both scouts toward the middle so traps, pickups and tags happen.
      const pick = (side: 0 | 1, s: FogState) => {
        const r = rnd(10);
        if (r === 9) return 6; // unknown code: stay
        const toward = s.pos[side].row < 2 ? S : s.pos[side].row > 2 ? N : r < 4 ? E : W;
        return r < 6 ? toward : [STAY, N, E, S, W][rnd(5)]!;
      };
      for (let i = 0; i < 10; i++) {
        const moves: [number, number] = [pick(0, state), pick(1, state)];
        const o = await round(id, moves[0], moves[1]);
        const step = resolveFogRound(state, moves);
        state = step.state;
        expect({ trapHit: o.trapHit, vialTaken: o.vialTaken, winner: Number(o.winner) }, `round ${i + 1} outcome`).to.deep.eq(step.outcome);
        for (const side of [0, 1] as const) {
          const v = await game.playerView(id, side);
          expect(Number(await dec8(v.tile)), `round ${i + 1} tile ${side}`).to.eq(fogTile(state.pos[side]));
          expect(Number(await dec8(v.senseVial)), `round ${i + 1} vial sense ${side}`).to.eq(step.private[side].senseVial);
          expect(Number(await dec8(v.senseRival)), `round ${i + 1} rival sense`).to.eq(step.private[side].senseRival);
          expect(await fhevm.debugger.decryptEbool(v.carrying), `round ${i + 1} carrying ${side}`).to.eq(state.carrying[side]);
          expect(await fhevm.debugger.decryptEbool(v.hit), `round ${i + 1} hit ${side}`).to.eq(step.private[side].hit);
          expect([Number(await dec8(v.trapsLive[0])), Number(await dec8(v.trapsLive[1]))]).to.deep.eq(state.traps[side]);
        }
        if (step.outcome.winner !== 0) break;
      }
    });
  });
});
