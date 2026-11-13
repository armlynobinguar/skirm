import type { Metadata } from 'next';
import { DocsHome } from '@/features/docs/DocsHome';
import { shareMeta } from '@/lib/share-meta';
import { routes } from '@/lib/routes';

export const metadata: Metadata = shareMeta(
  'Docs',
  'skirm docs: your first match, agents and maps, writing skills, bring your own agent, the API and the whitepaper.',
  routes.docs(),
);

export default function Page() {
  return <DocsHome />;
}
