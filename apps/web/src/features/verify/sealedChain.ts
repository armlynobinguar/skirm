// "Verify a sealed round": the read side. Reads SkirmMatch (packages/fhevm) on Sepolia over a public
// JSON-RPC node, read-only: no wallet, no account, no skirm server in between. The views give the
// stored state (status, revealed loadouts, randomness, settlement, escrow handles); the event scan
// gives where each step happened (block, log index, transaction), so the order of the commitments and
// the reveal transactions can be shown. The comparison itself is ./sealed.ts.
//
// Every SkirmMatch event takes the match id as its first indexed argument, so one `eth_getLogs`
// filter (address + topic1) returns all of a match's events. Public RPCs cap the block range of a
// log query, so the scan walks back from the latest block in windows until it finds MatchCreated,
// stopping at the deploy block (packages/fhevm deployments, or NEXT_PUBLIC_ZAMA_MATCH_FROM_BLOCK).
import { SkirmMatchAbi, sepolia } from '@skirm/fhevm/generated';
import { Contract, Interface, JsonRpcProvider, id as keccakUtf8 } from 'ethers';
import { zamaConfig } from '@/lib/zama/config';
import { CHAIN_STATUSES, type ChainEvent, type SealedChainRecord } from './sealed';

/** Blocks per eth_getLogs query (public Sepolia nodes accept 10k). */
export const LOG_WINDOW = 10_000;
/** How far back the scan goes without a known deploy block (about 6 weeks of Sepolia blocks). */
export const MAX_LOOKBACK_BLOCKS = 300_000;
/** Windows queried at once. */
const PARALLEL = 4;

/** The block event scans start at: NEXT_PUBLIC_ZAMA_MATCH_FROM_BLOCK, else SkirmMatch's deploy block. */
export function matchFromBlock(): number | null {
  const env = Number(process.env.NEXT_PUBLIC_ZAMA_MATCH_FROM_BLOCK);
  if (Number.isInteger(env) && env > 0) return env;
  return sepolia.deployBlocks?.SkirmMatch ?? null;
}

/** keccak256(utf8(matchId)): the on-chain id SkirmMatch keys a match by. */
export const chainKey = (matchId: string): string => keccakUtf8(matchId);

/** The SkirmMatch views the check reads (ethers-shaped results), and its event log. Faked in tests. */
export interface SealedChainSource {
  contract: string;
  getMatch(key: string): Promise<{ players: readonly string[]; status: bigint; locked: readonly boolean[] }>;
  revealedLoadout(key: string, side: number): Promise<{ agents: readonly bigint[]; skills: readonly bigint[]; tiers: readonly bigint[] }>;
  randomness(key: string): Promise<{ seed: bigint; drops: readonly bigint[]; startedAt: bigint; dropsRevealed: bigint }>;
  settlement(key: string): Promise<{ logHash: string; winner: bigint; settledAt: bigint }>;
  escrow(key: string): Promise<{ minStake: bigint; matchFeeBps: bigint; staked: readonly string[]; paid: readonly string[]; stakeOkClear: readonly boolean[] }>;
  blockNumber(): Promise<number>;
  /** The match's events in [from, to], any order. */
  events(key: string, from: number, to: number): Promise<ChainEvent[]>;
}

const plain = (v: unknown): unknown => (typeof v === 'bigint' ? v.toString() : Array.isArray(v) ? v.map(plain) : v);

/** SkirmMatch over a read-only JsonRpcProvider. */
export function ethersSealedSource(address: string, rpcUrl: string = zamaConfig.rpcUrl): SealedChainSource {
  const provider = new JsonRpcProvider(rpcUrl, zamaConfig.chainId, { staticNetwork: true });
  const c = new Contract(address, SkirmMatchAbi, provider);
  const iface = new Interface(SkirmMatchAbi);
  const call = <T,>(fn: string, ...args: unknown[]) => c.getFunction(fn)(...args) as Promise<T>;
  return {
    contract: address,
    getMatch: (key) => call('getMatch', key),
    revealedLoadout: (key, side) => call('revealedLoadout', key, side),
    randomness: (key) => call('randomness', key),
    settlement: (key) => call('settlement', key),
    escrow: (key) => call('escrow', key),
    blockNumber: () => provider.getBlockNumber(),
    async events(key, from, to) {
      const logs = await provider.getLogs({ address, topics: [null, key], fromBlock: from, toBlock: to });
      return logs.flatMap((l) => {
        const parsed = iface.parseLog({ topics: [...l.topics], data: l.data });
        if (!parsed) return [];
        const args = Object.fromEntries(parsed.fragment.inputs.map((input, i) => [input.name, plain(parsed.args[i])]));
        return [{ name: parsed.name, block: l.blockNumber, logIndex: l.index, tx: l.transactionHash, args }];
      });
    },
  };
}

