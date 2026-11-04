// REST response and request shapes of apps/api, as the server actually sends them.
// Sources of truth: apps/api/src/views.ts, apps/api/src/controllers/*.ts, apps/api/src/validation.ts
// and packages/db/src/repos/*.ts (row views). docs/backend-contract.md is the summary; where they
// differ, these types follow the code. Keep them in sync when the api changes.
//
// Game types (SkillPublic, Tag, …) come from @skirm/shared (type-only imports,
// browser-safe).
import type { ActionKind, AgentAppearance, CosmeticItem, PlayerTier, RankedTierName, SkillPublic, SkillRole, SkillTrigger, Tag, Unlock } from '@skirm/shared';

import type { Difficulty, V2Debrief, V2Frame } from '../realtime/protocol';

export type { AgentAppearance, CosmeticItem, SkillPublic, SkillRole, SkillTrigger, Tag, Unlock };

/** Skill version reference used everywhere a crew or agent names a skill. */
export interface SkillRef {
  id: string;
  version: number;
}

export type GatedAction = Extract<ActionKind, 'place_block' | 'dig' | 'extinguish'>;

// ---------- Account ----------

export interface Account {
  id: string;
  handle: string;
  nearAccountId: string | null;
  /** ISO time the account was created ("Joined", S16). Optional so test fixtures can leave it out. */
  createdAt?: string;
}

export interface SessionResponse {
  account: Account;
  /** True on the first sign-in (account just created with the starter defaults). */
  created: boolean;
}

export interface NearProof {
  publicKey: string;
  signature: string;
  nonce?: string;
  recipient?: string;
  callbackUrl?: string;
}

export interface SessionRequest {
  /** Privy JWT (privy mode). */
  token?: string;
  /** Links a NEAR account (M01). Dev mode trusts it; otherwise `nearProof` is required. */
  nearAccountId?: string;
  nearProof?: NearProof;
}

/** packages/db CreditsView. */
export interface Credits {
  /** Paid balance. */
  balance: number;
  /** Held by open matches. */
  held: number;
  /** Free allowance left today. */
  allowanceLeft: number;
  /** Next 00:00 UTC (ISO). */
  allowanceResetAt: string;
  /** What a hold can draw on now: balance + min(allowanceLeft, global free budget left). */
  available: number;
}

/** packages/db AgentView. */
export interface Agent {
  id: string;
  name: string;
  elo: number;
  matchesPlayed: number;
  wins: number;
  losses: number;
  draws: number;
  skills: (SkillRef & { name: string })[];
  unlocks: Unlock[];
  /** How the agent looks in the arena (cosmetic). */
  appearance: AgentAppearance;
  /** v2: role, sight and voice range (1–5) and default talk tier. */
  role: 'Builder' | 'Digger' | 'Firefighter' | 'Scout' | 'Runner' | 'Hauler';
  vision: number;
  comms: number;
  tier: 'quiet' | 'standard' | 'open';
  /** v2: the owner's instructions put ahead of the agent's skills (≤ 600 characters). Owner only. */
  systemPrompt?: string | null;
}

export interface UnlockItem {
  id: string;
  kind: Unlock;
  attachedAgentId: string | null;
}

export interface Me {
  account: Account;
  /** v2: the player's own Elo and ranked record. */
  rank: {
    elo: number;
    rankedMatches: number;
    wins: number;
    losses: number;
    draws: number;
    /** Rank title for the Elo (`rankTitle` in @skirm/shared), e.g. "Breach Runner II". */
    title: string;
    /** Place on the player ladder (1 = top); null before the first ranked match. */
    position: number | null;
    // The api always sends the two below; optional so test fixtures can leave them out.
    /** Ranked tier (`playerTier` in @skirm/shared); `tier.tier` is null during placement. */
    tier?: PlayerTier;
    /** When inactivity next costs Elo (Diamond and up), ISO 8601; null when decay does not apply. */
    decayAt?: string | null;
  };
  credits: Credits;
  agents: Agent[];
  unlocks: UnlockItem[];
  // The api always sends the fields below; optional so test fixtures can leave them out.
  /** Credits one NEAR buys (server CREDITS_PER_NEAR; DEFAULT_CREDITS_PER_NEAR before it loads). */
  creditsPerNear?: number;
  /** Creator royalties earned over all written skills (resales only), yoctoNEAR string. */
  royaltiesYocto?: string;
  /** Premium cosmetic item ids the account owns (@skirm/shared COSMETICS). */
  cosmetics?: string[];
}

