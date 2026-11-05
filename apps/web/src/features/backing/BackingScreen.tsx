'use client';
// /backing: back skill writers for a capped share of their future royalties (contracts/backing).
// Open rounds to back (GET /backing/rounds?status=open), the caller's portfolio with what each stake
// has paid so far and how far it is to the cap (GET /backing/mine), and the caller's own rounds as a
// writer: open one (terms are fixed for its life), close it to receive the raise, cancel it (stakes
// come back) and, on NEAR, forward the royalties a round is owed. On the keyless local stack the same
// rules run on paid credits and royalties come from skill resales by themselves.
import { Button, TextField } from '@skirm/ui';
import { BACKING } from '@skirm/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { ButtonLink } from '@/components/ButtonLink';
import { QueryView } from '@/components/states/QueryView';
import { Skeleton } from '@/components/states/Skeleton';
import { useToast } from '@/components/toast/ToastProvider';
import type { BackingConfig, BackingPosition, BackingRound, MyBacking } from '@/lib/api/backingTypes';
import { qk, useMe } from '@/lib/api/queries';
import { useSession } from '@/lib/auth/session';
import { formatNear, parseNear } from '@/lib/constants';
import { routes } from '@/lib/routes';
import { useApi } from '@/lib/services';
import s from '@/features/pvp/pvp.module.css';
import { BackForm, ProgressBar, RoundSummary } from './BackRound';
import { capX, money, sharePct, useBackingWrite } from './lib';
import b from './backing.module.css';

