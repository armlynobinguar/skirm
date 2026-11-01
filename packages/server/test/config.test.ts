import { describe, expect, it } from 'vitest';
import { DEFAULTS } from '@skirm/shared';
import { ConfigError, DEV_SKILL_KEK, ENV_DEFAULTS, loadConfig } from '../src/index';

describe('loadConfig', () => {
  it('applies the contract defaults', () => {
    const c = loadConfig({});
    expect(c).toMatchObject({
      DATABASE_URL: 'postgres://skirm:skirm@localhost:5432/skirm',
      REDIS_URL: 'redis://localhost:6379',
      AUTH_MODE: 'dev',
      NEAR_NETWORK: 'testnet',
      NEAR_RPC_URL: 'https://test.rpc.fastnear.com',
      NEAR_CONTRACT_SKILLS: 'skills.playskirm.testnet',
      NEAR_CONTRACT_MARKET: 'market.playskirm.testnet',
      NEAR_CONTRACT_REGISTRY: 'registry.playskirm.testnet',
      NEAR_CONTRACT_DEPOSITS: 'deposits.playskirm.testnet',
      NEAR_CONTRACT_SEASONS: 'seasons.playskirm.testnet',
      CREDITS_PER_NEAR: 1000,
      API_PORT: 4000,
      REALTIME_PORT: 4001,
      PUBLIC_API_URL: 'http://localhost:4000',
      PUBLIC_WS_URL: 'ws://localhost:4001/ws',
      devKek: true,
      nearOpsConfigured: false,
    });
    expect(c.kek.length).toBe(32);
    expect(c.OPENROUTER_API_KEY).toBeUndefined();
    expect(c.nearRpcUrls).toEqual([
      'https://test.rpc.fastnear.com',
      'https://near-testnet.drpc.org',
    ]);
  });

  it('prices NEAR from the shared credit config', () => {
    expect(ENV_DEFAULTS.CREDITS_PER_NEAR).toBe(DEFAULTS.credits.perNear);
    expect(loadConfig({}).CREDITS_PER_NEAR).toBe(DEFAULTS.credits.perNear);
  });

  it('parses overrides; empty strings mean unset', () => {
    const kek = Buffer.alloc(32, 7).toString('base64');
    const c = loadConfig({
      AUTH_MODE: '',
      API_PORT: '5000',
      CREDITS_PER_NEAR: '250',
      SKILL_KEK: kek,
      OPENROUTER_API_KEY: 'k',
      NEAR_OPS_ACCOUNT: 'ops.playskirm.testnet',
      NEAR_OPS_KEY: `ed25519:${'3'.repeat(88)}`,
      OPS_TOKEN: 'o'.repeat(32),
    });
    expect(c).toMatchObject({
      AUTH_MODE: 'dev',
      API_PORT: 5000,
      CREDITS_PER_NEAR: 250,
      OPS_TOKEN: 'o'.repeat(32),
      devKek: false,
      nearOpsConfigured: true,
    });
    expect(c.OPENROUTER_API_KEY).toBe('k');
    expect(Buffer.from(c.kek).equals(Buffer.alloc(32, 7))).toBe(true);
  });

  it('rejects bad values without echoing them', () => {
    const secret = 'c2VjcmV0LXNob3J0';
    try {
      loadConfig({
        AUTH_MODE: 'privy',
        SKILL_KEK: secret,
        API_PORT: 'x',
        NEAR_OPS_ACCOUNT: 'ops.testnet',
      });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError);
      const e = err as ConfigError;
      const paths = e.issues.map((i) => i.path);
      expect(paths).toEqual(expect.arrayContaining(['SKILL_KEK', 'API_PORT']));
      expect(e.message).not.toContain(secret);
    }
    try {
      loadConfig({ AUTH_MODE: 'privy', NEAR_OPS_ACCOUNT: 'ops.testnet' });
      expect.unreachable();
    } catch (err) {
      expect((err as ConfigError).issues.map((i) => i.path)).toEqual(
        expect.arrayContaining(['PRIVY_APP_ID', 'PRIVY_VERIFICATION_KEY', 'NEAR_OPS_KEY']),
      );
    }
    expect(() =>
      loadConfig({ NEAR_OPS_ACCOUNT: 'ops.testnet', NEAR_OPS_KEY: 'ed25519:short' }),
    ).toThrow(ConfigError);
    expect(() => loadConfig({ NEAR_CONTRACT_SEASONS: 'Seasons!' })).toThrow(ConfigError);
    expect(() => loadConfig({ DATABASE_URL: 'mysql://x' })).toThrow(ConfigError);
    expect(() => loadConfig({ OPS_TOKEN: 'too-short' })).toThrow(ConfigError);
    expect(DEV_SKILL_KEK).toBe(Buffer.from('skirm-dev-kek-not-for-production').toString('base64'));
  });
});
