// Test harness: the real app against PGlite, with an in-memory queue, spend reader and NEAR fakes.
import { randomBytes } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { createRepos, type Db, type Repos } from '@skirm/db';
import { createTestDb } from '@skirm/db/testing';
import {
  CompositeDepositVerifier,
  CompositeRentalVerifier,
  DepositError,
  DevDepositVerifier,
  DevRentalVerifier,
  RentalError,
  type RentalPayment,
  type RentalVerifier,
  LocalKeyWrapper,
  NoopBadges,
  NoopMinter,
  NoopOwnershipReader,
  Vault,
  type DepositVerifier,
  type OwnershipReader,
} from '@skirm/server';
import request from 'supertest';
import { createApp } from '../src/app.module';
import type { ApiConfig, ApiDeps } from '../src/deps';
import { MemoryBenchmarkQueue, MemoryDailyCosts } from '../src/infra';
import type { NearKeyChecker } from '../src/near-link';

/** Ownership reader the test controls (kind `near`, so purchases go through the RPC path). */
export class FakeOwnership implements OwnershipReader {
  readonly kind = 'near' as const;
  owners = new Map<string, string>();
  async ownerOf(tokenId: string): Promise<string | null> {
    return this.owners.get(tokenId) ?? null;
  }
}

/** RPC deposit verifier stand-in: knows a fixed set of tx hashes. */
export class FakeRpcDeposits implements DepositVerifier {
  txs = new Map<string, { sender: string; credits: number }>();
  async verify(txHash: string, opts: { senderId?: string | null } = {}) {
    const t = this.txs.get(txHash);
    if (!t) throw new DepositError('not_found', 'transaction not found');
    if (t.sender !== opts.senderId)
      throw new DepositError('wrong_sender', 'signed by another account');
    return {
      receipt: txHash,
      amountYocto: BigInt(t.credits) * 10n ** 21n,
      credits: t.credits,
      sender: t.sender,
      dev: false,
    };
  }
}

/** RPC rental verifier stand-in: knows a fixed set of tx hashes and their `rental` events. */
export class FakeRpcRentals implements RentalVerifier {
  txs = new Map<string, Omit<RentalPayment, 'receipt' | 'dev'>>();
  async verify(txHash: string, opts: { renterId?: string | null }) {
    const t = this.txs.get(txHash);
    if (!t) throw new RentalError('not_found', 'transaction not found');
    if (t.renter !== opts.renterId) throw new RentalError('wrong_sender', 'signed by another account');
    return { ...t, receipt: txHash, dev: false };
  }
}

export interface Harness {
  app: INestApplication;
  db: Db;
  repos: Repos;
  deps: ApiDeps;
  benchmarks: MemoryBenchmarkQueue;
  minter: NoopMinter;
  badges: NoopBadges;
  ownership: FakeOwnership | NoopOwnershipReader;
  rpcDeposits: FakeRpcDeposits;
  rpcRentals: FakeRpcRentals;
  clock: { now: number };
  costs: MemoryDailyCosts;
  http: () => ReturnType<typeof request>;
  /** Signs in a dev user and returns a request helper that sends their header. */
  as: (handle: string) => Promise<UserClient>;
  close: () => Promise<void>;
}

export interface UserClient {
  handle: string;
  accountId: string;
  get: (path: string) => request.Test;
  post: (path: string, body?: object) => request.Test;
  put: (path: string, body?: object) => request.Test;
  patch: (path: string, body?: object) => request.Test;
  del: (path: string, body?: object) => request.Test;
}

export async function setup(
  opts: {
    config?: Partial<ApiConfig>;
    nearOwnership?: boolean;
    /** Use this database (e.g. real Postgres) instead of a fresh PGlite. */
    db?: Db;
    nearKeys?: NearKeyChecker;
    now?: string;
    /** Turn request rate limits on (off by default: the harness signs many players in a minute). */
    rateLimit?: ApiDeps['rateLimit'];
    /** Stored frames for shared replays and the caster (default: none, template caster). */
    replayFrames?: ApiDeps['replayFrames'];
    caster?: ApiDeps['caster'];
  } = {},
): Promise<Harness> {
  const db = opts.db ?? (await createTestDb());
  const clock = { now: Date.parse(opts.now ?? '2026-11-03T08:00:00Z') };
  const repos = createRepos(db, { ledger: { clock: () => clock.now }, clock: () => clock.now });
  const benchmarks = new MemoryBenchmarkQueue();
  const minter = new NoopMinter();
  const badges = new NoopBadges();
  const ownership = opts.nearOwnership ? new FakeOwnership() : new NoopOwnershipReader();
  const rpcDeposits = new FakeRpcDeposits();
  const rpcRentals = new FakeRpcRentals();
  const costs = new MemoryDailyCosts();
  const config: ApiConfig = {
    AUTH_MODE: 'dev',
    PRIVY_APP_ID: undefined,
    PRIVY_VERIFICATION_KEY: undefined,
    CREDITS_PER_NEAR: 1000,
    ...opts.config,
  };
  const deps: ApiDeps = {
    config,
    repos,
    vault: new Vault(new LocalKeyWrapper(new Uint8Array(randomBytes(32)))),
    near: {
      minter,
      deposits: new CompositeDepositVerifier(
        rpcDeposits,
        config.AUTH_MODE === 'dev' ? new DevDepositVerifier(config.CREDITS_PER_NEAR) : undefined,
      ),
      rentals: new CompositeRentalVerifier(rpcRentals, config.AUTH_MODE === 'dev' ? new DevRentalVerifier() : undefined),
      ownership,
      badges,
      ...(opts.nearKeys ? { keys: opts.nearKeys } : {}),
    },
    benchmarkQueue: benchmarks,
    costs,
    ...(opts.rateLimit ? { rateLimit: opts.rateLimit } : {}),
    ...(opts.replayFrames ? { replayFrames: opts.replayFrames } : {}),
    ...(opts.caster ? { caster: opts.caster } : {}),
  };
  const app = await createApp(deps, { logger: false });
  await app.init();
  const server = app.getHttpServer();
  const http = () => request(server);
  const as = async (handle: string): Promise<UserClient> => {
    const res = await http().post('/auth/session').set('x-dev-user', handle).send({});
    if (res.status !== 200) throw new Error(`sign-in failed: ${res.status}`);
    const h = (t: request.Test) => t.set('x-dev-user', handle);
    return {
      handle,
      accountId: res.body.account.id,
      get: (p) => h(http().get(p)),
      post: (p, b) => h(http().post(p)).send(b ?? {}),
      put: (p, b) => h(http().put(p)).send(b ?? {}),
      patch: (p, b) => h(http().patch(p)).send(b ?? {}),
      del: (p, b) => (b ? h(http().delete(p)).send(b) : h(http().delete(p))),
    };
  };
  return {
    app,
    db,
    repos,
    deps,
    benchmarks,
    minter,
    badges,
    ownership,
    rpcDeposits,
    rpcRentals,
    clock,
    costs,
    http,
    as,
    close: () => app.close(),
  };
}

export const FLOOD_WARDEN = { id: 'skl_01JB7Z3K9QX4M2T8V6N5R1C0DE', version: 1 };

export const SAMPLE_SKILL = {
  name: 'Gap Sealer',
  summary: 'Blocks the first gap.',
  prompt: 'SECRET-PROMPT-7f3a: find the narrowest gap next to liquid and block it first.',
  reflexes: 'SECRET-REFLEX-91bc: block when liquid is one tile away.',
  requires_actions: ['place_block'],
  handles_tags: ['spreads', 'liquid'],
  royalty_bps: 500,
};
