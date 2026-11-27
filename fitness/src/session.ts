// Guided quest: the page walks the hunter through today's quest one step at
// a time — exercise, set, rest, next set — and logs everything at the end.
// Pure functions over the state; `now` is passed in.

import { exercise } from './exercises.js';
import { clearGate, completeQuest, hunterLevel, logSets, questFor, TEST_EXERCISE, type QuestItem } from './rules.js';
import type { ActiveSession, GateTest, HunterState, SessionStep, SessionSummary } from './types.js';

/** Rest after a Gate trial: full recovery before the next all-out set. */
const TRIAL_REST = 120;

const stepOf = (q: QuestItem, kind: SessionStep['kind']): SessionStep => {
  const s: SessionStep = {
    kind,
    exercise: q.exercise,
    sets: kind === 'work' ? q.sets : 1,
    target: kind === 'work' ? q.target : [q.target[0] ?? q.min],
    done: [],
    restSec: kind === 'work' ? q.restSec : 0,
  };
  if (q.ladder) s.ladder = q.ladder;
  if (q.note) s.note = q.note;
  return s;
};

/** Start (or resume) today's guided quest. */
export function startSession(state: HunterState, date: string, now: Date): ActiveSession {
  const a = state.active;
  if (a && a.date === date) {
    if (a.finished) throw new Error("Today's quest is already finished.");
    return a;
  }
  const quest = questFor(state, date);
  if (quest.done) throw new Error("Today's quest is already complete.");
  const steps: SessionStep[] = quest.warmup.map((w) => stepOf(w, 'warmup'));
  if (quest.type === 'gate') {
    for (const t of quest.gateTests) {
      steps.push({ kind: 'trial', exercise: TEST_EXERCISE[t], test: t, sets: 1, target: [], done: [], restSec: TRIAL_REST });
    }
  } else {
    for (const m of quest.main) steps.push(stepOf(m, quest.type === 'recovery' ? 'recovery' : 'work'));
  }
  if (steps.length === 0) throw new Error('Nothing to do today with the current equipment and injuries.');
  const session: ActiveSession = { date, type: quest.type, steps, cursor: 0, startedAt: now.toISOString() };
  if (quest.session) session.session = quest.session;
  state.active = session;
  return session;
}

export function activeToday(state: HunterState, date: string): ActiveSession | null {
  return state.active && state.active.date === date ? state.active : null;
}

function running(state: HunterState, date: string): ActiveSession {
  const a = activeToday(state, date);
  if (!a || a.finished) throw new Error('No quest in progress. Start it first (plugin_fitness_start).');
  return a;
}

export function restLeft(a: ActiveSession, now: Date): number {
  if (!a.restUntil) return 0;
  return Math.max(0, Math.ceil((Date.parse(a.restUntil) - now.getTime()) / 1000));
}

function startRest(a: ActiveSession, now: Date, seconds: number): void {
  if (seconds > 0) {
    a.restUntil = new Date(now.getTime() + seconds * 1000).toISOString();
    a.restSec = seconds;
  } else {
    delete a.restUntil;
    delete a.restSec;
  }
}

/** Move past the current step; finish when there is none left. */
function advance(state: HunterState, a: ActiveSession, date: string, now: Date, rest: number): void {
  a.cursor++;
  if (a.cursor >= a.steps.length) {
    finish(state, a, date, now);
    return;
  }
  startRest(a, now, rest);
}

/** Record one set (reps or seconds) of the current step. */
export function recordSet(state: HunterState, date: string, now: Date, value: number): ActiveSession {
  const a = running(state, date);
  const step = a.steps[a.cursor]!;
  step.done.push(Math.max(0, Math.round(value)));
  if (step.done.length < step.sets) startRest(a, now, step.restSec);
  else advance(state, a, date, now, step.restSec);
  return a;
}

export function skipRest(state: HunterState, date: string): ActiveSession {
  const a = running(state, date);
  delete a.restUntil;
  delete a.restSec;
  return a;
}

export function skipStep(state: HunterState, date: string, now: Date): ActiveSession {
  const a = running(state, date);
  a.steps[a.cursor]!.skipped = true;
  advance(state, a, date, now, 0);
  return a;
}

/** Stop now: whatever was done is logged; the quest counts if any real work happened. */
export function endSession(state: HunterState, date: string, now: Date): ActiveSession {
  const a = running(state, date);
  for (const s of a.steps.slice(a.cursor)) if (s.done.length === 0) s.skipped = true;
  finish(state, a, date, now);
  return a;
}

function finish(state: HunterState, a: ActiveSession, date: string, now: Date): void {
  delete a.restUntil;
  delete a.restSec;
  const levelBefore = hunterLevel(state.xp);
  const rankBefore = state.rank;
  const xpBefore = state.xp;
  const summary: SessionSummary = {
    at: now.toISOString(),
    outcome: 'complete',
    xp: 0,
    levelBefore,
    levelAfter: levelBefore,
    rankBefore,
    rankAfter: rankBefore,
    unlocked: [],
    recalibrated: [],
    logged: [],
    skipped: a.steps.filter((s) => s.skipped).map((s) => exercise(s.exercise).name),
  };

  if (a.type === 'gate') {
    const results: Partial<Record<GateTest, number>> = {};
    for (const s of a.steps) if (s.kind === 'trial' && s.test && s.done.length) results[s.test] = s.done[0]!;
    if (Object.keys(results).length) {
      clearGate(state, date, results);
      summary.outcome = 'gate';
      summary.logged = a.steps.filter((s) => s.kind === 'trial' && s.done.length).map((s) => ({ exercise: s.exercise, sets: s.done }));
    } else {
      summary.outcome = 'abandoned';
    }
  } else {
    const work = a.steps.filter((s) => s.kind === 'work' && s.done.length > 0);
    for (const s of work) {
      const r = logSets(state, date, s.exercise, s.done);
      summary.logged.push({ exercise: s.exercise, sets: s.done });
      summary.unlocked.push(...r.unlocked.map((u) => exercise(u.to).name));
      summary.recalibrated.push(...r.recalibrated.map((u) => exercise(u.to).name));
    }
    const didSomething = a.type === 'recovery' ? a.steps.some((s) => s.done.length > 0) : work.length > 0;
    if (didSomething) completeQuest(state, date);
    else summary.outcome = 'abandoned';
  }

  summary.xp = state.xp - xpBefore;
  summary.levelAfter = hunterLevel(state.xp);
  summary.rankAfter = state.rank;
  a.finished = summary;
}
