// Stick-figure animation renderer.
//
// An exercise describes a few key poses as joint angles; this module turns
// them into a self-contained, looping SVG (SMIL <animate> on polylines). The
// host draws it as an <img>, so the SVG must not reference anything outside
// itself — only `url(#id)` for the glow filter.
//
// Angles are absolute, in degrees, in screen space: 0 = straight down,
// 90 = forward (screen right, the way the figure faces), 180 = straight up,
// -90 = backward. Interpolating angles (not joint positions) keeps limb
// lengths constant while the figure moves.

export type Vec = [number, number];

export type Joint =
  | 'hip'
  | 'shoulder'
  | 'head'
  | 'elbowN'
  | 'handN'
  | 'elbowF'
  | 'handF'
  | 'kneeN'
  | 'ankleN'
  | 'toeN'
  | 'kneeF'
  | 'ankleF'
  | 'toeF';

/**
 * A limb is either two absolute angles [upper, lower], or a target point for
 * its end (hand or ankle) solved with two-bone IK. `bend` picks which side the
 * elbow/knee goes: 1 = clockwise of the root→target line on screen, -1 = the
 * other side.
 */
export type Limb = [number, number] | { to: Vec; bend?: 1 | -1 };

export interface Pose {
  /** Hip → shoulder direction. 180 = upright. */
  torso: number;
  /** Neck direction; defaults to the torso's. */
  neck?: number;
  /** Near arm. */
  armN: Limb;
  /** Far arm; defaults to the near arm. */
  armF?: Limb;
  /** Near leg. */
  legN: Limb;
  /** Far leg; defaults to the near leg. */
  legF?: Limb;
  /** Foot directions (ankle → toe); default 90 (flat, pointing forward). */
  footN?: number;
  footF?: number;
  /** Which joint is pinned where (e.g. feet on the floor, hands on the bar). */
  anchor: { joint: Joint; at: Vec };
}

export interface Key {
  pose: Pose;
  /** Seconds to stay in this pose before moving on. */
  hold?: number;
  /** Seconds to move from this pose to the next; defaults to the spec's `move`. */
  move?: number;
}

export type Prop =
  | { kind: 'floor' }
  | { kind: 'bar'; y: number; x1?: number; x2?: number }
  | { kind: 'dipBars'; y: number; x1: number; x2: number }
  | { kind: 'box'; x: number; y: number; w: number; h: number }
  | { kind: 'wall'; x: number }
  | { kind: 'pad'; x: number; y1: number; y2: number }
  | { kind: 'arrow'; from: Vec; to: Vec };

export interface FigureSpec {
  /** 'side' (default) or 'front' (limbs spread left/right, e.g. archer pull-up). */
  view?: 'side' | 'front';
  props: Prop[];
  keys: Key[];
  /** Seconds for each move between key poses. */
  move: number;
}

export const SIZE = 200;
export const GROUND = 186;

const SEG = {
  torso: 50,
  neck: 7,
  head: 8.5,
  upperArm: 26,
  forearm: 24,
  thigh: 38,
  shin: 36,
  foot: 11,
};
const SHOULDER_HALF = 11;
const HIP_HALF = 7;
const STEPS = 8;

const COLOR = {
  body: '#4fd8ff',
  far: '#2b8cff',
  head: '#0a1428',
  prop: '#2b5799',
  propFill: '#0d1a33',
  arrow: '#ffcf5c',
};

type Joints = Record<Joint, Vec> & { shoulderF: Vec; hipF: Vec; shoulderN: Vec; hipN: Vec };

const rad = (deg: number): number => (deg * Math.PI) / 180;
const dir = (deg: number): Vec => [Math.sin(rad(deg)), Math.cos(rad(deg))];
const add = (a: Vec, b: Vec): Vec => [a[0] + b[0], a[1] + b[1]];
const sub = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1]];
const scale = (v: Vec, k: number): Vec => [v[0] * k, v[1] * k];
const step = (from: Vec, deg: number, len: number): Vec => add(from, scale(dir(deg), len));

