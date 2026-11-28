// Fog Skirm on FogSkirm (packages/fhevm, Sepolia): the contract calls, the encrypt / decrypt steps
// and the pure helpers the /fog screen is built from. The rules themselves live in @skirm/shared
// (fog-skirm.ts), which mirrors the contract step for step.
//
// A round, per player: user-decrypt your view (scout tile, carrying, trap hit, sense pings, your
// traps) → click an adjacent tile → encrypt the direction in this tab → submitMove. The second move
// of a round resolves it under FHE on chain; then either client public-decrypts the three outcome
// handles and sends finalizeRound (the KMS proof is checked on chain). Whoever gets there first does
// it, the other's call reverts harmlessly. At the end the whole board opens the same way.
import { FogSkirmAbi } from '@skirm/fhevm/generated';
import {
  FOG_NO_TILE,
  retryRead,
  verifyFogGame,
  waitForHandles,
  withFreshKmsProof,
  type FogCheck,
  type FogOutcome,
  type FogReplayInput,
  type FogSense,
  type FogSide,
  type FogWinner,
} from '@skirm/shared';
import { Contract, ZeroAddress, type ContractRunner, type Log } from 'ethers';
import { zamaConfig, type HexAddress } from '@/lib/zama/config';
import { publicDecrypt, userDecrypt, type EncryptedInputs, type Hex, type TypedDataSigner } from '@/lib/zama/fhe';
import { ZamaWalletError } from '@/lib/zama/wallet';
import { trackTx } from '@/lib/zama/steps';

export const FOG_STATUSES = ['none', 'waiting', 'playing', 'ended', 'cancelled'] as const;
export type FogStatus = (typeof FOG_STATUSES)[number];
export const FOG_END_REASONS = ['none', 'delivered', 'max_rounds', 'timeout'] as const;
export type FogEndReason = (typeof FOG_END_REASONS)[number];

/** Default seconds per move for a game this client creates (the contract allows 1 min to 1 day). */
export const FOG_DEFAULT_WINDOW_S = 10 * 60;
/** How often the screen re-reads the game while it waits. */
export const FOG_POLL_MS = 4_000;

/**
 * Gas for submitMove. The first move of a round is cheap (~0.7M on Sepolia), but the second one
 * resolves the round inline under FHE (up to ~7.5M measured). Both players often move at once, so a
 * wallet that estimates while the rival's move is still pending prices the cheap case and the
 * transaction runs out of gas on chain. Every move therefore gets at least FOG_MOVE_GAS_FLOOR (unused
 * gas is refunded), capped under the per-transaction limit (EIP-7825, 2^24).
 */
export const FOG_MOVE_GAS_FLOOR = 9_000_000n;
export const FOG_MOVE_GAS_CAP = 16_000_000n;
export function fogMoveGasLimit(estimate: bigint): bigint {
  const padded = (estimate * 12n) / 10n;
  const limit = padded > FOG_MOVE_GAS_FLOOR ? padded : FOG_MOVE_GAS_FLOOR;
  return limit < FOG_MOVE_GAS_CAP ? limit : FOG_MOVE_GAS_CAP;
}

/** The public game header. */
export interface FogGame {
  id: bigint;
  /** Lower-case; the zero address is an open seat. */
  players: [string, string];
  status: FogStatus;
  round: number;
  roundsPlayed: number;
  awaitingReveal: boolean;
  moved: [boolean, boolean];
  moveWindow: number;
  /** Unix seconds the current round's moves are due. */
  deadline: number;
  winner: FogWinner;
  endReason: FogEndReason;
  revealed: boolean;
}

/** The handles a player can user-decrypt (FogSkirm.playerView). */
export interface FogViewHandles {
  tile: Hex;
  carrying: Hex;
  hit: Hex;
  senseVial: Hex;
  senseRival: Hex;
  trapsPlaced: [Hex, Hex];
  trapsLive: [Hex, Hex];
}

/** A player's decrypted view. */
export interface FogView {
  tile: number;
  carrying: boolean;
  hit: boolean;
  senseVial: FogSense;
  senseRival: FogSense;
  trapsPlaced: [number, number];
  trapsLive: [number, number];
}

/** What FogSkirm.replay returns once the game is revealed. */
export interface FogRevealed {
  traps: [[number, number], [number, number]];
  vialCol: number;
  finalTiles: [number, number];
  moves: [number, number][];
}

