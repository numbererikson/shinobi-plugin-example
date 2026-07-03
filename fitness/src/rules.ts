// Pure deterministic rules for the fitness plugin. No IO, no randomness, no
// natural language — every function is a referentially-transparent map from
// state to facts, which is what makes the plugin testable and the LLM the only
// source of words.

import type {
  EquipmentLevel,
  FitnessMission,
  JointRestriction,
  PainArea,
  RestrictionState,
  TodayRestriction,
  TrainingPhase,
} from './types.js';

const DAY_MS = 86_400_000;

/** Parse a YYYY-MM-DD (or ISO) date to a UTC-midnight epoch day count. */
function epochDay(date: string): number {
  return Math.floor(Date.parse(`${date.slice(0, 10)}T00:00:00Z`) / DAY_MS);
}

export function todayIso(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** Whole days from `from` to `to`, never negative. */
export function daysBetween(from: string, to: string): number {
  return Math.max(0, epochDay(to) - epochDay(from));
}

/** 1-based mission day: the start date is day 1. */
export function dayOfMission(startedAt: string, today: string): number {
  return daysBetween(startedAt, today) + 1;
}

/** Default phase for a given mission day (SPEC §7.3). */
export function phaseForDay(day: number): { number: TrainingPhase['number']; name: TrainingPhase['name'] } {
  if (day <= 30) return { number: 1, name: 'foundation' };
  if (day <= 75) return { number: 2, name: 'base_strength' };
  if (day <= 135) return { number: 3, name: 'progressive_strength' };
  return { number: 4, name: 'definition' };
}

function countCompletedInLastDays(mission: FitnessMission, today: string, window: number): number {
  const cutoff = epochDay(today) - window;
  return mission.history.filter((w) => w.completed && epochDay(w.date) > cutoff).length;
}

function hasHighPainRestriction(r: RestrictionState): boolean {
  return (
    r.shoulder?.status === 'avoid' ||
    r.knee?.status === 'avoid' ||
    r.back?.status === 'avoid' ||
    (r.temporary?.some((t) => t.severity === 'high') ?? false)
  );
}

/**
 * Effective phase for today. Advancement past the mission's stored phase is
 * delayed while consistency is low, a high-pain restriction is active, or the
 * mission is paused (SPEC §7.3). Never regresses below the stored phase.
 */
export function effectivePhase(mission: FitnessMission, today: string): TrainingPhase {
  const stored = mission.phase;
  const byDay = phaseForDay(dayOfMission(mission.startedAt, today));
  if (byDay.number <= stored.number) return stored;

  const blocked =
    mission.status === 'paused' ||
    countCompletedInLastDays(mission, today, 14) < 4 ||
    hasHighPainRestriction(mission.restrictions);
  if (blocked) return stored;

  return { number: byDay.number, name: byDay.name, startedAt: today };
}

/** Level shown to the LLM for a joint, derived from status + last pain value. */
function jointLevel(joint: JointRestriction): TodayRestriction['level'] | null {
  if (joint.status === 'cleared') return null;
  if (joint.status === 'avoid') return 'avoid';
  // 'watch': a 3-4 pain reading is a caution; an old/low flag stays a watch.
  return (joint.lastPain ?? 0) >= 3 ? 'caution' : 'watch';
}

/**
 * Structured restrictions for today. One entry per affected area. Only the
 * shoulder carries graded (watch/caution/avoid) guidance because that is the
 * only joint the spec details; knee/back surface at high pain only.
 */
export function todayRestrictions(r: RestrictionState): TodayRestriction[] {
  const out: TodayRestriction[] = [];

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
export function painLevel(value: number): 'normal' | 'caution' | 'avoid' {
  if (value >= 5) return 'avoid';
  if (value >= 3) return 'caution';
  return 'normal';
}

/** Apply a pain reading to a joint restriction, returning the next state. */
export function applyPainToRestrictions(
  current: RestrictionState,
  area: PainArea,
  value: number,
  side?: JointRestriction['side'],
): RestrictionState {
  if (area === 'other') return current; // no joint mapping in the MVP
  const status: JointRestriction['status'] = value >= 5 ? 'avoid' : value >= 3 ? 'watch' : 'cleared';
  const joint: JointRestriction = { side, status, lastPain: value };
  return { ...current, [area]: joint };
}

const PHASE1_FULLBODY = ['phase1_fullbody_a', 'phase1_fullbody_b', 'phase1_fullbody_c'] as const;
const PHASE2_BENCH = ['phase2_bench_dumbbell_a', 'phase2_bench_dumbbell_b'] as const;
const PHASE2_HYBRID = [
  'phase2_pullup_dumbbell_a',
  'phase2_bench_dumbbell_a',
  'phase2_bench_dumbbell_b',
] as const;

function rotate<T>(items: readonly T[], n: number): T {
  return items[((n % items.length) + items.length) % items.length] as T;
}

/** Workout families unlocked by an equipment level (SPEC §7.2). */
export function enabledWorkoutFamilies(level: EquipmentLevel): string[] {
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
export function selectWorkoutId(
  mission: FitnessMission,
  phase: TrainingPhase,
  restrictions: TodayRestriction[],
): string {
  const shoulderAvoid = restrictions.some((r) => r.area === 'shoulder' && r.level === 'avoid');
  if (shoulderAvoid) return 'phase1_legs_core';

  const completed = mission.history.filter((w) => w.completed).length;

  if (phase.number === 1) return rotate(PHASE1_FULLBODY, completed);

  const families = enabledWorkoutFamilies(mission.equipment.level);
  if (families.includes('phase2_pullup_dumbbell')) return rotate(PHASE2_HYBRID, completed);
  if (families.includes('phase2_bench_dumbbell')) return rotate(PHASE2_BENCH, completed);
  return rotate(PHASE1_FULLBODY, completed); // phase advanced but no equipment yet
}

/** Trailing consecutive calendar days ending today with a completed workout. */
export function workoutStreakDays(mission: FitnessMission, today: string): number {
  const done = new Set(mission.history.filter((w) => w.completed).map((w) => epochDay(w.date)));
  let day = epochDay(today);
  let streak = 0;
  while (done.has(day)) {
    streak++;
    day--;
  }
  return streak;
}
