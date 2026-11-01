import { createHash, randomBytes } from 'node:crypto';
import { createTestDb } from '../src/testing';
import { createRepos, type Db, type Repos, type SealedSkill, type SkillSealer } from '../src/index';

/** Test sealer: not real encryption (the vault lives in @skirm/server); counts calls. */
export class FakeSealer implements SkillSealer {
  calls = 0;
  async encryptSkill(prompt: string, reflexes?: string): Promise<SealedSkill> {
    this.calls++;
    const plain = Buffer.from(JSON.stringify({ prompt, reflexes }));
    return {
      ciphertext: new Uint8Array(plain.map((b) => b ^ 0x5a)),
      iv: new Uint8Array(randomBytes(12)),
      authTag: new Uint8Array(16).fill(7),
      wrappedKey: new Uint8Array(60).fill(9),
      keyId: 'test',
      promptSha256: createHash('sha256')
        .update(`${prompt}\n${reflexes ?? ''}`)
        .digest('hex'),
    };
  }
}

export interface Ctx {
  db: Db;
  repos: Repos;
  sealer: FakeSealer;
  clock: { now: number };
}

export async function setup(opts: { globalFreeBudget?: number; now?: string } = {}): Promise<Ctx> {
  const db = await createTestDb();
  const clock = { now: Date.parse(opts.now ?? '2026-11-03T08:00:00Z') };
  const repos = createRepos(db, {
    clock: () => clock.now,
    ledger: {
      clock: () => clock.now,
      ...(opts.globalFreeBudget !== undefined
        ? { config: { globalFreeBudget: opts.globalFreeBudget } }
        : {}),
    },
  });
  return { db, repos, sealer: new FakeSealer(), clock };
}

export async function signUp(ctx: Ctx, handle: string) {
  const { account } = await ctx.repos.accounts.getOrCreate({ handle }, ctx.sealer);
  return account;
}
