// Season prize pools (contract `seasons`: open_season, lock_season, post_standings,
// close_season) and the no-op stand-in used when NEAR_OPS_ACCOUNT/NEAR_OPS_KEY are unset.
import { createHash } from 'node:crypto';
import type { RegistryResult } from './registry';
import type { NearRpc } from './rpc';
import type { FunctionCaller } from './signer';

export interface OpenSeasonInput {
  /** Season number; the contract requires it to increase. */
  id: number;
  name: string;
  startsAtMs: number;
  endsAtMs: number;
}

/** One row of the final top 10, best first. */
export interface SeasonStandingInput {
  /** Platform account id. */
  player: string;
  /** NEAR account that can claim the prize; without one the share goes to the carry. */
  near?: string | null;
  points: number;
}

export type ChainSeasonStatus = 'open' | 'locked' | 'paid';

/** A season as the contract returns it; amounts are yoctoNEAR decimal strings. */
export interface ChainSeason {
  id: number;
  name: string;
  startsAtMs: number;
  endsAtMs: number;
  status: ChainSeasonStatus;
  pool: string;
  standings: {
    rank: number;
    player: string;
    near: string | null;
    points: number;
    share: string;
    claimed: boolean;
  }[];
  standingsPosted: boolean;
  paidTotal: string;
}

export interface SeasonsChain {
  readonly kind: 'noop' | 'near';
  openSeason(input: OpenSeasonInput): Promise<RegistryResult>;
  lockSeason(id: number): Promise<RegistryResult>;
  postStandings(id: number, standings: SeasonStandingInput[]): Promise<RegistryResult>;
  closeSeason(id: number): Promise<RegistryResult>;
  /** null when the season does not exist onchain; undefined = unknown (noop). */
  getSeason(id: number): Promise<ChainSeason | null | undefined>;
}

export interface SeasonsCall {
  method: 'open_season' | 'lock_season' | 'post_standings' | 'close_season';
  args: Record<string, unknown>;
}

export function openSeasonArgs(i: OpenSeasonInput): Record<string, unknown> {
  return {
    id: i.id,
    name: i.name,
    starts_at_ms: Math.floor(i.startsAtMs),
    ends_at_ms: Math.floor(i.endsAtMs),
  };
}

export function postStandingsArgs(
  id: number,
  standings: SeasonStandingInput[],
): Record<string, unknown> {
  return {
    id,
    standings: standings.map((s) => ({
      player: s.player,
      near: s.near ?? null,
      points: Math.max(0, Math.round(s.points)),
    })),
  };
}

interface RawSeason {
  id: number;
  name: string;
  starts_at_ms: number;
  ends_at_ms: number;
  status: ChainSeasonStatus;
  pool: string;
  standings: {
    rank: number;
    player: string;
    near: string | null;
    points: number;
    share: string;
    claimed: boolean;
  }[];
  standings_posted: boolean;
  paid_total: string;
}

export function parseChainSeason(raw: RawSeason): ChainSeason {
  return {
    id: raw.id,
    name: raw.name,
    startsAtMs: raw.starts_at_ms,
    endsAtMs: raw.ends_at_ms,
    status: raw.status,
    pool: raw.pool,
    standings: raw.standings.map((s) => ({
      rank: s.rank,
      player: s.player,
      near: s.near ?? null,
      points: s.points,
      share: s.share,
      claimed: s.claimed,
    })),
    standingsPosted: raw.standings_posted,
    paidTotal: raw.paid_total,
  };
}

const fakeHash = (body: SeasonsCall) =>
  `noop:${createHash('sha256').update('season').update(JSON.stringify(body)).digest('hex').slice(0, 44)}`;

/** Local stand-in: records each call; nothing goes onchain and the result is `local`. */
export class NoopSeasons implements SeasonsChain {
  readonly kind = 'noop' as const;
  readonly calls: SeasonsCall[] = [];
  private record(call: SeasonsCall): RegistryResult {
    this.calls.push(call);
    return { status: 'local', txHash: fakeHash(call) };
  }
  async openSeason(input: OpenSeasonInput): Promise<RegistryResult> {
    return this.record({ method: 'open_season', args: openSeasonArgs(input) });
  }
  async lockSeason(id: number): Promise<RegistryResult> {
    return this.record({ method: 'lock_season', args: { id } });
  }
  async postStandings(id: number, standings: SeasonStandingInput[]): Promise<RegistryResult> {
    return this.record({ method: 'post_standings', args: postStandingsArgs(id, standings) });
  }
  async closeSeason(id: number): Promise<RegistryResult> {
    return this.record({ method: 'close_season', args: { id } });
  }
  async getSeason(): Promise<undefined> {
    return undefined;
  }
}

/**
 * Calls the seasons contract with the ops function-call key. Throws on failure (the job retries;
 * every write is idempotent onchain, so resending one that already landed is safe).
 */
export class NearSeasons implements SeasonsChain {
  readonly kind = 'near' as const;
  constructor(
    private readonly caller: FunctionCaller,
    private readonly rpc: Pick<NearRpc, 'view'>,
    private readonly contractId: string,
  ) {}
  private async send(call: SeasonsCall): Promise<RegistryResult> {
    const { txHash } = await this.caller.call(this.contractId, call.method, call.args);
    return { status: 'recorded', txHash };
  }
  openSeason(input: OpenSeasonInput): Promise<RegistryResult> {
    return this.send({ method: 'open_season', args: openSeasonArgs(input) });
  }
  lockSeason(id: number): Promise<RegistryResult> {
    return this.send({ method: 'lock_season', args: { id } });
  }
  postStandings(id: number, standings: SeasonStandingInput[]): Promise<RegistryResult> {
    return this.send({ method: 'post_standings', args: postStandingsArgs(id, standings) });
  }
  closeSeason(id: number): Promise<RegistryResult> {
    return this.send({ method: 'close_season', args: { id } });
  }
  async getSeason(id: number): Promise<ChainSeason | null> {
    const raw = await this.rpc.view<RawSeason | null>(this.contractId, 'get_season', { id });
    return raw ? parseChainSeason(raw) : null;
  }
}
