'use client';
// Plays the background music (lib/music) while the "Music" preference is on: the calm loop in the
// menus, the tense one on a match screen. Browsers block audio until the player interacts with the
// page, so it starts on the first click or key press; turning the preference off fades it out.
import { usePathname } from 'next/navigation';
import { useEffect } from 'react';
import { musicEngine, type MusicMood } from '@/lib/music';
import { usePreferences } from '@/lib/preferences';

/** The mood for a path: a match screen (live, lock-in, debrief, replay) plays the match loop. */
export function moodFor(pathname: string): MusicMood {
  return /^\/matches\//.test(pathname) ? 'match' : 'menu';
}

export function MusicPlayer() {
  const { prefs } = usePreferences();
  const pathname = usePathname() ?? '/';
  const mood = moodFor(pathname);

  useEffect(() => {
    const m = musicEngine();
    if (!prefs.music) {
      m.stop();
      return;
    }
    if (m.playing) {
      m.setMood(mood);
      return;
    }
    const begin = () => {
      m.start(mood);
      off();
    };
    const off = () => {
      window.removeEventListener('pointerdown', begin);
      window.removeEventListener('keydown', begin);
    };
    window.addEventListener('pointerdown', begin);
    window.addEventListener('keydown', begin);
    return off;
  }, [prefs.music, mood]);

  return null;
}
