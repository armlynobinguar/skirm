'use client';
// cSKIRM confidential balance (credits page, behind NEXT_PUBLIC_ZAMA_ENABLED).
//
// The balance is an ERC-7984 ciphertext on Sepolia: the page only ever sees its handle until the
// holder presses Reveal, signs an EIP-712 user-decrypt request and the Zama KMS re-encrypts it to a
// key that lives in this tab. "Get test credits" calls the token's rate-limited faucet.
import { Button, Icon } from '@skirm/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import { zamaConfig } from '@/lib/zama/config';
import { clearDecryptAuth, formatUnits6, isZeroHandle, userDecryptUint, type Handle } from '@/lib/zama/fhe';
import { getFhevmInstance } from '@/lib/zama/relayer';
import { connectEvmWallet, restoreEvmWallet, type EvmConnection } from '@/lib/zama/wallet';
import { claimFaucet, creditsAddress, formatWait, readBalanceHandle, readFaucet, shortAddress, type FaucetStatus } from './credits';
import s from './credits.module.css';
import { WhoCanSee } from '@/features/zama/privacy/WhoCanSee';

type Busy = null | 'connect' | 'reveal' | 'faucet';

/** Readable message for wallet / relayer / contract failures. */
export function errorMessage(e: unknown): string {
  const err = e as { code?: unknown; shortMessage?: unknown; message?: unknown } | null;
  if (err?.code === 4001 || err?.code === 'ACTION_REJECTED') return 'The request was rejected in the wallet.';
  if (typeof err?.shortMessage === 'string') return err.shortMessage;
  if (typeof err?.message === 'string') return err.message;
  return 'Something went wrong. Try again.';
}

export function CSkirmBalance() {
  const [conn, setConn] = useState<EvmConnection | null>(null);
  const [handle, setHandle] = useState<Handle | null>(null);
  const [revealed, setRevealed] = useState<bigint | null>(null);
  const [faucet, setFaucet] = useState<FaucetStatus | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  const deployed = zamaConfig.contracts.credits !== null;

  const handleRef = useRef<Handle | null>(null);

  /** Re-reads the balance handle and faucet state; a new handle hides the old revealed value. */
  const refresh = useCallback(async (c: EvmConnection) => {
    const [h, f] = await Promise.all([readBalanceHandle(c.provider, c.address), readFaucet(c.provider, c.address)]);
    if (handleRef.current !== h) setRevealed(null);
    handleRef.current = h;
    setHandle(h);
    setFaucet(f);
  }, []);

  // Pick up an already-authorised wallet without prompting, and follow account / chain changes.
  useEffect(() => {
    let alive = true;
    const load = () =>
      restoreEvmWallet()
        .then((c) => {
          if (!alive) return;
          clearDecryptAuth();
          setConn(c);
          setRevealed(null);
          setHandle(null);
          handleRef.current = null;
          if (c && deployed && c.chainId === zamaConfig.chainId) return refresh(c);
        })
        .catch(() => {});
    void load();
    const eth = (window as unknown as { ethereum?: EvmConnection['eip1193'] }).ethereum;
    eth?.on?.('accountsChanged', load);
    eth?.on?.('chainChanged', load);
    return () => {
      alive = false;
      eth?.removeListener?.('accountsChanged', load);
      eth?.removeListener?.('chainChanged', load);
    };
  }, [deployed, refresh]);

  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(id);
  }, []);

  const run = async (kind: Exclude<Busy, null>, fn: () => Promise<void>) => {
    setBusy(kind);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const connect = () =>
    run('connect', async () => {
      const c = await connectEvmWallet();
      setConn(c);
      if (deployed) await refresh(c);
    });

  const reveal = () =>
    run('reveal', async () => {
      if (!conn || !handle) return;
      if (isZeroHandle(handle)) {
        setRevealed(0n);
        return;
      }
      const instance = await getFhevmInstance(conn.eip1193);
      setRevealed(await userDecryptUint(instance, conn.signer, { handle, contractAddress: creditsAddress() }));
    });

  const claim = () =>
    run('faucet', async () => {
      if (!conn) return;
      await claimFaucet(conn.signer);
      await refresh(conn);
    });

  const wait = faucet ? formatWait(faucet.availableAt, now) : null;
  const onSepolia = conn?.chainId === zamaConfig.chainId;

  return (
    <section aria-labelledby="zama-cskirm" className={s.card} data-testid="zama-cskirm">
      <div className={s.head}>
        <h2 id="zama-cskirm" className={s.h2}>
          Confidential credits
        </h2>
        <span className={s.chain}>cSKIRM · Sepolia</span>
      </div>

      {!deployed ? (
        <p className={s.note} data-testid="zama-cskirm-undeployed">
          cSKIRM is not deployed yet.
        </p>
      ) : !conn ? (
        <>
          <p className={s.note}>Connect an EVM wallet on Sepolia to see your encrypted balance.</p>
          <div className={s.actions}>
            <Button size="sm" icon="wallet" loading={busy === 'connect'} onClick={connect} data-testid="zama-connect">
              Connect EVM wallet
            </Button>
          </div>
        </>
      ) : !onSepolia ? (
        <>
          <p className={s.note}>Your wallet is on another network.</p>
          <div className={s.actions}>
            <Button size="sm" icon="wallet" loading={busy === 'connect'} onClick={connect} data-testid="zama-switch">
              Switch to Sepolia
            </Button>
          </div>
        </>
      ) : (
        <>
          <div className={s.balance}>
            <Icon name="lock" size={20} />
            <span className={s.amount} data-testid="zama-cskirm-balance">
              {revealed === null ? <span className={s.sealed}>••••••</span> : formatUnits6(revealed)}
            </span>
            <span className={s.unit}>cSKIRM</span>
          </div>
          <p className={s.note}>
            Encrypted on chain. Only <span className={s.mono}>{shortAddress(conn.address)}</span> can decrypt it.
          </p>
          <WhoCanSee topic="credits" />
          <div className={s.actions}>
            {revealed === null ? (
              <Button size="sm" icon="lock" loading={busy === 'reveal'} disabled={!handle || busy !== null} onClick={reveal} data-testid="zama-reveal">
                Reveal
              </Button>
            ) : (
              <Button size="sm" onClick={() => setRevealed(null)} data-testid="zama-hide">
                Hide
              </Button>
            )}
            <Button
              size="sm"
              variant="primary"
              icon="credits"
              loading={busy === 'faucet'}
              disabled={busy !== null || !faucet || faucet.amount === 0n || wait !== null}
              onClick={claim}
              data-testid="zama-faucet"
            >
              {wait ? `Next claim in ${wait}` : faucet && faucet.amount > 0n ? `Get ${formatUnits6(faucet.amount)} test credits` : 'Get test credits'}
            </Button>
          </div>
        </>
      )}
      {error ? (
        <p className={s.error} role="alert" data-testid="zama-error">
          {error}
        </p>
      ) : null}
    </section>
  );
}
