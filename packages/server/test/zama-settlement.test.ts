import { describe, expect, it } from 'vitest';
import { sealedMatchKey } from '../src/zama/sealed-match';
import { ContractMatchSettler, DRAW_SEAT, createMatchSettler, logHashBytes32, winnerSeat, type SettleContract } from '../src/zama/settlement';

const MATCH = '0x00000000000000000000000000000000000000cc';
const KEY = '0x' + '1'.repeat(64);
const HEAD = 'ab'.repeat(32);

/** A SkirmMatch fake: a fixed status, records every settle call. */
function fakeContract(status: number) {
  const calls: { key: string; seat: number; logHash: string }[] = [];
  const contract: SettleContract = {
    async getMatch() {
      return { status: BigInt(status) };
    },
    async settle(key, seat, logHash) {
      calls.push({ key, seat, logHash });
      return { hash: '0xfeed', wait: async () => undefined };
    },
  };
  return { contract, calls };
}

function captureLog() {
  const lines: string[] = [];
  return { lines, log: { warn: (m: string) => void lines.push(m) } };
}

describe('winnerSeat and logHashBytes32', () => {
  it('maps A, B and a draw to the contract seats', () => {
    expect([winnerSeat('A'), winnerSeat('B'), winnerSeat(null)]).toEqual([0, 1, DRAW_SEAT]);
    expect(DRAW_SEAT).toBe(255);
  });

  it('takes the log head with or without 0x, and refuses anything else', () => {
    expect(logHashBytes32(HEAD)).toBe(`0x${HEAD}`);
    expect(logHashBytes32(`0x${HEAD.toUpperCase()}`)).toBe(`0x${HEAD}`);
    expect(() => logHashBytes32('abc')).toThrow();
    expect(() => logHashBytes32('0'.repeat(64))).toThrow();
  });
});

describe('ContractMatchSettler', () => {
  it('settles a revealed match with the seat and the anchored log hash', async () => {
    const { contract, calls } = fakeContract(4);
    const out = await new ContractMatchSettler(contract).settle('m-1', 'B', HEAD);
    expect(out).toEqual({ status: 'settled', txHash: '0xfeed' });
    expect(calls).toEqual([{ key: sealedMatchKey('m-1'), seat: 1, logHash: `0x${HEAD}` }]);
  });

  it('skips a match that is not revealed (never sealed, forfeited, already settled)', async () => {
    for (const [status, name] of [
      [1, 'open'],
      [5, 'forfeited'],
      [7, 'settled'],
    ] as const) {
      const { contract, calls } = fakeContract(status);
      expect(await new ContractMatchSettler(contract).settle('m-1', null, HEAD)).toEqual({ status: 'skipped', reason: `match is ${name} on chain` });
      expect(calls).toEqual([]);
    }
  });
});

describe('createMatchSettler', () => {
  const on = { ZAMA_ENABLED: 'true', ZAMA_MATCH_ADDRESS: MATCH };

  it('is null while the feature is off, without a word', () => {
    const { lines, log } = captureLog();
    expect(createMatchSettler({ ZAMA_OPERATOR_PRIVATE_KEY: KEY }, log)).toBeNull();
    expect(lines).toEqual([]);
  });

  it('warns and stays null without an operator key', () => {
    const { lines, log } = captureLog();
    expect(createMatchSettler(on, log)).toBeNull();
    expect(lines).toEqual([expect.stringContaining('ZAMA_OPERATOR_PRIVATE_KEY is not set')]);
  });

  it('refuses a malformed key without logging it', () => {
    const { lines, log } = captureLog();
    const bad = 'not-a-key-secret-material';
    expect(createMatchSettler({ ...on, ZAMA_OPERATOR_PRIVATE_KEY: bad }, log)).toBeNull();
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain(bad);
  });

  it('builds a settler from a valid key and logs nothing', () => {
    const { lines, log } = captureLog();
    expect(createMatchSettler({ ...on, ZAMA_OPERATOR_PRIVATE_KEY: KEY }, log)).toBeInstanceOf(ContractMatchSettler);
    expect(lines).toEqual([]);
  });
});
