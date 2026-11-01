'use client';
// The arena's shared state: which map it shows. One store per tab, read by the arena canvas and by
// screens that change the map (the Atlas). Defaults to today's ranked rotation map.
import { useSyncExternalStore } from 'react';
import type { LiveArena } from './live';
import type { MatchCamMode } from './scene';
import { ROTATION_INDEX } from './world';

export interface ArenaStateSnapshot {
  /** Index into MAPS. */
  mapIdx: number;
  /** Bumped when the map changes, so the tiles drop in again. */
  introAt: number;
  /** A live match drawn instead of the map, with the map whose look it borrows. */
  live: { arena: LiveArena; look: string; at: number } | null;
  /** The live match camera: overview, following an agent, the intro, or 2D third person. */
  view: ArenaView;
}

export interface ArenaView {
  mode: MatchCamMode;
  /** Agent id the camera follows (follow and tpv). */
  focus: string | null;
}

export const OVERVIEW: ArenaView = { mode: 'overview', focus: null };

export interface ArenaStore {
  get(): ArenaStateSnapshot;
  setMap(idx: number): void;
  /** Draw a live match (null goes back to the map). */
  setLive(arena: LiveArena | null, look?: string): void;
  /** Point the live match camera (back to the overview when the match screen leaves). */
  setView(view: ArenaView): void;
  subscribe(l: () => void): () => void;
}

export function createArenaStore(): ArenaStore {
  let snap: ArenaStateSnapshot = { mapIdx: ROTATION_INDEX, introAt: 0, live: null, view: OVERVIEW };
  const ls = new Set<() => void>();
  return {
    get: () => snap,
    setMap(idx) {
      if (idx === snap.mapIdx) return;
      snap = { ...snap, mapIdx: idx, introAt: snap.introAt + 1 };
      for (const l of [...ls]) l();
    },
    setLive(arena, look = 'saltmarsh-weir') {
      if (!arena && !snap.live) return;
      snap = { ...snap, live: arena ? { arena, look, at: Date.now() } : null };
      for (const l of [...ls]) l();
    },
    setView(view) {
      if (view.mode === snap.view.mode && view.focus === snap.view.focus) return;
      snap = { ...snap, view };
      for (const l of [...ls]) l();
    },
    subscribe(l) {
      ls.add(l);
      return () => ls.delete(l);
    },
  };
}

let shared: ArenaStore | null = null;
export function arenaStore(): ArenaStore {
  return (shared ??= createArenaStore());
}

export function useArena(
  store: ArenaStore = arenaStore(),
): ArenaStateSnapshot & { setMap(idx: number): void; setLive: ArenaStore['setLive']; setView: ArenaStore['setView'] } {
  const snap = useSyncExternalStore(store.subscribe, store.get, store.get);
  return { ...snap, setMap: store.setMap, setLive: store.setLive, setView: store.setView };
}