/** The deployed FogSkirm address, or a `not_deployed` error. */
export function fogAddress(): HexAddress {
  const address = zamaConfig.contracts.fog;
  if (!address) {
    throw new ZamaWalletError('not_deployed', 'FogSkirm is not deployed yet: deploy packages/fhevm to Sepolia or set NEXT_PUBLIC_ZAMA_FOG_ADDRESS.');
  }
  return address;
}

/** The contract calls the screen needs (an interface, so tests can fake the chain). */
export interface FogApi {
  read(id: bigint): Promise<FogGame>;
  create(opponent: string, moveWindowS: number, enc: EncryptedInputs): Promise<bigint>;
  join(id: bigint, enc: EncryptedInputs): Promise<void>;
  move(id: bigint, enc: EncryptedInputs): Promise<void>;
  cancel(id: bigint): Promise<void>;
  claimTimeout(id: bigint): Promise<void>;
  roundHandles(id: bigint): Promise<Hex[]>;
  finalizeRound(id: bigint, clear: Hex, proof: Hex): Promise<void>;
  playerView(id: bigint, side: FogSide): Promise<FogViewHandles>;
  outcomes(id: bigint, rounds: number): Promise<FogOutcome[]>;
  revealHandles(id: bigint): Promise<Hex[]>;
  finalizeGameReveal(id: bigint, clear: Hex, proof: Hex): Promise<void>;
  replay(id: bigint): Promise<FogRevealed>;
}

type Tx = { wait: () => Promise<{ logs: readonly Log[] } | null> };

interface RawGame {
  players: string[];
  status: bigint;
  round: bigint;
  roundsPlayed: bigint;
  awaitingReveal: boolean;
  moved: boolean[];
  moveWindow: bigint;
  deadline: bigint;
  winner: bigint;
  endReason: bigint;
  revealed: boolean;
}

/** Maps FogSkirm.getGame's tuple to a FogGame. */
export function parseGame(id: bigint, g: RawGame): FogGame {
  return {
    id,
    players: [String(g.players[0]).toLowerCase(), String(g.players[1]).toLowerCase()],
    status: FOG_STATUSES[Number(g.status)] ?? 'none',
    round: Number(g.round),
    roundsPlayed: Number(g.roundsPlayed),
    awaitingReveal: !!g.awaitingReveal,
    moved: [!!g.moved[0], !!g.moved[1]],
    moveWindow: Number(g.moveWindow),
    deadline: Number(g.deadline),
    winner: Number(g.winner) as FogWinner,
    endReason: FOG_END_REASONS[Number(g.endReason)] ?? 'none',
    revealed: !!g.revealed,
  };
}

