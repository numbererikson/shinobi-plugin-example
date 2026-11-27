// What each skill means outside the app: the real-world feat a ladder step
// gives you. Shown on the path ahead and when a skill unlocks, so every
// level is a thing you can do, not just a number.

export const FEATS: Record<string, string> = {
  // pull
  dead_hang: 'Hang from a ledge or a branch with a grip that holds.',
  scapular_pullup: 'Shoulders strong and stable enough to hang safely.',
  negative_pullup: 'Lower yourself down a wall or a tree under control.',
  pullup: 'Pull your own body up: onto a wall, a ledge, out of a pool.',
  chest_to_bar: 'Pull high enough to get your chest over an obstacle.',
  archer_pullup: 'One arm does most of the pulling. Few gym-goers ever get here.',
  prone_y_raise: 'Upper back that keeps your shoulders healthy and your posture tall.',
  // dip / L-sit
  support_hold: 'Hold your weight on straight arms: the start of climbing over a fence.',
  negative_dip: 'Lower yourself from a high wall without dropping.',
  dip: 'Push yourself up out of a pool or onto a high wall.',
  tuck_l_sit: 'Lift your whole body off the ground on your hands.',
  l_sit: 'Hold your body and legs off the floor on your hands. Pure control.',
  // push
  wall_pushup: 'Pressing that is kind to the joints, and the first step back.',
  incline_pushup: 'Push yourself up off a table or a counter with ease.',
  pushup: 'Push yourself up off the ground from flat, any time.',
  deep_pushup: 'Full-range pressing strength for shoulders that last.',
  decline_pushup: 'Pressing power for lifting things overhead.',
  pseudo_planche_pushup: 'Strength on the way to holding your body off the floor.',
  // legs
  wall_sit: 'Legs that hold you through a long day on your feet.',
  squat: 'Get down to the floor and back up without a second thought.',
  split_squat: 'Take steep stairs two at a time.',
  bulgarian_split_squat: 'Strong single legs for hiking, skiing and running.',
  assisted_pistol: 'Stand up from a low seat on one leg.',
  pistol_squat: 'Full squat on one leg. Strength and balance few people have.',
  // hinge
  glute_bridge: 'A back that holds when you lift a box.',
  single_leg_glute_bridge: 'Hips strong enough to protect your knees and back.',
  single_leg_rdl: 'Pick something up from the floor balanced on one leg.',
  // core
  dead_bug: 'A trunk that protects your lower back.',
  hollow_hold: 'Brace your body like a plank of steel: the base of every skill.',
  knee_raise: 'Core control for getting up and moving freely.',
  leg_raise: 'Lift your legs with a flat back: real lower-belly strength.',
  hanging_knee_raise: 'Lift your legs while hanging: climbing over obstacles.',
  hanging_leg_raise: 'Full-body control hanging from a bar.',
};

export const featOf = (id: string): string | null => FEATS[id] ?? null;
