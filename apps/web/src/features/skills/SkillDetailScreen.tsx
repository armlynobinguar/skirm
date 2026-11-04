'use client';
// S10 Skill detail, shown as the Exchange's side drawer (the prototype's #drawer, P 2448-2478).
// /market/[skillId] deep links open the market with the drawer on that skill. Owner: skills builder.
// GET /market/:skillId: public fields, sales, the active listing (with the Formulas §6 split) and the
// pinned version hash. Never any skill text: a bought skill grants use, and the creator reads their
// own text in the editor, not here.
// Proof panels: the version lock, the benchmark at mint (the hidden gauntlet, `benchmark`), the
// ranked v2 record per map, counter stats and the hijack gauntlet's leak and manipulation rates. Offline servers run the greedy bot brain, which never reads skills, so the
// benchmark and trials say they need a model key and show no score.
// Try before you buy: POST /market/:id/trial with one of your agents, then GET /market/:id/trials,
// polled while a trial runs; 3 trials per version (429 trial_limit).
// Buy: M01 when no NEAR account is linked, then M02 with the api's split; dev auth mode records the
// purchase with a `dev:<yocto>:<nonce>` hash (apps/api market.controller). Otherwise the wallet
// signs `market.buy({token_id})` with the price attached and the tx hash goes to
// POST /market/:id/purchase. List for resale: M02 with the same split computed by @skirm/shared
// splitSale (the listing does not exist yet); outside dev mode the wallet signs
// `skills.nft_approve(token, market, {"price"})` first; then POST /market/:id/listing {priceYocto, txHash}.
// A signed transaction whose POST failed is re-sent on "Try again", never signed (paid) twice.
// Equip: PATCH /agents/:id with the skill added (≤ 3 per agent).
import { Badge, Button, Icon, TagChip, TextField, UnlockChip, fmt } from '@skirm/ui';
import { DIFFS, diffIndex, mapById } from '@/features/arena/world';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { splitSale } from '@skirm/shared';
import { ButtonLink } from '@/components/ButtonLink';
import { EmptyState } from '@/components/states/EmptyState';
import { ErrorCard } from '@/components/states/ErrorCard';
import { Skeleton } from '@/components/states/Skeleton';
import { useToast } from '@/components/toast/ToastProvider';
import { isApiError } from '@/lib/api/errors';
import { qk, useMe, useStartTrial, useTrials } from '@/lib/api/queries';
import type { Agent, Listing, MarketBenchmark, MarketDetail, Me, RecordTally, Trial, TrialResult } from '@/lib/api/types';
import { useSession } from '@/lib/auth/session';
import { routes } from '@/lib/routes';
import { useApi } from '@/lib/services';
import { buyTx, listTx, tokenIdOf } from '@/lib/wallet/contracts';
import { useNearSigner } from '@/lib/wallet/hooks';
import { WalletError } from '@/lib/wallet/types';
import { ConfirmTransactionModal } from './ConfirmTransactionModal';
import { ConnectWalletModal } from './ConnectWalletModal';
import { MarketplaceScreen } from './MarketplaceScreen';
import { ACTION_UNLOCK, NEEDS_MODEL, bpsPct, devTxHash, near, parsePrice, shortDate } from './lib';
import { StatusBadge, rarityOf, shortHash } from './parts';
import s from './skills.module.css';
import x from './exchange.module.css';
import { triggerSentence } from './TriggerField';

/** /market/[skillId]: the Exchange with the drawer open on this skill. */
export function SkillDetailScreen({ skillId }: { skillId: string }) {
  return <MarketplaceScreen skillId={skillId} />;
}

