// The 3D chase cam itself (the prototype's build3D, refresh3D and frame3D), on the pinned `three`
// npm package. Only ./index loads this module, with a dynamic import, so `three` ships in its own
// chunk. The world is built from the arena once per map (floor, walls, valves, scenery hills,
// weather), the tiles that change are re-laid when a new frame arrives, and every animation frame
// eases the agents, the fog light and the camera.
import * as THREE from 'three';
import { fillOf, lookFor, lookParts, lookTop, poseAt, poseKind, type LookGroup, type RoleLook } from '@skirm/ui';
import * as proto from '../proto/world';
import { TOOL_INFO } from '../gear';
import type { LiveArena } from '../live';
import { MAPS, ROTATION_INDEX, mapById, type Arena, type ArenaState } from '../world';
import type { ChaseCamOptions, ChaseCamState } from './index';
import {
  DIST_START,
  HEADING_STEPS,
  angDiff,
  approach,
  chaseRig,
  ease,
  headingYaw,
  segDist,
  softFog,
  stepAgentFade,
  stepSoftFog,
  wallBlocks,
  wheelDist,
  type SoftFog,
} from './math';

/** A map's sky, surrounding land, walls and weather (the prototype's THEME). */
interface Theme {
  sky: [string, string];
  low: string;
  lowKind: string;
  hill: string;
  weather: string;
  wall: { style: string; base: string; top: string };
}

/** The colours the 2D renderer derives per map (the prototype's palOf). */
interface Palette {
  floor: string;
  floor2: string;
  mid: string;
  accent: string;
  grass: string;
  tree: string;
  dirt: string;
  crate: string;
}

// The prototype rendered with three r128, which had no colour management: hex colours were used as
// they are and written out linear. Turn the conversion off before any colour is made so the scene
// keeps its look (this module is the only `three` user in the app).
THREE.ColorManagement.enabled = false;

const THEMES = proto.THEME as unknown as Readonly<Record<string, Theme>>;
const FALLBACK_THEME: Theme = { sky: ['#14202c', '#05080d'], low: '#111821', lowKind: 'void', hill: '#2a3440', weather: '', wall: { style: '', base: '#4a5262', top: '#7a8494' } };
/** Shipping container colours for the harbor's walls (the prototype's CONTAINER). */
const CONTAINER = ['#b5452f', '#2f6fb5', '#d08a2a', '#3b8a5a', '#8a3b6b'];
const hash = proto.hash as (x: number, y: number) => number;

/** Tiles a valve switch opens or closes (the prototype's laneSetOf); arenas without lanes have none. */
function laneSetOf(A: Arena): Set<number> {
  const out = new Set<number>();
  for (const v of A.valves as { lanes?: { A?: number[]; B?: number[] } }[]) for (const i of [...(v.lanes?.A ?? []), ...(v.lanes?.B ?? [])]) out.add(i);
  return out;
}

/** Weather particle colour, fall speed (up is negative) and sideways drift. */
const WEATHER: Readonly<Record<string, { color: string; fall: number; drift: number; size: number }>> = {
  snow: { color: '#ffffff', fall: 0.9, drift: 0.25, size: 0.09 },
  rain: { color: '#a9c4e0', fall: 9, drift: 0.25, size: 0.05 },
  storm: { color: '#a9c4e0', fall: 11, drift: 0.25, size: 0.05 },
  ember: { color: '#ff9a40', fall: -0.7, drift: 0.25, size: 0.09 },
  ash: { color: '#b8aeb8', fall: 0.6, drift: 0.25, size: 0.09 },
  dust: { color: '#e6c896', fall: 0.1, drift: 2.5, size: 0.09 },
  drip: { color: '#8cc8e6', fall: 5, drift: 0.25, size: 0.09 },
  pollen: { color: '#ec72d0', fall: -0.15, drift: 0.25, size: 0.09 },
  mist: { color: '#cfe4e8', fall: 0, drift: 0.3, size: 0.09 },
};

const TEAM_RING = { A: '#34e0c8', B: '#ff4655' } as const;
const BODY = { A: ['#34e0c8', '#ffb547', '#8fa8ff'], B: ['#ff4655', '#ff8db0', '#ff7a45'] } as const;
const AMBER = new THREE.Color('#ffb547');
/** The prototype was lit by three r128's legacy light units; modern three needs them times π. */
const LEGACY = Math.PI;
/** How long a move eases, as the 2D arena does. */
const TWEEN_MS = 400;

/** An agent as the arena draws it; live arenas also carry body colours and status. */
type Agent3 = ArenaState['agents'][number] & { c?: string; bone?: string };

type DynKey = 'dirt' | 'crate' | 'block' | 'grass' | 'trunk' | 'canopy' | 'water' | 'lava' | 'fire' | 'flame' | 'item' | 'ice' | 'gas' | 'shock' | 'sandbag' | 'bridge' | 'pump' | 'tool';

interface AgentRig {
  g: THREE.Group;
  body: THREE.Group;
  /** The role's look the figure was built from. */
  look: RoleLook;
  /** Pose groups inside `body` (feet, torso, head, held tool, antenna tip). */
  parts: Record<LookGroup, THREE.Group>;
  inv: THREE.Mesh[];
  /** Carried count over the items (roles that show it: Haulers). */
  count: THREE.Sprite | null;
  shown: number;
  /** Verb, stun and celebration effects (hidden when idle). */
  fx: { ring: THREE.Mesh; bits: THREE.Mesh[]; bitMat: THREE.MeshBasicMaterial; ringMat: THREE.MeshBasicMaterial };
  mats: THREE.Material[];
  /** Heading the agent faces (radians around y, 0 = +z). */
  face: number;
}

/** One wall tile: position, standing height, and whether it is cut away right now. */
interface WallSlot {
  x: number;
  y: number;
  h: number;
  cut: boolean;
}

