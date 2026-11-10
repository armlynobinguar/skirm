'use client';
// v2 match, found: the VS card. Accept or decline within 10 s; the rival stays hidden (practice
// names the greedy bot at once, since there is nobody to hide). Practice accepts by itself: the
// player just pressed Start, and a missed 10 s click would only void the match.
import { Button } from '@skirm/ui';
import { useEffect, useRef } from 'react';
import { TierBadge } from '@/components/TierBadge';
import { mapById } from '@/features/arena/world';
import { useRealtime } from '@/lib/services';
import { Countdown, PracticeBadge, other } from './common';
import v from './v2.module.css';
import type { V2MatchView } from './v2Store';

export function Accept({ view }: { view: V2MatchView }) {
  const rt = useRealtime();
  const map = mapById(view.mapId);
  const mine = view.accepted.includes(view.team);
  const sent = useRef(false);
  useEffect(() => {
    if (!view.practice || mine || sent.current) return;
    sent.current = true;
    rt.send({ type: 'v2_accept', matchId: view.matchId });
  }, [view.practice, view.matchId, mine, rt]);
  return (
    <div className={v.vs} role="dialog" aria-modal="true" aria-labelledby="v2-found" data-testid="v2-found">
      <p className={v.found}>
        <span id="v2-found" className="sk-kick">
          Match found · {view.ranked ? 'Ranked' : view.practice ? 'Practice' : view.draft ? 'Draft' : 'Casual'} · {map?.name ?? view.mapId}
        </span>
        {view.practice ? (
          <>
            {' '}
            <PracticeBadge free={view.free} />
          </>
        ) : null}
      </p>
      <div className={`${v.vside} ${v.va}`}>
        <span className="sk-kick">Your crew · {view.team}</span>
        <span className="sk-disp">You</span>
        {view.tiers ? <TierBadge tier={view.tiers.you} testId="v2-found-tier-you" /> : null}
        <span className={v.crewMeta}>{mine ? 'Accepted' : 'Waiting for you'}</span>
      </div>
      <div className={v.vmid}>
        <span className={`sk-disp ${v.vsWord}`}>VS</span>
        <Countdown until={view.acceptBy} />
        {mine ? (
          <p className="sk-kick">Waiting for the rival…</p>
        ) : (
          <div className={v.row}>
            <Button variant="primary" size="lg" onClick={() => rt.send({ type: 'v2_accept', matchId: view.matchId })} data-testid="v2-accept">
              Accept
            </Button>
            <Button variant="ghost" onClick={() => rt.send({ type: 'v2_decline', matchId: view.matchId })} data-testid="v2-decline">
              Decline
            </Button>
          </div>
        )}
      </div>
      <div className={`${v.vside} ${v.vb}`}>
        <span className="sk-kick">Rival crew · {other(view.team)}</span>
        <span className="sk-disp">{view.rivalHandle ?? '???'}</span>
        {view.tiers ? <TierBadge tier={view.tiers.rival} testId="v2-found-tier-rival" /> : null}
        <span className={v.crewMeta}>{view.accepted.includes(other(view.team)) ? 'Accepted' : 'Deciding'}</span>
      </div>
    </div>
  );
}
