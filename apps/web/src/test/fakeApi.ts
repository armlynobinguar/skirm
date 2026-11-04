// Fake ApiClient for component tests. Stub only the methods a test needs; any other call rejects
// with "fake api: <method> not stubbed", so a test never hits the network by accident.
//
//   const api = createFakeApi({ me: async () => meFixture(), myMatches: async () => [myMatchFixture()] });
//   renderWithProviders(<HomeScreen />, { api, handle: 'ada' });
//   expect(api.me).toHaveBeenCalled();         // every method is a vi.fn
//
// To simulate failures: `buyCosmetic: async () => { throw new ApiError(402, 'insufficient_credits', '…', undefined, { need: 150, have: 80 }) }`.
import { vi, type Mock } from 'vitest';
import type { ApiClient } from '@/lib/api/client';

export type FakeApi = { [K in keyof ApiClient]: Mock<ApiClient[K]> };

const METHODS: (keyof ApiClient)[] = [
  'health',
  'createSession',
  'me',
  'unlinkNear',
  'exportMe',
  'deleteMe',
  'earnBack',
  'myMatches',
  'agents',
  'agentRecord',
  'rentalOffers',
  'myRentals',
  'setRentalOffer',
  'rent',
  'patchAgent',
  'skills',
  'createSkill',
  'updateSkill',
  'skill',
  'mintSkill',
  'market',
  'marketSkill',
  'listSkill',
  'purchaseSkill',
  'startTrial',
  'trials',
  'currentSeason',
  'seasonStandings',
  'seasons',
  'cosmetics',
  'buyCosmetic',
  'credits',
  'deposit',
  'playerLadder',
  'mapLadder',
  'skillLadder',
  'v2Match',
  'v2LiveMatches',
  'onboarding',
  'updateTutorial',
  'dismissChecklist',
  'skillTemplates',
  'copyTemplate',
];

export function createFakeApi(overrides: Partial<ApiClient> = {}): FakeApi {
  const out = {} as Record<string, Mock>;
  for (const m of METHODS) {
    const impl = overrides[m] as ((...a: unknown[]) => unknown) | undefined;
    out[m] = vi.fn(impl ?? (async () => Promise.reject(new Error(`fake api: ${m} not stubbed`))));
  }
  return out as unknown as FakeApi;
}
