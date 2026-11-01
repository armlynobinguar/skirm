import { describe, expect, it } from 'vitest';
import {
  CompositeDepositVerifier,
  DevDepositVerifier,
  NearMinter,
  NearOwnershipReader,
  NearRegistry,
  NearRpc,
  NoopMinter,
  NoopOwnershipReader,
  NoopRegistry,
  OpsFunctionCaller,
  RpcDepositVerifier,
  createNearAdapters,
  creditsForYocto,
  loadConfig,
  recordMatchArgs,
  refreshOwner,
  type FetchLike,
  type FunctionCaller,
  type RecordMatchInput,
} from '../src/index';

const NEAR = 10n ** 24n;
const TX = '9ZsxQKpXvjhxLqC3HKbNkYfgZPhMgMHbHnfRL4y2rT5e';

function rpcFetch(
  handler: (
    url: string,
    body: { method: string; params: any },
  ) => { status?: number; body?: unknown },
) {
  const calls: { url: string; method: string }[] = [];
  const fetch: FetchLike = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, method: body.method });
    const r = handler(url, body);
    return { ok: (r.status ?? 200) < 400, status: r.status ?? 200, json: async () => r.body };
  };
  return { fetch, calls };
}

function depositTx(
  o: {
    receiver?: string;
    signer?: string;
    amount?: bigint;
    eventAmount?: bigint;
    fail?: boolean;
    player?: string;
  } = {},
) {
  const amount = o.amount ?? 2n * NEAR;
  return {
    status: o.fail ? { Failure: { ActionError: {} } } : { SuccessValue: 'IjEi' },
    transaction: {
      hash: TX,
      signer_id: o.signer ?? 'ana.testnet',
      receiver_id: o.receiver ?? 'deposits.playskirm.testnet',
      actions: [
        {
          FunctionCall: {
            method_name: 'deposit',
            args: 'e30=',
            gas: 30e12,
            deposit: amount.toString(),
          },
        },
      ],
    },
    transaction_outcome: { id: TX, outcome: { logs: [], status: { SuccessReceiptId: 'r1' } } },
    receipts_outcome: [
      {
        id: 'r1',
        outcome: {
          executor_id: 'deposits.playskirm.testnet',
          status: { SuccessValue: 'IjEi' },
          logs: [
            `EVENT_JSON:${JSON.stringify({
              standard: 'skirm_deposits',
              version: '1.0.0',
              event: 'deposit',
              data: [
                {
                  receipt: '7',
                  player: o.player ?? 'ana.testnet',
                  amount: (o.eventAmount ?? amount).toString(),
                  block_height: '1',
                  timestamp_ms: '1',
                },
              ],
            })}`,
          ],
        },
      },
    ],
  };
}

