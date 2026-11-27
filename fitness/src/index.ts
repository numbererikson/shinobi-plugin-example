// shinobi-plugin-fitness — "The System".
//
// A bodyweight strength trainer for Shinobi: progression ladders instead of
// heavier weights, a Daily Quest every day, ranks E→S earned at Gates (tests),
// injury-aware substitutions and animated exercise figures on the dashboard.
// State lives in Shinobi's per-plugin store (`registry.state`, key "hunter").
// The plugin returns facts; the LLM talks to the user in their own language.

import { AREAS, BY_ID, EXERCISES, LADDERS, TRACKED_LADDERS, type Area } from './exercises.js';
import { renderPage } from './page.js';
import { activeToday, endSession, recordSet, restLeft, skipRest, skipStep, startSession, type Readiness } from './session.js';
import {
  clearGate,
  completeQuest,
  formatDays,
  hunterLevel,
  logSets,
  newHunter,
  nextRankNeeds,
  parseDays,
  parseTime,
  questFor,
  reportPain,
  stats,
  streak,
  updateProfile,
  xpForLevel,
  type Baseline,
  type ProfilePatch,
  type QuestItem,
} from './rules.js';
import { T } from './text.js';
import { GATE_TESTS, STATE_KEY, type Feel, type GateTest, type HunterState, type PluginRegistry, type Side } from './types.js';

export interface Clock {
  now(): Date;
}

const PAGE_ID = 'the-system';
const PAGE_URL = `/apps/${PAGE_ID}`;
const WARNING_TIME = '19:30';

// ---- small input helpers ------------------------------------------------------

function optNum(v: unknown, name: string, min: number, max: number): number | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'));
  if (!Number.isFinite(n) || n < min || n > max) throw new Error(`${name} must be a number between ${min} and ${max}`);
  return n;
}

function optBool(v: unknown): boolean | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  if (typeof v === 'boolean') return v;
  return ['true', 'yes', '1', 'on'].includes(String(v).toLowerCase());
}

function optStr(v: unknown, max: number): string | undefined {
  if (v === undefined || v === null) return undefined;
  const s = String(v).trim();
  return s ? s.slice(0, max) : undefined;
}

function assertTimeZone(tz: string): string {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    throw new Error(`unknown time zone '${tz}' — use an IANA name such as Europe/Zagreb`);
  }
}

const AREA_ALIASES: Record<string, Area> = { back: 'lower_back', 'lower back': 'lower_back', lowerback: 'lower_back', shoulders: 'shoulder', knees: 'knee', elbows: 'elbow', wrists: 'wrist', hips: 'hip', ankles: 'ankle' };

function parseArea(v: unknown): Area {
  const s = String(v ?? '').trim().toLowerCase().replace(/-/g, '_');
  const a = (AREAS as string[]).includes(s) ? (s as Area) : AREA_ALIASES[s.replace(/_/g, ' ')] ?? AREA_ALIASES[s];
  if (!a) throw new Error(`area must be one of: ${AREAS.join(', ')}`);
  return a;
}

function parseSide(v: unknown): Side {
  const s = String(v ?? 'both').trim().toLowerCase();
  if (s === 'left' || s === 'right' || s === 'both') return s;
  throw new Error("side must be 'left', 'right' or 'both'");
}

function parseSets(args: Record<string, unknown>): number[] {
  if (Array.isArray(args.sets)) return args.sets.map((n, i) => optNum(n, `set ${i + 1}`, 0, 600) ?? 0);
  const sets: number[] = [];
  for (let i = 1; i <= 10; i++) {
    const v = optNum(args[`set${i}`], `set ${i}`, 0, 600);
    if (v !== undefined) sets.push(v);
  }
  return sets;
}

function findExercise(v: unknown): string {
  const s = String(v ?? '').trim().toLowerCase();
  if (BY_ID.has(s)) return s;
  const byName = EXERCISES.find((e) => e.name.toLowerCase() === s || e.id.replace(/_/g, ' ') === s);
  if (byName) return byName.id;
  throw new Error(`unknown exercise '${String(v)}' — call plugin_fitness_exercise without an id for the list`);
}