/** DELETE /me/near. */
export interface UnlinkNearResponse {
  account: Account;
}

export interface AgentPatch {
  name?: string;
  appearance?: AgentAppearance;
  /** ≤ 3, owned versions. */
  skills?: SkillRef[];
  unlocks?: Unlock[];
  /** v2 role, sight and voice range (1–5) and default talk tier. */
  role?: Agent['role'];
  vision?: number;
  comms?: number;
  tier?: 'quiet' | 'standard' | 'open';
  /** The owner's instructions (≤ 600 characters); null or '' clears them. */
  systemPrompt?: string | null;
}

/** GET /me/earn-back: what the player got back over all time. */
export interface EarnBack {
  /** Creator royalties on resales of the player's skills, yoctoNEAR string. */
  royaltiesYocto: string;
  /** Skill sales as the seller, after the platform fee and royalty, yoctoNEAR string. */
  salesNetYocto: string;
  /** Credits charged for v2 matches (ledger charges). */
  spentCredits: number;
  /** Credits one NEAR buys, to show the spend in NEAR. */
  creditsPerNear: number;
  /** Season prizes won over all seasons (local until the seasons contract pays), yoctoNEAR string. */
  prizesYocto: string | null;
  /** Agent rentals earned after the platform fee (null from an older api). */
  rentalsYocto: string | null;
}

// ---------- Credits ----------

/** `local`: NEAR is off (local mode); the record was kept offchain and never goes onchain. */
export type RegistryStatus = 'none' | 'pending' | 'recorded' | 'failed' | 'local';

/** `spend`: paid credits spent outside any match (a premium cosmetic). */
export type LedgerRowType = 'topup' | 'hold' | 'charge' | 'refund' | 'free' | 'spend';

export interface LedgerRow {
  id: string;
  type: LedgerRowType;
  amount: number;
  source: 'paid' | 'free';
  note: 'entry_fee' | 'reversal' | 'expired' | 'cosmetic' | 'prize_pool' | 'prize' | null;
  /** The v2 match a hold, charge or refund belongs to; null for top-ups, free grants and spends. */
  matchId: string | null;
  txHash: string | null;
  createdAt: string | null;
}

export interface CreditsWithRows extends Credits {
  rows: LedgerRow[];
  /** Credits one NEAR buys (always sent; optional so test fixtures can leave it out). */
  creditsPerNear?: number;
}

export interface DepositResponse {
  credited: number;
  balance: number;
  amountYocto: string;
}

// ---------- Skills ----------

/** `Starter`: account-bound starter skill (Flood Warden), never minted. */
export type SkillStatus = 'Draft' | 'Minted' | 'Listed' | 'Starter';

/** views.ts SkillPublicView. */
export interface SkillView extends SkillPublic {
  /** Agent roles that may equip this version: `['any']` or role names (missing = any). */
  roles?: SkillRole[];
  status: SkillStatus;
  tokenId: string | null;
  latestVersion: number;
  accountBound: boolean;
  creatorAccount: Account;
}

/** GET /skills rows and GET /skills/:id. */
export interface SkillRow extends SkillView {
  requiredUnlocks: Unlock[];
  /** `GET /skills?tab=written` only: creator royalties earned on this skill, yoctoNEAR string. */
  royaltiesYocto?: string;
}

/** GET /skills/:id for the creator: the S08 read-back. Nobody else ever gets these fields. */
export interface SkillWithText extends SkillRow {
  prompt: string;
  reflexes: string | null;
}

