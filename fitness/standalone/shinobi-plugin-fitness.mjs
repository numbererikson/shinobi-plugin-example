// shinobi-plugin-fitness — "The System". Single-file bundle generated from src/ (npm run bundle).
// Install from the Shinobi dashboard (Plugins → Catalog) or drop this file into ~/.shinobi/plugins/.
// Needs Shinobi 0.13+ for the full page (figures, forms, theme); tools work on any host with registry.state.

// src/figure.ts
var SIZE = 200;
var GROUND = 186;
var SEG = {
  torso: 50,
  neck: 7,
  head: 8.5,
  upperArm: 26,
  forearm: 24,
  thigh: 38,
  shin: 36,
  foot: 11
};
var SHOULDER_HALF = 11;
var HIP_HALF = 7;
var STEPS = 8;
var COLOR = {
  body: "#4fd8ff",
  prop: "#2b5799",
  propFill: "#0d1a33",
  arrow: "#ffcf5c"
};
var rad = (deg) => deg * Math.PI / 180;
var dir = (deg) => [Math.sin(rad(deg)), Math.cos(rad(deg))];
var add = (a, b) => [a[0] + b[0], a[1] + b[1]];
var sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
var scale = (v, k) => [v[0] * k, v[1] * k];
var step = (from, deg, len2) => add(from, scale(dir(deg), len2));
var len = (v) => Math.hypot(v[0], v[1]);
function reach(root, target, a, b, bend) {
  const d0 = sub(target, root);
  const dist = Math.min(Math.max(len(d0), Math.abs(a - b) + 0.01), a + b - 0.01);
  const u = len(d0) > 0 ? scale(d0, 1 / len(d0)) : [0, 1];
  const end = add(root, scale(u, dist));
  const alpha = Math.acos(Math.min(Math.max((a * a + dist * dist - b * b) / (2 * a * dist), -1), 1)) * bend;
  const r = [u[0] * Math.cos(alpha) - u[1] * Math.sin(alpha), u[0] * Math.sin(alpha) + u[1] * Math.cos(alpha)];
  return [add(root, scale(r, a)), end];
}
function limb(root, spec, a, b) {
  if (Array.isArray(spec)) {
    const mid = step(root, spec[0], a);
    return [mid, step(mid, spec[1], b)];
  }
  return reach(root, spec.to, a, b, spec.bend ?? 1);
}
function solve(pose, view = "side") {
  const armF = pose.armF ?? pose.armN;
  const legF = pose.legF ?? pose.legN;
  const hip0 = [0, 0];
  const shoulder0 = step(hip0, pose.torso, SEG.torso);
  const across = view === "front" ? dir(pose.torso + 90) : [0, 0];
  const angleLimbs = {};
  const raw = (root, spec, a, b, mid, end) => {
    if (!Array.isArray(spec)) return;
    const [m, e] = limb(root, spec, a, b);
    angleLimbs[mid] = m;
    angleLimbs[end] = e;
  };
  raw(add(shoulder0, scale(across, SHOULDER_HALF)), pose.armN, SEG.upperArm, SEG.forearm, "elbowN", "handN");
  raw(add(shoulder0, scale(across, -SHOULDER_HALF)), armF, SEG.upperArm, SEG.forearm, "elbowF", "handF");
  raw(add(hip0, scale(across, HIP_HALF)), pose.legN, SEG.thigh, SEG.shin, "kneeN", "ankleN");
  raw(add(hip0, scale(across, -HIP_HALF)), legF, SEG.thigh, SEG.shin, "kneeF", "ankleF");
  const torso0 = { hip: hip0, shoulder: shoulder0, head: step(shoulder0, pose.neck ?? pose.torso, SEG.neck + SEG.head) };
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
var lerp = (a, b, t) => a + (b - a) * t;
function blendLimb(a, b, t) {
  if (Array.isArray(a) && Array.isArray(b)) return [lerp(a[0], b[0], t), lerp(a[1], b[1], t)];
  if (!Array.isArray(a) && !Array.isArray(b)) {
    return { to: [lerp(a.to[0], b.to[0], t), lerp(a.to[1], b.to[1], t)], bend: a.bend ?? 1 };
  }
  throw new Error("a limb must be given the same way (angles or target) in every key pose");
}
var ease = (t) => 0.5 - Math.cos(Math.PI * t) / 2;
function blend(a, b, t) {
  const pose = {
    torso: lerp(a.torso, b.torso, t),
    neck: lerp(a.neck ?? a.torso, b.neck ?? b.torso, t),
    armN: blendLimb(a.armN, b.armN, t),
    armF: blendLimb(a.armF ?? a.armN, b.armF ?? b.armN, t),
    legN: blendLimb(a.legN, b.legN, t),
    legF: blendLimb(a.legF ?? a.legN, b.legF ?? b.legN, t),
    footN: lerp(a.footN ?? 90, b.footN ?? 90, t),
    footF: lerp(a.footF ?? 90, b.footF ?? 90, t),
    anchor: { joint: a.anchor.joint, at: [lerp(a.anchor.at[0], b.anchor.at[0], t), lerp(a.anchor.at[1], b.anchor.at[1], t)] }
  };
  return pose;
}
function frames(spec) {
  const view = spec.view ?? "side";
  const keys = spec.keys;
  if (keys.length === 1) return { list: [{ joints: solve(keys[0].pose, view), at: 0 }], duration: 1 };
  const list = [];
  let t = 0;
  for (let i = 0; i < keys.length; i++) {
    const cur = keys[i];
    const next = keys[(i + 1) % keys.length];
    list.push({ joints: solve(cur.pose, view), at: t });
    const hold = cur.hold ?? 0;
    if (hold > 0) {
      t += hold;
      list.push({ joints: solve(cur.pose, view), at: t });
    }
    const move = cur.move ?? spec.move;
    for (let s = 1; s < STEPS; s++) {
      list.push({ joints: solve(blend(cur.pose, next.pose, ease(s / STEPS)), view), at: t + move * s / STEPS });
    }
    t += move;
  }
  list.push({ joints: solve(keys[0].pose, view), at: t });
  return { list, duration: Math.max(t, 0.1) };
}
var fmt = (n) => (Math.round(n * 10) / 10).toString();
var pt = (v) => `${fmt(v[0])},${fmt(v[1])}`;
var pts = (vs) => vs.map(pt).join(" ");
var INK = "#020814";
var WIDTH = { near: 8, far: 7, torso: 13, neck: 6, outline: 4 };
function propSvg(p) {
  const metal = `stroke="url(#metal)" stroke-linecap="round"`;
  switch (p.kind) {
    case "floor":
      return `<line x1="6" y1="${GROUND + 4}" x2="${SIZE - 6}" y2="${GROUND + 4}" stroke="${COLOR.prop}" stroke-width="3" stroke-linecap="round"/><line x1="6" y1="${GROUND + 4}" x2="${SIZE - 6}" y2="${GROUND + 4}" stroke="${COLOR.body}" stroke-width="1" opacity="0.5"/>`;
    case "bar": {
      const x1 = p.x1 ?? 30;
      const x2 = p.x2 ?? 170;
      return `<line x1="${x1}" y1="${p.y}" x2="${x1}" y2="${GROUND + 4}" stroke="${COLOR.prop}" stroke-width="4" opacity="0.55"/><line x1="${x2}" y1="${p.y}" x2="${x2}" y2="${GROUND + 4}" stroke="${COLOR.prop}" stroke-width="4" opacity="0.55"/><line x1="${x1 - 4}" y1="${p.y}" x2="${x2 + 4}" y2="${p.y}" ${metal} stroke-width="6"/>`;
    }
    case "dipBars": {
      const mid = (p.x1 + p.x2) / 2;
      return `<line x1="${mid}" y1="${p.y}" x2="${mid}" y2="${GROUND + 4}" stroke="${COLOR.prop}" stroke-width="5" opacity="0.55"/><line x1="${p.x1}" y1="${p.y}" x2="${p.x2}" y2="${p.y}" ${metal} stroke-width="7"/>`;
    }
    case "box":
      return `<rect x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}" rx="4" fill="${COLOR.propFill}" stroke="${COLOR.prop}" stroke-width="3"/><line x1="${p.x + 4}" y1="${p.y + 2}" x2="${p.x + p.w - 4}" y2="${p.y + 2}" stroke="${COLOR.body}" stroke-width="1.5" opacity="0.5"/>`;
    case "wall":
      return `<rect x="${p.x - 3}" y="6" width="6" height="${GROUND - 2}" fill="${COLOR.propFill}" stroke="${COLOR.prop}" stroke-width="2"/>`;
    case "pad":
      return `<line x1="${p.x}" y1="${p.y1}" x2="${p.x}" y2="${p.y2}" stroke="${COLOR.prop}" stroke-width="9" stroke-linecap="round"/>`;
    case "arrow":
      return arrow(p.from, p.to, 0);
  }
}
function arrow(a, b, bow) {
  const d = sub(b, a);
  const l = len(d) || 1;
  const n = [-d[1] / l, d[0] / l];
  const c = add(scale(add(a, b), 0.5), scale(n, bow));
  const t = sub(b, c);
  const tl = len(t) || 1;
  const u = [t[0] / tl, t[1] / tl];
  const side = [-u[1], u[0]];
  const h1 = add(sub(b, scale(u, 7)), scale(side, 4));
  const h2 = add(sub(b, scale(u, 7)), scale(side, -4));
  return `<path d="M${pt(a)} Q${pt(c)} ${pt(b)}" fill="none" stroke="${COLOR.arrow}" stroke-width="2.5" stroke-dasharray="4 3" stroke-linecap="round" opacity="0.9"/><polyline points="${pts([h1, b, h2])}" fill="none" stroke="${COLOR.arrow}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`;
}
var keyTimesOf = (list, dur) => list.map((f) => Math.min(f.at / dur, 1).toFixed(4)).join(";");
function limbDef(id, list, dur, pick2) {
  const values = list.map((f) => pts(pick2(f.joints)));
  if (list.length < 2) return `<polyline id="${id}" points="${values[0]}"/>`;
  return `<polyline id="${id}" points="${values[0]}"><animate attributeName="points" dur="${fmt(dur)}s" repeatCount="indefinite" values="${values.join(";")}" keyTimes="${keyTimesOf(list, dur)}"/></polyline>`;
}
function limbUse(id, width, paint, opacity = 1) {
  const common = `fill="none" stroke-linecap="round" stroke-linejoin="round"`;
  return `<g opacity="${opacity}"><use href="#${id}" ${common} stroke="${INK}" stroke-width="${width + WIDTH.outline}"/><use href="#${id}" ${common} stroke="${paint}" stroke-width="${width}"/></g>`;
}
function animatedAttr(list, dur, attr, value) {
  if (list.length < 2) return "";
  return `<animate attributeName="${attr}" dur="${fmt(dur)}s" repeatCount="indefinite" values="${list.map((f) => fmt(value(f.joints))).join(";")}" keyTimes="${keyTimesOf(list, dur)}"/>`;
}
var MOVING = ["hip", "shoulder", "head", "handN", "ankleN", "kneeN", "elbowN"];
function endPose(spec) {
  if (spec.keys.length < 2) return null;
  const view = spec.view ?? "side";
  const start = solve(spec.keys[0].pose, view);
  let best = null;
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
function renderFigure(spec, title) {
  const { list, duration } = frames(spec);
  const front = spec.view === "front";
  const start = list[0].joints;
  const end = endPose(spec);
  const chains = {
    legF: (j) => [j.hipF, j.kneeF, j.ankleF, j.toeF],
    armF: (j) => [j.shoulderF, j.elbowF, j.handF],
    torso: front ? (j) => [j.shoulderF, j.shoulderN, j.shoulder, j.hip, j.hipF, j.hipN] : (j) => [j.hip, j.shoulder],
    neck: (j) => [j.shoulder, j.head],
    legN: (j) => [j.hipN, j.kneeN, j.ankleN, j.toeN],
    armN: (j) => [j.shoulderN, j.elbowN, j.handN]
  };
  const defs = Object.entries(chains).map(([id, pick2]) => limbDef(id, list, duration, pick2)).join("");
  let ghost = "";
  if (end) {
    const g = (vs, w) => `<polyline points="${pts(vs)}" fill="none" stroke="${COLOR.body}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;
    ghost = `<g opacity="0.14">${Object.entries(chains).map(([id, pick2]) => g(pick2(end), id === "torso" ? WIDTH.torso : WIDTH.near)).join("")}<circle cx="${fmt(end.head[0])}" cy="${fmt(end.head[1])}" r="${SEG.head + 1}" fill="${COLOR.body}"/></g>`;
  }
  let motion = "";
  const motionYs = [];
  if (end && !spec.props.some((p) => p.kind === "arrow")) {
    const disp = (j) => len(sub(end[j], start[j]));
    const pickMax = (js) => js.reduce((a2, b2) => disp(b2) > disp(a2) ? b2 : a2);
    const body = pickMax(["hip", "shoulder", "head"]);
    const limb2 = pickMax(["handN", "ankleN"]);
    const m = disp(limb2) > 1.6 * disp(body) ? limb2 : body;
    let a = start[m];
    let b = end[m];
    if (len(sub(b, a)) > 10) {
      const mid = scale(add(a, b), 0.5);
      const d = sub(b, a);
      const u = scale(d, 1 / len(d));
      const half = Math.max(len(d), 26) / 2;
      a = sub(mid, scale(u, half));
      b = add(mid, scale(u, half));
      let n = [-u[1], u[0]];
      const centre = scale(add(start.hip, start.shoulder), 0.5);
      if (n[0] * (mid[0] - centre[0]) + n[1] * (mid[1] - centre[1]) < 0) n = scale(n, -1);
      const off = scale(n, 22);
      const clamp = (v) => [Math.min(Math.max(v[0], 10), SIZE - 10), Math.min(Math.max(v[1], 10), GROUND - 4)];
      const p0 = clamp(add(a, off));
      const p1 = clamp(add(b, off));
      motionYs.push(p0[1], p1[1]);
      motion = arrow(p0, p1, 0);
    }
  }
  const hasFloor = spec.props.some((p) => p.kind === "floor");
  const shadow = hasFloor ? `<ellipse cx="${fmt(start.hip[0])}" cy="${GROUND + 5}" rx="30" ry="4" fill="#000" opacity="0.45">${animatedAttr(list, duration, "cx", (j) => j.hip[0])}</ellipse>` : "";
  const headDef = `cx="${fmt(start.head[0])}" cy="${fmt(start.head[1])}" r="${SEG.head + 1}"`;
  const head = `<circle ${headDef} fill="url(#head)" stroke="${INK}" stroke-width="2.5">` + animatedAttr(list, duration, "cx", (j) => j.head[0]) + animatedAttr(list, duration, "cy", (j) => j.head[1]) + `</circle>`;
  const farOpacity = front ? 1 : 0.6;
  const farPaint = front ? "url(#body)" : "url(#bodyFar)";
  const [vx, vy, vw, vh] = frameBox(spec, list, motionYs);
  const panel = `x="${vx}" y="${vy}" width="${vw}" height="${vh}"`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vx} ${vy} ${vw} ${vh}" width="${vw}" height="${vh}" role="img" aria-label="${escapeAttr(title)}"><defs><radialGradient id="bg" cx="50%" cy="38%" r="75%"><stop offset="0" stop-color="#0f2547"/><stop offset="1" stop-color="#040a17"/></radialGradient><pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse"><path d="M20 0H0V20" fill="none" stroke="#1d3b6b" stroke-width="0.6" opacity="0.55"/></pattern><linearGradient id="body" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="${SIZE}"><stop offset="0" stop-color="#9ff0ff"/><stop offset="0.5" stop-color="#4fd8ff"/><stop offset="1" stop-color="#1f8fe0"/></linearGradient><linearGradient id="bodyFar" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="${SIZE}"><stop offset="0" stop-color="#4fa8ff"/><stop offset="1" stop-color="#1d5fb8"/></linearGradient><linearGradient id="metal" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="${SIZE}" y2="0"><stop offset="0" stop-color="#3d6db0"/><stop offset="0.5" stop-color="#9cc8ff"/><stop offset="1" stop-color="#3d6db0"/></linearGradient><radialGradient id="head" cx="35%" cy="30%" r="75%"><stop offset="0" stop-color="#dffaff"/><stop offset="0.45" stop-color="#4fd8ff"/><stop offset="1" stop-color="#1667c4"/></radialGradient><filter id="glow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="2.4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>` + defs + `</defs><rect ${panel} rx="10" fill="url(#bg)"/><rect ${panel} rx="10" fill="url(#grid)"/><rect x="${vx + 1}" y="${vy + 1}" width="${vw - 2}" height="${vh - 2}" rx="10" fill="none" stroke="${COLOR.body}" stroke-width="1" opacity="0.35"/>` + shadow + `<g>${spec.props.map(propSvg).join("")}</g>` + ghost + `<g filter="url(#glow)">` + limbUse("legF", WIDTH.far, farPaint, farOpacity) + limbUse("armF", WIDTH.far, farPaint, farOpacity) + limbUse("torso", WIDTH.torso, "url(#body)") + limbUse("neck", WIDTH.neck, "url(#body)") + head + limbUse("legN", WIDTH.near, "url(#body)") + limbUse("armN", WIDTH.near, "url(#body)") + `</g>` + motion + `</svg>`;
}
function frameBox(spec, list, extraYs) {
  let y0 = Infinity;
  let y1 = -Infinity;
  const grow = (y) => {
    y0 = Math.min(y0, y);
    y1 = Math.max(y1, y);
  };
  for (const y of extraYs) grow(y);
  for (const f of list) for (const v of Object.values(f.joints)) grow(v[1]);
  for (const f of list) grow(f.joints.head[1] - SEG.head - 2);
  for (const p of spec.props) {
    if (p.kind === "floor") grow(GROUND + 6);
    else if (p.kind === "bar" || p.kind === "dipBars") grow(p.y - 4);
    else if (p.kind === "box") {
      grow(p.y);
      grow(p.y + p.h);
    } else if (p.kind === "pad") {
      grow(p.y1);
      grow(p.y2);
    } else if (p.kind === "arrow") {
      grow(p.from[1]);
      grow(p.to[1]);
    } else if (p.kind === "wall") grow(GROUND);
  }
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
function escapeAttr(s) {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

// src/exercises.ts
var AREAS = ["shoulder", "elbow", "wrist", "lower_back", "hip", "knee", "ankle"];
var FOOT_Y = GROUND - 1;
var FLOOR_HAND = GROUND - 2;
var at = (x, y) => [x, y];
var floor = { kind: "floor" };
var standing = (x, arms = [6, 4]) => ({
  torso: 180,
  armN: arms,
  armF: [arms[0] - 6, arms[1] - 6],
  legN: [0, 0],
  legF: [3, 3],
  anchor: { joint: "ankleN", at: at(x, FOOT_Y) }
});
var hanging = (legs = [6, -12], legsF) => ({
  torso: 180,
  neck: 158,
  armN: [182, 180],
  armF: [180, 178],
  legN: legs,
  legF: legsF ?? [legs[0] - 4, legs[1] - 4],
  anchor: { joint: "handN", at: at(100, 25) }
});
var bar = { kind: "bar", y: 22 };
var support = (legs = [8, -55]) => ({
  torso: 180,
  armN: [10, 6],
  armF: [8, 4],
  legN: legs,
  legF: [legs[0] - 6, legs[1] - 6],
  anchor: { joint: "handN", at: at(110, 105) }
});
var dipBars = { kind: "dipBars", y: 108, x1: 78, x2: 128 };
var supine = (hipLift, legN, extra = {}) => ({
  torso: -90 + hipLift,
  neck: -90,
  armN: [92, 90],
  legN,
  anchor: { joint: "shoulder", at: at(55, GROUND - 4) },
  ...extra
});
var chair = (legs) => ({
  torso: 180,
  armN: [0, 90],
  armF: [0, 88],
  legN: legs,
  legF: [legs[0] - 4, legs[1] - 4],
  anchor: { joint: "shoulder", at: at(90, 55) }
});
var chairProps = [
  { kind: "pad", x: 80, y1: 52, y2: 108 },
  { kind: "dipBars", y: 84, x1: 84, x2: 122 }
];
var plank = (torso, ankle, hand, foot = 25) => ({
  torso,
  armN: { to: hand, bend: -1 },
  armF: { to: [hand[0] - 3, hand[1]], bend: -1 },
  legN: [torso - 180, torso - 180],
  footN: foot,
  footF: foot,
  anchor: { joint: "ankleN", at: ankle }
});
var EXERCISES = [
  // ---------- legs ----------
  {
    id: "wall_sit",
    name: "Wall Sit",
    kind: "hold",
    sets: 3,
    min: 30,
    max: 60,
    restSec: 60,
    equipment: "wall",
    stress: { knee: 2, hip: 1 },
    cues: ["Back flat against the wall, feet a step in front of you.", "Slide down until your thighs are level with the floor.", "Knees stay over your ankles; breathe slowly."],
    mistake: "Sliding only halfway down, or letting the knees drift in front of the toes.",
    figure: {
      props: [floor, { kind: "wall", x: 66 }],
      keys: [{ pose: { torso: 180, armN: [40, 95], legN: [90, 0], legF: [88, -2], anchor: { joint: "ankleN", at: at(112, FOOT_Y) } } }],
      move: 1
    }
  },
  {
    id: "squat",
    name: "Bodyweight Squat",
    kind: "reps",
    sets: 3,
    min: 12,
    max: 20,
    restSec: 60,
    equipment: "none",
    stress: { knee: 2, hip: 1, ankle: 1 },
    cues: ["Feet shoulder-width, toes slightly out.", "Sit back and down as if onto a low chair; chest up.", "Push the floor away through your whole foot to stand."],
    mistake: "Heels lifting off the floor or knees caving inwards.",
    figure: {
      props: [floor],
      keys: [
        { pose: standing(100), hold: 0.4 },
        { pose: { torso: 145, armN: [88, 92], armF: [84, 88], legN: [85, -25], legF: [82, -27], anchor: { joint: "ankleN", at: at(100, FOOT_Y) } }, hold: 0.3 }
      ],
      move: 1.3
    }
  },
  {
    id: "split_squat",
    name: "Split Squat",
    kind: "reps",
    sets: 3,
    min: 8,
    max: 12,
    perSide: true,
    restSec: 60,
    equipment: "none",
    stress: { knee: 2, hip: 2, ankle: 1 },
    cues: ["Long step: front foot flat, back foot on its toes.", "Drop the back knee straight down until it almost touches the floor.", "Torso upright; drive up through the front heel."],
    mistake: "Stance too short, so the front knee shoots far past the toes.",
    figure: {
      props: [floor],
      keys: [
        { pose: { torso: 178, armN: [4, 2], legN: [16, 0], legF: { to: at(62, FOOT_Y - 8), bend: -1 }, footF: 40, anchor: { joint: "ankleN", at: at(128, FOOT_Y) } }, hold: 0.3 },
        { pose: { torso: 178, armN: [4, 2], legN: [82, -10], legF: { to: at(62, FOOT_Y - 8), bend: -1 }, footF: 40, anchor: { joint: "ankleN", at: at(128, FOOT_Y) } }, hold: 0.3 }
      ],
      move: 1.3
    }
  },
  {
    id: "bulgarian_split_squat",
    name: "Bulgarian Split Squat",
    kind: "reps",
    sets: 3,
    min: 6,
    max: 10,
    perSide: true,
    restSec: 75,
    equipment: "chair",
    stress: { knee: 2, hip: 2, ankle: 1, lower_back: 1 },
    cues: ["Rear foot laces-down on a chair or bench behind you.", "Lower straight down until the front thigh is level.", "Lean slightly forward; most of your weight stays on the front leg."],
    mistake: "Standing too close to the bench, which jams the front knee forward.",
    figure: {
      props: [floor, { kind: "box", x: 18, y: 150, w: 44, h: 39 }],
      keys: [
        { pose: { torso: 172, armN: [4, 2], legN: [12, 0], legF: { to: at(56, 145), bend: -1 }, footF: -100, anchor: { joint: "ankleN", at: at(132, FOOT_Y) } }, hold: 0.3 },
        { pose: { torso: 165, armN: [10, 6], legN: [80, -14], legF: { to: at(56, 145), bend: -1 }, footF: -100, anchor: { joint: "ankleN", at: at(132, FOOT_Y) } }, hold: 0.3 }
      ],
      move: 1.4
    }
  },
  {
    id: "assisted_pistol",
    name: "Assisted Pistol Squat",
    kind: "reps",
    sets: 3,
    min: 4,
    max: 8,
    perSide: true,
    restSec: 90,
    equipment: "tower",
    stress: { knee: 3, hip: 2, ankle: 2 },
    cues: ["Hold the tower upright lightly \u2014 it is for balance, not for pulling.", "Other leg reaches forward as you sit down on one leg.", "Go only as deep as you can control, then stand up."],
    mistake: "Pulling yourself up with the arms instead of pushing with the leg.",
    figure: {
      props: [floor, { kind: "wall", x: 168 }],
      keys: [
        { pose: { torso: 178, armN: { to: at(164, 104), bend: -1 }, armF: { to: at(164, 100), bend: -1 }, legN: [2, 0], legF: [25, 18], anchor: { joint: "ankleN", at: at(100, FOOT_Y) } }, hold: 0.3 },
        { pose: { torso: 140, armN: { to: at(164, 128), bend: -1 }, armF: { to: at(164, 124), bend: -1 }, legN: [80, -35], legF: [88, 92], footF: 120, anchor: { joint: "ankleN", at: at(100, FOOT_Y) } }, hold: 0.3 }
      ],
      move: 1.6
    }
  },
  {
    id: "pistol_squat",
    name: "Pistol Squat",
    kind: "reps",
    sets: 3,
    min: 3,
    max: 6,
    perSide: true,
    restSec: 90,
    equipment: "none",
    stress: { knee: 3, hip: 2, ankle: 2, lower_back: 1 },
    cues: ["Stand on one leg, the other leg and both arms reach forward.", "Sit all the way down under control, heel flat.", "Stand up without bouncing at the bottom."],
    mistake: "Dropping fast into the bottom and losing the heel.",
    figure: {
      props: [floor],
      keys: [
        { pose: { torso: 178, armN: [70, 80], armF: [66, 76], legN: [2, 0], legF: [25, 18], anchor: { joint: "ankleN", at: at(100, FOOT_Y) } }, hold: 0.3 },
        { pose: { torso: 138, armN: [92, 92], armF: [88, 88], legN: [80, -35], legF: [88, 92], footF: 120, anchor: { joint: "ankleN", at: at(100, FOOT_Y) } }, hold: 0.3 }
      ],
      move: 1.6
    }
  },
  // ---------- hinge ----------
  {
    id: "glute_bridge",
    name: "Glute Bridge",
    kind: "reps",
    sets: 3,
    min: 12,
    max: 20,
    restSec: 60,
    equipment: "none",
    stress: { hip: 1, lower_back: 1 },
    cues: ["Lie on your back, knees bent, feet flat near your hips.", "Squeeze your glutes and lift the hips until knees, hips and shoulders line up.", "Pause one second at the top, lower slowly."],
    mistake: "Arching the lower back instead of lifting with the glutes.",
    figure: {
      props: [floor],
      keys: [
        { pose: supine(0, { to: at(138, FOOT_Y), bend: -1 }), hold: 0.3 },
        { pose: supine(20, { to: at(138, FOOT_Y), bend: -1 }), hold: 0.8 }
      ],
      move: 1.1
    }
  },
  {
    id: "single_leg_glute_bridge",
    name: "Single-Leg Glute Bridge",
    kind: "reps",
    sets: 3,
    min: 8,
    max: 15,
    perSide: true,
    restSec: 60,
    equipment: "none",
    stress: { hip: 2, lower_back: 1 },
    cues: ["One foot flat, the other leg straight and lifted.", "Push through the planted heel and lift the hips level.", "Keep both sides of the pelvis at the same height."],
    mistake: "The hip on the lifted-leg side sagging down.",
    figure: {
      props: [floor],
      keys: [
        { pose: supine(0, { to: at(138, FOOT_Y), bend: -1 }, { legF: [100, 100] }), hold: 0.3 },
        { pose: supine(20, { to: at(138, FOOT_Y), bend: -1 }, { legF: [112, 112] }), hold: 0.8 }
      ],
      move: 1.1
    }
  },
  {
    id: "single_leg_rdl",
    name: "Single-Leg Romanian Deadlift",
    kind: "reps",
    sets: 3,
    min: 6,
    max: 10,
    perSide: true,
    restSec: 60,
    equipment: "none",
    stress: { hip: 2, lower_back: 2, knee: 1, ankle: 1 },
    cues: ["Stand on one leg with a soft knee.", "Hinge at the hip: chest goes forward as the free leg goes back, in one straight line.", "Stop when you feel the back of the thigh stretch, then return."],
    mistake: "Rounding the back to reach lower.",
    figure: {
      props: [floor],
      keys: [
        { pose: { torso: 180, armN: [2, 0], legN: [4, -2], legF: [-6, -8], anchor: { joint: "ankleN", at: at(112, FOOT_Y) } }, hold: 0.3 },
        { pose: { torso: 98, armN: [2, 0], armF: [-2, -2], legN: [8, -4], legF: [-84, -84], footF: -170, anchor: { joint: "ankleN", at: at(112, FOOT_Y) } }, hold: 0.5 }
      ],
      move: 1.6
    }
  },
  // ---------- core ----------
  {
    id: "dead_bug",
    name: "Dead Bug",
    kind: "reps",
    sets: 3,
    min: 6,
    max: 10,
    perSide: true,
    restSec: 45,
    equipment: "none",
    stress: { lower_back: 1 },
    cues: ["On your back, arms up, knees bent 90\xB0 above the hips.", "Press your lower back into the floor and keep it there.", "Slowly reach one arm back and the opposite leg out, then switch."],
    mistake: "The lower back lifting off the floor as the leg goes out.",
    figure: {
      props: [floor],
      keys: [
        { pose: { torso: -90, neck: -90, armN: [180, 180], armF: [178, 178], legN: [180, 90], legF: [178, 88], anchor: { joint: "hip", at: at(112, GROUND - 4) } }, hold: 0.3 },
        { pose: { torso: -90, neck: -90, armN: [-96, -96], armF: [178, 178], legN: [100, 100], legF: [178, 88], anchor: { joint: "hip", at: at(112, GROUND - 4) } }, hold: 0.6 }
      ],
      move: 1.6
    }
  },
  {
    id: "hollow_hold",
    name: "Hollow Body Hold",
    kind: "hold",
    sets: 3,
    min: 20,
    max: 40,
    restSec: 45,
    equipment: "none",
    stress: { lower_back: 2 },
    cues: ["On your back, lower back pressed into the floor.", "Lift shoulders and legs a little; arms reach past your head.", "Hold the banana shape and keep breathing."],
    mistake: "Legs too low for your strength, so the lower back arches up.",
    figure: {
      props: [floor],
      keys: [{ pose: { torso: -102, neck: -105, armN: [-100, -100], armF: [-102, -102], legN: [101, 101], legF: [99, 99], footN: 120, footF: 118, anchor: { joint: "hip", at: at(104, GROUND - 6) } } }],
      move: 1
    }
  },
  {
    id: "knee_raise",
    name: "Captain's Chair Knee Raise",
    kind: "reps",
    sets: 3,
    min: 8,
    max: 15,
    restSec: 60,
    equipment: "tower",
    stress: { shoulder: 1, elbow: 1, lower_back: 1, hip: 1 },
    cues: ["Forearms on the rests, back against the pad, shoulders down.", "Bring the knees up towards the chest.", "Lower slowly \u2014 no swinging."],
    mistake: "Swinging the legs and using momentum.",
    figure: {
      props: [...chairProps],
      keys: [
        { pose: chair([2, 0]), hold: 0.3 },
        { pose: chair([102, 2]), hold: 0.4 }
      ],
      move: 1.2
    }
  },
  {
    id: "leg_raise",
    name: "Captain's Chair Leg Raise",
    kind: "reps",
    sets: 3,
    min: 6,
    max: 12,
    restSec: 60,
    equipment: "tower",
    stress: { shoulder: 1, elbow: 1, lower_back: 2, hip: 2 },
    cues: ["Same position as the knee raise.", "Lift straight legs to hip height.", "Lower in two seconds without swinging."],
    mistake: "Leaning back and arching instead of curling the hips up.",
    figure: {
      props: [...chairProps],
      keys: [
        { pose: chair([2, 2]), hold: 0.3 },
        { pose: chair([90, 90]), hold: 0.4 }
      ],
      move: 1.4
    }
  },
  {
    id: "hanging_knee_raise",
    name: "Hanging Knee Raise",
    kind: "reps",
    sets: 3,
    min: 6,
    max: 12,
    restSec: 75,
    equipment: "tower",
    stress: { shoulder: 2, elbow: 1, wrist: 1, hip: 1, lower_back: 1 },
    cues: ["Hang from the bar, shoulders pulled down away from the ears.", "Bring the knees up past the hips.", "Lower slowly and stop the swing before the next rep."],
    mistake: "Swinging the whole body to get the knees up.",
    figure: {
      props: [bar],
      keys: [
        { pose: hanging([4, -6]), hold: 0.3 },
        { pose: hanging([108, 4], [104, 0]), hold: 0.4 }
      ],
      move: 1.2
    }
  },
  {
    id: "hanging_leg_raise",
    name: "Hanging Leg Raise",
    kind: "reps",
    sets: 3,
    min: 5,
    max: 10,
    restSec: 90,
    equipment: "tower",
    stress: { shoulder: 2, elbow: 1, wrist: 1, hip: 2, lower_back: 2 },
    cues: ["Hang with active shoulders.", "Lift straight legs to hip height or higher.", "Lower under control, no swinging."],
    mistake: "Bending the knees halfway and calling it straight.",
    figure: {
      props: [bar],
      keys: [
        { pose: hanging([4, 4]), hold: 0.3 },
        { pose: hanging([95, 95], [92, 92]), hold: 0.4 }
      ],
      move: 1.4
    }
  },
  // ---------- pull ----------
  {
    id: "dead_hang",
    name: "Dead Hang",
    kind: "hold",
    sets: 3,
    min: 20,
    max: 45,
    restSec: 60,
    equipment: "tower",
    stress: { shoulder: 2, elbow: 1, wrist: 1 },
    cues: ["Overhand grip, hands shoulder-width.", "Hang with straight arms and relaxed legs.", "Breathe; step down before the grip fails."],
    mistake: "Hanging with a painful shoulder \u2014 stop if it pinches.",
    figure: { props: [bar], keys: [{ pose: hanging() }], move: 1 }
  },
  {
    id: "scapular_pullup",
    name: "Scapular Pull-up",
    kind: "reps",
    sets: 3,
    min: 6,
    max: 12,
    restSec: 60,
    equipment: "tower",
    stress: { shoulder: 2, elbow: 1, wrist: 1 },
    cues: ["Start from a dead hang with straight arms.", "Pull the shoulder blades down and back \u2014 the body rises a few centimetres.", "Arms stay straight the whole time."],
    mistake: "Bending the elbows, which turns it into a small pull-up.",
    figure: {
      props: [bar, { kind: "arrow", from: at(140, 120), to: at(140, 100) }],
      keys: [
        { pose: hanging(), hold: 0.3 },
        { pose: { ...hanging(), torso: 186, neck: 176, armN: [174, 186], armF: [172, 184] }, hold: 0.5 }
      ],
      move: 0.8
    }
  },
  {
    id: "negative_pullup",
    name: "Negative Pull-up",
    kind: "reps",
    sets: 3,
    min: 3,
    max: 5,
    restSec: 120,
    equipment: "tower",
    stress: { shoulder: 3, elbow: 2, wrist: 1 },
    cues: ["Jump or step up so your chin is over the bar.", "Lower yourself as slowly as you can \u2014 aim for five seconds.", "Step back up; do not pull up from the bottom."],
    mistake: "Dropping fast in the last half of the way down.",
    figure: {
      props: [bar],
      keys: [
        { pose: { ...hanging([8, -20]), armN: [35, 172], armF: [33, 170] }, hold: 0.4, move: 4 },
        { pose: hanging(), hold: 0.3, move: 0.8 }
      ],
      move: 1
    }
  },
  {
    id: "pullup",
    name: "Pull-up",
    kind: "reps",
    sets: 3,
    min: 3,
    max: 8,
    restSec: 120,
    equipment: "tower",
    stress: { shoulder: 3, elbow: 2, wrist: 1 },
    cues: ["Overhand grip, start from straight arms.", "Pull the elbows down to your sides until the chin passes the bar.", "Lower all the way under control."],
    mistake: "Half reps: not straightening the arms at the bottom.",
    figure: {
      props: [bar],
      keys: [
        { pose: hanging(), hold: 0.3, move: 1.2 },
        { pose: { ...hanging([8, -20]), armN: [35, 172], armF: [33, 170] }, hold: 0.3, move: 1.6 }
      ],
      move: 1.2
    }
  },
  {
    id: "chest_to_bar",
    name: "Chest-to-Bar Pull-up",
    kind: "reps",
    sets: 3,
    min: 3,
    max: 6,
    restSec: 120,
    equipment: "tower",
    stress: { shoulder: 3, elbow: 3, wrist: 1 },
    cues: ["Same grip as a pull-up.", "Pull higher, until your upper chest touches the bar.", "Lean back slightly at the top and keep the elbows driving down."],
    mistake: "Kicking the legs to get higher.",
    figure: {
      props: [bar],
      keys: [
        { pose: hanging(), hold: 0.3, move: 1.3 },
        { pose: { ...hanging([10, -25]), torso: 196, neck: 186, armN: [-30, 150], armF: [-32, 148] }, hold: 0.3, move: 1.6 }
      ],
      move: 1.3
    }
  },
  {
    id: "archer_pullup",
    name: "Archer Pull-up",
    kind: "reps",
    sets: 3,
    min: 2,
    max: 5,
    perSide: true,
    restSec: 150,
    equipment: "tower",
    stress: { shoulder: 3, elbow: 3, wrist: 2 },
    cues: ["Very wide grip on the bar.", "Pull towards one hand while the other arm stays almost straight.", "Lower slowly, then pull to the other side."],
    mistake: 'Bending the "straight" arm so both arms share the work.',
    figure: {
      view: "front",
      props: [{ kind: "bar", y: 22, x1: 20, x2: 180 }],
      keys: [
        { pose: { torso: 180, armN: [219, 219], armF: [141, 141], legN: [-3, -6], legF: [3, 6], anchor: { joint: "handN", at: at(58, 25) } }, hold: 0.3 },
        { pose: { torso: 178, armN: [258, 182], armF: [128, 128], legN: [-3, -6], legF: [3, 6], anchor: { joint: "handN", at: at(58, 25) } }, hold: 0.4 }
      ],
      move: 1.6
    }
  },
  {
    id: "prone_y_raise",
    name: "Prone Y Raise",
    kind: "reps",
    sets: 3,
    min: 8,
    max: 15,
    restSec: 45,
    equipment: "none",
    stress: { shoulder: 1, lower_back: 1 },
    cues: ["Lie face down, arms overhead in a Y, thumbs up.", "Lift the arms a few centimetres by squeezing the shoulder blades down and together.", "Hold one second, lower slowly. No pain allowed."],
    mistake: "Shrugging the shoulders up to the ears.",
    figure: {
      props: [floor],
      keys: [
        { pose: { torso: 90, neck: 92, armN: [92, 92], legN: [-90, -90], footN: -100, anchor: { joint: "hip", at: at(80, GROUND - 4) } }, hold: 0.3 },
        { pose: { torso: 94, neck: 100, armN: [116, 116], armF: [114, 114], legN: [-90, -90], footN: -100, anchor: { joint: "hip", at: at(80, GROUND - 4) } }, hold: 0.8 }
      ],
      move: 1
    }
  },
  // ---------- shoulder care (rehab side quest) ----------
  {
    id: "side_lying_external_rotation",
    name: "Side-Lying External Rotation",
    kind: "reps",
    sets: 1,
    min: 12,
    max: 15,
    perSide: true,
    restSec: 0,
    equipment: "none",
    stress: { shoulder: 1 },
    cues: ["Lie on your side, top elbow bent 90\xB0 and tucked against your ribs (a rolled towel under it helps).", "Keep the elbow glued to your side and rotate the forearm up towards the ceiling.", "Lower slowly. Small, smooth and completely pain-free."],
    mistake: "Letting the elbow lift off the body \u2014 then the shoulder does the wrong job.",
    figure: {
      props: [floor],
      keys: [
        { pose: { torso: -90, neck: -96, armN: [94, 66], armF: [-96, -96], legN: [82, 100], legF: [84, 102], anchor: { joint: "hip", at: at(118, GROUND - 12) } }, hold: 0.3 },
        { pose: { torso: -90, neck: -96, armN: [94, 172], armF: [-96, -96], legN: [82, 100], legF: [84, 102], anchor: { joint: "hip", at: at(118, GROUND - 12) } }, hold: 0.6 }
      ],
      move: 1.4
    }
  },
  {
    id: "scapular_pushup",
    name: "Scapular Push-up",
    kind: "reps",
    sets: 1,
    min: 10,
    max: 15,
    restSec: 0,
    equipment: "none",
    stress: { shoulder: 1, wrist: 1 },
    cues: ["Top of a push-up (or on your knees), arms locked straight.", "Let the chest sink a little so the shoulder blades come together.", "Push the floor away so they spread apart \u2014 arms never bend."],
    mistake: "Bending the elbows; the whole movement is in the shoulder blades.",
    figure: {
      props: [floor, { kind: "arrow", from: at(128, 128), to: at(128, 110) }],
      keys: [
        { pose: plank(111, at(30, FOOT_Y - 8), at(148, FLOOR_HAND)), hold: 0.4 },
        { pose: plank(114, at(30, FOOT_Y - 8), at(148, FLOOR_HAND)), hold: 0.6 }
      ],
      move: 1
    }
  },
  // ---------- dip ----------
  {
    id: "support_hold",
    name: "Support Hold",
    kind: "hold",
    sets: 3,
    min: 15,
    max: 40,
    restSec: 60,
    equipment: "tower",
    stress: { shoulder: 2, elbow: 1, wrist: 2 },
    cues: ["Hands on the dip handles, arms locked straight.", "Push the shoulders down, away from your ears.", "Knees bent, body still. Breathe."],
    mistake: "Shoulders sinking up towards the ears.",
    figure: { props: [dipBars], keys: [{ pose: support() }], move: 1 }
  },
  {
    id: "negative_dip",
    name: "Negative Dip",
    kind: "reps",
    sets: 3,
    min: 3,
    max: 5,
    restSec: 120,
    equipment: "tower",
    stress: { shoulder: 3, elbow: 2, wrist: 2 },
    cues: ["Start at the top of a support hold.", "Lower slowly for about four seconds, leaning a little forward.", "Stop when the upper arms are level with the floor, then step back up."],
    mistake: "Going deeper than the shoulder is comfortable with.",
    figure: {
      props: [dipBars],
      keys: [
        { pose: { torso: 180, armN: { to: at(103, 105), bend: 1 }, armF: { to: at(100, 105), bend: 1 }, legN: [8, -55], legF: [2, -60], anchor: { joint: "shoulder", at: at(103, 55) } }, hold: 0.3, move: 3.5 },
        { pose: { torso: 166, armN: { to: at(103, 105), bend: 1 }, armF: { to: at(100, 105), bend: 1 }, legN: [12, -60], legF: [6, -64], anchor: { joint: "shoulder", at: at(106, 84) } }, hold: 0.3, move: 0.9 }
      ],
      move: 1
    }
  },
  {
    id: "dip",
    name: "Dip",
    kind: "reps",
    sets: 3,
    min: 5,
    max: 12,
    restSec: 120,
    equipment: "tower",
    stress: { shoulder: 3, elbow: 2, wrist: 2 },
    cues: ["From a support hold, lean slightly forward.", "Lower until the upper arms are about level with the floor.", "Press back up to straight arms."],
    mistake: "Dropping too deep, which strains the front of the shoulder.",
    figure: {
      props: [dipBars],
      keys: [
        { pose: { torso: 180, armN: { to: at(103, 105), bend: 1 }, armF: { to: at(100, 105), bend: 1 }, legN: [8, -55], legF: [2, -60], anchor: { joint: "shoulder", at: at(103, 55) } }, hold: 0.3, move: 1.6 },
        { pose: { torso: 166, armN: { to: at(103, 105), bend: 1 }, armF: { to: at(100, 105), bend: 1 }, legN: [12, -60], legF: [6, -64], anchor: { joint: "shoulder", at: at(106, 84) } }, hold: 0.2, move: 1.1 }
      ],
      move: 1.2
    }
  },
  // ---------- L-sit ----------
  {
    id: "tuck_l_sit",
    name: "Tuck L-sit",
    kind: "hold",
    sets: 3,
    min: 10,
    max: 20,
    restSec: 60,
    equipment: "tower",
    stress: { shoulder: 2, wrist: 2, elbow: 1, hip: 1 },
    cues: ["Support hold on the dip handles.", "Pull the knees up to the chest so the feet leave everything.", "Shoulders down, arms locked, hold."],
    mistake: "Bending the arms to make it easier.",
    figure: { props: [dipBars], keys: [{ pose: support([112, 2]) }], move: 1 }
  },
  {
    id: "l_sit",
    name: "L-sit",
    kind: "hold",
    sets: 3,
    min: 8,
    max: 20,
    restSec: 75,
    equipment: "tower",
    stress: { shoulder: 2, wrist: 2, elbow: 1, hip: 2 },
    cues: ["Support hold, then lift straight legs to hip height.", "Toes pointed, knees locked.", "If the legs drop, go back to the tuck for the rest of the set."],
    mistake: "Leaning far back with bent arms.",
    figure: { props: [dipBars], keys: [{ pose: support([90, 90]) }], move: 1 }
  },
  // ---------- push ----------
  {
    id: "wall_pushup",
    name: "Wall Push-up",
    kind: "reps",
    sets: 3,
    min: 12,
    max: 20,
    restSec: 45,
    equipment: "wall",
    stress: { shoulder: 1, wrist: 1 },
    cues: ["Hands on the wall at chest height, a big step away.", "Body straight from heels to head; bend the elbows towards the wall.", "Elbows point back, not out to the sides."],
    mistake: "Hips sagging or sticking out.",
    figure: {
      props: [floor, { kind: "wall", x: 162 }],
      keys: [
        { pose: { torso: 162, armN: { to: at(158, 72), bend: -1 }, legN: [-18, -18], footN: 60, footF: 60, anchor: { joint: "ankleN", at: at(72, FOOT_Y - 6) } }, hold: 0.3 },
        { pose: { torso: 150, armN: { to: at(158, 72), bend: -1 }, legN: [-30, -30], footN: 60, footF: 60, anchor: { joint: "ankleN", at: at(72, FOOT_Y - 6) } }, hold: 0.3 }
      ],
      move: 1.1
    }
  },
  {
    id: "incline_pushup",
    name: "Incline Push-up",
    kind: "reps",
    sets: 3,
    min: 8,
    max: 15,
    restSec: 60,
    equipment: "chair",
    stress: { shoulder: 1, elbow: 1, wrist: 1 },
    cues: ["Hands on a sturdy bench or the seat of a chair against the wall.", "Body straight; lower the chest to the edge.", "Push back up to straight arms."],
    mistake: "Only the head moves down while the body stays up.",
    figure: {
      props: [floor, { kind: "box", x: 140, y: 140, w: 50, h: 49 }],
      keys: [
        { pose: plank(125, at(14, FOOT_Y - 6), at(156, 136), 40), hold: 0.3 },
        { pose: plank(115, at(14, FOOT_Y - 6), at(156, 136), 40), hold: 0.3 }
      ],
      move: 1.2
    }
  },
  {
    id: "pushup",
    name: "Push-up",
    kind: "reps",
    sets: 3,
    min: 8,
    max: 15,
    restSec: 75,
    equipment: "none",
    stress: { shoulder: 2, wrist: 2, elbow: 1 },
    cues: ["Hands a bit wider than the shoulders, body in one straight line.", "Lower until the chest is a fist from the floor, elbows about 45\xB0 from the body.", "Push the floor away to straight arms."],
    mistake: "Elbows flared straight out to the sides (hard on the shoulders).",
    figure: {
      props: [floor],
      keys: [
        { pose: plank(111, at(30, FOOT_Y - 8), at(148, FLOOR_HAND)), hold: 0.3 },
        { pose: plank(99, at(30, FOOT_Y - 8), at(148, FLOOR_HAND)), hold: 0.3 }
      ],
      move: 1.1
    }
  },
  {
    id: "deep_pushup",
    name: "Deep Push-up on Handles",
    kind: "reps",
    sets: 3,
    min: 6,
    max: 12,
    restSec: 90,
    equipment: "tower",
    stress: { shoulder: 3, elbow: 1, wrist: 1 },
    cues: ["Grip the push-up handles on the tower base (or two sturdy blocks).", "Lower the chest below the level of the hands.", "Stop before it pinches in the shoulder; press up."],
    mistake: "Going deeper than the shoulder is ready for.",
    figure: {
      props: [floor, { kind: "box", x: 140, y: 172, w: 18, h: 17 }],
      keys: [
        { pose: plank(113, at(30, FOOT_Y - 8), at(149, 170)), hold: 0.3 },
        { pose: plank(96, at(30, FOOT_Y - 8), at(149, 170)), hold: 0.3 }
      ],
      move: 1.3
    }
  },
  {
    id: "decline_pushup",
    name: "Decline Push-up",
    kind: "reps",
    sets: 3,
    min: 6,
    max: 12,
    restSec: 90,
    equipment: "chair",
    stress: { shoulder: 3, wrist: 2, elbow: 2 },
    cues: ["Feet up on a bench or chair, hands on the floor.", "Keep the body straight \u2014 do not pike the hips.", "Lower the forehead/chest towards the floor, press up."],
    mistake: "Hips sagging towards the floor.",
    figure: {
      props: [floor, { kind: "box", x: 6, y: 150, w: 44, h: 39 }],
      keys: [
        { pose: plank(96, at(34, 143), at(150, FLOOR_HAND), 30), hold: 0.3 },
        { pose: plank(85, at(34, 143), at(150, FLOOR_HAND), 30), hold: 0.3 }
      ],
      move: 1.2
    }
  },
  {
    id: "pseudo_planche_pushup",
    name: "Pseudo Planche Push-up",
    kind: "reps",
    sets: 3,
    min: 4,
    max: 8,
    restSec: 120,
    equipment: "none",
    stress: { shoulder: 3, wrist: 3, elbow: 2 },
    cues: ["Hands beside the waist, fingers turned out or back.", "Lean the shoulders well forward of the hands and keep that lean.", "Lower and press while staying leaned forward."],
    mistake: "Losing the forward lean as you push up.",
    figure: {
      props: [floor],
      keys: [
        { pose: plank(110, at(24, FOOT_Y - 8), at(118, FLOOR_HAND)), hold: 0.3 },
        { pose: plank(100, at(24, FOOT_Y - 8), at(118, FLOOR_HAND)), hold: 0.3 }
      ],
      move: 1.3
    }
  },
  // ---------- mobility (recovery quest + warm-ups) ----------
  {
    id: "cat_cow",
    name: "Cat\u2013Cow",
    kind: "reps",
    sets: 1,
    min: 10,
    max: 10,
    restSec: 0,
    equipment: "none",
    stress: { wrist: 1 },
    cues: ["On hands and knees: hands under shoulders, knees under hips.", "Breathe in: let the belly drop and look up (cow).", "Breathe out: round the back towards the ceiling, chin to chest (cat)."],
    mistake: "Rushing \u2014 move with your breath, slowly.",
    figure: {
      props: [floor],
      keys: [
        { pose: { torso: 102, neck: 130, armN: { to: at(130, FLOOR_HAND), bend: -1 }, legN: [0, -90], footN: -90, footF: -90, anchor: { joint: "kneeN", at: at(82, GROUND - 3) } }, hold: 0.6 },
        { pose: { torso: 98, neck: 55, armN: { to: at(130, FLOOR_HAND), bend: -1 }, legN: [0, -90], footN: -90, footF: -90, anchor: { joint: "kneeN", at: at(82, GROUND - 3) } }, hold: 0.6 }
      ],
      move: 1.6
    }
  },
  {
    id: "wall_slide",
    name: "Wall Slide",
    kind: "reps",
    sets: 1,
    min: 10,
    max: 10,
    restSec: 0,
    equipment: "wall",
    stress: { shoulder: 1 },
    cues: ["Back, head and arms against the wall, elbows bent like a W.", "Slide the arms up into a Y without the wrists leaving the wall.", "Slide back down slowly. Stay below any pain."],
    mistake: "Arching the lower back to get the arms higher.",
    figure: {
      view: "front",
      props: [floor],
      keys: [
        { pose: { torso: 180, armN: [-100, 178], armF: [100, 182], legN: [-4, -2], legF: [4, 2], footN: -90, footF: 90, anchor: { joint: "hip", at: at(100, 111) } }, hold: 0.3 },
        { pose: { torso: 180, armN: [-150, -168], armF: [150, 168], legN: [-4, -2], legF: [4, 2], footN: -90, footF: 90, anchor: { joint: "hip", at: at(100, 111) } }, hold: 0.3 }
      ],
      move: 1.6
    }
  },
  {
    id: "deep_squat_hold",
    name: "Deep Squat Hold",
    kind: "hold",
    sets: 1,
    min: 45,
    max: 45,
    restSec: 0,
    equipment: "none",
    stress: { knee: 1, hip: 1, ankle: 1 },
    cues: ["Squat all the way down, heels flat (hold the tower if needed).", "Elbows gently push the knees out.", "Relax and breathe; shift your weight slowly side to side."],
    mistake: "Heels lifting \u2014 put something thin under them for now.",
    figure: {
      props: [floor],
      keys: [{ pose: { torso: 158, armN: [55, 110], armF: [50, 105], legN: [72, -38], legF: [69, -40], anchor: { joint: "ankleN", at: at(102, FOOT_Y) } } }],
      move: 1
    }
  },
  {
    id: "hip_flexor_stretch",
    name: "Half-Kneeling Hip Flexor Stretch",
    kind: "hold",
    sets: 1,
    min: 30,
    max: 30,
    perSide: true,
    restSec: 0,
    equipment: "none",
    stress: { knee: 1 },
    cues: ["Kneel on one knee, the other foot flat in front.", "Squeeze the glute of the back leg and tuck the pelvis under.", "Shift forward gently until the front of the back hip stretches."],
    mistake: "Arching the lower back instead of tucking the pelvis.",
    figure: {
      props: [floor],
      keys: [
        { pose: { torso: 180, armN: [4, 2], legN: [80, 0], legF: [-18, -90], footF: -90, anchor: { joint: "ankleN", at: at(128, FOOT_Y) } }, hold: 0.6 },
        { pose: { torso: 182, armN: [4, 2], legN: [62, -8], legF: [-34, -90], footF: -90, anchor: { joint: "ankleN", at: at(128, FOOT_Y) } }, hold: 1 }
      ],
      move: 1.6
    }
  },
  {
    id: "forward_fold",
    name: "Standing Forward Fold",
    kind: "hold",
    sets: 1,
    min: 30,
    max: 30,
    restSec: 0,
    equipment: "none",
    stress: { lower_back: 1 },
    cues: ["Feet hip-width, knees soft.", "Fold forward from the hips and let the arms and head hang.", "Breathe out and sink a little deeper each breath; roll up slowly."],
    mistake: "Forcing straight knees \u2014 bend them as much as you need.",
    figure: {
      props: [floor],
      keys: [
        { pose: standing(96), hold: 0.4 },
        { pose: { torso: 42, neck: 20, armN: [4, 0], armF: [2, -2], legN: [10, -6], legF: [12, -4], anchor: { joint: "ankleN", at: at(96, FOOT_Y) } }, hold: 1 }
      ],
      move: 2
    }
  }
];
var BY_ID = new Map(EXERCISES.map((e) => [e.id, e]));
function exercise(id) {
  const e = BY_ID.get(id);
  if (!e) throw new Error(`unknown exercise '${id}'`);
  return e;
}
var LADDERS = {
  pull: { id: "pull", name: "Pull", levels: ["dead_hang", "scapular_pullup", "negative_pullup", "pullup", "chest_to_bar", "archer_pullup"], fallback: "pull_floor" },
  pull_floor: { id: "pull_floor", name: "Pull (floor)", levels: ["prone_y_raise"] },
  dip: { id: "dip", name: "Dip", levels: ["support_hold", "negative_dip", "dip"], fallback: "push" },
  push: { id: "push", name: "Push", levels: ["wall_pushup", "incline_pushup", "pushup", "deep_pushup", "decline_pushup", "pseudo_planche_pushup"] },
  legs: { id: "legs", name: "Legs", levels: ["wall_sit", "squat", "split_squat", "bulgarian_split_squat", "assisted_pistol", "pistol_squat"] },
  hinge: { id: "hinge", name: "Hinge", levels: ["glute_bridge", "single_leg_glute_bridge", "single_leg_rdl"] },
  core: { id: "core", name: "Core", levels: ["dead_bug", "hollow_hold", "knee_raise", "leg_raise", "hanging_knee_raise", "hanging_leg_raise"] },
  lsit: { id: "lsit", name: "L-sit", levels: ["support_hold", "tuck_l_sit", "l_sit"], fallback: "core" }
};
var TRACKED_LADDERS = ["pull", "dip", "push", "legs", "hinge", "core", "lsit"];
var WARMUP_A = ["cat_cow", "wall_slide"];
var WARMUP_B = ["deep_squat_hold", "hip_flexor_stretch"];
var RECOVERY = ["cat_cow", "wall_slide", "deep_squat_hold", "hip_flexor_stretch", "forward_fold", "dead_hang"];
var REHAB = {
  shoulder: ["wall_slide", "prone_y_raise", "side_lying_external_rotation", "scapular_pushup"],
  lower_back: ["cat_cow", "dead_bug", "glute_bridge"],
  hip: ["glute_bridge", "cat_cow", "hip_flexor_stretch"],
  knee: ["glute_bridge", "dead_bug"]
};
var REHAB_MAX_PAIN = 6;
var REHAB_NAME = {
  shoulder: "Repair the shoulder",
  elbow: "Repair the elbow",
  wrist: "Repair the wrist",
  lower_back: "Repair the lower back",
  hip: "Repair the hip",
  knee: "Repair the knee",
  ankle: "Repair the ankle"
};

// src/types.ts
var RANKS = ["E", "D", "C", "B", "A", "S"];
var GATE_TESTS = ["pullups", "pushups", "dips", "dead_hang", "hollow_hold", "l_sit"];
var STATE_KEY = "hunter";

// src/rules.ts
var XP = { training: 100, gate: 300, recovery: 30, skill: 150, rank: 500, sideQuest: 20 };
var GATE_EVERY_DAYS = 42;
var DELOAD_EVERY_WEEKS = 5;
var MAX_LOGS = 3e3;
var MAX_EVENTS = 80;
var MAX_HISTORY = 300;
var MAX_QUESTS = 1100;
function addDays(date, days) {
  const d = /* @__PURE__ */ new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function daysBetween(from, to) {
  return Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 864e5);
}
function weekday(date) {
  return (/* @__PURE__ */ new Date(`${date}T12:00:00Z`)).getUTCDay();
}
function newHunter(profile, today, baseline = {}) {
  const state = {
    version: 2,
    startDate: today,
    profile,
    levels: { pull: 0, dip: 0, push: 1, legs: 1, hinge: 0, core: 0, lsit: 0 },
    streaks: {},
    injuries: [],
    logs: [],
    quests: [],
    body: profile.weightKg ? [{ date: today, weightKg: profile.weightKg }] : [],
    gates: [],
    events: [],
    profileHistory: [],
    best: {},
    xp: 0,
    rank: "E",
    // The first training day is the Awakening Gate: real numbers place every ladder.
    nextGate: today,
    notified: {}
  };
  place(state, {
    pushups: baseline.pushups,
    pullups: baseline.pullups,
    dips: baseline.dips,
    dead_hang: baseline.deadHang,
    hollow_hold: baseline.hollowHold,
    l_sit: baseline.lSit
  }, { squats: baseline.squats, wallSit: baseline.wallSit }, 1);
  event(state, today, "awakening", "You have been chosen. The System is now active.");
  return state;
}
var idx = (ladder, id) => LADDERS[ladder].levels.indexOf(id);
function placementFor(results, legs = {}) {
  const out = {};
  const r = results;
  if (r.pullups !== void 0 || r.dead_hang !== void 0) {
    const p = r.pullups ?? 0;
    const hang = r.dead_hang ?? 0;
    out.pull = p >= 15 ? idx("pull", "archer_pullup") : p >= 10 ? idx("pull", "chest_to_bar") : p >= 3 ? idx("pull", "pullup") : p >= 1 || hang >= 30 ? idx("pull", "negative_pullup") : hang >= 15 ? idx("pull", "scapular_pullup") : 0;
  }
  if (r.pushups !== void 0) {
    const p = r.pushups;
    out.push = p >= 45 ? idx("push", "pseudo_planche_pushup") : p >= 30 ? idx("push", "decline_pushup") : p >= 20 ? idx("push", "deep_pushup") : p >= 6 ? idx("push", "pushup") : p >= 1 ? idx("push", "incline_pushup") : 0;
  }
  if (r.dips !== void 0) out.dip = r.dips >= 3 ? idx("dip", "dip") : r.dips >= 1 ? idx("dip", "negative_dip") : 0;
  if (r.l_sit !== void 0) out.lsit = r.l_sit >= 8 ? idx("lsit", "l_sit") : r.l_sit >= 1 ? idx("lsit", "tuck_l_sit") : 0;
  if (r.hollow_hold !== void 0) out.core = r.hollow_hold >= 40 ? idx("core", "knee_raise") : r.hollow_hold >= 15 ? idx("core", "hollow_hold") : 0;
  if (legs.squats !== void 0 || legs.wallSit !== void 0) {
    const s = legs.squats ?? 0;
    out.legs = s >= 40 ? idx("legs", "bulgarian_split_squat") : s >= 20 ? idx("legs", "split_squat") : s >= 8 || (legs.wallSit ?? 0) >= 30 ? idx("legs", "squat") : 0;
  }
  return out;
}
function place(state, results, legs = {}, caution = 0) {
  const clean = {};
  for (const t of GATE_TESTS) {
    const v = results[t];
    if (typeof v === "number" && Number.isFinite(v) && v >= 0) clean[t] = v;
  }
  for (const [ladder, raw] of Object.entries(placementFor(clean, legs))) {
    const level = Math.max(0, raw - caution);
    if (level > state.levels[ladder]) state.levels[ladder] = level;
  }
}
function allowedStress(pain) {
  return pain <= 2 ? 3 : pain <= 4 ? 1 : 0;
}
function worstPain(injuries, area) {
  return injuries.filter((i) => i.area === area).reduce((m, i) => Math.max(m, i.pain), 0);
}
function blockedBy(ex, injuries) {
  for (const area of AREAS) {
    const pain = worstPain(injuries, area);
    if (pain > 0 && (ex.stress[area] ?? 0) > allowedStress(pain)) return { area, pain };
  }
  return null;
}
function hasEquipment(ex, profile) {
  switch (ex.equipment) {
    case "tower":
      return profile.equipment.tower;
    case "chair":
      return profile.equipment.chair;
    default:
      return true;
  }
}
function reportPain(state, today, area, side, pain, note) {
  const p = Math.max(0, Math.min(10, Math.round(pain)));
  const log = state.painLog ??= [];
  const same = log.findIndex((e) => e.date === today && e.area === area && e.side === side);
  if (same >= 0) log.splice(same, 1);
  log.push({ date: today, area, side, pain: p });
  if (log.length > MAX_HISTORY) log.splice(0, log.length - MAX_HISTORY);
  const i = state.injuries.findIndex((x) => x.area === area && x.side === side);
  const label = `${side === "both" ? "" : `${side} `}${area.replace("_", " ")}`;
  if (p === 0) {
    if (i >= 0) {
      state.injuries.splice(i, 1);
      event(state, today, "recovered", `Status effect removed: ${label}. Full training restored for it.`);
    }
    return { healed: true, injury: null };
  }
  const existing = state.injuries[i];
  const injury = { area, side, pain: p, since: existing?.since ?? today, updatedAt: today };
  if (note) injury.note = note.slice(0, 300);
  if (i >= 0) state.injuries[i] = injury;
  else state.injuries.push(injury);
  const mode = allowedStress(p) === 3 ? "train normally, stay below pain" : allowedStress(p) === 1 ? "light work only" : "rest that area";
  event(state, today, "injury", `Status effect: ${label} ${p}/10 \u2014 ${mode}.`);
  return { healed: false, injury };
}
function sideQuestFor(state, exclude) {
  const areas = AREAS.filter((a) => REHAB[a] && state.injuries.some((i) => i.area === a && i.pain >= 1 && i.pain <= REHAB_MAX_PAIN));
  const ids = [];
  for (const a of areas) {
    for (const id of REHAB[a]) {
      if (ids.includes(id) || exclude.has(id)) continue;
      const ex = exercise(id);
      if (!hasEquipment(ex, state.profile)) continue;
      const ok = AREAS.every((area) => {
        const pain = worstPain(state.injuries, area);
        const s = ex.stress[area] ?? 0;
        return pain === 0 || s === 0 || s <= 1 && pain <= REHAB_MAX_PAIN;
      });
      if (ok) ids.push(id);
    }
  }
  return { name: areas.length ? REHAB_NAME[areas[0]] + (areas.length > 1 ? ` (+${areas.length - 1})` : "") : null, ids };
}
function isTrainingDay(state, date) {
  return state.profile.trainingDays.includes(weekday(date));
}
function isDeload(state, date) {
  const week = Math.floor(Math.max(0, daysBetween(state.startDate, date)) / 7);
  return (week + 1) % DELOAD_EVERY_WEEKS === 0;
}
var TEST_EXERCISE = {
  pullups: "pullup",
  pushups: "pushup",
  dips: "dip",
  dead_hang: "dead_hang",
  hollow_hold: "hollow_hold",
  l_sit: "l_sit"
};
function gateTestsFor(state) {
  return GATE_TESTS.filter((t) => {
    const ex = exercise(TEST_EXERCISE[t]);
    if (!hasEquipment(ex, state.profile)) return false;
    return !AREAS.some((area) => (ex.stress[area] ?? 0) > 0 && worstPain(state.injuries, area) > 2);
  });
}
function prescribe(ex, state, deload) {
  const sets = deload ? Math.max(1, ex.sets - 1) : ex.sets;
  if (deload) return Array.from({ length: sets }, () => ex.min);
  const last = [...state.logs].reverse().find((l) => l.exercise === ex.id);
  const unit = ex.kind === "hold" ? 5 : 1;
  const stepUp = last?.feel === "easy" ? 2 * unit : last?.feel === "hard" ? 0 : unit;
  return Array.from({ length: sets }, (_, i) => {
    const prev = last?.sets[i] ?? last?.sets[last.sets.length - 1];
    if (prev === void 0) return ex.min;
    return Math.min(Math.max(prev + stepUp, ex.min), ex.max);
  });
}
function item(ex, state, deload, date, ladder) {
  const q = {
    exercise: ex.id,
    name: ex.name,
    kind: ex.kind,
    sets: deload ? Math.max(1, ex.sets - 1) : ex.sets,
    min: ex.min,
    max: ex.max,
    perSide: ex.perSide === true,
    restSec: ex.restSec,
    target: prescribe(ex, state, deload)
  };
  if (ladder) {
    q.ladder = ladder;
    const levels = LADDERS[ladder].levels;
    q.level = { at: levels.indexOf(ex.id) + 1, of: levels.length };
  }
  const logged = state.logs.filter((l) => l.date === date && l.exercise === ex.id).at(-1);
  if (logged) q.logged = logged.sets;
  return q;
}
function pick(state, ladder, seen = []) {
  const levels = LADDERS[ladder].levels;
  const current = ladder === "pull_floor" ? 0 : state.levels[ladder];
  const intended = exercise(levels[Math.min(current, levels.length - 1)]);
  let reason = "";
  for (let i = Math.min(current, levels.length - 1); i >= 0; i--) {
    const ex = exercise(levels[i]);
    if (!hasEquipment(ex, state.profile)) {
      reason ||= `needs ${ex.equipment === "tower" ? "the power tower" : "a sturdy chair or bench"}`;
      continue;
    }
    const block = blockedBy(ex, state.injuries);
    if (block) {
      reason ||= `${block.area.replace("_", " ")} pain ${block.pain}/10`;
      continue;
    }
    if (ex.id === intended.id) return { ex, ladder };
    return { ex, ladder, note: `Adjusted (${reason}): ${ex.name} instead of ${intended.name}.` };
  }
  const fb = LADDERS[ladder].fallback;
  if (fb && !seen.includes(fb)) {
    const alt = pick(state, fb, [...seen, ladder]);
    if ("ex" in alt) return { ...alt, note: `Adjusted (${reason}): ${alt.ex.name} replaces the ${LADDERS[ladder].name} work today.` };
  }
  return { skip: reason || "not available" };
}
var SESSION_LADDERS = {
  A: ["pull", "push", "legs", "core"],
  B: ["pull", "dip", "hinge", "lsit", "legs"]
};
function usable(state, id) {
  const ex = BY_ID.get(id);
  return !!ex && hasEquipment(ex, state.profile) && blockedBy(ex, state.injuries) === null;
}
function questFor(state, date) {
  const record = state.quests.find((q) => q.date === date);
  const deload = isDeload(state, date);
  const training = isTrainingDay(state, date);
  const gateDue = training && date >= state.nextGate && gateTestsFor(state).length > 0;
  const type = record?.type ?? (gateDue ? "gate" : training ? "training" : "recovery");
  const quest = { date, type, deload, warmup: [], main: [], skipped: [], gateTests: [], sideQuest: [], sideQuestName: null, done: !!record };
  const addSideQuest = () => {
    const used2 = new Set([...quest.warmup, ...quest.main].map((q) => q.exercise));
    const sq = sideQuestFor(state, used2);
    quest.sideQuestName = sq.ids.length ? sq.name : null;
    quest.sideQuest = sq.ids.map((id) => item(exercise(id), state, false, date));
  };
  if (type === "recovery") {
    quest.main = RECOVERY.filter((id) => usable(state, id)).map((id) => item(exercise(id), state, false, date));
    addSideQuest();
    return quest;
  }
  if (type === "gate") {
    quest.warmup = [...WARMUP_A, ...WARMUP_B].filter((id) => usable(state, id)).map((id) => item(exercise(id), state, false, date));
    quest.gateTests = gateTestsFor(state);
    return quest;
  }
  const done = state.quests.filter((q) => q.type === "training" && q.date < date).length;
  const session = record?.session ?? (done % 2 === 0 ? "A" : "B");
  quest.session = session;
  quest.warmup = (session === "A" ? WARMUP_A : WARMUP_B).filter((id) => usable(state, id)).map((id) => item(exercise(id), state, false, date));
  const used = /* @__PURE__ */ new Set();
  for (const ladder of SESSION_LADDERS[session]) {
    let p = pick(state, ladder);
    if ("skip" in p) {
      quest.skipped.push({ ladder, reason: p.skip });
      continue;
    }
    const fb = LADDERS[ladder].fallback;
    if (used.has(p.ex.id) && fb) {
      const alt = pick(state, fb, [ladder]);
      if ("ex" in alt) p = alt;
    }
    if (used.has(p.ex.id)) continue;
    used.add(p.ex.id);
    const q = item(p.ex, state, deload, date, p.ladder);
    if (p.note) q.note = p.note;
    quest.main.push(q);
  }
  addSideQuest();
  return quest;
}
function logSets(state, date, exerciseId, rawSets, feel) {
  const ex = exercise(exerciseId);
  const sets = rawSets.map((n) => Math.max(0, Math.round(n))).slice(0, 10);
  if (sets.length === 0) throw new Error("log at least one set");
  state.logs.push(feel ? { date, exercise: ex.id, sets, feel } : { date, exercise: ex.id, sets });
  if (state.logs.length > MAX_LOGS) state.logs.splice(0, state.logs.length - MAX_LOGS);
  const deload = isDeload(state, date);
  const required = deload ? Math.max(1, ex.sets - 1) : ex.sets;
  const hitTop = sets.length >= required && sets.slice(0, required).every((n) => n >= ex.max);
  const low = sets.filter((n) => n < ex.min).length > sets.length / 2;
  const s = state.streaks[ex.id] ??= { top: 0, low: 0 };
  s.top = hitTop ? s.top + 1 : 0;
  s.low = low ? s.low + 1 : 0;
  const result = { exercise: ex.id, sets, unlocked: [], recalibrated: [], hitTop };
  for (const ladder of TRACKED_LADDERS) {
    const levels = LADDERS[ladder].levels;
    if (levels[state.levels[ladder]] !== ex.id) continue;
    const at2 = state.levels[ladder];
    if (s.top >= 2 && !deload && at2 < levels.length - 1) {
      const next = exercise(levels[at2 + 1]);
      state.levels[ladder] = at2 + 1;
      state.xp += XP.skill;
      result.unlocked.push({ ladder, from: ex.id, to: next.id });
      event(state, date, "skill_unlocked", `Skill unlocked: ${next.name}. (+${XP.skill} XP)`);
    } else if (s.low >= 2 && at2 > 0) {
      const prev = exercise(levels[at2 - 1]);
      state.levels[ladder] = at2 - 1;
      result.recalibrated.push({ ladder, from: ex.id, to: prev.id });
      event(state, date, "recalibration", `Recalibrating: back to ${prev.name} to build the base.`);
    }
  }
  if (result.unlocked.length || result.recalibrated.length) state.streaks[ex.id] = { top: 0, low: 0 };
  return result;
}
function hunterLevel(xp) {
  return Math.floor((1 + Math.sqrt(1 + 8 * Math.max(0, xp) / 100)) / 2);
}
function xpForLevel(level) {
  return 50 * level * (level - 1);
}
function addXp(state, date, amount) {
  const before = hunterLevel(state.xp);
  state.xp += amount;
  const after = hunterLevel(state.xp);
  if (after > before) event(state, date, "level_up", `Level up! You are now level ${after}.`);
}
function completeQuest(state, date) {
  const existing = state.quests.find((q) => q.date === date);
  if (existing) return { already: true, xp: 0, type: existing.type };
  const quest = questFor(state, date);
  if (quest.type === "gate") throw new Error("Today is a Gate: log the test results with plugin_fitness_gate to clear it.");
  const xp = quest.type === "training" ? XP.training : XP.recovery;
  const record = { date, type: quest.type, xp };
  if (quest.session) record.session = quest.session;
  state.quests.push(record);
  if (state.quests.length > MAX_QUESTS) state.quests.splice(0, state.quests.length - MAX_QUESTS);
  event(state, date, "quest_complete", `${quest.type === "training" ? `Daily Quest (Training ${quest.session})` : "Recovery Quest"} complete. (+${xp} XP)`);
  addXp(state, date, xp);
  return { already: false, xp, type: quest.type };
}
function streak(state, today) {
  const dates = new Set(state.quests.map((q) => q.date));
  let day = dates.has(today) ? today : addDays(today, -1);
  let n = 0;
  while (dates.has(day)) {
    n++;
    day = addDays(day, -1);
  }
  return n;
}
var RANK_REQS = {
  D: [{ test: "pushups", min: 15 }, { test: "hollow_hold", min: 20 }, { ladder: "legs", level: "split_squat" }, { test: "pullups", min: 3, tower: true }, { test: "dead_hang", min: 30, tower: true }],
  C: [{ test: "pushups", min: 25 }, { test: "hollow_hold", min: 40 }, { ladder: "legs", level: "bulgarian_split_squat" }, { test: "pullups", min: 8, tower: true }, { test: "dips", min: 8, tower: true }, { test: "dead_hang", min: 45, tower: true }],
  B: [{ test: "pushups", min: 35 }, { ladder: "legs", level: "assisted_pistol" }, { test: "pullups", min: 12 }, { test: "dips", min: 15 }, { test: "dead_hang", min: 60 }, { test: "l_sit", min: 10 }, { ladder: "core", level: "hanging_knee_raise" }],
  A: [{ test: "pushups", min: 45 }, { ladder: "legs", level: "pistol_squat" }, { test: "pullups", min: 16 }, { test: "dips", min: 22 }, { test: "l_sit", min: 20 }, { ladder: "pull", level: "chest_to_bar" }, { ladder: "core", level: "hanging_leg_raise" }],
  S: [{ test: "pushups", min: 50 }, { ladder: "legs", level: "pistol_squat" }, { test: "pullups", min: 20 }, { test: "dips", min: 30 }, { test: "l_sit", min: 30 }, { ladder: "pull", level: "archer_pullup" }, { ladder: "push", level: "pseudo_planche_pushup" }]
};
function meets(state, req) {
  if (req.tower && !state.profile.equipment.tower) return true;
  if (req.test) return (state.best[req.test] ?? 0) >= (req.min ?? 0);
  if (req.ladder && req.level) return state.levels[req.ladder] >= LADDERS[req.ladder].levels.indexOf(req.level);
  return true;
}
function rankFor(state) {
  let rank = "E";
  for (const r of RANKS.slice(1)) {
    if (RANK_REQS[r].every((req) => meets(state, req))) rank = r;
    else break;
  }
  return rank;
}
var reqLabel = (req) => req.test ? `${TEST_LABEL[req.test].replace(/ \(.*\)$/, "")} ${req.min}${req.test === "dead_hang" || req.test === "hollow_hold" || req.test === "l_sit" ? " s" : ""}` : `${LADDERS[req.ladder].name}: reach ${exercise(req.level).name}`;
function rankChecklist(state) {
  const next = RANKS[RANKS.indexOf(state.rank) + 1];
  if (!next) return null;
  const items = RANK_REQS[next].filter((req) => !(req.tower && !state.profile.equipment.tower)).map((req) => {
    const item2 = { label: reqLabel(req), met: meets(state, req) };
    if (req.test && state.best[req.test] !== void 0) item2.best = state.best[req.test];
    return item2;
  });
  return { rank: next, items };
}
function nextRankNeeds(state) {
  const c = rankChecklist(state);
  return c ? { rank: c.rank, missing: c.items.filter((i) => !i.met).map((i) => i.label) } : null;
}
var questLabel = (type, session) => type === "training" ? `Training ${session ?? ""}`.trim() : type === "gate" ? "Gate" : "Recovery";
function weekPlan(state, today) {
  const monday = addDays(today, -((weekday(today) + 6) % 7));
  const trainingsBefore = state.quests.filter((q) => q.type === "training" && q.date < today).length;
  let futureTrainings = 0;
  let gatePlanned = false;
  return Array.from({ length: 7 }, (_, i) => {
    const date = addDays(monday, i);
    const record = state.quests.find((q) => q.date === date);
    if (record) return { date, label: questLabel(record.type, record.session), status: date === today ? "today" : "done" };
    if (date < today) {
      return { date, label: isTrainingDay(state, date) ? "Training" : "Recovery", status: date < state.startDate ? "before" : "missed" };
    }
    if (date === today) {
      const q = questFor(state, date);
      if (q.type === "gate") gatePlanned = true;
      if (q.type === "training") futureTrainings++;
      return { date, label: questLabel(q.type, q.session), status: "today" };
    }
    if (!isTrainingDay(state, date)) return { date, label: "Recovery", status: "planned" };
    if (!gatePlanned && date >= state.nextGate && gateTestsFor(state).length) {
      gatePlanned = true;
      return { date, label: "Gate", status: "planned" };
    }
    const session = (trainingsBefore + futureTrainings) % 2 === 0 ? "A" : "B";
    futureTrainings++;
    return { date, label: `Training ${session}`, status: "planned" };
  });
}
function ladderProgress(state) {
  return TRACKED_LADDERS.map((id) => {
    const levels = LADDERS[id].levels;
    const at2 = state.levels[id];
    const ex = exercise(levels[at2]);
    const next = levels[at2 + 1] ? exercise(levels[at2 + 1]) : null;
    const p = {
      ladder: id,
      name: LADDERS[id].name,
      level: at2 + 1,
      of: levels.length,
      current: ex.name,
      next: next?.name ?? null,
      needs: next ? `${ex.sets} \xD7 ${ex.max}${ex.kind === "hold" ? " s" : ""}${ex.perSide ? " per side" : ""} in 2 sessions` : null,
      top: Math.min(state.streaks[ex.id]?.top ?? 0, 2)
    };
    if (!hasEquipment(ex, state.profile)) p.held = ex.equipment === "tower" ? "needs the power tower" : "needs a chair or bench";
    else {
      const b = blockedBy(ex, state.injuries);
      if (b) p.held = `${b.area.replace("_", " ")} pain ${b.pain}/10`;
    }
    return p;
  });
}
var TEST_LABEL = {
  pullups: "Pull-ups (max, strict)",
  pushups: "Push-ups (max, strict)",
  dips: "Dips (max)",
  dead_hang: "Dead hang (seconds)",
  hollow_hold: "Hollow hold (seconds)",
  l_sit: "L-sit or tuck L-sit (seconds)"
};
function clearGate(state, date, results) {
  const clean = {};
  for (const t of GATE_TESTS) {
    const v = results[t];
    if (typeof v === "number" && Number.isFinite(v) && v >= 0) clean[t] = Math.round(v);
  }
  if (Object.keys(clean).length === 0) throw new Error("log at least one test result");
  const before = { ...state.levels };
  place(state, clean);
  for (const [t, v] of Object.entries(clean)) state.best[t] = Math.max(state.best[t] ?? 0, v);
  const rankBefore = state.rank;
  const computed = rankFor(state);
  if (RANKS.indexOf(computed) > RANKS.indexOf(state.rank)) state.rank = computed;
  const number = state.gates.length + 1;
  state.gates.push({ date, number, results: clean, rankBefore, rankAfter: state.rank });
  state.nextGate = addDays(date, GATE_EVERY_DAYS);
  const placed = {};
  for (const l of TRACKED_LADDERS) {
    if (state.levels[l] !== before[l]) placed[l] = { from: LADDERS[l].levels[before[l]], to: LADDERS[l].levels[state.levels[l]] };
  }
  if (!state.quests.some((q) => q.date === date)) {
    state.quests.push({ date, type: "gate", xp: XP.gate });
  }
  event(state, date, "gate_cleared", `Gate ${number} cleared. (+${XP.gate} XP)`);
  addXp(state, date, XP.gate);
  if (state.rank !== rankBefore) {
    event(state, date, "rank_up", `Rank up! ${rankBefore} \u2192 ${state.rank}. (+${XP.rank} XP)`);
    addXp(state, date, XP.rank);
  }
  return { number, rankBefore, rankAfter: state.rank, placed };
}
function stats(state, today) {
  const l = state.levels;
  const b = state.best;
  const recent = state.quests.filter((q) => daysBetween(q.date, today) < 28).length;
  const trainings = state.quests.filter((q) => q.type !== "recovery").length;
  return {
    STR: 10 + 4 * l.pull + 3 * l.push + 4 * l.dip + (b.pullups ?? 0) + Math.floor((b.pushups ?? 0) / 3) + Math.floor((b.dips ?? 0) / 2),
    AGI: 10 + 4 * l.core + 6 * l.lsit + Math.floor((b.hollow_hold ?? 0) / 5) + Math.floor((b.l_sit ?? 0) / 2),
    VIT: 10 + 5 * l.legs + 4 * l.hinge + Math.floor(trainings / 4),
    END: 10 + Math.floor((b.dead_hang ?? 0) / 3) + 2 * recent + 2 * Math.floor(streak(state, today) / 7)
  };
}
function updateProfile(state, today, patch) {
  const changed = [];
  const p = state.profile;
  const set = (field, value) => {
    if (value === void 0 || JSON.stringify(p[field]) === JSON.stringify(value)) return;
    state.profileHistory.push({ date: today, field, from: p[field], to: value });
    p[field] = value;
    changed.push(field);
  };
  set("name", patch.name);
  set("age", patch.age);
  set("heightCm", patch.heightCm);
  set("weightKg", patch.weightKg);
  set("trainingDays", patch.trainingDays);
  set("questTime", patch.questTime);
  set("eveningWarning", patch.eveningWarning);
  set("timezone", patch.timezone);
  for (const key of ["tower", "chair"]) {
    const v = patch[key];
    if (v === void 0 || p.equipment[key] === v) continue;
    state.profileHistory.push({ date: today, field: `equipment.${key}`, from: p.equipment[key], to: v });
    p.equipment = { ...p.equipment, [key]: v };
    changed.push(`equipment.${key}`);
    if (key === "tower" && v) {
      state.nextGate = today;
      event(state, today, "equipment", "New equipment detected: power tower. A Gate will open on your next training day.");
    }
  }
  if (patch.weightKg !== void 0 || patch.waistCm !== void 0) {
    const entry = state.body.find((b) => b.date === today) ?? { date: today };
    if (patch.weightKg !== void 0) entry.weightKg = patch.weightKg;
    if (patch.waistCm !== void 0) entry.waistCm = patch.waistCm;
    if (!state.body.includes(entry)) state.body.push(entry);
    if (patch.waistCm !== void 0 && !changed.includes("waistCm")) changed.push("waistCm");
  }
  if (state.profileHistory.length > MAX_HISTORY) state.profileHistory.splice(0, state.profileHistory.length - MAX_HISTORY);
  return changed;
}
function event(state, date, kind, text) {
  state.events.push({ date, kind, text });
  if (state.events.length > MAX_EVENTS) state.events.splice(0, state.events.length - MAX_EVENTS);
}
var DAY_NAMES = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
function parseDays(v) {
  if (v === void 0 || v === null || v === "") return void 0;
  const parts = Array.isArray(v) ? v : String(v).split(/[\s,;/]+/);
  const days = /* @__PURE__ */ new Set();
  for (const part of parts) {
    const s = String(part).trim().toLowerCase();
    if (!s) continue;
    const n = /^\d$/.test(s) ? Number(s) % 7 : DAY_NAMES.indexOf(s.slice(0, 3));
    if (n < 0) throw new Error(`unknown day '${String(part)}' \u2014 use mon,tue,\u2026 or 0-6 (0 = Sunday)`);
    days.add(n);
  }
  if (days.size === 0) throw new Error("pick at least one training day");
  return [...days].sort((a, b) => a - b);
}
function formatDays(days) {
  return days.map((d) => DAY_NAMES[d].replace(/^./, (c) => c.toUpperCase())).join(", ");
}
function parseTime(v) {
  if (v === void 0 || v === null || v === "") return void 0;
  const m = /^(\d{1,2})[:.](\d{2})$/.exec(String(v).trim());
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) throw new Error(`time '${String(v)}' must look like 10:30`);
  return `${m[1].padStart(2, "0")}:${m[2]}`;
}

// src/session.ts
var TRIAL_REST = 120;
function lightReason(r) {
  const why = [];
  if (r.sleep === "poor") why.push("poor sleep");
  if (r.soreness === "heavy") why.push("heavy soreness");
  return why.length ? why.join(" and ") : null;
}
var stepOf = (q, kind, light) => {
  const work = kind === "work";
  const sets = work ? light ? Math.max(1, q.sets - 1) : q.sets : 1;
  const s = {
    kind,
    exercise: q.exercise,
    sets,
    target: work ? light ? Array.from({ length: sets }, () => q.min) : q.target : [q.target[0] ?? q.min],
    done: [],
    restSec: work ? q.restSec : 0
  };
  if (q.ladder) s.ladder = q.ladder;
  if (q.note) s.note = q.note;
  return s;
};
function startSession(state, date, now, readiness = {}) {
  const a = state.active;
  if (a && a.date === date) {
    if (a.finished && a.finished.outcome !== "abandoned") throw new Error("Today's quest is already finished.");
    if (!a.finished) return a;
  }
  const quest = questFor(state, date);
  if (quest.done) throw new Error("Today's quest is already complete.");
  const light = quest.type === "training" ? lightReason(readiness) : null;
  const steps = quest.warmup.map((w) => stepOf(w, "warmup", false));
  if (quest.type === "gate") {
    for (const t of quest.gateTests) {
      steps.push({ kind: "trial", exercise: TEST_EXERCISE[t], test: t, sets: 1, target: [], done: [], restSec: TRIAL_REST });
    }
  } else {
    for (const m of quest.main) steps.push(stepOf(m, quest.type === "recovery" ? "recovery" : "work", !!light));
    for (const r of quest.sideQuest) steps.push(stepOf(r, "rehab", false));
  }
  if (steps.length === 0) throw new Error("Nothing to do today with the current equipment and injuries.");
  const session = { date, type: quest.type, steps, cursor: 0, startedAt: now.toISOString() };
  if (quest.session) session.session = quest.session;
  if (light) session.light = light;
  if (quest.type !== "gate" && quest.sideQuest.length && quest.sideQuestName) session.sideQuest = quest.sideQuestName;
  state.active = session;
  return session;
}
function activeToday(state, date) {
  return state.active && state.active.date === date ? state.active : null;
}
function running(state, date) {
  const a = activeToday(state, date);
  if (!a || a.finished) throw new Error("No quest in progress. Start it first (plugin_fitness_start).");
  return a;
}
function restLeft(a, now) {
  if (!a.restUntil) return 0;
  return Math.max(0, Math.ceil((Date.parse(a.restUntil) - now.getTime()) / 1e3));
}
function startRest(a, now, seconds) {
  if (seconds > 0) {
    a.restUntil = new Date(now.getTime() + seconds * 1e3).toISOString();
    a.restSec = seconds;
  } else {
    delete a.restUntil;
    delete a.restSec;
  }
}
function advance(state, a, date, now, rest) {
  a.cursor++;
  if (a.cursor >= a.steps.length) {
    finish(state, a, date, now);
    return;
  }
  startRest(a, now, rest);
}
function recordSet(state, date, now, value, feel) {
  const a = running(state, date);
  const step2 = a.steps[a.cursor];
  step2.done.push(Math.max(0, Math.round(value)));
  if (feel && step2.kind === "work") step2.feel = feel;
  if (step2.done.length < step2.sets) startRest(a, now, step2.restSec);
  else advance(state, a, date, now, step2.restSec);
  return a;
}
function skipRest(state, date) {
  const a = running(state, date);
  delete a.restUntil;
  delete a.restSec;
  return a;
}
function skipStep(state, date, now) {
  const a = running(state, date);
  a.steps[a.cursor].skipped = true;
  advance(state, a, date, now, 0);
  return a;
}
function endSession(state, date, now) {
  const a = running(state, date);
  for (const s of a.steps.slice(a.cursor)) if (s.done.length === 0) s.skipped = true;
  finish(state, a, date, now);
  return a;
}
function finish(state, a, date, now) {
  delete a.restUntil;
  delete a.restSec;
  const levelBefore = hunterLevel(state.xp);
  const rankBefore = state.rank;
  const xpBefore = state.xp;
  const summary = {
    at: now.toISOString(),
    outcome: "complete",
    xp: 0,
    levelBefore,
    levelAfter: levelBefore,
    rankBefore,
    rankAfter: rankBefore,
    unlocked: [],
    recalibrated: [],
    logged: [],
    skipped: a.steps.filter((s) => s.skipped).map((s) => exercise(s.exercise).name)
  };
  if (a.type === "gate") {
    const results = {};
    for (const s of a.steps) if (s.kind === "trial" && s.test && s.done.length) results[s.test] = s.done[0];
    if (Object.keys(results).length) {
      clearGate(state, date, results);
      summary.outcome = "gate";
      summary.logged = a.steps.filter((s) => s.kind === "trial" && s.done.length).map((s) => ({ exercise: s.exercise, sets: s.done }));
    } else {
      summary.outcome = "abandoned";
    }
  } else {
    const work = a.steps.filter((s) => s.kind === "work" && s.done.length > 0);
    for (const s of work) {
      const r = logSets(state, date, s.exercise, s.done, s.feel);
      summary.logged.push({ exercise: s.exercise, sets: s.done });
      summary.unlocked.push(...r.unlocked.map((u) => exercise(u.to).name));
      summary.recalibrated.push(...r.recalibrated.map((u) => exercise(u.to).name));
    }
    const rehabDone = a.steps.some((s) => s.kind === "rehab" && s.done.length > 0);
    const didSomething = a.type === "recovery" ? a.steps.some((s) => s.kind === "recovery" && s.done.length > 0) || rehabDone : work.length > 0;
    if (didSomething) {
      completeQuest(state, date);
      if (rehabDone && a.sideQuest) {
        event(state, date, "quest_complete", `Side quest complete: ${a.sideQuest}. (+${XP.sideQuest} XP)`);
        addXp(state, date, XP.sideQuest);
        summary.sideQuest = a.sideQuest;
      }
    } else {
      summary.outcome = "abandoned";
    }
  }
  summary.xp = state.xp - xpBefore;
  summary.levelAfter = hunterLevel(state.xp);
  summary.rankAfter = state.rank;
  a.finished = summary;
}

// src/text.ts
var T = {
  awakening: "[SYSTEM] A new Hunter has been detected.\nThe System trains strength you can carry anywhere: pull, push, legs and core, with your own body weight. No heavy loads, no training to failure \u2014 every exercise climbs a ladder from easy to elite, and you climb it when you own it.\nRegister below. Your first training day is the Awakening Gate: a short test that places you on every ladder.",
  trainingIntro: "Press START and the System walks you through it: warm-up, then every set with its target and the rest between sets. Stop each set with about two reps left in the tank \u2014 clean reps only. Everything is logged for you.",
  recoveryIntro: "Recovery day. Ten easy minutes of mobility keep the joints happy and the streak alive. A 30-minute walk counts as a bonus.",
  gateIntro: "A Gate has opened: a short test. Warm up, then one all-out set of each trial with strict form and full rest between them. The results place you on the ladders and decide your rank.",
  deload: "Deload week: one set fewer, bottom of the range, no level-ups. Recovery is part of the plan.",
  questDone: "[SYSTEM] Quest complete. Rest well, Hunter.",
  notify: {
    questTitle: "[SYSTEM] Daily Quest has arrived",
    recoveryTitle: "[SYSTEM] Recovery Quest has arrived",
    gateTitle: "[SYSTEM] A Gate has opened",
    warningTitle: "[SYSTEM] Warning",
    warningBody: "The Daily Quest is still incomplete. A short quest now keeps your streak alive."
  }
};

// src/page.ts
var figureCache = /* @__PURE__ */ new Map();
function figureSvg(id) {
  let svg = figureCache.get(id);
  if (!svg) {
    const ex = exercise(id);
    svg = renderFigure(ex.figure, ex.name);
    figureCache.set(id, svg);
  }
  return svg;
}
var unitOf = (ex) => ex.kind === "hold" ? "s" : "reps";
var DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
var dayName = (date) => DAY[(/* @__PURE__ */ new Date(`${date}T12:00:00Z`)).getUTCDay()];
var mmss = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
var questTitle = (type, session) => type === "gate" ? "Gate" : type === "training" ? `Training ${session ?? ""}`.trim() : "Recovery";
function figure(ex, opts) {
  const b = {
    type: "figure",
    svg: figureSvg(ex.id),
    alt: `${ex.name} \u2014 animated demonstration`,
    bullets: [...ex.cues, `Avoid: ${ex.mistake}`],
    size: opts.size ?? "md"
  };
  if (opts.title) b.title = opts.title;
  if (opts.caption) b.caption = opts.caption;
  if (opts.collapsed && opts.title) b.collapsed = true;
  return b;
}
function renderPage(state, today, now, defaultTimezone) {
  if (!state) return { blocks: awakening(defaultTimezone) };
  const active = activeToday(state, today);
  const running2 = active && !active.finished ? active : null;
  const blocks = [];
  let refreshSeconds;
  if (running2) {
    const r = runningBlocks(running2, now);
    blocks.push(...r.blocks);
    refreshSeconds = r.refreshSeconds;
  } else if (active?.finished) {
    blocks.push(...completeBlocks(state, active, today));
  } else {
    blocks.push(...startBlocks(state, today));
  }
  if (running2) return refreshSeconds ? { blocks, refreshSeconds } : { blocks };
  blocks.push({ type: "divider" }, ...statusBlocks(state, today));
  blocks.push({ type: "divider" }, ...pathBlocks(state, today));
  blocks.push({ type: "divider" }, ...codexBlocks(state));
  blocks.push({ type: "divider" }, ...historyBlocks(state, today));
  blocks.push({ type: "divider" }, { type: "heading", text: "Profile" }, profileForm(state), painForm());
  return { blocks };
}
function startBlocks(state, today) {
  const q = questFor(state, today);
  const title = `Daily Quest \u2014 ${dayName(today)} \xB7 ${questTitle(q.type, q.session)}`;
  if (q.done) {
    const next = weekPlan(state, addDays(today, 1)).find((d) => d.date === addDays(today, 1));
    return [
      { type: "heading", text: title },
      { type: "text", tone: "ok", text: `${T.questDone}
Tomorrow: ${next?.label ?? "Recovery"}.` }
    ];
  }
  const items = q.type === "gate" ? q.gateTests.map((t) => ({ title: TEST_LABEL[t], subtitle: "one all-out set", badge: "trial" })) : q.main.map((m) => ({
    title: m.name,
    subtitle: `${m.sets} \xD7 ${m.target.join("\xB7")} ${m.kind === "hold" ? "s" : "reps"}${m.perSide ? " per side" : ""}${m.note ? ` \u2014 ${m.note}` : ""}`,
    badge: m.level ? `Lv ${m.level.at}/${m.level.of}` : "",
    tone: m.note ? "warn" : "default"
  }));
  const minutes = q.type === "recovery" ? 10 : q.type === "gate" ? 25 : 10 + q.main.reduce((s, m) => s + Math.round(m.sets * (m.restSec + 40) / 60), 0);
  const blocks = [
    { type: "heading", text: title },
    { type: "text", text: q.type === "gate" ? T.gateIntro : q.type === "training" ? T.trainingIntro : T.recoveryIntro }
  ];
  if (q.deload && q.type === "training") blocks.push({ type: "text", tone: "warn", text: T.deload });
  blocks.push({
    type: "stats",
    items: [
      { label: "Quest", value: questTitle(q.type, q.session) },
      { label: q.type === "gate" ? "Trials" : "Exercises", value: String(items.length), hint: q.warmup.length ? `+ ${q.warmup.length} warm-up` : void 0 },
      { label: "Time", value: `~${minutes} min` },
      { label: "Reward", value: `+${q.type === "gate" ? 300 : q.type === "training" ? 100 : 30} XP`, tone: "ok" }
    ]
  });
  blocks.push({ type: "list", items });
  if (q.type === "gate") {
    const left = GATE_TESTS.filter((t) => !q.gateTests.includes(t));
    if (left.length) blocks.push({ type: "text", tone: "warn", text: `Not tested today (missing equipment or an area that hurts 3/10+): ${left.map((t) => TEST_LABEL[t].replace(/ \(.*\)$/, "")).join(", ")}. They join a later Gate.` });
  }
  if (q.skipped.length) {
    blocks.push({ type: "list", items: q.skipped.map((x) => ({ title: `${LADDERS[x.ladder].name} rests today`, subtitle: x.reason, tone: "warn" })) });
  }
  if (q.sideQuestName && q.sideQuest.length) {
    blocks.push({
      type: "list",
      items: [
        { title: `Side Quest: ${q.sideQuestName}`, subtitle: "gentle care after the main work, pain-free range only", badge: `+${XP.sideQuest} XP`, tone: "ok" },
        ...q.sideQuest.map((m) => ({ title: m.name, subtitle: `${m.target[0]} ${m.kind === "hold" ? "s" : "reps"}${m.perSide ? " per side" : ""}`, tone: "muted" }))
      ]
    });
  }
  if (q.type === "gate") {
    blocks.push({ type: "actions", buttons: [{ label: "\u25B6  ENTER THE GATE", tool: "plugin_fitness_start", variant: "primary" }] });
  } else {
    blocks.push({
      type: "form",
      title: "Quick check before you start",
      tool: "plugin_fitness_start",
      button: "\u25B6  START QUEST",
      fields: [
        { name: "sleep", label: "How did you sleep?", kind: "select", value: "good", options: [{ value: "good", label: "Well" }, { value: "ok", label: "So-so" }, { value: "poor", label: "Badly" }] },
        { name: "soreness", label: "Sore muscles?", kind: "select", value: "none", options: [{ value: "none", label: "No" }, { value: "some", label: "A little" }, { value: "heavy", label: "A lot" }] }
      ]
    });
  }
  return blocks;
}
function stepLabel(s) {
  return s.kind === "warmup" ? "Warm-up" : s.kind === "trial" ? "Gate trial" : s.kind === "recovery" ? "Mobility" : s.kind === "rehab" ? "Side quest" : "Exercise";
}
function runningBlocks(a, now) {
  const step2 = a.steps[a.cursor];
  const ex = exercise(step2.exercise);
  const totalSets = a.steps.reduce((n, s) => n + s.sets, 0);
  const doneSets = a.steps.reduce((n, s) => n + (s.skipped ? s.sets : s.done.length), 0);
  const blocks = [
    { type: "heading", text: `${questTitle(a.type, a.session)} \u2014 step ${a.cursor + 1} of ${a.steps.length}` },
    { type: "progress", label: `${doneSets} of ${totalSets} sets`, value: doneSets, max: totalSets }
  ];
  if (a.light) blocks.push({ type: "text", tone: "warn", text: `Light day (${a.light}): one set fewer, bottom of the range. Showing up still counts.` });
  const rest = restLeft(a, now);
  const setNo = step2.done.length + 1;
  const target = step2.target[step2.done.length] ?? step2.target[step2.target.length - 1];
  const perSide = ex.perSide ? " per side" : "";
  if (rest > 0) {
    blocks.push({
      type: "stats",
      items: [
        { label: "Rest", value: mmss(rest), tone: "ok", hint: "breathe, shake it out" },
        { label: "Next", value: `${ex.name}`, hint: `set ${setNo} of ${step2.sets}${target !== void 0 ? ` \xB7 ${target} ${unitOf(ex)}${perSide}` : ""}` }
      ]
    });
    blocks.push({ type: "progress", label: "Rest", value: (a.restSec ?? rest) - rest, max: a.restSec ?? rest, hint: mmss(rest) });
    blocks.push({ type: "actions", buttons: [{ label: "Skip rest  \u23ED", tool: "plugin_fitness_skip", args: { what: "rest" }, variant: "primary" }] });
    blocks.push(figure(ex, { title: `Next up: ${ex.name}`, size: "md" }));
    return { blocks, refreshSeconds: 2 };
  }
  const what = step2.kind === "trial" ? `ONE all-out set with clean form. Stop when the form breaks.` : `Set ${setNo} of ${step2.sets} \u2014 target ${target} ${unitOf(ex)}${perSide}${ex.kind === "hold" ? " (hold)" : ""}`;
  blocks.push(figure(ex, { title: `${stepLabel(step2)} \xB7 ${ex.name}`, caption: [what, step2.note ? `\u26A0 ${step2.note}` : ""].filter(Boolean).join("\n"), size: "lg" }));
  blocks.push({
    type: "form",
    tool: "plugin_fitness_set",
    button: step2.kind === "trial" ? "\u2713  Record" : step2.sets > 1 ? `\u2713  Set ${setNo} done` : "\u2713  Done",
    fields: [
      {
        name: "value",
        label: ex.kind === "hold" ? "Seconds held" : `Reps done${perSide}`,
        kind: "number",
        min: 0,
        max: 900,
        unit: unitOf(ex),
        ...step2.kind === "trial" ? { required: true } : { value: target }
      },
      // Last set of an exercise: how did it feel? Steers the next target.
      ...step2.kind === "work" && setNo === step2.sets ? [{ name: "feel", label: "How did this exercise feel?", kind: "select", value: "ok", options: [{ value: "ok", label: "Just right" }, { value: "easy", label: "Too easy" }, { value: "hard", label: "Too hard" }] }] : []
    ]
  });
  blocks.push({
    type: "actions",
    buttons: [
      { label: "Skip this exercise", tool: "plugin_fitness_skip", args: { what: "exercise" }, confirm: `Skip ${ex.name}?` },
      { label: "End quest", tool: "plugin_fitness_end", variant: "danger", confirm: "End the quest now? What you did so far is saved." }
    ]
  });
  const upcoming = a.steps.slice(a.cursor + 1);
  if (upcoming.length) {
    blocks.push({
      type: "list",
      items: upcoming.map((s) => ({
        title: exercise(s.exercise).name,
        subtitle: s.kind === "trial" ? "Gate trial \xB7 one all-out set" : `${stepLabel(s)} \xB7 ${s.sets} \xD7 ${s.target.join("\xB7")} ${unitOf(exercise(s.exercise))}`,
        tone: "muted"
      }))
    });
  }
  return { blocks };
}
function completeBlocks(state, a, today) {
  const f = a.finished;
  const blocks = [];
  if (f.outcome === "abandoned") {
    blocks.push({ type: "heading", text: "Quest ended" }, { type: "text", tone: "warn", text: "Nothing was logged, so the quest stays open. Start it again any time today." });
    blocks.push({ type: "actions", buttons: [{ label: "\u25B6  START AGAIN", tool: "plugin_fitness_start", variant: "primary" }] });
    return blocks;
  }
  blocks.push({ type: "heading", text: f.outcome === "gate" ? "Gate cleared" : "Quest complete" });
  blocks.push({
    type: "stats",
    items: [
      { label: "XP gained", value: `+${f.xp}`, tone: "ok" },
      { label: "Level", value: f.levelAfter > f.levelBefore ? `${f.levelBefore} \u2192 ${f.levelAfter}` : String(f.levelAfter), tone: f.levelAfter > f.levelBefore ? "ok" : "default" },
      { label: "Rank", value: f.rankAfter !== f.rankBefore ? `${f.rankBefore} \u2192 ${f.rankAfter}` : f.rankAfter, tone: f.rankAfter !== f.rankBefore ? "ok" : "default" },
      { label: "Streak", value: `${streak(state, today)} days` }
    ]
  });
  const items = [
    ...f.sideQuest ? [{ title: `Side quest complete: ${f.sideQuest}`, badge: `+${XP.sideQuest} XP`, tone: "ok" }] : [],
    ...f.unlocked.map((n) => ({ title: `Skill unlocked: ${n}`, badge: "new", tone: "ok" })),
    ...f.recalibrated.map((n) => ({ title: `Recalibrated to ${n}`, subtitle: "build the base, then climb again", tone: "warn" })),
    ...f.logged.map((l) => ({ title: exercise(l.exercise).name, subtitle: l.sets.join(" \xB7 ") })),
    ...f.skipped.map((n) => ({ title: `${n} \u2014 skipped`, tone: "muted" }))
  ];
  if (items.length) blocks.push({ type: "list", items });
  for (const i of state.injuries) {
    const where = `${i.side === "both" ? "" : `${i.side} `}${i.area.replace("_", " ")}`;
    blocks.push({
      type: "form",
      title: `How does your ${where} feel now?`,
      tool: "plugin_fitness_pain",
      button: "Update",
      args: { area: i.area, side: i.side },
      fields: [{ name: "pain", label: "Pain (0 = gone)", kind: "slider", min: 0, max: 10, value: i.pain, unit: "/10", hint: `It was ${i.pain}/10. At 2 or less the full exercises come back.` }]
    });
  }
  const tomorrow = weekPlan(state, addDays(today, 1)).find((d) => d.date === addDays(today, 1));
  blocks.push({ type: "text", text: `[SYSTEM] Well done, Hunter. Tomorrow: ${tomorrow?.label ?? "Recovery"}.` });
  return blocks;
}
function statusBlocks(state, today) {
  const level = hunterLevel(state.xp);
  const s = stats(state, today);
  const st = streak(state, today);
  const base = xpForLevel(level);
  const blocks = [
    { type: "heading", text: "Status Window" },
    {
      type: "stats",
      items: [
        { label: "Hunter", value: state.profile.name || "Unnamed", hint: `Day ${daysBetween(state.startDate, today) + 1}` },
        { label: "Rank", value: state.rank, tone: "ok" },
        { label: "Level", value: String(level), hint: `${state.xp} XP` },
        { label: "Streak", value: `${st} day${st === 1 ? "" : "s"}`, tone: st > 0 ? "ok" : "muted" },
        { label: "STR", value: String(s.STR), hint: "pull \xB7 push \xB7 dip" },
        { label: "AGI", value: String(s.AGI), hint: "core \xB7 L-sit" },
        { label: "VIT", value: String(s.VIT), hint: "legs \xB7 hinge" },
        { label: "END", value: String(s.END), hint: "hang \xB7 consistency" }
      ]
    },
    { type: "progress", label: `Level ${level} \u2192 ${level + 1}`, value: state.xp - base, max: xpForLevel(level + 1) - base, hint: `${state.xp - base} / ${xpForLevel(level + 1) - base} XP` }
  ];
  if (state.injuries.length) {
    blocks.push({
      type: "list",
      items: state.injuries.map((i) => ({
        title: `${i.side === "both" ? "" : `${i.side} `}${i.area.replace("_", " ")} \u2014 ${i.pain}/10`,
        subtitle: `since ${i.since}${i.note ? ` \xB7 ${i.note}` : ""} \xB7 ${i.pain <= 2 ? "train, stay below pain" : i.pain <= 4 ? "light work only" : "rest this area"} \xB7 update it in the Profile section`,
        badge: "Status effect",
        tone: i.pain >= 5 ? "error" : "warn"
      }))
    });
  }
  return blocks;
}
function pathBlocks(state, today) {
  const week = weekPlan(state, today);
  const mark = { done: "\u2713", today: "\u25B6", planned: "", missed: "\u2717", before: "" };
  const blocks = [
    { type: "heading", text: "Your Path" },
    {
      type: "table",
      columns: week.map((d) => `${dayName(d.date)} ${d.date.slice(8)}.`),
      rows: [week.map((d) => `${mark[d.status]} ${d.label}`.trim())]
    },
    {
      type: "text",
      tone: "muted",
      text: `Training days: ${formatDays(state.profile.trainingDays)} at ${state.profile.questTime}. Every exercise climbs a ladder: hit the top of its range in two sessions and the next one unlocks. Every 5th week is a lighter deload week.`
    }
  ];
  blocks.push({
    type: "list",
    items: ladderProgress(state).map((p) => ({
      title: `${p.name}: ${p.current}`,
      subtitle: p.held ? `On hold \u2014 ${p.held}. A lighter exercise stands in until then.` : p.next ? `Next: ${p.next} \u2014 ${p.needs} (${p.top}/2 done)` : "Top of this ladder \u2014 keep it sharp.",
      badge: `${p.level}/${p.of}`,
      tone: p.held ? "warn" : p.top > 0 ? "ok" : "default"
    }))
  });
  const check = rankChecklist(state);
  const gateIn = daysBetween(today, state.nextGate);
  if (check) {
    blocks.push({
      type: "list",
      items: check.items.map((i) => ({
        title: `${i.met ? "\u2713" : "\u25CB"} ${i.label}`,
        subtitle: i.best !== void 0 ? `best so far: ${i.best}` : void 0,
        tone: i.met ? "ok" : "default"
      })),
      empty: "All requirements met."
    });
    blocks.push({
      type: "text",
      tone: "muted",
      text: `Rank ${check.rank} needs everything above. Ranks are decided at Gates \u2014 ${gateIn <= 0 ? "one is open now" : `next Gate on ${state.nextGate} (in ${gateIn} day${gateIn === 1 ? "" : "s"})`}.`
    });
  } else {
    blocks.push({ type: "text", tone: "ok", text: "Rank S. There is nothing above you." });
  }
  return blocks;
}
function codexBlocks(state) {
  const blocks = [{ type: "heading", text: "Skill Codex" }, { type: "text", tone: "muted", text: "Every exercise in the System. Open one to see how it moves." }];
  const seen = /* @__PURE__ */ new Set();
  for (const l of Object.values(LADDERS)) {
    l.levels.forEach((id, i) => {
      if (seen.has(id)) return;
      seen.add(id);
      const ex = exercise(id);
      const tracked = l.id !== "pull_floor" ? state.levels[l.id] : 0;
      const tag = i < tracked ? " \u2713" : i === tracked ? " \u25C0 you are here" : "";
      blocks.push(figure(ex, { title: `${l.name} ${i + 1} \xB7 ${ex.name}${tag}`, caption: `${ex.sets} \xD7 ${ex.min}\u2013${ex.max} ${unitOf(ex)}${ex.perSide ? " per side" : ""}`, collapsed: true }));
    });
  }
  for (const ex of EXERCISES) {
    if (seen.has(ex.id)) continue;
    blocks.push(figure(ex, { title: `Mobility \xB7 ${ex.name}`, caption: `${ex.min} ${unitOf(ex)}${ex.perSide ? " per side" : ""}`, collapsed: true }));
  }
  return blocks;
}
function historyBlocks(state, today) {
  const blocks = [{ type: "heading", text: "History" }];
  const weeks = Array.from({ length: 12 }, (_, i) => addDays(today, -7 * (11 - i)));
  const volume = weeks.map((end) => {
    const start = addDays(end, -6);
    return state.logs.filter((l) => l.date >= start && l.date <= end && exercise(l.exercise).kind === "reps").reduce((sum, l) => sum + l.sets.reduce((a, b) => a + b, 0), 0);
  });
  if (volume.some((v) => v > 0)) {
    blocks.push({ type: "chart", kind: "bar", title: "Reps per week", labels: weeks.map((w) => w.slice(5)), series: [{ name: "Reps", values: volume }] });
  }
  const pains = (state.painLog ?? []).slice(-120);
  if (pains.length >= 2) {
    const dates = [...new Set(pains.map((p) => p.date))].sort().slice(-60);
    const keys = [...new Set(pains.map((p) => `${p.side === "both" ? "" : `${p.side} `}${p.area.replace("_", " ")}`))].slice(0, 4);
    blocks.push({
      type: "chart",
      kind: "line",
      title: "Pain",
      unit: "/10",
      labels: dates.map((d) => d.slice(5)),
      series: keys.map((k) => ({
        name: k,
        values: dates.map((d) => {
          const e = pains.filter((p) => p.date === d && `${p.side === "both" ? "" : `${p.side} `}${p.area.replace("_", " ")}` === k).at(-1);
          return e ? e.pain : null;
        })
      }))
    });
  }
  const body = state.body.filter((b) => b.weightKg !== void 0).slice(-60);
  if (body.length >= 2) {
    blocks.push({ type: "chart", kind: "line", title: "Weight", unit: "kg", labels: body.map((b) => b.date.slice(5)), series: [{ name: "Weight", values: body.map((b) => b.weightKg ?? null) }] });
  }
  if (state.gates.length) {
    blocks.push({
      type: "table",
      columns: ["Gate", "Date", "Rank", "Results"],
      rows: [...state.gates].reverse().map((g) => [
        `#${g.number}`,
        g.date,
        g.rankBefore === g.rankAfter ? g.rankAfter : `${g.rankBefore} \u2192 ${g.rankAfter}`,
        Object.entries(g.results).map(([k, v]) => `${k.replace("_", " ")} ${v}`).join(", ")
      ])
    });
  }
  blocks.push({
    type: "table",
    columns: ["Date", "Exercise", "Sets"],
    rows: [...state.logs].reverse().slice(0, 15).map((l) => [l.date, exercise(l.exercise).name, l.sets.join(" \xB7 ")]),
    empty: "No sets logged yet \u2014 they appear here after your first quest."
  });
  blocks.push({
    type: "list",
    items: [...state.events].reverse().slice(0, 8).map((e) => ({ title: e.text, subtitle: e.date, badge: e.kind.replace("_", " ") })),
    empty: "The System log is empty."
  });
  return blocks;
}
function profileForm(state) {
  const p = state.profile;
  const waist = [...state.body].reverse().find((b) => b.waistCm !== void 0)?.waistCm;
  return {
    type: "form",
    title: "Hunter profile \u2014 change anything, the System adapts",
    tool: "plugin_fitness_profile",
    button: "Save profile",
    fields: [
      { name: "name", label: "Hunter name", kind: "text", value: p.name ?? "", maxLength: 40 },
      { name: "age", label: "Age", kind: "number", value: p.age, min: 10, max: 100 },
      { name: "height_cm", label: "Height", kind: "number", unit: "cm", value: p.heightCm, min: 100, max: 230 },
      { name: "weight_kg", label: "Weight", kind: "number", unit: "kg", value: p.weightKg, min: 30, max: 250, step: 0.1 },
      { name: "waist_cm", label: "Waist", kind: "number", unit: "cm", value: waist, min: 40, max: 200, step: 0.5, hint: "Optional, at the belly button." },
      { name: "training_days", label: "Training days", kind: "text", value: formatDays(p.trainingDays), hint: "e.g. Mon, Wed, Fri" },
      { name: "quest_time", label: "Daily Quest time", kind: "text", value: p.questTime, hint: "24-hour, e.g. 10:30" },
      { name: "timezone", label: "Time zone", kind: "text", value: p.timezone },
      { name: "evening_warning", label: "Evening warning", kind: "toggle", value: p.eveningWarning, placeholder: "Remind me at 19:30 if the quest is open" },
      { name: "tower", label: "Power tower", kind: "toggle", value: p.equipment.tower, placeholder: "Pull-up bar + dip handles" },
      { name: "chair", label: "Sturdy chair or bench", kind: "toggle", value: p.equipment.chair, placeholder: "Available" }
    ]
  };
}
function painForm() {
  return {
    type: "form",
    title: "Report pain \u2014 0 means it is gone",
    tool: "plugin_fitness_pain",
    button: "Update status",
    fields: [
      { name: "area", label: "Where", kind: "select", options: AREAS.map((a) => ({ value: a, label: a.replace("_", " ") })) },
      { name: "side", label: "Side", kind: "select", options: [{ value: "right", label: "right" }, { value: "left", label: "left" }, { value: "both", label: "both / middle" }] },
      { name: "pain", label: "Pain now", kind: "slider", min: 0, max: 10, value: 0, unit: "/10" },
      { name: "note", label: "Note", kind: "text", maxLength: 200, placeholder: "e.g. hurts on overhead movements" }
    ]
  };
}
function awakening(defaultTimezone) {
  return [
    { type: "heading", text: "Awakening" },
    { type: "text", text: T.awakening },
    {
      type: "form",
      title: "Hunter registration",
      tool: "plugin_fitness_setup",
      button: "Awaken",
      fields: [
        { name: "name", label: "Hunter name", kind: "text", maxLength: 40 },
        { name: "age", label: "Age", kind: "number", min: 10, max: 100, required: true },
        { name: "height_cm", label: "Height", kind: "number", unit: "cm", min: 100, max: 230, required: true },
        { name: "weight_kg", label: "Weight", kind: "number", unit: "kg", min: 30, max: 250, step: 0.1, required: true },
        { name: "pushups", label: "Push-ups in a row (estimate)", kind: "number", min: 0, max: 200, hint: "Leave empty if unsure." },
        { name: "pullups", label: "Pull-ups in a row (estimate)", kind: "number", min: 0, max: 100 },
        { name: "squats", label: "Squats in a row (estimate)", kind: "number", min: 0, max: 300 },
        { name: "training_days", label: "Training days", kind: "text", value: "Mon, Wed, Fri" },
        { name: "quest_time", label: "Daily Quest time", kind: "text", value: "10:30" },
        { name: "timezone", label: "Time zone", kind: "text", value: defaultTimezone },
        { name: "tower", label: "Power tower", kind: "toggle", value: false, placeholder: "I have a pull-up bar + dip handles" },
        { name: "chair", label: "Sturdy chair or bench", kind: "toggle", value: true, placeholder: "Available" },
        { name: "pain_area", label: "Anything that hurts?", kind: "select", options: AREAS.map((a) => ({ value: a, label: a.replace("_", " ") })), hint: "Leave the pain at 0 if nothing hurts." },
        { name: "pain_side", label: "Side", kind: "select", options: [{ value: "right", label: "right" }, { value: "left", label: "left" }, { value: "both", label: "both / middle" }] },
        { name: "pain", label: "Pain level", kind: "slider", min: 0, max: 10, value: 0, unit: "/10" }
      ]
    }
  ];
}

// src/index.ts
var PAGE_ID = "the-system";
var PAGE_URL = `/apps/${PAGE_ID}`;
var WARNING_TIME = "19:30";
function optNum(v, name, min, max) {
  if (v === void 0 || v === null || v === "") return void 0;
  const n = typeof v === "number" ? v : Number(String(v).replace(",", "."));
  if (!Number.isFinite(n) || n < min || n > max) throw new Error(`${name} must be a number between ${min} and ${max}`);
  return n;
}
function optBool(v) {
  if (v === void 0 || v === null || v === "") return void 0;
  if (typeof v === "boolean") return v;
  return ["true", "yes", "1", "on"].includes(String(v).toLowerCase());
}
function optStr(v, max) {
  if (v === void 0 || v === null) return void 0;
  const s = String(v).trim();
  return s ? s.slice(0, max) : void 0;
}
function assertTimeZone(tz) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    throw new Error(`unknown time zone '${tz}' \u2014 use an IANA name such as Europe/Zagreb`);
  }
}
var AREA_ALIASES = { back: "lower_back", "lower back": "lower_back", lowerback: "lower_back", shoulders: "shoulder", knees: "knee", elbows: "elbow", wrists: "wrist", hips: "hip", ankles: "ankle" };
function parseArea(v) {
  const s = String(v ?? "").trim().toLowerCase().replace(/-/g, "_");
  const a = AREAS.includes(s) ? s : AREA_ALIASES[s.replace(/_/g, " ")] ?? AREA_ALIASES[s];
  if (!a) throw new Error(`area must be one of: ${AREAS.join(", ")}`);
  return a;
}
function parseSide(v) {
  const s = String(v ?? "both").trim().toLowerCase();
  if (s === "left" || s === "right" || s === "both") return s;
  throw new Error("side must be 'left', 'right' or 'both'");
}
function parseSets(args) {
  if (Array.isArray(args.sets)) return args.sets.map((n, i) => optNum(n, `set ${i + 1}`, 0, 600) ?? 0);
  const sets = [];
  for (let i = 1; i <= 10; i++) {
    const v = optNum(args[`set${i}`], `set ${i}`, 0, 600);
    if (v !== void 0) sets.push(v);
  }
  return sets;
}
function findExercise(v) {
  const s = String(v ?? "").trim().toLowerCase();
  if (BY_ID.has(s)) return s;
  const byName = EXERCISES.find((e) => e.name.toLowerCase() === s || e.id.replace(/_/g, " ") === s);
  if (byName) return byName.id;
  throw new Error(`unknown exercise '${String(v)}' \u2014 call plugin_fitness_exercise without an id for the list`);
}
function localNow(tz, now) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const get = (t) => parts.find((p) => p.type === t)?.value ?? "00";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, time: `${get("hour")}:${get("minute")}` };
}
function hostTimeZone() {
  const env = typeof process !== "undefined" ? process.env.SHINOBI_TIMEZONE : void 0;
  try {
    return assertTimeZone(env || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
  } catch {
    return "UTC";
  }
}
var describeItem = (q) => {
  const ex = BY_ID.get(q.exercise);
  return {
    exercise: q.exercise,
    name: q.name,
    ...q.ladder ? { ladder: q.ladder, level: q.level } : {},
    prescription: `${q.sets} \xD7 ${q.min}-${q.max} ${q.kind === "hold" ? "seconds" : "reps"}${q.perSide ? " per side" : ""}`,
    today: q.target,
    rest_seconds: q.restSec,
    cues: ex.cues,
    avoid: ex.mistake,
    ...q.note ? { note: q.note } : {},
    ...q.logged ? { logged_today: q.logged } : {}
  };
};
function registerFitness(registry, clock = { now: () => /* @__PURE__ */ new Date() }) {
  const store = registry.state;
  const defaultTz = hostTimeZone();
  const read = () => {
    const s = store.get(STATE_KEY);
    return s && s.version === 2 ? s : null;
  };
  const today = (s) => localNow(s?.profile.timezone ?? defaultTz, clock.now());
  const need = () => {
    const s = read();
    if (!s) throw new Error("No Hunter yet. Run plugin_fitness_setup first (or open The System page in the dashboard).");
    return s;
  };
  const mutate = (fn) => {
    let out;
    store.update(STATE_KEY, (cur) => {
      if (!cur || cur.version !== 2) throw new Error("No Hunter yet. Run plugin_fitness_setup first.");
      out = fn(cur, today(cur).date);
      return cur;
    });
    return out;
  };
  const optDate = (v, s) => {
    if (v === void 0 || v === null || v === "") return today(s).date;
    const d = String(v);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || Number.isNaN(Date.parse(d))) throw new Error("date must be YYYY-MM-DD");
    if (d > today(s).date) throw new Error("date cannot be in the future");
    return d;
  };
  function statusOf(s) {
    const { date } = today(s);
    const level = hunterLevel(s.xp);
    return {
      hunter: s.profile.name ?? null,
      day: Math.round((Date.parse(date) - Date.parse(s.startDate)) / 864e5) + 1,
      rank: s.rank,
      level,
      xp: s.xp,
      xp_to_next_level: xpForLevel(level + 1) - s.xp,
      stats: stats(s, date),
      streak_days: streak(s, date),
      injuries: s.injuries,
      skills: Object.fromEntries(
        TRACKED_LADDERS.map((l) => {
          const levels = LADDERS[l].levels;
          const at2 = s.levels[l];
          return [l, { current: levels[at2], level: at2 + 1, of: levels.length, next: levels[at2 + 1] ?? null }];
        })
      ),
      best: s.best,
      next_gate: s.nextGate,
      next_rank: nextRankNeeds(s),
      profile: { ...s.profile, trainingDays: formatDays(s.profile.trainingDays) },
      recent_events: s.events.slice(-6),
      page: PAGE_URL
    };
  }
  registry.registerTool({
    name: "plugin_fitness_setup",
    description: "Awaken a Hunter in The System (bodyweight strength training, ranks E\u2192S). Call once with age, height and weight; baseline estimates (push-ups, pull-ups, squats) and any pain are optional. Pass reset: true to erase an existing Hunter and start over.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        age: { type: "number" },
        height_cm: { type: "number" },
        weight_kg: { type: "number" },
        training_days: { description: "e.g. 'mon,wed,fri' or [1,3,5] (0 = Sunday). Default Mon, Wed, Fri.", type: ["string", "array"] },
        quest_time: { type: "string", description: "Daily Quest push time, HH:MM. Default 10:30." },
        timezone: { type: "string", description: "IANA zone, e.g. Europe/Zagreb." },
        tower: { type: "boolean", description: "Has a power tower (pull-up bar + dip handles)." },
        chair: { type: "boolean", description: "Has a sturdy chair or bench. Default true." },
        pushups: { type: "number" },
        pullups: { type: "number" },
        squats: { type: "number" },
        wall_sit: { type: "number", description: "seconds" },
        dead_hang: { type: "number", description: "seconds" },
        dips: { type: "number" },
        pains: { type: "array", items: { type: "object", properties: { area: { type: "string" }, side: { type: "string" }, pain: { type: "number" }, note: { type: "string" } }, required: ["area", "pain"] } },
        pain_area: { type: "string" },
        pain_side: { type: "string" },
        pain: { type: "number" },
        reset: { type: "boolean" }
      },
      additionalProperties: false
    },
    handler: (args) => {
      if (read() && args.reset !== true) throw new Error("A Hunter already exists. Use plugin_fitness_profile to change details, or pass reset: true to erase everything and start over.");
      const timezone = assertTimeZone(optStr(args.timezone, 60) ?? defaultTz);
      const profile = {
        trainingDays: parseDays(args.training_days) ?? [1, 3, 5],
        questTime: parseTime(args.quest_time) ?? "10:30",
        eveningWarning: true,
        timezone,
        equipment: { tower: optBool(args.tower) ?? false, chair: optBool(args.chair) ?? true }
      };
      const name = optStr(args.name, 40);
      if (name) profile.name = name;
      const age = optNum(args.age, "age", 10, 100);
      if (age !== void 0) profile.age = Math.round(age);
      const height = optNum(args.height_cm, "height_cm", 100, 230);
      if (height !== void 0) profile.heightCm = height;
      const weight = optNum(args.weight_kg, "weight_kg", 30, 250);
      if (weight !== void 0) profile.weightKg = weight;
      const baseline = {};
      const b = (key, v, max) => {
        const n = optNum(v, key, 0, max);
        if (n !== void 0) baseline[key] = n;
      };
      b("pushups", args.pushups, 300);
      b("pullups", args.pullups, 100);
      b("squats", args.squats, 500);
      b("wallSit", args.wall_sit, 900);
      b("deadHang", args.dead_hang, 900);
      b("dips", args.dips, 200);
      const date = localNow(timezone, clock.now()).date;
      const state = newHunter(profile, date, baseline);
      const pains = Array.isArray(args.pains) ? args.pains : [];
      if (args.pain_area !== void 0 && args.pain !== void 0) pains.push({ area: args.pain_area, side: args.pain_side, pain: args.pain });
      for (const p of pains) {
        const level = optNum(p.pain, "pain", 0, 10) ?? 0;
        if (level > 0) reportPain(state, date, parseArea(p.area), parseSide(p.side), level, optStr(p.note, 300));
      }
      store.set(STATE_KEY, state);
      return { message: "[SYSTEM] Awakening complete. Welcome, Hunter.", status: statusOf(state), today: questFor(state, date).type };
    }
  });
  registry.registerTool({
    name: "plugin_fitness_status",
    description: "The Hunter's Status Window: rank, level, XP, stats (STR/AGI/VIT/END), streak, injuries, skill ladders, best test results, next Gate and what the next rank needs.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    handler: () => {
      const s = read();
      return s ? statusOf(s) : { exists: false, next: "plugin_fitness_setup" };
    }
  });
  registry.registerTool({
    name: "plugin_fitness_today",
    description: "Today's quest: training (A/B), recovery or a Gate (test day). Lists each exercise with today's target per set, rest, coaching cues and any injury adjustment. Explain it to the user in their language; the dashboard page shows animations.",
    inputSchema: { type: "object", properties: { date: { type: "string", description: "YYYY-MM-DD, default today" } }, additionalProperties: false },
    handler: (args) => {
      const s = need();
      const date = optDate(args.date, s);
      const q = questFor(s, date);
      return {
        date,
        type: q.type,
        session: q.session ?? null,
        deload: q.deload,
        done: q.done,
        warmup: q.warmup.map(describeItem),
        exercises: q.main.map(describeItem),
        skipped: q.skipped,
        gate_tests: q.gateTests,
        side_quest: q.sideQuestName ? { name: q.sideQuestName, exercises: q.sideQuest.map(describeItem), reward_xp: 20 } : null,
        how_to_do_it: "Guided: plugin_fitness_start, then plugin_fitness_set after every set (the page shows each step with its animation). " + (q.type === "gate" ? "Or log all trial results at once with plugin_fitness_gate." : "Or log whole exercises with plugin_fitness_log and finish with plugin_fitness_complete."),
        in_progress: describeSession(s, date),
        page: PAGE_URL
      };
    }
  });
  const describeSession = (s, date) => {
    const a = activeToday(s, date);
    if (!a) return { running: false };
    if (a.finished) return { running: false, finished: a.finished, page: PAGE_URL };
    const step2 = a.steps[a.cursor];
    const ex = BY_ID.get(step2.exercise);
    return {
      running: true,
      quest: a.type,
      session: a.session ?? null,
      light_day: a.light ?? null,
      side_quest: a.sideQuest ?? null,
      step: a.cursor + 1,
      of: a.steps.length,
      current: {
        kind: step2.kind,
        exercise: ex.id,
        name: ex.name,
        set: step2.done.length + 1,
        sets: step2.sets,
        target: step2.target[step2.done.length] ?? null,
        unit: ex.kind === "hold" ? "seconds" : "reps",
        per_side: ex.perSide === true,
        cues: ex.cues,
        avoid: ex.mistake,
        ...step2.note ? { note: step2.note } : {}
      },
      rest_seconds_left: restLeft(a, clock.now()),
      next: a.steps.slice(a.cursor + 1).map((x) => BY_ID.get(x.exercise).name),
      page: PAGE_URL
    };
  };
  registry.registerTool({
    name: "plugin_fitness_start",
    description: "Start (or resume) today's quest as a guided session: warm-up, then each set with its target and the rest between sets, then the rehab side quest if something hurts. Ask first how they slept and how sore they are: poor sleep or heavy soreness makes it a light day. Report each set with plugin_fitness_set.",
    inputSchema: {
      type: "object",
      properties: {
        sleep: { type: "string", enum: ["good", "ok", "poor"] },
        soreness: { type: "string", enum: ["none", "some", "heavy"] }
      },
      additionalProperties: false
    },
    handler: (args) => {
      const pick2 = (v, allowed, name) => {
        if (v === void 0 || v === null || v === "") return void 0;
        if (!allowed.includes(v)) throw new Error(`${name} must be one of: ${allowed.join(", ")}`);
        return v;
      };
      const readiness = {};
      const sleep = pick2(args.sleep, ["good", "ok", "poor"], "sleep");
      if (sleep) readiness.sleep = sleep;
      const soreness = pick2(args.soreness, ["none", "some", "heavy"], "soreness");
      if (soreness) readiness.soreness = soreness;
      return mutate((s, date) => {
        startSession(s, date, clock.now(), readiness);
        return describeSession(s, date);
      });
    }
  });
  registry.registerTool({
    name: "plugin_fitness_set",
    description: "Report the set just done in the running quest: reps, or seconds for holds (for a Gate trial: the all-out result). Moves to the rest, the next set or the next exercise; after the last step the quest is logged and completed.",
    inputSchema: {
      type: "object",
      properties: {
        value: { type: "number", description: "Reps done or seconds held" },
        feel: { type: "string", enum: ["easy", "ok", "hard"], description: "How the exercise felt (ask on its last set): easy raises the next target faster, hard keeps it." }
      },
      required: ["value"],
      additionalProperties: false
    },
    handler: (args) => {
      const value = optNum(args.value, "value", 0, 900);
      if (value === void 0) throw new Error("value is required (reps or seconds)");
      const feel = args.feel === void 0 || args.feel === "" ? void 0 : String(args.feel);
      if (feel !== void 0 && feel !== "easy" && feel !== "ok" && feel !== "hard") throw new Error("feel must be 'easy', 'ok' or 'hard'");
      return mutate((s, date) => {
        recordSet(s, date, clock.now(), value, feel);
        return describeSession(s, date);
      });
    }
  });
  registry.registerTool({
    name: "plugin_fitness_skip",
    description: "In the running quest: skip the current rest (what: 'rest') or the current exercise (what: 'exercise').",
    inputSchema: { type: "object", properties: { what: { type: "string", enum: ["rest", "exercise"] } }, required: ["what"], additionalProperties: false },
    handler: (args) => mutate((s, date) => {
      if (args.what === "rest") skipRest(s, date);
      else if (args.what === "exercise") skipStep(s, date, clock.now());
      else throw new Error("what must be 'rest' or 'exercise'");
      return describeSession(s, date);
    })
  });
  registry.registerTool({
    name: "plugin_fitness_end",
    description: "End the running quest now. Sets done so far are logged; the quest counts as complete if any real work was done.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    handler: () => mutate((s, date) => {
      endSession(s, date, clock.now());
      return describeSession(s, date);
    })
  });
  registry.registerTool({
    name: "plugin_fitness_log",
    description: 'Log the sets of one exercise (reps, or seconds for holds), e.g. { exercise: "pullup", sets: [6, 5, 5] }. Hitting the top of the range in two sessions unlocks the next skill; falling short twice recalibrates one step down.',
    inputSchema: {
      type: "object",
      properties: {
        exercise: { type: "string", description: "Exercise id (or exact name)." },
        sets: { type: "array", items: { type: "number" } },
        set1: { type: "number" },
        set2: { type: "number" },
        set3: { type: "number" },
        set4: { type: "number" },
        set5: { type: "number" },
        date: { type: "string", description: "YYYY-MM-DD, default today" }
      },
      required: ["exercise"],
      additionalProperties: false
    },
    handler: (args) => {
      const id = findExercise(args.exercise);
      const sets = parseSets(args);
      if (sets.length === 0) throw new Error("give the sets, e.g. sets: [8, 8, 7]");
      return mutate((s) => {
        const d = optDate(args.date, s);
        const r = logSets(s, d, id, sets);
        const messages = [
          ...r.unlocked.map((u) => `[SYSTEM] Skill unlocked: ${BY_ID.get(u.to).name}.`),
          ...r.recalibrated.map((u) => `[SYSTEM] Recalibrating: ${BY_ID.get(u.to).name} until the base is solid.`)
        ];
        if (!messages.length && r.hitTop) messages.push("Top of the range. Do it once more next session to unlock the next skill.");
        return { ...r, date: d, messages };
      });
    }
  });
  registry.registerTool({
    name: "plugin_fitness_complete",
    description: "Mark today's Daily Quest (training or recovery) complete for XP and the streak. A Gate is cleared with plugin_fitness_gate instead.",
    inputSchema: { type: "object", properties: { date: { type: "string", description: "YYYY-MM-DD, default today" } }, additionalProperties: false },
    handler: (args) => mutate((s) => {
      const d = optDate(args.date, s);
      const r = completeQuest(s, d);
      return { ...r, date: d, level: hunterLevel(s.xp), total_xp: s.xp, streak_days: streak(s, d), message: r.already ? "Already completed." : T.questDone };
    })
  });
  registry.registerTool({
    name: "plugin_fitness_pain",
    description: "Report pain in an area (0-10); 0 means it is gone. 1-2: train normally below pain; 3-4: only light exercises for that area; 5+: that area rests. The System swaps exercises automatically.",
    inputSchema: {
      type: "object",
      properties: {
        area: { type: "string", enum: AREAS },
        side: { type: "string", enum: ["left", "right", "both"] },
        pain: { type: "number", minimum: 0, maximum: 10 },
        note: { type: "string" }
      },
      required: ["area", "pain"],
      additionalProperties: false
    },
    handler: (args) => {
      const area = parseArea(args.area);
      const side = parseSide(args.side);
      const pain = optNum(args.pain, "pain", 0, 10) ?? 0;
      return mutate((s, date) => {
        const r = reportPain(s, date, area, side, pain, optStr(args.note, 300));
        return { ...r, injuries: s.injuries, today: questFor(s, date).main.map((q) => q.name) };
      });
    }
  });
  registry.registerTool({
    name: "plugin_fitness_profile",
    description: "Change the Hunter profile: weight_kg, waist_cm, height_cm, age, name, training_days, quest_time, evening_warning, timezone, equipment (tower, chair). Every change is kept in the history; adding a power tower opens a Gate.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        age: { type: "number" },
        height_cm: { type: "number" },
        weight_kg: { type: "number" },
        waist_cm: { type: "number" },
        training_days: { type: ["string", "array"] },
        quest_time: { type: "string" },
        evening_warning: { type: "boolean" },
        timezone: { type: "string" },
        tower: { type: "boolean" },
        chair: { type: "boolean" }
      },
      additionalProperties: false
    },
    handler: (args) => {
      const patch = {};
      const name = optStr(args.name, 40);
      if (name) patch.name = name;
      const age = optNum(args.age, "age", 10, 100);
      if (age !== void 0) patch.age = Math.round(age);
      const h = optNum(args.height_cm, "height_cm", 100, 230);
      if (h !== void 0) patch.heightCm = h;
      const w = optNum(args.weight_kg, "weight_kg", 30, 250);
      if (w !== void 0) patch.weightKg = w;
      const waist = optNum(args.waist_cm, "waist_cm", 40, 200);
      if (waist !== void 0) patch.waistCm = waist;
      const days = parseDays(args.training_days);
      if (days) patch.trainingDays = days;
      const time = parseTime(args.quest_time);
      if (time) patch.questTime = time;
      const warn = optBool(args.evening_warning);
      if (warn !== void 0) patch.eveningWarning = warn;
      const tz = optStr(args.timezone, 60);
      if (tz) patch.timezone = assertTimeZone(tz);
      const tower = optBool(args.tower);
      if (tower !== void 0) patch.tower = tower;
      const chair2 = optBool(args.chair);
      if (chair2 !== void 0) patch.chair = chair2;
      return mutate((s, date) => {
        const changed = updateProfile(s, date, patch);
        return { changed, profile: { ...s.profile, trainingDays: formatDays(s.profile.trainingDays) }, next_gate: s.nextGate };
      });
    }
  });
  registry.registerTool({
    name: "plugin_fitness_gate",
    description: "Clear a Gate: log one all-out set of each trial (pullups, pushups, dips = reps; dead_hang, hollow_hold, l_sit = seconds). Updates best results, raises skill ladders the results justify, and decides the rank (E\u2192S). Gates open every 6 weeks.",
    inputSchema: {
      type: "object",
      properties: Object.fromEntries([...GATE_TESTS.map((t) => [t, { type: "number" }]), ["date", { type: "string" }]]),
      additionalProperties: false
    },
    handler: (args) => {
      const results = {};
      for (const t of GATE_TESTS) {
        const v = optNum(args[t], t, 0, 900);
        if (v !== void 0) results[t] = v;
      }
      return mutate((s) => {
        const d = optDate(args.date, s);
        const r = clearGate(s, d, results);
        return {
          ...r,
          message: r.rankAfter !== r.rankBefore ? `[SYSTEM] Rank up! ${r.rankBefore} \u2192 ${r.rankAfter}.` : `[SYSTEM] Gate ${r.number} cleared.`,
          next_gate: s.nextGate,
          next_rank: nextRankNeeds(s)
        };
      });
    }
  });
  registry.registerTool({
    name: "plugin_fitness_exercise",
    description: "How to do an exercise: cues, the common mistake, target range, which ladder it belongs to and what it loads. Without an id, lists every exercise by ladder.",
    inputSchema: { type: "object", properties: { id: { type: "string" } }, additionalProperties: false },
    handler: (args) => {
      if (args.id === void 0 || args.id === "") {
        return {
          ladders: Object.fromEntries(Object.values(LADDERS).map((l) => [l.id, l.levels.map((id) => ({ id, name: BY_ID.get(id).name }))])),
          mobility: EXERCISES.filter((e2) => !Object.values(LADDERS).some((l) => l.levels.includes(e2.id))).map((e2) => ({ id: e2.id, name: e2.name }))
        };
      }
      const e = BY_ID.get(findExercise(args.id));
      const ladders = Object.values(LADDERS).filter((l) => l.levels.includes(e.id)).map((l) => ({ ladder: l.id, level: l.levels.indexOf(e.id) + 1, of: l.levels.length }));
      return {
        id: e.id,
        name: e.name,
        kind: e.kind,
        target: `${e.sets} \xD7 ${e.min}-${e.max} ${e.kind === "hold" ? "seconds" : "reps"}${e.perSide ? " per side" : ""}`,
        rest_seconds: e.restSec,
        equipment: e.equipment,
        loads: e.stress,
        cues: e.cues,
        avoid: e.mistake,
        ladders,
        animation: `${PAGE_URL} (open the exercise in today's quest)`
      };
    }
  });
  registry.registerTool({
    name: "plugin_fitness_history",
    description: "Training history: completed quests, logged sets, body weight/waist, Gate results and profile changes over the last N days (default 30).",
    inputSchema: { type: "object", properties: { days: { type: "number" } }, additionalProperties: false },
    handler: (args) => {
      const s = need();
      const days = Math.round(optNum(args.days, "days", 1, 3650) ?? 30);
      const { date } = today(s);
      const from = new Date(Date.parse(`${date}T12:00:00Z`) - (days - 1) * 864e5).toISOString().slice(0, 10);
      const within = (xs) => xs.filter((x) => x.date >= from);
      return {
        from,
        to: date,
        quests: within(s.quests),
        logs: within(s.logs).map((l) => ({ ...l, name: BY_ID.get(l.exercise)?.name ?? l.exercise })),
        body: within(s.body),
        gates: s.gates,
        profile_changes: within(s.profileHistory)
      };
    }
  });
  async function tick() {
    const s = read();
    if (!s || !registry.notify) return { sent: null };
    const { date, time } = today(s);
    if (date < s.startDate) return { sent: null };
    const q = questFor(s, date);
    if (q.done) return { sent: null };
    let kind = null;
    if (time >= s.profile.questTime && s.notified.quest !== date) kind = "quest";
    else if (s.profile.eveningWarning && s.profile.questTime < WARNING_TIME && time >= WARNING_TIME && s.notified.warning !== date) kind = "warning";
    if (!kind) return { sent: null };
    store.update(STATE_KEY, (cur) => {
      if (cur) cur.notified = { ...cur.notified, [kind]: date };
      return cur;
    });
    const names = q.main.map((m) => m.name).join(", ");
    const n = kind === "warning" ? { title: T.notify.warningTitle, body: T.notify.warningBody } : q.type === "gate" ? { title: T.notify.gateTitle, body: "Today is a test day. Warm up, then one all-out set of each trial." } : q.type === "training" ? { title: T.notify.questTitle, body: `Training ${q.session}: ${names}.${q.deload ? " Deload week." : ""}` } : { title: T.notify.recoveryTitle, body: `Mobility, about 10 minutes: ${names}.` };
    try {
      await registry.notify({
        ...n,
        url: PAGE_URL,
        tag: `fitness-${date}`,
        ...q.type === "recovery" && kind === "quest" ? { actions: [{ label: "Done", tool: "plugin_fitness_complete", args: { date } }] } : {}
      });
    } catch (err) {
      console.error(`fitness: notify failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    return { sent: kind };
  }
  if (typeof registry.schedule === "function" && typeof registry.notify === "function") {
    registry.schedule({ id: "quest-tick", cron: "* * * * *", run: tick });
  }
  if (typeof registry.brief === "function") {
    registry.brief({
      id: "quest",
      order: 20,
      render: () => {
        const s = read();
        if (!s) return null;
        const { date } = today(s);
        const q = questFor(s, date);
        const what = q.type === "gate" ? "a Gate is open (test day)" : q.type === "training" ? `Training ${q.session} \u2014 ${q.main.map((m) => m.name).join(", ")}` : "Recovery (10 min mobility)";
        return `\u2694\uFE0F The System: ${what} \xB7 Rank ${s.rank} \xB7 Lv ${hunterLevel(s.xp)} \xB7 streak ${streak(s, date)}`;
      }
    });
  }
  if (typeof registry.registerPage === "function") {
    registry.registerPage({
      id: PAGE_ID,
      title: "The System",
      icon: "swords",
      order: 12,
      theme: "hologram",
      render: () => {
        const s = read();
        return renderPage(s, today(s).date, clock.now(), defaultTz);
      }
    });
  }
}
function register(registry) {
  registerFitness(registry);
}
export {
  register as default,
  registerFitness
};
