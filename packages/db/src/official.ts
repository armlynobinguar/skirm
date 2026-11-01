// Official starter skills for the marketplace (Concept risk table: "Empty marketplace at launch →
// seed it with official starter skills"; Milestones, Tue 10 Nov), written by the system account,
// minted and listed at modest prices. Their proof is the hidden benchmark queued at mint, as for a
// player's skill.
//
// Hidden-prompt rule: the text below is sealed into the vault at seed time like any skill. No API
// returns it (the creator is the system account, which never signs in).
import { and, eq } from 'drizzle-orm';
import type { Tag } from '@skirm/shared';
import type { Executor } from './client';
import { accounts, agents, skillOwnership, skillVersions, skills } from './schema';
import { SYSTEM_ACCOUNT_ID, SYSTEM_HANDLE } from './starter';
import type { SealedSkill } from './types';
import type { RequiredAction } from './repos/skills';

export interface OfficialSkillDef {
  id: string;
  version: 1;
  name: string;
  summary: string;
  royaltyBps: number;
  requiresActions: RequiredAction[];
  handlesTags: Tag[];
  /** Spec §9 write-only text; sealed into the vault, never returned. */
  prompt: string;
  reflexes: string;
  /** Listing price, yoctoNEAR. */
  priceYocto: string;
}

const NEAR = 10n ** 24n;
const near = (tenths: number) => ((BigInt(tenths) * NEAR) / 10n).toString();

/** The system account's agents (never ranked, so never on the ladder). */
export const OFFICIAL_AGENTS = [
  { id: 'agt_01JBK0FF1C1AAGENT000000001', name: 'Skirm One' },
  { id: 'agt_01JBK0FF1C1AAGENT000000002', name: 'Skirm Two' },
] as const;

export const OFFICIAL_SKILLS: readonly OfficialSkillDef[] = [
  {
    id: 'skl_01JBK0FF1C1AGATEKEEPER0001',
    version: 1,
    name: 'Gate Keeper',
    summary: 'Dams the one-tile gap before the flood reaches it, then sweeps every collectible.',
    royaltyBps: 500,
    requiresActions: ['place_block'],
    handlesTags: ['spreads', 'liquid', 'collectible'],
    prompt:
      'Before any task, find every tile tagged spreads+liquid and each gap one tile wide where it can reach open floor. Work out the tick it reaches each gap from its spread interval. If you can stand next to a gap before then, take the shortest route there and place a block in it. Then visit the collectible tiles in the order that gives the shortest total path, and stop once the collect goal is met. Never end a tick on a tile that spreads+liquid will reach on the next tick.',
    reflexes:
      'If a spreads+liquid tile is 1 tile from an open gap and place_block is legal toward the gap, place it. Otherwise move toward the nearest collectible.',
    priceYocto: near(5),
  },
  {
    id: 'skl_01JBK0FF1C1AF1REBREAK00001',
    version: 1,
    name: 'Firebreak',
    summary:
      'Cuts the fire off with a crate, puts out flames on the route, then takes the key out.',
    royaltyBps: 500,
    requiresActions: ['extinguish'],
    handlesTags: ['spreads', 'damages', 'flammable', 'pushable', 'goal'],
    prompt:
      'Find every tile tagged spreads+damages and the flammable tiles that link it to your route. Before the fire can reach the route, push a pushable tile into the narrowest flammable link so the fire has no path; a firebreak only has to hold for the ticks you need. Then take the shortest route that stays at least one tile away from spreads+damages: pick up the collectible and walk to the goal. If a spreads+damages tile sits on the only route and extinguish is legal toward it, put it out instead of waiting.',
    reflexes:
      'Never step next to spreads+damages when another legal move keeps you on the route. If extinguish is legal toward a spreads+damages tile on your route, use it.',
    priceYocto: near(8),
  },
  {
    id: 'skl_01JBK0FF1C1AMAGMADAM000001',
    version: 1,
    name: 'Lava Dam',
    summary: 'Dams the lava shaft in time, digs through to the crystal and gets out alive.',
    royaltyBps: 500,
    requiresActions: ['place_block', 'dig'],
    handlesTags: ['spreads', 'liquid', 'damages', 'breakable', 'collectible', 'goal'],
    prompt:
      'Before any task, find the spreads+liquid+damages source and the narrowest point where its flow can reach the goal or your route. Work out the tick it gets there from its spread interval and go there first: place a block in that point before it arrives. Then dig through the breakable tiles on the shortest route to each collectible, collect them, and walk to the goal. Keep at least one tile between you and any spreads+damages tile at all times.',
    reflexes:
      'If a spreads+liquid tile is 1 tile from the dam point and place_block is legal toward it, place it. If a breakable tile blocks the route and dig is legal toward it, dig.',
    priceYocto: near(12),
  },
  // Survival pack: ready-made skills for the hazards every map shares (rising water, dirt, fire,
  // supplies to carry home).
  {
    id: 'skl_01JBK0FF1C1ASANDBAG0000001',
    version: 1,
    name: 'Sandbag Line',
    summary: 'Seals the spillway the river is about to pour through, then helps carry supplies home.',
    royaltyBps: 500,
    requiresActions: ['place_block'],
    handlesTags: ['spreads', 'liquid', 'goal'],
    prompt:
      'Find every spreads+liquid tile and the open gaps in the wall below it. Work out which gap the flood reaches first from its spread interval and the tick now. Go to the tile beside that gap by the shortest safe route and place a block in it; repeat for the next gap while blocks remain. Then collect the nearest collectible and carry it to the goal. Never wait on a tile the flood enters on the next tick.',
    reflexes:
      'If a spreads+liquid tile is next to an open gap and place_block is legal toward the gap, place it. If the goal is about to flood, go straight to it.',
    priceYocto: near(3),
  },
  {
    id: 'skl_01JBK0FF1C1ATVNNE1RAT00001',
    version: 1,
    name: 'Tunnel Rat',
    summary: 'Digs through dirt-plugged gaps in the palisade for the short way to the shelter.',
    royaltyBps: 500,
    requiresActions: ['dig'],
    handlesTags: ['breakable', 'collectible', 'goal'],
    prompt:
      'Compare the shortest route to each collectible and then to the goal with and without digging through breakable tiles. When digging a breakable tile saves at least two steps, dig it from the side you approach. Collect what the goal needs, nearest first, then walk to the goal. Keep at least one tile between you and any spreads+damages tile.',
    reflexes: 'If a breakable tile is the next step on your route and dig is legal toward it, dig.',
    priceYocto: near(3),
  },
  {
    id: 'skl_01JBK0FF1C1AEMBERGVARD0001',
    version: 1,
    name: 'Ember Guard',
    summary: 'Keeps the wildfire off the crew: puts out flames on the route and stays out of their reach.',
    royaltyBps: 500,
    requiresActions: ['extinguish'],
    handlesTags: ['spreads', 'damages', 'flammable', 'goal'],
    prompt:
      'Find every spreads+damages tile and the flammable tiles touching it. Plan a route to the collectibles and the goal that stays at least two tiles from fire when it can. If fire sits on the only route, or will reach a crewmate next tick, and extinguish is legal toward it, put it out. Collect what the goal needs and walk to the goal.',
    reflexes:
      'If a spreads+damages tile is next to you and extinguish is legal toward it, extinguish. Never step onto a flammable tile next to fire.',
    priceYocto: near(4),
  },
  {
    id: 'skl_01JBK0FF1C1ASVPP1YRVNNER01',
    version: 1,
    name: 'Supply Runner',
    summary: 'No unlock needed: grabs supplies in the shortest order and runs them to the shelter.',
    royaltyBps: 500,
    requiresActions: [],
    handlesTags: ['collectible', 'goal'],
    prompt:
      'Order the collectibles so the total walk from your tile through them to the goal is shortest, skipping any that sit next to a spreads+damages tile. Collect only as many as the goal needs, then go to the goal. Prefer routes that keep away from spreading hazards.',
    reflexes: 'Move toward the next collectible in your order; once the goal count is met, move toward the goal.',
    priceYocto: near(2),
  },
];

