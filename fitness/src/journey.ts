// The motivation layer: titles earned along the way, Treasure (real-world
// rewards the hunter sets for themselves), the journey map E→S, "then vs now"
// and the weekly report. Pure functions over the state, like rules.ts.

import { BY_ID, LADDERS } from './exercises.js';
import {
  addDays,
  addXp,
  countersOf,
  daysBetween,
  event,
  hunterLevel,
  ladderProgress,
  queuePush,
  rankChecklist,
  streakInfo,
  TEST_LABEL,
  weekday,
  weekPlan,
  XP,
} from './rules.js';
import { RANKS, type Counters, type GateTest, type HunterState, type Rank, type Treasure, type TreasureWhen } from './types.js';

// ---- titles ---------------------------------------------------------------------

interface Ctx {
  s: HunterState;
  streak: number;
  c: Counters;
}

export interface TitleDef {
  id: string;
  name: string;
  desc: string;
  /** [now, needed] */
  progress: (x: Ctx) => [number, number];
}

const rankAt = (r: Rank): number => RANKS.indexOf(r);
/** Full pull-ups: the pull ladder from the strict pull-up up. */
const PULLUPS = new Set(LADDERS.pull.levels.slice(LADDERS.pull.levels.indexOf('pullup')));

/** In the order a beginner meets them: early wins first, the long road after. */
export const TITLES: TitleDef[] = [
  { id: 'awakened', name: 'The Awakened', desc: 'Complete your first quest.', progress: (x) => [x.s.quests.length, 1] },
  { id: 'gatebreaker', name: 'Gatebreaker', desc: 'Clear your first Gate.', progress: (x) => [x.s.gates.length, 1] },
  { id: 'showed_up', name: 'Showed Up Anyway', desc: 'Finish a light day after poor sleep or heavy soreness.', progress: (x) => [x.c.lightDays, 1] },
  { id: 'the_return', name: 'The Return', desc: 'Come back after 3+ days away.', progress: (x) => [x.c.comebacks, 1] },
  { id: 'iron_will', name: 'Iron Will', desc: 'Keep a 7-day streak.', progress: (x) => [x.streak, 7] },
  {
    id: 'bar_breaker',
    name: 'Bar Breaker',
    desc: 'Your first strict pull-up.',
    progress: (x) => [(x.s.best.pullups ?? 0) >= 1 || x.s.logs.some((l) => PULLUPS.has(l.exercise) && l.sets.some((n) => n >= 1)) ? 1 : 0, 1],
  },
  { id: 'mender', name: 'Mender', desc: 'Complete 10 rehab side quests.', progress: (x) => [x.c.sideQuests, 10] },
  { id: 'wanderer', name: 'Wanderer', desc: 'Take 20 bonus walks.', progress: (x) => [x.c.walks, 20] },
  { id: 'disciplined', name: 'Disciplined', desc: 'Complete 25 quests.', progress: (x) => [x.s.quests.length, 25] },
  { id: 'skill_hunter', name: 'Skill Hunter', desc: 'Unlock 5 skills.', progress: (x) => [x.c.skills, 5] },
  { id: 'thousand', name: 'Thousand Reps', desc: 'Log 1,000 reps.', progress: (x) => [x.c.reps, 1000] },
  { id: 'rising', name: 'Rising', desc: 'Reach rank D.', progress: (x) => [rankAt(x.s.rank), rankAt('D')] },
  { id: 'unbroken', name: 'Unbroken', desc: 'Keep a 30-day streak.', progress: (x) => [x.streak, 30] },
  { id: 'veteran', name: 'Veteran', desc: 'Complete 100 quests.', progress: (x) => [x.s.quests.length, 100] },
  { id: 'ten_thousand', name: 'Ten Thousand', desc: 'Log 10,000 reps.', progress: (x) => [x.c.reps, 10000] },
  { id: 'elite', name: 'Elite', desc: 'Reach rank B.', progress: (x) => [rankAt(x.s.rank), rankAt('B')] },
  { id: 'relentless', name: 'Relentless', desc: 'Keep a 100-day streak.', progress: (x) => [x.streak, 100] },
  { id: 'apex', name: 'Apex', desc: 'Reach rank S.', progress: (x) => [rankAt(x.s.rank), rankAt('S')] },
];
const TITLE_BY_ID = new Map(TITLES.map((t) => [t.id, t]));

