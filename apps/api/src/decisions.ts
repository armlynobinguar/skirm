// GET /v2/matches/:id/decisions: the debrief's decision timeline ("why did it do that?"). A player
// reads their own crew's timeline (practice adds the greedy bot's, as the live mind panel shows all
// minds there); never the rival player's. Each turn names the equipped skill that drove it by id:
// the model's own SKILL line, else (model brains only) the one equipped skill whose required action
// is the verb that resolved. Skill text is only ever sent to the skill's creator.
import type { MatchTimelineRow, SkillVersionView, V2DecisionRecord, V2MatchRow } from '@skirm/db';

type Team = 'A' | 'B';

/** Which required skill action each verb effect class (or a dig) stands for. */
const ACTION_OF_EFFECT: Record<string, string> = { add_solid: 'place_block', remove_solid: 'dig', extinguish: 'extinguish' };

export interface DecisionSkillRef {
  id: string;
  version: number;
  /** 'model': the agent's model named it; 'inferred': the only equipped skill needing that verb. */
  by: 'model' | 'inferred';
}

export type DecisionView = Omit<V2DecisionRecord, 'skill'> & { skill: DecisionSkillRef | null };

/** The crews a viewer may read: their own, and the bot's in practice. */
export function visibleTeams(m: Pick<V2MatchRow, 'teamAAccountId' | 'teamBAccountId' | 'practice'>, viewerId: string): Team[] {
  const you: Team | undefined = viewerId === m.teamAAccountId ? 'A' : viewerId === m.teamBAccountId ? 'B' : undefined;
  if (!you) return [];
  return m.practice ? ['A', 'B'] : [you];
}

/** The skill behind a turn: the model's pick, else the single equipped skill needing the verb it used. */
export function attributeSkill(
  d: V2DecisionRecord,
  brain: string,
  equipped: readonly { id: string; version: number }[],
  meta: ReadonlyMap<string, Pick<SkillVersionView, 'requiresActions'>>,
): DecisionSkillRef | null {
  if (d.skill) return { ...d.skill, by: 'model' };
  // The greedy brain plays without skills, so nothing it did came from one.
  if (brain === 'greedy' || !d.effect) return null;
  const need = ACTION_OF_EFFECT[d.effect];
  if (!need) return null;
  const fits = equipped.filter((k) => (meta.get(`${k.id}:${k.version}`)?.requiresActions as readonly string[] | undefined)?.includes(need));
  return fits.length === 1 ? { id: fits[0]!.id, version: fits[0]!.version, by: 'inferred' } : null;
}

export interface DecisionsViewInput {
  match: V2MatchRow;
  viewerId: string;
  timelines: readonly MatchTimelineRow[];
  /** Skill versions the crews played with, by `id:version`. */
  skills: ReadonlyMap<string, SkillVersionView>;
  /** Decrypted prompts of the viewer's own skills, by `id:version` (never anyone else's). */
  prompts: ReadonlyMap<string, string>;
}

export function decisionsView(i: DecisionsViewInput) {
  const { match: m } = i;
  const you: Team = i.viewerId === m.teamAAccountId ? 'A' : 'B';
  const crews = i.timelines.map((t) => {
    const roster = m.crews?.[t.team] ?? [];
    const equipped = new Map(roster.map((a) => [a.id, a.skills ?? []]));
    return {
      team: t.team,
      own: t.team === you,
      brain: t.brain,
      agents: roster.map((a) => ({ id: a.id, name: a.name, role: a.role, skills: a.skills ?? [] })),
      plans: t.plans,
      decisions: t.decisions.map((d): DecisionView => ({ ...d, skill: attributeSkill(d, t.brain, equipped.get(d.agentId) ?? [], i.skills) })),
      moments: t.moments,
    };
  });
  const keys = new Map<string, { id: string; version: number }>();
  for (const c of crews) for (const a of c.agents) for (const k of a.skills) keys.set(`${k.id}:${k.version}`, k);
  const skills = [...keys.entries()].map(([key, k]) => {
    const v = i.skills.get(key);
    const mine = !!v && v.creatorId === i.viewerId;
    const prompt = mine ? i.prompts.get(key) : undefined;
    return { id: k.id, version: k.version, name: v?.name ?? k.id, mine, ...(prompt !== undefined ? { prompt } : {}) };
  });
  return { matchId: m.id, you, ticks: m.ticks ?? 0, crews, skills };
}
