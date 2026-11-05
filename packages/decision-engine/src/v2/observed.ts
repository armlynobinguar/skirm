// What an agent saw on its turn, in one short line for the debrief's decision timeline ("why did it
// do that?"): where it stood and what it carried, how far the nearest item and the delivery point
// were, the nearest hazard in sight, rivals in sight, the score, a switch at hand, a bluff it
// believed and the last line it heard. Read off the Observation the brain got, so it never says more
// than the agent knew (fog included); never the skills or the plan, which the timeline keeps apart.
import type { Observation } from '@skirm/engine/v2';
import { distancesFrom } from './route';

/** Longest observation summary kept per agent per tick. */
export const MAX_OBSERVED_CHARS = 240;

const HAZARD: Record<string, string> = { '~': 'water', '^': 'fire', L: 'lava' };

/** The nearest water, fire or lava tile the crew has seen, by straight steps (null when none). */
export function nearestHazard(o: Observation): { kind: string; steps: number } | null {
  let best: { kind: string; steps: number } | null = null;
  for (let y = 0; y < o.rows.length; y++) {
    const row = o.rows[y]!;
    for (let x = 0; x < row.length; x++) {
      const kind = HAZARD[row[x]!];
      if (!kind) continue;
      const steps = Math.abs(x - o.me.x) + Math.abs(y - o.me.y);
      if (!best || steps < best.steps) best = { kind, steps };
    }
  }
  return best;
}

const cut = (t: string, n: number) => ([...t].length > n ? `${[...t].slice(0, n - 1).join('')}…` : t);

export function observedSummary(o: Observation): string {
  const d = distancesFrom(o, o.me.x, o.me.y);
  const item = o.map.item.toLowerCase();
  const parts: string[] = [`At ${o.me.x},${o.me.y} carrying ${o.me.carrying}/${o.me.capacity}`];
  parts.push(d.item !== null ? `nearest ${item} ${d.item} steps` : `no ${item} in sight`);
  if (d.deliver !== null) parts.push(`${o.map.deliverTo.toLowerCase()} ${d.deliver} steps`);
  const h = nearestHazard(o);
  if (h && h.steps <= 4) parts.push(`${h.kind} ${h.steps} ${h.steps === 1 ? 'step' : 'steps'} away`);
  if (o.choking) parts.push('choking in gas');
  if (o.shock?.some(([x, y]) => Math.abs(x - o.me.x) + Math.abs(y - o.me.y) <= 2)) parts.push('live water close');
  if (o.rivals.length) parts.push(`rivals in sight: ${o.rivals.map((r) => r.name).join(', ')}`);
  parts.push(`score ${o.score.mine}–${o.score.rival}`);
  if (o.legal.some((a) => a.type === 'switch')) parts.push('switch at hand');
  if (o.bluff?.believed) parts.push(`believed ${o.bluff.by}: the ${item} at ${o.bluff.at[0]},${o.bluff.at[1]} is gone`);
  const last = o.heard.at(-1);
  if (last) parts.push(`heard ${last.fromName}: "${cut(last.text, 48)}"`);
  return cut(`${parts.join('; ')}.`, MAX_OBSERVED_CHARS);
}
