// sitemap.xml: the pages a signed-out visitor can see.
import type { MetadataRoute } from 'next';
import { config } from '@/lib/config';
import { routes } from '@/lib/routes';

export default function sitemap(): MetadataRoute.Sitemap {
  const pages: Array<[path: string, priority: number]> = [
    [routes.signIn(), 1],
    [routes.home(), 0.8],
    [routes.leaderboards(), 0.6],
    [routes.terms(), 0.3],
    [routes.privacy(), 0.3],
  ];
  return pages.map(([path, priority]) => ({
    url: `${config.siteUrl}${path}`,
    changeFrequency: 'weekly',
    priority,
  }));
}
