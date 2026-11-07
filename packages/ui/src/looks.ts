// Role looks: what each agent role wears, as a few boxes over the shared block body, plus the pose
// math that animates them. One table drives every renderer: the isometric arena canvas and the
// portraits (apps/web arena/figure2d.ts), the 3D chase cam (arena/chase3d/scene3d.ts) and the SVG
// avatar on cards (AgentAvatar). Adding a role is one ROLE_LOOKS entry; an unknown role gets the
// generic look (a beanie in a colour picked from its name), so a new engine role never breaks.
//
// Space: one tile = 1. y is up from the agent's feet, +z is the way it faces, +x is its right.
// A part is an axis-aligned box: centre x / z, bottom y, size [w, h, d].

/** Which bit of the figure a part moves with when the agent is posed. */
export type LookGroup = 'footL' | 'footR' | 'body' | 'head' | 'hand' | 'tip';

/** A part colour: one of the agent's own (body = outfit, head = skin, team = crew ring) or a hex. */
export type LookFill = 'body' | 'head' | 'boot' | 'visor' | 'team' | `#${string}`;

export interface LookPart {
  group: LookGroup;
  /** Centre x, bottom y, centre z. */
  at: readonly [number, number, number];
  size: readonly [number, number, number];
  fill: LookFill;
  /** Unlit and bright in 3D (lamps, visors, antenna tips). */
  glow?: boolean;
  /** A band wrapped round a bigger part (belt, stripe, headband): the 2D figure draws its sides only. */
  band?: boolean;
}

/** What a role's verb looks like while the agent uses it. */
export type VerbFx =
  'dig' | 'build' | 'spray' | 'pulse' | 'heal' | 'wrench' | 'spark' | 'dash' | 'none';

export interface RoleLook {
  /** The role's signature colour (hat, badge), for chips and effects. */
  accent: string;
  /** Torso [w, h, d]; the default block body is [0.4, 0.3, 0.4]. */
  torso: readonly [number, number, number];
  /** Foot [w, d]; the default boot is [0.13, 0.3]. */
  foot?: readonly [number, number];
  /** Boot colour (default: the dark boot). */
  boot?: LookFill;
  /** Replaces the default visor (dark slit with a light in the body colour). */
  visor?: readonly LookPart[];
  /** What the role adds over the body: hats, packs, tools. */
  parts: readonly LookPart[];
  /** How its verb animates. */
  verb: VerbFx;
  /** Walk cycle speed and lean (1 = default). */
  stride?: number;
  /** Carried items to show (the engine's carry cap: Haulers carry 3). */
  carry: number;
  /** Draw the carried count beside the items (Haulers). */
  count?: boolean;
  /** Trouser colour on the legs, with a dark sole under each (dressed looks; default: plain boots). */
  pants?: string;
}

const p = (
  group: LookGroup,
  at: readonly [number, number, number],
  size: readonly [number, number, number],
  fill: LookFill,
  glow?: boolean,
): LookPart => (glow ? { group, at, size, fill, glow } : { group, at, size, fill });
/** A band round the torso or head (sides only in 2D). */
const band = (
  group: LookGroup,
  y: number,
  size: readonly [number, number, number],
  fill: LookFill,
): LookPart => ({ group, at: [0, y, 0], size, fill, band: true });

/** Head top: hats sit here. */
export const HEAD_TOP = 0.78;
const BASE_TORSO = [0.4, 0.3, 0.4] as const;

/**
 * Every role's look. Keys are the engine's role names (packages/engine/src/v2/match.ts `Role`);
 * Medic, Engineer, Saboteur and Courier are ready for when the engine adds them.
 */