interface World {
  key: string;
  W: number;
  H: number;
  cx0: number;
  pal: Palette;
  lanes: Set<number>;
  scene: THREE.Scene;
  sun: THREE.DirectionalLight;
  floor: THREE.InstancedMesh;
  walls: THREE.InstancedMesh;
  caps: THREE.InstancedMesh;
  wl: WallSlot[];
  /** Unlit wall and floor colours, for the fog light to scale. */
  wbase: Float32Array;
  fbase: Float32Array;
  dyn: Record<DynKey, THREE.InstancedMesh>;
  beam: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  ring: THREE.Mesh;
  wheels: THREE.Mesh[];
  agents: Map<string, AgentRig>;
  parts: THREE.Points | null;
  weather: string;
  /** Tiles drawn per frame: fires flicker, items spin. */
  fires: [number, number][];
  items: [number, number, boolean][];
  /** The board the tiles were last laid from. */
  snap: ArenaState | null;
  /** Fog light was applied last frame (so lifting the fog restores full light once). */
  lit: boolean;
  fog: SoftFog | null;
  fade: Record<string, number>;
}

/** The camera's own state, kept across map rebuilds. */
interface Rig {
  yaw: number | null;
  tyaw: number;
  look: number;
  dist: number;
  pos: THREE.Vector3 | null;
  focusAt: { x: number; z: number } | null;
  target: string | null;
  steps: [number, number][];
}

const tmp = new THREE.Object3D();
const col = new THREE.Color();

function place(im: THREE.InstancedMesh, i: number, x: number, y: number, z: number, sx: number, sy: number, sz: number, ry = 0) {
  tmp.position.set(x, y, z);
  tmp.scale.set(sx, sy, sz);
  tmp.rotation.set(0, ry, 0);
  tmp.updateMatrix();
  im.setMatrixAt(i, tmp.matrix);
}

function lambert(o: THREE.MeshLambertMaterialParameters = {}) {
  return new THREE.MeshLambertMaterial(o);
}

