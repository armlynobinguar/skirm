// The agent glyph in a 16-unit tile (tiles.md). Token paint goes in `style`, where
// CSS custom properties resolve; presentation attributes would not resolve var().
import * as React from 'react';
import type { Crew, Detail } from './types';
import { V } from './util';

export interface AgentGlyphOptions {
  detail?: Detail;
  crew?: Crew | undefined;
  lost?: boolean | undefined;
  letter?: string | null | undefined;
}

export function agentGlyph(opts: AgentGlyphOptions = {}): React.ReactElement[] {
  const detail = opts.detail ?? 'full';
  const ring = opts.crew ? V(opts.crew === 'b' ? 'crew-b' : 'crew-a') : null;
  const lost = !!opts.lost;
  const kids: React.ReactElement[] = [];
  if (ring) kids.push(<circle key="r" cx={8} cy={8} r={7.2} fill="none" strokeWidth={1.6} style={{ stroke: ring }} />);
  kids.push(
    <circle
      key="b"
      className="sk-agent-body"
      cx={8}
      cy={8}
      r={ring ? 5.6 : 6.2}
      strokeWidth={detail === 'fill' ? 0 : 0.9}
      style={{ fill: lost ? V('tile-wall') : V('tile-agent'), stroke: V('tile-mark-halo') }}
    />,
  );
  if (detail !== 'fill') {
    if (lost) {
      kids.push(
        <path key="f" className="sk-agent-face is-x" d="M5.8 5.8l4.4 4.4M10.2 5.8l-4.4 4.4" strokeWidth={1.3} strokeLinecap="round" fill="none" style={{ stroke: V('tile-agent-mark') }} />,
      );
    } else if (detail === 'full') {
      kids.push(
        <path
          key="f"
          className="sk-agent-face is-prompt"
          d="M5.4 6.2 7 7.8 5.4 9.4M8.3 9.8h2.4"
          strokeWidth={1.3}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
          style={{ stroke: V('tile-agent-mark') }}
        />,
      );
    } else {
      kids.push(<circle key="e1" className="sk-agent-face is-eyes" cx={6.2} cy={7.6} r={0.9} style={{ fill: V('tile-agent-mark') }} />);
      kids.push(<circle key="e2" cx={9.8} cy={7.6} r={0.9} style={{ fill: V('tile-agent-mark') }} />);
    }
  }
  if (opts.letter && detail === 'full') {
    kids.push(
      <rect key="lb" x={10.6} y={10.6} width={5.2} height={5.2} rx={0.8} strokeWidth={0.6} style={{ fill: ring ?? V('tile-agent'), stroke: V('tile-mark-halo') }} />,
    );
    kids.push(
      <text
        key="lt"
        className="sk-agent-letter"
        x={13.2}
        y={14.6}
        textAnchor="middle"
        fontSize={4.6}
        fontWeight={700}
        style={{ fontFamily: 'var(--font-mono)', fill: V('tile-mark-halo') }}
      >
        {opts.letter}
      </text>,
    );
  }
  return kids;
}
