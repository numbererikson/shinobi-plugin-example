// Exercise catalog: every exercise with its prescription, the joints it
// loads, coaching cues and an animated figure. All user-facing text is
// English; keep it plain — the reader is a beginner.

import { GROUND, type FigureSpec, type Pose, type Vec } from './figure.js';

export type Area = 'shoulder' | 'elbow' | 'wrist' | 'lower_back' | 'hip' | 'knee' | 'ankle';
export const AREAS: Area[] = ['shoulder', 'elbow', 'wrist', 'lower_back', 'hip', 'knee', 'ankle'];

export type Equipment = 'none' | 'tower' | 'chair' | 'wall';

export type LadderId = 'pull' | 'pull_floor' | 'dip' | 'push' | 'legs' | 'hinge' | 'core' | 'lsit';

export interface Exercise {
  id: string;
  name: string;
  /** 'reps' counts repetitions, 'hold' counts seconds. */
  kind: 'reps' | 'hold';
  sets: number;
  /** Target range per set (reps or seconds). */
  min: number;
  max: number;
  /** Counted per side (each leg / each arm). */
  perSide?: boolean;
  restSec: number;
  equipment: Equipment;
  /** How hard it loads each area: 0 none … 3 heavy. Missing = 0. */
  stress: Partial<Record<Area, 1 | 2 | 3>>;
  /** Three short coaching cues. */
  cues: [string, string, string];
  /** The most common mistake. */
  mistake: string;
  figure: FigureSpec;
}

const FOOT_Y = GROUND - 1;
const FLOOR_HAND = GROUND - 2;
const at = (x: number, y: number): Vec => [x, y];
const floor = { kind: 'floor' } as const;

// ---- shared poses ---------------------------------------------------------

const standing = (x: number, arms: [number, number] = [6, 4]): Pose => ({
  torso: 180,
  armN: arms,
  armF: [arms[0] - 6, arms[1] - 6],
  legN: [0, 0],
  legF: [3, 3],
  anchor: { joint: 'ankleN', at: at(x, FOOT_Y) },
});

const hanging = (legs: [number, number] = [6, -12], legsF?: [number, number]): Pose => ({
  torso: 180,
  neck: 158,
  armN: [182, 180],
  armF: [180, 178],
  legN: legs,
  legF: legsF ?? [legs[0] - 4, legs[1] - 4],
  anchor: { joint: 'handN', at: at(100, 25) },
});
const bar = { kind: 'bar', y: 22 } as const;

const support = (legs: [number, number] = [8, -55]): Pose => ({
  torso: 180,
  armN: [10, 6],
  armF: [8, 4],
  legN: legs,
  legF: [legs[0] - 6, legs[1] - 6],
  anchor: { joint: 'handN', at: at(110, 105) },
});
const dipBars = { kind: 'dipBars', y: 108, x1: 78, x2: 128 } as const;

// Lying on the back, head to the left, shoulders on the floor.
const supine = (hipLift: number, legN: Pose['legN'], extra: Partial<Pose> = {}): Pose => ({
  torso: -90 + hipLift,
  neck: -90,
  armN: [92, 90],
  legN,
  anchor: { joint: 'shoulder', at: at(55, GROUND - 4) },
  ...extra,
});

// Captain's chair (power tower knee-raise station): forearms on the rests.
const chair = (legs: [number, number]): Pose => ({
  torso: 180,
  armN: [0, 90],
  armF: [0, 88],
  legN: legs,
  legF: [legs[0] - 4, legs[1] - 4],
  anchor: { joint: 'shoulder', at: at(90, 55) },
});
const chairProps = [
  { kind: 'pad', x: 80, y1: 52, y2: 108 },
  { kind: 'dipBars', y: 84, x1: 84, x2: 122 },
] as const;

// Push-up family: body straight from ankles to shoulders, hands at a target.
const plank = (torso: number, ankle: Vec, hand: Vec, foot = 25): Pose => ({
  torso,
  armN: { to: hand, bend: -1 },
  armF: { to: [hand[0] - 3, hand[1]], bend: -1 },
  legN: [torso - 180, torso - 180],
  footN: foot,
  footF: foot,
  anchor: { joint: 'ankleN', at: ankle },
});

// ---- catalog --------------------------------------------------------------

