# @skirm/web

The skirm web app: Next.js 16 (App Router, Turbopack), React 19, TypeScript, TanStack Query v5 for
REST data, one shared WebSocket for v2 matches (queue, accept, lock-in, live, spectate), and
`@skirm/ui` for every component.

Backend shapes: `src/lib/api/types.ts` (mirrors `apps/api/src/views.ts` and the controllers).

## Run it

```bash
apps/web/scripts/dev-backend.sh start     # Postgres + Redis (started if down), build, migrate,
                                          # api :4000, worker, realtime ws://localhost:4001/ws
npm run dev -w @skirm/web                 # http://localhost:3000 (sign in with any handle)
apps/web/scripts/dev-backend.sh stop      # stops api/worker/realtime (leaves Postgres/Redis up)
```

`dev-backend.sh` also has `status`, `restart` and `logs [api|worker|realtime]`. It pins
`AUTH_MODE=dev` and `V2_BRAIN=greedy` (the offline greedy brain: no model key, no spend), and
passes `V2_TICK_MS` through (default 2000, as in production). Logs are in `/tmp/skirm-dev-backend/`.

The quickest way to see a whole match: sign in with any handle, open Play, pick **Quick practice**
(Vs Greedy bot on Copper Hollow, Easy), Accept, Lock in, and watch it play out to the debrief. A
practice match is free on the greedy brain. For fast matches (the practice e2e needs them):

```bash
V2_TICK_MS=200 apps/web/scripts/dev-backend.sh restart
```

Web config (`.env.example`; `NEXT_PUBLIC_*` is inlined at build time):

