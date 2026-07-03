// shinobi-plugin-fitness — single-file bundle (generated from src/, zero runtime deps).
// Install: drop this file into ~/.shinobi/plugins/ on your Shinobi host and restart.
// Requires a host with registry.state (Shinobi with the writable-plugin-state feature, PR #29).
// Regenerate with: npm run build && node scripts/bundle.mjs

// Pure deterministic rules for the fitness plugin. No IO, no randomness, no
// natural language — every function is a referentially-transparent map from
// state to facts, which is what makes the plugin testable and the LLM the only
// source of words.
const DAY_MS = 86_400_000;
/** Parse a YYYY-MM-DD (or ISO) date to a UTC-midnight epoch day count. */
function epochDay(date) {
    return Math.floor(Date.parse(`${date.slice(0, 10)}T00:00:00Z`) / DAY_MS);
}
export function todayIso(now = new Date()) {
    return now.toISOString().slice(0, 10);
}
/** Whole days from `from` to `to`, never negative. */
export function daysBetween(from, to) {
    return Math.max(0, epochDay(to) - epochDay(from));
}
/** 1-based mission day: the start date is day 1. */
export function dayOfMission(startedAt, today) {
    return daysBetween(startedAt, today) + 1;
}
/** Default phase for a given mission day (SPEC §7.3). */
export function phaseForDay(day) {
    if (day <= 30)
        return { number: 1, name: 'foundation' };
    if (day <= 75)
        return { number: 2, name: 'base_strength' };
    if (day <= 135)
        return { number: 3, name: 'progressive_strength' };
    return { number: 4, name: 'definition' };
}
function countCompletedInLastDays(mission, today, window) {
    const cutoff = epochDay(today) - window;
    return mission.history.filter((w) => w.completed && epochDay(w.date) > cutoff).length;
}
function hasHighPainRestriction(r) {
    return (r.shoulder?.status === 'avoid' ||
        r.knee?.status === 'avoid' ||
        r.back?.status === 'avoid' ||
        (r.temporary?.some((t) => t.severity === 'high') ?? false));
}
/**
 * Effective phase for today. Advancement past the mission's stored phase is
 * delayed while consistency is low, a high-pain restriction is active, or the
 * mission is paused (SPEC §7.3). Never regresses below the stored phase.
 */
export function effectivePhase(mission, today) {
    const stored = mission.phase;
    const byDay = phaseForDay(dayOfMission(mission.startedAt, today));
    if (byDay.number <= stored.number)
        return stored;
    const blocked = mission.status === 'paused' ||
        countCompletedInLastDays(mission, today, 14) < 4 ||
        hasHighPainRestriction(mission.restrictions);
    if (blocked)
        return stored;
    return { number: byDay.number, name: byDay.name, startedAt: today };
}
/** Level shown to the LLM for a joint, derived from status + last pain value. */
function jointLevel(joint) {
    if (joint.status === 'cleared')
        return null;
    if (joint.status === 'avoid')
        return 'avoid';
    // 'watch': a 3-4 pain reading is a caution; an old/low flag stays a watch.
    return (joint.lastPain ?? 0) >= 3 ? 'caution' : 'watch';
}
/**
 * Structured restrictions for today. One entry per affected area. Only the
 * shoulder carries graded (watch/caution/avoid) guidance because that is the
 * only joint the spec details; knee/back surface at high pain only.
 */