export function BackingScreen() {
  const api = useApi();
  const { status } = useSession();
  const me = useMe();
  const config = useQuery({ queryKey: qk.backing.config, queryFn: () => api.backingConfig() });
  const open = useQuery({ queryKey: qk.backing.rounds({ status: 'open' }), queryFn: () => api.backingRounds({ status: 'open' }) });
  const signedIn = status === 'signedIn';
  const mine = useQuery({ queryKey: qk.backing.mine, queryFn: () => api.myBacking(), enabled: signedIn });
  const mode = config.data?.mode ?? 'off';
  const cpn = config.data?.creditsPerNear;
  const myId = me.data?.account.id;

  return (
    <div className={s.page} data-testid="screen-backing">
      <div className={s.head}>
        <div className={s.headText}>
          <h1 className="app-h1">Back a writer</h1>
          <p className={s.lede}>
            Pay a skill writer up front; get a share of their future resale royalties until you have received the multiple they set, then
            it stops. {mode === 'credits' ? 'This server runs backing on paid credits.' : mode === 'near' ? 'Stakes and payouts move NEAR through the backing contract.' : ''}
          </p>
        </div>
        <ButtonLink href={routes.market()}>Exchange</ButtonLink>
      </div>
      {mode === 'off' && config.data ? <p className={s.note}>Writer backing is not set up on this server.</p> : null}
      <div className={s.cols}>
        <div className={s.colMain}>
          <section className={s.card} aria-labelledby="bk-open">
            <h2 className={s.h2} id="bk-open">
              Open rounds
            </h2>
            <QueryView query={open} loading={<Skeleton rows={3} label="Loading rounds" />}>
              {({ rounds }) =>
                rounds.length ? (
                  <ul className={b.list} data-testid="backing-open-rounds">
                    {rounds.map((r) => (
                      <li key={r.id} className={b.item}>
                        <RoundSummary r={r} {...(cpn ? { creditsPerNear: cpn } : {})} />
                        {signedIn && mode !== 'off' && r.writerId !== myId ? <BackForm r={r} mode={mode} {...(cpn ? { creditsPerNear: cpn } : {})} /> : null}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className={s.note}>No open rounds right now.</p>
                )
              }
            </QueryView>
          </section>
          {signedIn ? (
            <section className={s.card} aria-labelledby="bk-mine">
              <h2 className={s.h2} id="bk-mine">
                Your backings
              </h2>
              <QueryView query={mine} loading={<Skeleton rows={3} label="Loading your backings" />}>
                {(d) => <Portfolio d={d} creditsPerNear={cpn} />}
              </QueryView>
            </section>
          ) : null}
        </div>
        <aside className={s.colSide}>
          {signedIn && mode !== 'off' && config.data ? (
            <>
              <OpenRound config={config.data} />
              {mine.data ? <MyRounds rounds={mine.data.rounds} creditsPerNear={cpn} /> : null}
            </>
          ) : null}
        </aside>
      </div>
    </div>
  );
}

function Portfolio({ d, creditsPerNear }: { d: MyBacking; creditsPerNear: number | undefined }) {
  if (!d.positions.length) return <p className={s.note}>You have not backed anyone yet.</p>;
  return (
    <ul className={b.list} data-testid="backing-portfolio">
      {d.positions.map((p) => (
        <Position key={p.backingId} p={p} creditsPerNear={creditsPerNear} />
      ))}
    </ul>
  );
}

function Position({ p, creditsPerNear }: { p: BackingPosition; creditsPerNear: number | undefined }) {
  const api = useApi();
  const toast = useToast();
  const run = useBackingWrite();
  const m = p.round.mode;
  const fmtM = (v: string) => money(v, m, creditsPerNear);
  const cap = BigInt(p.capYocto);
  const earned = BigInt(p.earnedYocto);
  const claimable = BigInt(p.claimableYocto);
  const claim = useMutation({
    mutationFn: () => run(() => api.claimBacking(p.round.id)),
    onSuccess: () => toast.show({ tone: 'good', title: p.round.status === 'cancelled' ? 'Stake returned' : 'Earnings claimed' }),
    onError: (e) => toast.error(e),
  });
  return (
    <li className={b.item} data-testid="backing-position">
      <div className={b.itemHead}>
        <span>
          <b>{p.round.writerHandle}</b>
          <span className={b.muted}>
            {' '}
            · {p.round.skillName ?? 'all skills'} · {p.round.status}
          </span>
        </span>
        <span className={b.muted}>
          {sharePct(p.round.shareBps)} until {capX(p.round.capMultipleBps)}
        </span>
      </div>
      <dl className={b.facts}>
        <div>
          <dt>Staked</dt>
          <dd>{fmtM(p.stakeYocto)}</dd>
        </div>
        <div>
          <dt>Paid so far</dt>
          <dd data-testid="backing-paid">{fmtM(p.claimedYocto)}</dd>
        </div>
        <div>
          <dt>Earned</dt>
          <dd>{fmtM(p.earnedYocto)}</dd>
        </div>
        <div>
          <dt>Cap</dt>
          <dd>{fmtM(p.capYocto)}</dd>
        </div>
      </dl>
      {p.round.status === 'closed' ? (
        <ProgressBar value={cap > 0n ? Number((earned * 1000n) / cap) / 1000 : 0} label="Cap progress" testId="backing-cap-progress" />
      ) : null}
      {p.round.status === 'open' ? <span className={b.muted}>Earnings start when the writer closes the round.</span> : null}
      {p.refunded ? <span className={b.muted}>Round cancelled: your stake came back.</span> : null}
      {claimable > 0n ? (
        <div className={b.row}>
          <Button variant="primary" disabled={claim.isPending} onClick={() => claim.mutate()} data-testid="backing-claim">
            {p.round.status === 'cancelled' ? 'Get my stake back' : `Claim ${fmtM(p.claimableYocto)}`}
          </Button>
        </div>
      ) : null}
    </li>
  );
}

function OpenRound({ config }: { config: BackingConfig }) {
  const api = useApi();
  const toast = useToast();
  const run = useBackingWrite();
  const [share, setShare] = useState('20');
  const [cap, setCap] = useState('2');
  const [raise, setRaise] = useState('');
  const shareBps = Math.round(Number(share) * 100);
  const capBps = Math.round(Number(cap) * 10_000);
  let raiseYocto: string | null = null;
  try {
    raiseYocto = raise.trim() ? parseNear(raise) : null;
  } catch {
    raiseYocto = null;
  }
  const shareOk = Number.isFinite(shareBps) && shareBps >= 1 && shareBps <= config.maxShareBps;
  const capOk = Number.isFinite(capBps) && capBps >= config.minCapMultipleBps && capBps <= config.maxCapMultipleBps;
  const raiseOk = raiseYocto !== null && BigInt(raiseYocto) >= BigInt(config.minStakeYocto) && BigInt(raiseYocto) <= BigInt(config.maxRaiseYocto);
  const create = useMutation({
    mutationFn: () => run(() => api.openBackingRound({ shareBps, capMultipleBps: capBps, maxRaiseYocto: raiseYocto! })),
    onSuccess: () => {
      setRaise('');
      toast.show({ tone: 'good', title: 'Round open', message: 'Players can back you now.' });
    },
    onError: (e) => toast.error(e),
  });
  return (
    <section className={s.card} aria-labelledby="bk-new">
      <h2 className={s.h3} id="bk-new">
        Open a round
      </h2>
      <form
        className={b.form}
        onSubmit={(e) => {
          e.preventDefault();
          if (shareOk && capOk && raiseOk) create.mutate();
        }}
      >
        <TextField
          label="Backers' share of royalties (%)"
          inputMode="decimal"
          value={share}
          onChange={(e) => setShare(e.target.value)}
          error={shareOk ? undefined : `1 to ${config.maxShareBps / 100}%`}
          data-testid="backing-share"
        />
        <TextField
          label="Until backers get (× their stake)"
          inputMode="decimal"
          value={cap}
          onChange={(e) => setCap(e.target.value)}
          error={capOk ? undefined : `${config.minCapMultipleBps / 10_000}× to ${config.maxCapMultipleBps / 10_000}×`}
          data-testid="backing-cap"
        />
        <TextField
          label="Raise up to (NEAR)"
          inputMode="decimal"
          value={raise}
          onChange={(e) => setRaise(e.target.value)}
          hint={`At least ${formatNear(BACKING.minStakeYocto)} NEAR. Covers every skill you sell.`}
          data-testid="backing-raise"
        />
        <Button type="submit" variant="primary" disabled={!shareOk || !capOk || !raiseOk || create.isPending} data-testid="backing-open">
          Open the round ▸
        </Button>
      </form>
    </section>
  );
}

function MyRounds({ rounds, creditsPerNear }: { rounds: MyBacking['rounds']; creditsPerNear: number | undefined }) {
  if (!rounds.length) return null;
  return (
    <section className={s.card} aria-labelledby="bk-rounds">
      <h2 className={s.h3} id="bk-rounds">
        Your rounds
      </h2>
      <ul className={b.list} data-testid="backing-my-rounds">
        {rounds.map((r) => (
          <MyRound key={r.id} r={r} creditsPerNear={creditsPerNear} />
        ))}
      </ul>
    </section>
  );
}

function MyRound({ r, creditsPerNear }: { r: BackingRound & { owedYocto: string }; creditsPerNear: number | undefined }) {
  const api = useApi();
  const toast = useToast();
  const run = useBackingWrite();
  const act = useMutation({
    mutationFn: (what: 'close' | 'cancel' | 'distribute') =>
      run(() => (what === 'distribute' ? api.distributeBacking(r.id) : api.endBackingRound(r.id, what))),
    onSuccess: (_d, what) =>
      toast.show({ tone: 'good', title: what === 'close' ? 'Round closed: the raise is yours' : what === 'cancel' ? 'Round cancelled' : 'Royalties routed' }),
    onError: (e) => toast.error(e),
  });
  const owed = BigInt(r.owedYocto);
  return (
    <li className={b.item}>
      <RoundSummary r={r} {...(creditsPerNear ? { creditsPerNear } : {})} />
      {r.status === 'open' ? (
        <div className={b.row}>
          <Button variant="primary" disabled={act.isPending} onClick={() => act.mutate('close')} data-testid="backing-close">
            Close and take the raise
          </Button>
          <Button disabled={act.isPending} onClick={() => act.mutate('cancel')} data-testid="backing-cancel">
            Cancel
          </Button>
        </div>
      ) : null}
      {r.status === 'closed' && owed > 0n ? (
        <div className={b.row}>
          <Button variant="primary" disabled={act.isPending} onClick={() => act.mutate('distribute')} data-testid="backing-distribute">
            Route {money(owed, 'near')} of royalties
          </Button>
        </div>
      ) : null}
    </li>
  );
}
