import { describe, expect, it } from 'vitest';
import { YOCTO_PER_NEAR, backerEntitled, backingCap, capProgress, splitRoyalty } from '../src/index';

const N = YOCTO_PER_NEAR;

describe('writer backing arithmetic (contracts/backing)', () => {
  it('cap is the raise times the multiple', () => {
    expect(backingCap(4n * N, 20_000)).toBe(8n * N);
    expect(backingCap(3n, 15_000)).toBe(4n);
  });

  it('splits a royalty at the share until the cap, the rest to the writer', () => {
    const round = { shareBps: 2_000, capMultipleBps: 20_000, raised: 4n * N, earned: 0n };
    expect(splitRoyalty(5n * N, round)).toEqual({ toBackers: 1n * N, toWriter: 4n * N });
    // 7.5 NEAR earned: only 0.5 NEAR of room left.
    expect(splitRoyalty(5n * N, { ...round, earned: 75n * N / 10n })).toEqual({ toBackers: N / 2n, toWriter: 45n * N / 10n });
    expect(splitRoyalty(5n * N, { ...round, earned: 8n * N })).toEqual({ toBackers: 0n, toWriter: 5n * N });
    expect(splitRoyalty(0n, round)).toEqual({ toBackers: 0n, toWriter: 0n });
  });

  it('every backer earns the same fraction of their stake', () => {
    const raised = 4n * N;
    const earned = 1n * N;
    expect(backerEntitled(3n * N, earned, raised)).toBe(75n * N / 100n);
    expect(backerEntitled(1n * N, earned, raised)).toBe(25n * N / 100n);
    expect(backerEntitled(1n, 1n, 0n)).toBe(0n);
  });

  it('reports progress towards the cap', () => {
    expect(capProgress(2n * N, 4n * N, 20_000)).toBe(0.25);
    expect(capProgress(8n * N, 4n * N, 20_000)).toBe(1);
    expect(capProgress(0n, 0n, 20_000)).toBe(0);
  });
});
