'use client';
// /campaign: the single-player campaign. Three chapters of missions against the greedy bot, each a
// practice match on a fixed map and difficulty with a briefing and an objective. Missions open in
// order; clearing a chapter unlocks its starter skill (account-bound: equip it, never trade it) and,
// for the last one, a cosmetic. Picking a mission shows its briefing; "Start mission" asks the api
// for the queue (POST /campaign/missions/:id/start) and sends it over the socket with the first
// agents of the account at Standard talk. The match screen takes over on v2_found; realtime records
// the result when it ends, and the chapter map refreshes with `me`.
import { DIFF_MODS } from '@skirm/engine/v2';
import { Button, DisplayHeading } from '@skirm/ui';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { ButtonLink } from '@/components/ButtonLink';
import { RequireSession } from '@/components/shell/RequireSession';
import { EmptyState } from '@/components/states/EmptyState';
import { ErrorCard } from '@/components/states/ErrorCard';
import { Skeleton } from '@/components/states/Skeleton';
import { v2StoreFor } from '@/features/v2/v2Store';
import type { Campaign, CampaignChapterView, CampaignMissionView } from '@/lib/api/campaignTypes';
import { ApiError } from '@/lib/api/errors';
import { qk, useMe } from '@/lib/api/queries';
import type { Me } from '@/lib/api/types';
import { useRealtimeMessage } from '@/lib/realtime/hooks';
import { routes } from '@/lib/routes';
import { useRealtime } from '@/lib/services';
import { useCampaign, useStartMission } from './hooks';
import c from './campaign.module.css';

/** Errors of other screens' watches on the shared socket, not about the queue. */
const NOT_QUEUE_ERRORS = new Set(['not_found', 'too_many_subscriptions']);

export function queueError(code: string): string {
  switch (code) {
    case 'mission_locked':
      return 'This mission is still locked. Clear the missions before it first.';
    case 'in_match':
    case 'already_queued':
      return 'You are already in a match or searching for one. Finish it, then start the mission.';
    case 'agent_busy':
      return 'One of your agents is still in a match. Wait for it to end, then try again.';
    case 'insufficient_credits':
      return 'Not enough credits for this mission today. It is free again when the allowance resets.';
    case 'unavailable':
      return 'Matches are paused for a moment. Try again shortly.';
    default:
      return 'Could not start the mission. Try again in a moment.';
  }
}

const STATUS_LABEL: Record<CampaignMissionView['status'], string> = { locked: 'Locked', open: 'Open', cleared: 'Cleared' };

export function CampaignScreen() {
  return (
    <div data-testid="screen-campaign" className={c.page}>
      <RequireSession>
        <CampaignData />
      </RequireSession>
    </div>
  );
}

function CampaignData() {
  const me = useMe();
  const campaign = useCampaign();
  if (me.data === undefined || campaign.data === undefined) {
    const err = me.error ?? campaign.error;
    if (err) return <ErrorCard error={err} onRetry={() => void (me.isError ? me.refetch() : campaign.refetch())} />;
    return <Skeleton rows={8} label="Loading the campaign" />;
  }
  if (!me.data.agents.length)
    return <EmptyState action={<ButtonLink href={routes.home()}>Back to Play</ButtonLink>}>No agents on this account yet.</EmptyState>;
  return <ChapterMap me={me.data} campaign={campaign.data} />;
}

/** The mission the hash names, else the first open one, else the last cleared one. */
function initialMission(campaign: Campaign): string | null {
  const all = campaign.chapters.flatMap((ch) => ch.missions);
  const hash = typeof window !== 'undefined' ? decodeURIComponent(window.location.hash.slice(1)) : '';
  const named = all.find((m) => m.id === hash && m.status !== 'locked');
  return (named ?? all.find((m) => m.status === 'open') ?? [...all].reverse().find((m) => m.status === 'cleared'))?.id ?? null;
}

function ChapterMap({ me, campaign }: { me: Me; campaign: Campaign }) {
  const [selected, setSelected] = useState<string | null>(() => initialMission(campaign));
  const mission = campaign.chapters.flatMap((ch) => ch.missions).find((m) => m.id === selected);
  return (
    <>
      <header className={c.head}>
        <span className="sk-kick">Single player · vs the bot</span>
        <DisplayHeading level={1}>Campaign</DisplayHeading>
        <p className={c.lede} data-testid="campaign-progress">
          {campaign.progress.cleared} of {campaign.progress.total} missions cleared.{' '}
          {campaign.free ? 'Free on the offline brain.' : 'With a model, a mission holds credits like any practice match.'} Each
          chapter you complete unlocks a starter skill you can equip but never trade.
        </p>
      </header>
      <div className={c.layout}>
        <ol className={c.chapters}>
          {campaign.chapters.map((ch) => (
            <Chapter key={ch.id} chapter={ch} selected={selected} onSelect={setSelected} />
          ))}
        </ol>
        {mission ? <Briefing key={mission.id} me={me} mission={mission} /> : null}
      </div>
    </>
  );
}

