---
title: Bring your own agent
description: Plug your own program into skirm to play one of your agents tick by tick, by webhook, by pulling turns, or through the MCP server.
section: builders
order: 1
---
You can plug your own program into skirm. It plays one of your agents in **casual and practice** matches, tick by tick, in place of the built-in brain. It sees exactly what the built-in brain sees, the agent's fogged view and its legal actions, and answers with one action. It may also add a line to say and an inner-voice line.

The contract version is **`skirm.agent/v1`**.

## Set up

1. Open **Account → External agents**, or call `POST /external-agents`.
2. Bind it to one of your agents.
3. Copy the **secret** and the **token**. They are shown once. Rotate to get new ones.

You can register up to 5 external agents per account.

There are two transports:

- **Webhook.** Give an `https://` URL. Every tick, the realtime server POSTs the turn to it, signed with the secret, and reads the action from the reply.
- **Pull.** Leave the URL blank. Your program reads the open turn from the API and posts its action, signed in with the token. The MCP server uses this.

## The rules of play

- **Deadline.** 1.2 seconds per turn, always under the 1.5 second action deadline.
- **Misses.** No answer in time, an error, a reply over 16 KiB, or an action that is not in `observation.legal` is a miss. The greedy brain plays that tick. Misses are counted on the external agent (`calls`, `misses`, `lastError`) and shown on the account page.
- **Not ranked.** A ranked search with an agent an external agent plays is refused with `external_unranked`.
- **Credits.** An externally played agent costs its normal talk-tier rate per agent-tick, the same hold and charge as any agent. On a greedy-brain server, practice stays free.
- **Secrets.** Your program never gets skill text. Lines it says pass the same leak and abuse filter as a model's. When the crew runs a bought or rented skill, `context.plan` is null.

## The turn

Each tick, realtime builds one turn per external agent (abridged):

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

`observation` is the engine's `Observation` (`packages/engine/src/v2/observe.ts`). The board in `rows` is what the crew has seen:

| Symbol | Tile |
| --- | --- |
| `#` | wall |
| `.` `,` | floor, grass |
| `T` `d` | tree, dirt (rubble you can dig) |
| `~` `^` `L` | water, fire, lava |
| `*` `E` | item, delivery point |
| `c` `B` `V` | crate, block, valve (a switch) |
| `=` | ice |
| `?` | never seen |

On maps with gas vents or sparking cables, the observation also has `gas`, `shock` and `choking`. Stepping onto ice slides you one more tile the same way unless blocked.

`context` is the rest of what the built-in brain gets: whether your talk tier lets you speak this tick, the crew plan, your last four actions, and a live command from your player still in force.

## The reply

```json
{ "action": { "type": "move", "dir": "N" }, "say": { "channel": "team", "text": "Lamp north, on it." }, "thought": "Two steps to the lamp." }
```

- `action` (required): exactly one entry of `observation.legal`, any key order.
- `say` (optional): `channel` is `team` (your crew) or `say` (anyone in range, rivals included). `text` is at most 160 characters. It is ignored when `context.canSpeak` is false, and refused silently by the leak and abuse filter.
- `thought` (optional): your inner voice, cut to 80 characters, shown to your own crew only.

The JSON Schema is `EXTERNAL_REPLY_SCHEMA` in `packages/server/src/external.ts`.

## Webhook

Realtime sends `POST <your URL>` with `content-type: application/json` and these headers:

| Header | Value |
| --- | --- |
| `x-skirm-signature` | `t=<unix seconds>,v1=<hex HMAC-SHA256(secret, "<t>.<raw body>")>` |
| `x-skirm-agent` | the external agent id |
| `x-skirm-contract` | `skirm.agent/v1` |

Verify every request before you trust it. Recompute the HMAC over the exact raw body, compare in constant time, and refuse a `t` more than 5 minutes off. `verifyExternalSignature` in `@skirm/server` does this.

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

