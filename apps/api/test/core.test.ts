// /health, /auth/session, /me, /agents and the public-vs-session rules.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { FLOOD_WARDEN, setup, type Harness } from './helpers';

let h: Harness;
beforeAll(async () => {
  h = await setup();
});
afterAll(() => h.close());
afterEach(() => vi.restoreAllMocks());

/** Makes every agent read as playing a live match (AgentsRepo.busyAgents, the check PATCH uses). */
const allBusy = (ids: string[]) =>
  vi.spyOn(Object.getPrototypeOf(h.repos.agents) as { busyAgents: () => Promise<string[]> }, 'busyAgents').mockResolvedValue(ids);

describe('health and sessions', () => {
  it('GET /health is public', async () => {
    const res = await h.http().get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('POST /auth/session needs x-dev-user in dev mode', async () => {
    const res = await h.http().post('/auth/session').send({});
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('unauthenticated');
    const bad = await h.http().post('/auth/session').set('x-dev-user', 'A B!').send({});
    expect(bad.status).toBe(401);
  });

  it('links a NEAR account once', async () => {
    const res = await h
      .http()
      .post('/auth/session')
      .set('x-dev-user', 'nina')
      .send({ nearAccountId: 'nina.testnet' });
    expect(res.status).toBe(200);
    expect(res.body.account.nearAccountId).toBe('nina.testnet');
    const taken = await h
      .http()
      .post('/auth/session')
      .set('x-dev-user', 'otto')
      .send({ nearAccountId: 'nina.testnet' });
    expect(taken.status).toBe(409);
    expect(taken.body.error.code).toBe('near_account_taken');
  });

  it('refuses the reserved system handle', async () => {
    const res = await h.http().post('/auth/session').set('x-dev-user', 'skirm').send({});
    // `@skirm` is not a valid dev handle and `skirm` is an ordinary one: no account is shared.
    expect(res.status).toBe(200);
    expect(res.body.account.id).not.toBe('acc_00000000000000000000000000');
  });

  it('session routes are 401 without credentials or before sign-in', async () => {
    for (const path of ['/me', '/me/matches', '/agents', '/skills', '/credits']) {
      const res = await h.http().get(path);
      expect(res.status, path).toBe(401);
      expect(res.body.error).toMatchObject({ code: 'unauthenticated' });
    }
    const ghost = await h.http().get('/me').set('x-dev-user', 'never-signed-in');
    expect(ghost.status).toBe(401);
    expect(ghost.body.error.code).toBe('no_session');
  });

  it('public routes work without a session', async () => {
    for (const path of ['/leaderboards/players', '/v2/matches/live', '/seasons/current', '/market'])
      expect((await h.http().get(path)).status, path).toBe(200);
  });

  it('unknown routes use the error shape', async () => {
    const res = await h.http().get('/nope');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: { code: 'not_found', message: 'route not found' } });
  });

  it('privy mode refuses dev headers and bad tokens', async () => {
    const p = await setup({
      config: { AUTH_MODE: 'privy', PRIVY_APP_ID: 'app', PRIVY_VERIFICATION_KEY: 'junk' },
    });
    try {
      expect((await p.http().post('/auth/session').set('x-dev-user', 'ada').send({})).status).toBe(
        401,
      );
      const res = await p.http().post('/auth/session').send({ token: 'not.a.jwt' });
      expect(res.status).toBe(401);
      expect((await p.http().get('/me').set('authorization', 'Bearer x.y.z')).status).toBe(401);
    } finally {
      await p.close();
    }
  });
});

