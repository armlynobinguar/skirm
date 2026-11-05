'use client';
// v2 match (/matches/[id]): one screen through every phase the server drives.
//   found  → the VS card: Accept / Decline within 10 s (the rival stays hidden).
//   draft  → draft mode only: each crew bans one of the rival's skills in turn (./Draft).
//   lockin → each agent's talk tier (Quiet / Standard / Open, credits per tick); ranked is Standard.
//   live   → the intro, then the HUD over this crew's fogged frames (cards, comms, third person).
//   ended  → the VICTORY / DEFEAT banner over the last frame, then the debrief at
//            /matches/[id]/result (a void match shows its card here).
// "Watch replay" (or opening this URL with #replay) plays the stored frames back at ¼×–4×.
// Not a player here (no v2_found in this tab): it spectates with v2_watch, the whole board and both
// crews' talk, until the match ends (the result by crew, no banner). A player who reloaded is
// resumed by the server and the view turns into theirs. No frame within 10 s (or the server does not
// know the match): "Match not found or not live on this server".
// Everything comes from the tab's v2 store (v2_* messages); nothing here is simulated.
// The phases live in ./Accept, ./LockIn, ./Live and ./Ended.
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ButtonLink } from '@/components/ButtonLink';
import { arenaStore } from '@/features/arena/store';
import { MAPS } from '@/features/arena/world';
import { useMapById } from '@/features/maps/hooks';
import { useRealtimeMessage } from '@/lib/realtime/hooks';
import { routes } from '@/lib/routes';
import { useRealtime } from '@/lib/services';
import { Accept } from './Accept';
import { Draft } from './Draft';
import { Ended } from './Ended';
import { Replay } from './hud/Replay';
import { Live, RESULT_AT_MS } from './Live';
import { LockIn } from './LockIn';
import v from './v2.module.css';
import { useV2Match } from './v2Store';

/** How long a spectator waits for the first frame before saying the match is not here. */
export const WATCH_TIMEOUT_MS = 10_000;

export function V2MatchScreen({ matchId }: { matchId: string }) {
  const view = useV2Match(matchId);
  const router = useRouter();
  const rt = useRealtime();
  const [replayOn, setReplayOn] = useState(false);
  const [replayError, setReplayError] = useState<string | null>(null);
  const [bannerDone, setBannerDone] = useState(false);
  const [lost, setLost] = useState(false);
  // The arena behind every phase is the match's own map.
  const mapId = view?.mapId;
  // A community map is fetched and registered so the arena and the cards can draw it.
  useMapById(mapId);
  useEffect(() => {
    const idx = mapId ? MAPS.findIndex((m) => m.id === mapId) : -1;
    if (idx >= 0) arenaStore().setMap(idx);
  }, [mapId]);
  // Opened from the result screen's "Watch replay".
  useEffect(() => {
    if (window.location.hash === '#replay') setReplayOn(true);
  }, []);
  // A replay in a tab that never saw the match: the stored frames build the view.
  const known = !!view;
  useEffect(() => {
    if (replayOn && !known) rt.send({ type: 'v2_replay', matchId });
  }, [replayOn, known, rt, matchId]);
  // Spectate while this tab is not a player of the match (a replay asks for stored frames instead).
  const spectate = !replayOn && (!view || view.watch) && view?.phase !== 'ended';
  useEffect(() => {
    if (!spectate || window.location.hash === '#replay') return;
    return rt.watchV2(matchId);
  }, [spectate, rt, matchId]);
  // Nothing within 10 s: the match is over, unknown, or runs on another server.
  const waiting = spectate && !known;
  useEffect(() => {
    setLost(false);
    if (!waiting || window.location.hash === '#replay') return;
    const t = setTimeout(() => setLost(true), WATCH_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [waiting]);
  useRealtimeMessage((m) => {
    if (m.type === 'error' && m.code === 'not_found') setLost(true);
  }, waiting);
  // No frames to play (kept 6 h, never stored, or the match is not over): say so instead of waiting.
  // Errors carry no match id, but this tab asked for nothing else while it waits here.
  useRealtimeMessage((m) => {
    if (m.type === 'error') setReplayError(m.message);
    else if (m.type === 'v2_frames' && m.matchId === matchId && !m.frames.length) setReplayError('no frames are kept for this match');
  }, replayOn && !view?.replay);

  if (!view)
    return (
      <div className={v.wait} data-testid="v2-waiting">
        <p className="sk-kick">
          {replayOn
            ? replayError
              ? `No replay: ${replayError}`
              : 'Loading the replay…'
            : lost
              ? 'Match not found or not live on this server'
              : 'Connecting to the match…'}
        </p>
        {lost && !replayOn ? (
          <ButtonLink href={routes.matchResult(matchId)} variant="secondary" size="sm" data-testid="v2-lost-result">
            Look for its result
          </ButtonLink>
        ) : null}
        <ButtonLink href={routes.pvp()} variant="ghost" size="sm">
          Back to the hub
        </ButtonLink>
      </div>
    );
  switch (view.phase) {
    case 'found':
      return <Accept view={view} />;
    case 'draft':
      return <Draft view={view} />;
    case 'lockin':
      return <LockIn view={view} />;
    case 'live':
      return <Live view={view} />;
    case 'ended': {
      if (replayOn) return <Replay view={view} error={replayError} onExit={() => setReplayOn(false)} />;
      // Seen live in this tab and just over: the banner over the last frame, then the debrief.
      // A spectator has no banner of their own: the result by crew shows at once.
      const fresh = !view.watch && !!view.frame && !!view.end?.result && view.endAt != null && Date.now() - view.endAt < RESULT_AT_MS;
      if (fresh && !bannerDone)
        return (
          <Live
            view={view}
            onEnded={() => {
              setBannerDone(true);
              router.replace(routes.matchResult(matchId));
            }}
          />
        );
      return <Ended view={view} onReplay={() => setReplayOn(true)} />;
    }
  }
}
