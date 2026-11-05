// Every puzzle on the offline brain: a greedy crew (one agent, and the full crew size) must solve
// it within the tick cap, so puzzle mode is playable on the keyless local stack. Runs are
// deterministic: the same crew always scores the same and leaves the same log hash.
import { PUZZLES, botCrew, puzzleById, puzzleMedal, puzzleObjectiveText, type Observation } from '@skirm/engine/v2';
import { describe, expect, it } from 'vitest';
import { INERT_BRAIN, createGreedyBrain, playPuzzle, puzzleBrain, type V2AgentContext, type V2Brain } from '../src/v2';

describe('puzzles on the greedy brain', () => {
  it('solves every puzzle within its cap with one agent and with a full crew', async () => {
    const failed: string[] = [];
    for (const p of PUZZLES)
      for (const size of new Set([1, p.crewSize])) {
        const r = await playPuzzle({ puzzle: p, crew: botCrew(size as 1 | 2 | 3, 'me'), brain: createGreedyBrain() });
        if (!r.solved || r.ticks > p.cap || r.score === null) failed.push(`${p.id} x${size}: ${r.reason} @${r.ticks}`);
        else expect(r.medal).toBe(puzzleMedal(p, r.score));
      }
    expect(failed).toEqual([]);
  }, 120_000);

  it('plays the same run the same way every time', async () => {
    const p = puzzleById('pz-3')!;
    const a = await playPuzzle({ puzzle: p, crew: botCrew(2, 'me'), brain: createGreedyBrain() });
    const b = await playPuzzle({ puzzle: p, crew: botCrew(2, 'me'), brain: createGreedyBrain() });
    expect(a.headless.logHash).toBe(b.headless.logHash);
    expect(a.score).toBe(b.score);
    expect(a.headless.log.result).toMatchObject({ winner: 'A', reason: 'goal' });
  });

  it('never moves the rock crew', async () => {
    const p = puzzleById('pz-6')!;
    const starts = new Map<string, string>();
    await playPuzzle({
      puzzle: p,
      crew: botCrew(3, 'me'),
      brain: createGreedyBrain(),
      onTick: (_ev, s) => {
        for (const a of s.agents.filter((x) => x.team === 'B')) {
          const at = `${a.x},${a.y}`;
          if (!starts.has(a.id)) starts.set(a.id, `${a.start[0]},${a.start[1]}`);
          expect(at).toBe(starts.get(a.id));
        }
      },
    });
    expect(starts.size).toBe(3);
    expect((await INERT_BRAIN.act({} as Observation, { skills: [], plan: null, canSpeak: true })).action).toEqual({ type: 'wait' });
  });

  it('refuses a crew larger than the puzzle takes', async () => {
    const p = PUZZLES.find((x) => x.crewSize === 1)!;
    await expect(playPuzzle({ puzzle: p, crew: botCrew(2, 'me'), brain: createGreedyBrain() })).rejects.toThrow(/takes 1 to 1/);
  });

  it('tells a model brain the objective in every agent’s instructions, ahead of the owner’s own', async () => {
    const p = puzzleById('pz-1')!;
    const seen: (string | null | undefined)[] = [];
    const spy: V2Brain = {
      kind: 'model',
      model: 'test',
      async act(o, ctx: V2AgentContext) {
        seen.push(ctx.instructions);
        return createGreedyBrain().act(o, ctx);
      },
      plan: async () => ({ text: null }),
    };
    expect(puzzleBrain(p, spy)).toBe(spy);
    const crew = botCrew(1, 'me');
    const r = await playPuzzle({ puzzle: p, crew, brain: spy, contexts: { [crew[0]!.id]: { skills: [], instructions: 'Be quick.' } } });
    expect(r.solved).toBe(true);
    expect(seen[0]).toBe(`${puzzleObjectiveText(p)}\n\nBe quick.`);
  });
});
