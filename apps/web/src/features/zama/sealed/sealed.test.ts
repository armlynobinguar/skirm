import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/zama/config', () => ({
  zamaConfig: { enabled: true, chainId: 11155111, rpcUrl: '', explorerUrl: '', contracts: { credits: null, match: null } },
}));

import { FALLBACK_POLLS, SealError, matchAddress, sealLoadout, sealedMatchKey, sideOf, type ChainMatch, type ChainStatus, type SkirmMatchApi } from './sealed';

const ZERO = `0x${'0'.repeat(40)}`;
const ME = '0x00000000000000000000000000000000000000Aa';
const RIVAL = '0x00000000000000000000000000000000000000bb';
const VALUES = [2, 1, 0, 3, 1, 0, 1, 2, 0];

/** An in-memory SkirmMatch: `rival` scripts what the other client does on each read. */
function fakeChain(init: Partial<ChainMatch> = {}) {
  const m: ChainMatch = { status: 'none', players: [ZERO, ZERO], locked: [false, false], lockDeadline: 0, ...init };
  const calls: string[] = [];
  let reads = 0;
  const hooks: { onRead?: (m: ChainMatch, n: number) => void } = {};
  const api: SkirmMatchApi = {
    read: vi.fn(async () => {
      hooks.onRead?.(m, ++reads);
      return { ...m, players: [...m.players] as [string, string], locked: [...m.locked] as [boolean, boolean] };
    }),
    create: vi.fn(async () => {
      calls.push('create');
      if (m.status !== 'none') throw new Error('MatchExists');
      m.status = 'open';
    }),
    submit: vi.fn(async (_key, side, enc) => {
      calls.push(`submit:${side}:${enc.handles.length}`);
      m.players[side] = ME.toLowerCase();
      m.locked[side] = true;
      if (m.locked[0] && m.locked[1]) m.status = 'locked';
    }),
    reveal: vi.fn(async () => {
      calls.push('reveal');
      if (m.status !== 'locked') throw new Error('WrongStatus');
      m.status = 'revealing';
    }),
    revealHandles: vi.fn(async () => Array.from({ length: 18 }, (_, i) => `0x${String(i).padStart(64, '0')}` as const)),
    finalize: vi.fn(async (_key, clear, proof) => {
      calls.push(`finalize:${clear}:${proof}`);
      m.status = 'revealed';
    }),
  };
  const set = (status: ChainStatus) => (m.status = status);
  return { m, api, calls, hooks, set };
}

function fakeInstance() {
  const added: bigint[] = [];
  return {
    added,
    createEncryptedInput: vi.fn(() => {
      const input = {
        add8: (v: bigint) => (added.push(v), input),
        encrypt: async () => ({ handles: added.map((_, i) => new Uint8Array(32).fill(i + 1)), inputProof: new Uint8Array([0xab]) }),
      };
      return input;
    }),
    publicDecrypt: vi.fn(async (handles: string[]) => ({
      clearValues: Object.fromEntries(handles.map((h) => [h, 0n])),
      abiEncodedClearValues: '0xc1ea' as const,
      decryptionProof: '0x9f00' as const,
    })),
  } as const;
}

const base = (api: SkirmMatchApi, instance: ReturnType<typeof fakeInstance>, team: 'A' | 'B' = 'A') => ({
  api,
  instance: instance as never,
  contract: '0x0000000000000000000000000000000000000001',
  user: ME,
  matchId: 'mat_seal',
  team,
  values: VALUES,
  pollMs: 0,
  sleep: async () => {},
});

describe('sealed helpers', () => {
  it('derives the match key from the off-chain id and maps teams to sides', () => {
    expect(sealedMatchKey('')).toBe('0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470');
    expect(sideOf('A')).toBe(0);
    expect(sideOf('B')).toBe(1);
  });

  it('says when SkirmMatch is not deployed', () => {
    expect(() => matchAddress()).toThrow(/not deployed/);
  });
});

describe('sealLoadout', () => {
  it('creates the match, encrypts nine values under one proof, seals, then reveals and finalizes', async () => {
    const chain = fakeChain();
    // The rival seals while this client waits (the fourth read).
    chain.hooks.onRead = (m, n) => {
      if (n === 4 && !m.locked[1]) {
        m.players[1] = RIVAL;
        m.locked[1] = true;
        if (m.locked[0]) m.status = 'locked';
      }
    };
    const inst = fakeInstance();
    const steps: string[] = [];
    const out = await sealLoadout({ ...base(chain.api, inst), onStep: (s) => steps.push(s) });

    expect(out.status).toBe('revealed');
    expect(inst.added).toEqual(VALUES.map(BigInt));
    expect(inst.createEncryptedInput).toHaveBeenCalledWith('0x0000000000000000000000000000000000000001', ME);
    expect(chain.calls).toEqual(['create', 'submit:0:9', 'reveal', 'finalize:0xc1ea:0x9f00']);
    expect(steps).toEqual(['create', 'encrypt', 'submit', 'waiting', 'reveal', 'finalize', 'revealed']);
  });

  it('joins a match the rival already created and sealed', async () => {
    const chain = fakeChain({ status: 'open', players: [RIVAL, ZERO], locked: [true, false] });
    const inst = fakeInstance();
    await sealLoadout(base(chain.api, inst, 'B'));
    expect(chain.calls[0]).toBe('submit:1:9');
    expect(chain.m.status).toBe('revealed');
  });

  it('lets team A send the reveal; team B waits a few polls before taking over', async () => {
    const chain = fakeChain({ status: 'locked', players: [RIVAL, ME.toLowerCase()], locked: [true, true] });
    await sealLoadout(base(chain.api, fakeInstance(), 'B'));
    expect(chain.api.reveal).toHaveBeenCalledTimes(1);
    // FALLBACK_POLLS idle reads while locked, then its own reveal, then the finalize.
    expect((chain.api.read as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(FALLBACK_POLLS);
  });

  it('refuses a seat held by another address', async () => {
    const chain = fakeChain({ status: 'open', players: [RIVAL, ZERO], locked: [false, false] });
    await expect(sealLoadout(base(chain.api, fakeInstance(), 'A'))).rejects.toMatchObject({ code: 'seat_taken' });
    expect(chain.api.submit).not.toHaveBeenCalled();
  });

  it('stops on a forfeited match and when aborted', async () => {
    const forfeited = fakeChain({ status: 'forfeited', players: [ME.toLowerCase(), ZERO], locked: [true, false] });
    await expect(sealLoadout(base(forfeited.api, fakeInstance()))).rejects.toBeInstanceOf(SealError);

    const waiting = fakeChain({ status: 'open', players: [ME.toLowerCase(), ZERO], locked: [true, false] });
    const ctl = new AbortController();
    waiting.hooks.onRead = (_m, n) => {
      if (n === 3) ctl.abort();
    };
    await expect(sealLoadout({ ...base(waiting.api, fakeInstance()), signal: ctl.signal })).rejects.toMatchObject({ code: 'aborted' });
  });

  it('retries a finalize the relayer is not ready for', async () => {
    const chain = fakeChain({ status: 'revealing', players: [ME.toLowerCase(), RIVAL], locked: [true, true] });
    const inst = fakeInstance();
    inst.publicDecrypt.mockRejectedValueOnce(new Error('not ready'));
    await sealLoadout(base(chain.api, inst));
    expect(inst.publicDecrypt).toHaveBeenCalledTimes(2);
    expect(chain.m.status).toBe('revealed');
  });
});
