// Host contract (declared locally so the package never imports Shinobi
// internals) and the plugin's persisted state.

import type { Area, LadderId } from './exercises.js';

// ---- host contract --------------------------------------------------------

export interface PluginStateStore {
  get<T>(key: string): T | null;
  set(key: string, value: unknown): void;
  delete(key: string): void;
  update<T>(key: string, mutator: (current: T | null) => T): T;
}

export interface PluginToolDef {
  name: string;
  description: string;
  inputSchema: object;
  handler: (args: Record<string, unknown>) => unknown | Promise<unknown>;
}

export interface PluginRegistry {
  registerTool(def: PluginToolDef): void;
  state: PluginStateStore;
  registerPage?(def: { id: string; title: string; icon?: string; order?: number; theme?: string; render: () => unknown }): void;
  schedule?(def: { id: string; cron: string; timezone?: string; run: () => unknown | Promise<unknown> }): void;
  notify?(n: { title: string; body: string; url?: string; tag?: string; actions?: { label: string; tool: string; args?: Record<string, unknown> }[] }): Promise<unknown>;
  brief?(def: { id: string; order?: number; render: () => unknown }): void;
}

// ---- state ----------------------------------------------------------------

export type Rank = 'E' | 'D' | 'C' | 'B' | 'A' | 'S';
export const RANKS: Rank[] = ['E', 'D', 'C', 'B', 'A', 'S'];

export type Side = 'left' | 'right' | 'both';

export type GateTest = 'pullups' | 'pushups' | 'dips' | 'dead_hang' | 'hollow_hold' | 'l_sit';
export const GATE_TESTS: GateTest[] = ['pullups', 'pushups', 'dips', 'dead_hang', 'hollow_hold', 'l_sit'];

export type TrackedLadder = Exclude<LadderId, 'pull_floor'>;

export interface Profile {
  name?: string;
  age?: number;
  heightCm?: number;
  weightKg?: number;
  /** Local weekdays with a training quest, 0 = Sunday … 6 = Saturday. */
  trainingDays: number[];
  /** Local time of the Daily Quest push, "HH:MM". */
  questTime: string;
  /** Push a warning in the evening when the quest is still open. */
  eveningWarning: boolean;
  timezone: string;
  equipment: { tower: boolean; chair: boolean };
}

export interface Injury {
  area: Area;
  side: Side;
  /** 0–10. */
  pain: number;
  since: string;
  updatedAt: string;
  note?: string;
}

export type Feel = 'easy' | 'ok' | 'hard';

export interface ExerciseLog {
  date: string;
  exercise: string;
  /** Reps (or seconds for holds) per set. */
  sets: number[];
  /** How the exercise felt; steers the next target. */
  feel?: Feel;
}

export interface PainEntry {
  date: string;
  area: Area;
  side: Side;
  pain: number;
}

export type Sleep = 'good' | 'ok' | 'poor';
export type Soreness = 'none' | 'some' | 'heavy';

export type QuestType = 'training' | 'recovery' | 'gate';

export interface QuestRecord {
  date: string;
  type: QuestType;
  session?: 'A' | 'B';
  xp: number;
}

export interface BodyEntry {
  date: string;
  weightKg?: number;
  waistCm?: number;
}

export interface GateResult {
  date: string;
  number: number;
  results: Partial<Record<GateTest, number>>;
  rankBefore: Rank;
  rankAfter: Rank;
}

export type EventKind =
  | 'awakening'
  | 'quest_complete'
  | 'level_up'
  | 'skill_unlocked'
  | 'recalibration'
  | 'gate_cleared'
  | 'rank_up'
  | 'injury'
  | 'recovered'
  | 'equipment'
  | 'profile'
  | 'title'
  | 'treasure'
  | 'comeback'
  | 'walk';

export interface SystemEvent {
  date: string;
  kind: EventKind;
  text: string;
}

export interface ProfileChange {
  date: string;
  field: string;
  from: unknown;
  to: unknown;
}

