// @ts-nocheck -- vendored prototype code, see the header below.
/* The Skirm Arena Deck prototype's world: the 10-map v2 roster, mirrored 2-crew arena generation,
 * and the isometric canvas renderer with per-map scenery and weather. Ported verbatim from the
 * prototype's script so the app draws the exact same arenas; typed wrappers live in ../world.ts and
 * ../ArenaCanvas.tsx. The prototype's simulated match is not ported: matches are played by the v2 engine
 * (@skirm/engine/v2). Edit here only to fix bugs; new code goes in typed modules. */
import { drawFigure, drawIntent, drawSkillChip } from '../figure2d';
const MAPS_RAW = [{"id":"saltmarsh-weir","name":"Saltmarsh Weir","region":"Tidal flats","diff":1,"label":"Tutorial","blurb":"Boardwalk village on a salt marsh. The weir along the top has cracked open one tile wide, and the tide spills down into the lanes.","hazard":["Tide","Spreads every 4 ticks from the weir into every open tile"],"goal":"Collect 2 water jugs, then reach the shelter","legend":{"floor":"Boardwalk","wall":"Sea wall","water":"Tide water","fuel":["Marsh reeds","No tags"],"crate":"Fish crate","supply":"Water jug","exit":"Stilt shelter","start":"Agent"},"pal":{"bg":"#06222a","glow":"#1f8f9a","accent":"#34e0c8","floor":"#8b6d4c","wall":"#6d7a78","water":"#2a9fc6","fuel":"#7f9a5a","crate":"#9a6b3d","dirt":"#7a6a50","tree":"#3f7a55"},"grid":["############","#~~~~~~~~~~#","####.#######","#...,...*..#","#.##..##...#","#*.#..#..c.#","#..#.....#.#","#S.....E...#","############"],"crew":"1–2","inv":3,"elev":null,"wallH":0.9,"mood":"Overcast teal water, bleached boardwalk planks, a cold sea-blue accent. Calm on purpose so new players can read the board."},{"id":"ashfall-orchard","name":"Ashfall Orchard","region":"Burnt hills","diff":2,"label":"Easy","blurb":"An apple orchard in the dry season. A spark in the north corner walks through the grass tree by tree, and the farmhouse root cellar is the only way out.","hazard":["Fire","Spreads every 3 ticks into dry grass and trees"],"goal":"Collect 3 seed packs, then reach the cellar","legend":{"floor":"Packed earth","wall":"Stone fence","fuel":"Dry grass","tree":"Apple tree","fire":"Grass fire","supply":"Seed pack","exit":"Root cellar","start":"Agent"},"pal":{"bg":"#1d0f08","glow":"#a3401a","accent":"#ff9a3d","floor":"#6e5638","wall":"#7d7466","fuel":"#b39a4a","tree":"#56702e","fire":"#ff7a2a","dirt":"#6a5338","crate":"#7a5030","water":"#3a8fb0"},"grid":["############","#^,,T,,T,,,#","#,,,,,,,,,,#","#T,,..*.,T,#","#,,.T##.,,,#","#*,..##..,T#","#T,,....,,*#","#S..,,T..E.#","############"],"crew":"1–2","inv":3,"elev":null,"wallH":0.55,"mood":"Smoke-orange sky, cracked ochre earth, olive trees going brown. The accent is the ember itself."},{"id":"frostline-depot","name":"Frostline Depot","region":"North rail line","diff":2,"label":"Easy","blurb":"A rail depot buried in snow. Freight crates block the aisles and drifts seal the doors. Nothing spreads here, but the cold leaves very few steps to spare.","hazard":["No hazard","Nothing spreads. A hard 44-step limit, so every wasted push counts"],"goal":"Collect 2 heat packs, then reach the warm room","legend":{"floor":"Packed snow","wall":"Steel shed","dirt":"Snowdrift","crate":"Freight crate","supply":"Heat pack","exit":"Warm room","start":"Agent"},"pal":{"bg":"#0a1824","glow":"#4b86b5","accent":"#cfeaff","floor":"#c2cfdc","wall":"#3b4a5d","dirt":"#eef3f8","crate":"#8a6a48","fuel":"#9aa8b5","tree":"#3e5f55","water":"#5a9fd0"},"grid":["############","#S..#..d..*#","#.c.#..d...#","#...c..#####","##d##..c...#","#*...#...c.#","#..c.#.##..#","#....d...E.#","############"],"crew":"1","inv":2,"elev":null,"wallH":1.1,"mood":"Blue-white snow, gunmetal sheds, and a near-white frost accent. The quietest palette in the pack."},{"id":"glasshouse-ruins","name":"Glasshouse Ruins","region":"Old botanic garden","diff":3,"label":"Standard","blurb":"A collapsed glasshouse taken over by vines. The boiler room is still burning, and the gardener is trapped behind rows of dry creepers.","hazard":["Fire","Spreads every 2 ticks through vines and palms"],"goal":"Collect 4 seed vials, then reach the gate","legend":{"floor":"Mosaic tile","wall":"Iron frame","fuel":"Dry vines","tree":"Palm","fire":"Boiler fire","supply":"Seed vial","survivor":"Gardener","exit":"Garden gate","start":"Agent"},"pal":{"bg":"#0b1a14","glow":"#2f7a52","accent":"#ec72d0","floor":"#4c6a5c","wall":"#2c3a36","fuel":"#86a34a","tree":"#2f8f5a","fire":"#ff7a3a","dirt":"#5a5040","crate":"#6a4a30","water":"#3a8fb0"},"grid":["############","#,,,#^#,,,*#","#,T,,.,,T,,#","#,,..*..,,,#","##,#.#.#,###","#*,,.....,,#","#,T,,.S.,T,#","#,,,,E...,*#","############"],"crew":"1–2","inv":3,"elev":null,"wallH":1.3,"mood":"Deep greenhouse green, wrought-iron frames, and an orchid-pink accent for the flowers still alive."},{"id":"copper-hollow","name":"Copper Hollow","region":"Abandoned mine","diff":3,"label":"Standard","blurb":"A copper mine after a cave-in. Rubble fills every tunnel, a miner is cut off in the middle, and the old pump shaft in the corner is leaking.","hazard":["Flood","Spreads every 4 ticks out of the pump shaft"],"goal":"Collect 3 lamps, then reach the lift","legend":{"floor":"Mine floor","wall":"Bedrock","dirt":"Rubble","water":"Shaft water","supply":"Lamp oil","survivor":"Miner","exit":"Cage lift","start":"Agent"},"pal":{"bg":"#160d0a","glow":"#8a3d1e","accent":"#5fe08f","floor":"#5a4335","wall":"#2e2420","dirt":"#a0603a","water":"#3fa0a8","fuel":"#6a5a40","crate":"#6a4a30","tree":"#3a5a3a"},"grid":["############","#S.d#ddd#~~#","#..d#d*d#~~#","#d..d.dd.d.#","#dd#ddd#d..#","#*d#.d*.#dd#","#.dddd#dd.d#","#dd.#..d.dE#","############"],"crew":"1–2","inv":3,"elev":null,"wallH":1.1,"mood":"Rust and raw copper rock with a patina-green accent, like oxidised ore in lamplight."},{"id":"dust-bowl-silos","name":"Dust Bowl Silos","region":"Grain plains","diff":3,"label":"Standard","blurb":"Tall grain silos on a dry plain. A spark in the spilled grain is moving toward the yard, and loose hand carts can be pushed into the gap to stop it.","hazard":["Fire","Spreads every 2 ticks through spilled grain"],"goal":"Collect 2 water tanks, then reach the cellar","legend":{"floor":"Dry dirt","wall":"Grain silo","fuel":"Spilled grain","fire":"Grain fire","crate":"Hand cart","supply":"Water tank","survivor":"Farmer","exit":"Storm cellar","start":"Agent"},"pal":{"bg":"#1f160a","glow":"#a8742a","accent":"#ffd23f","floor":"#a98a5a","wall":"#8a7d6c","fuel":"#d9b85c","crate":"#7a4f2e","fire":"#ff7a2a","dirt":"#8a6a40","tree":"#6a7a3a","water":"#3a8fb0"},"grid":["############","#S..,,#,,^,#","#.c.,,#,,,,#","#...cc....*#","#.##...##..#","#.##...##c.#","#*.....,,,,#","#..c...,,E.#","############"],"crew":"1–2","inv":3,"elev":null,"wallH":1.75,"mood":"Dust-brown sky, sun-bleached silos and a wheat-yellow accent. The tallest walls in the pack."},{"id":"monsoon-terraces","name":"Monsoon Terraces","region":"Highland farms","diff":4,"label":"Hard","blurb":"Rice terraces cut into a mountainside. Three irrigation gates burst in the storm, and water runs down the steps toward the village.","hazard":["Flood","Spreads every 4 ticks from three gates at once"],"goal":"Collect 3 rice sacks, then reach the hut","legend":{"floor":"Terrace mud","wall":"Terrace wall","fuel":["Rice shoots","No tags"],"tree":["Banana tree","solid"],"water":"Floodwater","supply":"Rice sack","survivor":"Farmer","exit":"Village hut","start":"Agent"},"pal":{"bg":"#081a18","glow":"#1e6e5a","accent":"#7aa8ff","floor":"#5e7a4a","wall":"#4a5148","fuel":"#8fc25a","tree":"#3a7a40","water":"#4aa8d8","dirt":"#6a5a40","crate":"#6a4a30"},"grid":["############","#~...~...~.#","#..,..,..,.#","##.##.##.###","#*..,S..*..#","#.,..T..,..#","###.###.####","#....*...E.#","############"],"crew":"1–3","inv":3,"elev":[1,1,1,1,0.5,0.5,0.5,0,0],"wallH":0.6,"mood":"Rain-dark jade fields and wet slate, with a storm-blue accent. The board is built on three height levels."},{"id":"sunken-metro","name":"Sunken Metro","region":"Central line","diff":4,"label":"Hard","blurb":"A metro platform under a flooded city. Water pushes in from both tunnel mouths and rubble from the ceiling blocks the way to the stairs.","hazard":["Flood","Spreads every 2 ticks from both tunnels"],"goal":"Collect 3 med kits, then reach the stairs","legend":{"floor":"Platform tile","wall":"Concrete pillar","dirt":"Ceiling rubble","water":"Tunnel water","supply":"Med kit","survivor":"Station guard","exit":"Exit stairs","start":"Agent"},"pal":{"bg":"#070c18","glow":"#203a78","accent":"#c6f04a","floor":"#3d475c","wall":"#262d3d","dirt":"#6b6258","water":"#2f7fb8","fuel":"#4a5a4a","crate":"#5a4a3a","tree":"#2a4a3a"},"grid":["############","#~~#....#~~#","#~~d.*..d~~#","####.##.####","#S.....d..*#","#.####.###.#","#..d.....d.#","#*.#..E..#.#","############"],"crew":"1–3","inv":3,"elev":null,"wallH":1.2,"mood":"Midnight navy tiles and wet concrete under a single signal-lime accent, like the last working light on the line."},{"id":"basalt-stair","name":"Basalt Stair","region":"Volcanic ridge","diff":5,"label":"Brutal","blurb":"A mountain pass on a waking volcano. Lava creeps down from the vent, and only placed stone or a dug channel slows it.","hazard":["Lava","Spreads every 5 ticks and kills anything it touches"],"goal":"Collect 2 ash masks, then reach the cave","legend":{"floor":"Cooled basalt","wall":"Rock spire","dirt":"Loose scree","lava":"Lava flow","supply":"Ash mask","survivor":"Climber","exit":"Cave mouth","start":"Agent"},"pal":{"bg":"#0d0a12","glow":"#7a2a1a","accent":"#b28bff","floor":"#3a3540","wall":"#221f28","dirt":"#5a4f52","lava":"#ff5a1f","water":"#ff5a1f","fuel":"#4a3a3a","crate":"#5a4a3a","tree":"#3a3a3a"},"grid":["############","#LLL..#..*.#","#LL...#....#","#L....#....#","###.#####..#","#*..d...d..#","#.##..d.##.#","#..S.d....E#","############"],"crew":"1–3","inv":2,"elev":null,"wallH":1.4,"mood":"Obsidian violet-black rock and molten orange flow, with a cool violet accent so the UI never competes with the lava."},{"id":"blackout-harbor","name":"Blackout Harbor","region":"Storm coast","diff":5,"label":"Elite","blurb":"A fishing harbor at night, in a typhoon. The sea is coming over the wall, the fuel dock is on fire, and three dockworkers are still on the pier.","hazard":["Tide + fire","Tide every 3 ticks, fire every 4 ticks through the nets"],"goal":"Collect 3 flares, then reach the lighthouse","legend":{"floor":"Wet pier","wall":"Harbor wall","dirt":"Fallen cargo","crate":"Oil drum","fuel":"Fishing nets","water":"Storm surge","fire":"Fuel fire","supply":"Flare","survivor":"Dockworker","exit":"Lighthouse","start":"Agent"},"pal":{"bg":"#07071a","glow":"#4a1a3a","accent":"#ff3b5c","floor":"#3a3a50","wall":"#24243a","fuel":"#6a5a4a","water":"#2a5a9a","crate":"#7a3a2a","dirt":"#5a4a42","fire":"#ff7a2a","tree":"#2a3a3a"},"grid":["############","#~~~~~~~~~~#","####.#######","#..cS..^,,*#","#.#d##.#,,.#","#*.........#","#.##..#d#..#","#*.....c..E#","############"],"crew":"3","inv":3,"elev":null,"wallH":1,"mood":"Night-storm indigo and wet steel lit by a hazard red accent. The finale, built to need a full crew."}];
/* ───────────── v2 map data (10 maps, mirrored for 2 crews) ───────────── */
const V2 = {
  'saltmarsh-weir':  {code:'SW-01', ev:{water:4}, cap:7, unlock:'Builder', pressure:'Tide spills through the weir every 8 s',
    verbs:[['Sandbag the gap','add_solid'],['Push a fish crate','push'],['Open a sluice','add_liquid']]},
  'ashfall-orchard': {code:'AO-02', ev:{fire:3}, cap:7, unlock:'Firefighter', pressure:'Grass fire spreads every 6 s',
    verbs:[['Light a backburn','ignite'],['Beat out flames','extinguish']]},
  'frostline-depot': {code:'FD-03', ev:{}, cap:0, unlock:'Digger', pressure:'No hazard. Drifts and crates block routes',
    verbs:[['Shovel a drift','remove_solid'],['Push a freight crate','push'],['Stack crates','add_solid']]},
  'glasshouse-ruins':{code:'GR-04', ev:{fire:2}, cap:7, unlock:'Firefighter', pressure:'Boiler fire spreads every 4 s',
    verbs:[['Hose the boiler room','extinguish'],['Break a glass pane','remove_solid'],['Open the fountain','add_liquid']]},
  'copper-hollow':   {code:'CH-05', ev:{water:4}, cap:7, unlock:'Digger', pressure:'Pump shaft floods every 8 s',
    verbs:[['Dig rubble','remove_solid'],['Shore a tunnel','add_solid'],['Start the pump','add_liquid']]},
  'dust-bowl-silos': {code:'DB-06', ev:{fire:2}, cap:7, unlock:'Scout', pressure:'Grain fire spreads every 4 s',
    verbs:[['Push a hand cart','push'],['Set grain alight','ignite'],['Ring the dinner bell','area_repel']]},
  'monsoon-terraces':{code:'MT-07', ev:{water:4}, cap:6, unlock:'Builder', pressure:'Floodwater from 3 gates every 8 s',
    verbs:[['Open a paddy gate','add_liquid'],['Build a mud wall','add_solid'],['Grow rice','grow']]},
  'sunken-metro':    {code:'SM-08', ev:{water:2}, cap:6, unlock:'Scout', pressure:'Both tunnels flood every 4 s',
    verbs:[['Raise a flood barrier','add_solid'],['Clear rubble','remove_solid'],['Sound the alarm','area_repel']]},
  'basalt-stair':    {code:'BS-09', ev:{lava:5}, cap:6, unlock:'Builder', pressure:'Lava every 10 s. Touching it removes the agent',
    verbs:[['Build a stone dam','add_solid'],['Clear scree','remove_solid'],['Vent a fumarole','area_repel']]},
  'blackout-harbor': {code:'BH-10', ev:{water:3, fire:4}, cap:6, unlock:'Scout', pressure:'Tide every 6 s and net fire every 8 s',
    verbs:[['Sandbag','add_solid'],['Douse fire','extinguish'],['Cut nets','remove_solid'],['Fire a flare','area_repel']]},
};
/* difficulty sets size and how much the crews collide */
const SPEC = {
  1:{size:[31,13], band:1, routes:1, cont:1, valves:0, drops:[],      own:1, fog:false, steal:false, night:false},
  2:{size:[35,15], band:2, routes:2, cont:1, valves:0, drops:[40],    own:2, fog:false, steal:false, night:false},
  3:{size:[41,19], band:4, routes:2, cont:3, valves:1, drops:[40],    own:2, fog:true,  steal:true,  night:false},
  4:{size:[47,21], band:5, routes:3, cont:3, valves:2, drops:[35,70], own:2, fog:true,  steal:true,  night:false},
  5:{size:[55,25], band:7, routes:3, cont:5, valves:3, drops:[35,70], own:2, fog:true,  steal:true,  night:true},
};
const goalFor = d => { const s = SPEC[d]; return s.own + Math.ceil((s.cont + s.drops.length) / 2); };
/* the shared switch on each map, and what it does to the rival's tunnel */
const SWITCH = {
  'glasshouse-ruins':['Open the fountain','water'], 'copper-hollow':['Start the pump','water'], 'dust-bowl-silos':['Light the grain line','fire'],
  'monsoon-terraces':['Open a paddy gate','water'], 'sunken-metro':['Drop the tunnel ceiling','dirt'], 'basalt-stair':['Trigger a rockslide','dirt'], 'blackout-harbor':['Open the dock gates','water'],
};
/* Copper Hollow is hand-built; the other nine are generated from their base rooms */
const HAND = {'copper-hollow':{left:[
    '####################',
    '#SS.dd.#...d...#....',
    '#S...d.#.*.d...#.#..',
    '#...dd.#...dd..#.#..',
    '#.d.....d#####....d.',
    '#.d.##.........d....',
    '##d##..###d###.##...',
    '#....d.#.....#.....#',
    '#.*..d.#.dd..#..d..#',
    '#....d...dd.....d...',
    '#.dd.##.....#..d...#',
    '#..d..#.d#d.#......#',
    '###.###.....###.##..',
    '#.....11111.d.......',
    '#.d.##d.######.##d..',
    '#~~.d........#..#...',
    '#~~..d....d..#..#...',
    '#~~~.dd..d....d.....',
    '####################'], center:'#.X...X..E..DV..X.#'}};

