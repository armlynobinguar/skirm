// Which arena scene each screen shows, and the camera for it (the prototype's camFor). The arena
// canvas stays mounted behind every screen; only the camera and the dimming change between them.

export type ArenaScene =
  | 'boot'
  | 'lobby'
  | 'maps'
  | 'hub'
  | 'crew'
  | 'agent'
  | 'match'
  /** The live match with the camera on one agent (click a card). */
  | 'follow'
  /** The map entrance cutscene before a live match: a sweep across the map (setIntroSweep), else pulled far out with a slow ease. */
  | 'intro'
  /** 2D third person: tilted in close on one agent. */
  | 'tpv'
  | 'result'
  | 'market';

/** How the live match screen wants the camera (arena store `view`); the route still says 'match'. */
export type MatchCamMode = 'overview' | 'follow' | 'intro' | 'tpv';

export interface Camera {
  /** Focus point as a fraction of the viewport. */
  fx: number;
  fy: number;
  zoom: number;
  /** Opacity of the ink layer over the arena (0 = arena fully visible). */
  dim: number;
}

/** Scene for a screen key from screenOf() (lib/routes.ts); null keeps the arena dimmed as on Exchange. */
export function sceneForScreen(key: string | null | undefined): ArenaScene {
  switch (key) {
    case 'home':
      return 'lobby';
    case 'maps':
      return 'maps';
    case 'pvp':
    case 'ladder':
      return 'hub';
    case 'crew':
      return 'crew';
    case 'agent':
      return 'agent';
    case 'match':
      return 'match';
    case 'match-result':
      return 'result';
    default:
      return 'market';
  }
}

/** The match screen's camera mode applied to the route's scene (only a live match changes). */
export function sceneForMatchView(scene: ArenaScene, mode: MatchCamMode): ArenaScene {
  return scene === 'match' && mode !== 'overview' ? mode : scene;
}

/**
 * The intro's camera sweep (Intro.tsx starts it, never with reduced motion): the wall time it began,
 * or null for the plain slow pull-out. Module state, so the canvas's frame loop reads it per frame.
 */
let introSweepAt: number | null = null;
/** How long the sweep runs before the camera rests on the board (when the crews land). */
export const INTRO_SWEEP_MS = 4600;

/** Starts (wall ms) or stops (null) the intro's sweep. */
export function setIntroSweep(at: number | null): void {
  introSweepAt = at;
}

const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const smooth = (k: number) => {
  const t = Math.min(1, Math.max(0, k));
  return t * t * (3 - 2 * t);
};

/**
 * The sweep: in close on one end of the map, a slow diagonal pan across it while pulling back, then a
 * settle onto the overview camera so the hand-over to the live board does not jump.
 */
function sweepCamera(narrow: boolean, ms: number): Camera {
  const t = ms / INTRO_SWEEP_MS;
  const pan = smooth(t / 0.74);
  const settle = smooth((t - 0.74) / 0.26);
  const from = narrow ? { fx: 0.84, fy: 0.5, zoom: 2.1 } : { fx: 0.8, fy: 0.62, zoom: 1.8 };
  const to = narrow ? { fx: 0.16, fy: 0.36, zoom: 1.6 } : { fx: 0.2, fy: 0.46, zoom: 1.3 };
  const end = cameraFor('match', narrow);
  const mid = { fx: lerp(from.fx, to.fx, pan), fy: lerp(from.fy, to.fy, pan), zoom: lerp(from.zoom, to.zoom, pan) };
  return { fx: lerp(mid.fx, end.fx, settle), fy: lerp(mid.fy, end.fy, settle), zoom: lerp(mid.zoom, end.zoom, settle), dim: 0 };
}

/** The prototype's camera per scene; `narrow` is a viewport under 820px. `now` (wall ms) drives the intro sweep. */
export function cameraFor(scene: ArenaScene, narrow: boolean, now: number = Date.now()): Camera {
  switch (scene) {
    case 'boot':
      return { fx: 0.5, fy: 0.58, zoom: 1.25, dim: 0.62 };
    case 'lobby':
      return { fx: narrow ? 0.5 : 0.62, fy: 0.6, zoom: 1.05, dim: 0.66 };
    case 'maps':
      return { fx: 0.5, fy: narrow ? 0.28 : 0.56, zoom: narrow ? 0.9 : 1.05, dim: 0.45 };
    case 'hub':
      return { fx: 0.5, fy: 0.5, zoom: 1.3, dim: 0.84 };
    case 'crew':
      return { fx: 0.5, fy: 0.5, zoom: 1.4, dim: 0.86 };
    case 'agent':
      return { fx: narrow ? 0.5 : 0.66, fy: 0.6, zoom: 1.15, dim: 0.74 };
    case 'match':
      return { fx: narrow ? 0.5 : 0.44, fy: narrow ? 0.42 : 0.54, zoom: narrow ? 1.3 : 0.92, dim: 0 };
    case 'follow':
      return { fx: narrow ? 0.5 : 0.44, fy: narrow ? 0.42 : 0.54, zoom: 1.6, dim: 0 };
    case 'intro':
      if (introSweepAt != null) return sweepCamera(narrow, now - introSweepAt);
      return { fx: narrow ? 0.5 : 0.44, fy: narrow ? 0.42 : 0.54, zoom: 0.5, dim: 0 };
    case 'tpv':
      return { fx: 0.5, fy: 0.64, zoom: narrow ? 2.6 : 2.25, dim: 0 };
    case 'result':
      return { fx: 0.3, fy: 0.55, zoom: 1.1, dim: 0.66 };
    case 'market':
      return { fx: 0.5, fy: 0.5, zoom: 1.5, dim: 0.9 };
  }
}

/** Room the arena is fitted into before zoom (the prototype's availW / availH). */
export function fitBox(scene: ArenaScene, vw: number, vh: number): { w: number; h: number } {
  const narrow = vw < 820;
  // The compact HUD leaves the live board about 300px of height on desktop (top row plus card row);
  // third person keeps the older, tighter fit its tilt was tuned for.
  if (scene === 'match' || scene === 'follow' || scene === 'intro')
    return { w: narrow ? vw * 0.96 : vw - 420, h: vh - (narrow ? 420 : 300) };
  if (scene === 'tpv') return { w: narrow ? vw * 0.96 : vw - 420, h: vh - (narrow ? 420 : 380) };
  if (scene === 'maps') return { w: vw * 0.9, h: vh * (narrow ? 0.42 : 0.8) };
  return { w: vw * 0.9, h: vh * 0.8 };
}

/** How fast the camera eases toward a scene (the intro drifts in slowly; its sweep tracks closer). */
export function easeRateFor(scene: ArenaScene): number {
  if (scene === 'intro') return introSweepAt != null ? 2.4 : 0.75;
  return 4.2;
}

/** Eases the camera toward its target (exponential, frame-rate independent). */
export function stepCamera(cam: Camera, target: Camera, dt: number, rate = 4.2): Camera {
  const k = 1 - Math.exp(-dt * rate);
  return {
    fx: cam.fx + (target.fx - cam.fx) * k,
    fy: cam.fy + (target.fy - cam.fy) * k,
    zoom: cam.zoom + (target.zoom - cam.zoom) * k,
    dim: cam.dim + (target.dim - cam.dim) * k,
  };
}