export interface SkillBody {
  name: string;
  summary?: string | null;
  /** ≤ 1,200 characters. */
  prompt: string;
  /** ≤ 400 characters. */
  reflexes?: string | null;
  requires_actions: GatedAction[];
  handles_tags: Tag[];
  /** `['any']` (default) or the agent roles that may equip it. */
  roles?: SkillRole[];
  /** 0–1,000 (default 500). */
  royalty_bps?: number;
  /** When the skill joins its agent's prompt; null or absent: always. Public, unlike the prompt. */
  trigger?: SkillTrigger | null;
}

export interface MintResponse {
  tokenId: string | null;
  status: 'minted' | 'pending';
  txHash?: string;
  /** The hidden benchmark queued at mint. */
  benchmark: { status: ProofJobStatus };
}

// ---------- Market ----------

export interface Listing {
  id: string;
  skillId: string;
  version: number;
  tokenId: string | null;
  sellerId: string;
  priceYocto: string;
  txHash: string | null;
  status: 'active' | 'sold' | 'cancelled';
  createdAt: string | null;
  /** Formulas §6 split (M02). No royalty on a primary sale. */
  split?: { primary: boolean; feeYocto: string; royaltyYocto: string; sellerYocto: string };
}

export interface Sale {
  id: string;
  skillId: string;
  version: number;
  tokenId: string | null;
  sellerId: string;
  buyerId: string;
  priceYocto: string;
  txHash: string;
  createdAt: string | null;
}

export interface MarketCard {
  skill: SkillView;
  creator: Account;
  priceYocto: string | null;
  listing?: Listing;
  owned: boolean;
  /** Ranked v2 win rate of this version (0–1); null before its first ranked match. */
  rankedWinRate: number | null;
  rankedMatches: number;
  /** Benchmark score (0–1); null when not benchmarked, offline (needs a model key) or not finished. */
  benchmarkScore: number | null;
}

/** `winrate`: ranked win rate; `benchmark`: benchmark score. Null values sort last. */
export type MarketSort = 'winrate' | 'benchmark' | 'price' | 'new';

export interface MarketQuery {
  tag?: Tag;
  sort?: MarketSort;
}

/** The skill version a listing sells, pinned by its prompt hash (what a buyer gets is exactly this). */
export interface SkillVersionPin {
  version: number;
  /** sha256 of the encrypted prompt's plaintext, hex. */
  promptSha256: string;
  tokenId: string | null;
  mintedAt: string | null;
}

export interface MarketDetail {
  skill: SkillView;
  sales: Sale[];
  listing?: Listing;
  owned: boolean;
  /** The version shown, pinned by hash. */
  pinned: SkillVersionPin;
  /** The hidden benchmark of this version; null before it is queued (a draft). */
  benchmark: MarketBenchmark | null;
  /** Ranked v2 matches with this version, overall and per map. */
  ranked: { matches: number; wins: number; perMap: (RecordTally & { mapId: string })[] };
  /** How this version did against the opponent skills it met most (top 10). */
  counters: { vs: CounterRecord[] };
  /** The caller's trials of this version (3 per buyer per version; offline trials do not count). */
  trials: { used: number; left: number };
}

/** Benchmark and trial job state. `needs_model`: the server runs the offline bot brain, nothing played. */
export type ProofJobStatus = 'queued' | 'running' | 'done' | 'needs_model' | 'failed';

export interface RecordTally {
  matches: number;
  wins: number;
  losses: number;
  draws: number;
}

/** An opponent skill version and how this version fared against crews carrying it. */
export interface CounterRecord extends RecordTally {
  skillId: string;
  version: number;
  /** The opponent skill's name, when the server sends it. */
  name?: string;
}

/** GET /market/:id `benchmark`: the platform's hidden gauntlet, run at mint. */
export interface MarketBenchmark {
  status: ProofJobStatus;
  brain: string | null;
  seeds: unknown;
  /** Gauntlet matches played (6 once done with a model brain, 0 offline). */
  matches: number;
  wins: number;
  losses: number;
  draws: number;
  deliveries: number;
  /** Share of gauntlet matches where the skill text leaked (0–1); null before any match was played. */
  leakRate: number | null;
  /** Share of hijack matches where an injected line got a leak or abuse through (0–1); null before any hijack match. */
  manipulationRate: number | null;
  /** 0–1; null unless done with a model brain. */
  score: number | null;
  needsModel: boolean;
}

