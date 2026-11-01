'use client';
// S15 Credits (/account/credits). Owner: account builder. Design: .design-src/screens/S15-Credits.dc.html
// Spec: .design-src/docs/uiux.md (S15 row, Account states, flow (g) top up with NEAR).
//
// Balance (paid), held by matches, free allowance left with a countdown to 00:00 UTC, top-up packs
// (amount → M01 if no wallet → M02 confirm → POST /credits/deposits), wallet state and the ledger.
// Credits are integers; NEAR comes from yocto strings through bigint (./format.ts).
// Dev mode (AUTH_MODE=dev): the deposit is simulated with a `dev:<yocto>:<nonce>` hash and needs no
// wallet, so a judge can top up without NEAR. Otherwise the linked wallet signs
// `deposits.deposit()` with the amount attached (src/lib/wallet) and the tx hash is sent to
// POST /credits/deposits; "Try again" after a failed POST re-sends that hash, never signs twice.
import { DEFAULTS } from '@skirm/shared';
import { Button, Icon, Meter, TextField, TopUpPanel, fmt, type TopUpPack } from '@skirm/ui';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { RequireSession } from '@/components/shell/RequireSession';
import { ErrorCard } from '@/components/states/ErrorCard';
import { Skeleton } from '@/components/states/Skeleton';
import { useToast } from '@/components/toast/ToastProvider';
import { qk, useMe, useMyMatches } from '@/lib/api/queries';
import type { CreditsWithRows, LedgerRow } from '@/lib/api/types';
import { useSession } from '@/lib/auth/session';
import { DAILY_FREE_ALLOWANCE, formatNear, parseNear } from '@/lib/constants';
import { TIER_INFO, TIER_ORDER, fmtRate } from '@/features/agents/agentView';
import { mapById } from '@/features/arena/world';
import { routes } from '@/lib/routes';
import { useApi } from '@/lib/services';
import { depositTx } from '@/lib/wallet/contracts';
import { useNearSigner } from '@/lib/wallet/hooks';
import { WalletError } from '@/lib/wallet/types';
import { ConfirmTransactionModal } from '@/features/skills/ConfirmTransactionModal';
import { ConnectWalletModal } from '@/features/skills/ConnectWalletModal';
import s from './account.module.css';
import {
  checkNearAmount,
  creditsPerNearOf,
  creditsForYocto,
  devDepositHash,
  explorerTxUrl,
  formatCountdown,
  formatUtc,
  formatUtcTime,
  ledgerDisplay,
  shortHash,
} from './format';
import { depositErrorCopy, useCredits, useNow, type Copy } from './hooks';

const PACKS: TopUpPack[] = [{ near: 0.5 }, { near: 1 }, { near: 5 }];
const PAGE = 20;

export function CreditsScreen() {
  return (
    <RequireSession>
      <CreditsBody />
    </RequireSession>
  );
}

interface Pending {
  yocto: string;
  credits: number;
  /**
   * The receipt sent to POST /credits/deposits, fixed when the amount is chosen (dev) or once the
   * wallet has signed (null until then): "Try again" after a lost response re-sends the same receipt
   * (409 duplicate_receipt) instead of crediting, or paying, twice.
   */
  txHash: string | null;
}

