// "Verify on NEAR", entirely in the browser: fetch the match log from the api, recompute its hash
// chain with the engine's own canonical JSON + SHA-256 (@skirm/engine, the code the server hashed
// it with), read the registry contract's `get_match` view straight from a NEAR RPC node, and compare
// log hash, winner and score. Nothing here trusts the api's word for the onchain side.
import { canonicalJson, sha256Hex } from '@skirm/engine';
import type { ApiClient } from '@/lib/api/client';
import { ApiError } from '@/lib/api/errors';
import type { PublicMatchLog } from '@/lib/api/matchLogTypes';
import type { V2MatchRecord } from '@/lib/api/types';
import { config, type NearNetwork } from '@/lib/config';

// ---------- hash chain ----------

export interface ChainCheck {
  /** Every link recomputed (or, for a redacted tick, taken on the logged hash) and matching. */
  ok: boolean;
  /** The recomputed final hash (what goes on chain); null when the chain broke. */
  final: string | null;
  /** First place it broke: 0 for the header, else the tick number. */
  brokenAt: number | null;
  ticks: number;
  /** Ticks served without their live crew commands (private orders); their link is the logged hash. */
  redacted: number;
}

const HEX64 = /^[0-9a-f]{64}$/;

/** Recomputes the log's hash chain: header, then `sha256(prev + canonicalJson(tick))` per tick. */
export function checkChain(log: PublicMatchLog['log']): ChainCheck {
  const base = { ticks: log.ticks.length, redacted: 0 };
  if (log.hashes.length !== log.ticks.length + 1) return { ...base, ok: false, final: null, brokenAt: 0 };
  let h = sha256Hex(canonicalJson(log.header));
  if (h !== log.hashes[0]) return { ...base, ok: false, final: null, brokenAt: 0 };
  let redacted = 0;
  for (let i = 0; i < log.ticks.length; i++) {
    const t = log.ticks[i]!;
    const logged = log.hashes[i + 1]!;
    if (t.redacted) {
      if (!HEX64.test(logged)) return { ...base, redacted, ok: false, final: null, brokenAt: t.tick };
      h = logged;
      redacted++;
      continue;
    }
    h = sha256Hex(h + canonicalJson(t));
    if (h !== logged) return { ...base, redacted, ok: false, final: null, brokenAt: t.tick };
  }
  return { ...base, redacted, ok: true, final: h, brokenAt: null };
}

// ---------- registry (NEAR RPC) ----------

/** MatchRecordV2 as the registry contract's `get_match` view returns it (contracts/registry). */
export interface RegistryMatch {
  match_id: string;
  season_id: number | null;
  map_id: string;
  ranked: boolean;
  side_a: { player: string; agents: string[]; tiers: string[]; delivered: number };
  side_b: { player: string; agents: string[]; tiers: string[]; delivered: number };
  result: 'A' | 'B' | 'draw' | 'void';
  decided_by: string | null;
  head_start_ticks: number;
  ticks: number;
  log_sha256: string;
  recorded_at_ms: string;
  block_height: string;
}

/** The registry could not be read: the node is unreachable, or the contract is missing or has no `get_match`. */
export class RegistryUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RegistryUnavailable';
  }
}

interface RpcBody {
  result?: { result?: number[]; error?: string };
  error?: { name?: string; message?: string; cause?: { name?: string } };
}

const toBase64 = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s)));

/**
 * `get_match(match_id)` on the registry through JSON-RPC `query` / `call_function`
 * (https://docs.near.org/api/rpc/contracts). null when the registry holds no such match.
 */
