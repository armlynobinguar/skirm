// Turns DATABASE_URL (+ DATABASE_SSL, DATABASE_SSL_CA, DATABASE_POOL_MAX) into node-postgres pool
// settings. Local Docker Postgres has no TLS, so TLS is off unless the URL or env asks for it.
// Supabase: the Supavisor session pooler URL with `?sslmode=require` (docs/deploy.md, Database).
import { readFileSync } from 'node:fs';
import type { ConnectionOptions } from 'node:tls';

/**
 * libpq's meanings: `require` encrypts without checking the server certificate (unless a CA is
 * given, then it checks the chain like `verify-ca`); `verify-ca` checks the chain against the CA;
 * `verify-full` also checks the host name (against DATABASE_SSL_CA, or the system roots without one).
 */
export type DbSslMode = 'disable' | 'require' | 'verify-ca' | 'verify-full';

/** Per-process pool size when neither the caller nor DATABASE_POOL_MAX sets one. */
export const DEFAULT_POOL_MAX = 5;
/** Highest DATABASE_POOL_MAX accepted (a pooler caps connections well below this). */
export const POOL_MAX_LIMIT = 100;

export interface DbConnectionSettings {
  /** DATABASE_URL without its TLS parameters (node-postgres would let them override `ssl`). */
  connectionString: string;
  sslMode: DbSslMode;
  /** node-postgres `ssl`: false, or the TLS options. */
  ssl: false | ConnectionOptions;
  max: number;
}

export class DbConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DbConfigError';
  }
}

/** URL query parameters about TLS. node-postgres reads them and they win over the `ssl` option. */
const TLS_PARAMS = ['sslmode', 'ssl', 'sslrootcert', 'sslcert', 'sslkey', 'uselibpqcompat', 'sslnegotiation'];

/**
 * A `sslmode` URL value (libpq's names, plus node-postgres' `no-verify`) as one of ours. `allow`
 * and `prefer` mean "TLS if the server offers it", which node-postgres cannot do: they map to
 * `disable`, like a URL without `sslmode`. Unknown values throw.
 */
export function parseUrlSslMode(value: string): DbSslMode {
  switch (value.trim().toLowerCase()) {
    case 'disable':
    case 'allow':
    case 'prefer':
      return 'disable';
    case 'require':
    case 'no-verify':
      return 'require';
    case 'verify-ca':
      return 'verify-ca';
    case 'verify-full':
      return 'verify-full';
    default:
      throw new DbConfigError(
        `DATABASE_URL sslmode must be disable, allow, prefer, require, no-verify, verify-ca or verify-full`,
      );
  }
}

/**
 * DATABASE_SSL (or the URL's `ssl` parameter): off (`false`, `0`, `off`, `disable`), on
 * (`true`, `1`, `on`, `require`), `verify-ca` or `verify-full`. Empty means unset.
 */
export function parseSslSetting(value: string | undefined, name = 'DATABASE_SSL'): DbSslMode | undefined {
  if (value === undefined || value.trim() === '') return undefined;
  switch (value.trim().toLowerCase()) {
    case 'false':
    case '0':
    case 'off':
    case 'disable':
      return 'disable';
    case 'true':
    case '1':
    case 'on':
    case 'require':
      return 'require';
    case 'verify-ca':
      return 'verify-ca';
    case 'verify-full':
      return 'verify-full';
    default:
      throw new DbConfigError(`${name} must be true, false, require, verify-ca or verify-full`);
  }
}

/**
 * DATABASE_POOL_MAX: a whole number from 2 to POOL_MAX_LIMIT. Empty means unset. At least 2,
 * because `withAdvisoryLock` holds one connection while the locked work queries on another.
 */
export function parsePoolMax(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === '') return undefined;
  const n = Number(value.trim());
  if (!Number.isInteger(n) || n < 2 || n > POOL_MAX_LIMIT)
    throw new DbConfigError(`DATABASE_POOL_MAX must be a whole number from 2 to ${POOL_MAX_LIMIT}`);
  return n;
}

/** Splits `url` at its query string, without parsing the rest (passwords may hold any character). */
function splitQuery(url: string): { base: string; params: URLSearchParams; hash: string } {
  const hashAt = url.indexOf('#', url.lastIndexOf('@') + 1);
  const hash = hashAt >= 0 ? url.slice(hashAt) : '';
  const noHash = hashAt >= 0 ? url.slice(0, hashAt) : url;
  const q = noHash.indexOf('?', noHash.lastIndexOf('@') + 1);
  if (q < 0) return { base: noHash, params: new URLSearchParams(), hash };
  return { base: noHash.slice(0, q), params: new URLSearchParams(noHash.slice(q + 1)), hash };
}

/**
 * Pool settings for `url`. TLS: DATABASE_SSL wins over the URL's `sslmode` (or `ssl`); neither set
 * means no TLS. The CA is DATABASE_SSL_CA (PEM text) or the URL's `sslrootcert` (a file path).
 * Pool size: `opts.max`, else DATABASE_POOL_MAX, else DEFAULT_POOL_MAX. Errors never quote the URL.
 */
export function resolveDbConnection(
  url: string,
  env: Record<string, string | undefined> = process.env,
  opts: { max?: number } = {},
): DbConnectionSettings {
  const { base, params, hash } = splitQuery(url);
  if (params.has('sslcert') || params.has('sslkey'))
    throw new DbConfigError('DATABASE_URL sslcert/sslkey (client certificates) are not supported');

  const urlMode = params.has('sslmode')
    ? parseUrlSslMode(params.get('sslmode') ?? '')
    : parseSslSetting(params.get('ssl') ?? undefined, 'DATABASE_URL ssl');
  const sslMode = parseSslSetting(env.DATABASE_SSL) ?? urlMode ?? 'disable';

  const caPem = env.DATABASE_SSL_CA?.trim() || undefined;
  const caFile = params.get('sslrootcert') ?? undefined;
  let ca: string | undefined = caPem;
  if (!ca && caFile && caFile !== 'system' && sslMode !== 'disable') {
    try {
      ca = readFileSync(caFile, 'utf8');
    } catch {
      throw new DbConfigError('DATABASE_URL sslrootcert: cannot read the CA file');
    }
  }

  let ssl: false | ConnectionOptions;
  switch (sslMode) {
    case 'disable':
      ssl = false;
      break;
    case 'require':
      ssl = ca ? { ca, checkServerIdentity: () => undefined } : { rejectUnauthorized: false };
      break;
    case 'verify-ca':
      if (!ca) throw new DbConfigError('sslmode verify-ca needs a CA: set DATABASE_SSL_CA or sslrootcert');
      ssl = { ca, checkServerIdentity: () => undefined };
      break;
    case 'verify-full':
      ssl = ca ? { ca } : {};
      break;
  }

  for (const p of TLS_PARAMS) params.delete(p);
  const query = params.toString();
  const connectionString = `${base}${query ? `?${query}` : ''}${hash}`;

  const max = opts.max ?? parsePoolMax(env.DATABASE_POOL_MAX) ?? DEFAULT_POOL_MAX;
  return { connectionString, sslMode, ssl, max };
}
