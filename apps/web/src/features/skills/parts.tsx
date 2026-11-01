'use client';
// Small pieces shared by S07-S10. Public skill facts only: nothing here ever takes prompt text.
import { Badge } from '@skirm/ui';
import { useEffect, useRef, type PointerEvent } from 'react';
import type { Tag } from '@skirm/shared';
import * as proto from '@/features/arena/proto/world';
import type { SkillStatus } from '@/lib/api/types';
import { usePreferences } from '@/lib/preferences';
import { STATUS_ICON } from './lib';

// ---------- Exchange card rarity, art and tilt (the prototype's .sc cards) ----------

export type RarityKey = 'unrated' | 'starter' | 'draft';

export interface Rarity {
  key: RarityKey;
  label: string;
  /** Card accent (the prototype's per-skill `rc`). */
  colour: string;
  /** What the label means, shown as the chip's title. */
  band: string;
}

/** A card's corner chip and accent: an account-bound starter, a draft, or a minted version. */
export function rarityOf(o: { accountBound: boolean; status: SkillStatus }): Rarity {
  if (o.accountBound) return { key: 'starter', label: 'Starter', colour: '#93a4b1', band: 'account-bound starter' };
  if (o.status === 'Draft') return { key: 'draft', label: 'Draft', colour: '#ffb547', band: 'not minted' };
  return { key: 'unrated', label: 'Unrated', colour: '#7d8f9c', band: 'fewer than 5 public runs' };
}

/** The arena piece a card's art shows for its first tag (the prototype's tag → thing table). */
const TAG_THING: Record<Tag, string> = {
  spreads: 'fire',
  liquid: 'water',
  damages: 'lava',
  solid: 'block',
  blocks: 'wall',
  pushable: 'crate',
  breakable: 'dirt',
  flammable: 'grass',
  collectible: 'item',
  goal: 'exit',
};

/** A card's art band: a 3×3 isometric patch in a map's palette with the tag's piece on it (P drawArts). */
export function SkillArt({ name, tag, className }: { name: string; tag: Tag | undefined; className?: string }) {
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
      const T = r.height * 0.55;
      const maps = proto.MAPS as { pal2: unknown }[];
      const pal = maps[(name.length * 3) % maps.length]!.pal2;
      const thing = tag ? TAG_THING[tag] : 'block';
      for (let y = 0; y < 3; y++)
        for (let x = 0; x < 3; x++) {
          const sx = r.width * 0.62 + ((x - y) * T) / 2;
          const sy = r.height * 0.38 + ((x + y) * T) / 4;
          proto.cube(ctx, sx, sy, T, T * 0.1, (x + y) % 2 ? '#22303a' : '#1d2a33', 1, undefined);
          if ((x === 1 && y === 1) || proto.hash(x + name.length, y) > 0.74)
            proto.drawThing(ctx, thing, x, y, sx, sy - T * 0.1, T, pal, 1.3, null, null);
        }
    };
    draw();
    window.addEventListener('resize', draw);
    return () => window.removeEventListener('resize', draw);
  }, [name, tag]);
  return <canvas ref={ref} className={className} aria-hidden="true" />;
}

/** Pointer tilt for a card (P: rotate up to 6° toward the pointer). Off under reduced motion. */
export function useTilt(): { onPointerMove?: (e: PointerEvent<HTMLElement>) => void; onPointerLeave?: (e: PointerEvent<HTMLElement>) => void } {
  const { reducedMotion } = usePreferences();
  if (reducedMotion) return {};
  return {
    onPointerMove: (e) => {
      const el = e.currentTarget;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) return;
      const x = (e.clientX - r.left) / r.width - 0.5;
      const y = (e.clientY - r.top) / r.height - 0.5;
      el.style.transform = `rotateY(${x * 12}deg) rotateX(${-y * 12}deg) translateZ(10px)`;
    },
    onPointerLeave: (e) => {
      e.currentTarget.style.transform = '';
    },
  };
}

/** "0x1a2b3c4d": the short form of a prompt hash the prototype prints on the version lock. */
export function shortHash(sha256: string): string {
  return `0x${sha256.slice(0, 8)}`;
}

export function StatusBadge({ status }: { status: SkillStatus }) {
  return (
    <Badge icon={STATUS_ICON[status]} tone={status === 'Draft' ? 'neutral' : 'good'}>
      {status}
    </Badge>
  );
}