/** A name tag over an agent: the team colour edge and the name, on a canvas texture. */
function nameSprite(text: string, colour: string): THREE.Sprite | null {
  const cv = document.createElement('canvas');
  cv.width = 256;
  cv.height = 64;
  let g: CanvasRenderingContext2D | null = null;
  try {
    g = cv.getContext('2d');
  } catch {
    g = null;
  }
  if (!g) return null;
  const font = getComputedStyle(document.documentElement).getPropertyValue('--font-sans').trim() || 'Barlow, sans-serif';
  g.fillStyle = 'rgba(5,8,13,.85)';
  g.fillRect(28, 10, 200, 44);
  g.fillStyle = colour;
  g.fillRect(28, 10, 6, 44);
  g.fillStyle = '#ece8e1';
  g.font = `600 30px ${font}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 131, 33);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), transparent: true, depthWrite: false }));
  sp.scale.set(1.3, 0.325, 1);
  return sp;
}

function paletteOf(look: string) {
  const m = mapById(look) ?? MAPS[ROTATION_INDEX] ?? MAPS[0]!;
  return { theme: THEMES[m.id] ?? FALLBACK_THEME, pal: (m as unknown as { pal2: Palette }).pal2 };
}

/** The static world for one arena: everything that does not change during a match. */
export function buildWorld(arena: LiveArena, look: string): World {
  const A = arena.A;
  const W = A.w;
  const H = A.h;
  const { theme: th, pal } = paletteOf(look);
  const night = !!A.night;
  const scene = new THREE.Scene();
  const skyTop = new THREE.Color(th.sky[0]);
  const fogC = new THREE.Color(th.sky[0]).lerp(new THREE.Color(th.sky[1]), 0.35);
  scene.background = fogC;
  scene.fog = new THREE.Fog(fogC, night ? 6 : 10, night ? 22 : 32);
  scene.add(new THREE.HemisphereLight(skyTop.clone().lerp(new THREE.Color('#ffffff'), 0.6), new THREE.Color(th.low), (night ? 0.8 : 1.1) * LEGACY));
  scene.add(new THREE.AmbientLight(0xffffff, (night ? 0.18 : 0.25) * LEGACY));
  const sun = new THREE.DirectionalLight(th.lowKind === 'lava' || th.weather === 'ember' ? 0xffc89a : 0xfff4e6, (night ? 0.6 : 1) * LEGACY);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -15, right: 15, top: 15, bottom: -15, near: 1, far: 70 });
  sun.shadow.bias = -0.0012;
  scene.add(sun, sun.target);

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(W + 120, H + 120), lambert({ color: th.lowKind === 'lava' ? '#3a120a' : th.low }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.set((W - 1) / 2, -0.32, (H - 1) / 2);
  ground.receiveShadow = true;
  scene.add(ground);

  const box = new THREE.BoxGeometry(1, 1, 1);
  box.translate(0, 0.5, 0);
  const inst = (geo: THREE.BufferGeometry, mat: THREE.Material, n: number, shadow = true) => {
    const im = new THREE.InstancedMesh(geo, mat, Math.max(1, n));
    im.castShadow = shadow;
    im.receiveShadow = true;
    im.count = 0;
    im.frustumCulled = false;
    scene.add(im);
    return im;
  };

  // The floor, one slab per tile.
  const floor = inst(box, lambert(), W * H, false);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) place(floor, y * W + x, x, -0.16, y, 1, 0.16, 1);
  floor.count = W * H;

  // Walls and valves never change during a match.
  const wallAt: number[] = [];
  A.grid.forEach((t, i) => {
    if (t === 'wall') wallAt.push(i);
  });
  const nw = wallAt.length;
  const walls = inst(box, lambert(), nw);
  const caps = inst(box, lambert({ color: th.wall.top }), nw, false);
  const wl: WallSlot[] = [];
  const wbase = new Float32Array(Math.max(1, nw) * 3);
  wallAt.forEach((i, k) => {
    const x = i % W;
    const y = Math.floor(i / W);
    const h = 0.8 + hash(x, y) * 0.4;
    wl.push({ x, y, h, cut: false });
    place(walls, k, x, 0, y, 1, h, 1);
    place(caps, k, x, h, y, 1.02, 0.07, 1.02);
    col.set(th.wall.style === 'container' ? CONTAINER[Math.floor(hash(x, y) * CONTAINER.length)]! : th.wall.base).multiplyScalar(0.9 + hash(y, x) * 0.2);
    walls.setColorAt(k, col);
    wbase[k * 3] = col.r;
    wbase[k * 3 + 1] = col.g;
    wbase[k * 3 + 2] = col.b;
    caps.setColorAt(k, col.setRGB(1, 1, 1));
  });
  walls.count = caps.count = nw;

  const wheels: THREE.Mesh[] = [];
  const valveBody = lambert({ color: '#3a3f48' });
  const wheelGeo = new THREE.TorusGeometry(0.24, 0.04, 8, 20);
  const wheelMat = new THREE.MeshBasicMaterial({ color: '#ffb547' });
  for (const v of A.valves) {
    const b = new THREE.Mesh(box, valveBody);
    b.scale.set(0.7, 0.6, 0.7);
    b.position.set(v.pos[0], 0, v.pos[1]);
    b.castShadow = true;
    const w = new THREE.Mesh(wheelGeo, wheelMat);
    w.position.set(v.pos[0], 0.72, v.pos[1]);
    w.rotation.x = -Math.PI / 2;
    scene.add(b, w);
    wheels.push(w);
  }

  // Tiles that change: rubble, crates, blocks, grass, trees, hazards, items.
  const cap = W * H;
  const dyn: Record<DynKey, THREE.InstancedMesh> = {
    dirt: inst(box, lambert({ color: pal.dirt }), cap),
    crate: inst(box, lambert({ color: pal.crate }), cap),
    block: inst(box, lambert({ color: '#3b8f88', emissive: '#0d3a35' }), cap),
    grass: inst(box, lambert({ color: pal.grass }), cap, false),
    trunk: inst(new THREE.CylinderGeometry(0.07, 0.1, 0.5, 6).translate(0, 0.25, 0), lambert({ color: '#4a3626' }), cap),
    canopy: inst(new THREE.IcosahedronGeometry(0.42, 0), lambert({ color: pal.tree }), cap),
    water: inst(box, new THREE.MeshPhongMaterial({ color: '#2f78d0', emissive: '#0a2a55', transparent: true, opacity: 0.86, shininess: 90 }), cap, false),
    lava: inst(box, new THREE.MeshBasicMaterial({ color: '#ff5a1f' }), cap, false),
    fire: inst(box, lambert({ color: '#3a1a10', emissive: '#501400' }), cap, false),
    flame: inst(new THREE.ConeGeometry(0.15, 0.5, 6).translate(0, 0.25, 0), new THREE.MeshBasicMaterial({ color: '#ff8a3a' }), cap * 2, false),
    item: inst(new THREE.OctahedronGeometry(0.17), new THREE.MeshBasicMaterial({ color: pal.accent }), cap, true),
    ice: inst(box, new THREE.MeshPhongMaterial({ color: '#cdeefa', emissive: '#2a4a5a', shininess: 120, transparent: true, opacity: 0.92 }), cap, false),
    gas: inst(new THREE.IcosahedronGeometry(0.4, 1), new THREE.MeshLambertMaterial({ color: '#8fd65e', emissive: '#2c5a14', transparent: true, opacity: 0.38, depthWrite: false }), cap, false),
    shock: inst(box, new THREE.MeshBasicMaterial({ color: '#ffe94a', transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending }), cap, false),
    // Supply tools (../gear): placed sandbags, bridges and pumps, and tools waiting on the ground.
    sandbag: inst(new THREE.CapsuleGeometry(0.14, 0.5, 4, 8).rotateZ(Math.PI / 2), lambert({ color: TOOL_INFO.sandbag.colour }), cap * 2),
    bridge: inst(box, lambert({ color: TOOL_INFO.bridge.colour }), cap * 3),
    pump: inst(new THREE.CylinderGeometry(0.16, 0.2, 0.45, 10).translate(0, 0.225, 0), lambert({ color: '#2a4a5c', emissive: TOOL_INFO.pump.colour, emissiveIntensity: 0.35 }), cap),
    tool: inst(box, new THREE.MeshBasicMaterial({ color: '#ffd27a' }), cap, true),
  };

  // The delivery point: a turning ring and a soft beam.
  const ex = new THREE.Group();
  ex.position.set(A.exit[0], 0, A.exit[1]);
  scene.add(ex);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.035, 8, 32), new THREE.MeshBasicMaterial({ color: '#a98bff' }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.03;
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(0.3, 0.3, 4, 20, 1, true),
    new THREE.MeshBasicMaterial({ color: '#a98bff', transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }),
  );
  beam.position.y = 2;
  ex.add(ring, beam);

  // Hills around the arena, taller the farther out.
  const hills: [number, number, number][] = [];
  for (let y = -10; y < H + 10; y++)
    for (let x = -10; x < W + 10; x++) {
      if (x > -2 && x < W + 1 && y > -2 && y < H + 1) continue;
      const r = hash(x + 101, y + 57);
      if (r >= 0.45) hills.push([x, y, r]);
    }
  const hm = inst(box, lambert(), hills.length);
  hills.forEach(([x, y, r], i) => {
    const far = Math.max(x < 0 ? -x : x - W, y < 0 ? -y : y - H, 0);
    place(hm, i, x, -0.3, y, 1, 0.3 + r * 1.2 + Math.min(2.5, far * 0.18), 1);
    hm.setColorAt(i, col.set(th.hill).multiplyScalar(0.55 + hash(y, x) * 0.4));
  });
  hm.count = hills.length;

  // Weather particles in a 30×12×30 box that follows the camera.
  const wk = th.weather;
  const wx = WEATHER[wk];
  let parts: THREE.Points | null = null;
  if (wx) {
    const NP = 500;
    const pp = new Float32Array(NP * 3);
    for (let i = 0; i < NP; i++) {
      pp[i * 3] = (hash(i, 1) - 0.5) * 30;
      pp[i * 3 + 1] = hash(1, i) * 12;
      pp[i * 3 + 2] = (hash(i, 9) - 0.5) * 30;
    }
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(pp, 3));
    parts = new THREE.Points(pg, new THREE.PointsMaterial({ color: wx.color, size: wx.size, transparent: true, opacity: 0.75, depthWrite: false }));
    parts.frustumCulled = false;
    scene.add(parts);
  }

  return {
    key: worldKey(arena, look),
    W,
    H,
    cx0: A.exit[0],
    pal,
    lanes: laneSetOf(A),
    scene,
    sun,
    floor,
    walls,
    caps,
    wl,
    wbase,
    fbase: new Float32Array(W * H * 3),
    dyn,
    beam,
    ring,
    wheels,
    agents: new Map(),
    parts,
    weather: wk,
    fires: [],
    items: [],
    snap: null,
    lit: false,
    fog: null,
    fade: {},
  };
}

/** A world is rebuilt when the map or the arena's size changes. */
export function worldKey(arena: LiveArena, look: string): string {
  return `${look}:${arena.A.w}x${arena.A.h}`;
}

/** A small number on a canvas texture (the Hauler's carried count), repainted when it changes. */
function countSprite(): THREE.Sprite | null {
  const cv = document.createElement('canvas');
  cv.width = 64;
  cv.height = 32;
  let g: CanvasRenderingContext2D | null = null;
  try {
    g = cv.getContext('2d');
  } catch {
    g = null;
  }
  if (!g) return null;
  const ctx = g;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), transparent: true, depthWrite: false }));
  sp.scale.set(0.36, 0.18, 1);
  sp.userData.paint = (n: number, cap: number, colour: string) => {
    ctx.clearRect(0, 0, 64, 32);
    ctx.fillStyle = 'rgba(5,8,13,.85)';
    ctx.fillRect(2, 2, 60, 28);
    ctx.fillStyle = colour;
    ctx.font = '700 22px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${n}/${cap}`, 32, 17);
    (sp.material.map as THREE.Texture).needsUpdate = true;
  };
  return sp;
}

