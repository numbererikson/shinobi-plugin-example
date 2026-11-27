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

export interface ExerciseLog {
  date: string;
  exercise: string;
  /** Reps (or seconds for holds) per set. */
  sets: number[];
}

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
  | 'profile';

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
  /** Local dates the quest / evening warning were pushed. */
  notified: { quest?: string; warning?: string };
}

export const STATE_KEY = 'hunter';
