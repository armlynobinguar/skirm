// A 5xx writes one Error Reporting event (name, code, frames; never the message or query string).
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ERROR_EVENT_TYPE } from '@skirm/server';
import { setup, type Harness } from './helpers';

let h: Harness;
beforeAll(async () => {
  h = await setup();
});
afterAll(() => h.close());
afterEach(() => vi.restoreAllMocks());

describe('error reporting on a 5xx', () => {
  it('answers 500 internal and reports one event without the message', async () => {
    const u = await h.as('erin');
    vi.spyOn(h.repos.agents, 'listByOwner').mockRejectedValue(Object.assign(new Error('password=swordfish'), { code: 'XX000' }));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await u.get('/agents?debug=swordfish');
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('internal');
    const events = spy.mock.calls.map((c) => String(c[0])).filter((l) => l.includes(ERROR_EVENT_TYPE));
    expect(events).toHaveLength(1);
    const e = JSON.parse(events[0]!);
    expect(e).toMatchObject({ severity: 'ERROR', serviceContext: { service: 'api' }, context: { httpRequest: { method: 'GET', url: '/agents' } } });
    expect(e.message.split('\n')[0]).toBe('Error: XX000');
    expect(events[0]).not.toContain('swordfish');
  });

  it('reports nothing for a 4xx', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await h.http().get('/agents')).status).toBe(401);
    expect(spy.mock.calls.some((c) => String(c[0]).includes(ERROR_EVENT_TYPE))).toBe(false);
  });
});
