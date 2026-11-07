import { describe, expect, it } from 'vitest';
import { moodFor } from '@/components/shell/MusicPlayer';
import { SONGS, arpNote, hz } from './index';

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
});
