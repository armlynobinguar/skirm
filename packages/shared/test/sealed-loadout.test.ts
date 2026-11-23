import { describe, expect, it } from 'vitest';
import {
  SealedLoadoutError,
  decodeLoadout,
  encodeLoadout,
  loadoutFromValues,
  loadoutValues,
  sealedRoster,
  type SealedRosterAgent,
} from '../src/sealed-loadout';

// Listed out of id order on purpose: the index follows the id sort, not the list order.
const roster: SealedRosterAgent[] = [
  { id: 'c-agent', skills: [{ id: 's1' }, { id: 's2' }, { id: 's3' }] },
  { id: 'a-agent', skills: [{ id: 's4' }] },
  { id: 'b-agent', skills: [] },
];

describe('sealedRoster', () => {
  it('sorts by agent id without touching the input', () => {
    expect(sealedRoster(roster).map((a) => a.id)).toEqual(['a-agent', 'b-agent', 'c-agent']);
    expect(roster[0]!.id).toBe('c-agent');
  });
});

describe('encodeLoadout', () => {
  it('encodes roster indexes (1-based, by id), skill masks and tiers in crew order', () => {
    const enc = encodeLoadout(
      [
        { agentId: 'c-agent', tier: 'open', skillIds: ['s1', 's3'] },
        { agentId: 'a-agent', tier: 'quiet' },
      ],
      roster,
    );
    expect(enc).toEqual({ agents: [3, 1, 0], skills: [0b101, 0b1, 0], tiers: [2, 0, 0] });
    expect(loadoutValues(enc)).toEqual([3, 1, 0, 0b101, 0b1, 0, 2, 0, 0]);
  });

  it('defaults to every equipped skill and allows an agent with none', () => {
    expect(encodeLoadout([{ agentId: 'c-agent', tier: 'standard' }, { agentId: 'b-agent', tier: 'standard' }], roster)).toEqual({
      agents: [3, 2, 0],
      skills: [0b111, 0, 0],
      tiers: [1, 1, 0],
    });
  });

  it('refuses an empty or oversized crew, unknown agents, duplicates, skills and tiers', () => {
    expect(() => encodeLoadout([], roster)).toThrow(SealedLoadoutError);
    const four = ['a-agent', 'b-agent', 'c-agent', 'a-agent'].map((agentId) => ({ agentId, tier: 'standard' as const }));
    expect(() => encodeLoadout(four, roster)).toThrow(/1 to 3/);
    expect(() => encodeLoadout([{ agentId: 'zzz', tier: 'standard' }], roster)).toThrow(/not in the roster/);
    expect(() => encodeLoadout([{ agentId: 'a-agent', tier: 'standard' }, { agentId: 'a-agent', tier: 'open' }], roster)).toThrow(/twice/);
    expect(() => encodeLoadout([{ agentId: 'a-agent', tier: 'standard', skillIds: ['s1'] }], roster)).toThrow(/not equipped/);
    expect(() => encodeLoadout([{ agentId: 'a-agent', tier: 'loud' as never }], roster)).toThrow(/talk tier/);
  });
});

describe('decodeLoadout', () => {
  it('round-trips encodeLoadout', () => {
    const picks = [
      { agentId: 'b-agent', tier: 'quiet' as const },
      { agentId: 'c-agent', tier: 'open' as const, skillIds: ['s2'] },
      { agentId: 'a-agent', tier: 'standard' as const },
    ];
    expect(decodeLoadout(encodeLoadout(picks, roster), roster)).toEqual([
      { agentId: 'b-agent', tier: 'quiet', skillIds: [] },
      { agentId: 'c-agent', tier: 'open', skillIds: ['s2'] },
      { agentId: 'a-agent', tier: 'standard', skillIds: ['s4'] },
    ]);
  });

  it('decodes from the contract value order', () => {
    expect(decodeLoadout(loadoutFromValues([1n, 0n, 0n, 1n, 0n, 0n, 2n, 0n, 0n]), roster)).toEqual([
      { agentId: 'a-agent', tier: 'open', skillIds: ['s4'] },
    ]);
  });

  const bad = (agents: number[], skills: number[], tiers: number[]) =>
    decodeLoadout({ agents: agents as never, skills: skills as never, tiers: tiers as never }, roster);

  it('refuses plaintexts the contract could not check', () => {
    expect(() => bad([0, 0, 0], [0, 0, 0], [0, 0, 0])).toThrow(/at least one/);
    expect(() => bad([4, 0, 0], [0, 0, 0], [1, 0, 0])).toThrow(/out of range/);
    expect(() => bad([1, 1, 0], [0, 0, 0], [1, 1, 0])).toThrow(/twice/);
    expect(() => bad([0, 1, 0], [0, 0, 0], [0, 1, 0])).toThrow(/after an empty slot/);
    expect(() => bad([1, 0, 0], [0, 0, 0], [3, 0, 0])).toThrow(/talk tier/);
    expect(() => bad([1, 0, 0], [0b10, 0, 0], [1, 0, 0])).toThrow(/does not equip/);
    expect(() => bad([1, 0, 0], [0, 0, 0], [1.5, 0, 0])).toThrow(/uint8/);
  });

  it('loadoutFromValues wants exactly nine values', () => {
    expect(() => loadoutFromValues([1, 2, 3])).toThrow(SealedLoadoutError);
  });
});
