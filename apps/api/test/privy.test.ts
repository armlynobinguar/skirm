// AUTH_MODE=privy end to end: ES256 Privy tokens (iss, aud, exp, alg pinned) and NEAR linking with
// a wallet's NEP-413 `signMessage` proof.
import { generateKeyPairSync } from 'node:crypto';
import { SignJWT, importPKCS8 } from 'jose';
import { KeyPair, KeyPairSigner } from 'near-api-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { linkMessage } from '../src/near-link';
import { setup, type Harness } from './helpers';

const APP = 'privy-app-1';
const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const pem = publicKey.export({ format: 'pem', type: 'spki' }).toString();
const fullAccess = new Set<string>();
let h: Harness;

async function token(
  sub: string,
  o: { aud?: string; iss?: string; exp?: number | string } = {},
): Promise<string> {
  const key = await importPKCS8(
    privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(),
    'ES256',
  );
  return new SignJWT({})
    .setProtectedHeader({ alg: 'ES256' })
    .setSubject(sub)
    .setIssuer(o.iss ?? 'privy.io')
    .setAudience(o.aud ?? APP)
    .setIssuedAt()
    .setExpirationTime(o.exp ?? '1h')
    .sign(key);
}

beforeAll(async () => {
  h = await setup({
    config: { AUTH_MODE: 'privy', PRIVY_APP_ID: APP, PRIVY_VERIFICATION_KEY: pem },
    nearKeys: { isFullAccessKey: async (acc, key) => fullAccess.has(`${acc}/${key}`) },
  });
});
afterAll(() => h.close());

describe('privy mode', () => {
  it('signs in with a valid token and refuses expired, foreign or unsigned ones', async () => {
    const t = await token('did:privy:alice01');
    const s = await h.http().post('/auth/session').send({ token: t });
    expect(s.status).toBe(200);
    expect(s.body.account.handle).toBe('p_alice01');
    const me = await h.http().get('/me').set('authorization', `Bearer ${t}`);
    expect(me.status).toBe(200);
    expect(me.body.account.id).toBe(s.body.account.id);

    const bad = [
      await token('did:privy:alice01', { exp: Math.floor(Date.now() / 1000) - 60 }),
      await token('did:privy:alice01', { aud: 'other-app' }),
      await token('did:privy:alice01', { iss: 'evil.io' }),
      // alg none
      `${Buffer.from('{"alg":"none"}').toString('base64url')}.${Buffer.from(
        JSON.stringify({ sub: 'did:privy:alice01', iss: 'privy.io', aud: APP }),
      ).toString('base64url')}.`,
    ];
    for (const b of bad) {
      expect((await h.http().get('/me').set('authorization', `Bearer ${b}`)).status).toBe(401);
      expect((await h.http().post('/auth/session').send({ token: b })).status).toBe(401);
    }
    // Dev headers mean nothing here.
    expect((await h.http().get('/me').set('x-dev-user', 'p_alice01')).status).toBe(401);
  });

  it('links a NEAR account with a NEP-413 wallet signature', async () => {
    const t = await token('did:privy:bob02');
    const { account } = (await h.http().post('/auth/session').send({ token: t })).body;
    const kp = KeyPair.fromRandom('ed25519');
    const pk = kp.getPublicKey().toString();
    const nonce = new Uint8Array(32).map((_, i) => i * 7);
    const near = 'bob02.testnet';
    const signed = await new KeyPairSigner(kp).signNep413Message(near, {
      message: linkMessage(account.id, near),
      recipient: 'skirm',
      nonce,
    });
    const proof = {
      publicKey: pk,
      signature: Buffer.from(signed.signature).toString('base64'),
      nonce: Buffer.from(nonce).toString('base64'),
      recipient: 'skirm',
    };
    const link = (p: object) =>
      h.http().post('/auth/session').send({ token: t, nearAccountId: near, nearProof: p });
    // Not a full-access key yet.
    expect((await link(proof)).body.error.code).toBe('near_proof_invalid');
    fullAccess.add(`${near}/${pk}`);
    // Tampered envelope fields fail the signature.
    expect((await link({ ...proof, recipient: 'other' })).body.error.code).toBe(
      'near_proof_invalid',
    );
    const { recipient: _r, ...noRecipient } = proof;
    void _r;
    expect((await link(noRecipient)).status).toBe(422);
    const ok = await link(proof);
    expect(ok.status).toBe(200);
    expect(ok.body.account.nearAccountId).toBe(near);
  });
});