export const ROLE_LOOKS: Readonly<Record<string, RoleLook>> = {
  // Yellow hard hat with a ridge, tool belt, hammer.
  Builder: {
    accent: '#ffd23f',
    torso: BASE_TORSO,
    parts: [
      p('head', [0, 0.76, 0.03], [0.46, 0.03, 0.5], '#e6b400'),
      p('head', [0, 0.77, 0], [0.38, 0.13, 0.38], '#ffd23f'),
      p('head', [0, 0.9, 0], [0.07, 0.03, 0.32], '#fff1a8'),
      band('body', 0.22, [0.42, 0.05, 0.42], '#6b4a2b'),
      p('hand', [0.27, 0.12, 0.06], [0.05, 0.24, 0.05], '#8a5f37'),
      p('hand', [0.27, 0.34, 0.06], [0.08, 0.07, 0.15], '#9aa3ad'),
    ],
    verb: 'build',
    carry: 2,
  },
  // Miner helmet with a lamp, shovel at its side.
  Digger: {
    accent: '#ffe27a',
    torso: BASE_TORSO,
    parts: [
      p('head', [0, 0.76, 0.02], [0.42, 0.03, 0.46], '#30353d'),
      p('head', [0, 0.77, 0], [0.37, 0.11, 0.37], '#4a5160'),
      p('head', [0, 0.79, 0.2], [0.11, 0.08, 0.05], '#ffe27a', true),
      p('hand', [0.28, 0.0, 0.08], [0.15, 0.15, 0.04], '#b8c0c8'),
      p('hand', [0.28, 0.15, 0.08], [0.04, 0.46, 0.04], '#8a5f37'),
      p('hand', [0.28, 0.61, 0.08], [0.12, 0.04, 0.05], '#5a3d24'),
    ],
    verb: 'dig',
    carry: 2,
  },
  // Red helmet with a back flap and badge, air tank on the back, hose nozzle.
  Firefighter: {
    accent: '#ff5a3c',
    torso: BASE_TORSO,
    parts: [
      p('head', [0, 0.74, -0.14], [0.44, 0.04, 0.22], '#a8261e'),
      p('head', [0, 0.76, 0], [0.4, 0.14, 0.4], '#d8342a'),
      p('head', [0, 0.9, -0.02], [0.06, 0.05, 0.3], '#ffd23f'),
      p('head', [0, 0.79, 0.205], [0.12, 0.09, 0.02], '#ffd23f'),
      p('body', [-0.07, 0.18, -0.27], [0.12, 0.34, 0.12], '#c8d0d8'),
      p('body', [0.07, 0.18, -0.27], [0.12, 0.34, 0.12], '#c8d0d8'),
      p('body', [0, 0.52, -0.27], [0.08, 0.05, 0.08], '#d8342a'),
      p('hand', [0.26, 0.3, 0.12], [0.06, 0.06, 0.18], '#262b33'),
    ],
    verb: 'spray',
    carry: 2,
  },
  // Wide glowing visor and an antenna with a beacon tip.
  Scout: {
    accent: '#5fd3ff',
    torso: BASE_TORSO,
    visor: [
      p('head', [0, 0.59, 0.185], [0.38, 0.11, 0.03], '#0b1118'),
      p('head', [0, 0.61, 0.2], [0.34, 0.06, 0.02], '#5fd3ff', true),
    ],
    parts: [
      p('head', [0.1, 0.78, -0.06], [0.03, 0.3, 0.03], '#9aa3ad'),
      p('tip', [0.1, 1.06, -0.06], [0.08, 0.08, 0.08], '#ff4655', true),
      band('body', 0.44, [0.42, 0.06, 0.42], '#2c3440'),
    ],
    verb: 'pulse',
    carry: 2,
  },
  // Slim body, white racing stripes, headband, light shoes; long stride.
  Runner: {
    accent: '#ffffff',
    torso: [0.3, 0.32, 0.32],
    foot: [0.11, 0.28],
    boot: '#e9edf2',
    parts: [
      band('body', 0.27, [0.31, 0.03, 0.33], '#ffffff'),
      band('body', 0.39, [0.31, 0.03, 0.33], '#ffffff'),
      band('head', 0.71, [0.37, 0.05, 0.37], '#ff4655'),
    ],
    verb: 'dash',
    stride: 1.5,
    carry: 2,
  },
  // Broad body, a strapped crate on the back, flat cap; shows its carried count.
  Hauler: {
    accent: '#c9a46a',
    torso: [0.46, 0.3, 0.42],
    parts: [
      p('body', [0, 0.18, -0.31], [0.38, 0.4, 0.22], '#b98552'),
      { ...p('body', [0, 0.3, -0.31], [0.39, 0.04, 0.23], '#6f4a2a'), band: true },
      p('body', [0, 0.58, -0.31], [0.4, 0.03, 0.24], '#8a5f37'),
      p('head', [0, 0.78, 0], [0.37, 0.06, 0.37], '#6b7a4a'),
      p('head', [0, 0.78, 0.22], [0.3, 0.025, 0.12], '#55623a'),
    ],
    verb: 'none',
    carry: 3,
    count: true,
  },
  // White cap and a red cross, a med kit in hand.
  Medic: {
    accent: '#ff4d5e',
    torso: BASE_TORSO,
    parts: [
      p('head', [0, 0.77, 0], [0.37, 0.09, 0.37], '#f4f6f8'),
      p('head', [0, 0.79, 0.19], [0.09, 0.03, 0.02], '#ff4d5e'),
      p('head', [0, 0.765, 0.19], [0.03, 0.08, 0.02], '#ff4d5e'),
      p('body', [0, 0.32, 0.205], [0.14, 0.04, 0.02], '#ff4d5e'),
      p('body', [0, 0.27, 0.205], [0.04, 0.14, 0.02], '#ff4d5e'),
      p('hand', [0.28, 0.1, 0.05], [0.09, 0.12, 0.16], '#f4f6f8'),
      p('hand', [0.28, 0.15, 0.05], [0.095, 0.03, 0.165], '#ff4d5e'),
    ],
    verb: 'heal',
    carry: 2,
  },
  // Goggles on the forehead, a wrench, an orange tool pack.
  Engineer: {
    accent: '#ff9f1a',
    torso: BASE_TORSO,
    parts: [
      band('head', 0.68, [0.38, 0.05, 0.38], '#2a2f38'),
      p('head', [-0.08, 0.665, 0.19], [0.1, 0.08, 0.03], '#ffb547', true),
      p('head', [0.08, 0.665, 0.19], [0.1, 0.08, 0.03], '#ffb547', true),
      p('body', [0, 0.2, -0.25], [0.3, 0.26, 0.1], '#ff9f1a'),
      p('hand', [0.27, 0.12, 0.06], [0.04, 0.26, 0.04], '#9aa3ad'),
      p('hand', [0.27, 0.38, 0.06], [0.11, 0.05, 0.05], '#9aa3ad'),
    ],
    verb: 'wrench',
    carry: 2,
  },
  // Dark hood, red eye slit, a fused charge in hand.
  Saboteur: {
    accent: '#ff4655',
    torso: BASE_TORSO,
    visor: [
      p('head', [0, 0.6, 0.185], [0.3, 0.06, 0.03], '#0b1118'),
      p('head', [0, 0.615, 0.2], [0.24, 0.03, 0.02], '#ff4655', true),
    ],
    parts: [
      p('head', [0, 0.68, -0.02], [0.4, 0.14, 0.38], '#262a33'),
      p('head', [0, 0.82, -0.02], [0.3, 0.06, 0.3], '#1c1f26'),
      p('hand', [0.28, 0.1, 0.06], [0.12, 0.12, 0.12], '#14171c'),
      p('hand', [0.28, 0.22, 0.06], [0.02, 0.07, 0.02], '#ffb547', true),
    ],
    verb: 'spark',
    carry: 2,
  },
  // Peaked cap and a satchel at the hip.
  Courier: {
    accent: '#4fd6f2',
    torso: [0.36, 0.3, 0.36],
    parts: [
      p('head', [0, 0.78, 0], [0.37, 0.07, 0.37], '#2f6fd0'),
      p('head', [0, 0.78, 0.22], [0.32, 0.025, 0.14], '#24569f'),
      p('body', [-0.24, 0.12, 0], [0.1, 0.2, 0.26], '#c9a46a'),
      p('body', [-0.24, 0.3, 0], [0.11, 0.03, 0.27], '#6f5734'),
    ],
    verb: 'dash',
    stride: 1.3,
    carry: 1,
  },
};

