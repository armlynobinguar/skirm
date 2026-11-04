// Response shapes. Skill views are built from SkillVersionView, which carries no prompt, reflexes or
// ciphertext; the creator's read-back is added only in SkillsController.get.
import {
  v2DebriefOf,
  type AccountRow,
  type LedgerRowRecord,
  type ListingRow,
  type MatchMessageRow,
  type SaleRow,
  type SeasonRow,
  type SeasonStanding,
  type SkillBenchmarkRow,
  type SkillTrialRow,
  type SkillVersionView,
  type V2MatchRow,
} from '@skirm/db';
import { BOT_HANDLE } from '@skirm/engine/v2';
import { SEASON, normalizeSkillRoles, skillTriggerOf, splitSale, type SkillPublic, type SkillRole } from '@skirm/shared';

export const accountView = (a: AccountRow) => ({
  id: a.id,
  handle: a.handle,
  nearAccountId: a.nearAccountId ?? null,
  /** "Joined" (S16). */
  createdAt: new Date(a.createdAt).toISOString(),
});

const STATUS_LABEL = { draft: 'Draft', minted: 'Minted', listed: 'Listed' } as const;
/** Account-bound starter skills (Flood Warden) are never minted: S07 shows them as Starter. */
const STARTER_LABEL = 'Starter' as const;

export type SkillPublicView = SkillPublic & {
  /** Agent roles that may equip this version: `['any']` or role names. */
  roles: SkillRole[];
  status: (typeof STATUS_LABEL)[keyof typeof STATUS_LABEL] | typeof STARTER_LABEL;
  tokenId: string | null;
  latestVersion: number;
  accountBound: boolean;
  creatorAccount: { id: string; handle: string; nearAccountId: string | null };
};

/** skirm.skill/v0 without prompt and reflexes (Spec §9), plus status and token. */
export function skillPublic(v: SkillVersionView, owner?: string): SkillPublicView {
  const creator = v.creatorNear ?? v.creatorHandle;
  return {
    schema: 'skirm.skill/v0',
    id: v.id,
    version: v.version,
    name: v.name,
    ...(v.summary ? { summary: v.summary } : {}),
    creator,
    owner: owner ?? creator,
    royalty_bps: v.royaltyBps,
    requires_actions: v.requiresActions,
    handles_tags: v.handlesTags,
    roles: normalizeSkillRoles(v.roles),
    prompt_sha256: v.promptSha256,
    created_at: new Date(v.createdAt).toISOString(),
    trigger: skillTriggerOf(v.trigger),
    status: v.accountBound ? STARTER_LABEL : STATUS_LABEL[v.status],
    tokenId: v.tokenId,
    latestVersion: v.latestVersion,
    accountBound: v.accountBound,
    creatorAccount: { id: v.creatorId, handle: v.creatorHandle, nearAccountId: v.creatorNear },
  };
}

const iso = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString() : null);

/** The v2 match a ledger row belongs to: realtime keys each crew's hold `<matchId>-A` / `-B`. */
const LEDGER_MATCH_RE = /^(mat_[0-9A-HJKMNP-TV-Z]{26})-[AB]$/;

/** The match id a ledger row's hold key names, or null (top-ups, cosmetics and any other key). */
export function ledgerMatchId(runId: string | null): string | null {
  return (runId && LEDGER_MATCH_RE.exec(runId)?.[1]) || null;
}

export const ledgerRowView = (r: LedgerRowRecord) => ({
  id: r.id,
  type: r.type,
  amount: r.amount,
  source: r.source,
  note: r.note,
  matchId: ledgerMatchId(r.runId),
  txHash: r.txHash,
  createdAt: iso(r.createdAt),
});

/**
 * A listing, with the Formulas §6 split of its price when the skill version is known (M02 shows
 * price, creator royalty and platform fee before the wallet signs): no royalty on a primary sale.
 */