/** The drawer body for one skill. `onClose` empties the drawer (and puts the URL back on /market). */
export function SkillDrawer({ skillId, onClose }: { skillId: string; onClose: () => void }) {
  const api = useApi();
  const { status } = useSession();
  const me = useMe();
  const q = useQuery({
    queryKey: qk.market.one(skillId),
    queryFn: () => api.marketSkill(skillId),
    enabled: status === 'signedIn',
  });

  let body: ReactNode;
  if (q.data !== undefined)
    body = (
      <>
        {q.isError ? <ErrorCard error={q.error} onRetry={() => void q.refetch()} /> : null}
        <DrawerView d={q.data} me={me.data} onClose={onClose} />
      </>
    );
  else if (q.isError && isApiError(q.error) && (q.error.status === 404 || q.error.code === 'not_found'))
    body = (
      <>
        <CloseBar onClose={onClose} />
        <EmptyState action={<Button onClick={onClose}>Back to the market</Button>}>This skill was delisted or does not exist.</EmptyState>
      </>
    );
  else if (q.isError)
    body = (
      <>
        <CloseBar onClose={onClose} />
        <ErrorCard error={q.error} onRetry={() => void q.refetch()} />
      </>
    );
  else
    body = (
      <>
        <CloseBar onClose={onClose} />
        <Skeleton rows={8} label="Loading skill" />
      </>
    );
  return (
    <div className={x.dr} data-testid="screen-s10">
      {body}
    </div>
  );
}

function CloseButton({ onClose }: { onClose: () => void }) {
  return (
    <button type="button" className={x.close} onClick={onClose} aria-label="Close the skill detail" data-testid="s10-close">
      <Icon name="close" size={16} />
    </button>
  );
}

function CloseBar({ onClose }: { onClose: () => void }) {
  return (
    <div className={x.drTop}>
      <span className="sk-kick">Skill detail</span>
      <CloseButton onClose={onClose} />
    </div>
  );
}

function feeBpsOf(price: bigint, fee: bigint): number {
  return price > 0n ? Number((fee * 10_000n) / price) : 0;
}

/** One proof block (P .proof): a display-font title, a mono sub-label, then its body. */
function Proof({ title, sub, children, ...rest }: { title: string; sub?: string; children: ReactNode; 'data-testid'?: string }) {
  return (
    <section className={x.proofBox} aria-label={title} data-testid={rest['data-testid']}>
      <h3 className={x.proofHead}>
        <span>{title}</span>
        {sub ? <small>{sub}</small> : null}
      </h3>
      {children}
    </section>
  );
}