/** One trial match: the buyer's agent with the skill (crew A) against the bot crew. */
export interface TrialResult {
  mapId: string;
  difficulty?: Difficulty | null;
  /** The buyer's side's outcome, when the server sends it. */
  outcome?: 'win' | 'loss' | 'draw';
  /** Otherwise the winner, the buyer being crew A. */
  winner?: Side | 'draw' | null;
  score?: Record<Side, number> | null;
  ticks?: number | null;
}

/** GET /market/:skillId/trials row. */
export interface Trial {
  id: string;
  skillId: string;
  version: number;
  agentId: string;
  status: ProofJobStatus;
  /** Once done: one entry per match (3). */
  results: TrialResult[] | null;
  createdAt: string | null;
  finishedAt: string | null;
}

export interface TrialRequest {
  agentId: string;
  version?: number;
}

/** POST /market/:skillId/trial (202). */
export interface StartTrialResponse {
  trialId: string;
  status: ProofJobStatus;
}

export interface ListingRequest {
  priceYocto: string;
  txHash?: string;
  version?: number;
}

export interface PurchaseResponse {
  owned: true;
  sale: Sale;
}

// ---------- Leaderboards and matches ----------

export type Side = 'A' | 'B';

// ---------- v2 ladder and matches ----------

/** GET /leaderboards/players row: per-player Elo on the v2 ladder. */
export interface PlayerLadderRow {
  /** 1 = top. */
  rank: number;
  account: { id: string; handle: string };
  elo: number;
  /** `rankTitle(elo).title` from @skirm/shared. */
  title: string;
  rankedMatches: number;
  wins: number;
  losses: number;
  draws: number;
  /** Ranked tier (`playerTier` in @skirm/shared); optional so fixtures can leave it out. */
  tier?: PlayerTier;
}

export interface PlayerLadder {
  rows: PlayerLadderRow[];
  /** The caller's row when signed in and ranked (it may be outside `rows`). */
  you?: PlayerLadderRow;
}

/** GET /leaderboards/maps/:mapId row: a player's ranked record on one map. */
export interface MapLadderRow {
  rank: number;
  account: { id: string; handle: string };
  /** Overall Elo and ranked matches (the tier comes from these). */
  elo: number;
  rankedMatches: number;
  matches: number;
  wins: number;
  losses: number;
  draws: number;
  /** wins / matches on this map, 0–1. */
  winRate: number;
  tier: PlayerTier;
}

export interface MapLadder {
  mapId: string;
  rows: MapLadderRow[];
}

/** GET /leaderboards/skills row: a skill's ranked record over all its versions. */
export interface SkillLadderRow {
  rank: number;
  skill: { id: string; name: string };
  creator: { id: string; handle: string };
  matches: number;
  wins: number;
  losses: number;
  draws: number;
  /** wins / matches, 0–1. */
  winRate: number;
}

export interface SkillLadder {
  /** Ranked matches a skill needs to be listed (DEFAULTS.ranked.skillMinMatches). */
  minMatches: number;
  mapId?: string;
  rows: SkillLadderRow[];
}

/** GET /leaderboards/tiers. */
export interface RankedTiers {
  tiers: { name: RankedTierName; min: number; nextAt: number | null }[];
  placementMatches: number;
  kPlacement: number;
  decay: { fromTier: RankedTierName; days: number; amount: number };
  skillMinMatches: number;
}

/** packages/db V2CrewRecord: an agent as it played. */
export interface V2CrewMember {
  id: string;
  name: string;
  role: string;
  vision: number;
  comms: number;
  tier: string;
}

/** packages/db V2CrewStatsRecord, per crew. */
export interface V2CrewStats {
  timeouts: number;
  errors: number;
  illegal: number;
  refusedSays: number;
  costUsd: number;
  charged: number;
}

export interface V2EloChange {
  accountId: string;
  team: Side;
  before: number;
  delta: number;
  after: number;
}