export const listingView = (
  l: ListingRow,
  v?: Pick<SkillVersionView, 'creatorId' | 'royaltyBps'>,
) => {
  const out = {
    id: l.id,
    skillId: l.skillId,
    version: l.version,
    tokenId: l.tokenId,
    sellerId: l.sellerId,
    priceYocto: l.priceYocto,
    txHash: l.txHash,
    status: l.status,
    createdAt: iso(l.createdAt),
  };
  if (!v) return out;
  const primary = l.sellerId === v.creatorId;
  const s = splitSale(BigInt(l.priceYocto), { primary, royaltyBps: v.royaltyBps });
  return {
    ...out,
    split: {
      primary,
      feeYocto: s.fee.toString(),
      royaltyYocto: s.royalty.toString(),
      sellerYocto: s.seller.toString(),
    },
  };
};

export const saleView = (s: SaleRow) => ({
  id: s.id,
  skillId: s.skillId,
  version: s.version,
  tokenId: s.tokenId,
  sellerId: s.sellerId,
  buyerId: s.buyerId,
  priceYocto: s.priceYocto,
  txHash: s.txHash,
  createdAt: iso(s.createdAt),
});

// ---------- v2 matches ----------

/** Team B's name in a practice match: the greedy bot, not the system account. */
export const PRACTICE_BOT_HANDLE = BOT_HANDLE;

/** A line of GET /v2/matches/:id/messages. */
export const messageView = (r: MatchMessageRow) => ({
  tick: r.tick,
  team: r.team,
  agent: { id: r.agentId, name: r.agentName },
  channel: r.channel,
  text: r.text,
  heardBy: r.heardBy,
  overheardBy: r.overheardBy,
});

/**
 * GET /v2/matches/:id (web V2MatchRecord). Public: crews as they played, the result, Elo changes and
 * crew stats; `you` and the caller's own `debrief` only for a player of the match. The log stays
 * server side (its hash is the proof).
 */
export function v2MatchView(m: V2MatchRow, handles: { A: string | null; B: string | null }, viewerId?: string) {
  const you = viewerId === m.teamAAccountId ? 'A' : viewerId === m.teamBAccountId ? 'B' : undefined;
  // The rival stays hidden until the match ends (found, lock-in and live share status 'live'):
  // until then only a player's own side is shown, and only to that player.
  const team = (t: 'A' | 'B', accountId: string) =>
    m.status === 'live' && you !== t
      ? { accountId: null, handle: null, crew: [] }
      : { accountId, handle: m.practice && t === 'B' ? PRACTICE_BOT_HANDLE : handles[t], crew: m.crews?.[t] ?? [] };
  return {
    id: m.id,
    mapId: m.mapId,
    ranked: m.ranked,
    practice: m.practice,
    status: m.status,
    difficulty: m.difficulty ?? null,
    teams: {
      A: team('A', m.teamAAccountId),
      B: team('B', m.teamBAccountId),
    },
    winner: m.winner ?? null,
    reason: m.reason ?? null,
    decidedBy: m.decidedBy ?? null,
    score: m.scoreA !== null && m.scoreB !== null ? { A: m.scoreA, B: m.scoreB } : null,
    ticks: m.ticks ?? null,
    elo: m.eloDeltas ?? [],
    stats: m.stats ?? null,
    logHash: m.logHash ?? null,
    // A void or casual match is never recorded.
    registry: {
      status: m.status === 'void' ? 'none' : m.registryStatus,
      ...(m.registryTx ? { txHash: m.registryTx } : {}),
    },
    createdAt: iso(m.createdAt),
    endedAt: iso(m.endedAt),
    ...(you ? { you, debrief: v2DebriefOf(m, you) } : {}),
  };
}

/**
 * A row of GET /v2/matches/live: who plays (the bot side of a practice match as the greedy bot) and
 * how many agents each side brought. Crew agents stay hidden while the match is live.
 */
export function v2LiveView(m: V2MatchRow, handles: { A: string | null; B: string | null }) {
  const team = (t: 'A' | 'B') => ({
    handle: m.practice && t === 'B' ? PRACTICE_BOT_HANDLE : handles[t],
    size: m.crews?.[t]?.length ?? 0,
  });
  return {
    id: m.id,
    mapId: m.mapId,
    difficulty: m.difficulty ?? null,
    ranked: m.ranked,
    practice: m.practice,
    startedAt: iso(m.createdAt),
    teams: { A: team('A'), B: team('B') },
  };
}

