'use client';
// S09 Marketplace (/market), styled as the v2 Exchange (the prototype's #s-market, P 2405-2478): tilt
// cards with rarity art on the left, the skill's proof in a side drawer on the right (S10, in
// SkillDetailScreen.tsx). Owner: skills builder.
// Tabs: Exchange (GET /market?tag=&sort=, api default sort `winrate`: ranked v2 win rate, nulls
// last) and My skills (GET /skills?tab=written + ?tab=owned, merged). Picking a card opens the drawer
// and moves the URL to /market/[skillId] (history.replaceState, no navigation), so the link can be
// shared; /market/[skillId] renders this screen with the drawer open. Esc or ✕ closes it.
// Cards carry public metadata, the creator, the price in yoctoNEAR (formatted with bigint) and the
// proof line: the version's ranked v2 win rate and its benchmark score ("Not benchmarked" when it has
// none, e.g. on an offline server). The corner chip marks a starter, a draft or a minted version.
// Sorts: ranked win rate, benchmark score, price and newest. On wide screens the page fits the viewport
// and only the card grid and the drawer scroll (exchange.module.css).
// Public: signed-out visitors browse the Exchange and open any skill read-only (GET /market and
// GET /market/:skillId need no session); buy, trial, equip and back show "Sign in to …" instead,
// and the My skills tab asks them to sign in.
import { Badge, Button, TextField } from '@skirm/ui';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { describeSkillTrigger, type Tag } from '@skirm/shared';
import Link from 'next/link';
import { ButtonLink } from '@/components/ButtonLink';
import { RequireSession } from '@/components/shell/RequireSession';
import { EmptyState } from '@/components/states/EmptyState';
import { ErrorCard } from '@/components/states/ErrorCard';
import { Skeleton } from '@/components/states/Skeleton';
import { qk, useMe } from '@/lib/api/queries';
import type { MarketCard, MarketSort, SkillRow, SkillStatus, SkillView } from '@/lib/api/types';
import { useSession } from '@/lib/auth/session';
import { routes } from '@/lib/routes';
import { useApi } from '@/lib/services';
import { TAGS, near } from './lib';
import { SkillArt, rarityOf, useTilt } from './parts';
import { RoleTag } from './RoleTag';
import { SkillDrawer } from './SkillDetailScreen';
import s from './skills.module.css';
import x from './exchange.module.css';

const SORTS: { id: MarketSort; label: () => string }[] = [
  { id: 'winrate', label: () => 'Ranked win rate' },
  { id: 'benchmark', label: () => 'Benchmark score' },
  { id: 'price', label: () => 'Price, low to high' },
  { id: 'new', label: () => 'Newest' },
];

type MarketTab = 'exchange' | 'mine';

const TABS: { id: MarketTab; label: string }[] = [
  { id: 'exchange', label: 'Exchange' },
  { id: 'mine', label: 'My skills' },
];

/** `skillId`: open the drawer on this skill (the /market/[skillId] deep link). */
export function MarketplaceScreen({ skillId }: { skillId?: string } = {}) {
  return <Marketplace initial={skillId ?? null} />;
}

/** Keeps the address bar on the open skill without a navigation (Next syncs native history calls). */
function syncUrl(skillId: string | null) {
  try {
    const url = skillId ? routes.marketSkill(skillId) : routes.market();
    if (window.location.pathname !== url) window.history.replaceState(null, '', url);
  } catch {
    // A sandboxed frame can refuse history calls; the drawer still works.
  }
}