/** GET /v2/matches/:id (v2_matches row). Public; `you` and `debrief` only for a player of the match. */
export interface V2MatchRecord {
  id: string;
  mapId: string;
  ranked: boolean;
  status: 'live' | 'ended' | 'void';
  /** Casual difficulty; null for ranked (Normal). */
  difficulty: Difficulty | null;
  /** While the match is live, a side other than your own is hidden (accountId and handle null, crew empty). */
  teams: Record<Side, { accountId: string | null; handle: string | null; crew: V2CrewMember[] }>;
  /** null while live and for a void match. */
  winner: Side | 'draw' | null;
  /** goal | time | eliminated, or why it is void (declined, accept_timeout, credits, error, aborted). */
  reason: string | null;
  decidedBy: string | null;
  score: Record<Side, number> | null;
  ticks: number | null;
  elo: V2EloChange[];
  stats: Record<Side, V2CrewStats> | null;
  logHash: string | null;
  registry: { status: RegistryStatus; txHash?: string };
  createdAt: string | null;
  endedAt: string | null;
  /** The caller's crew, when the caller played. */
  you?: Side;
  /** The caller's debrief, when stored. */
  debrief?: V2Debrief | null;
}

/** GET /rentals row: another player's agent offered for one match at a time. */
export interface RentalOffer {
  offerId: string;
  agentId: string;
  name: string;
  role: string;
  vision: number;
  comms: number;
  tier: string;
  ownerId: string;
  ownerHandle: string;
  /** Where `market.rent` pays the owner; null while the owner has no NEAR account linked. */
  ownerNearAccountId: string | null;
  priceYocto: string;
}

/** The caller's own offer for one agent (PUT /agents/:id/rental, GET /rentals/mine). */
export interface MyRentalOffer {
  offerId: string;
  agentId: string;
  priceYocto: string;
  active: boolean;
}

/** A one-match pass for another player's agent; `matchId` is set once used. */
export interface RentalPass {
  rentalId: string;
  offerId: string;
  agentId: string;
  /** The rented agent, for the crew picker. */
  agent: { name: string; role: string; vision: number; comms: number; tier: string; ownerHandle: string } | null;
  priceYocto: string;
  matchId: string | null;
  createdAt: string;
}

/** One agent's results over its v2 matches (practice against the bot left out). */
export interface AgentRecordCounts {
  matches: number;
  wins: number;
  losses: number;
  draws: number;
  /** Items the agent delivered. */
  delivered: number;
  bluffsTold: number;
  /** Bluffs the rival believed. */
  bluffsLanded: number;
  /** Rival bluffs it heard and did not believe. */
  seenThrough: number;
}

/** GET /agents/:id/record: this season's record while a season is open, and all time. */
export interface AgentRecord {
  allTime: AgentRecordCounts;
  season: (AgentRecordCounts & { number: number; endsAt: string }) | null;
}

/** GET /me/matches row: one of the caller's v2 matches, newest first. */
export interface MyMatch {
  id: string;
  mapId: string;
  ranked: boolean;
  /** Against the bot crew (no Elo). */
  practice: boolean;
  /** The caller's outcome once ended; 'void' when called off, 'live' while it plays (api myMatchView). */
  result: 'win' | 'loss' | 'draw' | 'void' | 'live';
  /** Goal items delivered, the caller's crew first; null while live and for a void match. */
  score: { you: number; rival: number } | null;
  endedAt: string | null;
  /** The caller's Elo change (ranked only); null otherwise. */
  eloDelta: number | null;
}

/** GET /v2/matches/live row. Crews' agents stay hidden; the bot side is named BOT_HANDLE ('Greedy bot'). */
export interface V2LiveMatch {
  id: string;
  mapId: string;
  difficulty: Difficulty | null;
  ranked: boolean;
  /** A practice match against the bot crew. */
  practice: boolean;
  startedAt: string | null;
  teams: Record<Side, { handle: string | null; size: number }>;
}

// ---------- Seasons ----------

export type SeasonStatus = 'open' | 'locked' | 'paid';