/** A colour from a role's name, for roles the table does not know yet. */
function nameHue(role: string): string {
  let h = 0;
  for (let i = 0; i < role.length; i++) h = (h * 31 + role.charCodeAt(i)) >>> 0;
  return hslHex((h % 360) / 360, 0.55, 0.55);
}

const generic = new Map<string, RoleLook>();
/** The generic look: the plain block body with a beanie in a colour from the role's name. */
export function genericLook(role = ''): RoleLook {
  let g = generic.get(role);
  if (!g) {
    const c = role ? nameHue(role) : '#7a8494';
    g = {
      accent: c,
      torso: BASE_TORSO,
      parts: [
        p('head', [0, 0.76, 0], [0.37, 0.09, 0.37], c as LookFill),
        p('head', [0, 0.85, 0], [0.1, 0.06, 0.1], '#ece8e1'),
      ],
      verb: 'none',
      carry: 2,
    };
    generic.set(role, g);
  }
  return g;
}

/** The look for a role (any case); unknown or missing roles get the generic look. */
export function lookFor(role?: string | null): RoleLook {
  if (!role) return genericLook();
  const k = role.charAt(0).toUpperCase() + role.slice(1).toLowerCase();
  return ROLE_LOOKS[k] ?? genericLook(k);
}

/** Every part of a role's figure: boots, torso, head, visor, then the role's own. */
const partsCache = new WeakMap<RoleLook, LookPart[]>();
export function lookParts(look: RoleLook): LookPart[] {
  const hit = partsCache.get(look);
  if (hit) return hit;
  const out = buildParts(look);
  partsCache.set(look, out);
  return out;
}

function buildParts(look: RoleLook): LookPart[] {
  const [tw, th, td] = look.torso;
  const [fw, fd] = look.foot ?? [0.13, 0.3];
  const fx = Math.max(fw / 2 + 0.01, tw / 4.4);
  const boot = look.boot ?? 'boot';
  const legs: LookPart[] = look.pants
    ? [
        p('footL', [-fx, 0, 0], [fw, 0.05, fd], 'boot'),
        p('footR', [fx, 0, 0], [fw, 0.05, fd], 'boot'),
        p('footL', [-fx, 0.05, 0], [fw, 0.15, fd * 0.8], look.pants as LookFill),
        p('footR', [fx, 0.05, 0], [fw, 0.15, fd * 0.8], look.pants as LookFill),
      ]
    : [p('footL', [-fx, 0, 0], [fw, 0.2, fd], boot), p('footR', [fx, 0, 0], [fw, 0.2, fd], boot)];
  return [
    ...legs,
    p('body', [0, 0.2, 0], [tw, th, td], 'body'),
    p('head', [0, 0.5, 0], [0.36, 0.28, 0.36], 'head'),
    ...(look.visor ?? [
      p('head', [0, 0.62, 0.185], [0.28, 0.08, 0.02], 'visor'),
      p('head', [0, 0.645, 0.196], [0.2, 0.025, 0.02], 'body', true),
    ]),
    ...look.parts,
  ].map((q) =>
    (q.group === 'head' || q.group === 'tip') && th !== 0.3
      ? { ...q, at: [q.at[0], q.at[1] + th - 0.3, q.at[2]] as const }
      : q,
  );
}

/* ───────────── dressed looks (the look editor's appearance) ───────────── */

/**
 * How an owner dressed an agent (@skirm/shared AgentAppearance with its palette colours resolved):
 * hair style and colour, trousers, build and headgear. Outfit and skin are the agent's own body and
 * head colours (LookColours), so they are not here.
 */
export interface Dress {
  hair: 'short' | 'long' | 'bun' | 'buzz' | 'ponytail' | 'none' | (string & {});
  hairColor: string;
  pants: string;
  build: 'slim' | 'regular' | 'sturdy' | (string & {});
  /** `role` keeps the role's own hat and gear; the rest replace it. */
  headgear: 'role' | 'none' | 'cap' | 'bandana' | 'beanie' | (string & {});
}

const BUILD_SCALE: Readonly<Record<string, readonly [number, number]>> = {
  slim: [0.86, 0.94],
  regular: [1, 1],
  sturdy: [1.17, 1.08],
};