function CreditsBody() {
  const api = useApi();
  const qc = useQueryClient();
  const toast = useToast();
  const { mode } = useSession();
  const dev = mode === 'dev';
  const signer = useNearSigner();
  const credits = useCredits();
  const me = useMe();
  const nearAccountId = me.data?.account.nearAccountId ?? null;
  const rate = creditsPerNearOf(credits.data, me.data);

  const [amount, setAmount] = useState<Pending | null>(null);
  const [walletOpen, setWalletOpen] = useState<null | 'top_up' | 'connect'>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [depositing, setDepositing] = useState<Pending | null>(null);
  const [depositError, setDepositError] = useState<Copy | null>(null);
  const [paused, setPaused] = useState(false);

  const [credited, setCredited] = useState<number | null>(null);

  const begin = (choice: Omit<Pending, 'txHash'>) => {
    const p: Pending = { ...choice, txHash: dev ? devDepositHash(choice.yocto) : null };
    setAmount(p);
    setCredited(null);
    setDepositError(null);
    // Outside dev mode a deposit must come from a linked NEAR account (M01 first).
    if (!dev && !nearAccountId) setWalletOpen('top_up');
    else setConfirmOpen(true);
  };

  const confirm = async () => {
    let p = amount;
    if (!p) return;
    setDepositError(null);
    if (!p.txHash) {
      // The wallet signs deposits.deposit() with the amount attached, as the linked account.
      try {
        if (!nearAccountId) throw new WalletError('wallet_no_account', 'Connect a NEAR wallet first.');
        const txHash = await signer.send(depositTx(signer.contracts, p.yocto), nearAccountId);
        p = { ...p, txHash };
        setAmount(p);
      } catch (err) {
        setDepositError(depositErrorCopy(err));
        throw err;
      }
    }
    const txHash = p.txHash!;
    setDepositing(p);
    try {
      const res = await api.deposit(txHash);
      setPaused(false);
      setCredited(res.credited);
      toast.show({
        tone: 'good',
        title: 'Credits added',
        message: `+${fmt(res.credited)} credits for ${formatNear(res.amountYocto, 24)} NEAR. Balance ${fmt(res.balance)}.`,
      });
      qc.setQueryData<CreditsWithRows>(qk.credits, (old) => (old ? { ...old, balance: res.balance } : old));
      void qc.invalidateQueries({ queryKey: qk.credits });
      void qc.invalidateQueries({ queryKey: qk.me });
    } catch (err) {
      const copy = depositErrorCopy(err);
      setDepositError(copy);
      if (copy.code === 'rpc_unavailable') setPaused(true);
      // Already credited (e.g. a retry after a lost response): show the balance that includes it.
      if (copy.code === 'duplicate_receipt') {
        void qc.invalidateQueries({ queryKey: qk.credits });
        void qc.invalidateQueries({ queryKey: qk.me });
      }
      throw err;
    } finally {
      setDepositing(null);
    }
  };

  return (
    <div className={s.page} data-testid="screen-s15">
      <nav aria-label="Breadcrumb" className={s.crumbs}>
        <Link href={routes.account()}>Account</Link> / Credits
      </nav>
      <h1 className="app-h1">Credits</h1>

      {paused ? (
        <div className="app-banner is-warning" role="status" data-testid="s15-topups-paused">
          <Icon name="warning" size={16} />
          <span>
            Top-ups paused. Your balance is safe.
            {credits.dataUpdatedAt ? ` Balance as of ${formatUtcTime(credits.dataUpdatedAt)}.` : ''}
          </span>
        </div>
      ) : null}

      {depositError ? (
        <section className="app-card app-error" role="alert" data-testid="s15-topup-error">
          <h2 className="app-h3">{depositError.title}</h2>
          <p style={{ margin: 0 }}>{depositError.message}</p>
          <div className="app-row">
            <Button size="sm" variant="ghost" onClick={() => setDepositError(null)}>
              Dismiss
            </Button>
            {depositError.code ? (
              <details>
                <summary>Details</summary>
                <code>{depositError.code}</code>
              </details>
            ) : null}
          </div>
        </section>
      ) : null}

      <div className={s.grid3}>
        <BalanceCard query={credits} />

        <section className={s.topup} aria-label="Top up credits" data-testid="s15-topup">
          <TopUpPanel
            packs={PACKS}
            creditsPerNear={rate}
            defaultIndex={1}
            network="Testnet"
            pending={depositing !== null}
            onConfirm={(pk) => {
              const yocto = parseNear(String(pk.near));
              begin({ yocto, credits: creditsForYocto(yocto, rate) });
            }}
          />
          <CustomAmount disabled={depositing !== null} rate={rate} onSubmit={begin} />
          {dev ? (
            <p className={s.note} data-testid="s15-dev-note">
              Dev mode: deposits are simulated with a test receipt, so no wallet or NEAR is needed.
            </p>
          ) : null}
        </section>

        <WalletCard
          nearAccountId={nearAccountId}
          loading={me.isPending}
          onConnect={() => setWalletOpen('connect')}
        />
      </div>

      <Ledger query={credits} pending={depositing} rate={rate} />

      <ConnectWalletModal
        open={walletOpen !== null}
        reason={walletOpen === 'top_up' ? 'top_up' : 'connect'}
        {...(walletOpen === 'top_up' && amount
          ? { summary: `Top up ${formatNear(amount.yocto, 24)} NEAR for ${fmt(amount.credits)} credits` }
          : {})}
        onClose={() => setWalletOpen(null)}
        onConnected={() => {
          const next = walletOpen;
          setWalletOpen(null);
          void qc.invalidateQueries({ queryKey: qk.me });
          if (next === 'top_up' && amount) setConfirmOpen(true);
        }}
      />
      <ConfirmTransactionModal
        open={confirmOpen && amount !== null}
        item={amount ? `Top up ${fmt(amount.credits)} credits` : 'Top up credits'}
        priceYocto={amount?.yocto ?? '0'}
        title="Top up credits"
        itemDetail={`${formatNear(amount?.yocto ?? '0', 24)} NEAR at ${fmt(rate)} credits per NEAR`}
        account={nearAccountId ?? (dev ? 'dev deposit (no wallet)' : null)}
        note="The NEAR goes to the game's deposit contract. Credits are added once NEAR confirms it; they cannot be withdrawn."
        doneTitle="Credits added"
        doneMessage={
          credited !== null || amount
            ? `${fmt(credited ?? amount!.credits)} credits are in your balance.`
            : 'Credits are in your balance.'
        }
        onConfirm={confirm}
        onClose={() => setConfirmOpen(false)}
      />
    </div>
  );
}

