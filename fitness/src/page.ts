// Dashboard page (sidebar → Apps → The System). Data blocks only, drawn by
// the host (Shinobi 0.13+ for figures, forms and the hologram theme).
//
// Layout, top to bottom:
//   1. Today — START screen, the current step of a running quest, the rest
//      countdown, or the QUEST COMPLETE screen.
//   2. Status Window.
//   3. Your Path — this week, every skill ladder with its unlock progress,
//      the next rank checklist and the next Gate.
//   4. Skill Codex — every exercise with its animation.
//   5. History, then the profile and pain forms.

import { AREAS, EXERCISES, exercise, LADDERS, type Exercise } from './exercises.js';
import { renderFigure } from './figure.js';
import { activeToday, restLeft } from './session.js';
import {
  addDays,
  daysBetween,
  formatDays,
  hunterLevel,
  ladderProgress,
  questFor,
  rankChecklist,
  stats,
  streak,
  TEST_LABEL,
  weekPlan,
  XP,
  xpForLevel,
} from './rules.js';
import { T } from './text.js';
import { GATE_TESTS, type ActiveSession, type HunterState, type SessionStep } from './types.js';

type Block = Record<string, unknown>;
export interface PageRender {
  blocks: Block[];
  refreshSeconds?: number;
}

const figureCache = new Map<string, string>();
export function figureSvg(id: string): string {
  let svg = figureCache.get(id);
  if (!svg) {
    const ex = exercise(id);
    svg = renderFigure(ex.figure, ex.name);
    figureCache.set(id, svg);
  }
  return svg;
}

const unitOf = (ex: Exercise): string => (ex.kind === 'hold' ? 's' : 'reps');
const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const dayName = (date: string): string => DAY[new Date(`${date}T12:00:00Z`).getUTCDay()]!;
const mmss = (s: number): string => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
const questTitle = (type: string, session?: string): string =>
  type === 'gate' ? 'Gate' : type === 'training' ? `Training ${session ?? ''}`.trim() : 'Recovery';

function figure(ex: Exercise, opts: { title?: string; caption?: string; size?: 'md' | 'lg'; collapsed?: boolean }): Block {
  const b: Block = {
    type: 'figure',
    svg: figureSvg(ex.id),
    alt: `${ex.name} — animated demonstration`,
    bullets: [...ex.cues, `Avoid: ${ex.mistake}`],
    size: opts.size ?? 'md',
  };
  if (opts.title) b.title = opts.title;
  if (opts.caption) b.caption = opts.caption;
  if (opts.collapsed && opts.title) b.collapsed = true;
  return b;
}

export function renderPage(state: HunterState | null, today: string, now: Date, defaultTimezone: string): PageRender {
  if (!state) return { blocks: awakening(defaultTimezone) };
  const active = activeToday(state, today);
  const running = active && !active.finished ? active : null;

  const blocks: Block[] = [];
  let refreshSeconds: number | undefined;
  if (running) {
    const r = runningBlocks(running, now);
    blocks.push(...r.blocks);
    refreshSeconds = r.refreshSeconds;
  } else if (active?.finished) {
    blocks.push(...completeBlocks(state, active, today));
  } else {
    blocks.push(...startBlocks(state, today));
  }

  // While a quest runs the page stays focused on it (and refreshes during rest).
  if (running) return refreshSeconds ? { blocks, refreshSeconds } : { blocks };

  blocks.push({ type: 'divider' }, ...statusBlocks(state, today));
  blocks.push({ type: 'divider' }, ...pathBlocks(state, today));
  blocks.push({ type: 'divider' }, ...codexBlocks(state));
  blocks.push({ type: 'divider' }, ...historyBlocks(state, today));
  blocks.push({ type: 'divider' }, { type: 'heading', text: 'Profile' }, profileForm(state), painForm());
  return { blocks };
}

// ---- 1. Today ------------------------------------------------------------------