/** Hair boxes for a style; `covered` drops what a hat hides (the top and a bun). */
function hairParts(style: string, col: LookFill, covered: boolean): LookPart[] {
  const top = covered ? [] : [p('head', [0, HEAD_TOP - 0.01, -0.01], [0.38, 0.05, 0.38], col)];
  const back = p('head', [0, 0.6, -0.175], [0.38, 0.16, 0.05], col);
  switch (style) {
    case 'buzz':
      return covered ? [] : [p('head', [0, HEAD_TOP - 0.005, 0], [0.37, 0.02, 0.37], col)];
    case 'short':
      return [...top, back];
    case 'long':
      return [
        ...top,
        p('head', [0, 0.44, -0.18], [0.38, 0.34, 0.05], col),
        p('head', [-0.185, 0.48, -0.1], [0.03, 0.26, 0.14], col),
        p('head', [0.185, 0.48, -0.1], [0.03, 0.26, 0.14], col),
      ];
    case 'bun':
      return covered ? [back] : [...top, back, p('head', [0, HEAD_TOP + 0.03, -0.1], [0.15, 0.12, 0.15], col)];
    case 'ponytail':
      return [...top, back, p('head', [0, 0.42, -0.22], [0.09, 0.24, 0.08], col)];
    default:
      return [];
  }
}

/** Headgear boxes in the role's accent colour. */
function headgearParts(kind: string, accent: LookFill): LookPart[] {
  switch (kind) {
    case 'cap':
      return [
        p('head', [0, HEAD_TOP - 0.02, -0.01], [0.39, 0.1, 0.39], accent),
        p('head', [0, HEAD_TOP - 0.015, 0.25], [0.34, 0.025, 0.16], accent),
      ];
    case 'bandana':
      return [
        band('head', 0.68, [0.385, 0.06, 0.385], accent),
        p('head', [0, 0.64, -0.215], [0.08, 0.1, 0.04], accent),
      ];
    case 'beanie':
      return [
        p('head', [0, HEAD_TOP - 0.05, 0], [0.4, 0.14, 0.4], accent),
        p('head', [0, HEAD_TOP + 0.09, 0], [0.1, 0.06, 0.1], '#ece8e1'),
      ];
    default:
      return [];
  }
}

const dressed = new Map<RoleLook, Map<string, RoleLook>>();
/**
 * A role's look dressed the way its owner chose: the build scales the torso, the trousers colour
 * the legs, a crew sash keeps the side readable whatever the outfit, and any headgear but `role`
 * swaps the role's hat (and its antenna) for the chosen one. Tools, packs and visors stay. Cached
 * per look and dress, so renderers can call it every frame.
 */
export function dressLook(look: RoleLook, d: Dress): RoleLook {
  const key = `${d.hair}|${d.hairColor}|${d.pants}|${d.build}|${d.headgear}`;
  let per = dressed.get(look);
  if (!per) dressed.set(look, (per = new Map()));
  const hit = per.get(key);
  if (hit) return hit;
  const [sw, sd] = BUILD_SCALE[d.build] ?? [1, 1];
  const [tw, th, td] = look.torso;
  const torso = [tw * sw, th, td * sd] as const;
  const ownHat = d.headgear === 'role';
  // The role's hat: head parts at or above the forehead, plus antenna tips. Visors sit lower.
  const kept = look.parts.filter((q) => ownHat || !((q.group === 'head' && q.at[1] >= 0.66) || q.group === 'tip'));
  const covered = d.headgear === 'cap' || d.headgear === 'beanie' || ownHat;
  const hair = hairParts(d.hair, d.hairColor as LookFill, covered);
  const out: RoleLook = {
    ...look,
    torso,
    pants: d.pants,
    parts: [
      ...hair,
      band('body', 0.38, [torso[0] + 0.012, 0.045, torso[2] + 0.012], 'team'),
      ...kept,
      ...(ownHat ? [] : headgearParts(d.headgear, look.accent as LookFill)),
    ],
  };
  per.set(key, out);
  return out;
}

/** Height of the figure's highest point (hat, antenna): carried items float just over it. */
export function lookTop(look: RoleLook): number {
  let top = 0;
  for (const q of lookParts(look)) if (q.group !== 'hand') top = Math.max(top, q.at[1] + q.size[1]);
  return top;
}

/* ───────────── poses ───────────── */

/**
 * What an agent is doing, by priority: out (hidden), the match result (victory or defeat, on the
 * debrief), knocked down, stunned, celebrating, using a verb, walking, carrying, idle.
 */
export type PoseKind = 'out' | 'victory' | 'defeat' | 'down' | 'stun' | 'cheer' | 'act' | 'walk' | 'carry' | 'idle';

/**
 * How an agent reacts to the others this frame (render only: read off the frame's events, never fed
 * back to the game). The renderer also turns the agent toward whoever the reaction is about.
 */
export interface Social {
  /** It spoke this tick (hand gestures while it talks). */
  talk?: boolean;
  /** A crewmate's line reached it this tick (it nods). */
  listen?: boolean;
  /** Standing still to decide its next move (a thought bubble; own crew only). */
  think?: boolean;
  /** A crewmate nearby delivered (a fist pump). */
  hype?: boolean;
  /** Heading for an item or the exit (arm points the way). */
  point?: boolean;
  /** A rival is right next to it (squares up). */
  square?: boolean;
  /** Its move was blocked this tick (bumps back). */
  bump?: boolean;
  /** A rival just stole an item near it (shakes its fist). */
  shake?: boolean;
  /** Its bluff was believed (rubs its hands). */
  scheme?: boolean;
  /** It believed a rival's bluff (scratches its head; a "?" over it). */
  fooled?: boolean;
  /** It overheard a rival crew's team talk (hand cupped to its ear). */
  overhear?: boolean;
  /** Lost its turn coughing in gas (bent over, hand to mouth). */
  cough?: boolean;
  /** Slid on ice (arms windmill). */
  slip?: boolean;
  /** A hazard right next to it (leans away, an arm up); `wave`: a wave just came in. */
  flinch?: boolean;
  wave?: boolean;
}