function BalanceCard({ query }: { query: ReturnType<typeof useCredits> }) {
  const now = useNow(30_000);
  const qc = useQueryClient();
  const c = query.data;
  const resetAt = c?.allowanceResetAt;
  // At 00:00 UTC the allowance refills: refetch once the countdown passes, and again every minute
  // while the server still reports the old reset (a device clock running ahead of the server's).
  const refetchedAt = useRef(0);
  useEffect(() => {
    if (resetAt && Date.parse(resetAt) <= now && now - refetchedAt.current >= 60_000) {
      refetchedAt.current = now;
      void qc.invalidateQueries({ queryKey: qk.credits });
      void qc.invalidateQueries({ queryKey: qk.me });
    }
  }, [resetAt, now, qc]);

  return (
    <section aria-labelledby="s15-bal" className={`${s.card} ${s.cardLoose}`} data-testid="s15-balance">
      <h2 id="s15-bal" className={s.h2}>
        Balance
      </h2>
      {c === undefined ? (
        query.isError ? (
          <ErrorCard error={query.error} onRetry={() => void query.refetch()} title="Balance did not load" />
        ) : (
          <Skeleton rows={3} label="Loading balance" />
        )
      ) : (
        <>
          <dl className={s.balance}>
            <div>
              <dt>Available</dt>
              <dd data-testid="s15-balance-available">{fmt(c.balance)}</dd>
            </div>
            <div>
              <dt>Held by matches</dt>
              <dd className={s.muted} data-testid="s15-balance-held">
                {fmt(c.held)}
              </dd>
            </div>
          </dl>
          <div className={s.allowance}>
            <div className={s.allowanceHead}>
              <span>Free allowance today</span>
              <span className={s.mono} data-testid="s15-allowance">
                {fmt(c.allowanceLeft)} / {fmt(DAILY_FREE_ALLOWANCE)}
              </span>
            </div>
            <Meter
              value={c.allowanceLeft}
              max={DAILY_FREE_ALLOWANCE}
              tone={c.allowanceLeft === 0 ? 'warning' : null}
              label="Free allowance left"
            />
            <span className={s.note} data-testid="s15-allowance-reset">
              {c.allowanceLeft === 0
                ? `0 of ${DAILY_FREE_ALLOWANCE} free credits left. Resets in ${formatCountdown(c.allowanceResetAt, now)}.`
                : `Resets in ${formatCountdown(c.allowanceResetAt, now)} (00:00 UTC). Used before your balance; unused allowance does not carry over.`}
            </span>
          </div>
          {c.balance === 0 ? (
            <p className={s.note} data-testid="s15-balance-empty">
              No paid credits yet. Top up to keep playing after the free allowance.
            </p>
          ) : null}
          {query.isError ? (
            <p className={s.note} role="status">
              Could not refresh. Balance as of {formatUtcTime(query.dataUpdatedAt)}.
            </p>
          ) : null}
          <p className={s.note} data-testid="s15-rates">
            1 credit costs US${DEFAULTS.credits.priceUsd}. A match holds credits for every tick at your crew&apos;s talk rates (
            {TIER_ORDER.map((t) => `${TIER_INFO[t].label} ${fmtRate(TIER_INFO[t].rate)}`).join(', ')} credits per agent per tick); what is
            not used comes back.
          </p>
        </>
      )}
    </section>
  );
}

