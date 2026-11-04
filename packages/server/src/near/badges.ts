// Soulbound achievement badges (contract `badges`: nft_mint, ops account only, never
// transferable) and the no-op stand-in used when NEAR_OPS_ACCOUNT/NEAR_OPS_KEY are unset.
import { createHash } from 'node:crypto';
import type { RegistryResult } from './registry';
import type { FunctionCaller } from './signer';

export interface BadgeMintInput {
  /** Platform account id: with the achievement it fixes the token id. */
  accountId: string;
  achievementId: string;
  /** NEAR account that receives (and can never move) the badge. */
  receiverId: string;
  title: string;
  detail: string;
  /** When the achievement unlocked, ms since the epoch. */
  unlockedAtMs: number;
}

export interface BadgeMintResult extends RegistryResult {
  tokenId: string;
}

export interface BadgeMinter {
  readonly kind: 'noop' | 'near';
  mint(input: BadgeMintInput): Promise<BadgeMintResult>;
}

/** One badge per player and achievement: `<achievement id>:<platform account id>`. */
export function badgeTokenId(achievementId: string, accountId: string): string {
  return `${achievementId}:${accountId}`;
}

/** The `nft_mint` args of the badges contract. */
export function badgeMintArgs(i: BadgeMintInput): Record<string, unknown> {
  return {
    token_id: badgeTokenId(i.achievementId, i.accountId),
    receiver_id: i.receiverId,
    badge: {
      achievement_id: i.achievementId,
      player: i.accountId,
      title: i.title,
      description: i.detail,
      unlocked_at_ms: Math.floor(i.unlockedAtMs),
    },
  };
}

const fakeHash = (args: Record<string, unknown>) =>
  `noop:${createHash('sha256').update('badge').update(JSON.stringify(args)).digest('hex').slice(0, 44)}`;

/** Local stand-in: records each mint; nothing goes onchain and the result is `local`. */
export class NoopBadges implements BadgeMinter {
  readonly kind = 'noop' as const;
  readonly mints: Record<string, unknown>[] = [];
  async mint(input: BadgeMintInput): Promise<BadgeMintResult> {
    const args = badgeMintArgs(input);
    this.mints.push(args);
    return { status: 'local', txHash: fakeHash(args), tokenId: args.token_id as string };
  }
}

/**
 * Calls `nft_mint` on the badges contract with the ops function-call key. Throws on failure. The
 * contract returns the existing token when the same badge is minted to the same owner again, so a
 * retry after a lost answer is safe.
 */
export class NearBadges implements BadgeMinter {
  readonly kind = 'near' as const;
  constructor(
    private readonly caller: FunctionCaller,
    private readonly contractId: string,
  ) {}
  async mint(input: BadgeMintInput): Promise<BadgeMintResult> {
    const args = badgeMintArgs(input);
    const { txHash } = await this.caller.call(this.contractId, 'nft_mint', args);
    return { status: 'recorded', txHash, tokenId: args.token_id as string };
  }
}
