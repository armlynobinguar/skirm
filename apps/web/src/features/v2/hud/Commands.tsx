'use client';
// Live commands: the player's few directives during a match (DEFAULTS.commands.perMatch per crew).
// Pick who it goes to (the whole crew or one agent), then a preset (Hold the gate, Go for the drop,
// Regroup, Block the flow), optionally with a few words of your own; or send the words alone. The
// server applies it on the next tick, logs it in the match's hash chain and shows it to your crew
// only: the rival never sees it. One command at a time, then a short cooldown.
// The counter reads the frame's `commands.left`, or the last v2_command_ok while that is newer.
import { COMMAND_PRESETS, COMMAND_PRESET_IDS, type CommandPreset } from '@skirm/engine/v2';
import { DEFAULTS } from '@skirm/shared';
import { Button } from '@skirm/ui';
import { useEffect, useState } from 'react';
import { useToast } from '@/components/toast/ToastProvider';
import type { OutgoingMessage } from '@/lib/realtime/client';
import type { V2Frame, WsErrorCode } from '@/lib/realtime/protocol';
import { useRealtime } from '@/lib/services';
import type { V2MatchView } from '../v2Store';
import k from './commands.module.css';

/** Server refusals of a command (apps/realtime V2Match.command). */
const REFUSALS: readonly WsErrorCode[] = [
  'not_live',
  'no_commands',
  'rate_limited',
  'invalid_command',
  'command_refused',
  'bad_message',
  'not_found',
];

export interface CommandState {
  left: number;
  /** A sent command not yet applied in a frame. */
  pending: boolean;
  /** Ticks until another command may be sent (0: ready). */
  cooldown: number;
}

/** Commands left, whether one is on its way, and the cooldown, from the latest frame and ack. */
export function commandState(frame: V2Frame | null, ack: V2MatchView['commandAck']): CommandState {
  const cfg = DEFAULTS.commands;
  const tick = frame?.tick ?? 0;
  const log = frame?.commands?.log ?? [];
  const pending = !!ack && ack.tick > tick;
  const left = pending ? ack!.left : (frame?.commands?.left ?? ack?.left ?? cfg.perMatch);
  // The server counts the cooldown from the tick it was sent on: one before the tick it lands.
  const lastLanded = Math.max(log[log.length - 1]?.tick ?? -Infinity, ack?.tick ?? -Infinity);
  const cooldown = Number.isFinite(lastLanded)
    ? Math.max(0, cfg.cooldownTicks - (tick - (lastLanded - 1)))
    : 0;
  return { left, pending, cooldown };
}

export function CommandBar({ view, frame }: { view: V2MatchView; frame: V2Frame | null }) {
  const rt = useRealtime();
  const toast = useToast();
  const [target, setTarget] = useState<string>('');
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const st = commandState(frame, view.commandAck);
  const own = (frame?.agents ?? []).filter((a) => a.team === view.team && !a.out);
  const max = DEFAULTS.commands.maxChars;

  // The ack or a refusal ends the send (refusals carry no match id: only one is ever in flight).
  useEffect(() => {
    if (!sending) return;
    return rt.onMessage((m) => {
      if (m.type === 'v2_command_ok' && m.matchId === view.matchId) {
        setSending(false);
        setText('');
      } else if (m.type === 'error' && REFUSALS.includes(m.code)) {
        setSending(false);
        toast.show({ tone: 'warning', title: 'Command not sent', message: m.message });
      }
    });
  }, [sending, rt, toast, view.matchId]);

  // An agent that is out can no longer be commanded alone.
  useEffect(() => {
    if (target && !own.some((a) => a.id === target)) setTarget('');
  }, [own, target]);

  const blocked = sending || st.pending || st.left <= 0 || st.cooldown > 0 || view.phase !== 'live';
  const send = (preset?: CommandPreset) => {
    if (blocked) return;
    const words = text.trim();
    if (!preset && !words) return;
    const msg: Extract<OutgoingMessage, { type: 'v2_command' }> = {
      type: 'v2_command',
      matchId: view.matchId,
    };
    if (target) msg.agentId = target;
    if (preset) msg.preset = preset;
    if (words) msg.text = words;
    rt.send(msg);
    setSending(true);
  };
  const status =
    st.left <= 0
      ? 'No commands left'
      : sending || st.pending
        ? 'On its way…'
        : st.cooldown > 0
          ? `Ready in ${st.cooldown}`
          : 'Ready';

  return (
    <section className={`sk-panel ${k.bar}`} aria-label="Commands" data-testid="v2-commands">
      <div className={k.hd}>
        <span className="sk-kick">
          <b>Commands</b> · your crew only
        </span>
        <span
          className={k.left}
          data-testid="v2-commands-left"
          aria-label={`${st.left} of ${DEFAULTS.commands.perMatch} commands left`}
        >
          {Array.from({ length: DEFAULTS.commands.perMatch }, (_, i) => (
            <i key={i} data-on={i < st.left || undefined} aria-hidden="true" />
          ))}
          <span className={k.status}>{status}</span>
        </span>
      </div>
      <div className={k.row}>
        <select
          className={k.target}
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          aria-label="Send to"
          data-testid="v2-command-target"
          disabled={blocked}
        >
          <option value="">Whole crew</option>
          {own.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        {COMMAND_PRESET_IDS.map((p) => (
          <Button
            key={p}
            size="sm"
            onClick={() => send(p)}
            disabled={blocked}
            title={COMMAND_PRESETS[p].order}
            data-testid={`v2-command-${p}`}
          >
            {COMMAND_PRESETS[p].label}
          </Button>
        ))}
      </div>
      <form
        className={k.row}
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <input
          className={k.text}
          value={text}
          maxLength={max}
          onChange={(e) => setText(e.target.value)}
          placeholder="Add a few words (optional)"
          aria-label="Command text"
          data-testid="v2-command-text"
          disabled={blocked}
        />
        <Button
          size="sm"
          type="submit"
          variant="primary"
          disabled={blocked || !text.trim()}
          data-testid="v2-command-send"
        >
          Send
        </Button>
      </form>
    </section>
  );
}