function DrawerView({ d, me, onClose }: { d: MarketDetail; me: Me | undefined; onClose: () => void }) {
  const sk = d.skill;
  const creator = sk.creatorAccount.nearAccountId ?? sk.creatorAccount.handle;
  const listing = d.listing;
  const myId = me?.account.id;
  const isCreator = !!myId && myId === sk.creatorAccount.id;
  const ownListing = !!listing && listing.sellerId === myId;
  const listedBy = listing ? (listing.sellerId === sk.creatorAccount.id ? 'the creator' : sk.owner) : null;
  const unlocks = sk.requires_actions.map((a) => ACTION_UNLOCK[a as keyof typeof ACTION_UNLOCK]);
  const rar = rarityOf({ accountBound: sk.accountBound, status: sk.status });
  const draft = sk.status === 'Draft';
  const hash = d.pinned.promptSha256;
  const version = d.pinned.version;
  const tokenId = d.pinned.tokenId;

  return (
    <article className={x.drView} style={{ '--rc': rar.colour } as CSSProperties} aria-labelledby="s10-name">
      <div className={x.drTop}>
        <span className={`sk-kick ${x.rarKick}`} data-testid="s10-rarity">
          {rar.label} · {rar.band}
        </span>
        <CloseButton onClose={onClose} />
      </div>
      <div className={x.drTitle}>
        <h2 id="s10-name" className={x.disp} data-testid="s10-name">
          {sk.name}
        </h2>
        <div className="app-row app-wrap">
          <Badge icon={false}>v{sk.version}</Badge>
          <StatusBadge status={sk.status} />
          {d.owned ? <Badge tone="good">Owned</Badge> : null}
        </div>
      </div>
      <span className="sk-kick" data-testid="s10-creator">
        by {creator}
        {listedBy ? ` · listed by ${listedBy}` : ''}
      </span>
      {sk.summary ? <p className={x.blurb}>{sk.summary}</p> : null}
      <div className="sk-chiprow">
        {unlocks.map((u) => (
          <UnlockChip key={u} unlock={u} state="needed" />
        ))}
        {sk.handles_tags.map((t) => (
          <TagChip key={t} tag={t} />
        ))}
      </div>

      <p className={x.blurb} data-testid="s10-trigger">
        <b>When it plays</b> · {triggerSentence(sk.trigger)}
      </p>

      {isCreator ? (
        <div className={x.hid} data-testid="s10-prompt-own">
          <b>Prompt · only you can read this.</b> It stays out of the market;{' '}
          <Link href={routes.editSkill(sk.id)}>read and edit it in the editor</Link>.
        </div>
      ) : (
        <div className={x.hid} data-testid="s10-encrypted">
          PROMPT ENCRYPTED · you buy the right to run it, never the text. Proof below comes from the platform, not the
          seller.
        </div>
      )}

      <Actions d={d} me={me} ownListing={ownListing} creator={creator} />

      <Proof title="Version lock" sub={`V${version}`} data-testid="s10-version-lock">
        <p>
          {draft
            ? `Not locked yet: a draft changes with every save. Minting pins v${version} to its prompt hash, ${shortHash(hash)}.`
            : `Editing the prompt mints a new version and its stats restart at zero. What you ${d.owned ? 'hold' : 'buy'} is v${version}, hash ${shortHash(hash)}.`}
        </p>
        <dl className={x.lockFacts}>
          <dt>Prompt sha256</dt>
          <dd className={x.hash} data-testid="s10-hash">
            {hash}
          </dd>
          {tokenId ? (
            <>
              <dt>Token</dt>
              <dd className={x.hash}>{tokenId}</dd>
            </>
          ) : null}
          {d.pinned.mintedAt ? (
            <>
              <dt>Minted</dt>
              <dd>{shortDate(d.pinned.mintedAt)}</dd>
            </>
          ) : null}
        </dl>
      </Proof>

      {draft ? (
        <Proof title="Not minted" sub="DRAFT">
          <p>Not on the market yet. Mint it in the editor; the benchmark runs at mint and stats start at zero for every new version.</p>
        </Proof>
      ) : (
        <>
          <BenchmarkProof b={d.benchmark} />
          <RankedProof ranked={d.ranked} />
          <CountersProof vs={d.counters.vs} />
          <GauntletProof b={d.benchmark} />
        </>
      )}

      {!d.owned && !isCreator && !draft ? <TrialsProof d={d} agents={me?.agents ?? []} /> : null}

      <Proof title="Sale history" data-testid="s10-sales">
        <table className={s.smallTable}>
          <thead>
            <tr>
              <th scope="col">Date</th>
              <th scope="col">Event</th>
              <th scope="col" className={s.right}>
                Price
              </th>
            </tr>
          </thead>
          <tbody>
            {listing ? (
              <tr>
                <td className={s.mono}>{shortDate(listing.createdAt)}</td>
                <td>
                  Listed by {listedBy} · v{listing.version}
                </td>
                <td className={`${s.right} ${s.mono}`}>{near(listing.priceYocto)}</td>
              </tr>
            ) : null}
            {d.sales.map((sale) => (
              <tr key={sale.id}>
                <td className={s.mono}>{shortDate(sale.createdAt)}</td>
                <td>
                  {sale.sellerId === sk.creatorAccount.id ? 'Sold by the creator' : 'Resold'} · v{sale.version}
                </td>
                <td className={`${s.right} ${s.mono}`}>{near(sale.priceYocto)}</td>
              </tr>
            ))}
            {!draft && !sk.accountBound ? (
              <tr>
                <td className={s.mono}>–</td>
                <td>
                  Minted by {creator} · {bpsPct(sk.royalty_bps)} royalty
                </td>
                <td className={`${s.right} sk-muted`}>–</td>
              </tr>
            ) : null}
          </tbody>
        </table>
        {!listing && !d.sales.length ? <p>No sales yet.</p> : null}
      </Proof>
    </article>
  );
}

