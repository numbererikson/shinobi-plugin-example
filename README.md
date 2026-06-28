# @shinobi/plugin-fitness

A standalone, publishable Shinobi plugin that demonstrates **long-term adaptive
mission state**. It is the reference implementation for Shinobi's writable,
per-plugin state store (`registry.state`).

The point is not to be a fitness app. It is to show that Shinobi can persist
structured state across time while an LLM reasons over that state and adapts
recommendations. The first mission is: *get visible abs in 180 days while
staying smoke-free and alcohol-free.*

The package depends only on the plugin **contract** (declared locally in
[`src/types.ts`](src/types.ts)), never on Shinobi internals — the host supplies
the concrete, SQLite-backed state store at load time.

## Division of labour

- **Shinobi owns truth** — durable state in SQLite via `registry.state`.
- **The plugin owns state** — it returns structured facts, restrictions,
  message codes, IDs and snapshots. It never returns coaching, motivation, or
  exercise explanations.
- **The LLM owns language** — it maps workout IDs and message codes to words.

## Install

This package is loaded by Shinobi's plugin discovery, which scans `node_modules`
for packages named `@shinobi/plugin-*` or `shinobi-plugin-*` and imports the
package `exports`/`main` entry.

```bash
npm install @shinobi/plugin-fitness
```

The default export is `register(registry, api)`. Shinobi calls it with a
`registry` that provides `registerTool(...)` and a scoped, writable `state`
store.

## Tools

| Tool | Purpose |
| --- | --- |
| `plugin_fitness_create` | Create a `fitness_180` mission |
| `plugin_fitness_today` | Today's day, phase, workout ID, restrictions, streaks, rules |
| `plugin_fitness_log_workout` | Record a completed/skipped workout |
| `plugin_fitness_log_pain` | Record pain (0-10) and update restrictions |
| `plugin_fitness_log_weight` | Record weight/waist and delta from start |
| `plugin_fitness_set_equipment` | Update equipment and enabled workout families |
| `plugin_fitness_status` | Full mission status + progress summary |

Tool names are lowercase `snake_case`, matching the registration regex
`/^plugin_[a-z][a-z0-9_]*$/`.

Workout IDs (e.g. `phase1_fullbody_a`, `phase1_legs_core`,
`phase2_bench_dumbbell_a`) and restriction message codes (e.g.
`NO_HEAVY_OVERHEAD_PRESSING`, `SHOULDER_PAIN_HIGH`) are stable contracts the LLM
translates into instructions.

## Demo flow

This is the flow exercised by `src/fitness.test.ts`:

1. User creates a 180-day mission.
2. Plugin stores smoke-free and alcohol-free start dates.
3. User logs an old right-shoulder issue (`restrictions.shoulder = watch`).
4. `plugin_fitness_today` → `phase1_fullbody_a` with a `NO_HEAVY_OVERHEAD_PRESSING` watch.
5. User logs shoulder pain `5/10` → restriction escalates to `avoid`.
6. Next `plugin_fitness_today` → `phase1_legs_core` with `SHOULDER_PAIN_HIGH`.
7. User adds a bench + dumbbells (`set_equipment` `bench_dumbbells`).
8. Plugin enables the `phase2_bench_dumbbell` family.
9. The LLM explains the workout using the plugin's structured state — e.g.
   *"Today we skip push and overhead work; do legs and core only. Your right
   shoulder was 5/10, so keep the streak alive without irritating it."* The
   plugin never returns that sentence.

Example `plugin_fitness_today` payload (LLM input, not LLM output):

```json
{
  "exists": true,
  "missionId": "mission_abc",
  "day": 10,
  "phase": { "number": 1, "name": "foundation", "startedAt": "2026-06-18" },
  "workoutId": "phase1_legs_core",
  "restrictions": [
    { "area": "shoulder", "side": "right", "level": "avoid", "messageCode": "SHOULDER_PAIN_HIGH" }
  ],
  "streaks": { "smokeFreeDays": 27, "alcoholFreeDays": 27, "workoutStreakDays": 0 },
  "rules": { "trainToFailure": false, "repsInReserve": 2, "maxPainAllowed": 4 }
}
```

## Deterministic rules

- **Pain** (`src/rules.ts`): `0-2` normal, `3-4` caution, `5+` avoid. High
  shoulder pain replaces any push day with `phase1_legs_core`.
- **Phases** by mission day: foundation `1-30`, base_strength `31-75`,
  progressive_strength `76-135`, definition `136-180`. Advancement is delayed
  while consistency is low (<4 workouts/14 days), a high-pain restriction is
  active, or the mission is paused.
- **Equipment** gates workout families; dumbbell families unlock only once a
  bench *and* dumbbells are present.

Every rule is a pure function — no IO, no randomness, no language — which is why
the LLM is the only source of words and the plugin is fully testable.

## Persistence

State is a single JSON object under `registry.state` key `mission`
(`FitnessPluginState`, `version: 1`). On the host it lives in Shinobi's SQLite
DB, so it is covered by the pre-migration backup and `shinobi sync`, and works
behind the stateless remote `/mcp` endpoint. Read-modify-write goes through
`registry.state.update(...)` so concurrent calls stay atomic. A malformed or
absent value reads back as "no mission" rather than throwing.

## The plugin contract

This package never imports Shinobi internals. It declares the contract locally:

```ts
interface PluginStateStore {
  get<T>(key: string): T | null;
  set(key: string, value: unknown): void;
  delete(key: string): void;
  update<T>(key: string, mutator: (current: T | null) => T): T;
}

interface PluginRegistry {
  registerTool(def: PluginToolDef): void;
  state: PluginStateStore; // scoped to this plugin
}
```

A plugin module's default export is `register(registry, api)`. The host owns the
SQLite-backed implementation; the package depends only on this shape.

## Development

```bash
npm install
npm run build   # tsc → ./dist
npm test        # vitest run
```

## Notes / out of scope

The plugin does not give medical advice and does not replace a trainer, doctor,
physiotherapist, or dentist. No wearables, nutrition, video, React, external
APIs, or LLM calls live inside it — by design.

## License

MIT
