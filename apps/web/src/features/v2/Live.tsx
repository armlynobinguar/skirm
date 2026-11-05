'use client';
// v2 match, live: the prototype's match screen over the arena, drawn from this crew's fogged frames.
//   top     → your crew box, the clock (hazard rising or receding, switches ready, the next supply
//             drop, the difficulty's goal tag) and the rival's box.
//   right   → the comms feed, filtered All / Team / Say / overheard / Mind (plan changes).
//   bottom  → agent cards (carry slots with origin stripes, pickup and delivery floats; click to
//             follow, double-click for third person) and the controls; above them, for a player
//             only, the live commands (hud/Commands.tsx).
//   over it → the intro cutscene, the 3-2-1-GO count, callouts, and the VICTORY / DEFEAT banner.
// The match is server-paced: Pause freezes this view only (resume jumps back to live), Story keeps
// third person subtitles up for their full time, and the speed control shows only for a replay.
// Keys: Space pause, V third person, ← → next agent in third person, Enter / Esc skip the intro,
// Esc leaves third person, 1 / 2 / 4 replay speed.
// Spectating (a watch view): the whole board, both crews' cards and talk, the crews named by letter
// (never "you"), and no intro (the banner and debrief are the match screen's, not this HUD's).
import { AkIcon, Button, Segmented, type SegmentedOption } from '@skirm/ui';
import dynamic from 'next/dynamic';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useToast } from '@/components/toast/ToastProvider';
import type { ChaseCamState } from '@/features/arena/chase3d';
import { composeV2Arena, liveFx, setLiveFx } from '@/features/arena/live';
import { OVERVIEW, arenaStore } from '@/features/arena/store';
import type { ArenaState } from '@/features/arena/world';
import { useSession } from '@/lib/auth/session';
import type { FrameAgent, V2Frame } from '@/lib/realtime/protocol';
import { AgentCards, type CardAgent } from './hud/AgentCards';
import { GearLegend } from './hud/Gear';
import { CommandBar } from './hud/Commands';
import { Comms } from './hud/Comms';
import c from './hud/hud.module.css';
import { Intro } from './hud/Intro';
import { MatchTop } from './hud/MatchTop';
import { calloutOf, difficultyOf, type Callout, type FeedFilter } from './hud/model';
import { Banner, CalloutBar, CountIn } from './hud/parts';
import { ThirdPerson } from './hud/ThirdPerson';
import type { V2CommsLine, V2MatchView } from './v2Store';

const ChaseCam = dynamic(() => import('@/features/arena/chase3d/ChaseCam'), { ssr: false });

/** After v2_end: the banner shows at 0.5 s, the result screen takes over at 2.7 s. */
export const BANNER_AT_MS = 500;
export const RESULT_AT_MS = 2700;

/** Matches whose intro this tab already played (it plays once, at the start). */
const introPlayed = new Set<string>();
let tpvHintShown = false;

/** What the HUD draws: the live view, a paused copy of it, or a replay position. */
export interface HudSource {
  frame: V2Frame | null;
  prevFrame: V2Frame | null;
  comms: V2CommsLine[];
  rivals: FrameAgent[];
}

export interface ReplayControls {
  speed: number;
  onSpeed: (speed: number) => void;
  atEnd: boolean;
  onExit: () => void;
}

const SPEEDS: SegmentedOption<string>[] = [
  { value: '0.25', label: '¼×' },
  { value: '0.5', label: '½×' },
  { value: '1', label: '1×' },
  { value: '2', label: '2×' },
  { value: '4', label: '4×' },
];

export interface MatchHudProps {
  view: V2MatchView;
  source: HudSource;
  paused: boolean;
  onPause: () => void;
  /** A replay of stored frames: shows the speed control, no intro and no banner. */
  replay?: ReplayControls;
  /** The banner has run after the match ended (the screen moves to the result). */
  onEnded?: () => void;
}

