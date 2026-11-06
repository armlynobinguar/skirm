import { describe, expect, it } from 'vitest';
import { equipCosmeticById } from '@skirm/shared';
import {
  NearCosmetics,
  cosmeticCreateArgs,
  cosmeticMintArgs,
  cosmeticMintId,
  createNearAdapters,
  loadConfig,
  type FunctionCaller,
} from '../src/index';

const input = { accountId: 'acc_1', itemId: 'skin_ember', receiverId: 'ana.testnet' };

function caller(value: unknown = true) {
  const calls: { contractId: string; methodName: string; args: Record<string, unknown> }[] = [];
  const c: FunctionCaller = {
    async call(contractId, methodName, args) {
      calls.push({ contractId, methodName, args });
      return { txHash: 'HASH1', value };
    },
  };
  return { c, calls };
}

describe('cosmetics adapter (NEP-245)', () => {
  it('builds mt_mint args with one idempotent mint per player and item', () => {
    expect(cosmeticMintId('acc_1', 'skin_ember')).toBe('acc_1:skin_ember');
    expect(cosmeticMintArgs(input)).toEqual({
      receiver_id: 'ana.testnet',
      token_ids: ['skin_ember'],
      amounts: ['1'],
      memo: 'skirm purchase',
      mint_id: 'acc_1:skin_ember',
    });
  });

  it('builds mt_create args from the catalog, the look in metadata.extra', () => {
    const args = cosmeticCreateArgs(equipCosmeticById('trail_spark')!);
    expect(args).toMatchObject({ token_id: 'trail_spark', metadata: { title: 'Spark trail' } });
    const extra = JSON.parse((args.metadata as { extra: string }).extra);
    expect(extra).toEqual({ schema: 'skirm.cosmetic/v0', kind: 'trail', color: '#ffd166', style: 'sparks' });
  });

  it('mints with the ops key and reads balances by view', async () => {
    const { c, calls } = caller(true);
    const views: unknown[] = [];
    const rpc = {
      async view<T>(contractId: string, method: string, args: unknown) {
        views.push({ contractId, method, args });
        return ['1', '0'] as T;
      },
    };
    const chain = new NearCosmetics(c, rpc, 'cosmetics.playskirm.testnet');
    expect(await chain.mint(input)).toEqual({ txHash: 'HASH1', minted: true });
    expect(calls).toEqual([
      { contractId: 'cosmetics.playskirm.testnet', methodName: 'mt_mint', args: cosmeticMintArgs(input) },
    ]);
    expect(await chain.balances('ana.testnet', ['skin_ember', 'trail_spark'])).toEqual({
      skin_ember: 1,
      trail_spark: 0,
    });
    expect(views).toEqual([
      {
        contractId: 'cosmetics.playskirm.testnet',
        method: 'mt_batch_balance_of',
        args: { account_id: 'ana.testnet', token_ids: ['skin_ember', 'trail_spark'] },
      },
    ]);
    expect(await chain.balances('ana.testnet', [])).toEqual({});
    // A resend the contract had already minted.
    const again = new NearCosmetics(caller(false).c, rpc, 'cosmetics.playskirm.testnet');
    expect((await again.mint(input)).minted).toBe(false);
  });

  it('is off by default: no contract (or no signer) means no cosmetics chain', () => {
    expect(loadConfig({}).NEAR_CONTRACT_COSMETICS).toBeUndefined();
    expect(createNearAdapters(loadConfig({}), { caller: caller().c }).cosmetics).toBeUndefined();
    const cfg = loadConfig({ NEAR_CONTRACT_COSMETICS: ' cosmetics.playskirm.testnet ' });
    expect(cfg.NEAR_CONTRACT_COSMETICS).toBe('cosmetics.playskirm.testnet');
    expect(createNearAdapters(cfg).cosmetics).toBeUndefined(); // no ops signer
    expect(createNearAdapters(cfg, { caller: caller().c }).cosmetics?.contractId).toBe(
      'cosmetics.playskirm.testnet',
    );
    expect(() => loadConfig({ NEAR_CONTRACT_COSMETICS: 'Not An Account' })).toThrow();
  });
});
