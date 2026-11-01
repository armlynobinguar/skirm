'use client';
// A still thumbnail of a map's arena at rest (the prototype's miniMap), for atlas cards.
import { useEffect, useRef } from 'react';
import * as proto from './proto/world';
import { restingState, type V2Map } from './world';

export function MiniMap({ map, className }: { map: V2Map; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    const ctx = cv?.getContext('2d');
    if (!cv || !ctx) return;
    const draw = () => {
      const r = cv.getBoundingClientRect();
      if (!r.width) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      cv.width = r.width * dpr;
      cv.height = r.height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const A = map.A;
      const T = proto.fitT(A, r.width * 1.05, r.height * 1.05);
      const cxm = (A.w - 1) / 2;
      const cym = (A.h - 1) / 2;
      const pal = (map as unknown as { pal2: unknown }).pal2;
      proto.renderArena(ctx, A, pal, null, restingState(map), 1, T, r.width / 2 - ((cxm - cym) * T) / 2, r.height * 0.5 - ((cxm + cym) * T) / 4, 1, { intro: 9 });
    };
    draw();
    window.addEventListener('resize', draw);
    return () => window.removeEventListener('resize', draw);
  }, [map]);
  return <canvas ref={ref} className={className} aria-hidden="true" />;
}
