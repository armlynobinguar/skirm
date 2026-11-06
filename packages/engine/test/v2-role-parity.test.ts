// Parity for the six original roles. Every stored match was played with Builder, Digger,
// Firefighter, Scout, Runner and Hauler; /verify and the replay tools recompute them with today's
// engine. These pins were taken on the engine before Medic, Engineer, Saboteur and Courier existed:
// a scripted match per map (every agent picks among its legal actions by a fixed hash), logged,
// hashed and replayed. If any pin moves, an old match would no longer replay to what was recorded.
import { describe, expect, it } from 'vitest';
import { canonicalJson, sha256Hex } from '../src/canonical';
import {
  MAPS_V2,
  appendTick,
  createMatch,
  legalActions,
  logAgent,
  logHash,
  startLog,
  stepMatch,
  verifyLog,
  type Action,
  type AgentSpec,
  type MatchEvent,
  type Role,
  type SayInput,
} from '../src/v2';

const ORIGINAL: readonly Role[] = ['Builder', 'Digger', 'Firefighter', 'Scout', 'Runner', 'Hauler'];

function pick(seed: string, n: number): number {
  let h = 0x811c9dc5;
  for (const ch of seed) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) % n;
}

/** One scripted match: both crews field three of the original roles, mirrored across the two maps' halves. */
export function play(mapIndex: number, ranked: boolean) {
  const def = MAPS_V2[mapIndex]!;
  const size = Math.min(3, def.starts.A.length);
  const spec = (team: 'a' | 'b', i: number): AgentSpec => ({
    id: `${team}${i}`,
    name: `${team}${i}`,
    role: ORIGINAL[(i + (team === 'a' ? mapIndex : mapIndex + 3)) % ORIGINAL.length]!,
    vision: 1 + ((i + mapIndex) % 5),
    comms: 1 + ((i * 2 + mapIndex) % 5),
    tier: ranked ? 'standard' : (['quiet', 'standard', 'open'] as const)[i % 3]!,
  });
  const crews = { A: Array.from({ length: size }, (_, i) => spec('a', i)), B: Array.from({ length: size }, (_, i) => spec('b', i)) };
  const s = createMatch(def, crews, { ranked, ...(ranked ? {} : { difficulty: (['easy', 'normal', 'hard'] as const)[mapIndex % 3]! }) });
  const log = startLog({
    schema: 'skirm.match/v2',
    map: def.id,
    crews: { A: s.agents.filter((a) => a.team === 'A').map(logAgent), B: s.agents.filter((a) => a.team === 'B').map(logAgent) },
    ranked,
    models: { planner: 'script', actor: 'script', speech: 'script' },
  });
  const events: MatchEvent[][] = [];
  while (!s.result) {
    const actions: Record<string, Action> = {};
    for (const a of s.agents) {
      const legal = legalActions(s, a.id);
      // Moves twice as likely as anything else, so agents actually travel and pick things up.
      const weighted = [...legal, ...legal.filter((x) => x.type === 'move')];
      actions[a.id] = weighted[pick(`${def.id}:${s.tick}:${a.id}`, weighted.length)]!;
    }
    const says: SayInput[] = s.tick % 9 === 0 ? [{ agent: s.agents[s.tick % s.agents.length]!.id, channel: s.tick % 2 ? 'say' : 'team', text: `Tick ${s.tick}.` }] : [];
    const ev = stepMatch(s, { actions, says });
    events.push(ev);
    appendTick(log, { tick: s.tick, actions, says });
  }
  // lastSpoke starts at -Infinity, which canonical JSON refuses: recorded as null.
  const agents = s.agents.map((a) => ({ ...a, lastSpoke: Number.isFinite(a.lastSpoke) ? a.lastSpoke : null }));
  const state = { score: s.score, tally: s.tally, agents, grid: s.grid, gear: s.gear ?? null, seen: s.seen, result: s.result };
  return { log, hash: logHash(log), events: sha256Hex(canonicalJson(events)), state: sha256Hex(canonicalJson(state)), result: s.result!, crews };
}

describe('original-role parity: matches played before the new roles replay and hash the same', () => {
  it.each(MAPS_V2.map((m, i) => [m.id, i] as const))('%s', (_id, i) => {
    const casual = play(i, false);
    const ranked = play(i, true);
    expect(verifyLog(casual.log)).toBeNull();
    expect({ hash: casual.hash, events: casual.events, state: casual.state, ticks: casual.result.ticks }).toEqual(PINS[i]!.casual);
    expect({ hash: ranked.hash, events: ranked.events, state: ranked.state, ticks: ranked.result.ticks }).toEqual(PINS[i]!.ranked);
    // Replaying the logged ticks on a fresh match reproduces it.
    const again = createMatch(MAPS_V2[i]!, casual.crews, { difficulty: (['easy', 'normal', 'hard'] as const)[i % 3]! });
    for (const t of casual.log.ticks) stepMatch(again, { actions: t.actions, says: t.says });
    expect(again.result).toEqual(casual.result);
  });
});

