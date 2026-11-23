// Sealed loadouts on SkirmMatch (packages/fhevm, Sepolia): the contract calls and the seal flow the
// PvP lock-in runs behind NEXT_PUBLIC_ZAMA_ENABLED.
//
// Flow, per player: make sure the match exists on chain (either client creates it, seats open, with
// the public minimum stake SEAL_MIN_STAKE) → on a staked match, make SkirmMatch a cSKIRM operator
// once (approveStake) → encrypt the nine loadout values and the stake in the browser (one proof) →
// submitLoadout, which pulls the stake into the escrow → wait for the rival →
// reveal (anyone) → public-decrypt through the relayer → finalizeReveal (anyone; the KMS proof is
// checked on chain). Every step after the submit is idempotent, so both clients run it and whoever
// gets there first does the work.
import { SkirmMatchAbi } from '@skirm/fhevm/generated';
import { Contract, ZeroAddress, id as keccakUtf8, type ContractRunner } from 'ethers';
import { zamaConfig, type HexAddress } from '@/lib/zama/config';
import { MAX_U64, MAX_U8, checkUint, publicDecrypt, toHex, type EncryptedInputs, type Hex } from '@/lib/zama/fhe';
import { ZamaWalletError } from '@/lib/zama/wallet';
import type { Team } from '@/lib/realtime/protocol';
import type { FhevmInstance } from '@zama-fhe/relayer-sdk/web';
import { CSKIRM_UNIT, parseCskirm } from '@/features/zama/stakes/stakes';

export const MATCH_STATUSES = ['none', 'open', 'locked', 'revealing', 'revealed', 'forfeited', 'cancelled', 'settled'] as const;
export type ChainStatus = (typeof MATCH_STATUSES)[number];

/**
 * The public minimum cSKIRM stake (base units) of a match this client creates:
 * NEXT_PUBLIC_ZAMA_MIN_STAKE in whole cSKIRM (default 10; 0 makes sealed matches unstaked). Both
 * clients read the same build config, so whichever creates the match asks for the same minimum.
 */
export const SEAL_MIN_STAKE = parseCskirm(process.env.NEXT_PUBLIC_ZAMA_MIN_STAKE || '10') ?? 10n * CSKIRM_UNIT;

/** Seconds the on-chain lock stays open (the off-chain lock-in grows to fit, see realtime sealedLockMs). */
export const SEAL_LOCK_WINDOW_S = 15 * 60;
/** How often the flow re-reads the match while it waits. */
export const SEAL_POLL_MS = 4_000;

/** The public match header on chain. */
export interface ChainMatch {
  status: ChainStatus;
  /** Side 0 (team A), side 1 (team B), lower-case; the zero address is an open seat. */
  players: [string, string];
  locked: [boolean, boolean];
  lockDeadline: number;
  /** Public minimum cSKIRM stake per side, base units (0: unstaked match). */
  minStake: bigint;
}

/** The deployed SkirmMatch address, or a `not_deployed` error. */
export function matchAddress(): HexAddress {
  const address = zamaConfig.contracts.match;
  if (!address) {
    throw new ZamaWalletError('not_deployed', 'SkirmMatch is not deployed yet: deploy packages/fhevm to Sepolia or set NEXT_PUBLIC_ZAMA_MATCH_ADDRESS.');
  }
  return address;
}

/** The on-chain id of an off-chain match: keccak256 of its UTF-8 id (the server computes the same). */
export function sealedMatchKey(matchId: string): Hex {
  return keccakUtf8(matchId) as Hex;
}

/** Team A is side 0, team B side 1. */
export const sideOf = (team: Team): 0 | 1 => (team === 'A' ? 0 : 1);