const GROUPS: readonly LookGroup[] = ['footL', 'footR', 'body', 'head', 'hand', 'tip'];
/** Height of the carried items over the feet: just over the figure's top (it is scaled 1.1). */
const carryY = (look: RoleLook) => (lookTop(look) + 0.12) * 1.1;

/** The agent in its role's look (@skirm/ui ROLE_LOOKS), with a team ring, name tag, carry slots and effects. */
function agentRig(w: World, a: Agent3): AgentRig {
  const g = new THREE.Group();
  const body = new THREE.Group();
  g.add(body);
  const team = TEAM_RING[a.team];
  const look = lookFor(a.role);
  const colours = { body: a.c ?? BODY[a.team][a.slot % 3]!, head: a.bone ?? '#ece8e1', team };
  const mats: THREE.Material[] = [];
  const byFill = new Map<string, THREE.Material>();
  const matFor = (hex: string, glow: boolean) => {
    const k = (glow ? '*' : '') + hex;
    let m = byFill.get(k);
    if (!m) {
      m = glow ? new THREE.MeshBasicMaterial({ color: hex }) : lambert({ color: hex });
      byFill.set(k, m);
      mats.push(m);
    }
    return m;
  };
  const box = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  const parts = {} as Record<LookGroup, THREE.Group>;
  for (const k of GROUPS) {
    parts[k] = new THREE.Group();
    body.add(parts[k]);
  }
  for (const q of lookParts(look)) {
    const m = new THREE.Mesh(box, matFor(fillOf(q.fill, colours), !!q.glow));
    m.scale.set(q.size[0], q.size[1], q.size[2]);
    if (q.group === 'tip') {
      // The beacon tip scales around its own centre: its group sits at the part.
      parts.tip.position.set(q.at[0], q.at[1] + q.size[1] / 2, q.at[2]);
      parts.tip.userData.base = parts.tip.position.clone();
      m.position.set(0, -q.size[1] / 2, 0);
    } else m.position.set(q.at[0], q.at[1], q.at[2]);
    m.castShadow = q.size[1] > 0.04;
    parts[q.group].add(m);
  }
  body.scale.setScalar(1.1);
  const ringMat = new THREE.MeshBasicMaterial({ color: team, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false });
  const tr = new THREE.Mesh(new THREE.RingGeometry(0.34, 0.42, 28), ringMat);
  tr.rotation.x = -Math.PI / 2;
  tr.position.y = 0.02;
  g.add(tr);
  const tag = nameSprite(a.name, team);
  if (tag) {
    tag.position.y = Math.max(1.32, carryY(look) + 0.42);
    g.add(tag);
  }
  const topY = carryY(look);
  const invGeo = new THREE.OctahedronGeometry(0.09);
  const invMat = new THREE.MeshBasicMaterial({ color: w.pal.accent });
  const inv = Array.from({ length: look.carry }, (_, i) => {
    const o = new THREE.Mesh(invGeo, invMat);
    o.position.set((i - (look.carry - 1) / 2) * 0.2, topY, 0);
    o.visible = false;
    g.add(o);
    return o;
  });
  const count = look.count ? countSprite() : null;
  if (count) {
    count.position.set(0, topY + 0.2, 0);
    count.visible = false;
    g.add(count);
  }
  // Effects: a ground ring (the scout pulse) and a few bits (stars, dust, spray, sparkles).
  const fxRingMat = new THREE.MeshBasicMaterial({ color: look.accent, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false });
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.44, 0.5, 28), fxRingMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.03;
  ring.visible = false;
  g.add(ring);
  const bitMat = new THREE.MeshBasicMaterial({ color: '#ffd23f', transparent: true });
  const bitGeo = new THREE.OctahedronGeometry(0.045);
  const bits = Array.from({ length: 6 }, () => {
    const o = new THREE.Mesh(bitGeo, bitMat);
    o.visible = false;
    g.add(o);
    return o;
  });
  w.scene.add(g);
  // Crews start facing the middle.
  return { g, body, look, parts, inv, count, shown: -1, fx: { ring, bits, bitMat, ringMat: fxRingMat }, mats, face: a.team === 'A' ? Math.PI / 2 : -Math.PI / 2 };
}

