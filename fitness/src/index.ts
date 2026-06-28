// @shinobi/plugin-fitness — a headless Shinobi plugin (mission type:
// fitness_180).
//
// It demonstrates long-term adaptive mission state on top of Shinobi's
// writable, per-plugin state store (`registry.state`): the plugin owns
// structured facts, restrictions, IDs and snapshots; the LLM owns all language.
// The plugin never returns coaching or motivational text.
//
// This is a standalone, publishable package. It depends only on the plugin
// *contract* (declared locally in ./types.ts), never on Shinobi internals — the
// host supplies the concrete, SQLite-backed state store at load time.

import {
  dayOfMission,
  daysBetween,
  effectivePhase,
  enabledWorkoutFamilies,
  applyPainToRestrictions,
  painLevel,
  selectWorkoutId,
  todayIso,
  todayRestrictions,
  workoutStreakDays,
} from './rules.js';
import type {
  CreateFitnessInput,
  CreateFitnessOutput,
  FitnessMission,
  FitnessPluginState,
  FitnessSummary,
  LogPainInput,
  LogPainOutput,
  LogWeightInput,
  LogWeightOutput,
  LogWorkoutInput,
  LogWorkoutOutput,
  PluginRegistry,
  SetEquipmentInput,
  SetEquipmentOutput,
  StatusOutput,
  TodayOutput,
} from './types.js';

const STATE_KEY = 'mission';

const RULES = { trainToFailure: false as const, repsInReserve: 2, maxPainAllowed: 4 };

function emptyState(): FitnessPluginState {
  return { version: 1, missions: [] };
}

function activeMission(state: FitnessPluginState): FitnessMission | undefined {
  return state.missions.find((m) => m.id === state.activeMissionId);
}

function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
}

function buildSummary(mission: FitnessMission, today: string): FitnessSummary {
  const phase = effectivePhase(mission, today);
  const completed = mission.history.filter((w) => w.completed);
  const cutoff = daysBetween('1970-01-01', today) - 14;
  const last14 = completed.filter((w) => daysBetween('1970-01-01', w.date) > cutoff).length;
  const weights = mission.weightHistory;
  const latestWeightKg = weights.at(-1)?.weightKg ?? mission.profile.weightKg;
  const startWeight = weights[0]?.weightKg ?? mission.profile.weightKg;
  return {
    day: dayOfMission(mission.startedAt, today),
    phase: phase.name,
    workoutsCompleted: completed.length,
    workoutsLast14Days: last14,
    smokeFreeDays: mission.habits.smokeFreeSince
      ? daysBetween(mission.habits.smokeFreeSince, today)
      : undefined,
    alcoholFreeDays: mission.habits.alcoholFreeSince
      ? daysBetween(mission.habits.alcoholFreeSince, today)
      : undefined,
    latestWeightKg,
    deltaFromStartKg:
      latestWeightKg !== undefined && startWeight !== undefined
        ? Math.round((latestWeightKg - startWeight) * 10) / 10
        : undefined,
    activeRestrictions: todayRestrictions(mission.restrictions),
  };
}

function buildToday(mission: FitnessMission, today: string): TodayOutput {
  const phase = effectivePhase(mission, today);
  const restrictions = todayRestrictions(mission.restrictions);
  return {
    exists: true,
    missionId: mission.id,
    day: dayOfMission(mission.startedAt, today),
    phase,
    workoutId: selectWorkoutId(mission, phase, restrictions),
    restrictions,
    streaks: {
      smokeFreeDays: mission.habits.smokeFreeSince
        ? daysBetween(mission.habits.smokeFreeSince, today)
        : undefined,
      alcoholFreeDays: mission.habits.alcoholFreeSince
        ? daysBetween(mission.habits.alcoholFreeSince, today)
        : undefined,
      workoutStreakDays: workoutStreakDays(mission, today),
    },
    rules: RULES,
  };
}

/** Persist any phase advancement effectivePhase() computed, so it sticks. */
function commitPhase(mission: FitnessMission, today: string): FitnessMission {
  const phase = effectivePhase(mission, today);
  if (phase.number === mission.phase.number) return mission;
  return { ...mission, phase };
}

