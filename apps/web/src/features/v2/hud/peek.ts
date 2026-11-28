// Peeking through a teammate's visor: while you watch one of your own agents in the visor, hold Q
// (or press and hold a crewmate's button) to look through another crewmate's eyes; let go and the
// view comes back. Only your own crew: a rival's crewmates are behind its fog.
import type { FrameAgent, Team } from '@skirm/engine/v2';

/** The crewmates you can peek through from `watchedId`: your crew, still in the match, not itself. */
export function peekMates(agents: readonly FrameAgent[], watchedId: string | null, team: Team): FrameAgent[] {
  const w = agents.find((a) => a.id === watchedId);
  if (!w || w.team !== team) return [];
  return agents.filter((a) => a.team === team && a.id !== w.id && !a.out);
}

/** The crewmate after `last` in crew order (the first when `last` is gone or null); null with none. */
export function nextPeek(mates: readonly { id: string }[], last: string | null): string | null {
  if (!mates.length) return null;
  const i = mates.findIndex((m) => m.id === last);
  return mates[(i + 1) % mates.length]!.id;
}
