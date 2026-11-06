'use client';
// The agent cards under the arena (the prototype's buildCards / .acard): portrait, talk tier, role,
// delivered count and the carry slots with their origin stripe. A pickup, delivery or drop floats
// above the card. Click follows the agent (again to stop); double-click opens third person.
// Rivals show once seen; out of sight their slots are "?", and rivals never seen are blank cards.
import { carryOf, mapV2, type FrameAgent, type Team } from '@skirm/engine/v2';
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { AgentPortrait } from '@/features/arena/AgentPortrait';
import { agentColours } from '@/features/arena/live';
import { mapById } from '@/features/arena/world';
import { controlStyles } from './Control';
import c from './hud.module.css';
import { invChange, plural, slotsOf, type InvChange } from './model';
import { ToolChip } from './Gear';
import { ItemIcon, SmallSlots } from './parts';

const TIER_TAG = { quiet: 'QUIET', standard: 'STD', open: 'OPEN' } as const;

export interface CardAgent {
  agent: FrameAgent;
  /** In this crew's sight now (always true for your own agents). */
  inSight: boolean;
  slot: number;
}

export interface AgentCardsProps {
  team: Team;
  mapId: string;
  tick: number;
  cards: CardAgent[];
  /** Rival agents never seen yet (blank cards). */
  unseen?: number;
  /** The agent the camera follows or third person watches. */
  pressed: string | null;
  onPick: (id: string) => void;
  onWatch: (id: string) => void;
  className?: string;
  /** Hybrid control: the agent its player steers (tagged on its card). */
  controlled?: string | null;
  /** Hybrid control: drawn under each card (the "Take control" button). */
  extra?: (agent: FrameAgent) => ReactNode;
}

export function AgentCards({ team, mapId, tick, cards, unseen = 0, pressed, onPick, onWatch, className, controlled, extra }: AgentCardsProps) {
  const def = mapV2(mapId);
  const item = def?.item ?? 'Item';
  const accent = mapById(mapId) ? (mapById(mapId) as unknown as { pal: { accent: string } }).pal.accent : 'var(--amber)';
  return (
    <div className={`${c.cards} ${className ?? ''}`}>
      {cards.map(({ agent, inSight, slot }) => (
        <Card
          key={agent.id}
          agent={agent}
          rival={agent.team !== team}
          inSight={inSight}
          slot={slot}
          tick={tick}
          mapId={mapId}
          item={item}
          accent={accent}
          pressed={pressed === agent.id}
          onPick={onPick}
          onWatch={onWatch}
          steered={!!agent.controlled || controlled === agent.id}
          extra={extra?.(agent)}
        />
      ))}
      {Array.from({ length: unseen }, (_, i) => (
        <div key={`unseen-${i}`} className={c.cardWrap}>
          <div className={c.acard} data-rival="" data-unseen="" aria-label="Rival agent not seen yet">
            <span className={c.unseenFace}>?</span>
            <span className={c.cin}>
              <b>Unseen</b>
              <span className={c.st}>
                <span>rival</span>
                <span>–</span>
              </span>
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

interface CardProps {
  agent: FrameAgent;
  rival: boolean;
  inSight: boolean;
  slot: number;
  tick: number;
  mapId: string;
  item: string;
  accent: string;
  pressed: boolean;
  onPick: (id: string) => void;
  onWatch: (id: string) => void;
  steered?: boolean;
  extra?: ReactNode;
}

function Card({ agent, rival, inSight, slot, tick, mapId, item, accent, pressed, onPick, onWatch, steered, extra }: CardProps) {
  const float = useInvFloat(agent, inSight);
  const { body, head } = agentColours(agent.team, slot);
  const status = agent.out ? 'out' : agent.down ? 'swept' : `${agent.delivered} dlv`;
  return (
    <div className={c.cardWrap}>
      {float ? <InvFloat key={float.key} change={float.change} rival={rival} mapId={mapId} item={item} /> : null}
      {steered ? (
        <span className={controlStyles.steered} data-testid={`v2-steered-${agent.id}`}>
          {rival ? 'Player' : 'You'}
        </span>
      ) : null}
      <button
        type="button"
        className={c.acard}
        data-rival={rival || undefined}
        data-down={agent.out || agent.down || undefined}
        data-steered={steered || undefined}
        aria-pressed={pressed}
        title={`Follow ${agent.name} · double-click or V for third person`}
        style={rival ? undefined : ({ '--c': body } as CSSProperties)}
        onClick={() => onPick(agent.id)}
        onDoubleClick={() => onWatch(agent.id)}
        data-testid={`v2-card-${agent.id}`}
      >
        <span className={c.tier}>{TIER_TAG[agent.tier]}</span>
        {inSight ? <ToolChip kind={agent.tool} onCard /> : null}
        <AgentPortrait body={body} head={head} team={agent.team === 'A' ? 'A' : 'B'} label={`${agent.name}, ${agent.role}`} role={agent.role} className={c.portrait} />
        <span className={c.cin}>
          <b>{agent.name}</b>
          <span className={c.st}>
            <span>{agent.role}</span>
            <span>{status}</span>
          </span>
          <SmallSlots slots={slotsOf(agent, carryOf(agent.role), inSight, tick)} mapId={mapId} item={item} accent={accent} />
        </span>
      </button>
      {extra}
    </div>
  );
}

/** The latest change in an agent's hands, for 1.7 s; only while it is in sight on both frames. */
function useInvFloat(agent: FrameAgent, inSight: boolean): { key: number; change: InvChange } | null {
  const prev = useRef<FrameAgent | null>(null);
  const [float, setFloat] = useState<{ key: number; change: InvChange } | null>(null);
  useEffect(() => {
    const before = prev.current;
    prev.current = inSight ? agent : null;
    const change = before ? invChange(before, agent) : null;
    if (change) setFloat((f) => ({ key: (f?.key ?? 0) + 1, change }));
  }, [agent, inSight]);
  useEffect(() => {
    if (!float) return;
    const t = setTimeout(() => setFloat(null), 1700);
    return () => clearTimeout(t);
  }, [float]);
  return float;
}

function InvFloat({ change, rival, mapId, item }: { change: InvChange; rival: boolean; mapId: string; item: string }) {
  const style =
    change.kind === 'picked'
      ? { '--fc': rival ? 'var(--rival)' : 'var(--you)', '--ft': rival ? '#fff' : 'var(--bg)' }
      : change.kind === 'delivered'
        ? { '--fc': 'var(--violet)' }
        : { '--fc': 'var(--amber)' };
  const text =
    change.kind === 'picked'
      ? `+ ${change.n > 1 ? `${change.n} ${plural(item, 2)}` : item}`
      : change.kind === 'delivered'
        ? `Delivered ${change.n}`
        : `Dropped ${change.n}`;
  return (
    <span className={c.float} style={style as CSSProperties} role="status" data-testid="v2-float">
      <ItemIcon mapId={mapId} />
      {text}
    </span>
  );
}
