// Skills + Market fixtures for component tests (shapes of apps/api views.ts / controllers).
import type {
  Listing,
  MarketBenchmark,
  MarketCard,
  MarketDetail,
  SkillRow,
  SkillWithText,
  Trial,
} from '@/lib/api/types';

export const SKILL_ID = 'skl_01J000000000000000000DAM01';
export const SECRET_PROMPT = 'TOP SECRET: block the spillway at (7,4) before anything else';
export const SECRET_REFLEXES = 'SECRET REFLEX: place_block toward water';

export const ME_ID = 'acc_01J000000000000000000000AD';
export const OTHER_ID = 'acc_01J0000000000000000000TIDE';

export function skillRowFixture(o: Partial<SkillRow> = {}): SkillRow {
  return {
    schema: 'skirm.skill/v0',
    id: SKILL_ID,
    version: 1,
    name: 'Dam First',
    summary: 'Blocks the one gap a liquid needs.',
    creator: 'tidecaller',
    owner: 'tidecaller',
    royalty_bps: 500,
    requires_actions: ['place_block'],
    handles_tags: ['spreads', 'liquid'],
    prompt_sha256: 'a'.repeat(64),
    created_at: '2026-10-25T10:00:00.000Z',
    status: 'Draft',
    tokenId: null,
    latestVersion: 1,
    accountBound: false,
    creatorAccount: { id: OTHER_ID, handle: 'tidecaller', nearAccountId: null },
    requiredUnlocks: ['builder'],
    ...o,
  } as SkillRow;
}

export function skillWithTextFixture(o: Partial<SkillWithText> = {}): SkillWithText {
  return {
    ...skillRowFixture({ creatorAccount: { id: ME_ID, handle: 'ada', nearAccountId: null }, creator: 'ada', owner: 'ada' }),
    prompt: SECRET_PROMPT,
    reflexes: SECRET_REFLEXES,
    ...o,
  } as SkillWithText;
}

export function listingFixture(o: Partial<Listing> = {}): Listing {
  return {
    id: 'lst_1',
    skillId: SKILL_ID,
    version: 1,
    tokenId: `${SKILL_ID}:1`,
    sellerId: 'acc_01J0000000000000000000REEF',
    priceYocto: '1500000000000000000000000',
    txHash: null,
    status: 'active',
    createdAt: '2026-11-12T10:00:00.000Z',
    split: {
      primary: false,
      feeYocto: '75000000000000000000000',
      royaltyYocto: '75000000000000000000000',
      sellerYocto: '1350000000000000000000000',
    },
    ...o,
  };
}

export function marketCardFixture(o: Partial<MarketCard> = {}): MarketCard {
  const { requiredUnlocks: _r, ...skill } = skillRowFixture({ status: 'Listed', tokenId: `${SKILL_ID}:1` });
  return {
    skill,
    creator: { id: OTHER_ID, handle: 'tidecaller', nearAccountId: null },
    priceYocto: '1500000000000000000000000',
    listing: listingFixture(),
    owned: false,
    rankedWinRate: 0.625,
    rankedMatches: 16,
    benchmarkScore: 0.71,
    ...o,
  };
}

export function marketDetailFixture(o: Partial<MarketDetail> = {}): MarketDetail {
  return {
    skill: marketCardFixture().skill,
    sales: [],
    listing: listingFixture(),
    owned: false,
    pinned: { version: 1, promptSha256: 'a'.repeat(64), tokenId: `${SKILL_ID}:1`, mintedAt: null },
    benchmark: benchmarkFixture(),
    ranked: {
      matches: 16,
      wins: 10,
      perMap: [
        { mapId: 'copper-hollow', matches: 10, wins: 7, losses: 3, draws: 0 },
        { mapId: 'basalt-stair', matches: 6, wins: 3, losses: 2, draws: 1 },
      ],
    },
    counters: { vs: [{ skillId: 'skl_01J0000000000000000000BRCH', version: 2, name: 'Breach Line', matches: 5, wins: 2, losses: 3, draws: 0 }] },
    trials: { used: 0, left: 3 },
    ...o,
  };
}

/** A finished benchmark with a model brain: 4–2 over 6 seeded matches, one leak. */
export function benchmarkFixture(o: Partial<MarketBenchmark> = {}): MarketBenchmark {
  return {
    status: 'done',
    brain: 'model',
    seeds: 6,
    matches: 6,
    wins: 4,
    losses: 2,
    draws: 0,
    deliveries: 11,
    leakRate: 1 / 6,
    manipulationRate: 1 / 3,
    score: 0.56,
    needsModel: false,
    ...o,
  };
}

/** The offline benchmark: the server runs the greedy bot brain, nothing played, no score. */
export const offlineBenchmark = (): MarketBenchmark =>
  benchmarkFixture({ status: 'needs_model', brain: 'greedy', seeds: null, matches: 0, wins: 0, losses: 0, draws: 0, deliveries: 0, leakRate: null, manipulationRate: null, score: null, needsModel: true });

export function trialFixture(o: Partial<Trial> = {}): Trial {
  return {
    id: 'trl_01J00000000000000000000001',
    skillId: SKILL_ID,
    version: 1,
    agentId: 'agt_01J0000000000000000000ROOK',
    status: 'done',
    results: [
      { mapId: 'copper-hollow', difficulty: 'easy', outcome: 'win', score: { A: 3, B: 0 }, ticks: 58 },
      { mapId: 'basalt-stair', difficulty: 'easy', winner: 'B', score: { A: 1, B: 2 }, ticks: 102 },
      { mapId: 'copper-hollow', difficulty: 'normal', winner: 'draw', score: { A: 1, B: 1 }, ticks: 150 },
    ],
    createdAt: '2026-10-25T10:20:00.000Z',
    finishedAt: '2026-10-25T10:22:00.000Z',
    ...o,
  };
}
