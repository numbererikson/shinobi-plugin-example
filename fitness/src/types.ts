// Types for the fitness plugin. Mirrors SPEC_shinobi_plugin_fitness v0.2.0.
// The plugin stores and returns structured facts only — never natural language
// coaching; the LLM turns these into words.

export type Goal = 'visible_abs' | 'general_fitness' | 'custom';

export type Experience =
  | 'beginner'
  | 'returning_after_long_break'
  | 'physical_worker_returning'
  | 'intermediate'
  | 'advanced';

export interface FitnessProfile {
  age?: number;
  heightCm?: number;
  weightKg?: number;
  experience?: Experience;
  notes?: string;
}

export interface HabitState {
  smokeFreeSince?: string;
  alcoholFreeSince?: string;
}

export type EquipmentLevel =
  | 'none'
  | 'bodyweight'
  | 'bands'
  | 'bench'
  | 'dumbbells'
  | 'bench_dumbbells'
  | 'pullup_bar'
  | 'pullup_bar_bench_dumbbells'
  | 'home_gym';

export interface EquipmentState {
  level: EquipmentLevel;
  items?: string[];
}

export type Side = 'left' | 'right' | 'both';
export type PainArea = 'shoulder' | 'knee' | 'back' | 'other';

export interface JointRestriction {
  side?: Side;
  status: 'watch' | 'avoid' | 'cleared';
  lastPain?: number; // 0-10
  notes?: string;
}

export interface TemporaryRestriction {
  id: string;
  reason: string;
  activeUntil?: string;
  severity: 'low' | 'medium' | 'high';
}

export interface RestrictionState {
  shoulder?: JointRestriction;
  knee?: JointRestriction;
  back?: JointRestriction;
  temporary?: TemporaryRestriction[];
}

export type PhaseNumber = 1 | 2 | 3 | 4;
export type PhaseName = 'foundation' | 'base_strength' | 'progressive_strength' | 'definition';

export interface TrainingPhase {
  number: PhaseNumber;
  name: PhaseName;
  startedAt: string;
}

export interface PainReport {
  area: PainArea;
  side?: Side;
  value: number;
}

export interface WorkoutLog {
  id: string;
  date: string;
  workoutId: string;
  completed: boolean;
  durationMinutes?: number;
  difficulty?: number; // 1-10
  pain?: PainReport[];
  notes?: string;
}

export interface PainLog {
  date: string;
  area: PainArea;
  side?: Side;
  value: number; // 0-10
  trigger?: string;
  notes?: string;
}

export interface WeightLog {
  date: string;
  weightKg: number;
  waistCm?: number;
}

// Stable, machine-readable restriction codes. The LLM maps these to language.
// Add new codes rather than repurposing existing ones once shipped.
export type RestrictionMessageCode =
  | 'NO_HEAVY_OVERHEAD_PRESSING'
  | 'REDUCE_PUSH_VOLUME'
  | 'NO_DIPS'
  | 'SHOULDER_PAIN_HIGH'
  | 'KNEE_PAIN_HIGH'
  | 'BACK_PAIN_HIGH';

export interface TodayRestriction {
  area: PainArea;
  side?: Side;
  level: 'watch' | 'caution' | 'avoid';
  messageCode: RestrictionMessageCode;
}

export interface FitnessMission {
  id: string;
  type: 'fitness_180';
  status: 'active' | 'paused' | 'completed' | 'archived';
  createdAt: string;
  startedAt: string;
  targetDays: number;
  goal: Goal;
  profile: FitnessProfile;
  habits: HabitState;
  equipment: EquipmentState;
  restrictions: RestrictionState;
  phase: TrainingPhase;
  history: WorkoutLog[];
  weightHistory: WeightLog[];
  painHistory: PainLog[];
}

export interface FitnessPluginState {
  version: 1;
  missions: FitnessMission[];
  activeMissionId?: string;
}

// ---- Tool I/O ---------------------------------------------------------------

export interface CreateFitnessInput {
  goal?: Goal;
  targetDays?: number;
  profile?: Partial<FitnessProfile>;
  smokeFreeSince?: string;
  alcoholFreeSince?: string;
  equipment?: Partial<EquipmentState>;
  restrictions?: Partial<RestrictionState>;
}

export interface CreateFitnessOutput {
  mission: FitnessMission;
  created: boolean;
}

export interface TodayOutput {
  exists: boolean;
  requiredAction?: 'create_mission';
  missionId?: string;
  day?: number;
  phase?: TrainingPhase;
  workoutId?: string;
  restrictions?: TodayRestriction[];
  streaks?: {
    smokeFreeDays?: number;
    alcoholFreeDays?: number;
    workoutStreakDays?: number;
  };
  rules?: {
    trainToFailure: false;
    repsInReserve: number;
    maxPainAllowed: number;
  };
}

export interface LogWorkoutInput {
  date?: string;
  workoutId: string;
  completed: boolean;
  durationMinutes?: number;
  difficulty?: number;
  pain?: PainReport[];
  notes?: string;
}

export interface LogWorkoutOutput {
  stored: boolean;
  updatedRestrictions: RestrictionState;
  nextSuggestedWorkoutId?: string;
}

export interface LogPainInput {
  date?: string;
  area: PainArea;
  side?: Side;
  value: number;
  trigger?: string;
  notes?: string;
}

export interface LogPainOutput {
  stored: boolean;
  restrictionLevel: 'normal' | 'caution' | 'avoid';
  updatedRestrictions: RestrictionState;
}

export interface LogWeightInput {
  date?: string;
  weightKg: number;
  waistCm?: number;
}

export interface LogWeightOutput {
  stored: boolean;
  latestWeightKg: number;
  deltaFromStartKg?: number;
}

export interface SetEquipmentInput {
  level: EquipmentLevel;
  items?: string[];
}

export interface SetEquipmentOutput {
  stored: boolean;
  equipment: EquipmentState;
  enabledWorkoutFamilies: string[];
}

export interface FitnessSummary {
  day: number;
  phase: PhaseName;
  workoutsCompleted: number;
  workoutsLast14Days: number;
  smokeFreeDays?: number;
  alcoholFreeDays?: number;
  latestWeightKg?: number;
  deltaFromStartKg?: number;
  activeRestrictions: TodayRestriction[];
}

export interface StatusOutput {
  exists: boolean;
  requiredAction?: 'create_mission';
  mission?: FitnessMission;
  summary?: FitnessSummary;
}

// ---- Plugin contract (local copy, not imported from the host) ---------------
//
// A Shinobi plugin's default export is `register(registry, api)`. This package
// depends only on the *shape* of that contract — declared here as local
// interfaces — so it never imports Shinobi internals. The host supplies the
// concrete, SQLite-backed implementation at load time.

/**
 * Writable, per-plugin state store. Scoped to this plugin's namespace by the
 * host, so one plugin cannot read or clobber another's keys. Values are
 * JSON-serialized by the store.
 */
export interface PluginStateStore {
  get<T>(key: string): T | null;
  set(key: string, value: unknown): void;
  delete(key: string): void;
  /**
   * Atomic read-modify-write: applies `mutator` to the current value (or
   * `null` when absent), persists the result, and returns it.
   */
  update<T>(key: string, mutator: (current: T | null) => T): T;
}

/** A single tool registration. Tool names MUST match /^plugin_[a-z][a-z0-9_]*$/. */
export interface PluginToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: Record<string, any>) => unknown | Promise<unknown>;
}

/** The registry handed to `register()`; carries tool registration + state. */
export interface PluginRegistry {
  registerTool(def: PluginToolDef): void;
  state: PluginStateStore;
}