function startBlocks(state: HunterState, today: string): Block[] {
  const q = questFor(state, today);
  const title = `Daily Quest — ${dayName(today)} · ${questTitle(q.type, q.session)}`;
  if (q.done) {
    const next = weekPlan(state, addDays(today, 1)).find((d) => d.date === addDays(today, 1));
    return [
      { type: 'heading', text: title },
      { type: 'text', tone: 'ok', text: `${T.questDone}\nTomorrow: ${next?.label ?? 'Recovery'}.` },
    ];
  }
  const items = q.type === 'gate'
    ? q.gateTests.map((t) => ({ title: TEST_LABEL[t], subtitle: 'one all-out set', badge: 'trial' }))
    : q.main.map((m) => ({
        title: m.name,
        subtitle: `${m.sets} × ${m.target.join('·')} ${m.kind === 'hold' ? 's' : 'reps'}${m.perSide ? ' per side' : ''}${m.note ? ` — ${m.note}` : ''}`,
        badge: m.level ? `Lv ${m.level.at}/${m.level.of}` : '',
        tone: m.note ? 'warn' : 'default',
      }));
  const minutes = q.type === 'recovery' ? 10 : q.type === 'gate' ? 25 : 10 + q.main.reduce((s, m) => s + Math.round((m.sets * (m.restSec + 40)) / 60), 0);
  const blocks: Block[] = [
    { type: 'heading', text: title },
    { type: 'text', text: q.type === 'gate' ? T.gateIntro : q.type === 'training' ? T.trainingIntro : T.recoveryIntro },
  ];
  if (q.deload && q.type === 'training') blocks.push({ type: 'text', tone: 'warn', text: T.deload });
  blocks.push({
    type: 'stats',
    items: [
      { label: 'Quest', value: questTitle(q.type, q.session) },
      { label: q.type === 'gate' ? 'Trials' : 'Exercises', value: String(items.length), hint: q.warmup.length ? `+ ${q.warmup.length} warm-up` : undefined },
      { label: 'Time', value: `~${minutes} min` },
      { label: 'Reward', value: `+${q.type === 'gate' ? 300 : q.type === 'training' ? 100 : 30} XP`, tone: 'ok' },
    ],
  });
  blocks.push({ type: 'list', items });
  if (q.type === 'gate') {
    const left = GATE_TESTS.filter((t) => !q.gateTests.includes(t));
    if (left.length) blocks.push({ type: 'text', tone: 'warn', text: `Not tested today (missing equipment or an area that hurts 3/10+): ${left.map((t) => TEST_LABEL[t].replace(/ \(.*\)$/, '')).join(', ')}. They join a later Gate.` });
  }
  if (q.skipped.length) {
    blocks.push({ type: 'list', items: q.skipped.map((x) => ({ title: `${LADDERS[x.ladder].name} rests today`, subtitle: x.reason, tone: 'warn' })) });
  }
  if (q.sideQuestName && q.sideQuest.length) {
    blocks.push({
      type: 'list',
      items: [
        { title: `Side Quest: ${q.sideQuestName}`, subtitle: 'gentle care after the main work, pain-free range only', badge: `+${XP.sideQuest} XP`, tone: 'ok' },
        ...q.sideQuest.map((m) => ({ title: m.name, subtitle: `${m.target[0]} ${m.kind === 'hold' ? 's' : 'reps'}${m.perSide ? ' per side' : ''}`, tone: 'muted' })),
      ],
    });
  }
  if (q.type === 'gate') {
    blocks.push({ type: 'actions', buttons: [{ label: '▶  ENTER THE GATE', tool: 'plugin_fitness_start', variant: 'primary' }] });
  } else {
    // Readiness check: poor sleep or heavy soreness turns training into a light day.
    blocks.push({
      type: 'form',
      title: 'Quick check before you start',
      tool: 'plugin_fitness_start',
      button: '▶  START QUEST',
      fields: [
        { name: 'sleep', label: 'How did you sleep?', kind: 'select', value: 'good', options: [{ value: 'good', label: 'Well' }, { value: 'ok', label: 'So-so' }, { value: 'poor', label: 'Badly' }] },
        { name: 'soreness', label: 'Sore muscles?', kind: 'select', value: 'none', options: [{ value: 'none', label: 'No' }, { value: 'some', label: 'A little' }, { value: 'heavy', label: 'A lot' }] },
      ],
    });
  }
  return blocks;
}

function stepLabel(s: SessionStep): string {
  return s.kind === 'warmup' ? 'Warm-up' : s.kind === 'trial' ? 'Gate trial' : s.kind === 'recovery' ? 'Mobility' : s.kind === 'rehab' ? 'Side quest' : 'Exercise';
}