function genArena(m) {
  const sp = SPEC[m.diff], [W, H] = sp.size, hw = (W - 1) / 2, band = sp.band;
  const sepX = hw - band - 1, homeW = sepX - 1;
  const R = rng(m.id.length * 977 + m.diff * 31 + m.id.charCodeAt(0));
  const I = m.grid.slice(1, m.grid.length - 1).map(r => r.slice(1, r.length - 1));
  const IW = I[0].length, IH = I.length;
  const L = Array.from({length:H}, (_, y) => Array.from({length:hw}, (_, x) => (y === 0 || y === H - 1 || x === 0) ? '#' : '.'));
  const counts = {}; I.join('').split('').forEach(c => { if (',Tdc'.includes(c)) counts[c] = (counts[c] || 0) + 1; });
  const obs = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0] || 'd';
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < hw; x++) if (R() < .14) L[y][x] = R() < .3 ? '#' : obs;
  // home zone: the base room repeated down the side, every other copy flipped
  const ny = Math.max(1, Math.floor((H - 1) / (IH + 1)));
  for (let j = 0; j < ny; j++) {
    const y0 = 1 + j * (IH + 1), flip = j % 2 === 1;
    for (let ry = 0; ry < IH; ry++) for (let rx = 0; rx < IW; rx++) {
      const y = y0 + ry, x = 1 + rx; if (y >= H - 1 || x > homeW) continue;
      let c = I[flip ? IH - 1 - ry : ry][rx];
      if (c === 'S') c = j === 0 ? 'S' : '.';
      if (c === 'E') c = '.';
      L[y][x] = c;
    }
    const wy = y0 + IH; if (j < ny - 1 && wy < H - 1) for (let x = 1; x <= homeW; x++) L[wy][x] = (x === 3 || x === 8 || x > IW) ? '.' : '#';
  }
  // own items: keep the ones about halfway out from the start
  let S = null; L.forEach((r, y) => r.forEach((c, x) => { if (c === 'S' && !S) S = [x, y]; }));
  const own = []; L.forEach((r, y) => r.forEach((c, x) => { if (c === '*') own.push([x, y]); }));
  own.sort((a, b) => (Math.abs(a[0]-S[0]) + Math.abs(a[1]-S[1])) - (Math.abs(b[0]-S[0]) + Math.abs(b[1]-S[1])));
  const keepFrom = Math.max(0, Math.floor(own.length / 2) - Math.floor(sp.own / 2));
  own.forEach((p, i) => { if (i < keepFrom || i >= keepFrom + sp.own) L[p[1]][p[0]] = '.'; });
  // no hazard source within 3 tiles of the start, so the first waves cannot box a crew in at spawn
  L.forEach((r, y) => r.forEach((c, x) => { if ('~^L'.includes(c) && Math.abs(x - S[0]) + Math.abs(y - S[1]) <= 3) L[y][x] = '.'; }));
  // routes into the middle; the ones with a switch get a floodable stretch
  const routeRows = []; for (let k = 0; k < sp.routes; k++) routeRows.push(Math.round((k + 1) * (H - 1) / (sp.routes + 1)));
  for (let y = 1; y < H - 1; y++) L[y][sepX] = '#';
  routeRows.forEach((y, k) => { for (let x = Math.max(1, homeW - 6); x < hw; x++) L[y][x] = (k < sp.valves && x >= homeW - 4 && x <= homeW) ? String(k + 1) : '.'; });
  // the middle band: open cavern with a few pillars
  for (let y = 1; y < H - 1; y++) for (let x = sepX + 1; x < hw; x++) if (!routeRows.includes(y)) L[y][x] = R() < .1 ? '#' : R() < .07 ? obs : '.';
  // flow pass over the home zone (the hand-tuning the prototype asks for, measured against hand-built
  // Copper Hollow): a dead-end stub opens into a loop where a wall beside it also touches other open
  // floor. Never on the border or the wall line that sets the route count into the middle.
  const walkable = c => c === '.' || c === ',' || c === '*' || c === 'S' || c === 'd' || /[0-9]/.test(c);
  const around = (x, y) => [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]].filter(([a, b]) => a >= 1 && b >= 1 && a < sepX && b < H - 1);
  for (let pass = 0; pass < 6; pass++) {
    let changed = false;
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < sepX; x++) {
      if (!walkable(L[y][x]) || around(x, y).filter(([a, b]) => walkable(L[b][a])).length !== 1) continue;
      const door = around(x, y).find(([a, b]) => L[b][a] === '#' && around(a, b).some(([c, d]) => (c !== x || d !== y) && walkable(L[d][c])));
      if (door) { L[door[1]][door[0]] = '.'; changed = true; }
    }
    if (!changed) break;
  }
  // a second way out where the start's only way to the middle runs single file (Copper Hollow's spawn
  // has several): for each tile every route from the start must cross, open a home-zone wall with
  // floor on both sides of it. The route count into the middle stays as designed.
  const S0 = (() => { for (let y = 0; y < H; y++) { const x = L[y].indexOf('S'); if (x >= 0) return [x, y]; } return null; })();
  const fromStart = blocked => {
    const seen = new Set([S0.join()]); const q = [S0];
    while (q.length) { const [x, y] = q.pop(); for (const [a, b] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
      const k = `${a},${b}`; if (a < 1 || b < 1 || a > sepX || b >= H - 1 || k === blocked || seen.has(k) || !walkable(L[b][a])) continue; seen.add(k); q.push([a, b]); } }
    return seen;
  };
  const gates = () => { const g = []; for (let y = 1; y < H - 1; y++) if (walkable(L[y][sepX])) g.push(`${sepX},${y}`); return g; };
  const skip = new Set();
  for (let pass = 0; S0 && pass < 12; pass++) {
    const all = fromStart(null), out = gates();
    const choke = [...all].find(k => k !== S0.join() && !out.includes(k) && !skip.has(k) && !out.some(g => fromStart(k).has(g)));
    if (!choke) break;
    const near = fromStart(choke), far = new Set([...all].filter(k => !near.has(k) && k !== choke));
    let door = null;
    for (let y = 1; y < H - 1 && !door; y++) for (let x = 1; x < sepX && !door; x++) {
      if (L[y][x] !== '#') continue;
      const n = [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]].map(([a, b]) => `${a},${b}`);
      if (n.some(k => near.has(k)) && n.some(k => far.has(k))) door = [x, y];
    }
    if (door) L[door[1]][door[0]] = '.'; else skip.add(choke);
  }
  // center column: lift, switches, drops and the contested items
  const C = Array.from({length:H}, (_, y) => (y === 0 || y === H - 1) ? '#' : '.');
  const ey = Math.floor(H / 2); C[ey] = 'E';
  const free = []; for (let y = 2; y < H - 2; y++) if (Math.abs(y - ey) > 1) free.push(y);
  const grab = y => { free.splice(free.indexOf(y), 1); return y; };
  const nearest = y => free.reduce((b, r) => Math.abs(r - y) < Math.abs(b - y) ? r : b, free[0]);
  for (let k = 0; k < sp.valves; k++) C[grab(nearest(routeRows[k] + (routeRows[k] < ey ? -1 : 1)))] = 'V';
  const spread = n => { const out = []; for (let i = 0; i < n; i++) out.push(free[Math.floor((i + .5) * free.length / n)]); return out; };
  spread(sp.drops.length).forEach(y => { C[grab(y)] = 'D'; });
  // every contested item on the center column, as in hand-built Copper Hollow: the same distance
  // from both crews, so each one is a race (off-center pairs went to whichever crew was nearer)
  spread(sp.cont).forEach(y => { C[grab(nearest(y))] = 'X'; });
  const pack = () => ({left:L.map(r => r.join('')), center:C.join('')});
  // make sure everything matters is reachable from the start; carve through walls if not
  for (let pass = 0; pass < 12; pass++) {
    const A = buildXL({...m, arena:pack()});
    const targets = [];
    A.grid.forEach((t, i) => { if (t === 'item' || t === 'exit') targets.push(i); });
    A.drops.forEach(([x, y]) => targets.push(y * A.w + x));
    A.valves.forEach(v => targets.push(v.pos[1] * A.w + v.pos[0] + 1));
    const bad = targets.find(t => !bfs(A, A.grid, A.starts.A[0], (x, y, i) => i === t, {dig:true}));
    if (bad == null) break;
    const tmp = A.grid.map((t, i) => { const x = i % A.w, y = (i / A.w) | 0; return (t === 'wall' && x > 0 && y > 0 && x < A.w - 1 && y < A.h - 1) ? null : t; });
    const path = bfs(A, tmp, A.starts.A[0], (x, y, i) => i === bad, {dig:true}) || [];
    path.forEach(i => { const x = i % A.w, y = (i / A.w) | 0; if (A.grid[i] !== 'wall') return; if (x < hw) L[y][x] = '.'; else if (x === hw) C[y] = '.'; });
  }
  return pack();
}