| Var | Default |
| --- | --- |
| `NEXT_PUBLIC_SITE_URL` | `https://playskirm.xyz` (canonical URLs, link previews, sitemap) |
| `NEXT_PUBLIC_API_URL` | `http://localhost:4000` |
| `NEXT_PUBLIC_WS_URL` | `ws://localhost:4001/ws` |
| `NEXT_PUBLIC_AUTH_MODE` | `dev`: handle sign-in, `dev:` receipts, no wallet. `privy`: Privy sign-in, real NEAR wallet (see Session, Wallet) |
| `NEXT_PUBLIC_PRIVY_APP_ID` | empty (privy mode: required; must match the api's `PRIVY_APP_ID`) |
| `NEXT_PUBLIC_PRIVY_CLIENT_ID` | empty (optional Privy app client id) |
| `NEXT_PUBLIC_NEAR_NETWORK` | `testnet` (or `mainnet`) |
| `NEXT_PUBLIC_NEAR_RPC_URL` | FastNEAR for the network (`https://test.rpc.fastnear.com`); read-only calls such as the header's NEAR balance |
| `NEXT_PUBLIC_NEAR_CONTRACT_SKILLS` | `skills.playskirm.testnet` |
| `NEXT_PUBLIC_NEAR_CONTRACT_MARKET` | `market.playskirm.testnet` |
| `NEXT_PUBLIC_NEAR_CONTRACT_DEPOSITS` | `deposits.playskirm.testnet` |
| `NEXT_PUBLIC_NEAR_CONTRACT_REGISTRY` | `registry.playskirm.testnet` |

The contract ids must match the api's `NEAR_CONTRACT_*` (it verifies the hashes against them).

The api allows CORS from `CORS_ORIGINS` (default `http://localhost:3000`), so use port 3000.

Scripts (`npm run <x> -w @skirm/web`): `dev`, `build`, `start`, `test` (Vitest), `typecheck`
(`next typegen && tsc --noEmit`), `e2e` (Playwright).

## Layout

```
src/
  app/                              routes only (thin server components)
    layout.tsx                      root: CSS + <Providers>
    page.tsx                        S01 Sign in (no header)
    globals.css                     app-* classes, S01 styles
    not-found.tsx, error.tsx
    (shell)/layout.tsx              <AppShell>: header + main for every other screen
    (shell)/(play)/...              Play: home, maps, campaign, daily, puzzles, crew, agents
    (shell)/(skills)/...            Skills and the Exchange
    (shell)/(pvp)/...               PvP: hub, lobbies, tournaments, matches, replays, verify
    (shell)/(account)/...           Profile and credits
  features/<group>/                 screens and their private components, per section
    play/  skills/  pvp/  account/  campaign/  daily/  puzzles/  lobbies/  verify/  …
  components/                       Providers, shell (TopBar, AppShell, RequireSession),
                                            states (Skeleton, ErrorCard, EmptyState, QueryView),
                                            toast, ButtonLink, ScreenPlaceholder
  lib/
    config.ts                       NEXT_PUBLIC_* config
    constants.ts                    allowance, starter agents, DEFAULT_CREDITS_PER_NEAR, NEAR
                                    formatting (formatNear; parseNear is strict and throws)
    preferences/                    usePreferences(): theme, replay speed, reduced motion, …
    routes.ts                       every screen URL + nav group of a path
    services.tsx                    useApi(), useRealtime(), useServices()
    api/client.ts, types.ts, errors.ts, queries.ts
    auth/credentials.ts, session.tsx, privy.ts, PrivyRoot.tsx (the only Privy SDK import), drafts.ts
    wallet/types.ts, contracts.ts, nearConnect.ts, hooks.ts   NEAR wallet (NEAR Connect)
    realtime/client.ts, protocol.ts, hooks.ts
  test/                             setup, renderWithProviders, fakes, fixtures, router mock
e2e/                                Playwright specs (one file per group: practice.spec.ts, …)
scripts/dev-backend.sh              native backend for dev and e2e
```

Route groups `(play)`, `(skills)`, `(pvp)`, … group the routes by section; they add no layout and
no URL segment.

## Screens

| Section | Screen | Route | Screen component |
| --- | --- | --- | --- |
| Play | Sign in (pitch, practice line) | `/` | `features/play/SignInScreen.tsx` |
| Play | Home (Command deck) | `/play` | `features/play/HomeScreen.tsx` |
| Play | Map atlas, community maps | `/maps` (`?tab=community`) | `features/play/AtlasScreen.tsx` |
| Play | Map editor | `/maps/editor` | `features/maps/MapEditorScreen.tsx` |
| Play | Tutorial (guided first match) | `/tutorial` | `features/onboarding/TutorialScreen.tsx` |
| Play | Campaign (missions vs the bot) | `/campaign` | `features/campaign/CampaignScreen.tsx` |
| Play | Daily challenge | `/daily` | `features/daily/DailyScreen.tsx` |
| Play | Puzzles, one puzzle | `/puzzles`, `/puzzles/[puzzleId]` | `features/puzzles/PuzzlesScreen.tsx`, `PuzzleScreen.tsx` |
| Play | Crew (casual, ranked, vs the bot) | `/maps/[mapId]/crew` (`?d=`, `?opponent=bot`) | `features/play/CrewBuilderScreenV2.tsx` |
| Play | Agent editor | `/agents/[agentId]` | `features/agents/AgentEditorScreen.tsx` |
| Skills | My skills | `/skills` | `features/skills/MySkillsScreen.tsx` |
| Skills | Skill editor | `/skills/new`, `/skills/[skillId]/edit` | `features/skills/SkillEditorScreen.tsx` |
| Skills | Skill test bench | `/skills/bench`, `/skills/bench/[runId]` | `features/skills/bench/BenchScreen.tsx` |
| Exchange | Exchange (marketplace) | `/market` | `features/skills/MarketplaceScreen.tsx` |
| Exchange | Skill detail (drawer) | `/market/[skillId]` | `features/skills/SkillDetailScreen.tsx` |
| Exchange | Writer backing | `/backing` | `features/backing/BackingScreen.tsx` |
| PvP | PvP hub (ranked, casual, draft queues) | `/pvp` | `features/pvp/PvpLobbyScreen.tsx` |
| PvP | Private lobbies, a lobby, join by code | `/lobbies`, `/lobbies/[lobbyId]`, `/lobbies/join/[code]` | `features/lobbies/LobbiesScreen.tsx`, `LobbyScreen.tsx` |
| PvP | Tournaments, a bracket | `/tournaments`, `/tournaments/[id]` | `features/lobbies/TournamentsScreen.tsx`, `TournamentScreen.tsx` |
| PvP | Match: accept, lock-in, live, end (players and spectators) | `/matches/[matchId]` | `features/v2/V2MatchScreen.tsx` |
| PvP | Match result (debrief) | `/matches/[matchId]/result` | `features/v2/Ended.tsx` (`V2ResultScreen`) |
| PvP | Shared replay | `/replays/[shareId]` | `features/replays/SharedReplayScreen.tsx` |
| PvP | Verify a match on NEAR | `/verify` (`?id=`) | `features/verify/VerifyScreen.tsx` |
| Leaderboards | Season, all-time, map and skill boards | `/leaderboards` | `features/pvp/LeaderboardsScreen.tsx` |
| Account | Profile: rank, agents, recent matches, settings | `/account` | `features/account/ProfileScreen.tsx` |
| Account | Credits | `/account/credits` | `features/account/CreditsScreen.tsx` |
| Legal | Terms, privacy | `/terms`, `/privacy` | `app/(shell)/…/page.tsx` |

Every screen renders inside the header with a root `data-testid` and, where it needs an account,
inside `<RequireSession>`. Public screens (no session needed): sign in, leaderboards, matches and
their debriefs, shared replays, puzzles, verify and the legal pages. The api returns extra fields
for a signed-in player of the match (`you`, `debrief`).

## Conventions

- Build from `@skirm/ui` (`TopUpPanel`, `Modal`, `Tabs`, `TextField`, `Badge`, `TagChip`,
  `AgentAvatar`, `Icon`, …) and the arena pieces in `features/arena`.
- Styles: a CSS module next to the screen using tokens (`var(--surface)`, `var(--space-4)`, …).
  Global helpers: `app-card`, `app-row`, `app-stack`, `app-h1..3`, `app-banner is-warning|is-critical`,
  `sk-muted`, `sk-mono`. Phones from 360 px: 16 px gutters (the shell already pads), no horizontal
  page scroll (wide tables sit in an `overflow-x: auto` wrapper).
- Links: `routes.*` from `src/lib/routes.ts` with `next/link`; a link that looks like a button is
  `<ButtonLink>` (never a `<button>` inside `<a>`).
- Copy: "credits", "step", "network fee"; sentence case; verb + object buttons. Errors say what
  happened and what to do; the code goes in a Details disclosure (`ErrorCard` and `toast.error`).
- Server components are only the `page.tsx` files; screens are `'use client'`.
- The top bar's design notes (Notes, N) are internal: on in development, off in production builds
  unless `NEXT_PUBLIC_DESIGN_NOTES=1`.

Next 16 notes: `params` is a Promise (`const { matchId } = await params` in `page.tsx`);
`useSearchParams()` in a statically rendered page needs a `<Suspense>` boundary (or read
`window.location.search` in handlers); `error.tsx` gets `retry`, not `reset`. Docs for this exact
version: `node_modules/next/dist/docs/`.

## Data: REST

`useApi()` returns the typed client (`src/lib/api/client.ts`): one method per api route, e.g.
`api.me()`, `api.myMatches()`, `api.v2Match(id)`, `api.skills('owned')`,
`api.purchaseSkill(id, { txHash })`. It sends the session's credentials itself and throws `ApiError`
(`status`, `code`, `message`, `details`, `extra`; `err.shortfall` gives `{need, have}` on 402;
`status 0` / `code 'network'` when offline).

Fetch with TanStack Query, keys from `qk` (`src/lib/api/queries.ts`):

```tsx
const api = useApi();
const { status } = useSession();
const match = useQuery({ queryKey: qk.matches.v2(matchId), queryFn: () => api.v2Match(matchId) });

const qc = useQueryClient();
const save = useMutation({
  mutationFn: (patch: AgentPatch) => api.patchAgent(agentId, patch),
  onSuccess: () => void qc.invalidateQueries({ queryKey: qk.me }),
  onError: (err) => toast.error(err),
});

<QueryView query={match} loading={<Skeleton rows={6} />}>{(m) => <p>{m.winner}</p>}</QueryView>
```

Ready-made hooks: `useMe()` (account, rank, credits, agents; the header uses it, so it is usually
cached), `useMyMatches()` (`GET /me/matches`, under `qk.me`), `useCurrentSeason()`,
`useSeasonStandings()`, `useV2LiveMatches()`, `useTrials()`, `useCosmetics()`. 4xx errors are not
retried; network and 5xx retry twice. When a v2 match the tab plays or watches ends (`v2_end`),
`me` (rank, earn-back, recent matches), `credits`, `leaderboards`, `seasons` and `matches` are
invalidated automatically (`components/Providers.tsx`). After your own mutations invalidate what
they change (`qk.me` after anything that moves credits or agents).

Backend facts worth knowing: extra error codes (`near_account_taken`, `rate_limited`, `trial_limit`,
`cosmetic_not_owned`, `queue_unavailable`, `free_budget_exhausted`, …, listed in
`src/lib/api/errors.ts`); listings carry the M02 `split`; dev mode accepts `txHash: 'dev:<yocto>'`
for deposits and purchases; linking a NEAR account is `POST /auth/session { nearAccountId }` (dev
mode trusts it).

Shapes worth knowing (all in `src/lib/api/types.ts`):
- `me.rank` (`elo`, `rankedMatches`, `wins`, `losses`, `draws`, `title`, `position`),
  `me.creditsPerNear` and `credits.creditsPerNear` (server `CREDITS_PER_NEAR`;
  `DEFAULT_CREDITS_PER_NEAR` in `lib/constants` before they load), `me.royaltiesYocto` (creator
  royalties, all skills), `me.cosmetics` and `me.account.createdAt` ("Joined").
- `api.myMatches()` (`GET /me/matches`): `{ id, mapId, ranked, practice, result, score, endedAt,
  eloDelta }[]`, newest first; `result` is the caller's `'win' | 'loss' | 'draw' | 'void'`, or
  `'live'` while it plays, `score` is `{ you, rival }`.
- Ledger rows (`GET /credits`) name their v2 match as `matchId` (null for top-ups, free grants and
  premium looks); the Credits ledger links each to its result.
- `api.unlinkNear()` (`DELETE /me/near` → `{ account }`; 409 `listing_active` while the player has
  an open listing).
- `GET /skills?tab=written` rows carry `royaltiesYocto` per skill.
- `parseNear` is strict: digits with an optional 1–24 decimals; "1.2.3", "-1", "1e3", "1,5", ".5",
  "1." and 25+ decimals throw.

More api and realtime shapes:
- `api.playerLadder(limit?)` (`GET /leaderboards/players` → `{ rows, you? }`, `qk.leaderboards.players`),
  `api.earnBack()` (`GET /me/earn-back`, `qk.earnBack`; `rentalsYocto` is what agent rentals earned),
  agent rentals (`api.rentalOffers()` / `myRentals()` / `setRentalOffer()` / `rent()`; the agent
  editor's Rent out tile and the crew screen's RentShelf),
  `api.v2Match(id)` (`GET /v2/matches/:id`, `qk.matches.v2(id)`), `api.v2LiveMatches()`,
  `api.currentSeason()`, `api.seasonStandings(id)`, `api.startTrial(id, body)` / `api.trials(id)`,
  `api.cosmetics()` / `api.buyCosmetic(id)`, `api.patchAgent(id, { systemPrompt })`
  (≤ `AGENT_SYSTEM_PROMPT_MAX` = 600), `marketSkill(id).pinned` (version hash), `.benchmark`,
  `.ranked`, `.counters`, `.trials`. Rank titles: `rankTitle(elo)` from `@skirm/shared`.
- Realtime: `v2_queue { mapId, difficulty }` (casual), `v2_queue { opponent: 'bot' }` (practice),
  `v2_lock_in { crew }`, `v2_lockin { crewLimit, headStartTicks }`, `v2_found { difficulty, practice,
  free, rivalHandle }`, `v2_end { debrief }`, `v2_replay` → `v2_frames`; frames carry
  `agents[].items` (`{ kind, origin }`) and own-crew `plan` / `planHidden`, `planWhy` (the planner
  trace) and `thought` (the agent's inner voice this tick). The v2 store keeps them.
- Difficulty: `Difficulty`, `DIFFICULTIES`, `DIFF_MODS`, goals `MATCH_GOALS` / `goalFor` in
  `@skirm/engine/v2`; the prototype's `DIFFS`, `GOALS`, `goalOf` typed in `features/arena/world.ts`.
  Practice data: `BOT_HANDLE`, `PRACTICE_MAPS`, `DEFAULT_PRACTICE` from `@skirm/engine/v2`.
- Routes: `routes.match(id)` and `routes.matchResult(id)` are the match and its debrief,
  `routes.practice({ mapId, difficulty })`, `routes.crew(mapId, difficulty?)`,
  `routes.agent(id)`. Arena scenes `agent`, `follow`, `intro`, `tpv`; the live screen points the
  camera with `arenaStore().setView({ mode, focus })` (`OVERVIEW` to reset).
- `features/arena/chase3d`: `mountChaseCam(el, getState, { onFail })` and a `ChaseCam` default export for
  `next/dynamic` (`three` is pinned in `package.json`, loaded only there).
- "Soon" features use `<Soon what="Agent rentals" />` from `@skirm/ui`: never a mock number.

## Preferences

`usePreferences()` (`src/lib/preferences`) is the S16 Settings store, per browser
(`localStorage['skirm.prefs.v1']`, every access in try/catch, synced across tabs):

```tsx
const { prefs, reducedMotion, systemReducedMotion, set, reset } = usePreferences();
prefs.sfx                // interface sound effects, default true
prefs.replaySpeed        // 0.5 | 1 | 2 | 4, default 1 (also the reduced-motion default)
prefs.showProbabilities  // default true
prefs.showTagNames       // default false
reducedMotion            // resolved: prefs.reducedMotion ?? prefers-reduced-motion
set({ reducedMotion: true }); set({ reducedMotion: null }) // null = follow the OS again
```

Server render and hydration see the defaults. Screens adopt it as they need it.

## Session

`useSession()` gives `{ status: 'loading' | 'signedOut' | 'signedIn', handle, signIn, signOut }`.
`'loading'` lasts only through hydration (render a skeleton, not "signed out"). Wrap screens that
need an account in `<RequireSession>` (it shows "Sign in to continue" with `?next=` back here).
Dev mode keeps the handle in `localStorage['skirm.devUser']` and sends it as `x-dev-user`; S01
calls `POST /auth/session`, which creates the account with the starter defaults.
Sign-out (and signing in as another handle, or a session the server refuses) removes every
`localStorage['skirm.skillEditor.unsaved.*']` key (`clearPrivateDrafts()` in `lib/auth/drafts.ts`):
unsaved skill drafts hold secret prompt text, so S08 must keep its drafts under that prefix.
Privy (`NEXT_PUBLIC_AUTH_MODE=privy` + `NEXT_PUBLIC_PRIVY_APP_ID`): S01 shows Google/email buttons
that open Privy (`@privy-io/react-auth`). `<Providers>` loads `src/lib/auth/PrivyRoot.tsx` with a
dynamic import after hydration, beside the app (dev builds never fetch it); the session talks to it
through the controller in `src/lib/auth/privy.ts`. Login → `getAccessToken()` → credentials
`{ kind: 'privy', token }` → `POST /auth/session { token }`, `Authorization: Bearer` on every call,
`{type:'auth', token}` on the WebSocket. A session Privy restored on reload is picked up without a
click (status stays `'loading'` until Privy is ready, at most 10 s); the token is refreshed a minute
before it expires (and when a tab comes back with a stale one); sign-out also logs out of Privy, and a
token the api refuses (401/403) ends the Privy session. Without an app id the buttons say sign-in is
not set up. Tests: `FakePrivy` (`src/test/fakePrivy.ts`), `renderWithProviders(ui, { authMode:
'privy', token: 'jwt' })`; `src/lib/auth/privy.test.tsx` mocks the SDK itself.

## Wallet

Outside dev mode money and ownership go through the player's NEAR wallet: NEAR Connect
(`@hot-labs/near-connect`: HOT, Meteor, MyNearWallet, Intear, Nightly, OKX, ...), loaded on the
first wallet action only. `useNearSigner()` / `useWallet()` / `useWalletAccount()`
(`src/lib/wallet/hooks.ts`); transactions are built in `src/lib/wallet/contracts.ts`:

| Flow | Wallet signs | Then the api |
| --- | --- | --- |
| M01 link | NEP-413 `signMessage("skirm:link-near:<account id>:<near id>")`, 32-byte nonce, recipient = site host | `POST /auth/session { nearAccountId, nearProof }` |
| S15 top up | `deposits.deposit()` with the amount attached, 30 Tgas | `POST /credits/deposits { txHash }` |
| S10 buy | `market.buy({token_id})` with the price attached, 150 Tgas | `POST /market/:id/purchase { txHash, version }` |
| S10 list / reprice | `skills.nft_approve({token_id, account_id: market, msg: {"price"}})`, 0.01 NEAR storage, 100 Tgas | `POST /market/:id/listing { priceYocto, version, txHash }` |
| S08 mint | nothing: the api mints with the ops key to the linked account (M01 only links) | `POST /skills/:id/mint` |

The wallet must be signed in as the linked account (otherwise it is signed out and M02 says which
account to pick). A signed transaction whose api call failed is re-sent on "Try again", never signed
twice. Dev mode keeps the `dev:<yocto>:<nonce>` receipts and never touches the wallet. Tests:
`FakeWallet` (`src/test/fakeWallet.ts`), passed as `renderWithProviders(ui, { wallet })`.

## Realtime

One WebSocket per tab (`src/lib/realtime/client.ts`), opened on first use, authenticated on open,
reconnected with backoff (0.5 s doubling to 10 s), v2 watches refcounted and re-sent after a
reconnect. Match state lives in the tab's v2 store (`features/v2/v2Store.ts`), fed by every v2
message; screens read it with `useV2Match(matchId)`. The hooks (`src/lib/realtime/hooks.ts`):

```tsx
const status = useRealtimeStatus();                         // 'reconnecting' → "Reconnecting..."
useRealtimeMessage((m) => { if (m.type === 'v2_found') router.push(routes.match(m.matchId)); });
const rt = useRealtime();
rt.send({ type: 'v2_queue', ranked: false, opponent: 'bot', crew });  // practice, starts at once
rt.send({ type: 'v2_cancel_queue' });
const stop = rt.watchV2(matchId);                           // spectate: whole-board frames
```

`watchV2` sends `v2_watch` for the first watcher of a match and `v2_unwatch` after the last; the
server drops the watch at `v2_end`. A queue entry does not survive a reconnect (re-queue when status
returns to `open`). Errors arrive as `{type:'error', code, message}` through `useRealtimeMessage`.
Message types: `src/lib/realtime/protocol.ts`.

## Toasts

`const toast = useToast(); toast.show({ tone: 'good', title: 'Saved', message: 'Saved 14:02' });
toast.error(err)` (ApiError → spec copy + Details code). Critical toasts stay until dismissed.

## Testing

**Component tests** (Vitest + Testing Library + jsdom): `*.test.tsx` next to the code.

```tsx
import { renderWithProviders } from '@/test/render';
import { meFixture, myMatchFixture, v2FrameFixture } from '@/test/fixtures';

const { api, realtime, user, router } = renderWithProviders(<V2CrewScreen mapId="copper-hollow" />, {
  handle: 'ada',                                   // signed in; omit for signed out
  search: '?opponent=bot',                         // useSearchParams()
  api: { me: async () => meFixture(), myMatches: async () => [myMatchFixture()] },
});
expect(await screen.findByTestId('screen-s04')).toBeInTheDocument();
expect(realtime.sentOf('v2_queue')).toEqual([]);
act(() => realtime.emit({ type: 'v2_frame', matchId: 'mat_1', frame: v2FrameFixture({ tick: 3 }) }));
```

- The fake api rejects any method you did not stub ("fake api: X not stubbed"); every method is a
  `vi.fn`. Throw `new ApiError(402, 'insufficient_credits', '…', undefined, { need: 150, have: 80 })`
  to test error states.
- `FakeRealtime` records `sent` (`sentOf(type)`), counts `v2Watchers(id)`, and has `emit(msg)` and
  `setStatus(s)`.
- `next/navigation` is mocked (`src/test/router.ts`); assert on `router.push/replace`.
- Cover each screen's states from the spec table (empty, loading, error, out of credits, free
  budget used, offline / reconnecting) and keyboard paths, not only the happy path.

**data-testids**: the convention every screen follows:
- screen root: `screen-s01` … `screen-s16`; modals: `m01-…`, `m02-…`, `m03-…`.
- inside a screen: `sNN-<thing>` in kebab case, e.g. `s09-tag-filter-liquid`, `s11-find-match`,
  `s16-rank-elo`; the v2 match screens use `v2-<thing>` (`v2-accept`, `v2-verdict`). Repeated rows add an id: `s07-skill-row-<skillId>`.
- shared: `topbar`, `nav-play|skills|market|pvp|leaderboards`, `topbar-credits`,
  `topbar-allowance`, `topbar-account`, `topbar-signin`, `account-badge`, `signin-required`, `skeleton`,
  `error-card`, `empty-state`, `toasts`.
Prefer `getByRole`/`getByLabelText` in tests where they read well; testids are for e2e and
judges.

**Browser e2e** (Playwright, real backend; Chromium is preinstalled, never `playwright install`):

```bash
V2_TICK_MS=200 apps/web/scripts/dev-backend.sh start
npm run e2e -w @skirm/web       # builds and serves the app on :3000 (reuses a running one)
E2E_SKIP_BUILD=1 npm run e2e -w @skirm/web   # serve the existing .next build
```

One spec file per group (`e2e/practice.spec.ts`, `e2e/pvp.spec.ts`, `e2e/skills.spec.ts`,
`e2e/account.spec.ts`, `e2e/wallet.spec.ts`); `e2e/signin.spec.ts` is shared. Use `signIn(page)`
from `e2e/helpers.ts`: it signs in as a fresh unique handle, so tests never share accounts. Matches
play on the greedy brain (`V2_BRAIN=greedy`), so no model key is needed; `practice.spec.ts` needs
200 ms ticks to finish in time.

## Not done here

- **Docker / compose**: `docker/node.Dockerfile --build-arg APP=web` builds with
  `NEXT_OUTPUT=standalone` (`next.config.ts` turns on `output: 'standalone'` only then, since
  `next start` warns under it) and runs `node apps/web/server.js` on :3000. The public URLs are
  build args (`NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_WS_URL`, `NEXT_PUBLIC_AUTH_MODE`); compose fills
  them from `PUBLIC_API_URL` / `PUBLIC_WS_URL` / `AUTH_MODE`. Note: the root `npm ci --omit=dev`
  in that Dockerfile also installs `next` and `react` into the backend images (unused there).
- **Privy and wallet with real credentials**: verified with mocks and builds only (no Privy app id,
  no deployed testnet contracts in this repo's CI). Privy's embedded NEAR wallet is not used; players
  link their own wallet through M01.
- **CI**: `.github/workflows/ci.yml` runs typecheck and tests for every workspace (the web included)
  and the contracts' `cargo test` on pushes to `main`. The Playwright e2e runs by hand against
  `dev-backend.sh`.
