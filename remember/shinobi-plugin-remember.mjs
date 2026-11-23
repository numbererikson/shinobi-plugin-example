// shinobi-plugin-remember — personal memory + reminders, from any Claude chat.
//
// "Remember that the Wi-Fi password is XY123" / "what's the Wi-Fi password?"
// "Remind me tomorrow at 9 to call the bank" / "every Monday at 9 …"
//
// Install: drop this single file into the Shinobi plugins directory
// (~/.shinobi/plugins/, or /data/plugins in the Docker image) and restart.
// Needs Shinobi >= 0.7.0 for reminders (registry.schedule + registry.notify);
// memory works on older hosts too. Zero runtime dependencies.
//
// Reminders fire from the dashboard process every minute as a push
// notification (Done / Snooze 1h) — no chat needs to be open. Tapping the
// notification opens the plugin page, which has the same buttons (iOS does not
// show buttons on web notifications).
//
// Memory values are encrypted at rest (AES-256-GCM). The key is NOT stored in
// the database, so `shinobi sync` never ships readable secrets:
//   SHINOBI_REMEMBER_KEY        64 hex chars; wins when set
//   SHINOBI_REMEMBER_KEY_FILE   key file path (default: <config dir>/remember.key,
//                               i.e. /data/remember.key in Docker), created on
//                               first use with mode 0600. Back it up: without it
//                               stored values cannot be read.

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export const DEFAULT_TIMEZONE = 'Europe/Zagreb';
const PAGE_URL = '/apps/remember';
const MAX_KEY = 200;
const MAX_VALUE = 4000;
const MAX_TEXT = 500;
const MAX_CATEGORY = 50;
const KEEP_FINISHED_DAYS = 30;

/** Overridable clock — tests move time; the plugin never calls Date.now() directly. */
export const clock = { now: () => new Date() };

// ---- time zones ---------------------------------------------------------------

const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const formatters = new Map();

function partsIn(date, timeZone) {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      weekday: 'short',
    });
    formatters.set(timeZone, f);
  }
  const o = {};
  for (const p of f.formatToParts(date)) o[p.type] = p.value;
  return {
    year: Number(o.year),
    month: Number(o.month),
    day: Number(o.day),
    hour: Number(o.hour),
    minute: Number(o.minute),
    second: Number(o.second),
    weekday: WEEKDAY_SHORT.indexOf(o.weekday),
  };
}

function offsetMs(ms, timeZone) {
  const p = partsIn(new Date(ms), timeZone);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000;
}

/** The instant at which the wall clock in `timeZone` shows the given local time. */
export function zonedToUtc(year, month, day, hour, minute, timeZone) {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  let t = guess - offsetMs(guess, timeZone);
  const second = offsetMs(t, timeZone);
  if (second !== guess - t) t = guess - second;
  return new Date(t);
}

export function assertTimeZone(timeZone) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
  } catch {
    throw new Error(`unknown time zone '${timeZone}' (use an IANA name such as 'Europe/Zagreb')`);
  }
}

/**
 * Parse `at`: local wall-clock time 'YYYY-MM-DD HH:MM' (or 'T' separator,
 * optional seconds) in `timeZone`, or ISO 8601 with Z / an offset.
 */
export function parseWhen(input, timeZone) {
  if (typeof input !== 'string') throw new Error("'at' must be a string like '2026-11-22 09:00'");
  const s = input.trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (m) {
    const [, y, mo, d, h, mi] = m.map(Number);
    if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) throw new Error(`invalid date/time '${input}'`);
    return zonedToUtc(y, mo, d, h, mi, timeZone);
  }
  if (/(Z|[+-]\d{2}:?\d{2})$/.test(s)) {
    const date = new Date(s);
    if (!Number.isNaN(date.getTime())) return date;
  }
  throw new Error(`'at' must be local time 'YYYY-MM-DD HH:MM' or ISO 8601 with an offset, got '${input}'`);
}

/** Human local time, e.g. "Sun 22.11. 09:00". */
export function formatLocal(date, timeZone) {
  const p = partsIn(date, timeZone);
  const hh = String(p.hour).padStart(2, '0');
  const mm = String(p.minute).padStart(2, '0');
  return `${WEEKDAY_SHORT[p.weekday]} ${p.day}.${p.month}. ${hh}:${mm}`;
}

