'use client';
// The 3D chase cam as a component, for next/dynamic:
//   const ChaseCam = dynamic(() => import('@/features/arena/chase3d/ChaseCam'), { ssr: false });
//   <ChaseCam getState={...} onFail={() => setUse3d(false)} />
// Without a className it fills its positioned parent; a className must size and position it.
// Reduced motion comes from the viewer's preferences.
import { useEffect, useRef } from 'react';
import { usePreferences } from '@/lib/preferences';
import { mountChaseCam, type ChaseCamState } from './index';

export interface ChaseCamProps {
  /** Read every frame; return null to draw nothing. Keep it stable or read refs inside it. */
  getState: () => ChaseCamState | null;
  onFail?: (err: unknown) => void;
  className?: string;
}

export default function ChaseCam({ getState, onFail, className }: ChaseCamProps) {
  const { reducedMotion } = usePreferences();
  const host = useRef<HTMLDivElement>(null);
  const read = useRef(getState);
  read.current = getState;
  const fail = useRef(onFail);
  fail.current = onFail;
  const still = useRef(reducedMotion);
  still.current = reducedMotion;
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    return mountChaseCam(el, () => read.current(), { onFail: (err) => fail.current?.(err), still: () => still.current });
  }, []);
  return <div ref={host} className={className} style={className ? undefined : FILL} data-testid="chase-cam" aria-hidden="true" />;
}

const FILL = { position: 'absolute', inset: 0, overflow: 'hidden' } as const;