const len = (v: Vec): number => Math.hypot(v[0], v[1]);

/** Two-bone IK: mid joint for a limb from `root` reaching for `target`. */
function reach(root: Vec, target: Vec, a: number, b: number, bend: 1 | -1): [Vec, Vec] {
  const d0 = sub(target, root);
  const dist = Math.min(Math.max(len(d0), Math.abs(a - b) + 0.01), a + b - 0.01);
  const u: Vec = len(d0) > 0 ? scale(d0, 1 / len(d0)) : [0, 1];
  const end = add(root, scale(u, dist));
  const alpha = Math.acos(Math.min(Math.max((a * a + dist * dist - b * b) / (2 * a * dist), -1), 1)) * bend;
  const r: Vec = [u[0] * Math.cos(alpha) - u[1] * Math.sin(alpha), u[0] * Math.sin(alpha) + u[1] * Math.cos(alpha)];
  return [add(root, scale(r, a)), end];
}

function limb(root: Vec, spec: Limb, a: number, b: number): [Vec, Vec] {
  if (Array.isArray(spec)) {
    const mid = step(root, spec[0], a);
    return [mid, step(mid, spec[1], b)];
  }
  return reach(root, spec.to, a, b, spec.bend ?? 1);
}

/** Joint positions for one pose, translated so the anchor lands where asked. */
export function solve(pose: Pose, view: 'side' | 'front' = 'side'): Joints {
  const armF = pose.armF ?? pose.armN;
  const legF = pose.legF ?? pose.legN;
  const hip0: Vec = [0, 0];
  const shoulder0 = step(hip0, pose.torso, SEG.torso);
  // Front view: shoulders and hips are spread across the body.
  const across = view === 'front' ? dir(pose.torso + 90) : ([0, 0] as Vec);

  // Place the torso first. The anchor is the torso itself, or the end of a
  // limb given as angles (an IK limb's end depends on where the torso is).
  const angleLimbs: Partial<Record<Joint, Vec>> = {};
  const raw = (root: Vec, spec: Limb, a: number, b: number, mid: Joint, end: Joint): void => {
    if (!Array.isArray(spec)) return;
    const [m, e] = limb(root, spec, a, b);
    angleLimbs[mid] = m;
    angleLimbs[end] = e;
  };
  raw(add(shoulder0, scale(across, SHOULDER_HALF)), pose.armN, SEG.upperArm, SEG.forearm, 'elbowN', 'handN');
  raw(add(shoulder0, scale(across, -SHOULDER_HALF)), armF, SEG.upperArm, SEG.forearm, 'elbowF', 'handF');
  raw(add(hip0, scale(across, HIP_HALF)), pose.legN, SEG.thigh, SEG.shin, 'kneeN', 'ankleN');
  raw(add(hip0, scale(across, -HIP_HALF)), legF, SEG.thigh, SEG.shin, 'kneeF', 'ankleF');
  const torso0: Partial<Record<Joint, Vec>> = { hip: hip0, shoulder: shoulder0, head: step(shoulder0, pose.neck ?? pose.torso, SEG.neck + SEG.head) };
  const anchorRaw = torso0[pose.anchor.joint] ?? angleLimbs[pose.anchor.joint];
  if (!anchorRaw) throw new Error(`anchor '${pose.anchor.joint}' must be a torso joint or the end of an angle limb`);
  const shift = sub(pose.anchor.at, anchorRaw);

  const hip = add(hip0, shift);
  const shoulder = add(shoulder0, shift);
  const head = step(shoulder, pose.neck ?? pose.torso, SEG.neck + SEG.head);
  const shoulderN = add(shoulder, scale(across, SHOULDER_HALF));
  const shoulderF = add(shoulder, scale(across, -SHOULDER_HALF));
  const hipN = add(hip, scale(across, HIP_HALF));
  const hipF = add(hip, scale(across, -HIP_HALF));

  const [elbowN, handN] = limb(shoulderN, pose.armN, SEG.upperArm, SEG.forearm);
  const [elbowF, handF] = limb(shoulderF, armF, SEG.upperArm, SEG.forearm);
  const [kneeN, ankleN] = limb(hipN, pose.legN, SEG.thigh, SEG.shin);
  const [kneeF, ankleF] = limb(hipF, legF, SEG.thigh, SEG.shin);
  const toeN = step(ankleN, pose.footN ?? 90, SEG.foot);
  const toeF = step(ankleF, pose.footF ?? 90, SEG.foot);

  return { hip, shoulder, head, elbowN, handN, elbowF, handF, kneeN, ankleN, toeN, kneeF, ankleF, toeF, shoulderN, shoulderF, hipN, hipF };
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

function blendLimb(a: Limb, b: Limb, t: number): Limb {
  if (Array.isArray(a) && Array.isArray(b)) return [lerp(a[0], b[0], t), lerp(a[1], b[1], t)];
  if (!Array.isArray(a) && !Array.isArray(b)) {
    return { to: [lerp(a.to[0], b.to[0], t), lerp(a.to[1], b.to[1], t)], bend: a.bend ?? 1 };
  }
  throw new Error('a limb must be given the same way (angles or target) in every key pose');
}
const ease = (t: number): number => 0.5 - Math.cos(Math.PI * t) / 2;

/** Blend two poses (angles, IK targets and anchor point); the anchor joint must match. */
export function blend(a: Pose, b: Pose, t: number): Pose {
  const pose: Pose = {
    torso: lerp(a.torso, b.torso, t),
    neck: lerp(a.neck ?? a.torso, b.neck ?? b.torso, t),
    armN: blendLimb(a.armN, b.armN, t),
    armF: blendLimb(a.armF ?? a.armN, b.armF ?? b.armN, t),
    legN: blendLimb(a.legN, b.legN, t),
    legF: blendLimb(a.legF ?? a.legN, b.legF ?? b.legN, t),
    footN: lerp(a.footN ?? 90, b.footN ?? 90, t),
    footF: lerp(a.footF ?? 90, b.footF ?? 90, t),
    anchor: { joint: a.anchor.joint, at: [lerp(a.anchor.at[0], b.anchor.at[0], t), lerp(a.anchor.at[1], b.anchor.at[1], t)] },
  };
  return pose;
}

interface Frame {
  joints: Joints;
  /** Seconds from the start of the loop. */
  at: number;
}

/** Sample the whole loop: hold, move to the next key, …, move back to the first. */
export function frames(spec: FigureSpec): { list: Frame[]; duration: number } {
  const view = spec.view ?? 'side';
  const keys = spec.keys;
  // A single pose is a still picture.
  if (keys.length === 1) return { list: [{ joints: solve(keys[0]!.pose, view), at: 0 }], duration: 1 };
  const list: Frame[] = [];
  let t = 0;
  for (let i = 0; i < keys.length; i++) {
    const cur = keys[i]!;
    const next = keys[(i + 1) % keys.length]!;
    list.push({ joints: solve(cur.pose, view), at: t });
    const hold = cur.hold ?? 0;
    if (hold > 0) {
      t += hold;
      list.push({ joints: solve(cur.pose, view), at: t });
    }
    const move = cur.move ?? spec.move;
    for (let s = 1; s < STEPS; s++) {
      list.push({ joints: solve(blend(cur.pose, next.pose, ease(s / STEPS)), view), at: t + (move * s) / STEPS });
    }
    t += move;
  }
  // Close the loop on the first pose.
  list.push({ joints: solve(keys[0]!.pose, view), at: t });
  return { list, duration: Math.max(t, 0.1) };
}

const fmt = (n: number): string => (Math.round(n * 10) / 10).toString();
const pt = (v: Vec): string => `${fmt(v[0])},${fmt(v[1])}`;
const pts = (vs: Vec[]): string => vs.map(pt).join(' ');

// ---- drawing ----------------------------------------------------------------
//
// Style: a "System window" panel (dark spotlight + hologram grid), the body
// drawn as thick outlined limbs with a vertical cyan gradient, a lit head, a
// floor shadow, a faint ghost of the end position and an amber arrow showing
// where the movement goes. Every limb is defined once in <defs> (with its
// animation) and drawn twice through <use>: dark outline, then colour.

const INK = '#020814';
const WIDTH = { near: 8, far: 7, torso: 13, neck: 6, outline: 4 };

function propSvg(p: Prop): string {
  const metal = `stroke="url(#metal)" stroke-linecap="round"`;
  switch (p.kind) {
    case 'floor':
      return `<line x1="6" y1="${GROUND + 4}" x2="${SIZE - 6}" y2="${GROUND + 4}" stroke="${COLOR.prop}" stroke-width="3" stroke-linecap="round"/>` +
        `<line x1="6" y1="${GROUND + 4}" x2="${SIZE - 6}" y2="${GROUND + 4}" stroke="${COLOR.body}" stroke-width="1" opacity="0.5"/>`;
    case 'bar': {
      const x1 = p.x1 ?? 30;
      const x2 = p.x2 ?? 170;
      return `<line x1="${x1}" y1="${p.y}" x2="${x1}" y2="${GROUND + 4}" stroke="${COLOR.prop}" stroke-width="4" opacity="0.55"/>` +
        `<line x1="${x2}" y1="${p.y}" x2="${x2}" y2="${GROUND + 4}" stroke="${COLOR.prop}" stroke-width="4" opacity="0.55"/>` +
        `<line x1="${x1 - 4}" y1="${p.y}" x2="${x2 + 4}" y2="${p.y}" ${metal} stroke-width="6"/>`;
    }
    case 'dipBars': {
      const mid = (p.x1 + p.x2) / 2;
      return `<line x1="${mid}" y1="${p.y}" x2="${mid}" y2="${GROUND + 4}" stroke="${COLOR.prop}" stroke-width="5" opacity="0.55"/>` +
        `<line x1="${p.x1}" y1="${p.y}" x2="${p.x2}" y2="${p.y}" ${metal} stroke-width="7"/>`;
    }
    case 'box':
      return `<rect x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}" rx="4" fill="${COLOR.propFill}" stroke="${COLOR.prop}" stroke-width="3"/>` +
        `<line x1="${p.x + 4}" y1="${p.y + 2}" x2="${p.x + p.w - 4}" y2="${p.y + 2}" stroke="${COLOR.body}" stroke-width="1.5" opacity="0.5"/>`;
    case 'wall':
      return `<rect x="${p.x - 3}" y="6" width="6" height="${GROUND - 2}" fill="${COLOR.propFill}" stroke="${COLOR.prop}" stroke-width="2"/>`;
    case 'pad':
      return `<line x1="${p.x}" y1="${p.y1}" x2="${p.x}" y2="${p.y2}" stroke="${COLOR.prop}" stroke-width="9" stroke-linecap="round"/>`;
    case 'arrow':
      return arrow(p.from, p.to, 0);
  }
}

/** Amber dashed arrow from a to b, bowed sideways by `bow` px. */
function arrow(a: Vec, b: Vec, bow: number): string {
  const d = sub(b, a);
  const l = len(d) || 1;
  const n: Vec = [-d[1] / l, d[0] / l];
  const c = add(scale(add(a, b), 0.5), scale(n, bow));
  // Arrowhead along the curve's end tangent (control point → end).
  const t = sub(b, c);
  const tl = len(t) || 1;
  const u: Vec = [t[0] / tl, t[1] / tl];
  const side: Vec = [-u[1], u[0]];
  const h1 = add(sub(b, scale(u, 7)), scale(side, 4));
  const h2 = add(sub(b, scale(u, 7)), scale(side, -4));
  return `<path d="M${pt(a)} Q${pt(c)} ${pt(b)}" fill="none" stroke="${COLOR.arrow}" stroke-width="2.5" stroke-dasharray="4 3" stroke-linecap="round" opacity="0.9"/>` +
    `<polyline points="${pts([h1, b, h2])}" fill="none" stroke="${COLOR.arrow}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`;
}

const keyTimesOf = (list: Frame[], dur: number): string => list.map((f) => Math.min(f.at / dur, 1).toFixed(4)).join(';');

/** A limb path defined once (with its animation), to be drawn via <use>. */
function limbDef(id: string, list: Frame[], dur: number, pick: (j: Joints) => Vec[]): string {
  const values = list.map((f) => pts(pick(f.joints)));
  if (list.length < 2) return `<polyline id="${id}" points="${values[0]}"/>`;
  return `<polyline id="${id}" points="${values[0]}"><animate attributeName="points" dur="${fmt(dur)}s" repeatCount="indefinite" values="${values.join(';')}" keyTimes="${keyTimesOf(list, dur)}"/></polyline>`;
}

/** Outline + colour pass for a defined limb. */
function limbUse(id: string, width: number, paint: string, opacity = 1): string {
  const common = `fill="none" stroke-linecap="round" stroke-linejoin="round"`;
  return `<g opacity="${opacity}"><use href="#${id}" ${common} stroke="${INK}" stroke-width="${width + WIDTH.outline}"/>` +
    `<use href="#${id}" ${common} stroke="${paint}" stroke-width="${width}"/></g>`;
}

function animatedAttr(list: Frame[], dur: number, attr: string, value: (j: Joints) => number): string {
  if (list.length < 2) return '';
  return `<animate attributeName="${attr}" dur="${fmt(dur)}s" repeatCount="indefinite" values="${list.map((f) => fmt(value(f.joints))).join(';')}" keyTimes="${keyTimesOf(list, dur)}"/>`;
}

const MOVING: Joint[] = ['hip', 'shoulder', 'head', 'handN', 'ankleN', 'kneeN', 'elbowN'];

/** The key pose furthest from the first one: the end of the movement. */
function endPose(spec: FigureSpec): Joints | null {
  if (spec.keys.length < 2) return null;
  const view = spec.view ?? 'side';
  const start = solve(spec.keys[0]!.pose, view);
  let best: Joints | null = null;
  let bestD = 0;
  for (const k of spec.keys.slice(1)) {
    const j = solve(k.pose, view);
    const d = MOVING.reduce((s, m) => s + len(sub(j[m], start[m])), 0);
    if (d > bestD) {
      bestD = d;
      best = j;
    }
  }
  return best;
}

/** Render a figure spec as a standalone animated SVG document. */
export function renderFigure(spec: FigureSpec, title: string): string {
  const { list, duration } = frames(spec);
  const front = spec.view === 'front';
  const start = list[0]!.joints;
  const end = endPose(spec);

  const chains: Record<string, (j: Joints) => Vec[]> = {
    legF: (j) => [j.hipF, j.kneeF, j.ankleF, j.toeF],
    armF: (j) => [j.shoulderF, j.elbowF, j.handF],
    torso: front ? (j) => [j.shoulderF, j.shoulderN, j.shoulder, j.hip, j.hipF, j.hipN] : (j) => [j.hip, j.shoulder],
    neck: (j) => [j.shoulder, j.head],
    legN: (j) => [j.hipN, j.kneeN, j.ankleN, j.toeN],
    armN: (j) => [j.shoulderN, j.elbowN, j.handN],
  };
  const defs = Object.entries(chains).map(([id, pick]) => limbDef(id, list, duration, pick)).join('');

  // Ghost: the end of the movement, faint and static.
  let ghost = '';
  if (end) {
    const g = (vs: Vec[], w: number): string => `<polyline points="${pts(vs)}" fill="none" stroke="${COLOR.body}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;
    ghost = `<g opacity="0.14">${Object.entries(chains).map(([id, pick]) => g(pick(end), id === 'torso' ? WIDTH.torso : WIDTH.near)).join('')}` +
      `<circle cx="${fmt(end.head[0])}" cy="${fmt(end.head[1])}" r="${SEG.head + 1}" fill="${COLOR.body}"/></g>`;
  }

  // Direction arrow: the joint that travels furthest, from start to end, bowed outwards.
  let motion = '';
  const motionYs: number[] = [];
  if (end && !spec.props.some((p) => p.kind === 'arrow')) {
    // Follow the body (hip/shoulder/head) unless a limb clearly moves more (leg raise, Y raise).
    const disp = (j: Joint): number => len(sub(end[j], start[j]));
    const pickMax = (js: Joint[]): Joint => js.reduce((a, b) => (disp(b) > disp(a) ? b : a));
    const body = pickMax(['hip', 'shoulder', 'head']);
    const limb = pickMax(['handN', 'ankleN']);
    const m = disp(limb) > 1.6 * disp(body) ? limb : body;
    let a = start[m];
    let b = end[m];
    if (len(sub(b, a)) > 10) {
      // At least 26 px long, beside the body (away from its centre), inside the frame.
      const mid = scale(add(a, b), 0.5);
      const d = sub(b, a);
      const u: Vec = scale(d, 1 / len(d));
      const half = Math.max(len(d), 26) / 2;
      a = sub(mid, scale(u, half));
      b = add(mid, scale(u, half));
      let n: Vec = [-u[1], u[0]];
      const centre = scale(add(start.hip, start.shoulder), 0.5);
      if (n[0] * (mid[0] - centre[0]) + n[1] * (mid[1] - centre[1]) < 0) n = scale(n, -1);
      const off = scale(n, 22);
      const clamp = (v: Vec): Vec => [Math.min(Math.max(v[0], 10), SIZE - 10), Math.min(Math.max(v[1], 10), GROUND - 4)];
      const p0 = clamp(add(a, off));
      const p1 = clamp(add(b, off));
      motionYs.push(p0[1], p1[1]);
      motion = arrow(p0, p1, 0);
    }
  }

  const hasFloor = spec.props.some((p) => p.kind === 'floor');
  const shadow = hasFloor
    ? `<ellipse cx="${fmt(start.hip[0])}" cy="${GROUND + 5}" rx="30" ry="4" fill="#000" opacity="0.45">${animatedAttr(list, duration, 'cx', (j) => j.hip[0])}</ellipse>`
    : '';

  const headDef = `cx="${fmt(start.head[0])}" cy="${fmt(start.head[1])}" r="${SEG.head + 1}"`;
  const head =
    `<circle ${headDef} fill="url(#head)" stroke="${INK}" stroke-width="2.5">` +
    animatedAttr(list, duration, 'cx', (j) => j.head[0]) +
    animatedAttr(list, duration, 'cy', (j) => j.head[1]) +
    `</circle>`;

  const farOpacity = front ? 1 : 0.6;
  const farPaint = front ? 'url(#body)' : 'url(#bodyFar)';
  // Frame the picture around what moves: floor exercises become a wide, short
  // panel instead of a square that is two-thirds empty.
  const [vx, vy, vw, vh] = frameBox(spec, list, motionYs);
  const panel = `x="${vx}" y="${vy}" width="${vw}" height="${vh}"`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vx} ${vy} ${vw} ${vh}" width="${vw}" height="${vh}" role="img" aria-label="${escapeAttr(title)}">` +
    `<defs>` +
    `<radialGradient id="bg" cx="50%" cy="38%" r="75%"><stop offset="0" stop-color="#0f2547"/><stop offset="1" stop-color="#040a17"/></radialGradient>` +
    `<pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse"><path d="M20 0H0V20" fill="none" stroke="#1d3b6b" stroke-width="0.6" opacity="0.55"/></pattern>` +
    `<linearGradient id="body" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="${SIZE}"><stop offset="0" stop-color="#9ff0ff"/><stop offset="0.5" stop-color="#4fd8ff"/><stop offset="1" stop-color="#1f8fe0"/></linearGradient>` +
    `<linearGradient id="bodyFar" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="${SIZE}"><stop offset="0" stop-color="#4fa8ff"/><stop offset="1" stop-color="#1d5fb8"/></linearGradient>` +
    `<linearGradient id="metal" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="${SIZE}" y2="0"><stop offset="0" stop-color="#3d6db0"/><stop offset="0.5" stop-color="#9cc8ff"/><stop offset="1" stop-color="#3d6db0"/></linearGradient>` +
    `<radialGradient id="head" cx="35%" cy="30%" r="75%"><stop offset="0" stop-color="#dffaff"/><stop offset="0.45" stop-color="#4fd8ff"/><stop offset="1" stop-color="#1667c4"/></radialGradient>` +
    `<filter id="glow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="2.4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>` +
    defs +
    `</defs>` +
    `<rect ${panel} rx="10" fill="url(#bg)"/>` +
    `<rect ${panel} rx="10" fill="url(#grid)"/>` +
    `<rect x="${vx + 1}" y="${vy + 1}" width="${vw - 2}" height="${vh - 2}" rx="10" fill="none" stroke="${COLOR.body}" stroke-width="1" opacity="0.35"/>` +
    shadow +
    `<g>${spec.props.map(propSvg).join('')}</g>` +
    ghost +
    `<g filter="url(#glow)">` +
    limbUse('legF', WIDTH.far, farPaint, farOpacity) +
    limbUse('armF', WIDTH.far, farPaint, farOpacity) +
    limbUse('torso', WIDTH.torso, 'url(#body)') +
    limbUse('neck', WIDTH.neck, 'url(#body)') +
    head +
    limbUse('legN', WIDTH.near, 'url(#body)') +
    limbUse('armN', WIDTH.near, 'url(#body)') +
    `</g>` +
    motion +
    `</svg>`
  );
}

/** Bounding box of everything drawn (all frames + props), padded, inside the 200×200 stage. */
function frameBox(spec: FigureSpec, list: Frame[], extraYs: number[]): [number, number, number, number] {
  let y0 = Infinity;
  let y1 = -Infinity;
  const grow = (y: number): void => {
    y0 = Math.min(y0, y);
    y1 = Math.max(y1, y);
  };
  for (const y of extraYs) grow(y);
  for (const f of list) for (const v of Object.values(f.joints) as Vec[]) grow(v[1]);
  for (const f of list) grow(f.joints.head[1] - SEG.head - 2);
  for (const p of spec.props) {
    if (p.kind === 'floor') grow(GROUND + 6);
    else if (p.kind === 'bar' || p.kind === 'dipBars') grow(p.y - 4);
    else if (p.kind === 'box') { grow(p.y); grow(p.y + p.h); }
    else if (p.kind === 'pad') { grow(p.y1); grow(p.y2); }
    else if (p.kind === 'arrow') { grow(p.from[1]); grow(p.to[1]); }
    else if (p.kind === 'wall') grow(GROUND);
  }
  // Pad, keep at least half the stage tall so arrows and props fit, stay inside the stage.
  const pad = 16;
  let top = Math.max(0, Math.floor(y0 - pad));
  let bottom = Math.min(SIZE, Math.ceil(y1 + pad));
  const minH = SIZE / 2;
  if (bottom - top < minH) {
    const extra = minH - (bottom - top);
    top = Math.max(0, top - extra);
    bottom = Math.min(SIZE, top + minH);
  }
  return [0, top, SIZE, bottom - top];
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
