import { describe, expect, it } from 'vitest';
import {
  NearBadges,
  NoopBadges,
  badgeMintArgs,
  badgeTokenId,
  createNearAdapters,
  loadConfig,
  type FunctionCaller,
} from '../src/index';

const input = {
  accountId: 'acc_01JB7Z3K9QX4M2T8V6N5R1C0DE',
  achievementId: 'first_win',
  receiverId: 'ana.testnet',
  title: 'First win',
  detail: 'Win a match',
  unlockedAtMs: 1_793_700_000_123.7,
};

function caller() {
  const calls: { contractId: string; methodName: string; args: Record<string, unknown> }[] = [];
  const c: FunctionCaller = {
    async call(contractId, methodName, args) {
      calls.push({ contractId, methodName, args });
      return { txHash: 'HASH1' };
    },
  };
  return { c, calls };
}

describe('badges adapter', () => {
  it('builds nft_mint args with one token per player and achievement', () => {
    expect(badgeTokenId('first_win', 'acc_1')).toBe('first_win:acc_1');
    expect(badgeMintArgs(input)).toEqual({
      token_id: `first_win:${input.accountId}`,
      receiver_id: 'ana.testnet',
      badge: {
        achievement_id: 'first_win',
        player: input.accountId,
        title: 'First win',
        description: 'Win a match',
        unlocked_at_ms: 1_793_700_000_123,
      },
    });
  });

  it('is a no-op locally: status local with a noop: hash, nothing signed', async () => {
    const noop = new NoopBadges();
    const r = await noop.mint(input);
    expect(r.status).toBe('local');
    expect(r.txHash).toMatch(/^noop:[0-9a-f]{44}$/);
    expect(r.tokenId).toBe(`first_win:${input.accountId}`);
    expect(noop.mints).toHaveLength(1);
    // Same input, same fake hash.
    expect((await noop.mint(input)).txHash).toBe(r.txHash);
  });

  it('signs nft_mint on the badges contract with the ops key', async () => {
    const { c, calls } = caller();
    const near = new NearBadges(c, 'badges.playskirm.testnet');
    const r = await near.mint(input);
    expect(r).toEqual({ status: 'recorded', txHash: 'HASH1', tokenId: `first_win:${input.accountId}` });
    expect(calls).toEqual([
      { contractId: 'badges.playskirm.testnet', methodName: 'nft_mint', args: badgeMintArgs(input) },
    ]);
  });

  it('createNearAdapters: noop without ops keys, near on NEAR_CONTRACT_BADGES with them', async () => {
    expect(loadConfig({}).NEAR_CONTRACT_BADGES).toBe('badges.playskirm.testnet');
    expect(createNearAdapters(loadConfig({})).badges.kind).toBe('noop');
    const { c, calls } = caller();
    const near = createNearAdapters(loadConfig({ NEAR_CONTRACT_BADGES: 'badges.skirm-staging.testnet' }), {
      caller: c,
    });
    expect(near.badges.kind).toBe('near');
    await near.badges.mint(input);
    expect(calls[0]!.contractId).toBe('badges.skirm-staging.testnet');
  });
});