function Marketplace({ initial }: { initial: string | null }) {
  const [tab, setTab] = useState<MarketTab>('exchange');
  const [sel, setSel] = useState<string | null>(initial);
  const drawer = useRef<HTMLElement>(null);
  const tabRefs = useRef<Record<MarketTab, HTMLButtonElement | null>>({ exchange: null, mine: null });

  const select = (id: string | null) => {
    setSel(id);
    syncUrl(id);
    if (id) drawer.current?.focus({ preventScroll: true });
  };

  const pickTab = (t: MarketTab, focus = false) => {
    setTab(t);
    if (focus) tabRefs.current[t]?.focus();
    if (t !== tab) select(null);
  };

  // Esc closes the drawer, unless a modal (M01/M02) is open: the modal takes Esc first.
  useEffect(() => {
    if (!sel) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (document.querySelector('[aria-modal="true"]')) return;
      e.preventDefault();
      setSel(null);
      syncUrl(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sel]);

  const onTabKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'Home' && e.key !== 'End') return;
    e.preventDefault();
    const i = TABS.findIndex((t) => t.id === tab);
    const n = e.key === 'Home' ? 0 : e.key === 'End' ? TABS.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + TABS.length) % TABS.length;
    pickTab(TABS[n]!.id, true);
  };

  return (
    <div className={x.page} data-testid="screen-s09">
      <section className={x.head}>
        <div>
          <span className="sk-kick">NEAR testnet · 5% platform fee · royalty up to 10%</span>
          <h1 className={x.title}>{tab === 'mine' ? 'My skills' : 'Exchange'}</h1>
        </div>
        <div className={x.tabs} role="tablist" aria-label="Skills" onKeyDown={onTabKey}>
          {TABS.map((t) => (
            <button
              key={t.id}
              ref={(el) => {
                tabRefs.current[t.id] = el;
              }}
              type="button"
              role="tab"
              id={`s09-tab-${t.id}`}
              aria-selected={tab === t.id}
              aria-controls="s09-panel"
              tabIndex={tab === t.id ? 0 : -1}
              onClick={() => pickTab(t.id)}
              data-testid={`s09-tab-${t.id}`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <p className={x.lede}>
          {tab === 'mine'
            ? 'Skills you wrote and skills you hold. Pick one to see its proof, list it or equip it.'
            : 'Find a skill by proof: its ranked win rate and the benchmark the platform runs at mint, on seeds the seller never sees. You buy the right to use a skill, never its text.'}{' '}
          <Link href={routes.backing()} data-testid="s09-backing">
            {tab === 'mine' ? 'Raise from backers' : 'Back a writer'}
          </Link>
        </p>
      </section>

      <div className={x.mk} data-open={sel ? '' : undefined}>
        <div id="s09-panel" role="tabpanel" aria-labelledby={`s09-tab-${tab}`} className={x.list}>
          {tab === 'exchange' ? (
            <ExchangeList sel={sel} onSelect={select} />
          ) : (
            <RequireSession>
              <MineList sel={sel} onSelect={select} />
            </RequireSession>
          )}
        </div>
        <aside ref={drawer} className={x.drawer} aria-label="Skill detail" tabIndex={-1} data-testid="s09-drawer">
          {sel ? (
            <SkillDrawer key={sel} skillId={sel} onClose={() => select(null)} />
          ) : (
            <p className={`sk-kick ${x.pick}`}>Pick a skill to see its proof.</p>
          )}
        </aside>
      </div>
    </div>
  );
}

// ---------- Exchange tab ----------

function ExchangeList({ sel, onSelect }: { sel: string | null; onSelect: (id: string) => void }) {
  const api = useApi();
  const { status } = useSession();
  const me = useMe();
  const [tag, setTag] = useState<Tag | null>(null);
  const [sort, setSort] = useState<MarketSort>('winrate');
  const [search, setSearch] = useState('');

  const query = { ...(tag ? { tag } : {}), sort };
  const market = useQuery({
    queryKey: qk.market.list(query),
    queryFn: () => api.market(query),
    // Public: signed out too, once the session is known (the cache is cleared on sign-in).
    enabled: status !== 'loading',
    placeholderData: keepPreviousData,
  });

  const needle = search.trim().toLowerCase();
  const cards = (market.data ?? []).filter(
    (c) =>
      !needle ||
      c.skill.name.toLowerCase().includes(needle) ||
      c.creator.handle.toLowerCase().includes(needle) ||
      (c.creator.nearAccountId ?? '').toLowerCase().includes(needle),
  );
  const meId = me.data?.account.id;

  const clear = () => {
    setTag(null);
    setSearch('');
  };

  return (
    <>
      <section aria-label="Filters" className={x.filters} data-testid="s09-filters">
        <div role="group" aria-label="Mechanic tag" className={x.chips}>
          <span className="sk-kick">Handles</span>
          {TAGS.map((t) => (
            <button
              key={t}
              type="button"
              className={x.chip}
              aria-pressed={tag === t}
              onClick={() => setTag(tag === t ? null : t)}
              data-testid={`s09-tag-filter-${t}`}
            >
              {t}
            </button>
          ))}
        </div>
        <div className={s.filterRow}>
          <label className={s.selectLabel}>
            Sort
            <select
              className={s.select}
              value={sort}
              onChange={(e) => setSort(e.target.value as MarketSort)}
              data-testid="s09-sort"
            >
              {SORTS.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label()}
                </option>
              ))}
            </select>
          </label>
          <div className={s.search}>
            <TextField
              label="Search"
              prefix="skill"
              placeholder="Skill or creator"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              data-testid="s09-search"
            />
          </div>
        </div>
      </section>

      {market.data !== undefined ? (
        <p className={s.resultLine} role="status" data-testid="s09-result-line">
          {resultLine(cards.length, tag)}
        </p>
      ) : null}

      {market.isError ? <ErrorCard error={market.error} onRetry={() => void market.refetch()} /> : null}

      {market.data === undefined ? (
        market.isError ? null : (
          <Skeleton rows={6} label="Loading skills" />
        )
      ) : cards.length === 0 ? (
        <EmptyState
          action={
            <div className="app-row app-wrap">
              {tag || search ? (
                <Button onClick={clear} data-testid="s09-clear-filters">
                  Clear the filter
                </Button>
              ) : null}
              <ButtonLink href={routes.newSkill()} variant="primary" icon="plus">
                Write a skill
              </ButtonLink>
            </div>
          }
        >
          {emptyLine(tag, !!search)}
        </EmptyState>
      ) : (
        <section aria-label="Skills" className={x.grid} data-testid="s09-cards" aria-busy={market.isFetching || undefined}>
          {cards.map((c) => (
            <Card key={`${c.skill.id}:${c.skill.version}`} card={fromMarket(c, meId)} selected={sel === c.skill.id} onSelect={onSelect} />
          ))}
        </section>
      )}
    </>
  );
}

