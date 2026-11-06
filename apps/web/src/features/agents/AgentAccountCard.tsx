'use client';
// "Agent account" tile on the agent editor (docs/agent-accounts.md): the agent's own NEAR account,
// so it can pay for rentals by itself. CUSTODIAL, and the tile says so: skirm creates the account
// and holds its key; the agent spends only up to the per-match cap the owner sets here. The owner
// funds it with a plain transfer from their linked wallet (the wallet signs; skirm never sees that
// key) and can withdraw the rest back to the linked account at any time.
//   GET  /agents/:id/account            hidden entirely while the server has the feature off
//   POST /agents/:id/account            create
//   PUT  /agents/:id/account/cap        set the per-match cap
//   POST /agents/:id/account/withdraw   send the rest to the linked account
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type CSSProperties } from 'react';
import { useToast } from '@/components/toast/ToastProvider';
import { ApiError } from '@/lib/api/errors';
import { qk, useMe } from '@/lib/api/queries';
import type { AgentAccount } from '@/lib/api/types';
import { formatNear, parseNear } from '@/lib/constants';
import { useApi } from '@/lib/services';
import { fundAgentTx } from '@/lib/wallet/contracts';
import { useNearSigner } from '@/lib/wallet/hooks';
import e from './agentEditor.module.css';

/** A positive NEAR amount typed by the owner, in yocto; null when empty or invalid. */
function yoctoOf(text: string): string | null {
  try {
    const v = text.trim() ? parseNear(text) : null;
    return v !== null && BigInt(v) > 0n ? v : null;
  } catch {
    return null;
  }
}

const fmt = (v: string | null) => (v === null ? '—' : `${formatNear(BigInt(v))} NEAR`);

export function AgentAccountCard({ agentId, agentName }: { agentId: string; agentName: string }) {
  const api = useApi();
  const qc = useQueryClient();
  const toast = useToast();
  const signer = useNearSigner();
  const me = useMe();
  const linked = me.data?.account.nearAccountId ?? null;
  const status = useQuery({ queryKey: qk.agentAccount(agentId), queryFn: () => api.agentAccount(agentId), retry: false });
  const [cap, setCap] = useState('');
  const [fund, setFund] = useState('');

  const put = (account: AgentAccount) => qc.setQueryData(qk.agentAccount(agentId), { enabled: true, account });
  const failed = (title: string) => (err: unknown) =>
    toast.show({ tone: 'critical', title, message: err instanceof ApiError ? err.message : 'Something went wrong.' });

  const create = useMutation({
    mutationFn: () => api.createAgentAccount(agentId),
    onSuccess: (r) => {
      put(r.account);
      toast.show({ tone: 'good', title: `${agentName} has its own NEAR account.`, message: r.account.nearAccountId });
    },
    onError: failed('Account not created'),
  });
  const saveCap = useMutation({
    mutationFn: (capYocto: string) => api.setAgentAccountCap(agentId, capYocto),
    onSuccess: (r) => {
      put(r.account);
      setCap('');
      toast.show({ tone: 'good', title: `${agentName} may spend up to ${fmt(r.account.capYocto)} a match.` });
    },
    onError: failed('Cap not changed'),
  });
  const topUp = useMutation({
    mutationFn: async ({ to, amount }: { to: string; amount: string }) => {
      if (!linked) throw new ApiError(422, 'near_account_required', 'Link a NEAR account to fund the agent.');
      return signer.send(fundAgentTx(to, amount), linked);
    },
    onSuccess: () => {
      setFund('');
      void qc.invalidateQueries({ queryKey: qk.agentAccount(agentId) });
      toast.show({ tone: 'good', title: `Sent to ${agentName}'s account.` });
    },
    onError: failed('Not funded'),
  });
  const withdraw = useMutation({
    mutationFn: () => api.withdrawAgentAccount(agentId),
    onSuccess: (r) => {
      put(r.account);
      toast.show({ tone: 'good', title: `Withdrew ${fmt(r.amountYocto)} to ${r.to}.` });
    },
    onError: failed('Nothing withdrawn'),
  });

  // Off on this server (or not answering): no tile at all.
  if (!status.data?.enabled) return null;
  const account = status.data.account;
  const capYocto = yoctoOf(cap) ?? (cap.trim() === '0' ? '0' : null);
  const fundYocto = yoctoOf(fund);
  const busy = create.isPending || saveCap.isPending || topUp.isPending || withdraw.isPending;

  return (
    <section className={e.tierBox} aria-label="Agent account" data-rise style={{ '--rise-i': 5 } as CSSProperties} data-testid="agent-account">
      <div className={e.tierHead}>
        <span className={e.code}>Agent account · custodial</span>
        <b data-testid="agent-account-balance">{account ? fmt(account.balanceYocto) : 'None'}</b>
      </div>
      {!account ? (
        <>
          <div className={e.row}>
            <button
              type="button"
              className={`${e.btn} ${e.primary}`}
              disabled={!linked || busy}
              onClick={() => create.mutate()}
              data-testid="agent-account-create"
            >
              Create account
            </button>
          </div>
          <span className={e.sub} data-testid="agent-account-note">
            {linked
              ? `Give ${agentName} its own NEAR account to pay for rentals by itself. skirm holds its key and spends only up to the cap you set.`
              : 'Link a NEAR account first: you fund the agent from it and withdraw back to it.'}
          </span>
        </>
      ) : (
        <>
          <span className={e.sub} data-testid="agent-account-id">
            {account.nearAccountId}
          </span>
          <span className={e.sub} data-testid="agent-account-cap">
            Cap {fmt(account.capYocto)} a match · {fmt(account.committedYocto)} committed · {fmt(account.spendableYocto)} spendable
          </span>
          <div className={e.row}>
            <input
              className={e.rentInput}
              inputMode="decimal"
              placeholder="Cap per match in NEAR (0 stops spending)"
              value={cap}
              onChange={(ev) => setCap(ev.target.value)}
              aria-label={`Spend cap per match for ${agentName}, in NEAR`}
              data-testid="agent-account-cap-input"
            />
            <button
              type="button"
              className={e.btn}
              disabled={capYocto === null || busy}
              onClick={() => capYocto !== null && saveCap.mutate(capYocto)}
              data-testid="agent-account-cap-save"
            >
              Set cap
            </button>
          </div>
          <div className={e.row}>
            <input
              className={e.rentInput}
              inputMode="decimal"
              placeholder="Amount in NEAR"
              value={fund}
              onChange={(ev) => setFund(ev.target.value)}
              aria-label={`Amount to send to ${agentName}'s account, in NEAR`}
              data-testid="agent-account-fund-input"
            />
            <button
              type="button"
              className={`${e.btn} ${e.primary}`}
              disabled={!fundYocto || !linked || busy}
              onClick={() => fundYocto && topUp.mutate({ to: account.nearAccountId, amount: fundYocto })}
              data-testid="agent-account-fund"
            >
              Fund
            </button>
            <button
              type="button"
              className={e.btn}
              disabled={busy || account.spendableYocto === '0'}
              onClick={() => withdraw.mutate()}
              data-testid="agent-account-withdraw"
            >
              Withdraw
            </button>
          </div>
          <span className={e.sub}>
            Custodial: skirm holds this account&apos;s key and signs its payments. Withdraw sends the rest to {linked ?? 'your linked account'}.
          </span>
        </>
      )}
    </section>
  );
}