// ---------- Exchange proof (v2) ----------

const v2MapName = (id: string) => mapById(id)?.name ?? id;
const wld = (r: Pick<RecordTally, 'wins' | 'losses' | 'draws'>) => `${r.wins}–${r.losses}–${r.draws}`;
const winPct = (r: Pick<RecordTally, 'wins' | 'matches'>) => (r.matches ? `${Math.round((r.wins / r.matches) * 100)}%` : '–');
const ratePct = (x: number | null) => (x === null ? '–' : `${Math.round(x * 100)}%`);

function BenchmarkProof({ b }: { b: MarketBenchmark | null }) {
  let body: ReactNode;
  if (!b) body = <p>Runs when this version is minted, on seeds the seller never sees.</p>;
  else if (b.needsModel) body = <p data-testid="s10-benchmark-needs-model">{NEEDS_MODEL}. No score until it runs with one.</p>;
  else if (b.status === 'queued' || b.status === 'running')
    body = <p>{b.status === 'queued' ? 'Queued.' : 'Running now.'} The platform plays it on hidden seeds against the bot crew; results show here when it ends.</p>;
  else if (b.status === 'failed') body = <p>The benchmark did not finish. The platform runs it again on the next mint.</p>;
  else
    body = (
      <>
        <dl className={x.lockFacts}>
          <dt>Score</dt>
          <dd data-testid="s10-benchmark-score">{b.score === null ? 'No score' : ratePct(b.score)}</dd>
          <dt>Record</dt>
          <dd>{wld(b)}</dd>
          <dt>Deliveries</dt>
          <dd>{fmt(b.deliveries)}</dd>
        </dl>
        <p>Win rate on hidden seeds, cut by how often the skill text leaked. Played by the platform, not the seller.</p>
      </>
    );
  return (
    <Proof title="Benchmark at mint" sub={b?.brain ? `HIDDEN SEEDS · ${b.brain.toUpperCase()}` : 'HIDDEN SEEDS'} data-testid="s10-benchmark">
      {body}
    </Proof>
  );
}

