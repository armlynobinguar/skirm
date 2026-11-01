// The single retry, the time limit and the HTTP helper every v2 provider call goes through.
import { describe, expect, it, vi } from 'vitest';
import { dig, num, postJson, type FetchLike } from '../src/http';
import { HttpError, TimeoutError, errorLabel, isRetryable, runWithPolicy } from '../src/policy';

const json = (body: unknown, status = 200) =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });

describe('runWithPolicy', () => {
  it('returns the first success with its attempt count', async () => {
    const fn = vi.fn(async () => 'ok');
    expect(await runWithPolicy(fn, { timeLimitMs: 1000 })).toEqual({
      ok: true,
      value: 'ok',
      attempts: 1,
    });
  });

  it('retries once on a 5xx, then succeeds; two failures are an error', async () => {
    const flaky = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new HttpError(500, 'boom'))
      .mockResolvedValueOnce('ok');
    expect(await runWithPolicy(flaky, { timeLimitMs: 1000 })).toMatchObject({
      ok: true,
      value: 'ok',
      attempts: 2,
    });
    const down = vi.fn(async () => {
      throw new HttpError(503, 'down');
    });
    expect(await runWithPolicy(down, { timeLimitMs: 1000 })).toMatchObject({
      ok: false,
      reason: 'error',
      attempts: 2,
    });
  });

  it('does not retry a 4xx other than 408, 409 and 429, or when retry is off', async () => {
    const bad = vi.fn(async () => {
      throw new HttpError(401, 'nope');
    });
    expect(await runWithPolicy(bad, { timeLimitMs: 1000 })).toMatchObject({
      ok: false,
      reason: 'error',
      attempts: 1,
    });
    const busy = vi.fn(async () => {
      throw new HttpError(429, 'slow down');
    });
    expect(await runWithPolicy(busy, { timeLimitMs: 1000, retry: false })).toMatchObject({
      attempts: 1,
    });
  });

  it('times out a hanging call, aborts its signal and skips a retry that would not fit', async () => {
    let signal: AbortSignal | undefined;
    const hang = vi.fn((s: AbortSignal) => {
      signal = s;
      return new Promise<string>(() => {});
    });
    const out = await runWithPolicy(hang, { timeLimitMs: 40 });
    expect(out).toMatchObject({ ok: false, reason: 'timeout', attempts: 1 });
    expect(signal?.aborted).toBe(true);
    expect(hang).toHaveBeenCalledTimes(1);
  });
});

describe('error helpers', () => {
  it('retries network errors, timeouts, 408, 409, 429 and 5xx only', () => {
    expect(isRetryable(new TypeError('fetch failed'))).toBe(true);
    expect(isRetryable(new TimeoutError(10))).toBe(true);
    for (const s of [408, 409, 429, 500, 502]) expect(isRetryable(new HttpError(s, ''))).toBe(true);
    for (const s of [400, 401, 403, 404]) expect(isRetryable(new HttpError(s, ''))).toBe(false);
  });

  it('labels errors by HTTP status or name', () => {
    expect(errorLabel(new HttpError(502, ''))).toBe('HTTP 502');
    expect(errorLabel(new TimeoutError(5))).toBe('TimeoutError');
    expect(errorLabel('x')).toBe('Error');
  });
});

describe('postJson', () => {
  it('posts JSON with the given headers and parses the reply', async () => {
    const fetch = vi.fn<FetchLike>(async () => json({ a: { b: [1, 2] } }));
    const signal = new AbortController().signal;
    const out = await postJson({
      fetch,
      url: 'https://x.test/v1',
      headers: { Authorization: 'Bearer k' },
      body: { q: 1 },
      signal,
    });
    expect(dig(out, 'a', 'b', 1)).toBe(2);
    expect(fetch).toHaveBeenCalledWith('https://x.test/v1', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer k' },
      body: '{"q":1}',
      signal,
    });
  });

  it('throws HttpError on a non-2xx status or a body that is not JSON', async () => {
    const args = { url: 'u', headers: {}, body: {}, signal: new AbortController().signal };
    await expect(postJson({ ...args, fetch: async () => json('nope', 500) })).rejects.toMatchObject(
      {
        status: 500,
        body: 'nope',
      },
    );
    await expect(postJson({ ...args, fetch: async () => json('<html>') })).rejects.toBeInstanceOf(
      HttpError,
    );
  });

  it('dig and num read untrusted shapes without throwing', () => {
    expect(dig(null, 'a')).toBeUndefined();
    expect(dig({ a: 1 }, 'a', 'b')).toBeUndefined();
    expect(num('3')).toBe(0);
    expect(num(Number.NaN)).toBe(0);
    expect(num(4)).toBe(4);
  });
});
