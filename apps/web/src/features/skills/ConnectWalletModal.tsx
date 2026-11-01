'use client';
// M01 Connect NEAR wallet. Owner: skills+market builder. Design: .design-src/screens/M01-Connect-wallet.dc.html
// Opened from Top up (S15), Mint (S08), Buy and List for resale (S10), Connect (S16). The Account
// builder uses it too, so keep these props stable; add optional props only.
// Linking: POST /auth/session { nearAccountId, nearProof? } (apps/api/src/controllers/core.controller.ts).
// Esc / Cancel returns focus to the trigger (Modal does it).
//
// dev auth mode: picking a wallet asks for the testnet account id and links it directly (the api
// trusts it). Otherwise "Choose a wallet" opens NEAR Connect (src/lib/wallet), the wallet signs the
// NEP-413 link message `skirm:link-near:<skirm account id>:<near account id>`, and the proof goes
// with the link request.
import { Badge, Button, Icon, Modal, TextField } from '@skirm/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { errorCopy, isApiError } from '@/lib/api/errors';
import { qk, useMe } from '@/lib/api/queries';
import { useSession } from '@/lib/auth/session';
import { useApi } from '@/lib/services';
import { useNearSigner } from '@/lib/wallet/hooks';
import s from './skills.module.css';

export interface ConnectWalletModalProps {
  open: boolean;
  /** What the wallet is needed for; drives the one-line explanation. */
  reason?: 'top_up' | 'mint' | 'buy' | 'list' | 'connect';
  onClose: () => void;
  /** Called with the linked NEAR account id once the account is linked. */
  onConnected: (nearAccountId: string) => void;

  // ----- Optional, added by the Skills + Market builder (additive) -----
  /** A context line in the grey box, e.g. "Top up 1 NEAR for 1,000 credits". */
  summary?: ReactNode;
}

const WALLETS = [
  { id: 'mynearwallet', name: 'MyNearWallet', kind: 'Web wallet' },
  { id: 'meteor', name: 'Meteor Wallet', kind: 'Browser extension or web' },
  { id: 'here', name: 'HERE Wallet', kind: 'Phone app' },
] as const;

const NEED: Record<NonNullable<ConnectWalletModalProps['reason']>, string> = {
  top_up: 'To top up credits you need a NEAR wallet.',
  mint: 'To mint your skill as an NFT you need a NEAR wallet.',
  buy: 'To buy a skill you need a NEAR wallet. It holds the skills you own.',
  list: 'To list a skill for resale you need a NEAR wallet. Sales are paid into it.',
  connect: 'A NEAR wallet holds your skills and pays for top-ups.',
};

/** Same pattern as the api's sessionBody.nearAccountId. */
const NEAR_ID_RE = /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;

function linkError(err: unknown): string {
  if (isApiError(err)) {
    if (err.code === 'wallet_rejected') return 'Cancelled in the wallet. Nothing was linked.';
    if (err.code === 'wallet_no_account') return 'The wallet has no account on testnet. Create one in the wallet, then try again.';
    if (err.code === 'wallet_failed' || err.code === 'wallet_unsupported')
      return `The wallet did not finish: ${err.message} Try again or pick another wallet.`;
    if (err.code === 'rpc_unavailable' || err.code === 'near_unavailable')
      return 'NEAR is not reachable right now, so the link cannot be checked. Try again in a few minutes.';
    if (err.code === 'near_account_taken') return 'That NEAR account is linked to another player. Use another account.';
    if (err.code === 'near_proof_required' || err.code === 'near_proof_invalid')
      return 'The wallet has to sign to prove the account is yours. Try again from the wallet.';
    if (err.code === 'invalid_request') return 'That is not a NEAR account id. Example: ada.testnet';
  }
  return errorCopy(err).message;
}

