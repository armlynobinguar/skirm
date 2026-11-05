'use client';
// Hybrid control: steer one of your own agents by hand while the AI runs the rest (casual and
// practice only; ranked is the brains' alone). "Take control" on an agent card sends v2_control;
// while you steer, its action each tick is your latest input (v2_steer) and a wait when you send
// none in time. Keys: WASD or the arrows step north / west / south / east on the board, E uses the
// role's verb toward the last step, T takes the nearest item, G delivers, X stops, Esc hands it back
// to the AI. A click on the board walks it to that tile. A held step key repeats once a tick (the
// socket has a message budget). The steered agent is ringed on the board and tagged on its card.
import { Button } from '@skirm/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useToast } from '@/components/toast/ToastProvider';
import { tileAtPoint } from '@/features/arena/pick';
import type { SteerInput, V2Frame, WsErrorCode } from '@/lib/realtime/protocol';
import { useRealtime } from '@/lib/services';
import type { V2MatchView } from '../v2Store';
import k from './control.module.css';

type Dir = 'N' | 'E' | 'S' | 'W';

/** Server refusals of v2_control (apps/realtime V2Match.control). */
const REFUSALS: readonly WsErrorCode[] = ['control_casual', 'not_live', 'invalid_command', 'not_found', 'bad_message'];

/** Step keys: WASD and the arrows, as board directions (W / ↑ is north). */
export const STEP_KEYS: Readonly<Record<string, Dir>> = {
  w: 'N',
  W: 'N',
  ArrowUp: 'N',
  s: 'S',
  S: 'S',
  ArrowDown: 'S',
  a: 'W',
  A: 'W',
  ArrowLeft: 'W',
  d: 'E',
  D: 'E',
  ArrowRight: 'E',
};

/** Steering is for a player's own live casual or practice match (never ranked, a spectator or a replay). */
export const controlAllowed = (view: V2MatchView) => !view.watch && !view.ranked && view.phase === 'live';

/** Who you steer: the last v2_control_ok until the next frame, then the frame's own word on it. */
export function controlledOf(frame: V2Frame | null, ack: { agentId: string | null; tick: number } | null): string | null {
  if (ack && ack.tick === (frame?.tick ?? 0)) return ack.agentId;
  return frame?.steer?.agentId ?? null;
}

/** The standing order as a line for the panel. */
export function standingText(s: SteerInput | null | undefined): string | null {
  if (!s) return null;
  if (s.kind === 'take') return 'Heading for the nearest item';
  if (s.kind === 'deliver') return 'Heading to deliver';
  if (s.kind === 'goto') return `Walking to ${s.to[0]}, ${s.to[1]}`;
  return null;
}

export interface HybridControl {
  allowed: boolean;
  /** The agent you steer, or null. */
  controlled: string | null;
  take(agentId: string): void;
  release(): void;
  steer(input: SteerInput): void;
  /** A key from the HUD's key handler; true when steering used it. */
  onKey(e: KeyboardEvent): boolean;
}

