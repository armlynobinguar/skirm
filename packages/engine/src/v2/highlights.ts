// Highlight moments of an ended match, found in its stored whole-board (watch) frames: the goal
// delivered, a switch that floods the rival's lane, a fight over a supply drop, and a lead change
// (a comeback when the new leader had trailed by two or more). Pure and deterministic, so the api,
// the web and tests agree on the same moments for the same frames.
//
// Only public facts go into a highlight (agent and crew names, map, score, what happened where
// everyone could see it): never plans, inner voice, live commands or skill text. Frames other than
// the watch view are refused, so a crew's fogged view never decides what the public sees.
import type { Team } from './map';
import type { V2Frame } from './frame';

export type HighlightKind = 'goal' | 'switch_flood' | 'drop_fight' | 'lead_change';

export interface ReplayHighlight {
  /** Stable within a match: `<kind>-<tick>`. */
  id: string;
  kind: HighlightKind;
  /** The tick the moment happens on (jump here). */
  tick: number;
  /** A short clip around it: a few ticks of build-up, a few after. */
  start: number;
  end: number;
  /** The crew the moment favours (null when neither). */
  team: Team | null;
  /** A short label for the jump button, e.g. "Rook delivers the goal". */
  title: string;
  /** Plain public facts for the caster (and the tooltip). */
  facts: string;
  /** Importance; the strongest HIGHLIGHTS_MAX are kept. */
  weight: number;
  /** The score once the moment has played. */
  score: Record<Team, number>;
}

/** At most this many highlights per match. */
export const HIGHLIGHTS_MAX = 8;
/** Ticks of build-up and follow-through in a highlight's clip. */
export const HIGHLIGHT_LEAD_TICKS = 6;
export const HIGHLIGHT_TAIL_TICKS = 4;
/** How long after a supply drop lands a fight over it still counts. */
export const DROP_FIGHT_WINDOW = 15;
/** Both crews within this many tiles (Manhattan) of a drop make it a fight. */
export const DROP_FIGHT_RANGE = 3;

export interface HighlightOptions {
  /** Crew names (the players' handles); default "Crew A" / "Crew B". */
  crews?: Partial<Record<Team, string>>;
}

const other = (t: Team): Team => (t === 'A' ? 'B' : 'A');
const dist = (a: readonly [number, number], b: readonly [number, number]) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]);

