import { describe, expect, it, vi } from 'vitest';
import { screenOf } from '@/lib/routes';
import { NOTES, notesFor, notesStore } from './notes';

describe('notes', () => {
  it('maps each route screen onto the prototype screen it shows', () => {
    const at = (path: string) => notesFor(screenOf(path)?.key).title;
    expect(at('/play')).toBe('Command deck');
    expect(at('/maps')).toBe('Map atlas');
    expect(at('/maps/copper-hollow/crew')).toBe('Lock in');
    expect(at('/agents/agt_1')).toBe('Agent editor');
    expect(at('/pvp')).toBe('Skirmish');
    expect(at('/leaderboards')).toBe('Skirmish');
    expect(at('/matches/m_1')).toBe('Live match');
    expect(at('/matches/m_1/result')).toBe('Debrief');
    expect(at('/market/skl_1')).toBe('Exchange');
  });

  it('falls back to the Command deck card for screens the prototype has no note for', () => {
    expect(notesFor(screenOf('/account/credits')?.key)).toBe(NOTES.lobby);
    expect(notesFor(null)).toBe(NOTES.lobby);
  });

  it('toggles and notifies subscribers only on a change', () => {
    const l = vi.fn();
    const off = notesStore.subscribe(l);
    notesStore.toggle();
    expect(notesStore.get()).toBe(true);
    notesStore.set(true);
    expect(l).toHaveBeenCalledTimes(1);
    notesStore.toggle();
    expect(notesStore.get()).toBe(false);
    expect(l).toHaveBeenCalledTimes(2);
    off();
  });
});
