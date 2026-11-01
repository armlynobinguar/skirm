// Third person in 3D (the prototype's Three.js chase cam): the camera sits behind the watched agent
// and turns with it; drag looks around and springs back, the wheel moves the camera in or out. It
// draws into its own canvas inside `el` and reads the match through `getState` every frame, so the
// live screen never pushes into it.
//
// This module stays free of `three`: mountChaseCam imports ./scene3d (which holds every `three` use)
// on first mount, so the bundler puts `three` in its own chunk. Mount it from ./ChaseCam with
// next/dynamic, or call mountChaseCam from client code; never import ./scene3d directly.
import type { LiveArena } from '../live';
import type { ArenaState } from '../world';

export interface ChaseCamState {
  /** The current frame as the arena draws it (tiles, agents, fog). */
  arena: LiveArena;
  /** The frame before it, to tween moves from (null on the first frame). */
  prev: ArenaState | null;
  /** Wall time (ms) the current frame arrived; moves ease over 400 ms from it. */
  at: number;
  /** Agent id the camera chases. */
  focus: string;
  /** v2 map id whose palette and scenery to use. */
  look: string;
  /** View-only pause: hold the picture. */
  paused?: boolean;
}

export interface ChaseCamOptions {
  /** WebGL or `three` failed: the caller falls back to the 2D third person. */
  onFail?: (err: unknown) => void;
  /** Read every frame: reduced motion (no bob, spin, flicker or weather, and the camera snaps). */
  still?: () => boolean;
}

/** Mounts the 3D chase cam into `el`; returns the unmount (removes the canvas, frees the GPU). */
export function mountChaseCam(el: HTMLElement, getState: () => ChaseCamState | null, opts: ChaseCamOptions = {}): () => void {
  let stop: (() => void) | null = null;
  let gone = false;
  const fail = (err: unknown) => {
    if (!gone) opts.onFail?.(err);
  };
  import('./scene3d').then((m) => {
    if (gone) return;
    try {
      stop = m.startChaseCam(el, getState, { ...opts, onFail: fail });
    } catch (err) {
      // No WebGL (or it was lost before the first frame).
      fail(err);
    }
  }, fail);
  return () => {
    gone = true;
    stop?.();
    stop = null;
  };
}
