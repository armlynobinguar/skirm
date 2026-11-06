'use client';
// Keys that work on every shell screen (the prototype's keydown handler). Mounted once in AppShell.
//   N       toggles the design notes (notes.ts).
//   Escape  closes the top-most thing, in order: an open modal (the @skirm/ui Modal closes itself),
//           then an escape layer a screen registered with useEscapeLayer (the match-found takeover,
//           the match intro, third person, and last the live match itself, which only swallows the
//           key so Escape never leaves a match in play), then a screen's own Escape handler (it calls
//           preventDefault, e.g. a skill picker or a queue search), and only then goes Back
//           (screenOf(path).back, the same target as the top bar's Back button).
// Keys typed into a field, or pressed with Ctrl/Cmd/Alt, are left alone.
// useStartKey is the Enter/Space "tap" for screens with one big start action (the Boot screen
// outside the shell, Enter only since S01 scrolls; the match intro's skip).
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { screenOf } from '@/lib/routes';
import { useSfx } from '@/lib/sfx';
import { notesStore } from './notes';
import { matchBack } from '@/lib/match-origin';
import { config } from '@/lib/config';

/** Escape layers, handled first to last: the first active one takes the key. */
export const ESCAPE_LAYERS = ['takeover', 'intro', 'tpv', 'match'] as const;
export type EscapeLayer = (typeof ESCAPE_LAYERS)[number];

interface LayerEntry {
  layer: EscapeLayer;
  onEscape: { current: (() => void) | undefined };
}
const layers = new Set<LayerEntry>();

/** The active layer Escape goes to, if any (exported for tests). */
export function topEscapeLayer(): EscapeLayer | null {
  return topEntry()?.layer ?? null;
}

function topEntry(): LayerEntry | null {
  let best: LayerEntry | null = null;
  for (const e of layers) {
    if (!best || ESCAPE_LAYERS.indexOf(e.layer) < ESCAPE_LAYERS.indexOf(best.layer)) best = e;
  }
  return best;
}

/**
 * While `active`, Escape goes to `onEscape` instead of Back. Without `onEscape` the layer only
 * swallows Escape (the match-found takeover: decide with its buttons, not by leaving).
 */
export function useEscapeLayer(layer: EscapeLayer, active: boolean, onEscape?: () => void): void {
  const ref = useRef(onEscape);
  ref.current = onEscape;
  useEffect(() => {
    if (!active) return;
    const entry: LayerEntry = { layer, onEscape: ref };
    layers.add(entry);
    return () => {
      layers.delete(entry);
    };
  }, [layer, active]);
}

/** A field that takes typing (keys there are text, not commands). */
export function isTypingTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  return t.isContentEditable || t.matches('input, textarea, select');
}

/** A control that already acts on Enter/Space itself. */
function isActivatable(t: EventTarget | null): boolean {
  return t instanceof HTMLElement && !!t.closest('button, a[href], summary, [role="button"], [role="link"]');
}

function modalOpen(): boolean {
  return !!document.querySelector('[role="dialog"][aria-modal="true"]');
}

/**
 * While `active`, Enter (and Space, unless `space` is false: on a page that scrolls, Space should
 * scroll) anywhere outside fields and buttons, which act on their own, runs `onStart`.
 */
export function useStartKey(active: boolean, onStart: () => void, { space = true }: { space?: boolean } = {}): void {
  const ref = useRef(onStart);
  ref.current = onStart;
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' && !(space && e.key === ' ')) return;
      if (e.defaultPrevented || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      if (isTypingTarget(e.target) || isActivatable(e.target) || modalOpen()) return;
      e.preventDefault();
      ref.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, space]);
}

export function GlobalKeys() {
  const router = useRouter();
  const pathname = usePathname() ?? '/';
  const sfx = useSfx();
  const backRef = useRef<string | null>(null);
  backRef.current = screenOf(pathname)?.back ?? null;
  const goBack = useRef<(to: string) => void>(() => {});
  goBack.current = (to) => {
    sfx.play('click');
    router.push(to);
  };

  useEffect(() => {
    // Capture phase, so this sees the page before anything else reacts to the key (the Modal
    // closes on its own listener; after it, the dialog may already be gone).
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      if (isTypingTarget(e.target)) return;
      if (config.designNotes && (e.key === 'n' || e.key === 'N')) {
        if (e.repeat) return;
        notesStore.toggle();
        sfx.play('click');
        return;
      }
      if (e.key !== 'Escape' || modalOpen()) return;
      const layer = topEntry();
      if (layer) {
        e.preventDefault();
        layer.onEscape.current?.();
        return;
      }
      const back = backRef.current;
      if (!back) return;
      // A screen's own Escape handler (an open picker, a queue search) calls preventDefault when it
      // uses the key; it runs after this listener, so decide once the event has gone through.
      setTimeout(() => {
        if (!e.defaultPrevented && backRef.current === back) goBack.current(matchBack(window.location.pathname, back));
      }, 0);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [sfx]);

  return null;
}
