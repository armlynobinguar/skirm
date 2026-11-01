import { describe, expect, it } from 'vitest';
import {
  NearCallError,
  NearSeasons,
  NoopSeasons,
  createNearAdapters,
  loadConfig,
  type FunctionCaller,
} from '../src/index';

const START = Date.UTC(2026, 10, 1);
const END = START + 14 * 86_400_000;

function fakeCaller(fail?: string) {
  const calls: {
    contractId: string;
    methodName: string;
    args: Record<string, unknown>;
    gasTgas?: number;
  }[] = [];
  const caller: FunctionCaller = {
    async call(contractId, methodName, args, gasTgas) {
      calls.push({ contractId, methodName, args, gasTgas });
      if (methodName === fail) throw new NearCallError(`${methodName} failed onchain`, 'BADTX');
      return { txHash: `TX_${methodName}`, value: {} };
    },
  };
  return { caller, calls };
}

function fakeRpc(result: unknown) {
  const views: { contractId: string; methodName: string; args: unknown }[] = [];
  return {
    views,
    rpc: {
      async view<T>(contractId: string, methodName: string, args: unknown = {}) {
        views.push({ contractId, methodName, args });
        return result as T | undefined;
      },
    },
  };
}

const rawSeason = {
  id: 3,
  name: 'Season 3',
  starts_at_ms: START,
  ends_at_ms: END,
  status: 'locked',
  pool: '10000000000000000000000000',
  standings: [
    {
      rank: 1,
      player: 'acc_ana',
      near: 'ana.testnet',
      points: 75,
      share: '3000000000000000000000000',
      claimed: true,
    },
    { rank: 2, player: 'acc_guest', near: null, points: 50, share: '0', claimed: false },
  ],
  standings_posted: true,
  paid_total: '3000000000000000000000000',
};

describe('NearSeasons', () => {
  it('sends each lifecycle call to the seasons contract with snake_case args', async () => {
    const { caller, calls } = fakeCaller();
    const seasons = new NearSeasons(caller, fakeRpc(null).rpc, 'seasons.playskirm.testnet');
    expect(seasons.kind).toBe('near');

    await expect(
      seasons.openSeason({ id: 3, name: 'Season 3', startsAtMs: START, endsAtMs: END }),
    ).resolves.toEqual({ status: 'recorded', txHash: 'TX_open_season' });
    await seasons.lockSeason(3);
    await expect(
      seasons.postStandings(3, [
        { player: 'acc_ana', near: 'ana.testnet', points: 75 },
        { player: 'acc_guest', points: 49.6 },
      ]),
    ).resolves.toEqual({ status: 'recorded', txHash: 'TX_post_standings' });
    await seasons.closeSeason(3);

    expect(calls).toEqual([
      {
        contractId: 'seasons.playskirm.testnet',
        methodName: 'open_season',
        args: { id: 3, name: 'Season 3', starts_at_ms: START, ends_at_ms: END },
        gasTgas: undefined,
      },
      {
        contractId: 'seasons.playskirm.testnet',
        methodName: 'lock_season',
        args: { id: 3 },
        gasTgas: undefined,
      },
      {
        contractId: 'seasons.playskirm.testnet',
        methodName: 'post_standings',
        args: {
          id: 3,
          standings: [
            { player: 'acc_ana', near: 'ana.testnet', points: 75 },
            { player: 'acc_guest', near: null, points: 50 },
          ],
        },
        gasTgas: undefined,
      },
      {
        contractId: 'seasons.playskirm.testnet',
        methodName: 'close_season',
        args: { id: 3 },
        gasTgas: undefined,
      },
    ]);
  });

  it('throws when the call fails so the job retries', async () => {
    const { caller } = fakeCaller('lock_season');
    const seasons = new NearSeasons(caller, fakeRpc(null).rpc, 'seasons.playskirm.testnet');
    await expect(seasons.lockSeason(3)).rejects.toBeInstanceOf(NearCallError);
  });

  it('reads get_season through RPC and maps it to camelCase', async () => {
    const { caller, calls } = fakeCaller();
    const { rpc, views } = fakeRpc(rawSeason);
    const season = await new NearSeasons(caller, rpc, 'seasons.playskirm.testnet').getSeason(3);
    expect(views).toEqual([
      { contractId: 'seasons.playskirm.testnet', methodName: 'get_season', args: { id: 3 } },
    ]);
    expect(calls).toEqual([]);
    expect(season).toEqual({
      id: 3,
      name: 'Season 3',
      startsAtMs: START,
      endsAtMs: END,
      status: 'locked',
      pool: '10000000000000000000000000',
      standings: [
        {
          rank: 1,
          player: 'acc_ana',
          near: 'ana.testnet',
          points: 75,
          share: '3000000000000000000000000',
          claimed: true,
        },
        { rank: 2, player: 'acc_guest', near: null, points: 50, share: '0', claimed: false },
      ],
      standingsPosted: true,
      paidTotal: '3000000000000000000000000',
    });
  });

  it('returns null for a season the contract does not have', async () => {
    const { caller } = fakeCaller();
    for (const missing of [null, undefined]) {
      const seasons = new NearSeasons(caller, fakeRpc(missing).rpc, 'seasons.playskirm.testnet');
      await expect(seasons.getSeason(9)).resolves.toBeNull();
    }
  });
});

describe('NoopSeasons', () => {
  it('records the calls locally with a fake hash and knows no chain state', async () => {
    const seasons = new NoopSeasons();
    expect(seasons.kind).toBe('noop');
    const opened = await seasons.openSeason({
      id: 1,
      name: 'Season 1',
      startsAtMs: START,
      endsAtMs: END,
    });
    expect(opened.status).toBe('local');
    expect(opened.txHash).toMatch(/^noop:[0-9a-f]{44}$/);
    await seasons.lockSeason(1);
    await seasons.postStandings(1, [{ player: 'acc_ana', near: 'ana.testnet', points: 25 }]);
    await seasons.closeSeason(1);
    expect(seasons.calls.map((c) => c.method)).toEqual([
      'open_season',
      'lock_season',
      'post_standings',
      'close_season',
    ]);
    expect(seasons.calls[2]!.args).toEqual({
      id: 1,
      standings: [{ player: 'acc_ana', near: 'ana.testnet', points: 25 }],
    });
    await expect(seasons.getSeason()).resolves.toBeUndefined();
  });
});

describe('createNearAdapters seasons', () => {
  it('is noop without ops keys and near on NEAR_CONTRACT_SEASONS with them', async () => {
    expect(createNearAdapters(loadConfig({})).seasons.kind).toBe('noop');
    const { caller, calls } = fakeCaller();
    const near = createNearAdapters(
      loadConfig({ NEAR_CONTRACT_SEASONS: 'seasons.skirm-staging.testnet' }),
      { caller },
    );
    expect(near.seasons.kind).toBe('near');
    await near.seasons.closeSeason(2);
    expect(calls[0]!.contractId).toBe('seasons.skirm-staging.testnet');
  });
});