export const EXERCISES: Exercise[] = [
  // ---------- legs ----------
  {
    id: 'wall_sit',
    name: 'Wall Sit',
    kind: 'hold',
    sets: 3,
    min: 30,
    max: 60,
    restSec: 60,
    equipment: 'wall',
    stress: { knee: 2, hip: 1 },
    cues: ['Back flat against the wall, feet a step in front of you.', 'Slide down until your thighs are level with the floor.', 'Knees stay over your ankles; breathe slowly.'],
    mistake: 'Sliding only halfway down, or letting the knees drift in front of the toes.',
    figure: {
      props: [floor, { kind: 'wall', x: 66 }],
      keys: [{ pose: { torso: 180, armN: [40, 95], legN: [90, 0], legF: [88, -2], anchor: { joint: 'ankleN', at: at(112, FOOT_Y) } } }],
      move: 1,
    },
  },
  {
    id: 'squat',
    name: 'Bodyweight Squat',
    kind: 'reps',
    sets: 3,
    min: 12,
    max: 20,
    restSec: 60,
    equipment: 'none',
    stress: { knee: 2, hip: 1, ankle: 1 },
    cues: ['Feet shoulder-width, toes slightly out.', 'Sit back and down as if onto a low chair; chest up.', 'Push the floor away through your whole foot to stand.'],
    mistake: 'Heels lifting off the floor or knees caving inwards.',
    figure: {
      props: [floor],
      keys: [
        { pose: standing(100), hold: 0.4 },
        { pose: { torso: 145, armN: [88, 92], armF: [84, 88], legN: [85, -25], legF: [82, -27], anchor: { joint: 'ankleN', at: at(100, FOOT_Y) } }, hold: 0.3 },
      ],
      move: 1.3,
    },
  },
  {
    id: 'split_squat',
    name: 'Split Squat',
    kind: 'reps',
    sets: 3,
    min: 8,
    max: 12,
    perSide: true,
    restSec: 60,
    equipment: 'none',
    stress: { knee: 2, hip: 2, ankle: 1 },
    cues: ['Long step: front foot flat, back foot on its toes.', 'Drop the back knee straight down until it almost touches the floor.', 'Torso upright; drive up through the front heel.'],
    mistake: 'Stance too short, so the front knee shoots far past the toes.',
    figure: {
      props: [floor],
      keys: [
        { pose: { torso: 178, armN: [4, 2], legN: [16, 0], legF: { to: at(62, FOOT_Y - 8), bend: -1 }, footF: 40, anchor: { joint: 'ankleN', at: at(128, FOOT_Y) } }, hold: 0.3 },
        { pose: { torso: 178, armN: [4, 2], legN: [82, -10], legF: { to: at(62, FOOT_Y - 8), bend: -1 }, footF: 40, anchor: { joint: 'ankleN', at: at(128, FOOT_Y) } }, hold: 0.3 },
      ],
      move: 1.3,
    },
  },
  {
    id: 'bulgarian_split_squat',
    name: 'Bulgarian Split Squat',
    kind: 'reps',
    sets: 3,
    min: 6,
    max: 10,
    perSide: true,
    restSec: 75,
    equipment: 'chair',
    stress: { knee: 2, hip: 2, ankle: 1, lower_back: 1 },
    cues: ['Rear foot laces-down on a chair or bench behind you.', 'Lower straight down until the front thigh is level.', 'Lean slightly forward; most of your weight stays on the front leg.'],
    mistake: 'Standing too close to the bench, which jams the front knee forward.',
    figure: {
      props: [floor, { kind: 'box', x: 18, y: 150, w: 44, h: 39 }],
      keys: [
        { pose: { torso: 172, armN: [4, 2], legN: [12, 0], legF: { to: at(56, 145), bend: -1 }, footF: -100, anchor: { joint: 'ankleN', at: at(132, FOOT_Y) } }, hold: 0.3 },
        { pose: { torso: 165, armN: [10, 6], legN: [80, -14], legF: { to: at(56, 145), bend: -1 }, footF: -100, anchor: { joint: 'ankleN', at: at(132, FOOT_Y) } }, hold: 0.3 },
      ],
      move: 1.4,
    },
  },
  {
    id: 'assisted_pistol',
    name: 'Assisted Pistol Squat',
    kind: 'reps',
    sets: 3,
    min: 4,
    max: 8,
    perSide: true,
    restSec: 90,
    equipment: 'tower',
    stress: { knee: 3, hip: 2, ankle: 2 },
    cues: ['Hold the tower upright lightly — it is for balance, not for pulling.', 'Other leg reaches forward as you sit down on one leg.', 'Go only as deep as you can control, then stand up.'],
    mistake: 'Pulling yourself up with the arms instead of pushing with the leg.',
    figure: {
      props: [floor, { kind: 'wall', x: 168 }],
      keys: [
        { pose: { torso: 178, armN: { to: at(164, 104), bend: -1 }, armF: { to: at(164, 100), bend: -1 }, legN: [2, 0], legF: [25, 18], anchor: { joint: 'ankleN', at: at(100, FOOT_Y) } }, hold: 0.3 },
        { pose: { torso: 140, armN: { to: at(164, 128), bend: -1 }, armF: { to: at(164, 124), bend: -1 }, legN: [80, -35], legF: [88, 92], footF: 120, anchor: { joint: 'ankleN', at: at(100, FOOT_Y) } }, hold: 0.3 },
      ],
      move: 1.6,
    },
  },
  {
    id: 'pistol_squat',
    name: 'Pistol Squat',
    kind: 'reps',
    sets: 3,
    min: 3,
    max: 6,
    perSide: true,
    restSec: 90,
    equipment: 'none',
    stress: { knee: 3, hip: 2, ankle: 2, lower_back: 1 },
    cues: ['Stand on one leg, the other leg and both arms reach forward.', 'Sit all the way down under control, heel flat.', 'Stand up without bouncing at the bottom.'],
    mistake: 'Dropping fast into the bottom and losing the heel.',
    figure: {
      props: [floor],
      keys: [
        { pose: { torso: 178, armN: [70, 80], armF: [66, 76], legN: [2, 0], legF: [25, 18], anchor: { joint: 'ankleN', at: at(100, FOOT_Y) } }, hold: 0.3 },
        { pose: { torso: 138, armN: [92, 92], armF: [88, 88], legN: [80, -35], legF: [88, 92], footF: 120, anchor: { joint: 'ankleN', at: at(100, FOOT_Y) } }, hold: 0.3 },
      ],
      move: 1.6,
    },
  },

  // ---------- hinge ----------
  {
    id: 'glute_bridge',
    name: 'Glute Bridge',
    kind: 'reps',
    sets: 3,
    min: 12,
    max: 20,
    restSec: 60,
    equipment: 'none',
    stress: { hip: 1, lower_back: 1 },
    cues: ['Lie on your back, knees bent, feet flat near your hips.', 'Squeeze your glutes and lift the hips until knees, hips and shoulders line up.', 'Pause one second at the top, lower slowly.'],
    mistake: 'Arching the lower back instead of lifting with the glutes.',
    figure: {
      props: [floor],
      keys: [
        { pose: supine(0, { to: at(138, FOOT_Y), bend: -1 }), hold: 0.3 },
        { pose: supine(20, { to: at(138, FOOT_Y), bend: -1 }), hold: 0.8 },
      ],
      move: 1.1,
    },
  },
  {
    id: 'single_leg_glute_bridge',
    name: 'Single-Leg Glute Bridge',
    kind: 'reps',
    sets: 3,
    min: 8,
    max: 15,
    perSide: true,
    restSec: 60,
    equipment: 'none',
    stress: { hip: 2, lower_back: 1 },
    cues: ['One foot flat, the other leg straight and lifted.', 'Push through the planted heel and lift the hips level.', 'Keep both sides of the pelvis at the same height.'],
    mistake: 'The hip on the lifted-leg side sagging down.',
    figure: {
      props: [floor],
      keys: [
        { pose: supine(0, { to: at(138, FOOT_Y), bend: -1 }, { legF: [100, 100] }), hold: 0.3 },
        { pose: supine(20, { to: at(138, FOOT_Y), bend: -1 }, { legF: [112, 112] }), hold: 0.8 },
      ],
      move: 1.1,
    },
  },
  {
    id: 'single_leg_rdl',
    name: 'Single-Leg Romanian Deadlift',
    kind: 'reps',
    sets: 3,
    min: 6,
    max: 10,
    perSide: true,
    restSec: 60,
    equipment: 'none',
    stress: { hip: 2, lower_back: 2, knee: 1, ankle: 1 },
    cues: ['Stand on one leg with a soft knee.', 'Hinge at the hip: chest goes forward as the free leg goes back, in one straight line.', 'Stop when you feel the back of the thigh stretch, then return.'],
    mistake: 'Rounding the back to reach lower.',
    figure: {
      props: [floor],
      keys: [
        { pose: { torso: 180, armN: [2, 0], legN: [4, -2], legF: [-6, -8], anchor: { joint: 'ankleN', at: at(112, FOOT_Y) } }, hold: 0.3 },
        { pose: { torso: 98, armN: [2, 0], armF: [-2, -2], legN: [8, -4], legF: [-84, -84], footF: -170, anchor: { joint: 'ankleN', at: at(112, FOOT_Y) } }, hold: 0.5 },
      ],
      move: 1.6,
    },
  },

  // ---------- core ----------
  {
    id: 'dead_bug',
    name: 'Dead Bug',
    kind: 'reps',
    sets: 3,
    min: 6,
    max: 10,
    perSide: true,
    restSec: 45,
    equipment: 'none',
    stress: { lower_back: 1 },
    cues: ['On your back, arms up, knees bent 90° above the hips.', 'Press your lower back into the floor and keep it there.', 'Slowly reach one arm back and the opposite leg out, then switch.'],
    mistake: 'The lower back lifting off the floor as the leg goes out.',
    figure: {
      props: [floor],
      keys: [
        { pose: { torso: -90, neck: -90, armN: [180, 180], armF: [178, 178], legN: [180, 90], legF: [178, 88], anchor: { joint: 'hip', at: at(112, GROUND - 4) } }, hold: 0.3 },
        { pose: { torso: -90, neck: -90, armN: [-96, -96], armF: [178, 178], legN: [100, 100], legF: [178, 88], anchor: { joint: 'hip', at: at(112, GROUND - 4) } }, hold: 0.6 },
      ],
      move: 1.6,
    },
  },
  {
    id: 'hollow_hold',
    name: 'Hollow Body Hold',
    kind: 'hold',
    sets: 3,
    min: 20,
    max: 40,
    restSec: 45,
    equipment: 'none',
    stress: { lower_back: 2 },
    cues: ['On your back, lower back pressed into the floor.', 'Lift shoulders and legs a little; arms reach past your head.', 'Hold the banana shape and keep breathing.'],
    mistake: 'Legs too low for your strength, so the lower back arches up.',
    figure: {
      props: [floor],
      keys: [{ pose: { torso: -102, neck: -105, armN: [-100, -100], armF: [-102, -102], legN: [101, 101], legF: [99, 99], footN: 120, footF: 118, anchor: { joint: 'hip', at: at(104, GROUND - 6) } } }],
      move: 1,
    },
  },
  {
    id: 'knee_raise',
    name: "Captain's Chair Knee Raise",
    kind: 'reps',
    sets: 3,
    min: 8,
    max: 15,
    restSec: 60,
    equipment: 'tower',
    stress: { shoulder: 1, elbow: 1, lower_back: 1, hip: 1 },
    cues: ['Forearms on the rests, back against the pad, shoulders down.', 'Bring the knees up towards the chest.', 'Lower slowly — no swinging.'],
    mistake: 'Swinging the legs and using momentum.',
    figure: {
      props: [...chairProps],
      keys: [
        { pose: chair([2, 0]), hold: 0.3 },
        { pose: chair([102, 2]), hold: 0.4 },
      ],
      move: 1.2,
    },
  },
  {
    id: 'leg_raise',
    name: "Captain's Chair Leg Raise",
    kind: 'reps',
    sets: 3,
    min: 6,
    max: 12,
    restSec: 60,
    equipment: 'tower',
    stress: { shoulder: 1, elbow: 1, lower_back: 2, hip: 2 },
    cues: ['Same position as the knee raise.', 'Lift straight legs to hip height.', 'Lower in two seconds without swinging.'],
    mistake: 'Leaning back and arching instead of curling the hips up.',
    figure: {
      props: [...chairProps],
      keys: [
        { pose: chair([2, 2]), hold: 0.3 },
        { pose: chair([90, 90]), hold: 0.4 },
      ],
      move: 1.4,
    },
  },
  {
    id: 'hanging_knee_raise',
    name: 'Hanging Knee Raise',
    kind: 'reps',
    sets: 3,
    min: 6,
    max: 12,
    restSec: 75,
    equipment: 'tower',
    stress: { shoulder: 2, elbow: 1, wrist: 1, hip: 1, lower_back: 1 },
    cues: ['Hang from the bar, shoulders pulled down away from the ears.', 'Bring the knees up past the hips.', 'Lower slowly and stop the swing before the next rep.'],
    mistake: 'Swinging the whole body to get the knees up.',
    figure: {
      props: [bar],
      keys: [
        { pose: hanging([4, -6]), hold: 0.3 },
        { pose: hanging([108, 4], [104, 0]), hold: 0.4 },
      ],
      move: 1.2,
    },
  },
  {
    id: 'hanging_leg_raise',
    name: 'Hanging Leg Raise',
    kind: 'reps',
    sets: 3,
    min: 5,
    max: 10,
    restSec: 90,
    equipment: 'tower',
    stress: { shoulder: 2, elbow: 1, wrist: 1, hip: 2, lower_back: 2 },
    cues: ['Hang with active shoulders.', 'Lift straight legs to hip height or higher.', 'Lower under control, no swinging.'],
    mistake: 'Bending the knees halfway and calling it straight.',
    figure: {
      props: [bar],
      keys: [
        { pose: hanging([4, 4]), hold: 0.3 },
        { pose: hanging([95, 95], [92, 92]), hold: 0.4 },
      ],
      move: 1.4,
    },
  },

  // ---------- pull ----------
  {
    id: 'dead_hang',
    name: 'Dead Hang',
    kind: 'hold',
    sets: 3,
    min: 20,
    max: 45,
    restSec: 60,
    equipment: 'tower',
    stress: { shoulder: 2, elbow: 1, wrist: 1 },
    cues: ['Overhand grip, hands shoulder-width.', 'Hang with straight arms and relaxed legs.', 'Breathe; step down before the grip fails.'],
    mistake: 'Hanging with a painful shoulder — stop if it pinches.',
    figure: { props: [bar], keys: [{ pose: hanging() }], move: 1 },
  },
  {
    id: 'scapular_pullup',
    name: 'Scapular Pull-up',
    kind: 'reps',
    sets: 3,
    min: 6,
    max: 12,
    restSec: 60,
    equipment: 'tower',
    stress: { shoulder: 2, elbow: 1, wrist: 1 },
    cues: ['Start from a dead hang with straight arms.', 'Pull the shoulder blades down and back — the body rises a few centimetres.', 'Arms stay straight the whole time.'],
    mistake: 'Bending the elbows, which turns it into a small pull-up.',
    figure: {
      props: [bar, { kind: 'arrow', from: at(140, 120), to: at(140, 100) }],
      keys: [
        { pose: hanging(), hold: 0.3 },
        { pose: { ...hanging(), torso: 186, neck: 176, armN: [174, 186], armF: [172, 184] }, hold: 0.5 },
      ],
      move: 0.8,
    },
  },
  {
    id: 'negative_pullup',
    name: 'Negative Pull-up',
    kind: 'reps',
    sets: 3,
    min: 3,
    max: 5,
    restSec: 120,
    equipment: 'tower',
    stress: { shoulder: 3, elbow: 2, wrist: 1 },
    cues: ['Jump or step up so your chin is over the bar.', 'Lower yourself as slowly as you can — aim for five seconds.', 'Step back up; do not pull up from the bottom.'],
    mistake: 'Dropping fast in the last half of the way down.',
    figure: {
      props: [bar],
      keys: [
        { pose: { ...hanging([8, -20]), armN: [35, 172], armF: [33, 170] }, hold: 0.4, move: 4 },
        { pose: hanging(), hold: 0.3, move: 0.8 },
      ],
      move: 1,
    },
  },
  {
    id: 'pullup',
    name: 'Pull-up',
    kind: 'reps',
    sets: 3,
    min: 3,
    max: 8,
    restSec: 120,
    equipment: 'tower',
    stress: { shoulder: 3, elbow: 2, wrist: 1 },
    cues: ['Overhand grip, start from straight arms.', 'Pull the elbows down to your sides until the chin passes the bar.', 'Lower all the way under control.'],
    mistake: 'Half reps: not straightening the arms at the bottom.',
    figure: {
      props: [bar],
      keys: [
        { pose: hanging(), hold: 0.3, move: 1.2 },
        { pose: { ...hanging([8, -20]), armN: [35, 172], armF: [33, 170] }, hold: 0.3, move: 1.6 },
      ],
      move: 1.2,
    },
  },
  {
    id: 'chest_to_bar',
    name: 'Chest-to-Bar Pull-up',
    kind: 'reps',
    sets: 3,
    min: 3,
    max: 6,
    restSec: 120,
    equipment: 'tower',
    stress: { shoulder: 3, elbow: 3, wrist: 1 },
    cues: ['Same grip as a pull-up.', 'Pull higher, until your upper chest touches the bar.', 'Lean back slightly at the top and keep the elbows driving down.'],
    mistake: 'Kicking the legs to get higher.',
    figure: {
      props: [bar],
      keys: [
        { pose: hanging(), hold: 0.3, move: 1.3 },
        { pose: { ...hanging([10, -25]), torso: 196, neck: 186, armN: [-30, 150], armF: [-32, 148] }, hold: 0.3, move: 1.6 },
      ],
      move: 1.3,
    },
  },
  {
    id: 'archer_pullup',
    name: 'Archer Pull-up',
    kind: 'reps',
    sets: 3,
    min: 2,
    max: 5,
    perSide: true,
    restSec: 150,
    equipment: 'tower',
    stress: { shoulder: 3, elbow: 3, wrist: 2 },
    cues: ['Very wide grip on the bar.', 'Pull towards one hand while the other arm stays almost straight.', 'Lower slowly, then pull to the other side.'],
    mistake: 'Bending the "straight" arm so both arms share the work.',
    figure: {
      view: 'front',
      props: [{ kind: 'bar', y: 22, x1: 20, x2: 180 }],
      keys: [
        { pose: { torso: 180, armN: [219, 219], armF: [141, 141], legN: [-3, -6], legF: [3, 6], anchor: { joint: 'handN', at: at(58, 25) } }, hold: 0.3 },
        { pose: { torso: 178, armN: [258, 182], armF: [128, 128], legN: [-3, -6], legF: [3, 6], anchor: { joint: 'handN', at: at(58, 25) } }, hold: 0.4 },
      ],
      move: 1.6,
    },
  },
  {
    id: 'prone_y_raise',
    name: 'Prone Y Raise',
    kind: 'reps',
    sets: 3,
    min: 8,
    max: 15,
    restSec: 45,
    equipment: 'none',
    stress: { shoulder: 1, lower_back: 1 },
    cues: ['Lie face down, arms overhead in a Y, thumbs up.', 'Lift the arms a few centimetres by squeezing the shoulder blades down and together.', 'Hold one second, lower slowly. No pain allowed.'],
    mistake: 'Shrugging the shoulders up to the ears.',
    figure: {
      props: [floor],
      keys: [
        { pose: { torso: 90, neck: 92, armN: [92, 92], legN: [-90, -90], footN: -100, anchor: { joint: 'hip', at: at(80, GROUND - 4) } }, hold: 0.3 },
        { pose: { torso: 94, neck: 100, armN: [116, 116], armF: [114, 114], legN: [-90, -90], footN: -100, anchor: { joint: 'hip', at: at(80, GROUND - 4) } }, hold: 0.8 },
      ],
      move: 1,
    },
  },

  // ---------- dip ----------
  {
    id: 'support_hold',
    name: 'Support Hold',
    kind: 'hold',
    sets: 3,
    min: 15,
    max: 40,
    restSec: 60,
    equipment: 'tower',
    stress: { shoulder: 2, elbow: 1, wrist: 2 },
    cues: ['Hands on the dip handles, arms locked straight.', 'Push the shoulders down, away from your ears.', 'Knees bent, body still. Breathe.'],
    mistake: 'Shoulders sinking up towards the ears.',
    figure: { props: [dipBars], keys: [{ pose: support() }], move: 1 },
  },
  {
    id: 'negative_dip',
    name: 'Negative Dip',
    kind: 'reps',
    sets: 3,
    min: 3,
    max: 5,
    restSec: 120,
    equipment: 'tower',
    stress: { shoulder: 3, elbow: 2, wrist: 2 },
    cues: ['Start at the top of a support hold.', 'Lower slowly for about four seconds, leaning a little forward.', 'Stop when the upper arms are level with the floor, then step back up.'],
    mistake: 'Going deeper than the shoulder is comfortable with.',
    figure: {
      props: [dipBars],
      keys: [
        { pose: { torso: 180, armN: { to: at(103, 105), bend: 1 }, armF: { to: at(100, 105), bend: 1 }, legN: [8, -55], legF: [2, -60], anchor: { joint: 'shoulder', at: at(103, 55) } }, hold: 0.3, move: 3.5 },
        { pose: { torso: 166, armN: { to: at(103, 105), bend: 1 }, armF: { to: at(100, 105), bend: 1 }, legN: [12, -60], legF: [6, -64], anchor: { joint: 'shoulder', at: at(106, 84) } }, hold: 0.3, move: 0.9 },
      ],
      move: 1,
    },
  },
  {
    id: 'dip',
    name: 'Dip',
    kind: 'reps',
    sets: 3,
    min: 5,
    max: 12,
    restSec: 120,
    equipment: 'tower',
    stress: { shoulder: 3, elbow: 2, wrist: 2 },
    cues: ['From a support hold, lean slightly forward.', 'Lower until the upper arms are about level with the floor.', 'Press back up to straight arms.'],
    mistake: 'Dropping too deep, which strains the front of the shoulder.',
    figure: {
      props: [dipBars],
      keys: [
        { pose: { torso: 180, armN: { to: at(103, 105), bend: 1 }, armF: { to: at(100, 105), bend: 1 }, legN: [8, -55], legF: [2, -60], anchor: { joint: 'shoulder', at: at(103, 55) } }, hold: 0.3, move: 1.6 },
        { pose: { torso: 166, armN: { to: at(103, 105), bend: 1 }, armF: { to: at(100, 105), bend: 1 }, legN: [12, -60], legF: [6, -64], anchor: { joint: 'shoulder', at: at(106, 84) } }, hold: 0.2, move: 1.1 },
      ],
      move: 1.2,
    },
  },

  // ---------- L-sit ----------
  {
    id: 'tuck_l_sit',
    name: 'Tuck L-sit',
    kind: 'hold',
    sets: 3,
    min: 10,
    max: 20,
    restSec: 60,
    equipment: 'tower',
    stress: { shoulder: 2, wrist: 2, elbow: 1, hip: 1 },
    cues: ['Support hold on the dip handles.', 'Pull the knees up to the chest so the feet leave everything.', 'Shoulders down, arms locked, hold.'],
    mistake: 'Bending the arms to make it easier.',
    figure: { props: [dipBars], keys: [{ pose: support([112, 2]) }], move: 1 },
  },
  {
    id: 'l_sit',
    name: 'L-sit',
    kind: 'hold',
    sets: 3,
    min: 8,
    max: 20,
    restSec: 75,
    equipment: 'tower',
    stress: { shoulder: 2, wrist: 2, elbow: 1, hip: 2 },
    cues: ['Support hold, then lift straight legs to hip height.', 'Toes pointed, knees locked.', 'If the legs drop, go back to the tuck for the rest of the set.'],
    mistake: 'Leaning far back with bent arms.',
    figure: { props: [dipBars], keys: [{ pose: support([90, 90]) }], move: 1 },
  },

  // ---------- push ----------
  {
    id: 'wall_pushup',
    name: 'Wall Push-up',
    kind: 'reps',
    sets: 3,
    min: 12,
    max: 20,
    restSec: 45,
    equipment: 'wall',
    stress: { shoulder: 1, wrist: 1 },
    cues: ['Hands on the wall at chest height, a big step away.', 'Body straight from heels to head; bend the elbows towards the wall.', 'Elbows point back, not out to the sides.'],
    mistake: 'Hips sagging or sticking out.',
    figure: {
      props: [floor, { kind: 'wall', x: 162 }],
      keys: [
        { pose: { torso: 162, armN: { to: at(158, 72), bend: -1 }, legN: [-18, -18], footN: 60, footF: 60, anchor: { joint: 'ankleN', at: at(72, FOOT_Y - 6) } }, hold: 0.3 },
        { pose: { torso: 150, armN: { to: at(158, 72), bend: -1 }, legN: [-30, -30], footN: 60, footF: 60, anchor: { joint: 'ankleN', at: at(72, FOOT_Y - 6) } }, hold: 0.3 },
      ],
      move: 1.1,
    },
  },
  {
    id: 'incline_pushup',
    name: 'Incline Push-up',
    kind: 'reps',
    sets: 3,
    min: 8,
    max: 15,
    restSec: 60,
    equipment: 'chair',
    stress: { shoulder: 1, elbow: 1, wrist: 1 },
    cues: ['Hands on a sturdy bench or the seat of a chair against the wall.', 'Body straight; lower the chest to the edge.', 'Push back up to straight arms.'],
    mistake: 'Only the head moves down while the body stays up.',
    figure: {
      props: [floor, { kind: 'box', x: 140, y: 140, w: 50, h: 49 }],
      keys: [
        { pose: plank(125, at(14, FOOT_Y - 6), at(156, 136), 40), hold: 0.3 },
        { pose: plank(115, at(14, FOOT_Y - 6), at(156, 136), 40), hold: 0.3 },
      ],
      move: 1.2,
    },
  },
  {
    id: 'pushup',
    name: 'Push-up',
    kind: 'reps',
    sets: 3,
    min: 8,
    max: 15,
    restSec: 75,
    equipment: 'none',
    stress: { shoulder: 2, wrist: 2, elbow: 1 },
    cues: ['Hands a bit wider than the shoulders, body in one straight line.', 'Lower until the chest is a fist from the floor, elbows about 45° from the body.', 'Push the floor away to straight arms.'],
    mistake: 'Elbows flared straight out to the sides (hard on the shoulders).',
    figure: {
      props: [floor],
      keys: [
        { pose: plank(111, at(30, FOOT_Y - 8), at(148, FLOOR_HAND)), hold: 0.3 },
        { pose: plank(99, at(30, FOOT_Y - 8), at(148, FLOOR_HAND)), hold: 0.3 },
      ],
      move: 1.1,
    },
  },
  {
    id: 'deep_pushup',
    name: 'Deep Push-up on Handles',
    kind: 'reps',
    sets: 3,
    min: 6,
    max: 12,
    restSec: 90,
    equipment: 'tower',
    stress: { shoulder: 3, elbow: 1, wrist: 1 },
    cues: ['Grip the push-up handles on the tower base (or two sturdy blocks).', 'Lower the chest below the level of the hands.', 'Stop before it pinches in the shoulder; press up.'],
    mistake: 'Going deeper than the shoulder is ready for.',
    figure: {
      props: [floor, { kind: 'box', x: 140, y: 172, w: 18, h: 17 }],
      keys: [
        { pose: plank(113, at(30, FOOT_Y - 8), at(149, 170)), hold: 0.3 },
        { pose: plank(96, at(30, FOOT_Y - 8), at(149, 170)), hold: 0.3 },
      ],
      move: 1.3,
    },
  },
  {
    id: 'decline_pushup',
    name: 'Decline Push-up',
    kind: 'reps',
    sets: 3,
    min: 6,
    max: 12,
    restSec: 90,
    equipment: 'chair',
    stress: { shoulder: 3, wrist: 2, elbow: 2 },
    cues: ['Feet up on a bench or chair, hands on the floor.', 'Keep the body straight — do not pike the hips.', 'Lower the forehead/chest towards the floor, press up.'],
    mistake: 'Hips sagging towards the floor.',
    figure: {
      props: [floor, { kind: 'box', x: 6, y: 150, w: 44, h: 39 }],
      keys: [
        { pose: plank(96, at(34, 143), at(150, FLOOR_HAND), 30), hold: 0.3 },
        { pose: plank(85, at(34, 143), at(150, FLOOR_HAND), 30), hold: 0.3 },
      ],
      move: 1.2,
    },
  },
  {
    id: 'pseudo_planche_pushup',
    name: 'Pseudo Planche Push-up',
    kind: 'reps',
    sets: 3,
    min: 4,
    max: 8,
    restSec: 120,
    equipment: 'none',
    stress: { shoulder: 3, wrist: 3, elbow: 2 },
    cues: ['Hands beside the waist, fingers turned out or back.', 'Lean the shoulders well forward of the hands and keep that lean.', 'Lower and press while staying leaned forward.'],
    mistake: 'Losing the forward lean as you push up.',
    figure: {
      props: [floor],
      keys: [
        { pose: plank(110, at(24, FOOT_Y - 8), at(118, FLOOR_HAND)), hold: 0.3 },
        { pose: plank(100, at(24, FOOT_Y - 8), at(118, FLOOR_HAND)), hold: 0.3 },
      ],
      move: 1.3,
    },
  },

  // ---------- mobility (recovery quest + warm-ups) ----------
  {
    id: 'cat_cow',
    name: 'Cat–Cow',
    kind: 'reps',
    sets: 1,
    min: 10,
    max: 10,
    restSec: 0,
    equipment: 'none',
    stress: { wrist: 1 },
    cues: ['On hands and knees: hands under shoulders, knees under hips.', 'Breathe in: let the belly drop and look up (cow).', 'Breathe out: round the back towards the ceiling, chin to chest (cat).'],
    mistake: 'Rushing — move with your breath, slowly.',
    figure: {
      props: [floor],
      keys: [
        { pose: { torso: 102, neck: 130, armN: { to: at(130, FLOOR_HAND), bend: -1 }, legN: [0, -90], footN: -90, footF: -90, anchor: { joint: 'kneeN', at: at(82, GROUND - 3) } }, hold: 0.6 },
        { pose: { torso: 98, neck: 55, armN: { to: at(130, FLOOR_HAND), bend: -1 }, legN: [0, -90], footN: -90, footF: -90, anchor: { joint: 'kneeN', at: at(82, GROUND - 3) } }, hold: 0.6 },
      ],
      move: 1.6,
    },
  },
  {
    id: 'wall_slide',
    name: 'Wall Slide',
    kind: 'reps',
    sets: 1,
    min: 10,
    max: 10,
    restSec: 0,
    equipment: 'wall',
    stress: { shoulder: 1 },
    cues: ['Back, head and arms against the wall, elbows bent like a W.', 'Slide the arms up into a Y without the wrists leaving the wall.', 'Slide back down slowly. Stay below any pain.'],
    mistake: 'Arching the lower back to get the arms higher.',
    figure: {
      view: 'front',
      props: [floor],
      keys: [
        { pose: { torso: 180, armN: [-100, 178], armF: [100, 182], legN: [-4, -2], legF: [4, 2], footN: -90, footF: 90, anchor: { joint: 'hip', at: at(100, 111) } }, hold: 0.3 },
        { pose: { torso: 180, armN: [-150, -168], armF: [150, 168], legN: [-4, -2], legF: [4, 2], footN: -90, footF: 90, anchor: { joint: 'hip', at: at(100, 111) } }, hold: 0.3 },
      ],
      move: 1.6,
    },
  },
  {
    id: 'deep_squat_hold',
    name: 'Deep Squat Hold',
    kind: 'hold',
    sets: 1,
    min: 45,
    max: 45,
    restSec: 0,
    equipment: 'none',
    stress: { knee: 1, hip: 1, ankle: 1 },
    cues: ['Squat all the way down, heels flat (hold the tower if needed).', 'Elbows gently push the knees out.', 'Relax and breathe; shift your weight slowly side to side.'],
    mistake: 'Heels lifting — put something thin under them for now.',
    figure: {
      props: [floor],
      keys: [{ pose: { torso: 158, armN: [55, 110], armF: [50, 105], legN: [72, -38], legF: [69, -40], anchor: { joint: 'ankleN', at: at(102, FOOT_Y) } } }],
      move: 1,
    },
  },
  {
    id: 'hip_flexor_stretch',
    name: 'Half-Kneeling Hip Flexor Stretch',
    kind: 'hold',
    sets: 1,
    min: 30,
    max: 30,
    perSide: true,
    restSec: 0,
    equipment: 'none',
    stress: { knee: 1 },
    cues: ['Kneel on one knee, the other foot flat in front.', 'Squeeze the glute of the back leg and tuck the pelvis under.', 'Shift forward gently until the front of the back hip stretches.'],
    mistake: 'Arching the lower back instead of tucking the pelvis.',
    figure: {
      props: [floor],
      keys: [
        { pose: { torso: 180, armN: [4, 2], legN: [80, 0], legF: [-18, -90], footF: -90, anchor: { joint: 'ankleN', at: at(128, FOOT_Y) } }, hold: 0.6 },
        { pose: { torso: 182, armN: [4, 2], legN: [62, -8], legF: [-34, -90], footF: -90, anchor: { joint: 'ankleN', at: at(128, FOOT_Y) } }, hold: 1 },
      ],
      move: 1.6,
    },
  },
  {
    id: 'forward_fold',
    name: 'Standing Forward Fold',
    kind: 'hold',
    sets: 1,
    min: 30,
    max: 30,
    restSec: 0,
    equipment: 'none',
    stress: { lower_back: 1 },
    cues: ['Feet hip-width, knees soft.', 'Fold forward from the hips and let the arms and head hang.', 'Breathe out and sink a little deeper each breath; roll up slowly.'],
    mistake: 'Forcing straight knees — bend them as much as you need.',
    figure: {
      props: [floor],
      keys: [
        { pose: standing(96), hold: 0.4 },
        { pose: { torso: 42, neck: 20, armN: [4, 0], armF: [2, -2], legN: [10, -6], legF: [12, -4], anchor: { joint: 'ankleN', at: at(96, FOOT_Y) } }, hold: 1 },
      ],
      move: 2,
    },
  },
];