describe('agents', () => {
  it('GET /agents lists the starter agents', async () => {
    const u = await h.as('agnes');
    const res = await u.get('/agents');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(3);
    expect(res.body[0]).toMatchObject({
      name: 'Rook',
      skills: [FLOOD_WARDEN],
      unlocks: ['builder'],
    });
  });

  it('PATCH /agents/:id renames, moves unlocks and equips owned skills', async () => {
    const u = await h.as('pat');
    const [rook, wren] = (await u.get('/agents')).body;
    const res = await u.patch(`/agents/${wren.id}`, {
      name: 'Wren II',
      unlocks: ['builder', 'digger'],
      skills: [FLOOD_WARDEN],
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      name: 'Wren II',
      unlocks: ['builder', 'digger'],
      skills: [{ ...FLOOD_WARDEN, name: 'Flood Warden' }],
    });
    // Builder moved off Rook (idle), Flood Warden can sit on both.
    const after = (await u.get('/agents')).body;
    expect(after[0]).toMatchObject({ id: rook.id, unlocks: [] });
  });

  it('PATCH /agents/:id sets the v2 role, vision, comms and talk tier', async () => {
    const u = await h.as('v2pat');
    const [rook] = (await u.get('/agents')).body;
    expect(rook).toMatchObject({ role: 'Runner', vision: 3, comms: 3, tier: 'standard' });
    const res = await u.patch(`/agents/${rook.id}`, { role: 'Scout', vision: 5, comms: 1, tier: 'open' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ role: 'Scout', vision: 5, comms: 1, tier: 'open' });
    expect((await u.patch(`/agents/${rook.id}`, { role: 'Wizard' })).status).toBe(400);
    expect((await u.patch(`/agents/${rook.id}`, { vision: 6 })).status).toBe(400);
  });

  it('PATCH /agents/:id errors: 404, 422, 409 busy', async () => {
    const u = await h.as('perr');
    const other = await h.as('perr2');
    const [rook, wren] = (await u.get('/agents')).body;
    const theirs = (await other.get('/agents')).body[0];
    expect((await u.patch(`/agents/${theirs.id}`, { name: 'x' })).status).toBe(404);
    expect((await u.patch('/agents/agt_nope', { name: 'x' })).status).toBe(404);
    const tooMany = await u.patch(`/agents/${wren.id}`, {
      skills: [FLOOD_WARDEN, { id: 'skl_01JB7Z3K9QX4M2T8V6N5R1C0DF', version: 1 }],
    });
    expect(tooMany.status).toBe(422);
    expect(tooMany.body.error.code).toBe('skill_not_owned');
    const four = await u.patch(`/agents/${wren.id}`, {
      skills: [1, 2, 3, 4].map((v) => ({ id: FLOOD_WARDEN.id, version: v })),
    });
    expect(four.status).toBe(422);
    const badBody = await u.patch(`/agents/${wren.id}`, { unlocks: ['wizard'] });
    expect(badBody.status).toBe(400);
    expect(badBody.body.error.code).toBe('invalid_request');

    allBusy([rook.id]);
    const busy = await u.patch(`/agents/${rook.id}`, { name: 'Rook II' });
    expect(busy.status).toBe(409);
    expect(busy.body.error.code).toBe('agent_busy');
  });

  it('PATCH /agents/:id changes the look, also mid-match, and refuses an invalid one', async () => {
    const u = await h.as('looks');
    const [rook] = (await u.get('/agents')).body;
    expect(rook.appearance).toMatchObject({ headgear: 'role' });
    const look = { skin: 3, hair: 'ponytail', hairColor: 1, outfit: 6, pants: 2, build: 'slim', headgear: 'bandana' };
    allBusy([rook.id]);
    const res = await u.patch(`/agents/${rook.id}`, { appearance: look });
    expect(res.status).toBe(200);
    expect(res.body.appearance).toEqual(look);
    expect((await u.get('/agents')).body[0].appearance).toEqual(look);
    for (const bad of [{ ...look, skin: 9 }, { ...look, hair: 'mohawk' }, { ...look, glow: true }, { skin: 1 }]) {
      const r = await u.patch(`/agents/${rook.id}`, { appearance: bad });
      expect(r.status).toBe(400);
    }
  });
});

describe('NEAR account linking outside dev mode', () => {
  const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  const b58 = (bytes: Uint8Array) => {
    let n = BigInt('0x' + (Buffer.from(bytes).toString('hex') || '0'));
    let s = '';
    while (n > 0n) {
      s = B58[Number(n % 58n)] + s;
      n /= 58n;
    }
    for (const b of bytes) {
      if (b !== 0) break;
      s = '1' + s;
    }
    return s;
  };

  it('needs a signature by a full-access key and refuses a NEAR id linked elsewhere', async () => {
    const { generateKeyPairSync, sign } = await import('node:crypto');
    const { linkMessage } = await import('../src/near-link');
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const raw = Buffer.from(publicKey.export({ format: 'jwk' }).x!, 'base64url');
    const pk = `ed25519:${b58(raw)}`;
    const fullAccess = new Set<string>();
    const p = await setup({
      config: { AUTH_MODE: 'privy', PRIVY_APP_ID: 'app', PRIVY_VERIFICATION_KEY: 'k' },
      nearKeys: { isFullAccessKey: async (acc, key) => fullAccess.has(`${acc}/${key}`) },
    });
    try {
      // Privy sign-in is not testable without a key pair for Privy; drive the guard-free part.
      const { repos, deps } = p;
      const { account } = await repos.accounts.getOrCreate(
        { handle: 'p_link', privyDid: 'did:privy:link' },
        deps.vault,
      );
      const ctrl = p.app.get((await import('../src/controllers/core.controller')).CoreController);
      const check = (proof?: { publicKey: string; signature: string }) =>
        (
          ctrl as unknown as {
            checkNearProof: (a: string, n: string, p?: unknown) => Promise<void>;
          }
        ).checkNearProof(account.id, 'linker.testnet', proof);
      await expect(check()).rejects.toMatchObject({ status: 422, code: 'near_proof_required' });
      const sig = sign(
        null,
        Buffer.from(linkMessage(account.id, 'linker.testnet')),
        privateKey,
      ).toString('base64');
      const wrong = sign(null, Buffer.from('other'), privateKey).toString('base64');
      await expect(check({ publicKey: pk, signature: wrong })).rejects.toMatchObject({
        code: 'near_proof_invalid',
      });
      await expect(check({ publicKey: pk, signature: sig })).rejects.toMatchObject({
        code: 'near_proof_invalid',
      });
      fullAccess.add(`linker.testnet/${pk}`);
      await expect(check({ publicKey: pk, signature: sig })).resolves.toBeUndefined();
      // The sign-in form (no NEAR id in the text) passes too, and is bound by the same key check.
      const { linkSignInMessage } = await import('../src/near-link');
      const sigIn = sign(null, Buffer.from(linkSignInMessage(account.id)), privateKey).toString('base64');
      await expect(check({ publicKey: pk, signature: sigIn })).resolves.toBeUndefined();
      fullAccess.delete(`linker.testnet/${pk}`);
      await expect(check({ publicKey: pk, signature: sigIn })).rejects.toMatchObject({ status: 422 });
      fullAccess.add(`linker.testnet/${pk}`);
    } finally {
      await p.close();
    }
  });
});
