# Promptlings System Architecture
2026-10-25 · @Tyron
**Proposed: everything offchain runs in one GCP project in us-central1 (Iowa) on Cloud Run; only ownership, trades, deposits and results go to NEAR testnet.** Five containers come from one monorepo: web, api, realtime, worker and a migrate job. Postgres, Redis, Cloud Storage, Secret Manager and Cloud KMS sit beside them in the same region. The players are in the Philippines and only watch during a run, so the region is chosen for the model calls, not for the players. All hosting choices here are proposed for the team to confirm.
| Decision | Choice (proposed) | Why |
| Cloud | GCP primary; AWS equivalents listed below | Team is strong on GCP; Cloud Run covers HTTP, WebSockets and background workers with one deploy tool |
| Region | us-central1 for all compute and data | Keeps the 1.5–2.5 s per-action budget for the models, which are reached from the US; Tier 1 prices; the Cloud Storage free tier is US-only |
| Web app (Next.js) | Cloud Run service `web`, not Vercel | One cloud, one CI pipeline and the same container in Docker Compose. Vercel Hobby is limited to non-commercial use, and SSR calls to `api` stay in-region |
| API (NestJS) | Cloud Run service `api`, request-based billing, scales to zero | Stateless REST: auth, credits ledger, skills, runs, marketplace index |
| Match server | Cloud Run service `realtime`, 1 always-on instance, 60-minute request timeout, session affinity | Cloud Run WebSockets last up to 60 minutes, so a 10-minute match fits. One instance holds every match during the hackathon |
| Run workers | BullMQ on Redis, consumed by a Cloud Run worker pool `worker` | Redis is needed anyway for tick pub/sub. BullMQ runs the same in Docker Compose. Worker pools are GA since 14 Apr 2026 and cost less than an always-on service |
| Social login | Privy (email or Google, creates an embedded NEAR wallet); NEAR Connect for players who already have a wallet | Both are documented on docs.near.org with testnet examples; Privy is free under 500 monthly active users |
| NEAR RPC (backend) | FASTNEAR testnet RPC, dRPC as fallback | NEAR's own testnet endpoint is listed as severely rate limited |

