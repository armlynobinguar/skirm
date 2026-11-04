// Postgres schema for skirm (Drizzle). Source: docs/backend-contract.md, System Architecture
// (Money and ownership, Secrets) and Game Spec §6, §8, §9.
// Skill prompt text never lives here in plain form: only AES-256-GCM ciphertext and a wrapped key.
import { sql } from 'drizzle-orm';
import {
  bigserial,
  boolean,
  check,
  customType,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';

/** bytea column mapped to Uint8Array. */
export const bytea = customType<{ data: Uint8Array; driverData: Uint8Array | Buffer | string }>({
  dataType() {
    return 'bytea';
  },
  toDriver(value) {
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  },
  fromDriver(value) {
    if (typeof value === 'string') {
      // Text form `\x0a0b…` (some drivers return bytea as hex text).
      const hex = value.startsWith('\\x') ? value.slice(2) : value;
      return new Uint8Array(Buffer.from(hex, 'hex'));
    }
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice();
  },
});

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const createdAt = () => ts('created_at').notNull().defaultNow();

// ---------- Enums ----------

export const unlockKind = pgEnum('unlock_kind', ['builder', 'digger', 'firefighter']);
export const skillStatus = pgEnum('skill_status', ['draft', 'minted', 'listed']);
export const ledgerRowType = pgEnum('ledger_row_type', [
  'topup',
  'hold',
  'charge',
  'refund',
  'free',
  /** Paid credits spent outside any run (a cosmetic); never the allowance. */
  'spend',
]);
export const creditSource = pgEnum('credit_source', ['paid', 'free']);
export const ledgerNote = pgEnum('ledger_note', ['entry_fee', 'reversal', 'expired', 'cosmetic']);
export const holdStatus = pgEnum('hold_status', ['held', 'settled', 'aborted']);
/** `local`: recorded by the NoopRegistry only (NEAR is off in local mode); never onchain. */
export const registryStatus = pgEnum('registry_status', [
  'none',
  'pending',
  'recorded',
  'failed',
  'local',
]);
export const matchStatus = pgEnum('match_status', ['live', 'ended', 'void']);
export const listingStatus = pgEnum('listing_status', ['active', 'sold', 'cancelled']);
export const seasonStatus = pgEnum('season_status', ['open', 'locked', 'paid']);

// ---------- Accounts, agents, unlocks ----------

export const accounts = pgTable(
  'accounts',
  {
    id: text('id').primaryKey(),
    handle: text('handle').notNull(),
    privyDid: text('privy_did'),
    nearAccountId: text('near_account_id'),
    /** Platform-owned account (creator of the starter skill); never signs in. */
    system: boolean('system').notNull().default(false),
    /** v2: Elo is per player (ranked v2 matches only). */
    elo: integer('elo').notNull().default(1200),
    rankedMatches: integer('ranked_matches').notNull().default(0),
    wins: integer('wins').notNull().default(0),
    losses: integer('losses').notNull().default(0),
    draws: integer('draws').notNull().default(0),
    /** When the player's last ranked v2 result was written (the Elo decay's inactivity clock). */
    lastRankedAt: ts('last_ranked_at'),
    createdAt: createdAt(),
    /** Set when the player deleted the account: it never signs in again (AccountsRepo.deleteAccount). */
    deletedAt: ts('deleted_at'),
  },
  (t) => [
    index('accounts_elo_idx').on(t.elo),
    uniqueIndex('accounts_handle_uq').on(t.handle),
    uniqueIndex('accounts_privy_did_uq').on(t.privyDid),
    /** One player per NEAR account (0010 nulled the duplicates linked before it, keeping the oldest). */
    uniqueIndex('accounts_near_uq')
      .on(t.nearAccountId)
      .where(sql`${t.nearAccountId} is not null`),
  ],
);

export const agents = pgTable(
  'agents',
  {
    id: text('id').primaryKey(),
    ownerId: text('owner_id')
      .notNull()
      .references(() => accounts.id),
    name: text('name').notNull(),
    elo: integer('elo').notNull().default(1200),
    matchesPlayed: integer('matches_played').notNull().default(0),
    wins: integer('wins').notNull().default(0),
    losses: integer('losses').notNull().default(0),
    draws: integer('draws').notNull().default(0),
    /** v2: role (Builder, Digger, Firefighter, Scout, Runner, Hauler), sight and voice range (1–5), talk tier. */
    role: text('role').notNull().default('Runner'),
    vision: integer('vision').notNull().default(3),
    comms: integer('comms').notNull().default(3),
    tier: text('tier').notNull().default('standard'),
    /** v2: the owner's instructions, put ahead of the agent's skills in its system prompt (≤ 600 characters). */
    systemPrompt: text('system_prompt'),
    /** Cosmetic look on the 3D board (AgentAppearance); null until the owner changes it. */
    appearance: jsonb('appearance'),
    createdAt: createdAt(),
  },
  (t) => [
    index('agents_owner_idx').on(t.ownerId),
    index('agents_elo_idx').on(t.elo),
    check('agents_system_prompt_ck', sql`char_length(${t.systemPrompt}) <= 600`),
  ],
);

export const unlockItems = pgTable(
  'unlock_items',
  {
    id: text('id').primaryKey(),
    ownerId: text('owner_id')
      .notNull()
      .references(() => accounts.id),
    kind: unlockKind('kind').notNull(),
    attachedAgentId: text('attached_agent_id').references(() => agents.id),
    /** Where it came from: `starter`, or a game event id. */
    source: text('source').notNull().default('starter'),
    createdAt: createdAt(),
  },
  (t) => [
    index('unlock_items_owner_idx').on(t.ownerId),
    index('unlock_items_agent_idx').on(t.attachedAgentId),
  ],
);

// ---------- Skills ----------

export const skills = pgTable(
  'skills',
  {
    /** `skl_` + ULID. */
    id: text('id').primaryKey(),
    creatorId: text('creator_id')
      .notNull()
      .references(() => accounts.id),
    /** Name and summary of the latest version (each version keeps its own; Spec §9 immutability). */
    name: text('name').notNull(),
    summary: text('summary'),
    /** Starter skills: never minted, owned by every account that was granted it. */
    accountBound: boolean('account_bound').notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index('skills_creator_idx').on(t.creatorId)],
);

export const skillVersions = pgTable(
  'skill_versions',
  {
    skillId: text('skill_id')
      .notNull()
      .references(() => skills.id),
    version: integer('version').notNull(),
    /** Public name and summary as published with this version; never changed afterwards. */
    name: text('name').notNull(),
    summary: text('summary'),
    requiresActions: jsonb('requires_actions').$type<string[]>().notNull(),
    handlesTags: jsonb('handles_tags').$type<string[]>().notNull(),
    royaltyBps: integer('royalty_bps').notNull().default(500),
    promptSha256: text('prompt_sha256').notNull(),
    ciphertext: bytea('ciphertext').notNull(),
    iv: bytea('iv').notNull(),
    authTag: bytea('auth_tag').notNull(),
    wrappedKey: bytea('wrapped_key').notNull(),
    /** Which KEK wrapped the data key (`local:<fingerprint>` or a KMS key name). */
    keyId: text('key_id').notNull(),
    status: skillStatus('status').notNull().default('draft'),
    tokenId: text('token_id'),
    mintedAt: ts('minted_at'),
    /** Set while a mint request holds this draft (SkillsRepo.claimMint); a stale claim can be retaken. */
    mintClaimedAt: ts('mint_claimed_at'),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.skillId, t.version] }),
    uniqueIndex('skill_versions_token_uq').on(t.tokenId),
    check('skill_versions_royalty_ck', sql`${t.royaltyBps} between 0 and 1000`),
    check('skill_versions_version_ck', sql`${t.version} >= 1`),
  ],
);

