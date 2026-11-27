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
  far: "#2b8cff",
  head: "#0a1428",
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
function propSvg(p) {
  switch (p.kind) {
    case "floor":
      return `<line x1="4" y1="${GROUND + 3}" x2="${SIZE - 4}" y2="${GROUND + 3}" stroke="${COLOR.prop}" stroke-width="3"/>`;
    case "bar":
      return `<line x1="${p.x1 ?? 30}" y1="${p.y}" x2="${p.x2 ?? 170}" y2="${p.y}" stroke="${COLOR.prop}" stroke-width="5" stroke-linecap="round"/>`;
    case "dipBars":
      return `<line x1="${p.x1}" y1="${p.y}" x2="${p.x2}" y2="${p.y}" stroke="${COLOR.prop}" stroke-width="6" stroke-linecap="round"/><line x1="${(p.x1 + p.x2) / 2}" y1="${p.y}" x2="${(p.x1 + p.x2) / 2}" y2="${GROUND + 3}" stroke="${COLOR.prop}" stroke-width="3" opacity="0.6"/>`;
    case "box":
      return `<rect x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}" rx="3" fill="${COLOR.propFill}" stroke="${COLOR.prop}" stroke-width="3"/>`;
    case "wall":
      return `<line x1="${p.x}" y1="8" x2="${p.x}" y2="${GROUND + 3}" stroke="${COLOR.prop}" stroke-width="4"/>`;
    case "pad":
      return `<line x1="${p.x}" y1="${p.y1}" x2="${p.x}" y2="${p.y2}" stroke="${COLOR.prop}" stroke-width="7" stroke-linecap="round"/>`;
    case "arrow": {
      const [x1, y1] = p.from;
      const [x2, y2] = p.to;
      const a = Math.atan2(y2 - y1, x2 - x1);
      const h1 = [x2 - 6 * Math.cos(a - 0.5), y2 - 6 * Math.sin(a - 0.5)];
      const h2 = [x2 - 6 * Math.cos(a + 0.5), y2 - 6 * Math.sin(a + 0.5)];
      return `<polyline points="${pts([p.from, p.to])}" fill="none" stroke="${COLOR.arrow}" stroke-width="2" stroke-dasharray="3 3"/><polyline points="${pts([h1, p.to, h2])}" fill="none" stroke="${COLOR.arrow}" stroke-width="2"/>`;
    }
  }
}
function animatedLine(list, dur, pick2, attrs) {
  const values = list.map((f) => pts(pick2(f.joints)));
  const first = values[0];
  if (list.length < 2) return `<polyline points="${first}" ${attrs}/>`;
  const keyTimes = list.map((f) => Math.min(f.at / dur, 1).toFixed(4)).join(";");
  return `<polyline points="${first}" ${attrs}><animate attributeName="points" dur="${fmt(dur)}s" repeatCount="indefinite" values="${values.join(";")}" keyTimes="${keyTimes}"/></polyline>`;
}
function animatedHead(list, dur) {
  const head = list[0].joints.head;
  const base = `cx="${fmt(head[0])}" cy="${fmt(head[1])}" r="${SEG.head}" fill="${COLOR.head}" stroke="${COLOR.body}" stroke-width="4"`;
  if (list.length < 2) return `<circle ${base}/>`;
  const keyTimes = list.map((f) => Math.min(f.at / dur, 1).toFixed(4)).join(";");
  const cx = list.map((f) => fmt(f.joints.head[0])).join(";");
  const cy = list.map((f) => fmt(f.joints.head[1])).join(";");
  return `<circle ${base}><animate attributeName="cx" dur="${fmt(dur)}s" repeatCount="indefinite" values="${cx}" keyTimes="${keyTimes}"/><animate attributeName="cy" dur="${fmt(dur)}s" repeatCount="indefinite" values="${cy}" keyTimes="${keyTimes}"/></circle>`;
}
function renderFigure(spec, title) {
  const { list, duration } = frames(spec);
  const front = spec.view === "front";
  const limb2 = `fill="none" stroke-linecap="round" stroke-linejoin="round"`;
  const nearAttrs = `${limb2} stroke="${COLOR.body}" stroke-width="5"`;
  const farAttrs = front ? nearAttrs : `${limb2} stroke="${COLOR.far}" stroke-width="5" opacity="0.55"`;
  const far = [
    animatedLine(list, duration, (j) => [j.hipF, j.kneeF, j.ankleF, j.toeF], farAttrs),
    animatedLine(list, duration, (j) => [j.shoulderF, j.elbowF, j.handF], farAttrs)
  ];
  const torso = front ? animatedLine(list, duration, (j) => [j.shoulderF, j.shoulderN, j.shoulder, j.hip, j.hipF, j.hipN], `${limb2} stroke="${COLOR.body}" stroke-width="6"`) : animatedLine(list, duration, (j) => [j.hip, j.shoulder], `${limb2} stroke="${COLOR.body}" stroke-width="7"`);
  const near = [
    animatedLine(list, duration, (j) => [j.hipN, j.kneeN, j.ankleN, j.toeN], nearAttrs),
    animatedLine(list, duration, (j) => [j.shoulderN, j.elbowN, j.handN], nearAttrs)
  ];
  const neck = animatedLine(list, duration, (j) => [j.shoulder, j.head], `${limb2} stroke="${COLOR.body}" stroke-width="5"`);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIZE} ${SIZE}" width="${SIZE}" height="${SIZE}" role="img" aria-label="${escapeAttr(title)}"><defs><filter id="glow" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs><g>${spec.props.map(propSvg).join("")}</g><g filter="url(#glow)">${far.join("")}${torso}${neck}${animatedHead(list, duration)}${near.join("")}</g></svg>`;
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

// src/types.ts
var RANKS = ["E", "D", "C", "B", "A", "S"];
var GATE_TESTS = ["pullups", "pushups", "dips", "dead_hang", "hollow_hold", "l_sit"];
var STATE_KEY = "hunter";

// src/rules.ts
var XP = { training: 100, gate: 300, recovery: 30, skill: 150, rank: 500 };
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
  }, { squats: baseline.squats, wallSit: baseline.wallSit });
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
function place(state, results, legs = {}) {
  const clean = {};
  for (const t of GATE_TESTS) {
    const v = results[t];
    if (typeof v === "number" && Number.isFinite(v) && v >= 0) clean[t] = v;
  }
  for (const [ladder, level] of Object.entries(placementFor(clean, legs))) {
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
  const stepUp = ex.kind === "hold" ? 5 : 1;
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
  const quest = { date, type, deload, warmup: [], main: [], skipped: [], gateTests: [], done: !!record };
  if (type === "recovery") {
    quest.main = RECOVERY.filter((id) => usable(state, id)).map((id) => item(exercise(id), state, false, date));
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
  return quest;
}
function logSets(state, date, exerciseId, rawSets) {
  const ex = exercise(exerciseId);
  const sets = rawSets.map((n) => Math.max(0, Math.round(n))).slice(0, 10);
  if (sets.length === 0) throw new Error("log at least one set");
  state.logs.push({ date, exercise: ex.id, sets });
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
function nextRankNeeds(state) {
  const i = RANKS.indexOf(state.rank);
  const next = RANKS[i + 1];
  if (!next) return null;
  const missing = RANK_REQS[next].filter((req) => !meets(state, req)).map(
    (req) => req.test ? `${TEST_LABEL[req.test]} \u2265 ${req.min}${req.test === "dead_hang" || req.test === "hollow_hold" || req.test === "l_sit" ? " s" : ""}` : `${LADDERS[req.ladder].name}: reach ${exercise(req.level).name}`
  );
  return { rank: next, missing };
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

// src/text.ts
var T = {
  awakening: "[SYSTEM] A new Hunter has been detected.\nThe System trains strength you can carry anywhere: pull, push, legs and core, with your own body weight. No heavy loads, no training to failure \u2014 every exercise climbs a ladder from easy to elite, and you climb it when you own it.\nRegister below. Your first training day is the Awakening Gate: a short test that places you on every ladder.",
  trainingIntro: "Warm up first, then work through each exercise. Stop every set with about two reps left in the tank \u2014 clean reps only. Log your sets as you go; hit the top of the range twice and the next skill unlocks.",
  recoveryIntro: "Recovery day. Ten easy minutes of mobility keep the joints happy and the streak alive. A 30-minute walk counts as a bonus.",
  gateIntro: "A Gate has opened. Warm up, then do one all-out set of each trial with strict form and full rest between them. The results place you on the ladders and decide your rank.",
  deload: "Deload week: one set fewer, bottom of the range, no level-ups. Recovery is part of the plan.",
  questDone: "[SYSTEM] Quest complete. Rest well, Hunter.",
  questDoneShort: "\u2713 Completed today.",
  noTower: "Pull, dip and L-sit ladders unlock fully when you add a power tower in your profile. Until then the System substitutes floor work.",
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
var unit = (q) => q.kind === "hold" ? "s" : "reps";
var range = (q) => `${q.sets} \xD7 ${q.min === q.max ? q.min : `${q.min}\u2013${q.max}`} ${unit(q)}${q.perSide ? " / side" : ""}`;
function exerciseBlocks(q, opts) {
  const ex = exercise(q.exercise);
  const level = q.level ? ` \xB7 Lv ${q.level.at}/${q.level.of}` : "";
  const caption = [
    `Today: ${q.target.join(" \xB7 ")} ${unit(q)}${q.perSide ? " per side" : ""}${q.restSec ? ` \u2014 rest ${q.restSec} s between sets` : ""}`,
    q.note ? `\u26A0 ${q.note}` : "",
    q.logged ? `\u2713 Logged: ${q.logged.join(" \xB7 ")}` : ""
  ].filter(Boolean).join("\n");
  const blocks = [
    {
      type: "figure",
      svg: figureSvg(ex.id),
      alt: `${ex.name} \u2014 animated demonstration`,
      title: `${opts.warmup ? "Warm-up \xB7 " : ""}${ex.name} \xB7 ${range(q)}${level}${q.logged ? " \u2713" : ""}`,
      caption,
      bullets: [...ex.cues, `Avoid: ${ex.mistake}`],
      size: "md",
      collapsed: true
    }
  ];
  if (opts.log) {
    blocks.push({
      type: "form",
      tool: "plugin_fitness_log",
      button: q.logged ? "Log again" : `Log ${ex.name}`,
      args: { exercise: ex.id },
      fields: q.target.map((t, i) => ({
        name: `set${i + 1}`,
        label: `Set ${i + 1}`,
        kind: "number",
        min: 0,
        max: 600,
        unit: unit(q),
        value: q.logged?.[i] ?? t
      }))
    });
  }
  return blocks;
}
function renderPage(state, today, defaultTimezone) {
  if (!state) return awakening(defaultTimezone);
  const blocks = [];
  const level = hunterLevel(state.xp);
  const s = stats(state, today);
  const st = streak(state, today);
  blocks.push({ type: "heading", text: "Status Window" });
  blocks.push({
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
  });
  const base = xpForLevel(level);
  blocks.push({ type: "progress", label: `Level ${level} \u2192 ${level + 1}`, value: state.xp - base, max: xpForLevel(level + 1) - base, hint: `${state.xp - base} / ${xpForLevel(level + 1) - base} XP` });
  const needs = nextRankNeeds(state);
  const gateIn = daysBetween(today, state.nextGate);
  blocks.push({
    type: "text",
    tone: "muted",
    text: [
      needs ? `Next rank ${needs.rank}: ${needs.missing.length ? needs.missing.join(", ") : "all requirements met \u2014 clear the next Gate"}` : "Maximum rank reached.",
      gateIn <= 0 ? "A Gate is open: it replaces your next training quest." : `Next Gate in ${gateIn} day${gateIn === 1 ? "" : "s"} (${state.nextGate}).`
    ].join("\n")
  });
  if (state.injuries.length) {
    blocks.push({
      type: "list",
      items: state.injuries.map((i) => ({
        title: `${i.side === "both" ? "" : `${i.side} `}${i.area.replace("_", " ")} \u2014 ${i.pain}/10`,
        subtitle: `since ${i.since}${i.note ? ` \xB7 ${i.note}` : ""} \xB7 ${i.pain <= 2 ? "train, stay below pain" : i.pain <= 4 ? "light work only" : "rest this area"}`,
        badge: "Status effect",
        tone: i.pain >= 5 ? "error" : "warn"
      }))
    });
  }
  const quest = questFor(state, today);
  const title = quest.type === "gate" ? "Gate" : quest.type === "training" ? `Daily Quest \u2014 Training ${quest.session}` : "Daily Quest \u2014 Recovery";
  blocks.push({ type: "divider" });
  blocks.push({ type: "heading", text: title });
  blocks.push({ type: "text", text: questIntro(quest.type, quest.deload, quest.done) });
  for (const w of quest.warmup) blocks.push(...exerciseBlocks(w, { log: false, warmup: true }));
  for (const m of quest.main) blocks.push(...exerciseBlocks(m, { log: quest.type === "training" && !quest.done }));
  if (quest.skipped.length) {
    blocks.push({
      type: "list",
      items: quest.skipped.map((x) => ({ title: `${LADDERS[x.ladder].name} skipped`, subtitle: x.reason, tone: "warn" }))
    });
  }
  if (quest.type === "gate" && !quest.done) {
    for (const t of quest.gateTests) {
      const ex = exercise(TEST_EXERCISE[t]);
      blocks.push({
        type: "figure",
        svg: figureSvg(ex.id),
        alt: `${ex.name} \u2014 animated demonstration`,
        title: `Trial \xB7 ${TEST_LABEL[t]}`,
        caption: `One all-out set of ${ex.name} with clean form. Stop when the form breaks and note the ${ex.kind === "hold" ? "seconds" : "reps"}.`,
        bullets: [...ex.cues, `Avoid: ${ex.mistake}`],
        size: "md",
        collapsed: false
      });
    }
    const left = GATE_TESTS.filter((t) => !quest.gateTests.includes(t));
    if (left.length) {
      blocks.push({
        type: "text",
        tone: "warn",
        text: `Not tested today (missing equipment or an area that hurts 3/10+): ${left.map((t) => TEST_LABEL[t].replace(/ \(.*\)$/, "")).join(", ")}. They join a later Gate.`
      });
    }
    blocks.push({
      type: "form",
      title: "Gate trials \u2014 one all-out set each, strict form, full rest between",
      tool: "plugin_fitness_gate",
      button: "Clear the Gate",
      fields: quest.gateTests.map((t) => ({ name: t, label: TEST_LABEL[t], kind: "number", min: 0, max: 600, unit: t === "pullups" || t === "pushups" || t === "dips" ? "reps" : "s" }))
    });
  } else if (quest.done) {
    blocks.push({ type: "text", tone: "ok", text: T.questDone });
  } else {
    blocks.push({ type: "actions", buttons: [{ label: "Complete Quest", tool: "plugin_fitness_complete", variant: "primary" }] });
  }
  blocks.push({ type: "divider" });
  blocks.push({ type: "heading", text: "Skills" });
  for (const id of TRACKED_LADDERS) {
    const ladder = LADDERS[id];
    const at2 = state.levels[id];
    const next = ladder.levels[at2 + 1];
    blocks.push({
      type: "progress",
      label: `${ladder.name}: ${exercise(ladder.levels[at2]).name}`,
      value: at2 + 1,
      max: ladder.levels.length,
      hint: next ? `next: ${exercise(next).name}` : "mastered"
    });
  }
  if (!state.profile.equipment.tower) blocks.push({ type: "text", tone: "muted", text: T.noTower });
  blocks.push({ type: "divider" });
  blocks.push({ type: "heading", text: "History" });
  const weeks = Array.from({ length: 12 }, (_, i) => addDays(today, -7 * (11 - i)));
  const volume = weeks.map((end) => {
    const start = addDays(end, -6);
    return state.logs.filter((l) => l.date >= start && l.date <= end && exercise(l.exercise).kind === "reps").reduce((sum, l) => sum + l.sets.reduce((a, b) => a + b, 0), 0);
  });
  if (volume.some((v) => v > 0)) {
    blocks.push({ type: "chart", kind: "bar", title: "Reps per week", labels: weeks.map((w) => w.slice(5)), series: [{ name: "Reps", values: volume }] });
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
    empty: "No sets logged yet."
  });
  blocks.push({
    type: "list",
    items: [...state.events].reverse().slice(0, 8).map((e) => ({ title: e.text, subtitle: e.date, badge: e.kind.replace("_", " ") })),
    empty: "The System log is empty."
  });
  blocks.push({ type: "divider" });
  blocks.push({ type: "heading", text: "Profile" });
  blocks.push(profileForm(state));
  blocks.push(painForm());
  return blocks;
}
function questIntro(type, deload, done) {
  const lines = [];
  if (type === "gate") lines.push(T.gateIntro);
  else if (type === "training") lines.push(T.trainingIntro);
  else lines.push(T.recoveryIntro);
  if (deload && type === "training") lines.push(T.deload);
  if (done) lines.push(T.questDoneShort);
  return lines.join("\n");
}
function profileForm(state) {
  const p = state.profile;
  const last = [...state.body].reverse();
  const waist = last.find((b) => b.waistCm !== void 0)?.waistCm;
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
        how_to_finish: q.type === "gate" ? "Log the trials with plugin_fitness_gate." : "Log each exercise with plugin_fitness_log, then plugin_fitness_complete.",
        page: PAGE_URL
      };
    }
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
        ...q.type === "recovery" ? { actions: [{ label: "Done", tool: "plugin_fitness_complete", args: { date } }] } : {}
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
        return renderPage(s, today(s).date, defaultTz);
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