## Hosting overview
<embed {'caption': 'hosting overview · 4 trust zones, 5 containers, 5 managed data services', 'ref': 'node/84aa71b0-5bd0'}>
The browser talks to three Cloud Run services and, for money and ownership, straight to NEAR through the player's own wallet. Nothing in the data row has a public endpoint. Only `worker` and `realtime` call the model providers, and they decrypt skill prompts only to build those calls.
## Service inventory
**Five containers, six managed GCP services, five NEAR contracts and five outside APIs run Promptlings.** `api`, `realtime` and `worker` are three NestJS apps in one monorepo. They share the engine package, the decision engine module and the ledger module, so a rule or a price changes in one place. Scaling values are proposed starting points for staging.
| Service | What it does | Hosted on | Scaling (proposed) | System index entry | Scope |
| `web` | Next.js app: screens S01–S16, skill editor, marketplace UI, live and replay viewer | Cloud Run service, us-central1 | Request-based, 0–3 instances | Web app, Skill editor, Marketplace UI | MVP |
| `api` | REST, auth (verifies Privy tokens), accounts and agents, skill vault writes, run start (credit hold + enqueue), credits ledger, deposit verification, leaderboards, marketplace index | Cloud Run service, us-central1 | Request-based, 0–5 instances, concurrency 80 | Run orchestrator (start), Credits ledger, Skill vault, Scoring and leaderboards, Login and wallets, Cost guardrails | MVP |
| `realtime` | WebSocket gateway for live solo runs and PvP; matchmaking; Race tick clock; PvP decision calls; match settlement | Cloud Run service, us-central1 | Instance-based billing, min 1, max 1, concurrency 1,000, timeout 3,600 s, session affinity on | PvP match server | MVP |
| `worker` | BullMQ consumer: solo runs and private skill tests (planner + actor calls, simulation engine), settlement, replay upload, registry writes | Cloud Run worker pool, us-central1 | 1 instance (manual), about 20 runs at once per instance | Run orchestrator (turn loop), Simulation engine, Agent decision engine, Replay log | MVP |
| `migrate` | Database migrations before each deploy | Cloud Run job, us-central1 | One task per deploy | Hosting and data | MVP |
| Cloud SQL for PostgreSQL | Accounts, agents, skills metadata and ciphertext, ledger, runs, matches, Elo, leaderboards | us-central1, db-f1-micro, 10 GiB SSD | Single zone on staging | Hosting and data | MVP |
| Memorystore for Redis | BullMQ queues, tick pub/sub, matchmaking queue, rate limits, daily free budget counter | us-central1, Basic tier, 1 GiB | Single node | Hosting and data, Cost guardrails | MVP |
| Cloud Storage | Replay logs (JSONL), map files by id and version | us-central1, two buckets: `replays`, `maps` | Managed | Replay log, Map format and validator | MVP |
| Secret Manager | Model API keys, NEAR platform keys, database password, Privy secret | Project-wide | Managed | Skill vault, Cost guardrails | MVP |
| Cloud KMS | Key that wraps each skill prompt's data key (envelope encryption) | us-central1 key ring `skill-vault` | Managed | Skill vault | MVP |
| Cloud Logging, Monitoring, Billing budgets | Tokens and cost per turn, latency, errors, budget alerts | Project-wide | Managed | Observability, Cost guardrails | MVP |
| `skills` contract | Skill NFTs (NEP-171 or NEP-245, still open) with NEP-199 payouts for royalties | NEAR testnet | Onchain | Skill NFT contract | MVP |
| `market` contract | List, buy and resell skills; pays royalty and platform fee | NEAR testnet | Onchain | Marketplace contract | MVP |
| `registry` contract | Run and match results, Elo, replay hashes | NEAR testnet | Onchain | Run and match registry | MVP |
| `deposits` contract | Receives NEAR top-ups and logs them for the ledger | NEAR testnet | Onchain | Deposit handling | MVP |
| `pool` contract | Holds a season's entry fees and pays the top scores | NEAR testnet | Onchain | Reward pool contract | Stretch |
| Anthropic API | Claude Haiku 5.5 planner; fallback actor | Third party (assumed US) | Monthly spend limit on the key | LLM providers | MVP |
| OpenRouter → TypeSafe Jev | Actor: one pick per agent per tick | Third party | Spend limit on the key | LLM providers | MVP |
| OpenAI Decisions API | Backup actor | Third party | Spend limit on the key | LLM providers | MVP |
| Privy | Social login and embedded NEAR wallet | Third party | Free plan to 499 monthly active users | Login and wallets | MVP |
| FASTNEAR RPC (dRPC fallback) | Backend reads and writes to NEAR testnet | Third party | Free tier | Deposit handling, Run and match registry | MVP |

Contract account names are proposed: `skills.promptlings.testnet`, `market.promptlings.testnet`, `registry.promptlings.testnet`, `deposits.promptlings.testnet`, `pool.promptlings.testnet`, plus a platform signer `ops.promptlings.testnet`. Systems not listed above live inside a container: Mechanics library, Map format and validator, Scoring and the Simulator tests are code in the engine package; Provider benchmark is a script run from a laptop.
## Region and latency
**Proposed: us-central1, because the model calls sit on the tick's critical path and the players do not.** Players pick a crew before Start and then only watch. A slower link to the player delays what they see but never changes the result. A slower link to the model can make an agent miss its time limit, and a missed action becomes `wait`.
Google Cloud has no region in the Philippines. The nearest are Singapore (asia-southeast1, Tier 2 prices), Bangkok (asia-southeast3, Tier 1) and Jakarta (asia-southeast2, Tier 2).
| Per tick | Free ranked | Paid ranked |
| Tick length | 3 s | 2 s |
| Per-action limit (tick − 0.5 s) | 2.5 s | 1.5 s |
| Jev pick on OpenRouter (concept figures) | 0.21 s median, 0.34 s p95 | same |
| Extra round trip per call if the server is in Singapore (estimate) | about 0.2 s | about 0.2 s |

