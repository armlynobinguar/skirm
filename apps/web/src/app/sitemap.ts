// sitemap.xml: the pages a signed-out visitor can see. Screens behind RequireSession (/play,
// /puzzles and the rest of Play) only show a sign-in prompt to a crawler, so they are left out.
import type { MetadataRoute } from 'next';
import { config } from '@/lib/config';
import { DOC_PAGES } from '@/features/docs/docs.generated';
import { routes } from '@/lib/routes';

export default function sitemap(): MetadataRoute.Sitemap {
  const pages: Array<[path: string, priority: number]> = [
    [routes.signIn(), 1],
    [routes.leaderboards(), 0.6],
    [routes.verify(), 0.6],
    [routes.docs(), 0.8],
    ...DOC_PAGES.map((p): [string, number] => [routes.docs(p.slug), 0.5]),
    [routes.terms(), 0.3],
    [routes.privacy(), 0.3],
  ];
  return pages.map(([path, priority]) => ({
    url: `${config.siteUrl}${path}`,
    changeFrequency: 'weekly',
    priority,
  }));
}
