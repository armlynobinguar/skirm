// The docs site's frame: section sidebar on the left, the page in the middle, "On this page" on the
// right. Server-rendered and readable signed out, like /terms.
import Link from 'next/link';
import type { ReactNode } from 'react';
import { routes } from '@/lib/routes';
import { DOC_SECTIONS, pagesIn } from './docs';
import styles from './docs.module.css';

export function DocsLayout({
  current,
  toc,
  children,
}: {
  current?: string;
  toc?: { id: string; text: string }[];
  children: ReactNode;
}) {
  return (
    <div className={`app-page ${styles.layout}`} data-testid="docs">
      <nav className={styles.sidebar} aria-label="Docs">
        <Link href={routes.docs()} className={styles.sidebarTitle}>
          Docs
        </Link>
        {DOC_SECTIONS.map((s) => (
          <div key={s.id} className={styles.group}>
            <p className={styles.groupTitle}>{s.title}</p>
            <ul className={styles.links}>
              {pagesIn(s.id).map((p) => (
                <li key={p.slug}>
                  <Link
                    href={routes.docs(p.slug)}
                    className={styles.link}
                    aria-current={p.slug === current ? 'page' : undefined}
                  >
                    {p.title}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
      <div className={styles.page}>{children}</div>
      {toc && toc.length > 1 ? (
        <aside className={styles.toc} aria-label="On this page">
          <p className={styles.groupTitle}>On this page</p>
          <ol>
            {toc.map((h) => (
              <li key={h.id}>
                <a href={`#${h.id}`}>{h.text}</a>
              </li>
            ))}
          </ol>
        </aside>
      ) : null}
    </div>
  );
}
