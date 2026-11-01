// The speech filter: messages leave an agent only if they keep its skills secret and stay civil.
// Spectators see every message, so the filter protects viewers too (design doc "Talk and manipulation").

const BLOCKED = /\b(fuck|shit|cunt|nigg|fag|retard|kill yourself|kys)\w*/i;
const WINDOW = 6;

export type FilterResult = { ok: true; text: string } | { ok: false; reason: 'leak' | 'abuse' | 'empty' };

const words = (t: string) => t.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);

/** Refuses a message that repeats 6 words in a row from any secret skill text, or is abusive. */
export function filterSpeech(text: string, secrets: string[]): FilterResult {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t) return { ok: false, reason: 'empty' };
  if (BLOCKED.test(t)) return { ok: false, reason: 'abuse' };
  const said = words(t).join(' ');
  for (const secret of secrets) {
    const w = words(secret);
    for (let i = 0; i + WINDOW <= w.length; i++) if (said.includes(w.slice(i, i + WINDOW).join(' '))) return { ok: false, reason: 'leak' };
  }
  return { ok: true, text: t };
}
