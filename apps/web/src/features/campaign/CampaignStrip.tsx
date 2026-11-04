'use client';
// The campaign on home: how far the player got and the next mission, linking to /campaign. Shows
// the plain link while the api has not answered, so the campaign is always one click from home.
import Link from 'next/link';
import { routes } from '@/lib/routes';
import { useCampaign } from './hooks';
import c from './campaign.module.css';

export function CampaignStrip() {
  const q = useCampaign();
  const data = q.data;
  const next = data?.chapters.flatMap((ch) => ch.missions.map((m) => ({ ...m, chapter: ch }))).find((m) => m.status === 'open');
  const done = !!data && data.progress.cleared === data.progress.total;
  const sub = !data
    ? 'Chapters of missions against the bot that unlock starter skills'
    : done
      ? 'Every mission cleared. Replay any of them.'
      : next
        ? `Next: Chapter ${next.chapter.index} · ${next.title} · ${next.mapName}`
        : 'Chapters of missions against the bot';
  return (
    <aside className={c.strip} aria-labelledby="campaign-strip-title" data-testid="campaign-strip">
      <span className={c.stripText}>
        <span className="sk-kick">Single player{data ? ` · ${data.progress.cleared}/${data.progress.total}` : ''}</span>
        <span id="campaign-strip-title" className={c.stripTitle}>
          Campaign
        </span>
        <span className={c.stripSub}>{sub}</span>
      </span>
      <Link href={next ? routes.campaign(next.id) : routes.campaign()} className={c.stripGo} data-testid="campaign-strip-go">
        {data && data.progress.cleared > 0 && !done ? 'Continue ▸' : 'Open ▸'}
      </Link>
    </aside>
  );
}
