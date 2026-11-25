// On-chain FHE randomness on SkirmMatch (packages/fhevm, Sepolia): the match seed and the sealed
// supply drop values, behind NEXT_PUBLIC_ZAMA_ENABLED.
//
// SkirmMatch draws the seed (FHE.randEuint64) and one value per drop slot (FHE.randEuint16) once
// both loadouts are sealed. The seed is revealed with the loadouts; each drop value opens on its own,
// in slot order, no earlier than DROP_INTERVAL_S × (slot + 1) after the reveal: revealDrop marks it
// publicly decryptable, the relayer returns the value and the KMS proof, finalizeDrop checks the proof
// on chain. The game server reads the stored value and lands the drop on the tile it maps to
// (@skirm/engine sealedDropTile). This module reads all of it and drives those two transactions.
import { mapV2, parseMapV2, sealedDropTile } from '@skirm/engine/v2';
import { SkirmMatchAbi } from '@skirm/fhevm/generated';
import { Contract, JsonRpcProvider, type ContractRunner } from 'ethers';
import { zamaConfig } from '@/lib/zama/config';
import { isZeroHandle, publicDecrypt, type Hex } from '@/lib/zama/fhe';
import type { Team } from '@/lib/realtime/protocol';
import { trackTx } from '@/lib/zama/steps';

/** Drop values SkirmMatch draws per match (DROP_SLOTS). */
export const DROP_SLOTS = 3;
/** Seconds between drop reveal times (SkirmMatch.DROP_INTERVAL). */
export const DROP_INTERVAL_S = 60;
/** How far back the reveal transactions are looked up (about a day of Sepolia blocks). */
export const TX_LOOKBACK_BLOCKS = 7_200;

/** SkirmMatch.randomness, as the web reads it. */
export interface ChainRandomness {
  seedHandle: Hex;
  dropHandles: Hex[];
  /** The verified seed, a decimal uint64 (null before the reveal is finalized). */
  seed: string | null;
  /** Each slot's verified value (null until its finalizeDrop). */
  drops: (number | null)[];
  /** Unix seconds the reveal was finalized (0 before). */
  startedAt: number;
  dropsRequested: number;
  dropsRevealed: number;
}

/** The transactions that published each value (null: not found, or not revealed yet). */
export interface RevealTxs {
  seed: Hex | null;
  drops: (Hex | null)[];
}

/** The SkirmMatch calls this feature needs (an interface, so tests can fake the chain). */
export interface RandomnessApi {
  read(key: Hex): Promise<ChainRandomness>;
  txs(key: Hex): Promise<RevealTxs>;
  revealDrop(key: Hex, slot: number): Promise<void>;
  finalizeDrop(key: Hex, slot: number, abiEncodedClearValue: Hex, decryptionProof: Hex): Promise<void>;
}

type Tx = { wait: () => Promise<unknown> };
type EventLike = { transactionHash: string; args?: { slot?: bigint } };

/** A read-only Sepolia provider (no wallet): the public RPC from the config. */
export function readOnlyRunner(): JsonRpcProvider {
  return new JsonRpcProvider(zamaConfig.rpcUrl, zamaConfig.chainId, { staticNetwork: true });
}

/** SkirmMatch's randomness through ethers: reads on `runner`, writes signed by it (a JsonRpcSigner). */
export function randomnessApi(runner: ContractRunner, address: string): RandomnessApi {
  const c = new Contract(address, SkirmMatchAbi, runner);
  const send = async (fn: string, ...args: unknown[]) => {
    await trackTx(() => c.getFunction(fn)(...args) as Promise<Tx>);
  };
  return {
    async read(key) {
      const r = (await c.getFunction('randomness')(key)) as {
        seedHandle: string;
        dropHandles: string[];
        seed: bigint;
        drops: bigint[];
        startedAt: bigint;
        dropsRequested: bigint;
        dropsRevealed: bigint;
      };
      const revealed = Number(r.dropsRevealed);
      return {
        seedHandle: r.seedHandle as Hex,
        dropHandles: r.dropHandles.map((h) => h as Hex),
        seed: r.startedAt > 0n ? r.seed.toString() : null,
        drops: r.drops.map((v, i) => (i < revealed ? Number(v) : null)),
        startedAt: Number(r.startedAt),
        dropsRequested: Number(r.dropsRequested),
        dropsRevealed: revealed,
      };
    },
    async txs(key) {
      const latest = await (c.runner?.provider ?? readOnlyRunner()).getBlockNumber();
      const from = Math.max(0, latest - TX_LOOKBACK_BLOCKS);
      const [seeds, drops] = (await Promise.all([
        c.queryFilter(c.getEvent('SeedRevealed')(key), from),
        c.queryFilter(c.getEvent('DropRevealed')(key), from),
      ])) as [EventLike[], EventLike[]];
      const bySlot: (Hex | null)[] = new Array(DROP_SLOTS).fill(null);
      for (const e of drops) if (e.args?.slot !== undefined) bySlot[Number(e.args.slot)] = e.transactionHash as Hex;
      return { seed: (seeds[0]?.transactionHash as Hex | undefined) ?? null, drops: bySlot };
    },
    revealDrop: (key, slot) => send('revealDrop', key, slot),
    finalizeDrop: (key, slot, clear, proof) => send('finalizeDrop', key, slot, clear, proof),
  };
}

