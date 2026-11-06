'use client';
// Third person in 3D: the chased agent's latest reaction (arena/emotes.ts) as a pill over it. The
// chase cam keeps the agent at the same spot on screen, so the pill sits there too, for EMOTE_MS
// after it appears. The feed's emote lines only ever name agents in this crew's frame (in sight),
// and the caller mounts this only for an agent in sight, so a rival out of sight never shows one.
import { useEffect, useState, type CSSProperties } from 'react';
import { EMOTE_MS, liveEmotesOf } from '@/features/arena/emotes';
import type { V2CommsLine } from '../v2Store';
import e from './emotes.module.css';

/** The arena's crew colours (name tags and pills): A teal, B red, whoever is watching. */
const TEAM_COL = { A: '#34e0c8', B: '#ff4655' } as const;

export function TpvEmote({
  lines,
  agentId,
  tick,
}: {
  lines: V2CommsLine[];
  agentId: string;
  tick: number;
}) {
  const latest =
    liveEmotesOf(lines, tick)
      .filter((m) => m.agent === agentId)
      .pop() ?? null;
  const id = latest?.id ?? null;
  const [over, setOver] = useState<string | null>(null);
  useEffect(() => {
    if (!id) return;
    const t = setTimeout(() => setOver(id), EMOTE_MS);
    return () => clearTimeout(t);
  }, [id]);
  if (!latest || over === latest.id) return null;
  const text =
    lines.find((l) => l.channel === 'emote' && l.from === agentId && l.tick === latest.tick)
      ?.text ?? latest.label;
  return (
    <div
      key={latest.id}
      className={e.tpv}
      role="status"
      aria-label={text}
      data-testid="v2-tpv-emote"
      style={{ '--c': TEAM_COL[latest.team] } as CSSProperties}
    >
      <b className={e.glyph}>{latest.glyph}</b>
      <span className={e.label}>{latest.label}</span>
    </div>
  );
}