/** Poses one agent's figure and its effects for this moment (poseAt in @skirm/ui). */
function poseRig(ag: AgentRig, a: Agent3, o: { time: number; age: number; walk: number; moving: boolean; still: boolean; seed: number; accent: string }) {
  const kind = poseKind({ out: a.out, down: a.down, stun: a.stun, cheer: a.cheer, act: a.act, carrying: a.inv.length, moving: o.moving });
  const pose = poseAt(kind, ag.look, o);
  ag.body.rotation.z = pose.tilt;
  ag.body.rotation.x = pose.lean;
  ag.body.position.y = pose.lift + (a.down ? 0.1 * Math.sin(Math.abs(pose.tilt)) : 0);
  for (const k of GROUPS) {
    if (k === 'tip') continue;
    const off = pose.off[k];
    ag.parts[k].position.set(off?.[0] ?? 0, off?.[1] ?? 0, off?.[2] ?? 0);
  }
  const tip = ag.parts.tip;
  const base = tip.userData.base as THREE.Vector3 | undefined;
  if (base) {
    const off = pose.off.head;
    tip.position.set(base.x + (off?.[0] ?? 0), base.y + (off?.[1] ?? 0), base.z + (off?.[2] ?? 0));
    tip.scale.setScalar(pose.tipScale);
  }
  const { ring, bits, bitMat, ringMat } = ag.fx;
  const t = o.still ? 0.4 : o.time;
  ring.visible = pose.kind === 'act' && ag.look.verb === 'pulse';
  if (ring.visible) {
    const k = o.still ? 0.6 : (o.time * 0.9) % 1;
    ring.scale.setScalar(0.7 + k * 2);
    ringMat.opacity = o.still ? 0.5 : 0.9 * (1 - k);
  }
  const topY = carryY(ag.look);
  let n = 0;
  const bit = (x: number, y: number, z: number) => {
    const b = bits[n++];
    if (!b) return;
    b.visible = true;
    b.position.set(x, y, z);
  };
  if (pose.kind === 'stun') {
    bitMat.color.set('#ffd23f');
    bitMat.opacity = 1;
    for (let i = 0; i < 5; i++) {
      const ang = (o.still ? 0 : o.time * 6) + i * 1.25;
      bit(Math.cos(ang) * 0.26, topY - 0.12, Math.sin(ang) * 0.26);
    }
  } else if (pose.kind === 'cheer' && pose.fx > 0) {
    bitMat.color.set(o.accent);
    bitMat.opacity = pose.fx;
    for (let i = 0; i < 6; i++) {
      const ang = i * 1.05 + t * 2;
      const r = 0.25 + (1 - pose.fx) * 0.35;
      bit(Math.cos(ang) * r, topY - 0.1 + (1 - pose.fx) * 0.4, Math.sin(ang) * r);
    }
  } else if (pose.kind === 'act' && ag.look.verb !== 'pulse') {
    // In front of the agent (+z in its own frame; the rig group turns with its heading).
    const v = ag.look.verb;
    bitMat.color.set(v === 'dig' ? '#a07850' : v === 'spray' ? '#8fd0ff' : v === 'build' ? '#7ff5e4' : v === 'heal' ? '#ff4d5e' : '#ffe94a');
    bitMat.opacity = 0.9;
    for (let i = 0; i < 5; i++) {
      const ph = (t * (v === 'spray' ? 2.2 : 1.6) + i / 5) % 1;
      if (v === 'spray') bit(0.3 + (i % 2) * 0.04, 0.42 - ph * ph * 0.4, 0.3 + ph * 0.5);
      else if (v === 'dig') bit((i - 2) * 0.06, 0.05 + Math.sin(ph * Math.PI) * 0.35, 0.45);
      else bit((i - 2) * 0.07, 0.3 + Math.sin(ph * Math.PI) * 0.2, 0.42);
    }
  }
  for (; n < bits.length; n++) bits[n]!.visible = false;
  return pose;
}

/** Re-lays the tiles that change, from a new board. */
function layTiles(w: World, state: ArenaState, seen: ((i: number) => boolean) | null) {
  const { W, H, dyn } = w;
  const n: Partial<Record<DynKey, number>> = {};
  const put = (key: DynKey, x: number, y: number, z: number, sx: number, sy: number, sz: number, ry = 0) => {
    const i = n[key] ?? 0;
    place(dyn[key], i, x, y, z, sx, sy, sz, ry);
    n[key] = i + 1;
  };
  w.fires = [];
  w.items = [];
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      col.set(x === w.cx0 ? w.pal.mid : (x + y) % 2 ? w.pal.floor : w.pal.floor2).multiplyScalar(1.7);
      if (w.lanes.has(i)) col.lerp(AMBER, 0.25);
      w.fbase[i * 3] = col.r;
      w.fbase[i * 3 + 1] = col.g;
      w.fbase[i * 3 + 2] = col.b;
      w.floor.setColorAt(i, col);
      const r = hash(x * 3, y * 7);
      switch (state.grid[i]) {
        case 'dirt':
          put('dirt', x, 0, y, 0.94, 0.38 + r * 0.14, 0.94, r);
          break;
        case 'crate':
          put('crate', x, 0, y, 0.7, 0.55, 0.7);
          break;
        case 'block':
          put('block', x, 0, y, 0.92, 0.62, 0.92);
          break;
        case 'grass':
          put('grass', x, 0, y, 0.94, 0.06 + r * 0.05, 0.94);
          break;
        case 'tree':
          put('trunk', x, 0, y, 1, 1, 1);
          put('canopy', x, 0.82, y, 1, 0.9 + r * 0.3, 1, r * 3);
          break;
        case 'water':
          put('water', x, -0.02, y, 1, 0.06, 1);
          break;
        case 'lava':
          put('lava', x, -0.02, y, 1, 0.08, 1);
          break;
        case 'fire':
          put('fire', x, 0, y, 0.96, 0.05, 0.96);
          w.fires.push([x, y]);
          break;
        case 'item':
          w.items.push([x, y, !!seen && !seen(i)]);
          break;
        case 'ice':
          put('ice', x, -0.01, y, 0.98, 0.04, 0.98);
          break;
      }
    }
  // Overlays: electrified water glows over the water, gas hangs as a low green cloud.
  for (const i of state.shock ?? []) put('shock', i % W, 0.02, (i / W) | 0, 1, 0.05, 1);
  for (const i of state.gas ?? []) put('gas', i % W, 0.35, (i / W) | 0, 1.1, 0.7, 1.1, hash(i, 3) * 3);
  const gear = state.gear;
  for (const p of gear?.placed ?? []) {
    const [x, y] = p.at;
    if (p.kind === 'sandbag') {
      put('sandbag', x, 0.1, y - 0.12, 1, 1, 1);
      put('sandbag', x, 0.1, y + 0.12, 1, 1, 1);
    } else if (p.kind === 'bridge') for (const k of [-0.3, 0, 0.3]) put('bridge', x + k, 0.04, y, 0.24, 0.08, 1.04);
    else put('pump', x, 0, y, 1, 1, 1);
  }
  for (const g of gear?.tools ?? []) put('tool', g.at[0], 0.15, g.at[1], 0.34, 0.3, 0.34, 0.6);
  for (const key of Object.keys(dyn) as DynKey[]) {
    dyn[key].count = n[key] ?? 0;
    dyn[key].instanceMatrix.needsUpdate = true;
  }
  if (w.floor.instanceColor) w.floor.instanceColor.needsUpdate = true;
}

