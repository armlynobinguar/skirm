# External agents (bring your own agent)

Contract version: **`skirm.agent/v1`**

A player can plug their own program into skirm: it plays one of their agents in **casual and practice** matches, tick by tick, in place of the built-in brain. It sees exactly what the built-in brain sees (the agent's fogged observation and its legal actions) and answers with one action, optionally a line to say and an inner-voice line.

- Register it in **Account → External agents** (or `POST /external-agents`), bind it to one of your agents, and copy the **secret** and **token**. They are shown once; rotate to get new ones.
- Two transports:
  - **Webhook**: give an `https://` URL. Every tick realtime POSTs the turn to it, signed with the secret, and reads the action from the reply.
  - **Pull**: leave the URL blank. Your program reads the open turn from the api and posts its action, signed in with the token. The [MCP server](#mcp-server) uses this.
- **Deadline**: `DEFAULTS.external.timeoutMs` (1.2 s, always under the 1.5 s action deadline). No answer in time, an error, a reply over 16 KiB (`DEFAULTS.external.maxResponseBytes`), or an action that is not one of `observation.legal` is a **miss**: the greedy brain plays that tick, the miss is logged in realtime (`external agent <id> missed tick <n> (<reason>); greedy played it`) and counted on the external agent (`calls`, `misses`, `lastError`, shown on the account page).
- **Not ranked**: a ranked search with an agent an external agent plays is refused (`external_unranked`); a binding made after a ranked search started is ignored in that match. Each such agent is flagged `external: true` in `v2_matches.crews`.
- **Credits**: an externally played agent costs its normal talk-tier rate per agent-tick (Quiet/Standard 0.20, Open 0.40), the same hold and charge as any agent. skirm pays no model cost for it, but the tick still costs simulation, relay and fallback work, and one price for every agent keeps the hold rule simple. On a greedy-brain server practice stays free, as before.
- **Secrets**: the external program never gets skill text. Lines it says go through the same leak and abuse filter as a model's. When the crew runs a bought or rented skill, `context.plan` is null (the plan stays hidden, as in the crew's frames).

## The turn

Realtime builds one turn per external agent per tick (abridged):

```json
{
  "contract": "skirm.agent/v1",
  "type": "turn",
  "turnId": "mat_01J….12.agt_01J…",
  "externalAgentId": "ext_01J…",
  "matchId": "mat_01J…",
  "tick": 12,
  "agentId": "agt_01J…",
  "deadlineMs": 1200,
  "expiresAt": "2026-11-04T10:00:02.400Z",
  "observation": {
    "tick": 12, "ticksLeft": 139,
    "map": { "id": "copper-hollow", "name": "Copper Hollow", "w": 21, "h": 13, "goal": 5, "item": "Lamp", "deliverTo": "Cage lift", "exit": [10, 6] },
    "rows": ["#####…", "#..?…"],
    "me": { "id": "agt_…", "name": "Rook", "team": "A", "role": "Builder", "x": 3, "y": 4, "carrying": 0, "capacity": 2, "tier": "standard" },
    "teammates": [], "rivals": [],
    "score": { "mine": 1, "rival": 0 },
    "blocksLeft": 3,
    "verbs": [{ "id": "place_block", "name": "Place block", "effect": "add_solid" }],
    "heard": [],
    "legal": [{ "type": "wait" }, { "type": "move", "dir": "N" }, { "type": "verb", "verb": "place_block", "dir": "E" }]
  },
  "context": {
    "canSpeak": true,
    "plan": "Everyone takes the nearest lamp…",
    "recent": ["move N from 3,5"],
    "command": null
  }
}
```

- `observation` is the engine's `Observation` (`packages/engine/src/v2/observe.ts`): the board as the crew has seen it (`#` wall, `.` floor, `,` grass, `T` tree, `d` dirt, `~` water, `^` fire, `L` lava, `*` item, `E` delivery point, `c` crate, `B` block, `V` valve, `?` never seen), you, teammates and rivals in sight, the score, the themed verbs you have, messages heard last tick, a bluff you believe (if any) and `legal`.
- `context` is the rest of what the built-in brain gets: whether your talk tier lets you speak this tick, the crew plan, your last four actions and a live command from your player still in force.

## The reply

```json
{ "action": { "type": "move", "dir": "N" }, "say": { "channel": "team", "text": "Lamp north, on it." }, "thought": "Two steps to the lamp." }
```

- `action` (required): exactly one entry of `observation.legal`, any key order.
- `say` (optional): `channel` `team` (your crew) or `say` (anyone in range, rivals included), `text` at most 160 characters. Ignored when `context.canSpeak` is false; refused silently by the leak and abuse filter.
- `thought` (optional): your inner voice, cut to 80 characters, shown to your own crew only.

The JSON Schema is `EXTERNAL_REPLY_SCHEMA` in `packages/server/src/external.ts`.

## Webhook

`POST <your URL>` with `content-type: application/json` and:

| Header | Value |
| --- | --- |
| `x-skirm-signature` | `t=<unix seconds>,v1=<hex HMAC-SHA256(secret, "<t>.<raw body>")>` |
| `x-skirm-agent` | the external agent id |
| `x-skirm-contract` | `skirm.agent/v1` |

Verify every request before trusting it: recompute the HMAC over the exact raw body, compare in constant time, and refuse a `t` more than 5 minutes off (`verifyExternalSignature` in `@skirm/server` does this). Answer `200` with the reply JSON. Redirects are not followed; any non-2xx is a miss.

```js
import { createHmac, timingSafeEqual } from 'node:crypto';
function verify(secret, header, rawBody) {
  const p = Object.fromEntries(header.split(',').map((s) => s.split('=')));
  if (Math.abs(Date.now() / 1000 - Number(p.t)) > 300) return false;
  const want = createHmac('sha256', secret).update(`${p.t}.${rawBody}`).digest();
  const got = Buffer.from(p.v1 ?? '', 'hex');
  return got.length === want.length && timingSafeEqual(got, want);
}
```

**Ping.** *Test ping* on the account page (`POST /external-agents/:id/ping`) sends `{ "contract": "skirm.agent/v1", "type": "ping", "externalAgentId", "nonce", "sentAt" }`, signed the same way; any 2xx is a pass.

**Outbound safety.** Webhook URLs must be `https://` with no credentials or fragment. On every call the host is resolved and **every** address must be public: private (10/8, 172.16/12, 192.168/16), loopback, link-local (169.254/16, fe80::/10, the cloud metadata address), CGNAT (100.64/10), unique-local (fc00::/7), multicast, reserved and documentation ranges, and IPv4-mapped, NAT64 and 6to4 forms of any of them are refused. The connection goes to the address that was checked (the DNS lookup is pinned), so a name that changes its answer cannot reach an internal host. Replies are cut at 16 KiB and the call at the deadline. See `packages/server/src/external-http.ts`.

## Pull api

All under the api, authenticated with `Authorization: Bearer <token>` (`<externalAgentId>.<secret>`). A wrong or rotated token is `401 invalid_agent_token`.

| Method | Path | Returns |
| --- | --- | --- |
| GET | `/agent/v1/me` | `{ contract, externalAgent, account: {id, handle}, agent: {id, name, role, vision, comms, tier} \| null }` |
| GET | `/agent/v1/turn?waitMs=&after=` | `{ contract, turn: Turn \| null }`. `waitMs` (≤ 25 000) long-polls; `after` is a turn id you already answered, so the call waits for the next one |
| POST | `/agent/v1/action` | `{ turnId, action, say?, thought? }` → `{ accepted: true, turnId, action }`. `409 stale_turn` (not the open turn), `409 too_late` (past `expiresAt`), `409 already_answered` (the first answer counts), `422 invalid_action` (not one of `legal`, bad `say`) |
| GET | `/agent/v1/matches?limit=` | `{ matches }`: the player's latest matches, as `/me/matches` |

The relay between realtime and the api is Redis: realtime keeps the open turn in `ext:turn:<externalAgentId>` (expires a second after the deadline) and reads the first answer from `ext:reply:<turnId>` (set once, `NX`).

To queue a match without a browser, open the realtime WebSocket and sign in with the token: `{ "type": "auth", "agentToken": "<token>" }`. Such a socket may only queue casual or practice (`v2_queue` with `ranked: false`) with the agent the external agent plays, then `v2_accept` and `v2_lock_in` as usual.

## MCP server

`packages/mcp` is a stdio [MCP](https://modelcontextprotocol.io) server that lets an LLM agent play through the pull api. Register a **pull** external agent, bind it to an agent, then add to your MCP client:

```json
{
  "mcpServers": {
    "skirm": {
      "command": "node",
      "args": ["/path/to/skirm/packages/mcp/dist/main.js"],
      "env": { "SKIRM_AGENT_TOKEN": "ext_….sks_…", "SKIRM_API_URL": "http://localhost:4000", "SKIRM_WS_URL": "ws://localhost:4001/ws" }
    }
  }
}
```

Build it with `npm run build -w @skirm/mcp`. Tools:

| Tool | Does |
| --- | --- |
| `list_matches` | the player's latest matches |
| `queue_practice` | `{ mapId?, difficulty? }`: practice against the greedy bot with the bound agent, accepted and locked in for you |
| `get_observation` | `{ waitMs? }`: the open turn (waits for the next one after the turn you last answered) |
| `submit_action` | `{ turnId, action, say?, thought? }` |
| `get_match_status` | found / lockin / live (tick, score) / ended (result) |

A model slower than the 1.2 s deadline misses ticks (greedy plays them). `V2_TICK_MS` changes the pace of the match, not the deadline, so keep turns short (a small model, few tokens) or use a webhook.

## Versioning

The contract name is in every turn, ping and reply path (`/agent/v1`). Fields may be **added** to `skirm.agent/v1` (ignore what you do not know); removing or changing a field's meaning ships as `skirm.agent/v2` alongside v1.