function Chapter({ chapter, selected, onSelect }: { chapter: CampaignChapterView; selected: string | null; onSelect: (id: string) => void }) {
  const state = chapter.complete ? 'Complete' : chapter.unlocked ? `${chapter.cleared} of ${chapter.missions.length}` : 'Locked';
  const { skill, cosmetic, granted } = chapter.rewards;
  return (
    <li className={c.chapter} data-locked={!chapter.unlocked || undefined} data-testid={`campaign-chapter-${chapter.id}`} aria-labelledby={`chapter-${chapter.id}-title`}>
      <header className={c.chapterHead}>
        <div>
          <span className="sk-kick">Chapter {chapter.index}</span>
          <h2 id={`chapter-${chapter.id}-title`} className={c.chapterTitle}>
            {chapter.title}
          </h2>
          <p className={c.blurb}>{chapter.blurb}</p>
        </div>
        <span className={c.state} data-testid={`campaign-chapter-${chapter.id}-state`}>
          {state}
        </span>
      </header>
      <ol className={c.missions}>
        {chapter.missions.map((m, i) => (
          <li key={m.id}>
            <button
              type="button"
              className={c.mission}
              data-status={m.status}
              aria-pressed={selected === m.id}
              disabled={m.status === 'locked'}
              onClick={() => onSelect(m.id)}
              data-testid={`campaign-mission-${m.id}`}
            >
              <span className={c.missionNo} aria-hidden="true">
                {m.status === 'cleared' ? '✓' : i + 1}
              </span>
              <span className={c.missionText}>
                <span className={c.missionTitle}>{m.title}</span>
                <span className={c.missionMeta}>
                  {m.mapName} · {DIFF_MODS[m.difficulty]?.name ?? m.difficulty} · crew {m.crewSize}
                </span>
              </span>
              <span className={c.missionState}>{STATUS_LABEL[m.status]}</span>
            </button>
          </li>
        ))}
      </ol>
      <div className={c.reward} data-granted={granted || undefined} data-testid={`campaign-reward-${chapter.id}`}>
        <span className="sk-kick">{granted ? 'Unlocked' : 'Complete the chapter to unlock'}</span>
        <span className={c.rewardName}>
          {skill.name} <span className={c.rewardKind}>starter skill</span>
          {cosmetic ? (
            <>
              {' '}
              + {cosmetic.name} <span className={c.rewardKind}>cosmetic</span>
            </>
          ) : null}
        </span>
        <span className={c.rewardSummary}>{skill.summary}</span>
        {granted ? (
          <Link href={routes.skills('owned')} className={c.rewardLink}>
            Equip it from your skills ▸
          </Link>
        ) : null}
      </div>
    </li>
  );
}

function Briefing({ me, mission }: { me: Me; mission: CampaignMissionView }) {
  const rt = useRealtime();
  const router = useRouter();
  const qc = useQueryClient();
  const start = useStartMission();
  const [phase, setPhase] = useState<'brief' | 'starting'>('brief');
  const [error, setError] = useState<string | null>(null);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const crew = me.agents.slice(0, mission.crewSize);
  const diff = DIFF_MODS[mission.difficulty];

  useEffect(() => {
    try {
      window.history.replaceState(null, '', routes.campaign(mission.id));
    } catch {
      /* no history in tests */
    }
  }, [mission.id]);

  useRealtimeMessage((m) => {
    if (phaseRef.current !== 'starting') return;
    if (m.type === 'v2_found') {
      void qc.invalidateQueries({ queryKey: qk.me });
      router.push(routes.match(m.matchId));
    } else if (m.type === 'error' && !NOT_QUEUE_ERRORS.has(m.code)) {
      setError(queueError(m.code));
      setPhase('brief');
    }
  });

  const go = () => {
    setError(null);
    setPhase('starting');
    start.mutate(mission.id, {
      onSuccess: ({ queue }) => {
        v2StoreFor(rt).queued = crew.map((a) => ({ agentId: a.id, name: a.name, tier: 'standard' as const }));
        rt.send({ ...queue, crew: crew.map((a) => ({ agentId: a.id, tier: 'standard' as const })) });
      },
      onError: (e) => {
        setError(e instanceof ApiError ? queueError(e.code) : queueError('internal'));
        setPhase('brief');
      },
    });
  };

  return (
    <section className={c.brief} aria-labelledby="campaign-brief-title" data-testid="campaign-briefing">
      <span className="sk-kick">Briefing · {STATUS_LABEL[mission.status]}</span>
      <h2 id="campaign-brief-title" className={c.briefTitle}>
        {mission.title}
      </h2>
      <p className={c.briefBody}>{mission.briefing}</p>
      <dl className={c.facts}>
        <dt>Map</dt>
        <dd>
          {mission.mapName} · <span style={{ color: diff?.colour }}>{diff?.name ?? mission.difficulty}</span>
        </dd>
        <dt>Objective</dt>
        <dd data-testid="campaign-objective">{mission.objective.label}</dd>
        <dt>Your crew</dt>
        <dd>{crew.map((a) => a.name).join(', ')}, talk Standard</dd>
        <dt>Rival</dt>
        <dd>
          {mission.rival.handle}, {mission.rival.size} agent{mission.rival.size === 1 ? '' : 's'} on {mission.rival.tier} talk
        </dd>
        <dt>Credits</dt>
        <dd>{mission.costCredits ? `Holds up to ${mission.costCredits} from your crew` : 'None on the offline brain'}</dd>
        {mission.attempts ? (
          <>
            <dt>Record</dt>
            <dd>
              {mission.attempts} attempt{mission.attempts === 1 ? '' : 's'}
              {mission.bestTicks !== null ? ` · best clear at tick ${mission.bestTicks}` : ''}
            </dd>
          </>
        ) : null}
      </dl>
      {error ? (
        <div className="app-banner is-critical" role="alert" data-testid="campaign-error">
          {error}
        </div>
      ) : null}
      <div className={c.row}>
        <Button variant="primary" onClick={go} loading={phase === 'starting'} disabled={phase === 'starting' || mission.status === 'locked'} data-testid="campaign-start">
          {mission.status === 'cleared' ? 'Play again ▸' : 'Start mission ▸'}
        </Button>
      </div>
    </section>
  );
}