export function ConnectWalletModal({ open, reason = 'connect', onClose, onConnected, summary }: ConnectWalletModalProps) {
  const api = useApi();
  const qc = useQueryClient();
  const me = useMe();
  const signer = useNearSigner();
  const { mode, handle } = useSession();
  const [wallet, setWallet] = useState<string | null>(null);
  const [accountId, setAccountId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** Wallet path: what the player is waiting for. */
  const [step, setStep] = useState<null | 'wallet' | 'linking'>(null);

  useEffect(() => {
    if (!open) return;
    setWallet(null);
    setError(null);
    setBusy(false);
    setStep(null);
    setAccountId(handle ? `${handle.replace(/[^a-z\d_-]/g, '')}.testnet` : '');
  }, [open, handle]);

  /** Non-dev: connect through NEAR Connect, sign the link message, link with the proof. */
  const connectWallet = async () => {
    setBusy(true);
    setError(null);
    setStep('wallet');
    try {
      const skirmId = me.data?.account.id ?? (await api.me()).account.id;
      const { nearAccountId, nearProof } = await signer.connectAndProve(skirmId);
      setStep('linking');
      const res = await api.createSession({ nearAccountId, nearProof });
      await qc.invalidateQueries({ queryKey: qk.me });
      onConnected(res.account.nearAccountId ?? nearAccountId);
    } catch (err) {
      setError(linkError(err));
    } finally {
      setBusy(false);
      setStep(null);
    }
  };

  const connect = async () => {
    const id = accountId.trim().toLowerCase();
    if (id.length < 2 || id.length > 64 || !NEAR_ID_RE.test(id)) {
      setError('That is not a NEAR account id. Example: ada.testnet');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await api.createSession({ nearAccountId: id });
      await qc.invalidateQueries({ queryKey: qk.me });
      onConnected(res.account.nearAccountId ?? id);
    } catch (err) {
      setError(linkError(err));
    } finally {
      setBusy(false);
    }
  };

  const dev = mode === 'dev';
  const footer = (
    <>
      <Button onClick={onClose} data-testid="m01-cancel">
        Not now
      </Button>
      {wallet && dev ? (
        <Button variant="primary" icon="wallet" loading={busy} onClick={() => void connect()} data-testid="m01-connect">
          Connect wallet
        </Button>
      ) : null}
      {!dev ? (
        <Button variant="primary" icon="wallet" loading={busy} onClick={() => void connectWallet()} data-testid="m01-connect">
          {error ? 'Try again' : 'Choose a wallet'}
        </Button>
      ) : null}
    </>
  );

  return (
    <Modal open={open} title="Connect a NEAR wallet" onClose={onClose} footer={footer}>
      <div className={s.modalBody} data-testid="m01-connect-wallet">
        <p className="sk-muted" style={{ margin: 0 }}>
          {NEED[reason]} It is your account on NEAR; skirm never sees its keys. Playing never needs one.
        </p>
        <div className={s.sunken}>
          <span>{summary ?? 'Your NEAR account id is linked to this skirm account.'}</span>
          <Badge>Testnet</Badge>
        </div>
        {dev ? (
          <ul className={s.walletList} aria-label="Wallets">
            {WALLETS.map((w) => (
              <li key={w.id}>
                <button
                  type="button"
                  className={s.walletBtn}
                  aria-pressed={wallet === w.id}
                  onClick={() => {
                    setWallet(w.id);
                    setError(null);
                  }}
                  data-testid={`m01-wallet-${w.id}`}
                >
                  <span className={s.walletLeft}>
                    <span className={s.walletIcon}>
                      <Icon name="wallet" />
                    </span>
                    <span className={s.walletText}>
                      <span className={s.walletName}>{w.name}</span>
                      <span className={s.walletKind}>{w.kind}</span>
                    </span>
                  </span>
                  <Icon name="step_fwd" />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="sk-muted app-small" style={{ margin: 0 }} data-testid="m01-wallets-note">
            HOT, Meteor, MyNearWallet, Intear and other NEAR wallets. The wallet then asks you to sign a short
            message; it proves the account is yours and moves no NEAR.
          </p>
        )}
        {wallet && dev ? (
          <TextField
            label="Testnet account id"
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return;
              e.preventDefault(); // M01 renders inside S08's <form>: Enter must not submit it too
              void connect();
            }}
            hint="Dev mode: the account is linked without a wallet signature."
            mono
            autoFocus
            data-testid="m01-account-input"
          />
        ) : null}
        {step ? (
          <p className={s.note} role="status" data-testid="m01-pending">
            {step === 'wallet'
              ? 'Pick a wallet, then sign the link message in it. Keep this tab open.'
              : 'Checking the signature with NEAR...'}
          </p>
        ) : null}
        {error ? (
          <p className="app-banner is-critical" role="alert" data-testid="m01-error" style={{ margin: 0 }}>
            {error}
          </p>
        ) : null}
        <p className={s.note}>No wallet yet? Create a free testnet account in any of these; testnet NEAR has no real value.</p>
      </div>
    </Modal>
  );
}