type Pin = { hash: string; events: string; state: string; ticks: number };
/** Taken on the engine before the new roles (origin/main), one per map in MAPS_V2 order. */
const PINS: { casual: Pin; ranked: Pin }[] = [
  {
    "casual": {
      "hash": "d2a5b9b6088531ae941ae730e796821e7402b66e0f2b24eb99ce72e88648cad4",
      "events": "5a00e9e25be156bfcc0c82e0d247d153fa2662026a6e8b8e80c38c34036c280e",
      "state": "0bda953745fd4a1e28b2cfdcfe07755142d48d394e6816de5ddeabfcacb2ac0b",
      "ticks": 150
    },
    "ranked": {
      "hash": "8ea23c583b8613cc43394d41d20ee8c093611d1b9a04c58cc9e6ac8d68205c9b",
      "events": "526ec5894c87a150281e799c4fc4135e132f56ea801b1e386460fc5d0c6f7516",
      "state": "a06930eb7ffad1522223e07c777092124d2f8ea6d686c96ae0daf4b143b4433e",
      "ticks": 150
    }
  },
  {
    "casual": {
      "hash": "fb3924e7815d5cc3cea88766a7d198746d4aa8240719d5efaaeb53a4b660d1df",
      "events": "e222d1d8f810bc48a663ff5ff4534d573c410dc5729520b72ac4ef26984be4a1",
      "state": "d2bfa8f4aafc5c3f6608a53b9cee71bdb98e45be6f566ead899a3e4a93bbbf88",
      "ticks": 150
    },
    "ranked": {
      "hash": "037ff09a2d947c8408d5a37b853609b8967020c7d9a0a78630c9e12d2b7d3ac5",
      "events": "2c6c385262996e69726d8b28679b388a42e04e4e846f29cea53de8b368a78354",
      "state": "3f60325a8d9d30b89194ec0c15ca002086fa2c3dbd65f65458da0a2293f5392a",
      "ticks": 150
    }
  },
  {
    "casual": {
      "hash": "aaf7e17421f40e3f5faafc2757708b889d3f9b41c644ceb6d603b7c0e50e0425",
      "events": "d8c8106b0e9069ab00614f1f51b1b872cf44a45aa914346a354b46846cddc013",
      "state": "c8072e615a34b6e43b898255b7581f864acd38182c314bbfe75ba84cbcc72f91",
      "ticks": 135
    },
    "ranked": {
      "hash": "1a13aadf7bea46595c99853ec7c561141af1d0eb4e0b69c8098de9dedee741cc",
      "events": "4ff77e6a0fbe29364827aec6a360d7f71251f5d4e97581850377cee2ed56265f",
      "state": "ff78be621514c5cdf9798d5af9415e51c6cdab835fbd2553e6039b473f60c1bf",
      "ticks": 150
    }
  },
  {
    "casual": {
      "hash": "1b4181c0323e8aba51bfb219657ff52ece5d3bc60a499c883135cc6eb49f3617",
      "events": "cc1f43b196648af6f90b9290552e81c2e0b2fa7e8e57b80c8d874c6b895559b1",
      "state": "4d1a597939814bc550e6abf68094dbec631cb561c44cdd64d4c7f001fea3203f",
      "ticks": 150
    },
    "ranked": {
      "hash": "39a1d688b59cf20a7222fdc17de7461122feca2337530159e8019c8ecedf8126",
      "events": "9f9b0197dcadec9064a0f34a9b6263a51f3ec03a4d6b8a46106cca6b323eaadf",
      "state": "e4ff6d82dffae5ffa0f3de91792e9f6d40fc226b8482c535a35c74dcd9bb69e9",
      "ticks": 150
    }
  },
  {
    "casual": {
      "hash": "d8ae9ca8070f47e69df8b23eb80160582bf4798f59dd87c18781d5ead28d2eaf",
      "events": "6a4a54aa82d16ade458a0f0af6cda11683f5acc9f5d7b4f92730ddc9ee81faac",
      "state": "73ea05297f9a9bce92cf80a3f681213bcf8ff033bcc10fb23af43df8d62ca9a3",
      "ticks": 150
    },
    "ranked": {
      "hash": "0c53b8a34ced2a768e9a5b8201493cbefe7cd893bebce98d4ce4105c89cbc5c5",
      "events": "cfc45b2f5099d475b3bd0bab91872f90734652767b6201fb66ecaac7e27eaf64",
      "state": "58311c718ccb529b310385ade02bec21f8e90cdf28635f2d308d9ac7e879812a",
      "ticks": 150
    }
  },
  {
    "casual": {
      "hash": "55b669586cdd7e1d6b31fca6ea38c3602a21d5ebddc556bfd4873a7d4acbc051",
      "events": "5187abc1ed0c52c21a2fb80db7728c1e57ad51946c754a2d4c4a4270a676037e",
      "state": "45be7a6466730f405695dda461e9f99094c909beb13f89a76be413b0f5612a9b",
      "ticks": 135
    },
    "ranked": {
      "hash": "295a31a59f9d91311b7ae7119a6b9ee8ec1da9126e89e8dc76eacc1764ed4d0b",
      "events": "0283b236032431ad77ca5ac3739eb3ae0eba86b3932f41192e361a352fafb35c",
      "state": "b57b03bf563313cf014fea4307eb0a60d439283172cfafc5e7e6a95526408dd0",
      "ticks": 150
    }
  },
  {
    "casual": {
      "hash": "8330945b9597afb4a180142e7f3e1d7dae76df6d543dd3806923803129b05c66",
      "events": "eaa406a72471f9ff6a2ac65e70a03daad792e1d472c570f8abc98612f012b65e",
      "state": "64a75ea9350c45b164c337cada2618fce752686f6351112068677979f55fbfe7",
      "ticks": 150
    },
    "ranked": {
      "hash": "2fe8a39eb88fe9262918e9e8679ee2cec22ff47ebebb1ffdc3d03d4debbba6e1",
      "events": "9bc54afd611afb2e7a1a944cf4af3f66ae3f2e9f8d879a5195e63ed117d5c972",
      "state": "82c89afb71155fade7f2d333bce57f438dd74a99712cda7953af072e447dc558",
      "ticks": 150
    }
  },
  {
    "casual": {
      "hash": "fe4f0738b5448c8bba0e204cc8f33c0a02bb2cdd5da5fb20b0343f52e95dd556",
      "events": "14a814abca7ab6bf35f5140de55841b5a19767190c8d17f4fd7042b3ff850e45",
      "state": "bc1bd8062a92fa3113b8cda1b4bbeb9bd35c032818c5398f4b4aa76e99c9f576",
      "ticks": 150
    },
    "ranked": {
      "hash": "9f3c7c9b0bf6c8970b16b043739061fd15e017e486fcc894d7c337b9228f7eb9",
      "events": "34d36e799d2474a79e03177b68cbeb32d26911b7a3b50f7ac3a90a58efdb4f59",
      "state": "4d08a10313c7161ab477a192e9b0267d3b0e0110f2bd7e0ca23ac2536762fa24",
      "ticks": 150
    }
  },
  {
    "casual": {
      "hash": "01887a1ec5a7d0188086ef6cae688714d19c7bf03a1526602121ea45c8b76791",
      "events": "efa46c0bcb0bc90ae39b63ee3bd9abc945d8b31e46915a5c113191e8e7a7ec60",
      "state": "9963e8f1f6ca89bdf887e714b8456597a0a2954ad6eca0bd640c1554aad9cf83",
      "ticks": 60
    },
    "ranked": {
      "hash": "126d8aa690db334cad73e03b6d816172d699ec093405d5b6db2dba0b683e5da8",
      "events": "f5f555841fb0d09b5dcb7a7becfc0c8523c2382ca3c90e778581c1a7b5382a56",
      "state": "d7e24a39031ca9f920c858fda41728233446c69568aba8d9ee3667e321860390",
      "ticks": 150
    }
  },
  {
    "casual": {
      "hash": "0543facdbcc15f45905cd9fa75b4642ec5f0846238849a2ccfe40a56f8457ebe",
      "events": "53a0f3e28757cd149d4d0ea452d87d9ad1dd4ec62ec3f2156f6b7c110135fb85",
      "state": "c5891f5525a6a8276ef636b813e24f9254b4a1dfd99437710fec08b8ca813954",
      "ticks": 150
    },
    "ranked": {
      "hash": "ae65330d14ed201c38924c7b69e2307e730b38290044880c44f866e63b714bf3",
      "events": "390d968c9b545264dbc19a0ac8b2c919a5c53e65e3dddd43b65695110a23b3ec",
      "state": "44e8e4a8f2cb3ee3b3cea845e5e931facfab1912c72d1315224aa25c83f69868",
      "ticks": 150
    }
  }
];