/** The status a renderer knows about an agent this frame. */
export interface PoseInput {
  out?: boolean;
  down?: boolean;
  stun?: boolean;
  /** Delivered this frame. */
  cheer?: boolean;
  /** Used a verb this frame (its effect class, or any truthy tag). */
  act?: string | null;
  /** Items carried. */
  carrying?: number;
  /** Stepping between tiles right now. */
  moving?: boolean;
  /** The match is over: a looping victory or defeat pose (debrief portraits). */
  result?: 'victory' | 'defeat' | null;
}

export function poseKind(a: PoseInput): PoseKind {
  if (a.out) return 'out';
  if (a.result) return a.result;
  if (a.down) return 'down';
  if (a.stun) return 'stun';
  if (a.cheer) return 'cheer';
  if (a.act) return 'act';
  if (a.moving) return 'walk';
  if ((a.carrying ?? 0) > 0) return 'carry';
  return 'idle';
}

export interface Pose {
  kind: PoseKind;
  /** Whole figure raised (hops, bob). */
  lift: number;
  /** Sideways tip in radians (knocked down, stun wobble); positive falls to its right. */
  tilt: number;
  /** Forward lean in radians (walking, running). */
  lean: number;
  /** Offset per group [dx, dy, dz] in figure space. */
  off: Partial<Record<LookGroup, readonly [number, number, number]>>;
  /** Scale of the 'tip' group (the scout beacon pulse). */
  tipScale: number;
  /** 0–1 strength of the verb effect this moment (dust, spray, ring), 0 when none. */
  fx: number;
}

/** Seconds a fall, a celebration and a verb play from the frame's arrival. */
export const FALL_S = 0.35;
export const CHEER_S = 1.1;

const clamp01 = (t: number) => Math.max(0, Math.min(1, t));

/**
 * The pose at `time` (looping motion, seconds) and `age` (seconds since this frame arrived, for
 * one-shots). `walk` is the move's progress 0–1. With `still` (reduced motion) every pose is a
 * fixed, readable frame: no bob, no wobble, no hops.
 */
export function poseAt(
  kind: PoseKind,
  look: RoleLook,
  o: { time: number; age: number; walk?: number; still?: boolean; seed?: number; social?: Social | null },
): Pose {
  const base = basePose(kind, look, o);
  return o.social && SOCIAL_KINDS.has(base.kind) ? withSocial(base, look, o.social, o) : base;
}

/** Poses a reaction may play over: the agent is up and not busy with a verb, a fall or a celebration. */
const SOCIAL_KINDS = new Set<PoseKind>(['idle', 'carry', 'walk']);
/** Seconds a one-shot reaction (fist pump, bump, shake) plays from the frame's arrival. */
const REACT_S = 1.2;

/** A reaction over the base pose; legs keep walking, the upper body reacts. */
function withSocial(pose: Pose, look: RoleLook, s: Social, o: { time: number; age: number; still?: boolean; seed?: number }): Pose {
  const still = !!o.still;
  const t = still ? 0 : o.time + (o.seed ?? 0);
  const k = clamp01(o.age / REACT_S);
  const live = still || k < 1;
  const off = { ...pose.off };
  if (s.cough && live) {
    // Bent over coughing, hand to mouth, a jerk on each cough.
    const jerk = still ? 0 : Math.max(0, Math.sin(t * 14)) * 0.03;
    off.hand = [0, 0.22, 0.1];
    off.head = [0, -jerk, 0.03];
    return { ...pose, off, lean: pose.lean + 0.28 + jerk };
  }
  if (s.slip && live) {
    // Arms windmill to keep its balance.
    const a = still ? 0.6 : t * 16;
    off.hand = [Math.cos(a) * 0.08, 0.16 + Math.sin(a) * 0.1, 0.04];
    return { ...pose, off, tilt: still ? 0.08 : Math.sin(t * 9) * 0.12 };
  }
  if (s.scheme) {
    // Rubs its hands: the hand jitters side to side in front of it.
    off.hand = [still ? 0 : Math.sin(t * 18) * 0.025, 0.1, 0.1];
    return { ...pose, off, lean: pose.lean + 0.08 };
  }
  if (s.fooled) {
    // Scratches its head, head tipped.
    off.hand = [0, 0.3 + (still ? 0 : Math.abs(Math.sin(t * 10)) * 0.02), 0.02];
    return { ...pose, off, tilt: 0.1 };
  }
  if (s.hype && live) {
    // Fist pump: the hand shoots up twice, a small hop.
    const pump = still ? 1 : Math.abs(Math.sin(k * Math.PI * 3));
    off.hand = [0, 0.18 + pump * 0.16, 0.02];
    return { ...pose, off, lift: pose.lift + (still ? 0 : pump * 0.06 * (1 - k)) };
  }
  if (s.bump && live) {
    // Walked into something: rocks back, then settles.
    return { ...pose, off, lean: pose.lean - (still ? 0.12 : 0.22 * Math.sin(Math.min(1, k * 2) * Math.PI)) };
  }
  if (s.shake && live) {
    off.hand = [0, 0.2, 0.06 + (still ? 0 : Math.sin(t * 22) * 0.03)];
    return { ...pose, off, lean: pose.lean + 0.06 };
  }
  if (s.talk) {
    // Talking with its hands, a little bob of the head on the beats.
    off.hand = [0, 0.08 + (still ? 0.03 : Math.abs(Math.sin(t * 6)) * 0.07), 0.08];
    off.head = [0, still ? 0 : Math.max(0, Math.sin(t * 9)) * 0.012, 0.01];
    return { ...pose, off };
  }
  if (s.overhear) {
    // Hand cupped to its ear, head turned toward the voice.
    off.hand = [0, 0.26, -0.02];
    off.head = [0.03, 0, 0];
    return { ...pose, off, tilt: -0.05 };
  }
  if (s.listen) {
    // Nods along.
    off.head = [0, still ? -0.01 : -Math.max(0, Math.sin(t * 4.5)) * 0.022, 0.015];
    return { ...pose, off };
  }
  if (s.square) {
    // Squares up to the rival: leans in, hands up, a slow sway.
    off.hand = [0, 0.12, 0.08];
    return { ...pose, off, lean: pose.lean + 0.12, tilt: still ? 0 : Math.sin(t * 2.2) * 0.03 };
  }
  if (s.flinch) {
    // Leans away from the hazard next to it, an arm up; harder when a wave just came in.
    const k2 = s.wave && live && !still ? 1 - k : 0;
    off.hand = [0, 0.14 + k2 * 0.08, 0.1];
    return { ...pose, off, lean: pose.lean - 0.12 - k2 * 0.16 };
  }
  if (s.point) {
    // Points the way it is heading.
    off.hand = [0, 0.16, 0.16];
    return { ...pose, off };
  }
  if (s.think && pose.kind !== 'walk') {
    // Hand to the chin while it thinks.
    off.hand = [0, 0.24, 0.07];
    off.head = [0, still ? 0 : Math.sin(t * 1.3) * 0.006, 0];
    return { ...pose, off, lean: pose.lean + 0.04 };
  }
  void look;
  return pose;
}

