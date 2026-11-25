// The benchmark seeds badge steps and the on-chain verify, with the chain faked.
import { PRACTICE_MAPS } from '@skirm/engine/v2';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/zama/config', () => ({
  zamaConfig: { enabled: true, chainId: 11155111, rpcUrl: 'http://127.0.0.1:1', explorerUrl: 'https://sepolia.etherscan.io', contracts: { benchmarks: null } },
}));

import { badgeSteps } from './badge';
import { benchmarkContract, benchmarkSkillRef, explorerLink, verifyBenchmarkOnChain } from './benchmarks';
import { fixture } from './testFixtures';

const SHA = 'ab'.repeat(32);

describe('badgeSteps', () => {
  it('lights the steps as the seed moves on', () => {
    expect(badgeSteps('committed')).toEqual({ drawn: 'done', sealed: 'current', revealed: 'pending' });
    expect(badgeSteps('published')).toEqual({ drawn: 'done', sealed: 'done', revealed: 'current' });
    expect(badgeSteps('revealed')).toEqual({ drawn: 'done', sealed: 'done', revealed: 'done' });
    expect(badgeSteps(null)).toEqual({ drawn: 'pending', sealed: 'pending', revealed: 'pending' });
  });
});

describe('verifyBenchmarkOnChain', () => {
  it('reads the record by the skill reference it computes, and verifies the played picks', async () => {
    const { onchain, chain } = fixture();
    const read = vi.fn(async () => chain);
    const r = await verifyBenchmarkOnChain({ read }, { skillId: 'skl_x', version: 2, onchain, promptSha256: SHA, score: 0.5 });
    expect(read).toHaveBeenCalledWith(benchmarkSkillRef('skl_x', 2));
    expect(r.ok).toBe(true);
    expect(r.checks.every((c) => c.ok)).toBe(true);
  });

  it('catches an api that reports other matches than the seed deals', async () => {
    const { onchain, chain } = fixture();
    const played = onchain.played.map((m, i) => (i === 0 ? { ...m, mapId: m.mapId === PRACTICE_MAPS[0] ? PRACTICE_MAPS[1]! : PRACTICE_MAPS[0]! } : m));
    const r = await verifyBenchmarkOnChain({ read: async () => chain }, { skillId: 'skl_x', version: 2, onchain: { ...onchain, played }, promptSha256: SHA, score: 0.5 });
    expect(r.ok).toBe(false);
    expect(r.checks.find((c) => c.name === 'picks')!.ok).toBe(false);
  });

  it('prefers the configured contract, and links txs or the contract', () => {
    expect(benchmarkContract({ contract: '0xabc' })).toBe('0xabc');
    expect(explorerLink('0xt', '0xc')).toBe('https://sepolia.etherscan.io/tx/0xt');
    expect(explorerLink(null, '0xc')).toBe('https://sepolia.etherscan.io/address/0xc');
  });
});