function resultLine(n: number, tag: Tag | null): string {
  const what = `${n} ${n === 1 ? 'skill' : 'skills'}`;
  if (tag) return `${what} ${n === 1 ? 'handles' : 'handle'} ${tag}`;
  return `${what} on the market`;
}

function emptyLine(tag: Tag | null, searching: boolean): string {
  if (searching) return 'No skill or creator matches that search. Clear the filter or write one.';
  if (tag) return `No skills handle ${tag} yet. Clear the filter or write one.`;
  return 'No skills on the market yet. Write one and mint it.';
}

// ---------- My skills tab ----------

function MineList({ sel, onSelect }: { sel: string | null; onSelect: (id: string) => void }) {
  const api = useApi();
  const { status } = useSession();
  const me = useMe();
  const enabled = status === 'signedIn';
  const written = useQuery({ queryKey: qk.skills.list('written'), queryFn: () => api.skills('written'), enabled });
  const owned = useQuery({ queryKey: qk.skills.list('owned'), queryFn: () => api.skills('owned'), enabled });
  const meId = me.data?.account.id;

  const failed = written.isError ? written : owned.isError ? owned : null;
  if (failed)
    return (
      <ErrorCard
        error={failed.error}
        onRetry={() => {
          void written.refetch();
          void owned.refetch();
        }}
      />
    );
  if (!written.data || !owned.data) return <Skeleton rows={6} label="Loading your skills" />;

  const rows = mergeMine(written.data, owned.data);
  if (!rows.length)
    return (
      <EmptyState
        action={
          <ButtonLink href={routes.newSkill()} variant="primary" icon="plus">
            Write a skill
          </ButtonLink>
        }
      >
        You have no skills yet. Write one, or buy one on the Exchange.
      </EmptyState>
    );
  return (
    <section aria-label="My skills" className={x.grid} data-testid="s09-mine">
      {rows.map(({ row, held }) => (
        <Card key={`${row.id}:${row.version}`} card={fromRow(row, held, meId)} selected={sel === row.id} onSelect={onSelect} />
      ))}
    </section>
  );
}

/** Written skills first (latest version of each), then held ones not written by me; one card per skill. */
export function mergeMine(written: SkillRow[], owned: SkillRow[]): { row: SkillRow; held: boolean }[] {
  const heldIds = new Set(owned.map((r) => r.id));
  const out = written.map((row) => ({ row, held: heldIds.has(row.id) }));
  const seen = new Set(written.map((r) => r.id));
  for (const row of owned) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    out.push({ row, held: true });
  }
  return out;
}

// ---------- Cards ----------

interface CardModel {
  skill: SkillView;
  creator: string;
  priceYocto: string | null;
  owned: boolean;
  /** Written by the viewer. */
  mine: boolean;
  /** My skills tab: show the status where the price goes. */
  statusLine?: SkillStatus | 'Owned';
  /** Exchange cards: the v2 proof (ranked win rate and benchmark score). */
  v2?: Pick<MarketCard, 'rankedWinRate' | 'rankedMatches' | 'benchmarkScore'>;
}