export function todayRestrictions(r) {
    const out = [];
    if (r.shoulder) {
        const level = jointLevel(r.shoulder);
        if (level) {
            out.push({
                area: 'shoulder',
                side: r.shoulder.side,
                level,
                messageCode: level === 'avoid' ? 'SHOULDER_PAIN_HIGH' : 'NO_HEAVY_OVERHEAD_PRESSING',
            });
        }
    }
    if (r.knee?.status === 'avoid') {
        out.push({ area: 'knee', side: r.knee.side, level: 'avoid', messageCode: 'KNEE_PAIN_HIGH' });
    }
    if (r.back?.status === 'avoid') {
        out.push({ area: 'back', side: r.back.side, level: 'avoid', messageCode: 'BACK_PAIN_HIGH' });
    }
    return out;
}
/** Map a logged pain value to its coarse restriction level (SPEC §7.1). */
export function painLevel(value) {
    if (value >= 5)
        return 'avoid';
    if (value >= 3)
        return 'caution';
    return 'normal';
}
/** Apply a pain reading to a joint restriction, returning the next state. */
export function applyPainToRestrictions(current, area, value, side) {
    if (area === 'other')
        return current; // no joint mapping in the MVP
    const status = value >= 5 ? 'avoid' : value >= 3 ? 'watch' : 'cleared';
    const joint = { side, status, lastPain: value };
    return { ...current, [area]: joint };
}
const PHASE1_FULLBODY = ['phase1_fullbody_a', 'phase1_fullbody_b', 'phase1_fullbody_c'];
const PHASE2_BENCH = ['phase2_bench_dumbbell_a', 'phase2_bench_dumbbell_b'];
const PHASE2_HYBRID = [
    'phase2_pullup_dumbbell_a',
    'phase2_bench_dumbbell_a',
    'phase2_bench_dumbbell_b',
];
function rotate(items, n) {
    return items[((n % items.length) + items.length) % items.length];
}
/** Workout families unlocked by an equipment level (SPEC §7.2). */
export function enabledWorkoutFamilies(level) {
    const base = ['phase1_fullbody', 'phase1_legs_core', 'phase1_pull_core', 'recovery'];
    switch (level) {
        case 'none':
        case 'bodyweight':
            return base;
        case 'bands':
            return [...base, 'prehab', 'pull_accessory'];
        case 'bench':
        case 'dumbbells':
            // A bench alone, or dumbbells alone, still trains as bodyweight in the MVP
            // until paired (bench_dumbbells) — matches the spec's "only if dumbbells exist".
            return base;
        case 'bench_dumbbells':
            return [...base, 'phase2_bench_dumbbell'];
        case 'pullup_bar':
            return [...base, 'pull_accessory'];
        case 'pullup_bar_bench_dumbbells':
            return [...base, 'phase2_bench_dumbbell', 'phase2_pullup_dumbbell'];
        case 'home_gym':
            return [...base, 'prehab', 'pull_accessory', 'phase2_bench_dumbbell', 'phase2_pullup_dumbbell'];
    }
}
/**
 * Deterministic workout ID for today. High shoulder pain replaces any push day
 * with legs/core to keep the streak alive; phase 1 rotates bodyweight; phase 2+
 * uses dumbbell families when the equipment is there, else falls back to phase 1.
 */
export function selectWorkoutId(mission, phase, restrictions) {
    const shoulderAvoid = restrictions.some((r) => r.area === 'shoulder' && r.level === 'avoid');
    if (shoulderAvoid)
        return 'phase1_legs_core';
    const completed = mission.history.filter((w) => w.completed).length;
    if (phase.number === 1)
        return rotate(PHASE1_FULLBODY, completed);
    const families = enabledWorkoutFamilies(mission.equipment.level);
    if (families.includes('phase2_pullup_dumbbell'))
        return rotate(PHASE2_HYBRID, completed);
    if (families.includes('phase2_bench_dumbbell'))
        return rotate(PHASE2_BENCH, completed);
    return rotate(PHASE1_FULLBODY, completed); // phase advanced but no equipment yet
}
/** Trailing consecutive calendar days ending today with a completed workout. */
export function workoutStreakDays(mission, today) {
    const done = new Set(mission.history.filter((w) => w.completed).map((w) => epochDay(w.date)));
    let day = epochDay(today);
    let streak = 0;
    while (done.has(day)) {
        streak++;
        day--;
    }
    return streak;
}

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

