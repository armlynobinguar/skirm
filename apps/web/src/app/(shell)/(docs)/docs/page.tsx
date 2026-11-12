import type { Metadata } from 'next';
import { DocsHome } from '@/features/docs/DocsHome';

export const metadata: Metadata = {
  title: 'Docs',
  description: 'skirm docs: your first match, agents and maps, writing skills, bring your own agent, the API and the whitepaper.',
};

export default function Page() {
  return <DocsHome />;
}
