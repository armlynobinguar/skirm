/* @ds-bundle: {"format":4,"namespace":"Promptlings","components":[{"name":"Logo"},{"name":"Icon"},{"name":"Button"},{"name":"TextField"},{"name":"Tabs"},{"name":"Toast"},{"name":"Modal"},{"name":"Badge"},{"name":"TagChip"},{"name":"UnlockChip"},{"name":"ScopeChip"},{"name":"AgentAvatar"},{"name":"AgentChip"},{"name":"CrewSlot"},{"name":"SkillCard"},{"name":"MapGrid"},{"name":"TileLegend"},{"name":"MapCard"},{"name":"RunHUD"},{"name":"ConfidenceBar"},{"name":"ReplayScrubber"},{"name":"ScoreBreakdown"},{"name":"ScoreHistogram"},{"name":"LeaderboardRow"},{"name":"CreditsBalance"},{"name":"TopUpPanel"},{"name":"PvPHeader"}]} */
(function () {
  'use strict';
  var React = window.React;
  var SVG_TAGS = { svg: 1, g: 1, rect: 1, path: 1, circle: 1, text: 1 };
  var VAR_ATTRS = ['fill', 'stroke', 'fontFamily'];
  /* createElement that moves var(--token) paint into style, where custom properties resolve. */
  var h = function (tag, attrs) {
    if (attrs && typeof tag === 'string' && SVG_TAGS[tag]) {
      var a = null;
      for (var i = 0; i < VAR_ATTRS.length; i++) {
        var k = VAR_ATTRS[i], v = attrs[k];
        if (typeof v === 'string' && v.indexOf('var(') === 0) {
          if (!a) { a = Object.assign({}, attrs); a.style = Object.assign({}, attrs.style); }
          a.style[k] = v; delete a[k];
        }
      }
      if (a) { var args = Array.prototype.slice.call(arguments); args[1] = a; return React.createElement.apply(null, args); }
    }
    return React.createElement.apply(null, arguments);
  };
  var Frag = React.Fragment;

  function cx() {
    var out = [];
    for (var i = 0; i < arguments.length; i++) if (arguments[i]) out.push(arguments[i]);
    return out.join(' ');
  }
  function fmt(n) {
    if (n === null || n === undefined || isNaN(n)) return '–';
    return Math.round(n).toLocaleString('en-US');
  }
  function fmtDec(n, d) { return Number(n).toFixed(d === undefined ? 2 : d); }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function fmtClock(ms) {
    var s = Math.max(0, Math.ceil(ms / 1000));
    return pad2(Math.floor(s / 60)) + ':' + pad2(s % 60);
  }

  /* ------------------------------------------------------------------ */
  /* Engine vocabulary (v0, from the concept doc)                        */
  /* ------------------------------------------------------------------ */
  var TAGS = ['spreads', 'liquid', 'damages', 'solid', 'blocks', 'pushable', 'breakable', 'flammable', 'collectible', 'goal'];
  var TAG_MEANING = {
    spreads: 'Grows into neighbouring tiles over time',
    liquid: 'Agents cannot walk into it; water puts out fire',
    damages: 'Removes an agent on the same tile',
    solid: 'Agents cannot walk into it',
    blocks: 'Stops anything that spreads',
    pushable: 'Moves one tile when an agent walks into it',
    breakable: 'Removed by dig',
    flammable: 'Fire can spread onto it, destroying it',
    collectible: 'Can be picked up into an agent’s inventory',
    goal: 'Reaching or collecting it can end the run'
  };
  var ACTIONS = ['move', 'wait', 'pick_up', 'drop', 'place_block', 'dig', 'extinguish'];
  var UNLOCKS = {
    Builder: { action: 'place_block', icon: 'place_block' },
    Digger: { action: 'dig', icon: 'dig' },
    Firefighter: { action: 'extinguish', icon: 'extinguish' }
  };

  /* Tiles: one entry per thing in the "Things built from tags" table.  */
  var TILES = [
    { kind: 'floor', ch: '.', name: 'Floor', tags: [], token: 'tile-floor', glyph: 'none (open tile)' },
    { kind: 'wall', ch: '#', name: 'Stone wall', tags: ['solid', 'blocks'], token: 'tile-wall', glyph: 'brick joints' },
    { kind: 'water', ch: '~', name: 'Water', tags: ['spreads', 'liquid'], token: 'tile-water', glyph: 'two waves' },
    { kind: 'lava', ch: 'L', name: 'Lava', tags: ['spreads', 'liquid', 'damages'], token: 'tile-lava', glyph: 'glowing crack' },
    { kind: 'fire', ch: '^', name: 'Fire', tags: ['spreads', 'damages'], token: 'tile-fire', glyph: 'flame' },
    { kind: 'grass', ch: ',', name: 'Grass', tags: ['flammable'], token: 'tile-grass', glyph: 'three tufts' },
    { kind: 'crate', ch: 'c', name: 'Wooden crate', tags: ['solid', 'pushable', 'flammable'], token: 'tile-crate', glyph: 'frame and X brace' },
    { kind: 'dirt', ch: 'd', name: 'Dirt', tags: ['solid', 'blocks', 'breakable'], token: 'tile-dirt', glyph: 'stipple' },
    { kind: 'block', ch: '=', name: 'Placed block', tags: ['solid', 'blocks'], token: 'tile-block', glyph: 'inset frame and plus' },
    { kind: 'gem', ch: '*', name: 'Gem, key, crystal', tags: ['collectible'], token: 'tile-gem', glyph: 'faceted diamond' },
    { kind: 'exit', ch: 'E', name: 'Exit', tags: ['goal'], token: 'tile-exit', glyph: 'door arch' },
    { kind: 'agent', ch: '0', name: 'Agent', tags: [], token: 'tile-agent', glyph: 'round body, >_ face' },
    { kind: 'mark', ch: null, name: 'Critical spot', tags: [], token: 'tile-mark', glyph: 'pink corner brackets' }
  ];
  var CH = {};
  TILES.forEach(function (t) { if (t.ch) CH[t.ch] = t.kind; });
  CH['0'] = 'floor';
  var HAZARD = { water: 1, lava: 1, fire: 1 };

  /* The three tested v0 maps (maps-v0.md). */
  var MAPS = {
    floodGate: {
      id: 'flood-gate', name: 'Flood Gate', theme: 'Sunken canal village',
      rows: ['###############', '#~~~~~~~~~~~~~#', '#######.#######', '#.....#.#.....#', '#.*...#.#...*.#', '#.............#', '#.............#', '#.*....0......#', '###############'],
      hazard: 'Water, spreads every 2 ticks', tags: ['spreads', 'liquid', 'collectible'], unlocks: ['Builder'],
      goal: 'Collect 3 gems', stepLimit: 60, bestSolo: { steps: 27, score: 2325 }, bestDuo: { steps: 23, score: 1213 },
      marks: [[7, 4]], spreadEvery: { water: 2 }
    },
    emberWarehouse: {
      id: 'ember-warehouse', name: 'Ember Warehouse', theme: 'Burning warehouse',
      rows: ['###############', '#######.#######', '#^,,,,,c,,,,,,#', '#######.###.#,#', '#...........#,#', '#.0.........#,#', '#..........E#*#', '###############'],
      hazard: 'Fire, spreads every 2 ticks along fuel', tags: ['spreads', 'damages', 'flammable', 'pushable', 'collectible', 'goal'], unlocks: [],
      goal: 'Collect the key, then reach the exit', stepLimit: 50, bestSolo: { steps: 29, score: 2130 }, bestDuo: { steps: 29, score: 1065 },
      marks: [[7, 2]], spreadEvery: { fire: 2 }
    },
    magmaMine: {
      id: 'magma-mine', name: 'Magma Mine', theme: 'Volcanic mine',
      rows: ['###############', '#0#######LLL###', '#.d.######.####', '#.#*######.####', '#.########.#.##', '#.............#', '#############.#', '###########*dE#', '###############'],
      hazard: 'Lava, spreads every 5 ticks', tags: ['spreads', 'liquid', 'damages', 'breakable', 'collectible', 'goal'], unlocks: ['Builder', 'Digger'],
      goal: 'Collect 2 crystals, then reach the exit', stepLimit: 70, bestSolo: { steps: 57, score: 1779 }, bestDuo: { steps: 32, score: 1157 },
      marks: [[10, 4]], spreadEvery: { lava: 5 }
    }
  };

  /* Score formula from the concept doc. Rounds half up: Math.floor(x + 0.5).
     Upkeep is 25 points per equipped skill unless a total upkeep is passed. */
  var UPKEEP_PER_SKILL = 25;
  function multiplierFor(agents) { return agents <= 1 ? 3.0 : agents === 2 ? 1.5 : 1.0; }
  function upkeepFor(o) { return o.upkeep !== undefined ? o.upkeep : UPKEEP_PER_SKILL * (o.skills || 0); }
  function scoreRun(o) {
    if (!o.cleared) return 0;
    var raw = 1000 * multiplierFor(o.agents) * (1 - 0.5 * (o.steps / o.stepLimit)) - upkeepFor(o);
    return Math.floor(raw + 0.5);
  }

  /* ------------------------------------------------------------------ */
  /* Icons: 16-unit grid, 1.5 stroke, round caps. currentColor.          */
  /* ------------------------------------------------------------------ */
  var ICONS = {
    move: 'M8 2v12M2 8h12M6 4l2-2 2 2M6 12l2 2 2-2M4 6 2 8l2 2M12 6l2 2-2 2',
    wait: 'M4.5 2h7M4.5 14h7M5.5 2v1.6c0 2 5 2.4 5 4.4s-5 2.4-5 4.4V14M10.5 2v1.6c0 2-5 2.4-5 4.4s5 2.4 5 4.4V14',
    pick_up: 'M8 10V2.5M5 5.5l3-3 3 3M2.5 10v3.5h11V10',
    drop: 'M8 2.5V10M5 7l3 3 3-3M2.5 10v3.5h11V10',
    place_block: 'M2.5 2.5h11v11h-11zM8 5.2v5.6M5.2 8h5.6',
    dig: 'M2.5 6.2C5 3.2 11 3.2 13.5 6.2M8 4.4V14',
    extinguish: 'M8 2s4.5 4.9 4.5 7.9a4.5 4.5 0 0 1-9 0C3.5 6.9 8 2 8 2zM6.2 10.6l3.6-3.6',
    tick: 'M1.5 8.5h2.5l1.5-4 3 7.5 1.5-3.5h4.5',
    steps: 'M2.5 13.5H6V10h3.5V6.5H13V3',
    agent: 'M8 14.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM5.3 6.2 7 7.9 5.3 9.6M8.4 10h2.6',
    crew: 'M5.5 10.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM11 13.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z',
    skill: 'M2.5 2.5h11v11h-11zM5 6l2 2-2 2M8.4 10.4H11',
    credits: 'M8 5.5c3 0 5.5-.9 5.5-2s-2.5-2-5.5-2-5.5.9-5.5 2 2.5 2 5.5 2zM2.5 3.5v4c0 1.1 2.5 2 5.5 2s5.5-.9 5.5-2v-4M2.5 7.5v4c0 1.1 2.5 2 5.5 2s5.5-.9 5.5-2v-4',
    timer: 'M8 15a5.5 5.5 0 1 0 0-11 5.5 5.5 0 0 0 0 11zM8 6.8v2.8l1.8 1.1M6.3 1.5h3.4M12.4 4.6l1.1-1.1',
    royalty: 'M12.5 3.5l-9 9M4.8 6.3a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM11.2 12.7a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z',
    trophy: 'M5 2.5h6V6a3 3 0 0 1-6 0zM5 3.5H2.5V5A2.5 2.5 0 0 0 5 7.5M11 3.5h2.5V5A2.5 2.5 0 0 1 11 7.5M8 9v3M5.5 14h5M6.5 12h3',
    replay: 'M2.6 8.6a5.5 5.5 0 1 0 1.5-4.5M3 1.8v3h3',
    play: 'M5 3l8 5-8 5z',
    pause: 'M5.5 3v10M10.5 3v10',
    step_back: 'M4 3v10M13 3 6.5 8l6.5 5z',
    step_fwd: 'M12 3v10M3 3l6.5 5L3 13z',
    check: 'M3 8.5l3 3 7-7',
    warning: 'M8 2 14.5 13.5h-13zM8 6.5v3.2M8 11.8v.2',
    critical: 'M5.5 1.5h5l4 4v5l-4 4h-5l-4-4v-5zM6 6l4 4M10 6l-4 4',
    info: 'M8 14.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM8 7.5v4M8 4.8v.2',
    close: 'M3.5 3.5l9 9M12.5 3.5l-9 9',
    plus: 'M8 3v10M3 8h10',
    minus: 'M3 8h10',
    lock: 'M3.5 7.5h9v6.5h-9zM5.5 7.5V5a2.5 2.5 0 0 1 5 0v2.5',
    elo: 'M3 9.5 8 5l5 4.5M3 13.5 8 9l5 4.5',
    map: 'M2.5 2.5h11v11h-11zM2.5 6.2h11M2.5 9.8h11M6.2 2.5v11M9.8 2.5v11',
    pvp: 'M2.5 2.5 10 10M13.5 2.5 6 10M9 12l3.5 1.5L11 10M7 12l-3.5 1.5L5 10',
    wallet: 'M2.5 4.5h10.5v9H2.5zM2.5 4.5l8-2v2M10 9h3',
    tag_spreads: 'M8 9.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM8 1.5v3M8 11.5v3M1.5 8h3M11.5 8h3',
    tag_liquid: 'M1.5 6c1.6-1.5 3.3-1.5 4.3 0s2.7 1.5 4.3 0 3.3-1.5 4.4 0M1.5 10.5c1.6-1.5 3.3-1.5 4.3 0s2.7 1.5 4.3 0 3.3-1.5 4.4 0',
    tag_damages: 'M9 1.5 4 9h4l-1 5.5L12 7H8z',
    tag_solid: 'M2.5 2.5h11v11h-11zM2.5 8 8 2.5M2.5 13.5l11-11M8 13.5 13.5 8',
    tag_blocks: 'M2 3.5h12v9H2zM2 8h12M6 3.5V8M10 8v4.5',
    tag_pushable: 'M7.5 4.5h6v7h-6zM1.5 8h4M3.6 6l2 2-2 2',
    tag_breakable: 'M2.5 2.5h11v11h-11zM8.5 2.5 7 6l2.5 2-2 2.5.6 3',
    tag_flammable: 'M8 1.8c2.6 3 4.7 5 4.2 8.2-.4 2.5-2.3 4-4.2 4s-3.8-1.5-4.2-4c-.3-2 1-3 2-4.5.3 1.5 1 2.3 1.6 2.6C7.2 6.1 7.5 4 8 1.8z',
    tag_collectible: 'M8 2l5 5-5 7-5-7zM3 7h10',
    tag_goal: 'M3.5 14.5V2M3.5 2.5h8.5l-2 3 2 3H3.5'
  };
  var FILLED_ICONS = { play: 1 };

  function Icon(props) {
    var name = props.name, size = props.size || 16;
    var d = ICONS[name] || ICONS.info;
    var filled = !!FILLED_ICONS[name];
    return h('svg', {
      className: cx('pl-icon', props.className), width: size, height: size, viewBox: '0 0 16 16',
      fill: filled ? 'currentColor' : 'none', stroke: 'currentColor', strokeWidth: props.strokeWidth || 1.5,
      strokeLinecap: 'round', strokeLinejoin: 'round',
      role: props.title ? 'img' : undefined, 'aria-hidden': props.title ? undefined : true, focusable: 'false'
    }, props.title ? h('title', null, props.title) : null, h('path', { d: d }));
  }

  /* ------------------------------------------------------------------ */
  /* Tile glyphs, in a 16-unit tile. detail: full | compact | fill       */
  /* ------------------------------------------------------------------ */
  var V = function (n) { return 'var(--' + n + ')'; };
  function agentGlyph(opts) {
    opts = opts || {};
    var detail = opts.detail || 'full';
    var ring = opts.crew ? V(opts.crew === 'b' ? 'crew-b' : 'crew-a') : null;
    var lost = opts.lost;
    var kids = [];
    if (ring) kids.push(h('circle', { key: 'r', cx: 8, cy: 8, r: 7.2, fill: 'none', stroke: ring, strokeWidth: 1.6 }));
    kids.push(h('circle', { key: 'b', cx: 8, cy: 8, r: ring ? 5.6 : 6.2, fill: lost ? V('tile-wall') : V('tile-agent'), stroke: V('tile-mark-halo'), strokeWidth: detail === 'fill' ? 0 : 0.9 }));
    if (detail !== 'fill') {
      if (lost) {
        kids.push(h('path', { key: 'f', d: 'M5.8 5.8l4.4 4.4M10.2 5.8l-4.4 4.4', stroke: V('tile-agent-mark'), strokeWidth: 1.3, strokeLinecap: 'round', fill: 'none' }));
      } else if (detail === 'full') {
        kids.push(h('path', { key: 'f', d: 'M5.4 6.2 7 7.8 5.4 9.4M8.3 9.8h2.4', stroke: V('tile-agent-mark'), strokeWidth: 1.3, strokeLinecap: 'round', strokeLinejoin: 'round', fill: 'none' }));
      } else {
        kids.push(h('circle', { key: 'e1', cx: 6.2, cy: 7.6, r: 0.9, fill: V('tile-agent-mark') }));
        kids.push(h('circle', { key: 'e2', cx: 9.8, cy: 7.6, r: 0.9, fill: V('tile-agent-mark') }));
      }
    }
    if (opts.letter && detail === 'full') {
      kids.push(h('rect', { key: 'lb', x: 10.6, y: 10.6, width: 5.2, height: 5.2, rx: 0.8, fill: ring || V('tile-agent'), stroke: V('tile-mark-halo'), strokeWidth: 0.6 }));
      kids.push(h('text', { key: 'lt', x: 13.2, y: 14.6, textAnchor: 'middle', fontSize: 4.6, fontWeight: 700, fontFamily: 'var(--font-mono)', fill: V('tile-mark-halo') }, opts.letter));
    }
    return kids;
  }

  function tileGlyph(kind, detail, anim) {
    detail = detail || 'full';
    var full = detail === 'full', fill = detail === 'fill';
    var k = [];
    var base = function (tok, cls, style) { k.push(h('rect', { key: 'bg', className: cls, style: style, x: 0, y: 0, width: 16, height: 16, fill: V(tok) })); };
    var line = function (key, d, tok, w, cls) { k.push(h('path', { key: key, className: cls, d: d, stroke: V(tok), strokeWidth: w || 1.25, fill: 'none', strokeLinecap: 'round', strokeLinejoin: 'round' })); };
    var spreadCls = anim && anim.spread ? 'pl-anim-spread' : null;
    var spreadStyle = anim && anim.origin ? { transformOrigin: anim.origin } : undefined;
    switch (kind) {
      case 'floor':
        base('tile-floor');
        if (!fill) k.push(h('rect', { key: 'g', x: 0.25, y: 0.25, width: 15.5, height: 15.5, fill: 'none', stroke: V('tile-grid'), strokeWidth: 0.5 }));
        break;
      case 'wall':
        base('tile-wall');
        if (full) line('p', 'M0 5.5h16M0 10.5h16M8 0v5.5M4 5.5v5M12 5.5v5M8 10.5V16', 'tile-wall-mark', 0.75);
        break;
      case 'water':
        k.push(h('rect', { key: 'fl', x: 0, y: 0, width: 16, height: 16, fill: V('tile-floor') }));
        k.push(h('g', { key: 'w', className: spreadCls, style: spreadStyle },
          h('rect', { x: 0, y: 0, width: 16, height: 16, fill: V('tile-water') }),
          fill ? null : h('path', { className: 'pl-anim-wave', d: full ? 'M2 6c1.3-1.3 2.7-1.3 4 0s2.7 1.3 4 0 2.7-1.3 4 0M2 11c1.3-1.3 2.7-1.3 4 0s2.7 1.3 4 0 2.7-1.3 4 0' : 'M2 8.5c1.3-1.6 2.7-1.6 4 0s2.7 1.6 4 0 2.7-1.6 4 0', stroke: V('tile-water-mark'), strokeWidth: full ? 1.25 : 1.6, fill: 'none', strokeLinecap: 'round' })));
        break;
      case 'lava':
        k.push(h('rect', { key: 'fl', x: 0, y: 0, width: 16, height: 16, fill: V('tile-floor') }));
        k.push(h('g', { key: 'l', className: spreadCls, style: spreadStyle },
          h('rect', { x: 0, y: 0, width: 16, height: 16, fill: V('tile-lava') }),
          fill ? null : h('path', { className: 'pl-anim-glow', d: full ? 'M2 4l4 3-1 4 4 2.5M6 7l5-2 3 3M11 5l1-3' : 'M2.5 5l5 3-1.5 5.5M7.5 8 13 6', stroke: V('tile-lava-mark'), strokeWidth: full ? 1.25 : 1.6, fill: 'none', strokeLinecap: 'round', strokeLinejoin: 'round' })));
        break;
      case 'fire':
        k.push(h('rect', { key: 'fl', x: 0, y: 0, width: 16, height: 16, fill: V('tile-floor') }));
        k.push(h('g', { key: 'f', className: spreadCls, style: spreadStyle },
          h('rect', { x: 0, y: 0, width: 16, height: 16, fill: V('tile-fire') }),
          fill ? null : h('path', { className: 'pl-anim-flicker', d: 'M8 2.4c2.6 3.1 4.6 5 4.1 8.2-.4 2.5-2.3 3.9-4.1 3.9s-3.7-1.4-4.1-3.9c-.3-2 1-3.1 2-4.6.3 1.5 1 2.3 1.6 2.6C7.3 6.6 7.5 4.6 8 2.4z', fill: V('tile-fire-mark') })));
        break;
      case 'grass':
        base('tile-grass');
        if (!fill) line('p', full ? 'M2.5 12.5 4 8.5l1.5 4M6.5 9 8 5l1.5 4M10.5 13.5 12 9.5l1.5 4' : 'M4 12 8 5l4 7', 'tile-grass-mark', full ? 1.25 : 1.6);
        break;
      case 'crate':
        base('tile-crate');
        if (!fill) line('p', full ? 'M2 2h12v12H2zM2.6 2.6l10.8 10.8M13.4 2.6 2.6 13.4' : 'M2.5 2.5l11 11M13.5 2.5l-11 11', 'tile-crate-mark', full ? 1.25 : 1.8);
        break;
      case 'dirt':
        base('tile-dirt');
        if (!fill) {
          var dots = full ? [[3.5, 3.5], [10, 2.8], [7, 7], [12.6, 8.4], [3.8, 11], [9, 12.8], [13.4, 13.6]] : [[4, 4.5], [11.5, 6], [6.5, 11.5]];
          dots.forEach(function (p, i) { k.push(h('circle', { key: 'd' + i, cx: p[0], cy: p[1], r: full ? 1 : 1.4, fill: V('tile-dirt-mark') })); });
        }
        break;
      case 'block':
        base('tile-block');
        if (!fill) line('p', full ? 'M2.5 2.5h11v11h-11zM8 5.4v5.2M5.4 8h5.2' : 'M8 4v8M4 8h8', 'tile-block-mark', full ? 1.25 : 1.8);
        break;
      case 'gem':
        base('tile-floor');
        k.push(h('path', { key: 'gm', d: fill ? 'M8 2 14 8 8 14 2 8z' : 'M8 2.5 13 7l-5 6.5L3 7z', fill: V('tile-gem'), stroke: fill ? 'none' : V('tile-gem-mark'), strokeWidth: 0.9, strokeLinejoin: 'round' }));
        if (full) line('ft', 'M3.2 7h9.6M6.2 7 8 13M9.8 7 8 13M6.2 7 8 2.6 9.8 7', 'tile-gem-mark', 0.7);
        break;
      case 'exit':
        base('tile-exit');
        k.push(h('path', { key: 'a', d: fill ? 'M4 16V8a4 4 0 0 1 8 0v8z' : 'M4.5 14.5V7.5a3.5 3.5 0 0 1 7 0v7z', fill: V('tile-exit-mark') }));
        break;
      case 'agent':
        base('tile-floor');
        agentGlyph({ detail: detail }).forEach(function (e) { k.push(e); });
        break;
      case 'mark':
        k.push(h('g', { key: 'm', className: 'pl-anim-pulse' },
          h('path', { d: 'M1.2 5V1.2H5M11 1.2h3.8V5M14.8 11v3.8H11M5 14.8H1.2V11', stroke: V('tile-mark-halo'), strokeWidth: 3.2, fill: 'none', strokeLinecap: 'square' }),
          h('path', { d: 'M1.2 5V1.2H5M11 1.2h3.8V5M14.8 11v3.8H11M5 14.8H1.2V11', stroke: V('tile-mark'), strokeWidth: 1.6, fill: 'none', strokeLinecap: 'square' })));
        break;
      default:
        base('tile-floor');
    }
    return k;
  }

  function detailFor(size) { return size >= 16 ? 'full' : size >= 10 ? 'compact' : 'fill'; }

  function TileSwatch(props) {
    var size = props.size || 32;
    var kind = props.kind;
    var detail = props.detail || detailFor(size);
    var under = kind === 'mark' ? tileGlyph('floor', detail) : [];
    return h('svg', { className: 'pl-swatch', width: size, height: size, viewBox: '0 0 16 16', 'aria-hidden': true },
      under, tileGlyph(kind, detail));
  }

  /* ------------------------------------------------------------------ */
  /* Logo                                                                */
  /* ------------------------------------------------------------------ */
  function LogoMark(props) {
    var size = props.size || 32;
    return h('svg', { className: 'pl-logo-mark', width: size, height: size, viewBox: '0 0 24 24', role: 'img', 'aria-label': props.title || 'Promptlings' },
      h('rect', { x: 0, y: 0, width: 24, height: 24, rx: 3, fill: V('tile-floor') }),
      h('path', { d: 'M1 6V1h5M18 1h5v5', stroke: V('tile-mark'), strokeWidth: 1.5, fill: 'none' }),
      h('circle', { cx: 12, cy: 13, r: 8, fill: V('tile-agent') }),
      h('path', { d: 'M8.4 10.4 10.8 12.8 8.4 15.2M12.6 15.6h3.6', stroke: V('tile-agent-mark'), strokeWidth: 1.9, strokeLinecap: 'round', strokeLinejoin: 'round', fill: 'none' }));
  }
  function Logo(props) {
    var size = props.size || 32;
    return h('span', { className: cx('pl-logo', props.className) },
      h(LogoMark, { size: size, title: props.markOnly ? 'Promptlings' : '' }),
      props.markOnly ? null : h('span', { className: 'pl-logo-word', style: { fontSize: Math.round(size * 0.9) + 'px' } }, 'Promptlings'));
  }

  /* ------------------------------------------------------------------ */
  /* Controls                                                            */
  /* ------------------------------------------------------------------ */
  function TickDots() {
    return h('span', { className: 'pl-tickdots', 'aria-hidden': true }, h('i'), h('i'), h('i'));
  }
  function Button(props) {
    var variant = props.variant || 'secondary', size = props.size || 'md';
    var rest = Object.assign({}, props);
    ['variant', 'size', 'icon', 'iconRight', 'loading', 'className', 'children', 'block'].forEach(function (k) { delete rest[k]; });
    var iconSize = size === 'lg' ? 18 : 16;
    return h('button', Object.assign({ type: 'button' }, rest, {
      className: cx('pl-btn', 'pl-btn-' + variant, 'pl-btn-' + size, props.block && 'pl-btn-block', props.loading && 'is-loading', props.className),
      disabled: props.disabled || props.loading, 'aria-busy': props.loading ? true : undefined
    }),
      props.loading ? h(TickDots) : (props.icon ? h(Icon, { name: props.icon, size: iconSize }) : null),
      props.children ? h('span', null, props.children) : null,
      props.iconRight && !props.loading ? h(Icon, { name: props.iconRight, size: iconSize }) : null);
  }

  var fieldSeq = 0;
  function TextField(props) {
    var idRef = React.useRef(null);
    if (!idRef.current) idRef.current = props.id || 'pl-field-' + (++fieldSeq);
    var id = idRef.current;
    var rest = Object.assign({}, props);
    ['label', 'hint', 'error', 'prefix', 'suffix', 'multiline', 'className', 'id', 'mono'].forEach(function (k) { delete rest[k]; });
    var descId = (props.hint || props.error) ? id + '-desc' : undefined;
    var Tag = props.multiline ? 'textarea' : 'input';
    return h('div', { className: cx('pl-field', props.error && 'is-error', props.disabled && 'is-disabled', props.className) },
      props.label ? h('label', { className: 'pl-field-label', htmlFor: id }, props.label) : null,
      h('div', { className: cx('pl-input-wrap', props.multiline && 'is-multi') },
        props.prefix ? h('span', { className: 'pl-input-affix' }, typeof props.prefix === 'string' && ICONS[props.prefix] ? h(Icon, { name: props.prefix }) : props.prefix) : null,
        h(Tag, Object.assign({ id: id, className: cx('pl-input', props.mono && 'is-mono'), 'aria-invalid': props.error ? true : undefined, 'aria-describedby': descId }, rest)),
        props.suffix ? h('span', { className: 'pl-input-affix' }, props.suffix) : null),
      props.error ? h('div', { className: 'pl-field-msg is-error', id: descId }, h(Icon, { name: 'critical', size: 14 }), h('span', null, props.error))
        : props.hint ? h('div', { className: 'pl-field-msg', id: descId }, props.hint) : null);
  }

  function Tabs(props) {
    var tabs = props.tabs || [];
    var st = React.useState(props.defaultValue || (tabs[0] && tabs[0].id));
    var value = props.value !== undefined ? props.value : st[0];
    var set = function (v) { if (props.value === undefined) st[1](v); if (props.onChange) props.onChange(v); };
    var refs = React.useRef({});
    function onKey(e) {
      var i = tabs.findIndex(function (t) { return t.id === value; });
      var n = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : null;
      if (n === null) return;
      e.preventDefault();
      n = (n + tabs.length) % tabs.length;
      set(tabs[n].id);
      if (refs.current[tabs[n].id]) refs.current[tabs[n].id].focus();
    }
    return h('div', { className: cx('pl-tabs', props.className), role: 'tablist', 'aria-label': props.label, onKeyDown: onKey },
      tabs.map(function (t) {
        var sel = t.id === value;
        return h('button', {
          key: t.id, ref: function (el) { refs.current[t.id] = el; }, type: 'button', role: 'tab', 'aria-selected': sel, tabIndex: sel ? 0 : -1,
          className: cx('pl-tab', sel && 'is-selected'), onClick: function () { set(t.id); }, disabled: t.disabled
        }, t.icon ? h(Icon, { name: t.icon, size: 14 }) : null, h('span', null, t.label), t.count !== undefined ? h('span', { className: 'pl-tab-count' }, t.count) : null);
      }));
  }

  var TONE_ICON = { neutral: 'info', good: 'check', warning: 'warning', critical: 'critical' };
  function Toast(props) {
    var tone = props.tone || 'neutral';
    return h('div', { className: cx('pl-toast', 'pl-tone-' + tone, props.className), role: tone === 'critical' ? 'alert' : 'status' },
      h('span', { className: 'pl-toast-icon' }, h(Icon, { name: props.icon || TONE_ICON[tone], size: 16 })),
      h('div', { className: 'pl-toast-body' },
        props.title ? h('div', { className: 'pl-toast-title' }, props.title) : null,
        props.children ? h('div', { className: 'pl-toast-text' }, props.children) : null),
      props.action ? h('div', { className: 'pl-toast-action' }, props.action) : null,
      props.onClose ? h('button', { type: 'button', className: 'pl-iconbtn', 'aria-label': 'Dismiss', onClick: props.onClose }, h(Icon, { name: 'close', size: 14 })) : null);
  }

  function Modal(props) {
    var ref = React.useRef(null);
    React.useEffect(function () {
      if (!props.open || props.inline) return;
      var prev = document.activeElement;
      if (ref.current) ref.current.focus();
      function onKey(e) { if (e.key === 'Escape' && props.onClose) props.onClose(); }
      document.addEventListener('keydown', onKey);
      return function () { document.removeEventListener('keydown', onKey); if (prev && prev.focus) prev.focus(); };
    }, [props.open, props.inline]);
    if (!props.open) return null;
    return h('div', { className: cx('pl-scrim', props.inline && 'is-inline'), onMouseDown: function (e) { if (e.target === e.currentTarget && props.onClose) props.onClose(); } },
      h('div', { className: cx('pl-modal', props.size === 'lg' && 'is-lg'), role: 'dialog', 'aria-modal': props.inline ? undefined : true, 'aria-labelledby': 'pl-modal-title', tabIndex: -1, ref: ref },
        h('div', { className: 'pl-modal-head' },
          h('h2', { className: 'pl-modal-title', id: 'pl-modal-title' }, props.title),
          props.onClose ? h('button', { type: 'button', className: 'pl-iconbtn', 'aria-label': 'Close', onClick: props.onClose }, h(Icon, { name: 'close' })) : null),
        h('div', { className: 'pl-modal-body' }, props.children),
        props.footer ? h('div', { className: 'pl-modal-foot' }, props.footer) : null));
  }

  /* ------------------------------------------------------------------ */
  /* Badges and chips                                                    */
  /* ------------------------------------------------------------------ */
  function Badge(props) {
    var tone = props.tone || 'neutral';
    var icon = props.icon === false ? null : (props.icon || TONE_ICON[tone] && tone !== 'neutral' ? (props.icon || TONE_ICON[tone]) : null);
    return h('span', { className: cx('pl-badge', 'pl-tone-' + tone, props.solid && 'is-solid', props.className) },
      icon ? h(Icon, { name: icon, size: 12, strokeWidth: 2 }) : null, h('span', null, props.children));
  }
  function TagChip(props) {
    var tag = props.tag;
    return h('span', { className: cx('pl-chip', 'pl-chip-tag', props.className), title: TAG_MEANING[tag] },
      h(Icon, { name: 'tag_' + tag, size: 13 }), h('span', null, tag), props.count !== undefined ? h('span', { className: 'pl-chip-count' }, props.count) : null);
  }
  function UnlockChip(props) {
    var u = UNLOCKS[props.unlock] || UNLOCKS.Builder;
    var state = props.state || 'owned';
    var lead = state === 'missing' ? 'warning' : state === 'owned' ? u.icon : 'lock';
    return h('span', { className: cx('pl-chip', 'pl-chip-unlock', 'is-' + state, props.className), title: props.unlock + ' unlocks ' + u.action },
      h(Icon, { name: lead, size: 13 }), h('span', null, props.unlock),
      state === 'missing' ? h('span', { className: 'pl-chip-note' }, 'not on map') : state === 'needed' ? h('span', { className: 'pl-chip-note' }, 'needed') : null);
  }
  function ScopeChip(props) {
    var s = props.scope || 'MVP';
    return h('span', { className: cx('pl-chip', 'pl-chip-scope', 'is-' + s.toLowerCase(), props.className) }, s);
  }

  /* ------------------------------------------------------------------ */
  /* Agents and crew                                                     */
  /* ------------------------------------------------------------------ */
  function AgentAvatar(props) {
    var size = props.size || 32;
    var detail = size >= 20 ? 'full' : 'compact';
    return h('span', { className: cx('pl-avatar', props.state === 'acting' && 'is-acting', props.state === 'lost' && 'is-lost', props.className), style: { width: size, height: size } },
      h('svg', { width: size, height: size, viewBox: '0 0 16 16', role: 'img', 'aria-label': (props.label || 'Agent') + (props.crew ? ', crew ' + props.crew.toUpperCase() : '') + (props.state === 'lost' ? ', lost' : '') },
        agentGlyph({ detail: detail, crew: props.crew, lost: props.state === 'lost', letter: props.crew && size >= 28 ? props.crew.toUpperCase() : null })));
  }
  function AgentChip(props) {
    var a = props.agent || {};
    return h('div', { className: cx('pl-agentchip', props.className) },
      h(AgentAvatar, { size: 28, crew: a.crew, state: a.state, label: a.name }),
      h('div', { className: 'pl-agentchip-text' },
        h('div', { className: 'pl-agentchip-name' }, a.name),
        h('div', { className: 'pl-agentchip-meta' },
          (a.unlocks || []).map(function (u) { return h(Icon, { key: u, name: UNLOCKS[u].icon, size: 12, title: u }); }),
          a.skills !== undefined ? h('span', null, a.skills + (a.skills === 1 ? ' skill' : ' skills')) : null,
          a.elo !== undefined ? h('span', { className: 'pl-mono' }, 'Elo ' + fmt(a.elo)) : null)));
  }
  function CrewSlot(props) {
    var a = props.agent;
    var slot = props.slot || 1;
    if (!a) {
      var m = multiplierFor(slot);
      return h('button', { type: 'button', className: cx('pl-crewslot', 'is-empty', props.className), onClick: props.onAdd, disabled: props.disabled },
        h('span', { className: 'pl-crewslot-plus' }, h(Icon, { name: 'plus', size: 18 })),
        h('span', { className: 'pl-crewslot-title' }, 'Add agent ' + slot),
        h('span', { className: 'pl-crewslot-note' }, slot === 1 ? 'Score ×3.0 with one agent' : 'Score drops to ×' + fmtDec(m, 1)),
        props.creditsPerAgent ? h('span', { className: 'pl-crewslot-note pl-mono' }, '+' + fmt(props.creditsPerAgent) + ' credits held') : null);
    }
    return h('div', { className: cx('pl-crewslot', props.className) },
      h('div', { className: 'pl-crewslot-head' },
        h(AgentAvatar, { size: 36, crew: a.crew, label: a.name }),
        h('div', { className: 'pl-crewslot-who' },
          h('div', { className: 'pl-crewslot-title' }, a.name),
          h('div', { className: 'pl-crewslot-note' }, 'Slot ' + slot)),
        props.onRemove ? h('button', { type: 'button', className: 'pl-iconbtn', 'aria-label': 'Remove ' + a.name, onClick: props.onRemove }, h(Icon, { name: 'close', size: 14 })) : null),
      (a.unlocks && a.unlocks.length) ? h('div', { className: 'pl-chiprow' }, a.unlocks.map(function (u) { return h(UnlockChip, { key: u, unlock: u, state: props.mapUnlocks && props.mapUnlocks.indexOf(u) < 0 ? 'missing' : 'owned' }); })) : null,
      h('ul', { className: 'pl-crewslot-skills' },
        (a.skills || []).map(function (s) { return h('li', { key: s }, h(Icon, { name: 'skill', size: 13 }), h('span', null, s)); }),
        (!a.skills || !a.skills.length) ? h('li', { className: 'is-none' }, 'No skills equipped') : null));
  }

  /* ------------------------------------------------------------------ */
  /* Skill card                                                          */
  /* ------------------------------------------------------------------ */
  function RateBar(props) {
    var pct = props.runs ? Math.round(100 * props.cleared / props.runs) : 0;
    return h('div', { className: 'pl-rate' },
      h('span', { className: 'pl-rate-tag' }, h(Icon, { name: 'tag_' + props.tag, size: 12 }), props.tag),
      h('span', { className: 'pl-rate-track', role: 'img', 'aria-label': props.tag + ': cleared ' + props.cleared + ' of ' + props.runs + ' maps' }, h('span', { className: 'pl-rate-fill', style: { width: pct + '%' } })),
      h('span', { className: cx('pl-rate-num', props.runs < 5 && 'is-few') }, props.cleared + '/' + props.runs));
  }
  function SkillCard(props) {
    var s = props.skill || {};
    var needs = s.unlocks || [];
    var missing = props.mapUnlocks ? needs.filter(function (u) { return props.mapUnlocks.indexOf(u) < 0; }) : [];
    return h('article', { className: cx('pl-card', 'pl-skill', missing.length && 'is-unusable', props.className) },
      h('header', { className: 'pl-skill-head' },
        h('span', { className: 'pl-skill-icon' }, h(Icon, { name: 'skill', size: 18 })),
        h('div', { className: 'pl-skill-who' },
          h('h3', { className: 'pl-skill-name' }, s.name),
          s.creator ? h('div', { className: 'pl-skill-by' }, 'by ' + s.creator) : null),
        props.owned ? h(Badge, { tone: 'good' }, 'Owned') : null),
      h('dl', { className: 'pl-skill-facts' },
        h('dt', null, 'Unlocks needed'),
        h('dd', { className: 'pl-chiprow' }, needs.length ? needs.map(function (u) { return h(UnlockChip, { key: u, unlock: u, state: missing.indexOf(u) >= 0 ? 'missing' : 'needed' }); }) : h('span', { className: 'pl-muted' }, 'None')),
        h('dt', null, 'Handles'),
        h('dd', { className: 'pl-chiprow' }, (s.tags || []).map(function (t) { return h(TagChip, { key: t, tag: t }); }))),
      (s.clearRates && s.clearRates.length) ? h('div', { className: 'pl-skill-rates' },
        h('div', { className: 'pl-eyebrow' }, 'Clear rate by tag'),
        s.clearRates.map(function (r) { return h(RateBar, { key: r.tag, tag: r.tag, cleared: r.cleared, runs: r.runs }); })) : null,
      missing.length ? h('div', { className: 'pl-skill-warn' }, h(Icon, { name: 'warning', size: 14 }), h('span', null, 'Needs ' + missing.join(', ') + '. This map does not offer it.')) : null,
      h('footer', { className: 'pl-skill-foot' },
        h('div', { className: 'pl-skill-price' },
          s.price !== undefined ? h('span', { className: 'pl-price' }, fmtDec(s.price, s.price % 1 ? 1 : 0) + ' NEAR') : null,
          s.royalty !== undefined ? h('span', { className: 'pl-skill-roy' }, h(Icon, { name: 'royalty', size: 12 }), s.royalty + '% to creator on resale') : null),
        props.owned ? (props.onEquip ? h(Button, { size: 'sm', onClick: props.onEquip }, 'Equip') : null)
          : (props.onBuy ? h(Button, { size: 'sm', variant: 'primary', onClick: props.onBuy }, 'Buy') : null)));
  }

  /* ------------------------------------------------------------------ */
  /* Map renderer                                                        */
  /* ------------------------------------------------------------------ */
  function parseRows(rows) {
    return rows.map(function (r) { return r.split('').map(function (c) { return CH[c] || 'floor'; }); });
  }
  function startAgents(rows) {
    var out = [];
    rows.forEach(function (r, y) { r.split('').forEach(function (c, x) { if (c === '0') out.push({ id: 'a' + out.length, x: x, y: y }); }); });
    return out;
  }
  var ORIGIN = { N: '50% 0%', S: '50% 100%', W: '0% 50%', E: '100% 50%' };

  function MapGrid(props) {
    var rows = props.rows || [];
    var s = props.tileSize || 24;
    var detail = props.detail || detailFor(s);
    var grid = parseRows(rows);
    var H = grid.length, W = H ? grid[0].length : 0;
    var agents = props.agents || startAgents(rows);
    var mounted = React.useRef(false);
    var born = React.useRef({});
    React.useEffect(function () { mounted.current = true; }, []);
    var tiles = [];
    for (var y = 0; y < H; y++) {
      for (var x = 0; x < W; x++) {
        var kind = grid[y][x];
        var key = x + ',' + y + ':' + kind;
        if (!(key in born.current)) born.current[key] = mounted.current;
        var anim = null;
        if (HAZARD[kind] && born.current[key] && props.animate !== false) {
          var from = (y > 0 && grid[y - 1][x] === kind) ? 'N' : (y < H - 1 && grid[y + 1][x] === kind) ? 'S' : (x > 0 && grid[y][x - 1] === kind) ? 'W' : (x < W - 1 && grid[y][x + 1] === kind) ? 'E' : null;
          anim = { spread: true, origin: from ? ORIGIN[from] : '50% 50%' };
        }
        tiles.push(h('g', { key: key, transform: 'translate(' + (x * s) + ' ' + (y * s) + ') scale(' + (s / 16) + ')', 'data-kind': kind }, tileGlyph(kind, detail, anim)));
      }
    }
    var marks = (props.marks || []).map(function (m, i) {
      return h('g', { key: 'm' + i, transform: 'translate(' + (m[0] * s) + ' ' + (m[1] * s) + ') scale(' + (s / 16) + ')' }, tileGlyph('mark', detail));
    });
    var ags = agents.map(function (a) {
      return h('g', { key: a.id, className: cx('pl-agent-pos', a.alive === false && 'is-lost'), style: { transform: 'translate(' + (a.x * s) + 'px,' + (a.y * s) + 'px)' } },
        h('g', { transform: 'scale(' + (s / 16) + ')' }, agentGlyph({ detail: detail, crew: a.crew, lost: a.alive === false, letter: a.letter })));
    });
    return h('div', { className: cx('pl-board', props.reducedMotion && 'is-still', props.className), style: { '--pl-tile': s + 'px' } },
      h('svg', { width: W * s, height: H * s, viewBox: '0 0 ' + (W * s) + ' ' + (H * s), role: 'img', 'aria-label': props.label || ('Map, ' + W + ' by ' + H + ' tiles') },
        tiles, marks, ags));
  }

  function TileLegend(props) {
    var only = props.kinds;
    var list = TILES.filter(function (t) { return !only || only.indexOf(t.kind) >= 0; });
    var size = props.size || 32;
    return h('ul', { className: cx('pl-legend', props.compact && 'is-compact', props.className) },
      list.map(function (t) {
        return h('li', { key: t.kind, className: 'pl-legend-item' },
          h(TileSwatch, { kind: t.kind, size: props.compact ? 20 : size }),
          h('div', { className: 'pl-legend-text' },
            h('div', { className: 'pl-legend-name' }, t.name, t.ch ? h('code', { className: 'pl-legend-ch' }, t.ch) : null),
            props.compact ? null : h('div', { className: 'pl-legend-tags' }, t.tags.length ? t.tags.join(' · ') : (t.kind === 'agent' ? 'entity' : t.kind === 'mark' ? 'overlay' : 'no tags'))));
      }));
  }

  function MapCard(props) {
    var m = props.map || MAPS.floodGate;
    return h('article', { className: cx('pl-card', 'pl-mapcard', props.className) },
      h('div', { className: 'pl-mapcard-thumb' }, h(MapGrid, { rows: m.rows, tileSize: props.thumbSize || 12, animate: false, label: m.name + ' map preview' })),
      h('div', { className: 'pl-mapcard-body' },
        h('div', { className: 'pl-mapcard-titlerow' },
          h('h3', { className: 'pl-mapcard-name' }, m.name),
          props.cleared ? h(Badge, { tone: 'good' }, 'Cleared') : null),
        h('div', { className: 'pl-mapcard-theme' }, m.theme),
        h('div', { className: 'pl-chiprow' }, (m.tags || []).slice(0, props.maxTags || 4).map(function (t) { return h(TagChip, { key: t, tag: t }); })),
        h('dl', { className: 'pl-mapcard-facts' },
          h('dt', null, 'Goal'), h('dd', null, m.goal),
          h('dt', null, 'Step limit'), h('dd', { className: 'pl-mono' }, m.stepLimit),
          h('dt', null, 'Unlocks'), h('dd', null, m.unlocks && m.unlocks.length ? m.unlocks.join(', ') : 'None'),
          m.bestSolo ? h(Frag, null, h('dt', null, 'Best solo'), h('dd', { className: 'pl-mono' }, m.bestSolo.steps + ' steps · ' + fmt(m.bestSolo.score))) : null,
          props.yourBest ? h(Frag, null, h('dt', null, 'Your best'), h('dd', { className: 'pl-mono' }, fmt(props.yourBest))) : null),
        props.onPlay ? h(Button, { variant: 'primary', size: 'sm', icon: 'play', onClick: props.onPlay }, props.entryFee ? 'Play · ' + props.entryFee + ' NEAR' : 'Play') : null));
  }

  /* ------------------------------------------------------------------ */
  /* Run view                                                            */
  /* ------------------------------------------------------------------ */
  function Meter(props) {
    var pct = Math.max(0, Math.min(1, props.value / props.max));
    return h('span', { className: cx('pl-meter', props.tone && 'pl-tone-' + props.tone), role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': props.max, 'aria-valuenow': props.value, 'aria-label': props.label },
      h('span', { className: 'pl-meter-fill', style: { width: (pct * 100) + '%' } }));
  }
  function RunHUD(props) {
    var tick = props.tick || 0, limit = props.stepLimit || 60;
    var used = tick / limit;
    var stepTone = used >= 0.85 ? 'warning' : null;
    var alive = props.agentsAlive, total = props.agentsTotal || 1;
    var status = props.status || 'running';
    var statusBadge = status === 'cleared' ? h(Badge, { tone: 'good' }, 'Cleared') : status === 'failed' ? h(Badge, { tone: 'critical' }, props.failReason || 'Failed') : status === 'planning' ? h(Badge, { icon: 'skill' }, 'Planning') : h(Badge, { icon: 'tick' }, 'Running');
    var avatars = [];
    for (var i = 0; i < total; i++) avatars.push(h(AgentAvatar, { key: i, size: 18, state: i < alive ? 'idle' : 'lost', crew: props.crew }));
    return h('div', { className: cx('pl-hud', props.className), role: 'group', 'aria-label': 'Run status' },
      h('div', { className: 'pl-hud-stat pl-hud-tick' },
        h('div', { className: 'pl-hud-label' }, h(Icon, { name: 'tick', size: 13 }), 'Tick'),
        h('div', { className: cx('pl-hud-value', stepTone && 'pl-text-' + stepTone), 'aria-live': 'off' }, pad2(tick), h('span', { className: 'pl-hud-of' }, ' / ' + limit)),
        h(Meter, { value: tick, max: limit, tone: stepTone, label: 'Steps used' }),
        stepTone ? h('div', { className: 'pl-hud-note pl-text-warning' }, h(Icon, { name: 'warning', size: 12 }), (limit - tick) + ' steps left') : null),
      h('div', { className: 'pl-hud-stat' },
        h('div', { className: 'pl-hud-label' }, h(Icon, { name: 'crew', size: 13 }), 'Agents alive'),
        h('div', { className: cx('pl-hud-value', alive < total && 'pl-text-critical') }, alive, h('span', { className: 'pl-hud-of' }, ' / ' + total)),
        h('div', { className: 'pl-hud-avatars' }, avatars)),
      h('div', { className: 'pl-hud-stat' },
        h('div', { className: 'pl-hud-label' }, h(Icon, { name: 'credits', size: 13 }), 'Credits spent'),
        h('div', { className: 'pl-hud-value' }, fmt(props.creditsSpent || 0)),
        props.creditsHeld !== undefined ? h('div', { className: 'pl-hud-note' }, fmt(props.creditsHeld) + ' held, unused come back') : null),
      h('div', { className: 'pl-hud-status' }, statusBadge, props.speed ? h('span', { className: 'pl-hud-speed' }, props.speed + '×') : null));
  }

  function ConfidenceBar(props) {
    var opts = (props.options || []).slice().sort(function (a, b) { return b.p - a.p; });
    var top = opts[0];
    var shown = opts.slice(0, props.max || 4);
    var rest = opts.slice(props.max || 4).reduce(function (s, o) { return s + o.p; }, 0);
    var low = top && top.p < (props.lowAt || 0.4);
    return h('div', { className: cx('pl-conf', props.className) },
      h('div', { className: 'pl-conf-head' },
        props.agentName ? h('span', { className: 'pl-conf-agent' }, h(AgentAvatar, { size: 18, crew: props.crew }), props.agentName) : null,
        h('span', { className: 'pl-conf-tick' }, props.tick !== undefined ? 'T ' + props.tick : '')),
      props.timedOut ? h('div', { className: 'pl-conf-top' }, h('span', { className: 'pl-conf-action' }, 'wait'), h(Badge, { tone: 'warning' }, 'Missed time limit'))
        : top ? h('div', { className: 'pl-conf-top' }, h('span', { className: 'pl-conf-action' }, top.action), h('span', { className: 'pl-conf-p' }, fmtDec(top.p))) : null,
      h('ul', { className: 'pl-conf-list' },
        shown.map(function (o, i) {
          return h('li', { key: o.action, className: cx('pl-conf-row', i === 0 && !props.timedOut && 'is-top') },
            h('span', { className: 'pl-conf-label' }, o.action),
            h('span', { className: 'pl-conf-track' }, h('span', { className: 'pl-conf-fill', style: { width: (o.p * 100) + '%' } })),
            h('span', { className: 'pl-conf-num' }, fmtDec(o.p)));
        }),
        rest > 0.0001 ? h('li', { className: 'pl-conf-row is-rest' }, h('span', { className: 'pl-conf-label' }, (opts.length - shown.length) + ' more'), h('span', { className: 'pl-conf-track' }, h('span', { className: 'pl-conf-fill', style: { width: (rest * 100) + '%' } })), h('span', { className: 'pl-conf-num' }, fmtDec(rest))) : null),
      low && !props.timedOut ? h('div', { className: 'pl-conf-note' }, h(Icon, { name: 'warning', size: 12 }), 'Unsure: top pick under ' + Math.round((props.lowAt || 0.4) * 100) + '%') : null);
  }

  var EVENT_SHAPE = {
    spread: { label: 'Spread', cls: 'ev-spread' },
    block: { label: 'Block placed', cls: 'ev-block' },
    collect: { label: 'Collected', cls: 'ev-collect' },
    replan: { label: 'Replan', cls: 'ev-replan' },
    lost: { label: 'Agent lost', cls: 'ev-lost' },
    goal: { label: 'Goal', cls: 'ev-goal' }
  };
  function EventGlyph(props) {
    var k = props.kind;
    var shape = k === 'collect' ? h('path', { d: 'M5 0.8 9.2 5 5 9.2 0.8 5z' })
      : k === 'block' ? h('rect', { x: 1, y: 1, width: 8, height: 8 })
        : k === 'replan' ? h('circle', { cx: 5, cy: 5, r: 3.6 })
          : k === 'lost' ? h('path', { d: 'M1.5 1.5l7 7M8.5 1.5l-7 7' })
            : k === 'goal' ? h('path', { d: 'M2 9.5V0.8h6.5L7 3l1.5 2.2H2' })
              : h('path', { d: 'M5 1 9 9H1z' });
    return h('svg', { className: cx('pl-ev', EVENT_SHAPE[k] && EVENT_SHAPE[k].cls), width: 10, height: 10, viewBox: '0 0 10 10', 'aria-hidden': true }, shape);
  }
  function ReplayScrubber(props) {
    var total = props.total || 60;
    var st = React.useState(props.defaultTick || 0);
    var tick = props.tick !== undefined ? props.tick : st[0];
    var setTick = function (t) { t = Math.max(0, Math.min(total, t)); if (props.tick === undefined) st[1](t); if (props.onSeek) props.onSeek(t); };
    var trackRef = React.useRef(null);
    function fromEvent(e) {
      var r = trackRef.current.getBoundingClientRect();
      return Math.round(((e.clientX - r.left) / r.width) * total);
    }
    function onDown(e) {
      setTick(fromEvent(e));
      var move = function (ev) { setTick(fromEvent(ev)); };
      var up = function () { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
      window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
    }
    function onKey(e) {
      var d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : e.key === 'PageUp' ? 10 : e.key === 'PageDown' ? -10 : null;
      if (e.key === 'Home') { e.preventDefault(); setTick(0); return; }
      if (e.key === 'End') { e.preventDefault(); setTick(total); return; }
      if (d === null) return;
      e.preventDefault(); setTick(tick + d);
    }
    var speeds = props.speeds || [0.5, 1, 2, 4];
    var kinds = {};
    (props.events || []).forEach(function (ev) { kinds[ev.kind] = 1; });
    return h('div', { className: cx('pl-scrub', props.className) },
      h('div', { className: 'pl-scrub-controls' },
        h('button', { type: 'button', className: 'pl-iconbtn', 'aria-label': 'Step back', onClick: function () { setTick(tick - 1); } }, h(Icon, { name: 'step_back' })),
        h('button', { type: 'button', className: 'pl-iconbtn is-primary', 'aria-label': props.playing ? 'Pause' : 'Play', onClick: props.onPlayToggle }, h(Icon, { name: props.playing ? 'pause' : 'play' })),
        h('button', { type: 'button', className: 'pl-iconbtn', 'aria-label': 'Step forward', onClick: function () { setTick(tick + 1); } }, h(Icon, { name: 'step_fwd' })),
        h('span', { className: 'pl-scrub-readout' }, 'T ' + pad2(tick), h('span', { className: 'pl-hud-of' }, ' / ' + total)),
        h('span', { className: 'pl-scrub-speeds', role: 'radiogroup', 'aria-label': 'Playback speed' },
          speeds.map(function (sp) {
            var on = sp === (props.speed || 1);
            return h('button', { key: sp, type: 'button', role: 'radio', 'aria-checked': on, className: cx('pl-speed', on && 'is-on'), onClick: function () { if (props.onSpeed) props.onSpeed(sp); } }, sp + '×');
          }))),
      h('div', { className: 'pl-scrub-lane' },
        h('div', { className: 'pl-scrub-events', 'aria-hidden': true },
          (props.events || []).map(function (ev, i) {
            return h('span', { key: i, className: 'pl-scrub-event', style: { left: (ev.tick / total * 100) + '%' }, title: 'T ' + ev.tick + ': ' + (ev.label || EVENT_SHAPE[ev.kind].label) }, h(EventGlyph, { kind: ev.kind }));
          })),
        h('div', {
          className: 'pl-scrub-track', ref: trackRef, role: 'slider', tabIndex: 0, 'aria-label': 'Replay tick', 'aria-valuemin': 0, 'aria-valuemax': total, 'aria-valuenow': tick, 'aria-valuetext': 'Tick ' + tick + ' of ' + total,
          onPointerDown: onDown, onKeyDown: onKey
        },
          h('span', { className: 'pl-scrub-fill', style: { width: (tick / total * 100) + '%' } }),
          h('span', { className: 'pl-scrub-handle', style: { left: (tick / total * 100) + '%' } }))),
      Object.keys(kinds).length ? h('ul', { className: 'pl-scrub-key' }, Object.keys(EVENT_SHAPE).filter(function (k) { return kinds[k]; }).map(function (k) { return h('li', { key: k }, h(EventGlyph, { kind: k }), EVENT_SHAPE[k].label); })) : null);
  }

  function ScoreBreakdown(props) {
    var agents = props.agents || 1, steps = props.steps, limit = props.stepLimit, upkeep = upkeepFor(props);
    var cleared = props.cleared !== false;
    var m = multiplierFor(agents);
    var factor = 1 - 0.5 * (steps / limit);
    var score = scoreRun({ cleared: cleared, agents: agents, steps: steps, stepLimit: limit, upkeep: upkeep });
    if (!cleared) {
      return h('div', { className: cx('pl-card', 'pl-score', 'is-failed', props.className) },
        h('div', { className: 'pl-score-total' }, h('span', { className: 'pl-score-num' }, '0'), h(Badge, { tone: 'critical' }, props.failReason || 'Not cleared')),
        h('p', { className: 'pl-score-why' }, 'No clear, no score. Credits for unused steps come back.'));
    }
    var row = function (label, expr, val, cls) { return h('div', { className: cx('pl-score-row', cls) }, h('span', { className: 'pl-score-label' }, label), h('span', { className: 'pl-score-expr' }, expr), h('span', { className: 'pl-score-val' }, val)); };
    return h('div', { className: cx('pl-card', 'pl-score', props.className) },
      h('div', { className: 'pl-score-rows' },
        row('Base', 'clear', '1,000'),
        row('Crew', agents + (agents === 1 ? ' agent' : ' agents'), '×' + fmtDec(m, 1)),
        row('Steps', '1 − 0.5 × ' + steps + '/' + limit, '×' + fmtDec(factor, 3)),
        row('Skill upkeep', (props.skills || 0) + ' × ' + UPKEEP_PER_SKILL, upkeep ? '−' + fmt(upkeep) : '0')),
      h('div', { className: 'pl-score-total' },
        h('span', { className: 'pl-score-num' }, fmt(score)),
        props.rankText ? h('span', { className: 'pl-score-rank' }, props.rankText) : null));
  }

  function ScoreHistogram(props) {
    var bins = props.bins || [];
    var max = Math.max.apply(null, bins.concat([1]));
    var min = props.min || 0, maxS = props.max || 3000;
    var you = props.yourScore;
    var yourBin = you === undefined ? -1 : Math.min(bins.length - 1, Math.max(0, Math.floor((you - min) / (maxS - min) * bins.length)));
    var height = props.height || 64;
    return h('figure', { className: cx('pl-hist', props.className) },
      h('div', { className: 'pl-hist-plot', style: { height: height } },
        bins.map(function (b, i) {
          return h('span', { key: i, className: cx('pl-hist-bar', i === yourBin && 'is-you'), style: { height: Math.max(2, b / max * height) + 'px' }, title: b + ' players' });
        }),
        you !== undefined ? h('span', { className: 'pl-hist-you', style: { left: ((you - min) / (maxS - min) * 100) + '%' } }, h('span', { className: 'pl-hist-youlabel' }, 'You ' + fmt(you))) : null),
      h('figcaption', { className: 'pl-hist-axis' }, h('span', null, fmt(min)), props.caption ? h('span', { className: 'pl-hist-cap' }, props.caption) : null, h('span', null, fmt(maxS))));
  }

  function LeaderboardRow(props) {
    var r = props.row || {};
    var dots = [];
    for (var i = 0; i < Math.min(r.agents || 1, 3); i++) dots.push(h(AgentAvatar, { key: i, size: 16 }));
    return h('div', { className: cx('pl-lbrow', props.you && 'is-you', props.className), role: 'row' },
      h('span', { className: 'pl-lbrow-rank', role: 'cell' }, '#' + r.rank),
      h('span', { className: 'pl-lbrow-name', role: 'cell' }, r.player, props.you ? h(Badge, { tone: 'you', icon: false }, 'You') : null),
      h('span', { className: 'pl-lbrow-crew', role: 'cell', 'aria-label': r.agents + ' agents' }, dots, (r.agents || 1) > 3 ? '+' : null),
      h('span', { className: 'pl-lbrow-steps', role: 'cell' }, r.steps + ' st'),
      h('span', { className: 'pl-lbrow-score', role: 'cell' }, fmt(r.score)),
      props.percentile !== undefined ? h('span', { className: 'pl-lbrow-pct', role: 'cell', 'aria-label': 'Better than ' + props.percentile + '% of runs' },
        h('span', { className: 'pl-lbrow-pcttrack' }, h('span', { className: 'pl-lbrow-pctmark', style: { left: props.percentile + '%' } }))) : null);
  }

  /* ------------------------------------------------------------------ */
  /* Credits                                                             */
  /* ------------------------------------------------------------------ */
  function CreditsBalance(props) {
    var low = props.lowAt !== undefined && props.balance < props.lowAt;
    return h('div', { className: cx('pl-credits', low && 'is-low', props.className) },
      h('span', { className: 'pl-credits-icon' }, h(Icon, { name: 'credits', size: 16 })),
      h('div', { className: 'pl-credits-text' },
        h('div', { className: 'pl-credits-num' }, fmt(props.balance), h('span', { className: 'pl-credits-unit' }, ' credits')),
        props.freeRuns !== undefined ? h('div', { className: 'pl-credits-free' }, props.freeRuns + (props.freeRuns === 1 ? ' free run' : ' free runs') + ' left today')
          : low ? h('div', { className: 'pl-credits-free pl-text-warning' }, 'Low balance') : null),
      props.onTopUp ? h(Button, { size: 'sm', icon: 'plus', onClick: props.onTopUp }, 'Top up') : null);
  }
  function TopUpPanel(props) {
    var packs = props.packs || [{ near: 1 }, { near: 5 }, { near: 10 }];
    var rate = props.creditsPerNear || 1000;
    var st = React.useState(props.defaultIndex !== undefined ? props.defaultIndex : 1);
    var sel = st[0];
    var p = packs[sel] || packs[0];
    return h('div', { className: cx('pl-card', 'pl-topup', props.className) },
      h('div', { className: 'pl-topup-head' }, h('h3', { className: 'pl-topup-title' }, 'Top up credits'), props.network ? h(Badge, null, props.network) : null),
      h('div', { className: 'pl-topup-packs', role: 'radiogroup', 'aria-label': 'Amount' },
        packs.map(function (pk, i) {
          var on = i === sel;
          return h('button', { key: i, type: 'button', role: 'radio', 'aria-checked': on, className: cx('pl-pack', on && 'is-on'), onClick: function () { st[1](i); } },
            h('span', { className: 'pl-pack-near' }, pk.near + ' NEAR'),
            h('span', { className: 'pl-pack-credits' }, fmt(pk.near * rate) + ' credits'));
        })),
      h('p', { className: 'pl-topup-note' }, '1 credit pays for one agent turn. A run holds agents × step limit up front; unused credits come back when it ends.'),
      h(Button, { variant: 'primary', block: true, icon: 'wallet', onClick: function () { if (props.onConfirm) props.onConfirm(p); }, loading: props.pending }, props.pending ? 'Waiting for wallet' : 'Top up ' + p.near + ' NEAR'));
  }

  /* ------------------------------------------------------------------ */
  /* PvP                                                                 */
  /* ------------------------------------------------------------------ */
  function CrewSide(props) {
    var c = props.crew || {};
    var side = props.side;
    var avatars = [];
    for (var i = 0; i < (c.agents || 1); i++) avatars.push(h(AgentAvatar, { key: i, size: 22, crew: side, state: c.lost && i < c.lost ? 'lost' : 'idle' }));
    return h('div', { className: cx('pl-pvp-side', 'is-' + side, c.leading && 'is-leading') },
      h('span', { className: 'pl-pvp-letter' }, side.toUpperCase()),
      h('div', { className: 'pl-pvp-who' },
        h('div', { className: 'pl-pvp-name' }, c.name, c.you ? h(Badge, { tone: 'you', icon: false }, 'You') : null),
        h('div', { className: 'pl-pvp-meta' }, h(Icon, { name: 'elo', size: 12 }), h('span', { className: 'pl-mono' }, 'Elo ' + fmt(c.elo)), c.eloDelta ? h('span', { className: cx('pl-mono', c.eloDelta > 0 ? 'pl-text-good' : 'pl-text-critical') }, (c.eloDelta > 0 ? '+' : '−') + Math.abs(c.eloDelta)) : null)),
      h('div', { className: 'pl-pvp-crew' }, avatars),
      c.progress ? h('div', { className: 'pl-pvp-progress' }, c.progress) : null);
  }
  function PvPHeader(props) {
    var cap = props.capMs || 600000;
    var left = Math.max(0, cap - (props.elapsedMs || 0));
    var tone = left <= 60000 ? 'warning' : null;
    return h('header', { className: cx('pl-pvp', props.className) },
      h(CrewSide, { crew: props.crewA, side: 'a' }),
      h('div', { className: 'pl-pvp-mid' },
        h('div', { className: 'pl-pvp-mode' }, h(Icon, { name: 'pvp', size: 13 }), (props.mode || 'Race') + (props.ranked === false ? '' : ' · ranked')),
        h('div', { className: cx('pl-pvp-clock', tone && 'pl-text-warning'), role: 'timer', 'aria-label': fmtClock(left) + ' left' }, fmtClock(left)),
        h(Meter, { value: cap - left, max: cap, tone: tone, label: 'Match time used' }),
        h('div', { className: 'pl-pvp-tick' }, 'T ' + (props.tick || 0) + ' · 10:00 cap')),
      h(CrewSide, { crew: props.crewB, side: 'b' }));
  }

  /* ------------------------------------------------------------------ */
  var NS = {
    Logo: Logo, LogoMark: LogoMark, Icon: Icon, Button: Button, TextField: TextField, Tabs: Tabs, Toast: Toast, Modal: Modal,
    Badge: Badge, TagChip: TagChip, UnlockChip: UnlockChip, ScopeChip: ScopeChip,
    AgentAvatar: AgentAvatar, AgentChip: AgentChip, CrewSlot: CrewSlot, SkillCard: SkillCard,
    MapGrid: MapGrid, TileLegend: TileLegend, TileSwatch: TileSwatch, MapCard: MapCard,
    RunHUD: RunHUD, ConfidenceBar: ConfidenceBar, ReplayScrubber: ReplayScrubber, ScoreBreakdown: ScoreBreakdown,
    ScoreHistogram: ScoreHistogram, LeaderboardRow: LeaderboardRow, CreditsBalance: CreditsBalance, TopUpPanel: TopUpPanel,
    PvPHeader: PvPHeader,
    /* data and helpers */
    TAGS: TAGS, TAG_MEANING: TAG_MEANING, ACTIONS: ACTIONS, UNLOCKS: UNLOCKS, TILES: TILES, MAPS: MAPS, ICONS: ICONS,
    tileGlyph: tileGlyph, agentGlyph: agentGlyph, parseRows: parseRows, multiplierFor: multiplierFor, scoreRun: scoreRun, UPKEEP_PER_SKILL: UPKEEP_PER_SKILL
  };
  window.Promptlings = Object.assign(window.Promptlings || {}, NS);
})();