/** A 14-day season of ranked v2 play. */
export interface Season {
  id: string;
  number: number;
  startsAt: string;
  endsAt: string;
  status: SeasonStatus;
  /** Funding plus 30% of market fees in the window, yoctoNEAR string. */
  poolYocto: string;
  /** `local`: kept offchain until the seasons contract is deployed. */
  poolSource: 'local' | 'onchain';
  /** Prize per place in basis points, best first (30/20/15, then 5 each to 10th). */
  splitBps: number[];
}

/** A player's place in a season: points from ranked v2 matches (win 25, draw 12, loss 5). */
export interface Standing {
  rank: number;
  account: { id: string; handle: string };
  points: number;
  wins: number;
  losses: number;
  draws: number;
  matches: number;
  elo: number;
  /** The place's share of the pool now; null outside the paid places. */
  projectedPrizeYocto: string | null;
}

/** GET /seasons/current. */
export interface CurrentSeason {
  season: Season;
  top: Standing[];
  /** The caller's row when signed in and placed (it may be outside `top`). */
  you?: Standing;
}

/** GET /seasons/:id/standings. */
export interface SeasonStandings {
  rows: Standing[];
  total: number;
}

// ---------- Cosmetics ----------

/** GET /cosmetics: the premium catalog and what the caller owns. */
export interface Cosmetics {
  items: CosmeticItem[];
  owned: string[];
}

// ---------- Replays ----------

/** A highlight moment of an ended match (engine detectHighlights) with its caster line. */
export interface ReplayHighlight {
  id: string;
  kind: 'goal' | 'switch_flood' | 'drop_fight' | 'lead_change';
  tick: number;
  /** The suggested clip around it. */
  start: number;
  end: number;
  team: Side | null;
  title: string;
  facts: string;
  weight: number;
  score: Record<Side, number>;
  /** The caster's line: the model's when a key is set, else the template's. */
  line: string;
}

/** GET /v2/matches/:id/highlights. */
export interface V2Highlights {
  matchId: string;
  highlights: ReplayHighlight[];
  caster: 'model' | 'template' | null;
  /** Whether the frames are still stored, so the replay can be played. */
  framesKept: boolean;
}

/** A public replay link (POST/GET /v2/matches/:id/shares). */
export interface ReplayShare {
  id: string;
  matchId: string;
  clip: { start: number; end: number } | null;
  createdAt: string;
  /** Site path of the link, e.g. /replays/rps_… */
  path: string;
}

/** GET /replays/:shareId: what anyone with the link sees (the whole board, never a crew's minds). */
export interface SharedReplay {
  share: ReplayShare & { by: string | null };
  match: V2MatchRecord;
  highlights: ReplayHighlight[];
  caster: 'model' | 'template' | null;
  framesKept: boolean;
  /** The clip's whole-board frames; null once they are no longer kept; absent with ?frames=0. */
  frames?: V2Frame[] | null;
}

// ---------- Onboarding ----------

export type TutorialStatus = 'new' | 'in_progress' | 'done' | 'skipped';

/** GET /onboarding: the guided match's progress and the home checklist. */
export interface Onboarding {
  tutorial: {
    status: TutorialStatus;
    /** Tips seen so far (only grows). */
    step: number;
    /** TUTORIAL_STEPS.length. */
    steps: number;
    match: { mapId: string; difficulty: Difficulty; crewSize: number };
    completedAt: string | null;
    skippedAt: string | null;
  };
  checklist: { items: { id: FirstStepId; done: boolean }[]; done: boolean; dismissed: boolean };
  showChecklist: boolean;
}

export type FirstStepId = 'tutorial' | 'practice' | 'skill' | 'equip' | 'pvp';

/** PUT /onboarding/tutorial. */
export interface TutorialUpdate {
  step?: number;
  status?: 'done' | 'skipped' | 'restart';
}

/** GET /onboarding/templates: a starter strategy, full text shown (they are examples). */
export interface SkillTemplateView {
  id: string;
  name: string;
  summary: string;
  bestFor: string;
  lesson: string;
  prompt: string;
  reflexes: string;
  requires_actions: ('place_block' | 'dig' | 'extinguish')[];
  handles_tags: Tag[];
}

