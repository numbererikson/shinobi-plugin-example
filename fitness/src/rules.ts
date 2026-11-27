// Pure rules: no IO, no clock, no randomness. Every function takes the state
// (and today's local date where it matters) and returns facts or a new state.

import { AREAS, BY_ID, exercise, LADDERS, RECOVERY, REHAB, REHAB_MAX_PAIN, REHAB_NAME, TRACKED_LADDERS, WARMUP_A, WARMUP_B, type Area, type Exercise, type LadderId } from './exercises.js';
import { featOf } from './feats.js';
import {
  GATE_TESTS,
  RANKS,
  type Counters,
  type EventKind,
  type Feel,
  type GateTest,
  type HunterState,
  type Injury,
  type Profile,
  type Push,
  type QuestType,
  type Rank,
  type Side,
  type SystemEvent,
  type TrackedLadder,
} from './types.js';

export const XP = { training: 100, gate: 300, recovery: 30, skill: 150, rank: 500, sideQuest: 20, title: 50, walk: 20 } as const;
export const GATE_EVERY_DAYS = 42;
export const DELOAD_EVERY_WEEKS = 5;
const MAX_LOGS = 3000;
const MAX_EVENTS = 80;
const MAX_HISTORY = 300;
const MAX_QUESTS = 1100;

// ---- dates (local calendar dates as YYYY-MM-DD) -----------------------------

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);
}

export function weekday(date: string): number {
  return new Date(`${date}T12:00:00Z`).getUTCDay();
}

// ---- new hunter -------------------------------------------------------------

export interface Baseline {
  pushups?: number;
  pullups?: number;
  squats?: number;
  wallSit?: number;
  deadHang?: number;
  dips?: number;
  hollowHold?: number;
  lSit?: number;
}

export function newHunter(profile: Profile, today: string, baseline: Baseline = {}): HunterState {
  const state: HunterState = {
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
    rank: 'E',
    // The first training day is the Awakening Gate: real numbers place every ladder.
    nextGate: today,
    notified: {},
  };
  // Estimates are guesses: place one step below what they suggest. The
  // Awakening Gate measures for real and only ever raises.
  place(state, {
    pushups: baseline.pushups,
    pullups: baseline.pullups,
    dips: baseline.dips,
    dead_hang: baseline.deadHang,
    hollow_hold: baseline.hollowHold,
    l_sit: baseline.lSit,
  }, { squats: baseline.squats, wallSit: baseline.wallSit }, 1);
  event(state, today, 'awakening', 'You have been chosen. The System is now active.');
  return state;
}

// ---- placement: test numbers → ladder levels (only ever raises) --------------

const idx = (ladder: LadderId, id: string): number => LADDERS[ladder].levels.indexOf(id);

export function placementFor(results: Partial<Record<GateTest, number>>, legs: { squats?: number | undefined; wallSit?: number | undefined } = {}): Partial<Record<TrackedLadder, number>> {
  const out: Partial<Record<TrackedLadder, number>> = {};
  const r = results;
  if (r.pullups !== undefined || r.dead_hang !== undefined) {
    const p = r.pullups ?? 0;
    const hang = r.dead_hang ?? 0;
    out.pull = p >= 15 ? idx('pull', 'archer_pullup')
      : p >= 10 ? idx('pull', 'chest_to_bar')
      : p >= 3 ? idx('pull', 'pullup')
      : p >= 1 || hang >= 30 ? idx('pull', 'negative_pullup')
      : hang >= 15 ? idx('pull', 'scapular_pullup')
      : 0;
  }
  if (r.pushups !== undefined) {
    const p = r.pushups;
    out.push = p >= 45 ? idx('push', 'pseudo_planche_pushup')
      : p >= 30 ? idx('push', 'decline_pushup')
      : p >= 20 ? idx('push', 'deep_pushup')
      : p >= 6 ? idx('push', 'pushup')
      : p >= 1 ? idx('push', 'incline_pushup')
      : 0;
  }
  if (r.dips !== undefined) out.dip = r.dips >= 3 ? idx('dip', 'dip') : r.dips >= 1 ? idx('dip', 'negative_dip') : 0;
  if (r.l_sit !== undefined) out.lsit = r.l_sit >= 8 ? idx('lsit', 'l_sit') : r.l_sit >= 1 ? idx('lsit', 'tuck_l_sit') : 0;
  if (r.hollow_hold !== undefined) out.core = r.hollow_hold >= 40 ? idx('core', 'knee_raise') : r.hollow_hold >= 15 ? idx('core', 'hollow_hold') : 0;
  if (legs.squats !== undefined || legs.wallSit !== undefined) {
    const s = legs.squats ?? 0;
    out.legs = s >= 40 ? idx('legs', 'bulgarian_split_squat') : s >= 20 ? idx('legs', 'split_squat') : s >= 8 || (legs.wallSit ?? 0) >= 30 ? idx('legs', 'squat') : 0;
  }
  return out;
}