/** Owner cache: NFT owner per token (from chain), or account-bound grants (no token). */
export const skillOwnership = pgTable(
  'skill_ownership',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    skillId: text('skill_id').notNull(),
    version: integer('version').notNull(),
    tokenId: text('token_id'),
    ownerId: text('owner_id').references(() => accounts.id),
    /** NEAR account that holds the token onchain (may not map to any account yet). */
    ownerNear: text('owner_near'),
    refreshedAt: ts('refreshed_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('skill_ownership_owner_uq').on(t.skillId, t.version, t.ownerId),
    index('skill_ownership_token_idx').on(t.tokenId),
    index('skill_ownership_owner_idx').on(t.ownerId),
  ],
);

export const agentSkills = pgTable(
  'agent_skills',
  {
    agentId: text('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    slot: integer('slot').notNull(),
    skillId: text('skill_id').notNull(),
    version: integer('version').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.agentId, t.slot] }),
    uniqueIndex('agent_skills_skill_uq').on(t.agentId, t.skillId),
    check('agent_skills_slot_ck', sql`${t.slot} between 0 and 2`),
  ],
);

export const listings = pgTable(
  'listings',
  {
    id: text('id').primaryKey(),
    skillId: text('skill_id').notNull(),
    version: integer('version').notNull(),
    tokenId: text('token_id'),
    sellerId: text('seller_id')
      .notNull()
      .references(() => accounts.id),
    priceYocto: numeric('price_yocto', { precision: 40, scale: 0 }).notNull(),
    txHash: text('tx_hash'),
    status: listingStatus('status').notNull().default('active'),
    createdAt: createdAt(),
    closedAt: ts('closed_at'),
  },
  (t) => [
    index('listings_skill_idx').on(t.skillId, t.version),
    uniqueIndex('listings_active_uq')
      .on(t.skillId, t.version, t.sellerId)
      .where(sql`${t.status} = 'active'`),
  ],
);