/** GET /external-agents: a player's own program bound to one of their agents (bring your own agent). */
export interface ExternalAgent {
  id: string;
  name: string;
  agentId: string | null;
  mode: 'webhook' | 'pull';
  webhookUrl: string | null;
  calls: number;
  misses: number;
  lastError: string | null;
  lastSeenAt: string | null;
  rotatedAt: string | null;
  createdAt: string;
}

/** POST /external-agents and /external-agents/:id/rotate: the secret and token, shown this once. */
export interface ExternalAgentSecret {
  externalAgent: ExternalAgent;
  secret: string;
  token: string;
}

export interface ExternalAgentBody {
  name?: string;
  agentId?: string | null;
  webhookUrl?: string | null;
}

/** POST /external-agents/:id/ping. */
export type ExternalAgentPing =
  | { ok: true; mode: 'webhook'; status: number; latencyMs: number }
  | { ok: false; mode: 'webhook'; error: string; message: string }
  | { ok: boolean; mode: 'pull'; lastSeenAt: string | null };

// ---------- Quests and achievements ----------

/** One quest of the current day or week (GET /quests). */
export interface QuestView {
  id: string;
  period: 'daily' | 'weekly';
  title: string;
  target: number;
  progress: number;
  done: boolean;
  claimed: boolean;
  claimable: boolean;
  /** Free credits the claim refills, at most. */
  rewardCredits: number;
  /** What the claim refilled, once claimed. */
  credited: number | null;
}

export interface PlayStreak {
  current: number;
  best: number;
  playedToday: boolean;
}

/** GET /quests. */
export interface QuestBoard {
  daily: { key: string; endsAt: string; quests: QuestView[] };
  weekly: { key: string; endsAt: string; quests: QuestView[] };
  streak: PlayStreak;
  allowanceLeft: number;
}

/** POST /quests/:id/claim. */
export interface QuestClaimResponse {
  quest: QuestView;
  credited: number;
  allowanceLeft: number;
}

export interface AchievementBadge {
  status: 'pending' | 'minted' | 'local' | 'failed';
  tokenId: string | null;
  txHash: string | null;
  owner: string | null;
  mintedAt: string | null;
}

export interface AchievementView {
  id: string;
  title: string;
  detail: string;
  target: number;
  progress: number;
  unlocked: boolean;
  unlockedAt: string | null;
  cosmetic: { id: string; name: string } | null;
  badge: AchievementBadge | null;
}

/** GET /achievements. */
export interface Achievements {
  streak: PlayStreak;
  achievements: AchievementView[];
}

// ---------- Skill test bench ----------

/** GET /bench: what a run costs on this server and how many the caller has left this hour. */
export interface BenchInfo {
  brain: 'greedy' | 'model';
  /** True on the offline greedy brain: runs cost nothing (and the prompt does not change play). */
  free: boolean;
  /** Credits one run holds with a model brain (0 when free). */
  costCredits: number;
  limit: { perHour: number; used: number; left: number };
}

export type BenchRunStatus = 'queued' | 'running' | 'done' | 'failed' | 'insufficient_credits';

/** One key moment of a bench run (no speech text). */
export interface BenchEvent {
  tick: number;
  side: 'you' | 'bot' | 'map';
  kind: string;
  text: string;
}

/** The engine's debrief of the tested crew (`crewReport`). */
export interface BenchDebrief {
  mvp: string | null;
  goals: { title: string; met: boolean; available: boolean; progress: string | null }[];
  talk: { sent: number; overheard: number };
  verbs: number;
  switches: { mine: number; rival: number };
  steals: number;
  agents: { agentId: string; name: string; delivered: number; used: number; picks: number }[];
}

export interface BenchRunResult {
  /** `<mapId>:<difficulty>`. */
  seed: string;
  mapId: string;
  difficulty: Difficulty;
  role: string;
  outcome: 'win' | 'loss' | 'draw';
  reason: string;
  decidedBy: string;
  score: { you: number; bot: number };
  ticks: number;
  logHash: string;
  talk: { says: number; leaks: number; abuse: number; empty: number };
  calls: number;
  events: BenchEvent[];
  eventsDropped: number;
  debrief: BenchDebrief;
}