function RankedProof({ ranked }: { ranked: MarketDetail['ranked'] }) {
  return (
    <Proof title="Ranked record" sub="V2 · STANDARD TALK" data-testid="s10-ranked">
      {ranked.matches === 0 ? (
        <p>No ranked matches with this version yet.</p>
      ) : (
        <>
          <p data-testid="s10-ranked-total">
            Won {fmt(ranked.wins)} of {fmt(ranked.matches)} ranked {ranked.matches === 1 ? 'match' : 'matches'} ({winPct(ranked)}).
          </p>
          <ul className={x.mapRows}>
            {ranked.perMap.map((m) => (
              <li key={m.mapId} className={x.mapRow} data-testid={`s10-ranked-${m.mapId}`}>
                <span className={x.mapName}>{v2MapName(m.mapId)}</span>
                <span className={x.mapVal}>{winPct(m)} won</span>
                <span className={x.mapVal}>{wld(m)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Proof>
  );
}

function CountersProof({ vs }: { vs: MarketDetail['counters']['vs'] }) {
  return (
    <Proof title="Counter stats" sub="VS THE SKILLS MET MOST" data-testid="s10-counters">
      {vs.length === 0 ? (
        <p>No ranked matches against other skills yet.</p>
      ) : (
        <ul className={x.mapRows}>
          {vs.map((c) => (
            <li key={`${c.skillId}:${c.version}`} className={x.mapRow} data-testid={`s10-counter-${c.skillId}`}>
              <span className={x.mapName}>
                {c.name ?? c.skillId} v{c.version}
              </span>
              <span className={x.mapVal}>{winPct(c)} won</span>
              <span className={x.mapVal}>{wld(c)}</span>
            </li>
          ))}
        </ul>
      )}
    </Proof>
  );
}

function GauntletProof({ b }: { b: MarketBenchmark | null }) {
  let body: ReactNode;
  if (b?.needsModel) body = <p>{NEEDS_MODEL}.</p>;
  else if (!b || b.status !== 'done') body = <p>Shows once the benchmark has run. Rivals try prompt injection and probing; a leak is any message that matches this prompt.</p>;
  else
    body = (
      <>
        <dl className={x.lockFacts}>
          <dt>Leak rate</dt>
          <dd data-testid="s10-gauntlet-leak">{ratePct(b.leakRate)}</dd>
          <dt>Manipulation rate</dt>
          <dd data-testid="s10-gauntlet-manipulation">{ratePct(b.manipulationRate)}</dd>
        </dl>
        <p>Leak: matches where the skill text came out. Manipulation: hijack matches where an injected line got a leak or abuse through.</p>
      </>
    );
  return (
    <Proof title="Manipulation" sub="HIJACK GAUNTLET" data-testid="s10-gauntlet">
      {body}
    </Proof>
  );
}

/** The buyer's side's result of one trial match (crew A carries the skill). */
export function trialOutcome(r: TrialResult): 'win' | 'loss' | 'draw' | null {
  if (r.outcome) return r.outcome;
  if (r.winner === 'draw') return 'draw';
  if (r.winner === 'A') return 'win';
  if (r.winner === 'B') return 'loss';
  return null;
}

const OUTCOME_LABEL = { win: 'Win', loss: 'Loss', draw: 'Draw' } as const;

function TrialsProof({ d, agents }: { d: MarketDetail; agents: Agent[] }) {
  const sk = d.skill;
  const trials = useTrials(sk.id, sk.version);
  const start = useStartTrial(sk.id);
  const [agentId, setAgentId] = useState('');
  const agent = agents.find((a) => a.id === agentId) ?? agents[0];
  const limited = isApiError(start.error) && (start.error.status === 429 || start.error.code === 'trial_limit');
  const noneLeft = d.trials.left <= 0 || limited;
  // Between the 202 and the refetch that lists the new trial nothing looks open, so a second click
  // would start (and count) a second trial: the started one counts as open until it is listed.
  const unlisted = start.isSuccess && !(trials.data ?? []).some((t) => t.id === start.data.trialId);
  const running = unlisted || (trials.data ?? []).some((t) => t.status === 'queued' || t.status === 'running');

  return (
    <Proof title="Try before you buy" sub={`${d.trials.left} OF ${d.trials.used + d.trials.left} LEFT`} data-testid="s10-trials">
      <p>Three matches of your agent carrying this skill against the bot crew, so you see what it does before you pay.</p>
      {agents.length === 0 ? (
        <p>You need an agent to run a trial.</p>
      ) : (
        <div className={x.listForm}>
          <label className={s.selectLabel}>
            Agent
            <select className={s.select} value={agent?.id ?? ''} onChange={(e) => setAgentId(e.target.value)} data-testid="s10-trial-agent">
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} · {a.role}
                </option>
              ))}
            </select>
          </label>
          <Button
            variant="primary"
            disabled={noneLeft || running}
            loading={start.isPending}
            onClick={() => start.mutate({ agentId: agent!.id, version: sk.version })}
            data-testid="s10-trial-start"
          >
            {running ? 'Trial running…' : 'Run a trial'}
          </Button>
        </div>
      )}
      {noneLeft ? (
        <p className="app-banner is-warning" role="status" data-testid="s10-trial-limit">
          Trial limit reached
        </p>
      ) : start.isError ? (
        <ErrorCard error={start.error} onRetry={() => start.reset()} />
      ) : null}
      {trials.isError ? <ErrorCard error={trials.error} onRetry={() => void trials.refetch()} /> : null}
      {trials.data?.length ? (
        <ul className={x.mapRows} data-testid="s10-trial-list">
          {trials.data.map((t) => (
            <TrialRow key={t.id} t={t} agentName={agents.find((a) => a.id === t.agentId)?.name ?? 'Your agent'} />
          ))}
        </ul>
      ) : null}
    </Proof>
  );
}

function TrialRow({ t, agentName }: { t: Trial; agentName: string }) {
  let body: ReactNode;
  if (t.status === 'queued') body = <span className="app-small sk-muted">Queued</span>;
  else if (t.status === 'running') body = <span className="app-small sk-muted">Playing…</span>;
  else if (t.status === 'needs_model') body = <span className="app-small sk-muted">{NEEDS_MODEL}. This trial did not count.</span>;
  else if (t.status === 'failed') body = <span className="app-small sk-muted">Did not finish.</span>;
  else
    body = (
      <ul className={x.tagStats}>
        {(t.results ?? []).map((r, i) => {
          const o = trialOutcome(r);
          const diff = r.difficulty ? DIFFS[diffIndex(r.difficulty)]?.n : null;
          return (
            <li key={i} data-testid={`s10-trial-${t.id}-${i}`}>
              <small>
                {v2MapName(r.mapId)}
                {diff ? ` · ${diff}` : ''}
              </small>
              <span>
                {o ? OUTCOME_LABEL[o] : '–'}
                {r.score ? ` · ${r.score.A}–${r.score.B}` : ''}
              </span>
            </li>
          );
        })}
      </ul>
    );
  return (
    <li className={x.mapRow} data-testid={`s10-trial-${t.id}`}>
      <span className={x.mapName}>
        {agentName} · {shortDate(t.createdAt)}
      </span>
      {body}
    </li>
  );
}

// ---------- Buy / equip / list ----------

type Flow = null | { step: 'wallet' | 'confirm'; action: 'buy' | 'list' };

function Actions({ d, me, ownListing, creator }: { d: MarketDetail; me: Me | undefined; ownListing: boolean; creator: string }) {
  const api = useApi();
  const qc = useQueryClient();
  const { mode } = useSession();
  const sk = d.skill;
  const listing = d.listing;
  const [flow, setFlow] = useState<Flow>(null);
  const [priceText, setPriceText] = useState('');
  const [priceError, setPriceError] = useState<string | null>(null);
  const [listYocto, setListYocto] = useState<string | null>(null);
  // The listing being bought, kept for M02's done state (the refetch after a sale drops it).
  const [buying, setBuying] = useState<Listing | null>(null);
  const [soldBy, setSoldBy] = useState('');

  const nearId = me?.account.nearAccountId ?? null;
  const isCreator = !!me && me.account.id === sk.creatorAccount.id;
  const canBuy = !d.owned && !!listing && !ownListing;
  const canList = d.owned && sk.status !== 'Draft' && !sk.accountBound;

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: qk.market.all });
    void qc.invalidateQueries({ queryKey: qk.skills.all });
    void qc.invalidateQueries({ queryKey: qk.me });
  };

  const begin = (action: 'buy' | 'list') => setFlow({ step: nearId ? 'confirm' : 'wallet', action });

  const startList = () => {
    const p = parsePrice(priceText);
    if ('error' in p) {
      setPriceError(p.error);
      return;
    }
    setPriceError(null);
    setListYocto(p.yocto);
    begin('list');
  };

  const signer = useNearSigner();
  // Signed but not yet recorded by the api (the POST failed): re-sent as is on "Try again".
  const signedBuy = useRef<{ listingId: string; txHash: string } | null>(null);
  const signedList = useRef<{ key: string; txHash: string } | null>(null);

  const linkedOrThrow = (): string => {
    if (!nearId) throw new WalletError('wallet_no_account', 'Connect a NEAR wallet first.');
    return nearId;
  };

  const buy = async () => {
    const listing = buying;
    if (!listing) return;
    let txHash: string;
    if (mode === 'dev') txHash = devTxHash(listing.priceYocto);
    else if (signedBuy.current?.listingId === listing.id) txHash = signedBuy.current.txHash;
    else {
      const tokenId = listing.tokenId ?? tokenIdOf(sk.id, listing.version);
      txHash = await signer.send(buyTx(signer.contracts, tokenId, listing.priceYocto), linkedOrThrow());
      signedBuy.current = { listingId: listing.id, txHash };
    }
    await api.purchaseSkill(sk.id, { txHash, version: listing.version });
    signedBuy.current = null;
    refresh();
  };

  const list = async () => {
    if (!listYocto) return;
    let txHash: string | undefined;
    if (mode !== 'dev') {
      const key = `${sk.version}:${listYocto}`;
      if (signedList.current?.key === key) txHash = signedList.current.txHash;
      else {
        const tokenId = sk.tokenId ?? tokenIdOf(sk.id, sk.version);
        txHash = await signer.send(listTx(signer.contracts, tokenId, listYocto), linkedOrThrow());
        signedList.current = { key, txHash };
      }
    }
    await api.listSkill(sk.id, { priceYocto: listYocto, version: sk.version, ...(txHash ? { txHash } : {}) });
    signedList.current = null;
    refresh();
  };

  const listSplit = listYocto
    ? splitSale(BigInt(listYocto), { primary: isCreator, royaltyBps: sk.royalty_bps })
    : null;

  return (
    <div className={x.buyBox}>
      {listing ? (
        <span className={x.drPrice} data-testid="s10-price">
          {near(listing.priceYocto)}
        </span>
      ) : (
        <span className="sk-muted" data-testid="s10-price">
          Not for sale
        </span>
      )}
      {!sk.accountBound ? (
        <span className={s.royalty}>
          <Icon name="royalty" size={13} />
          {bpsPct(sk.royalty_bps)} to creator on resale
        </span>
      ) : (
        <span className={s.royalty}>Starter skill: account-bound, not an NFT</span>
      )}

      {canBuy ? (
        <>
          <Button
            variant="primary"
            onClick={() => {
              setBuying(listing);
              setSoldBy(listing.sellerId === sk.creatorAccount.id ? '' : ` · sold by ${sk.owner}`);
              begin('buy');
            }}
            data-testid="s10-buy"
          >
            Buy · {near(listing.priceYocto)}
          </Button>
          <span className="app-small sk-muted">You get the right to use it. Its text stays hidden.</span>
        </>
      ) : null}
      {ownListing ? <span className="app-small sk-muted" data-testid="s10-own-listing">Your listing. Buyers see it on the market.</span> : null}
      {sk.status === 'Draft' && isCreator ? (
        <ButtonLink href={routes.editSkill(sk.id)} data-testid="s10-edit">
          Test and mint in the editor
        </ButtonLink>
      ) : null}
      {sk.status !== 'Draft' && isCreator && !sk.accountBound ? (
        <ButtonLink href={routes.editSkill(sk.id)} data-testid="s10-edit">
          Edit · new version
        </ButtonLink>
      ) : null}

      {d.owned ? <Equip skillId={sk.id} version={sk.version} name={sk.name} agents={me?.agents ?? []} /> : null}

      {canList ? (
        <div className={x.listForm}>
          <TextField
            label={ownListing ? 'New price' : 'Resale price'}
            value={priceText}
            onChange={(e) => setPriceText(e.target.value)}
            suffix="NEAR"
            mono
            inputMode="decimal"
            placeholder="1.5"
            {...(priceError ? { error: priceError } : {})}
            data-testid="s10-list-price"
          />
          <Button icon="royalty" onClick={startList} data-testid="s10-list">
            {ownListing ? 'Change price' : 'List for resale'}
          </Button>
        </div>
      ) : null}

      <ConnectWalletModal
        open={flow?.step === 'wallet'}
        reason={flow?.action ?? 'buy'}
        onClose={() => setFlow(null)}
        onConnected={() => setFlow((f) => (f ? { ...f, step: 'confirm' } : f))}
      />

      {buying?.split ? (
        <ConfirmTransactionModal
          open={flow?.step === 'confirm' && flow.action === 'buy'}
          title="Confirm purchase"
          item={sk.name}
          itemDetail={`by ${creator}${soldBy}`}
          priceYocto={buying.priceYocto}
          royaltyYocto={buying.split.royaltyYocto}
          royaltyLabel={buying.split.primary ? 'Creator royalty · none on a first sale' : `Creator royalty · ${bpsPct(sk.royalty_bps)} to ${creator}`}
          feeYocto={buying.split.feeYocto}
          feeLabel={`Platform fee · ${bpsPct(feeBpsOf(BigInt(buying.priceYocto), BigInt(buying.split.feeYocto)))}`}
          sellerYocto={buying.split.sellerYocto}
          account={nearId}
          note={`You get the right to equip ${sk.name} and resell it. Its text stays hidden. Royalty and fee come out of the price; you pay the price plus the network fee.`}
          doneTitle={`${sk.name} is yours`}
          doneMessage={`Equip it on an agent here or in the crew builder. Paid ${near(buying.priceYocto)} plus the network fee.`}
          onConfirm={buy}
          onClose={() => {
            setFlow(null);
            setBuying(null);
          }}
        />
      ) : null}

      {listYocto && listSplit ? (
        <ConfirmTransactionModal
          open={flow?.step === 'confirm' && flow.action === 'list'}
          kind="receive"
          title="Confirm listing"
          item={`List ${sk.name} v${sk.version}`}
          itemDetail={`by ${creator}`}
          priceYocto={listYocto}
          royaltyYocto={listSplit.royalty.toString()}
          royaltyLabel={isCreator ? 'Creator royalty · none on a first sale' : `Creator royalty · ${bpsPct(sk.royalty_bps)} to ${creator}`}
          feeYocto={listSplit.fee.toString()}
          feeLabel={`Platform fee · ${bpsPct(feeBpsOf(BigInt(listYocto), listSplit.fee))}`}
          sellerYocto={listSplit.seller.toString()}
          account={nearId}
          note="The wallet approves the market to sell this token at this price. You keep it until someone buys it, and can change the price any time."
          confirmLabel="Approve in wallet"
          doneTitle={`${sk.name} is listed`}
          doneMessage={`Listed at ${near(listYocto)}. Buyers see it on the market now.`}
          onConfirm={list}
          onClose={() => {
            setFlow(null);
            setPriceText('');
          }}
        />
      ) : null}
    </div>
  );
}

