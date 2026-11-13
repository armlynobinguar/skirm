// Page metadata for a public page that people share: its own title and description in the link
// preview (Open Graph, X card) and a canonical URL. Without this, every shared docs or ladder link
// previews as the home page, because the root layout's openGraph/twitter blocks are inherited as-is.
// The image stays the site's preview card (./app/opengraph-image.tsx), named here so a page that
// sets its own openGraph block keeps it.
import type { Metadata } from 'next';

const IMAGE = {
  url: '/opengraph-image',
  width: 1200,
  height: 630,
  alt: 'skirm: your crew plays the match. You write how.',
};

/** `title` is the page's own title; the "· skirm" suffix is added for the tab and the preview. */
export function shareMeta(title: string, description: string, path: string): Metadata {
  const full = `${title} · skirm`;
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: {
      type: 'website',
      siteName: 'skirm',
      title: full,
      description,
      url: path,
      locale: 'en_US',
      images: [IMAGE],
    },
    twitter: { card: 'summary_large_image', title: full, description, images: [IMAGE] },
  };
}