const STATE_KEY = 'mission';
const RULES = { trainToFailure: false, repsInReserve: 2, maxPainAllowed: 4 };
function emptyState() {
    return { version: 1, missions: [] };
}
function activeMission(state) {
    return state.missions.find((m) => m.id === state.activeMissionId);
}
function newId(prefix) {
    return `${prefix}_${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
}
function buildSummary(mission, today) {
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
        deltaFromStartKg: latestWeightKg !== undefined && startWeight !== undefined
            ? Math.round((latestWeightKg - startWeight) * 10) / 10
            : undefined,
        activeRestrictions: todayRestrictions(mission.restrictions),
    };
}
function buildToday(mission, today) {
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
function commitPhase(mission, today) {
    const phase = effectivePhase(mission, today);
    if (phase.number === mission.phase.number)
        return mission;
    return { ...mission, phase };
}
export function register(registry) {
    const store = registry.state;
    registry.registerTool({
        name: 'plugin_fitness_create',
        description: 'Create a fitness_180 mission and persist its initial state (profile, habits, equipment, restrictions). Returns the structured mission. Does not generate any coaching text.',
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
        handler: (args) => {
            const input = args;
            const today = todayIso();
            const mission = {
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
            store.update(STATE_KEY, (cur) => {
                const state = cur ?? emptyState();
                return { ...state, missions: [...state.missions, mission], activeMissionId: mission.id };
            });
            return { mission, created: true };
        },
    });
    registry.registerTool({
        name: 'plugin_fitness_today',
        description: "Return today's structured workout context for the active mission: day, phase, suggested workout ID, active restrictions (with message codes), streaks and training rules. Returns {exists:false, requiredAction:'create_mission'} when there is no mission.",
        inputSchema: {
            type: 'object',
            properties: { date: { type: 'string' } },
            additionalProperties: false,
        },
        handler: (args) => {
            const today = args.date ?? todayIso();
            let state = store.get(STATE_KEY) ?? emptyState();
            let mission = activeMission(state);
            if (!mission)
                return { exists: false, requiredAction: 'create_mission' };
            // Persist a phase advance only when one is actually due — today() is
            // otherwise a pure read.
            const advanced = commitPhase(mission, today);
            if (advanced !== mission) {
                state = store.update(STATE_KEY, (cur) => {
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
        description: 'Record a completed or skipped workout (with optional duration, difficulty, pain reports, notes). Applies any high pain to restrictions and returns the next suggested workout ID.',
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
        handler: (args) => {
            const input = args;
            const date = input.date ?? todayIso();
            const state = store.update(STATE_KEY, (cur) => {
                const s = cur ?? emptyState();
                const m = activeMission(s);
                if (!m)
                    return s;
                let restrictions = m.restrictions;
                for (const p of input.pain ?? []) {
                    restrictions = applyPainToRestrictions(restrictions, p.area, p.value, p.side);
                }
                const updated = {
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
            if (!mission)
                return { stored: false, updatedRestrictions: {} };
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
        description: 'Record a pain signal (area, side, 0-10 value) and deterministically update restrictions. Returns the coarse restriction level and the updated restriction state.',
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
        handler: (args) => {
            const input = args;
            const date = input.date ?? todayIso();
            const state = store.update(STATE_KEY, (cur) => {
                const s = cur ?? emptyState();
                const m = activeMission(s);
                if (!m)
                    return s;
                const updated = {
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
            if (!mission)
                return { stored: false, restrictionLevel: 'normal', updatedRestrictions: {} };
            return {
                stored: true,
                restrictionLevel: painLevel(input.value),
                updatedRestrictions: mission.restrictions,
            };
        },
    });
    registry.registerTool({
        name: 'plugin_fitness_log_weight',
        description: 'Record a body weight (kg) and optional waist (cm). Returns the latest weight and delta from the first recorded weight.',
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
        handler: (args) => {
            const input = args;
            const date = input.date ?? todayIso();
            const state = store.update(STATE_KEY, (cur) => {
                const s = cur ?? emptyState();
                const m = activeMission(s);
                if (!m)
                    return s;
                const updated = {
                    ...m,
                    weightHistory: [...m.weightHistory, { date, weightKg: input.weightKg, waistCm: input.waistCm }],
                };
                return { ...s, missions: s.missions.map((x) => (x.id === m.id ? updated : x)) };
            });
            const mission = activeMission(state);
            if (!mission)
                return { stored: false, latestWeightKg: input.weightKg };
            const start = mission.weightHistory[0]?.weightKg ?? mission.profile.weightKg;
            return {
                stored: true,
                latestWeightKg: input.weightKg,
                deltaFromStartKg: start !== undefined ? Math.round((input.weightKg - start) * 10) / 10 : undefined,
            };
        },
    });
    registry.registerTool({
        name: 'plugin_fitness_set_equipment',
        description: 'Update available equipment for the active mission. Returns the stored equipment and the workout families it enables.',
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
        handler: (args) => {
            const input = args;
            const state = store.update(STATE_KEY, (cur) => {
                const s = cur ?? emptyState();
                const m = activeMission(s);
                if (!m)
                    return s;
                const updated = {
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
        description: 'Return the full mission status: a progress summary, and (optionally) the complete mission record including history.',
        inputSchema: {
            type: 'object',
            properties: { includeHistory: { type: 'boolean' } },
            additionalProperties: false,
        },
        handler: (args) => {
            const today = todayIso();
            const state = store.get(STATE_KEY) ?? emptyState();
            const mission = activeMission(state);
            if (!mission)
                return { exists: false, requiredAction: 'create_mission' };
            const summary = buildSummary(mission, today);
            if (args.includeHistory)
                return { exists: true, mission, summary };
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