function buildXL(m) {
  const sp = SPEC[m.diff], ar = m.arena;
  const L = ar.left, Cc = ar.center, H = L.length, half = L[0].length, W = half * 2 + 1, cx = half;
  const grid = [], startsA = [], laneK = {}, contested = [], valvePos = [], drops = [];
  let exit = null;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let c = x < half ? L[y][x] : x > half ? L[y][W - 1 - x] : Cc[y];
    if (c === 'S') { if (x < half) startsA.push([x, y]); c = '.'; }
    if (c >= '1' && c <= '3') { const k = +c - 1; (laneK[k] || (laneK[k] = {A:[], B:[]}))[x < half ? 'A' : 'B'].push(y * W + x); c = '.'; }
    if (c === 'X') { contested.push(y * W + x); c = '*'; }
    if (c === 'E') exit = [x, y];
    if (c === 'D') { drops.push([x, y, sp.drops[drops.length] || 40]); c = '.'; }
    if (c === 'V') { valvePos.push([x, y]); grid.push('valve'); continue; }
    grid.push(CH[c] ?? null);
  }
  // fill in starts next to the first one
  const s0 = startsA[0];
  for (const [dx, dy] of [[1,0],[0,1],[1,1],[0,-1],[2,0]]) { if (startsA.length >= 3) break; const x = s0[0] + dx, y = s0[1] + dy; if (x > 0 && y > 0 && y < H - 1 && x < half && grid[y * W + x] === null && !startsA.some(p => p[0] === x && p[1] === y)) startsA.push([x, y]); }
  const starts = {A:startsA.slice(0, 3), B:startsA.slice(0, 3).map(([x, y]) => [W - 1 - x, y])};
  const sw = SWITCH[m.id] || ['Shared switch', 'water'];
  const valves = valvePos.map((pos, k) => ({pos, lanes:laneK[k] || {A:[], B:[]}, name:sw[0], kind:sw[1]}));
  const c0 = contested.find(i => i % W === cx) ?? contested[0];
  return {w:W, h:H, grid, starts, exit, center:[c0 % W, (c0 / W) | 0], contested, n:goalFor(m.diff), origin:{}, xl:true,
    valves, drops, fog:sp.fog, steal:sp.steal, night:sp.night, spec:sp};
}
const CH = {'#':'wall','.':null,',':'grass','T':'tree','d':'dirt','~':'water','L':'lava','^':'fire','*':'item','E':'exit','c':'crate','S':null,'B':'block'};
const HAZ = new Set(['water','lava','fire']);
const SOLID = new Set(['wall','tree','crate','block','dirt']);
const goalN = m => +((m.goal.match(/Collect (\d+)/) || [0, 2])[1]);
const nameOf = v => Array.isArray(v) ? v[0] : v;

function buildArena(m) {
  if (m.xl !== false) { if (!m.arena) m.arena = HAND[m.id] || genArena(m); return buildXL(m); }
  const G = m.grid, H = G.length, W0 = G[0].length;
  const L = G.map(r => r.slice(0, W0 - 1));
  const n = goalN(m);
  let S = null; L.forEach((r, y) => { const x = r.indexOf('S'); if (x >= 0) S = [x, y]; });
  const items = []; L.forEach((r, y) => [...r].forEach((c, x) => { if (c === '*') items.push([x, y]); }));
  items.sort((a, b) => (Math.abs(a[0]-S[0]) + Math.abs(a[1]-S[1])) - (Math.abs(b[0]-S[0]) + Math.abs(b[1]-S[1])));
  const keep = new Set(items.slice(0, n - 1).map(p => p.join(',')));
  const half = L[0].length, W = half * 2 + 1, cx = half;
  const open = c => c === '.' || c === ',' || c === '*' || c === 'S' || c === 'E';
  const openRows = []; for (let y = 1; y < H - 1; y++) if (open(L[y][half - 1])) openRows.push(y);
  const mid = (H - 1) / 2;
  openRows.sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid));
  const ey = openRows[0] ?? Math.floor(mid);
  const iy = openRows.length > 1 ? openRows.slice(1).sort((a, b) => Math.abs(b - ey) - Math.abs(a - ey))[0] : null;
  const grid = [], starts = {A:[], B:[]}, origin = {};
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let c;
      if (x < half) c = L[y][x];
      else if (x > half) c = L[y][W - 1 - x];
      else c = (y === 0 || y === H - 1) ? '#' : (y === ey ? 'E' : (open(L[y][half - 1]) ? '.' : '#'));
      if (c === 'E' && x !== cx) c = '.';
      if (c === '*') { const lx = x < half ? x : W - 1 - x; if (!keep.has(lx + ',' + y)) c = '.'; }
      if (c === 'S') c = '.';
      grid.push(CH[c] ?? null);
    }
  }
  // contested item in the center column; if the column has no second open row, put it beside the exit
  let ci = iy != null ? [cx, iy] : null;
  if (!ci) { for (const dy of [-1, 1]) { const y = ey + dy; if (y > 0 && y < H - 1) { grid[y * W + cx] = null; ci = [cx, y]; break; } } }
  grid[ci[1] * W + ci[0]] = 'item';
  // starts: S and two open neighbours, mirrored for the rival
  const nb = [[0,0],[0,1],[0,-1],[1,0],[-1,0],[1,1],[1,-1]];
  for (const [dx, dy] of nb) {
    const x = S[0] + dx, y = S[1] + dy;
    if (x > 0 && x < half && y > 0 && y < H - 1 && grid[y * W + x] === null && starts.A.length < 3) { starts.A.push([x, y]); starts.B.push([W - 1 - x, y]); }
  }
  grid.forEach((t, i) => { if (t === 'item') origin[i] = true; });
  return {w:W, h:H, grid, starts, exit:[cx, ey], center:ci, n, origin};
}

/* ───────────── BFS ───────────── */
const DIRS = [[0,-1],[1,0],[0,1],[-1,0]];
const DIRS_B = [[0,-1],[-1,0],[0,1],[1,0]];
function bfs(A, grid, from, isGoal, opts = {}) {
  const D = opts.mirror ? DIRS_B : DIRS;
  const W = A.w, H = A.h, seen = new Int16Array(W * H).fill(-1), q = [from[1] * W + from[0]];
  seen[q[0]] = q[0];
  const block = opts.block || new Set();
  for (let h = 0; h < q.length; h++) {
    const i = q[h], x = i % W, y = (i / W) | 0;
    if (h > 0 && isGoal(x, y, i)) { const path = []; let k = i; while (k !== q[0]) { path.push(k); k = seen[k]; } return path.reverse(); }
    for (const [dx, dy] of D) {
      const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const j = ny * W + nx; if (seen[j] >= 0) continue;
      const t = grid[j];
      if (t === 'wall' || t === 'tree' || t === 'crate' || t === 'block' || t === 'valve' || HAZ.has(t)) continue;
      if (t === 'dirt' && opts.dig === false) continue;
      if (block.has(j) && !isGoal(nx, ny, j)) continue;
      seen[j] = i; q.push(j);
    }
  }
  return null;
}

