import { describe, expect, it } from 'vitest';

import { register } from './index.js';
import {
  enabledWorkoutFamilies,
  painLevel,
  phaseForDay,
  selectWorkoutId,
  todayRestrictions,
  workoutStreakDays,
} from './rules.js';
import type {
  CreateFitnessOutput,
  FitnessMission,
  LogPainOutput,
  PluginRegistry,
  PluginStateStore,
  PluginToolDef,
  SetEquipmentOutput,
  StatusOutput,
  TodayOutput,
} from './types.js';

// ---- In-memory fake host ----------------------------------------------------
//
// The real host backs `registry.state` with scoped SQLite rows. Here we stand
// in a tiny Map-based store. Values are JSON round-tripped on every read/write
// so the fake matches the host's serialize-on-store contract — including the
// SPEC §7.4 rule that a malformed value reads back as "no value" rather than
// throwing. A shared backing Map across two registries emulates "same plugin,
// fresh process" persistence.

function makeStore(backing: Map<string, string>): PluginStateStore {
  return {
    get<T>(key: string): T | null {
      const raw = backing.get(key);
      if (raw === undefined) return null;
      try {
        return JSON.parse(raw) as T;
      } catch {
        return null; // malformed value → treat as absent
      }
    },
    set(key: string, value: unknown): void {
      backing.set(key, JSON.stringify(value));
    },
    delete(key: string): void {
      backing.delete(key);
    },
    update<T>(key: string, mutator: (current: T | null) => T): T {
      const raw = backing.get(key);
      let current: T | null = null;
      if (raw !== undefined) {
        try {
          current = JSON.parse(raw) as T;
        } catch {
          current = null;
        }
      }
      const next = mutator(current);
      backing.set(key, JSON.stringify(next));
      return next;
    },
  };
}

type Call = (name: string, args?: Record<string, unknown>) => Promise<unknown>;

function mount(backing: Map<string, string> = new Map()): { call: Call; backing: Map<string, string> } {
  const tools = new Map<string, PluginToolDef>();
  const registry: PluginRegistry = {
    registerTool: (def) => tools.set(def.name, def),
    state: makeStore(backing),
  };
  register(registry);
  const call: Call = async (name, args = {}) => {
    const tool = tools.get(name);
    if (!tool) throw new Error(`unknown tool: ${name}`);
    return tool.handler(args);
  };
  return { call, backing };
}

describe('rules', () => {
  it('maps mission day to phase at the SPEC boundaries', () => {
    expect(phaseForDay(1).name).toBe('foundation');
    expect(phaseForDay(30).name).toBe('foundation');
    expect(phaseForDay(31).name).toBe('base_strength');
    expect(phaseForDay(76).name).toBe('progressive_strength');
    expect(phaseForDay(136).name).toBe('definition');
  });

  it('grades pain into normal/caution/avoid', () => {
    expect(painLevel(1)).toBe('normal');
    expect(painLevel(3)).toBe('caution');
    expect(painLevel(7)).toBe('avoid');
  });

  it('emits a graded shoulder restriction with the right message code', () => {
    expect(todayRestrictions({ shoulder: { status: 'watch', lastPain: 2 } })[0]).toMatchObject({
      level: 'watch',
      messageCode: 'NO_HEAVY_OVERHEAD_PRESSING',
    });
    expect(todayRestrictions({ shoulder: { status: 'avoid', lastPain: 6 } })[0]).toMatchObject({
      level: 'avoid',
      messageCode: 'SHOULDER_PAIN_HIGH',
    });
  });

  it('unlocks dumbbell families only when bench+dumbbells are present', () => {
    expect(enabledWorkoutFamilies('bench')).not.toContain('phase2_bench_dumbbell');
    expect(enabledWorkoutFamilies('bench_dumbbells')).toContain('phase2_bench_dumbbell');
    expect(enabledWorkoutFamilies('pullup_bar_bench_dumbbells')).toContain('phase2_pullup_dumbbell');
  });

  it('swaps a push day for legs/core under high shoulder pain', () => {
    const mission = { history: [], equipment: { level: 'none' } } as unknown as FitnessMission;
    const restrictions = todayRestrictions({ shoulder: { status: 'avoid', lastPain: 6 } });
    expect(selectWorkoutId(mission, { number: 1, name: 'foundation', startedAt: 'x' }, restrictions)).toBe(
      'phase1_legs_core',
    );
  });

  it('counts a trailing workout streak ending today', () => {
    const mission = {
      history: [
        { completed: true, date: '2026-06-26' },
        { completed: true, date: '2026-06-27' },
        { completed: true, date: '2026-06-28' },
      ],
    } as unknown as FitnessMission;
    expect(workoutStreakDays(mission, '2026-06-28')).toBe(3);
    expect(workoutStreakDays(mission, '2026-06-30')).toBe(0); // gap breaks it
  });
});

