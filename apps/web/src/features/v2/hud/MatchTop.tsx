'use client';
// The live HUD's top row: your crew box, the clock (time left, the hazard line, switches, the next
// supply drop and the difficulty's goal tag) and the rival's box (the prototype's hud()). A spectator
// sees two crews by letter and handle, never "You" and "Rival".
import { mapV2, type Difficulty, type FrameAgent, type Team, type V2Frame } from '@skirm/engine/v2';
import type { CSSProperties, ReactNode } from 'react';
import { crewName } from '../common';
import c from './hud.module.css';
import { clock, clockLine, fieldHazards, goalTag } from './model';

export interface MatchTopProps {
  frame: V2Frame | null;
  team: Team;
  ranked: boolean;
  difficulty: Difficulty;
  tickMs: number;
  /** Your handle, and the rival's once the match started. */
  you: string | null;
  rivalHandle: string | null;
  /** Rival agents seen so far (names show once seen). */
  rivals: FrameAgent[];
  /** Spectating: `you` and `rivalHandle` are crew A's and crew B's handles, when known. */
  watch?: boolean;
  /** Practice against the greedy bot (the clock line says so). */
  practice?: boolean;
  /** Drawn under the clock card (the live callout), so it never covers the clock. */
  children?: ReactNode;
}

export function MatchTop({ frame, team, ranked, difficulty, tickMs, you, rivalHandle, rivals, watch = false, practice = false, children }: MatchTopProps) {
  const them: Team = team === 'A' ? 'B' : 'A';
  const def = frame ? mapV2(frame.mapId) : undefined;
  const goal = frame?.goal ?? def?.goal ?? 3;
  const mine = frame?.agents.filter((a) => a.team === team) ?? [];
  const seen = frame?.agents.filter((a) => a.team === them) ?? [];
  const line = frame ? clockLine(frame, team, difficulty, tickMs) : null;
  const tag = frame ? goalTag(frame.mapId, difficulty) : null;
  const field = frame ? fieldHazards(frame) : [];
  const tick = frame?.tick ?? 0;
  const limit = frame?.limit ?? 150;
  // A crew's head start is the other crew's hold at the start.
  const head = (t: Team) => {
    const n = frame?.holdTicks[t === 'A' ? 'B' : 'A'] ?? 0;
    return n > 0 ? ` · +${Math.ceil((n * tickMs) / 1000)} s head start` : '';
  };
  return (
    <div className={c.mtop}>
      <div className={`sk-panel ${c.crewbox} ${c.boxA}`}>
        <span className="sk-kick" data-testid="v2-crew-label">
          {watch ? (
            <b>{crewName(team, you)}</b>
          ) : (
            <>
              <b>You</b>
              {you ? ` · ${you}` : ''} · {team}
            </>
          )}
        </span>
        <span className={c.crewT}>{mine.map((a) => a.name).join(' · ') || (watch ? `Crew ${team}` : 'Your crew')}</span>
        <Gems n={goal} filled={frame?.score[team] ?? 0} colour="var(--you)" />
        <span className="sk-kick" data-testid="v2-score-me">
          {frame?.score[team] ?? 0} / {goal} delivered · {mine.reduce((s, a) => s + a.items.length, 0)} carried
          {head(team)}
        </span>
      </div>
      <div className={c.mid}>
        <div className={`sk-panel ${c.clock}`}>
          <span className="sk-kick">
            {def?.code ?? 'v2'} · {ranked ? 'ranked' : practice ? 'practice' : 'casual'} · {watch ? 'watching · ' : ''}T{String(tick).padStart(3, '0')}
          </span>
          <span className={c.clockN} data-testid="v2-clock">
            {clock(line?.left ?? (limit * tickMs) / 1000)}
          </span>
          <span className={c.bar}>
            <i style={{ width: `${((limit - tick) / limit) * 100}%` }} />
          </span>
          {line ? (
            <span className={c.hzLine} data-testid="v2-hazard">
              {line.hazards.length
                ? line.hazards.map((h, i) => (
                    <span key={h.kind}>
                      {i ? ' · ' : ''}
                      <b>{h.kind}</b> {h.receding ? 'receding' : 'rising'} · next wave in {h.nextIn} s
                    </span>
                  ))
                : 'No hazard on this map'}
              {line.switches ? (
                <>
                  {' · switches '}
                  <span className={c.sw}>{line.switches.ready == null ? line.switches.total : `${line.switches.ready}/${line.switches.total} ready`}</span>
                </>
              ) : null}
              {line.dropIn != null ? ` · drop in ${line.dropIn} s` : null}
              {line.holding > 0 ? ` · holding ${line.holding} s` : null}
            </span>
          ) : null}
          {field.length ? (
            <span className={c.hzField} data-testid="v2-field-hazards">
              {field.map((h) => (
                <span key={h.key} className={c.hzChip} data-kind={h.key} data-live={h.live || undefined} title={h.hint} aria-label={`${h.name}: ${h.hint}`}>
                  <i />
                  {h.name}
                </span>
              ))}
            </span>
          ) : null}
          {tag ? (
            <span className={c.obj} title={tag.text} data-testid="v2-goal">
              <span className={c.dtag} style={{ '--dc': tag.colour } as CSSProperties}>
                {tag.name}
              </span>
              <b>{tag.title}</b>
              <span>{tag.text}</span>
              <i />
            </span>
          ) : null}
        </div>
        {children}
      </div>
      <div className={`sk-panel ${c.crewbox} ${c.boxB}`}>
        <span className="sk-kick" data-testid="v2-rival-label">
          {watch ? (
            <b className={c.r}>{crewName(them, rivalHandle)}</b>
          ) : (
            <>
              <span className={c.r}>Rival</span>
              {rivalHandle ? ` · ${rivalHandle}` : ''} · {them}
            </>
          )}
        </span>
        <span className={c.crewT}>{rivals.map((a) => a.name).join(' · ') || 'Unseen'}</span>
        <Gems n={goal} filled={frame?.score[them] ?? 0} colour="var(--rival)" />
        <span className="sk-kick" data-testid="v2-score-rival">
          {frame?.score[them] ?? 0} / {goal} delivered · {seen.length ? `${seen.length} in sight` : 'out of sight'}
          {head(them)}
        </span>
      </div>
    </div>
  );
}

function Gems({ n, filled, colour }: { n: number; filled: number; colour: string }) {
  return (
    <span className={c.gems} style={{ '--g': colour } as CSSProperties} aria-hidden="true">
      {Array.from({ length: n }, (_, i) => (
        <i key={i} data-f={i < filled || undefined} />
      ))}
    </span>
  );
}