/* ───────────── crews ───────────── */
const ROLE_UNLOCK = {Builder:'add_solid', Digger:'remove_solid', Firefighter:'extinguish', Scout:'area_repel', Runner:null, Hauler:null};
const ROSTER = [
  {id:'wick', name:'Wick', role:'Builder', c:'#34e0c8', bone:'#ece8e1', vis:4, com:3, talk:'Calm', skill:'Flood Warden', ver:'v3'},
  {id:'moss', name:'Moss', role:'Runner', c:'#ffb547', bone:'#f1e6d2', vis:3, com:3, talk:'Blunt', skill:'Clean Sweep', ver:'v5'},
  {id:'rook', name:'Rook', role:'Scout', c:'#8fa8ff', bone:'#e6e9f2', vis:5, com:4, talk:'Cocky', skill:'Read the Room', ver:'v2'},
  {id:'ember', name:'Ember', role:'Firefighter', c:'#ff9f6a', bone:'#f3e6dc', vis:3, com:2, talk:'Careful', skill:'Firebreak Line', ver:'v4'},
  {id:'pike', name:'Pike', role:'Digger', c:'#a6e05a', bone:'#eaf0dc', vis:2, com:3, talk:'Quiet', skill:'Tunnel Sense', ver:'v2'},
  {id:'vale', name:'Vale', role:'Hauler', c:'#c9a6ff', bone:'#ece6f6', vis:3, com:5, talk:'Chatty', skill:'Smooth Talker', ver:'v1'},
];
const RIVALS = [
  {id:'wren', name:'Wren', role:'Runner', c:'#ff4655', bone:'#f3e1e1', vis:3, com:4, talk:'Cocky', skill:'Two-Lane Split'},
  {id:'juno', name:'Juno', role:'Scout', c:'#ff8db0', bone:'#f3e1e8', vis:4, com:5, talk:'Chatty', skill:'Smooth Talker'},
  {id:'kes', name:'Kestrel', role:'Builder', c:'#ff7a45', bone:'#f3e6dc', vis:3, com:3, talk:'Bossy', skill:'Dam First'},
];
const TIERS = {quiet:{n:'Quiet', every:0, rate:1}, standard:{n:'Standard', every:5, rate:2}, open:{n:'Open', every:1, rate:4}};
/* ───────────── difficulty: same map, different rules, different goal ───────────── */
const DIFFS = [
  {k:'easy',    n:'Easy',         c:'#5fd39a', haz:1.6, cap:-2, lies:1, dn:-1, limit:150, rivalTalk:'quiet', wait:6, line:'Slow hazard · rival waits 12 s · one fewer to deliver'},
  {k:'normal',  n:'Normal',       c:'#34e0c8', haz:1,   cap:0,  lies:3, dn:0,  limit:150, rivalTalk:'standard', line:'The map as designed · ranked plays this'},
  {k:'hard',    n:'Hard',         c:'#ffb547', haz:.75, cap:1,  lies:4, dn:0,  limit:135, rivalTalk:'standard', line:'Faster hazard · 4:30 clock'},
  {k:'agentic', n:'Agentic',      c:'#ff4655', haz:.6,  cap:2,  lies:6, dn:1,  limit:135, rivalTalk:'open', fog:true, line:'Rivals talk every tick and bluff often · fog everywhere · one more to deliver'},
  {k:'mega',    n:'Mega Agentic', c:'#c06bff', haz:.5,  cap:3,  lies:9, dn:1,  limit:120, rivalTalk:'open', fog:true, night:true, full:true, line:'Full rival crew on Open talk · night fog · 4:00 clock'},
];
/* one goal per difficulty per map: [title, what to do, check]. Every goal also needs the delivery race won. */
const GOALS = {
  'saltmarsh-weir':  [['Fetch the water','Carry the jugs to the stilt shelter. The tide is slow today.',['win']], ['Claim the boardwalk','Win and take a middle jug before the rival does.',['mid',1]], ['Ears on the marsh','Win and see through a rival bluff.',['see',1]], ['Keep them dry','Win while the rival delivers 1 jug or fewer.',['hold',1]], ['High tide','Win while the rival delivers 2 jugs or fewer. Their crew is full and talking.',['hold',2]]],
  'ashfall-orchard': [['Save the seed','Get the seed packs into the root cellar.',['win']], ['Nobody gets burned','Win with no agent burned back to start.',['clean']], ['Beat the burn','Win with 1:00 or more still on the clock.',['fast',60]], ['Orchard sweep','Win and take a middle seed pack before the rival does.',['mid',1]], ['Read the smoke','Win and see through a rival bluff.',['see',1]]],
  'frostline-depot': [['Warm up','Bring the heat packs to the warm room.',['win']], ['Clear the aisles','Win and shovel or push through a blocked aisle.',['verb',1]], ['Cold radios','Win sending 14 messages or fewer. Batteries drain in the cold.',['quiet',14]], ['Shut the door','Win while the rival delivers 1 heat pack or fewer.',['hold',1]], ['Whiteout','Win with 1:00 or more still on the clock.',['fast',60]]],
  'glasshouse-ruins':[['Rescue the vials','Carry the seed vials out the garden gate.',['win']], ['Both middle vials','Win and take both middle vials.',['mid',2]], ['Fountain play','Win and open the fountain on the rival at least once.',['switch',1]], ['Untouched','Win with no agent burned or swept.',['clean']], ['Read the vines','Win and see through 2 rival bluffs.',['see',2]]],
  'copper-hollow':   [['Light the way','Bring the lamps up the cage lift.',['win']], ['Shore the tunnels','Win and dig or shore 3 times on the way.',['verb',3]], ['Echo in the dark','Win and land a bluff on the rival.',['bluff',1]], ['Start the pump','Win and flood the rival tunnel at least once.',['switch',1]], ['Trust your lamp','Win and see through 2 rival bluffs.',['see',2]]],
  'dust-bowl-silos': [['Water the yard','Bring the water tanks to the storm cellar.',['win']], ['Ring the bell','Win and fire a themed verb at least once.',['verb',1]], ['Dust devils','Win and see through 2 rival bluffs.',['see',2]], ['Talk them down','Win and land a bluff on the rival.',['bluff',1]], ['Both middle tanks','Win and take both middle water tanks.',['mid',2]]],
  'monsoon-terraces':[['Bring in the rice','Carry the rice sacks to the village hut.',['win']], ['Mud walls','Win and fire themed verbs twice.',['verb',2]], ['Dry run','Win without the floodwater sweeping anyone.',['clean']], ['Open the gates','Win and flood rival tunnels twice.',['switch',2]], ['Rumours in the rain','Win and see through 2 rival bluffs.',['see',2]]],
  'sunken-metro':    [['Get the kits out','Bring the med kits up the exit stairs.',['win']], ['Platform rumours','Win and land a bluff on the rival.',['bluff',1]], ['Drop the ceiling','Win and bury the rival tunnel at least once.',['switch',1]], ['Hear the tunnels','Win and see through 2 rival bluffs.',['see',2]], ['Raise the barrier','Win and fire themed verbs twice.',['verb',2]]],
  'basalt-stair':    [['Masks on','Bring the ash masks to the cave mouth.',['win']], ['Stone dam','Win and dam or clear the way 3 times.',['verb',3]], ['Nobody burns','Win with every agent still standing.',['clean']], ['Rockslide','Win and bury rival tunnels twice.',['switch',2]], ['Outrun the vent','Win with 0:45 or more still on the clock.',['fast',45]]],
  'blackout-harbor': [['Light the tower','Bring the flares to the lighthouse.',['win']], ['Douse the dock','Win and fire a themed verb at least once.',['verb',1]], ['Lie through the storm','Win and land 2 bluffs.',['bluff',2]], ['Ears on the pier','Win and see through 2 rival bluffs.',['see',2]], ['Weather the storm','Win with every agent still standing.',['clean']]],
};
const goalOf = (m, d) => { const g = (GOALS[m.id] || [])[d] || ['Deliver','Win the delivery race.',['win']]; return {t:g[0], d:g[1], chk:g[2]}; };
/* ───────────── seeded rng ───────────── */
function rng(seed) { let a = (seed * 2654435761) >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

/* ───────────── isometric renderer (Command Deck style, extended for v2 arenas) ───────────── */
const hexRgb = h => [parseInt(h.slice(1,3),16),parseInt(h.slice(3,5),16),parseInt(h.slice(5,7),16)];
const SH = {};
function shade(h, f) { const k = h+f; if (SH[k]) return SH[k]; const [r,g,b] = hexRgb(h); const t = f < 0 ? 0 : 255, p = Math.abs(f);
  return SH[k] = `rgb(${Math.round(r+(t-r)*p)},${Math.round(g+(t-g)*p)},${Math.round(b+(t-b)*p)})`; }
function mixHex(a, b, k) { const A = hexRgb(a), B = hexRgb(b); return '#' + A.map((v,i) => Math.round(v + (B[i]-v)*k).toString(16).padStart(2,'0')).join(''); }
function poly(c, p, fill) { c.beginPath(); c.moveTo(p[0],p[1]); for (let i=2;i<p.length;i+=2) c.lineTo(p[i],p[i+1]); c.closePath(); c.fillStyle = fill; c.fill(); }
function cube(c, sx, sy, T, h, col, s=1, edge) {
  const hw = T/2*s, hh = T/4*s, top = sy-h;
  poly(c,[sx-hw,top, sx,top+hh, sx,sy+hh, sx-hw,sy], shade(col,-.3));
  poly(c,[sx+hw,top, sx,top+hh, sx,sy+hh, sx+hw,sy], shade(col,-.5));
  poly(c,[sx,top-hh, sx+hw,top, sx,top+hh, sx-hw,top], col);
  if (edge) { c.strokeStyle = edge; c.lineWidth = Math.max(1,T/40); c.beginPath(); c.moveTo(sx-hw,top); c.lineTo(sx,top-hh); c.lineTo(sx+hw,top); c.stroke(); }
}
function diamond(c, sx, sy, T, s, col) { const hw=T/2*s, hh=T/4*s; poly(c,[sx,sy-hh,sx+hw,sy,sx,sy+hh,sx-hw,sy],col); }
const hash = (x,y) => { let h = (Math.imul(x|0,374761393) + Math.imul(y|0,668265263))|0; h = Math.imul(h^(h>>>13),1274126177); return ((h^(h>>>16))>>>0)/4294967296; };
const ease = t => 1 - Math.pow(1-Math.max(0,Math.min(1,t)),3);

function palOf(m) {
  const p = m.pal;
  return {floor:mixHex(p.floor,'#0a1018',.5), floor2:mixHex(p.floor,'#0a1018',.6), wall:mixHex(p.wall,'#0a1018',.15), top:mixHex(p.wall,'#ffffff',.22),
    accent:p.accent, grass:p.fuel || '#6a7a4a', tree:p.tree || '#3f7a55', dirt:p.dirt || '#6b4a33', crate:p.crate || '#9a6b3d', water:p.water || '#2f78d0', mid:mixHex(p.floor,'#0a1018',.35), theme:(typeof THEME !== 'undefined' && THEME[m.id]) || null};
}

/* agents: the role figure (../figure2d.ts draws the look and pose per role) */
function drawAgent(c, sx, b, T, a, time, hop, opts={}) { drawFigure(c, sx, b, T, a, time, hop, opts); }
// Which way each agent faces on screen (1: lower right, -1: lower left), kept from frame to frame,
// and the step it last turned for (so a turn plays once per step).
const FACING = new Map();
function faceOf(a, pa, stepping) {
  const was = FACING.get(a.id);
  const before = was ? was.dir : (a.team === 'B' ? -1 : 1);
  let dir = before, turning = false;
  if (stepping) {
    const step = pa.x+','+pa.y+'>'+a.x+','+a.y;
    // Screen x grows with x and shrinks with y: +x and -y steps face right, +y and -x face left.
    dir = (a.x - a.y) - (pa.x - pa.y) > 0 ? 1 : -1;
    if (was && was.step === step) turning = was.turning;
    else turning = dir !== before;
    FACING.set(a.id, { dir, step, turning });
  } else {
    if (a.faceTo) {
      const d = (a.faceTo[0] - a.faceTo[1]) - (a.x - a.y);
      if (d) dir = d > 0 ? 1 : -1;
    }
    FACING.set(a.id, { dir, step: was ? was.step : null, turning: false });
  }
  return { dir, turning };
}

function drawThing(c, t, x, y, sx, sy, T, pal, time, fresh, gone) {
  const b = sy, grow = fresh != null ? ease(fresh) : 1;
  switch (t) {
    case 'wall': if (pal.theme) { drawWall(c, x, y, sx, b, T, pal.theme, time); break; } { const h = T*(0.55 + hash(x,y)*0.12); cube(c, sx, b, T, h, pal.wall); diamond(c, sx, b-h, T, .98, pal.top);
      if (hash(y,x) > .72) diamond(c, sx+T*0.08, b-h+T*0.02, T, .28, 'rgba(120,170,110,.4)'); break; }
    case 'block': cube(c, sx, b, T, T*0.46*grow, '#3b8f88', .92, '#7ff5e4'); break;
    case 'dirt': cube(c, sx, b, T, T*0.38, pal.dirt, .95); for (let i=0;i<4;i++) diamond(c, sx+(hash(x+i,y)-.5)*T*.5, b-T*0.38+(hash(x,y+i)-.5)*T*.2, T, .08, shade(pal.dirt,-.45)); break;
    case 'crate': { cube(c, sx, b, T, T*0.4, pal.crate, .7); c.strokeStyle = shade(pal.crate,-.55); c.lineWidth = Math.max(1,T/36); const hw = T*.35/2, top = b-T*0.4;
      c.beginPath(); c.moveTo(sx-hw*.98,top+T*.02); c.lineTo(sx,top+T*.4*.62); c.moveTo(sx+hw*.98,top+T*.02); c.lineTo(sx,top+T*.4*.62); c.stroke(); break; }
    case 'tree': { cube(c, sx, b, T, T*0.3, '#4a3626', .14); const cy = b - T*0.55; for (let i=0;i<3;i++) { const r = T*(.22-i*.05); c.fillStyle = shade(pal.tree, i*.12-.1); c.beginPath(); c.ellipse(sx, cy - i*T*.12, r, r*.75, 0, 0, 7); c.fill(); } break; }
    case 'water': case 'lava': {
      const base = t === 'water' ? '#2f78d0' : '#e2461c', hi = t === 'water' ? '#8fd0ff' : '#ffd166';
      diamond(c, sx, b+T*0.02, T, grow, base);
      const ph = time*(t==='water'?2.2:1.2) + x*0.9 + y*0.6;
      c.globalAlpha = 0.35 + 0.25*Math.sin(ph); diamond(c, sx+Math.sin(ph)*T*0.05, b+T*0.02, T, .45*grow, hi); c.globalAlpha = 1;
      if (t === 'lava') { c.globalAlpha = .18 + .1*Math.sin(ph*2); diamond(c, sx, b-T*0.02, T, 1.25*grow, '#ff7a2a'); c.globalAlpha = 1; }
      break; }
    case 'ice': { diamond(c, sx, b+T*0.01, T, .97, '#bfe6f5'); diamond(c, sx, b+T*0.01, T, .7, '#e8f8ff');
      c.strokeStyle = 'rgba(70,140,180,.55)'; c.lineWidth = Math.max(1,T/45); c.beginPath(); c.moveTo(sx-T*.18,b-T*.02); c.lineTo(sx+T*.05,b+T*.05); c.lineTo(sx+T*.2,b-T*.03); c.stroke();
      c.globalAlpha = .25 + .2*Math.sin(time*1.8 + x + y); diamond(c, sx+T*.08, b-T*.02, T, .18, '#ffffff'); c.globalAlpha = 1; break; }
    case 'grass': diamond(c, sx, b, T, .96, shade(pal.grass,-.35)); for (let i=0;i<5;i++) { const gx = sx+(hash(x*3+i,y)-.5)*T*.6, gy = b+(hash(x,y*3+i)-.5)*T*.25; c.strokeStyle = shade(pal.grass,.15); c.lineWidth = Math.max(1,T/40); c.beginPath(); c.moveTo(gx,gy); c.lineTo(gx+Math.sin(time*2+i)*T*.02,gy-T*.08); c.stroke(); } break;
    case 'fire': { diamond(c, sx, b, T, .95*grow, '#3a1a10');
      for (let i=0;i<4;i++) { const fx = sx+(hash(x+i,y*2)-.5)*T*.5, fy = b+(hash(x*2,y+i)-.5)*T*.2, fh = T*(0.22+0.18*Math.abs(Math.sin(time*6+i*1.7+x)))*grow;
        poly(c,[fx-T*.07,fy, fx,fy-fh, fx+T*.07,fy], i%2?'#ff8a3a':'#ffd166'); } break; }
    case 'item': { const col = pal.accent, fy = b - T*0.32 + Math.sin(time*2.4+x+y)*T*0.04, s = T*0.13, a = gone != null ? 1-ease(gone) : 1, lift = gone != null ? ease(gone)*T*0.5 : 0;
      c.globalAlpha = .18*a; c.fillStyle = col; c.beginPath(); c.ellipse(sx, b, T*0.2, T*0.1, 0, 0, 7); c.fill(); c.globalAlpha = a;
      poly(c,[sx,fy-s*1.6-lift, sx+s,fy-lift, sx,fy+s*1.2-lift], col); poly(c,[sx,fy-s*1.6-lift, sx-s,fy-lift, sx,fy+s*1.2-lift], shade(col,-.3)); poly(c,[sx-s,fy-lift, sx+s,fy-lift, sx,fy-s*.4-lift], shade(col,.35));
      c.globalAlpha = 1; break; }
    case 'valve': { cube(c, sx, b, T, T*0.5, '#3a3f48', .7, '#ffb547'); const top = b - T*0.5;
      c.strokeStyle = '#ffb547'; c.lineWidth = Math.max(1.5, T/18); c.beginPath(); c.ellipse(sx, top - T*0.12, T*0.16, T*0.08, 0, 0, 7); c.stroke();
      const a2 = time*1.5; c.beginPath(); c.moveTo(sx + Math.cos(a2)*T*.16, top - T*.12 + Math.sin(a2)*T*.08); c.lineTo(sx - Math.cos(a2)*T*.16, top - T*.12 - Math.sin(a2)*T*.08); c.stroke();
      c.fillStyle = '#ffb547'; c.fillRect(sx - T*0.02, top - T*0.12, T*0.04, T*0.12); break; }
    case 'exit': { c.strokeStyle = '#a98bff'; c.lineWidth = Math.max(1.5,T/22);
      c.beginPath(); c.ellipse(sx, b, T*0.36, T*0.18, 0, 0, 7); c.stroke();
      c.setLineDash([T*.08,T*.08]); c.lineDashOffset = -time*T*.3; c.beginPath(); c.ellipse(sx, b, T*0.24, T*0.12, 0, 0, 7); c.stroke(); c.setLineDash([]);
      const gr = c.createLinearGradient(0, b-T*1.3, 0, b); gr.addColorStop(0,'rgba(169,139,255,0)'); gr.addColorStop(1,'rgba(169,139,255,.5)'); c.fillStyle = gr; c.fillRect(sx-T*0.24, b-T*1.3, T*0.48, T*1.3); break; }
  }
}

/* one arena at origin (ox,oy), tile size T, tweening prev→cur by alpha */
function renderArena(c, A, pal, prev, cur, alpha, T, ox, oy, time, opts={}) {
  const W = A.w, H = A.h, slab = T*0.13, cx = A.exit[0];
  const P = (x,y) => [ox + (x-y)*T/2, oy + (x+y)*T/4];
  const intro = opts.intro != null ? opts.intro : 9;
  const drop = (x,y) => { const k = ease((intro - (x+y)*0.03)/0.5); return [(1-k)*-T*2.2, k]; };
  for (let d = 0; d <= W+H-2; d++) for (let x = 0; x < W; x++) { const y = d-x; if (y<0||y>=H) continue;
    const [sx,sy] = P(x,y), [dy,k] = drop(x,y); if (k <= 0.01) continue;
    c.globalAlpha = k;
    const lb = opts.light ? opts.light[y*W+x] : 1;
    let col = x === cx ? pal.mid : (x+y)%2 ? pal.floor : pal.floor2;
    if (lb < .97) col = shade(col, -Math.round((1 - lb) * .72 * 25) / 25);
    cube(c, sx, sy+dy, T, slab, col);
    if (opts.lanes && opts.lanes.has(y*W+x)) { c.globalAlpha = k*(.06 + .26*lb); diamond(c, sx, sy+dy-slab, T, .7, '#ffb547'); c.globalAlpha = k; }
    if (opts.drops && opts.drops.some(d => d[0] === x && d[1] === y)) { c.globalAlpha = .5 + .4*Math.sin(time*4); c.strokeStyle = '#ffb547'; c.lineWidth = Math.max(1.5, T/20); c.beginPath(); c.ellipse(sx, sy+dy-slab, T*.34, T*.17, 0, 0, 7); c.stroke(); c.globalAlpha = k; }
    if (opts.sides && x !== cx && y > 0 && y < H-1 && (x === 1 || x === W-2)) { c.globalAlpha = k*.5; diamond(c, sx, sy+dy-slab, T, .5, x < cx ? 'rgba(52,224,200,.5)' : 'rgba(255,70,85,.5)'); }
    c.globalAlpha = 1;
  }
  const items = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y*W+x, t = cur.grid[i], pt = prev ? prev.grid[i] : t;
    if (t && opts.reveal != null && opts.reveal < 1 && opts.revealSet && opts.revealSet.has(t)) { const rv = ease(opts.reveal*2.4 - hash(x*7, y*3)*1.1 - (y/H)*.3); if (rv > .01) items.push({d:x+y, x, y, t, rv}); }
    else if (t) items.push({d:x+y, x, y, t, fresh: pt !== t ? alpha : null});
    else if (pt === 'item') items.push({d:x+y, x, y, t:pt, gone:alpha});
    else if (pt === 'crate' || pt === 'dirt' || pt === 'block' || pt === 'tree') items.push({d:x+y, x, y, t:pt, gone:alpha, fade:true});
  }
  const pos = new Map();
  (cur.agents || []).forEach((a,i) => {
    if (a.out && !(prev && !prev.agents[i].out)) return;
    const af = opts.agFade && opts.agFade[a.id] != null ? opts.agFade[a.id] : 1; if (af < .02) return;
    const dk = opts.deploy == null ? 1 : ease(opts.deploy*1.7 - (a.slot||0)*.2 - (a.team === 'B' ? .3 : 0)); if (dk <= .01) return;
    const pa = prev ? prev.agents[i] : a;
    const teleport = Math.abs(pa.x-a.x)+Math.abs(pa.y-a.y) > 1;
    const stepping = !teleport && (pa.x !== a.x || pa.y !== a.y);
    // Facing: the way it steps; standing, toward whoever it reacts to (faceTo); else as it was.
    const f = faceOf(a, pa, stepping);
    // A step is walked at a steady pace (linear), not eased like a hop; when the step turns it, it
    // turns on the spot first, then walks.
    const turnLead = f.turning && !opts.still ? 0.22 : 0;
    const k = stepping ? Math.max(0, Math.min(1, (alpha - turnLead) / (1 - turnLead))) : ease(alpha);
    let ix = teleport ? a.x : pa.x + (a.x-pa.x)*k, iy = teleport ? a.y : pa.y + (a.y-pa.y)*k;
    const key = Math.round(ix)+','+Math.round(iy), n = pos.get(key) || 0; pos.set(key, n+1);
    if (n) { ix += n*0.22; iy -= n*0.22; }
    const moving = stepping && k > 0;
    items.push({d:ix+iy+0.01, agent: f.dir !== a.face ? {...a, face: f.dir} : a, af, ix, iy, moving, walk: k, hop: (moving && !opts.still ? Math.abs(Math.sin(2*Math.PI*k))*T*0.025 : 0) + (1-dk)*T*5});
  });
  items.sort((p,q) => p.d - q.d);
  for (const it of items) {
    if (it.agent) {
      const [sx,sy] = P(it.ix,it.iy), a = it.agent;
      drawAgent(c, sx, sy - slab, T, a, time, it.hop, {team: a.team === 'A' ? '#34e0c8' : '#ff4655', ring: opts.focus === a.id, item: pal.accent, alpha: it.af, moving: it.moving, walk: it.walk, age: opts.age, still: opts.still});
      it.sx = sx; it.sy = sy - slab; continue;
    }
    const [sx,sy] = P(it.x,it.y), [dy,k] = drop(it.x,it.y); if (k <= 0.01) continue;
    if (it.rv != null) { const liq = HAZ.has(it.t); c.globalAlpha = liq ? 1 : it.rv; drawThing(c, it.t, it.x, it.y, sx, sy - slab + dy - (liq ? 0 : (1-it.rv)*T*1.8), T, pal, time, liq ? it.rv : null, null); c.globalAlpha = 1; continue; }
    c.globalAlpha = (it.fade ? 1-ease(it.gone) : k) * (opts.light ? .22 + .78*opts.light[it.y*W+it.x] : 1);
    drawThing(c, it.t, it.x, it.y, sx, sy - slab + dy, T, pal, time, it.fresh, it.fade ? null : it.gone);
    c.globalAlpha = 1;
  }
  // Live water (crackling arcs over electrified tiles) and gas (drifting green puffs), over the board.
  for (const j of cur.shock || []) { const x = j % W, y = (j / W) | 0, [sx, sy] = P(x, y), lb = opts.light ? opts.light[j] : 1, b = sy - slab;
    c.globalAlpha = (.35 + .25*Math.abs(Math.sin(time*9 + x*1.3 + y))) * lb; diamond(c, sx, b, T, .92, '#ffe94a');
    c.globalAlpha = .9 * lb; c.strokeStyle = '#fffbd0'; c.lineWidth = Math.max(1.2, T/30); c.beginPath();
    const ph = Math.floor(time*12 + x*3 + y*5); c.moveTo(sx - T*.3, b); for (let i = 1; i <= 4; i++) c.lineTo(sx - T*.3 + i*T*.15, b + ((ph + i) % 2 ? -1 : 1)*T*.06); c.stroke(); c.globalAlpha = 1; }
  for (const j of cur.gas || []) { const x = j % W, y = (j / W) | 0, [sx, sy] = P(x, y), lb = opts.light ? opts.light[j] : 1, b = sy - slab;
    for (let i = 0; i < 3; i++) { const ph = time*0.9 + i*2.1 + hash(x, y)*6, px = sx + Math.sin(ph)*T*.14 + (i-1)*T*.12, py = b - T*(.12 + .1*i) - Math.abs(Math.sin(ph*.7))*T*.06;
      c.globalAlpha = (.28 + .08*Math.sin(ph*1.3)) * lb; c.fillStyle = i % 2 ? '#9be36b' : '#6fbf4a'; c.beginPath(); c.ellipse(px, py, T*.24, T*.13, 0, 0, 7); c.fill(); }
    c.globalAlpha = 1; }
  if (opts.tags) for (const it of items) if (it.agent && !it.agent.out) {
    const a = it.agent, fs = Math.max(10, T*0.2), team = a.team === 'A' ? '#34e0c8' : '#ff4655';
    c.font = `600 ${fs}px Barlow, sans-serif`;
    const tw = c.measureText(a.name).width + fs*0.8, th = fs*1.35; let ty = it.sy - it.hop - T*1.05;
    // the intent chip (what it is going for: live.ts intentsOf) sits just right of the plate
    const iw = a.intent ? th*0.86 + 2 : 0;
    // nameplates of agents on the same or nearby tiles stack upward instead of overlapping
    const pl = opts._placed || (opts._placed = []);
    for (let n = 0; n < 6 && pl.some(r => it.sx - tw/2 < r[2] && it.sx + tw/2 + iw > r[0] && ty - fs < r[3] && ty - fs + th > r[1]); n++) ty -= th + 2;
    pl.push([it.sx - tw/2, ty - fs, it.sx + tw/2 + iw, ty - fs + th]);
    c.globalAlpha = it.af ?? 1; c.fillStyle = 'rgba(5,8,13,.84)'; c.fillRect(it.sx - tw/2, ty - fs, tw, th);
    c.fillStyle = team; c.fillRect(it.sx - tw/2, ty - fs, 2.5, th);
    c.fillStyle = '#ece8e1'; c.textAlign = 'center'; c.fillText(a.name, it.sx, ty);
    if (a.intent) drawIntent(c, it.sx + tw/2 + 2 + th*0.43, ty - fs + th/2, th*0.43, a.intent, pal.accent, time, !!opts.still);
    c.globalAlpha = 1;
    // the name of a skill that just kicked in (live.ts skillKicksOf), as a gold chip over the plate
    const chipH = a.skill ? drawSkillChip(c, it.sx, ty - fs, fs, a.skill, opts.age ?? 9, !!opts.still) : 0;
    const bk = opts.barks && opts.barks[a.id];
    if (bk && time - bk.t < 2.6) {
      const fade = Math.min(1, (2.6-(time-bk.t))*3, (time-bk.t)*8);
      c.globalAlpha = fade;
      const bf = Math.max(11, T*0.2); c.font = `500 ${bf}px Barlow, sans-serif`;
      const text = bk.text.length > 46 ? bk.text.slice(0,44) + '…' : bk.text;
      const lab = bk.ch === 'team' ? 'TEAM' : bk.lie ? 'SAY' : 'SAY';
      c.font = `500 ${bf*0.72}px "JetBrains Mono", monospace`; const lw = c.measureText(lab).width + bf*0.6;
      c.font = `500 ${bf}px Barlow, sans-serif`;
      const bw = c.measureText(text).width + bf*1.2 + lw; let by = ty - fs*1.9 - chipH;
      // bubbles that would overlap one already drawn move up until they clear it
      const hgt = bf*1.6;
      for (let n = 0; n < 6 && pl.some(r => it.sx - bw/2 < r[2] && it.sx + bw/2 > r[0] && by - bf*1.15 < r[3] && by - bf*1.15 + hgt > r[1]); n++) by -= hgt + 4;
      pl.push([it.sx - bw/2, by - bf*1.15, it.sx + bw/2, by - bf*1.15 + hgt]);
      const bg = bk.ch === 'team' ? 'rgba(8,40,36,.96)' : 'rgba(236,232,225,.96)', fg = bk.ch === 'team' ? '#d8fff8' : '#05080d';
      c.fillStyle = bg; c.fillRect(it.sx - bw/2, by - bf*1.15, bw, bf*1.6);
      if (bk.ch === 'team') { c.strokeStyle = team; c.lineWidth = 1.5; c.strokeRect(it.sx - bw/2, by - bf*1.15, bw, bf*1.6); }
      poly(c,[it.sx-bf*.4, by+bf*.45, it.sx+bf*.4, by+bf*.45, it.sx, by+bf*.95], bg);
      c.fillStyle = bk.ch === 'team' ? team : '#05080d'; c.fillRect(it.sx - bw/2, by - bf*1.15, lw, bf*1.6);
      c.fillStyle = bk.ch === 'team' ? '#04201c' : '#ece8e1'; c.font = `600 ${bf*0.72}px "JetBrains Mono", monospace`; c.textAlign = 'center'; c.fillText(lab, it.sx - bw/2 + lw/2, by - bf*0.05);
      c.fillStyle = fg; c.font = `500 ${bf}px Barlow, sans-serif`; c.textAlign = 'left'; c.fillText(text, it.sx - bw/2 + lw + bf*0.6, by);
      if (bk.heard && EAR_PATH) { const ex = it.sx + bw/2, ey = by - bf*1.15, er = bf*.62;
        c.fillStyle = '#ffb547'; c.beginPath(); c.arc(ex, ey, er, 0, 7); c.fill();
        c.save(); c.translate(ex - er*.66, ey - er*.66); c.scale(er*1.32/24, er*1.32/24); c.strokeStyle = '#05080d'; c.lineWidth = 2.4; c.lineCap = 'round'; c.lineJoin = 'round'; c.stroke(EAR_PATH); c.restore(); }
      c.globalAlpha = 1;
    }
    c.textAlign = 'start';
  }
  return items;
}
function fitT(A, w, h) { const n = A.w + A.h; return Math.min(w / (n/2), h / (n/4 + 0.9)); }
/* ───────────── per-map scenery: sky, surrounding land, props, weather, and themed walls (cosmetic only) ───────────── */
const THEME = {
  'saltmarsh-weir':  {sky:['#123844','#04121a'], low:'#1d6f8c', lowKind:'water', hill:'#55654c', props:['stilt','stilt','reeds','reeds','post'], weather:'mist',
    wall:{style:'plank', base:'#6b5236', top:'#8f7552'}},
  'ashfall-orchard': {sky:['#4a1c0c','#0d0604'], low:'#2a1810', lowKind:'ember', hill:'#5a4a2e', props:['tree','tree','burnt','farm'], weather:'ember',
    wall:{style:'stone', base:'#7a6448', top:'#a8906a'}},
  'frostline-depot': {sky:['#1d3550','#060c14'], low:'#a9bccd', lowKind:'snow', hill:'#dfe8f0', props:['fir','fir','shed','railcar'], weather:'snow',
    wall:{style:'snowcap', base:'#3d5168', top:'#f2f6fa'}},
  'glasshouse-ruins':{sky:['#0d3326','#03100b'], low:'#173a2e', lowKind:'water', hill:'#3e6a48', props:['palm','palm','dome','tree'], weather:'pollen',
    wall:{style:'glass', base:'#26332e', top:'#7fd6c0'}},
  'copper-hollow':   {sky:['#1e100a','#050302'], low:'#100a08', lowKind:'void', hill:'#4a3022', props:['timber','timber','lantern','rocks'], weather:'drip',
    wall:{style:'ore', base:'#4e3627', top:'#6e4d38'}},
  'dust-bowl-silos': {sky:['#7a5228','#1a1008'], low:'#7a5a34', lowKind:'flat', hill:'#b08f5c', props:['silo','silo','windmill','farm'], weather:'dust',
    wall:{style:'straw', base:'#a9874e', top:'#dcbc78'}},
  'monsoon-terraces':{sky:['#173a46','#050f12'], low:'#2a6f8a', lowKind:'water', hill:'#4f7a3e', props:['terrace','terrace','hut','palm'], weather:'rain',
    wall:{style:'moss', base:'#5d6a52', top:'#6f9a4c'}},
  'sunken-metro':    {sky:['#0e1c33','#03060c'], low:'#123050', lowKind:'water', hill:'#3a4252', props:['tower','tower','tower','sign'], weather:'drip',
    wall:{style:'concrete', base:'#4a5262', top:'#7a8494'}},
  'basalt-stair':    {sky:['#3a1210','#080406'], low:'#ff5a1f', lowKind:'lava', hill:'#3a3440', props:['spire','spire','smoke','rocks'], weather:'ash',
    wall:{style:'basalt', base:'#2e2a36', top:'#4a4456'}},
  'blackout-harbor': {sky:['#111c40','#03050c'], low:'#16305a', lowKind:'water', hill:'#34344a', props:['crane','stack','lighthouse','stack'], weather:'storm',
    wall:{style:'container', base:'#b5452f', top:'#c9604a'}},
};
const CONTAINER = ['#b5452f','#2f6fb5','#d08a2a','#3b8a5a','#8a3b6b'];

