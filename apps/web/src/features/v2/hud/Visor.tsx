'use client';
// The visor: first person from the watched agent in the live match (the voxel-pov prototype's
// visor). The 3D cam draws the world from its eyes (chase3d, mode 'visor'); this draws skirm's
// Tactical HUD frame over it: corner brackets, a compass tape that turns with the view, a marker
// for the delivery point, a cut reticle, and the inner voice from what the agent is going for.
// Supply drops: the nearest tools on the ground get their own pips on the tape (Sandbags · 3 m),
// and the tool the agent carries shows in a kit chip with what it does.
// The compass reads the camera through `view` every animation frame and moves the DOM directly,
// so turning the view never re-renders React.
import { mapV2, type FrameAgent, type Team, type ToolKind } from '@skirm/engine/v2';
import { useEffect, useMemo, useRef, type CSSProperties } from 'react';
import type { CamView } from '@/features/arena/chase3d';
import { bearingTo, headingDeg, nearMarks, tapeCells, tapeMark, tapeShift } from '@/features/arena/chase3d/visor';
import { TOOL_INFO } from '@/features/arena/gear';
import { ToolIcon } from './Gear';
import c from './visor.module.css';
import { innerVoiceOf } from './visorVoice';

const CELL = 30;
/** Tools on the ground within this many tiles get a pip; at most this many. */
export const TOOL_RANGE = 8;
export const TOOL_PIPS = 3;

export interface VisorProps {
  agent: FrameAgent;
  team: Team;
  mapId: string;
  /** Where the camera looks right now (written by the 3D cam each frame). */
  view: { current: CamView | null };
  /** Tools from supply drops lying on the map (the frame's `tools`). */
  tools?: readonly { at: [number, number]; kind: ToolKind }[];
}

export function Visor({ agent, team, mapId, view, tools = [] }: VisorProps) {
  const def = mapV2(mapId);
  const item = def?.item ?? 'Item';
  const deliverTo = def?.deliverTo ?? 'Drop point';
  const exit = def?.exit ?? null;
  const tape = useRef<HTMLDivElement>(null);
  const ticks = useRef<HTMLDivElement>(null);
  const mark = useRef<HTMLDivElement>(null);
  // Which tools get a pip follows the agent's tile; where each pip sits follows the view every frame.
  const near = nearMarks({ x: agent.x, z: agent.y }, 0, tools, TOOL_RANGE, TOOL_PIPS).map((m) => m.of);
  const nearKey = near.map((t) => `${t.kind}@${t.at[0]},${t.at[1]}`).join('|');
  const pips = useRef<(HTMLDivElement | null)[]>([]);
  const nearRef = useRef(near);
  nearRef.current = near;
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
      if (v)
        nearRef.current.forEach((t, i) => {
          const el = pips.current[i];
          if (!el) return;
          const b = bearingTo({ x: v.x, z: v.z }, { x: t.at[0], z: t.at[1] }, v.yaw);
          const m = tapeMark(b.rel, CELL, tw);
          el.style.transform = `translateX(calc(-50% + ${m.x.toFixed(1)}px))`;
          const label = `${m.off === 'left' ? '◂ ' : ''}${TOOL_INFO[t.kind].name} · ${Math.round(b.dist)} m${m.off === 'right' ? ' ▸' : ''}`;
          if (el.dataset.label !== label) {
            el.dataset.label = label;
            const span = el.lastElementChild;
            if (span) span.textContent = label;
          }
        });
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
      {near.map((t, i) => (
        <div
          key={`${nearKey}#${i}`}
          ref={(el) => {
            pips.current[i] = el;
          }}
          className={c.pip}
          style={{ '--tc': TOOL_INFO[t.kind].colour } as CSSProperties}
          data-testid="v2-visor-tool"
          data-kind={t.kind}
        >
          <ToolIcon kind={t.kind} size={12} />
          <span>{TOOL_INFO[t.kind].name}</span>
        </div>
      ))}
      {agent.tool ? (
        <div className={c.kit} data-testid="v2-visor-kit">
          <ToolIcon kind={agent.tool} size={18} />
          <span>
            <b>Kit · {TOOL_INFO[agent.tool].name}</b>
            {TOOL_INFO[agent.tool].line}
          </span>
        </div>
      ) : null}
      <div className={c.reticle} aria-hidden="true" />
      <p className={c.voice} aria-live="polite" data-testid="v2-visor-voice">
        <span>{voice.kick}</span>
        {voice.text}
      </p>
    </div>
  );
}