/** Machine local time, e.g. "2026-11-22 09:00". */
export function isoLocal(date, timeZone) {
  const p = partsIn(date, timeZone);
  const pad = (n) => String(n).padStart(2, '0');
  return `${p.year}-${pad(p.month)}-${pad(p.day)} ${pad(p.hour)}:${pad(p.minute)}`;
}

// ---- recurrence ---------------------------------------------------------------

const DAY_NAMES = {
  sun: 0, sunday: 0, mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2, wed: 3, wednesday: 3,
  thu: 4, thur: 4, thurs: 4, thursday: 4, fri: 5, friday: 5, sat: 6, saturday: 6,
};

/**
 * null | 'daily' | 'weekdays' | 'weekly:<days>' | 'monthly:<day>'.
 * Weekly days accept names ('monday', 'mon') or numbers (0 or 7 = Sunday).
 */
export function normalizeRecurrence(raw) {
  if (raw === undefined || raw === null || raw === '') return null;
  const s = String(raw).trim().toLowerCase();
  if (s === 'daily' || s === 'weekdays') return s;
  const weekly = s.match(/^weekly:(.+)$/);
  if (weekly) {
    const days = weekly[1].split(',').map((t) => {
      const v = t.trim();
      const n = /^\d$/.test(v) ? Number(v) % 7 : DAY_NAMES[v];
      if (n === undefined || Number.isNaN(n)) throw new Error(`unknown weekday '${v}' in recurrence '${raw}'`);
      return n;
    });
    return `weekly:${[...new Set(days)].sort((a, b) => a - b).join(',')}`;
  }
  const monthly = s.match(/^monthly:(\d{1,2})$/);
  if (monthly && Number(monthly[1]) >= 1 && Number(monthly[1]) <= 31) return `monthly:${Number(monthly[1])}`;
  throw new Error(`recurrence must be daily, weekdays, weekly:<days> (e.g. weekly:monday,thursday) or monthly:<1-31>, got '${raw}'`);
}

export function describeRecurrence(rec) {
  if (!rec) return 'once';
  if (rec === 'daily' || rec === 'weekdays') return rec;
  if (rec.startsWith('weekly:')) return `weekly on ${rec.slice(7).split(',').map((d) => WEEKDAY_SHORT[Number(d)]).join(', ')}`;
  return `monthly on day ${rec.slice(8)}`;
}

function matchesRule(rec, year, month, day, weekday) {
  if (rec === 'daily') return true;
  if (rec === 'weekdays') return weekday >= 1 && weekday <= 5;
  if (rec.startsWith('weekly:')) return rec.slice(7).split(',').map(Number).includes(weekday);
  const target = Number(rec.slice(8));
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day === Math.min(target, daysInMonth);
}

/** The first occurrence after `prev` (same local time of day) that is later than `after`. */
export function nextOccurrence(rec, prev, timeZone, after) {
  const p = partsIn(prev, timeZone);
  for (let i = 1; i <= 800; i++) {
    const base = new Date(Date.UTC(p.year, p.month - 1, p.day + i));
    const y = base.getUTCFullYear();
    const mo = base.getUTCMonth() + 1;
    const d = base.getUTCDate();
    if (!matchesRule(rec, y, mo, d, base.getUTCDay())) continue;
    const candidate = zonedToUtc(y, mo, d, p.hour, p.minute, timeZone);
    if (candidate > after) return candidate;
  }
  throw new Error(`no occurrence of '${rec}' found`);
}

// ---- encryption ---------------------------------------------------------------

let cachedKey = null;

export function keyFilePath(env = process.env) {
  return env.SHINOBI_REMEMBER_KEY_FILE || join(env.SHINOBI_CONFIG_DIR || join(homedir(), '.shinobi'), 'remember.key');
}

/** Short, non-secret id of the current key, so a backup acknowledgement is tied to that key. */
export function keyFingerprint() {
  return createHash('sha256').update(loadKey().key).digest('hex').slice(0, 12);
}