/** What the watching crew can see, from the arena: soft light if it ships one, else the hard sight. */
function sightOf(arena: LiveArena): { light: readonly number[] | null; vis: readonly boolean[] | null } {
  const f = arena as { light?: readonly number[] | null; vis?: readonly boolean[] | null };
  return { light: f.light ?? null, vis: f.vis ?? null };
}

export interface FrameInput {
  state: ChaseCamState;
  /** Seconds since the last frame (clamped) and since mount. */
  dt: number;
  time: number;
  /** Date.now(), for the move tween. */
  now: number;
  /** Reduced motion: no bob, spin, flicker or weather drift, and the camera snaps. */
  still: boolean;
  dragging: boolean;
}

/** Steps the world and the camera rig for one animation frame; the caller renders. */
export function stepWorld(w: World, rig: Rig, cam: THREE.PerspectiveCamera, f: FrameInput) {
  const { state, dt, still, dragging } = f;
  const time = still ? 0 : f.time;
  const cur = state.arena.state;
  const prev = state.prev;
  const agents = cur.agents as Agent3[];
  const prevById = new Map((prev?.agents ?? []).map((a) => [a.id, a]));
  const focusAgent = agents.find((a) => a.id === state.focus);
  const team = focusAgent?.team ?? 'A';
  const { light, vis } = sightOf(state.arena);
  const seen = vis ? (i: number) => !!vis[i] : light ? (i: number) => (light[i] ?? 1) > 0.5 : null;

  if (w.snap !== cur) {
    layTiles(w, cur, seen);
    // Each agent faces the way it last stepped; the watched one also steers the camera.
    for (const a of agents) {
      const pa = prevById.get(a.id) ?? a;
      const dx = a.x - pa.x;
      const dz = a.y - pa.y;
      const ag = w.agents.get(a.id);
      if (!ag || Math.abs(dx) + Math.abs(dz) !== 1) continue;
      ag.face = Math.atan2(dx, dz);
      if (a.id === state.focus) {
        rig.steps.push([dx, dz]);
        if (rig.steps.length > HEADING_STEPS) rig.steps.shift();
      }
    }
    w.snap = cur;
  }
  for (const a of agents) if (!w.agents.has(a.id)) w.agents.set(a.id, agentRig(w, a));

  if (rig.target !== state.focus) {
    rig.target = state.focus;
    rig.steps = [];
    rig.tyaw = w.agents.get(state.focus)?.face ?? 0;
    if (rig.yaw == null) rig.yaw = rig.tyaw;
  }
  const heading = headingYaw(rig.steps);
  if (heading != null) rig.tyaw = heading;

  const fade = stepAgentFade(w.fade, agents, seen, team, w.W, still ? 1 : dt);
  const alpha = prev && !still && !state.paused ? Math.min(1, (f.now - state.at) / TWEEN_MS) : 1;
  const k = ease(alpha);
  let focus: THREE.Vector3 | null = null;
  const present = new Set<string>();
  agents.forEach((a, i) => {
    const ag = w.agents.get(a.id);
    if (!ag) return;
    present.add(a.id);
    const pa = prevById.get(a.id) ?? a;
    const tele = Math.abs(pa.x - a.x) + Math.abs(pa.y - a.y) > 1;
    const x = tele ? a.x : pa.x + (a.x - pa.x) * k;
    const z = tele ? a.y : pa.y + (a.y - pa.y) * k;
    const moving = !tele && (pa.x !== a.x || pa.y !== a.y);
    const af = fade[a.id] ?? 1;
    ag.g.visible = !a.out && af >= 0.02;
    const hop = moving && !still ? Math.sin(Math.PI * Math.min(1, alpha)) * 0.12 : 0;
    ag.g.position.set(x, hop, z);
    ag.g.rotation.y += still ? angDiff(ag.g.rotation.y, ag.face) : angDiff(ag.g.rotation.y, ag.face) * Math.min(1, dt * 10);
    poseRig(ag, a, { time, age: (f.now - state.at) / 1000, walk: alpha, moving: moving && !still, still, seed: i, accent: TEAM_RING[a.team] });
    // Anyone between the camera and the watched agent fades so they never hide it.
    const blocking = !!rig.pos && !!rig.focusAt && a.id !== state.focus && segDist(x, z, rig.pos.x, rig.pos.z, rig.focusAt.x, rig.focusAt.z) < 0.75;
    const op = (a.down ? 0.5 : blocking ? 0.28 : 1) * af;
    for (const m of ag.mats) {
      m.transparent = op < 1;
      m.opacity = op;
    }
    const carried = a.down ? 0 : a.inv.length;
    ag.inv.forEach((o, j) => {
      o.visible = j < carried;
      o.rotation.y = time * 3;
    });
    if (ag.count) {
      ag.count.visible = carried > 0;
      if (carried > 0 && ag.shown !== carried) (ag.count.userData.paint as (n: number, cap: number, c: string) => void)(carried, ag.look.carry, w.pal.accent);
      ag.shown = carried;
    }
    if (a.id === state.focus) focus = ag.g.position;
  });
  // Rivals that left sight are not in the frame at all.
  for (const [id, ag] of w.agents) if (!present.has(id)) ag.g.visible = false;

  // Fog light on the floor and walls, eased every frame.
  let FL: ArrayLike<number> | null = null;
  if (light) FL = light;
  else if (vis) {
    if (!w.fog) w.fog = softFog(w.W, w.H);
    FL = stepSoftFog(w.fog, vis, still ? 10 : dt);
  }
  if (FL || w.lit) {
    const fb = w.fbase;
    for (let i = 0; i < w.W * w.H; i++) {
      const l = FL ? (FL[i] ?? 1) : 1;
      w.floor.setColorAt(i, col.setRGB(fb[i * 3]! * l, fb[i * 3 + 1]! * l, fb[i * 3 + 2]! * l));
    }
    w.wl.forEach((s, i) => {
      const l = FL ? 0.35 + 0.65 * (FL[s.y * w.W + s.x] ?? 1) : 1;
      w.walls.setColorAt(i, col.setRGB(w.wbase[i * 3]! * l, w.wbase[i * 3 + 1]! * l, w.wbase[i * 3 + 2]! * l));
      w.caps.setColorAt(i, col.setRGB(l, l, l));
    });
    for (const im of [w.floor, w.walls, w.caps]) if (im.instanceColor) im.instanceColor.needsUpdate = true;
    w.lit = !!FL;
  }

  // Items spin, flames flicker, liquids breathe.
  w.items.forEach(([x, y, hid], i) => {
    tmp.position.set(x, 0.5 + Math.sin(time * 2.4 + x + y) * 0.06, y);
    tmp.rotation.set(0, time * 1.6 + x, 0);
    tmp.scale.setScalar(hid ? 0.6 : 1);
    tmp.updateMatrix();
    w.dyn.item.setMatrixAt(i, tmp.matrix);
  });
  w.dyn.item.count = w.items.length;
  w.dyn.item.instanceMatrix.needsUpdate = true;
  let fi = 0;
  for (const [x, y] of w.fires)
    for (let j = 0; j < 2; j++) {
      const fl = 0.6 + 0.5 * Math.abs(Math.sin(time * 7 + x * 1.7 + y + j * 2));
      tmp.position.set(x + (j ? 0.18 : -0.16), 0.04, y + (j ? -0.12 : 0.14));
      tmp.rotation.set(0, 0, 0);
      tmp.scale.set(1, fl, 1);
      tmp.updateMatrix();
      w.dyn.flame.setMatrixAt(fi++, tmp.matrix);
    }
  w.dyn.flame.count = fi;
  w.dyn.flame.instanceMatrix.needsUpdate = true;
  (w.dyn.lava.material as THREE.MeshBasicMaterial).color.setHSL(0.04, 1, 0.5 + 0.06 * Math.sin(time * 1.6));
  (w.dyn.water.material as THREE.MeshPhongMaterial).opacity = 0.8 + 0.08 * Math.sin(time * 2.2);
  (w.dyn.shock.material as THREE.MeshBasicMaterial).opacity = 0.35 + 0.3 * Math.abs(Math.sin(time * 9));
  (w.dyn.gas.material as THREE.MeshLambertMaterial).opacity = 0.32 + 0.06 * Math.sin(time * 1.4);
  w.beam.material.opacity = 0.16 + 0.08 * Math.sin(time * 3);
  w.ring.rotation.z = time * 0.8;
  for (const wh of w.wheels) wh.rotation.z = time * 1.5;

  // The chase camera: behind the agent, a little to the right, looking past it.
  const fp: { x: number; z: number } = focus ?? { x: w.W / 2, z: w.H / 2 };
  const yaw0: number = rig.yaw ?? rig.tyaw;
  rig.yaw = still ? rig.tyaw : yaw0 + angDiff(yaw0, rig.tyaw) * approach(dt, 2.4);
  if (!dragging) rig.look *= still ? 0 : Math.exp(-dt * 1.5);
  const want = chaseRig(fp, rig.yaw + rig.look, rig.dist);
  if (!rig.pos || still) rig.pos = new THREE.Vector3(want.pos.x, want.pos.y, want.pos.z);
  else rig.pos.lerp(new THREE.Vector3(want.pos.x, want.pos.y, want.pos.z), approach(dt, 6));
  cam.position.copy(rig.pos);
  rig.focusAt = { x: fp.x, z: fp.z };

  // Walls between the camera and the agent drop to a low cutaway so they never hide it.
  let cutChanged = false;
  w.wl.forEach((s, i) => {
    const cut = wallBlocks(s.x, s.y, rig.pos!, fp);
    if (cut === s.cut) return;
    s.cut = cut;
    cutChanged = true;
    const h = cut ? 0.14 : s.h;
    place(w.walls, i, s.x, 0, s.y, 1, h, 1);
    place(w.caps, i, s.x, h, s.y, 1.02, 0.07, 1.02);
  });
  if (cutChanged) {
    w.walls.instanceMatrix.needsUpdate = true;
    w.caps.instanceMatrix.needsUpdate = true;
  }
  cam.lookAt(want.look.x, want.look.y, want.look.z);
  w.sun.position.set(fp.x + 7, 16, fp.z + 5);
  w.sun.target.position.set(fp.x, 0, fp.z);
  w.sun.target.updateMatrixWorld();

  if (w.parts && !still) {
    const wx = WEATHER[w.weather]!;
    const attr = w.parts.geometry.getAttribute('position') as THREE.BufferAttribute;
    const p = attr.array as Float32Array;
    for (let i = 0; i < p.length; i += 3) {
      p[i + 1]! -= wx.fall * dt;
      p[i]! += Math.sin(time + i) * wx.drift * dt;
      if (p[i + 1]! < 0) p[i + 1]! += 12;
      if (p[i + 1]! > 12) p[i + 1]! -= 12;
      const ddx = p[i]! - fp.x;
      const ddz = p[i + 2]! - fp.z;
      if (Math.abs(ddx) > 15) p[i]! -= Math.sign(ddx) * 30;
      if (Math.abs(ddz) > 15) p[i + 2]! -= Math.sign(ddz) * 30;
    }
    attr.needsUpdate = true;
  }
}