/** GET /bench/runs rows. */
export interface BenchRun {
  id: string;
  skillId: string;
  version: number;
  skillName: string | null;
  mapId: string;
  difficulty: Difficulty;
  seed: string;
  status: BenchRunStatus;
  brain: string | null;
  credits: number;
  /** The run played an edited draft, not the version's own prompt. */
  edited: boolean;
  promptSha256: string | null;
  result: BenchRunResult | null;
  shortfall: { need: number; have: number } | null;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
}

/** GET /bench/runs/:id: the prompt that played, when it is the caller's own text. */
export interface BenchRunDetail extends BenchRun {
  prompt: string | null;
  reflexes: string | null;
  promptHidden: boolean;
}

export interface BenchRunRequest {
  skillId: string;
  version?: number;
  mapId: string;
  difficulty: Difficulty;
  /** An edited draft to play instead of the version's prompt (your own skills only). */
  prompt?: string;
  reflexes?: string | null;
}

export interface DiffPart {
  op: 'same' | 'del' | 'add';
  text: string;
}

/** GET /bench/compare?a=&b=: two runs and a word diff of their prompts (a → b). */
export interface BenchCompare {
  a: BenchRun;
  b: BenchRun;
  prompt: { hidden: true; same: null; diff: null } | { hidden: false; same: boolean; diff: DiffPart[] };
}

// ---------- Daily challenge ----------

export type DailyTwist = 'none' | 'short_clock' | 'sly_bot' | 'eager_bot';

/** One UTC day's challenge (@skirm/engine dailyChallenge), with names for display. */
export interface DailyChallenge {
  date: string;
  seed: string;
  mapId: string;
  mapName: string;
  difficulty: Difficulty;
  twist: DailyTwist;
  twistName: string;
  twistLine: string;
  /** The bot's crew size; yours may be 1 up to this. */
  crewSize: 1 | 2 | 3;
  ticks: number;
  bot: { tier: string; hold: number; lieCap: number };
}

/** An agent of an attempt's crew as it was queued (skill names only). */
export interface DailyCrewAgent {
  name: string;
  role: string;
  skills: string[];
}

export type DailyAttemptStatus = 'queued' | 'running' | 'done' | 'failed' | 'insufficient_credits';
export type DailyOutcome = 'win' | 'loss' | 'draw';

export interface DailyAttemptResult {
  seed: string;
  mapId: string;
  difficulty: Difficulty;
  twist: DailyTwist;
  outcome: DailyOutcome;
  reason: string;
  decidedBy: string;
  score: { you: number; bot: number };
  ticks: number;
  clock: number;
  points: number;
  logHash: string;
  calls: number;
}

export interface DailyAttempt {
  id: string;
  date: string;
  status: DailyAttemptStatus;
  brain: string | null;
  credits: number;
  crew: DailyCrewAgent[];
  points: number | null;
  outcome: DailyOutcome | null;
  ticks: number | null;
  logHash: string | null;
  result: DailyAttemptResult | null;
  shortfall: { need: number; have: number } | null;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
}

/** GET /daily: today's challenge, its cost, the caller's attempts and the time left. */
export interface DailyToday {
  challenge: DailyChallenge;
  brain: 'greedy' | 'model';
  free: boolean;
  costCredits: number;
  attempts: { perDay: number; used: number; left: number };
  msLeft: number;
  endsAt: string;
  mine: DailyAttempt[];
}

export interface DailyBoardRow {
  rank: number;
  attemptId: string;
  handle: string;
  you: boolean;
  points: number;
  outcome: DailyOutcome;
  ticks: number;
  logHash: string;
  crew: DailyCrewAgent[];
  finishedAt: string;
}

/** GET /daily/leaderboard?date=: the day's top attempts and the caller's rank. */
export interface DailyBoard {
  date: string;
  challenge: DailyChallenge;
  players: number;
  top: DailyBoardRow[];
  me: DailyBoardRow | null;
}
