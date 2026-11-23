'use client';
// /fog: Fog Skirm, a short fully on-chain hidden-information mode (Zama FHEVM on Sepolia). The
// explainer renders right away; the game client (ethers, the FogSkirm ABI, the wallet and the
// relayer SDK loader) is code-split and only loaded in the browser.
import dynamic from 'next/dynamic';
import { Suspense } from 'react';
import { Skeleton } from '@/components/states/Skeleton';
import s from './fog.module.css';

const FogArena = dynamic(() => import('./FogArena').then((m) => m.FogArena), { ssr: false, loading: () => <Skeleton rows={4} /> });

export function FogScreen() {
  return (
    <div className={s.screen} data-testid="screen-fog">
      <header className={s.hero}>
        <span className="sk-kick">Zama FHEVM · Sepolia · fully on chain</span>
        <h1 className={`sk-disp ${s.title}`}>Fog Skirm</h1>
        <p className={s.lead}>
          Two scouts, a 5×5 marsh and one seed vial hidden in the middle row. Find it, carry it back to your home row, and stay clear of the two
          flood switches your rival planted where you cannot see them. Ten rounds. Every move is a sealed transaction.
        </p>
      </header>
      <Suspense fallback={<Skeleton rows={4} />}>
        <FogArena />
      </Suspense>
      <details className={`sk-panel ${s.panel} ${s.why}`} open>
        <summary className="sk-kick">Why this game needs FHE</summary>
        <ul className={s.whyList}>
          <li>
            <strong>On a transparent chain the fog is gone.</strong> Traps, positions and moves would sit in calldata and contract storage: anyone,
            including your rival, could read them from a block explorer before the next move.
          </li>
          <li>
            <strong>Commit-reveal is not enough.</strong> The rules need to compare your scout with hidden traps and a hidden vial every round. With
            hashes, someone has to reveal to resolve; here the contract resolves the round on ciphertexts (FHE.eq, FHE.select) and nobody reveals
            anything.
          </li>
          <li>
            <strong>No referee.</strong> No server knows the board. The vial is drawn on chain with FHE.randEuint8 after both players have
            committed their traps, and no account can decrypt it.
          </li>
          <li>
            <strong>Each player sees only their own fog.</strong> Your scout, your traps and your sense pings are shared with your address through
            the ACL and decrypted in this tab. Each round only three facts go public, checked against a KMS proof: someone hit a trap, the vial is
            carried, who won.
          </li>
          <li>
            <strong>Verifiable afterwards.</strong> When the game ends every hidden value is opened for public decryption; Verify this game replays
            the history with the same rules and checks it against the chain.
          </li>
        </ul>
      </details>
    </div>
  );
}