/* face helpers: a point on the left or right face of a cube, u across (0..1), v down (0..1) */
const faceL = (sx, top, b, T, s, u, v) => { const hw = T/2*s, hh = T/4*s; return [sx - hw + u*hw, top + u*hh + v*(b - top)]; };
const faceR = (sx, top, b, T, s, u, v) => { const hw = T/2*s, hh = T/4*s; return [sx + u*hw, top + hh - u*hh + v*(b - top)]; };
function faceLine(c, f, sx, top, b, T, s, u0, v0, u1, v1) { const [x0, y0] = f(sx, top, b, T, s, u0, v0), [x1, y1] = f(sx, top, b, T, s, u1, v1); c.moveTo(x0, y0); c.lineTo(x1, y1); }

function drawWall(c, x, y, sx, b, T, th, time) {
  const w = th.wall, r = hash(x, y), lw = Math.max(1, T/38);
  switch (w.style) {
    case 'plank': { const h = T*(0.5 + r*0.14), top = b - h; cube(c, sx, b, T, h, w.base); diamond(c, sx, top, T, .98, w.top);
      c.strokeStyle = shade(w.base, -.55); c.lineWidth = lw; c.beginPath();
      for (const v of [.33, .66]) { faceLine(c, faceL, sx, top, b, T, 1, 0, v, 1, v); faceLine(c, faceR, sx, top, b, T, 1, 0, v, 1, v); } c.stroke();
      if (r > .7) { c.fillStyle = 'rgba(90,140,90,.55)'; c.beginPath(); c.ellipse(sx - T*.12, top + T*.02, T*.1, T*.04, 0, 0, 7); c.fill(); } return; }
    case 'stone': { const h = T*(0.42 + r*0.16), top = b - h; cube(c, sx, b, T, h, w.base); diamond(c, sx, top, T, .98, w.top);
      for (let i = 0; i < 5; i++) { const f = i % 2 ? faceL : faceR, [px, py] = f(sx, top, b, T, 1, .15 + hash(x+i, y)*.7, .2 + hash(x, y+i)*.6); c.fillStyle = shade(w.base, i % 3 ? .12 : -.25); c.fillRect(px - T*.04, py - T*.025, T*.08, T*.05); }
      if (r > .55) { c.fillStyle = 'rgba(80,110,50,.7)'; c.beginPath(); c.ellipse(sx + T*.08, top - T*.04, T*.13, T*.06, 0, 0, 7); c.fill(); } return; }
    case 'snowcap': { const h = T*(0.58 + r*0.14), top = b - h; cube(c, sx, b, T, h, w.base);
      c.strokeStyle = shade(w.base, -.5); c.lineWidth = lw; c.beginPath(); for (const u of [.33, .66]) { faceLine(c, faceL, sx, top, b, T, 1, u, 0, u, 1); faceLine(c, faceR, sx, top, b, T, 1, u, 0, u, 1); } c.stroke();
      diamond(c, sx, top - T*.03, T, 1.04, w.top);
      const [a0, a1] = faceL(sx, top, b, T, 1, 0, .12), [b0, b1] = faceL(sx, top, b, T, 1, 1, .12);
      poly(c, [sx - T/2*1.04, top - T*.03, sx, top + T/4 - T*.03, b0, b1, a0, a1 + T*.04], '#dfe8f0');
      return; }
    case 'glass': { const h = T*(0.62 + r*0.18), top = b - h; cube(c, sx, b, T, h, w.base);
      c.globalAlpha *= .45; cube(c, sx, b - T*.04, T, h - T*.06, w.top, .9); c.globalAlpha /= .45;
      c.strokeStyle = '#1a2420'; c.lineWidth = lw*1.4; c.beginPath(); faceLine(c, faceL, sx, top, b, T, 1, .5, 0, .5, 1); faceLine(c, faceR, sx, top, b, T, 1, .5, 0, .5, 1); faceLine(c, faceL, sx, top, b, T, 1, 0, .5, 1, .5); faceLine(c, faceR, sx, top, b, T, 1, 0, .5, 1, .5); c.stroke();
      c.strokeStyle = 'rgba(220,255,245,.55)'; c.lineWidth = lw; c.beginPath(); faceLine(c, faceR, sx, top, b, T, 1, .15, .1, .35, .4); c.stroke();
      if (r > .6) { c.fillStyle = 'rgba(236,114,208,.8)'; c.beginPath(); c.arc(sx - T*.1, top + T*.02, T*.05, 0, 7); c.fill(); } return; }
    case 'ore': { const h = T*(0.56 + r*0.18), top = b - h; cube(c, sx, b, T, h, w.base); diamond(c, sx, top, T, .98, w.top);
      for (let i = 0; i < 6; i++) { const f = i % 2 ? faceL : faceR, [px, py] = f(sx, top, b, T, 1, .1 + hash(x*3+i, y)*.8, .15 + hash(x, y*3+i)*.7); c.fillStyle = i % 4 === 0 ? '#5fe08f' : '#e07a3a'; c.globalAlpha *= .9; c.fillRect(px, py, T*.045, T*.03); c.globalAlpha /= .9; }
      return; }
    case 'straw': { const h = T*(0.46 + r*0.12), top = b - h; cube(c, sx, b, T, h, w.base, .94); diamond(c, sx, top, T, .92, w.top);
      c.strokeStyle = shade(w.base, -.35); c.lineWidth = lw; c.beginPath(); for (const u of [.2, .4, .6, .8]) { faceLine(c, faceL, sx, top, b, T, .94, u, 0, u, 1); faceLine(c, faceR, sx, top, b, T, .94, u, 0, u, 1); } c.stroke();
      c.strokeStyle = '#6a4a2a'; c.lineWidth = lw*1.6; c.beginPath(); faceLine(c, faceL, sx, top, b, T, .94, 0, .5, 1, .5); faceLine(c, faceR, sx, top, b, T, .94, 0, .5, 1, .5); c.stroke(); return; }
    case 'moss': { const h = T*(0.4 + r*0.2), top = b - h; cube(c, sx, b, T, h, w.base);
      c.strokeStyle = shade(w.base, -.45); c.lineWidth = lw; c.beginPath(); for (const v of [.5]) { faceLine(c, faceL, sx, top, b, T, 1, 0, v, 1, v); faceLine(c, faceR, sx, top, b, T, 1, 0, v, 1, v); } faceLine(c, faceL, sx, top, b, T, 1, .5, 0, .5, .5); faceLine(c, faceR, sx, top, b, T, 1, .3, .5, .3, 1); c.stroke();
      diamond(c, sx, top, T, .98, w.top);
      const [mx, my] = faceL(sx, top, b, T, 1, .3, 0); poly(c, [mx - T*.08, my, mx + T*.1, my + T*.04, mx + T*.02, my + T*.16], w.top); return; }
    case 'concrete': { const h = T*(0.6 + r*0.12), top = b - h; cube(c, sx, b, T, h, w.base); diamond(c, sx, top, T, .98, w.top);
      c.strokeStyle = shade(w.base, -.45); c.lineWidth = lw*.8; c.beginPath(); for (const v of [.3, .6]) { faceLine(c, faceL, sx, top, b, T, 1, 0, v, 1, v); faceLine(c, faceR, sx, top, b, T, 1, 0, v, 1, v); } for (const u of [.5]) { faceLine(c, faceL, sx, top, b, T, 1, u, 0, u, .85); faceLine(c, faceR, sx, top, b, T, 1, u, 0, u, .85); } c.stroke();
      for (let i = 0; i < 4; i++) { const [p0, p1] = faceL(sx, top, b, T, 1, i/4, .86), [q0, q1] = faceL(sx, top, b, T, 1, (i+1)/4, .86); poly(c, [p0, p1, q0, q1, q0, q1 + T*.06, p0, p1 + T*.06], i % 2 ? '#ffd23f' : '#14161c'); }
      if (r > .7) { const [lx, ly] = faceR(sx, top, b, T, 1, .5, .4); c.fillStyle = '#9fe0ff'; c.globalAlpha *= .7; c.fillRect(lx - T*.05, ly, T*.1, T*.03); c.globalAlpha /= .7; } return; }
    case 'basalt': { const h = T*(0.6 + r*0.3), top = b - h; cube(c, sx, b, T, h, w.base, .9); diamond(c, sx, top, T, .88, w.top);
      c.strokeStyle = shade(w.top, .25); c.lineWidth = lw; c.beginPath(); c.ellipse(sx, top, T*.2, T*.1, 0, 0, 7); c.stroke();
      if (r > .4) { const g = .5 + .5*Math.sin(time*2 + x + y); c.strokeStyle = `rgba(255,${120 + g*60|0},40,${.5 + g*.4})`; c.lineWidth = lw*1.3; c.beginPath(); faceLine(c, faceR, sx, top, b, T, .9, .3, .1, .45, .5); faceLine(c, faceR, sx, top, b, T, .9, .45, .5, .35, .9); c.stroke(); } return; }
    case 'container': { const col = CONTAINER[Math.floor(r * CONTAINER.length)], h = T*(0.6 + (hash(y, x) > .55 ? .32 : 0)), top = b - h; cube(c, sx, b, T, h, col); diamond(c, sx, top, T, .98, shade(col, .12));
      c.strokeStyle = shade(col, -.45); c.lineWidth = lw; c.beginPath(); for (const u of [.17, .34, .5, .67, .84]) { faceLine(c, faceL, sx, top, b, T, 1, u, .06, u, .94); faceLine(c, faceR, sx, top, b, T, 1, u, .06, u, .94); } c.stroke();
      if (h > T*.8) { c.strokeStyle = 'rgba(0,0,0,.35)'; c.beginPath(); faceLine(c, faceL, sx, top, b, T, 1, 0, .5, 1, .5); faceLine(c, faceR, sx, top, b, T, 1, 0, .5, 1, .5); c.stroke(); } return; }
  }
  const h = T*(0.55 + r*0.12); cube(c, sx, b, T, h, th.wall.base); diamond(c, sx, b - h, T, .98, th.wall.top);
}