export interface HunterState {
  version: 2;
  startDate: string;
  profile: Profile;
  levels: Record<TrackedLadder, number>;
  /** Consecutive sessions at the top / bottom of the range, per exercise. */
  streaks: Record<string, { top: number; low: number }>;
  injuries: Injury[];
  logs: ExerciseLog[];
  quests: QuestRecord[];
  body: BodyEntry[];
  gates: GateResult[];
  events: SystemEvent[];
  profileHistory: ProfileChange[];
  best: Partial<Record<GateTest, number>>;
  xp: number;
  rank: Rank;
  /** First day a Gate (test) is due. */
  nextGate: string;
  /** Local dates the quest / evening warning / weekly report were pushed. */
  notified: { quest?: string; warning?: string; weekly?: string };
  /** The guided quest in progress (or just finished) today. */
  active?: ActiveSession;
  /** Every pain report, for the pain chart. */
  painLog?: PainEntry[];
  /** Lifetime tallies the titles are earned from. */
  counters?: Counters;
  /** Titles earned (kept forever) and the one shown under the name. */
  titles?: { id: string; date: string }[];
  activeTitle?: string;
  /** The hunter picked the active title themselves: new titles do not replace it. */
  titleChosen?: boolean;
  /** Real-world rewards the hunter set for themselves. */
  treasures?: Treasure[];
  nextTreasureId?: number;
  /** Dates of bonus walks. */
  walks?: string[];
  /** Pushes waiting for the next minute tick (level up, rank up, titles, treasure). */
  outbox?: Push[];
}

export interface Counters {
  sideQuests: number;
  lightDays: number;
  comebacks: number;
  skills: number;
  reps: number;
  walks: number;
}

export type TreasureWhen = 'level' | 'rank' | 'streak' | 'quests' | 'title';

export interface Treasure {
  id: number;
  name: string;
  when: TreasureWhen;
  /** Level / streak days / quest count, a rank letter, or a title id. */
  target: number | string;
  createdAt: string;
  unlockedAt?: string;
  claimedAt?: string;
}

export interface Push {
  title: string;
  body: string;
  actions?: { label: string; tool: string; args?: Record<string, unknown> }[];
}

export type StepKind = 'warmup' | 'work' | 'trial' | 'recovery' | 'rehab';

export interface SessionStep {
  kind: StepKind;
  exercise: string;
  ladder?: LadderId;
  test?: GateTest;
  sets: number;
  /** Target per set; empty for Gate trials (all-out). */
  target: number[];
  /** What was done per set so far. */
  done: number[];
  skipped?: boolean;
  /** Rest after each set of this step, seconds. */
  restSec: number;
  note?: string;
  /** How it felt (asked on the last set of a work step). */
  feel?: Feel;
}

export interface SessionSummary {
  at: string;
  outcome: 'complete' | 'gate' | 'abandoned';
  xp: number;
  levelBefore: number;
  levelAfter: number;
  rankBefore: Rank;
  rankAfter: Rank;
  unlocked: string[];
  recalibrated: string[];
  logged: { exercise: string; sets: number[] }[];
  skipped: string[];
  /** The rehab side quest was done. */
  sideQuest?: string;
  /** Titles earned and treasures unlocked by this quest (names). */
  titles?: string[];
  treasures?: { id: number; name: string }[];
}

export interface ActiveSession {
  date: string;
  type: QuestType;
  session?: 'A' | 'B';
  steps: SessionStep[];
  /** Index of the current step. */
  cursor: number;
  /** ISO time the current rest ends. */
  restUntil?: string;
  /** Seconds of the current rest (for the progress bar). */
  restSec?: number;
  startedAt: string;
  /** Readiness made this a light day (one set fewer, bottom of the range): the reason. */
  light?: string;
  /** Name of today's rehab side quest, when it is part of the session. */
  sideQuest?: string;
  finished?: SessionSummary;
}

export const STATE_KEY = 'hunter';
