'use client';
// One agent drawn the arena way (the isometric block figure in its role's look, figure2d.ts): body
// in the agent's colour, head in its "bone" colour, standing on a small pad, idling. Used by the
// look editor, the crew lock-in and the match cards. Reduced motion draws one still frame.
import type { Dress } from '@skirm/ui';
import { useEffect, useRef } from 'react';
import { usePreferences } from '@/lib/preferences';
import * as proto from './proto/world';

export interface AgentPortraitProps {
  /** Body colour (hex). */
  body: string;
  /** Head colour (hex). */
  head: string;
  /** 'B' faces left and draws a red team ring; 'A' faces right with teal. Omit for no ring. */
  team?: 'A' | 'B';
  /** Accessible name, e.g. "Wick, Builder". */
  label: string;
  /** The agent's role (Builder, Digger, ...): its hat, tools and pack. Omit for the generic look. */
  role?: string;
  /** How its owner dressed it (hair, trousers, build, headgear). Omit for the role's plain look. */
  dress?: Dress;
  /** `hero`: the Command deck's lead agent (smaller figure left of centre, pulsing rings, a floating block). */
  variant?: 'portrait' | 'hero';
  className?: string;
  'data-testid'?: string;
}

export function AgentPortrait({ body, head, team, label, role, dress, variant = 'portrait', className, 'data-testid': testId }: AgentPortraitProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  const { reducedMotion } = usePreferences();

  useEffect(() => {
    const cv = ref.current;
    const ctx = cv?.getContext('2d');
    if (!cv || !ctx) return;
    let raf = 0;
    const t0 = performance.now();
    const draw = (now: number) => {
      const r = cv.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      if (cv.width !== Math.round(r.width * dpr)) cv.width = Math.round(r.width * dpr);
      if (cv.height !== Math.round(r.height * dpr)) cv.height = Math.round(r.height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, r.width, r.height);
      const time = reducedMotion ? 0 : (now - t0) / 1000;
      const hero = variant === 'hero';
      const T = hero ? Math.min(r.width * 0.6, r.height * 0.64) : Math.min(r.width * 0.9, r.height * 0.98);
      const sx = r.width * (hero ? 0.36 : 0.5);
      const b = r.height * (hero ? 0.84 : 0.88);
      if (hero) {
        // Rings pulsing out from under the agent (the prototype's drawHero).
        ctx.strokeStyle = 'rgba(52,224,200,.5)';
        ctx.lineWidth = 2;
        for (let i = 0; i < 3; i++) {
          const k = (time * 0.5 + i / 3) % 1;
          ctx.globalAlpha = reducedMotion ? 0.35 : 1 - k;
          ctx.beginPath();
          ctx.ellipse(sx, b, T * (0.25 + k * 0.25), T * (0.125 + k * 0.125), 0, 0, 7);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }
      proto.cube(ctx, sx, b + T * 0.03, T, T * 0.03, '#0f2a2a', 0.7, team === 'B' ? '#ff4655' : '#34e0c8');
      proto.drawAgent(
        ctx,
        sx,
        b,
        T,
        { c: body, bone: head, team: team ?? 'A', slot: 0, inv: [], role, ...(dress ? { dress } : {}) },
        time * 0.6,
        0,
        { ...(team ? { team: team === 'A' ? '#34e0c8' : '#ff4655' } : {}), still: reducedMotion },
      );
      if (hero) {
        const fy = b - T * 0.95 + Math.sin(time * 1.8) * T * 0.02;
        ctx.globalAlpha = 0.85;
        proto.cube(ctx, sx + T * 0.32, fy, T, T * 0.12, '#3b8f88', 0.22, '#7ff5e4');
        ctx.globalAlpha = 1;
      }
      if (!reducedMotion) raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
    // The dress is compared by value: callers build a fresh object each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [body, head, team, role, variant, reducedMotion, dress ? JSON.stringify(dress) : '']);

  return <canvas ref={ref} role="img" aria-label={label} className={className} data-testid={testId} />;
}
