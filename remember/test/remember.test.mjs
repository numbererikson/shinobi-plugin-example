import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import register, {
  clock,
  decrypt,
  encrypt,
  fold,
  isoLocal,
  loadKey,
  nextOccurrence,
  normalizeRecurrence,
  parseWhen,
  resetKeyCache,
  zonedToUtc,
} from '../shinobi-plugin-remember.mjs';

const TZ = 'Europe/Zagreb';
const tmp = mkdtempSync(join(tmpdir(), 'remember-'));
process.env.SHINOBI_CONFIG_DIR = tmp;
delete process.env.SHINOBI_REMEMBER_KEY;
after(() => rmSync(tmp, { recursive: true, force: true }));

// ---- fake host: same surface as Shinobi's plugin registry ----------------------

function host() {
  const store = new Map();
  const tools = new Map();
  const pages = new Map();
  const schedules = new Map();
  const sent = [];
  const briefs = new Map();
  const registry = {
    brief: (def) => briefs.set(def.id, def),
    state: {
      get: (k) => (store.has(k) ? JSON.parse(store.get(k)) : null),
      set: (k, v) => store.set(k, JSON.stringify(v)),
      delete: (k) => store.delete(k),
      update: (k, fn) => {
        const next = fn(store.has(k) ? JSON.parse(store.get(k)) : null);
        store.set(k, JSON.stringify(next));
        return next;
      },
    },
    registerTool: (def) => tools.set(def.name, def),
    registerPage: (def) => pages.set(def.id, def),
    schedule: (def) => schedules.set(def.id, def),
    notify: async (n) => {
      sent.push(n);
      return { total: 1, succeeded: 1, failed: 0, pruned_endpoints: [], error: null };
    },
  };
  register(registry);
  const call = (name, args = {}) => tools.get(name).handler(args);
  const tick = () => schedules.get('tick').run();
  return { registry, store, tools, pages, schedules, briefs, sent, call, tick };
}

let now;
beforeEach(() => {
  now = new Date('2026-11-21T08:00:00Z'); // Sat 21.11. 09:00 in Zagreb
  clock.now = () => now;
});
const at = (iso) => {
  now = new Date(iso);
};

// ---- time zones + recurrence --------------------------------------------------

test('zonedToUtc handles CET, CEST and the DST switch', () => {
  assert.equal(zonedToUtc(2026, 11, 22, 9, 0, TZ).toISOString(), '2026-11-22T08:00:00.000Z');
  assert.equal(zonedToUtc(2026, 7, 1, 9, 0, TZ).toISOString(), '2026-07-01T07:00:00.000Z');
  assert.equal(zonedToUtc(2026, 3, 29, 3, 30, TZ).toISOString(), '2026-03-29T01:30:00.000Z');
});

test('parseWhen accepts local time and ISO with offset', () => {
  assert.equal(parseWhen('2026-11-22 09:00', TZ).toISOString(), '2026-11-22T08:00:00.000Z');
  assert.equal(parseWhen('2026-11-22T09:00:30', TZ).toISOString(), '2026-11-22T08:00:00.000Z');
  assert.equal(parseWhen('2026-11-22T09:00:00+01:00', TZ).toISOString(), '2026-11-22T08:00:00.000Z');
  assert.throws(() => parseWhen('tomorrow 9', TZ), /local time/);
  assert.throws(() => parseWhen('2026-13-01 09:00', TZ), /invalid/);
});

test('normalizeRecurrence understands LIMAlife formats', () => {
  assert.equal(normalizeRecurrence(null), null);
  assert.equal(normalizeRecurrence('daily'), 'daily');
  assert.equal(normalizeRecurrence('Weekly:Monday'), 'weekly:1');
  assert.equal(normalizeRecurrence('weekly:thu,mon,7'), 'weekly:0,1,4');
  assert.equal(normalizeRecurrence('monthly:15'), 'monthly:15');
  assert.throws(() => normalizeRecurrence('weekly:blursday'), /weekday/);
  assert.throws(() => normalizeRecurrence('hourly'), /recurrence must be/);
});