/** Raise ladders to what the results justify, minus `caution` steps (for estimates). */
function place(state: HunterState, results: Partial<Record<GateTest, number>>, legs: { squats?: number | undefined; wallSit?: number | undefined } = {}, caution = 0): void {
  const clean: Partial<Record<GateTest, number>> = {};
  for (const t of GATE_TESTS) {
    const v = results[t];
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0) clean[t] = v;
  }
  for (const [ladder, raw] of Object.entries(placementFor(clean, legs)) as [TrackedLadder, number][]) {
    const level = Math.max(0, raw - caution);
    if (level > state.levels[ladder]) state.levels[ladder] = level;
  }
}

// ---- injuries --------------------------------------------------------------

/** Highest joint stress allowed for an area at this pain level. */
export function allowedStress(pain: number): number {
  return pain <= 2 ? 3 : pain <= 4 ? 1 : 0;
}

function worstPain(injuries: Injury[], area: Area): number {
  return injuries.filter((i) => i.area === area).reduce((m, i) => Math.max(m, i.pain), 0);
}

/** The injured area that rules an exercise out, or null when it is allowed. */
export function blockedBy(ex: Exercise, injuries: Injury[]): { area: Area; pain: number } | null {
  for (const area of AREAS) {
    const pain = worstPain(injuries, area);
    if (pain > 0 && (ex.stress[area] ?? 0) > allowedStress(pain)) return { area, pain };
  }
  return null;
}

export function hasEquipment(ex: Exercise, profile: Profile): boolean {
  switch (ex.equipment) {
    case 'tower':
      return profile.equipment.tower;
    case 'chair':
      return profile.equipment.chair;
    default:
      return true;
  }
}

export function reportPain(state: HunterState, today: string, area: Area, side: Side, pain: number, note?: string): { healed: boolean; injury: Injury | null } {
  const p = Math.max(0, Math.min(10, Math.round(pain)));
  // Keep every report (one per area/side/day: the latest wins) for the pain chart.
  const log = (state.painLog ??= []);
  const same = log.findIndex((e) => e.date === today && e.area === area && e.side === side);
  if (same >= 0) log.splice(same, 1);
  log.push({ date: today, area, side, pain: p });
  if (log.length > MAX_HISTORY) log.splice(0, log.length - MAX_HISTORY);
  const i = state.injuries.findIndex((x) => x.area === area && x.side === side);
  const label = `${side === 'both' ? '' : `${side} `}${area.replace('_', ' ')}`;
  if (p === 0) {
    if (i >= 0) {
      state.injuries.splice(i, 1);
      event(state, today, 'recovered', `Status effect removed: ${label}. Full training restored for it.`);
    }
    return { healed: true, injury: null };
  }
  const existing = state.injuries[i];
  const injury: Injury = { area, side, pain: p, since: existing?.since ?? today, updatedAt: today };
  if (note) injury.note = note.slice(0, 300);
  if (i >= 0) state.injuries[i] = injury;
  else state.injuries.push(injury);
  const mode = allowedStress(p) === 3 ? 'train normally, stay below pain' : allowedStress(p) === 1 ? 'light work only' : 'rest that area';
  event(state, today, 'injury', `Status effect: ${label} ${p}/10 — ${mode}.`);
  return { healed: false, injury };
}

// ---- quest of the day --------------------------------------------------------

export interface QuestItem {
  exercise: string;
  name: string;
  ladder?: LadderId;
  kind: 'reps' | 'hold';
  sets: number;
  min: number;
  max: number;
  perSide: boolean;
  restSec: number;
  /** Prescribed reps/seconds per set for today. */
  target: number[];
  /** Ladder position: 1-based level and ladder length. */
  level?: { at: number; of: number };
  note?: string;
  /** Sets already logged today. */
  logged?: number[];
}

export interface Quest {
  date: string;
  type: QuestType;
  session?: 'A' | 'B';
  deload: boolean;
  warmup: QuestItem[];
  main: QuestItem[];
  skipped: { ladder: LadderId; reason: string }[];
  gateTests: GateTest[];
  /** Gentle care for a hurting area, after the main work. */
  sideQuest: QuestItem[];
  /** Its name, e.g. "Repair the shoulder"; null when there is none. */
  sideQuestName: string | null;
  done: boolean;
}

/** Today's rehab side quest: gentle exercises for every area that hurts 1–6/10. */
export function sideQuestFor(state: HunterState, exclude: Set<string>): { name: string | null; ids: string[] } {
  const areas = AREAS.filter((a) => REHAB[a] && state.injuries.some((i) => i.area === a && i.pain >= 1 && i.pain <= REHAB_MAX_PAIN));
  const ids: string[] = [];
  for (const a of areas) {
    for (const id of REHAB[a]!) {
      if (ids.includes(id) || exclude.has(id)) continue;
      const ex = exercise(id);
      if (!hasEquipment(ex, state.profile)) continue;
      // Light load only, and nothing at all for an area that hurts more than the rehab limit.
      const ok = AREAS.every((area) => {
        const pain = worstPain(state.injuries, area);
        const s = ex.stress[area] ?? 0;
        return pain === 0 || s === 0 || (s <= 1 && pain <= REHAB_MAX_PAIN);
      });
      if (ok) ids.push(id);
    }
  }
  return { name: areas.length ? REHAB_NAME[areas[0]!] + (areas.length > 1 ? ` (+${areas.length - 1})` : '') : null, ids };
}