/**
 * Idle habits by role, so a crew waiting reads as characters: the dasher bounces on its toes, the
 * digger leans on its shovel, the builder taps a block, the scout and the others look around now
 * and then. Small and slow; reduced motion keeps the plain stance.
 */
function idleHabit(pose: Pose, look: RoleLook, t: number, seed: number): Pose {
  const cycle = (t + seed * 1.7) % 6;
  const glance = cycle > 4.2 ? Math.sin(((cycle - 4.2) / 1.8) * Math.PI) : 0;
  switch (look.verb) {
    case 'dash':
      pose.lift = Math.abs(Math.sin(t * 5 + seed)) * 0.03;
      pose.off.footL = [0, pose.lift * 0.5, 0];
      pose.off.footR = [0, pose.lift * 0.5, 0];
      break;
    case 'dig':
      pose.lean = 0.08;
      pose.off.hand = [0, 0.02, 0.1];
      pose.lift = Math.sin(t * 1.6 + seed) * 0.006;
      break;
    case 'build':
    case 'wrench': {
      const tap = cycle < 1.2 ? Math.abs(Math.sin(cycle * Math.PI * 2.5)) : 0;
      pose.off.hand = [0, 0.04 + tap * 0.06, 0.08];
      pose.lean = 0.05 * tap;
      break;
    }
    default:
      pose.lift = Math.sin(t * 3 + seed) * 0.015;
  }
  if (glance) pose.off.head = [glance * 0.035, 0, 0];
  return pose;
}

function basePose(
  kind: PoseKind,
  look: RoleLook,
  o: { time: number; age: number; walk?: number; still?: boolean; seed?: number },
): Pose {
  const pose: Pose = { kind, lift: 0, tilt: 0, lean: 0, off: {}, tipScale: 1, fx: 0 };
  const still = !!o.still;
  const t = still ? 0 : o.time;
  const seed = o.seed ?? 0;
  const stride = look.stride ?? 1;
  switch (kind) {
    case 'out':
      return pose;
    case 'victory': {
      // Arms up, a hop every beat, the celebration's stars throughout.
      const ph = (t * 1.4 + seed * 0.37) % 1;
      pose.lift = still ? 0 : Math.max(0, Math.sin(ph * Math.PI * 2)) * 0.16;
      pose.off.hand = [0, 0.34, 0.02];
      pose.off.head = [0, still ? 0.01 : Math.max(0, Math.sin(ph * Math.PI * 2)) * 0.02, 0];
      pose.fx = 1;
      return pose;
    }
    case 'defeat':
      // Slumped: leaning forward, head down, hands low, a slow sway.
      pose.lean = 0.28;
      pose.off.head = [0, -0.035, 0.03];
      pose.off.hand = [0, -0.04, -0.02];
      pose.tilt = still ? 0 : Math.sin(t * 1.2 + seed) * 0.03;
      pose.fx = 1;
      return pose;
    case 'down':
      pose.tilt = 1.35 * (still ? 1 : 1 - Math.pow(1 - clamp01(o.age / FALL_S), 3));
      return pose;
    case 'stun':
      pose.tilt = still ? 0.1 : Math.sin(t * 7 + seed) * 0.14;
      pose.off.head = still ? [0, 0, 0] : [Math.sin(t * 7 + seed) * 0.02, 0, 0];
      pose.fx = 1;
      return pose;
    case 'cheer': {
      const k = clamp01(o.age / CHEER_S);
      const on = still || k < 1;
      pose.lift = still
        ? 0
        : Math.abs(Math.sin(k * Math.PI * 2)) * 0.22 * (1 - k * 0.3) * (k < 1 ? 1 : 0);
      pose.off.hand = on ? [0, 0.32, 0.02] : [0, 0, 0];
      pose.fx = on ? (still ? 1 : 1 - k) : 0;
      if (!on) pose.kind = 'idle';
      return pose;
    }
    case 'act': {
      const ph = t * 8 + seed;
      pose.fx = still ? 1 : 0.6 + 0.4 * Math.abs(Math.sin(ph));
      switch (look.verb) {
        case 'dig':
        case 'build':
        case 'wrench':
          pose.off.hand = still ? [0, 0.12, 0.06] : [0, Math.abs(Math.sin(ph)) * 0.16, 0.06];
          pose.lean = 0.12;
          break;
        case 'spray':
          pose.off.hand = [0, 0.08, 0.1];
          pose.lean = 0.06;
          break;
        case 'pulse':
          pose.tipScale = still ? 1.4 : 1 + 0.6 * Math.abs(Math.sin(ph * 0.75));
          pose.off.head = [0, still ? 0.02 : Math.abs(Math.sin(ph * 0.5)) * 0.03, 0];
          break;
        case 'heal':
        case 'spark':
          pose.off.hand = [0, 0.16, 0.12];
          break;
        default:
          pose.off.hand = [0, 0.18, 0.04];
      }
      return pose;
    }
    case 'walk': {
      const ph = (o.walk ?? 0) * Math.PI * 2 * stride + seed;
      const sw = still ? 0 : Math.sin(ph);
      pose.off.footL = [0, Math.max(0, sw) * 0.05, sw * 0.09 * stride];
      pose.off.footR = [0, Math.max(0, -sw) * 0.05, -sw * 0.09 * stride];
      pose.off.hand = [0, 0, -sw * 0.06];
      pose.lean = 0.1 * stride;
      pose.lift = still ? 0 : Math.abs(sw) * 0.02;
      return pose;
    }
    case 'carry':
      pose.off.hand = [0, 0.1, 0.04];
      pose.lift = still ? 0 : Math.sin(t * 3 + seed) * 0.012;
      return pose;
    default:
      return still ? pose : idleHabit(pose, look, t, seed);
  }
}