/* props that sit on the hills behind the arena */
function drawProp(c, kind, sx, b, T, th, time, seed) {
  const S = T*1.1;
  switch (kind) {
    case 'stilt': { c.strokeStyle = '#3a2a1c'; c.lineWidth = Math.max(1.5, S/22); c.beginPath(); for (const dx of [-.2, .2]) { c.moveTo(sx + dx*S, b); c.lineTo(sx + dx*S, b - S*.35); } c.stroke();
      cube(c, sx, b - S*.35, S, S*.32, '#b9ab90', .55); const tp = b - S*.67; poly(c, [sx - S*.3, tp, sx, tp - S*.28, sx + S*.3, tp, sx, tp + S*.14], '#a4553a'); return; }
    case 'reeds': c.strokeStyle = '#7f9a5a'; c.lineWidth = Math.max(1, S/40); c.beginPath(); for (let i = 0; i < 6; i++) { const x = sx + (hash(seed, i) - .5)*S*.6; c.moveTo(x, b); c.lineTo(x + Math.sin(time + i)*S*.04, b - S*(.25 + hash(i, seed)*.2)); } c.stroke(); return;
    case 'post': cube(c, sx, b, S, S*.5, '#5a4632', .14); return;
    case 'tree': case 'burnt': { cube(c, sx, b, S, S*.3, '#4a3626', .14); const cy = b - S*.55, col = kind === 'burnt' ? '#3a2a1c' : '#56702e';
      for (let i = 0; i < 3; i++) { const r = S*(.24 - i*.05); c.fillStyle = shade(col, i*.12 - .1); c.beginPath(); c.ellipse(sx, cy - i*S*.12, r, r*.75, 0, 0, 7); c.fill(); }
      if (kind === 'tree' && hash(seed, 3) > .5) { c.fillStyle = '#d24a2a'; c.beginPath(); c.arc(sx + S*.08, cy, S*.03, 0, 7); c.fill(); } return; }
    case 'farm': { cube(c, sx, b, S, S*.4, '#9a8a70', .7); const tp = b - S*.4; poly(c, [sx - S*.36, tp, sx, tp - S*.32, sx + S*.36, tp, sx, tp + S*.18], '#6a3a22'); return; }
    case 'fir': { c.fillStyle = '#4a3626'; c.fillRect(sx - S*.03, b - S*.15, S*.06, S*.15); for (let i = 0; i < 3; i++) { const y0 = b - S*.15 - i*S*.18, w = S*(.26 - i*.06); poly(c, [sx - w, y0, sx, y0 - S*.3, sx + w, y0], i === 2 ? '#e8f0f6' : '#2f5f4f'); } return; }
    case 'shed': { cube(c, sx, b, S, S*.36, '#5a6a7e', .8); diamond(c, sx, b - S*.36, S, .84, '#eef3f8'); return; }
    case 'railcar': { cube(c, sx, b, S, S*.3, '#7a3a2a', .9); c.fillStyle = '#1a1a1a'; c.beginPath(); c.arc(sx - S*.15, b + S*.02, S*.05, 0, 7); c.arc(sx + S*.15, b + S*.02, S*.05, 0, 7); c.fill(); diamond(c, sx, b - S*.3, S, .9, '#eef3f8'); return; }
    case 'palm': { c.strokeStyle = '#6a5a3a'; c.lineWidth = Math.max(1.5, S/20); c.beginPath(); c.moveTo(sx, b); c.quadraticCurveTo(sx + S*.08, b - S*.4, sx + S*.04, b - S*.7); c.stroke();
      c.strokeStyle = '#2f8f5a'; c.lineWidth = Math.max(1.5, S/22); c.beginPath(); for (let i = 0; i < 6; i++) { const a = i/6*Math.PI*2 + Math.sin(time*.8 + seed)*.1; c.moveTo(sx + S*.04, b - S*.7); c.quadraticCurveTo(sx + S*.04 + Math.cos(a)*S*.2, b - S*.78 + Math.sin(a)*S*.06, sx + S*.04 + Math.cos(a)*S*.3, b - S*.62 + Math.sin(a)*S*.08); } c.stroke(); return; }
    case 'dome': { c.fillStyle = 'rgba(127,214,192,.28)'; c.strokeStyle = 'rgba(200,255,240,.55)'; c.lineWidth = Math.max(1, S/40); c.beginPath(); c.ellipse(sx, b, S*.42, S*.42, 0, Math.PI, 0); c.fill(); c.stroke();
      c.beginPath(); c.moveTo(sx, b - S*.42); c.lineTo(sx, b); c.moveTo(sx - S*.42, b); c.quadraticCurveTo(sx, b - S*.2, sx + S*.42, b); c.stroke(); return; }
    case 'timber': { c.fillStyle = '#6a4a2a'; c.fillRect(sx - S*.22, b - S*.5, S*.06, S*.5); c.fillRect(sx + S*.16, b - S*.5, S*.06, S*.5); c.fillRect(sx - S*.26, b - S*.54, S*.52, S*.07); return; }
    case 'lantern': { c.fillStyle = '#3a2a1c'; c.fillRect(sx - S*.02, b - S*.45, S*.04, S*.45); const g = c.createRadialGradient(sx, b - S*.5, 0, sx, b - S*.5, S*.5); g.addColorStop(0, `rgba(255,200,120,${.55 + .15*Math.sin(time*3 + seed)})`); g.addColorStop(1, 'rgba(255,200,120,0)'); c.fillStyle = g; c.fillRect(sx - S*.5, b - S, S, S); c.fillStyle = '#ffd27a'; c.fillRect(sx - S*.04, b - S*.54, S*.08, S*.08); return; }
    case 'rocks': { for (let i = 0; i < 3; i++) cube(c, sx + (i - 1)*S*.18, b + (i % 2)*S*.04, S, S*(.12 + hash(seed, i)*.18), th.hill, .25 + hash(i, seed)*.15); return; }
    case 'silo': { const col = '#c8c0b0'; c.fillStyle = shade(col, -.3); c.fillRect(sx - S*.2, b - S*1.1, S*.2, S*1.1); c.fillStyle = shade(col, -.5); c.fillRect(sx, b - S*1.1, S*.2, S*1.1);
      c.fillStyle = col; c.beginPath(); c.ellipse(sx, b - S*1.1, S*.2, S*.1, 0, 0, 7); c.fill(); c.fillStyle = '#9a4a2a'; c.beginPath(); c.ellipse(sx, b - S*1.16, S*.2, S*.14, 0, Math.PI, 0); c.fill(); return; }
    case 'windmill': { c.strokeStyle = '#7a6a58'; c.lineWidth = Math.max(1.5, S/24); c.beginPath(); c.moveTo(sx - S*.12, b); c.lineTo(sx, b - S*.9); c.lineTo(sx + S*.12, b); c.stroke();
      c.strokeStyle = '#e8d8b8'; c.beginPath(); for (let i = 0; i < 4; i++) { const a = time*.8 + i*Math.PI/2; c.moveTo(sx, b - S*.9); c.lineTo(sx + Math.cos(a)*S*.3, b - S*.9 + Math.sin(a)*S*.3); } c.stroke(); return; }
    case 'terrace': { for (let i = 0; i < 3; i++) cube(c, sx, b - i*S*.14, S, S*.14, mixHex('#4f7a3e', '#ffffff', i*.08), 1 - i*.22); return; }
    case 'hut': { c.strokeStyle = '#5a4632'; c.lineWidth = Math.max(1.5, S/24); c.beginPath(); c.moveTo(sx - S*.18, b); c.lineTo(sx - S*.18, b - S*.25); c.moveTo(sx + S*.18, b); c.lineTo(sx + S*.18, b - S*.25); c.stroke();
      cube(c, sx, b - S*.25, S, S*.22, '#a89070', .5); const tp = b - S*.47; poly(c, [sx - S*.34, tp + S*.04, sx, tp - S*.3, sx + S*.34, tp + S*.04, sx, tp + S*.2], '#7a5a34'); return; }
    case 'tower': { const h = S*(1.2 + hash(seed, 1)*1.4); cube(c, sx, b, S, h, '#262c3a', .62);
      for (let i = 0; i < 10; i++) { if (hash(seed, i) < .45) continue; const [wx, wy] = faceL(sx, b - h, b, S, .62, .2 + (i % 3)*.3, .08 + Math.floor(i/3)*.22); c.fillStyle = hash(i, seed) > .5 ? 'rgba(255,214,120,.75)' : 'rgba(159,224,255,.55)'; c.fillRect(wx, wy, S*.05, S*.04); } return; }
    case 'sign': { c.fillStyle = '#3a4252'; c.fillRect(sx - S*.02, b - S*.6, S*.04, S*.6); c.fillStyle = '#c6f04a'; c.fillRect(sx - S*.2, b - S*.7, S*.4, S*.12); return; }
    case 'spire': { const h = S*(.9 + hash(seed, 2)*1.2); poly(c, [sx - S*.18, b, sx - S*.04, b - h, sx + S*.05, b - h*.92, sx + S*.18, b], '#2a2430'); poly(c, [sx, b, sx + S*.05, b - h*.92, sx + S*.18, b], '#1c1820');
      c.strokeStyle = `rgba(255,120,40,${.4 + .3*Math.sin(time*2 + seed)})`; c.lineWidth = Math.max(1, S/30); c.beginPath(); c.moveTo(sx - S*.02, b - h*.3); c.lineTo(sx + S*.04, b - h*.55); c.stroke(); return; }
    case 'smoke': { for (let i = 0; i < 4; i++) { const t = (time*.15 + i/4 + hash(seed, i)) % 1; c.fillStyle = `rgba(90,80,90,${.35*(1 - t)})`; c.beginPath(); c.arc(sx + Math.sin(t*4 + seed)*S*.2, b - S*.3 - t*S*1.6, S*(.15 + t*.35), 0, 7); c.fill(); } return; }
    case 'crane': { c.strokeStyle = '#d0a050'; c.lineWidth = Math.max(1.5, S/18); c.beginPath(); c.moveTo(sx, b); c.lineTo(sx, b - S*1.6); c.lineTo(sx + S*.9, b - S*1.45); c.moveTo(sx, b - S*1.6); c.lineTo(sx - S*.3, b - S*1.5); c.stroke();
      c.strokeStyle = 'rgba(208,160,80,.6)'; c.lineWidth = Math.max(1, S/40); c.beginPath(); c.moveTo(sx + S*.7, b - S*1.47); c.lineTo(sx + S*.7, b - S*.9); c.stroke();
      c.fillStyle = `rgba(255,70,85,${.5 + .5*Math.sin(time*3)})`; c.fillRect(sx - S*.03, b - S*1.66, S*.06, S*.06); return; }
    case 'stack': { for (let i = 0; i < 3; i++) cube(c, sx + (i % 2)*S*.1, b - i*S*.22, S, S*.22, CONTAINER[(seed + i) % CONTAINER.length], .62); return; }
    case 'lighthouse': { poly(c, [sx - S*.16, b, sx - S*.08, b - S*1.5, sx + S*.08, b - S*1.5, sx + S*.16, b], '#d8d0c8'); c.fillStyle = '#b5452f'; c.fillRect(sx - S*.12, b - S*.75, S*.24, S*.16);
      const a = time*.9, g = c.createLinearGradient(sx, b - S*1.55, sx + Math.cos(a)*S*4, b - S*1.55 + Math.sin(a)*S*.6); g.addColorStop(0, 'rgba(255,240,180,.45)'); g.addColorStop(1, 'rgba(255,240,180,0)');
      c.fillStyle = g; c.beginPath(); c.moveTo(sx, b - S*1.55); c.lineTo(sx + Math.cos(a - .12)*S*4, b - S*1.55 + Math.sin(a - .12)*S*.8); c.lineTo(sx + Math.cos(a + .12)*S*4, b - S*1.55 + Math.sin(a + .12)*S*.8); c.fill();
      c.fillStyle = '#fff3c0'; c.fillRect(sx - S*.07, b - S*1.6, S*.14, S*.1); return; }
  }
}