export const BY_ID: ReadonlyMap<string, Exercise> = new Map(EXERCISES.map((e) => [e.id, e]));

export function exercise(id: string): Exercise {
  const e = BY_ID.get(id);
  if (!e) throw new Error(`unknown exercise '${id}'`);
  return e;
}

export interface Ladder {
  id: LadderId;
  name: string;
  /** Exercise ids from easiest to hardest. */
  levels: string[];
  /** Ladder used when none of this ladder's levels is possible today. */
  fallback?: LadderId;
}

export const LADDERS: Record<LadderId, Ladder> = {
  pull: { id: 'pull', name: 'Pull', levels: ['dead_hang', 'scapular_pullup', 'negative_pullup', 'pullup', 'chest_to_bar', 'archer_pullup'], fallback: 'pull_floor' },
  pull_floor: { id: 'pull_floor', name: 'Pull (floor)', levels: ['prone_y_raise'] },
  dip: { id: 'dip', name: 'Dip', levels: ['support_hold', 'negative_dip', 'dip'], fallback: 'push' },
  push: { id: 'push', name: 'Push', levels: ['wall_pushup', 'incline_pushup', 'pushup', 'deep_pushup', 'decline_pushup', 'pseudo_planche_pushup'] },
  legs: { id: 'legs', name: 'Legs', levels: ['wall_sit', 'squat', 'split_squat', 'bulgarian_split_squat', 'assisted_pistol', 'pistol_squat'] },
  hinge: { id: 'hinge', name: 'Hinge', levels: ['glute_bridge', 'single_leg_glute_bridge', 'single_leg_rdl'] },
  core: { id: 'core', name: 'Core', levels: ['dead_bug', 'hollow_hold', 'knee_raise', 'leg_raise', 'hanging_knee_raise', 'hanging_leg_raise'] },
  lsit: { id: 'lsit', name: 'L-sit', levels: ['support_hold', 'tuck_l_sit', 'l_sit'], fallback: 'core' },
};

/** Ladders whose level the hunter tracks (pull_floor has a single level). */
export const TRACKED_LADDERS = ['pull', 'dip', 'push', 'legs', 'hinge', 'core', 'lsit'] as const satisfies readonly LadderId[];

export const WARMUP_A = ['cat_cow', 'wall_slide'];
export const WARMUP_B = ['deep_squat_hold', 'hip_flexor_stretch'];
export const RECOVERY = ['cat_cow', 'wall_slide', 'deep_squat_hold', 'hip_flexor_stretch', 'forward_fold', 'dead_hang'];
