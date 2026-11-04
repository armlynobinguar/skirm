'use client';
// Highlight moments of an ended match (GET /v2/matches/:id/highlights): the goal delivered, switch
// floods, supply drop fights and lead changes, each with its caster line.
//   HighlightStrip → over the replay HUD: a jump button per moment, and the caster line of the
//                    moment the playback is in.
//   HighlightList  → on the debrief and a shared link: each moment with a link that opens the
//                    replay there (`onJump` or `href`).
import { TICK_MS } from '@skirm/engine/v2';
import { Button } from '@skirm/ui';
import { ButtonLink } from '@/components/ButtonLink';
import type { ReplayHighlight } from '@/lib/api/types';
import { clock } from '../v2/hud/model';
import r from './replays.module.css';

export const tickClock = (tick: number) => clock((tick * TICK_MS) / 1000);

/** The highlight whose clip the playback is in, if any (the latest one starting at or before the tick). */
export function highlightAt(highlights: readonly ReplayHighlight[], tick: number): ReplayHighlight | null {
  let at: ReplayHighlight | null = null;
  for (const h of highlights) if (h.start <= tick && tick <= h.end) at = h;
  return at;
}

export function HighlightStrip({ highlights, tick, onJump, caster }: { highlights: readonly ReplayHighlight[]; tick: number; onJump: (h: ReplayHighlight) => void; caster?: 'model' | 'template' | null }) {
  if (!highlights.length) return null;
  const now = highlightAt(highlights, tick);
  return (
    <>
      <nav className={r.strip} aria-label="Highlights" data-testid="replay-highlights">
        {highlights.map((h) => (
          <button key={h.id} type="button" className={r.jump} data-team={h.team ?? undefined} data-on={now?.id === h.id || undefined} onClick={() => onJump(h)} title={h.facts} data-testid={`replay-jump-${h.id}`}>
            <b>{h.title}</b>
            <small>
              {tickClock(h.tick)} · {h.score.A}–{h.score.B}
            </small>
          </button>
        ))}
      </nav>
      {now ? (
        <p className={r.cast} aria-live="polite" data-testid="replay-cast">
          <small>{caster === 'model' ? 'Caster' : 'Caster · offline'}</small>
          {now.line}
        </p>
      ) : null}
    </>
  );
}

export function HighlightList({ highlights, hrefOf, onJump }: { highlights: readonly ReplayHighlight[]; hrefOf?: (h: ReplayHighlight) => string; onJump?: (h: ReplayHighlight) => void }) {
  return (
    <ol className={r.list} data-testid="highlight-list">
      {highlights.map((h) => (
        <li key={h.id} style={{ color: h.team === 'B' ? 'var(--rival)' : h.team === 'A' ? 'var(--you)' : undefined }}>
          <span className={r.tk}>{tickClock(h.tick)}</span>
          <span className={r.line}>
            <b>{h.title}</b>
            <span>{h.line}</span>
          </span>
          {onJump ? (
            <Button size="sm" onClick={() => onJump(h)} data-testid={`highlight-watch-${h.id}`}>
              Watch
            </Button>
          ) : hrefOf ? (
            <ButtonLink size="sm" href={hrefOf(h)} data-testid={`highlight-watch-${h.id}`}>
              Watch
            </ButtonLink>
          ) : null}
        </li>
      ))}
    </ol>
  );
}
