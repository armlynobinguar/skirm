import { SignJWT, exportSPKI, generateKeyPair } from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  AuthError,
  handleFromPrivyDid,
  loadConfig,
  verifyCredentials,
  verifyRequestUser,
  type ServerConfig,
} from '../src/index';

describe('auth: dev', () => {
  const config = loadConfig({});
  it('trusts x-dev-user', async () => {
    expect(await verifyRequestUser(config, { 'x-dev-user': 'Ana' })).toEqual({ handle: 'ana' });
    expect(await verifyRequestUser(config, new Headers({ 'X-Dev-User': 'judge-1' }))).toEqual({
      handle: 'judge-1',
    });
    expect(await verifyCredentials(config, { devUser: 'ben' })).toEqual({ handle: 'ben' });
  });
  it('refuses missing or malformed handles', async () => {
    await expect(verifyRequestUser(config, {})).rejects.toBeInstanceOf(AuthError);
    await expect(verifyRequestUser(config, { 'x-dev-user': 'a' })).rejects.toBeInstanceOf(
      AuthError,
    );
    await expect(verifyRequestUser(config, { 'x-dev-user': '@skirm' })).rejects.toBeInstanceOf(
      AuthError,
    );
    await expect(
      verifyRequestUser(config, { 'x-dev-user': 'x'.repeat(40) }),
    ).rejects.toBeInstanceOf(AuthError);
  });
});

describe('auth: privy', () => {
  let config: ServerConfig;
  let sign: (claims: {
    aud?: string;
    iss?: string;
    sub?: string;
    exp?: string | number;
  }) => Promise<string>;
  let otherKeyToken: string;

  beforeAll(async () => {
    const { publicKey, privateKey } = await generateKeyPair('ES256');
    const pem = await exportSPKI(publicKey);
    config = loadConfig({
      AUTH_MODE: 'privy',
      PRIVY_APP_ID: 'app-123',
      PRIVY_VERIFICATION_KEY: pem.replace(/\n/g, '\\n'),
    });
    sign = (c) =>
      new SignJWT({ sid: 's1' })
        .setProtectedHeader({ alg: 'ES256', typ: 'JWT' })
        .setIssuer(c.iss ?? 'privy.io')
        .setAudience(c.aud ?? 'app-123')
        .setSubject(c.sub ?? 'did:privy:cm1abcDEF123')
        .setIssuedAt()
        .setExpirationTime(c.exp ?? '1h')
        .sign(privateKey);
    const other = await generateKeyPair('ES256');
    otherKeyToken = await new SignJWT({})
      .setProtectedHeader({ alg: 'ES256' })
      .setIssuer('privy.io')
      .setAudience('app-123')
      .setSubject('did:privy:x')
      .setExpirationTime('1h')
      .sign(other.privateKey);
  });

  it('verifies a signed token', async () => {
    const token = await sign({});
    expect(await verifyRequestUser(config, { authorization: `Bearer ${token}` })).toEqual({
      handle: 'p_cm1abcdef123',
      privyDid: 'did:privy:cm1abcDEF123',
    });
    expect(await verifyCredentials(config, { token })).toMatchObject({
      privyDid: 'did:privy:cm1abcDEF123',
    });
  });

  it('refuses wrong audience, issuer, key, expired or missing tokens', async () => {
    await expect(
      verifyRequestUser(config, { authorization: `Bearer ${await sign({ aud: 'other' })}` }),
    ).rejects.toBeInstanceOf(AuthError);
    await expect(
      verifyRequestUser(config, { authorization: `Bearer ${await sign({ iss: 'evil.io' })}` }),
    ).rejects.toBeInstanceOf(AuthError);
    await expect(
      verifyRequestUser(config, { authorization: `Bearer ${otherKeyToken}` }),
    ).rejects.toBeInstanceOf(AuthError);
    await expect(
      verifyRequestUser(config, {
        authorization: `Bearer ${await sign({ exp: Math.floor(Date.parse('2020-01-01T00:00:00Z') / 1000) })}`,
      }),
    ).rejects.toBeInstanceOf(AuthError);
    await expect(verifyRequestUser(config, {})).rejects.toBeInstanceOf(AuthError);
    await expect(verifyRequestUser(config, { 'x-dev-user': 'ana' })).rejects.toBeInstanceOf(
      AuthError,
    );
    await expect(
      verifyRequestUser(config, { authorization: 'Bearer not.a.jwt' }),
    ).rejects.toBeInstanceOf(AuthError);
  });

  it('derives handles from DIDs', () => {
    expect(handleFromPrivyDid('did:privy:' + 'a'.repeat(40))).toBe('p_' + 'a'.repeat(30));
    expect(() => handleFromPrivyDid('did:privy:')).toThrow(AuthError);
  });
});