function localNow(tz: string, now: Date): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? '00';
  return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${get('hour')}:${get('minute')}` };
}

function hostTimeZone(): string {
  const env = typeof process !== 'undefined' ? process.env.SHINOBI_TIMEZONE : undefined;
  try {
    return assertTimeZone(env || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
  } catch {
    return 'UTC';
  }
}

const describeItem = (q: QuestItem): Record<string, unknown> => {
  const ex = BY_ID.get(q.exercise)!;
  return {
    exercise: q.exercise,
    name: q.name,
    ...(q.ladder ? { ladder: q.ladder, level: q.level } : {}),
    prescription: `${q.sets} × ${q.min}-${q.max} ${q.kind === 'hold' ? 'seconds' : 'reps'}${q.perSide ? ' per side' : ''}`,
    today: q.target,
    rest_seconds: q.restSec,
    cues: ex.cues,
    avoid: ex.mistake,
    ...(q.note ? { note: q.note } : {}),
    ...(q.logged ? { logged_today: q.logged } : {}),
  };
};

// ---- plugin ------------------------------------------------------------------

export function registerFitness(registry: PluginRegistry, clock: Clock = { now: () => new Date() }): void {
  const store = registry.state;
  const defaultTz = hostTimeZone();

  const read = (): HunterState | null => {
    const s = store.get<HunterState>(STATE_KEY);
    return s && s.version === 2 ? s : null;
  };
  const today = (s: HunterState | null): { date: string; time: string } => localNow(s?.profile.timezone ?? defaultTz, clock.now());
  const need = (): HunterState => {
    const s = read();
    if (!s) throw new Error('No Hunter yet. Run plugin_fitness_setup first (or open The System page in the dashboard).');
    return s;
  };
  /** Atomic read-modify-write of the hunter. */
  const mutate = <R>(fn: (s: HunterState, date: string) => R): R => {
    let out: R | undefined;
    store.update<HunterState>(STATE_KEY, (cur) => {
      if (!cur || cur.version !== 2) throw new Error('No Hunter yet. Run plugin_fitness_setup first.');
      out = fn(cur, today(cur).date);
      return cur;
    });
    return out as R;
  };
  const optDate = (v: unknown, s: HunterState): string => {
    if (v === undefined || v === null || v === '') return today(s).date;
    const d = String(v);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || Number.isNaN(Date.parse(d))) throw new Error('date must be YYYY-MM-DD');
    if (d > today(s).date) throw new Error('date cannot be in the future');
    return d;
  };

  function statusOf(s: HunterState): Record<string, unknown> {
    const { date } = today(s);
    const level = hunterLevel(s.xp);
    return {
      hunter: s.profile.name ?? null,
      day: Math.round((Date.parse(date) - Date.parse(s.startDate)) / 86_400_000) + 1,
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
          const at = s.levels[l];
          return [l, { current: levels[at], level: at + 1, of: levels.length, next: levels[at + 1] ?? null }];
        }),
      ),
      best: s.best,
      next_gate: s.nextGate,
      next_rank: nextRankNeeds(s),
      profile: { ...s.profile, trainingDays: formatDays(s.profile.trainingDays) },
      recent_events: s.events.slice(-6),
      page: PAGE_URL,
    };
  }

  registry.registerTool({
    name: 'plugin_fitness_setup',
    description:
      'Awaken a Hunter in The System (bodyweight strength training, ranks E→S). Call once with age, height and weight; baseline estimates (push-ups, pull-ups, squats) and any pain are optional. Pass reset: true to erase an existing Hunter and start over.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        age: { type: 'number' },
        height_cm: { type: 'number' },
        weight_kg: { type: 'number' },
        training_days: { description: "e.g. 'mon,wed,fri' or [1,3,5] (0 = Sunday). Default Mon, Wed, Fri.", type: ['string', 'array'] },
        quest_time: { type: 'string', description: 'Daily Quest push time, HH:MM. Default 10:30.' },
        timezone: { type: 'string', description: 'IANA zone, e.g. Europe/Zagreb.' },
        tower: { type: 'boolean', description: 'Has a power tower (pull-up bar + dip handles).' },
        chair: { type: 'boolean', description: 'Has a sturdy chair or bench. Default true.' },
        pushups: { type: 'number' },
        pullups: { type: 'number' },
        squats: { type: 'number' },
        wall_sit: { type: 'number', description: 'seconds' },
        dead_hang: { type: 'number', description: 'seconds' },
        dips: { type: 'number' },
        pains: { type: 'array', items: { type: 'object', properties: { area: { type: 'string' }, side: { type: 'string' }, pain: { type: 'number' }, note: { type: 'string' } }, required: ['area', 'pain'] } },
        pain_area: { type: 'string' },
        pain_side: { type: 'string' },
        pain: { type: 'number' },
        reset: { type: 'boolean' },
      },
      additionalProperties: false,
    },
    handler: (args) => {
      if (read() && args.reset !== true) throw new Error('A Hunter already exists. Use plugin_fitness_profile to change details, or pass reset: true to erase everything and start over.');
      const timezone = assertTimeZone(optStr(args.timezone, 60) ?? defaultTz);
      const profile: HunterState['profile'] = {
        trainingDays: parseDays(args.training_days) ?? [1, 3, 5],
        questTime: parseTime(args.quest_time) ?? '10:30',
        eveningWarning: true,
        timezone,
        equipment: { tower: optBool(args.tower) ?? false, chair: optBool(args.chair) ?? true },
      };
      const name = optStr(args.name, 40);
      if (name) profile.name = name;
      const age = optNum(args.age, 'age', 10, 100);
      if (age !== undefined) profile.age = Math.round(age);
      const height = optNum(args.height_cm, 'height_cm', 100, 230);
      if (height !== undefined) profile.heightCm = height;
      const weight = optNum(args.weight_kg, 'weight_kg', 30, 250);
      if (weight !== undefined) profile.weightKg = weight;

      const baseline: Baseline = {};
      const b = (key: keyof Baseline, v: unknown, max: number): void => {
        const n = optNum(v, key, 0, max);
        if (n !== undefined) baseline[key] = n;
      };
      b('pushups', args.pushups, 300);
      b('pullups', args.pullups, 100);
      b('squats', args.squats, 500);
      b('wallSit', args.wall_sit, 900);
      b('deadHang', args.dead_hang, 900);
      b('dips', args.dips, 200);

      const date = localNow(timezone, clock.now()).date;
      const state = newHunter(profile, date, baseline);
      const pains = Array.isArray(args.pains) ? (args.pains as Record<string, unknown>[]) : [];
      if (args.pain_area !== undefined && args.pain !== undefined) pains.push({ area: args.pain_area, side: args.pain_side, pain: args.pain });
      for (const p of pains) {
        const level = optNum(p.pain, 'pain', 0, 10) ?? 0;
        if (level > 0) reportPain(state, date, parseArea(p.area), parseSide(p.side), level, optStr(p.note, 300));
      }
      store.set(STATE_KEY, state);
      return { message: '[SYSTEM] Awakening complete. Welcome, Hunter.', status: statusOf(state), today: questFor(state, date).type };
    },
  });

  registry.registerTool({
    name: 'plugin_fitness_status',
    description: "The Hunter's Status Window: rank, level, XP, stats (STR/AGI/VIT/END), streak, injuries, skill ladders, best test results, next Gate and what the next rank needs.",
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: () => {
      const s = read();
      return s ? statusOf(s) : { exists: false, next: 'plugin_fitness_setup' };
    },
  });

  registry.registerTool({
    name: 'plugin_fitness_today',
    description:
      "Today's quest: training (A/B), recovery or a Gate (test day). Lists each exercise with today's target per set, rest, coaching cues and any injury adjustment. Explain it to the user in their language; the dashboard page shows animations.",
    inputSchema: { type: 'object', properties: { date: { type: 'string', description: 'YYYY-MM-DD, default today' } }, additionalProperties: false },
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
        how_to_do_it:
          'Guided: plugin_fitness_start, then plugin_fitness_set after every set (the page shows each step with its animation). ' +
          (q.type === 'gate' ? 'Or log all trial results at once with plugin_fitness_gate.' : 'Or log whole exercises with plugin_fitness_log and finish with plugin_fitness_complete.'),
        in_progress: describeSession(s, date),
        page: PAGE_URL,
      };
    },
  });

  // ---- guided quest: start → set → (rest) → … → summary ----

  const describeSession = (s: HunterState, date: string): Record<string, unknown> => {
    const a = activeToday(s, date);
    if (!a) return { running: false };
    if (a.finished) return { running: false, finished: a.finished, page: PAGE_URL };
    const step = a.steps[a.cursor]!;
    const ex = BY_ID.get(step.exercise)!;
    return {
      running: true,
      quest: a.type,
      session: a.session ?? null,
      light_day: a.light ?? null,
      side_quest: a.sideQuest ?? null,
      step: a.cursor + 1,
      of: a.steps.length,
      current: {
        kind: step.kind,
        exercise: ex.id,
        name: ex.name,
        set: step.done.length + 1,
        sets: step.sets,
        target: step.target[step.done.length] ?? null,
        unit: ex.kind === 'hold' ? 'seconds' : 'reps',
        per_side: ex.perSide === true,
        cues: ex.cues,
        avoid: ex.mistake,
        ...(step.note ? { note: step.note } : {}),
      },
      rest_seconds_left: restLeft(a, clock.now()),
      next: a.steps.slice(a.cursor + 1).map((x) => BY_ID.get(x.exercise)!.name),
      page: PAGE_URL,
    };
  };

  registry.registerTool({
    name: 'plugin_fitness_start',
    description:
      "Start (or resume) today's quest as a guided session: warm-up, then each set with its target and the rest between sets, then the rehab side quest if something hurts. Ask first how they slept and how sore they are: poor sleep or heavy soreness makes it a light day. Report each set with plugin_fitness_set.",
    inputSchema: {
      type: 'object',
      properties: {
        sleep: { type: 'string', enum: ['good', 'ok', 'poor'] },
        soreness: { type: 'string', enum: ['none', 'some', 'heavy'] },
      },
      additionalProperties: false,
    },
    handler: (args) => {
      const pick = <T extends string>(v: unknown, allowed: readonly T[], name: string): T | undefined => {
        if (v === undefined || v === null || v === '') return undefined;
        if (!allowed.includes(v as T)) throw new Error(`${name} must be one of: ${allowed.join(', ')}`);
        return v as T;
      };
      const readiness: Readiness = {};
      const sleep = pick(args.sleep, ['good', 'ok', 'poor'] as const, 'sleep');
      if (sleep) readiness.sleep = sleep;
      const soreness = pick(args.soreness, ['none', 'some', 'heavy'] as const, 'soreness');
      if (soreness) readiness.soreness = soreness;
      return mutate((s, date) => {
        startSession(s, date, clock.now(), readiness);
        return describeSession(s, date);
      });
    },
  });

  registry.registerTool({
    name: 'plugin_fitness_set',
    description: 'Report the set just done in the running quest: reps, or seconds for holds (for a Gate trial: the all-out result). Moves to the rest, the next set or the next exercise; after the last step the quest is logged and completed.',
    inputSchema: {
      type: 'object',
      properties: {
        value: { type: 'number', description: 'Reps done or seconds held' },
        feel: { type: 'string', enum: ['easy', 'ok', 'hard'], description: 'How the exercise felt (ask on its last set): easy raises the next target faster, hard keeps it.' },
      },
      required: ['value'],
      additionalProperties: false,
    },
    handler: (args) => {
      const value = optNum(args.value, 'value', 0, 900);
      if (value === undefined) throw new Error('value is required (reps or seconds)');
      const feel = args.feel === undefined || args.feel === '' ? undefined : String(args.feel);
      if (feel !== undefined && feel !== 'easy' && feel !== 'ok' && feel !== 'hard') throw new Error("feel must be 'easy', 'ok' or 'hard'");
      return mutate((s, date) => {
        recordSet(s, date, clock.now(), value, feel as Feel | undefined);
        return describeSession(s, date);
      });
    },
  });

  registry.registerTool({
    name: 'plugin_fitness_skip',
    description: "In the running quest: skip the current rest (what: 'rest') or the current exercise (what: 'exercise').",
    inputSchema: { type: 'object', properties: { what: { type: 'string', enum: ['rest', 'exercise'] } }, required: ['what'], additionalProperties: false },
    handler: (args) =>
      mutate((s, date) => {
        if (args.what === 'rest') skipRest(s, date);
        else if (args.what === 'exercise') skipStep(s, date, clock.now());
        else throw new Error("what must be 'rest' or 'exercise'");
        return describeSession(s, date);
      }),
  });

  registry.registerTool({
    name: 'plugin_fitness_end',
    description: 'End the running quest now. Sets done so far are logged; the quest counts as complete if any real work was done.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: () =>
      mutate((s, date) => {
        endSession(s, date, clock.now());
        return describeSession(s, date);
      }),
  });

  registry.registerTool({
    name: 'plugin_fitness_log',
    description:
      'Log the sets of one exercise (reps, or seconds for holds), e.g. { exercise: "pullup", sets: [6, 5, 5] }. Hitting the top of the range in two sessions unlocks the next skill; falling short twice recalibrates one step down.',
    inputSchema: {
      type: 'object',
      properties: {
        exercise: { type: 'string', description: 'Exercise id (or exact name).' },
        sets: { type: 'array', items: { type: 'number' } },
        set1: { type: 'number' },
        set2: { type: 'number' },
        set3: { type: 'number' },
        set4: { type: 'number' },
        set5: { type: 'number' },
        date: { type: 'string', description: 'YYYY-MM-DD, default today' },
      },
      required: ['exercise'],
      additionalProperties: false,
    },
    handler: (args) => {
      const id = findExercise(args.exercise);
      const sets = parseSets(args);
      if (sets.length === 0) throw new Error('give the sets, e.g. sets: [8, 8, 7]');
      return mutate((s) => {
        const d = optDate(args.date, s);
        const r = logSets(s, d, id, sets);
        const messages = [
          ...r.unlocked.map((u) => `[SYSTEM] Skill unlocked: ${BY_ID.get(u.to)!.name}.`),
          ...r.recalibrated.map((u) => `[SYSTEM] Recalibrating: ${BY_ID.get(u.to)!.name} until the base is solid.`),
        ];
        if (!messages.length && r.hitTop) messages.push('Top of the range. Do it once more next session to unlock the next skill.');
        return { ...r, date: d, messages };
      });
    },
  });

  registry.registerTool({
    name: 'plugin_fitness_complete',
    description: "Mark today's Daily Quest (training or recovery) complete for XP and the streak. A Gate is cleared with plugin_fitness_gate instead.",
    inputSchema: { type: 'object', properties: { date: { type: 'string', description: 'YYYY-MM-DD, default today' } }, additionalProperties: false },
    handler: (args) =>
      mutate((s) => {
        const d = optDate(args.date, s);
        const r = completeQuest(s, d);
        return { ...r, date: d, level: hunterLevel(s.xp), total_xp: s.xp, streak_days: streak(s, d), message: r.already ? 'Already completed.' : T.questDone };
      }),
  });

  registry.registerTool({
    name: 'plugin_fitness_pain',
    description:
      'Report pain in an area (0-10); 0 means it is gone. 1-2: train normally below pain; 3-4: only light exercises for that area; 5+: that area rests. The System swaps exercises automatically.',
    inputSchema: {
      type: 'object',
      properties: {
        area: { type: 'string', enum: AREAS },
        side: { type: 'string', enum: ['left', 'right', 'both'] },
        pain: { type: 'number', minimum: 0, maximum: 10 },
        note: { type: 'string' },
      },
      required: ['area', 'pain'],
      additionalProperties: false,
    },
    handler: (args) => {
      const area = parseArea(args.area);
      const side = parseSide(args.side);
      const pain = optNum(args.pain, 'pain', 0, 10) ?? 0;
      return mutate((s, date) => {
        const r = reportPain(s, date, area, side, pain, optStr(args.note, 300));
        return { ...r, injuries: s.injuries, today: questFor(s, date).main.map((q) => q.name) };
      });
    },
  });

  registry.registerTool({
    name: 'plugin_fitness_profile',
    description:
      'Change the Hunter profile: weight_kg, waist_cm, height_cm, age, name, training_days, quest_time, evening_warning, timezone, equipment (tower, chair). Every change is kept in the history; adding a power tower opens a Gate.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        age: { type: 'number' },
        height_cm: { type: 'number' },
        weight_kg: { type: 'number' },
        waist_cm: { type: 'number' },
        training_days: { type: ['string', 'array'] },
        quest_time: { type: 'string' },
        evening_warning: { type: 'boolean' },
        timezone: { type: 'string' },
        tower: { type: 'boolean' },
        chair: { type: 'boolean' },
      },
      additionalProperties: false,
    },
    handler: (args) => {
      const patch: ProfilePatch = {};
      const name = optStr(args.name, 40);
      if (name) patch.name = name;
      const age = optNum(args.age, 'age', 10, 100);
      if (age !== undefined) patch.age = Math.round(age);
      const h = optNum(args.height_cm, 'height_cm', 100, 230);
      if (h !== undefined) patch.heightCm = h;
      const w = optNum(args.weight_kg, 'weight_kg', 30, 250);
      if (w !== undefined) patch.weightKg = w;
      const waist = optNum(args.waist_cm, 'waist_cm', 40, 200);
      if (waist !== undefined) patch.waistCm = waist;
      const days = parseDays(args.training_days);
      if (days) patch.trainingDays = days;
      const time = parseTime(args.quest_time);
      if (time) patch.questTime = time;
      const warn = optBool(args.evening_warning);
      if (warn !== undefined) patch.eveningWarning = warn;
      const tz = optStr(args.timezone, 60);
      if (tz) patch.timezone = assertTimeZone(tz);
      const tower = optBool(args.tower);
      if (tower !== undefined) patch.tower = tower;
      const chair = optBool(args.chair);
      if (chair !== undefined) patch.chair = chair;
      return mutate((s, date) => {
        const changed = updateProfile(s, date, patch);
        return { changed, profile: { ...s.profile, trainingDays: formatDays(s.profile.trainingDays) }, next_gate: s.nextGate };
      });
    },
  });

  registry.registerTool({
    name: 'plugin_fitness_gate',
    description:
      'Clear a Gate: log one all-out set of each trial (pullups, pushups, dips = reps; dead_hang, hollow_hold, l_sit = seconds). Updates best results, raises skill ladders the results justify, and decides the rank (E→S). Gates open every 6 weeks.',
    inputSchema: {
      type: 'object',
      properties: Object.fromEntries([...GATE_TESTS.map((t) => [t, { type: 'number' }]), ['date', { type: 'string' }]]),
      additionalProperties: false,
    },
    handler: (args) => {
      const results: Partial<Record<GateTest, number>> = {};
      for (const t of GATE_TESTS) {
        const v = optNum(args[t], t, 0, 900);
        if (v !== undefined) results[t] = v;
      }
      return mutate((s) => {
        const d = optDate(args.date, s);
        const r = clearGate(s, d, results);
        return {
          ...r,
          message: r.rankAfter !== r.rankBefore ? `[SYSTEM] Rank up! ${r.rankBefore} → ${r.rankAfter}.` : `[SYSTEM] Gate ${r.number} cleared.`,
          next_gate: s.nextGate,
          next_rank: nextRankNeeds(s),
        };
      });
    },
  });

  registry.registerTool({
    name: 'plugin_fitness_exercise',
    description: 'How to do an exercise: cues, the common mistake, target range, which ladder it belongs to and what it loads. Without an id, lists every exercise by ladder.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, additionalProperties: false },
    handler: (args) => {
      if (args.id === undefined || args.id === '') {
        return {
          ladders: Object.fromEntries(Object.values(LADDERS).map((l) => [l.id, l.levels.map((id) => ({ id, name: BY_ID.get(id)!.name }))])),
          mobility: EXERCISES.filter((e) => !Object.values(LADDERS).some((l) => l.levels.includes(e.id))).map((e) => ({ id: e.id, name: e.name })),
        };
      }
      const e = BY_ID.get(findExercise(args.id))!;
      const ladders = Object.values(LADDERS).filter((l) => l.levels.includes(e.id)).map((l) => ({ ladder: l.id, level: l.levels.indexOf(e.id) + 1, of: l.levels.length }));
      return {
        id: e.id,
        name: e.name,
        kind: e.kind,
        target: `${e.sets} × ${e.min}-${e.max} ${e.kind === 'hold' ? 'seconds' : 'reps'}${e.perSide ? ' per side' : ''}`,
        rest_seconds: e.restSec,
        equipment: e.equipment,
        loads: e.stress,
        cues: e.cues,
        avoid: e.mistake,
        ladders,
        animation: `${PAGE_URL} (open the exercise in today's quest)`,
      };
    },
  });

  registry.registerTool({
    name: 'plugin_fitness_history',
    description: 'Training history: completed quests, logged sets, body weight/waist, Gate results and profile changes over the last N days (default 30).',
    inputSchema: { type: 'object', properties: { days: { type: 'number' } }, additionalProperties: false },
    handler: (args) => {
      const s = need();
      const days = Math.round(optNum(args.days, 'days', 1, 3650) ?? 30);
      const { date } = today(s);
      const from = new Date(Date.parse(`${date}T12:00:00Z`) - (days - 1) * 86_400_000).toISOString().slice(0, 10);
      const within = <T extends { date: string }>(xs: T[]): T[] => xs.filter((x) => x.date >= from);
      return {
        from,
        to: date,
        quests: within(s.quests),
        logs: within(s.logs).map((l) => ({ ...l, name: BY_ID.get(l.exercise)?.name ?? l.exercise })),
        body: within(s.body),
        gates: s.gates,
        profile_changes: within(s.profileHistory),
      };
    },
  });

  // ---- Daily Quest push + evening warning (every minute, compares local time) ----

  async function tick(): Promise<{ sent: string | null }> {
    const s = read();
    if (!s || !registry.notify) return { sent: null };
    const { date, time } = today(s);
    if (date < s.startDate) return { sent: null };
    const q = questFor(s, date);
    if (q.done) return { sent: null };

    let kind: 'quest' | 'warning' | null = null;
    if (time >= s.profile.questTime && s.notified.quest !== date) kind = 'quest';
    else if (s.profile.eveningWarning && s.profile.questTime < WARNING_TIME && time >= WARNING_TIME && s.notified.warning !== date) kind = 'warning';
    if (!kind) return { sent: null };

    // Claim the slot first so a slow push can never be sent twice.
    store.update<HunterState>(STATE_KEY, (cur) => {
      if (cur) cur.notified = { ...cur.notified, [kind!]: date };
      return cur as HunterState;
    });
    const names = q.main.map((m) => m.name).join(', ');
    const n =
      kind === 'warning'
        ? { title: T.notify.warningTitle, body: T.notify.warningBody }
        : q.type === 'gate'
          ? { title: T.notify.gateTitle, body: 'Today is a test day. Warm up, then one all-out set of each trial.' }
          : q.type === 'training'
            ? { title: T.notify.questTitle, body: `Training ${q.session}: ${names}.${q.deload ? ' Deload week.' : ''}` }
            : { title: T.notify.recoveryTitle, body: `Mobility, about 10 minutes: ${names}.` };
    try {
      await registry.notify({
        ...n,
        url: PAGE_URL,
        tag: `fitness-${date}`,
        ...(q.type === 'recovery' && kind === 'quest' ? { actions: [{ label: 'Done', tool: 'plugin_fitness_complete', args: { date } }] } : {}),
      });
    } catch (err) {
      console.error(`fitness: notify failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    return { sent: kind };
  }

  if (typeof registry.schedule === 'function' && typeof registry.notify === 'function') {
    registry.schedule({ id: 'quest-tick', cron: '* * * * *', run: tick });
  }

  // ---- morning brief ----
  if (typeof registry.brief === 'function') {
    registry.brief({
      id: 'quest',
      order: 20,
      render: () => {
        const s = read();
        if (!s) return null;
        const { date } = today(s);
        const q = questFor(s, date);
        const what =
          q.type === 'gate' ? 'a Gate is open (test day)' : q.type === 'training' ? `Training ${q.session} — ${q.main.map((m) => m.name).join(', ')}` : 'Recovery (10 min mobility)';
        return `⚔️ The System: ${what} · Rank ${s.rank} · Lv ${hunterLevel(s.xp)} · streak ${streak(s, date)}`;
      },
    });
  }

  // ---- dashboard page: sidebar → Apps → The System (right after Music) ----
  if (typeof registry.registerPage === 'function') {
    registry.registerPage({
      id: PAGE_ID,
      title: 'The System',
      icon: 'swords',
      order: 12,
      theme: 'hologram',
      render: () => {
        const s = read();
        return renderPage(s, today(s).date, clock.now(), defaultTz);
      },
    });
  }
}

export default function register(registry: PluginRegistry): void {
  registerFitness(registry);
}