function runningBlocks(a: ActiveSession, now: Date): PageRender {
  const step = a.steps[a.cursor]!;
  const ex = exercise(step.exercise);
  const totalSets = a.steps.reduce((n, s) => n + s.sets, 0);
  const doneSets = a.steps.reduce((n, s) => n + (s.skipped ? s.sets : s.done.length), 0);
  const blocks: Block[] = [
    { type: 'heading', text: `${questTitle(a.type, a.session)} — step ${a.cursor + 1} of ${a.steps.length}` },
    { type: 'progress', label: `${doneSets} of ${totalSets} sets`, value: doneSets, max: totalSets },
  ];
  if (a.light) blocks.push({ type: 'text', tone: 'warn', text: `Light day (${a.light}): one set fewer, bottom of the range. Showing up still counts.` });
  const rest = restLeft(a, now);
  const setNo = step.done.length + 1;
  const target = step.target[step.done.length] ?? step.target[step.target.length - 1];
  const perSide = ex.perSide ? ' per side' : '';

  if (rest > 0) {
    blocks.push({
      type: 'stats',
      items: [
        { label: 'Rest', value: mmss(rest), tone: 'ok', hint: 'breathe, shake it out' },
        { label: 'Next', value: `${ex.name}`, hint: `set ${setNo} of ${step.sets}${target !== undefined ? ` · ${target} ${unitOf(ex)}${perSide}` : ''}` },
      ],
    });
    blocks.push({ type: 'progress', label: 'Rest', value: (a.restSec ?? rest) - rest, max: a.restSec ?? rest, hint: mmss(rest) });
    blocks.push({ type: 'actions', buttons: [{ label: 'Skip rest  ⏭', tool: 'plugin_fitness_skip', args: { what: 'rest' }, variant: 'primary' }] });
    blocks.push(figure(ex, { title: `Next up: ${ex.name}`, size: 'md' }));
    return { blocks, refreshSeconds: 2 };
  }

  const what =
    step.kind === 'trial'
      ? `ONE all-out set with clean form. Stop when the form breaks.`
      : `Set ${setNo} of ${step.sets} — target ${target} ${unitOf(ex)}${perSide}${ex.kind === 'hold' ? ' (hold)' : ''}`;
  blocks.push(figure(ex, { title: `${stepLabel(step)} · ${ex.name}`, caption: [what, step.note ? `⚠ ${step.note}` : ''].filter(Boolean).join('\n'), size: 'lg' }));
  blocks.push({
    type: 'form',
    tool: 'plugin_fitness_set',
    button: step.kind === 'trial' ? '✓  Record' : step.sets > 1 ? `✓  Set ${setNo} done` : '✓  Done',
    fields: [
      {
        name: 'value',
        label: ex.kind === 'hold' ? 'Seconds held' : `Reps done${perSide}`,
        kind: 'number',
        min: 0,
        max: 900,
        unit: unitOf(ex),
        ...(step.kind === 'trial' ? { required: true } : { value: target }),
      },
      // Last set of an exercise: how did it feel? Steers the next target.
      ...(step.kind === 'work' && setNo === step.sets
        ? [{ name: 'feel', label: 'How did this exercise feel?', kind: 'select', value: 'ok', options: [{ value: 'ok', label: 'Just right' }, { value: 'easy', label: 'Too easy' }, { value: 'hard', label: 'Too hard' }] }]
        : []),
    ],
  });
  blocks.push({
    type: 'actions',
    buttons: [
      { label: 'Skip this exercise', tool: 'plugin_fitness_skip', args: { what: 'exercise' }, confirm: `Skip ${ex.name}?` },
      { label: 'End quest', tool: 'plugin_fitness_end', variant: 'danger', confirm: 'End the quest now? What you did so far is saved.' },
    ],
  });
  const upcoming = a.steps.slice(a.cursor + 1);
  if (upcoming.length) {
    blocks.push({
      type: 'list',
      items: upcoming.map((s) => ({
        title: exercise(s.exercise).name,
        subtitle: s.kind === 'trial' ? 'Gate trial · one all-out set' : `${stepLabel(s)} · ${s.sets} × ${s.target.join('·')} ${unitOf(exercise(s.exercise))}`,
        tone: 'muted',
      })),
    });
  }
  return { blocks };
}