test('nextOccurrence keeps local time across DST and clamps month ends', () => {
  const sat = parseWhen('2026-03-28 09:00', TZ);
  assert.equal(isoLocal(nextOccurrence('daily', sat, TZ, sat), TZ), '2026-03-29 09:00');
  assert.equal(isoLocal(nextOccurrence('weekdays', sat, TZ, sat), TZ), '2026-03-30 09:00');
  assert.equal(isoLocal(nextOccurrence('weekly:4', sat, TZ, sat), TZ), '2026-04-02 09:00');
  const jan31 = parseWhen('2027-01-31 08:00', TZ);
  assert.equal(isoLocal(nextOccurrence('monthly:31', jan31, TZ, jan31), TZ), '2027-02-28 08:00');
  // Long downtime: skips to the first occurrence after "after".
  assert.equal(isoLocal(nextOccurrence('daily', sat, TZ, parseWhen('2026-04-10 12:00', TZ)), TZ), '2026-04-11 09:00');
});

// ---- encryption ----------------------------------------------------------------

test('creates a 0600 key file and round-trips values', () => {
  resetKeyCache();
  const key = loadKey();
  assert.equal(key.source, join(tmp, 'remember.key'));
  assert.match(readFileSync(key.source, 'utf8').trim(), /^[0-9a-f]{64}$/);
  if (process.platform !== 'win32') assert.equal(statSync(key.source).mode & 0o777, 0o600);
  const enc = encrypt('XY123 šifra');
  assert.ok(enc.startsWith('v1:'));
  assert.ok(!enc.includes('XY123'));
  assert.equal(decrypt(enc), 'XY123 šifra');
});

test('a different key cannot read the value', () => {
  resetKeyCache();
  const enc = encrypt('secret');
  process.env.SHINOBI_REMEMBER_KEY = 'a'.repeat(64);
  resetKeyCache();
  assert.throws(() => decrypt(enc), /cannot decrypt/);
  delete process.env.SHINOBI_REMEMBER_KEY;
  resetKeyCache();
});

// ---- memory --------------------------------------------------------------------

test('save, recall (accent-insensitive), replace and forget', () => {
  const h = host();
  h.call('plugin_remember_save', { key: 'WiFi šifra ured', value: 'XY123', category: 'Passwords' });
  h.call('plugin_remember_save', { key: 'parking', value: 'razina -2, mjesto 14' });
  assert.ok(!h.store.get('memories').includes('XY123'), 'value is encrypted in state');

  let r = h.call('plugin_remember_recall', { query: 'sifra' });
  assert.equal(r.count, 1);
  assert.equal(r.memories[0].value, 'XY123');
  assert.equal(r.memories[0].category, 'passwords');
  assert.equal(h.call('plugin_remember_recall', { query: 'mjesto 14' }).memories[0].key, 'parking');
  assert.equal(h.call('plugin_remember_recall', {}).count, 2);

  const again = h.call('plugin_remember_save', { key: 'wifi sifra ured', value: 'NEW' });
  assert.equal(again.replaced, true);
  assert.equal(h.call('plugin_remember_recall', { query: 'wifi' }).memories[0].value, 'NEW');

  assert.deepEqual(h.call('plugin_remember_forget', { key: 'Parking' }), { forgotten: 'parking' });
  assert.throws(() => h.call('plugin_remember_forget', { key: 'parking' }), /nothing remembered/);
  assert.equal(fold('Đurđevac Čakovec'), 'durdevac cakovec');
});

test('expired memories disappear', async () => {
  const h = host();
  h.call('plugin_remember_save', { key: 'parking', value: 'P2', expires_at: '2026-11-21 10:00' });
  assert.equal(h.call('plugin_remember_recall', {}).count, 1);
  at('2026-11-21T09:30:00Z');
  assert.equal(h.call('plugin_remember_recall', {}).count, 0);
  await h.tick();
  assert.deepEqual(h.registry.state.get('memories'), {});
});

// ---- reminders -----------------------------------------------------------------

test('a one-time reminder fires once, with Done + Snooze buttons', async () => {
  const h = host();
  const { reminder } = h.call('plugin_remember_remind', { text: 'Nazovi banku', at: '2026-11-21 09:30' });
  assert.equal(reminder.due, '2026-11-21 09:30');

  await h.tick();
  assert.equal(h.sent.length, 0, 'not due yet');
  at('2026-11-21T08:30:20Z');
  assert.deepEqual(await h.tick(), { fired: 1 });
  assert.deepEqual(await h.tick(), { fired: 0 }, 'fires once');

  const n = h.sent[0];
  assert.equal(n.title, 'Nazovi banku');
  assert.equal(n.url, '/apps/remember');
  assert.deepEqual(n.actions.map((a) => [a.label, a.tool]), [['Done', 'plugin_remember_done'], ['Snooze 1h', 'plugin_remember_snooze']]);
  assert.equal(h.call('plugin_remember_reminders', {}).reminders[0].status, 'due');

  assert.equal(h.call('plugin_remember_done', n.actions[0].args).status, 'done');
  assert.equal(h.call('plugin_remember_reminders', {}).count, 0);
});

