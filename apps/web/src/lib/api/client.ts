// Typed fetch wrapper over every apps/api route (docs/backend-contract.md, REST).
// Every method returns the parsed JSON body or throws an ApiError (./errors.ts).
// Credentials are read per request from the CredentialsStore, so signing in or out needs no new
// client. In components use `useApi()` (src/lib/providers.tsx), never construct one.
import type { CredentialsStore } from '../auth/credentials';
import { authHeaders } from '../auth/credentials';
import type { MatchDecisions } from './decisions';
import { ApiError, errorFromBody } from './errors';
import type {
  Agent,
  AgentPatch,
  Cosmetics,
  CreditsWithRows,
  CurrentSeason,
  DepositResponse,
  EarnBack,
  Listing,
  ListingRequest,
  MarketCard,
  MarketDetail,
  MarketQuery,
  Me,
  AgentRecord,
  MyMatch,
  MyRentalOffer,
  Onboarding,
  SkillTemplateView,
  TutorialUpdate,
  RentalOffer,
  RentalPass,
  MintResponse,
  MapLadder,
  PlayerLadder,
  SkillLadder,
  PurchaseResponse,
  Season,
  SeasonStandings,
  SessionRequest,
  SessionResponse,
  SkillBody,
  SkillRow,
  SkillView,
  SkillWithText,
  StartTrialResponse,
  Trial,
  TrialRequest,
  UnlinkNearResponse,
  V2LiveMatch,
  V2MatchRecord,
} from './types';

export interface ApiClient {
  health(): Promise<{ ok: true }>;
  /** POST /auth/session: signs in with the current credentials, creating the account (S01). */
  createSession(body?: SessionRequest): Promise<SessionResponse>;
  me(): Promise<Me>;
  /** GET /me/export: everything skirm holds about the caller, own skill prompts included. */
  exportMe(): Promise<Record<string, unknown>>;
  /** DELETE /me: deletes the account; `confirm` is the current handle. */
  deleteMe(confirm: string): Promise<{ deleted: true }>;
  /** DELETE /me/near: unlinks the NEAR account (409 `listing_active` while a listing is open). */
  unlinkNear(): Promise<UnlinkNearResponse>;
  /** GET /me/earn-back: royalties, net skill sales, season prizes, agent rentals and match spend. */
  earnBack(): Promise<EarnBack>;
  /** GET /me/matches: the caller's latest v2 matches, newest first. */
  myMatches(): Promise<MyMatch[]>;

  agents(): Promise<Agent[]>;
  /** GET /rentals: other players' agents offered for rent, cheapest first. */
  rentalOffers(): Promise<RentalOffer[]>;
  /** GET /rentals/mine: the caller's offers and unused passes. */
  myRentals(): Promise<{ offers: MyRentalOffer[]; passes: RentalPass[] }>;
  /** PUT /agents/:id/rental: offer an agent at a price per match, or stop (null). */
  setRentalOffer(agentId: string, priceYocto: string | null): Promise<{ offer: MyRentalOffer | null }>;
  /** POST /rentals/:offerId: records a paid rental (`market.rent` tx, or `dev:<yocto>[:<nonce>]`). */
  rent(offerId: string, txHash: string): Promise<{ pass: RentalPass }>;
  /** GET /agents/:id/record: the agent's season and all-time record, bluffs included. */
  agentRecord(agentId: string): Promise<AgentRecord>;
  /** PATCH /agents/:id: name, look, skills, unlocks, v2 role/vision/comms/tier and `systemPrompt` (≤ 600). */
  patchAgent(agentId: string, patch: AgentPatch): Promise<Agent>;

  skills(tab?: 'written' | 'owned'): Promise<SkillRow[]>;
  createSkill(body: SkillBody): Promise<SkillView>;
  updateSkill(skillId: string, body: SkillBody): Promise<SkillView>;
  /** The creator also gets `{ prompt, reflexes }`; check with `'prompt' in skill`. */
  skill(skillId: string, version?: number): Promise<SkillRow | SkillWithText>;
  mintSkill(skillId: string, version?: number): Promise<MintResponse>;

