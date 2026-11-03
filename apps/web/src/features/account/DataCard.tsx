'use client';
// S16 "Your data" card (the privacy policy's choices): download everything skirm holds about the
// player (GET /me/export, saved as JSON), or delete the account (DELETE /me, confirmed by typing the
// handle). Deleting signs out; the sign-in, NEAR link, system prompts and rental offers go, credits
// are forfeited, and match history and sales stay for other players' records.
import { Button, TextField } from '@skirm/ui';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useToast } from '@/components/toast/ToastProvider';
import { errorCopy } from '@/lib/api/errors';
import { useSession } from '@/lib/auth/session';
import { routes } from '@/lib/routes';
import { useApi } from '@/lib/services';
import s from './account.module.css';

/** Hands a JSON value to the browser as a file download. */
function download(name: string, value: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function DataCard({ handle }: { handle: string }) {
  const api = useApi();
  const toast = useToast();
  const router = useRouter();
  const { signOut } = useSession();
  const [busy, setBusy] = useState<'export' | 'delete' | null>(null);
  const [confirm, setConfirm] = useState('');
  const [open, setOpen] = useState(false);

  const exportData = async () => {
    setBusy('export');
    try {
      download(`skirm-${handle}-${new Date().toISOString().slice(0, 10)}.json`, await api.exportMe());
      toast.show({ tone: 'good', title: 'Your data is downloading' });
    } catch (err) {
      toast.show({ tone: 'critical', ...errorCopy(err) });
    } finally {
      setBusy(null);
    }
  };

  const deleteAccount = async () => {
    setBusy('delete');
    try {
      await api.deleteMe(confirm);
      await signOut();
      router.push(routes.signIn());
    } catch (err) {
      toast.show({ tone: 'critical', ...errorCopy(err) });
      setBusy(null);
    }
  };

  return (
    <section aria-labelledby="s16-data" className={s.card} data-testid="s16-data">
      <h2 id="s16-data" className={s.h2Display}>
        Your data
      </h2>
      <p className="sk-muted">
        What skirm keeps and who sees it is in the <Link href={routes.privacy()}>privacy policy</Link>; the rules are in the{' '}
        <Link href={routes.terms()}>terms</Link>.
      </p>
      <div className={s.actions}>
        <Button variant="secondary" onClick={exportData} disabled={busy !== null} loading={busy === 'export'} data-testid="s16-export">
          Download my data
        </Button>
        {!open ? (
          <Button variant="ghost" onClick={() => setOpen(true)} disabled={busy !== null} data-testid="s16-delete-open">
            Delete account
          </Button>
        ) : null}
      </div>
      {open ? (
        <div className={s.cardLoose} data-testid="s16-delete">
          <p>
            This cannot be undone. Your sign-in, NEAR link, system prompts and rental offers are removed and your credits
            are forfeited. Match history and sales stay, and records on the NEAR blockchain cannot be removed. Type{' '}
            <b>{handle}</b> to confirm.
          </p>
          <TextField label="Your handle" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" data-testid="s16-delete-confirm" />
          <div className={s.actions}>
            <Button variant="danger" onClick={deleteAccount} disabled={confirm !== handle || busy !== null} loading={busy === 'delete'} data-testid="s16-delete-go">
              Delete my account
            </Button>
            <Button variant="ghost" onClick={() => (setOpen(false), setConfirm(''))} disabled={busy !== null}>
              Keep my account
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