export function register(registry: PluginRegistry): void {
  const store = registry.state;

  registry.registerTool({
    name: 'plugin_fitness_create',
    description:
      'Create a fitness_180 mission and persist its initial state (profile, habits, equipment, restrictions). Returns the structured mission. Does not generate any coaching text.',
    inputSchema: {
      type: 'object',
      properties: {
        goal: { type: 'string', enum: ['visible_abs', 'general_fitness', 'custom'] },
        targetDays: { type: 'number' },
        profile: { type: 'object' },
        smokeFreeSince: { type: 'string' },
        alcoholFreeSince: { type: 'string' },
        equipment: { type: 'object' },
        restrictions: { type: 'object' },
      },
      additionalProperties: false,
    },
    handler: (args): CreateFitnessOutput => {
      const input = args as CreateFitnessInput;
      const today = todayIso();
      const mission: FitnessMission = {
        id: newId('mission'),
        type: 'fitness_180',
        status: 'active',
        createdAt: today,
        startedAt: today,
        targetDays: input.targetDays ?? 180,
        goal: input.goal ?? 'visible_abs',
        profile: input.profile ?? {},
        habits: {
          smokeFreeSince: input.smokeFreeSince,
          alcoholFreeSince: input.alcoholFreeSince,
        },
        equipment: { level: input.equipment?.level ?? 'none', items: input.equipment?.items },
        restrictions: input.restrictions ?? {},
        phase: { number: 1, name: 'foundation', startedAt: today },
        history: [],
        weightHistory: [],
        painHistory: [],
      };
      store.update<FitnessPluginState>(STATE_KEY, (cur) => {
        const state = cur ?? emptyState();
        return { ...state, missions: [...state.missions, mission], activeMissionId: mission.id };
      });
      return { mission, created: true };
    },
  });

  registry.registerTool({
    name: 'plugin_fitness_today',
    description:
      "Return today's structured workout context for the active mission: day, phase, suggested workout ID, active restrictions (with message codes), streaks and training rules. Returns {exists:false, requiredAction:'create_mission'} when there is no mission.",
    inputSchema: {
      type: 'object',
      properties: { date: { type: 'string' } },
      additionalProperties: false,
    },
    handler: (args): TodayOutput => {
      const today = (args.date as string | undefined) ?? todayIso();
      let state = store.get<FitnessPluginState>(STATE_KEY) ?? emptyState();
      let mission = activeMission(state);
      if (!mission) return { exists: false, requiredAction: 'create_mission' };
      // Persist a phase advance only when one is actually due — today() is
      // otherwise a pure read.
      const advanced = commitPhase(mission, today);
      if (advanced !== mission) {
        state = store.update<FitnessPluginState>(STATE_KEY, (cur) => {
          const s = cur ?? emptyState();
          return { ...s, missions: s.missions.map((x) => (x.id === advanced.id ? advanced : x)) };
        });
        mission = activeMission(state) ?? advanced;
      }
      return buildToday(mission, today);
    },
  });

  registry.registerTool({
    name: 'plugin_fitness_log_workout',
    description:
      'Record a completed or skipped workout (with optional duration, difficulty, pain reports, notes). Applies any high pain to restrictions and returns the next suggested workout ID.',
    inputSchema: {
      type: 'object',
      properties: {
        date: { type: 'string' },
        workoutId: { type: 'string' },
        completed: { type: 'boolean' },
        durationMinutes: { type: 'number' },
        difficulty: { type: 'number' },
        pain: { type: 'array' },
        notes: { type: 'string' },
      },
      required: ['workoutId', 'completed'],
      additionalProperties: false,
    },
    handler: (args): LogWorkoutOutput => {
      const input = args as LogWorkoutInput;
      const date = input.date ?? todayIso();
      const state = store.update<FitnessPluginState>(STATE_KEY, (cur) => {
        const s = cur ?? emptyState();
        const m = activeMission(s);
        if (!m) return s;
        let restrictions = m.restrictions;
        for (const p of input.pain ?? []) {
          restrictions = applyPainToRestrictions(restrictions, p.area, p.value, p.side);
        }
        const updated: FitnessMission = {
          ...m,
          restrictions,
          history: [
            ...m.history,
            {
              id: newId('w'),
              date,
              workoutId: input.workoutId,
              completed: input.completed,
              durationMinutes: input.durationMinutes,
              difficulty: input.difficulty,
              pain: input.pain,
              notes: input.notes,
            },
          ],
        };
        return { ...s, missions: s.missions.map((x) => (x.id === m.id ? updated : x)) };
      });
      const mission = activeMission(state);
      if (!mission) return { stored: false, updatedRestrictions: {} };
      const phase = effectivePhase(mission, date);
      const restrictions = todayRestrictions(mission.restrictions);
      return {
        stored: true,
        updatedRestrictions: mission.restrictions,
        nextSuggestedWorkoutId: selectWorkoutId(mission, phase, restrictions),
      };
    },
  });

  registry.registerTool({
    name: 'plugin_fitness_log_pain',
    description:
      'Record a pain signal (area, side, 0-10 value) and deterministically update restrictions. Returns the coarse restriction level and the updated restriction state.',
    inputSchema: {
      type: 'object',
      properties: {
        date: { type: 'string' },
        area: { type: 'string', enum: ['shoulder', 'knee', 'back', 'other'] },
        side: { type: 'string', enum: ['left', 'right', 'both'] },
        value: { type: 'number' },
        trigger: { type: 'string' },
        notes: { type: 'string' },
      },
      required: ['area', 'value'],
      additionalProperties: false,
    },
    handler: (args): LogPainOutput => {
      const input = args as LogPainInput;
      const date = input.date ?? todayIso();
      const state = store.update<FitnessPluginState>(STATE_KEY, (cur) => {
        const s = cur ?? emptyState();
        const m = activeMission(s);
        if (!m) return s;
        const updated: FitnessMission = {
          ...m,
          restrictions: applyPainToRestrictions(m.restrictions, input.area, input.value, input.side),
          painHistory: [
            ...m.painHistory,
            {
              date,
              area: input.area,
              side: input.side,
              value: input.value,
              trigger: input.trigger,
              notes: input.notes,
            },
          ],
        };
        return { ...s, missions: s.missions.map((x) => (x.id === m.id ? updated : x)) };
      });
      const mission = activeMission(state);
      if (!mission) return { stored: false, restrictionLevel: 'normal', updatedRestrictions: {} };
      return {
        stored: true,
        restrictionLevel: painLevel(input.value),
        updatedRestrictions: mission.restrictions,
      };
    },
  });

  registry.registerTool({
    name: 'plugin_fitness_log_weight',
    description:
      'Record a body weight (kg) and optional waist (cm). Returns the latest weight and delta from the first recorded weight.',
    inputSchema: {
      type: 'object',
      properties: {
        date: { type: 'string' },
        weightKg: { type: 'number' },
        waistCm: { type: 'number' },
      },
      required: ['weightKg'],
      additionalProperties: false,
    },
    handler: (args): LogWeightOutput => {
      const input = args as LogWeightInput;
      const date = input.date ?? todayIso();
      const state = store.update<FitnessPluginState>(STATE_KEY, (cur) => {
        const s = cur ?? emptyState();
        const m = activeMission(s);
        if (!m) return s;
        const updated: FitnessMission = {
          ...m,
          weightHistory: [...m.weightHistory, { date, weightKg: input.weightKg, waistCm: input.waistCm }],
        };
        return { ...s, missions: s.missions.map((x) => (x.id === m.id ? updated : x)) };
      });
      const mission = activeMission(state);
      if (!mission) return { stored: false, latestWeightKg: input.weightKg };
      const start = mission.weightHistory[0]?.weightKg ?? mission.profile.weightKg;
      return {
        stored: true,
        latestWeightKg: input.weightKg,
        deltaFromStartKg:
          start !== undefined ? Math.round((input.weightKg - start) * 10) / 10 : undefined,
      };
    },
  });

  registry.registerTool({
    name: 'plugin_fitness_set_equipment',
    description:
      'Update available equipment for the active mission. Returns the stored equipment and the workout families it enables.',
    inputSchema: {
      type: 'object',
      properties: {
        level: {
          type: 'string',
          enum: [
            'none',
            'bodyweight',
            'bands',
            'bench',
            'dumbbells',
            'bench_dumbbells',
            'pullup_bar',
            'pullup_bar_bench_dumbbells',
            'home_gym',
          ],
        },
        items: { type: 'array', items: { type: 'string' } },
      },
      required: ['level'],
      additionalProperties: false,
    },
    handler: (args): SetEquipmentOutput => {
      const input = args as SetEquipmentInput;
      const state = store.update<FitnessPluginState>(STATE_KEY, (cur) => {
        const s = cur ?? emptyState();
        const m = activeMission(s);
        if (!m) return s;
        const updated: FitnessMission = {
          ...m,
          equipment: { level: input.level, items: input.items },
        };
        return { ...s, missions: s.missions.map((x) => (x.id === m.id ? updated : x)) };
      });
      const mission = activeMission(state);
      const equipment = mission?.equipment ?? { level: input.level, items: input.items };
      return {
        stored: Boolean(mission),
        equipment,
        enabledWorkoutFamilies: enabledWorkoutFamilies(equipment.level),
      };
    },
  });

  registry.registerTool({
    name: 'plugin_fitness_status',
    description:
      'Return the full mission status: a progress summary, and (optionally) the complete mission record including history.',
    inputSchema: {
      type: 'object',
      properties: { includeHistory: { type: 'boolean' } },
      additionalProperties: false,
    },
    handler: (args): StatusOutput => {
      const today = todayIso();
      const state = store.get<FitnessPluginState>(STATE_KEY) ?? emptyState();
      const mission = activeMission(state);
      if (!mission) return { exists: false, requiredAction: 'create_mission' };
      const summary = buildSummary(mission, today);
      if (args.includeHistory) return { exists: true, mission, summary };
      // Default response omits the (potentially large) log arrays.
      return {
        exists: true,
        mission: { ...mission, history: [], weightHistory: [], painHistory: [] },
        summary,
      };
    },
  });
}

export default register;