export const sales = pgTable(
  'sales',
  {
    id: text('id').primaryKey(),
    skillId: text('skill_id').notNull(),
    version: integer('version').notNull(),
    tokenId: text('token_id'),
    listingId: text('listing_id'),
    sellerId: text('seller_id').references(() => accounts.id),
    buyerId: text('buyer_id')
      .notNull()
      .references(() => accounts.id),
    priceYocto: numeric('price_yocto', { precision: 40, scale: 0 }).notNull(),
    txHash: text('tx_hash').notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('sales_tx_uq').on(t.txHash), index('sales_skill_idx').on(t.skillId)],
);

// ---------- Agent rentals ----------

/**
 * An owner's offer to rent out one agent, a match at a time, at `price_yocto` paid through
 * `market.rent` (the platform fee comes out of it). One offer per agent; removing it ends the offer
 * but keeps passes already bought.
 */
export const rentalOffers = pgTable(
  'rental_offers',
  {
    /** `rof_` + ULID. */
    id: text('id').primaryKey(),
    agentId: text('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    ownerId: text('owner_id')
      .notNull()
      .references(() => accounts.id),
    priceYocto: numeric('price_yocto', { precision: 40, scale: 0 }).notNull(),
    active: boolean('active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('rental_offers_agent_active_uq').on(t.agentId).where(sql`${t.active}`),
    index('rental_offers_owner_idx').on(t.ownerId),
    check('rental_offers_price_ck', sql`${t.priceYocto} > 0`),
  ],
);

/**
 * A paid rental: the renter may field the agent in one match. `match_id` is set when that match
 * starts (the pass is then used up). The amounts are the `rental` event's, from the chain.
 */
export const rentals = pgTable(
  'rentals',
  {
    /** `rnt_` + ULID. */
    id: text('id').primaryKey(),
    offerId: text('offer_id')
      .notNull()
      .references(() => rentalOffers.id),
    agentId: text('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    ownerId: text('owner_id')
      .notNull()
      .references(() => accounts.id),
    renterId: text('renter_id')
      .notNull()
      .references(() => accounts.id),
    priceYocto: numeric('price_yocto', { precision: 40, scale: 0 }).notNull(),
    feeYocto: numeric('fee_yocto', { precision: 40, scale: 0 }).notNull(),
    ownerProceedsYocto: numeric('owner_proceeds_yocto', { precision: 40, scale: 0 }).notNull(),
    txHash: text('tx_hash').notNull(),
    matchId: text('match_id'),
    createdAt: createdAt(),
    usedAt: ts('used_at'),
  },
  (t) => [
    uniqueIndex('rentals_tx_uq').on(t.txHash),
    index('rentals_renter_idx').on(t.renterId, t.agentId),
    index('rentals_owner_idx').on(t.ownerId),
    check('rentals_owner_renter_ck', sql`${t.ownerId} <> ${t.renterId}`),
  ],
);

// ---------- Credits ledger ----------

export const ledgerAccounts = pgTable('ledger_accounts', {
  accountId: text('account_id')
    .primaryKey()
    .references(() => accounts.id),
  /** Paid balance available to spend (credits held by runs excluded). */
  balance: integer('balance').notNull().default(0),
  /** Credits held by open runs (free + paid, entry fees excluded). */
  held: integer('held').notNull().default(0),
  /** Free allowance left on `allowance_day` (resets at 00:00 UTC). */
  allowanceLeft: integer('allowance_left').notNull().default(60),
  /** UTC day (YYYY-MM-DD) `allowance_left` belongs to. */
  allowanceDay: text('allowance_day').notNull().default(''),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const ledgerRows = pgTable(
  'ledger_rows',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id),
    type: ledgerRowType('type').notNull(),
    amount: integer('amount').notNull(),
    source: creditSource('source').notNull(),
    note: ledgerNote('note'),
    /** The run or match hold a row belongs to; for a `spend`, what was bought (`cosmetic:<item>`). */
    runId: text('run_id'),
    /** Deposit receipt (tx hash) of a top-up. */
    txHash: text('tx_hash'),
    createdAt: createdAt(),
  },
  (t) => [
    index('ledger_rows_account_idx').on(t.accountId, t.id),
    index('ledger_rows_run_idx').on(t.runId),
    uniqueIndex('ledger_rows_receipt_uq')
      .on(t.txHash)
      .where(sql`${t.type} = 'topup' and ${t.txHash} is not null`),
  ],
);

/** One hold per run (or paid match): the @skirm/ledger RunHold, persisted. */
export const runHolds = pgTable(
  'run_holds',
  {
    runId: text('run_id').primaryKey(),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id),
    status: holdStatus('status').notNull(),
    day: text('day').notNull(),
    agents: integer('agents').notNull(),
    stepLimit: integer('step_limit').notNull(),
    hold: integer('hold').notNull(),
    freeHeld: integer('free_held').notNull(),
    paidHeld: integer('paid_held').notNull(),
    entryFee: integer('entry_fee').notNull().default(0),
    chargesTurns: boolean('charges_turns').notNull().default(true),
    ticks: jsonb('ticks').$type<number[]>().notNull(),
    lost: jsonb('lost').$type<boolean[]>().notNull(),
    turnsCharged: integer('turns_charged').notNull().default(0),
    chargedFree: integer('charged_free').notNull().default(0),
    chargedPaid: integer('charged_paid').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [index('run_holds_account_idx').on(t.accountId, t.status)],
);

/** Global daily free budget G (Formulas §4), in credits, per UTC day. */
export const freeBudgetDays = pgTable('free_budget_days', {
  day: text('day').primaryKey(),
  used: integer('used').notNull().default(0),
});

// ---------- v2 matches ----------

/** An agent as it played a v2 match (role, attributes and the talk tier it locked in). */
export interface V2CrewRecord {
  id: string;
  name: string;
  role: string;
  vision: number;
  comms: number;
  tier: string;
  /** Skill versions the agent played with (filled by realtime). */
  skills?: { id: string; version: number }[];
}

export interface V2EloDeltaRecord {
  accountId: string;
  team: 'A' | 'B';
  before: number;
  delta: number;
  after: number;
}

/** Per crew: missed deadlines, provider errors, illegal answers, refused speech, model cost, credits charged. */
export interface V2CrewStatsRecord {
  timeouts: number;
  errors: number;
  illegal: number;
  refusedSays: number;
  costUsd: number;
  charged: number;
}

/** One agent's line in a v2 debrief (@skirm/server V2DebriefAgent). */
export interface V2DebriefAgentRecord {
  agentId: string;
  name: string;
  delivered: number;
  used: number;
  picks: number;
  bluffs?: { told: number; landed: number; seenThrough: number };
}

/**
 * What one crew was told at the end (@skirm/server V2Debrief). `eloDelta` and `registry` are filled
 * by `finish` and read back live, so a stored debrief never shows a stale registry state.
 */
export interface V2DebriefRecord {
  eloDelta: number | null;
  mvp: string | null;
  goals: { title: string; met: boolean; available?: boolean; progress?: string | null }[];
  talk: { sent: number; overheard: number };
  credits: { held: number; used: number; returned: number };
  registry: 'pending' | 'written' | null;
  agents: V2DebriefAgentRecord[];
  difficulty?: string;
  /** Ranked: the season this result counted towards and the standings points it gave (set by finish). */
  season?: { number: number; points: number };
  /** The crew's own live commands (V2Debrief.commands); absent when none were sent. */
  commands?: { tick: number; agents: { id: string; name: string }[]; preset: string | null; text: string | null }[];
}

/**
 * v2 matches: two crews on one shared map. The hash-chained log (actions and accepted messages per
 * tick) is the replay; `log_hash` is its final hash.
 */
export const v2Matches = pgTable(
  'v2_matches',
  {
    id: text('id').primaryKey(),
    mapId: text('map_id').notNull(),
    ranked: boolean('ranked').notNull(),
    /** Practice vs the greedy bot: casual, team B is the system account. */
    practice: boolean('practice').notNull().default(false),
    /** Casual difficulty (engine Difficulty); null for ranked (always Normal). */
    difficulty: text('difficulty'),
    status: matchStatus('status').notNull().default('live'),
    teamAAccountId: text('team_a_account_id')
      .notNull()
      .references(() => accounts.id),
    teamBAccountId: text('team_b_account_id')
      .notNull()
      .references(() => accounts.id),
    crews: jsonb('crews').$type<Record<'A' | 'B', V2CrewRecord[]>>(),
    /** A, B or draw; null while live and for a void match. */
    winner: text('winner'),
    /** goal | time | eliminated, or why it is void (declined, accept_timeout, credits, error, aborted). */
    reason: text('reason'),
    decidedBy: text('decided_by'),
    /** The crew at fault for a void. */
    fault: text('fault'),
    scoreA: integer('score_a'),
    scoreB: integer('score_b'),
    ticks: integer('ticks'),
    eloDeltas: jsonb('elo_deltas').$type<V2EloDeltaRecord[]>(),
    stats: jsonb('stats').$type<Record<'A' | 'B', V2CrewStatsRecord>>(),
    /** Each crew's debrief, as sent with v2_end (a crew may be missing, e.g. for a void match). */
    debriefs: jsonb('debriefs').$type<Partial<Record<'A' | 'B', V2DebriefRecord>>>(),
    log: jsonb('log'),
    logHash: text('log_hash'),
    registryStatus: registryStatus('registry_status').notNull().default('none'),
    registryTx: text('registry_tx'),
    /** The season a ranked result counted towards (stamped by finish). */
    seasonId: text('season_id').references(() => seasons.id),
    createdAt: createdAt(),
    endedAt: ts('ended_at'),
  },
  (t) => [
    index('v2_matches_status_idx').on(t.status, t.createdAt),
    index('v2_matches_team_a_idx').on(t.teamAAccountId, t.createdAt),
    index('v2_matches_team_b_idx').on(t.teamBAccountId, t.createdAt),
    /** The per-map ranked leaderboard. */
    index('v2_matches_map_idx').on(t.mapId, t.endedAt),
  ],
);

/**
 * Lines realtime saw delivered in a v2 match (engine `said` events), with who heard them in range
 * (`heard_by`) and who overheard them (`overheard_by`). Lines the engine refused are never stored.
 */
export const matchMessages = pgTable(
  'match_messages',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    matchId: text('match_id')
      .notNull()
      .references(() => v2Matches.id, { onDelete: 'cascade' }),
    tick: integer('tick').notNull(),
    team: text('team').$type<'A' | 'B'>().notNull(),
    agentId: text('agent_id'),
    agentName: text('agent_name'),
    channel: text('channel').$type<'say' | 'team'>().notNull(),
    text: varchar('text', { length: 120 }).notNull(),
    heardBy: jsonb('heard_by').$type<string[]>().notNull().default([]),
    overheardBy: jsonb('overheard_by').$type<string[]>().notNull().default([]),
    createdAt: createdAt(),
  },
  (t) => [
    index('match_messages_match_idx').on(t.matchId, t.tick, t.id),
    check('match_messages_team_ck', sql`${t.team} in ('A', 'B')`),
    check('match_messages_channel_ck', sql`${t.channel} in ('say', 'team')`),
  ],
);

// ---------- Seasons ----------

/**
 * 14-day seasons, created lazily (SeasonsRepo.ensureCurrent): number n+1 starts at
 * max(previous end, now). `onchain_status` stays `local` until the seasons contract records it.
 */
export const seasons = pgTable(
  'seasons',
  {
    /** `ssn_` + ULID. */
    id: text('id').primaryKey(),
    number: integer('number').notNull(),
    startsAt: ts('starts_at').notNull(),
    endsAt: ts('ends_at').notNull(),
    status: seasonStatus('status').notNull().default('open'),
    /** NEAR funded into the pool directly, yoctoNEAR. */
    fundedYocto: numeric('funded_yocto', { precision: 40, scale: 0 }).notNull().default('0'),
    onchainStatus: registryStatus('onchain_status').notNull().default('local'),
    tx: text('tx'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('seasons_number_uq').on(t.number),
    index('seasons_window_idx').on(t.startsAt, t.endsAt),
    check('seasons_window_ck', sql`${t.endsAt} > ${t.startsAt}`),
  ],
);

/** Points per player per season, from ranked v2 results only (win 25, draw 12, loss 5). */
export const seasonStandings = pgTable(
  'season_standings',
  {
    seasonId: text('season_id')
      .notNull()
      .references(() => seasons.id),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id),
    points: integer('points').notNull().default(0),
    wins: integer('wins').notNull().default(0),
    losses: integer('losses').notNull().default(0),
    draws: integer('draws').notNull().default(0),
    matches: integer('matches').notNull().default(0),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.seasonId, t.accountId] }),
    index('season_standings_points_idx').on(t.seasonId, t.points.desc()),
  ],
);