/** FogSkirm through ethers: reads on `runner`, writes signed by it (a JsonRpcSigner). */
export function fogApi(runner: ContractRunner, address: string = fogAddress()): FogApi {
  const c = new Contract(address, FogSkirmAbi, runner);
  const call = <T>(fn: string, ...args: unknown[]) => c.getFunction(fn)(...args) as Promise<T>;
  const send = async (fn: string, ...args: unknown[]) => (await trackTx(() => call<Tx>(fn, ...args))).receipt?.logs ?? [];
  const hex = (h: unknown) => String(h) as Hex;
  return {
    read: async (id) => parseGame(id, await call<RawGame>('getGame', id)),
    async create(opponent, moveWindowS, enc) {
      const logs = await send('createGame', opponent || ZeroAddress, moveWindowS, enc.handles[0], enc.handles[1], enc.inputProof);
      for (const log of logs) {
        const parsed = (() => {
          try {
            return c.interface.parseLog(log);
          } catch {
            return null;
          }
        })();
        if (parsed?.name === 'GameCreated') return BigInt(parsed.args[0] as bigint);
      }
      throw new Error('The game was created but its id was not in the receipt.');
    },
    join: async (id, enc) => void (await send('joinGame', id, enc.handles[0], enc.handles[1], enc.inputProof)),
    async move(id, enc) {
      const args = [id, enc.handles[0], enc.inputProof] as const;
      // A real revert (not your turn, game over) still fails here, before anything is sent.
      const estimate = (await c.getFunction('submitMove').estimateGas(...args)) as bigint;
      await send('submitMove', ...args, { gasLimit: fogMoveGasLimit(estimate) });
    },
    cancel: async (id) => void (await send('cancelGame', id)),
    claimTimeout: async (id) => void (await send('claimTimeout', id)),
    roundHandles: async (id) => (await call<unknown[]>('roundHandles', id)).map(hex),
    finalizeRound: async (id, clear, proof) => void (await send('finalizeRound', id, clear, proof)),
    async playerView(id, side) {
      const v = await call<{ tile: string; carrying: string; hit: string; senseVial: string; senseRival: string; trapsPlaced: string[]; trapsLive: string[] }>(
        'playerView',
        id,
        side,
      );
      return {
        tile: hex(v.tile),
        carrying: hex(v.carrying),
        hit: hex(v.hit),
        senseVial: hex(v.senseVial),
        senseRival: hex(v.senseRival),
        trapsPlaced: [hex(v.trapsPlaced[0]), hex(v.trapsPlaced[1])],
        trapsLive: [hex(v.trapsLive[0]), hex(v.trapsLive[1])],
      };
    },
    async outcomes(id, rounds) {
      const out: FogOutcome[] = [];
      for (let r = 1; r <= rounds; r++) {
        const o = await call<{ trapHit: boolean; vialTaken: boolean; winner: bigint }>('outcome', id, r);
        out.push({ trapHit: !!o.trapHit, vialTaken: !!o.vialTaken, winner: Number(o.winner) as FogWinner });
      }
      return out;
    },
    revealHandles: async (id) => (await call<unknown[]>('revealHandles', id)).map(hex),
    finalizeGameReveal: async (id, clear, proof) => void (await send('finalizeGameReveal', id, clear, proof)),
    async replay(id) {
      const r = await call<{ traps: bigint[][]; vialCol: bigint; finalTiles: bigint[]; moves: bigint[][] }>('replay', id);
      return {
        traps: [
          [Number(r.traps[0]![0]), Number(r.traps[0]![1])],
          [Number(r.traps[1]![0]), Number(r.traps[1]![1])],
        ],
        vialCol: Number(r.vialCol),
        finalTiles: [Number(r.finalTiles[0]), Number(r.finalTiles[1])],
        moves: r.moves.map((m) => [Number(m[0]), Number(m[1])] as [number, number]),
      };
    },
  };
}

/** Which side `address` plays in `game`, or null for a spectator. */
export function sideOf(game: Pick<FogGame, 'players'>, address: string | null | undefined): FogSide | null {
  const a = (address ?? '').toLowerCase();
  if (!a) return null;
  if (game.players[0] === a) return 0;
  if (game.players[1] === a) return 1;
  return null;
}

export const isOpenSeat = (a: string) => a === ZeroAddress.toLowerCase();

type DecryptInstance = Parameters<typeof userDecrypt>[0];

/** User-decrypts the player's view in one request (one signature per session, cached). */
export async function decryptView(instance: DecryptInstance, signer: TypedDataSigner, contract: string, h: FogViewHandles): Promise<FogView> {
  const handles = [h.tile, h.carrying, h.hit, h.senseVial, h.senseRival, ...h.trapsPlaced, ...h.trapsLive];
  const v = await userDecrypt(
    instance,
    signer,
    handles.map((handle) => ({ handle, contractAddress: contract })),
  );
  const n = (x: unknown) => Number(typeof x === 'boolean' ? (x ? 1 : 0) : (x as bigint));
  return {
    tile: n(v[0]),
    carrying: n(v[1]) === 1,
    hit: n(v[2]) === 1,
    senseVial: n(v[3]) as FogSense,
    senseRival: n(v[4]) as FogSense,
    trapsPlaced: [n(v[5]), n(v[6])],
    trapsLive: [n(v[7]), n(v[8])],
  };
}

type PublicInstance = Parameters<typeof publicDecrypt>[0];

/**
 * Publishes a resolved round: public-decrypts the outcome handles and sends finalizeRound. Returns
 * false when the game was no longer waiting (the rival's client finalized first).
 */
export async function finalizePendingRound(api: FogApi, instance: PublicInstance, id: bigint): Promise<boolean> {
  const g = await retryRead(() => api.read(id));
  if (g.status !== 'playing' || !g.awaitingReveal) return false;
  // A lagging RPC node can hand back zero handles just after the resolving move; the relayer won't decrypt those.
  const handles = [...(await waitForHandles(() => api.roundHandles(id)))];
  try {
    // A rejected KMS proof (KMSInvalidSigner) is fetched again and resent.
    await withFreshKmsProof(
      () => publicDecrypt(instance, handles),
      (res) => api.finalizeRound(id, res.abiEncodedClearValues, res.decryptionProof),
    );
    return true;
  } catch (e) {
    // Lost the race: the rival's tab already finalized it.
    const after = await retryRead(() => api.read(id));
    if (after.roundsPlayed > g.roundsPlayed) return false;
    throw e;
  }
}

