// Official starter skills (Concept risk table "Empty marketplace at launch": seed it with official
// starter skills; Milestones Tue 10 Nov). Runs at worker boot, after migrations, and is safe to run
// again and concurrently: everything happens under a Postgres session advisory lock, and every write
// is keyed by fixed ids or checked against what is already there.
//
// Each skill is sealed into the vault, its hidden benchmark is queued (the proof a mint now carries,
// as for a player's skill), then it is minted and listed by the system account. No matches are played:
// the benchmark worker produces the skill's proof, and with no model key it honestly reports
// `needs_model` instead of a score.
import {
  OFFICIAL_SKILLS,
  OfficialRepo,
  SEED_LOCK_KEY,
  SYSTEM_ACCOUNT_ID,
  withAdvisoryLock,
  type Db,
  type OfficialSkillDef,
  type ProofJobStatus,
  type SkillSealer,
} from '@skirm/db';
import type { Minter } from '@skirm/server';
import { errorCode, type WorkerDeps } from './deps';

export interface SeedOptions {
  /** The pool the advisory lock is taken on (the same database as `deps.repos`). */
  db: Db;
  /** Seals the skill text into the vault. */
  sealer: SkillSealer;
  minter: Minter;
  /** Creator named onchain when the minter is NEAR (the platform ops account). */
  creatorNear?: string;
  /** Default: the shipped OFFICIAL_SKILLS. */
  skills?: readonly OfficialSkillDef[];
}

export interface SeedSkillReport {
  id: string;
  name: string;
  created: boolean;
  minted: boolean;
  listed: boolean;
  /** The benchmark's state after the seed (`queued` until the benchmark worker takes it). */
  benchmark: ProofJobStatus;
}

export interface SeedReport {
  skills: SeedSkillReport[];
}

/** Seeds the official skills. Idempotent; concurrent callers run one after another. */
export async function seedOfficialSkills(
  deps: Pick<WorkerDeps, 'repos' | 'logger' | 'benchmarkQueue'>,
  opts: SeedOptions,
): Promise<SeedReport> {
  return withAdvisoryLock(opts.db, SEED_LOCK_KEY, () => seedLocked(deps, opts));
}

async function seedLocked(
  deps: Pick<WorkerDeps, 'repos' | 'logger' | 'benchmarkQueue'>,
  opts: SeedOptions,
): Promise<SeedReport> {
  const { repos, logger } = deps;
  const official = new OfficialRepo(repos.db);
  await official.ensureSystem();

  const out: SeedSkillReport[] = [];
  for (const def of opts.skills ?? OFFICIAL_SKILLS) {
    let created = false;
    if (!(await official.skillExists(def))) {
      const sealed = await opts.sealer.encryptSkill(def.prompt, def.reflexes);
      await official.ensureSkill(def, sealed);
      created = true;
    }

    // The benchmark is queued at mint. A row still `queued` (a job lost with Redis, or never sent)
    // is sent again; the stable job id keeps it to one job.
    const bench = await repos.proof.enqueueBenchmark(def.id, def.version);
    if (bench.status === 'queued')
      await deps.benchmarkQueue.enqueue({ kind: 'mint', skillId: def.id, version: def.version });

    let minted = false;
    let v = await repos.skills.get(def.id, def.version);
    if (v?.status === 'draft') {
      try {
        const token = await opts.minter.mint({
          id: v.id,
          version: v.version,
          name: v.name,
          summary: v.summary,
          creator: (opts.minter.kind === 'near' && opts.creatorNear) || v.creatorHandle,
          royaltyBps: v.royaltyBps,
          requiresActions: v.requiresActions,
          handlesTags: v.handlesTags,
          promptSha256: v.promptSha256,
          createdAt: new Date(v.createdAt).toISOString(),
        });
        await repos.skills.markMinted(v.id, v.version, token.tokenId);
        minted = true;
        v = await repos.skills.get(def.id, def.version);
      } catch (err) {
        logger.warn('official skill mint failed; next boot retries', {
          skillId: def.id,
          code: errorCode(err),
        });
      }
    }

    // List while the system account still holds it (after a sale the buyer owns it: no relist).
    let listed = false;
    if (
      v?.status === 'minted' &&
      (await repos.skills.owns(SYSTEM_ACCOUNT_ID, v.id, v.version)) &&
      !(await repos.market.activeListing(v.id, v.version))
    ) {
      await repos.market.list({
        skillId: v.id,
        version: v.version,
        sellerId: SYSTEM_ACCOUNT_ID,
        priceYocto: def.priceYocto,
      });
      listed = true;
    }
    out.push({ id: def.id, name: def.name, created, minted, listed, benchmark: bench.status });
  }

  const changed = out.some((s) => s.created || s.minted || s.listed);
  logger.info(changed ? 'official skills seeded' : 'official skills already seeded', {
    skills: out.map((s) => ({
      id: s.id,
      minted: s.minted,
      listed: s.listed,
      benchmark: s.benchmark,
    })),
  });
  return { skills: out };
}
