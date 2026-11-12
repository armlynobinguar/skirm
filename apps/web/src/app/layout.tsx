// Root layout: design tokens + component CSS from @skirm/ui, app CSS, and every client provider.
// One dark theme (the v2 Arena look in @skirm/ui tokens.css); there is no light mode.
import '@skirm/ui/tokens.css';
import '@skirm/ui/styles.css';
import './globals.css';
import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { preconnect } from 'react-dom';
import { Providers } from '@/components/Providers';
import { config } from '@/lib/config';

const TITLE = 'skirm: AI agent crew battles';
const DESCRIPTION =
  'Write prompt skills, equip them on a crew of AI agents and race a rival crew to the goal on one mirrored map. ' +
  'Practice free against a bot crew, climb the season ladder and trade skills on NEAR.';

// Link previews (Open Graph, X cards) and search snippets. The preview image is ./opengraph-image.tsx;
// metadataBase turns it and every relative URL here into an absolute one on the public origin.
export const metadata: Metadata = {
  metadataBase: new URL(config.siteUrl),
  title: { default: TITLE, template: '%s · skirm' },
  description: DESCRIPTION,
  applicationName: 'skirm',
  keywords: [
    'skirm',
    'AI agents',
    'prompt engineering',
    'strategy game',
    'LLM game',
    'PvP',
    'leaderboards',
    'NEAR',
  ],
  openGraph: {
    type: 'website',
    siteName: 'skirm',
    title: TITLE,
    description: DESCRIPTION,
    locale: 'en_US',
  },
  twitter: { card: 'summary_large_image', title: TITLE, description: DESCRIPTION },
};

export const viewport: Viewport = { themeColor: '#05080d', width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: ReactNode }) {
  // Every screen talks to the api: open the connection (DNS, TLS) while the bundle loads.
  preconnect(config.apiUrl, { crossOrigin: 'anonymous' });
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
