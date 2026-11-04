// Live commands in the engine: the presets and the order text, where "go for the drop" points, and
// how a command enters the hash-chained log (a tick without one hashes as it always did).
import { describe, expect, it } from 'vitest';
import {
  COMMAND_PRESETS,
  COMMAND_PRESET_IDS,
  appendTick,
  commandLabel,
  commandOrder,
  createMatch,
  dropTargets,
  isCommandPreset,
  startLog,
  stepMatch,
  verifyLog,
  type AgentSpec,
  type LogHeader,
  type MapDefV2,
} from '../src/v2';

const agent = (id: string): AgentSpec => ({
  id,
  name: id,
  role: 'Runner',
  vision: 3,
  comms: 3,
  tier: 'standard',
});

function testMap(o: Partial<MapDefV2> = {}): MapDefV2 {
  const rows = [
    '###########',
    '#.........#',
    '#.........#',
    '#....E....#',
    '#.........#',
    '#.........#',
    '###########',
  ];
  return {
    schema: 'skirm.map/v2',
    id: 'test',
    code: 'TS-00',
    name: 'Test',
    region: 'Test',
    difficulty: 1,
    label: 'Test',
    blurb: '',
    item: 'Gem',
    deliverTo: 'Exit',
    goal: 2,
    rows,
    starts: { A: [[1, 1]], B: [[9, 1]] },
    exit: [5, 3],
    verbs: [{ id: 'sandbag', name: 'Sandbag', effect: 'add_solid' }],
    hazards: [],
    switches: [],
    drops: [],
    blockSupply: 2,
    fog: false,
    steal: false,
    night: false,
    ...o,
  };
}

const header: LogHeader = {
  schema: 'skirm.match/v2',
  map: 'test',
  crews: { A: [], B: [] },
  ranked: false,
  models: { planner: 'g', actor: 'g', speech: 'g' },
};

describe('v2 live commands', () => {
  it('has the four presets, and reads an order and a label from a preset and text', () => {
    expect(COMMAND_PRESET_IDS).toEqual(['hold_gate', 'go_drop', 'regroup', 'block_flow']);
    expect(isCommandPreset('regroup')).toBe(true);
    expect(isCommandPreset('toString')).toBe(false);
    expect(isCommandPreset('charge')).toBe(false);
    expect(commandOrder({ preset: 'regroup', text: null })).toBe(COMMAND_PRESETS.regroup.order);
    expect(commandOrder({ preset: 'hold_gate', text: 'watch the west' })).toBe(
      `${COMMAND_PRESETS.hold_gate.order} Your player adds: "watch the west"`,
    );
    expect(commandOrder({ preset: null, text: 'go east' })).toBe('Your player adds: "go east"');
    expect(commandLabel({ preset: 'go_drop', text: 'now' })).toBe('Go for the drop · now');
    expect(commandLabel({ preset: null, text: 'now' })).toBe('now');
  });

  it('points go_drop at a landed supply drop that still holds an item, else the middle items', () => {
    const s = createMatch(testMap({ drops: [{ at: [5, 5], tick: 2 }] }), {
      A: [agent('a')],
      B: [agent('b')],
    });
    // No drop yet and no items on the board.
    expect(dropTargets(s)).toEqual([]);
    stepMatch(s, { actions: {} });
    stepMatch(s, { actions: {} });
    expect(dropTargets(s)).toEqual([[5, 5]]);
  });

  it('logs commands with their tick, verifiably, and leaves ticks without one hashing the same', () => {
    const plain = startLog(header);
    const withNone = startLog(header);
    appendTick(plain, { tick: 1, actions: {}, says: [] });
    appendTick(withNone, { tick: 1, actions: {}, says: [], commands: undefined });
    expect(withNone.hashes).toEqual(plain.hashes);

    const log = startLog(header);
    appendTick(log, {
      tick: 1,
      actions: {},
      says: [],
      commands: [{ team: 'A', agents: ['a'], preset: 'regroup', text: null }],
    });
    expect(log.hashes[1]).not.toBe(plain.hashes[1]);
    expect(verifyLog(log)).toBeNull();
    log.ticks[0]!.commands![0]!.preset = 'hold_gate';
    expect(verifyLog(log)).toBe(1);
  });
});