function completeBlocks(state: HunterState, a: ActiveSession, today: string): Block[] {
  const f = a.finished!;
  const blocks: Block[] = [];
  if (f.outcome === 'abandoned') {
    blocks.push({ type: 'heading', text: 'Quest ended' }, { type: 'text', tone: 'warn', text: 'Nothing was logged, so the quest stays open. Start it again any time today.' });
    blocks.push({ type: 'actions', buttons: [{ label: '▶  START AGAIN', tool: 'plugin_fitness_start', variant: 'primary' }] });
    return blocks;
  }
  blocks.push({ type: 'heading', text: f.outcome === 'gate' ? 'Gate cleared' : 'Quest complete' });
  blocks.push({
    type: 'stats',
    items: [
      { label: 'XP gained', value: `+${f.xp}`, tone: 'ok' },
      { label: 'Level', value: f.levelAfter > f.levelBefore ? `${f.levelBefore} → ${f.levelAfter}` : String(f.levelAfter), tone: f.levelAfter > f.levelBefore ? 'ok' : 'default' },
      { label: 'Rank', value: f.rankAfter !== f.rankBefore ? `${f.rankBefore} → ${f.rankAfter}` : f.rankAfter, tone: f.rankAfter !== f.rankBefore ? 'ok' : 'default' },
      { label: 'Streak', value: `${streak(state, today)} days` },
    ],
  });
  const items = [
    ...(f.sideQuest ? [{ title: `Side quest complete: ${f.sideQuest}`, badge: `+${XP.sideQuest} XP`, tone: 'ok' }] : []),
    ...f.unlocked.map((n) => ({ title: `Skill unlocked: ${n}`, badge: 'new', tone: 'ok' })),
    ...f.recalibrated.map((n) => ({ title: `Recalibrated to ${n}`, subtitle: 'build the base, then climb again', tone: 'warn' })),
    ...f.logged.map((l) => ({ title: exercise(l.exercise).name, subtitle: l.sets.join(' · ') })),
    ...f.skipped.map((n) => ({ title: `${n} — skipped`, tone: 'muted' })),
  ];
  if (items.length) blocks.push({ type: 'list', items });
  // Pain check: one slider per status effect, pre-set to the last value.
  for (const i of state.injuries) {
    const where = `${i.side === 'both' ? '' : `${i.side} `}${i.area.replace('_', ' ')}`;
    blocks.push({
      type: 'form',
      title: `How does your ${where} feel now?`,
      tool: 'plugin_fitness_pain',
      button: 'Update',
      args: { area: i.area, side: i.side },
      fields: [{ name: 'pain', label: 'Pain (0 = gone)', kind: 'slider', min: 0, max: 10, value: i.pain, unit: '/10', hint: `It was ${i.pain}/10. At 2 or less the full exercises come back.` }],
    });
  }
  const tomorrow = weekPlan(state, addDays(today, 1)).find((d) => d.date === addDays(today, 1));
  blocks.push({ type: 'text', text: `[SYSTEM] Well done, Hunter. Tomorrow: ${tomorrow?.label ?? 'Recovery'}.` });
  return blocks;
}

// ---- 2. Status Window ------------------------------------------------------------

function statusBlocks(state: HunterState, today: string): Block[] {
  const level = hunterLevel(state.xp);
  const s = stats(state, today);
  const st = streak(state, today);
  const base = xpForLevel(level);
  const blocks: Block[] = [
    { type: 'heading', text: 'Status Window' },
    {
      type: 'stats',
      items: [
        { label: 'Hunter', value: state.profile.name || 'Unnamed', hint: `Day ${daysBetween(state.startDate, today) + 1}` },
        { label: 'Rank', value: state.rank, tone: 'ok' },
        { label: 'Level', value: String(level), hint: `${state.xp} XP` },
        { label: 'Streak', value: `${st} day${st === 1 ? '' : 's'}`, tone: st > 0 ? 'ok' : 'muted' },
        { label: 'STR', value: String(s.STR), hint: 'pull · push · dip' },
        { label: 'AGI', value: String(s.AGI), hint: 'core · L-sit' },
        { label: 'VIT', value: String(s.VIT), hint: 'legs · hinge' },
        { label: 'END', value: String(s.END), hint: 'hang · consistency' },
      ],
    },
    { type: 'progress', label: `Level ${level} → ${level + 1}`, value: state.xp - base, max: xpForLevel(level + 1) - base, hint: `${state.xp - base} / ${xpForLevel(level + 1) - base} XP` },
  ];
  if (state.injuries.length) {
    blocks.push({
      type: 'list',
      items: state.injuries.map((i) => ({
        title: `${i.side === 'both' ? '' : `${i.side} `}${i.area.replace('_', ' ')} — ${i.pain}/10`,
        subtitle: `since ${i.since}${i.note ? ` · ${i.note}` : ''} · ${i.pain <= 2 ? 'train, stay below pain' : i.pain <= 4 ? 'light work only' : 'rest this area'} · update it in the Profile section`,
        badge: 'Status effect',
        tone: i.pain >= 5 ? 'error' : 'warn',
      })),
    });
  }
  return blocks;
}