/* the world around the arena: sky, low ground, hills with props behind it */
function drawScenery(c, m, A, T, ox, oy, time, VW, VH) {
  const th = THEME[m.id]; if (!th) return false;
  const sky = c.createLinearGradient(0, 0, 0, VH); sky.addColorStop(0, th.sky[0]); sky.addColorStop(1, th.sky[1]);
  c.fillStyle = sky; c.fillRect(0, 0, VW, VH);
  const W = A.w, H = A.h, K = 9;
  const P = (x, y) => [ox + (x - y)*T/2, oy + (x + y)*T/4];
  // low ground: one big diamond reaching past the screen
  const sink = T*0.18;
  const c0 = P(-K, -K), c1 = P(W + K, -K), c2 = P(W + K, H + K), c3 = P(-K, H + K);
  const low = th.lowKind === 'lava' ? '#3a120a' : th.low;
  poly(c, [c0[0], c0[1] + sink, c1[0], c1[1] + sink, c2[0], c2[1] + sink, c3[0], c3[1] + sink], low);
  // texture on the low ground
  for (let i = 0; i < 70; i++) {
    const gx = -K + hash(i, 7)*(W + 2*K), gy = -K + hash(7, i)*(H + 2*K);
    if (gx > -1 && gx < W && gy > -1 && gy < H) continue;
    const [sx, sy] = P(gx, gy), ph = time + i;
    if (th.lowKind === 'water') { c.strokeStyle = `rgba(160,220,255,${.12 + .1*Math.sin(ph*1.3)})`; c.lineWidth = Math.max(1, T/30); c.beginPath(); c.moveTo(sx - T*.3, sy + sink + Math.sin(ph)*T*.03); c.lineTo(sx + T*.3, sy + sink + Math.sin(ph + 1)*T*.03); c.stroke(); }
    else if (th.lowKind === 'ember') { c.fillStyle = `rgba(255,${120 + 60*Math.sin(ph)|0},40,${.35 + .3*Math.sin(ph*2)})`; c.fillRect(sx, sy + sink, T*.05, T*.05); }
    else if (th.lowKind === 'snow') { c.fillStyle = `rgba(255,255,255,${.3 + .3*Math.sin(ph*2)})`; c.fillRect(sx, sy + sink, T*.04, T*.04); }
    else if (th.lowKind === 'lava') { const g = .5 + .5*Math.sin(ph*.8); c.fillStyle = `rgba(255,${90 + g*80|0},30,${.55 + .35*g})`; c.beginPath(); c.ellipse(sx, sy + sink, T*(.3 + hash(i, 3)*.5), T*(.12 + hash(3, i)*.2), 0, 0, 7); c.fill(); }
    else if (th.lowKind === 'flat') { c.fillStyle = 'rgba(255,230,180,.12)'; c.fillRect(sx - T*.3, sy + sink, T*.6, T*.03); }
    else { c.fillStyle = 'rgba(120,90,70,.18)'; c.fillRect(sx, sy + sink, T*.08, T*.05); }
  }
  // hills and props behind the arena (top-left and top-right edges), back to front
  const spots = [];
  for (let gy = -K; gy < H; gy++) for (let gx = -K; gx < W + 3; gx++) {
    if (gx >= 0 && gy >= 0) continue;
    const r = hash(gx + 101, gy + 57); if (r < .5) continue;
    spots.push({gx, gy, r});
  }
  spots.sort((a, b) => (a.gx + a.gy) - (b.gx + b.gy));
  for (const s of spots) {
    const [sx, sy] = P(s.gx, s.gy); if (sx < -T*3 || sx > VW + T*3 || sy < -T*3 || sy > VH + T*2) continue;
    const dist = Math.min(-s.gx, -s.gy) < 0 ? 0 : Math.max(0, Math.min(-s.gx, -s.gy));
    const hgt = T*(0.18 + s.r*0.5 + Math.min(.8, Math.max(0, (Math.max(-s.gx, -s.gy) - 1)*.06)));
    cube(c, sx, sy + sink, T, hgt, mixHex(th.hill, '#000000', .1 + hash(s.gx, s.gy)*.3));
    if (s.r > .8 && Math.max(-s.gx, -s.gy) > 1) drawProp(c, th.props[Math.floor(hash(s.gy, s.gx)*th.props.length)], sx, sy + sink - hgt, T, th, time, (s.gx*31 + s.gy*17) & 255);
  }
  return true;
}