  market(query?: MarketQuery): Promise<MarketCard[]>;
  marketSkill(skillId: string, version?: number): Promise<MarketDetail>;
  listSkill(skillId: string, body: ListingRequest): Promise<Listing>;
  /** Dev mode accepts `txHash: 'dev:<yocto>[:<nonce>]'`. */
  purchaseSkill(skillId: string, body: { txHash: string; version?: number }): Promise<PurchaseResponse>;
  /** POST /market/:id/trial: 202 queued; 429 `trial_limit` after 3 trials of the version. */
  startTrial(skillId: string, body: TrialRequest): Promise<StartTrialResponse>;
  /** GET /market/:id/trials: the caller's trials of the skill, newest first. */
  trials(skillId: string, version?: number): Promise<Trial[]>;

  /** GET /seasons/current: the open season (opened on demand), its top 10 and the caller's row. */
  currentSeason(): Promise<CurrentSeason>;
  seasonStandings(seasonId: string, page?: { limit?: number; offset?: number }): Promise<SeasonStandings>;
  /** GET /seasons: recent seasons, newest first. */
  seasons(): Promise<Season[]>;

  /** GET /cosmetics: the premium catalog and what the caller owns. */
  cosmetics(): Promise<Cosmetics>;
  /** POST /cosmetics/:id/buy: paid credits only (402 `insufficient_credits` with need/have). */
  buyCosmetic(itemId: string): Promise<{ owned: string[] }>;

  credits(): Promise<CreditsWithRows>;
  /** Dev mode accepts `txHash: 'dev:<yocto>'`. */
  deposit(txHash: string): Promise<DepositResponse>;

  /** GET /leaderboards/players: per-player Elo, rank and title (v2 ladder). */
  playerLadder(limit?: number): Promise<PlayerLadder>;
  /** GET /leaderboards/maps/:mapId: players by ranked results on one map. */
  mapLadder(mapId: string, limit?: number): Promise<MapLadder>;
  /** GET /leaderboards/skills: skills by ranked win rate (minimum matches applied). */
  skillLadder(opts?: { mapId?: string; limit?: number }): Promise<SkillLadder>;
  /** GET /v2/matches/:id: a v2 match with Elo changes and crew stats (the result screen). */
  v2Match(matchId: string): Promise<V2MatchRecord>;
  /** GET /v2/matches/live: v2 matches being played now, crews hidden. */
  v2LiveMatches(): Promise<V2LiveMatch[]>;
  /** GET /v2/matches/:id/decisions: the caller's crew's decision timeline (players only, once ended). */
  v2MatchDecisions(matchId: string): Promise<MatchDecisions>;

  /** GET /onboarding: tutorial progress and the home checklist. */
  onboarding(): Promise<Onboarding>;
  /** PUT /onboarding/tutorial: tips seen (only grows), or `done` / `skipped` / `restart`. */
  updateTutorial(body: TutorialUpdate): Promise<Onboarding>;
  /** POST /onboarding/checklist/dismiss: hides the home checklist for good. */
  dismissChecklist(): Promise<Onboarding>;
  /** GET /onboarding/templates: the starter skill templates, full text. */
  skillTemplates(): Promise<SkillTemplateView[]>;
  /** POST /onboarding/templates/:id/copy: a new draft skill of the caller's from the template. */
  copyTemplate(templateId: string): Promise<SkillView>;
}

export interface ApiClientOptions {
  baseUrl: string;
  credentials: CredentialsStore;
  fetch?: typeof fetch;
}

type Query = Record<string, string | number | boolean | undefined | null>;

function qs(q?: Query): string {
  if (!q) return '';
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
}

const enc = encodeURIComponent;