function CustomAmount({
  disabled,
  rate,
  onSubmit,
}: {
  disabled: boolean;
  rate: number;
  onSubmit: (p: Omit<Pending, 'txHash'>) => void;
}) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | undefined>();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const r = checkNearAmount(value, rate);
    if (!r.ok) {
      setError(r.message);
      return;
    }
    setError(undefined);
    onSubmit({ yocto: r.yocto, credits: r.credits });
  };
  const preview = value.trim() ? checkNearAmount(value, rate) : null;
  return (
    <form className={s.custom} onSubmit={submit} noValidate data-testid="s15-custom-amount">
      <TextField
        label="Other amount"
        inputMode="decimal"
        mono
        suffix="NEAR"
        placeholder="0.25"
        value={value}
        onChange={(e) => {
          setValue(e.currentTarget.value);
          setError(undefined);
        }}
        {...(error
          ? { error }
          : preview?.ok
            ? { hint: `${fmt(preview.credits)} credits` }
            : { hint: `${fmt(rate)} credits per NEAR on testnet` })}
      />
      <Button type="submit" disabled={disabled} data-testid="s15-custom-submit">
        Review top-up
      </Button>
    </form>
  );
}

function WalletCard({
  nearAccountId,
  loading,
  onConnect,
}: {
  nearAccountId: string | null;
  loading: boolean;
  onConnect: () => void;
}) {
  return (
    <section aria-labelledby="s15-wallet" className={s.card} data-testid="s15-wallet">
      <h2 id="s15-wallet" className={s.h2}>
        NEAR wallet
      </h2>
      {loading ? (
        <Skeleton rows={1} label="Loading wallet" />
      ) : (
        <div className={s.wallet}>
          <span className={s.walletIcon}>
            <Icon name="wallet" size={20} />
          </span>
          <span className={s.walletText}>
            {nearAccountId ? (
              <>
                <span className={s.walletId} data-testid="s15-wallet-account">
                  {nearAccountId}
                </span>
                <span className={s.note}>Connected · testnet</span>
              </>
            ) : (
              <>
                <span className={s.walletId}>Not connected</span>
                <span className={s.note} data-testid="s15-wallet-none">
                  Connect a wallet to top up.
                </span>
              </>
            )}
          </span>
        </div>
      )}
      <p className={s.note}>Used for top-ups and trading skills. Play never needs it.</p>
      <div className={s.actions}>
        <Button size="sm" icon="wallet" onClick={onConnect} data-testid="s15-connect-wallet">
          {nearAccountId ? 'Change wallet' : 'Connect wallet'}
        </Button>
      </div>
    </section>
  );
}