function Equip({ skillId, version, name, agents }: { skillId: string; version: number; name: string; agents: Agent[] }) {
  const api = useApi();
  const qc = useQueryClient();
  const toast = useToast();
  const [agentId, setAgentId] = useState<string>('');
  const agent = agents.find((a) => a.id === agentId) ?? agents.find((a) => !a.skills.some((x) => x.id === skillId)) ?? agents[0];
  const already = agent?.skills.find((x) => x.id === skillId);
  const others = agent ? agent.skills.filter((x) => x.id !== skillId) : [];
  const full = others.length >= 3;

  const equip = useMutation({
    mutationFn: () =>
      api.patchAgent(agent!.id, { skills: [...others.map((x) => ({ id: x.id, version: x.version })), { id: skillId, version }] }),
    onSuccess: (a) => {
      void qc.invalidateQueries({ queryKey: qk.me });
      void qc.invalidateQueries({ queryKey: qk.agents });
      toast.show({ tone: 'good', title: `Equipped on ${a.name}`, message: `${name} runs on ${a.name} from the next match.` });
    },
    onError: (err) => toast.error(err, isApiError(err) && err.code === 'agent_busy' ? { title: 'Agent is busy', message: 'This agent is in a match. Try again when it ends.' } : undefined),
  });

  if (!agents.length) return null;
  return (
    <div className={x.listForm} data-testid="s10-equip">
      <label className={s.selectLabel}>
        Agent
        <select className={s.select} value={agent?.id ?? ''} onChange={(e) => setAgentId(e.target.value)} data-testid="s10-equip-agent">
          {agents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name} · {a.skills.length} of 3 skills
            </option>
          ))}
        </select>
      </label>
      <Button
        variant="primary"
        icon="plus"
        disabled={full || (already?.version === version)}
        loading={equip.isPending}
        onClick={() => equip.mutate()}
        data-testid="s10-equip-btn"
        title={full ? `${agent?.name} has 3 skills. Remove one in the crew builder.` : undefined}
      >
        {already?.version === version ? `Equipped on ${agent?.name}` : `Equip on ${agent?.name}`}
      </Button>
    </div>
  );
}
