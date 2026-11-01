'use client';
// Account-only hooks and error copy (S15, S16).
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { qk } from '@/lib/api/queries';
import { isApiError } from '@/lib/api/errors';
import { useSession } from '@/lib/auth/session';
import { useApi } from '@/lib/services';

/** Date.now(), refreshed every `everyMs` (the allowance countdown). */
export function useNow(everyMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(id);
  }, [everyMs]);
  return now;
}

/** GET /credits (balance, held, allowance, ledger rows newest first, at most 100). */
export function useCredits() {
  const api = useApi();
  const { status } = useSession();
  return useQuery({
    queryKey: qk.credits,
    queryFn: () => api.credits(),
    enabled: status === 'signedIn',
    staleTime: 10_000,
  });
}

export interface Copy {
  title: string;
  message: string;
  code?: string;
}

/** POST /credits/deposits failures (UI/UX Spec Account states). */
export function depositErrorCopy(err: unknown): Copy {
  if (!isApiError(err)) return { title: 'Top-up did not finish', message: 'Nothing was sent. Try again in a moment.' };
  const code = err.code;
  switch (code) {
    case 'wallet_rejected':
      return { title: 'Cancelled', message: 'Cancelled in the wallet. Nothing was sent.', code };
    case 'wallet_wrong_account':
      return { title: 'Wrong wallet account', message: err.message, code };
    case 'wallet_no_account':
      return { title: 'Connect your NEAR wallet first', message: 'Top-ups come from the NEAR account linked to your profile.', code };
    case 'wallet_tx_failed':
      return { title: 'The deposit failed on NEAR', message: 'No NEAR was deposited. Try again in a moment.', code };
    case 'wallet_failed':
    case 'wallet_unsupported':
      return { title: 'The wallet did not finish', message: `${err.message} Nothing was sent.`, code };
    case 'not_found':
      return {
        title: 'Deposit not found yet',
        message: 'NEAR has not shown this deposit yet. Wait a few seconds and try again; it will not be paid twice.',
        code,
      };
    case 'invalid_amount':
      return {
        title: 'That amount cannot be credited',
        message: 'Your balance would go over the limit. Try a smaller amount.',
        code,
      };
    case 'too_small':
      return { title: 'Amount too small', message: 'That deposit is worth less than 1 credit.', code };
    case 'duplicate_receipt':
      return {
        title: 'Already credited',
        message: 'This deposit was credited before. Your balance already includes it.',
        code,
      };
    case 'rpc_unavailable':
      return {
        title: 'Top-ups paused',
        message: 'NEAR is not reachable right now. Your balance is safe. Try again in a few minutes.',
        code,
      };
    case 'dev_disabled':
      return {
        title: 'Test deposits are off',
        message: 'This server only accepts real NEAR deposits. Connect a NEAR wallet to top up.',
        code,
      };
    case 'sender_required':
    case 'wrong_sender':
      return {
        title: 'Connect your NEAR wallet first',
        message: 'The deposit must come from the NEAR account linked to your profile.',
        code,
      };
    case 'network':
      return {
        title: 'Offline',
        message: 'The game server could not be reached. Nothing was sent. Check your connection.',
        code,
      };
    default:
      return { title: 'Top-up did not finish', message: err.message, code };
  }
}