| Option | What the player feels | What the agents feel | Price |
| **us-central1 (chosen)** | Each REST call about 0.2 s slower; the live stream arrives about 0.1 s later | Full budget for the model, short hop to US providers | Tier 1; the 5 GB Cloud Storage free tier applies (US regions only) |
| asia-southeast1 | Faster REST and stream | Every planner and actor call crosses the Pacific; less headroom at 1.5 s | Tier 2; no Cloud Storage free tier |

The round-trip figures are estimates. Measuring them is already on the Before 1 Nov list: time Jev and Haiku calls from a Cloud Run instance in each region, and page loads from Manila. If Jev's or Anthropic's endpoints turn out to be served from Asia, the choice flips to asia-southeast1. Cloud SQL, Redis and Cloud Storage must stay in the same region as the compute.
## Solo run
<embed {'caption': 'solo run sequence · 16 steps, one tick loop', 'ref': 'node/650d642c-5870'}>
**Money moves twice per run: a hold at Start and one settlement at the end.** Run states follow the Game Spec run lifecycle (`queued` → `credit_check` → `planning` → `ticking` → `ended`).
| Step | What happens | Runs on |
| 1 | Start on S04 sends map id and version, crew, unlocks and skills: `POST /runs` | browser → `api` |
| 2 | Checks ownership; hold = step limit × S(n) credits (S = 1, 2.5, 4.5 for 1–3 agents), daily allowance first. Flood Gate with one agent holds 60 | `api` → Cloud SQL |
| 3 | BullMQ job for the run | `api` → Redis |
| 4 | `202` with the run id; the browser opens S05 | `api` → browser |
| 5 | WebSocket subscribe to the run's channel | browser → `realtime` |
| 6 | Worker takes the job; about 20 runs at once per instance (proposed) | Redis → `worker` |
| 7 | Loads the map from Cloud Storage (cached), the skill ciphertext from Cloud SQL, and unwraps each data key with Cloud KMS | `worker` |
| 8 | `plan()` once per agent with Claude Haiku 5.5; replans about every 20 turns or after a big change | `worker` → Anthropic |
| 9 | `chooseAction()` per living agent with the legal actions in canonical order | `worker` → OpenRouter (Jev) |
| 10 | Engine applies the actions in agent order, then spread, damage and end checks; appends to the replay log | `worker` |
| 11–13 | Tick state, actions, probabilities and plan structure go out on Redis pub/sub; S05 shows 2 steps per second | `worker` → Redis → `realtime` → browser |
| 14 | Charge turns used by price weight, release the rest of the hold, upload the replay JSONL, update scores and leaderboards | `worker` → Cloud SQL, Cloud Storage |
| 15 | `record_run` with the result and the replay's SHA-256, signed with the platform's function-call key; retried as its own job | `worker` → NEAR `registry` |
| 16 | S06 reads the result; "Recorded on NEAR" shows once the transaction lands | browser → `api` |

## PvP Race
<embed {'caption': 'PvP Race data flow · matchmaking, tick loop, settlement', 'ref': 'node/9bf17d12-f661'}>
**The match lives in memory on the one ****`realtime`**** instance; Redis carries the queue and the tick fan-out so a second instance can be added later.** Both crews' picks go out together (`Promise.all`) with a deadline of tick − 0.5 s: 1.5 s on paid 2 s ticks, 2.5 s on free 3 s ticks. A pick that misses it becomes `wait` and still counts as a turn.
| Setting | Value | Why |
| Request timeout | 3,600 s (Cloud Run maximum) | Covers the 10-minute cap and the 5 s countdown; browsers reconnect on drop |
| Instances | min 1, max 1 | Every match and socket on one instance; up to 1,000 connections |
| Billing | Instance-based | Keeps the clock running when no player is connected |
| Session affinity | On | Reconnects land on the same instance when there are several |
| Settlement | Elo (start 1,200, K 32 for the first 20 ranked matches, then 16, floor 100); paid ranked charges credits; replay to Cloud Storage; `record_match` to the registry | Same ledger and registry path as solo |

