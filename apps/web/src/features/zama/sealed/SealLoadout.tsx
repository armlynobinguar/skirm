'use client';
// "Seal loadout on Sepolia" on the PvP lock-in (behind NEXT_PUBLIC_ZAMA_ENABLED).
//
// The crew on screen is encoded (@skirm/shared encodeLoadout), encrypted in the browser with the
// Zama relayer SDK and submitted to SkirmMatch. Until both crews have sealed nobody can read it:
// not the rival, not the game server, not a block explorer. Then the match is revealed on chain and
// this tab sends v2_lock_in `sealed`, so the server plays exactly the crew that was committed.
import { encodeLoadout, loadoutValues, type SealedPick, type SealedRosterAgent } from '@skirm/shared';
import { Button } from '@skirm/ui';
import { useEffect, useRef, useState } from 'react';
import { useRealtime } from '@/lib/services';
import { getFhevmInstance } from '@/lib/zama/relayer';
import { connectEvmWallet } from '@/lib/zama/wallet';
import { errorMessage } from '@/features/zama/credits/CSkirmBalance';
import { shortAddress } from '@/features/zama/credits/credits';
import { other } from '@/features/v2/common';
import type { V2MatchView } from '@/features/v2/v2Store';
import { matchAddress, sealLoadout, sideOf, skirmMatchApi, type ChainMatch, type SealStep } from './sealed';
import s from './sealed.module.css';

const STEP_TEXT: Record<SealStep, string> = {
  create: 'Opening the match on Sepolia…',
  encrypt: 'Encrypting your loadout in this tab…',
  submit: 'Sealing it on chain (confirm in your wallet)…',
  waiting: 'Sealed. Waiting for the rival to seal…',
  reveal: 'Both sealed. Revealing on chain…',
  finalize: 'Checking the decryption proof on chain…',
  revealed: 'Revealed on chain. Starting…',
};

export interface SealLoadoutProps {
  view: V2MatchView;
  /** The crew on screen, in slot order. */
  picks: readonly SealedPick[];
  /** The player's own agents with their equipped skills (what the roster index is taken against). */
  roster: readonly SealedRosterAgent[];
  /** The crew playbook picked on the lock-in, when it moved off the queued one (sent with the sealed lock). */
  playbookPick?: () => string | null | undefined;
  /** Sealing started (true) or failed and gave the crew back (false). */
  onSealing(active: boolean): void;
}

type Phase = { kind: 'idle' } | { kind: 'busy'; step: SealStep | 'connect'; address?: string } | { kind: 'error'; message: string };

export function SealLoadout({ view, picks, roster, playbookPick, onSealing }: SealLoadoutProps) {
  const rt = useRealtime();
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [chain, setChain] = useState<ChainMatch | null>(null);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);

  let deployed = true;
  try {
    matchAddress();
  } catch {
    deployed = false;
  }
  const rivalSide = sideOf(other(view.team));
  const rivalSealed = !!chain?.locked[rivalSide];
  const rivalSealing = rivalSealed || !!view.sealing?.includes(other(view.team));
  const mineSealed = !!chain?.locked[sideOf(view.team)];
  const lockedOff = view.locked.includes(view.team);

  const seal = async () => {
    let values: number[];
    try {
      values = loadoutValues(encodeLoadout(picks, roster));
    } catch (e) {
      setPhase({ kind: 'error', message: errorMessage(e) });
      return;
    }
    const ctl = new AbortController();
    abort.current = ctl;
    setPhase({ kind: 'busy', step: 'connect' });
    onSealing(true);
    try {
      const contract = matchAddress();
      const conn = await connectEvmWallet();
      rt.send({ type: 'v2_seal', matchId: view.matchId, address: conn.address });
      const instance = await getFhevmInstance(conn.eip1193);
      await sealLoadout({
        api: skirmMatchApi(conn.signer, contract),
        instance,
        contract,
        user: conn.address,
        matchId: view.matchId,
        team: view.team,
        values,
        signal: ctl.signal,
        onStep: (step, m) => {
          setChain(m);
          setPhase({ kind: 'busy', step, address: conn.address });
        },
      });
      const playbookId = playbookPick?.();
      rt.send({
        type: 'v2_lock_in',
        matchId: view.matchId,
        tiers: picks.map((p) => p.tier),
        sealed: true,
        ...(playbookId !== undefined ? { playbookId } : {}),
      });
    } catch (e) {
      if (ctl.signal.aborted) return;
      setPhase({ kind: 'error', message: errorMessage(e) });
      // Not sealed on chain yet: hand the crew back so the normal lock-in still works.
      if (!mineSealedRef.current) onSealing(false);
    }
  };
  const mineSealedRef = useRef(false);
  mineSealedRef.current = mineSealed;

  if (!deployed) {
    return (
      <div className={`sk-panel ${s.card}`} data-testid="zama-seal">
        <span className="sk-kick">Sealed loadout · Sepolia</span>
        <p className={s.note}>SkirmMatch is not deployed yet, so this lock-in cannot be sealed on chain.</p>
      </div>
    );
  }

  const busy = phase.kind === 'busy';
  return (
    <div className={`sk-panel ${s.card}`} data-testid="zama-seal">
      <span className="sk-kick">Sealed loadout · Sepolia</span>
      {phase.kind === 'idle' ? (
        <>
          <p className={s.note}>
            Encrypt this crew on chain with Zama FHE. Nobody, not the rival and not the game server, can read your picks until both crews have
            sealed; then both are revealed together and the server plays exactly what was sealed.
          </p>
          <Button variant="secondary" block onClick={() => void seal()} disabled={lockedOff || !picks.length} data-testid="zama-seal-start">
            🔒 Seal loadout on Sepolia
          </Button>
        </>
      ) : null}
      {busy || mineSealed ? (
        <ul className={s.sides} aria-live="polite">
          <li data-testid="zama-seal-you">
            <span className={s.who}>You</span>
            <span className={mineSealed ? s.sealed : s.pending}>{mineSealed ? '🔒 sealed' : 'sealing…'}</span>
          </li>
          <li data-testid="zama-seal-rival">
            <span className={s.who}>Rival</span>
            <span className={rivalSealed ? s.sealed : s.pending}>{rivalSealed ? '🔒 sealed · hidden' : rivalSealing ? 'sealing… · hidden' : 'not sealing yet'}</span>
          </li>
        </ul>
      ) : null}
      {busy ? (
        <p className={s.note} data-testid="zama-seal-step">
          {phase.step === 'connect' ? 'Connecting your EVM wallet…' : STEP_TEXT[phase.step]}
          {phase.address ? <span className={s.mono}> · {shortAddress(phase.address)}</span> : null}
        </p>
      ) : null}
      {phase.kind === 'error' ? (
        <>
          <p className={s.error} role="alert">
            {phase.message}
          </p>
          {!mineSealed ? (
            <Button variant="secondary" block onClick={() => void seal()} disabled={lockedOff} data-testid="zama-seal-retry">
              Try sealing again
            </Button>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
