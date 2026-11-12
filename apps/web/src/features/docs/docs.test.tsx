import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import sitemap from '@/app/sitemap';
import { routes } from '@/lib/routes';
import { DOC_PAGES } from './docs.generated';
import { DOC_SECTIONS, ORDERED_PAGES, findPage, neighbours } from './docs';
import { DocPageView } from './DocPageView';
import { DocsHome } from './DocsHome';

const webDir = path.resolve(__dirname, '..', '..', '..');

describe('docs site', () => {
  it('docs.generated.ts matches the markdown pages', () => {
    // Fails with "out of date" when a page was edited without `npm run docs:build -w @skirm/web`.
    expect(() =>
      execFileSync(process.execPath, ['scripts/build-docs.mjs', '--check'], { cwd: webDir, stdio: 'pipe' }),
    ).not.toThrow();
  });

  it('every page has a known section, a unique slug and a description', () => {
    const sections = new Set(DOC_SECTIONS.map((s) => s.id));
    expect(DOC_PAGES.length).toBeGreaterThan(0);
    for (const page of DOC_PAGES) {
      expect(sections.has(page.section), `${page.slug}: section ${page.section}`).toBe(true);
      expect(page.description.length, `${page.slug}: description`).toBeGreaterThan(10);
      expect(page.body.startsWith('# '), `${page.slug}: use ## headings, the title is rendered`).toBe(false);
    }
    expect(new Set(DOC_PAGES.map((p) => p.slug)).size).toBe(DOC_PAGES.length);
  });

  it('every link between docs pages points at a page that exists', () => {
    for (const page of DOC_PAGES) {
      for (const [, slug = ''] of page.body.matchAll(/\]\(\/docs\/([a-z0-9-]+)/g)) {
        expect(findPage(slug), `${page.slug} links /docs/${slug}`).toBeDefined();
      }
    }
  });

  it('the landing page links every section, and pages link their neighbours', () => {
    render(<DocsHome />);
    expect(screen.getByTestId('docs-home')).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'Docs' });
    expect(within(nav).getAllByRole('link').length).toBe(DOC_PAGES.length + 1);

    const first = ORDERED_PAGES[0]!;
    expect(neighbours(first.slug).prev).toBeUndefined();
    expect(neighbours(first.slug).next).toBe(ORDERED_PAGES[1]);
  });

  it('a page shows its title, marks itself current and links the next page', () => {
    const page = ORDERED_PAGES[0]!;
    render(<DocPageView page={page} />);
    expect(screen.getByRole('heading', { level: 1, name: page.title })).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'Docs' });
    expect(within(nav).getByRole('link', { name: page.title })).toHaveAttribute('aria-current', 'page');
    const pager = screen.getByRole('navigation', { name: 'Previous and next page' });
    expect(within(pager).getByRole('link')).toHaveAttribute('href', routes.docs(ORDERED_PAGES[1]!.slug));
  });

  it('every page is in the sitemap', () => {
    const urls = sitemap().map((e) => e.url);
    expect(urls.some((u) => u.endsWith('/docs'))).toBe(true);
    for (const page of DOC_PAGES) expect(urls.some((u) => u.endsWith(`/docs/${page.slug}`))).toBe(true);
  });
});