/* weather drawn over the arena, under the HUD */
const WX = Array.from({length:140}, (_, i) => ({x:hash(i, 11), y:hash(11, i), s:.4 + hash(i, i + 3), v:.3 + hash(i, 5)*.7}));
function drawWeather(c, m, time, VW, VH) {
  const th = THEME[m.id]; if (!th) return;
  const k = th.weather;
  for (const p of WX) {
    if (k === 'snow') { const y = ((p.y + time*.05*p.v) % 1)*VH, x = (p.x*VW + Math.sin(time*.8 + p.y*20)*30) % VW; c.fillStyle = `rgba(255,255,255,${.35 + .4*p.s/1.4})`; c.beginPath(); c.arc(x, y, 1 + p.s*1.6, 0, 7); c.fill(); }
    else if (k === 'rain' || k === 'storm') { const y = ((p.y + time*.9*p.v) % 1)*VH, x = (p.x*VW + y*.25) % VW; c.strokeStyle = `rgba(170,200,230,${.18 + .15*p.s})`; c.lineWidth = 1; c.beginPath(); c.moveTo(x, y); c.lineTo(x - 5, y - 16); c.stroke(); }
    else if (k === 'ember') { const y = (1 - ((p.y + time*.04*p.v) % 1))*VH, x = p.x*VW + Math.sin(time + p.y*9)*18; c.fillStyle = `rgba(255,${130 + p.s*60|0},50,${.3 + .4*Math.abs(Math.sin(time*2 + p.x*20))})`; c.fillRect(x, y, 1.5 + p.s, 1.5 + p.s); }
    else if (k === 'ash') { const y = ((p.y + time*.03*p.v) % 1)*VH, x = p.x*VW + Math.sin(time*.6 + p.y*9)*24; c.fillStyle = p.s > 1.2 ? `rgba(255,120,40,.55)` : `rgba(170,160,170,${.25 + .2*p.s})`; c.fillRect(x, y, 1.5 + p.s, 1.5 + p.s); }
    else if (k === 'dust') { const x = ((p.x + time*.04*p.v) % 1)*VW, y = p.y*VH + Math.sin(time + p.x*10)*10; c.fillStyle = `rgba(230,200,150,${.12 + .12*p.s})`; c.fillRect(x, y, 2 + p.s*2, 1.2); }
    else if (k === 'drip') { if (p.s < .9) continue; const y = ((p.y + time*.6*p.v) % 1)*VH, x = p.x*VW; c.strokeStyle = 'rgba(140,200,230,.35)'; c.lineWidth = 1.2; c.beginPath(); c.moveTo(x, y); c.lineTo(x, y + 7); c.stroke(); }
    else if (k === 'pollen') { const y = ((p.y - time*.012*p.v) % 1 + 1) % 1*VH, x = p.x*VW + Math.sin(time*.7 + p.y*12)*26; c.fillStyle = p.s > 1 ? `rgba(236,114,208,${.3 + .3*Math.sin(time + p.x*9)})` : `rgba(127,214,192,${.25 + .25*Math.sin(time*1.3 + p.y*9)})`; c.beginPath(); c.arc(x, y, 1.2 + p.s, 0, 7); c.fill(); }
    else if (k === 'mist') { if (p.s < 1.1) continue; const x = ((p.x + time*.006*p.v) % 1)*VW, y = p.y*VH; const g = c.createRadialGradient(x, y, 0, x, y, 120*p.s); g.addColorStop(0, 'rgba(190,220,225,.07)'); g.addColorStop(1, 'rgba(190,220,225,0)'); c.fillStyle = g; c.fillRect(x - 200, y - 200, 400, 400); }
  }
  if (k === 'storm') { const f = Math.max(0, Math.sin(time*.7)*Math.sin(time*5.3)*Math.sin(time*1.1)); if (f > .82) { c.fillStyle = `rgba(200,215,255,${(f - .82)*1.4})`; c.fillRect(0, 0, VW, VH); } }
}
/* ───────────── maps ───────────── */
const MAPS = MAPS_RAW.map(m => { const A = buildArena(m); return {...m, ...V2[m.id], label:({Easy:'Starter', Hard:'Veteran', Brutal:'Extreme'})[m.label] || m.label, A, pal2:palOf(m), item:nameOf(m.legend.supply), exitN:nameOf(m.legend.exit), n:goalN(m)}; });
const ROT = MAPS.findIndex(m => m.id === 'copper-hollow');
const laneSetOf = A => new Set(A.valves.flatMap(v => [...v.lanes.A, ...v.lanes.B]));
const VERB_ICON = {
  add_solid:'M3 3h16v16H3zM11 7v8M7 11h8', remove_solid:'M4 18 13 9M9 4c5-2 9 1 9 1s3 4 1 9', extinguish:'M11 3S6 9 6 13a5 5 0 0 0 10 0c0-4-5-10-5-10zM8 12l6 4M14 12l-6 4',
  add_liquid:'M2 9c3-3 4 3 7 0s4 3 7 0 3 3 4 0M2 15c3-3 4 3 7 0s4 3 7 0 3 3 4 0', ignite:'M11 20c-4 0-7-3-7-7 0-4 4-5 4-10 3 2 4 4 4 7 1-1 2-3 2-4 3 3 4 5 4 7 0 4-3 7-7 7z',
  push:'M2 6h11v11H2zM15 11h5M18 8l3 3-3 3', area_repel:'M11 11m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0M5 5a8 8 0 0 0 0 12M17 5a8 8 0 0 1 0 12M2 2a12 12 0 0 0 0 18M20 2a12 12 0 0 1 0 18', grow:'M11 20V9M11 9C11 5 7 3 4 3c0 4 3 6 7 6zM11 12c0-4 4-6 7-6 0 4-3 6-7 6z',
};
const ROLE_ICON = {
  Builder:'M4 4h22v22H4zM15 9v12M9 15h12', Digger:'M5 25 18 12M12 6c6-3 12 2 12 2s4 6 1 12', Firefighter:'M15 4S8 12 8 17a7 7 0 0 0 14 0c0-5-7-13-7-13z',
  Scout:'M15 15m-4 0a4 4 0 1 0 8 0a4 4 0 1 0-8 0M3 15s5-8 12-8 12 8 12 8-5 8-12 8-12-8-12-8z', Runner:'M6 24l6-8 5 3 4-7M18 6m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0', Hauler:'M4 10h22v14H4zM10 10V6h10v4',
  Medic:'M12 5h6v7h7v6h-7v7h-6v-7H5v-6h7z', Engineer:'M15 15m-6 0a6 6 0 1 0 12 0a6 6 0 1 0-12 0M15 4v5M15 21v5M4 15h5M21 15h5', Saboteur:'M4 11c4-3 18-3 22 0 0 6-4 9-7 9-2 0-3-2-4-2s-2 2-4 2c-3 0-7-3-7-9zM9 13h3M18 13h3', Courier:'M17 3 7 17h7l-2 10 11-15h-7z',
};
const EAR_D = 'M6 8.5a6.5 6.5 0 1 1 13 0c0 6-6 6-6 10a3.5 3.5 0 1 1-7 0M15 8.5a2.5 2.5 0 0 0-5 0v1a2 2 0 1 1 0 4';
const EAR_PATH = typeof Path2D !== 'undefined' ? new Path2D(EAR_D) : null;
const ico = (d, vb = 22) => `<svg viewBox="0 0 ${vb} ${vb}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;
const EAR = `<svg class="ear" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${EAR_D}"/></svg>`;

/* ───────────── sound ───────────── */

export {
  MAPS_RAW, V2, SPEC, goalFor, SWITCH, HAND, CH, HAZ, SOLID, nameOf, goalN,
  buildArena, bfs, DIRS,
  ROLE_UNLOCK, ROSTER, RIVALS, TIERS, rng,
  DIFFS, GOALS, goalOf,
  shade, mixHex, poly, cube, diamond, hash, ease, palOf, drawAgent, renderArena, fitT,
  THEME, drawScenery, drawWeather, drawThing,
  MAPS, ROT, laneSetOf, VERB_ICON, ROLE_ICON, EAR_D, EAR_PATH, ico, EAR,
};
