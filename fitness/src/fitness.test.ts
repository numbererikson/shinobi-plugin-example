import { describe, expect, it } from 'vitest';

import { EXERCISES, LADDERS } from './exercises.js';
import { renderFigure } from './figure.js';
import { registerFitness, type Clock } from './index.js';
import { renderPage } from './page.js';
import { addDays, clearGate, completeQuest, isDeload, logSets, newHunter, parseDays, parseTime, questFor, rankFor, reportPain, updateProfile } from './rules.js';
import type { HunterState, PluginRegistry, Profile } from './types.js';

// ---- fakes -----------------------------------------------------------------

type Handler = (args: Record<string, unknown>) => unknown;

function fakeHost(clock: Clock) {
  const data = new Map<string, unknown>();
  const tools = new Map<string, Handler>();
  const schedules: (() => unknown)[] = [];
  const pushes: { title: string; body: string; actions?: unknown[] }[] = [];
  const pages: { id: string; order?: number; theme?: string; render: () => unknown }[] = [];
  const clone = <T>(v: T): T => (v === undefined || v === null ? v : JSON.parse(JSON.stringify(v)));
  const registry: PluginRegistry = {
    state: {
      get: <T>(k: string) => (clone(data.get(k)) as T) ?? null,
      set: (k, v) => void data.set(k, clone(v)),
      delete: (k) => void data.delete(k),
      // Like the host's db.transaction: a throwing mutator leaves the value untouched.
      update: <T>(k: string, fn: (cur: T | null) => T) => {
        const next = fn(clone(data.get(k) as T) ?? null);
        data.set(k, clone(next));
        return next;
      },
    },
    registerTool: (def) => void tools.set(def.name, def.handler as Handler),
    registerPage: (def) => void pages.push(def),
    schedule: (def) => void schedules.push(def.run),
    notify: async (n) => {
      pushes.push(n);
      return { total: 1 };
    },
    brief: () => undefined,
  };
  registerFitness(registry, clock);
  const call = (name: string, args: Record<string, unknown> = {}) => {
    const h = tools.get(name);
    if (!h) throw new Error(`no tool ${name}`);
    return h(args) as Record<string, any>;
  };
  return { call, tools, schedules, pushes, pages, hunter: () => data.get('hunter') as HunterState };
}

/** A settable clock; Zagreb is UTC+1 in winter. */
function clockAt(iso: string): Clock & { set(iso: string): void } {
  let now = new Date(iso);
  return { now: () => now, set: (v: string) => void (now = new Date(v)) };
}

const profile = (over: Partial<Profile> = {}): Profile => ({
  trainingDays: [1, 3, 5],
  questTime: '10:30',
  eveningWarning: true,
  timezone: 'Europe/Zagreb',
  equipment: { tower: true, chair: true },
  ...over,
});

const MONDAY = '2026-11-30';

// ---- figures -----------------------------------------------------------------

