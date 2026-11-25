'use client';
// One "Sealed auction 🔒" listing on the Exchange (NEXT_PUBLIC_ZAMA_ENABLED).
//
// Public: the countdown, "N sealed bids" (a count, never an amount) and, once over, the winner and
// the clearing price, the only two numbers the chain ever opens. Private: the bid box encrypts the
// amount in this tab before it leaves the browser, and "Your bid: 🔒 Reveal" user-decrypts the
// caller's own bid (only its wallet holds ACL access). Losers get their escrow back by confidential
// transfer, so their amounts are never revealed.
import { Button, TextField } from '@skirm/ui';
import { useEffect, useRef, useState } from 'react';
import type { SealedAuctionCard as Card } from '@/lib/api/zamaTypes';
import { zamaConfig } from '@/lib/zama/config';
import { encryptU64, formatUnits6, isZeroHandle } from '@/lib/zama/fhe';
import { getFhevmInstance } from '@/lib/zama/relayer';
import { connectEvmWallet, restoreEvmWallet } from '@/lib/zama/wallet';
import { errorMessage } from '@/features/zama/credits/CSkirmBalance';
import { explorerUrl, readOnlyRunner } from '@/features/zama/randomness/randomness';
import { approveOperator, parseCskirm } from '@/features/zama/stakes/stakes';
import {
  AUCTION_POLL_MS,
  auctionApi,
  auctionPhase,
  closeAndFinalize,
  countdown,
  hasWinner,
  revealMyBid,
  roleOf,
  sealedBidsLabel,
  type AuctionApi,
  type ChainAuction,
} from './auctions';
import s from './auctions.module.css';
import { SealBadge, WhoCanSee } from '@/features/zama/privacy/WhoCanSee';

export interface SealedAuctionCardProps {
  card: Card;
  /** The SkillAuction address the card's auction lives on. */
  contract: string;
  /** Tests: the chain (default: SkillAuction over the public Sepolia RPC for reads, the wallet for writes). */
  api?: AuctionApi;
  /** Tests: a fixed wallet address instead of the injected wallet's. */
  address?: string | null;
}

type Busy = 'bid' | 'reveal' | 'close' | 'refund' | null;

