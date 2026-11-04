// Outbound calls to players' webhooks, made safe against server-side request forgery: https only,
// no credentials in the URL, every address the name resolves to must be public (no private,
// loopback, link-local, CGNAT, multicast or reserved ranges, IPv4-mapped IPv6 included), and the
// socket connects to the address that was checked (the lookup is pinned, so a DNS answer that
// changes between the check and the connect cannot reach an internal host). Redirects are never
// followed, the reply is cut at a byte limit and the whole call has a deadline.
import { lookup as dnsLookup } from 'node:dns';
import { request as httpsRequest, type RequestOptions } from 'node:https';
import type { ClientRequest, IncomingMessage } from 'node:http';
import { BlockList, isIP, type LookupFunction } from 'node:net';

export class ExternalHttpError extends Error {
  constructor(
    readonly code: 'invalid_url' | 'blocked_address' | 'dns_failed' | 'timeout' | 'too_large' | 'bad_status' | 'network',
    message: string,
  ) {
    super(message);
    this.name = 'ExternalHttpError';
  }
}

const blocked = new BlockList();
for (const [net, prefix] of [
  ['0.0.0.0', 8], // "this" network
  ['10.0.0.0', 8],
  ['100.64.0.0', 10], // CGNAT
  ['127.0.0.0', 8],
  ['169.254.0.0', 16], // link-local, cloud metadata
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved, broadcast
] as const)
  blocked.addSubnet(net, prefix, 'ipv4');
for (const [net, prefix] of [
  ['::', 128], // unspecified
  ['::1', 128], // loopback
  ['64:ff9b:1::', 48], // local-use NAT64
  ['100::', 64], // discard
  ['2001::', 23], // IETF protocol assignments (Teredo, ORCHID…)
  ['2001:db8::', 32], // documentation
  ['2002::', 16], // 6to4 (can embed any IPv4)
  ['fc00::', 7], // unique local
  ['fe80::', 10], // link-local
  ['fec0::', 10], // site-local (deprecated)
  ['ff00::', 8], // multicast
] as const)
  blocked.addSubnet(net, prefix, 'ipv6');

/** The IPv4 address inside an IPv4-mapped (::ffff:a.b.c.d), IPv4-compatible or NAT64 IPv6 address. */
function embeddedIPv4(ip: string): string | null {
  const lower = ip.toLowerCase();
  const dotted = /^(?:::ffff:|::|64:ff9b::)(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
  if (dotted) return dotted[1]!;
  const hex = /^(?:::ffff:|64:ff9b::)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(lower);
  if (hex) {
    const hi = parseInt(hex[1]!, 16);
    const lo = parseInt(hex[2]!, 16);
    return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
  }
  return null;
}

/** True for any address a webhook must never reach (and for anything that is not an IP at all). */
export function isBlockedAddress(ip: string): boolean {
  const bare = ip.replace(/^\[|\]$/g, '').split('%')[0]!;
  const v = isIP(bare);
  if (v === 4) return blocked.check(bare, 'ipv4');
  if (v === 6) {
    const v4 = embeddedIPv4(bare);
    if (v4 && isIP(v4) === 4) return true; // mapped/compatible/NAT64 forms are never needed for a public webhook
    return blocked.check(bare, 'ipv6');
  }
  return true;
}

const MAX_URL_LENGTH = 2048;

/**
 * A webhook URL as it is stored: https, a host name or public IP literal, no user:password, no
 * fragment, at most 2 KiB. Throws ExternalHttpError('invalid_url' | 'blocked_address').
 */
export function checkWebhookUrl(raw: string): URL {
  if (typeof raw !== 'string' || raw.length > MAX_URL_LENGTH) throw new ExternalHttpError('invalid_url', 'the webhook URL is too long');
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new ExternalHttpError('invalid_url', 'the webhook URL is not a URL');
  }
  if (u.protocol !== 'https:') throw new ExternalHttpError('invalid_url', 'the webhook URL must use https');
  if (u.username || u.password) throw new ExternalHttpError('invalid_url', 'the webhook URL must not carry credentials');
  if (u.hash) throw new ExternalHttpError('invalid_url', 'the webhook URL must not have a fragment');
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!host) throw new ExternalHttpError('invalid_url', 'the webhook URL needs a host');
  if (isIP(host)) {
    if (isBlockedAddress(host)) throw new ExternalHttpError('blocked_address', 'the webhook URL points at a private or reserved address');
  } else if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') || !host.includes('.')) {
    throw new ExternalHttpError('blocked_address', 'the webhook URL must name a public host');
  }
  return u;
}

export type Resolver = (host: string) => Promise<{ address: string; family: number }[]>;

export const systemResolver: Resolver = (host) =>
  new Promise((resolve, reject) =>
    dnsLookup(host, { all: true, verbatim: true }, (err, addrs) => (err ? reject(err) : resolve(addrs))),
  );

