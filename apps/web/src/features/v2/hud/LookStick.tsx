'use client';
// The visor's look stick for phones and tablets: a round pad that turns and tilts the view while a
// thumb holds it off centre (chase3d/visor stickOf: a dead zone, clamped at the rim). It writes the
// deflection into `stick` for the 3D cam to read every frame; letting go zeroes it and the view
// springs back. Shown on touch screens only (a mouse drags the view instead).
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { stickOf, type Stick } from '@/features/arena/chase3d/visor';
import c from './lookstick.module.css';

export function LookStick({ stick }: { stick: { current: Stick | null } }) {
  const pad = useRef<HTMLDivElement>(null);
  const [knob, setKnob] = useState<Stick>({ x: 0, y: 0 });
  const [held, setHeld] = useState(false);
  // Closing the visor mid-push leaves nothing held.
  useEffect(
    () => () => {
      stick.current = null;
    },
    [stick],
  );
  const read = (e: ReactPointerEvent) => {
    const r = pad.current?.getBoundingClientRect();
    if (!r) return;
    const s = stickOf(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2), r.width / 2 || 1);
    stick.current = s;
    // The knob follows the thumb to the rim.
    const dx = e.clientX - (r.left + r.width / 2);
    const dy = e.clientY - (r.top + r.height / 2);
    const m = Math.hypot(dx, dy);
    const k = m > r.width / 2 ? r.width / 2 / m : 1;
    setKnob({ x: dx * k, y: dy * k });
  };
  const end = () => {
    stick.current = null;
    setHeld(false);
    setKnob({ x: 0, y: 0 });
  };
  return (
    <div
      ref={pad}
      className={c.pad}
      data-held={held || undefined}
      role="presentation"
      aria-hidden="true"
      data-testid="v2-visor-stick"
      onPointerDown={(e) => {
        e.preventDefault();
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          // Synthetic pointers (tests) refuse capture; the stick still works.
        }
        setHeld(true);
        read(e);
      }}
      onPointerMove={(e) => {
        if (held) read(e);
      }}
      onPointerUp={end}
      onPointerCancel={end}
      onLostPointerCapture={end}
    >
      <span className={c.ring} />
      <span className={c.knob} style={{ transform: `translate(calc(-50% + ${knob.x}px), calc(-50% + ${knob.y}px))` }} />
      <span className={c.label}>Look</span>
    </div>
  );
}
