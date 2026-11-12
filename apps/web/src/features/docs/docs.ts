// The docs site's table of contents: sections in reading order, each with its pages by `order`.
import { DOC_PAGES } from './docs.generated';
import type { DocPage, DocSectionId } from './types';

export const DOC_SECTIONS: { id: DocSectionId; title: string; blurb: string }[] = [
  { id: 'getting-started', title: 'Getting started', blurb: 'What skirm is and your first match.' },
  { id: 'playing', title: 'Playing the game', blurb: 'Agents, maps, comms, the debrief and ranked play.' },
  { id: 'skills', title: 'Skills', blurb: 'Write the minds your crew plays with.' },
  { id: 'builders', title: 'Builders', blurb: 'Bring your own agent, the API and running skirm locally.' },
  { id: 'whitepaper', title: 'Whitepaper', blurb: 'Why skirm exists and how it works.' },
  { id: 'about', title: 'About', blurb: 'Changelog, brand kit and policies.' },
];

export function pagesIn(section: DocSectionId): DocPage[] {
  return DOC_PAGES.filter((p) => p.section === section).sort((a, b) => a.order - b.order);
}

/** Every page in reading order: section by section. */
export const ORDERED_PAGES: DocPage[] = DOC_SECTIONS.flatMap((s) => pagesIn(s.id));

export function findPage(slug: string): DocPage | undefined {
  return DOC_PAGES.find((p) => p.slug === slug);
}

/** The pages before and after `slug` in reading order. */
export function neighbours(slug: string): { prev?: DocPage; next?: DocPage } {
  const i = ORDERED_PAGES.findIndex((p) => p.slug === slug);
  if (i < 0) return {};
  return { prev: ORDERED_PAGES[i - 1], next: ORDERED_PAGES[i + 1] };
}

/** The page's `##` headings, for the "On this page" list. */
export function headingsOf(body: string): { id: string; text: string }[] {
  return body
    .split('\n')
    .filter((l) => /^## /.test(l))
    .map((l) => l.slice(3).trim())
    .map((text) => ({ id: slugify(text), text: text.replace(/[*`]/g, '') }));
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[*`]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}