/**
 * The match's events, walking back from the latest block in LOG_WINDOW windows until MatchCreated
 * turns up or the floor (the deploy block, else MAX_LOOKBACK_BLOCKS back) is reached. `partial`:
 * MatchCreated was not found and the scan stopped short of the deploy block.
 */
export async function scanEvents(source: SealedChainSource, key: string, opts: { fromBlock?: number | null; window?: number; maxLookback?: number } = {}): Promise<{ events: ChainEvent[]; partial: boolean }> {
  const window = opts.window ?? LOG_WINDOW;
  const latest = await source.blockNumber();
  const known = opts.fromBlock ?? null;
  const floor = Math.max(0, known ?? latest - (opts.maxLookback ?? MAX_LOOKBACK_BLOCKS));
  const found: ChainEvent[] = [];
  let to = latest;
  while (to >= floor) {
    const ranges: [number, number][] = [];
    for (let i = 0; i < PARALLEL && to >= floor; i++) {
      const from = Math.max(floor, to - window + 1);
      ranges.push([from, to]);
      to = from - 1;
    }
    const batches = await Promise.all(ranges.map(([f, t]) => source.events(key, f, t)));
    for (const b of batches) found.push(...b);
    if (found.some((e) => e.name === 'MatchCreated')) break;
  }
  found.sort((a, b) => a.block - b.block || a.logIndex - b.logIndex);
  const created = found.some((e) => e.name === 'MatchCreated');
  return { events: found, partial: !created && (known === null || floor > known) };
}

const triple = (v: readonly bigint[]): [number, number, number] => [Number(v[0]), Number(v[1]), Number(v[2])];

/** Reads everything ./sealed.ts compares, for one off-chain match id. */
export async function readSealedChain(source: SealedChainSource, matchId: string, opts: { fromBlock?: number | null; window?: number; maxLookback?: number } = {}): Promise<SealedChainRecord> {
  const key = chainKey(matchId);
  const [m, rnd, settled, esc, scan] = await Promise.all([source.getMatch(key), source.randomness(key), source.settlement(key), source.escrow(key), scanEvents(source, key, opts)]);
  const status = CHAIN_STATUSES[Number(m.status)] ?? 'none';
  const started = rnd.startedAt > 0n;
  const revealed = started ? await Promise.all([0, 1].map((side) => source.revealedLoadout(key, side))) : null;
  const dropsRevealed = Number(rnd.dropsRevealed);
  return {
    contract: source.contract,
    key,
    status,
    players: [String(m.players[0]).toLowerCase(), String(m.players[1]).toLowerCase()],
    locked: [!!m.locked[0], !!m.locked[1]],
    revealed: revealed ? (revealed.map((r) => ({ agents: triple(r.agents), skills: triple(r.skills), tiers: triple(r.tiers) })) as SealedChainRecord['revealed']) : null,
    randomness: { seed: started ? rnd.seed.toString() : null, drops: rnd.drops.map((v, i) => (i < dropsRevealed ? Number(v) : null)), startedAt: Number(rnd.startedAt) },
    settlement: settled.settledAt > 0n ? { logHash: String(settled.logHash).toLowerCase(), winner: Number(settled.winner), settledAt: Number(settled.settledAt) } : null,
    escrow: {
      minStake: esc.minStake.toString(),
      feeBps: Number(esc.matchFeeBps),
      staked: [String(esc.staked[0]), String(esc.staked[1])],
      paid: [String(esc.paid[0]), String(esc.paid[1])],
      stakeOk: [!!esc.stakeOkClear[0], !!esc.stakeOkClear[1]],
    },
    events: scan.events,
    ...(scan.partial ? { eventsPartial: true } : {}),
  };
}
