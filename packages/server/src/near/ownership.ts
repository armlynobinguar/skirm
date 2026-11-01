// Owner cache refresh for skill tokens: reads `nft_token` on the skills contract.
import type { NearRpc } from './rpc';

export interface OwnershipReader {
  readonly kind: 'noop' | 'near';
  /** Current NEAR owner of the token; null when the token does not exist; undefined = unknown (noop). */
  ownerOf(tokenId: string): Promise<string | null | undefined>;
}

/** Without NEAR ops nothing is minted onchain, so the local cache is the truth. */
export class NoopOwnershipReader implements OwnershipReader {
  readonly kind = 'noop' as const;
  async ownerOf(): Promise<undefined> {
    return undefined;
  }
}

export class NearOwnershipReader implements OwnershipReader {
  readonly kind = 'near' as const;
  constructor(
    private readonly rpc: NearRpc,
    private readonly skillsContract: string,
  ) {}
  async ownerOf(tokenId: string): Promise<string | null> {
    const token = await this.rpc.view<{ owner_id?: string } | null>(
      this.skillsContract,
      'nft_token',
      { token_id: tokenId },
    );
    return token?.owner_id ?? null;
  }
}

/** The pieces of @skirm/db the refresh needs (kept structural to avoid a hard coupling). */
export interface OwnerCacheRepos {
  accounts: { byNearAccount(near: string): Promise<{ id: string } | undefined> };
  skills: {
    setTokenOwner(tokenId: string, ownerId: string | null, ownerNear: string | null): Promise<void>;
  };
}

/**
 * Reads the owner from chain and updates skill_ownership. Returns the NEAR owner, or undefined
 * when the reader cannot tell (noop) or the token is unknown onchain (cache left untouched).
 */
export async function refreshOwner(
  reader: OwnershipReader,
  repos: OwnerCacheRepos,
  tokenId: string,
): Promise<string | undefined> {
  const owner = await reader.ownerOf(tokenId);
  if (!owner) return undefined;
  const account = await repos.accounts.byNearAccount(owner);
  await repos.skills.setTokenOwner(tokenId, account?.id ?? null, owner);
  return owner;
}