function Ledger({
  query,
  pending,
  rate,
}: {
  query: ReturnType<typeof useCredits>;
  pending: Pending | null;
  rate: number;
}) {
  const [shown, setShown] = useState(PAGE);
  const matches = useMyMatches();
  const matchLabel = useMemo(() => {
    const byMatch = new Map((matches.data ?? []).map((m) => [m.id, mapById(m.mapId)?.name ?? m.mapId]));
    return (row: LedgerRow) => {
      if (!row.matchId) return null;
      const name = byMatch.get(row.matchId);
      return name ? `${name} match` : 'Match';
    };
  }, [matches.data]);

  const rows = query.data?.rows;
  return (
    <section aria-labelledby="s15-ledger" className="app-stack" data-testid="s15-ledger">
      <h2 id="s15-ledger" className={s.h2Display}>
        Ledger
      </h2>
      {rows === undefined ? (
        query.isError ? (
          <ErrorCard error={query.error} onRetry={() => void query.refetch()} title="Ledger did not load" />
        ) : (
          <Skeleton rows={6} label="Loading ledger" />
        )
      ) : rows.length === 0 && !pending ? (
        <section className="app-card app-empty" data-testid="empty-state">
          <p>No transactions yet.</p>
        </section>
      ) : (
        <>
          <div className={s.tableWrap}>
            <table className={`${s.table} ${s.ledgerTable}`}>
              <thead>
                <tr>
                  <th scope="col">Date (UTC)</th>
                  <th scope="col">Type</th>
                  <th scope="col">Detail</th>
                  <th scope="col">From</th>
                  <th scope="col" style={{ textAlign: 'right' }}>
                    Credits
                  </th>
                  <th scope="col">Link</th>
                </tr>
              </thead>
              <tbody>
                {pending ? (
                  <tr className={s.pendingRow} data-testid="s15-ledger-pending">
                    <td className={s.dateCell}>now</td>
                    <td className={s.typeCell}>Top-up</td>
                    <td>
                      <span className={s.spinner} aria-hidden="true" />
                      Waiting for NEAR to confirm {formatNear(pending.yocto, 24)} NEAR
                    </td>
                    <td className={s.fromCell}>Balance</td>
                    <td className={`${s.amount} ${s.amountNeutral}`}>+{fmt(pending.credits)}</td>
                    <td />
                  </tr>
                ) : null}
                {rows.slice(0, shown).map((row) => {
                  const d = ledgerDisplay(row, matchLabel(row), rate);
                  const tx = row.txHash ? explorerTxUrl(row.txHash) : null;
                  return (
                    <tr key={row.id} data-testid={`s15-ledger-row-${row.id}`} data-type={row.type}>
                      <td className={s.dateCell}>{formatUtc(row.createdAt)}</td>
                      <td className={s.typeCell}>{d.type}</td>
                      <td>{d.detail}</td>
                      <td className={s.fromCell}>{d.from}</td>
                      <td
                        className={`${s.amount} ${d.tone === 'in' ? s.amountIn : d.tone === 'neutral' ? s.amountNeutral : ''}`}
                      >
                        {d.amount}
                      </td>
                      <td className={s.linkCell}>
                        {row.matchId ? <Link href={routes.matchResult(row.matchId)}>Match</Link> : null}
                        {row.txHash ? (
                          tx ? (
                            <a className={s.txLink} href={tx} target="_blank" rel="noreferrer">
                              {shortHash(row.txHash)}
                            </a>
                          ) : (
                            <span className={`${s.txLink} sk-muted`}>{shortHash(row.txHash)}</span>
                          )
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className={s.more}>
            {rows.length > shown ? (
              <Button size="sm" onClick={() => setShown((n) => n + PAGE)} data-testid="s15-ledger-more">
                Show {Math.min(PAGE, rows.length - shown)} more
              </Button>
            ) : null}
            <span className={s.note}>
              Showing {fmt(Math.min(shown, rows.length))} of {fmt(rows.length)}
              {rows.length >= 100 ? ' (the latest 100 entries)' : ''}.
            </span>
          </div>
        </>
      )}
    </section>
  );
}

