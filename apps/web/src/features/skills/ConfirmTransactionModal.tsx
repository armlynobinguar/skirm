'use client';
// M02 Confirm transaction. Owner: skills+market builder. Design: .design-src/screens/M02-Confirm-transaction.dc.html
// Shows the full sum before any signature: item, price, creator royalty, platform fee, network fee,
// total in NEAR (never converted to credits); then pending, done or failed. Used by S10 (buy, list)
// and S15 (top-up), so keep these props stable; add optional props only.
// All amounts are yoctoNEAR strings and are summed as bigint.
import { Badge, Button, Icon, Modal } from '@skirm/ui';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { errorCopy, isApiError } from '@/lib/api/errors';
import { NETWORK_FEE_ESTIMATE_YOCTO, near } from './lib';
import s from './skills.module.css';

export interface ConfirmTransactionModalProps {
  open: boolean;
  /** e.g. "Buy Dam First v2" or "Top up 1,000 credits". */
  item: string;
  /** yoctoNEAR strings. Royalty and fee are shown only when given (a top-up has neither). */
  priceYocto: string;
  royaltyYocto?: string;
  feeYocto?: string;
  networkFeeYocto?: string;
  /** Signs in the wallet and records the result (e.g. api.purchaseSkill / api.deposit). */
  onConfirm: () => Promise<void>;
  onClose: () => void;

  // ----- Optional, added by the Skills + Market builder (all additive) -----
  /** Modal title (default "Confirm transaction"). */
  title?: string;
  /** Line under the item, e.g. "by tidecaller · sold by reefwalker". */
  itemDetail?: ReactNode;
  /** What the seller receives (shown under the fee lines). */
  sellerYocto?: string;
  /** Label of the royalty line (default "Creator royalty"). */
  royaltyLabel?: string;
  /** Label of the fee line (default "Platform fee"). */
  feeLabel?: string;
  /**
   * `pay` (default): the signer pays price + network fee (buy, top-up).
   * `receive`: the signer is the seller; the bottom line is what they receive (list for resale).
   */
  kind?: 'pay' | 'receive';
  /** The signing NEAR account, shown with a Testnet badge. */
  account?: string | null;
  /** One explanatory paragraph under the sum. */
  note?: ReactNode;
  /** Confirm button label (default "Confirm in wallet · <total>"). */
  confirmLabel?: string;
  /** Done state copy (defaults "Done" / "The transaction went through."). */
  doneTitle?: string;
  doneMessage?: ReactNode;
}

type Phase = { kind: 'idle' } | { kind: 'pending' } | { kind: 'done' } | { kind: 'failed'; error: unknown };

const big = (v: string | undefined) => (v ? BigInt(v) : 0n);

/** "Cancelled. Nothing was sent." when the wallet refused; spec copy for other failures. */
function failure(err: unknown): { title: string; message: string; code?: string } {
  if (isApiError(err) && (err.code === 'wallet_rejected' || err.code === 'user_rejected'))
    return { title: 'Cancelled', message: 'Cancelled. Nothing was sent.', code: err.code };
  if (err instanceof Error && /reject|cancel/i.test(err.message) && !isApiError(err))
    return { title: 'Cancelled', message: 'Cancelled. Nothing was sent.' };
  const c = errorCopy(err);
  return { title: 'The transaction did not go through', message: c.message, ...(c.code ? { code: c.code } : {}) };
}