// ---- 3. Your Path -------------------------------------------------------------------

function pathBlocks(state: HunterState, today: string): Block[] {
  const week = weekPlan(state, today);
  const mark = { done: '✓', today: '▶', planned: '', missed: '✗', before: '' } as const;
  const blocks: Block[] = [
    { type: 'heading', text: 'Your Path' },
    {
      type: 'table',
      columns: week.map((d) => `${dayName(d.date)} ${d.date.slice(8)}.`),
      rows: [week.map((d) => `${mark[d.status]} ${d.label}`.trim())],
    },
    {
      type: 'text',
      tone: 'muted',
      text:
        `Training days: ${formatDays(state.profile.trainingDays)} at ${state.profile.questTime}. ` +
        `Every exercise climbs a ladder: hit the top of its range in two sessions and the next one unlocks. Every 5th week is a lighter deload week.`,
    },
  ];
  blocks.push({
    type: 'list',
    items: ladderProgress(state).map((p) => ({
      title: `${p.name}: ${p.current}`,
      subtitle: p.held
        ? `On hold — ${p.held}. A lighter exercise stands in until then.`
        : p.next
          ? `Next: ${p.next} — ${p.needs} (${p.top}/2 done)`
          : 'Top of this ladder — keep it sharp.',
      badge: `${p.level}/${p.of}`,
      tone: p.held ? 'warn' : p.top > 0 ? 'ok' : 'default',
    })),
  });
  const check = rankChecklist(state);
  const gateIn = daysBetween(today, state.nextGate);
  if (check) {
    blocks.push({
      type: 'list',
      items: check.items.map((i) => ({
        title: `${i.met ? '✓' : '○'} ${i.label}`,
        subtitle: i.best !== undefined ? `best so far: ${i.best}` : undefined,
        tone: i.met ? 'ok' : 'default',
      })),
      empty: 'All requirements met.',
    });
    blocks.push({
      type: 'text',
      tone: 'muted',
      text: `Rank ${check.rank} needs everything above. Ranks are decided at Gates — ${gateIn <= 0 ? 'one is open now' : `next Gate on ${state.nextGate} (in ${gateIn} day${gateIn === 1 ? '' : 's'})`}.`,
    });
  } else {
    blocks.push({ type: 'text', tone: 'ok', text: 'Rank S. There is nothing above you.' });
  }
  return blocks;
}

// ---- 4. Skill Codex ---------------------------------------------------------------------

function codexBlocks(state: HunterState): Block[] {
  const blocks: Block[] = [{ type: 'heading', text: 'Skill Codex' }, { type: 'text', tone: 'muted', text: 'Every exercise in the System. Open one to see how it moves.' }];
  const seen = new Set<string>();
  for (const l of Object.values(LADDERS)) {
    l.levels.forEach((id, i) => {
      if (seen.has(id)) return;
      seen.add(id);
      const ex = exercise(id);
      const tracked = l.id !== 'pull_floor' ? state.levels[l.id as keyof HunterState['levels']] : 0;
      const tag = i < tracked ? ' ✓' : i === tracked ? ' ◀ you are here' : '';
      blocks.push(figure(ex, { title: `${l.name} ${i + 1} · ${ex.name}${tag}`, caption: `${ex.sets} × ${ex.min}–${ex.max} ${unitOf(ex)}${ex.perSide ? ' per side' : ''}`, collapsed: true }));
    });
  }
  for (const ex of EXERCISES) {
    if (seen.has(ex.id)) continue;
    blocks.push(figure(ex, { title: `Mobility · ${ex.name}`, caption: `${ex.min} ${unitOf(ex)}${ex.perSide ? ' per side' : ''}`, collapsed: true }));
  }
  return blocks;
}