export const titleName = (id: string | undefined): string | null => (id ? TITLE_BY_ID.get(id)?.name ?? null : null);

const ctxOf = (s: HunterState, today: string): Ctx => ({ s, streak: streakInfo(s, today).days, c: countersOf(s) });

export interface TitleStatus {
  id: string;
  name: string;
  desc: string;
  earned: string | null;
  now: number;
  of: number;
}

export function titleStatus(state: HunterState, today: string): TitleStatus[] {
  const x = ctxOf(state, today);
  const earned = new Map((state.titles ?? []).map((t) => [t.id, t.date]));
  return TITLES.map((t) => {
    const [now, of] = t.progress(x);
    return { id: t.id, name: t.name, desc: t.desc, earned: earned.get(t.id) ?? null, now: Math.min(Math.max(0, now), of), of };
  });
}

export function chooseTitle(state: HunterState, id: string): string {
  const t = TITLES.find((d) => d.id === id || d.name.toLowerCase() === id.trim().toLowerCase());
  if (!t) throw new Error(`unknown title '${id}'`);
  if (!(state.titles ?? []).some((e) => e.id === t.id)) throw new Error(`'${t.name}' is not earned yet.`);
  state.activeTitle = t.id;
  state.titleChosen = true;
  return t.name;
}

// ---- treasure ----------------------------------------------------------------------

const MAX_OPEN_TREASURES = 12;
const MAX_TREASURES = 40;

export const TREASURE_WHEN: TreasureWhen[] = ['level', 'rank', 'streak', 'quests', 'title'];