In PvP the clock keeps running during a replan and the agent uses its old plan until the new one arrives (Game Spec, proposed).
## Money and ownership
<embed {'caption': 'money and ownership · 4 contracts onchain, ledger offchain', 'ref': 'node/9e1504b5-d95e'}>
**Two kinds of value, two homes: NEAR tokens and skill NFTs live onchain, credits live in Postgres.** In plain terms, a contract is a program on NEAR that holds tokens and enforces its own rules; the backend can read it but only the player's wallet can spend the player's NEAR.
| Flow | Who signs | What happens |
| Top up | Player's wallet | `deposits.deposit()` with NEAR attached. The browser sends the transaction hash to `api`, which reads it through RPC, checks the receiver and amount, and adds 1,000 credits per NEAR once per receipt (testnet placeholder rate) |
| Run | Nobody onchain | Hold, charge and refund are ledger rows; the daily 60 free credits (reset 00:00 UTC) are spent before the paid balance |
| Mint | Platform `ops` key (function-call key limited to `nft_mint`) | Creator presses Mint on S08; `api` mints the version's token to the creator's account with `prompt_sha256` and the royalty. The contract pays storage, because function-call keys cannot attach NEAR |
| List | Seller's wallet | `nft_approve` lets `market` transfer the token when it sells |
| Buy | Buyer's wallet | `market` takes the price in NEAR, calls the skills contract's NEP-199 payout and sends the creator royalty (default 5%), the 5% platform fee and the rest to the seller |
| Ownership | Nobody (read only) | `api` refreshes its owner cache after each trade; Start is refused for skills the player no longer owns. The starter skill Flood Warden is account-bound and never onchain |
| Pool (stretch) | Platform | Entry fees fund the season pool; it pays the top scores minus the 10% cut. Whether the fee is paid in NEAR or credits is open |

## Secrets and trust boundaries
<embed {'caption': 'secrets and trust boundaries · where each key lives', 'ref': 'node/0926b2c2-2a9d'}>
**The hidden-prompt rule becomes three architectural rules: prompts are stored only as ciphertext, decrypted only inside the process building a model call, and never written to any output.** Envelope encryption means each skill version gets its own random data key (AES-256-GCM); KMS wraps that data key with `skill-prompt-kek`, and only the wrapped key is stored beside the ciphertext.
| Secret | Lives in | Read by |
| Model API keys (Anthropic, OpenRouter, OpenAI) | Secret Manager | `worker`, `realtime` |
| `NEAR_OPS_KEY` (function-call keys of `ops.promptlings.testnet`, limited to `nft_mint` on `skills` and `record_run`, `record_match` on `registry`) | Secret Manager | `worker`, `realtime`, `api` (mint) |
| Database password, Privy app secret | Secret Manager | Database: `api`, `worker`, `realtime`. Privy secret: `api`; `realtime` checks tokens with Privy's public verification key |
| `skill-prompt-kek` | Cloud KMS; never exported | Encrypt: `api`. Decrypt: `worker`, `realtime`, and `api` only for the creator's own read-back on S08 |
| Contract full-access keys | Offline on the team's laptops | Used by hand to deploy contracts |
| Player's wallet key | Player's device (Privy embedded or wallet extension) | Never the platform |

What leaves the runners: actions, probabilities and the plan as up to 6 structured steps {agent, intent, target}, as the UI/UX Spec shows. Prompt text, plan text and model output text never reach Redis, logs, replays or any API. Skill tests from S08 run on `worker` like any run.
## Environments and CI/CD
<embed {'caption': 'environments and CI/CD · local, PR, main, staging', 'ref': 'node/5c65dd5d-fdb5'}>
**Two environments for the hackathon: local and staging.** Staging is on GCP and NEAR testnet; there is no production and no mainnet until after judging.
| Environment | Runs on | Secrets | NEAR |
| Local | Docker Compose on a laptop or a judge's machine | `.env` (git-ignored); without model keys the scripted engine runs | Testnet, read only unless a developer sets a key |
| Staging | GCP us-central1, project `promptlings-staging` (proposed name) | Secret Manager | Testnet contracts and the `ops` signer |

