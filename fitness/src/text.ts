// Every fixed sentence the System says, in one place (a future locale only
// has to translate this table). Exercise names and cues live in exercises.ts.

export const T = {
  awakening:
    '[SYSTEM] A new Hunter has been detected.\n' +
    'The System trains strength you can carry anywhere: pull, push, legs and core, with your own body weight. ' +
    'No heavy loads, no training to failure — every exercise climbs a ladder from easy to elite, and you climb it when you own it.\n' +
    'Register below. Your first training day is the Awakening Gate: a short test that places you on every ladder.',
  trainingIntro:
    'Press START and the System walks you through it: warm-up, then every set with its target and the rest between sets. ' +
    'Stop each set with about two reps left in the tank — clean reps only. Everything is logged for you.',
  recoveryIntro: 'Recovery day. Ten easy minutes of mobility keep the joints happy and the streak alive. A 30-minute walk counts as a bonus.',
  gateIntro:
    'A Gate has opened: a short test. Warm up, then one all-out set of each trial with strict form and full rest between them. ' +
    'The results place you on the ladders and decide your rank.',
  deload: 'Deload week: one set fewer, bottom of the range, no level-ups. Recovery is part of the plan.',
  questDone: '[SYSTEM] Quest complete. Rest well, Hunter.',
  questDoneShort: '✓ Completed today.',
  noTower: 'Pull, dip and L-sit ladders unlock fully when you add a power tower in your profile. Until then the System substitutes floor work.',
  notify: {
    questTitle: '[SYSTEM] Daily Quest has arrived',
    recoveryTitle: '[SYSTEM] Recovery Quest has arrived',
    gateTitle: '[SYSTEM] A Gate has opened',
    warningTitle: '[SYSTEM] Warning',
    warningBody: 'The Daily Quest is still incomplete. A short quest now keeps your streak alive.',
  },
} as const;
