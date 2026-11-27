// Dashboard page (sidebar → Apps → The System): data blocks only, drawn by
// the host. Needs Shinobi 0.13+ for figures, forms and the hologram theme;
// older hosts drop those blocks and show the rest.

import { AREAS, exercise, LADDERS, TRACKED_LADDERS } from './exercises.js';
import { renderFigure } from './figure.js';
import {
  addDays,
  daysBetween,
  formatDays,
  hunterLevel,
  nextRankNeeds,
  questFor,
  stats,
  streak,
  TEST_EXERCISE,
  TEST_LABEL,
  xpForLevel,
  type QuestItem,
} from './rules.js';
import { GATE_TESTS, type HunterState } from './types.js';
import { T } from './text.js';

type Block = Record<string, unknown>;

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

const unit = (q: { kind: 'reps' | 'hold' }): string => (q.kind === 'hold' ? 's' : 'reps');
const range = (q: QuestItem): string => `${q.sets} × ${q.min === q.max ? q.min : `${q.min}–${q.max}`} ${unit(q)}${q.perSide ? ' / side' : ''}`;

function exerciseBlocks(q: QuestItem, opts: { log: boolean; warmup?: boolean }): Block[] {
  const ex = exercise(q.exercise);
  const level = q.level ? ` · Lv ${q.level.at}/${q.level.of}` : '';
  const caption = [
    `Today: ${q.target.join(' · ')} ${unit(q)}${q.perSide ? ' per side' : ''}${q.restSec ? ` — rest ${q.restSec} s between sets` : ''}`,
    q.note ? `⚠ ${q.note}` : '',
    q.logged ? `✓ Logged: ${q.logged.join(' · ')}` : '',
  ].filter(Boolean).join('\n');
  const blocks: Block[] = [
    {
      type: 'figure',
      svg: figureSvg(ex.id),
      alt: `${ex.name} — animated demonstration`,
      title: `${opts.warmup ? 'Warm-up · ' : ''}${ex.name} · ${range(q)}${level}${q.logged ? ' ✓' : ''}`,
      caption,
      bullets: [...ex.cues, `Avoid: ${ex.mistake}`],
      size: 'md',
      collapsed: true,
    },
  ];
  if (opts.log) {
    blocks.push({
      type: 'form',
      tool: 'plugin_fitness_log',
      button: q.logged ? 'Log again' : `Log ${ex.name}`,
      args: { exercise: ex.id },
      fields: q.target.map((t, i) => ({
        name: `set${i + 1}`,
        label: `Set ${i + 1}`,
        kind: 'number',
        min: 0,
        max: 600,
        unit: unit(q),
        value: q.logged?.[i] ?? t,
      })),
    });
  }
  return blocks;
}