Deploy order on each merge: build and push images, run `migrate`, deploy `api` and `web`, update the `worker` pool, deploy `realtime` last because a new revision ends live matches. The Milestones' day-one task (monorepo, CI, Docker Compose, hello-world on staging) builds exactly this pipeline.
## AWS equivalents
**Every GCP piece has a direct AWS counterpart, so the same containers move if the team switches.** The code depends on Postgres, Redis, an object store, a secret store and a KMS, not on GCP-only APIs. Names only; limits and prices were not checked for AWS.
| Part | GCP (chosen) | AWS equivalent |
| `web`, `api` containers | Cloud Run services | ECS on Fargate behind an Application Load Balancer (or App Runner) |
| `realtime` WebSockets | Cloud Run service with session affinity | ECS on Fargate behind an Application Load Balancer with sticky sessions |
| `worker` queue consumer | Cloud Run worker pool | ECS on Fargate service with no load balancer |
| `migrate` | Cloud Run job | ECS RunTask on Fargate |
| Postgres | Cloud SQL for PostgreSQL | RDS for PostgreSQL |
| Redis | Memorystore for Redis | ElastiCache (Redis OSS or Valkey) |
| Replays and maps | Cloud Storage | S3 |
| Secrets | Secret Manager | Secrets Manager |
| Skill vault key | Cloud KMS | AWS KMS |
| Container images | Artifact Registry | ECR |
| Logs, metrics, alerts | Cloud Logging and Monitoring, Billing budgets | CloudWatch, AWS Budgets |
| CI login | Workload Identity Federation for GitHub Actions | IAM role assumed through GitHub OIDC |
| Private network to Redis and Postgres | Direct VPC egress | VPC subnets and security groups |

## Hosting cost at hackathon scale
**About US$116 a month for staging with everything always on, before LLM spend; a new GCP account's US$300 credit covers the hackathon.** Redis and the always-on `realtime` instance are 70% of it. Prices are us-central1 list prices from the pages in Sources, for a 730-hour month. LLM costs are in the concept's Unit economics, not here.
| Item | Size (proposed) | Price used | Monthly (US$) |
| `realtime` (instance-based, always on) | 1 vCPU, 0.5 GiB | $0.000018 per vCPU-s, $0.000002 per GiB-s, after 240,000 vCPU-s and 450,000 GiB-s free | 44.71 |
| Memorystore for Redis, Basic | 1 GiB | $0.049 per GiB-hour | 35.77 |
| `worker` pool | 1 instance, 1 vCPU, 0.5 GiB | $0.000011244 per vCPU-s, $0.000001235 per GiB-s, after 384,204 vCPU-s and 728,744 GiB-s free | 25.95 |
| Cloud SQL for PostgreSQL | db-f1-micro, 10 GiB SSD | $0.0105 per hour + $0.000232877 per GiB-hour | 9.37 |
| Cloud KMS | 1 software key version | $0.06 per version + $0.03 per 10,000 operations | about 0.10 |
| `web`, `api` (request-based, scale to zero) | Hackathon traffic | Free tier: 180,000 vCPU-s, 360,000 GiB-s, 2 million requests a month | 0 expected |
| Cloud Storage | Replays and maps, under 5 GB | Free tier: 5 GB-months in us-central1 | 0 expected |
| Secret Manager | About 7 secrets | Free tier: 6 active versions, 10,000 accesses | near 0 |
| Artifact Registry | Five images | Free tier: 0.5 GB | small; overage price not checked |
| Privy | Under 500 monthly active users | Free Developer plan | 0 |
| **Total** |  |  | **about 116** |