/** Whether the match has its randomness drawn (both loadouts sealed). */
export const isDrawn = (r: Pick<ChainRandomness, 'seedHandle'>) => !isZeroHandle(r.seedHandle);

/** When drop `slot` may be opened (unix seconds), or null before the reveal is finalized. */
export function dropDueAt(r: Pick<ChainRandomness, 'startedAt'>, slot: number): number | null {
  return r.startedAt ? r.startedAt + (slot + 1) * DROP_INTERVAL_S : null;
}

/** What to send next to open the drops up to `slots`, in order. */
export type DropAction = { kind: 'reveal'; slot: number } | { kind: 'finalize'; slot: number } | { kind: 'wait'; slot: number; untilSec: number | null } | { kind: 'done' };

export function nextDropAction(r: ChainRandomness, nowSec: number, slots = DROP_SLOTS): DropAction {
  const slot = r.dropsRevealed;
  if (slot >= Math.min(slots, DROP_SLOTS)) return { kind: 'done' };
  if (r.dropsRequested > slot) return { kind: 'finalize', slot };
  const due = dropDueAt(r, slot);
  if (due === null || nowSec < due) return { kind: 'wait', slot, untilSec: due };
  return { kind: 'reveal', slot };
}

/** The tile a revealed drop value lands on, on `mapId` (as the game server places it). */
export function dropTileOf(mapId: string, value: number): [number, number] | null {
  const def = mapV2(mapId);
  if (!def) return null;
  try {
    return sealedDropTile(parseMapV2(def), value);
  } catch {
    return null;
  }
}

/** Supply drops the map lands (the slots a live match reveals). */
export const mapDropCount = (mapId: string) => mapV2(mapId)?.drops.length ?? 0;

/** A Sepolia Etherscan link for a transaction, or for the contract when the tx is not known. */
export function explorerUrl(hash: Hex | null, contract?: string | null): string | null {
  if (hash) return `${zamaConfig.explorerUrl}/tx/${hash}`;
  return contract ? `${zamaConfig.explorerUrl}/address/${contract}` : null;
}

/** A long seed shortened for a chip (the full one stays in the title). */
export function shortSeed(seed: string): string {
  return seed.length > 12 ? `${seed.slice(0, 6)}…${seed.slice(-4)}` : seed;
}

/** Polls team B waits for team A's drop transactions before sending them itself. */
export const DROP_FALLBACK_POLLS = 3;
export const DROP_POLL_MS = 4_000;

export interface DriveOptions {
  api: RandomnessApi;
  /** The relayer SDK instance (public decrypt). */
  instance: Parameters<typeof publicDecrypt>[0];
  key: Hex;
  /** The player's side (team A sends first); null: send without waiting (the debrief). */
  team: Team | null;
  /** Open slots 0 .. slots - 1. */
  slots: number;
  onUpdate?: (r: ChainRandomness, action: DropAction) => void;
  signal?: AbortSignal;
  nowSec?: () => number;
  sleep?: (ms: number) => Promise<void>;
  pollMs?: number;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Opens the drops in order as each comes due: revealDrop, then the relayer's public decryption and
 * finalizeDrop. Both players' tabs run it; team A sends, team B only once team A's transaction has
 * not landed for DROP_FALLBACK_POLLS polls. A failed step (a revert because the other tab was first,
 * the relayer lagging a block) is retried on the next poll. Resolves when every slot is revealed.
 */
export async function driveDropReveals(o: DriveOptions): Promise<ChainRandomness> {
  const now = o.nowSec ?? (() => Math.floor(Date.now() / 1000));
  const sleep = o.sleep ?? defaultSleep;
  let idle = 0;
  let last = '';
  for (;;) {
    if (o.signal?.aborted) throw new Error('aborted');
    const r = await o.api.read(o.key);
    const action = nextDropAction(r, now(), o.slots);
    o.onUpdate?.(r, action);
    if (action.kind === 'done') return r;
    const step = `${action.kind}:${'slot' in action ? action.slot : ''}`;
    idle = step === last ? idle + 1 : 0;
    last = step;
    const mine = o.team === null || o.team === 'A' || idle >= DROP_FALLBACK_POLLS;
    if (mine && action.kind === 'reveal') await o.api.revealDrop(o.key, action.slot).catch(() => undefined);
    if (mine && action.kind === 'finalize') {
      const handle = r.dropHandles[action.slot]!;
      await publicDecrypt(o.instance, [handle])
        .then((res) => o.api.finalizeDrop(o.key, action.slot, res.abiEncodedClearValues, res.decryptionProof))
        .catch(() => undefined);
    }
    if (action.kind === 'wait' && action.untilSec !== null) {
      await sleep(Math.max(0, Math.min(o.pollMs ?? DROP_POLL_MS, (action.untilSec - now()) * 1000)));
    } else await sleep(o.pollMs ?? DROP_POLL_MS);
  }
}