export function isTrainingDay(state: HunterState, date: string): boolean {
  return state.profile.trainingDays.includes(weekday(date));
}

export function isDeload(state: HunterState, date: string): boolean {
  const week = Math.floor(Math.max(0, daysBetween(state.startDate, date)) / 7);
  return (week + 1) % DELOAD_EVERY_WEEKS === 0;
}

/** The exercise each Gate trial is: its equipment and the joints it loads. */
export const TEST_EXERCISE: Record<GateTest, string> = {
  pullups: 'pullup',
  pushups: 'pushup',
  dips: 'dip',
  dead_hang: 'dead_hang',
  hollow_hold: 'hollow_hold',
  l_sit: 'l_sit',
};

/**
 * Trials for today's Gate. A trial is an all-out set, so it is left out when
 * the equipment is missing or it loads any area that hurts at 3/10 or more —
 * that ladder is tested at a later Gate, once the area has settled.
 */
export function gateTestsFor(state: Pick<HunterState, 'profile' | 'injuries'>): GateTest[] {
  return GATE_TESTS.filter((t) => {
    const ex = exercise(TEST_EXERCISE[t]);
    if (!hasEquipment(ex, state.profile)) return false;
    return !AREAS.some((area) => (ex.stress[area] ?? 0) > 0 && worstPain(state.injuries, area) > 2);
  });
}

function prescribe(ex: Exercise, state: HunterState, deload: boolean): number[] {
  const sets = deload ? Math.max(1, ex.sets - 1) : ex.sets;
  if (deload) return Array.from({ length: sets }, () => ex.min);
  const last = [...state.logs].reverse().find((l) => l.exercise === ex.id);
  // Too easy last time → two steps up; too hard → same target again.
  const unit = ex.kind === 'hold' ? 5 : 1;
  const stepUp = last?.feel === 'easy' ? 2 * unit : last?.feel === 'hard' ? 0 : unit;
  return Array.from({ length: sets }, (_, i) => {
    const prev = last?.sets[i] ?? last?.sets[last.sets.length - 1];
    if (prev === undefined) return ex.min;
    return Math.min(Math.max(prev + stepUp, ex.min), ex.max);
  });
}

