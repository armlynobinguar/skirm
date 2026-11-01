#!/usr/bin/env node
// v2 match clients over /ws (docs/backend-contract.md, WebSocket), for scripts/smoke.sh and by hand.
// Each client signs in with a dev handle, sends v2_queue, accepts its v2_found, locks in on v2_lockin
// with its crew's tiers, and waits for v2_end. Practice (`opponent: 'bot'`) starts at once; two
// clients without `opponent` and with the same `ranked` pair with each other.
//
//   node scripts/ws-v2.cjs SPEC [TIMEOUT_S] [OUT_FILE]
//
// SPEC is a JSON file or inline JSON: one client or an array of them,
//   { "devUser": "judge1", "crew": [{ "agentId": "agt_…", "tier": "standard" }],
//     "ranked": false, "opponent": "bot", "mapId": "copper-hollow", "difficulty": "easy" }
// (`ranked` defaults to false; `opponent`, `mapId` and `difficulty` are optional.)
// TIMEOUT_S defaults to 300. The result is written to OUT_FILE, or printed when there is none:
//   { why, clients: [{ devUser, opened, queueStatus, found, lockin, start, frames, lastTick, end, errors }] }
// `found`, `lockin`, `start` and `end` are the server's v2_found, v2_lockin, v2_start and v2_end.
// It stops early when a client fails (refused before a match was found, or its socket closed).
// Exits 0 when every client got its v2_end, 1 otherwise, 2 on bad arguments.
//
// Env: WS_URL (ws://localhost:4001/ws); WS_MODULE, a path to the `ws` package (default: the repo's,
// so run `npm ci` at the repo root first).
'use strict';
const fs = require('fs');

const WS_URL = process.env.WS_URL || 'ws://localhost:4001/ws';
const WebSocket = require(process.env.WS_MODULE || 'ws');

function usage(msg) {
  process.stderr.write(
    `ws-v2: ${msg}\nusage: node scripts/ws-v2.cjs SPEC [TIMEOUT_S] [OUT_FILE]\n`,
  );
  process.exit(2);
}

const [specArg, timeoutArg, outFile] = process.argv.slice(2);
if (!specArg) usage('SPEC is required');
let spec;
try {
  const text = /^\s*[[{]/.test(specArg) ? specArg : fs.readFileSync(specArg, 'utf8');
  spec = JSON.parse(text);
} catch (e) {
  usage(`SPEC is not a JSON file or JSON text: ${e.message}`);
}
if (!Array.isArray(spec)) spec = [spec];
if (!spec.length) usage('SPEC has no clients');
for (const [i, s] of spec.entries()) {
  if (!s || typeof s.devUser !== 'string' || !s.devUser) usage(`client ${i} needs a devUser`);
  if (!Array.isArray(s.crew) || !s.crew.length)
    usage(`client ${i} needs a crew of {agentId, tier}`);
}
const timeoutS = timeoutArg === undefined ? 300 : Number(timeoutArg);
if (!Number.isFinite(timeoutS) || timeoutS <= 0)
  usage('TIMEOUT_S must be a positive number of seconds');

const out = spec.map((s) => ({
  devUser: s.devUser,
  opened: false,
  queueStatus: 0,
  found: null,
  lockin: null,
  start: null,
  frames: 0,
  lastTick: null,
  end: null,
  errors: [],
  failed: false,
}));
const sockets = [];
let finished = false;

function done(why) {
  if (finished) return;
  finished = true;
  const result = JSON.stringify({ why, clients: out });
  if (outFile) fs.writeFileSync(outFile, result);
  else process.stdout.write(result + '\n');
  for (const ws of sockets) {
    try {
      ws.close();
    } catch {}
  }
  process.exit(out.every((c) => c.end) ? 0 : 1);
}

/** Done when every client got its v2_end, or as soon as one fails (a pair can no longer form). */
function check() {
  if (out.some((c) => c.failed)) done('failed');
  else if (out.every((c) => c.end)) done('v2_end');
}

setTimeout(() => done('timeout'), timeoutS * 1000);
process.on('SIGTERM', () => done('stopped'));
process.on('SIGINT', () => done('stopped'));

spec.forEach((s, i) => {
  const o = out[i];
  const ws = new WebSocket(WS_URL);
  sockets.push(ws);
  const send = (m) => ws.send(JSON.stringify(m));
  const mine = (m) => !o.found || m.matchId === o.found.matchId;
  ws.on('open', () => {
    o.opened = true;
    send({ type: 'auth', devUser: s.devUser });
    const queue = { type: 'v2_queue', crew: s.crew, ranked: s.ranked === true };
    if (s.opponent) queue.opponent = s.opponent;
    if (s.mapId) queue.mapId = s.mapId;
    if (s.difficulty) queue.difficulty = s.difficulty;
    send(queue);
  });
  ws.on('message', (data) => {
    let m;
    try {
      m = JSON.parse(String(data));
    } catch {
      o.errors.push('non-JSON message');
      return;
    }
    switch (m.type) {
      case 'queue_status':
        o.queueStatus++;
        break;
      case 'v2_found':
        if (o.found) break;
        o.found = m;
        send({ type: 'v2_accept', matchId: m.matchId });
        break;
      case 'v2_lockin':
        if (!mine(m) || o.lockin) break;
        o.lockin = m;
        send({ type: 'v2_lock_in', matchId: m.matchId, tiers: s.crew.map((c) => c.tier) });
        break;
      case 'v2_start':
        if (mine(m)) o.start = m;
        break;
      case 'v2_frame':
        if (!mine(m)) break;
        o.frames++;
        if (typeof m.frame?.tick === 'number') o.lastTick = m.frame.tick;
        break;
      case 'v2_end':
        if (!mine(m) || o.end) break;
        o.end = m;
        check();
        break;
      case 'error':
        o.errors.push(`${m.code}: ${m.message}`);
        // Refused before a match was found (bad crew, busy agent, ...): nothing more will come.
        if (!o.found) {
          o.failed = true;
          check();
        }
        break;
    }
  });
  ws.on('error', (e) => o.errors.push(`socket: ${e.message}`));
  ws.on('close', () => {
    if (finished || o.end) return;
    o.errors.push('socket closed before v2_end');
    o.failed = true;
    check();
  });
});
