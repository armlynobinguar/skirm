// One docs page: section label, title, description, the markdown body and previous/next links.
import Link from 'next/link';
import { routes } from '@/lib/routes';
import { DOC_SECTIONS, headingsOf, neighbours } from './docs';
import { DocsLayout } from './DocsLayout';
import { Markdown } from './Markdown';
import { PrintButton } from './PrintButton';
import type { DocPage } from './types';
import styles from './docs.module.css';

export function DocPageView({ page }: { page: DocPage }) {
  const section = DOC_SECTIONS.find((s) => s.id === page.section);
  const { prev, next } = neighbours(page.slug);
  return (
    <DocsLayout current={page.slug} toc={headingsOf(page.body)}>
      <article data-testid={`doc-${page.slug}`}>
        <p className={styles.crumb}>{section?.title}</p>
        <h1 className="app-h1">{page.title}</h1>
        <p className={styles.lede}>{page.description}</p>
        {page.section === 'whitepaper' ? (
          <div className={styles.actions}>
            <PrintButton className={styles.actionBtn} />
          </div>
        ) : null}
        <div className={styles.prose}>
          <Markdown source={page.body} />
        </div>
        <nav className={styles.pager} aria-label="Previous and next page">
          {prev ? (
            <Link href={routes.docs(prev.slug)} className={styles.pagerLink}>
              <small>Previous</small>
              {prev.title}
            </Link>
          ) : null}
          {next ? (
            <Link href={routes.docs(next.slug)} className={`${styles.pagerLink} ${styles.pagerNext}`}>
              <small>Next</small>
              {next.title}
            </Link>
          ) : null}
        </nav>
      </article>
    </DocsLayout>
  );
}