test('snooze moves a one-time reminder and it fires again', async () => {
  const h = host();
  h.call('plugin_remember_remind', { text: 'Lijekovi', at: '2026-11-21 09:01' });
  at('2026-11-21T08:01:00Z');
  await h.tick();
  const r = h.call('plugin_remember_snooze', { id: 1, minutes: 30 });
  assert.equal(r.due, '2026-11-21 09:31');
  at('2026-11-21T08:31:00Z');
  assert.deepEqual(await h.tick(), { fired: 1 });
  assert.equal(h.sent.length, 2);
});

test('a repeating reminder rolls over; Done from an old notification only acknowledges', async () => {
  const h = host();
  h.call('plugin_remember_remind', { text: 'Izvještaj', at: '2026-11-23 09:00', recurrence: 'weekly:monday' });
  at('2026-11-23T08:00:00Z');
  await h.tick();
  const fired = h.sent[0].actions[0].args;
  let list = h.call('plugin_remember_reminders', {}).reminders;
  assert.equal(list[0].due, '2026-11-30 09:00');
  assert.equal(list[0].status, 'pending');

  const ack = h.call('plugin_remember_done', fired);
  assert.equal(ack.acknowledged, true);
  assert.equal(h.call('plugin_remember_reminders', {}).reminders[0].due, '2026-11-30 09:00');

  // Done without an occurrence (page / chat) skips the next one.
  assert.equal(h.call('plugin_remember_done', { id: 1 }).skipped_to, '2026-12-07 09:00');

  // Snooze on a series adds a one-time copy.
  const copy = h.call('plugin_remember_snooze', { id: 1, minutes: 60 });
  assert.equal(copy.copy_of, 1);
  list = h.call('plugin_remember_reminders', {}).reminders;
  assert.equal(list.length, 2);

  assert.equal(h.call('plugin_remember_cancel', { id: 1 }).status, 'cancelled');
});

test('rejects one-time reminders in the past, moves repeating ones forward', () => {
  const h = host();
  assert.throws(() => h.call('plugin_remember_remind', { text: 'x', at: '2026-11-21 08:00' }), /in the past/);
  const r = h.call('plugin_remember_remind', { text: 'Jutro', at: '2026-11-21 07:00', recurrence: 'daily' });
  assert.equal(r.reminder.due, '2026-11-22 07:00');
});

test('settings: time zone change and status', () => {
  const h = host();
  assert.equal(h.call('plugin_remember_settings', {}).time_zone, 'Europe/Zagreb');
  assert.equal(h.call('plugin_remember_settings', {}).now, '2026-11-21 09:00');
  assert.throws(() => h.call('plugin_remember_settings', { timezone: 'Mars/Base' }), /unknown time zone/);
  const s = h.call('plugin_remember_settings', { timezone: 'Europe/London' });
  assert.equal(s.now, '2026-11-21 08:00');
});

// ---- LIMAlife import -----------------------------------------------------------

test('imports a LIMAlife backup', () => {
  const h = host();
  h.call('plugin_remember_save', { key: 'wifi', value: 'keep me' });
  const report = h.call('plugin_remember_import', {
    backup: {
      exported_at: '2026-11-21T09:00:00+01:00',
      memories: [
        { key_name: 'wifi', category: 'passwords', value: 'from limalife', expires_at: null, created_at: '2026-05-01 10:00:00' },
        { key_name: 'Markov broj', category: 'contacts', value: '091 123 4567', expires_at: null, created_at: '2026-05-02 10:00:00' },
        { key_name: 'parking', category: 'parking', value: 'P1', expires_at: '2026-11-01 10:00:00', created_at: '2026-10-31 10:00:00' },
      ],
      reminders: [
        { message: 'Pošalji izvještaj', remind_at: '2026-11-23 09:00:00', recurrence: 'weekly:monday', status: 'pending', snooze_count: 0 },
        { message: 'Stari tjedni', remind_at: '2026-01-05 09:00:00', recurrence: 'weekly:monday', status: 'pending', snooze_count: 2 },
        { message: 'Propušteni', remind_at: '2026-11-20 09:00:00', recurrence: null, status: 'snoozed', snooze_count: 1 },
        { message: 'Gotovo', remind_at: '2026-11-01 09:00:00', recurrence: null, status: 'sent', snooze_count: 0 },
      ],
      follow_ups: [],
    },
  });
  assert.equal(report.memories_imported, 1);
  assert.deepEqual(report.memories_skipped.map((s) => s.reason).sort(), ['already remembered', 'expired']);
  assert.equal(report.reminders_imported, 3);
  assert.deepEqual(report.reminders_skipped, [{ text: 'Gotovo', reason: 'status sent' }]);

  assert.equal(h.call('plugin_remember_recall', { query: 'wifi' }).memories[0].value, 'keep me');
  assert.equal(h.call('plugin_remember_recall', { query: 'markov' }).memories[0].value, '091 123 4567');
  const list = h.call('plugin_remember_reminders', {}).reminders;
  assert.deepEqual(list.map((r) => [r.text, r.status, r.due]), [
    ['Propušteni', 'due', '2026-11-20 09:00'],
    ['Pošalji izvještaj', 'pending', '2026-11-23 09:00'],
    ['Stari tjedni', 'pending', '2026-11-23 09:00'],
  ]);
});

