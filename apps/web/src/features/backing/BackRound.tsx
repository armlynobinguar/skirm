'use client';
// One backing round as a row: terms, raise progress, what the backers earned towards the cap, and
// the "Back this writer" form (POST /backing/rounds/:id/back; near mode signs `backing.back`).
import { Button } from '@skirm/ui';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { useToast } from '@/components/toast/ToastProvider';
import type { BackingMode, BackingRound } from '@/lib/api/backingTypes';
import { formatNear, parseNear } from '@/lib/constants';
import { useApi } from '@/lib/services';
import { money, roundProgress, termsLine, useBackingWrite } from './lib';
import b from './backing.module.css';

export function ProgressBar({ value, label, testId }: { value: number; label: string; testId?: string }) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <div className={b.bar} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)} data-testid={testId}>
      <span className={b.barFill} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function RoundSummary({ r, creditsPerNear }: { r: BackingRound; creditsPerNear?: number }) {
  const raised = BigInt(r.raisedYocto);
  const max = BigInt(r.maxRaiseYocto);
  return (
    <>
      <div className={b.itemHead}>
        <span>
          <b>{r.writerHandle}</b>
          <span className={b.muted}>
            {' '}
            · {r.skillName ?? 'all skills'} · {r.status}
          </span>
        </span>
        <span className={b.muted} data-testid="backing-terms">
          {termsLine(r)}
        </span>
      </div>
      <span className={b.muted} data-testid="backing-raised">
        Raised {money(r.raisedYocto, r.mode, creditsPerNear)} of {money(r.maxRaiseYocto, r.mode, creditsPerNear)} from {r.backers} backer
        {r.backers === 1 ? '' : 's'}
      </span>
      {r.status === 'open' ? (
        <ProgressBar value={max > 0n ? Number((raised * 1000n) / max) / 1000 : 0} label="Raised" />
      ) : r.status === 'closed' ? (
        <>
          <span className={b.muted}>
            Backers earned {money(r.backersEarnedYocto, r.mode, creditsPerNear)} of their {money(r.capYocto, r.mode, creditsPerNear)} cap
          </span>
          <ProgressBar value={roundProgress(r)} label="Towards the cap" />
        </>
      ) : null}
    </>
  );
}

/** The back form for an open round the caller did not write. */
export function BackForm({ r, mode, creditsPerNear }: { r: BackingRound; mode: BackingMode; creditsPerNear?: number }) {
  const api = useApi();
  const toast = useToast();
  const run = useBackingWrite();
  const [amount, setAmount] = useState('');
  let yocto: string | null = null;
  try {
    yocto = amount.trim() ? parseNear(amount) : null;
  } catch {
    yocto = null;
  }
  const valid = yocto !== null && BigInt(yocto) > 0n;
  const back = useMutation({
    mutationFn: (y: string) => run(() => api.backRound(r.id, y)),
    onSuccess: () => {
      setAmount('');
      toast.show({ tone: 'good', title: `You backed ${r.writerHandle}`, message: termsLine(r) });
    },
    onError: (e) => toast.error(e),
  });
  return (
    <form
      className={b.row}
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) back.mutate(yocto!);
      }}
    >
      <input
        className={`sk-input ${b.input}`}
        inputMode="decimal"
        placeholder="NEAR, e.g. 1"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        aria-label={`Amount to back ${r.writerHandle} with, in NEAR`}
        data-testid="backing-amount"
      />
      <Button type="submit" variant="primary" disabled={!valid || back.isPending} data-testid="backing-back">
        Back this writer
      </Button>
      {valid ? (
        <span className={b.muted} data-testid="backing-cost">
          {mode === 'credits' ? `${money(yocto!, 'credits', creditsPerNear)} from your paid balance` : `${formatNear(yocto!)} NEAR from your wallet`}
        </span>
      ) : null}
    </form>
  );
}
