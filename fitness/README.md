# shinobi-plugin-fitness — The System

A bodyweight strength trainer for [Shinobi](https://github.com/numbererikson/shinobi),
dressed as a hunter-RPG "System": a **Daily Quest** every day, **ranks E → S**
earned at **Gates** (test days), stats, level-ups and skill unlocks.

The goal is strength you can carry anywhere at a normal body weight — pull,
push, legs and core — not bodybuilding. No heavy loads and no training to
failure: every movement climbs a **ladder** from easy to elite (dead hang →
pull-up → archer pull-up, wall push-up → pseudo planche push-up, squat →
pistol squat…), and you climb it when you own the current step.

Works with a power tower (pull-up bar + dip handles) or with just the floor,
a wall and a chair.

## What you get

- **Guided quests.** Press **START QUEST** and the page walks you through it
  one step at a time: a large animation of the exercise, "Set 2 of 3 — target
  10 reps", a box for what you actually did and **✓ Set done**. Between sets a
  rest countdown runs (with *Skip rest*), then the next set or exercise. At the
  end everything is logged and the quest completes by itself: XP, level-ups,
  unlocked skills and what tomorrow brings. *Skip this exercise* and *End
  quest* are always there. The same flow works from chat
  (`plugin_fitness_start` → `plugin_fitness_set` …).
- **Your Path.** This week day by day (done / today / planned), every ladder
  with exactly what unlocks its next step ("3 × 15 in 2 sessions — 1/2 done")
  or why it is on hold, the next rank as a checklist with your best results,
  and the next Gate.
- **Skill Codex.** Every exercise with its animation, marked ✓ / "you are
  here" on its ladder.
- **Daily Quest.** Training days alternate session A (pull, push, legs, core)
  and B (pull, dip, hinge, L-sit, legs) of about 40 minutes with a short
  warm-up; other days are a 10-minute recovery quest (mobility). Every fifth
  week is a deload.
- **Ladders and double progression.** Each exercise has a range (e.g. 3 × 3–8).
  Today's target is one rep more than last time; hit the top of the range in
  two sessions and the next skill unlocks. Fall clearly short twice and the
  System recalibrates one step down.
- **Injury-aware.** Report pain 0–10 per area (shoulder, elbow, wrist, lower
  back, hip, knee, ankle). 1–2: train below pain; 3–4: only light work for that
  area; 5+: the area rests. Exercises are swapped automatically for easier ones
  on the same ladder or a floor alternative, and the quest says why.
- **Gates every 6 weeks** (and when you add a power tower): one all-out set of
  pull-ups, push-ups, dips, dead hang, hollow hold and L-sit. Results place you
  on the ladders and decide your rank. The first training day is the
  Awakening Gate.
- **Status Window**: rank, level/XP, STR · AGI · VIT · END, streak, active
  status effects, what the next rank needs.
- **Animated figures.** Every exercise has a looping animation — outlined,
  shaded body on a hologram grid, a faint "ghost" of the end position, an
  arrow showing the direction of the movement, framed tight around the
  figure — plus three plain cues and the most common mistake. No video
  searching.
- **Dashboard page** (*Apps → The System*, right after Music) in the
  `hologram` theme: today first (START / current step / rest / complete),
  then the Status Window, Your Path, the Skill Codex, history charts (reps
  per week, weight), Gate results, the System log, and the profile and pain
  forms.
- **Pushes**: the Daily Quest at your chosen time, an optional 19:30 warning
  if it is still open (recovery quests get a *Done* button), and a line in
  Shinobi's morning brief.

Nutrition and habit tracking are deliberately out of scope.

## Install

From the Shinobi dashboard: **Plugins → Catalog → Fitness → Install →
Restart now**. Or drop the single-file bundle into the plugins folder:

```bash
curl -fsSL -o ~/.shinobi/plugins/shinobi-plugin-fitness.mjs \
  https://raw.githubusercontent.com/numbererikson/shinobi-plugin-example/main/fitness/standalone/shinobi-plugin-fitness.mjs
```

Needs Shinobi **0.13+** for the full page (figure and form blocks, the
`hologram` theme). The tools work on any host with `registry.state`; older
hosts simply leave out the blocks they do not know.

Then open *The System* and fill in the registration form, or tell Claude
"set me up in The System: 43, 173 cm, 75 kg, power tower arriving next week".

## Tools

| Tool | Purpose |
| --- | --- |
| `plugin_fitness_setup` | Awaken a Hunter: age, height, weight, optional baseline (push-ups, pull-ups, squats…), training days, quest time, time zone, equipment, pain. `reset: true` starts over. |
| `plugin_fitness_status` | Status Window: rank, level, XP, stats, streak, injuries, ladders, best results, next Gate, next-rank requirements. |
| `plugin_fitness_today` | Today's quest with targets per set, rest, cues and adjustments (and the guided session in progress, if any). |
| `plugin_fitness_start` | Start or resume today's quest as a guided session. |
| `plugin_fitness_set` | Report the set just done (reps or seconds; a Gate trial's result). Moves to rest / next set / next exercise; the last one logs and completes the quest. |
| `plugin_fitness_skip` | Skip the current rest (`what: "rest"`) or exercise (`what: "exercise"`). |
| `plugin_fitness_end` | End the guided quest now; what was done is logged. |
| `plugin_fitness_log` | Log one exercise's sets (`sets: [6, 5, 5]`, or `set1`…`set5`). Unlocks/recalibrates. |
| `plugin_fitness_complete` | Complete today's training or recovery quest (XP, streak). |
| `plugin_fitness_pain` | Report pain 0–10 for an area and side; 0 clears it. |
| `plugin_fitness_profile` | Weight, waist, height, age, name, training days, quest time, evening warning, time zone, equipment. Every change is kept in the history. |
| `plugin_fitness_gate` | Log Gate trial results; updates bests, ladders and rank. |
| `plugin_fitness_exercise` | How to do an exercise; without an id, the full catalogue by ladder. |
| `plugin_fitness_history` | Quests, sets, body measurements, Gates and profile changes for the last N days. |

The plugin returns facts in English (exercise ids, targets, cues, `[SYSTEM]`
messages); the LLM explains them to the user in the user's own language.

## Rules at a glance

| | |
| --- | --- |
| XP | training quest 100 · recovery 30 · Gate 300 · skill unlock 150 · rank up 500 |
| Level | level *n* needs 50 · *n* · (*n* − 1) XP |
| Ranks | E → D → C → B → A → S, decided only at Gates and never lost. Requirements combine test results (e.g. C: 8 pull-ups, 25 push-ups, 8 dips, 45 s hang, 40 s hollow hold) and ladder levels (e.g. C: Bulgarian split squat). Without a tower the pull/dip trials are waived up to rank C. |
| Stats | STR from pull/push/dip levels and bests · AGI from core and L-sit · VIT from legs and hinge · END from hang time and consistency |

All rules are pure functions in [`src/rules.ts`](src/rules.ts); the catalogue,
ladders and figure poses are in [`src/exercises.ts`](src/exercises.ts).

## Development

```bash
npm install
npm test          # vitest: rules, tools, page, every figure
npm run bundle    # tsc + esbuild → standalone/shinobi-plugin-fitness.mjs (commit it)
npm run preview   # preview/index.html: every figure, live and frozen across its loop
```

Figures are generated from key poses (joint angles, or IK targets for hands
and feet) by [`src/figure.ts`](src/figure.ts) into self-contained SVG with SMIL
animation. Shinobi draws them as images, so they cannot run script; keep them
free of external references (`#id` only).

State is one JSON document under `registry.state` key `hunter` (`version: 2`),
updated atomically. Sets, quests, events and history are capped so it stays
small.

## Not medical advice

The System is a general training plan. It does not replace a doctor or a
physiotherapist; if pain persists, get it looked at and tell the System what
they said.

## License

MIT