Two switches cut it to about US$45: set `realtime` to min 0 instances and the worker pool to 0 instances outside test sessions and the 16–18 Nov judging window. The concept's break-even table assumed US$150 a month of fixed infrastructure, so this fits. Check every price again before launch.
## Open questions
- **Latency:** measure Jev (OpenRouter) and Haiku 5.5 call times from Cloud Run in us-central1 and asia-southeast1, and page loads from Manila. Where are Jev's and Anthropic's serving endpoints? Settles the region.
- **Privy on testnet:** spike the Privy embedded NEAR wallet on testnet. Who funds a new embedded account with testnet NEAR for gas and storage, and is its account id implicit (a 64-character hex id)? Fallback: Web3Auth, which NEAR's social-login page also names.
- **Deploys end live matches:** a new `realtime` revision replaces the one instance and drops its WebSockets. Proposed: no deploys during demo windows; a match cut by a restart is `void` with a full refund. Confirm the result screen handles it.
- **Scaling past one ****`realtime`**** instance:** one instance takes up to 1,000 WebSocket connections. More instances need a per-match owner lease in Redis so only one instance runs each tick clock (design sketched, not built).
- **Redis cost:** Memorystore is US$36 a month even when idle. Keep it, or run Redis in a container on the free e2-micro VM for staging?
- **Storage deposits:** NEAR function-call keys cannot attach deposits, so the `skills` and `registry` contracts must pay storage from their own balance when the platform mints or records. How much testnet NEAR do they need for the hackathon?
- **Entry fee currency (stretch):** the concept says pool entry fees are paid in NEAR; the Game Spec takes the fee with the credits hold. Which one?
- **Plan visibility:** the Game Spec says plans are hidden everywhere; the UI/UX Spec shows a plan as up to 6 structured steps {agent, intent, target}. This doc follows the UI/UX Spec: structure only, never text. Confirm.
- **Judges without API keys:** proposed: a `DECISION_ENGINE=scripted` mode in Docker Compose that replays a stored solution, so a judge sees a full run with no keys. Confirm it is acceptable for the README.
- **Skill token standard:** NEP-171 or NEP-245 is still open; the hosting does not change either way.
- **Credit withdrawals:** proposed none in v0; credits are spent, never redeemed.
## Sources
Pages opened on 25 Oct 2026. Game numbers come from the [concept doc](https://claude.ai/artifact/5UhnAPVmV6JfaP6c2gs1vR), the [Game Spec](https://claude.ai/artifact/SoDsx1deNGMkh4iskJq4sy), the [UI/UX Spec](https://claude.ai/artifact/267kvVM55hjgwQ3WG8Xzyn) and the [Milestones](https://claude.ai/artifact/QBJF3BZCZ3XPfsJYRTtUMV).
- [Cloud Run: using WebSockets](https://docs.cloud.google.com/run/docs/triggering/websockets): up to 60-minute timeout, 1,000 connections per instance, Redis pub/sub across instances, instance-based billing while a socket is open
- [Cloud Run: request timeout](https://docs.cloud.google.com/run/docs/configuring/request-timeout): default 300 s, maximum 3,600 s
- [Cloud Run: session affinity](https://docs.cloud.google.com/run/docs/configuring/session-affinity): cookie-based, best effort
- [Cloud Run locations](https://docs.cloud.google.com/run/docs/locations): regions and price tiers; no Philippines region
- [Cloud Run: deploy worker pools](https://docs.cloud.google.com/run/docs/deploy-worker-pools): no endpoint, manual instance count
- [Cloud Run release notes](https://docs.cloud.google.com/run/docs/release-notes): worker pools GA on 14 Apr 2026
- [Cloud Run pricing](https://cloud.google.com/run/pricing): free tiers and per-second prices
- [Cloud Run: Direct VPC egress](https://docs.cloud.google.com/run/docs/configuring/vpc-direct-vpc): services, jobs and worker pools
- [Cloud SQL pricing](https://cloud.google.com/sql/pricing)
- [Memorystore for Redis pricing](https://cloud.google.com/memorystore/docs/redis/pricing)
- [Cloud KMS pricing](https://cloud.google.com/kms/pricing)
- [Google Cloud free features](https://docs.cloud.google.com/free/docs/free-cloud-features): US$300 for 90 days, free-tier limits
- [Vercel Hobby plan](https://vercel.com/docs/plans/hobby): non-commercial use only
- [google-github-actions/auth](https://github.com/google-github-actions/auth): Workload Identity Federation over key files
- [NEAR RPC providers](https://docs.near.org/api/rpc/providers): testnet endpoints and free-tier limits
- [NEAR web login](https://docs.near.org/web3-apps/concepts/web-login) and [NEAR social login](https://docs.near.org/web3-apps/tutorials/social-login): NEAR Connect, Privy, Web3Auth
- [NEAR with Privy](https://docs.near.org/web3-apps/tutorials/privy): embedded NEAR wallet created at login
- [Privy pricing](https://www.privy.io/pricing): free to 499 monthly active users
- [NEAR access keys](https://docs.near.org/protocol/access-keys): function-call keys cannot attach NEAR