/** Load (or on first use create) the 32-byte key. */
export function loadKey(env = process.env) {
  if (cachedKey) return cachedKey;
  const fromEnv = env.SHINOBI_REMEMBER_KEY;
  if (fromEnv) {
    if (!/^[0-9a-f]{64}$/i.test(fromEnv.trim())) throw new Error('SHINOBI_REMEMBER_KEY must be 64 hex characters');
    cachedKey = { key: Buffer.from(fromEnv.trim(), 'hex'), source: 'env' };
    return cachedKey;
  }
  const path = keyFilePath(env);
  if (!existsSync(path)) {
    mkdirSync(dirname(path), { recursive: true });
    try {
      writeFileSync(path, `${randomBytes(32).toString('hex')}\n`, { mode: 0o600, flag: 'wx' });
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
    }
  }
  const hex = readFileSync(path, 'utf8').trim();
  if (!/^[0-9a-f]{64}$/i.test(hex)) throw new Error(`key file ${path} is not 64 hex characters`);
  cachedKey = { key: Buffer.from(hex, 'hex'), source: path };
  return cachedKey;
}

export function resetKeyCache() {
  cachedKey = null;
}

export function encrypt(plaintext) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', loadKey().key, iv);
  const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return `v1:${Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64')}`;
}

export function decrypt(stored) {
  if (!stored.startsWith('v1:')) throw new Error('unknown value format');
  const buf = Buffer.from(stored.slice(3), 'base64');
  try {
    const decipher = createDecipheriv('aes-256-gcm', loadKey().key, buf.subarray(0, 12));
    decipher.setAuthTag(buf.subarray(12, 28));
    return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString('utf8');
  } catch {
    throw new Error('cannot decrypt — is this the remember.key the value was saved with?');
  }
}

// ---- helpers ------------------------------------------------------------------

/** Lowercase, no diacritics (č→c, đ→d), single spaces — for keys and search. */
export function fold(s) {
  return String(s)
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function requireText(value, field, max) {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`'${field}' must be a non-empty string`);
  if (value.length > max) throw new Error(`'${field}' is longer than ${max} characters`);
  return value.trim();
}

function emptyReminders() {
  return { next_id: 1, items: [] };
}

// ---- plugin -------------------------------------------------------------------

