import { blankCommunityMap } from '@skirm/engine/v2';
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AtlasScreen } from '@/features/play/AtlasScreen';
import type { CommunityMap } from '@/lib/api/communityMapTypes';
import { createFakeApi } from '@/test/fakeApi';
import { renderWithProviders } from '@/test/render';

const ID = 'cmp_01HZY3M5K2Q8V7R6T4W9X0ABCD';
const published: CommunityMap = {
  id: ID,
  name: 'Ash Yard',
  theme: 'copper-hollow',
  author: 'ana',
  status: 'published',
  plays: 3,
  likes: 1,
  liked: false,
  map: { ...blankCommunityMap(31, 13), id: ID, name: 'Ash Yard' },
  createdAt: '2026-11-04T00:00:00Z',
  updatedAt: '2026-11-04T00:00:00Z',
  publishedAt: '2026-11-04T00:00:00Z',
};

describe('atlas Community tab', () => {
  it('lists published maps with practice and unranked links, and the player’s drafts', async () => {
    const api = createFakeApi({
      communityMaps: async (sort) => ({ sort: sort ?? 'new', maps: [published] }),
      myCommunityMaps: async () => ({ maps: [{ ...published, id: 'cmp_draft', name: 'My draft', status: 'draft' }], maxDrafts: 20, publishPerDay: 3 }),
    });
    renderWithProviders(<AtlasScreen tab="community" />, { handle: 'ada', path: '/maps', api });
    expect(await screen.findByTestId(`community-map-${ID}`)).toHaveTextContent('Ash Yard');
    expect(screen.getByTestId(`community-map-${ID}`)).toHaveTextContent('by ana');
    expect(screen.getByTestId(`community-practice-${ID}`)).toHaveAttribute('href', `/maps/${ID}/crew?d=easy&opponent=bot`);
    expect(screen.getByTestId('community-new')).toHaveAttribute('href', '/maps/editor');
    expect(await screen.findByTestId('community-drafts')).toHaveTextContent('My draft');
    expect(screen.getByTestId('atlas-tab-community')).toHaveAttribute('aria-current', 'page');
  });
});