function item(ex: Exercise, state: HunterState, deload: boolean, date: string, ladder?: LadderId): QuestItem {
  const q: QuestItem = {
    exercise: ex.id,
    name: ex.name,
    kind: ex.kind,
    sets: deload ? Math.max(1, ex.sets - 1) : ex.sets,
    min: ex.min,
    max: ex.max,
    perSide: ex.perSide === true,
    restSec: ex.restSec,
    target: prescribe(ex, state, deload),
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

/** Pick today's exercise for a ladder: its level, else easier ones, else its fallback ladder. */
export function pick(state: HunterState, ladder: LadderId, seen: LadderId[] = []): { ex: Exercise; ladder: LadderId; note?: string } | { skip: string } {
  const levels = LADDERS[ladder].levels;
  const current = ladder === 'pull_floor' ? 0 : state.levels[ladder as TrackedLadder];
  const intended = exercise(levels[Math.min(current, levels.length - 1)]!);
  let reason = '';
  for (let i = Math.min(current, levels.length - 1); i >= 0; i--) {
    const ex = exercise(levels[i]!);
    if (!hasEquipment(ex, state.profile)) {
      reason ||= `needs ${ex.equipment === 'tower' ? 'the power tower' : 'a sturdy chair or bench'}`;
      continue;
    }
    const block = blockedBy(ex, state.injuries);
    if (block) {
      reason ||= `${block.area.replace('_', ' ')} pain ${block.pain}/10`;
      continue;
    }
    if (ex.id === intended.id) return { ex, ladder };
    return { ex, ladder, note: `Adjusted (${reason}): ${ex.name} instead of ${intended.name}.` };
  }
  const fb = LADDERS[ladder].fallback;
  if (fb && !seen.includes(fb)) {
    const alt = pick(state, fb, [...seen, ladder]);
    if ('ex' in alt) return { ...alt, note: `Adjusted (${reason}): ${alt.ex.name} replaces the ${LADDERS[ladder].name} work today.` };
  }
  return { skip: reason || 'not available' };
}

const SESSION_LADDERS: Record<'A' | 'B', LadderId[]> = {
  A: ['pull', 'push', 'legs', 'core'],
  B: ['pull', 'dip', 'hinge', 'lsit', 'legs'],
};

function usable(state: HunterState, id: string): boolean {
  const ex = BY_ID.get(id);
  return !!ex && hasEquipment(ex, state.profile) && blockedBy(ex, state.injuries) === null;
}

export function questFor(state: HunterState, date: string): Quest {
  const record = state.quests.find((q) => q.date === date);
  const deload = isDeload(state, date);
  const training = isTrainingDay(state, date);
  // A Gate with no trial possible today (injuries, equipment) waits: train instead.
  const gateDue = training && date >= state.nextGate && gateTestsFor(state).length > 0;
  const type: QuestType = record?.type ?? (gateDue ? 'gate' : training ? 'training' : 'recovery');
  const quest: Quest = { date, type, deload, warmup: [], main: [], skipped: [], gateTests: [], sideQuest: [], sideQuestName: null, done: !!record };
  const addSideQuest = (): void => {
    const used = new Set([...quest.warmup, ...quest.main].map((q) => q.exercise));
    const sq = sideQuestFor(state, used);
    quest.sideQuestName = sq.ids.length ? sq.name : null;
    quest.sideQuest = sq.ids.map((id) => item(exercise(id), state, false, date));
  };

  if (type === 'recovery') {
    quest.main = RECOVERY.filter((id) => usable(state, id)).map((id) => item(exercise(id), state, false, date));
    addSideQuest();
    return quest;
  }
  if (type === 'gate') {
    quest.warmup = [...WARMUP_A, ...WARMUP_B].filter((id) => usable(state, id)).map((id) => item(exercise(id), state, false, date));
    quest.gateTests = gateTestsFor(state);
    return quest;
  }
  const done = state.quests.filter((q) => q.type === 'training' && q.date < date).length;
  const session = record?.session ?? (done % 2 === 0 ? 'A' : 'B');
  quest.session = session;
  quest.warmup = (session === 'A' ? WARMUP_A : WARMUP_B).filter((id) => usable(state, id)).map((id) => item(exercise(id), state, false, date));
  const used = new Set<string>();
  for (const ladder of SESSION_LADDERS[session]) {
    let p = pick(state, ladder);
    if ('skip' in p) {
      quest.skipped.push({ ladder, reason: p.skip });
      continue;
    }
    // Two ladders can land on the same exercise (e.g. support hold for dips and
    // L-sit): use the second ladder's fallback instead of repeating it.
    const fb = LADDERS[ladder].fallback;
    if (used.has(p.ex.id) && fb) {
      const alt = pick(state, fb, [ladder]);
      if ('ex' in alt) p = alt;
    }
    if (used.has(p.ex.id)) continue;
    used.add(p.ex.id);
    const q = item(p.ex, state, deload, date, p.ladder);
    if (p.note) q.note = p.note;
    quest.main.push(q);
  }
  addSideQuest();
  return quest;
}

// ---- logging & progression ---------------------------------------------------

export interface LogResult {
  exercise: string;
  sets: number[];
  unlocked: { ladder: LadderId; from: string; to: string }[];
  recalibrated: { ladder: LadderId; from: string; to: string }[];
  hitTop: boolean;
}

export function logSets(state: HunterState, date: string, exerciseId: string, rawSets: number[], feel?: Feel): LogResult {
  const ex = exercise(exerciseId);
  const sets = rawSets.map((n) => Math.max(0, Math.round(n))).slice(0, 10);
  if (sets.length === 0) throw new Error('log at least one set');
  state.logs.push(feel ? { date, exercise: ex.id, sets, feel } : { date, exercise: ex.id, sets });
  if (state.logs.length > MAX_LOGS) state.logs.splice(0, state.logs.length - MAX_LOGS);

  const deload = isDeload(state, date);
  const required = deload ? Math.max(1, ex.sets - 1) : ex.sets;
  const hitTop = sets.length >= required && sets.slice(0, required).every((n) => n >= ex.max);
  const low = sets.filter((n) => n < ex.min).length > sets.length / 2;
  const s = (state.streaks[ex.id] ??= { top: 0, low: 0 });
  s.top = hitTop ? s.top + 1 : 0;
  s.low = low ? s.low + 1 : 0;

  const c = counters(state);
  if (ex.kind === 'reps') c.reps += sets.reduce((a, b) => a + b, 0);

  const result: LogResult = { exercise: ex.id, sets, unlocked: [], recalibrated: [], hitTop };
  for (const ladder of TRACKED_LADDERS) {
    const levels = LADDERS[ladder].levels;
    if (levels[state.levels[ladder]] !== ex.id) continue;
    const at = state.levels[ladder];
    if (s.top >= 2 && !deload && at < levels.length - 1) {
      const next = exercise(levels[at + 1]!);
      state.levels[ladder] = at + 1;
      c.skills++;
      result.unlocked.push({ ladder, from: ex.id, to: next.id });
      const feat = featOf(next.id);
      event(state, date, 'skill_unlocked', `Skill unlocked: ${next.name}. (+${XP.skill} XP)${feat ? ` Real world: ${feat}` : ''}`);
      addXp(state, date, XP.skill);
    } else if (s.low >= 2 && at > 0) {
      const prev = exercise(levels[at - 1]!);
      state.levels[ladder] = at - 1;
      result.recalibrated.push({ ladder, from: ex.id, to: prev.id });
      event(state, date, 'recalibration', `Recalibrating: back to ${prev.name} to build the base.`);
    }
  }
  if (result.unlocked.length || result.recalibrated.length) state.streaks[ex.id] = { top: 0, low: 0 };
  return result;
}

// ---- quests, XP, level, streak ----------------------------------------------------

export function hunterLevel(xp: number): number {
  return Math.floor((1 + Math.sqrt(1 + (8 * Math.max(0, xp)) / 100)) / 2);
}

export function xpForLevel(level: number): number {
  return 50 * level * (level - 1);
}

export function addXp(state: HunterState, date: string, amount: number): void {
  const before = hunterLevel(state.xp);
  state.xp += amount;
  const after = hunterLevel(state.xp);
  if (after > before) event(state, date, 'level_up', `Level up! You are now level ${after}.`);
}

export function completeQuest(state: HunterState, date: string): { already: boolean; xp: number; type: QuestType } {
  const existing = state.quests.find((q) => q.date === date);
  if (existing) return { already: true, xp: 0, type: existing.type };
  const quest = questFor(state, date);
  if (quest.type === 'gate') throw new Error('Today is a Gate: log the test results with plugin_fitness_gate to clear it.');
  const xp = quest.type === 'training' ? XP.training : XP.recovery;
  const record: HunterState['quests'][number] = { date, type: quest.type, xp };
  if (quest.session) record.session = quest.session;
  addQuestRecord(state, record);
  event(state, date, 'quest_complete', `${quest.type === 'training' ? `Daily Quest (Training ${quest.session})` : 'Recovery Quest'} complete. (+${xp} XP)`);
  addXp(state, date, xp);
  return { already: false, xp, type: quest.type };
}

/** Days away (3+ missed) before a quest counts as a comeback. */
const COMEBACK_GAP = 4;

/** Store a finished quest; coming back after days away is celebrated, not punished. */
function addQuestRecord(state: HunterState, record: HunterState['quests'][number]): void {
  const prev = state.quests.reduce<string | null>((m, q) => (q.date < record.date && (!m || q.date > m) ? q.date : m), null);
  state.quests.push(record);
  if (state.quests.length > MAX_QUESTS) state.quests.splice(0, state.quests.length - MAX_QUESTS);
  if (prev && daysBetween(prev, record.date) >= COMEBACK_GAP) {
    counters(state).comebacks++;
    event(state, record.date, 'comeback', 'Welcome back, Hunter. Coming back is the hardest rep. The path continues.');
  }
}

export const SHIELD_EVERY = 7;
export const MAX_SHIELDS = 2;

export interface StreakInfo {
  days: number;
  /** Shields in hand: each one covers a missed day. */
  shields: number;
  /** Completed days until the next shield. */
  toNextShield: number;
  /** Missed days a shield covered. */
  shielded: string[];
}

/**
 * The streak, walked forward from the first day: every 7 days in a row earn a
 * shield (max 2), and a missed day spends one instead of breaking the streak.
 * Today does not break it while its quest is still open.
 */
export function streakInfo(state: HunterState, today: string): StreakInfo {
  const done = new Set(state.quests.map((q) => q.date));
  let days = 0;
  let shields = 0;
  let run = 0;
  const shielded: string[] = [];
  for (let d = state.startDate; d <= today; d = addDays(d, 1)) {
    if (done.has(d)) {
      days++;
      run++;
      if (run >= SHIELD_EVERY) {
        run = 0;
        shields = Math.min(MAX_SHIELDS, shields + 1);
      }
    } else if (d === today) {
      break;
    } else if (shields > 0) {
      shields--;
      shielded.push(d);
    } else {
      days = 0;
      run = 0;
    }
  }
  return { days, shields, toNextShield: SHIELD_EVERY - run, shielded };
}

export function streak(state: HunterState, today: string): number {
  return streakInfo(state, today).days;
}

const NO_COUNTERS: Counters = { sideQuests: 0, lightDays: 0, comebacks: 0, skills: 0, reps: 0, walks: 0 };

/** Lifetime tallies, created on first write (older states have none). */
export function counters(state: HunterState): Counters {
  state.counters = { ...NO_COUNTERS, ...state.counters };
  return state.counters;
}

export const countersOf = (state: HunterState): Counters => ({ ...NO_COUNTERS, ...state.counters });

/** Minimum minutes for the bonus walk. */
export const WALK_MIN = 20;

/** A bonus walk (any day, once a day): +20 XP. */
export function logWalk(state: HunterState, date: string, minutes: number): { already: boolean; xp: number } {
  if (minutes < WALK_MIN) throw new Error(`A bonus walk is about 30 minutes (at least ${WALK_MIN}).`);
  const walks = (state.walks ??= []);
  if (walks.includes(date)) return { already: true, xp: 0 };
  walks.push(date);
  if (walks.length > MAX_QUESTS) walks.splice(0, walks.length - MAX_QUESTS);
  counters(state).walks++;
  event(state, date, 'walk', `Bonus walk: ${Math.round(minutes)} minutes. (+${XP.walk} XP)`);
  addXp(state, date, XP.walk);
  return { already: false, xp: XP.walk };
}

// ---- gates & ranks -------------------------------------------------------------

type Req = { test?: GateTest; min?: number; ladder?: TrackedLadder; level?: string; tower?: boolean };

const RANK_REQS: Record<Exclude<Rank, 'E'>, Req[]> = {
  D: [{ test: 'pushups', min: 15 }, { test: 'hollow_hold', min: 20 }, { ladder: 'legs', level: 'split_squat' }, { test: 'pullups', min: 3, tower: true }, { test: 'dead_hang', min: 30, tower: true }],
  C: [{ test: 'pushups', min: 25 }, { test: 'hollow_hold', min: 40 }, { ladder: 'legs', level: 'bulgarian_split_squat' }, { test: 'pullups', min: 8, tower: true }, { test: 'dips', min: 8, tower: true }, { test: 'dead_hang', min: 45, tower: true }],
  B: [{ test: 'pushups', min: 35 }, { ladder: 'legs', level: 'assisted_pistol' }, { test: 'pullups', min: 12 }, { test: 'dips', min: 15 }, { test: 'dead_hang', min: 60 }, { test: 'l_sit', min: 10 }, { ladder: 'core', level: 'hanging_knee_raise' }],
  A: [{ test: 'pushups', min: 45 }, { ladder: 'legs', level: 'pistol_squat' }, { test: 'pullups', min: 16 }, { test: 'dips', min: 22 }, { test: 'l_sit', min: 20 }, { ladder: 'pull', level: 'chest_to_bar' }, { ladder: 'core', level: 'hanging_leg_raise' }],
  S: [{ test: 'pushups', min: 50 }, { ladder: 'legs', level: 'pistol_squat' }, { test: 'pullups', min: 20 }, { test: 'dips', min: 30 }, { test: 'l_sit', min: 30 }, { ladder: 'pull', level: 'archer_pullup' }, { ladder: 'push', level: 'pseudo_planche_pushup' }],
};

function meets(state: HunterState, req: Req): boolean {
  // Without the tower, tower-only requirements of the low ranks are waived; B and up need it.
  if (req.tower && !state.profile.equipment.tower) return true;
  if (req.test) return (state.best[req.test] ?? 0) >= (req.min ?? 0);
  if (req.ladder && req.level) return state.levels[req.ladder] >= LADDERS[req.ladder].levels.indexOf(req.level);
  return true;
}

export function rankFor(state: HunterState): Rank {
  let rank: Rank = 'E';
  for (const r of RANKS.slice(1) as Exclude<Rank, 'E'>[]) {
    if (RANK_REQS[r].every((req) => meets(state, req))) rank = r;
    else break;
  }
  return rank;
}

const reqLabel = (req: Req): string =>
  req.test
    ? `${TEST_LABEL[req.test].replace(/ \(.*\)$/, '')} ${req.min}${req.test === 'dead_hang' || req.test === 'hollow_hold' || req.test === 'l_sit' ? ' s' : ''}`
    : `${LADDERS[req.ladder!].name}: reach ${exercise(req.level!).name}`;

/** Every requirement of the next rank, met or not (tower-only ones waived without a tower). */
export function rankChecklist(state: HunterState): { rank: Rank; items: { label: string; met: boolean; best?: number }[] } | null {
  const next = RANKS[RANKS.indexOf(state.rank) + 1] as Exclude<Rank, 'E'> | undefined;
  if (!next) return null;
  const items = RANK_REQS[next]
    .filter((req) => !(req.tower && !state.profile.equipment.tower))
    .map((req) => {
      const item: { label: string; met: boolean; best?: number } = { label: reqLabel(req), met: meets(state, req) };
      if (req.test && state.best[req.test] !== undefined) item.best = state.best[req.test]!;
      return item;
    });
  return { rank: next, items };
}

/** What still stands between the hunter and the next rank. */
export function nextRankNeeds(state: HunterState): { rank: Rank; missing: string[] } | null {
  const c = rankChecklist(state);
  return c ? { rank: c.rank, missing: c.items.filter((i) => !i.met).map((i) => i.label) } : null;
}

// ---- the path ahead ----------------------------------------------------------------

export interface DayPlan {
  date: string;
  /** e.g. "Training A", "Recovery", "Gate". */
  label: string;
  status: 'done' | 'today' | 'planned' | 'missed' | 'shielded' | 'before';
}

const questLabel = (type: QuestType, session?: 'A' | 'B'): string => (type === 'training' ? `Training ${session ?? ''}`.trim() : type === 'gate' ? 'Gate' : 'Recovery');

/** Monday-to-Sunday plan of the week holding `today`: what was done, what comes. */
export function weekPlan(state: HunterState, today: string): DayPlan[] {
  const monday = addDays(today, -((weekday(today) + 6) % 7));
  const trainingsBefore = state.quests.filter((q) => q.type === 'training' && q.date < today).length;
  let futureTrainings = 0;
  let gatePlanned = false;
  const shielded = new Set(streakInfo(state, today).shielded);
  return Array.from({ length: 7 }, (_, i) => {
    const date = addDays(monday, i);
    const record = state.quests.find((q) => q.date === date);
    if (record) return { date, label: questLabel(record.type, record.session), status: date === today ? 'today' : 'done' };
    if (date < today) {
      return { date, label: isTrainingDay(state, date) ? 'Training' : 'Recovery', status: date < state.startDate ? 'before' : shielded.has(date) ? 'shielded' : 'missed' };
    }
    if (date === today) {
      const q = questFor(state, date);
      if (q.type === 'gate') gatePlanned = true;
      if (q.type === 'training') futureTrainings++;
      return { date, label: questLabel(q.type, q.session), status: 'today' };
    }
    if (!isTrainingDay(state, date)) return { date, label: 'Recovery', status: 'planned' };
    if (!gatePlanned && date >= state.nextGate && gateTestsFor(state).length) {
      gatePlanned = true;
      return { date, label: 'Gate', status: 'planned' };
    }
    const session = (trainingsBefore + futureTrainings) % 2 === 0 ? 'A' : 'B';
    futureTrainings++;
    return { date, label: `Training ${session}`, status: 'planned' };
  });
}

export interface LadderProgress {
  ladder: TrackedLadder;
  name: string;
  level: number;
  of: number;
  current: string;
  next: string | null;
  /** How to unlock the next step. */
  needs: string | null;
  /** Sessions at the top of the range so far (2 unlock). */
  top: number;
  /** Why the ladder is held back today, if it is. */
  held?: string;
  /** What the next step (or the top one) lets you do in real life. */
  feat: string | null;
}

export function ladderProgress(state: HunterState): LadderProgress[] {
  return TRACKED_LADDERS.map((id) => {
    const levels = LADDERS[id].levels;
    const at = state.levels[id];
    const ex = exercise(levels[at]!);
    const next = levels[at + 1] ? exercise(levels[at + 1]!) : null;
    const p: LadderProgress = {
      ladder: id,
      name: LADDERS[id].name,
      level: at + 1,
      of: levels.length,
      current: ex.name,
      next: next?.name ?? null,
      needs: next ? `${ex.sets} × ${ex.max}${ex.kind === 'hold' ? ' s' : ''}${ex.perSide ? ' per side' : ''} in 2 sessions` : null,
      top: Math.min(state.streaks[ex.id]?.top ?? 0, 2),
      feat: featOf(next?.id ?? ex.id),
    };
    if (!hasEquipment(ex, state.profile)) p.held = ex.equipment === 'tower' ? 'needs the power tower' : 'needs a chair or bench';
    else {
      const b = blockedBy(ex, state.injuries);
      if (b) p.held = `${b.area.replace('_', ' ')} pain ${b.pain}/10`;
    }
    return p;
  });
}

export const TEST_LABEL: Record<GateTest, string> = {
  pullups: 'Pull-ups (max, strict)',
  pushups: 'Push-ups (max, strict)',
  dips: 'Dips (max)',
  dead_hang: 'Dead hang (seconds)',
  hollow_hold: 'Hollow hold (seconds)',
  l_sit: 'L-sit or tuck L-sit (seconds)',
};

export function clearGate(state: HunterState, date: string, results: Partial<Record<GateTest, number>>): { number: number; rankBefore: Rank; rankAfter: Rank; placed: Partial<Record<TrackedLadder, { from: string; to: string }>> } {
  const clean: Partial<Record<GateTest, number>> = {};
  for (const t of GATE_TESTS) {
    const v = results[t];
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0) clean[t] = Math.round(v);
  }
  if (Object.keys(clean).length === 0) throw new Error('log at least one test result');
  const before = { ...state.levels };
  place(state, clean);
  for (const [t, v] of Object.entries(clean) as [GateTest, number][]) state.best[t] = Math.max(state.best[t] ?? 0, v);

  const rankBefore = state.rank;
  const computed = rankFor(state);
  if (RANKS.indexOf(computed) > RANKS.indexOf(state.rank)) state.rank = computed;
  const number = state.gates.length + 1;
  state.gates.push({ date, number, results: clean, rankBefore, rankAfter: state.rank });
  state.nextGate = addDays(date, GATE_EVERY_DAYS);

  const placed: Partial<Record<TrackedLadder, { from: string; to: string }>> = {};
  for (const l of TRACKED_LADDERS) {
    if (state.levels[l] !== before[l]) placed[l] = { from: LADDERS[l].levels[before[l]]!, to: LADDERS[l].levels[state.levels[l]]! };
  }

  if (!state.quests.some((q) => q.date === date)) {
    addQuestRecord(state, { date, type: 'gate', xp: XP.gate });
  }
  event(state, date, 'gate_cleared', `Gate ${number} cleared. (+${XP.gate} XP)`);
  addXp(state, date, XP.gate);
  if (state.rank !== rankBefore) {
    event(state, date, 'rank_up', `Rank up! ${rankBefore} → ${state.rank}. (+${XP.rank} XP)`);
    addXp(state, date, XP.rank);
  }
  return { number, rankBefore, rankAfter: state.rank, placed };
}

// ---- stats ----------------------------------------------------------------------

export interface Stats {
  STR: number;
  AGI: number;
  VIT: number;
  END: number;
}

export function stats(state: HunterState, today: string): Stats {
  const l = state.levels;
  const b = state.best;
  const recent = state.quests.filter((q) => daysBetween(q.date, today) < 28).length;
  const trainings = state.quests.filter((q) => q.type !== 'recovery').length;
  return {
    STR: 10 + 4 * l.pull + 3 * l.push + 4 * l.dip + (b.pullups ?? 0) + Math.floor((b.pushups ?? 0) / 3) + Math.floor((b.dips ?? 0) / 2),
    AGI: 10 + 4 * l.core + 6 * l.lsit + Math.floor((b.hollow_hold ?? 0) / 5) + Math.floor((b.l_sit ?? 0) / 2),
    VIT: 10 + 5 * l.legs + 4 * l.hinge + Math.floor(trainings / 4),
    END: 10 + Math.floor((b.dead_hang ?? 0) / 3) + 2 * recent + 2 * Math.floor(streak(state, today) / 7),
  };
}

// ---- profile -----------------------------------------------------------------------

export type ProfilePatch = Partial<Omit<Profile, 'equipment'>> & { tower?: boolean; chair?: boolean; waistCm?: number };

export function updateProfile(state: HunterState, today: string, patch: ProfilePatch): string[] {
  const changed: string[] = [];
  const p = state.profile;
  const set = <K extends keyof Profile>(field: K, value: Profile[K] | undefined): void => {
    if (value === undefined || JSON.stringify(p[field]) === JSON.stringify(value)) return;
    state.profileHistory.push({ date: today, field, from: p[field], to: value });
    p[field] = value;
    changed.push(field);
  };
  set('name', patch.name);
  set('age', patch.age);
  set('heightCm', patch.heightCm);
  set('weightKg', patch.weightKg);
  set('trainingDays', patch.trainingDays);
  set('questTime', patch.questTime);
  set('eveningWarning', patch.eveningWarning);
  set('timezone', patch.timezone);

  for (const key of ['tower', 'chair'] as const) {
    const v = patch[key];
    if (v === undefined || p.equipment[key] === v) continue;
    state.profileHistory.push({ date: today, field: `equipment.${key}`, from: p.equipment[key], to: v });
    p.equipment = { ...p.equipment, [key]: v };
    changed.push(`equipment.${key}`);
    if (key === 'tower' && v) {
      // New equipment unlocks new tests: open a Gate on the next training day.
      state.nextGate = today;
      event(state, today, 'equipment', 'New equipment detected: power tower. A Gate will open on your next training day.');
    }
  }

  if (patch.weightKg !== undefined || patch.waistCm !== undefined) {
    const entry = state.body.find((b) => b.date === today) ?? { date: today };
    if (patch.weightKg !== undefined) entry.weightKg = patch.weightKg;
    if (patch.waistCm !== undefined) entry.waistCm = patch.waistCm;
    if (!state.body.includes(entry)) state.body.push(entry);
    if (patch.waistCm !== undefined && !changed.includes('waistCm')) changed.push('waistCm');
  }
  if (state.profileHistory.length > MAX_HISTORY) state.profileHistory.splice(0, state.profileHistory.length - MAX_HISTORY);
  return changed;
}

// ---- events ----------------------------------------------------------------------------

/** Events worth a push to the phone, with the push title. */
const PUSH_TITLES: Partial<Record<EventKind, string>> = {
  level_up: '[SYSTEM] Level up',
  rank_up: '[SYSTEM] Rank up',
  skill_unlocked: '[SYSTEM] Skill unlocked',
  title: '[SYSTEM] Title earned',
};
const MAX_OUTBOX = 10;

export function event(state: HunterState, date: string, kind: SystemEvent['kind'], text: string): void {
  state.events.push({ date, kind, text });
  if (state.events.length > MAX_EVENTS) state.events.splice(0, state.events.length - MAX_EVENTS);
  const title = PUSH_TITLES[kind];
  if (title) queuePush(state, { title, body: text });
}

/** Queue a push for the next minute tick. */
export function queuePush(state: HunterState, push: Push): void {
  const box = (state.outbox ??= []);
  box.push(push);
  if (box.length > MAX_OUTBOX) box.splice(0, box.length - MAX_OUTBOX);
}

// ---- parsing helpers (tool input) ---------------------------------------------------------

const DAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/** "mon,wed,fri" | "1,3,5" | [1,3,5] → sorted unique weekdays. */
export function parseDays(v: unknown): number[] | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  const parts = Array.isArray(v) ? v : String(v).split(/[\s,;/]+/);
  const days = new Set<number>();
  for (const part of parts) {
    const s = String(part).trim().toLowerCase();
    if (!s) continue;
    const n = /^\d$/.test(s) ? Number(s) % 7 : DAY_NAMES.indexOf(s.slice(0, 3));
    if (n < 0) throw new Error(`unknown day '${String(part)}' — use mon,tue,… or 0-6 (0 = Sunday)`);
    days.add(n);
  }
  if (days.size === 0) throw new Error('pick at least one training day');
  return [...days].sort((a, b) => a - b);
}

export function formatDays(days: number[]): string {
  return days.map((d) => DAY_NAMES[d]!.replace(/^./, (c) => c.toUpperCase())).join(', ');
}

export function parseTime(v: unknown): string | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  const m = /^(\d{1,2})[:.](\d{2})$/.exec(String(v).trim());
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) throw new Error(`time '${String(v)}' must look like 10:30`);
  return `${m[1]!.padStart(2, '0')}:${m[2]}`;
}
