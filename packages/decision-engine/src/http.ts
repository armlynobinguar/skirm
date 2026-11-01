// The only place that speaks HTTP for the OpenAI-compatible provider (OpenRouter).

import { HttpError } from './policy';

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface PostJsonArgs {
  fetch: FetchLike;
  url: string;
  headers: Record<string, string>;
  body: unknown;
  signal: AbortSignal;
}

export async function postJson(args: PostJsonArgs): Promise<unknown> {
  const res = await args.fetch(args.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...args.headers },
    body: JSON.stringify(args.body),
    signal: args.signal,
  });
  const text = await res.text();
  if (!res.ok) throw new HttpError(res.status, text.slice(0, 500));
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new HttpError(res.status, 'invalid JSON body');
  }
}

export function defaultFetch(): FetchLike {
  if (typeof globalThis.fetch !== 'function') throw new Error('global fetch is not available');
  return (input, init) => globalThis.fetch(input, init);
}

/** Read a nested property without throwing. */
export function dig(obj: unknown, ...path: (string | number)[]): unknown {
  let cur: unknown = obj;
  for (const key of path) {
    if (cur === null || cur === undefined || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string | number, unknown>)[key];
  }
  return cur;
}

export function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}