function fromMarket(c: MarketCard, meId: string | undefined): CardModel {
  return {
    skill: c.skill,
    creator: c.creator.nearAccountId ?? c.creator.handle,
    priceYocto: c.priceYocto,
    owned: c.owned,
    mine: !!meId && c.creator.id === meId,
    v2: { rankedWinRate: c.rankedWinRate, rankedMatches: c.rankedMatches, benchmarkScore: c.benchmarkScore },
  };
}

function fromRow(row: SkillRow, held: boolean, meId: string | undefined): CardModel {
  const mine = !!meId && row.creatorAccount.id === meId;
  return {
    skill: row,
    creator: row.creatorAccount.nearAccountId ?? row.creatorAccount.handle,
    priceYocto: null,
    owned: held,
    mine,
    statusLine: mine || row.status === 'Starter' ? row.status : 'Owned',
  };
}

/** "Won 63% of 16 ranked · Benchmark 71%" / "No ranked matches · Not benchmarked". */
export function v2ProofLine(p: NonNullable<CardModel['v2']>): string {
  const ranked =
    p.rankedMatches > 0 && p.rankedWinRate !== null
      ? `Won ${Math.round(p.rankedWinRate * 100)}% of ${p.rankedMatches} ranked`
      : 'No ranked matches';
  const bench = p.benchmarkScore === null ? 'Not benchmarked' : `Benchmark ${Math.round(p.benchmarkScore * 100)}%`;
  return `${ranked} · ${bench}`;
}

/** The proof line of a My skills card, which carries no ranked or benchmark figures. */
const ROW_PROOF = 'Not rated yet: 0 of 5 public runs';

function Card({ card: c, selected, onSelect }: { card: CardModel; selected: boolean; onSelect: (id: string) => void }) {
  const sk = c.skill;
  const tilt = useTilt();
  const rar = rarityOf({ accountBound: sk.accountBound, status: sk.status });
  const badge = sk.accountBound ? 'Official · starter' : c.mine ? 'Yours' : null;
  const p = c.v2 && c.v2.rankedMatches > 0 && c.v2.rankedWinRate !== null ? Math.round(c.v2.rankedWinRate * 100) : null;
  return (
    <button
      type="button"
      className={x.card}
      style={{ '--rc': rar.colour } as CSSProperties}
      aria-pressed={selected}
      onClick={() => onSelect(sk.id)}
      data-testid={`s09-card-${sk.id}`}
      {...tilt}
    >
      <span className={x.art}>
        <SkillArt name={sk.name} tag={sk.handles_tags[0]} className={x.artCanvas} />
        <span className={x.rar} title={`Rarity: ${rar.band}`} data-testid="s09-rarity">
          {rar.label}
        </span>
        <span className={x.ver}>v{sk.version}</span>
        <span className={x.badges}>
          {badge ? (
            <Badge tone="you" icon={false}>
              {badge}
            </Badge>
          ) : null}
          {c.owned ? <Badge tone="good">Owned</Badge> : null}
          <RoleTag roles={sk.roles} />
        </span>
      </span>
      <span className={x.in}>
        <b className={x.name}>{sk.name}</b>
        <span className={x.by}>by {c.creator}</span>
        {sk.trigger && sk.trigger.kind !== 'always' ? (
          <span className={x.by} data-testid="s09-trigger">
            Plays when: {describeSkillTrigger(sk.trigger).toLowerCase()}
          </span>
        ) : null}
        <span className={x.wr}>
          <span className={x.proof} data-testid="s09-proof">
            {c.v2 ? v2ProofLine(c.v2) : ROW_PROOF}
          </span>
          <span className={x.ln}>
            <i style={{ width: `${p ?? 0}%` }} />
          </span>
        </span>
        <span className={x.meta}>
          <span className="sk-kick">{sk.handles_tags[0] ?? ''}</span>
          {c.statusLine ? (
            <span className={x.status}>{c.statusLine}</span>
          ) : c.priceYocto !== null ? (
            <span className={x.price} data-testid="s09-price">
              {near(c.priceYocto)}
            </span>
          ) : (
            <span className={x.notForSale}>Not for sale</span>
          )}
        </span>
      </span>
    </button>
  );
}