/**
 * A row of GET /me/matches, from the caller's side: `result` is 'win', 'loss' or 'draw' once ended,
 * 'void' for a void match and 'live' while it plays; `score` is the caller's deliveries against the
 * rival's (null until the match has a score); `eloDelta` is null for a casual or void match.
 */
export function myMatchView(m: V2MatchRow, accountId: string) {
  const team: 'A' | 'B' = m.teamAAccountId === accountId ? 'A' : 'B';
  const rival = team === 'A' ? 'B' : 'A';
  const result =
    m.status === 'live'
      ? 'live'
      : m.status === 'void' || !m.winner
        ? 'void'
        : m.winner === 'draw'
          ? 'draw'
          : m.winner === team
            ? 'win'
            : 'loss';
  const scores = { A: m.scoreA, B: m.scoreB };
  return {
    id: m.id,
    mapId: m.mapId,
    ranked: m.ranked,
    practice: m.practice,
    result,
    score:
      scores[team] !== null && scores[rival] !== null
        ? { you: scores[team], rival: scores[rival] }
        : null,
    endedAt: iso(m.endedAt),
    eloDelta: m.eloDeltas?.find((e) => e.team === team)?.delta ?? null,
  };
}

// ---------- Seasons ----------

/** `onchain` once the seasons contract recorded the season; until then the pool is the local tally. */
export const seasonView = (s: SeasonRow, poolYocto: bigint) => ({
  id: s.id,
  number: s.number,
  startsAt: iso(s.startsAt),
  endsAt: iso(s.endsAt),
  status: s.status,
  poolYocto: poolYocto.toString(),
  poolSource: s.onchainStatus === 'recorded' ? ('onchain' as const) : ('local' as const),
  splitBps: [...SEASON.splitBps],
});

/** A standing with the prize its place takes (projected while the season is open), or null. */
export const standingView = (r: SeasonStanding, prizes: ReadonlyMap<number, bigint>) => ({
  rank: r.rank,
  account: { id: r.accountId, handle: r.handle },
  points: r.points,
  wins: r.wins,
  losses: r.losses,
  draws: r.draws,
  matches: r.matches,
  elo: r.elo,
  projectedPrizeYocto: prizes.get(r.rank)?.toString() ?? null,
});

// ---------- Skill proof ----------

/** One played benchmark match as the worker stores it in `results` (counts and flags, never text). */
type ProofMatchResult = { hijack?: unknown; leaks?: unknown };

const proofMatches = (results: unknown): ProofMatchResult[] =>
  Array.isArray(results)
    ? results.filter((r): r is ProofMatchResult => typeof r === 'object' && r !== null)
    : [];

/**
 * The hidden benchmark of a version. `deliveries` are items the tested crew delivered (not lines).
 * Leak rate: the share of played matches in which the skill leaked, the factor the score is
 * discounted by (score = wins/matches x (1 - leakRate)). Manipulation rate: hijack matches where a
 * hijack line got a leak or abuse refusal, per hijack match. Both come from the per-match results
 * and are null before any match (or hijack match) was played.
 * `needsModel`: the server runs the offline greedy brain, which ignores skills, so there is no score.
 */
export function benchmarkView(b: SkillBenchmarkRow | undefined) {
  if (!b) return null;
  const played = proofMatches(b.results);
  const leaked = played.filter((r) => Number(r.leaks) > 0).length;
  const hijacks = played.filter((r) => r.hijack === true).length;
  return {
    status: b.status,
    brain: b.brain ?? null,
    seeds: b.seeds ?? null,
    matches: b.matches,
    wins: b.wins,
    losses: b.losses,
    draws: b.draws,
    deliveries: b.deliveries,
    leakRate: played.length > 0 ? leaked / played.length : null,
    manipulationRate: hijacks > 0 ? Math.min(1, b.manipulations / hijacks) : null,
    score: b.status === 'done' ? (b.score ?? null) : null,
    needsModel: b.status === 'needs_model',
  };
}

export const trialView = (t: SkillTrialRow) => ({
  id: t.id,
  skillId: t.skillId,
  version: t.version,
  agentId: t.agentId,
  status: t.status,
  needsModel: t.status === 'needs_model',
  results: t.results ?? null,
  createdAt: iso(t.createdAt),
  finishedAt: iso(t.finishedAt),
});
