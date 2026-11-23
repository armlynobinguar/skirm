import { encodeLoadout, type SealedRosterAgent } from '@skirm/shared';
import { describe, expect, it } from 'vitest';
import {
  SealedMatchError,
  createSealedMatchReader,
  revealedCrew,
  sealedMatchKey,
  zamaServerConfig,
  type SealedMatchState,
} from '../src/zama/sealed-match';

const ALICE = '0x00000000000000000000000000000000000a11ce';
const BOB = '0x0000000000000000000000000000000000000b0b';
const roster: SealedRosterAgent[] = [
  { id: 'agent-2', skills: [{ id: 'sk-a' }, { id: 'sk-b' }] },
  { id: 'agent-1', skills: [] },
];

const revealed = (): SealedMatchState => ({
  status: 'revealed',
  players: [ALICE, BOB],
  locked: [true, true],
  revealed: [
    encodeLoadout([{ agentId: 'agent-2', tier: 'open', skillIds: ['sk-b'] }, { agentId: 'agent-1', tier: 'quiet' }], roster),
    encodeLoadout([{ agentId: 'agent-1', tier: 'standard' }], roster),
  ],
});

describe('zamaServerConfig', () => {
  it('is off unless ZAMA_ENABLED is set, and reads the RPC and address overrides', () => {
    expect(zamaServerConfig({}).enabled).toBe(false);
    const cfg = zamaServerConfig({ ZAMA_ENABLED: 'true', SEPOLIA_RPC_URL: 'https://rpc.example', ZAMA_MATCH_ADDRESS: BOB });
    expect(cfg).toEqual({ enabled: true, rpcUrl: 'https://rpc.example', matchAddress: BOB });
  });

  it('ignores a malformed address override', () => {
    expect(zamaServerConfig({ ZAMA_MATCH_ADDRESS: 'nope' }).matchAddress).not.toBe('nope');
  });

  it('builds no reader when off or not deployed', () => {
    expect(createSealedMatchReader({ enabled: false, rpcUrl: 'http://x', matchAddress: BOB })).toBeNull();
    expect(createSealedMatchReader({ enabled: true, rpcUrl: 'http://x', matchAddress: null })).toBeNull();
    expect(createSealedMatchReader({ enabled: true, rpcUrl: 'http://x', matchAddress: BOB })).not.toBeNull();
  });
});

describe('sealedMatchKey', () => {
  it('is keccak256 of the UTF-8 id', () => {
    // keccak256("") is the well-known empty hash.
    expect(sealedMatchKey('')).toBe('0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470');
    expect(sealedMatchKey('m1')).toMatch(/^0x[0-9a-f]{64}$/);
    expect(sealedMatchKey('m1')).not.toBe(sealedMatchKey('m2'));
  });
});

describe('revealedCrew', () => {
  it('decodes each side against its roster', () => {
    expect(revealedCrew(revealed(), 'A', ALICE.toUpperCase().replace('0X', '0x'), roster)).toEqual([
      { agentId: 'agent-2', tier: 'open', skillIds: ['sk-b'] },
      { agentId: 'agent-1', tier: 'quiet', skillIds: [] },
    ]);
    expect(revealedCrew(revealed(), 'B', BOB, roster)).toEqual([{ agentId: 'agent-1', tier: 'standard', skillIds: [] }]);
  });

  it('refuses a match that is not revealed', () => {
    const s = { ...revealed(), status: 'locked' as const, revealed: null };
    expect(() => revealedCrew(s, 'A', ALICE, roster)).toThrow(expect.objectContaining({ code: 'not_revealed' }));
  });

  it('refuses a seat sealed by another address', () => {
    expect(() => revealedCrew(revealed(), 'A', BOB, roster)).toThrow(expect.objectContaining({ code: 'wrong_player' }));
  });

  it('refuses plaintexts that do not fit the roster', () => {
    const s = revealed();
    s.revealed![1] = { agents: [9, 0, 0], skills: [0, 0, 0], tiers: [1, 0, 0] };
    expect(() => revealedCrew(s, 'B', BOB, roster)).toThrow(SealedMatchError);
    expect(() => revealedCrew(s, 'B', BOB, roster)).toThrow(expect.objectContaining({ code: 'invalid_loadout' }));
  });
});
