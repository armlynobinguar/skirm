'use client';
// /fog (behind NEXT_PUBLIC_ZAMA_ENABLED): connects the EVM wallet, builds the FogSkirm client and
// the relayer SDK (only through getFhevmInstance), and shows the lobby or the game in `?game=`.
import { Button } from '@skirm/ui';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { routes } from '@/lib/routes';
import { zamaConfig } from '@/lib/zama/config';
import { getFhevmInstance } from '@/lib/zama/relayer';
import { connectEvmWallet, restoreEvmWallet, type EvmConnection } from '@/lib/zama/wallet';
import { errorMessage } from '@/features/zama/credits/CSkirmBalance';
import { shortAddress } from '@/features/zama/credits/credits';
import { fogAddress, fogApi, parseGameId } from './fog';
import { FogLobby } from './FogLobby';
import { FogPlay, type FogDeps, type FogInstance } from './FogPlay';
import s from './fog.module.css';

export function FogArena() {
  const router = useRouter();
  const gameId = parseGameId(useSearchParams().get('game') ?? '');
  const [conn, setConn] = useState<EvmConnection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const deployed = zamaConfig.contracts.fog !== null;

  useEffect(() => {
    // An already-connected wallet on another chain still goes through Connect (which switches it).
    void restoreEvmWallet().then((c) => setConn(c && c.chainId === zamaConfig.chainId ? c : null), () => undefined);
  }, []);

  const deps = useMemo<FogDeps | null>(() => {
    if (!conn || !deployed) return null;
    const contract = fogAddress();
    return {
      address: conn.address,
      contract,
      api: fogApi(conn.signer, contract),
      signer: conn.signer,
      instance: () => getFhevmInstance(conn.eip1193) as Promise<FogInstance>,
    };
  }, [conn, deployed]);

  if (!deployed) {
    return (
      <section className={`sk-panel ${s.panel}`} data-testid="fog-not-deployed">
        <p className={s.note}>FogSkirm is not deployed yet. Deploy packages/fhevm to Sepolia (DEPLOY_CONTRACTS=FogSkirm) or set NEXT_PUBLIC_ZAMA_FOG_ADDRESS.</p>
      </section>
    );
  }

  if (!deps) {
    return (
      <section className={`sk-panel ${s.panel}`} data-testid="fog-connect">
        <p className={s.lead}>Connect an EVM wallet on Sepolia to play. Every move is a transaction; your scout, traps and pings are decrypted only in this tab.</p>
        <Button
          variant="primary"
          loading={connecting}
          onClick={async () => {
            setConnecting(true);
            setError(null);
            try {
              setConn(await connectEvmWallet());
            } catch (e) {
              setError(errorMessage(e));
            } finally {
              setConnecting(false);
            }
          }}
        >
          Connect wallet
        </Button>
        {error ? (
          <p className={s.error} role="alert">
            {error}
          </p>
        ) : null}
      </section>
    );
  }

  return (
    <>
      <p className={s.who}>
        Playing as <span className="sk-mono">{shortAddress(deps.address)}</span>
      </p>
      {gameId === null ? (
        <FogLobby {...deps} onEnter={(id) => router.replace(routes.fog(String(id)))} />
      ) : (
        <FogPlay key={`${deps.address}:${gameId}`} {...deps} gameId={gameId} onLeave={() => router.replace(routes.fog())} />
      )}
    </>
  );
}
