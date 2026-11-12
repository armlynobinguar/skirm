/** One docs page, built from src/features/docs/content/<slug>.md by scripts/build-docs.mjs. */
export interface DocPage {
  slug: string;
  title: string;
  description: string;
  section: DocSectionId;
  order: number;
  /** The page's markdown, front matter removed. */
  body: string;
}

export type DocSectionId = 'getting-started' | 'playing' | 'skills' | 'builders' | 'whitepaper' | 'about';