const FORBIDDEN = [/<script/i, /<foreignObject/i, /<image/i, /\son[a-z]+\s*=/i, /javascript:/i, /\bhref\s*=\s*(?:"(?!#)|'(?!#)|(?!["'#\s]))/i, /url\(\s*(?:"(?!#)|'(?!#)|(?!["'#\s]))/i];

describe('figures', () => {
  it.each(EXERCISES.map((e) => [e.id, e] as const))('%s renders a self-contained animated SVG', (_id, e) => {
    const svg = renderFigure(e.figure, e.name);
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(svg.endsWith('</svg>')).toBe(true);
    expect(svg).not.toMatch(/NaN|Infinity|undefined/);
    for (const re of FORBIDDEN) expect(svg).not.toMatch(re);
    expect(svg.length).toBeLessThan(100_000);
    if (e.figure.keys.length > 1) expect(svg).toContain('<animate');
  });

  it('every ladder level is a known exercise with sane targets', () => {
    for (const l of Object.values(LADDERS)) {
      for (const id of l.levels) {
        const e = EXERCISES.find((x) => x.id === id);
        expect(e, id).toBeDefined();
        expect(e!.min).toBeLessThanOrEqual(e!.max);
        expect(e!.cues).toHaveLength(3);
      }
    }
  });
});

// ---- rules -------------------------------------------------------------------

describe('new hunter', () => {
  it('places ladders from the baseline and opens the Awakening Gate on the first training day', () => {
    const s = newHunter(profile(), MONDAY, { pushups: 15, squats: 25, pullups: 6 });
    expect(LADDERS.push.levels[s.levels.push]).toBe('pushup');
    expect(LADDERS.legs.levels[s.levels.legs]).toBe('split_squat');
    expect(LADDERS.pull.levels[s.levels.pull]).toBe('pullup');
    expect(s.rank).toBe('E');
    expect(questFor(s, MONDAY).type).toBe('gate');
    expect(questFor(s, addDays(MONDAY, 1)).type).toBe('recovery');
  });
});

describe('quests and injuries', () => {
  const afterGate = (p: Profile = profile()) => {
    const s = newHunter(p, MONDAY, { pushups: 15, squats: 25, pullups: 6 });
    s.nextGate = addDays(MONDAY, 42);
    return s;
  };

  it('alternates A and B sessions on training days', () => {
    const s = afterGate();
    const a = questFor(s, MONDAY);
    expect(a.type).toBe('training');
    expect(a.session).toBe('A');
    expect(a.main.map((m) => m.exercise)).toEqual(['pullup', 'pushup', 'split_squat', 'dead_bug']);
    completeQuest(s, MONDAY);
    const b = questFor(s, addDays(MONDAY, 2));
    expect(b.session).toBe('B');
    // Dip and L-sit both start at the support hold: L-sit falls back to core instead of repeating it.
    expect(b.main.map((m) => m.ladder)).toEqual(['pull', 'dip', 'hinge', 'core', 'legs']);
    expect(b.main.map((m) => m.exercise)).toContain('support_hold');
  });

  it('swaps shoulder-heavy work for light work at pain 3-4, and rests the area at 5+', () => {
    const s = afterGate();
    reportPain(s, MONDAY, 'shoulder', 'right', 4);
    const q = questFor(s, MONDAY);
    const byLadder = Object.fromEntries(q.main.map((m) => [m.ladder, m.exercise]));
    expect(byLadder.pull_floor).toBe('prone_y_raise');
    expect(byLadder.push).toBe('incline_pushup');
    expect(q.main.find((m) => m.exercise === 'prone_y_raise')?.note).toMatch(/shoulder pain 4\/10/);

    reportPain(s, MONDAY, 'shoulder', 'right', 6);
    const rest = questFor(s, MONDAY);
    expect(rest.main.map((m) => m.exercise)).toEqual(['split_squat', 'dead_bug']);
    expect(rest.skipped.map((x) => x.ladder)).toEqual(['pull', 'push']);

    reportPain(s, MONDAY, 'shoulder', 'right', 0);
    expect(s.injuries).toEqual([]);
    expect(questFor(s, MONDAY).main[0]!.exercise).toBe('pullup');
  });

  it('works without a tower: floor pull work, no tower exercises', () => {
    const s = afterGate(profile({ equipment: { tower: false, chair: true } }));
    const q = questFor(s, MONDAY);
    expect(q.main.map((m) => m.exercise)).toEqual(['prone_y_raise', 'pushup', 'split_squat', 'dead_bug']);
  });

  it('marks every fifth week as a deload with fewer sets at the bottom of the range', () => {
    const s = afterGate();
    expect(isDeload(s, MONDAY)).toBe(false);
    expect(isDeload(s, addDays(MONDAY, 28))).toBe(true);
    const q = questFor(s, addDays(MONDAY, 28));
    expect(q.deload).toBe(true);
    expect(q.main[0]!.target).toEqual([3, 3]);
  });
});

describe('progression', () => {
  it('prescribes one more rep than last time, unlocks after two top sessions, recalibrates after two weak ones', () => {
    const s = newHunter(profile(), MONDAY, { pushups: 10 });
    s.nextGate = addDays(MONDAY, 42);
    expect(questFor(s, MONDAY).main.find((m) => m.exercise === 'pushup')!.target).toEqual([8, 8, 8]);
    logSets(s, MONDAY, 'pushup', [10, 9, 8]);
    expect(questFor(s, addDays(MONDAY, 2)).main.length).toBeGreaterThan(0);
    expect(questFor(s, addDays(MONDAY, 7)).main.find((m) => m.exercise === 'pushup')!.target).toEqual([11, 10, 9]);

    expect(logSets(s, MONDAY, 'pushup', [15, 15, 15]).unlocked).toEqual([]);
    const up = logSets(s, addDays(MONDAY, 2), 'pushup', [15, 16, 15]);
    expect(up.unlocked).toEqual([{ ladder: 'push', from: 'pushup', to: 'deep_pushup' }]);
    expect(s.events.at(-1)!.text).toMatch(/Skill unlocked: Deep Push-up/);

    logSets(s, addDays(MONDAY, 4), 'deep_pushup', [3, 2, 2]);
    const down = logSets(s, addDays(MONDAY, 7), 'deep_pushup', [4, 3, 2]);
    expect(down.recalibrated).toEqual([{ ladder: 'push', from: 'deep_pushup', to: 'pushup' }]);
  });

  it('logging a substitute does not move the ladder', () => {
    const s = newHunter(profile(), MONDAY, { pushups: 10 });
    logSets(s, MONDAY, 'wall_pushup', [20, 20, 20]);
    logSets(s, MONDAY, 'wall_pushup', [20, 20, 20]);
    expect(LADDERS.push.levels[s.levels.push]).toBe('pushup');
  });
});

describe('XP, streak and gates', () => {
  it('rewards quests, refuses to complete a Gate day and ranks up at a Gate', () => {
    const s = newHunter(profile(), MONDAY, { pushups: 10 });
    expect(() => completeQuest(s, MONDAY)).toThrow(/Gate/);
    const g = clearGate(s, MONDAY, { pullups: 5, pushups: 18, dips: 4, dead_hang: 40, hollow_hold: 25, l_sit: 3 });
    expect(g.number).toBe(1);
    expect(s.levels.legs).toBe(1);
    // Legs ladder is still at squat, so rank D (needs split squat) is not met yet.
    expect(g.rankAfter).toBe('E');
    s.levels.legs = 2;
    expect(rankFor(s)).toBe('D');
    expect(s.nextGate).toBe(addDays(MONDAY, 42));
    expect(s.xp).toBe(300);

    const tue = addDays(MONDAY, 1);
    expect(completeQuest(s, tue)).toMatchObject({ already: false, type: 'recovery', xp: 30 });
    expect(completeQuest(s, tue).already).toBe(true);
  });
});

describe('profile', () => {
  it('keeps a history, logs body weight, and a new tower opens a Gate', () => {
    const s = newHunter(profile({ equipment: { tower: false, chair: true }, weightKg: 75 }), MONDAY);
    s.nextGate = addDays(MONDAY, 40);
    const day = addDays(MONDAY, 10);
    const changed = updateProfile(s, day, { weightKg: 74, tower: true, waistCm: 84 });
    expect(changed).toEqual(['weightKg', 'equipment.tower', 'waistCm']);
    expect(s.profileHistory.map((h) => h.field)).toEqual(['weightKg', 'equipment.tower']);
    expect(s.body.at(-1)).toEqual({ date: day, weightKg: 74, waistCm: 84 });
    expect(s.nextGate).toBe(day);
  });

  it('parses days and times', () => {
    expect(parseDays('Mon, wed;FRI')).toEqual([1, 3, 5]);
    expect(parseDays([0, 6])).toEqual([0, 6]);
    expect(() => parseDays('funday')).toThrow(/unknown day/);
    expect(parseTime('9.05')).toBe('09:05');
    expect(() => parseTime('25:00')).toThrow();
  });
});

// ---- tools, page and pushes through the registry ---------------------------------------

describe('plugin', () => {
  it('setup → today → log → complete through the tools', () => {
    const clock = clockAt('2026-11-30T09:31:00Z'); // Monday 10:31 in Zagreb
    const host = fakeHost(clock);
    expect(host.call('plugin_fitness_status')).toEqual({ exists: false, next: 'plugin_fitness_setup' });
    host.call('plugin_fitness_setup', { name: 'Tom', age: 43, height_cm: 173, weight_kg: 75, pushups: 15, squats: 25, tower: true, timezone: 'Europe/Zagreb', pains: [{ area: 'shoulder', side: 'right', pain: 3 }] });
    expect(() => host.call('plugin_fitness_setup', { age: 1 })).toThrow(/already exists/);
    expect(host.call('plugin_fitness_today').type).toBe('gate');

    const gate = host.call('plugin_fitness_gate', { pushups: 15, hollow_hold: 30, dead_hang: 35, pullups: 4, dips: 2, l_sit: 0 });
    expect(gate.number).toBe(1);

    clock.set('2026-12-02T09:31:00Z'); // Wednesday
    const today = host.call('plugin_fitness_today');
    expect(today.type).toBe('training');
    expect(today.exercises[0].cues).toHaveLength(3);
    const log = host.call('plugin_fitness_log', { exercise: today.exercises[0].exercise, set1: 5, set2: 5, set3: 4 });
    expect(log.sets).toEqual([5, 5, 4]);
    expect(host.call('plugin_fitness_complete').xp).toBe(100);
    expect(host.call('plugin_fitness_status').streak_days).toBe(1);
    expect(() => host.call('plugin_fitness_log', { exercise: 'moonwalk', sets: [1] })).toThrow(/unknown exercise/);
  });

  it('pushes the Daily Quest once at quest time and an evening warning, never when done', async () => {
    const clock = clockAt('2026-12-01T09:00:00Z'); // Tuesday 10:00
    const host = fakeHost(clock);
    host.call('plugin_fitness_setup', { age: 43, height_cm: 173, weight_kg: 75, timezone: 'Europe/Zagreb' });
    const tick = host.schedules[0]!;
    expect(await tick()).toEqual({ sent: null });
    clock.set('2026-12-01T09:30:00Z');
    expect(await tick()).toEqual({ sent: 'quest' });
    expect(await tick()).toEqual({ sent: null });
    expect(host.pushes[0]).toMatchObject({ title: '[SYSTEM] Recovery Quest has arrived', actions: [{ tool: 'plugin_fitness_complete' }] });
    clock.set('2026-12-01T18:31:00Z');
    expect(await tick()).toEqual({ sent: 'warning' });
    host.call('plugin_fitness_complete');
    clock.set('2026-12-02T09:45:00Z');
    host.call('plugin_fitness_complete', { date: '2026-12-01' });
    expect(host.pushes).toHaveLength(2);
  });

  it('registers a themed page after Music and renders every section', () => {
    const host = fakeHost(clockAt('2026-11-30T09:31:00Z'));
    const page = host.pages[0]!;
    expect(page).toMatchObject({ id: 'the-system', order: 12, theme: 'hologram' });
    const empty = page.render() as { type: string; tool?: string }[];
    expect(empty.find((b) => b.type === 'form')?.tool).toBe('plugin_fitness_setup');

    host.call('plugin_fitness_setup', { age: 43, height_cm: 173, weight_kg: 75, tower: true });
    const blocks = page.render() as { type: string; text?: string; tool?: string }[];
    const headings = blocks.filter((b) => b.type === 'heading').map((b) => b.text);
    expect(headings).toEqual(['Status Window', 'Gate', 'Skills', 'History', 'Profile']);
    expect(blocks.some((b) => b.type === 'figure')).toBe(true);
    expect(blocks.filter((b) => b.type === 'form').map((b) => b.tool)).toEqual(['plugin_fitness_gate', 'plugin_fitness_profile', 'plugin_fitness_pain']);
    expect(renderPage(null, MONDAY, 'UTC')[0]).toMatchObject({ type: 'heading', text: 'Awakening' });
  });
});
