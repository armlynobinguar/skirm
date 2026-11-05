// Typed fetch wrapper over every apps/api route (docs/backend-contract.md, REST).
// Every method returns the parsed JSON body or throws an ApiError (./errors.ts).
// Credentials are read per request from the CredentialsStore, so signing in or out needs no new
// client. In components use `useApi()` (src/lib/providers.tsx), never construct one.
import type { TraitId } from '@skirm/shared';
import type { CredentialsStore } from '../auth/credentials';
import { authHeaders } from '../auth/credentials';
import type { MatchDecisions } from './decisions';
import { ApiError, errorFromBody } from './errors';
import type { Campaign, CampaignStart } from './campaignTypes';
import type { PuzzleDetail, PuzzleLeaderboard, PuzzleList, PuzzleRun, PuzzleRunRequest } from './puzzleTypes';
import type { MapDefV2 } from '@skirm/engine/v2';
import type { CommunityMap, CommunityMapBody, CommunityMapList, MyCommunityMaps, TestPlayResult } from './communityMapTypes';
import type { Playbook, PlaybookList, PlaybookWithText } from './playbookTypes';
import type { CreateTournament, Lobby, LobbySettings, TournamentDetail, TournamentStatus, TournamentSummary } from './lobbyTypes';
import type {
  AchievementBadge,
  Achievements,
  Agent,
  AgentPatch,
  BenchCompare,
  BenchInfo,
  BenchRun,
  BenchRunDetail,
  BenchRunRequest,
  DailyAttempt,
  DailyBoard,
  DailyToday,
  Cosmetics,
  CreditsWithRows,
  CurrentSeason,
  DepositResponse,
  ExternalAgent,
  ExternalAgentBody,
  ExternalAgentPing,
  ExternalAgentSecret,
  EarnBack,
  Listing,
  ListingRequest,
  MarketCard,
  MarketDetail,
  MarketQuery,
  Me,
  AgentProgressionInfo,
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
  QuestBoard,
  QuestClaimResponse,
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
  ReplayShare,
  SharedReplay,
  V2Highlights,
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
  /** POST /rentals/:offerId `{ credits, key }`: pays in paid credits; a retry with the same key returns the same pass. */
  rentWithCredits(offerId: string, key: string): Promise<{ pass: RentalPass; credits: number }>;
  /** GET /agents/:id/record: the agent's season and all-time record, bluffs included. */
  agentRecord(agentId: string): Promise<AgentRecord>;
  /** GET /agents/:id/progression: XP, level, traits and the trait catalogue. */
  agentProgression(agentId: string): Promise<AgentProgressionInfo>;
  /** POST /agents/:id/traits: picks a trait into an earned slot; returns the agent. */
  pickTrait(agentId: string, trait: TraitId): Promise<Agent>;
  /** PATCH /agents/:id: name, look, skills, unlocks, v2 role/vision/comms/tier and `systemPrompt` (≤ 600). */
  patchAgent(agentId: string, patch: AgentPatch): Promise<Agent>;

  skills(tab?: 'written' | 'owned'): Promise<SkillRow[]>;
  createSkill(body: SkillBody): Promise<SkillView>;
  updateSkill(skillId: string, body: SkillBody): Promise<SkillView>;
  /** The creator also gets `{ prompt, reflexes }`; check with `'prompt' in skill`. */
  skill(skillId: string, version?: number): Promise<SkillRow | SkillWithText>;
  mintSkill(skillId: string, version?: number): Promise<MintResponse>;

  /** GET /playbooks: the caller's crew playbooks (names only), the cap and the text limit. */
  playbooks(): Promise<PlaybookList>;
  /** GET /playbooks/:id: the owner's read-back, with the text. */
  playbook(playbookId: string): Promise<PlaybookWithText>;
  /** POST /playbooks (422 `playbook_limit` at the cap, `playbook_refused` by the filter). */
  createPlaybook(body: { name: string; text: string }): Promise<Playbook>;
  updatePlaybook(playbookId: string, body: { name?: string; text?: string }): Promise<Playbook>;
  deletePlaybook(playbookId: string): Promise<{ deleted: true }>;
  /** POST /playbooks/select: the one lock-in starts with (null: none). */
  selectPlaybook(playbookId: string | null): Promise<{ selected: string | null }>;

  market(query?: MarketQuery): Promise<MarketCard[]>;
  marketSkill(skillId: string, version?: number): Promise<MarketDetail>;
  listSkill(skillId: string, body: ListingRequest): Promise<Listing>;
  /** Dev mode accepts `txHash: 'dev:<yocto>[:<nonce>]'`. */
  purchaseSkill(skillId: string, body: { txHash: string; version?: number }): Promise<PurchaseResponse>;
  /** POST /market/:id/trial: 202 queued; 429 `trial_limit` after 3 trials of the version. */
  startTrial(skillId: string, body: TrialRequest): Promise<StartTrialResponse>;
  /** GET /market/:id/trials: the caller's trials of the skill, newest first. */
  trials(skillId: string, version?: number): Promise<Trial[]>;

  /** GET /bench: the test bench's cost here and the caller's runs left this hour. */
  benchInfo(): Promise<BenchInfo>;
  /** POST /bench/runs: 202 queued; 429 `bench_limit` past the hourly cap. */
  startBenchRun(body: BenchRunRequest): Promise<BenchRun>;
  /** GET /bench/runs: the caller's runs (of one skill, or all), newest first. */
  benchRuns(skillId?: string): Promise<BenchRun[]>;
  /** GET /bench/runs/:id: one run, with its prompt when it is the caller's own text. */
  benchRun(runId: string): Promise<BenchRunDetail>;
  /** GET /bench/compare: two runs side by side and a word diff of their prompts. */
  compareBenchRuns(a: string, b: string): Promise<BenchCompare>;

  /** GET /daily: today's challenge, your attempts and the time left. */
  daily(): Promise<DailyToday>;
  /** POST /daily/attempts: 202 queued with your crew (default: your first agents); 429 `daily_limit`. */
  startDailyAttempt(agentIds?: string[]): Promise<DailyAttempt>;
  /** GET /daily/leaderboard: a day's top attempts (today by default) and your rank. */
  dailyBoard(date?: string): Promise<DailyBoard>;

  /** GET /seasons/current: the open season (opened on demand), its top 10 and the caller's row. */
  currentSeason(): Promise<CurrentSeason>;
  seasonStandings(seasonId: string, page?: { limit?: number; offset?: number }): Promise<SeasonStandings>;
  /** GET /seasons: recent seasons, newest first. */
  seasons(): Promise<Season[]>;

  /** GET /cosmetics: the premium catalog and what the caller owns. */
  cosmetics(): Promise<Cosmetics>;
  /** POST /cosmetics/:id/buy: paid credits only (402 `insufficient_credits` with need/have). */
  buyCosmetic(itemId: string): Promise<{ owned: string[] }>;

  /** GET /quests: today's and this week's quests, progress and the play streak. */
  quests(): Promise<QuestBoard>;
  /** POST /quests/:id/claim: refills free credits (409 `quest_incomplete`, `already_claimed`, `allowance_full`). */
  claimQuest(questId: string): Promise<QuestClaimResponse>;
  /** GET /achievements: every achievement with progress, unlock time and badge. */
  achievements(): Promise<Achievements>;
  /** POST /achievements/:id/badge: mints the soulbound badge (local without a NEAR signer). */
  mintBadge(achievementId: string): Promise<{ badge: AchievementBadge | null }>;

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
  /** GET /v2/matches/:id/highlights: highlight moments with caster lines (public, once ended). */
  v2Highlights(matchId: string): Promise<V2Highlights>;
  /** POST /v2/matches/:id/shares: a player's public link to the replay, optionally a clip. */
  createReplayShare(matchId: string, clip?: { start: number; end: number } | null): Promise<{ share: ReplayShare }>;
  /** GET /v2/matches/:id/shares: the caller's live links to that match. */
  replayShares(matchId: string): Promise<{ shares: ReplayShare[] }>;
  /** GET /replays/:shareId: a shared replay (public); `frames: false` leaves the frames out. */
  sharedReplay(shareId: string, opts?: { frames?: boolean }): Promise<SharedReplay>;
  /** DELETE /replays/:shareId: its creator ends the link. */
  revokeReplayShare(shareId: string): Promise<{ revoked: true }>;
  /** GET /v2/matches/:id/decisions: the caller's crew's decision timeline (players only, once ended). */
  v2MatchDecisions(matchId: string): Promise<MatchDecisions>;

  /** POST /lobbies: a private friend lobby with the caller as host. */
  createLobby(settings: Partial<LobbySettings> & { mapId: string }): Promise<Lobby>;
  /** GET /lobbies: the caller's lobbies still to play (friend and bracket ones). */
  myLobbies(): Promise<Lobby[]>;
  lobby(lobbyId: string): Promise<Lobby>;
  /** GET /lobbies/code/:code: an invite's lobby before joining it. */
  lobbyByCode(code: string): Promise<Lobby>;
  /** POST /lobbies/join: takes the guest seat (409 `lobby_full`, `own_lobby`, `lobby_closed`). */
  joinLobby(code: string): Promise<Lobby>;
  /** PATCH /lobbies/:id: the host changes the settings (409 `lobby_ready` while a crew is readied). */
  updateLobby(lobbyId: string, patch: Partial<LobbySettings>): Promise<Lobby>;
  /** DELETE /lobbies/:id: a guest leaves; the host closes the lobby. */
  leaveLobby(lobbyId: string): Promise<Lobby>;
  tournaments(status?: TournamentStatus): Promise<TournamentSummary[]>;
  tournament(id: string): Promise<TournamentDetail>;
  /** POST /tournaments: a prize pool is spent from paid credits (402 `insufficient_credits`). */
  createTournament(body: CreateTournament): Promise<TournamentDetail>;
  joinTournament(id: string): Promise<TournamentDetail>;
  leaveTournament(id: string): Promise<TournamentDetail>;
  /** POST /tournaments/:id/cancel: the creator, before it starts; the pool comes back. */
  cancelTournament(id: string): Promise<TournamentDetail>;
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
  /** GET /campaign: chapters, missions with their state, and each chapter's rewards. */
  campaign(): Promise<Campaign>;
  /** POST /campaign/missions/:id/start: the v2_queue to send (403 `mission_locked`). */
  startMission(missionId: string): Promise<CampaignStart>;
  /** GET /puzzles: every puzzle with par, medals and the caller's best; the brain, cost and hourly cap. */
  puzzles(): Promise<PuzzleList>;
  /** GET /puzzles/:id: one puzzle with its board layout and the caller's recent runs. */
  puzzle(puzzleId: string): Promise<PuzzleDetail>;
  /** POST /puzzles/:id/runs: 202 queued; 429 `puzzle_limit` past the hourly cap. */
  startPuzzleRun(puzzleId: string, body: PuzzleRunRequest): Promise<PuzzleRun>;
  /** GET /puzzles/:id/runs/:runId: one of the caller's runs (poll while queued or running). */
  puzzleRun(puzzleId: string, runId: string): Promise<PuzzleRun>;
  /** GET /puzzles/:id/leaderboard: each player's best, lowest score first (public). */
  puzzleLeaderboard(puzzleId: string): Promise<PuzzleLeaderboard>;

  /** GET /community-maps: published community maps, newest or most popular first. */
  communityMaps(sort?: 'new' | 'popular'): Promise<CommunityMapList>;
  /** GET /community-maps/mine: the caller's drafts and published maps. */
  myCommunityMaps(): Promise<MyCommunityMaps>;
  /** GET /community-maps/:id: a published map, or the caller's own draft. */
  communityMap(id: string): Promise<CommunityMap>;
  /** POST /community-maps: a new draft (422 `map_limit` at the cap). */
  createCommunityMap(body: CommunityMapBody & { name: string; map: MapDefV2 }): Promise<CommunityMap>;
  /** PUT /community-maps/:id: an own draft (409 `map_published` once published). */
  updateCommunityMap(id: string, body: CommunityMapBody): Promise<CommunityMap>;
  deleteCommunityMap(id: string): Promise<{ deleted: true }>;
  /** POST /community-maps/:id/publish (422 `map_invalid`, `map_unbalanced`, `map_refused`; 429 `publish_limit`; 409 `name_taken`). */
  publishCommunityMap(id: string): Promise<CommunityMap>;
  /** POST /community-maps/test-play: validation issues, or a greedy balance report. */
  testPlayMap(map: MapDefV2): Promise<TestPlayResult>;
  likeCommunityMap(id: string, on: boolean): Promise<{ likes: number; liked: boolean }>;

  /** GET /external-agents: the caller's own programs (bring your own agent). */
  externalAgents(): Promise<ExternalAgent[]>;
  /** POST /external-agents: registers one; the secret and token come back this once. */
  createExternalAgent(body: ExternalAgentBody & { name: string }): Promise<ExternalAgentSecret>;
  /** PATCH /external-agents/:id: name, bound agent (null unbinds), webhook (null: pull). */
  updateExternalAgent(id: string, body: ExternalAgentBody): Promise<ExternalAgent>;
  /** POST /external-agents/:id/rotate: a new secret; the old one stops working. */
  rotateExternalAgent(id: string): Promise<ExternalAgentSecret>;
  /** POST /external-agents/:id/ping: a signed ping to the webhook (pull: whether it was seen). */
  pingExternalAgent(id: string): Promise<ExternalAgentPing>;
  deleteExternalAgent(id: string): Promise<{ deleted: true }>;
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
    agentProgression: (id) => get(`/agents/${enc(id)}/progression`),
    pickTrait: (id, trait) => json('POST', `/agents/${enc(id)}/traits`, { body: { trait } }),
    rentalOffers: () => get('/rentals'),
    myRentals: () => get('/rentals/mine'),
    setRentalOffer: (id, priceYocto) => json('PUT', `/agents/${enc(id)}/rental`, { body: { priceYocto } }),
    rent: (offerId, txHash) => json('POST', `/rentals/${enc(offerId)}`, { body: { txHash } }),
    rentWithCredits: (offerId, key) => json('POST', `/rentals/${enc(offerId)}`, { body: { credits: true, key } }),
    patchAgent: (id, patch) => json('PATCH', `/agents/${enc(id)}`, { body: patch }),

    skills: (tab = 'written') => get('/skills', { tab }),
    createSkill: (body) => json('POST', '/skills', { body }),
    updateSkill: (id, body) => json('PUT', `/skills/${enc(id)}`, { body }),
    skill: (id, version) => get(`/skills/${enc(id)}`, { version }),
    mintSkill: (id, version) =>
      json('POST', `/skills/${enc(id)}/mint`, { body: version !== undefined ? { version } : {} }),

    playbooks: () => get('/playbooks'),
    playbook: (id) => get(`/playbooks/${enc(id)}`),
    createPlaybook: (body) => json('POST', '/playbooks', { body }),
    updatePlaybook: (id, body) => json('PUT', `/playbooks/${enc(id)}`, { body }),
    deletePlaybook: (id) => json('DELETE', `/playbooks/${enc(id)}`),
    selectPlaybook: (id) => json('POST', '/playbooks/select', { body: { id } }),

    market: (q = {}) => get('/market', { tag: q.tag, sort: q.sort }),
    marketSkill: (id, version) => get(`/market/${enc(id)}`, { version }),
    listSkill: (id, body) => json('POST', `/market/${enc(id)}/listing`, { body }),
    purchaseSkill: (id, body) => json('POST', `/market/${enc(id)}/purchase`, { body }),
    startTrial: (id, body) => json('POST', `/market/${enc(id)}/trial`, { body }),
    trials: (id, version) => get(`/market/${enc(id)}/trials`, { version }),

    benchInfo: () => get('/bench'),
    startBenchRun: (body) => json('POST', '/bench/runs', { body }),
    benchRuns: (skillId) => get('/bench/runs', { skillId }),
    benchRun: (id) => get(`/bench/runs/${enc(id)}`),
    compareBenchRuns: (a, b) => get('/bench/compare', { a, b }),

    daily: () => get('/daily'),
    startDailyAttempt: (agentIds) => json('POST', '/daily/attempts', { body: agentIds ? { agentIds } : {} }),
    dailyBoard: (date) => get('/daily/leaderboard', { date }),

    currentSeason: () => get('/seasons/current'),
    seasonStandings: (id, page = {}) => get(`/seasons/${enc(id)}/standings`, { limit: page.limit, offset: page.offset }),
    seasons: () => get('/seasons'),

    cosmetics: () => get('/cosmetics'),
    buyCosmetic: (id) => json('POST', `/cosmetics/${enc(id)}/buy`),

    quests: () => get('/quests'),
    claimQuest: (id) => json('POST', `/quests/${enc(id)}/claim`),
    achievements: () => get('/achievements'),
    mintBadge: (id) => json('POST', `/achievements/${enc(id)}/badge`),

    credits: () => get('/credits'),
    deposit: (txHash) => json('POST', '/credits/deposits', { body: { txHash } }),

    playerLadder: (limit) => get('/leaderboards/players', { limit }),
    mapLadder: (mapId, limit) => get(`/leaderboards/maps/${enc(mapId)}`, { limit }),
    skillLadder: (opts = {}) => get('/leaderboards/skills', { mapId: opts.mapId, limit: opts.limit }),
    v2Match: (id) => get(`/v2/matches/${enc(id)}`),
    v2LiveMatches: () => get('/v2/matches/live'),
    v2Highlights: (id) => get(`/v2/matches/${enc(id)}/highlights`),
    createReplayShare: (id, clip) => json('POST', `/v2/matches/${enc(id)}/shares`, { body: clip ? { clip } : {} }),
    replayShares: (id) => get(`/v2/matches/${enc(id)}/shares`),
    sharedReplay: (id, opts = {}) => get(`/replays/${enc(id)}`, opts.frames === false ? { frames: 0 } : undefined),
    revokeReplayShare: (id) => json('DELETE', `/replays/${enc(id)}`),
    v2MatchDecisions: (id) => get(`/v2/matches/${enc(id)}/decisions`),

    createLobby: (settings) => json('POST', '/lobbies', { body: settings }),
    myLobbies: () => get('/lobbies'),
    lobby: (id) => get(`/lobbies/${enc(id)}`),
    lobbyByCode: (code) => get(`/lobbies/code/${enc(code)}`),
    joinLobby: (code) => json('POST', '/lobbies/join', { body: { code } }),
    updateLobby: (id, patch) => json('PATCH', `/lobbies/${enc(id)}`, { body: patch }),
    leaveLobby: (id) => json('DELETE', `/lobbies/${enc(id)}`),
    tournaments: (status) => get('/tournaments', { status }),
    tournament: (id) => get(`/tournaments/${enc(id)}`),
    createTournament: (body) => json('POST', '/tournaments', { body }),
    joinTournament: (id) => json('POST', `/tournaments/${enc(id)}/join`),
    leaveTournament: (id) => json('POST', `/tournaments/${enc(id)}/leave`),
    cancelTournament: (id) => json('POST', `/tournaments/${enc(id)}/cancel`),
    onboarding: () => get('/onboarding'),
    updateTutorial: (body) => json('PUT', '/onboarding/tutorial', { body }),
    dismissChecklist: () => json('POST', '/onboarding/checklist/dismiss'),
    skillTemplates: () => get('/onboarding/templates'),
    copyTemplate: (id) => json('POST', `/onboarding/templates/${enc(id)}/copy`),
    campaign: () => get('/campaign'),
    startMission: (id) => json('POST', `/campaign/missions/${enc(id)}/start`),
    puzzles: () => get('/puzzles'),
    puzzle: (id) => get(`/puzzles/${enc(id)}`),
    startPuzzleRun: (id, body) => json('POST', `/puzzles/${enc(id)}/runs`, { body }),
    puzzleRun: (id, runId) => get(`/puzzles/${enc(id)}/runs/${enc(runId)}`),
    puzzleLeaderboard: (id) => get(`/puzzles/${enc(id)}/leaderboard`),

    externalAgents: () => get('/external-agents'),
    createExternalAgent: (body) => json('POST', '/external-agents', { body }),
    updateExternalAgent: (id, body) => json('PATCH', `/external-agents/${enc(id)}`, { body }),
    rotateExternalAgent: (id) => json('POST', `/external-agents/${enc(id)}/rotate`),
    pingExternalAgent: (id) => json('POST', `/external-agents/${enc(id)}/ping`),
    deleteExternalAgent: (id) => json('DELETE', `/external-agents/${enc(id)}`),

    communityMaps: (sort = 'new') => get('/community-maps', { sort }),
    myCommunityMaps: () => get('/community-maps/mine'),
    communityMap: (id) => get(`/community-maps/${enc(id)}`),
    createCommunityMap: (body) => json('POST', '/community-maps', { body }),
    updateCommunityMap: (id, body) => json('PUT', `/community-maps/${enc(id)}`, { body }),
    deleteCommunityMap: (id) => json('DELETE', `/community-maps/${enc(id)}`),
    publishCommunityMap: (id) => json('POST', `/community-maps/${enc(id)}/publish`),
    testPlayMap: (map) => json('POST', '/community-maps/test-play', { body: { map } }),
    likeCommunityMap: (id, on) => json(on ? 'POST' : 'DELETE', `/community-maps/${enc(id)}/like`),
  };
}
