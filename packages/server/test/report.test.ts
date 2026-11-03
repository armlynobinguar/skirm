// Error Reporting events: structured, grouped by Cloud Error Reporting, and never carrying the
// error's message (which can quote query parameters or user text).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ERROR_EVENT_TYPE, errorStack, reportError } from '../src/report';

afterEach(() => vi.restoreAllMocks());

describe('error reporting', () => {
  it('keeps the name, code and stack frames and drops the message', () => {
    const err = Object.assign(new TypeError('secret=hunter2 in the query'), { code: 'E_BAD' });
    const s = errorStack(err);
    expect(s.split('\n')[0]).toBe('TypeError: E_BAD');
    expect(s).toMatch(/\n\s+at /);
    expect(s).not.toContain('hunter2');
    // A wrapped driver error: the code comes from the cause.
    expect(errorStack(Object.assign(new Error('x'), { cause: { code: 'ECONNREFUSED' } })).split('\n')[0]).toBe('Error: ECONNREFUSED');
    // A thrown string still makes a groupable event.
    expect(errorStack('oops')).toBe('Error: no code\n    at <unknown>');
  });

  it('writes one structured Error Reporting event, query string removed', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    reportError('api', new Error('token=abc'), { where: 'GET /me', httpRequest: { method: 'GET', url: '/me?token=abc' } });
    expect(spy).toHaveBeenCalledTimes(1);
    const event = JSON.parse(spy.mock.calls[0]![0] as string);
    expect(event).toMatchObject({
      severity: 'ERROR',
      '@type': ERROR_EVENT_TYPE,
      serviceContext: { service: 'api' },
      context: { reportLocation: { functionName: 'GET /me' }, httpRequest: { method: 'GET', url: '/me' } },
    });
    expect(JSON.stringify(event)).not.toContain('abc');
  });
});
