import { createServer, request as httpRequest, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import type { Action } from '@skirm/engine/v2';
import {
  ExternalHttpError,
  MemoryExternalTurnStore,
  checkWebhookUrl,
  externalAgentToken,
  externalSecretMatches,
  externalSecretSha256,
  isBlockedAddress,
  newExternalSecret,
  parseExternalAgentToken,
  parseExternalReply,
  resolvePublic,
  safePostJson,
  signExternalBody,
  verifyExternalSignature,
  type ExternalTurn,
} from '../src/index';

describe('external agent secrets and tokens', () => {
  it('makes 256-bit secrets and tokens that parse back', () => {
    const s = newExternalSecret();
    expect(s).toMatch(/^sks_[A-Za-z0-9_-]{43}$/);
    expect(newExternalSecret()).not.toBe(s);
    const id = 'ext_01J9Z8Y7X6W5V4T3S2R1Q0P9N8';
    expect(parseExternalAgentToken(externalAgentToken(id, s))).toEqual({ id, secret: s });
    expect(parseExternalAgentToken(`${id}.nope`)).toBeNull();
    expect(parseExternalAgentToken(s)).toBeNull();
  });

  it('checks a secret against its stored hash only', () => {
    const s = newExternalSecret();
    const sha = externalSecretSha256(s);
    expect(externalSecretMatches(s, sha)).toBe(true);
    expect(externalSecretMatches(newExternalSecret(), sha)).toBe(false);
    expect(externalSecretMatches(s, '')).toBe(false);
  });
});

describe('webhook signatures', () => {
  const secret = 'sks_test-secret';
  const body = '{"type":"turn","tick":3}';
  const now = 1_790_000_000_000;

  it('signs `<t>.<body>` with HMAC-SHA256 and verifies it', () => {
    const h = signExternalBody(secret, body, now);
    expect(h).toMatch(/^t=1790000000,v1=[0-9a-f]{64}$/);
    expect(verifyExternalSignature(secret, h, body, { nowMs: now })).toBe(true);
  });

  it('refuses another body, another secret, a stale timestamp and junk headers', () => {
    const h = signExternalBody(secret, body, now);
    expect(verifyExternalSignature(secret, h, `${body} `, { nowMs: now })).toBe(false);
    expect(verifyExternalSignature('sks_other', h, body, { nowMs: now })).toBe(false);
    expect(verifyExternalSignature(secret, h, body, { nowMs: now + 301_000 })).toBe(false);
    expect(verifyExternalSignature(secret, h, body, { nowMs: now + 299_000 })).toBe(true);
    for (const bad of [undefined, '', 't=1', 'v1=abc', `t=x,v1=${'0'.repeat(64)}`, h.replace(/v1=./, 'v1=g')]) expect(verifyExternalSignature(secret, bad, body, { nowMs: now })).toBe(false);
  });
});

describe('SSRF guard', () => {
  it('blocks private, loopback, link-local, CGNAT, reserved and multicast addresses', () => {
    for (const ip of [
      '127.0.0.1',
      '10.1.2.3',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.1.1',
      '169.254.169.254',
      '100.64.0.1',
      '0.0.0.0',
      '224.0.0.1',
      '255.255.255.255',
      '198.18.0.1',
      '::1',
      '::',
      'fe80::1',
      'fc00::1',
      'fd12:3456::1',
      'ff02::1',
      '::ffff:127.0.0.1',
      '::ffff:7f00:1',
      '::ffff:169.254.169.254',
      '64:ff9b::a9fe:a9fe',
      '2002:7f00:1::',
      '[::1]',
      'not-an-ip',
    ])
      expect(isBlockedAddress(ip), ip).toBe(true);
  });

  it('lets public addresses through', () => {
    for (const ip of ['1.1.1.1', '8.8.8.8', '172.32.0.1', '100.128.0.1', '2606:4700:4700::1111', '2a00:1450:4001:80b::200e']) expect(isBlockedAddress(ip), ip).toBe(false);
  });

  it('takes https URLs to public hosts only', () => {
    expect(checkWebhookUrl('https://agent.example.com/hook?x=1').hostname).toBe('agent.example.com');
    const refuse = (url: string, code: ExternalHttpError['code']) => {
      try {
        checkWebhookUrl(url);
        throw new Error(`accepted ${url}`);
      } catch (err) {
        expect(err, url).toBeInstanceOf(ExternalHttpError);
        expect((err as ExternalHttpError).code, url).toBe(code);
      }
    };
    refuse('http://agent.example.com/hook', 'invalid_url');
    refuse('ftp://agent.example.com/', 'invalid_url');
    refuse('https://user:pw@agent.example.com/', 'invalid_url');
    refuse('https://agent.example.com/#x', 'invalid_url');
    refuse('not a url', 'invalid_url');
    refuse(`https://agent.example.com/${'a'.repeat(2100)}`, 'invalid_url');
    refuse('https://127.0.0.1/hook', 'blocked_address');
    refuse('https://[::1]/hook', 'blocked_address');
    refuse('https://169.254.169.254/latest/meta-data', 'blocked_address');
    refuse('https://localhost/hook', 'blocked_address');
    refuse('https://metadata.google.internal/', 'blocked_address');
    refuse('https://intranet/', 'blocked_address');
  });

  it('refuses a name when any address it resolves to is private (checked after DNS)', async () => {
    const dns = (answers: string[]) => async () => answers.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));
    await expect(resolvePublic('ok.example.com', dns(['93.184.216.34']))).resolves.toEqual({ address: '93.184.216.34', family: 4 });
    await expect(resolvePublic('rebind.example.com', dns(['93.184.216.34', '10.0.0.5']))).rejects.toMatchObject({ code: 'blocked_address' });
    await expect(resolvePublic('six.example.com', dns(['::ffff:127.0.0.1']))).rejects.toMatchObject({ code: 'blocked_address' });
    await expect(resolvePublic('none.example.com', dns([]))).rejects.toMatchObject({ code: 'dns_failed' });
    await expect(resolvePublic('err.example.com', async () => Promise.reject(new Error('ENOTFOUND')))).rejects.toMatchObject({ code: 'dns_failed' });
  });

  it('never connects when the webhook resolves to a private address', async () => {
    let connected = false;
    await expect(
      safePostJson('https://evil.example.com/hook', '{}', {
        timeoutMs: 500,
        maxBytes: 1024,
        resolver: async () => [{ address: '127.0.0.1', family: 4 }],
        request: () => {
          connected = true;
          throw new Error('should not connect');
        },
      }),
    ).rejects.toMatchObject({ code: 'blocked_address' });
    expect(connected).toBe(false);
    await expect(safePostJson('http://evil.example.com/hook', '{}', { timeoutMs: 500, maxBytes: 1024 })).rejects.toMatchObject({ code: 'invalid_url' });
  });
});