describe('deposits', () => {
  it('credits floor(yocto · rate / 10^24)', () => {
    expect(creditsForYocto(NEAR, 1000)).toBe(1000);
    expect(creditsForYocto(NEAR / 2n + 1n, 1000)).toBe(500);
    expect(creditsForYocto(999_999_999_999_999_999_999n, 1000)).toBe(0);
  });

  it('dev hashes: dev:<yocto>[:nonce]', async () => {
    const v = new DevDepositVerifier(1000);
    expect(await v.verify(`dev:${3n * NEAR}`, { senderId: 'ana.testnet' })).toMatchObject({
      receipt: `dev:${3n * NEAR}`,
      credits: 3000,
      amountYocto: 3n * NEAR,
      dev: true,
    });
    expect((await v.verify(`dev:${NEAR}:abc`)).credits).toBe(1000);
    await expect(v.verify('dev:abc')).rejects.toMatchObject({ code: 'invalid_hash' });
    await expect(v.verify('dev:5')).rejects.toMatchObject({ code: 'too_small' });
  });

  it('verifies a deposit through RPC, falling back when FastNEAR fails', async () => {
    const { fetch, calls } = rpcFetch((url, body) => {
      if (url.includes('fastnear')) return { status: 503 };
      expect(body.method).toBe('EXPERIMENTAL_tx_status');
      expect(body.params).toEqual({
        tx_hash: TX,
        sender_account_id: 'ana.testnet',
        wait_until: 'FINAL',
      });
      return { body: { jsonrpc: '2.0', id: 'skirm', result: depositTx() } };
    });
    const rpc = new NearRpc(['https://test.rpc.fastnear.com', 'https://near-testnet.drpc.org'], {
      fetch,
    });
    const v = new RpcDepositVerifier(rpc, 'deposits.playskirm.testnet', 1000);
    expect(await v.verify(TX, { senderId: 'ana.testnet' })).toEqual({
      receipt: TX,
      amountYocto: 2n * NEAR,
      credits: 2000,
      sender: 'ana.testnet',
      depositReceipt: '7',
      dev: false,
    });
    expect(calls.map((c) => new URL(c.url).host)).toEqual([
      'test.rpc.fastnear.com',
      'near-testnet.drpc.org',
    ]);
  });

  it('refuses wrong receivers, signers, failures and mismatched events', async () => {
    const check = async (
      tx: unknown,
      code: string,
      senderId: string | null = 'ana.testnet',
      hash = TX,
    ) => {
      const { fetch } = rpcFetch(() => ({ body: { result: tx } }));
      const v = new RpcDepositVerifier(
        new NearRpc(['https://rpc.example'], { fetch }),
        'deposits.playskirm.testnet',
        1000,
      );
      await expect(v.verify(hash, { senderId })).rejects.toMatchObject({ code });
    };
    await check(depositTx({ receiver: 'evil.testnet' }), 'wrong_receiver');
    await check(depositTx({ signer: 'ben.testnet' }), 'wrong_sender');
    await check(depositTx({ player: 'ben.testnet' }), 'wrong_sender');
    await check(depositTx({ fail: true }), 'failed');
    await check(depositTx({ eventAmount: 5n * NEAR }), 'no_deposit');
    await check(depositTx(), 'sender_required', null);
    await check(depositTx(), 'invalid_hash', 'ana.testnet', 'not-a-hash');
    const { fetch } = rpcFetch(() => ({
      body: { error: { name: 'HANDLER_ERROR', cause: { name: 'UNKNOWN_TRANSACTION' } } },
    }));
    const v = new RpcDepositVerifier(
      new NearRpc(['https://rpc.example'], { fetch }),
      'deposits.playskirm.testnet',
      1000,
    );
    await expect(v.verify(TX, { senderId: 'ana.testnet' })).rejects.toMatchObject({
      code: 'not_found',
    });
    const down = new RpcDepositVerifier(
      new NearRpc(['https://a.example', 'https://b.example'], {
        fetch: rpcFetch(() => ({ status: 502 })).fetch,
      }),
      'deposits.playskirm.testnet',
      1000,
    );
    await expect(down.verify(TX, { senderId: 'ana.testnet' })).rejects.toMatchObject({
      code: 'rpc_unavailable',
    });
  });

  it('dev hashes only in AUTH_MODE=dev', async () => {
    const devAdapters = createNearAdapters(loadConfig({}));
    expect((await devAdapters.deposits.verify(`dev:${NEAR}`)).credits).toBe(1000);
    const prod = new CompositeDepositVerifier(new DevDepositVerifier(1), undefined);
    await expect(prod.verify(`dev:${NEAR}`)).rejects.toMatchObject({ code: 'dev_disabled' });
  });
});