export async function fetchRegistryMatch(
  matchId: string,
  opts: { rpcUrl?: string; contractId?: string; fetch?: typeof fetch } = {},
): Promise<RegistryMatch | null> {
  const rpcUrl = opts.rpcUrl ?? config.near.rpcUrl;
  const contractId = opts.contractId ?? config.near.contracts.registry;
  const f = opts.fetch ?? fetch;
  let body: RpcBody;
  try {
    const res = await f(rpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'skirm-verify',
        method: 'query',
        params: {
          request_type: 'call_function',
          finality: 'final',
          account_id: contractId,
          method_name: 'get_match',
          args_base64: toBase64(JSON.stringify({ match_id: matchId })),
        },
      }),
    });
    if (!res.ok) throw new RegistryUnavailable(`NEAR RPC answered ${res.status}`);
    body = (await res.json()) as RpcBody;
  } catch (err) {
    if (err instanceof RegistryUnavailable) throw err;
    throw new RegistryUnavailable('could not reach the NEAR RPC node');
  }
  if (body.error) {
    if (body.error.cause?.name === 'UNKNOWN_ACCOUNT') throw new RegistryUnavailable(`${contractId} does not exist on this network`);
    throw new RegistryUnavailable(body.error.message ?? body.error.name ?? 'NEAR RPC error');
  }
  if (body.result?.error) {
    if (/CodeDoesNotExist/.test(body.result.error)) throw new RegistryUnavailable(`${contractId} has no contract deployed`);
    if (/MethodNotFound/.test(body.result.error)) throw new RegistryUnavailable(`${contractId} has no get_match view`);
    throw new RegistryUnavailable(body.result.error);
  }
  if (!Array.isArray(body.result?.result)) throw new RegistryUnavailable('NEAR RPC: no result');
  const text = new TextDecoder().decode(new Uint8Array(body.result.result));
  return JSON.parse(text) as RegistryMatch | null;
}

// ---------- verdict ----------

/** verified: onchain record matches the recomputed log. mismatch: something disagrees. not_recorded: the registry has no record. unavailable: could not check onchain. */
export type VerifyStatus = 'verified' | 'mismatch' | 'not_recorded' | 'unavailable';

export interface VerifyCheck {
  id: 'chain' | 'server_hash' | 'log_result' | 'chain_hash' | 'chain_winner' | 'chain_score';
  where: 'browser' | 'near';
  label: string;
  ok: boolean;
  detail: string;
}

export interface VerifyReport {
  matchId: string;
  status: VerifyStatus;
  /** Why it is not_recorded or unavailable, in a sentence. */
  reason: string | null;
  checks: VerifyCheck[];
  chain: ChainCheck | null;
  /** The recomputed final log hash. */
  logHash: string | null;
  record: RegistryMatch | null;
  links: { contract: string; tx: string | null };
}

export type VerifyMatch = Pick<V2MatchRecord, 'id' | 'ranked' | 'status' | 'winner' | 'score' | 'logHash' | 'registry'> & { practice?: boolean };

const short = (h: string | null | undefined) => (h ? `${h.slice(0, 10)}…${h.slice(-6)}` : 'none');
const scoreText = (s: { A: number; B: number } | null | undefined) => (s ? `${s.A}–${s.B}` : 'none');

export function explorerBase(network: NearNetwork = config.near.network): string {
  return network === 'mainnet' ? 'https://nearblocks.io' : 'https://testnet.nearblocks.io';
}

/** nearblocks links for the registry contract and the match's registry transaction (a real hash only). */
export function verifyLinks(match: Pick<VerifyMatch, 'registry'>, contractId: string = config.near.contracts.registry, network?: NearNetwork) {
  const base = explorerBase(network);
  const tx = match.registry.txHash;
  return {
    contract: `${base}/address/${encodeURIComponent(contractId)}`,
    tx: tx && !/^(noop|dev):/.test(tx) ? `${base}/txns/${encodeURIComponent(tx)}` : null,
  };
}

/** Why a match has no onchain record, from what the api says about it. */
export function notRecordedReason(match: VerifyMatch): string {
  if (match.status === 'void') return 'Void matches are never written to the registry.';
  if (!match.ranked) return 'Only ranked matches are written to the NEAR registry; casual and practice matches stay off chain.';
  switch (match.registry.status) {
    case 'local':
      return 'NEAR is off on this server, so nothing is written onchain.';
    case 'pending':
      return 'The result is queued for the registry but not written yet. Try again later.';
    case 'failed':
      return 'The write to the registry failed, so the result is not onchain.';
    default:
      return "The registry has no record of this match. The platform's NEAR signer is not set up yet, so most matches are not recorded onchain.";
  }
}