/** Session-level advisory lock key for the official seed ("skds"; the migrator uses "skirm"). */
export const SEED_LOCK_KEY = 0x736b6473;

/** Seed-side reads and idempotent writes (fixed ids, so concurrent or repeated seeds converge). */
export class OfficialRepo {
  constructor(private readonly db: Executor) {}

  /** System account and its agents. */
  async ensureSystem(): Promise<void> {
    await this.db
      .insert(accounts)
      .values({ id: SYSTEM_ACCOUNT_ID, handle: SYSTEM_HANDLE, system: true })
      .onConflictDoNothing();
    await this.db
      .insert(agents)
      .values(OFFICIAL_AGENTS.map((a) => ({ id: a.id, ownerId: SYSTEM_ACCOUNT_ID, name: a.name })))
      .onConflictDoNothing();
  }

  async skillExists(def: OfficialSkillDef): Promise<boolean> {
    const [row] = await this.db
      .select({ v: skillVersions.version })
      .from(skillVersions)
      .where(and(eq(skillVersions.skillId, def.id), eq(skillVersions.version, def.version)));
    return !!row;
  }

  /** The skill, version 1 as a draft, held by the system account. Idempotent. */
  async ensureSkill(def: OfficialSkillDef, sealed: SealedSkill): Promise<void> {
    await this.db.transaction(async (t) => {
      await t
        .insert(skills)
        .values({
          id: def.id,
          creatorId: SYSTEM_ACCOUNT_ID,
          name: def.name,
          summary: def.summary,
          accountBound: false,
        })
        .onConflictDoNothing();
      await t
        .insert(skillVersions)
        .values({
          skillId: def.id,
          version: def.version,
          name: def.name,
          summary: def.summary,
          requiresActions: [...def.requiresActions],
          handlesTags: [...def.handlesTags],
          royaltyBps: def.royaltyBps,
          promptSha256: sealed.promptSha256,
          ciphertext: sealed.ciphertext,
          iv: sealed.iv,
          authTag: sealed.authTag,
          wrappedKey: sealed.wrappedKey,
          keyId: sealed.keyId,
          status: 'draft',
        })
        .onConflictDoNothing();
      await t
        .insert(skillOwnership)
        .values({ skillId: def.id, version: def.version, ownerId: SYSTEM_ACCOUNT_ID })
        .onConflictDoNothing();
    });
  }
}
