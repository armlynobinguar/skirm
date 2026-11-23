'use client';
// "Start a sealed auction 🔒" on a skill the player holds (NEXT_PUBLIC_ZAMA_ENABLED).
//
// Steps, each one wallet prompt at most: link the wallet's address to the account (a signed message,
// once: the Exchange grants the winner the skill through that link), create the auction on
// SkillAuction (the reserve is public or encrypted in this tab), then register it with the api so
// the Exchange lists it. Bids, the ranking and the payment all stay on chain.
import { Button, TextField } from '@skirm/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useApi } from '@/lib/services';
import { encryptU64 } from '@/lib/zama/fhe';
import { getFhevmInstance } from '@/lib/zama/relayer';
import { connectEvmWallet } from '@/lib/zama/wallet';
import { errorMessage } from '@/features/zama/credits/CSkirmBalance';
import { parseCskirm } from '@/features/zama/stakes/stakes';
import { AUCTION_DURATIONS, auctionAddress, auctionApi, auctionSkillRef, linkMessage, type AuctionApi } from './auctions';
import s from './auctions.module.css';

export interface StartSealedAuctionProps {
  skillId: string;
  version: number;
  accountId: string;
  /** Tests: the chain (default: SkillAuction signed by the connected wallet). */
  api?: AuctionApi;
  onStarted?: () => void;
}

export function StartSealedAuction({ skillId, version, accountId, api: injected, onStarted }: StartSealedAuctionProps) {
  const client = useApi();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [duration, setDuration] = useState<number>(AUCTION_DURATIONS[2].seconds);
  const [reserveText, setReserveText] = useState('');
  const [sealedReserve, setSealedReserve] = useState(true);
  const [step, setStep] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reserve = reserveText.trim() === '' ? 0n : parseCskirm(reserveText);

  if (!open) {
    return (
      <Button variant="secondary" onClick={() => setOpen(true)} data-testid="zama-auction-start-open">
        Start a sealed auction 🔒
      </Button>
    );
  }

  const start = async () => {
    if (reserve === null) return;
    setError(null);
    try {
      const contract = auctionAddress();
      setStep('Connecting your wallet…');
      const conn = await connectEvmWallet();
      const me = conn.address.toLowerCase();
      const linked = await client.evmLink();
      if (linked.address !== me) {
        setStep('Sign to link this wallet to your account…');
        const signature = await conn.signer.signMessage(linkMessage(accountId, me));
        await client.linkEvm({ address: me, signature });
      }
      const api = injected ?? auctionApi(conn.signer, contract);
      const endTime = Math.floor(Date.now() / 1000) + duration;
      let reserveArg: Parameters<AuctionApi['create']>[2] = reserve;
      if (sealedReserve && reserve > 0n) {
        setStep('Encrypting the reserve…');
        const instance = await getFhevmInstance(conn.eip1193);
        reserveArg = await encryptU64(instance, contract, me, reserve);
      }
      setStep('Creating the auction on Sepolia…');
      const auctionId = await api.create(auctionSkillRef(skillId, version), endTime, reserveArg);
      setStep('Listing it on the Exchange…');
      await client.registerSealedAuction({ skillId, version, auctionId: auctionId.toString() });
      await qc.invalidateQueries({ queryKey: ['zama', 'auctions'] });
      setOpen(false);
      onStarted?.();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setStep(null);
    }
  };

  return (
    <div className={s.form} data-testid="zama-auction-start">
      <span className="sk-kick">Sealed auction 🔒 · paid in cSKIRM on Sepolia</span>
      <p className={s.muted}>
        Bidders submit encrypted bids. Nobody, you included, sees a bid until it closes; then only the winner and the price open. The winner pays the
        second-highest bid (or your reserve).
      </p>
      <label className={s.check}>
        Ends in
        <select className={s.select} value={duration} onChange={(e) => setDuration(Number(e.target.value))} data-testid="zama-auction-duration">
          {AUCTION_DURATIONS.map((d) => (
            <option key={d.seconds} value={d.seconds}>
              {d.label}
            </option>
          ))}
        </select>
      </label>
      <TextField
        label="Reserve price (optional)"
        value={reserveText}
        onChange={(e) => setReserveText(e.target.value)}
        suffix="cSKIRM"
        mono
        inputMode="decimal"
        placeholder="0"
        {...(reserve === null ? { error: 'Up to 6 decimals' } : {})}
        data-testid="zama-auction-reserve"
      />
      <label className={s.check}>
        <input type="checkbox" checked={sealedReserve} onChange={(e) => setSealedReserve(e.target.checked)} data-testid="zama-auction-sealed-reserve" />
        Keep the reserve sealed 🔒 (bidders cannot aim just above it)
      </label>
      <div className={s.row}>
        <Button variant="primary" onClick={() => void start()} disabled={step !== null || reserve === null} data-testid="zama-auction-start">
          {step ?? 'Start auction'}
        </Button>
        <Button variant="ghost" onClick={() => setOpen(false)} disabled={step !== null}>
          Cancel
        </Button>
      </div>
      {error ? (
        <p className={s.error} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