export function newRig(): Rig {
  return { yaw: null, tyaw: 0, look: 0, dist: DIST_START, pos: null, focusAt: null, target: null, steps: [] };
}

/** Frees every geometry, material and texture the world holds. */
function disposeWorld(w: World) {
  const seen = new Set<{ dispose(): void }>();
  w.scene.traverse((o) => {
    const m = o as Partial<THREE.Mesh>;
    if (m.geometry) seen.add(m.geometry);
    const mats = m.material ? (Array.isArray(m.material) ? m.material : [m.material]) : [];
    for (const mat of mats) {
      seen.add(mat);
      const map = (mat as THREE.SpriteMaterial).map;
      if (map) seen.add(map);
    }
    if (o instanceof THREE.InstancedMesh) seen.add(o);
  });
  for (const d of seen) d.dispose();
  w.sun.shadow.map?.dispose();
}

export interface RendererLike {
  domElement: HTMLCanvasElement;
  setPixelRatio(r: number): void;
  setSize(w: number, h: number, updateStyle?: boolean): void;
  render(scene: THREE.Scene, cam: THREE.Camera): void;
  dispose(): void;
}

/** Makes the WebGL renderer; throws where WebGL is missing (the caller falls back to 2D). */
function webglRenderer(): RendererLike {
  const r = new THREE.WebGLRenderer({ antialias: true });
  // Linear out, as three r128 wrote it (see ColorManagement above).
  r.outputColorSpace = THREE.LinearSRGBColorSpace;
  r.shadowMap.enabled = true;
  r.shadowMap.type = THREE.PCFSoftShadowMap;
  return r;
}

