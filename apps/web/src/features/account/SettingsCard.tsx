'use client';
// S16 Settings card (S16-Profile.dc.html "Settings"; UI/UX Spec S16 row, Reduced motion, Tile
// legend "Show tag names"). Edits are a draft over the stored preferences until Save settings;
// usePreferences() keeps them per browser and every open tab follows.
import { Button } from '@skirm/ui';
import { useState, type FormEvent } from 'react';
import { useToast } from '@/components/toast/ToastProvider';
import {
  REPLAY_SPEEDS,
  usePreferences,
  type Preferences,
  type ReplaySpeed,
} from '@/lib/preferences';
import s from './account.module.css';

// The artboard lists 1x first (the default).
const SPEEDS: ReplaySpeed[] = [1, ...REPLAY_SPEEDS.filter((v) => v !== 1)];

const KEYS: (keyof Preferences)[] = ['sfx', 'replaySpeed', 'reducedMotion', 'showProbabilities', 'showTagNames'];

export function SettingsCard() {
  const { prefs, systemReducedMotion, set } = usePreferences();
  const toast = useToast();
  const [draft, setDraft] = useState<Partial<Preferences>>({});
  const shown: Preferences = { ...prefs, ...draft };
  const dirty = KEYS.some((k) => k in draft && draft[k] !== prefs[k]);
  const edit = (patch: Partial<Preferences>) => setDraft((d) => ({ ...d, ...patch }));
  const reduced = shown.reducedMotion ?? systemReducedMotion;

  const save = (e: FormEvent) => {
    e.preventDefault();
    set(draft);
    setDraft({});
    toast.show({ tone: 'good', title: 'Settings saved', message: 'They apply in this browser.' });
  };

  return (
    <section aria-labelledby="s16-settings" className={s.card} data-testid="s16-settings">
      <h2 id="s16-settings" className={s.h2Display}>
        Settings
      </h2>
      <form className={s.settings} onSubmit={save}>
        <div className={s.settingsGrid}>
          <label className={s.field}>
            Replay speed
            <select
              className={`${s.select} sk-mono`}
              value={String(shown.replaySpeed)}
              onChange={(e) => edit({ replaySpeed: Number(e.currentTarget.value) as ReplaySpeed })}
              data-testid="s16-replay-speed"
            >
              {SPEEDS.map((v) => (
                <option key={v} value={String(v)}>
                  {v}×
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className={s.check}>
          <label className={s.checkLabel}>
            <input
              type="checkbox"
              checked={reduced}
              onChange={(e) => edit({ reducedMotion: e.currentTarget.checked })}
              data-testid="s16-reduced-motion"
            />
            Reduce board motion (no ambient loops, steps snap)
          </label>
          <span className={s.note} data-testid="s16-reduced-motion-note">
            {shown.reducedMotion === null ? (
              `Follows your device setting (${systemReducedMotion ? 'on' : 'off'}).`
            ) : (
              <>
                Replays start at 1× while this is on.{' '}
                <button type="button" className={s.linkButton} onClick={() => edit({ reducedMotion: null })}>
                  Follow the device setting
                </button>
              </>
            )}
          </span>
        </div>
        <label className={s.checkLabel}>
          <input
            type="checkbox"
            checked={shown.sfx}
            onChange={(e) => edit({ sfx: e.currentTarget.checked })}
            data-testid="s16-sfx"
          />
          Sound effects (clicks, screen wipes and match cues)
        </label>
        <label className={s.checkLabel}>
          <input
            type="checkbox"
            checked={shown.showProbabilities}
            onChange={(e) => edit({ showProbabilities: e.currentTarget.checked })}
            data-testid="s16-probabilities"
          />
          Show action probabilities in run and match views
        </label>
        <label className={s.checkLabel}>
          <input
            type="checkbox"
            checked={shown.showTagNames}
            onChange={(e) => edit({ showTagNames: e.currentTarget.checked })}
            data-testid="s16-tag-names"
          />
          Show tag names for the focused tile
        </label>
        <div className={s.settingsActions}>
          {dirty ? (
            <Button type="button" variant="ghost" onClick={() => setDraft({})}>
              Discard changes
            </Button>
          ) : null}
          <Button type="submit" variant="primary" disabled={!dirty} data-testid="s16-save-settings">
            Save settings
          </Button>
        </div>
      </form>
    </section>
  );
}