/**
 * Every address `host` resolves to, when all of them are public; the first is the one to connect to.
 * One private answer refuses the whole name (a split answer is a classic rebinding trick).
 */
export async function resolvePublic(host: string, resolver: Resolver = systemResolver, isBlocked: (ip: string) => boolean = isBlockedAddress): Promise<{ address: string; family: number }> {
  const bare = host.replace(/^\[|\]$/g, '');
  if (isIP(bare)) {
    if (isBlocked(bare)) throw new ExternalHttpError('blocked_address', 'the webhook resolves to a private or reserved address');
    return { address: bare, family: isIP(bare) };
  }
  let addrs: { address: string; family: number }[];
  try {
    addrs = await resolver(bare);
  } catch {
    throw new ExternalHttpError('dns_failed', 'the webhook host did not resolve');
  }
  if (!addrs.length) throw new ExternalHttpError('dns_failed', 'the webhook host did not resolve');
  if (addrs.some((a) => isBlocked(a.address))) throw new ExternalHttpError('blocked_address', 'the webhook resolves to a private or reserved address');
  return addrs[0]!;
}

export interface SafePostOptions {
  timeoutMs: number;
  maxBytes: number;
  headers?: Record<string, string>;
  resolver?: Resolver;
  /** Tests only: the address policy (default isBlockedAddress). */
  isBlocked?: (ip: string) => boolean;
  /** Tests only: the transport (default https.request); the URL check still requires https. */
  request?: (opts: RequestOptions, cb: (res: IncomingMessage) => void) => ClientRequest;
  signal?: AbortSignal;
}

export interface SafePostResult {
  status: number;
  body: string;
  latencyMs: number;
}

/**
 * POSTs `body` (JSON text) to a checked webhook URL. Resolves with a 2xx reply's text; throws
 * ExternalHttpError for a bad URL, a private address, DNS failure, timeout, a reply over
 * `maxBytes`, a non-2xx status (redirects included: they are never followed) or a network error.
 */
export async function safePostJson(url: string, body: string, opts: SafePostOptions): Promise<SafePostResult> {
  const started = Date.now();
  const u = checkWebhookUrl(url);
  const isBlocked = opts.isBlocked ?? isBlockedAddress;
  const resolver = opts.resolver ?? systemResolver;
  const deadline = started + opts.timeoutMs;
  const target = await withDeadline(resolvePublic(u.hostname, resolver, isBlocked), deadline);
  // The socket connects to the address checked above, whatever DNS says by then; TLS still checks
  // the certificate against the host name.
  const pinned: LookupFunction = (_host, options, cb) => {
    if ((options as { all?: boolean }).all) (cb as unknown as (e: null, a: { address: string; family: number }[]) => void)(null, [target]);
    else cb(null, target.address, target.family);
  };
  const send = opts.request ?? httpsRequest;
  return new Promise<SafePostResult>((resolve, reject) => {
    let done = false;
    const fail = (e: ExternalHttpError) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      req.destroy();
      reject(e);
    };
    const left = Math.max(1, deadline - Date.now());
    const timer = setTimeout(() => fail(new ExternalHttpError('timeout', `no reply within ${opts.timeoutMs} ms`)), left);
    const req = send(
      {
        protocol: u.protocol,
        hostname: u.hostname.replace(/^\[|\]$/g, ''),
        port: u.port || undefined,
        path: `${u.pathname}${u.search}`,
        method: 'POST',
        lookup: pinned,
        headers: { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(body)), 'user-agent': 'skirm-agent-relay/1', ...opts.headers },
        agent: false,
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status < 200 || status >= 300) {
          res.resume();
          return fail(new ExternalHttpError('bad_status', `the webhook answered ${status}`));
        }
        const declared = Number(res.headers['content-length']);
        if (Number.isFinite(declared) && declared > opts.maxBytes) return fail(new ExternalHttpError('too_large', `the reply is over ${opts.maxBytes} bytes`));
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (c: Buffer) => {
          size += c.length;
          if (size > opts.maxBytes) return fail(new ExternalHttpError('too_large', `the reply is over ${opts.maxBytes} bytes`));
          chunks.push(c);
        });
        res.on('end', () => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          resolve({ status, body: Buffer.concat(chunks).toString('utf8'), latencyMs: Date.now() - started });
        });
        res.on('error', () => fail(new ExternalHttpError('network', 'the reply broke off')));
      },
    );
    req.on('error', (e: Error) => fail(e instanceof ExternalHttpError ? e : new ExternalHttpError('network', 'the webhook could not be reached')));
    opts.signal?.addEventListener('abort', () => fail(new ExternalHttpError('timeout', 'cancelled')), { once: true });
    req.end(body);
  });
}

function withDeadline<T>(p: Promise<T>, deadline: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new ExternalHttpError('timeout', 'the webhook host did not resolve in time')), Math.max(1, deadline - Date.now()));
    p.then(
      (v) => (clearTimeout(t), resolve(v)),
      (e: unknown) => (clearTimeout(t), reject(e)),
    );
  });
}
