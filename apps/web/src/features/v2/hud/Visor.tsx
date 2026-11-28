'use client';
// The visor: first person from the watched agent in the live match (the voxel-pov prototype's
// visor). The 3D cam draws the world from its eyes (chase3d, mode 'visor'); this draws skirm's
// Tactical HUD frame over it: corner brackets, a compass tape that turns with the view, a marker
// for the delivery point, a cut reticle, and the inner voice from what the agent is going for.
// Peek (./peek): hold Q or a crewmate's button to look through that crewmate's visor for a moment.
// The compass reads the camera through `view` every animation frame and moves the DOM directly,
// so turning the view never re-renders React.
import { mapV2, type FrameAgent, type Team } from '@skirm/engine/v2';
import { useEffect, useMemo, useRef } from 'react';
import type { CamView } from '@/features/arena/chase3d';
import { bearingTo, headingDeg, tapeCells, tapeMark, tapeShift } from '@/features/arena/chase3d/visor';
import c from './visor.module.css';
import { innerVoiceOf } from './visorVoice';

const CELL = 30;

export interface VisorProps {
  agent: FrameAgent;
  team: Team;
  mapId: string;
  /** Where the camera looks right now (written by the 3D cam each frame). */
  view: { current: CamView | null };
  /** Crewmates to peek through (empty: no peek bar). */
  mates?: readonly { id: string; name: string }[];
  /** The crewmate being peeked through (then `agent` is that crewmate). */
  peeking?: string | null;
  /** Start (id) or end (null) a peek. */
  onPeek?: (id: string | null) => void;
}

export function Visor({ agent, team, mapId, view, mates = [], peeking = null, onPeek }: VisorProps) {
  const def = mapV2(mapId);
  const item = def?.item ?? 'Item';
  const deliverTo = def?.deliverTo ?? 'Drop point';
  const exit = def?.exit ?? null;
  const tape = useRef<HTMLDivElement>(null);
  const ticks = useRef<HTMLDivElement>(null);
  const mark = useRef<HTMLDivElement>(null);
  const cells = useMemo(() => [0, 1, 2].flatMap((r) => tapeCells().map((t) => ({ ...t, key: `${r}-${t.deg}` }))), []);

  useEffect(() => {
    let raf = 0;
    let last = '';
    const step = () => {
      const v = view.current;
      const tw = tape.current?.clientWidth ?? 0;
      if (v && ticks.current) ticks.current.style.transform = `translateX(${tapeShift(headingDeg(v.yaw), CELL, tw).toFixed(1)}px)`;
      if (v && exit && mark.current) {
        const b = bearingTo({ x: v.x, z: v.z }, { x: exit[0], z: exit[1] }, v.yaw);
        const m = tapeMark(b.rel, CELL, tw);
        mark.current.style.transform = `translateX(calc(-50% + ${m.x.toFixed(1)}px))`;
        const text = `${m.off === 'left' ? '◂ ' : ''}${deliverTo} · ${Math.round(b.dist)} m${m.off === 'right' ? ' ▸' : ''}`;
        if (text !== last) mark.current.textContent = last = text;
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [view, exit, deliverTo]);

  const dist = exit ? Math.round(Math.hypot(exit[0] - agent.x, exit[1] - agent.y)) : 0;
  const voice = innerVoiceOf(agent, { team, item, deliverTo, dist });
  const rival = agent.team !== team;
  return (
    <div className={`${c.visor} ${rival ? c.rival : ''}`} data-testid="v2-visor">
      <div className={c.scan} />
      <div className={`${c.br} ${c.tl}`} />
      <div className={`${c.br} ${c.tr}`} />
      <div className={`${c.br} ${c.bl}`} />
      <div className={`${c.br} ${c.brr}`} />
      <div className={c.tape} ref={tape} aria-hidden="true">
        <div className={c.ticks} ref={ticks}>
          {cells.map((t) => (
            <span key={t.key} className={`${c.t} ${t.cardinal ? c.card : ''}`}>
              {t.label}
            </span>
          ))}
        </div>
      </div>
      {exit ? <div className={c.mark} ref={mark} aria-hidden="true" data-testid="v2-visor-mark" /> : null}
      <div className={c.reticle} aria-hidden="true" />
      {peeking ? (
        <div className={c.peekTag} data-testid="v2-visor-peek-tag">
          Peek · {agent.name}&rsquo;s visor
        </div>
      ) : null}
      {mates.length && onPeek ? (
        <div className={c.peek} role="group" aria-label="Peek through a crewmate (hold)" data-testid="v2-visor-peek">
          <span className="sk-kick">Peek · hold Q</span>
          {mates.map((m) => {
            const end = () => onPeek(null);
            return (
              <button
                key={m.id}
                type="button"
                className={c.peekBtn}
                aria-pressed={peeking === m.id}
                onPointerDown={(e) => {
                  e.preventDefault();
                  onPeek(m.id);
                }}
                onPointerUp={end}
                onPointerLeave={end}
                onPointerCancel={end}
                onKeyDown={(e) => {
                  if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) {
                    e.preventDefault();
                    e.stopPropagation();
                    onPeek(m.id);
                  }
                }}
                onKeyUp={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') end();
                }}
                onBlur={end}
                data-testid={`v2-visor-peek-${m.id}`}
              >
                {m.name}
              </button>
            );
          })}
        </div>
      ) : null}
      <p className={c.voice} aria-live="polite" data-testid="v2-visor-voice">
        <span>{voice.kick}</span>
        {voice.text}
      </p>
    </div>
  );
}
