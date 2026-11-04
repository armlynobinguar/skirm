// Every campaign mission as realtime plays it on the offline brain: the player's crew (greedy, the
// mission's crew size) against the practice bot shaped by the difficulty (practiceRival: size, talk
// tier, late start, bluff cap). Each must clear its objective, so the campaign can be finished on
// the keyless local stack.
import { CAMPAIGN_CHAPTERS, CAMPAIGN_MISSIONS, objectiveMet } from '@skirm/shared';
import { DIFFICULTIES, botCrew, mapV2, practiceRival } from '@skirm/engine/v2';
import { describe, expect, it } from 'vitest';
import { createGreedyBrain, playHeadless } from '../src/v2';

describe('campaign on the greedy brain', () => {
  it('names real maps and difficulties, with unique mission ids', () => {
    const ids = CAMPAIGN_MISSIONS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const m of CAMPAIGN_MISSIONS) {
      const def = mapV2(m.mapId);
      expect(def, m.id).toBeDefined();
      expect(DIFFICULTIES).toContain(m.difficulty);
      expect(m.crewSize).toBeLessThanOrEqual(Math.min(3, def!.starts.A.length, def!.starts.B.length));
    }
    expect(CAMPAIGN_CHAPTERS.length).toBe(3);
  });

  it('clears every mission with a greedy crew against the practice bot', async () => {
    const failed: string[] = [];
    for (const m of CAMPAIGN_MISSIONS) {
      const def = mapV2(m.mapId)!;
      const rival = practiceRival(m.difficulty, m.crewSize, Math.min(3, def.starts.A.length, def.starts.B.length));
      const r = await playHeadless({
        def,
        difficulty: m.difficulty,
        crews: { A: botCrew(m.crewSize, 'p'), B: botCrew(rival.size, 'bot', rival.tier) },
        brains: { A: createGreedyBrain(), B: createGreedyBrain() },
        ...(rival.hold ? { hold: { B: rival.hold } } : {}),
        lieCap: { B: rival.lieCap },
      });
      if (!objectiveMet(m.objective, { winner: r.result.winner, score: r.score, ticks: r.ticks }))
        failed.push(`${m.id} ${m.mapId}/${m.difficulty}: ${r.result.winner} ${r.score.A}-${r.score.B} @${r.ticks} (${r.result.decidedBy})`);
    }
    expect(failed).toEqual([]);
  }, 120_000);
});