export function renderPage(state: HunterState | null, today: string, defaultTimezone: string): Block[] {
  if (!state) return awakening(defaultTimezone);
  const blocks: Block[] = [];
  const level = hunterLevel(state.xp);
  const s = stats(state, today);
  const st = streak(state, today);

  // ---- Status Window ----
  blocks.push({ type: 'heading', text: 'Status Window' });
  blocks.push({
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
  });
  const base = xpForLevel(level);
  blocks.push({ type: 'progress', label: `Level ${level} → ${level + 1}`, value: state.xp - base, max: xpForLevel(level + 1) - base, hint: `${state.xp - base} / ${xpForLevel(level + 1) - base} XP` });
  const needs = nextRankNeeds(state);
  const gateIn = daysBetween(today, state.nextGate);
  blocks.push({
    type: 'text',
    tone: 'muted',
    text: [
      needs ? `Next rank ${needs.rank}: ${needs.missing.length ? needs.missing.join(', ') : 'all requirements met — clear the next Gate'}` : 'Maximum rank reached.',
      gateIn <= 0 ? 'A Gate is open: it replaces your next training quest.' : `Next Gate in ${gateIn} day${gateIn === 1 ? '' : 's'} (${state.nextGate}).`,
    ].join('\n'),
  });
  if (state.injuries.length) {
    blocks.push({
      type: 'list',
      items: state.injuries.map((i) => ({
        title: `${i.side === 'both' ? '' : `${i.side} `}${i.area.replace('_', ' ')} — ${i.pain}/10`,
        subtitle: `since ${i.since}${i.note ? ` · ${i.note}` : ''} · ${i.pain <= 2 ? 'train, stay below pain' : i.pain <= 4 ? 'light work only' : 'rest this area'}`,
        badge: 'Status effect',
        tone: i.pain >= 5 ? 'error' : 'warn',
      })),
    });
  }

  // ---- Daily Quest ----
  const quest = questFor(state, today);
  const title = quest.type === 'gate' ? 'Gate' : quest.type === 'training' ? `Daily Quest — Training ${quest.session}` : 'Daily Quest — Recovery';
  blocks.push({ type: 'divider' });
  blocks.push({ type: 'heading', text: title });
  blocks.push({ type: 'text', text: questIntro(quest.type, quest.deload, quest.done) });
  for (const w of quest.warmup) blocks.push(...exerciseBlocks(w, { log: false, warmup: true }));
  for (const m of quest.main) blocks.push(...exerciseBlocks(m, { log: quest.type === 'training' && !quest.done }));
  if (quest.skipped.length) {
    blocks.push({
      type: 'list',
      items: quest.skipped.map((x) => ({ title: `${LADDERS[x.ladder].name} skipped`, subtitle: x.reason, tone: 'warn' })),
    });
  }
  if (quest.type === 'gate' && !quest.done) {
    // Show how each trial is done: same animation, cues and mistake as in training.
    for (const t of quest.gateTests) {
      const ex = exercise(TEST_EXERCISE[t]);
      blocks.push({
        type: 'figure',
        svg: figureSvg(ex.id),
        alt: `${ex.name} — animated demonstration`,
        title: `Trial · ${TEST_LABEL[t]}`,
        caption: `One all-out set of ${ex.name} with clean form. Stop when the form breaks and note the ${ex.kind === 'hold' ? 'seconds' : 'reps'}.`,
        bullets: [...ex.cues, `Avoid: ${ex.mistake}`],
        size: 'md',
        collapsed: false,
      });
    }
    const left = GATE_TESTS.filter((t) => !quest.gateTests.includes(t));
    if (left.length) {
      blocks.push({
        type: 'text',
        tone: 'warn',
        text: `Not tested today (missing equipment or an area that hurts 3/10+): ${left.map((t) => TEST_LABEL[t].replace(/ \(.*\)$/, '')).join(', ')}. They join a later Gate.`,
      });
    }
    blocks.push({
      type: 'form',
      title: 'Gate trials — one all-out set each, strict form, full rest between',
      tool: 'plugin_fitness_gate',
      button: 'Clear the Gate',
      fields: quest.gateTests.map((t) => ({ name: t, label: TEST_LABEL[t], kind: 'number', min: 0, max: 600, unit: t === 'pullups' || t === 'pushups' || t === 'dips' ? 'reps' : 's' })),
    });
  } else if (quest.done) {
    blocks.push({ type: 'text', tone: 'ok', text: T.questDone });
  } else {
    blocks.push({ type: 'actions', buttons: [{ label: 'Complete Quest', tool: 'plugin_fitness_complete', variant: 'primary' }] });
  }

  // ---- Skills ----
  blocks.push({ type: 'divider' });
  blocks.push({ type: 'heading', text: 'Skills' });
  for (const id of TRACKED_LADDERS) {
    const ladder = LADDERS[id];
    const at = state.levels[id];
    const next = ladder.levels[at + 1];
    blocks.push({
      type: 'progress',
      label: `${ladder.name}: ${exercise(ladder.levels[at]!).name}`,
      value: at + 1,
      max: ladder.levels.length,
      hint: next ? `next: ${exercise(next).name}` : 'mastered',
    });
  }
  if (!state.profile.equipment.tower) blocks.push({ type: 'text', tone: 'muted', text: T.noTower });

  // ---- History ----
  blocks.push({ type: 'divider' });
  blocks.push({ type: 'heading', text: 'History' });
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
    empty: 'No sets logged yet.',
  });
  blocks.push({
    type: 'list',
    items: [...state.events].reverse().slice(0, 8).map((e) => ({ title: e.text, subtitle: e.date, badge: e.kind.replace('_', ' ') })),
    empty: 'The System log is empty.',
  });

  // ---- Profile ----
  blocks.push({ type: 'divider' });
  blocks.push({ type: 'heading', text: 'Profile' });
  blocks.push(profileForm(state));
  blocks.push(painForm());
  return blocks;
}

function questIntro(type: string, deload: boolean, done: boolean): string {
  const lines: string[] = [];
  if (type === 'gate') lines.push(T.gateIntro);
  else if (type === 'training') lines.push(T.trainingIntro);
  else lines.push(T.recoveryIntro);
  if (deload && type === 'training') lines.push(T.deload);
  if (done) lines.push(T.questDoneShort);
  return lines.join('\n');
}

function profileForm(state: HunterState): Block {
  const p = state.profile;
  const last = [...state.body].reverse();
  const waist = last.find((b) => b.waistCm !== undefined)?.waistCm;
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
