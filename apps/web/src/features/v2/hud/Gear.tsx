'use client';
// Tools from supply drops in the HUD: the icon for each tool, the chip on an agent card for the tool
// it carries, and the legend that explains what is on the map (ground tools and placed objects).
import type { ToolKind, V2Frame } from '@skirm/engine/v2';
import { TOOL_INFO } from '@/features/arena/gear';
import g from './gear.module.css';

/** A small inline icon per tool, in its arena colour. */
export function ToolIcon({ kind, size = 14 }: { kind: ToolKind; size?: number }) {
  const col = TOOL_INFO[kind].colour;
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      {kind === 'sandbag' ? (
        <g fill={col} stroke="#6f5734" strokeWidth="1">
          <ellipse cx="5" cy="11" rx="4" ry="2.6" />
          <ellipse cx="11" cy="11" rx="4" ry="2.6" />
          <ellipse cx="8" cy="6.5" rx="4" ry="2.6" />
        </g>
      ) : kind === 'bridge' ? (
        <g fill={col}>
          <rect x="1" y="4" width="14" height="2" />
          <rect x="1" y="10" width="14" height="2" />
          <rect x="3" y="4" width="2" height="8" />
          <rect x="7" y="4" width="2" height="8" />
          <rect x="11" y="4" width="2" height="8" />
        </g>
      ) : (
        <g>
          <rect x="5" y="3" width="6" height="10" rx="1" fill="#2a4a5c" stroke={col} strokeWidth="1.2" />
          <path d="M8 6 C6.5 8 6.5 9.5 8 10.5 C9.5 9.5 9.5 8 8 6Z" fill={col} />
        </g>
      )}
    </svg>
  );
}

/** The tool an agent carries, on its card (nothing when it carries none). */
export function ToolChip({ kind, onCard = false }: { kind: ToolKind | undefined; onCard?: boolean }) {
  if (!kind) return null;
  const t = TOOL_INFO[kind];
  return (
    <span className={onCard ? `${g.chip} ${g.onCard}` : g.chip} title={`${t.name}: ${t.line}`} data-testid={`v2-tool-${kind}`}>
      <ToolIcon kind={kind} size={12} />
      {t.name}
    </span>
  );
}

/** Which tools show up anywhere in a frame: on the ground, placed, or in an agent's hands. */
export function toolsInFrame(frame: Pick<V2Frame, 'tools' | 'placed' | 'agents'> | null): ToolKind[] {
  if (!frame) return [];
  const kinds = new Set<ToolKind>();
  for (const t of frame.tools ?? []) kinds.add(t.kind);
  for (const p of frame.placed ?? []) kinds.add(p.kind);
  for (const a of frame.agents) if (a.tool) kinds.add(a.tool);
  return (['sandbag', 'pump', 'bridge'] as const).filter((k) => kinds.has(k));
}

/** The legend for the tools in play this frame; nothing when there are none. */
export function GearLegend({ frame }: { frame: Pick<V2Frame, 'tools' | 'placed' | 'agents'> | null }) {
  const kinds = toolsInFrame(frame);
  if (!kinds.length) return null;
  return (
    <aside className={`sk-panel ${g.legend}`} aria-label="Supply tools" data-testid="v2-gear-legend">
      <span className="sk-kick">Supply tools</span>
      <ul>
        {kinds.map((k) => (
          <li key={k} title={TOOL_INFO[k].line}>
            <ToolIcon kind={k} />
            <b>{TOOL_INFO[k].name}</b>
            <span>{TOOL_INFO[k].line}</span>
          </li>
        ))}
      </ul>
    </aside>
  );
}