export function MatchHud({ view, source, paused, onPause, replay, onEnded }: MatchHudProps) {
  const toast = useToast();
  const { handle } = useSession();
  const { frame, comms } = source;
  const team = view.team;
  const watch = view.watch;
  const difficulty = difficultyOf(view.ranked ? 'normal' : view.difficulty);
  const ended = !replay && view.phase === 'ended' && !!view.end?.result;
  const [filter, setFilter] = useState<FeedFilter>('all');
  const [focus, setFocus] = useState<string | null>(null);
  const [tpv, setTpv] = useState<string | null>(null);
  const [story, setStory] = useState(true);
  const [held, setHeld] = useState(false);
  const [use3d, setUse3d] = useState(true);
  const [intro, setIntro] = useState(() => !replay && !watch && view.phase === 'live' && !introPlayed.has(view.matchId) && (frame?.tick ?? 0) <= 2);
  const [count, setCount] = useState<string | null>(null);
  const [callout, setCallout] = useState<Callout | null>(null);
  const [banner, setBanner] = useState<'VICTORY' | 'DEFEAT' | 'DRAW' | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const later = useCallback((ms: number, f: () => void) => void timers.current.push(setTimeout(f, ms)), []);

  useEffect(() => {
    if (intro) introPlayed.add(view.matchId);
    const ts = timers.current;
    return () => {
      ts.forEach(clearTimeout);
      arenaStore().setLive(null);
      arenaStore().setView(OVERVIEW);
      setLiveFx(null);
    };
    // Mount and unmount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Draw this frame in the arena (without subscribing: the canvas does). The 3D cam tweens from the last one.
  const prevArena = useRef<ArenaState | null>(null);
  useEffect(() => {
    const arena = frame ? composeV2Arena(frame) : null;
    prevArena.current = arenaStore().get().live?.arena.state ?? null;
    arenaStore().setLive(arena, view.mapId);
  }, [frame, view.mapId]);

  // The camera: the intro's slow pull-in, third person, following an agent, or the whole board.
  useEffect(() => {
    arenaStore().setView(intro ? { mode: 'intro', focus: null } : tpv ? { mode: 'tpv', focus: tpv } : focus ? { mode: 'follow', focus } : OVERVIEW);
  }, [intro, tpv, focus]);

  // A big moment this tick shows under the clock for 1.8 s.
  useEffect(() => {
    const co = frame ? calloutOf(frame, team) : null;
    if (!co) return;
    setCallout(co);
    const t = setTimeout(() => setCallout(null), 1800);
    return () => clearTimeout(t);
  }, [frame, team]);

  // The end: the banner, then the result screen.
  const endedRef = useRef(onEnded);
  endedRef.current = onEnded;
  useEffect(() => {
    if (!ended) return;
    const w = view.end!.result!.winner;
    later(BANNER_AT_MS, () => setBanner(w === team ? 'VICTORY' : w === 'draw' ? 'DRAW' : 'DEFEAT'));
    later(RESULT_AT_MS, () => endedRef.current?.());
  }, [ended, view.end, team, later]);

  const endIntro = useCallback(() => {
    setIntro(false);
    const fx = liveFx();
    const now = Date.now();
    setLiveFx({ intro: false, revealAt: fx.revealAt ?? now - 600, deployAt: fx.deployAt ?? now - 400 });
    ['3', '2', '1', 'GO'].forEach((s, i) => later(200 + i * 480, () => setCount(s)));
    later(200 + 4 * 480, () => setCount(null));
  }, [later]);

  const agents = frame?.agents ?? [];
  // A spectator sees every agent, so the other crew is simply the frame's.
  const rivals = watch ? agents.filter((a) => a.team !== team) : source.rivals;
  const findAgent = (id: string | null): { agent: FrameAgent; inSight: boolean } | null => {
    if (!id) return null;
    const a = agents.find((x) => x.id === id);
    if (a) return { agent: a, inSight: true };
    const r = rivals.find((x) => x.id === id);
    return r ? { agent: r, inSight: false } : null;
  };

  const enterTpv = (id: string | null) => {
    if (intro) return;
    const pick = findAgent(id)?.agent ?? agents.find((a) => a.team === team && !a.out) ?? agents[0];
    if (!pick) return;
    setTpv(pick.id);
    setFocus(pick.id);
    if (!tpvHintShown) {
      tpvHintShown = true;
      toast.show({ title: 'Third person', message: 'Drag to look around · scroll to zoom · ← → switch agent · Esc to leave' });
    }
  };
  const exitTpv = () => {
    setTpv(null);
    setFocus(null);
  };
  const toggleTpv = () => (tpv ? exitTpv() : enterTpv(focus));
  const toggleStory = () => {
    setStory(!story);
    toast.show({
      title: story ? 'Story pace off' : 'Story pace on',
      message: story
        ? 'Third person keeps up with the match and skips lines it cannot show in time.'
        : 'In third person every subtitle stays up until you have read it.',
    });
  };

  // Keys (capture phase, so Esc closes the intro or third person before the shell goes back).
  const keys = useRef<(e: KeyboardEvent) => void>(() => {});
  keys.current = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null;
    if (e.metaKey || e.ctrlKey || e.altKey || (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)))) return;
    const take = () => {
      e.preventDefault();
      e.stopPropagation();
    };
    if (intro) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') {
        take();
        endIntro();
      }
      return;
    }
    if (e.key === 'Escape' && tpv) {
      take();
      exitTpv();
    } else if (e.key === ' ') {
      if (t?.tagName === 'BUTTON') return; // Space on a focused button presses it
      take();
      if (!ended) onPause();
    } else if (e.key === 'v' || e.key === 'V') {
      take();
      toggleTpv();
    } else if (tpv && (e.key === 'ArrowRight' || e.key === 'ArrowLeft') && agents.length) {
      take();
      const i = agents.findIndex((a) => a.id === tpv);
      enterTpv(agents[(i + (e.key === 'ArrowRight' ? 1 : -1) + agents.length) % agents.length]!.id);
    } else if (replay && (e.key === '1' || e.key === '2' || e.key === '4')) {
      take();
      replay.onSpeed(Number(e.key));
    }
  };
  useEffect(() => {
    const on = (e: KeyboardEvent) => keys.current(e);
    window.addEventListener('keydown', on, true);
    return () => window.removeEventListener('keydown', on, true);
  }, []);

  // The 3D chase cam reads the arena every frame (lazy: `three` loads only in third person).
  const chase = useRef({ tpv, paused });
  chase.current = { tpv, paused };
  const chaseState = useCallback((): ChaseCamState | null => {
    const live = arenaStore().get().live;
    const id = chase.current.tpv;
    if (!live || !id) return null;
    return { arena: live.arena, prev: prevArena.current, at: live.at, focus: id, look: live.look, paused: chase.current.paused };
  }, []);
  const on3dFail = useCallback(() => {
    setUse3d(false);
    toast.show({ tone: 'warning', title: 'No 3D view', message: 'The 3D view could not load here, so third person is showing the tilted map instead.' });
  }, [toast]);

  const own: CardAgent[] = agents.filter((a) => a.team === team).map((agent, slot) => ({ agent, inSight: true, slot }));
  const rivalCards: CardAgent[] = rivals.map((r, slot) => {
    const now = agents.find((a) => a.id === r.id);
    return { agent: now ?? r, inSight: !!now, slot };
  });
  const unseen = Math.max(0, (view.rivalAgents ?? 0) - rivals.length);
  const watched = findAgent(tpv);
  const onPick = (id: string) => (tpv ? enterTpv(id) : setFocus((f) => (f === id ? null : id)));
  const cls = [c.hud, intro && c.introing, tpv && c.tpv, (intro || tpv) && c.cine].filter(Boolean).join(' ');
  const tick = frame?.tick ?? 0;

  return (
    <div className={cls} data-testid="v2-live" data-paused={paused || undefined}>
      <div className={`${c.lbox} ${c.lboxT}`} aria-hidden="true" />
      <div className={`${c.lbox} ${c.lboxB}`} aria-hidden="true" />
      <MatchTop
        frame={frame}
        team={team}
        ranked={view.ranked}
        difficulty={difficulty}
        tickMs={view.tickMs}
        you={watch ? null : handle}
        rivalHandle={watch ? null : view.rivalHandle}
        rivals={rivals}
        watch={watch}
        practice={view.practice}
      />
      <Comms lines={comms} team={team} filter={filter} onFilter={setFilter} tickMs={view.tickMs} />
      <div className={c.mbot}>
        {!watch && !replay && view.phase === 'live' ? <CommandBar view={view} frame={frame} /> : null}
        <AgentCards team={team} mapId={view.mapId} tick={tick} cards={own} pressed={tpv ?? focus} onPick={onPick} onWatch={enterTpv} />
        <div className={`sk-panel ${c.ctrl}`}>
          <Button size="sm" onClick={onPause} disabled={ended} aria-label={paused ? 'Resume' : 'Pause'} title={replay ? 'Pause (Space)' : 'Pause the view; the match goes on (Space)'} data-testid="v2-pause">
            <AkIcon name={paused ? 'resume' : 'pause'} />
          </Button>
          {replay ? <Segmented label="Speed" options={SPEEDS} value={String(replay.speed)} onChange={(s) => replay.onSpeed(Number(s))} data-testid="v2-speed" /> : null}
          <Button size="sm" className={c.tg} aria-pressed={!!tpv} onClick={toggleTpv} aria-label="3rd person" title="Third person on the selected agent (V)" data-testid="v2-tpv-toggle">
            <AkIcon name="tpv" />
            <span className={c.bl}>3rd person</span>
          </Button>
          <Button size="sm" className={`${c.tg} ${held ? c.held : ''}`} aria-pressed={story} onClick={toggleStory} aria-label="Story" title="Story pace: third person subtitles stay up until read" data-testid="v2-story">
            <AkIcon name="story" />
            <span className={c.bl}>Story</span>
          </Button>
          {paused && !replay ? <span className="sk-kick">View paused · the match goes on</span> : null}
          {replay ? (
            <>
              <span className="sk-kick">{replay.atEnd ? 'Replay ended' : 'Replay'}</span>
              <Button size="sm" variant="ghost" onClick={replay.onExit} data-testid="v2-replay-exit">
                Back to the debrief
              </Button>
            </>
          ) : null}
        </div>
        <AgentCards team={team} mapId={view.mapId} tick={tick} cards={rivalCards} unseen={unseen} pressed={tpv ?? focus} onPick={onPick} onWatch={enterTpv} className={c.cardsB} />
      </div>
      <CalloutBar callout={callout} />
      {intro ? null : <GearLegend frame={frame} />}
      {watched ? (
        <ThirdPerson
          agent={watched.agent}
          team={team}
          ranked={view.ranked}
          mapId={view.mapId}
          inSight={watched.inSight}
          tick={tick}
          limit={frame?.limit ?? 150}
          tickMs={view.tickMs}
          lines={comms}
          playbook={frame?.playbook ?? null}
          story={story}
          onHeld={setHeld}
          onExit={exitTpv}
        />
      ) : null}
      {watched && use3d ? <ChaseCam className={c.chase} getState={chaseState} onFail={on3dFail} /> : null}
      {intro ? (
        <Intro
          mapId={view.mapId}
          ranked={view.ranked}
          difficulty={difficulty}
          goal={frame?.goal ?? 3}
          limit={frame?.limit ?? 150}
          tickMs={view.tickMs}
          you={handle}
          rivalHandle={view.rivalHandle}
          crew={(frame?.agents.filter((a) => a.team === team).map((a) => a.name) ?? view.crew?.map((a) => a.name)) ?? []}
          rivalAgents={view.rivalAgents}
          onDone={endIntro}
        />
      ) : null}
      <CountIn step={count} />
      {banner ? <Banner word={banner} /> : null}
    </div>
  );
}

/** The live match: the store's latest frame, or a frozen copy of it while paused. */
export function Live({ view, onEnded }: { view: V2MatchView; onEnded?: () => void }) {
  const [frozen, setFrozen] = useState<HudSource | null>(null);
  const live: HudSource = { frame: view.frame, prevFrame: view.prevFrame, comms: view.comms, rivals: view.rivals };
  const over = view.phase === 'ended';
  const source = frozen && !over ? frozen : live;
  return <MatchHud view={view} source={source} paused={!!frozen && !over} onPause={() => setFrozen((f) => (f || over ? null : live))} onEnded={onEnded} />;
}