// ---- dashboard page ------------------------------------------------------------

test('page sits right after Music and never shows memory values', async () => {
  const h = host();
  const page = h.pages.get('remember');
  assert.equal(page.order, 15);
  h.call('plugin_remember_save', { key: 'wifi', value: 'XY123' });
  h.call('plugin_remember_remind', { text: 'Banka', at: '2026-11-21 09:05' });
  at('2026-11-21T08:05:00Z');
  await h.tick();
  const { blocks } = page.render();
  const json = JSON.stringify(blocks);
  assert.ok(!json.includes('XY123'));
  assert.ok(json.includes('Banka'));
  assert.equal(blocks[0].items[0].value, '1', 'one due');
  const actions = blocks.find((b) => b.type === 'actions' && b.buttons[0].tool === 'plugin_remember_done');
  assert.deepEqual(actions.buttons.map((b) => b.tool), ['plugin_remember_done', 'plugin_remember_snooze', 'plugin_remember_snooze']);
});

test('page nags about backing up the key until acknowledged for that key', () => {
  const h = host();
  const page = h.pages.get('remember');
  const nag = () => JSON.stringify(page.render().blocks).includes('Back up the encryption key');
  assert.equal(nag(), false, 'nothing to lose yet');
  h.call('plugin_remember_save', { key: 'wifi', value: 'XY123' });
  assert.equal(nag(), true);
  assert.equal(h.call('plugin_remember_settings', {}).key_backed_up, false);
  const button = page.render().blocks.find((b) => b.type === 'actions').buttons[0];
  h.call(button.tool, button.args);
  assert.equal(nag(), false);
  assert.equal(h.call('plugin_remember_settings', {}).key_backed_up, true);
  // A different key (e.g. recreated file) asks again.
  h.store.set('settings', JSON.stringify({ key_backup: { fingerprint: 'other', at: 'x' } }));
  assert.equal(nag(), true);
});

test('morning brief: overdue first, then today in local time, plus the key reminder', async () => {
  const h = host();
  const brief = () => h.briefs.get('today').render();
  assert.deepEqual(brief(), ['🔔 Today: no reminders']);
  h.call('plugin_remember_remind', { text: 'Banka', at: '2026-11-21 09:05' });
  h.call('plugin_remember_remind', { text: 'Trening', at: '2026-11-21 17:00' });
  h.call('plugin_remember_remind', { text: 'Sutra', at: '2026-11-22 09:00' });
  at('2026-11-21T08:06:00Z'); // 09:06 Zagreb: Banka is now due
  await h.tick();
  assert.deepEqual(brief(), ['⏰ Overdue: Banka', '🔔 Today: 17:00 Trening']);
  h.call('plugin_remember_save', { key: 'wifi', value: 'XY' });
  assert.equal(brief().at(-1), '🔑 Remember: back up the encryption key');
});

test('works on a host without schedule/notify (memory only)', () => {
  const tools = new Map();
  const store = new Map();
  register({
    state: {
      get: (k) => (store.has(k) ? JSON.parse(store.get(k)) : null),
      set: (k, v) => store.set(k, JSON.stringify(v)),
      delete: (k) => store.delete(k),
      update: (k, fn) => {
        const next = fn(store.has(k) ? JSON.parse(store.get(k)) : null);
        store.set(k, JSON.stringify(next));
        return next;
      },
    },
    registerTool: (def) => tools.set(def.name, def),
  });
  tools.get('plugin_remember_save').handler({ key: 'a', value: 'b' });
  assert.equal(tools.get('plugin_remember_recall').handler({}).count, 1);
});