/** Validate the target for a kind of treasure. */
function parseTarget(when: TreasureWhen, raw: unknown): number | string {
  const s = String(raw ?? '').trim();
  const int = (min: number, max: number, what: string): number => {
    const n = Number(s);
    if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${what} must be a whole number between ${min} and ${max}`);
    return n;
  };
  switch (when) {
    case 'level':
      return int(2, 200, 'level');
    case 'streak':
      return int(3, 1000, 'streak days');
    case 'quests':
      return int(1, 2000, 'quest count');
    case 'rank': {
      const r = s.toUpperCase().replace(/^RANK\s*/, '') as Rank;
      if (!RANKS.includes(r) || r === 'E') throw new Error('rank must be D, C, B, A or S');
      return r;
    }
    case 'title': {
      const t = TITLES.find((d) => d.id === s || d.name.toLowerCase() === s.toLowerCase());
      if (!t) throw new Error(`title must be one of: ${TITLES.map((d) => d.name).join(', ')}`);
      return t.id;
    }
  }
}

export function treasureGoal(t: Treasure): string {
  switch (t.when) {
    case 'level':
      return `Level ${t.target}`;
    case 'rank':
      return `Rank ${t.target}`;
    case 'streak':
      return `${t.target}-day streak`;
    case 'quests':
      return `${t.target} quests`;
    case 'title':
      return `Title: ${titleName(String(t.target)) ?? t.target}`;
  }
}

/** [now, needed] towards a treasure. */
function treasureProgressCtx(t: Treasure, x: Ctx): [number, number] {
  switch (t.when) {
    case 'level':
      return [hunterLevel(x.s.xp), Number(t.target)];
    case 'rank':
      return [rankAt(x.s.rank), rankAt(t.target as Rank)];
    case 'streak':
      return [x.streak, Number(t.target)];
    case 'quests':
      return [x.s.quests.length, Number(t.target)];
    case 'title':
      return [(x.s.titles ?? []).some((e) => e.id === t.target) ? 1 : 0, 1];
  }
}

export function treasureProgress(state: HunterState, t: Treasure, today: string): { now: number; of: number } {
  let [now, of] = treasureProgressCtx(t, ctxOf(state, today));
  // A rank treasure shows the way to the next rank too (display only: it unlocks at the Gate).
  if (t.when === 'rank' && now < of) {
    const check = rankChecklist(state);
    if (check?.items.length) now += Math.min(0.95, check.items.filter((i) => i.met).length / check.items.length);
    now = Math.round(now * 100) / 100;
  }
  return { now: Math.min(Math.max(0, now), of), of };
}

/** "12 / 30", "now rank E" or "not earned yet". */
export function treasureProgressText(state: HunterState, t: Treasure, p: { now: number; of: number }): string {
  if (t.when === 'rank') return `now rank ${state.rank}`;
  if (t.when === 'title') return p.now >= p.of ? 'earned' : 'not earned yet';
  return `${p.now} / ${p.of}`;
}

export function addTreasure(state: HunterState, today: string, name: string, when: TreasureWhen, raw: unknown): Treasure {
  const clean = name.trim().slice(0, 60);
  if (!clean) throw new Error('give the treasure a name, e.g. "New running shoes"');
  if (!TREASURE_WHEN.includes(when)) throw new Error(`when must be one of: ${TREASURE_WHEN.join(', ')}`);
  const list = (state.treasures ??= []);
  if (list.filter((t) => !t.claimedAt).length >= MAX_OPEN_TREASURES) throw new Error(`At most ${MAX_OPEN_TREASURES} open treasures. Claim or remove one first.`);
  const id = state.nextTreasureId ?? 1;
  state.nextTreasureId = id + 1;
  const t: Treasure = { id, name: clean, when, target: parseTarget(when, raw), createdAt: today };
  list.push(t);
  if (list.length > MAX_TREASURES) {
    const old = list.findIndex((x) => x.claimedAt);
    if (old >= 0) list.splice(old, 1);
  }
  return t;
}

function findTreasure(state: HunterState, id: number): Treasure {
  const t = (state.treasures ?? []).find((x) => x.id === id);
  if (!t) throw new Error(`no treasure #${id}`);
  return t;
}

export function claimTreasure(state: HunterState, today: string, id: number): Treasure {
  const t = findTreasure(state, id);
  if (!t.unlockedAt) throw new Error(`'${t.name}' is still locked: ${treasureGoal(t)} first.`);
  if (!t.claimedAt) {
    t.claimedAt = today;
    event(state, today, 'treasure', `Treasure claimed: ${t.name}. Enjoy it, you earned it.`);
  }
  return t;
}

export function removeTreasure(state: HunterState, id: number): Treasure {
  const t = findTreasure(state, id);
  state.treasures = (state.treasures ?? []).filter((x) => x.id !== id);
  return t;
}

// ---- reward check (after anything that can change progress) ------------------------------

/** Earn new titles and unlock treasures; returns what happened now. */
export function checkRewards(state: HunterState, today: string): { titles: string[]; treasures: Treasure[] } {
  const out: { titles: string[]; treasures: Treasure[] } = { titles: [], treasures: [] };
  let x = ctxOf(state, today);
  const have = new Set((state.titles ?? []).map((t) => t.id));
  for (const t of TITLES) {
    if (have.has(t.id)) continue;
    const [now, of] = t.progress(x);
    if (now < of) continue;
    (state.titles ??= []).push({ id: t.id, date: today });
    have.add(t.id);
    out.titles.push(t.name);
    event(state, today, 'title', `Title earned: ${t.name}. ${t.desc} (+${XP.title} XP)`);
    addXp(state, today, XP.title);
    if (!state.titleChosen) state.activeTitle = t.id;
  }
  if (out.titles.length) x = ctxOf(state, today);
  for (const t of state.treasures ?? []) {
    if (t.unlockedAt) continue;
    const [now, of] = treasureProgressCtx(t, x);
    if (now < of) continue;
    t.unlockedAt = today;
    out.treasures.push(t);
    event(state, today, 'treasure', `Treasure unlocked: ${t.name} (${treasureGoal(t)}). Go get it in the real world.`);
    queuePush(state, {
      title: '[SYSTEM] Treasure unlocked',
      body: `${t.name}: you reached ${treasureGoal(t)}. You earned it. Go get it.`,
      actions: [{ label: 'Claimed', tool: 'plugin_fitness_treasure', args: { action: 'claim', id: t.id } }],
    });
  }
  return out;
}

// ---- next goals (what is closest) ------------------------------------------------------------

/** The nearest skill, title and treasure: what to chase next. */
export function nextGoals(state: HunterState, today: string): string[] {
  const goals: string[] = [];
  const skill = ladderProgress(state)
    .filter((p) => p.next && !p.held)
    .sort((a, b) => b.top - a.top || a.level / a.of - b.level / b.of)[0];
  if (skill) goals.push(`Skill: ${skill.next} (${skill.top}/2 sessions at the top of ${skill.current})`);
  const title = titleStatus(state, today)
    .filter((t) => !t.earned)
    .sort((a, b) => b.now / b.of - a.now / a.of)[0];
  if (title) goals.push(`Title: ${title.name}. ${title.desc} (${title.now}/${title.of})`);
  const open = (state.treasures ?? []).filter((t) => !t.unlockedAt);
  const treasure = open
    .map((t) => ({ t, p: treasureProgress(state, t, today) }))
    .sort((a, b) => b.p.now / b.p.of - a.p.now / a.p.of)[0];
  if (treasure) goals.push(`Treasure: ${treasure.t.name} at ${treasureGoal(treasure.t)} (${treasureProgressText(state, treasure.t, treasure.p)})`);
  return goals;
}

// ---- journey map ----------------------------------------------------------------------------

const RANK_WORD: Record<Rank, string> = { E: 'Novice', D: 'Solid base', C: 'Strong', B: 'Advanced', A: 'Elite', S: 'Apex' };
const C = { line: '#1e3a5f', glow: '#4fd8ff', dark: '#0d1a33', dim: '#5a7aa6', gold: '#ffcf5c', text: '#cfe9ff' };

/** E→S as a path of six nodes; the marker sits between the current rank and the next by checklist progress. */
export function journeyMapSvg(state: HunterState, today: string): string {
  // Narrow on purpose: it is drawn at the card's width, so on a phone the text stays readable.
  const W = 360;
  const H = 150;
  const y = 86;
  const step = 60;
  const x = (i: number): number => 30 + i * step;
  const at = rankAt(state.rank);
  const check = rankChecklist(state);
  const frac = check && check.items.length ? check.items.filter((i) => i.met).length / check.items.length : 0;
  const pos = at >= RANKS.length - 1 ? x(at) : x(at) + frac * step;
  const mx = pos;
  // Keep the label inside the picture near either end.
  const anchor = mx < 70 ? 'start' : mx > W - 70 ? 'end' : 'middle';
  const lx = anchor === 'start' ? Math.max(4, mx - 14) : anchor === 'end' ? Math.min(W - 4, mx + 14) : mx;
  const level = hunterLevel(state.xp);
  const day = daysBetween(state.startDate, today) + 1;
  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="sans-serif">`,
    `<defs><linearGradient id="jg" x1="0" x2="1" y1="0" y2="0"><stop offset="0" stop-color="#2b7fff"/><stop offset="1" stop-color="${C.glow}"/></linearGradient></defs>`,
    `<line x1="${x(0)}" y1="${y}" x2="${x(5)}" y2="${y}" stroke="${C.line}" stroke-width="4" stroke-linecap="round"/>`,
    `<line x1="${x(0)}" y1="${y}" x2="${pos.toFixed(1)}" y2="${y}" stroke="${C.glow}" stroke-opacity="0.25" stroke-width="12" stroke-linecap="round"/>`,
    `<line x1="${x(0)}" y1="${y}" x2="${pos.toFixed(1)}" y2="${y}" stroke="url(#jg)" stroke-width="4" stroke-linecap="round"/>`,
  ];
  RANKS.forEach((r, i) => {
    const cx = x(i);
    if (i === at) {
      parts.push(
        `<circle cx="${cx}" cy="${y}" r="18" fill="none" stroke="${C.glow}" stroke-width="2"><animate attributeName="r" values="18;26;18" dur="2.4s" repeatCount="indefinite"/><animate attributeName="stroke-opacity" values="0.8;0;0.8" dur="2.4s" repeatCount="indefinite"/></circle>`,
        `<circle cx="${cx}" cy="${y}" r="17" fill="${C.dark}" stroke="${C.glow}" stroke-width="3"/>`,
        `<text x="${cx}" y="${y + 6}" text-anchor="middle" font-size="17" font-weight="700" fill="${C.glow}">${r}</text>`,
      );
    } else if (i < at) {
      parts.push(
        `<circle cx="${cx}" cy="${y}" r="15" fill="${C.glow}"/>`,
        `<text x="${cx}" y="${y + 5}" text-anchor="middle" font-size="15" font-weight="700" fill="${C.dark}">${r}</text>`,
      );
    } else {
      parts.push(
        `<circle cx="${cx}" cy="${y}" r="15" fill="${C.dark}" stroke="${C.dim}" stroke-width="2"/>`,
        `<text x="${cx}" y="${y + 5}" text-anchor="middle" font-size="15" font-weight="700" fill="${C.dim}">${r}</text>`,
      );
    }
    parts.push(`<text x="${cx}" y="${y + 40}" text-anchor="middle" font-size="11" fill="${i <= at ? C.text : C.dim}">${RANK_WORD[r]}</text>`);
  });
  // The hunter marker: a gold arrow above the path where they stand.
  parts.push(
    `<path d="M${(mx - 7).toFixed(1)} ${y - 32} L${(mx + 7).toFixed(1)} ${y - 32} L${mx.toFixed(1)} ${y - 22} Z" fill="${C.gold}"/>`,
    `<text x="${lx.toFixed(1)}" y="${y - 40}" text-anchor="${anchor}" font-size="13" font-weight="700" fill="${C.gold}">YOU · Lv ${level} · Day ${day}</text>`,
  );
  parts.push('</svg>');
  return parts.join('');
}

// ---- then vs now --------------------------------------------------------------------------------

const SHORT: Record<GateTest, string> = {
  pullups: 'Pull-ups',
  pushups: 'Push-ups',
  dips: 'Dips',
  dead_hang: 'Dead hang (s)',
  hollow_hold: 'Hollow hold (s)',
  l_sit: 'L-sit (s)',
};

/** Rows of [what, day 1, now] once the hunter has a first Gate. */
export function thenVsNow(state: HunterState): string[][] {
  const rows: string[][] = [
    ['Level', '1', String(hunterLevel(state.xp))],
    ['Rank', 'E', state.rank],
  ];
  const first = state.gates[0]?.results ?? {};
  for (const t of Object.keys(TEST_LABEL) as GateTest[]) {
    const then = first[t];
    const now = state.best[t];
    if (then !== undefined && now !== undefined) rows.push([SHORT[t], String(then), String(now)]);
  }
  const weights = state.body.filter((b) => b.weightKg !== undefined);
  if (weights.length >= 2) rows.push(['Weight (kg)', String(weights[0]!.weightKg), String(weights.at(-1)!.weightKg)]);
  const c = countersOf(state);
  rows.push(['Skills unlocked', '0', String(c.skills)], ['Quests done', '0', String(state.quests.length)]);
  return rows;
}

// ---- weekly report ------------------------------------------------------------------------------

const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Sunday-evening summary of the week (Mon–Sun) and a look at the next one. */
export function weeklyReport(state: HunterState, today: string): { title: string; body: string } {
  const monday = addDays(today, -((weekday(today) + 6) % 7));
  const inWeek = <T extends { date: string }>(xs: T[]): T[] => xs.filter((x) => x.date >= monday && x.date <= today);
  const quests = inWeek(state.quests);
  const trainings = quests.filter((q) => q.type !== 'recovery').length;
  const planned = weekPlan(state, today).filter((d) => d.status !== 'before' && /Training|Gate/.test(d.label)).length;
  const recovery = quests.filter((q) => q.type === 'recovery').length;
  const reps = inWeek(state.logs)
    .filter((l) => BY_ID.get(l.exercise)?.kind === 'reps')
    .reduce((n, l) => n + l.sets.reduce((a, b) => a + b, 0), 0);
  const unlocked = inWeek(state.events).filter((e) => e.kind === 'skill_unlocked').map((e) => e.text.replace(/^Skill unlocked: ([^.]+)\..*$/, '$1'));
  const st = streakInfo(state, today);
  const next = weekPlan(state, addDays(today, 1))
    .filter((d) => /Training|Gate/.test(d.label))
    .map((d) => `${DAY[weekday(d.date)]} ${d.label}`)
    .join(', ');
  const lastWeight = [...state.body].reverse().find((b) => b.weightKg !== undefined);
  const weighIn = !lastWeight || daysBetween(lastWeight.date, today) >= 7;
  const lines = [
    `Trainings ${trainings}/${Math.max(planned, trainings)} · recovery ${recovery} · ${reps} reps · streak ${st.days}${st.shields ? ` (shield ${st.shields})` : ''}.`,
    unlocked.length ? `Unlocked: ${unlocked.join(', ')}.` : '',
    next ? `Next week: ${next}.` : '',
    weighIn ? 'Weekly weigh-in: step on the scale and log it in the profile.' : '',
  ].filter(Boolean);
  return { title: '[SYSTEM] Weekly report', body: lines.join(' ') };
}
