// Request auth (contract: AUTH_MODE dev trusts `x-dev-user`; privy verifies the Privy JWT, ES256,
// aud = PRIVY_APP_ID, iss = privy.io).
import { importSPKI, jwtVerify, type KeyLike } from 'jose';
import type { ServerConfig } from './config';

export interface RequestUser {
  /** Account handle: the dev user name, or `p_<privy id>` for Privy users. */
  handle: string;
  privyDid?: string;
}

export class AuthError extends Error {
  readonly code = 'unauthenticated';
  constructor(message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

export type HeaderBag = Record<string, string | string[] | undefined> | Headers;

const DEV_HANDLE_RE = /^[a-z0-9][a-z0-9_.-]{1,31}$/;

export const PRIVY_ISSUER = 'privy.io';

function header(headers: HeaderBag, name: string): string | undefined {
  if (typeof (headers as Headers).get === 'function')
    return (headers as Headers).get(name) ?? undefined;
  const bag = headers as Record<string, string | string[] | undefined>;
  const v =
    bag[name] ??
    bag[name.toLowerCase()] ??
    Object.entries(bag).find(([k]) => k.toLowerCase() === name)?.[1];
  return Array.isArray(v) ? v[0] : v;
}

/** Dev handles: 2–32 chars, lower-case letters, digits, `_`, `.`, `-`. */
export function normaliseDevHandle(raw: string): string {
  const h = raw.trim().toLowerCase();
  if (!DEV_HANDLE_RE.test(h))
    throw new AuthError('x-dev-user must be 2-32 characters: a-z, 0-9, _ . -');
  return h;
}

/** `did:privy:cm1abc…` → `p_cm1abc…` (lower-case, ≤ 32 chars). */
export function handleFromPrivyDid(did: string): string {
  const id = did
    .replace(/^did:privy:/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
  if (!id) throw new AuthError('token subject is not a Privy DID');
  return `p_${id.slice(0, 30)}`;
}

const keyCache = new Map<string, Promise<KeyLike>>();
function verificationKey(pem: string): Promise<KeyLike> {
  let k = keyCache.get(pem);
  if (!k) {
    // .env files often carry the PEM on one line with literal \n.
    k = importSPKI(pem.replace(/\\n/g, '\n').trim(), 'ES256') as Promise<KeyLike>;
    keyCache.set(pem, k);
    k.catch(() => keyCache.delete(pem));
  }
  return k;
}

/** Verifies a Privy access token. */
export async function verifyPrivyToken(
  config: Pick<ServerConfig, 'PRIVY_APP_ID' | 'PRIVY_VERIFICATION_KEY'>,
  token: string,
): Promise<RequestUser> {
  if (!config.PRIVY_APP_ID || !config.PRIVY_VERIFICATION_KEY)
    throw new AuthError('privy auth is not configured');
  let key: KeyLike;
  try {
    key = await verificationKey(config.PRIVY_VERIFICATION_KEY);
  } catch {
    throw new AuthError('privy verification key is invalid');
  }
  try {
    const { payload } = await jwtVerify(token, key, {
      issuer: PRIVY_ISSUER,
      audience: config.PRIVY_APP_ID,
      algorithms: ['ES256'],
    });
    if (typeof payload.sub !== 'string' || !payload.sub)
      throw new AuthError('token has no subject');
    return { handle: handleFromPrivyDid(payload.sub), privyDid: payload.sub };
  } catch (err) {
    if (err instanceof AuthError) throw err;
    throw new AuthError('invalid or expired token');
  }
}

/** Credentials as the WebSocket `auth` message or POST /auth/session body carries them. */
export async function verifyCredentials(
  config: Pick<ServerConfig, 'AUTH_MODE' | 'PRIVY_APP_ID' | 'PRIVY_VERIFICATION_KEY'>,
  creds: { token?: string | null; devUser?: string | null },
): Promise<RequestUser> {
  if (config.AUTH_MODE === 'dev') {
    if (!creds.devUser) throw new AuthError('missing x-dev-user');
    return { handle: normaliseDevHandle(creds.devUser) };
  }
  if (!creds.token) throw new AuthError('missing bearer token');
  return verifyPrivyToken(config, creds.token);
}

/**
 * HTTP: dev mode reads `x-dev-user`; privy mode reads `Authorization: Bearer <jwt>`.
 * Throws AuthError (map it to 401).
 */
export async function verifyRequestUser(
  config: Pick<ServerConfig, 'AUTH_MODE' | 'PRIVY_APP_ID' | 'PRIVY_VERIFICATION_KEY'>,
  headers: HeaderBag,
): Promise<RequestUser> {
  if (config.AUTH_MODE === 'dev')
    return verifyCredentials(config, { devUser: header(headers, 'x-dev-user') });
  const auth = header(headers, 'authorization');
  const m = auth?.match(/^Bearer\s+(.+)$/i);
  return verifyCredentials(config, { token: m?.[1]?.trim() });
}