// ---- 5. History + profile -------------------------------------------------------------------

function historyBlocks(state: HunterState, today: string): Block[] {
  const blocks: Block[] = [{ type: 'heading', text: 'History' }];
  const weeks = Array.from({ length: 12 }, (_, i) => addDays(today, -7 * (11 - i)));
  const volume = weeks.map((end) => {
    const start = addDays(end, -6);
    return state.logs
      .filter((l) => l.date >= start && l.date <= end && exercise(l.exercise).kind === 'reps')
      .reduce((sum, l) => sum + l.sets.reduce((a, b) => a + b, 0), 0);
  });
  if (volume.some((v) => v > 0)) {
    blocks.push({ type: 'chart', kind: 'bar', title: 'Reps per week', labels: weeks.map((w) => w.slice(5)), series: [{ name: 'Reps', values: volume }] });
  }
  // Pain over time, one line per area/side (max 4).
  const pains = (state.painLog ?? []).slice(-120);
  if (pains.length >= 2) {
    const dates = [...new Set(pains.map((p) => p.date))].sort().slice(-60);
    const keys = [...new Set(pains.map((p) => `${p.side === 'both' ? '' : `${p.side} `}${p.area.replace('_', ' ')}`))].slice(0, 4);
    blocks.push({
      type: 'chart',
      kind: 'line',
      title: 'Pain',
      unit: '/10',
      labels: dates.map((d) => d.slice(5)),
      series: keys.map((k) => ({
        name: k,
        values: dates.map((d) => {
          const e = pains.filter((p) => p.date === d && `${p.side === 'both' ? '' : `${p.side} `}${p.area.replace('_', ' ')}` === k).at(-1);
          return e ? e.pain : null;
        }),
      })),
    });
  }
  const body = state.body.filter((b) => b.weightKg !== undefined).slice(-60);
  if (body.length >= 2) {
    blocks.push({ type: 'chart', kind: 'line', title: 'Weight', unit: 'kg', labels: body.map((b) => b.date.slice(5)), series: [{ name: 'Weight', values: body.map((b) => b.weightKg ?? null) }] });
  }
  if (state.gates.length) {
    blocks.push({
      type: 'table',
      columns: ['Gate', 'Date', 'Rank', 'Results'],
      rows: [...state.gates].reverse().map((g) => [
        `#${g.number}`,
        g.date,
        g.rankBefore === g.rankAfter ? g.rankAfter : `${g.rankBefore} → ${g.rankAfter}`,
        Object.entries(g.results).map(([k, v]) => `${k.replace('_', ' ')} ${v}`).join(', '),
      ]),
    });
  }
  blocks.push({
    type: 'table',
    columns: ['Date', 'Exercise', 'Sets'],
    rows: [...state.logs].reverse().slice(0, 15).map((l) => [l.date, exercise(l.exercise).name, l.sets.join(' · ')]),
    empty: 'No sets logged yet — they appear here after your first quest.',
  });
  blocks.push({
    type: 'list',
    items: [...state.events].reverse().slice(0, 8).map((e) => ({ title: e.text, subtitle: e.date, badge: e.kind.replace('_', ' ') })),
    empty: 'The System log is empty.',
  });
  return blocks;
}

