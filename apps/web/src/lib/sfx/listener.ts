// Where match sounds are heard from: while the visor is on, the watched agent's ears (its tile and
// the way the view faces), so voices, footfalls and coughs come from their side and fade with
// distance. Null: no listener, every sound centred (the board and the chase cam).
// The visor sets it every frame and clears it when it closes; the arena reads it when it plays a
// frame's sounds.

export interface Listener {
  x: number;
  z: number;
  yaw: number;
}

let current: Listener | null = null;

export function setListener(l: Listener | null): void {
  current = l;
}

export function listener(): Listener | null {
  return current;
}