describe('registry and minter', () => {
  const caller = () => {
    const calls: { contractId: string; methodName: string; args: Record<string, unknown> }[] = [];
    const c: FunctionCaller = {
      async call(contractId, methodName, args) {
        calls.push({ contractId, methodName, args });
        return {
          txHash: 'HASH1',
          value:
            methodName === 'nft_mint'
              ? { token_id: `${(args.skill as any).id}:${(args.skill as any).version}` }
              : {},
        };
      },
    };
    return { c, calls };
  };

  const oneOnOne: RecordMatchInput = {
    matchId: 'mat_0',
    mapId: 'copper-hollow',
    ranked: false,
    sideA: { player: 'acc_a', crew: [{ id: 'a1', tier: 'standard' }], delivered: 2 },
    sideB: { player: 'acc_b', crew: [{ id: 'b1', tier: 'standard' }], delivered: 1 },
    result: 'A',
    decidedBy: 'score',
    ticks: 150,
    logSha256: 'e'.repeat(64),
    eloDeltas: [],
  };

  it('NoopRegistry records local (never onchain) with a fake hash', async () => {
    const r = new NoopRegistry();
    const res = await r.recordMatch(oneOnOne);
    expect(res.status).toBe('local');
    expect(res.txHash).toMatch(/^noop:[0-9a-f]{44}$/);
    expect(r.matches).toEqual([oneOnOne]);
  });

  it('NearRegistry sends contract-shaped args', async () => {
    const { c, calls } = caller();
    const reg = new NearRegistry(c, 'registry.playskirm.testnet');
    const match: RecordMatchInput = {
      matchId: 'mat_1',
      mapId: 'copper-hollow',
      ranked: true,
      sideA: {
        player: 'acc_a',
        crew: [
          { id: 'a1', tier: 'quiet' },
          { id: 'a2', tier: 'open' },
          { id: 'a3', tier: 'standard' },
        ],
        delivered: 3,
      },
      sideB: { player: 'acc_b', crew: [{ id: 'b1', tier: 'standard' }], delivered: 1 },
      result: 'B',
      decidedBy: 'score',
      ticks: 150,
      logSha256: 'e'.repeat(64),
      eloDeltas: [
        { team: 'A', delta: -16 },
        { team: 'B', delta: 16 },
      ],
    };
    expect(await reg.recordMatch({ ...match, seasonId: 4 })).toEqual({
      status: 'recorded',
      txHash: 'HASH1',
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      contractId: 'registry.playskirm.testnet',
      methodName: 'record_match',
      args: {
        match_id: 'mat_1',
        season_id: 4,
        map_id: 'copper-hollow',
        ranked: true,
        side_a: {
          player: 'acc_a',
          agents: ['a1', 'a2', 'a3'],
          tiers: ['quiet', 'open', 'standard'],
          delivered: 3,
        },
        side_b: { player: 'acc_b', agents: ['b1'], tiers: ['standard'], delivered: 1 },
        result: 'B',
        decided_by: 'score',
        // Two agents fewer: 5 ticks each.
        head_start_ticks: 10,
        ticks: 150,
        log_sha256: 'e'.repeat(64),
        elo_changes: [
          { player: 'acc_a', delta: -16 },
          { player: 'acc_b', delta: 16 },
        ],
      },
    });
  });

  it('recordMatchArgs: no season is null; unranked and void matches carry no Elo', () => {
    const base: RecordMatchInput = {
      matchId: 'mat_2',
      mapId: 'copper-hollow',
      ranked: true,
      sideA: { player: 'acc_a', crew: [{ id: 'a1', tier: 'standard' }], delivered: 0 },
      sideB: { player: 'acc_b', crew: [{ id: 'b1', tier: 'standard' }], delivered: 0 },
      result: 'draw',
      decidedBy: 'draw',
      ticks: 150,
      logSha256: 'f'.repeat(64),
      eloDeltas: [
        { team: 'B', delta: 2 },
        { team: 'A', delta: -2 },
      ],
    };
    expect(recordMatchArgs(base)).toMatchObject({
      season_id: null,
      head_start_ticks: 0,
      decided_by: 'draw',
      elo_changes: [
        { player: 'acc_b', delta: 2 },
        { player: 'acc_a', delta: -2 },
      ],
    });
    expect(recordMatchArgs({ ...base, ranked: false })).toMatchObject({
      ranked: false,
      elo_changes: [],
    });
    expect(recordMatchArgs({ ...base, result: 'void', decidedBy: 'goal' })).toMatchObject({
      result: 'void',
      decided_by: null,
      elo_changes: [],
    });
  });

  it('minter: noop pending, near nft_mint', async () => {
    const skill = {
      id: 'skl_01JB7Z3K9QX4M2T8V6N5R1C0DE',
      version: 2,
      name: 'Flood Warden',
      summary: null,
      creator: 'ana.testnet',
      royaltyBps: 500,
      requiresActions: ['place_block' as const],
      handlesTags: ['spreads' as const],
      promptSha256: 'a'.repeat(64),
      createdAt: '2026-11-03T08:15:00.123Z',
    };
    expect(await new NoopMinter().mint(skill)).toEqual({
      tokenId: 'skl_01JB7Z3K9QX4M2T8V6N5R1C0DE:2',
      status: 'pending',
    });
    const { c, calls } = caller();
    expect(await new NearMinter(c, 'skills.playskirm.testnet').mint(skill)).toEqual({
      tokenId: 'skl_01JB7Z3K9QX4M2T8V6N5R1C0DE:2',
      status: 'minted',
      txHash: 'HASH1',
    });
    expect(calls[0]!.args.skill).toMatchObject({
      royalty_bps: 500,
      created_at: '2026-11-03T08:15:00Z',
      creator: 'ana.testnet',
    });
  });

  it('createNearAdapters picks Noop without ops keys and Near with them', () => {
    const noop = createNearAdapters(loadConfig({}));
    expect([noop.registry.kind, noop.minter.kind, noop.ownership.kind]).toEqual([
      'noop',
      'noop',
      'noop',
    ]);
    const { c } = caller();
    const near = createNearAdapters(loadConfig({}), { caller: c });
    expect([near.registry.kind, near.minter.kind, near.ownership.kind]).toEqual([
      'near',
      'near',
      'near',
    ]);
    const real = createNearAdapters(
      loadConfig({
        NEAR_OPS_ACCOUNT: 'ops.playskirm.testnet',
        NEAR_OPS_KEY: `ed25519:${'3'.repeat(88)}`,
      }),
    );
    expect(real.registry.kind).toBe('near');
  });
});