/* ───────────── isometric projection (2D canvas and SVG) ───────────── */

/** The agent's own colours. */
export interface LookColours {
  body: string;
  head: string;
  team?: string;
}

/** One filled polygon of a figure, in tile units (multiply by the tile size T). */
export interface IsoPoly {
  pts: number[];
  fill: string;
}

/** Height on screen of one unit up, in tile widths (the arena's block agents use this). */
export const ISO_V = 0.8;

const hexRgb = (h: string): [number, number, number] => {
  const s = h.length === 4 ? h.replace(/^#(.)(.)(.)$/, '#$1$1$2$2$3$3') : h;
  return [
    parseInt(s.slice(1, 3), 16) || 0,
    parseInt(s.slice(3, 5), 16) || 0,
    parseInt(s.slice(5, 7), 16) || 0,
  ];
};
const SHADE: Record<string, string> = {};
/** A hex colour toward black (f < 0) or white (f > 0), as an rgb() string (memoised). */
export function shadeHex(h: string, f: number): string {
  const k = h + f;
  const hit = SHADE[k];
  if (hit) return hit;
  const [r, g, b] = hexRgb(h);
  const t = f < 0 ? 0 : 255;
  const q = Math.abs(f);
  return (SHADE[k] =
    `rgb(${Math.round(r + (t - r) * q)},${Math.round(g + (t - g) * q)},${Math.round(b + (t - b) * q)})`);
}

export function hslHex(h: number, s: number, l: number): string {
  const f = (n: number) => {
    const k = (n + h * 12) % 12;
    const a = s * Math.min(l, 1 - l);
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))))
      .toString(16)
      .padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

/** A part's colour for these agent colours. */
export function fillOf(f: LookFill, c: LookColours): string {
  switch (f) {
    case 'body':
      return c.body;
    case 'head':
      return c.head;
    case 'boot':
      return '#1c2530';
    case 'visor':
      return '#0b1118';
    case 'team':
      return c.team ?? c.body;
    default:
      return f;
  }
}

/**
 * The figure as isometric polygons around its feet (0, 0), y down, in tile units: top, left (+y
 * tile side) and right (+x tile side) faces, back to front. `dir` 1 faces down-right (+x tile, crew
 * A), -1 down-left (+y tile, crew B). Group offsets from the pose apply; tilt is the caller's
 * (rotate the canvas around the feet).
 */