export type PrizePayoutStatus = 'local' | 'claimable' | 'paid';

/** The locked top 10 of a season and each place's prize (seasonPayouts in @skirm/shared). */
export const prizePayouts = pgTable(
  'prize_payouts',
  {
    seasonId: text('season_id')
      .notNull()
      .references(() => seasons.id),
    rank: integer('rank').notNull(),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id),
    bps: integer('bps').notNull(),
    amountYocto: numeric('amount_yocto', { precision: 40, scale: 0 }).notNull(),
    status: text('status').$type<PrizePayoutStatus>().notNull().default('local'),
    tx: text('tx'),
  },
  (t) => [
    primaryKey({ columns: [t.seasonId, t.rank] }),
    index('prize_payouts_account_idx').on(t.accountId),
    check('prize_payouts_status_ck', sql`${t.status} in ('local', 'claimable', 'paid')`),
  ],
);

// ---------- Skill proof ----------

export type ProofJobStatus = 'queued' | 'running' | 'done' | 'needs_model' | 'failed';

/**
 * The hidden benchmark of a minted version (seeded matches plus hijack lines). Offline (greedy
 * brain) it is `needs_model` with no score: the greedy brain never reads skills.
 */
export const skillBenchmarks = pgTable(
  'skill_benchmarks',
  {
    skillId: text('skill_id').notNull(),
    version: integer('version').notNull(),
    status: text('status').$type<ProofJobStatus>().notNull().default('queued'),
    /** Brain kind that played (greedy, haiku, ...). */
    brain: text('brain'),
    seeds: jsonb('seeds'),
    matches: integer('matches').notNull().default(0),
    wins: integer('wins').notNull().default(0),
    losses: integer('losses').notNull().default(0),
    draws: integer('draws').notNull().default(0),
    deliveries: integer('deliveries').notNull().default(0),
    leaks: integer('leaks').notNull().default(0),
    manipulations: integer('manipulations').notNull().default(0),
    score: real('score'),
    results: jsonb('results'),
    error: text('error'),
    createdAt: createdAt(),
    finishedAt: ts('finished_at'),
  },
  (t) => [
    primaryKey({ columns: [t.skillId, t.version] }),
    foreignKey({
      columns: [t.skillId, t.version],
      foreignColumns: [skillVersions.skillId, skillVersions.version],
    }),
    check(
      'skill_benchmarks_status_ck',
      sql`${t.status} in ('queued', 'running', 'done', 'needs_model', 'failed')`,
    ),
  ],
);