export default function register(registry) {
  const state = registry.state;

  const timeZone = () => state.get('settings')?.timezone ?? DEFAULT_TIMEZONE;
  const memories = () => state.get('memories') ?? {};
  const reminders = () => state.get('reminders') ?? emptyReminders();
  // A key from SHINOBI_REMEMBER_KEY lives in the env file the owner already manages.
  const keyBackedUp = () => loadKey().source === 'env' || state.get('settings')?.key_backup?.fingerprint === keyFingerprint();

  const view = (r, tz) => ({
    id: r.id,
    text: r.text,
    due: isoLocal(new Date(r.due_at), tz),
    due_label: formatLocal(new Date(r.due_at), tz),
    repeats: describeRecurrence(r.recurrence),
    status: r.status,
    snoozed: r.snooze_count,
  });

  const findReminder = (s, id) => {
    const r = s.items.find((x) => x.id === Number(id));
    if (!r) throw new Error(`no reminder #${id}`);
    return r;
  };

  // ---- memory ----

  registry.registerTool({
    name: 'plugin_remember_save',
    description:
      'Remember a personal fact for the owner ("remember that the Wi-Fi password is XY123", "I parked on level -2"). ' +
      'Saving an existing key replaces its value. Values are encrypted at rest. Use a short descriptive key (e.g. "wifi password office").',
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Short name of the fact, e.g. "wifi password office".' },
        value: { type: 'string', description: 'The fact itself.' },
        category: { type: 'string', description: 'Optional grouping: general, passwords, contacts, parking, notes …' },
        expires_at: { type: 'string', description: "Optional local time 'YYYY-MM-DD HH:MM' after which it is forgotten (e.g. a parking spot)." },
      },
      required: ['key', 'value'],
      additionalProperties: false,
    },
    handler: (args) => {
      const key = requireText(args.key, 'key', MAX_KEY);
      const value = requireText(args.value, 'value', MAX_VALUE);
      const category = args.category === undefined ? 'general' : fold(requireText(args.category, 'category', MAX_CATEGORY));
      const expiresAt = args.expires_at === undefined ? null : parseWhen(args.expires_at, timeZone()).toISOString();
      const now = clock.now().toISOString();
      const stored = encrypt(value);
      let replaced = false;
      state.update('memories', (cur) => {
        const all = cur ?? {};
        const id = fold(key);
        replaced = Boolean(all[id]);
        all[id] = { key, category, value: stored, created_at: all[id]?.created_at ?? now, updated_at: now, expires_at: expiresAt };
        return all;
      });
      return { saved: key, category, replaced };
    },
  });

  registry.registerTool({
    name: 'plugin_remember_recall',
    description:
      'Look up remembered facts. With a query, returns facts whose key, category or value contains every word of it ' +
      '(case- and accent-insensitive). Without a query, lists everything.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Words to look for, e.g. "wifi".' },
        category: { type: 'string', description: 'Only this category.' },
      },
      additionalProperties: false,
    },
    handler: (args) => {
      const words = args.query ? fold(args.query).split(' ').filter(Boolean) : [];
      const category = args.category ? fold(args.category) : null;
      const now = clock.now();
      const found = [];
      for (const m of Object.values(memories())) {
        if (m.expires_at && new Date(m.expires_at) <= now) continue;
        if (category && m.category !== category) continue;
        let value = null;
        let error = null;
        try {
          value = decrypt(m.value);
        } catch (err) {
          error = err.message;
        }
        const hay = fold(`${m.key} ${m.category} ${value ?? ''}`);
        if (words.every((w) => hay.includes(w))) {
          found.push({ key: m.key, category: m.category, value, updated: isoLocal(new Date(m.updated_at), timeZone()), ...(error ? { error } : {}) });
        }
      }
      found.sort((a, b) => a.key.localeCompare(b.key));
      return { count: found.length, memories: found };
    },
  });

  registry.registerTool({
    name: 'plugin_remember_forget',
    description: 'Permanently forget a remembered fact by its key.',
    inputSchema: {
      type: 'object',
      properties: { key: { type: 'string' } },
      required: ['key'],
      additionalProperties: false,
    },
    handler: (args) => {
      const id = fold(requireText(args.key, 'key', MAX_KEY));
      let removed = null;
      state.update('memories', (cur) => {
        const all = cur ?? {};
        removed = all[id]?.key ?? null;
        delete all[id];
        return all;
      });
      if (!removed) throw new Error(`nothing remembered under '${args.key}'`);
      return { forgotten: removed };
    },
  });

  // ---- reminders ----

  registry.registerTool({
    name: 'plugin_remember_remind',
    description:
      'Set a reminder; it arrives as a push notification on the phone. `at` is LOCAL wall-clock time in the plugin time zone ' +
      "(see plugin_remember_reminders → now), format 'YYYY-MM-DD HH:MM'. Resolve phrases like \"tomorrow at 9\" yourself. " +
      'For repeating reminders `at` is the first occurrence and `recurrence` is daily, weekdays, weekly:<days> ' +
      '(e.g. weekly:monday,thursday) or monthly:<1-31>.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'What to remind about, e.g. "Call the bank".' },
        at: { type: 'string', description: "Local time 'YYYY-MM-DD HH:MM'." },
        recurrence: { type: 'string', description: 'Optional: daily | weekdays | weekly:<days> | monthly:<day>.' },
      },
      required: ['text', 'at'],
      additionalProperties: false,
    },
    handler: (args) => {
      const text = requireText(args.text, 'text', MAX_TEXT);
      const tz = timeZone();
      const recurrence = normalizeRecurrence(args.recurrence);
      const now = clock.now();
      let due = parseWhen(args.at, tz);
      if (due <= now) {
        if (!recurrence) throw new Error(`'${args.at}' is in the past (now is ${isoLocal(now, tz)} ${tz})`);
        due = nextOccurrence(recurrence, due, tz, now);
      }
      let created = null;
      state.update('reminders', (cur) => {
        const s = cur ?? emptyReminders();
        created = {
          id: s.next_id++,
          text,
          due_at: due.toISOString(),
          recurrence,
          status: 'pending',
          snooze_count: 0,
          created_at: now.toISOString(),
          last_fired_at: null,
          parent_id: null,
        };
        s.items.push(created);
        return s;
      });
      return { reminder: view(created, tz), time_zone: tz };
    },
  });

  registry.registerTool({
    name: 'plugin_remember_reminders',
    description:
      'List reminders: "due" (fired, waiting for Done) and "pending" (upcoming), soonest first. ' +
      'Also returns the current local time and time zone — use them to resolve relative times.',
    inputSchema: {
      type: 'object',
      properties: { include_finished: { type: 'boolean', description: 'Also list done and cancelled ones (last 30 days).' } },
      additionalProperties: false,
    },
    handler: (args) => {
      const tz = timeZone();
      const order = { due: 0, pending: 1, done: 2, cancelled: 3 };
      const items = reminders()
        .items.filter((r) => args.include_finished === true || r.status === 'due' || r.status === 'pending')
        .sort((a, b) => order[a.status] - order[b.status] || a.due_at.localeCompare(b.due_at))
        .map((r) => view(r, tz));
      return { now: isoLocal(clock.now(), tz), time_zone: tz, count: items.length, reminders: items };
    },
  });

  registry.registerTool({
    name: 'plugin_remember_done',
    description:
      'Mark a reminder done. A one-time reminder is finished. For a repeating one this skips its next occurrence ' +
      '(use plugin_remember_cancel to stop it for good).',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'integer' },
        occurrence: { type: 'string', description: 'Set by notification buttons: the occurrence that fired.' },
      },
      required: ['id'],
      additionalProperties: false,
    },
    handler: (args) => {
      const tz = timeZone();
      const now = clock.now();
      let result = null;
      state.update('reminders', (cur) => {
        const s = cur ?? emptyReminders();
        const r = findReminder(s, args.id);
        if (r.status === 'done' || r.status === 'cancelled') {
          result = { id: r.id, status: r.status, note: `already ${r.status}` };
        } else if (!r.recurrence) {
          r.status = 'done';
          result = { id: r.id, status: 'done' };
        } else if (args.occurrence && args.occurrence !== r.due_at) {
          // The notification's occurrence already rolled over to the next one.
          result = { id: r.id, status: r.status, acknowledged: true, next: isoLocal(new Date(r.due_at), tz) };
        } else {
          r.due_at = nextOccurrence(r.recurrence, new Date(r.due_at), tz, now).toISOString();
          result = { id: r.id, status: r.status, skipped_to: isoLocal(new Date(r.due_at), tz) };
        }
        return s;
      });
      return result;
    },
  });

  registry.registerTool({
    name: 'plugin_remember_snooze',
    description: 'Snooze a reminder for N minutes (default 60). For a repeating one this adds a one-time copy; the series is unchanged.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'integer' }, minutes: { type: 'integer', minimum: 1, maximum: 10080 } },
      required: ['id'],
      additionalProperties: false,
    },
    handler: (args) => {
      const minutes = args.minutes === undefined ? 60 : Number(args.minutes);
      if (!Number.isInteger(minutes) || minutes < 1 || minutes > 10080) throw new Error('minutes must be 1-10080');
      const tz = timeZone();
      const now = clock.now();
      const due = new Date(now.getTime() + minutes * 60_000).toISOString();
      let result = null;
      state.update('reminders', (cur) => {
        const s = cur ?? emptyReminders();
        const r = findReminder(s, args.id);
        if (r.status === 'done' || r.status === 'cancelled') {
          result = { id: r.id, status: r.status, note: `already ${r.status}` };
        } else if (r.recurrence) {
          const copy = { ...r, id: s.next_id++, recurrence: null, due_at: due, status: 'pending', snooze_count: 1, created_at: now.toISOString(), last_fired_at: null, parent_id: r.id };
          s.items.push(copy);
          result = { id: copy.id, status: 'pending', due: isoLocal(new Date(due), tz), copy_of: r.id };
        } else {
          r.due_at = due;
          r.status = 'pending';
          r.snooze_count += 1;
          result = { id: r.id, status: 'pending', due: isoLocal(new Date(due), tz) };
        }
        return s;
      });
      return result;
    },
  });

  registry.registerTool({
    name: 'plugin_remember_cancel',
    description: 'Cancel a reminder. For a repeating one this stops the whole series.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'integer' } },
      required: ['id'],
      additionalProperties: false,
    },
    handler: (args) => {
      let result = null;
      state.update('reminders', (cur) => {
        const s = cur ?? emptyReminders();
        const r = findReminder(s, args.id);
        if (r.status !== 'done') r.status = 'cancelled';
        result = { id: r.id, status: r.status };
        return s;
      });
      return result;
    },
  });

  // ---- settings + import ----

  registry.registerTool({
    name: 'plugin_remember_settings',
    description:
      'Show or change settings: the time zone reminders use (IANA name, default Europe/Zagreb) and where the encryption key lives. ' +
      'Set key_backed_up: true once the user confirms the key file is copied somewhere safe.',
    inputSchema: {
      type: 'object',
      properties: {
        timezone: { type: 'string', description: "IANA zone, e.g. 'Europe/Zagreb'." },
        key_backed_up: { type: 'boolean', description: 'The user has copied the encryption key off this machine.' },
      },
      additionalProperties: false,
    },
    handler: (args) => {
      if (args.timezone !== undefined) {
        assertTimeZone(args.timezone);
        state.update('settings', (cur) => ({ ...(cur ?? {}), timezone: args.timezone }));
      }
      if (args.key_backed_up !== undefined) {
        const ack = args.key_backed_up === true ? { fingerprint: keyFingerprint(), at: clock.now().toISOString() } : null;
        state.update('settings', (cur) => ({ ...(cur ?? {}), key_backup: ack }));
      }
      const tz = timeZone();
      const s = reminders();
      return {
        time_zone: tz,
        now: isoLocal(clock.now(), tz),
        encryption_key: loadKey().source === 'env' ? 'SHINOBI_REMEMBER_KEY' : loadKey().source,
        key_backed_up: keyBackedUp(),
        memories: Object.keys(memories()).length,
        reminders_open: s.items.filter((r) => r.status === 'pending' || r.status === 'due').length,
      };
    },
  });

  registry.registerTool({
    name: 'plugin_remember_import',
    description:
      'Import a LIMAlife backup (the JSON from /limalife/admin/backup/export): memories plus open reminders. ' +
      'Times in it are local time in the plugin time zone. Existing memory keys are kept unless overwrite is true.',
    inputSchema: {
      type: 'object',
      properties: {
        backup: { type: 'object', description: 'The parsed backup JSON ({ memories: [...], reminders: [...] }).' },
        overwrite: { type: 'boolean' },
      },
      required: ['backup'],
      additionalProperties: false,
    },
    handler: (args) => {
      const backup = args.backup ?? {};
      const tz = timeZone();
      const now = clock.now();
      const report = { memories_imported: 0, memories_skipped: [], reminders_imported: 0, reminders_skipped: [] };

      state.update('memories', (cur) => {
        const all = cur ?? {};
        for (const m of Array.isArray(backup.memories) ? backup.memories : []) {
          const key = typeof m?.key_name === 'string' ? m.key_name.trim() : '';
          if (!key || typeof m.value !== 'string' || m.value === '') {
            report.memories_skipped.push({ key: key || null, reason: 'missing key or value' });
            continue;
          }
          const expires = m.expires_at ? parseWhen(String(m.expires_at).slice(0, 16), tz) : null;
          if (expires && expires <= now) {
            report.memories_skipped.push({ key, reason: 'expired' });
            continue;
          }
          const id = fold(key);
          if (all[id] && args.overwrite !== true) {
            report.memories_skipped.push({ key, reason: 'already remembered' });
            continue;
          }
          const created = m.created_at ? parseWhen(String(m.created_at).slice(0, 16), tz).toISOString() : now.toISOString();
          all[id] = {
            key: key.slice(0, MAX_KEY),
            category: fold(m.category || 'general').slice(0, MAX_CATEGORY),
            value: encrypt(m.value.slice(0, MAX_VALUE)),
            created_at: created,
            updated_at: now.toISOString(),
            expires_at: expires ? expires.toISOString() : null,
          };
          report.memories_imported++;
        }
        return all;
      });

      state.update('reminders', (cur) => {
        const s = cur ?? emptyReminders();
        for (const r of Array.isArray(backup.reminders) ? backup.reminders : []) {
          const text = typeof r?.message === 'string' ? r.message.trim().slice(0, MAX_TEXT) : '';
          if (!text) continue;
          if (r.status !== 'pending' && r.status !== 'snoozed') {
            report.reminders_skipped.push({ text, reason: `status ${r.status}` });
            continue;
          }
          let recurrence;
          let due;
          try {
            recurrence = normalizeRecurrence(r.recurrence);
            due = parseWhen(String(r.remind_at).slice(0, 16), tz);
          } catch (err) {
            report.reminders_skipped.push({ text, reason: err.message });
            continue;
          }
          let status = 'pending';
          if (due <= now) {
            if (recurrence) due = nextOccurrence(recurrence, due, tz, now);
            else status = 'due';
          }
          s.items.push({
            id: s.next_id++,
            text,
            due_at: due.toISOString(),
            recurrence,
            status,
            snooze_count: Number(r.snooze_count) || 0,
            created_at: now.toISOString(),
            last_fired_at: null,
            parent_id: null,
          });
          report.reminders_imported++;
        }
        return s;
      });
      return report;
    },
  });

  // ---- every minute: fire due reminders, drop expired memories ----

  async function tick() {
    const tz = timeZone();
    const now = clock.now();
    const cutoff = new Date(now.getTime() - KEEP_FINISHED_DAYS * 86_400_000).toISOString();

    if (Object.values(memories()).some((m) => m.expires_at && new Date(m.expires_at) <= now)) {
      state.update('memories', (cur) => {
        const all = cur ?? {};
        for (const [id, m] of Object.entries(all)) if (m.expires_at && new Date(m.expires_at) <= now) delete all[id];
        return all;
      });
    }

    const fired = [];
    state.update('reminders', (cur) => {
      const s = cur ?? emptyReminders();
      for (const r of s.items) {
        if (r.status !== 'pending' || new Date(r.due_at) > now) continue;
        fired.push({ id: r.id, text: r.text, occurrence: r.due_at, recurrence: r.recurrence });
        r.last_fired_at = now.toISOString();
        if (r.recurrence) r.due_at = nextOccurrence(r.recurrence, new Date(r.due_at), tz, now).toISOString();
        else r.status = 'due';
      }
      s.items = s.items.filter((r) => !((r.status === 'done' || r.status === 'cancelled') && r.created_at < cutoff));
      return s;
    });

    for (const f of fired) {
      const when = formatLocal(new Date(f.occurrence), tz);
      try {
        await registry.notify({
          title: f.text,
          body: f.recurrence ? `Reminder · ${when} · repeats ${describeRecurrence(f.recurrence)}` : `Reminder · ${when}`,
          url: PAGE_URL,
          tag: `remember-${f.id}`,
          actions: [
            { label: 'Done', tool: 'plugin_remember_done', args: { id: f.id, occurrence: f.occurrence } },
            { label: 'Snooze 1h', tool: 'plugin_remember_snooze', args: { id: f.id, minutes: 60 } },
          ],
        });
      } catch (err) {
        console.error(`remember: notify failed for #${f.id}: ${err.message}`);
      }
    }
    return { fired: fired.length };
  }

  if (typeof registry.schedule === 'function' && typeof registry.notify === 'function') {
    registry.schedule({ id: 'tick', cron: '* * * * *', run: tick });
  }

  // ---- dashboard page: sidebar → Remember (right after Music) ----

  // Morning brief (Shinobi >= 0.10.0): what is due today, overdue ones first.
  if (typeof registry.brief === 'function') {
    registry.brief({
      id: 'today',
      order: 10,
      render: () => {
        const tz = timeZone();
        const today = isoLocal(clock.now(), tz).slice(0, 10);
        const s = reminders();
        const overdue = s.items.filter((r) => r.status === 'due');
        const todays = s.items
          .filter((r) => r.status === 'pending' && isoLocal(new Date(r.due_at), tz).slice(0, 10) === today)
          .sort((a, b) => a.due_at.localeCompare(b.due_at));
        const lines = [];
        if (overdue.length) lines.push(`⏰ Overdue: ${overdue.map((r) => r.text).join(', ')}`);
        lines.push(
          todays.length
            ? `🔔 Today: ${todays.map((r) => `${isoLocal(new Date(r.due_at), tz).slice(11)} ${r.text}`).join(', ')}`
            : '🔔 Today: no reminders',
        );
        if (Object.keys(memories()).length && !keyBackedUp()) lines.push('🔑 Remember: back up the encryption key');
        return lines;
      },
    });
  }

  if (typeof registry.registerPage === 'function') {
    registry.registerPage({
      id: 'remember',
      title: 'Remember',
      icon: 'list',
      order: 15,
      render: () => renderPage(),
    });
  }

  function renderPage() {
    const tz = timeZone();
    const s = reminders();
    const due = s.items.filter((r) => r.status === 'due').sort((a, b) => a.due_at.localeCompare(b.due_at));
    const upcoming = s.items.filter((r) => r.status === 'pending').sort((a, b) => a.due_at.localeCompare(b.due_at));
    const mems = Object.values(memories()).sort((a, b) => a.key.localeCompare(b.key));
    const scheduling = typeof registry.schedule === 'function' && typeof registry.notify === 'function';

    const blocks = [
      {
        type: 'stats',
        items: [
          { label: 'Due now', value: String(due.length), tone: due.length ? 'warn' : 'muted' },
          { label: 'Upcoming', value: String(upcoming.length) },
          { label: 'Remembered', value: String(mems.length) },
          { label: 'Time zone', value: tz, hint: isoLocal(clock.now(), tz) },
        ],
      },
    ];
    if (mems.length && !keyBackedUp()) {
      blocks.push({
        type: 'text',
        tone: 'warn',
        text:
          `Back up the encryption key. Without ${loadKey().source} every remembered value is lost, even from a database backup ` +
          '(the key is not in the database). On the server: docker cp shinobi:/data/remember.key ./remember.key — ' +
          'then put it in your password manager and delete the copy.',
      });
      blocks.push({
        type: 'actions',
        buttons: [{ label: "I've backed it up", tool: 'plugin_remember_settings', args: { key_backed_up: true }, variant: 'primary' }],
      });
    }
    if (!scheduling) {
      blocks.push({ type: 'text', tone: 'warn', text: 'This Shinobi is older than 0.7.0: reminders are stored but will not fire. Update Shinobi.' });
    }

    if (due.length) {
      blocks.push({ type: 'heading', text: 'Due' });
      for (const r of due.slice(0, 10)) {
        blocks.push({ type: 'list', items: [{ title: r.text, subtitle: formatLocal(new Date(r.due_at), tz), badge: 'due', tone: 'warn' }] });
        blocks.push({
          type: 'actions',
          buttons: [
            { label: 'Done', tool: 'plugin_remember_done', args: { id: r.id }, variant: 'primary' },
            { label: 'Snooze 1h', tool: 'plugin_remember_snooze', args: { id: r.id, minutes: 60 } },
            { label: 'Tomorrow', tool: 'plugin_remember_snooze', args: { id: r.id, minutes: 1440 } },
          ],
        });
      }
    }

    blocks.push({ type: 'heading', text: 'Upcoming' });
    if (!upcoming.length) blocks.push({ type: 'text', tone: 'muted', text: 'Nothing scheduled. Ask Claude: "remind me tomorrow at 9 to …".' });
    for (const r of upcoming.slice(0, 15)) {
      blocks.push({
        type: 'list',
        items: [{ title: r.text, subtitle: `${formatLocal(new Date(r.due_at), tz)} · ${describeRecurrence(r.recurrence)}`, badge: r.recurrence ? 'repeats' : undefined }],
      });
      blocks.push({
        type: 'actions',
        buttons: r.recurrence
          ? [
              { label: 'Skip next', tool: 'plugin_remember_done', args: { id: r.id } },
              { label: 'Stop', tool: 'plugin_remember_cancel', args: { id: r.id }, confirm: `Stop "${r.text}" for good?`, variant: 'danger' },
            ]
          : [{ label: 'Cancel', tool: 'plugin_remember_cancel', args: { id: r.id }, confirm: `Cancel "${r.text}"?`, variant: 'danger' }],
      });
    }

    blocks.push({ type: 'divider' });
    blocks.push({ type: 'heading', text: 'Remembered' });
    blocks.push({
      type: 'table',
      columns: ['Key', 'Category', 'Updated'],
      rows: mems.slice(0, 100).map((m) => [m.key, m.category, isoLocal(new Date(m.updated_at), tz)]),
      empty: 'Nothing yet. Tell Claude: "remember that …".',
    });
    blocks.push({ type: 'text', tone: 'muted', text: 'Values are encrypted and not shown here — ask Claude to recall one.' });
    return { blocks, refreshSeconds: 30 };
  }
}