/** The contract calls the flow needs (an interface, so tests can fake the chain). */
export interface SkirmMatchApi {
  read(key: Hex): Promise<ChainMatch>;
  create(key: Hex, lockWindowS: number, minStake: bigint): Promise<void>;
  submit(key: Hex, side: 0 | 1, enc: EncryptedInputs): Promise<void>;
  reveal(key: Hex): Promise<void>;
  revealHandles(key: Hex): Promise<Hex[]>;
  finalize(key: Hex, abiEncodedClearValues: Hex, decryptionProof: Hex): Promise<void>;
}

type Tx = { wait: () => Promise<unknown> };

/** SkirmMatch through ethers: reads on `runner`, writes signed by it (a JsonRpcSigner). */
export function skirmMatchApi(runner: ContractRunner, address: string = matchAddress()): SkirmMatchApi {
  const c = new Contract(address, SkirmMatchAbi, runner);
  const send = async (fn: string, ...args: unknown[]) => {
    const tx = (await c.getFunction(fn)(...args)) as Tx;
    await tx.wait();
  };
  return {
    async read(key) {
      const [m, e] = (await Promise.all([c.getFunction('getMatch')(key), c.getFunction('escrow')(key)])) as [
        { players: string[]; lockDeadline: bigint; status: bigint; locked: boolean[] },
        { minStake: bigint },
      ];
      return {
        status: MATCH_STATUSES[Number(m.status)] ?? 'none',
        players: [String(m.players[0]).toLowerCase(), String(m.players[1]).toLowerCase()],
        locked: [!!m.locked[0], !!m.locked[1]],
        lockDeadline: Number(m.lockDeadline),
        minStake: BigInt(e.minStake),
      };
    },
    create: (key, lockWindowS, minStake) => send('createMatch', key, ZeroAddress, ZeroAddress, lockWindowS, minStake),
    submit: (key, side, enc) => {
      const h = enc.handles;
      return send('submitLoadout', key, side, [h[0], h[1], h[2]], [h[3], h[4], h[5]], [h[6], h[7], h[8]], h[9], enc.inputProof);
    },
    reveal: (key) => send('reveal', key),
    revealHandles: async (key) => ((await c.getFunction('revealHandles')(key)) as string[]).map((h) => h as Hex),
    finalize: (key, clear, proof) => send('finalizeReveal', key, clear, proof),
  };
}

/**
 * Encrypts the nine loadout values (uint8) and the stake (uint64) under one proof, in the order
 * submitLoadout takes them: handles 0-8 the loadout, handle 9 the stake.
 */
export async function encryptSeal(
  instance: Pick<FhevmInstance, 'createEncryptedInput'>,
  contract: string,
  user: string,
  values: readonly number[],
  stake: bigint,
): Promise<EncryptedInputs> {
  if (values.length !== 9) throw new RangeError(`encryptSeal: a loadout is 9 values, got ${values.length}`);
  const input = instance.createEncryptedInput(contract, user);
  values.forEach((v, i) => input.add8(checkUint(v, MAX_U8, `loadout[${i}]`)));
  input.add64(checkUint(stake, MAX_U64, 'stake'));
  const { handles, inputProof } = await input.encrypt();
  return { handles: handles.map((h) => toHex(h)), inputProof: toHex(inputProof) };
}

/** Where the flow is, for the lock-in panel. */
export type SealStep = 'create' | 'approve' | 'encrypt' | 'submit' | 'waiting' | 'reveal' | 'finalize' | 'revealed';

