import * as React from 'react';
import { agentGlyph } from '../glyphs';
import { dressLook, isoPolys, lookFor, polyBounds, type Dress } from '../looks';
import type { AgentState, Crew } from '../types';
import { cx } from '../util';

export interface AgentAvatarProps {
  size?: number;
  crew?: Crew;
  state?: AgentState;
  /** The agent's name, for screen readers. */
  label?: string;
  /**
   * The agent's role (Builder, Digger, ...): draws its arena figure in that role's look (hard hat,
   * shovel, tank...) instead of the round glyph. Unknown roles get the generic look.
   */
  role?: string;
  /** Body (outfit) colour for the figure; defaults to the crew colour. */
  body?: string;
  /** Head (skin) colour for the figure. */
  head?: string;
  /** How its owner dressed it (hair, trousers, build, headgear); omit for the role's plain look. */
  dress?: Dress;
  className?: string;
}

const CREW_RING = { a: '#34e0c8', b: '#ff4655' } as const;

/** The role figure as SVG polygons, fitted to a 16-unit box with its feet near the bottom. */
function RoleFigure({
  role,
  body,
  head,
  crew,
  lost,
  dress,
}: {
  role: string;
  body: string;
  head: string;
  crew?: Crew;
  lost: boolean;
  dress?: Dress;
}) {
  const dressKey = dress ? JSON.stringify(dress) : '';
  const polys = React.useMemo(
    () =>
      isoPolys(dress ? dressLook(lookFor(role), dress) : lookFor(role), { body, head, team: CREW_RING[crew ?? 'a'] }, crew === 'b' ? -1 : 1),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [role, body, head, crew, dressKey],
  );
  const [x0, y0, x1, y1] = polyBounds(polys);
  // Fit the whole figure (it is taller than wide) into the box, feet near the bottom.
  const s = Math.min(14 / (y1 - y0), 14 / (x1 - x0));
  const ox = 8 - ((x0 + x1) / 2) * s;
  const oy = 15.2 - y1 * s;
  return (
    <g opacity={lost ? 0.45 : 1}>
      <ellipse cx={ox} cy={oy} rx={4.6} ry={1.5} fill="rgba(0,0,0,.35)" />
      {crew ? (
        <ellipse
          cx={ox}
          cy={oy}
          rx={6}
          ry={1.9}
          fill="none"
          strokeWidth={1}
          stroke={CREW_RING[crew]}
        />
      ) : null}
      {polys.map((q, i) => (
        <polygon
          key={i}
          points={q.pts.map((v, j) => (j % 2 ? oy + v * s : ox + v * s).toFixed(2)).join(' ')}
          fill={q.fill}
        />
      ))}
    </g>
  );
}

export function AgentAvatar({
  size = 32,
  crew,
  state,
  label,
  role,
  body,
  head,
  dress,
  className,
}: AgentAvatarProps): React.ReactElement {
  const detail = size >= 20 ? 'full' : 'compact';
  const aria =
    (label || 'Agent') +
    (role ? ', ' + role : '') +
    (crew ? ', crew ' + crew.toUpperCase() : '') +
    (state === 'lost' ? ', lost' : '');
  return (
    <span
      className={cx(
        'sk-avatar',
        state === 'acting' && 'is-acting',
        state === 'lost' && 'is-lost',
        className,
      )}
      style={{ width: size, height: size }}
      data-role={role || undefined}
    >
      <svg width={size} height={size} viewBox="0 0 16 16" role="img" aria-label={aria}>
        {role ? (
          <RoleFigure
            role={role}
            body={body ?? (crew === 'b' ? '#ff4655' : '#34e0c8')}
            head={head ?? '#ece8e1'}
            crew={crew}
            lost={state === 'lost'}
            {...(dress ? { dress } : {})}
          />
        ) : (
          agentGlyph({
            detail,
            crew,
            lost: state === 'lost',
            letter: crew && size >= 28 ? crew.toUpperCase() : null,
          })
        )}
      </svg>
    </span>
  );
}
