import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  DEFAULT_POOL_MAX,
  DbConfigError,
  closeDb,
  createDb,
  parsePoolMax,
  parseSslSetting,
  parseUrlSslMode,
  resolveDbConnection,
} from '../src/index';

const LOCAL = 'postgres://skirm:skirm@localhost:5432/skirm';
const POOLER =
  'postgresql://postgres.abcdefghijklmnopqrst:p%40ss%3Aw0rd@aws-0-us-east-1.pooler.supabase.com:5432/postgres';
const PEM = '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n';

describe('resolveDbConnection', () => {
  it('local Docker URL: no TLS, URL unchanged, default pool size', () => {
    const c = resolveDbConnection(LOCAL, {});
    expect(c).toEqual({ connectionString: LOCAL, sslMode: 'disable', ssl: false, max: DEFAULT_POOL_MAX });
  });

  it('sslmode=require (Supabase pooler): encrypts without CA check, strips the parameter', () => {
    const c = resolveDbConnection(`${POOLER}?sslmode=require`, {});
    expect(c.sslMode).toBe('require');
    expect(c.ssl).toEqual({ rejectUnauthorized: false });
    // Stripped so node-postgres does not turn it back into verify-full; the password stays encoded.
    expect(c.connectionString).toBe(POOLER);
  });

  it('keeps unrelated query parameters', () => {
    const c = resolveDbConnection(`${POOLER}?application_name=skirm&sslmode=require&options=-c%20x%3D1`, {});
    expect(c.connectionString).toBe(`${POOLER}?application_name=skirm&options=-c+x%3D1`);
  });

  it('require with DATABASE_SSL_CA checks the chain but not the host name', () => {
    const c = resolveDbConnection(`${POOLER}?sslmode=require`, { DATABASE_SSL_CA: PEM });
    expect(c.ssl).toMatchObject({ ca: PEM.trim() });
    const ssl = c.ssl as { checkServerIdentity?: () => unknown; rejectUnauthorized?: boolean };
    expect(ssl.rejectUnauthorized).toBeUndefined();
    expect(ssl.checkServerIdentity?.()).toBeUndefined();
  });

  it('verify-full: system roots without a CA, the CA with one', () => {
    expect(resolveDbConnection(`${POOLER}?sslmode=verify-full`, {}).ssl).toEqual({});
    expect(resolveDbConnection(`${POOLER}?sslmode=verify-full`, { DATABASE_SSL_CA: PEM }).ssl).toEqual({
      ca: PEM.trim(),
    });
  });

  it('verify-ca needs a CA', () => {
    expect(() => resolveDbConnection(`${POOLER}?sslmode=verify-ca`, {})).toThrow(DbConfigError);
    const c = resolveDbConnection(`${POOLER}?sslmode=verify-ca`, { DATABASE_SSL_CA: PEM });
    expect(c.sslMode).toBe('verify-ca');
    expect(c.ssl).toMatchObject({ ca: PEM.trim() });
  });

  it('reads sslrootcert from a file and strips it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'skirm-ca-'));
    try {
      const file = join(dir, 'ca.pem');
      writeFileSync(file, PEM);
      const c = resolveDbConnection(
        `${POOLER}?sslmode=verify-full&sslrootcert=${encodeURIComponent(file)}`,
        {},
      );
      expect(c.ssl).toEqual({ ca: PEM });
      expect(c.connectionString).toBe(POOLER);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('DATABASE_SSL turns TLS on for a URL without sslmode, or off over the URL', () => {
    expect(resolveDbConnection(POOLER, { DATABASE_SSL: 'true' }).ssl).toEqual({ rejectUnauthorized: false });
    const off = resolveDbConnection(`${LOCAL}?sslmode=require`, { DATABASE_SSL: 'false' });
    expect(off.ssl).toBe(false);
    expect(off.connectionString).toBe(LOCAL);
    expect(resolveDbConnection(POOLER, { DATABASE_SSL: '' }).ssl).toBe(false);
  });

  it('prefer/allow/disable mean no TLS; ssl=true means require', () => {
    for (const m of ['prefer', 'allow', 'disable'])
      expect(resolveDbConnection(`${LOCAL}?sslmode=${m}`, {}).ssl).toBe(false);
    expect(resolveDbConnection(`${LOCAL}?ssl=true`, {}).sslMode).toBe('require');
  });

  it('rejects client certificates and unknown modes without quoting the URL', () => {
    expect(() => resolveDbConnection(`${POOLER}?sslcert=/x.pem`, {})).toThrow(DbConfigError);
    try {
      resolveDbConnection(`${POOLER}?sslmode=bogus`, {});
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(DbConfigError);
      expect((err as Error).message).not.toContain('p%40ss');
    }
  });

  it('pool size: caller, then DATABASE_POOL_MAX, then the default', () => {
    expect(resolveDbConnection(LOCAL, { DATABASE_POOL_MAX: '8' }).max).toBe(8);
    expect(resolveDbConnection(LOCAL, { DATABASE_POOL_MAX: '8' }, { max: 1 }).max).toBe(1);
    expect(() => resolveDbConnection(LOCAL, { DATABASE_POOL_MAX: '1' })).toThrow(DbConfigError);
  });
});

describe('parsers', () => {
  it('parseUrlSslMode', () => {
    expect(parseUrlSslMode('REQUIRE')).toBe('require');
    expect(parseUrlSslMode('no-verify')).toBe('require');
    expect(() => parseUrlSslMode('yes')).toThrow(DbConfigError);
  });

  it('parseSslSetting', () => {
    expect(parseSslSetting(undefined)).toBeUndefined();
    expect(parseSslSetting(' ')).toBeUndefined();
    expect(parseSslSetting('1')).toBe('require');
    expect(parseSslSetting('off')).toBe('disable');
    expect(parseSslSetting('verify-full')).toBe('verify-full');
    expect(() => parseSslSetting('maybe')).toThrow(/DATABASE_SSL/);
  });

  it('parsePoolMax', () => {
    expect(parsePoolMax(undefined)).toBeUndefined();
    expect(parsePoolMax('')).toBeUndefined();
    expect(parsePoolMax('2')).toBe(2);
    expect(parsePoolMax('100')).toBe(100);
    for (const bad of ['0', '1', '101', '2.5', 'ten']) expect(() => parsePoolMax(bad)).toThrow(DbConfigError);
  });
});

describe('createDb', () => {
  const dbs: ReturnType<typeof createDb>[] = [];
  afterAll(async () => {
    for (const db of dbs) await closeDb(db);
  });

  it('hands the pool the resolved TLS options, size and a URL without sslmode', () => {
    const db = createDb(`${POOLER}?sslmode=require`, { env: { DATABASE_POOL_MAX: '7' } });
    dbs.push(db);
    const opts = (db as unknown as { $client: { options: Record<string, unknown> } }).$client.options;
    expect(opts.ssl).toEqual({ rejectUnauthorized: false });
    expect(opts.max).toBe(7);
    expect(opts.keepAlive).toBe(true);
    expect(opts.connectionString).toBe(POOLER);
  });

  it('throws at creation on a bad setting', () => {
    expect(() => createDb(LOCAL, { env: { DATABASE_SSL: 'nope' } })).toThrow(DbConfigError);
  });
});