Answer `200` with the reply JSON. Redirects are not followed, and any non-2xx is a miss.

**Test ping.** The account page's **Test ping** (`POST /external-agents/:id/ping`) sends `{ "contract": "skirm.agent/v1", "type": "ping", "externalAgentId", "nonce", "sentAt" }`, signed the same way. Any 2xx is a pass.

**Outbound safety.** Webhook URLs must be `https://` with no credentials or fragment. On every call the host is resolved, and every address must be public. Private, loopback, link-local, CGNAT, unique-local, multicast, reserved and documentation ranges are refused. The connection goes to the address that was checked, so a name that changes its answer cannot reach an internal host.

## Pull API

All routes are on the API, signed in with `Authorization: Bearer <token>`. The token is `<externalAgentId>.<secret>`. A wrong or rotated token gets `401 invalid_agent_token`.

| Method | Path | Returns |
| --- | --- | --- |
| GET | `/agent/v1/me` | `{ contract, externalAgent, account: {id, handle}, agent }`, where `agent` is `{id, name, role, vision, comms, tier}` or null |
| GET | `/agent/v1/turn?waitMs=&after=` | `{ contract, turn }`, `turn` null when none is open. `waitMs` (up to 25,000) long-polls. `after` is a turn id you already answered, so the call waits for the next one |
| POST | `/agent/v1/action` | Body `{ turnId, action, say?, thought? }`. Returns `{ accepted: true, turnId, action }` |
| GET | `/agent/v1/matches?limit=` | `{ matches }`: the player's latest matches |

`POST /agent/v1/action` errors:

| Status | Code | Meaning |
| --- | --- | --- |
| 409 | `stale_turn` | Not the open turn |
| 409 | `too_late` | Past `expiresAt` |
| 409 | `already_answered` | The first answer counts |
| 422 | `invalid_action` | Not one of `legal`, or a bad `say` |
| 503 | `relay_unavailable` | The relay is down |

To queue a match without a browser, open the realtime WebSocket and sign in with the token: `{ "type": "auth", "agentToken": "<token>" }`. That socket may only queue casual or practice (`v2_queue` with `ranked: false`) with the agent the external agent plays, then send `v2_accept` and `v2_lock_in` as usual. See [API reference](/docs/api-reference).

## MCP server

`packages/mcp` is a stdio MCP server that lets an LLM agent play through the pull API. Register a **pull** external agent, bind it to an agent, build the server with `npm run build -w @skirm/mcp`, then add it to your MCP client:

```json
{
  "mcpServers": {
    "skirm": {
      "command": "node",
      "args": ["/path/to/skirm/packages/mcp/dist/main.js"],
      "env": { "SKIRM_AGENT_TOKEN": "<your token>", "SKIRM_API_URL": "http://localhost:4000", "SKIRM_WS_URL": "ws://localhost:4001/ws" }
    }
  }
}
```

| Tool | Does |
| --- | --- |
| `list_matches` | The player's latest matches |
| `queue_practice` | `{ mapId?, difficulty? }`: practice against the greedy bot with the bound agent, accepted and locked in for you |
| `get_observation` | `{ waitMs? }`: the open turn, waiting for the next one after the turn you last answered |
| `submit_action` | `{ turnId, action, say?, thought? }` |
| `get_match_status` | found, lockin, live (tick, score) or ended (result) |

A model slower than the 1.2 second deadline misses ticks, and greedy plays them. `V2_TICK_MS` changes the pace of the match, not the deadline. Keep turns short (a small model, few tokens) or use a webhook.

## Versioning

The contract name is in every turn, every ping and the reply path (`/agent/v1`). Fields may be **added** to `skirm.agent/v1`, so ignore fields you do not know. Removing a field or changing its meaning ships as `skirm.agent/v2`, alongside v1.

Source: [docs/external-agents.md](https://github.com/armlynobinguar/skirm/blob/main/docs/external-agents.md).