export function createApiClient(opts: ApiClientOptions): ApiClient {
  const doFetch = opts.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));

  async function send(
    method: string,
    path: string,
    init: { body?: unknown; query?: Query } = {},
  ): Promise<Response> {
    const headers: Record<string, string> = {
      accept: 'application/json',
      ...authHeaders(opts.credentials.get()),
    };
    if (init.body !== undefined) headers['content-type'] = 'application/json';
    let res: Response;
    try {
      res = await doFetch(`${opts.baseUrl}${path}${qs(init.query)}`, {
        method,
        headers,
        ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
      });
    } catch (err) {
      throw new ApiError(0, 'network', err instanceof Error ? err.message : 'network error');
    }
    if (!res.ok) {
      let body: unknown = null;
      try {
        body = await res.json();
      } catch {
        /* not JSON */
      }
      throw errorFromBody(res.status, body);
    }
    return res;
  }

  async function json<T>(method: string, path: string, init?: { body?: unknown; query?: Query }): Promise<T> {
    const res = await send(method, path, init);
    try {
      return (await res.json()) as T;
    } catch {
      throw new ApiError(res.status, 'bad_response', 'the server sent a response that is not JSON');
    }
  }

  const get = <T>(path: string, query?: Query) => json<T>('GET', path, query ? { query } : undefined);

  return {
    health: () => get('/health'),
    createSession: (body = {}) => json('POST', '/auth/session', { body }),
    me: () => get('/me'),
    unlinkNear: () => json('DELETE', '/me/near'),
    exportMe: () => get('/me/export'),
    deleteMe: (confirm) => json('DELETE', '/me', { body: { confirm } }),
    earnBack: () => get('/me/earn-back'),
    myMatches: () => get('/me/matches'),

    agents: () => get('/agents'),
    agentRecord: (id) => get(`/agents/${enc(id)}/record`),
    rentalOffers: () => get('/rentals'),
    myRentals: () => get('/rentals/mine'),
    setRentalOffer: (id, priceYocto) => json('PUT', `/agents/${enc(id)}/rental`, { body: { priceYocto } }),
    rent: (offerId, txHash) => json('POST', `/rentals/${enc(offerId)}`, { body: { txHash } }),
    patchAgent: (id, patch) => json('PATCH', `/agents/${enc(id)}`, { body: patch }),

    skills: (tab = 'written') => get('/skills', { tab }),
    createSkill: (body) => json('POST', '/skills', { body }),
    updateSkill: (id, body) => json('PUT', `/skills/${enc(id)}`, { body }),
    skill: (id, version) => get(`/skills/${enc(id)}`, { version }),
    mintSkill: (id, version) =>
      json('POST', `/skills/${enc(id)}/mint`, { body: version !== undefined ? { version } : {} }),

    market: (q = {}) => get('/market', { tag: q.tag, sort: q.sort }),
    marketSkill: (id, version) => get(`/market/${enc(id)}`, { version }),
    listSkill: (id, body) => json('POST', `/market/${enc(id)}/listing`, { body }),
    purchaseSkill: (id, body) => json('POST', `/market/${enc(id)}/purchase`, { body }),
    startTrial: (id, body) => json('POST', `/market/${enc(id)}/trial`, { body }),
    trials: (id, version) => get(`/market/${enc(id)}/trials`, { version }),

    currentSeason: () => get('/seasons/current'),
    seasonStandings: (id, page = {}) => get(`/seasons/${enc(id)}/standings`, { limit: page.limit, offset: page.offset }),
    seasons: () => get('/seasons'),

    cosmetics: () => get('/cosmetics'),
    buyCosmetic: (id) => json('POST', `/cosmetics/${enc(id)}/buy`),

    credits: () => get('/credits'),
    deposit: (txHash) => json('POST', '/credits/deposits', { body: { txHash } }),

    playerLadder: (limit) => get('/leaderboards/players', { limit }),
    mapLadder: (mapId, limit) => get(`/leaderboards/maps/${enc(mapId)}`, { limit }),
    skillLadder: (opts = {}) => get('/leaderboards/skills', { mapId: opts.mapId, limit: opts.limit }),
    v2Match: (id) => get(`/v2/matches/${enc(id)}`),
    v2LiveMatches: () => get('/v2/matches/live'),
    v2MatchDecisions: (id) => get(`/v2/matches/${enc(id)}/decisions`),

    onboarding: () => get('/onboarding'),
    updateTutorial: (body) => json('PUT', '/onboarding/tutorial', { body }),
    dismissChecklist: () => json('POST', '/onboarding/checklist/dismiss'),
    skillTemplates: () => get('/onboarding/templates'),
    copyTemplate: (id) => json('POST', `/onboarding/templates/${enc(id)}/copy`),
  };
}
