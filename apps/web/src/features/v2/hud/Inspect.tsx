'use client';
// Click anything on the live board to see what it is (inspectInfo.ts): a tile in the map's own words
// and what it does, or an agent with its crew, role, status and load (and a button to watch it in
// third person). A click elsewhere on the board inspects that instead; a click off the board, the ×
// or Escape closes it. Off while the player steers an agent (a click walks it there) and in third
// person (the board is tilted there).
import { Button } from '@skirm/ui';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { tileAtPoint } from '@/features/arena/pick';
import type { V2Frame } from '@/lib/realtime/protocol';
import c from './hud.module.css';
import { inspectTile, type Inspected } from './inspectInfo';

export interface InspectProps {
  frame: V2Frame | null;
  tickMs: number;
  /** False while the player steers an agent or watches in third person. */
  enabled: boolean;
  onWatch: (agentId: string) => void;
}

const TONE: Record<Inspected['tone'], string> = {
  you: 'var(--you)',
  rival: 'var(--rival)',
  hazard: 'var(--fire, #ff7a2a)',
  goal: 'var(--amber)',
  plain: 'var(--muted)',
};

export function Inspect({ frame, tickMs, enabled, onWatch }: InspectProps) {
  const [open, setOpen] = useState<{ at: [number, number]; px: number; py: number } | null>(null);
  const frameRef = useRef(frame);
  frameRef.current = frame;

  useEffect(() => {
    if (!enabled) {
      setOpen(null);
      return;
    }
    const onClick = (e: MouseEvent) => {
      const t = e.target as Element | null;
      if (t?.closest?.('button, a, input, select, textarea, label, [role="dialog"], .sk-panel, .app-topbar')) return;
      const at = tileAtPoint(e.clientX, e.clientY);
      setOpen(at && frameRef.current ? { at, px: e.clientX, py: e.clientY } : null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpen((o) => {
        if (o) e.preventDefault();
        return null;
      });
    };
    window.addEventListener('click', onClick);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('click', onClick);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [enabled]);

  if (!open || !frame) return null;
  // Read live: the tile or agent as this frame shows it now.
  const info = inspectTile(frame, open.at[0], open.at[1], tickMs);
  if (!info) return null;
  // Beside the click, kept on screen.
  const vw = typeof window === 'undefined' ? 1280 : window.innerWidth;
  const vh = typeof window === 'undefined' ? 800 : window.innerHeight;
  const left = Math.min(Math.max(12, open.px + 16), vw - 292);
  const top = Math.min(Math.max(72, open.py - 24), vh - 220);
  return (
    <div className={`sk-panel ${c.inspect}`} role="dialog" aria-label={info.title} style={{ left, top, '--c': TONE[info.tone] } as CSSProperties} data-testid="v2-inspect">
      <div className={c.inspHd}>
        <span className="sk-kick">{info.kind}</span>
        <button type="button" className={c.inspX} onClick={() => setOpen(null)} aria-label="Close" data-testid="v2-inspect-close">
          ×
        </button>
      </div>
      <b className={c.inspTitle}>{info.title}</b>
      {info.lines.map((l) => (
        <p key={l}>{l}</p>
      ))}
      <span className={c.inspAt}>
        Tile {open.at[0]}, {open.at[1]}
      </span>
      {info.agentId ? (
        <Button
          size="sm"
          onClick={() => {
            onWatch(info.agentId!);
            setOpen(null);
          }}
          data-testid="v2-inspect-watch"
        >
          Watch in 3rd person
        </Button>
      ) : null}
    </div>
  );
}
