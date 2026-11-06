// The new roles on the HUD: callouts for a Medic's tend, a planted and a sprung decoy, and carry slots.
import { carryOf } from '@skirm/engine/v2';
import { describe, expect, it } from 'vitest';
import { v2FrameFixture } from '@/test/fixtures';
import { calloutOf, slotsOf } from './model';

describe('new roles on the HUD', () => {
  it('calls out a tend, a planted decoy (own crew) and a sprung one', () => {
    const f = v2FrameFixture();
    const [a, b] = f.agents;
    expect(calloutOf({ ...f, events: [{ kind: 'tended', agent: a!.id, target: a!.id, was: 'stunned' }] }, a!.team)).toEqual({ text: `${a!.name} tended ${a!.name} · stun cleared`, side: 'you' });
    const planted = calloutOf({ ...f, events: [{ kind: 'planted', agent: a!.id, at: [3, 3] }] }, a!.team);
    expect(planted?.text).toMatch(new RegExp(`^${a!.name} planted a decoy `));
    const rival = b && b.team !== a!.team ? b : a!;
    const sprung = calloutOf({ ...f, events: [{ kind: 'decoy_sprung', agent: rival.id, team: a!.team, at: [3, 3] }] }, a!.team);
    expect(sprung).toMatchObject({ side: 'you' });
    expect(sprung!.text).toContain('grabbed a decoy');
  });

  it('draws one carry slot for a Courier', () => {
    const f = v2FrameFixture();
    const courier = { ...f.agents[0]!, role: 'Courier' as const };
    expect(slotsOf(courier, carryOf(courier.role), true, f.tick)).toHaveLength(1);
  });
});