function profileForm(state: HunterState): Block {
  const p = state.profile;
  const waist = [...state.body].reverse().find((b) => b.waistCm !== undefined)?.waistCm;
  return {
    type: 'form',
    title: 'Hunter profile — change anything, the System adapts',
    tool: 'plugin_fitness_profile',
    button: 'Save profile',
    fields: [
      { name: 'name', label: 'Hunter name', kind: 'text', value: p.name ?? '', maxLength: 40 },
      { name: 'age', label: 'Age', kind: 'number', value: p.age, min: 10, max: 100 },
      { name: 'height_cm', label: 'Height', kind: 'number', unit: 'cm', value: p.heightCm, min: 100, max: 230 },
      { name: 'weight_kg', label: 'Weight', kind: 'number', unit: 'kg', value: p.weightKg, min: 30, max: 250, step: 0.1 },
      { name: 'waist_cm', label: 'Waist', kind: 'number', unit: 'cm', value: waist, min: 40, max: 200, step: 0.5, hint: 'Optional, at the belly button.' },
      { name: 'training_days', label: 'Training days', kind: 'text', value: formatDays(p.trainingDays), hint: 'e.g. Mon, Wed, Fri' },
      { name: 'quest_time', label: 'Daily Quest time', kind: 'text', value: p.questTime, hint: '24-hour, e.g. 10:30' },
      { name: 'timezone', label: 'Time zone', kind: 'text', value: p.timezone },
      { name: 'evening_warning', label: 'Evening warning', kind: 'toggle', value: p.eveningWarning, placeholder: 'Remind me at 19:30 if the quest is open' },
      { name: 'tower', label: 'Power tower', kind: 'toggle', value: p.equipment.tower, placeholder: 'Pull-up bar + dip handles' },
      { name: 'chair', label: 'Sturdy chair or bench', kind: 'toggle', value: p.equipment.chair, placeholder: 'Available' },
    ],
  };
}

function painForm(): Block {
  return {
    type: 'form',
    title: 'Report pain — 0 means it is gone',
    tool: 'plugin_fitness_pain',
    button: 'Update status',
    fields: [
      { name: 'area', label: 'Where', kind: 'select', options: AREAS.map((a) => ({ value: a, label: a.replace('_', ' ') })) },
      { name: 'side', label: 'Side', kind: 'select', options: [{ value: 'right', label: 'right' }, { value: 'left', label: 'left' }, { value: 'both', label: 'both / middle' }] },
      { name: 'pain', label: 'Pain now', kind: 'slider', min: 0, max: 10, value: 0, unit: '/10' },
      { name: 'note', label: 'Note', kind: 'text', maxLength: 200, placeholder: 'e.g. hurts on overhead movements' },
    ],
  };
}

function awakening(defaultTimezone: string): Block[] {
  return [
    { type: 'heading', text: 'Awakening' },
    { type: 'text', text: T.awakening },
    {
      type: 'form',
      title: 'Hunter registration',
      tool: 'plugin_fitness_setup',
      button: 'Awaken',
      fields: [
        { name: 'name', label: 'Hunter name', kind: 'text', maxLength: 40 },
        { name: 'age', label: 'Age', kind: 'number', min: 10, max: 100, required: true },
        { name: 'height_cm', label: 'Height', kind: 'number', unit: 'cm', min: 100, max: 230, required: true },
        { name: 'weight_kg', label: 'Weight', kind: 'number', unit: 'kg', min: 30, max: 250, step: 0.1, required: true },
        { name: 'pushups', label: 'Push-ups in a row (estimate)', kind: 'number', min: 0, max: 200, hint: 'Leave empty if unsure.' },
        { name: 'pullups', label: 'Pull-ups in a row (estimate)', kind: 'number', min: 0, max: 100 },
        { name: 'squats', label: 'Squats in a row (estimate)', kind: 'number', min: 0, max: 300 },
        { name: 'training_days', label: 'Training days', kind: 'text', value: 'Mon, Wed, Fri' },
        { name: 'quest_time', label: 'Daily Quest time', kind: 'text', value: '10:30' },
        { name: 'timezone', label: 'Time zone', kind: 'text', value: defaultTimezone },
        { name: 'tower', label: 'Power tower', kind: 'toggle', value: false, placeholder: 'I have a pull-up bar + dip handles' },
        { name: 'chair', label: 'Sturdy chair or bench', kind: 'toggle', value: true, placeholder: 'Available' },
        { name: 'pain_area', label: 'Anything that hurts?', kind: 'select', options: AREAS.map((a) => ({ value: a, label: a.replace('_', ' ') })), hint: 'Leave the pain at 0 if nothing hurts.' },
        { name: 'pain_side', label: 'Side', kind: 'select', options: [{ value: 'right', label: 'right' }, { value: 'left', label: 'left' }, { value: 'both', label: 'both / middle' }] },
        { name: 'pain', label: 'Pain level', kind: 'slider', min: 0, max: 10, value: 0, unit: '/10' },
      ],
    },
  ];
}
