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

function propSvg(p: Prop): string {
  switch (p.kind) {
    case 'floor':
      return `<line x1="4" y1="${GROUND + 3}" x2="${SIZE - 4}" y2="${GROUND + 3}" stroke="${COLOR.prop}" stroke-width="3"/>`;
    case 'bar':
      return `<line x1="${p.x1 ?? 30}" y1="${p.y}" x2="${p.x2 ?? 170}" y2="${p.y}" stroke="${COLOR.prop}" stroke-width="5" stroke-linecap="round"/>`;
    case 'dipBars':
      return `<line x1="${p.x1}" y1="${p.y}" x2="${p.x2}" y2="${p.y}" stroke="${COLOR.prop}" stroke-width="6" stroke-linecap="round"/>` +
        `<line x1="${(p.x1 + p.x2) / 2}" y1="${p.y}" x2="${(p.x1 + p.x2) / 2}" y2="${GROUND + 3}" stroke="${COLOR.prop}" stroke-width="3" opacity="0.6"/>`;
    case 'box':
      return `<rect x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}" rx="3" fill="${COLOR.propFill}" stroke="${COLOR.prop}" stroke-width="3"/>`;
    case 'wall':
      return `<line x1="${p.x}" y1="8" x2="${p.x}" y2="${GROUND + 3}" stroke="${COLOR.prop}" stroke-width="4"/>`;
    case 'pad':
      return `<line x1="${p.x}" y1="${p.y1}" x2="${p.x}" y2="${p.y2}" stroke="${COLOR.prop}" stroke-width="7" stroke-linecap="round"/>`;
    case 'arrow': {
      const [x1, y1] = p.from;
      const [x2, y2] = p.to;
      const a = Math.atan2(y2 - y1, x2 - x1);
      const h1: Vec = [x2 - 6 * Math.cos(a - 0.5), y2 - 6 * Math.sin(a - 0.5)];
      const h2: Vec = [x2 - 6 * Math.cos(a + 0.5), y2 - 6 * Math.sin(a + 0.5)];
      return `<polyline points="${pts([p.from, p.to])}" fill="none" stroke="${COLOR.arrow}" stroke-width="2" stroke-dasharray="3 3"/>` +
        `<polyline points="${pts([h1, p.to, h2])}" fill="none" stroke="${COLOR.arrow}" stroke-width="2"/>`;
    }
  }
}

/** An animated polyline (or a static one when there is a single frame). */
function animatedLine(list: Frame[], dur: number, pick: (j: Joints) => Vec[], attrs: string): string {
  const values = list.map((f) => pts(pick(f.joints)));
  const first = values[0]!;
  if (list.length < 2) return `<polyline points="${first}" ${attrs}/>`;
  const keyTimes = list.map((f) => Math.min(f.at / dur, 1).toFixed(4)).join(';');
  return `<polyline points="${first}" ${attrs}><animate attributeName="points" dur="${fmt(dur)}s" repeatCount="indefinite" values="${values.join(';')}" keyTimes="${keyTimes}"/></polyline>`;
}

function animatedHead(list: Frame[], dur: number): string {
  const head = list[0]!.joints.head;
  const base = `cx="${fmt(head[0])}" cy="${fmt(head[1])}" r="${SEG.head}" fill="${COLOR.head}" stroke="${COLOR.body}" stroke-width="4"`;
  if (list.length < 2) return `<circle ${base}/>`;
  const keyTimes = list.map((f) => (Math.min(f.at / dur, 1)).toFixed(4)).join(';');
  const cx = list.map((f) => fmt(f.joints.head[0])).join(';');
  const cy = list.map((f) => fmt(f.joints.head[1])).join(';');
  return `<circle ${base}><animate attributeName="cx" dur="${fmt(dur)}s" repeatCount="indefinite" values="${cx}" keyTimes="${keyTimes}"/><animate attributeName="cy" dur="${fmt(dur)}s" repeatCount="indefinite" values="${cy}" keyTimes="${keyTimes}"/></circle>`;
}

/** Render a figure spec as a standalone animated SVG document. */
export function renderFigure(spec: FigureSpec, title: string): string {
  const { list, duration } = frames(spec);
  const front = spec.view === 'front';
  const limb = `fill="none" stroke-linecap="round" stroke-linejoin="round"`;
  const nearAttrs = `${limb} stroke="${COLOR.body}" stroke-width="5"`;
  const farAttrs = front ? nearAttrs : `${limb} stroke="${COLOR.far}" stroke-width="5" opacity="0.55"`;

  const far = [
    animatedLine(list, duration, (j) => [j.hipF, j.kneeF, j.ankleF, j.toeF], farAttrs),
    animatedLine(list, duration, (j) => [j.shoulderF, j.elbowF, j.handF], farAttrs),
  ];
  const torso = front
    ? animatedLine(list, duration, (j) => [j.shoulderF, j.shoulderN, j.shoulder, j.hip, j.hipF, j.hipN], `${limb} stroke="${COLOR.body}" stroke-width="6"`)
    : animatedLine(list, duration, (j) => [j.hip, j.shoulder], `${limb} stroke="${COLOR.body}" stroke-width="7"`);
  const near = [
    animatedLine(list, duration, (j) => [j.hipN, j.kneeN, j.ankleN, j.toeN], nearAttrs),
    animatedLine(list, duration, (j) => [j.shoulderN, j.elbowN, j.handN], nearAttrs),
  ];
  const neck = animatedLine(list, duration, (j) => [j.shoulder, j.head], `${limb} stroke="${COLOR.body}" stroke-width="5"`);

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIZE} ${SIZE}" width="${SIZE}" height="${SIZE}" role="img" aria-label="${escapeAttr(title)}">` +
    `<defs><filter id="glow" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>` +
    `<g>${spec.props.map(propSvg).join('')}</g>` +
    `<g filter="url(#glow)">${far.join('')}${torso}${neck}${animatedHead(list, duration)}${near.join('')}</g>` +
    `</svg>`
  );
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