/** Opens and stores the full board of an ended game (once; anyone may send it). */
export async function revealEndedGame(api: FogApi, instance: PublicInstance, id: bigint): Promise<FogRevealed> {
  const g = await retryRead(() => api.read(id));
  if (g.status !== 'ended') throw new Error(`Game ${id} has not ended (${g.status}).`);
  if (!g.revealed) {
    const handles = [...(await waitForHandles(() => api.revealHandles(id)))];
    try {
      await withFreshKmsProof(
        () => publicDecrypt(instance, handles),
        (res) => api.finalizeGameReveal(id, res.abiEncodedClearValues, res.decryptionProof),
      );
    } catch (e) {
      if (!(await retryRead(() => api.read(id))).revealed) throw e;
    }
  }
  return api.replay(id);
}

/** Replays the revealed history and checks it against the on-chain record ("Verify this game"). */
export async function verifyGameOnChain(api: FogApi, id: bigint): Promise<{ checks: FogCheck[]; revealed: FogRevealed; outcomes: FogOutcome[] }> {
  const g = await api.read(id);
  if (!g.revealed) throw new Error('The board is not revealed yet.');
  const [revealed, outcomes] = await Promise.all([api.replay(id), api.outcomes(id, g.roundsPlayed)]);
  const input: FogReplayInput = { traps: revealed.traps, vialCol: revealed.vialCol, moves: revealed.moves };
  const checks = verifyFogGame(input, { outcomes, winner: g.winner, endReason: g.endReason, finalTiles: revealed.finalTiles });
  return { checks, revealed, outcomes };
}

/** A round of the public log, plus what this player privately sensed if the tab saw it. */
export interface FogLogEntry {
  round: number;
  text: string;
  tone: 'trap' | 'vial' | 'drop' | 'win' | 'quiet';
}

/** Turns the KMS-verified public outcomes into log lines (newest last). */
export function logEntries(outcomes: readonly FogOutcome[], mySide: FogSide | null): FogLogEntry[] {
  const out: FogLogEntry[] = [];
  let taken = false;
  outcomes.forEach((o, i) => {
    const round = i + 1;
    const parts: string[] = [];
    let tone: FogLogEntry['tone'] = 'quiet';
    if (o.trapHit) {
      parts.push('A flood switch went off: a scout was washed home.');
      tone = 'trap';
    }
    if (o.vialTaken && !taken) {
      parts.push('Someone lifted the seed vial.');
      tone = 'vial';
    } else if (!o.vialTaken && taken) {
      parts.push('The vial was knocked loose and rolled back to its hiding spot.');
      tone = 'drop';
    }
    if (o.winner !== 0) {
      const mine = mySide !== null && o.winner === mySide + 1;
      parts.push(mySide === null ? `Side ${o.winner} delivered the vial home.` : mine ? 'You delivered the vial home!' : 'Your rival delivered the vial home.');
      tone = 'win';
    }
    if (parts.length === 0) parts.push(taken ? 'The vial is still on the move. Nothing else surfaced.' : 'Quiet. Nothing surfaced through the fog.');
    out.push({ round, text: parts.join(' '), tone });
    taken = o.vialTaken;
  });
  return out;
}

export const SENSE_TEXT: Record<FogSense, { icon: string; label: string }> = {
  0: { icon: '🟢', label: 'adjacent' },
  1: { icon: '🟡', label: 'near' },
  2: { icon: '⚪', label: 'far' },
};

/** Live trap value as a tile, or null when spent / inert. */
export const liveTile = (t: number): number | null => (t === FOG_NO_TILE || t > 24 ? null : t);

/** Seconds left until `deadline` (never negative). */
export const secondsLeft = (deadline: number, nowMs = Date.now()) => Math.max(0, deadline - Math.floor(nowMs / 1000));

/** A game id typed by the player ("7", "#7", or a /fog?game=7 link). */
export function parseGameId(input: string): bigint | null {
  const t = input.trim();
  const m = /[?&]game=(\d+)/.exec(t) ?? /^#?(\d+)$/.exec(t);
  if (!m) return null;
  const id = BigInt(m[1]!);
  return id > 0n ? id : null;
}
