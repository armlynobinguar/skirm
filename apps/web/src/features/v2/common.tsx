'use client';
// Bits every v2 match phase shares: the rival's side, the accept / lock-in countdown, the practice
// badge and how a spectator names the crews.
import { BOT_HANDLE, type Team } from '@skirm/engine/v2';
import { Badge } from '@skirm/ui';
import { useNow } from '@/features/pvp/pvpUtil';
import v from './v2.module.css';

export const other = (t: Team): Team => (t === 'A' ? 'B' : 'A');

/** Whole seconds left until `until` (wall ms), ticking 4 times a second. */
export function Countdown({ until }: { until: number }) {
  const now = useNow(250);
  return <span className={v.vsCount}>{Math.max(0, Math.ceil((until - now) / 1000))}</span>;
}

/** Practice against the greedy bot: "vs Greedy bot", plus "Free practice" when this crew holds nothing. */
export function PracticeBadge({ free }: { free: boolean }) {
  return (
    <span className="sk-kick" data-testid="v2-practice">
      <Badge tone="you" icon={false}>
        vs {BOT_HANDLE}
      </Badge>
      {free ? (
        <>
          {' '}
          <Badge tone="good" icon={false} data-testid="v2-free">
            Free practice
          </Badge>
        </>
      ) : null}
    </span>
  );
}

/** A spectator's name for a crew: its player's handle when known, never "you". */
export const crewName = (t: Team, handle: string | null | undefined): string => (handle ? `${handle} · ${t}` : `Crew ${t}`);