describe('ownership', () => {
  it('reads nft_token and refreshes the owner cache', async () => {
    const { fetch } = rpcFetch((_url, body) => {
      expect(body.params.method_name).toBe('nft_token');
      const args = JSON.parse(Buffer.from(body.params.args_base64, 'base64').toString());
      const value =
        args.token_id === 'skl_X:1' ? { token_id: 'skl_X:1', owner_id: 'ben.testnet' } : null;
      return { body: { result: { result: [...Buffer.from(JSON.stringify(value))], logs: [] } } };
    });
    const reader = new NearOwnershipReader(
      new NearRpc(['https://rpc.example'], { fetch }),
      'skills.playskirm.testnet',
    );
    expect(await reader.ownerOf('skl_X:1')).toBe('ben.testnet');
    expect(await reader.ownerOf('skl_Y:1')).toBeNull();

    const set: unknown[] = [];
    const repos = {
      accounts: {
        byNearAccount: async (n: string) => (n === 'ben.testnet' ? { id: 'acc_ben' } : undefined),
      },
      skills: { setTokenOwner: async (...a: unknown[]) => void set.push(a) },
    };
    expect(await refreshOwner(reader, repos, 'skl_X:1')).toBe('ben.testnet');
    expect(await refreshOwner(reader, repos, 'skl_Y:1')).toBeUndefined();
    expect(await refreshOwner(new NoopOwnershipReader(), repos, 'skl_X:1')).toBeUndefined();
    expect(set).toEqual([['skl_X:1', 'acc_ben', 'ben.testnet']]);
  });
});

describe('ops signer', () => {
  const ok = { status: { SuccessValue: '' }, transaction: { hash: TX } };
  const nonceError = () => Object.assign(new Error('Invalid nonce'), { name: 'InvalidNonceError' });

  it('sends one transaction at a time', async () => {
    let inFlight = 0;
    let most = 0;
    const order: string[] = [];
    const account = {
      callFunctionRaw: async ({ methodName }: { methodName: string }) => {
        inFlight++;
        most = Math.max(most, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        order.push(methodName);
        inFlight--;
        return ok;
      },
    };
    const caller = new OpsFunctionCaller(account as never);
    await Promise.all([
      caller.call('seasons.near', 'open_season', {}),
      caller.call('skills.near', 'nft_mint', {}),
      caller.call('registry.near', 'record_match', {}),
    ]);
    expect(most).toBe(1);
    expect(order).toEqual(['open_season', 'nft_mint', 'record_match']);
  });

  it('keeps the queue going after a failed call', async () => {
    let n = 0;
    const account = {
      callFunctionRaw: async () => {
        if (n++ === 0) throw new Error('boom');
        return ok;
      },
    };
    const caller = new OpsFunctionCaller(account as never);
    const [first, second] = await Promise.allSettled([
      caller.call('skills.near', 'nft_mint', {}),
      caller.call('skills.near', 'nft_mint', {}),
    ]);
    expect(first.status).toBe('rejected');
    expect(second).toEqual({ status: 'fulfilled', value: { txHash: TX } });
  });

  it('resends after a nonce clash', async () => {
    let n = 0;
    const account = {
      callFunctionRaw: async () => {
        if (n++ === 0) throw nonceError();
        return ok;
      },
    };
    await expect(
      new OpsFunctionCaller(account as never).call('skills.near', 'nft_mint', {}),
    ).resolves.toEqual({
      txHash: TX,
    });
    expect(n).toBe(2);
  });

  it('gives up after repeated nonce clashes', async () => {
    let n = 0;
    const account = {
      callFunctionRaw: async () => {
        n++;
        throw nonceError();
      },
    };
    await expect(
      new OpsFunctionCaller(account as never).call('skills.near', 'nft_mint', {}),
    ).rejects.toThrow('nft_mint on skills.near failed (InvalidNonceError)');
    expect(n).toBe(3);
  });

  it('does not resend other errors', async () => {
    let n = 0;
    const account = {
      callFunctionRaw: async () => {
        n++;
        throw Object.assign(new Error('x'), { name: 'NotEnoughBalanceError' });
      },
    };
    await expect(
      new OpsFunctionCaller(account as never).call('skills.near', 'nft_mint', {}),
    ).rejects.toThrow('(NotEnoughBalanceError)');
    expect(n).toBe(1);
  });
});