export function isoPolys(
  look: RoleLook,
  c: LookColours,
  dir: 1 | -1,
  pose?: Pose | null,
  parts: readonly LookPart[] = lookParts(look),
): IsoPoly[] {
  const boxes: (IsoBox & { fill: string; band: boolean })[] = [];
  const lean = pose?.lean ?? 0;
  for (const q of parts) {
    const o = pose?.off[q.group];
    let [x, y, z] = q.at;
    let [w, h, d] = q.size;
    if (o) {
      x += o[0];
      y += o[1];
      z += o[2];
    }
    if (q.group === 'tip' && pose && pose.tipScale !== 1) {
      const s = pose.tipScale;
      y -= (h * (s - 1)) / 2;
      w *= s;
      h *= s;
      d *= s;
    }
    // Leaning forward shifts higher parts toward the front.
    if (lean && q.group !== 'footL' && q.group !== 'footR') z += Math.sin(lean) * (y + h / 2) * 0.6;
    // Local → tile axes: dir 1 puts forward (+z) on +x tile, dir -1 on +y tile; either way the
    // right hand (+x) is on the viewer's side so held tools show.
    const tx = dir === 1 ? z : x;
    const ty = dir === 1 ? x : z;
    const hx = (dir === 1 ? d : w) / 2;
    const hy = (dir === 1 ? w : d) / 2;
    boxes.push({
      tx,
      ty,
      hx,
      hy,
      y0: y,
      h,
      fill: fillOf(q.fill, c),
      band: !!q.band,
      key: tx + ty + y * 0.02,
    });
  }
  const out: IsoPoly[] = [];
  const X = (tx: number, ty: number) => (tx - ty) / 2;
  const Y = (tx: number, ty: number, y: number) => (tx + ty) / 4 - y * ISO_V;
  for (const b of paintOrder(boxes)) {
    const { tx, ty, hx, hy } = b;
    const top = b.y0 + b.h;
    const bot = b.y0;
    // +y tile face (screen left/front).
    out.push({
      pts: [
        X(tx - hx, ty + hy),
        Y(tx - hx, ty + hy, top),
        X(tx + hx, ty + hy),
        Y(tx + hx, ty + hy, top),
        X(tx + hx, ty + hy),
        Y(tx + hx, ty + hy, bot),
        X(tx - hx, ty + hy),
        Y(tx - hx, ty + hy, bot),
      ],
      fill: shadeHex(b.fill, -0.3),
    });
    // +x tile face (screen right/front).
    out.push({
      pts: [
        X(tx + hx, ty - hy),
        Y(tx + hx, ty - hy, top),
        X(tx + hx, ty + hy),
        Y(tx + hx, ty + hy, top),
        X(tx + hx, ty + hy),
        Y(tx + hx, ty + hy, bot),
        X(tx + hx, ty - hy),
        Y(tx + hx, ty - hy, bot),
      ],
      fill: shadeHex(b.fill, -0.5),
    });
    if (!b.band)
      out.push({
        pts: [
          X(tx - hx, ty - hy),
          Y(tx - hx, ty - hy, top),
          X(tx + hx, ty - hy),
          Y(tx + hx, ty - hy, top),
          X(tx + hx, ty + hy),
          Y(tx + hx, ty + hy, top),
          X(tx - hx, ty + hy),
          Y(tx - hx, ty + hy, top),
        ],
        fill: b.fill.startsWith('#') ? shadeHex(b.fill, 0) : b.fill,
      });
  }
  return out;
}

interface IsoBox {
  tx: number;
  ty: number;
  hx: number;
  hy: number;
  y0: number;
  h: number;
  key: number;
}

/** Overlap allowed before two boxes count as intersecting (parts sit a hair into each other). */
const EPS = 0.025;

/**
 * Whether box a must be painted before b, seen from +x +y and above: a is below b, or behind it
 * along x or y. Boxes that intersect (a belt round a torso, a visor on a head) paint the one that
 * reaches further toward the viewer last.
 */
export function paintsBefore(a: IsoBox, b: IsoBox): boolean {
  if (a.y0 + a.h <= b.y0 + EPS) return true;
  if (b.y0 + b.h <= a.y0 + EPS) return false;
  if (a.tx + a.hx <= b.tx - b.hx + EPS) return true;
  if (b.tx + b.hx <= a.tx - a.hx + EPS) return false;
  if (a.ty + a.hy <= b.ty - b.hy + EPS) return true;
  if (b.ty + b.hy <= a.ty - a.hy + EPS) return false;
  const fa = Math.max(a.tx + a.hx - (b.tx + b.hx), a.ty + a.hy - (b.ty + b.hy));
  const fb = Math.max(b.tx + b.hx - (a.tx + a.hx), b.ty + b.hy - (a.ty + a.hy));
  return fa !== fb ? fa < fb : a.key < b.key;
}

/** Back-to-front order for a figure's boxes (a small topological sort; ties by depth key). */
function paintOrder<B extends IsoBox>(boxes: B[]): B[] {
  const n = boxes.length;
  const before: number[] = new Array(n).fill(0);
  const after: number[][] = boxes.map(() => []);
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) {
      if (paintsBefore(boxes[i]!, boxes[j]!)) {
        after[i]!.push(j);
        before[j]!++;
      } else {
        after[j]!.push(i);
        before[i]!++;
      }
    }
  const out: B[] = [];
  const done = new Array<boolean>(n).fill(false);
  for (let k = 0; k < n; k++) {
    // The free box furthest back; on a cycle (rare: intersecting parts), the furthest back of the rest.
    let pick = -1;
    for (let i = 0; i < n; i++)
      if (!done[i] && before[i] === 0 && (pick < 0 || boxes[i]!.key < boxes[pick]!.key)) pick = i;
    if (pick < 0)
      for (let i = 0; i < n; i++)
        if (!done[i] && (pick < 0 || boxes[i]!.key < boxes[pick]!.key)) pick = i;
    done[pick] = true;
    out.push(boxes[pick]!);
    for (const j of after[pick]!) before[j]!--;
  }
  return out;
}

/** Bounds of polygons: [minX, minY, maxX, maxY]. */
export function polyBounds(polys: readonly IsoPoly[]): [number, number, number, number] {
  let a = Infinity;
  let b = Infinity;
  let c = -Infinity;
  let d = -Infinity;
  for (const q of polys)
    for (let i = 0; i < q.pts.length; i += 2) {
      a = Math.min(a, q.pts[i]!);
      c = Math.max(c, q.pts[i]!);
      b = Math.min(b, q.pts[i + 1]!);
      d = Math.max(d, q.pts[i + 1]!);
    }
  return [a, b, c, d];
}