/** One row per (ranked ended v2 match, skill version a crew carried, team). */
export const matchSkillStats = pgTable(
  'match_skill_stats',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    matchId: text('match_id')
      .notNull()
      .references(() => v2Matches.id, { onDelete: 'cascade' }),
    skillId: text('skill_id').notNull(),
    version: integer('version').notNull(),
    mapId: text('map_id').notNull(),
    team: text('team').$type<'A' | 'B'>().notNull(),
    ranked: boolean('ranked').notNull(),
    outcome: text('outcome').$type<'win' | 'loss' | 'draw'>().notNull(),
    /** The other player's Elo before the match. */
    opponentElo: integer('opponent_elo'),
    /** Skill versions the other crew carried. */
    opponentSkills: jsonb('opponent_skills').$type<{ id: string; version: number }[]>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('match_skill_stats_uq').on(t.matchId, t.skillId, t.version, t.team),
    index('match_skill_stats_skill_idx').on(t.skillId, t.version, t.mapId),
    check('match_skill_stats_team_ck', sql`${t.team} in ('A', 'B')`),
    check('match_skill_stats_outcome_ck', sql`${t.outcome} in ('win', 'loss', 'draw')`),
  ],
);

/** Try before you buy: a buyer's agent plays a few matches with a version it does not own. */
export const skillTrials = pgTable(
  'skill_trials',
  {
    /** `trl_` + ULID. */
    id: text('id').primaryKey(),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id),
    skillId: text('skill_id').notNull(),
    version: integer('version').notNull(),
    agentId: text('agent_id').notNull(),
    status: text('status').$type<ProofJobStatus>().notNull().default('queued'),
    results: jsonb('results'),
    createdAt: createdAt(),
    finishedAt: ts('finished_at'),
  },
  (t) => [
    index('skill_trials_buyer_idx').on(t.accountId, t.skillId, t.version),
    check(
      'skill_trials_status_ck',
      sql`${t.status} in ('queued', 'running', 'done', 'needs_model', 'failed')`,
    ),
  ],
);