export function ConfirmTransactionModal({
  open,
  item,
  priceYocto,
  royaltyYocto,
  feeYocto,
  networkFeeYocto,
  onConfirm,
  onClose,
  title = 'Confirm transaction',
  itemDetail,
  sellerYocto,
  royaltyLabel = 'Creator royalty',
  feeLabel = 'Platform fee',
  kind = 'pay',
  account,
  note,
  confirmLabel,
  doneTitle = 'Done',
  doneMessage = 'The transaction went through.',
}: ConfirmTransactionModalProps) {
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    if (open) setPhase({ kind: 'idle' });
  }, [open]);

  const net = networkFeeYocto ?? NETWORK_FEE_ESTIMATE_YOCTO;
  const price = big(priceYocto);
  const seller =
    sellerYocto !== undefined ? big(sellerYocto) : price - big(feeYocto) - big(royaltyYocto);
  const total = kind === 'pay' ? price + big(net) : seller;
  const totalText = near(total);

  const confirm = async () => {
    setPhase({ kind: 'pending' });
    try {
      await onConfirm();
      if (alive.current) setPhase({ kind: 'done' });
    } catch (err) {
      if (alive.current) setPhase({ kind: 'failed', error: err });
    }
  };

  const pending = phase.kind === 'pending';
  const footer =
    phase.kind === 'done' ? (
      <Button variant="primary" onClick={onClose} data-testid="m02-done-close">
        Done
      </Button>
    ) : (
      <>
        <Button onClick={onClose} data-testid="m02-cancel" disabled={pending}>
          Cancel
        </Button>
        <Button variant="primary" icon="wallet" loading={pending} onClick={() => void confirm()} data-testid="m02-confirm">
          {pending ? 'Waiting for wallet' : phase.kind === 'failed' ? 'Try again' : (confirmLabel ?? `Confirm in wallet · ${totalText}`)}
        </Button>
      </>
    );

  return (
    <Modal open={open} title={title} onClose={pending ? undefined : onClose} footer={footer}>
      <div className={s.modalBody} data-testid="m02-confirm-transaction">
        <div className={s.item}>
          <span className={s.itemIcon}>
            <Icon name={kind === 'pay' && !royaltyYocto && !feeYocto ? 'credits' : 'skill'} size={20} />
          </span>
          <span className={s.itemText}>
            <span className={s.itemName} data-testid="m02-item">
              {item}
            </span>
            {itemDetail ? <span className="app-small sk-muted">{itemDetail}</span> : null}
          </span>
        </div>

        <dl className={s.sum}>
          <dt>Price</dt>
          <dd data-testid="m02-price">{near(priceYocto)}</dd>
          {royaltyYocto !== undefined ? (
            <>
              <dt className={s.sub}>{royaltyLabel}</dt>
              <dd className="sk-muted" data-testid="m02-royalty">
                {near(royaltyYocto)}
              </dd>
            </>
          ) : null}
          {feeYocto !== undefined ? (
            <>
              <dt className={s.sub}>{feeLabel}</dt>
              <dd className="sk-muted" data-testid="m02-fee">
                {near(feeYocto)}
              </dd>
            </>
          ) : null}
          {(feeYocto !== undefined || royaltyYocto !== undefined) && kind === 'pay' ? (
            <>
              <dt className={s.sub}>Seller receives</dt>
              <dd className="sk-muted" data-testid="m02-seller">
                {near(seller)}
              </dd>
            </>
          ) : null}
          <dt>Network fee · estimate</dt>
          <dd data-testid="m02-network-fee">about {near(net)}</dd>
          <dt className={s.total}>{kind === 'pay' ? 'Total' : 'You receive'}</dt>
          <dd className={s.totalVal} data-testid="m02-total">
            {totalText}
          </dd>
        </dl>

        <div className={s.walletLine}>
          {account ? (
            <span className={s.walletId}>
              <Icon name="wallet" size={14} />
              <span data-testid="m02-account">{account}</span>
            </span>
          ) : (
            <span />
          )}
          <Badge>Testnet</Badge>
        </div>

        {note ? <p className={s.note}>{note}</p> : null}

        {phase.kind === 'pending' ? (
          <p className={s.note} role="status" data-testid="m02-pending">
            Waiting for the wallet to sign. Keep this tab open.
          </p>
        ) : null}
        {phase.kind === 'done' ? (
          <div className={`${s.status} ${s.statusGood}`} role="status" data-testid="m02-done">
            <Icon name="check" size={18} />
            <span>
              <span className={s.statusTitle}>{doneTitle}</span>
              {doneMessage}
            </span>
          </div>
        ) : null}
        {phase.kind === 'failed' ? <Failed error={phase.error} /> : null}
      </div>
    </Modal>
  );
}

function Failed({ error }: { error: unknown }) {
  const f = failure(error);
  return (
    <div className={`${s.status} ${s.statusBad}`} role="alert" data-testid="m02-failed">
      <Icon name="critical" size={18} />
      <span>
        <span className={s.statusTitle}>{f.title}</span>
        {f.message}
        {f.code ? (
          <details>
            <summary>Details</summary>
            <code>{f.code}</code>
          </details>
        ) : null}
      </span>
    </div>
  );
}
