import type { Executor } from '../client';
import { AccountsRepo } from './accounts';
import { AgentsRepo } from './agents';
import { CosmeticsRepo } from './cosmetics';
import { LeaderboardsRepo } from './leaderboards';
import { LedgerRepo, type LedgerRepoOptions } from './ledger';
import { MarketRepo } from './market';
import { MatchMessagesRepo } from './match-messages';
import { OpsRepo } from './ops';
import { ProofRepo } from './proof';
import { QuestsRepo } from './quests';
import { RentalsRepo } from './rentals';
import { SeasonsRepo } from './seasons';
import { SkillsRepo } from './skills';
import { tx, type Clock } from './util';
import { V2MatchesRepo } from './v2-matches';

export interface Repos {
  db: Executor;
  accounts: AccountsRepo;
  agents: AgentsRepo;
  skills: SkillsRepo;
  market: MarketRepo;
  ledger: LedgerRepo;
  leaderboards: LeaderboardsRepo;
  v2Matches: V2MatchesRepo;
  /** Lines delivered in v2 matches (GET /v2/matches/:id/messages). */
  matchMessages: MatchMessagesRepo;
  /** Operator aggregates (GET /ops/stats). */
  ops: OpsRepo;
  /** v2 seasons: standings, pool, locked prizes. */
  seasons: SeasonsRepo;
  /** Skill proof: benchmarks, ranked records per version, counters, trials. */
  proof: ProofRepo;
  /** Premium cosmetics (paid credits only). */
  cosmetics: CosmeticsRepo;
  /** Agent rental offers and one-match passes. */
  rentals: RentalsRepo;
  /** Quest claims, play streaks and achievements (with their soulbound badges). */
  quests: QuestsRepo;
  /** Runs `fn` with repositories bound to one transaction. */
  transaction<T>(fn: (repos: Repos) => Promise<T>): Promise<T>;
}

export interface ReposOptions {
  ledger?: LedgerRepoOptions;
  /** Clock for seasons (which season a ranked finish counts towards). */
  clock?: Clock;
}

export function createRepos(db: Executor, opts: ReposOptions = {}): Repos {
  return {
    db,
    accounts: new AccountsRepo(db),
    agents: new AgentsRepo(db),
    skills: new SkillsRepo(db),
    market: new MarketRepo(db),
    ledger: new LedgerRepo(db, opts.ledger),
    leaderboards: new LeaderboardsRepo(db),
    v2Matches: new V2MatchesRepo(db, opts.clock),
    matchMessages: new MatchMessagesRepo(db),
    ops: new OpsRepo(db),
    seasons: new SeasonsRepo(db, opts.clock),
    proof: new ProofRepo(db),
    cosmetics: new CosmeticsRepo(db, opts.ledger),
    rentals: new RentalsRepo(db),
    quests: new QuestsRepo(db, {
      ...(opts.ledger?.clock ? { clock: opts.ledger.clock } : opts.clock ? { clock: opts.clock } : {}),
      ...(opts.ledger?.config?.freeAllowance !== undefined
        ? { freeAllowance: opts.ledger.config.freeAllowance }
        : {}),
    }),
    transaction: (fn) => tx(db, (t) => fn(createRepos(t, opts))),
  };
}

export * from './accounts';
export * from './agents';
export * from './cosmetics';
export * from './leaderboards';
export * from './ledger';
export * from './market';
export * from './match-messages';
export * from './ops';
export * from './proof';
export * from './quests';
export * from './rentals';
export * from './seasons';
export * from './skills';
export * from './v2-matches';
export { isUniqueViolation, nextUtcMidnight, rowsOf, utcDay, utcDayStart, type Clock } from './util';