export interface SealOptions {
  api: SkirmMatchApi;
  /** The relayer SDK instance (encrypt + public decrypt). */
  instance: Pick<FhevmInstance, 'createEncryptedInput'> & Parameters<typeof publicDecrypt>[0];
  contract: string;
  /** The player's EVM address. */
  user: string;
  matchId: string;
  team: Team;
  /** The nine loadout values (@skirm/shared loadoutValues). */
  values: readonly number[];
  /** The cSKIRM stake in base units, encrypted with the loadout (ignored on an unstaked match). */
  stake?: bigint;
  /** The minimum stake a match this client creates asks for (default SEAL_MIN_STAKE). */
  minStake?: bigint;
  /** Makes SkirmMatch a cSKIRM operator for the player (no-op when it already is); run before a staked seal. */
  approveStake?: () => Promise<void>;
  onStep?: (step: SealStep, match: ChainMatch) => void;
  signal?: AbortSignal;
  pollMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

export class SealError extends Error {
  constructor(
    readonly code: 'seat_taken' | 'ended' | 'aborted',
    message: string,
  ) {
    super(message);
    this.name = 'SealError';
  }
}

const isZero = (a: string) => a === ZeroAddress.toLowerCase();
const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Seals the player's loadout and drives the match to `revealed`. Resolves once both loadouts are
 * revealed on chain; throws SealError when the seat is someone else's, the match was forfeited or
 * cancelled, or `signal` aborts.
 */
export async function sealLoadout(o: SealOptions): Promise<ChainMatch> {
  const { api } = o;
  const key = sealedMatchKey(o.matchId);
  const side = sideOf(o.team);
  const user = o.user.toLowerCase();
  const sleep = o.sleep ?? defaultSleep;
  const check = () => {
    if (o.signal?.aborted) throw new SealError('aborted', 'Sealing was stopped.');
  };

  let m = await api.read(key);
  if (m.status === 'none') {
    o.onStep?.('create', m);
    // The rival's client may create it first: then the create reverts and the re-read finds it.
    await api.create(key, SEAL_LOCK_WINDOW_S, o.minStake ?? SEAL_MIN_STAKE).catch(() => undefined);
    m = await api.read(key);
    if (m.status === 'none') throw new Error('Could not create the match on chain.');
  }
  check();

  if (!m.locked[side]) {
    const seat = m.players[side];
    if (!isZero(seat) && seat !== user) throw new SealError('seat_taken', 'Another address already holds your side of this match.');
    if (m.status !== 'open') throw new SealError('ended', `The match is ${m.status} on chain.`);
    if (m.minStake > 0n && o.approveStake) {
      o.onStep?.('approve', m);
      await o.approveStake();
      check();
    }
    o.onStep?.('encrypt', m);
    const enc = await encryptSeal(o.instance, o.contract, o.user, o.values, o.stake ?? 0n);
    check();
    o.onStep?.('submit', m);
    await api.submit(key, side, enc);
    m = await api.read(key);
  } else if (m.players[side] !== user) {
    throw new SealError('seat_taken', 'Another address already sealed your side of this match.');
  }

  // Team A sends the reveal and finalize transactions; team B takes over only if they do not land
  // within a few polls, so both players are not asked to sign the same transaction.
  let idle = 0;
  const poll = () => sleep(o.pollMs ?? SEAL_POLL_MS);
  for (;;) {
    check();
    const mine = side === 0 || idle >= FALLBACK_POLLS;
    switch (m.status) {
      case 'revealed':
      case 'settled':
        o.onStep?.('revealed', m);
        return m;
      case 'forfeited':
      case 'cancelled':
        throw new SealError('ended', m.status === 'forfeited' ? 'The rival never sealed: the match was forfeited on chain.' : 'The match was cancelled on chain.');
      case 'locked':
        o.onStep?.('reveal', m);
        // A revert (the other client revealed first) is harmless: the re-read sees `revealing`.
        if (mine) await api.reveal(key).catch(() => undefined);
        else idle++;
        await poll();
        break;
      case 'revealing':
        o.onStep?.('finalize', m);
        if (mine) {
          // The relayer can lag the reveal by a block or two; a failure is retried on the next poll.
          await api
            .revealHandles(key)
            .then((handles) => publicDecrypt(o.instance, handles))
            .then((res) => api.finalize(key, res.abiEncodedClearValues, res.decryptionProof))
            .catch(() => undefined);
        } else idle++;
        await poll();
        break;
      default:
        o.onStep?.('waiting', m);
        await poll();
    }
    m = await api.read(key);
  }
}

/** Polls team B waits for team A's reveal or finalize before sending it itself. */
export const FALLBACK_POLLS = 3;