export function SealedAuctionCard({ card, contract, api: injected, address: fixedAddress }: SealedAuctionCardProps) {
  const id = BigInt(card.auctionId);
  const reader = useRef<AuctionApi | null>(null);
  if (!reader.current) reader.current = injected ?? auctionApi(readOnlyRunner(), contract);
  const [chain, setChain] = useState<ChainAuction | null>(null);
  const [address, setAddress] = useState<string | null>(fixedAddress ?? null);
  const [hasBid, setHasBid] = useState(false);
  const [refunded, setRefunded] = useState(false);
  const [mine, setMine] = useState<bigint | null>(null);
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [tx, setTx] = useState<string | null>(null);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

  // The already-connected wallet, without a prompt (tests pass one in).
  useEffect(() => {
    if (fixedAddress !== undefined) return;
    let gone = false;
    void restoreEvmWallet()
      .then((c) => !gone && setAddress(c?.address.toLowerCase() ?? null))
      .catch(() => undefined);
    return () => {
      gone = true;
    };
  }, [fixedAddress]);

  // Chain state, re-read until the auction is over; the clock ticks every second for the countdown.
  const over = chain?.status === 'won' || chain?.status === 'failed';
  useEffect(() => {
    const api = reader.current!;
    let gone = false;
    const read = async () => {
      try {
        const a = await api.get(id);
        if (gone) return;
        setChain(a);
        if (address) {
          const [h, r] = await Promise.all([api.bidOf(id, address), api.refunded(id, address)]);
          if (gone) return;
          setHasBid(!isZeroHandle(h));
          setRefunded(r);
        }
      } catch {
        // RPC hiccup: the next poll retries.
      }
    };
    void read();
    const poll = over ? null : setInterval(() => void read(), AUCTION_POLL_MS);
    return () => {
      gone = true;
      if (poll) clearInterval(poll);
    };
  }, [id, address, over]);
  useEffect(() => {
    if (over) return;
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1_000);
    return () => clearInterval(t);
  }, [over]);

  if (!chain) {
    return (
      <div className={`sk-panel ${s.card}`} data-testid="zama-auction-card" aria-busy>
        <p className={s.name}>{card.skill.name ?? card.skill.id}</p>
        <p className={s.muted}>Reading the auction on Sepolia…</p>
      </div>
    );
  }

  const phase = auctionPhase(chain, now);
  const role = roleOf(chain, address, hasBid);
  const amountBase = parseCskirm(amount);

  /** Runs a wallet action: connects, gets the FHE instance, then `fn` with a signer-bound api. */
  const run = async (kind: Exclude<Busy, null>, fn: (ctx: { api: AuctionApi; me: string; instance: Awaited<ReturnType<typeof getFhevmInstance>>; signer: Awaited<ReturnType<typeof connectEvmWallet>>['signer'] }) => Promise<void>) => {
    setBusy(kind);
    setError(null);
    try {
      const conn = await connectEvmWallet();
      const me = conn.address.toLowerCase();
      setAddress(me);
      const instance = await getFhevmInstance(conn.eip1193);
      await fn({ api: injected ?? auctionApi(conn.signer, contract), me, instance, signer: conn.signer });
      const api = reader.current!;
      setChain(await api.get(id));
      setHasBid(!isZeroHandle(await api.bidOf(id, me)));
      setRefunded(await api.refunded(id, me));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const bid = () =>
    run('bid', async ({ api, me, instance, signer }) => {
      if (amountBase === null || amountBase === 0n) throw new Error('Enter an amount in cSKIRM, e.g. 12.5.');
      const credits = zamaConfig.contracts.credits;
      if (!credits) throw new Error('cSKIRM is not deployed yet.');
      // One-time: SkillAuction may pull cSKIRM, but only on a bid this wallet signs.
      await approveOperator(signer, credits, me, contract);
      const enc = await encryptU64(instance, contract, me, amountBase);
      setTx(await api.bid(id, enc));
      setAmount('');
      setMine(null);
    });

  const reveal = () =>
    run('reveal', async ({ api, instance, signer }) => {
      setMine(await revealMyBid(instance, signer, api, contract, id));
    });

  const settle = () =>
    run('close', async ({ api, instance }) => {
      await closeAndFinalize(api, instance, id);
    });

  const refund = () =>
    run('refund', async ({ api, me }) => {
      setTx(await api.refund(id, me));
    });

  const txLink = tx ? explorerUrl(tx as `0x${string}`) : null;

  return (
    <div className={`sk-panel ${s.card}`} data-testid="zama-auction-card">
      <div className={s.cardHead}>
        <p className={s.name}>
          {card.skill.name ?? card.skill.id} <span className={s.muted}>v{card.skill.version}</span>
        </p>
        <SealBadge state="sealed">Sealed auction</SealBadge>
      </div>
      <p className={s.stats}>
        <span>by {card.seller.handle ?? 'unknown'}</span>
        {phase === 'bidding' ? (
          <span className={s.clock} data-testid="zama-auction-countdown">
            ⏱ {countdown(chain.endTime, now)}
          </span>
        ) : null}
        <span data-testid="zama-auction-bids">{sealedBidsLabel(chain.bidders)}</span>
        <span>{chain.reserveEncrypted ? <SealBadge state="sealed">reserve sealed</SealBadge> : chain.reserve > 0n ? `reserve ${formatUnits6(chain.reserve)} cSKIRM` : 'no reserve'}</span>
      </p>

      <WhoCanSee topic="auction" />

      {phase === 'bidding' && role !== 'seller' ? (
        <div className={s.row}>
          <TextField
            label="Your sealed bid"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            suffix="cSKIRM"
            mono
            inputMode="decimal"
            placeholder="25"
            {...(amount && amountBase === null ? { error: 'Up to 6 decimals' } : {})}
            data-testid="zama-auction-amount"
          />
          <Button variant="primary" size="sm" onClick={() => void bid()} disabled={busy !== null || !amountBase} data-testid="zama-auction-bid">
            {busy === 'bid' ? 'Encrypting…' : hasBid ? 'Raise 🔒' : 'Bid 🔒'}
          </Button>
        </div>
      ) : null}
      {phase === 'bidding' ? (
        <p className={s.muted}>
          {role === 'seller'
            ? 'Your auction. Nobody, you included, can read a bid until it closes.'
            : 'Second price: the highest bid wins and pays the runner-up’s bid (or the reserve). Raising adds to your bid.'}
        </p>
      ) : null}

      {hasBid ? (
        mine !== null ? (
          <p className={s.result} data-testid="zama-auction-mine">
            Your bid: {formatUnits6(mine)} cSKIRM <span className={s.muted}>· only you can see this</span>
          </p>
        ) : (
          <Button variant="secondary" size="sm" onClick={() => void reveal()} disabled={busy !== null} data-testid="zama-auction-reveal">
            Your bid: 🔒 Reveal
          </Button>
        )
      ) : null}

      {phase === 'ended' || phase === 'closing' ? (
        <>
          <p className={s.muted}>Bidding is over. Open the result: the chain reveals only the winner and the price.</p>
          <Button variant="secondary" size="sm" onClick={() => void settle()} disabled={busy !== null} data-testid="zama-auction-close">
            {busy === 'close' ? 'Opening…' : 'Open the result'}
          </Button>
        </>
      ) : null}

      {phase === 'won' && hasWinner(chain) ? (
        <p className={s.result} data-testid="zama-auction-result">
          {role === 'winner' ? <span className={s.good}>You won</span> : <>Won by {card.buyer?.handle ?? `${chain.winner.slice(0, 6)}…${chain.winner.slice(-4)}`}</>} at{' '}
          {formatUnits6(chain.price)} cSKIRM
        </p>
      ) : null}
      {phase === 'failed' ? (
        <p className={s.result} data-testid="zama-auction-result">
          No sale{chain.bidders === 0 ? ': no bids' : ': the best bid stayed below the reserve'}. Every bid goes back, unrevealed.
        </p>
      ) : null}
      {phase === 'won' && role === 'winner' ? (
        <p className={s.muted}>{card.status === 'granted' ? 'The skill is yours: equip it from My skills.' : 'The Exchange grants you the skill shortly.'}</p>
      ) : null}

      {(phase === 'won' || phase === 'failed') && hasBid ? (
        refunded ? (
          <p className={s.muted} data-testid="zama-auction-refunded">
            {role === 'winner' ? 'Your change (bid − price) was refunded 🔒' : 'Your bid was refunded 🔒 · its amount was never revealed'}
          </p>
        ) : (
          <Button variant="secondary" size="sm" onClick={() => void refund()} disabled={busy !== null} data-testid="zama-auction-refund">
            {role === 'winner' ? 'Collect your change 🔒' : 'Get your bid back 🔒'}
          </Button>
        )
      ) : null}

      {txLink ? (
        <a className={s.link} href={txLink} target="_blank" rel="noreferrer">
          Transaction ↗
        </a>
      ) : null}
      {error ? (
        <p className={s.error} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
