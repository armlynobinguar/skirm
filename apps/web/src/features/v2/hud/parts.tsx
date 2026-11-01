'use client';
// Small pieces the live HUD shares: stroke icons (the heard-by ear, the map's item), inventory slots
// with their origin stripe, the callout, the 3-2-1-GO countdown and the VICTORY / DEFEAT banner.
import type { CSSProperties } from 'react';
import { EAR_D } from '@/features/arena/world';
import c from './hud.module.css';
import { ORIGIN, clock, itemIconOf, type Callout, type Slot } from './model';

export function StrokeIcon({ d, size = 24, className }: { d: string; size?: number; className?: string }) {
  return (
    <svg className={className} viewBox={`0 0 ${size} ${size}`} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

/** The heard-by ear (amber in the feed): talk a rival overheard, or rival talk you overheard. */
export function Ear() {
  return (
    <svg className={c.ear} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={EAR_D} />
    </svg>
  );
}

export function ItemIcon({ mapId }: { mapId: string }) {
  return <StrokeIcon d={itemIconOf(mapId)} />;
}

/** A card's small slots: the item icon with its origin stripe, empty, or "?" out of sight. */
export function SmallSlots({ slots, mapId, item, accent }: { slots: Slot[]; mapId: string; item: string; accent: string }) {
  return (
    <span className={c.inv} style={{ '--ic': accent } as CSSProperties}>
      {slots.map((s, i) => {
        if (s.state === 'unknown')
          return (
            <span key={i} className={c.slot} data-unknown="" title="Out of sight">
              ?
            </span>
          );
        if (s.state === 'empty') return <span key={i} className={c.slot} title="Empty slot" />;
        const o = s.item.origin ? ORIGIN[s.item.origin] : null;
        return (
          <span
            key={i}
            className={c.slot}
            data-full=""
            data-pop={s.fresh || undefined}
            title={o ? `${item} · ${o.label}` : item}
            style={o ? ({ '--oc': o.colour } as CSSProperties) : undefined}
          >
            <ItemIcon mapId={mapId} />
          </span>
        );
      })}
    </span>
  );
}

/** The third person's big slots: item, where it came from and when it was picked up. */
export function BigSlots({ slots, mapId, item, accent, limit, tickMs }: { slots: Slot[]; mapId: string; item: string; accent: string; limit: number; tickMs: number }) {
  return (
    <>
      {slots.map((s, i) => {
        if (s.state === 'unknown')
          return (
            <div key={i} className={c.islot}>
              <span className={c.slot} data-unknown="">
                ?
              </span>
              <span>
                <b>Unknown</b>
                <small>Out of your crew&apos;s sight</small>
              </span>
            </div>
          );
        if (s.state === 'empty')
          return (
            <div key={i} className={c.islot} data-empty="">
              <span className={c.slot} />
              <span>
                <b>Empty</b>
                <small>Slot {s.n}</small>
              </span>
            </div>
          );
        const o = s.item.origin ? ORIGIN[s.item.origin] : null;
        const at = s.item.tick != null ? ` · picked up at ${clock(((limit - s.item.tick) * tickMs) / 1000)}` : '';
        return (
          <div key={i} className={c.islot} data-pop={s.fresh || undefined} style={{ '--ic': accent, ...(o ? { '--oc': o.colour } : null) } as CSSProperties}>
            <span className={c.slot} data-full="">
              <ItemIcon mapId={mapId} />
            </span>
            <span>
              <b>{item}</b>
              <small>
                {o ? o.label : 'Carried'}
                {at}
              </small>
            </span>
          </div>
        );
      })}
    </>
  );
}

export function CalloutBar({ callout }: { callout: Callout | null }) {
  if (!callout) return null;
  return (
    <div className={c.callout} data-side={callout.side} role="status" data-testid="v2-callout">
      {callout.text}
    </div>
  );
}

/** 3, 2, 1, GO after the intro (or null when it is not counting). */
export function CountIn({ step }: { step: string | null }) {
  return <div className={c.count}>{step ? <span key={step}>{step}</span> : null}</div>;
}

export function Banner({ word }: { word: 'VICTORY' | 'DEFEAT' | 'DRAW' }) {
  return (
    <div className={c.banner} data-fail={word !== 'VICTORY' || undefined} role="status" data-testid="v2-banner">
      <span>{word}</span>
    </div>
  );
}
