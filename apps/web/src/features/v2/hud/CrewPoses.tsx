'use client';
// The crew line on the debrief: each of this player's agents in its own look, posing for the result.
// A win loops the victory pose (arms up, hops, stars), a loss the defeat pose (slumped under a rain
// cloud), a draw stands still; each wears an emote pill from the arena's reaction set (EMOTE_LOOK),
// and the MVP gets its tag. Looks come from the last frame this tab saw (role, owner look, skin);
// a result loaded cold has no frame, so its agents stand in the crew colours.
import type { FrameAgent, Team } from '@skirm/engine/v2';
import { lookColours, equipCosmeticById } from '@skirm/shared';
import type { Dress } from '@skirm/ui';
import { AgentPortrait } from '@/features/arena/AgentPortrait';
import { EMOTE_LOOK, type EmoteKind } from '@/features/arena/emotes';
import { agentColours } from '@/features/arena/live';
import v from '../v2.module.css';

export type CrewOutcome = 'victory' | 'defeat' | 'draw';

/** The reactions each outcome draws from, one per agent in turn. */
const OUTCOME_EMOTES: Readonly<Record<CrewOutcome, readonly EmoteKind[]>> = {
  victory: ['won_race', 'delivered', 'bluffed'],
  defeat: ['lost_race', 'knocked', 'stunned'],
  draw: ['not_fooled'],
};

export interface PosedAgent {
  id: string;
  name: string;
  role?: string;
  body: string;
  head: string;
  dress?: Dress;
  emote: { glyph: string; label: string };
  mvp: boolean;
}

/**
 * Who stands in the line and how they look: the debrief's agents in order, dressed from the last
 * frame's agent when there is one (owner look, then a worn skin over it, as the arena draws them).
 */
export function posedCrew(
  agents: readonly { agentId: string; name: string }[],
  frameAgents: readonly FrameAgent[] | null | undefined,
  team: Team,
  outcome: CrewOutcome,
  mvp: string | null,
): PosedAgent[] {
  const pool = OUTCOME_EMOTES[outcome];
  return agents.map((a, i) => {
    const f = frameAgents?.find((g) => g.id === a.agentId);
    let { body, head } = agentColours(team, i);
    let dress: Dress | undefined;
    if (f?.look) {
      const own = lookColours(f.look);
      ({ body, head } = own);
      dress = own.dress;
    }
    const skin = f?.cosmetics?.skin ? equipCosmeticById(f.cosmetics.skin) : undefined;
    if (skin?.kind === 'skin') {
      body = skin.body;
      head = skin.accent;
    }
    return {
      id: a.agentId,
      name: a.name,
      ...(f?.role ? { role: f.role } : {}),
      body,
      head,
      ...(dress ? { dress } : {}),
      emote: EMOTE_LOOK[pool[i % pool.length]!],
      mvp: a.agentId === mvp,
    };
  });
}

export function CrewPoses({ crew, outcome, team }: { crew: readonly PosedAgent[]; outcome: CrewOutcome; team: Team }) {
  if (!crew.length) return null;
  return (
    <ul className={v.poses} data-outcome={outcome} aria-label="Your crew" data-testid="v2-crew-poses">
      {crew.map((a, i) => (
        <li key={a.id} style={{ animationDelay: `${300 + i * 140}ms` }} data-testid={`v2-pose-${a.id}`}>
          <span className={v.poseEmote} aria-hidden="true">
            {a.emote.glyph}
          </span>
          <AgentPortrait
            body={a.body}
            head={a.head}
            team={team}
            label={`${a.name}, ${outcome === 'draw' ? 'a draw' : outcome}${a.mvp ? ', MVP' : ''}`}
            {...(a.role ? { role: a.role } : {})}
            {...(a.dress ? { dress: a.dress } : {})}
            {...(outcome !== 'draw' ? { result: outcome } : {})}
            className={v.poseFig}
          />
          <span className={v.poseName}>
            {a.mvp ? <b className={v.poseMvp}>MVP</b> : null}
            {a.name}
            <span className="sk-sr-only"> · {a.emote.label}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
