// How a v2 agent reads on the crew, lock-in and editor screens (the prototype's ROSTER fields):
// role, colours, vision and comms, default talk tier, its verb on a map and its voice.
import { ROLE_EFFECT, TALK_TIERS, HEAD_START_TICKS_PER_AGENT, TICK_MS, type EffectClass, type Role, type TalkTier } from '@skirm/engine/v2';
import { OUTFIT_COLORS, SKIN_TONES } from '@skirm/shared';
import type { V2Map } from '@/features/arena/world';
import type { Agent } from '@/lib/api/types';
import { routes } from '@/lib/routes';

export function agentRole(a: Agent): Role {
  return a.role;
}

/** Body colour: the agent's outfit (the prototype's `c`). */
export function agentColour(a: Agent): string {
  return OUTFIT_COLORS[a.appearance.outfit] ?? OUTFIT_COLORS[0]!;
}

/** Head colour (the prototype's `bone`). */
export function agentBone(a: Agent): string {
  return SKIN_TONES[a.appearance.skin] ?? SKIN_TONES[0]!;
}

export const agentVision = (a: Agent): number => a.vision;
export const agentComms = (a: Agent): number => a.comms;
export const agentTier = (a: Agent): TalkTier => a.tier;

/** Tiles an agent sees (night: one less) and its say reach, as the engine counts them. */
export const sightOf = (vision: number) => 1 + vision;
export const reachOf = (comms: number) => 2 + comms;

/** Talk tiers in picker order, with the prototype's copy. Rates are credits per agent per tick (engine ratePer100 / 100). */
export const TIER_ORDER: readonly TalkTier[] = ['quiet', 'standard', 'open'];
export const TIER_INFO: Readonly<Record<TalkTier, { label: string; note: string; line: string; rate: number }>> = {
  quiet: {
    label: 'Quiet',
    note: 'Callouts only',
    line: 'Speaks only for callouts. Costs the same as Standard, and rivals learn nothing from it.',
    rate: TALK_TIERS.quiet.ratePer100 / 100,
  },
  standard: {
    label: 'Standard',
    note: 'A line every 5 ticks',
    line: 'One message every 5 ticks, 120 characters.',
    rate: TALK_TIERS.standard.ratePer100 / 100,
  },
  open: {
    label: 'Open',
    note: 'A line every tick',
    line: 'Can speak every tick. Best for bluffing, and the easiest to overhear.',
    rate: TALK_TIERS.open.ratePer100 / 100,
  },
};

/** How the agent speaks and thinks. Agents have no voice field yet, so it follows the role (the prototype's roster). */
export type Voice = 'Calm' | 'Blunt' | 'Cocky' | 'Careful' | 'Quiet' | 'Chatty' | 'Bossy';
export const VOICE_OF_ROLE: Readonly<Record<Role, Voice>> = {
  Builder: 'Calm',
  Runner: 'Blunt',
  Scout: 'Cocky',
  Firefighter: 'Careful',
  Digger: 'Quiet',
  Hauler: 'Chatty',
};
export const agentVoice = (a: Agent): Voice => VOICE_OF_ROLE[agentRole(a)];

export interface VerbFit {
  /** The effect class only this role can use (null: Runner and Hauler take and deliver only). */
  effect: EffectClass | null;
  /** The map's themed verb for it, when the map has one. */
  verb: string | null;
}

export function verbFit(role: Role, map: V2Map | undefined): VerbFit {
  const effect = ROLE_EFFECT[role];
  const verb = effect && map ? (map.verbs.find((v) => v[1] === effect)?.[0] ?? null) : null;
  return { effect, verb };
}

/** Credits per tick for a crew at these tiers (summed in hundredths, so 0.2 + 0.2 + 0.4 is exactly 0.8). */
export const ratePerTick = (tiers: readonly TalkTier[]) => tiers.reduce((n, t) => n + TALK_TIERS[t].ratePer100, 0) / 100;

/** A credits-per-tick rate as the screens show it: two decimals (0.20). */
export const fmtRate = (rate: number) => rate.toFixed(2);

/** Seconds of head start for each agent one crew fields beyond the other's. */
export const HEAD_START_S_PER_AGENT = (HEAD_START_TICKS_PER_AGENT * TICK_MS) / 1000;

/** The lock-in head-start line: the larger crew waits 10 s per extra agent. */
export function headStartLine(mine: number, rival: number): { text: string; tone: 'rival' | 'you' | null } {
  const d = mine - rival;
  if (d > 0) return { text: `Rival fields ${rival} · they start ${d * HEAD_START_S_PER_AGENT} s ahead`, tone: 'rival' };
  if (d < 0) return { text: `Rival fields ${rival} · you start ${-d * HEAD_START_S_PER_AGENT} s ahead`, tone: 'you' };
  return { text: `Rival fields ${rival} · no head start`, tone: null };
}

/** "1:30" from seconds. */
export function clock(s: number): string {
  const t = Math.max(0, Math.ceil(s));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}

/** The agent editor, with the crew screen it was opened from for its Back link. */
export function agentEditorHref(agentId: string, from?: { mapId: string; difficulty?: string }): string {
  if (!from) return routes.agent(agentId);
  const q = new URLSearchParams({ map: from.mapId, ...(from.difficulty ? { d: from.difficulty } : {}) });
  return `${routes.agent(agentId)}?${q}`;
}