describe('safePostJson against a local server (address policy relaxed for the test)', () => {
  let server: Server | undefined;
  afterEach(() => new Promise<void>((r) => (server ? server.close(() => r()) : r())));

  /** An http server standing in for the webhook; the client still sees an https URL. */
  async function serve(handler: Parameters<typeof createServer>[1]) {
    server = createServer(handler);
    await new Promise<void>((r) => server!.listen(0, '127.0.0.1', () => r()));
    const port = (server.address() as AddressInfo).port;
    const opts = {
      resolver: async () => [{ address: '127.0.0.1', family: 4 }],
      isBlocked: () => false,
      request: ((o: Parameters<typeof httpRequest>[0] & object, cb: never) => httpRequest({ ...o, protocol: 'http:', port }, cb)) as never,
    };
    return { url: 'https://agent.example.com/hook', opts };
  }

  it('posts the body with the headers and reads a 2xx reply, connecting to the checked address', async () => {
    let seen: { body: string; sig?: string; host?: string } | undefined;
    const { url, opts } = await serve((req, res) => {
      let b = '';
      req.on('data', (c: Buffer) => (b += c.toString()));
      req.on('end', () => {
        seen = { body: b, sig: req.headers['x-skirm-signature'] as string, host: req.headers.host };
        res.writeHead(200, { 'content-type': 'application/json' }).end('{"action":{"type":"wait"}}');
      });
    });
    const r = await safePostJson(url, '{"a":1}', { ...opts, timeoutMs: 2000, maxBytes: 1024, headers: { 'x-skirm-signature': 't=1,v1=00' } });
    expect(r).toMatchObject({ status: 200, body: '{"action":{"type":"wait"}}' });
    expect(seen).toMatchObject({ body: '{"a":1}', sig: 't=1,v1=00' });
    expect(seen!.host).toContain('agent.example.com');
  });

  it('cuts a reply over the size limit', async () => {
    const { url, opts } = await serve((_req, res) => {
      res.writeHead(200);
      res.write('x'.repeat(600));
      res.end('y'.repeat(600));
    });
    await expect(safePostJson(url, '{}', { ...opts, timeoutMs: 2000, maxBytes: 1000 })).rejects.toMatchObject({ code: 'too_large' });
  });

  it('gives up at the deadline, and never follows a redirect', async () => {
    const slow = await serve(() => undefined);
    await expect(safePostJson(slow.url, '{}', { ...slow.opts, timeoutMs: 150, maxBytes: 1000 })).rejects.toMatchObject({ code: 'timeout' });
    await new Promise<void>((r) => server!.close(() => r()));
    const redirect = await serve((_req, res) => res.writeHead(302, { location: 'http://169.254.169.254/' }).end());
    await expect(safePostJson(redirect.url, '{}', { ...redirect.opts, timeoutMs: 2000, maxBytes: 1000 })).rejects.toMatchObject({ code: 'bad_status' });
  });
});

