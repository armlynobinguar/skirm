// cSKIRM (ConfidentialSkirmCredits, ERC-7984) calls used by the credits widget.
import { ConfidentialSkirmCreditsAbi } from '@skirm/fhevm/generated';
import { Contract, type ContractRunner } from 'ethers';
import { zamaConfig, type HexAddress } from '@/lib/zama/config';
import type { Handle } from '@/lib/zama/fhe';
import { ZamaWalletError } from '@/lib/zama/wallet';

/** The deployed cSKIRM address, or a `not_deployed` error. */
export function creditsAddress(): HexAddress {
  const address = zamaConfig.contracts.credits;
  if (!address) {
    throw new ZamaWalletError(
      'not_deployed',
      'cSKIRM is not deployed yet: deploy packages/fhevm to Sepolia or set NEXT_PUBLIC_ZAMA_CREDITS_ADDRESS.',
    );
  }
  return address;
}

function credits(runner: ContractRunner): Contract {
  return new Contract(creditsAddress(), ConfidentialSkirmCreditsAbi, runner);
}

/** The holder's encrypted balance handle (all zeros if they never held cSKIRM). */
export async function readBalanceHandle(runner: ContractRunner, holder: string): Promise<Handle> {
  return (await credits(runner).getFunction('confidentialBalanceOf')(holder)) as Handle;
}

export interface FaucetStatus {
  /** Base units (6 decimals) per claim; 0 means the faucet is off. */
  amount: bigint;
  /** Unix seconds from which `holder` can claim (0: now). */
  availableAt: number;
}

export async function readFaucet(runner: ContractRunner, holder: string): Promise<FaucetStatus> {
  const c = credits(runner);
  const [amount, availableAt] = await Promise.all([
    c.getFunction('faucetAmount')() as Promise<bigint>,
    c.getFunction('nextFaucetClaimAt')(holder) as Promise<bigint>,
  ]);
  return { amount, availableAt: Number(availableAt) };
}

/** Sends claimFaucet() and waits for one confirmation; returns the tx hash. */
export async function claimFaucet(signer: ContractRunner): Promise<string> {
  const tx = (await credits(signer).getFunction('claimFaucet')()) as { hash: string; wait: () => Promise<unknown> };
  await tx.wait();
  return tx.hash;
}

/** "3h 20m" / "12m" / "45s" until `availableAt`, or null if it is already claimable. */
export function formatWait(availableAt: number, nowSec: number): string | null {
  const left = Math.ceil(availableAt - nowSec);
  if (left <= 0) return null;
  const h = Math.floor(left / 3600);
  const m = Math.floor((left % 3600) / 60);
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  if (m > 0) return `${m}m`;
  return `${left}s`;
}

/** 0x1234…abcd */
export function shortAddress(address: string): string {
  return address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
}
