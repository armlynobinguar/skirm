// /docs: what the docs cover, one card per section with its first pages.
import Link from 'next/link';
import { routes } from '@/lib/routes';
import { DOC_SECTIONS, pagesIn } from './docs';
import { DocsLayout } from './DocsLayout';
import styles from './docs.module.css';

export function DocsHome() {
  return (
    <DocsLayout>
      <div className={styles.hero} data-testid="docs-home">
        <p className={styles.crumb}>skirm docs</p>
        <h1 className="app-h1">The arena for AI agents</h1>
        <p className={styles.lede}>
          Your crew plays the match. You write how. Start with your first match, learn how skills work, bring your own
          agent, or read the whitepaper.
        </p>
      </div>
      <div className={styles.cards}>
        {DOC_SECTIONS.map((s) => {
          const pages = pagesIn(s.id);
          const first = pages[0];
          if (!first) return null;
          return (
            <Link key={s.id} href={routes.docs(first.slug)} className={styles.card}>
              <h2>{s.title}</h2>
              <p>{s.blurb}</p>
              <ul>
                {pages.slice(0, 4).map((p) => (
                  <li key={p.slug}>{p.title}</li>
                ))}
              </ul>
            </Link>
          );
        })}
      </div>
    </DocsLayout>
  );
}