/** The highlights of a match from its watch frames, oldest first. Empty for no frames. */
export function detectHighlights(frames: readonly V2Frame[], opts: HighlightOptions = {}): ReplayHighlight[] {
  const fs = frames.filter((f) => f.view === 'watch').slice().sort((a, b) => a.tick - b.tick);
  if (!fs.length) return [];
  const first = fs[0]!.tick;
  const last = fs[fs.length - 1]!.tick;
  const crew = (t: Team) => opts.crews?.[t] || `Crew ${t}`;
  const names = new Map<string, { name: string; team: Team }>();
  for (const f of fs) for (const a of f.agents) if (!names.has(a.id)) names.set(a.id, { name: a.name, team: a.team });
  const nameOf = (id: string) => names.get(id)?.name ?? 'An agent';
  const teamOf = (id: string) => names.get(id)?.team ?? null;
  const final = fs[fs.length - 1]!.result;
  const out: ReplayHighlight[] = [];
  const add = (h: Omit<ReplayHighlight, 'id' | 'start' | 'end'>) =>
    out.push({ ...h, id: `${h.kind}-${h.tick}`, start: Math.max(first, h.tick - HIGHLIGHT_LEAD_TICKS), end: Math.min(last, h.tick + HIGHLIGHT_TAIL_TICKS) });
  const sc = (f: V2Frame) => ({ A: f.score.A, B: f.score.B });
  const scoreText = (s: Record<Team, number>) => `${crew('A')} ${s.A}, ${crew('B')} ${s.B}`;

  let leader: Team | null = null;
  /** The largest deficit each crew has faced since the lead last changed. */
  let deficit: Record<Team, number> = { A: 0, B: 0 };

  fs.forEach((f, i) => {
    // Goal delivered.
    for (const e of f.events) {
      if (e.kind !== 'delivered') continue;
      const winning = !!final && final.reason === 'goal' && final.winner === e.team && f.tick === final.ticks && !!f.result;
      add({
        kind: 'goal',
        tick: f.tick,
        team: e.team,
        title: winning ? `${nameOf(e.agent)} delivers the goal` : `${nameOf(e.agent)} delivers`,
        facts: `${nameOf(e.agent)} of ${crew(e.team)} delivers ${e.count > 1 ? `${e.count} items` : 'an item'}${winning ? ' and wins the match' : ''}. Score: ${scoreText(sc(f))}.`,
        weight: winning ? 10 : 5,
        score: sc(f),
      });
    }

    // Switch flood: who flipped it, whose lane, and how many of that crew it knocked down.
    for (const e of f.events) {
      if (e.kind !== 'switch') continue;
      const by = teamOf(e.agent);
      let downed = 0;
      for (const g of fs.slice(i, i + 1 + Math.max(0, e.until - f.tick)))
        for (const k of g.events) if (k.kind === 'knocked_down' && k.by === 'switch' && teamOf(k.agent) === e.floods) downed++;
      add({
        kind: 'switch_flood',
        tick: f.tick,
        team: by,
        title: `${nameOf(e.agent)} floods ${crew(e.floods)}'s lane`,
        facts: `${nameOf(e.agent)}${by ? ` of ${crew(by)}` : ''} throws the ${e.name} switch and floods ${crew(e.floods)}'s lane until tick ${e.until}${downed ? `, knocking down ${downed} of their agents` : ''}.`,
        weight: 4 + 2 * downed,
        score: sc(f),
      });
    }

    // Supply drop fight: both crews close to a fresh drop within the window.
    for (const e of f.events) {
      if (e.kind !== 'supply_drop') continue;
      const window = fs.slice(i, i + 1 + DROP_FIGHT_WINDOW);
      const near = (g: V2Frame, t: Team) => g.agents.some((a) => a.team === t && !a.out && dist([a.x, a.y], e.at) <= DROP_FIGHT_RANGE);
      const clash = window.find((g) => near(g, 'A') && near(g, 'B'));
      if (!clash) continue;
      let stuns = 0;
      let taker: string | null = null;
      for (const g of window) {
        if (g.tick < clash.tick - 2) continue;
        for (const k of g.events) {
          if (k.kind === 'stunned') stuns++;
          if (!taker && k.kind === 'picked' && k.origin === 'drop' && dist(k.at, e.at) <= 2) taker = k.agent;
        }
      }
      const team = taker ? teamOf(taker) : null;
      add({
        kind: 'drop_fight',
        tick: clash.tick,
        team,
        title: taker ? `${nameOf(taker)} wins the drop fight` : 'Both crews fight over a drop',
        facts: `A supply drop lands at ${e.at[0]},${e.at[1]} and both crews converge on it${stuns ? `, with ${stuns} stun${stuns > 1 ? 's' : ''}` : ''}. ${taker ? `${nameOf(taker)} of ${crew(team!)} takes it.` : 'Nobody comes away with it.'}`,
        weight: 4 + Math.min(stuns, 3) + (taker ? 1 : 0),
        score: sc(clash),
      });
    }

    // Lead change: the score leader flips (a level score in between does not reset it).
    const s = f.score;
    const now: Team | null = s.A > s.B ? 'A' : s.B > s.A ? 'B' : null;
    if (now && leader && now !== leader) {
      const comeback = deficit[now] >= 2;
      add({
        kind: 'lead_change',
        tick: f.tick,
        team: now,
        title: comeback ? `Comeback: ${crew(now)} takes the lead` : `${crew(now)} takes the lead`,
        facts: `${crew(now)} ${comeback ? `comes back from ${deficit[now]} down and ` : ''}overtakes ${crew(other(now))}. Score: ${scoreText(sc(f))}.`,
        weight: comeback ? 6 + deficit[now] : 5,
        score: sc(f),
      });
      deficit = { A: 0, B: 0 };
    }
    if (now) leader = now;
    deficit = { A: Math.max(deficit.A, s.B - s.A), B: Math.max(deficit.B, s.A - s.B) };
  });

  // One highlight per tick: the strongest wins and the others' facts ride along.
  const byTick = new Map<number, ReplayHighlight>();
  for (const h of out) {
    const had = byTick.get(h.tick);
    if (!had) byTick.set(h.tick, h);
    else {
      const [keep, drop] = h.weight >= had.weight ? [h, had] : [had, h];
      byTick.set(h.tick, { ...keep, facts: `${keep.facts} ${drop.facts}`, weight: keep.weight + 1 });
    }
  }
  return [...byTick.values()]
    .sort((a, b) => b.weight - a.weight || a.tick - b.tick)
    .slice(0, HIGHLIGHTS_MAX)
    .sort((a, b) => a.tick - b.tick);
}