describe('plugin demo flow (SPEC §10)', () => {
  it('create → today → log pain → today → set equipment → status', async () => {
    const { call } = mount();

    const created = (await call('plugin_fitness_create', {
      goal: 'visible_abs',
      smokeFreeSince: '2026-06-01',
      alcoholFreeSince: '2026-06-01',
      restrictions: { shoulder: { side: 'right', status: 'watch', lastPain: 2 } },
    })) as CreateFitnessOutput;
    expect(created.created).toBe(true);
    expect(created.mission.type).toBe('fitness_180');

    const day1 = (await call('plugin_fitness_today')) as TodayOutput;
    expect(day1.exists).toBe(true);
    expect(day1.phase?.name).toBe('foundation');
    expect(day1.workoutId).toBe('phase1_fullbody_a');
    expect(day1.restrictions?.[0]?.messageCode).toBe('NO_HEAVY_OVERHEAD_PRESSING');
    expect(day1.streaks?.smokeFreeDays).toBeGreaterThan(0);

    const pain = (await call('plugin_fitness_log_pain', {
      area: 'shoulder',
      side: 'right',
      value: 5,
    })) as LogPainOutput;
    expect(pain.restrictionLevel).toBe('avoid');

    const afterPain = (await call('plugin_fitness_today')) as TodayOutput;
    expect(afterPain.workoutId).toBe('phase1_legs_core');
    expect(afterPain.restrictions?.[0]?.messageCode).toBe('SHOULDER_PAIN_HIGH');

    const equip = (await call('plugin_fitness_set_equipment', {
      level: 'bench_dumbbells',
    })) as SetEquipmentOutput;
    expect(equip.enabledWorkoutFamilies).toContain('phase2_bench_dumbbell');

    const status = (await call('plugin_fitness_status')) as StatusOutput;
    expect(status.exists).toBe(true);
    expect(status.summary?.smokeFreeDays).toBeGreaterThan(0);
    expect(status.summary?.activeRestrictions[0]?.messageCode).toBe('SHOULDER_PAIN_HIGH');
  });

  it('returns a safe fallback when no mission exists', async () => {
    const { call } = mount();
    const today = (await call('plugin_fitness_today')) as TodayOutput;
    expect(today.exists).toBe(false);
    expect(today.requiredAction).toBe('create_mission');
  });

  it('persists mission state across a fresh registry instance', async () => {
    const backing = new Map<string, string>();
    const first = mount(backing);
    await first.call('plugin_fitness_create', { goal: 'general_fitness' });

    // A brand new registry/handler set, same backing store → same persisted state.
    const second = mount(backing);
    const status = (await second.call('plugin_fitness_status')) as StatusOutput;
    expect(status.exists).toBe(true);
    expect(status.mission?.goal).toBe('general_fitness');
  });

  it('treats a malformed stored value as no mission', async () => {
    const backing = new Map<string, string>([['mission', '{not valid json']]);
    const { call } = mount(backing);
    const today = (await call('plugin_fitness_today')) as TodayOutput;
    expect(today.exists).toBe(false);
    expect(today.requiredAction).toBe('create_mission');
  });
});