/** Compares the recomputed log, the api's match and the registry record. `record` 'unavailable' when NEAR could not be read. */
export function buildReport(input: {
  match: VerifyMatch;
  log: PublicMatchLog | null;
  record: RegistryMatch | null | { unavailable: string };
  contractId?: string;
  network?: NearNetwork;
}): VerifyReport {
  const { match, log } = input;
  const checks: VerifyCheck[] = [];
  const chain = log ? checkChain(log.log) : null;
  const logHash = chain?.final ?? null;

  if (!log || !chain) {
    checks.push({ id: 'chain', where: 'browser', label: 'Match log hash chain', ok: false, detail: 'The match log is not available, so nothing could be recomputed.' });
  } else {
    checks.push({
      id: 'chain',
      where: 'browser',
      label: 'Match log hash chain',
      ok: chain.ok,
      detail: chain.ok
        ? `${chain.ticks} ticks rechained in your browser${chain.redacted ? ` (${chain.redacted} with private crew orders taken on their logged hash)` : ''}`
        : chain.brokenAt === 0
          ? 'The header does not hash to the first link.'
          : `The chain breaks at tick ${chain.brokenAt}.`,
    });
    if (chain.ok) {
      checks.push({
        id: 'server_hash',
        where: 'browser',
        label: "Matches the server's log hash",
        ok: logHash === match.logHash,
        detail: logHash === match.logHash ? short(logHash) : `recomputed ${short(logHash)}, server says ${short(match.logHash)}`,
      });
    }
    const r = log.log.result;
    if (r) {
      const ok = r.winner === match.winner && !!match.score && r.score.A === match.score.A && r.score.B === match.score.B;
      checks.push({
        id: 'log_result',
        where: 'browser',
        label: 'Log result matches the scoreboard',
        ok,
        detail: ok ? `${r.winner === 'draw' ? 'draw' : `${r.winner} wins`} ${scoreText(r.score)}` : `log ${r.winner} ${scoreText(r.score)}, scoreboard ${match.winner ?? 'none'} ${scoreText(match.score)}`,
      });
    }
  }

  const localOk = checks.every((c) => c.ok);
  const links = verifyLinks(match, input.contractId, input.network);
  const base = { matchId: match.id, checks, chain, logHash, links };

  if (input.record && 'unavailable' in input.record) {
    return { ...base, status: localOk ? 'unavailable' : 'mismatch', reason: `Could not read the registry: ${input.record.unavailable}.`, record: null };
  }
  const record = input.record;
  if (!record) {
    return { ...base, status: localOk ? 'not_recorded' : 'mismatch', reason: notRecordedReason(match), record: null };
  }

  const hashOk = !!logHash && record.log_sha256 === logHash;
  checks.push({ id: 'chain_hash', where: 'near', label: 'Onchain log hash', ok: hashOk, detail: hashOk ? short(record.log_sha256) : `onchain ${short(record.log_sha256)}, recomputed ${short(logHash)}` });
  const winnerOk = record.result === match.winner;
  checks.push({ id: 'chain_winner', where: 'near', label: 'Onchain winner', ok: winnerOk, detail: winnerOk ? record.result : `onchain ${record.result}, scoreboard ${match.winner ?? 'none'}` });
  const onchainScore = { A: record.side_a.delivered, B: record.side_b.delivered };
  const scoreOk = !!match.score && onchainScore.A === match.score.A && onchainScore.B === match.score.B;
  checks.push({ id: 'chain_score', where: 'near', label: 'Onchain score', ok: scoreOk, detail: scoreOk ? scoreText(onchainScore) : `onchain ${scoreText(onchainScore)}, scoreboard ${scoreText(match.score)}` });

  return { ...base, status: checks.every((c) => c.ok) ? 'verified' : 'mismatch', reason: null, record };
}

/** The whole check for one match id: api match + log, registry view, report. Throws ApiError for an unknown or live match. */
export async function verifyMatch(
  api: Pick<ApiClient, 'v2Match' | 'v2MatchLog'>,
  matchId: string,
  opts: { rpcUrl?: string; contractId?: string; network?: NearNetwork; fetch?: typeof fetch } = {},
): Promise<VerifyReport> {
  const match = await api.v2Match(matchId);
  if (match.status === 'live') throw new ApiError(409, 'match_live', 'the match is still being played');
  const [log, record] = await Promise.all([
    api.v2MatchLog(matchId).catch((err: unknown) => {
      if (err instanceof ApiError && err.status === 404) return null;
      throw err;
    }),
    fetchRegistryMatch(match.id, opts).catch((err: unknown) => {
      if (err instanceof RegistryUnavailable) return { unavailable: err.message };
      throw err;
    }),
  ]);
  return buildReport({ match, log, record, ...(opts.contractId ? { contractId: opts.contractId } : {}), ...(opts.network ? { network: opts.network } : {}) });
}