export interface MountDeps {
  /** Swaps the WebGL renderer (tests). */
  renderer?: () => RendererLike;
}

/**
 * Mounts the chase cam into `el`: a canvas filling it, a frame loop reading `getState`, drag to
 * look around (springs back) and the wheel to move in or out. Returns the unmount. Throws when
 * WebGL cannot start; errors inside the frame loop stop it and go to `opts.onFail`.
 */
export function startChaseCam(el: HTMLElement, getState: () => ChaseCamState | null, opts: ChaseCamOptions = {}, deps: MountDeps = {}): () => void {
  const r = (deps.renderer ?? webglRenderer)();
  const cv = r.domElement;
  Object.assign(cv.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', display: 'block', touchAction: 'none', cursor: 'grab' });
  el.appendChild(cv);
  const cam = new THREE.PerspectiveCamera(58, 1, 0.1, 160);
  const size = () => {
    const w = el.clientWidth || window.innerWidth;
    const h = el.clientHeight || window.innerHeight;
    r.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    r.setSize(w, h, false);
    cam.aspect = w / Math.max(1, h);
    cam.updateProjectionMatrix();
  };
  size();
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(size) : null;
  if (ro) ro.observe(el);
  else window.addEventListener('resize', size);

  const rig = newRig();
  let world: World | null = null;
  let held: ChaseCamState | null = null;
  let drag: { x: number; o: number } | null = null;
  const down = (e: PointerEvent) => {
    drag = { x: e.clientX, o: rig.look };
    cv.style.cursor = 'grabbing';
    try {
      cv.setPointerCapture(e.pointerId);
    } catch {
      // jsdom and some browsers refuse capture for synthetic pointers; dragging still works.
    }
  };
  const move = (e: PointerEvent) => {
    if (drag) rig.look = drag.o + (e.clientX - drag.x) * -0.008;
  };
  const up = () => {
    drag = null;
    cv.style.cursor = 'grab';
  };
  const wheel = (e: WheelEvent) => {
    e.preventDefault();
    rig.dist = wheelDist(rig.dist, e.deltaY);
  };
  cv.addEventListener('pointerdown', down);
  cv.addEventListener('pointermove', move);
  cv.addEventListener('pointerup', up);
  cv.addEventListener('pointercancel', up);
  cv.addEventListener('wheel', wheel, { passive: false });
  // A lost GPU context (driver reset, too many contexts) ends the 3D view; the caller goes 2D.
  const lost = (e: Event) => {
    e.preventDefault();
    stop();
    opts.onFail?.(new Error('WebGL context lost'));
  };
  cv.addEventListener('webglcontextlost', lost);

  let raf = 0;
  let stopped = false;
  const t0 = performance.now();
  let last = t0;
  const frame = (now: number) => {
    if (stopped) return;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    try {
      const live = getState();
      // A view-only pause holds the picture it had; the camera can still be dragged.
      const st = live?.paused && held && held.focus === live.focus ? { ...held, paused: true } : live;
      held = st;
      cv.style.visibility = st ? 'visible' : 'hidden';
      if (st) {
        const key = worldKey(st.arena, st.look);
        if (!world || world.key !== key) {
          if (world) disposeWorld(world);
          world = buildWorld(st.arena, st.look);
          rig.pos = null;
        }
        stepWorld(world, rig, cam, { state: st, dt, time: (now - t0) / 1000, now: Date.now(), still: !!opts.still?.(), dragging: !!drag });
        r.render(world.scene, cam);
      }
    } catch (err) {
      stop();
      opts.onFail?.(err);
      return;
    }
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);

  function stop() {
    if (stopped) return;
    stopped = true;
    cancelAnimationFrame(raf);
    ro?.disconnect();
    if (!ro) window.removeEventListener('resize', size);
    cv.removeEventListener('pointerdown', down);
    cv.removeEventListener('pointermove', move);
    cv.removeEventListener('pointerup', up);
    cv.removeEventListener('pointercancel', up);
    cv.removeEventListener('wheel', wheel);
    cv.removeEventListener('webglcontextlost', lost);
    if (world) disposeWorld(world);
    world = null;
    r.dispose();
    cv.remove();
  }
  return stop;
}
