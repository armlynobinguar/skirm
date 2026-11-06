'use client';
// The design notes aside (the prototype's #notes): bottom left over the arena, amber on dark, with
// the current screen's card (notes.ts). Opened by the top bar's Notes toggle or N (GlobalKeys).
import { usePathname } from 'next/navigation';
import { screenOf } from '@/lib/routes';
import { DECK_NOTES, notesFor, useNotesOpen } from './notes';
import styles from './shell.module.css';
import { config } from '@/lib/config';

export function NotesAside() {
  const open = useNotesOpen();
  const pathname = usePathname() ?? '/';
  if (!open || !config.designNotes) return null;
  const n = notesFor(screenOf(pathname)?.key);
  return (
    <aside className={styles.notes} aria-label="Design notes" data-testid="notes-aside">
      <span className="sk-kick">Design notes · press N to hide</span>
      <h3>{n.title}</h3>
      <p>{n.lead}</p>
      <ul>
        {n.points.map((p) => (
          <li key={p}>{p}</li>
        ))}
      </ul>
      <p className="sk-kick">From the Command Deck</p>
      <ul>
        {DECK_NOTES.map((p) => (
          <li key={p}>{p}</li>
        ))}
      </ul>
    </aside>
  );
}
