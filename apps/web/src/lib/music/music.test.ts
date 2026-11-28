import { describe, expect, it } from 'vitest';
import { moodFor } from '@/components/shell/MusicPlayer';
import { SONGS, arpNote, hz, layers } from './index';

describe('background music', () => {
  it('plays the match loop on match screens and the calm one everywhere else', () => {
    expect(moodFor('/matches/mat_1')).toBe('match');
    expect(moodFor('/matches/mat_1/result')).toBe('match');
    expect(moodFor('/play')).toBe('menu');
    expect(moodFor('/market')).toBe('menu');
  });

  it('is in A minor, faster in a match, and arpeggiates the bar chord', () => {
    expect(hz(69)).toBeCloseTo(440);
    expect(SONGS.match.bpm).toBeGreaterThan(SONGS.menu.bpm);
    const [root, triad] = SONGS.menu.bars[0]!;
    const notes = Array.from({ length: 8 }, (_, i) => arpNote(root, triad, i) % 12);
    expect(new Set(notes)).toEqual(new Set([9, 0, 4])); // A, C, E
  });

  it('has a lead tune for every chord, in A minor (with the G sharp of the major V)', () => {
    const inKey = new Set([9, 11, 0, 2, 4, 5, 7, 8]);
    for (const song of Object.values(SONGS)) {
      expect(song.bars).toHaveLength(8);
      expect(song.lead).toHaveLength(song.bars.length);
      for (const bar of song.lead) {
        for (const [step, midi, len] of bar) {
          expect(inKey.has(midi % 12)).toBe(true);
          expect(step + len).toBeLessThanOrEqual(16);
        }
      }
    }
  });

  it('builds over a 32-bar arrangement instead of one loop', () => {
    expect(layers('menu', 0)).toMatchObject({ pad: true, arp: true, bass: false, lead: false });
    expect(layers('menu', 16)).toMatchObject({ bass: true, lead: true });
    expect(layers('menu', 24)).toMatchObject({ arp: false, lead: true });
    expect(layers('match', 0)).toMatchObject({ kick: true, snare: false, lead: false });
    expect(layers('match', 8)).toMatchObject({ snare: true, hats: true });
    expect(layers('match', 7).fill).toBe(true);
    expect(layers('match', 23).fill).toBe(false); // the hook runs straight into the breakdown
    expect(layers('match', 32)).toEqual(layers('match', 0)); // and around again
  });
});
