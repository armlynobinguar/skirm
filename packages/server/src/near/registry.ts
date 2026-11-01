// Match registry (contract `registry`: record_match, v2 records), skill minter (`skills`:
// nft_mint) and their no-op stand-ins used when NEAR_OPS_ACCOUNT/NEAR_OPS_KEY are unset.
import { createHash } from 'node:crypto';
import { HEAD_START_TICKS_PER_AGENT } from '@skirm/engine/v2';
import type { Tag } from '@skirm/shared';
import type { FunctionCaller } from './signer';

/**
 * `local`: the NoopRegistry took the record because NEAR is off (no NEAR_OPS_*); nothing went
 * onchain and nothing will. Distinct from `pending` (a NEAR write still to come).
 */
export type RegistryStatus = 'pending' | 'recorded' | 'failed' | 'local';

export interface RegistryResult {
  status: RegistryStatus;
  txHash?: string;
}

/** What decided a v2 match (engine v2 MatchResult.decidedBy). */
export type MatchDecidedBy = 'goal' | 'score' | 'fewer_agents' | 'earlier' | 'draw';

/** One crew as it played a v2 match. */
export interface RecordMatchSide {
  /** NEAR account or platform account id. */
  player: string;
  /** Agents in crew order with the talk tier each locked in (v2_matches crews). */
  crew: { id: string; tier: string }[];
  /** Items the crew delivered (its score). */
  delivered: number;
}

/** A v2 match for the registry's record_match (MatchRecordV2). */
export interface RecordMatchInput {
  matchId: string;
  /** Season the ranked match counts for; left out until seasons exist. */
  seasonId?: number;
  mapId: string;
  ranked: boolean;
  sideA: RecordMatchSide;
  sideB: RecordMatchSide;
  result: 'A' | 'B' | 'draw' | 'void';
  /** null only for a void match. */
  decidedBy: MatchDecidedBy | null;
  ticks: number;
  /** Final hash of the match log. */
  logSha256: string;
  /** Per-player Elo change of a ranked result (v2_matches elo_deltas); sent only when ranked and not void. */
  eloDeltas: { team: 'A' | 'B'; delta: number }[];
}

export interface Registry {
  readonly kind: 'noop' | 'near';
  recordMatch(input: RecordMatchInput): Promise<RegistryResult>;
}

const fakeHash = (prefix: string, body: unknown) =>
  `noop:${createHash('sha256').update(prefix).update(JSON.stringify(body)).digest('hex').slice(0, 44)}`;

/** Local stand-in: nothing goes onchain; the record is `local` with a fake `noop:` hash. */
export class NoopRegistry implements Registry {
  readonly kind = 'noop' as const;
  readonly matches: RecordMatchInput[] = [];
  async recordMatch(input: RecordMatchInput): Promise<RegistryResult> {
    this.matches.push(input);
    return { status: 'local', txHash: fakeHash('match', input) };
  }
}

/**
 * record_match args as the registry contract takes them (MatchRecordV2 without the applied Elo).
 * The smaller crew's head start is 5 ticks per agent of difference, as the engine sets it.
 */
export function recordMatchArgs(i: RecordMatchInput): Record<string, unknown> {
  const side = (s: RecordMatchSide) => ({
    player: s.player,
    agents: s.crew.map((c) => c.id),
    tiers: s.crew.map((c) => c.tier),
    delivered: Math.max(0, Math.round(s.delivered)),
  });
  const rated = i.ranked && i.result !== 'void';
  return {
    match_id: i.matchId,
    season_id: i.seasonId ?? null,
    map_id: i.mapId,
    ranked: i.ranked,
    side_a: side(i.sideA),
    side_b: side(i.sideB),
    result: i.result,
    decided_by: i.result === 'void' ? null : i.decidedBy,
    head_start_ticks:
      HEAD_START_TICKS_PER_AGENT * Math.abs(i.sideA.crew.length - i.sideB.crew.length),
    ticks: Math.max(0, Math.round(i.ticks)),
    log_sha256: i.logSha256,
    elo_changes: rated
      ? i.eloDeltas.map((e) => ({
          player: (e.team === 'A' ? i.sideA : i.sideB).player,
          delta: e.delta,
        }))
      : [],
  };
}

/** Calls the registry contract with the ops function-call key. Throws on failure (the job retries). */
export class NearRegistry implements Registry {
  readonly kind = 'near' as const;
  constructor(
    private readonly caller: FunctionCaller,
    private readonly contractId: string,
  ) {}
  async recordMatch(input: RecordMatchInput): Promise<RegistryResult> {
    const { txHash } = await this.caller.call(
      this.contractId,
      'record_match',
      recordMatchArgs(input),
    );
    return { status: 'recorded', txHash };
  }
}

// ---------- Minter ----------

export interface SkillMintInput {
  id: string;
  version: number;
  name: string;
  summary?: string | null;
  /** NEAR account of the writer; receives the token and royalties. */
  creator: string;
  royaltyBps: number;
  requiresActions: ('place_block' | 'dig' | 'extinguish')[];
  handlesTags: Tag[];
  promptSha256: string;
  /** ISO 8601 UTC. */
  createdAt: string;
}

export interface MintResult {
  tokenId: string;
  status: 'minted' | 'pending';
  txHash?: string;
}

export interface Minter {
  readonly kind: 'noop' | 'near';
  mint(skill: SkillMintInput): Promise<MintResult>;
}

/** Token id the skills contract assigns: `<skill id>:<version>`. */
export const skillTokenId = (id: string, version: number) => `${id}:${version}`;

export class NoopMinter implements Minter {
  readonly kind = 'noop' as const;
  readonly minted: SkillMintInput[] = [];
  async mint(skill: SkillMintInput): Promise<MintResult> {
    this.minted.push(skill);
    return { tokenId: skillTokenId(skill.id, skill.version), status: 'pending' };
  }
}

export function nftMintArgs(s: SkillMintInput): Record<string, unknown> {
  return {
    skill: {
      id: s.id,
      version: s.version,
      name: s.name,
      summary: s.summary ?? null,
      creator: s.creator,
      royalty_bps: s.royaltyBps,
      requires_actions: s.requiresActions,
      handles_tags: s.handlesTags,
      prompt_sha256: s.promptSha256,
      created_at: new Date(s.createdAt).toISOString().replace(/\.\d{3}Z$/, 'Z'),
    },
  };
}

export class NearMinter implements Minter {
  readonly kind = 'near' as const;
  constructor(
    private readonly caller: FunctionCaller,
    private readonly contractId: string,
  ) {}
  async mint(skill: SkillMintInput): Promise<MintResult> {
    const { txHash, value } = await this.caller.call(
      this.contractId,
      'nft_mint',
      nftMintArgs(skill),
      150,
    );
    const tokenId =
      value &&
      typeof value === 'object' &&
      typeof (value as { token_id?: unknown }).token_id === 'string'
        ? (value as { token_id: string }).token_id
        : skillTokenId(skill.id, skill.version);
    return { tokenId, status: 'minted', txHash };
  }
}