describe('external replies', () => {
  const legal: Action[] = [{ type: 'wait' }, { type: 'move', dir: 'N' }, { type: 'verb', verb: 'dig', dir: 'E' }, { type: 'switch' }];

  it('accepts one of the legal actions and hands back the legal entry', () => {
    const r = parseExternalReply({ action: { dir: 'E', verb: 'dig', type: 'verb' } }, legal, false);
    expect(r).toEqual({ ok: true, reply: { action: legal[2] } });
    expect(parseExternalReply({ action: { type: 'move', dir: 'N' } }, legal, false)).toMatchObject({ ok: true });
  });

  it('refuses an illegal or malformed action', () => {
    expect(parseExternalReply({ action: { type: 'move', dir: 'S' } }, legal, false)).toMatchObject({ ok: false });
    expect(parseExternalReply({ action: { type: 'verb', verb: 'dig' } }, legal, false)).toMatchObject({ ok: false });
    expect(parseExternalReply({ action: 'wait' }, legal, false)).toMatchObject({ ok: false });
    expect(parseExternalReply(null, legal, false)).toMatchObject({ ok: false });
    expect(parseExternalReply([], legal, false)).toMatchObject({ ok: false });
  });

  it('keeps a line only when the agent may speak, and cuts the inner voice to 80', () => {
    const say = { channel: 'team', text: '  on   my way ' };
    expect(parseExternalReply({ action: { type: 'wait' }, say }, legal, true)).toEqual({ ok: true, reply: { action: { type: 'wait' }, say: { channel: 'team', text: 'on my way' } } });
    expect(parseExternalReply({ action: { type: 'wait' }, say }, legal, false)).toEqual({ ok: true, reply: { action: { type: 'wait' } } });
    expect(parseExternalReply({ action: { type: 'wait' }, say: { channel: 'shout', text: 'x' } }, legal, true)).toMatchObject({ ok: false });
    expect(parseExternalReply({ action: { type: 'wait' }, say: { channel: 'say', text: 'x'.repeat(161) } }, legal, true)).toMatchObject({ ok: false });
    const r = parseExternalReply({ action: { type: 'wait' }, thought: 'y'.repeat(100) }, legal, false);
    expect(r.ok && r.reply.thought).toHaveLength(80);
  });
});

describe('MemoryExternalTurnStore', () => {
  const turn = (turnId: string): ExternalTurn => ({ contract: 'skirm.agent/v1', type: 'turn', turnId, externalAgentId: 'ext_1', matchId: 'mat_1', tick: 1, agentId: 'agt_1', deadlineMs: 1200, expiresAt: '', observation: {} as never, context: { canSpeak: false, plan: null, recent: [], command: null } });

  it('keeps the latest turn, the first answer, and refuses answers to old turns', async () => {
    let now = 0;
    const s = new MemoryExternalTurnStore(() => now);
    await s.publish(turn('t1'), 1000);
    expect((await s.current('ext_1'))?.turnId).toBe('t1');
    expect(await s.submit('ext_1', 't1', { action: { type: 'wait' } }, 5000)).toBe('ok');
    expect(await s.submit('ext_1', 't1', { action: { type: 'switch' } }, 5000)).toBe('duplicate');
    expect(await s.reply('t1')).toEqual({ action: { type: 'wait' } });
    await s.publish(turn('t2'), 1000);
    expect(await s.submit('ext_1', 't1', { action: { type: 'wait' } }, 5000)).toBe('stale');
    now = 2000;
    expect(await s.current('ext_1')).toBeNull();
  });
});