export function useHybridControl(view: V2MatchView, frame: V2Frame | null, enabled: boolean): HybridControl {
  const rt = useRealtime();
  const toast = useToast();
  const [ack, setAck] = useState<{ agentId: string | null; tick: number } | null>(null);
  const [asking, setAsking] = useState(false);
  const allowed = enabled && controlAllowed(view);
  const controlled = allowed ? controlledOf(frame, ack) : null;
  const tick = frame?.tick ?? 0;
  const tickRef = useRef(tick);
  tickRef.current = tick;
  const held = useRef<Dir | null>(null);
  const lastDir = useRef<Dir | null>(null);

  useEffect(() => {
    if (!allowed) return;
    return rt.onMessage((m) => {
      if (m.type === 'v2_control_ok' && m.matchId === view.matchId) {
        setAck({ agentId: m.agentId, tick: tickRef.current });
        setAsking(false);
      } else if (m.type === 'error' && asking && REFUSALS.includes(m.code)) {
        setAsking(false);
        toast.show({ tone: 'warning', title: 'Could not take control', message: m.message });
      }
    });
  }, [allowed, asking, rt, toast, view.matchId]);

  const send = useCallback((agentId: string | null) => {
    rt.send({ type: 'v2_control', matchId: view.matchId, agentId });
    setAsking(true);
  }, [rt, view.matchId]);
  const steer = useCallback((input: SteerInput) => {
    if (input.kind === 'move') lastDir.current = input.dir;
    rt.send({ type: 'v2_steer', matchId: view.matchId, input });
  }, [rt, view.matchId]);

  // A held step key steps again once a tick.
  useEffect(() => {
    if (controlled && held.current) steer({ kind: 'move', dir: held.current });
    // Once per new frame only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);

  useEffect(() => {
    if (!controlled) {
      held.current = null;
      return;
    }
    const up = (e: KeyboardEvent) => {
      if (STEP_KEYS[e.key] && STEP_KEYS[e.key] === held.current) held.current = null;
    };
    // Click-to-move: a click on the board (not on a panel or control) walks the agent there.
    const click = (e: MouseEvent) => {
      const t = e.target as Element | null;
      if (t?.closest?.('button, a, input, select, textarea, label, [role="dialog"], .sk-panel')) return;
      const at = tileAtPoint(e.clientX, e.clientY);
      if (at) steer({ kind: 'goto', to: at });
    };
    window.addEventListener('keyup', up);
    window.addEventListener('click', click);
    return () => {
      window.removeEventListener('keyup', up);
      window.removeEventListener('click', click);
    };
  }, [controlled, steer]);

  const onKey = (e: KeyboardEvent): boolean => {
    if (!controlled) return false;
    const dir = STEP_KEYS[e.key];
    if (dir) {
      if (!e.repeat) steer({ kind: 'move', dir });
      held.current = dir;
      return true;
    }
    switch (e.key.toLowerCase()) {
      case 'e':
        steer(lastDir.current ? { kind: 'use', dir: lastDir.current } : { kind: 'use' });
        return true;
      case 't':
        steer({ kind: 'take' });
        return true;
      case 'g':
        steer({ kind: 'deliver' });
        return true;
      case 'x':
        steer({ kind: 'stop' });
        return true;
      case 'escape':
        send(null);
        return true;
    }
    return false;
  };

  return { allowed, controlled, take: (id) => send(id), release: () => send(null), steer, onKey };
}

/** The steering panel while you steer: who, the order it walks, the keys, and Hand back. */
export function ControlBar({ control, frame }: { control: HybridControl; frame: V2Frame | null }) {
  if (!control.controlled) return null;
  const agent = frame?.agents.find((a) => a.id === control.controlled);
  const order = standingText(frame?.steer?.standing);
  return (
    <section className={`sk-panel ${k.bar}`} aria-label="Steering" data-testid="v2-control">
      <div className={k.hd}>
        <span className="sk-kick">
          <b>Steering {agent?.name ?? 'your agent'}</b> · the AI runs the rest
        </span>
        <Button size="sm" variant="ghost" onClick={control.release} title="Hand it back to the AI (Esc)" data-testid="v2-control-release">
          Hand back
        </Button>
      </div>
      {order ? <span className={k.order} data-testid="v2-control-order">{order}</span> : null}
      <span className={k.keys} data-testid="v2-control-keys">
        <span><kbd>WASD</kbd>/<kbd>↑↓←→</kbd>step</span>
        <span><kbd>E</kbd>use</span>
        <span><kbd>T</kbd>take</span>
        <span><kbd>G</kbd>deliver</span>
        <span><kbd>X</kbd>stop</span>
        <span>click the map to walk</span>
        <span><kbd>Esc</kbd>hand back</span>
      </span>
    </section>
  );
}

/** "Take control" / "Steering" under one of your agent cards. */
export function TakeControl({ agentId, name, control, out }: { agentId: string; name: string; control: HybridControl; out: boolean }) {
  if (!control.allowed || out) return null;
  const on = control.controlled === agentId;
  return (
    <button
      type="button"
      className={k.take}
      aria-pressed={on}
      onClick={() => (on ? control.release() : control.take(agentId))}
      title={on ? `Hand ${name} back to the AI (Esc)` : `Steer ${name} yourself; the AI runs the rest`}
      data-testid={`v2-take-control-${agentId}`}
    >
      {on ? 'Hand back' : 'Take control'}
    </button>
  );
}

export { k as controlStyles };