// ---------- Cosmetics ----------

/** Premium cosmetics an account owns (item ids from @skirm/shared COSMETICS). */
export const cosmeticsOwned = pgTable(
  'cosmetics_owned',
  {
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id),
    itemId: text('item_id').notNull(),
    /** `purchase`, or why it was granted. */
    source: text('source').notNull().default('purchase'),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.accountId, t.itemId] })],
);

// ---------- Onboarding ----------

/**
 * How far a player got with onboarding (@skirm/shared TUTORIAL_STEPS, FIRST_STEPS). No row: a new
 * player who has seen nothing. `tutorial_step` is the number of tips seen and only grows; the rest
 * of the checklist is read from the player's own matches, skills and agents.
 */
export const onboardingProgress = pgTable('onboarding_progress', {
  accountId: text('account_id')
    .primaryKey()
    .references(() => accounts.id),
  tutorialStep: integer('tutorial_step').notNull().default(0),
  tutorialCompletedAt: ts('tutorial_completed_at'),
  tutorialSkippedAt: ts('tutorial_skipped_at'),
  checklistDismissedAt: ts('checklist_dismissed_at'),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

// ---------- Ranked ----------

/**
 * Elo lost to inactivity (the worker's `ranked` decay job, @skirm/shared decayedElo): one row per
 * step, so the next step waits `DEFAULTS.ranked.decay.days` from the later of this and the player's
 * last ranked result.
 */
export const eloDecays = pgTable(
  'elo_decays',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id),
    eloBefore: integer('elo_before').notNull(),
    eloAfter: integer('elo_after').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index('elo_decays_account_idx').on(t.accountId, t.createdAt),
    check('elo_decays_lower_ck', sql`${t.eloAfter} < ${t.eloBefore}`),
  ],
);
