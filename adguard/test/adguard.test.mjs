import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import register, { fold, msUntil, parseDays, normalizeDomain, describeSchedule, adguardConfigFromEnv } from '../shinobi-plugin-adguard.mjs';

// ---- Fake AdGuard Home --------------------------------------------------------
// Just enough of the REST API: clients, blocked services, query log, stats,
// custom rules, protection. Basic auth admin:secret.

const fresh = () => ({
  clients: [
    { name: 'TV dnevna', ids: ['192.168.1.10'], use_global_settings: true, use_global_blocked_services: false, blocked_services: ['youtube'], blocked_services_schedule: { time_zone: 'Local' }, filtering_enabled: true, tags: [], upstreams: [] },
    { name: 'Android box', ids: ['192.168.1.11'], use_global_settings: true, use_global_blocked_services: false, blocked_services: ['youtube'], blocked_services_schedule: { time_zone: 'Local' }, filtering_enabled: true, tags: [], upstreams: [] },
  ],
  auto: [
    { name: 'DESKTOP-T9AG12L', ip: '192.168.1.120', source: 'rdns' },
    { name: '', ip: '192.168.1.150', source: 'arp' },
  ],
  rules: ['||ads.example.org^'],
  protection: true,
  log: [
    { time: new Date().toISOString(), client: '192.168.1.10', client_info: { name: 'TV dnevna' }, question: { name: 'www.youtube.com' }, reason: 'FilteredBlockedService' },
    { time: new Date().toISOString(), client: '192.168.1.10', client_info: { name: 'TV dnevna' }, question: { name: 'i.ytimg.com' }, reason: 'FilteredBlockedService' },
    { time: new Date().toISOString(), client: '192.168.1.10', client_info: { name: 'TV dnevna' }, question: { name: 'api.netflix.com' }, reason: 'NotFilteredNotFound' },
    { time: new Date().toISOString(), client: '192.168.1.120', client_info: { name: '' }, question: { name: 'www.roblox.com' }, reason: 'NotFilteredNotFound' },
  ],
  requests: [],
});
let ag = fresh();
let srv;
let base;

const SERVICES = [
  { id: 'youtube', name: 'YouTube' },
  { id: 'tiktok', name: 'TikTok' },
  { id: 'roblox', name: 'Roblox' },
];

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': typeof body === 'string' ? 'text/plain' : 'application/json' });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

before(async () => {
  srv = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const url = new URL(req.url, 'http://x');
      ag.requests.push(`${req.method} ${url.pathname}`);
      if (req.headers.authorization !== 'Basic ' + Buffer.from('admin:secret').toString('base64')) return send(res, 401, 'Unauthorized');
      const body = raw ? JSON.parse(raw) : null;
      switch (`${req.method} ${url.pathname}`) {
        case 'GET /control/clients':
          return send(res, 200, { clients: ag.clients, auto_clients: ag.auto });
        case 'POST /control/clients/add':
          if (ag.clients.some((c) => c.name === body.name)) return send(res, 400, 'client already exists');
          ag.clients.push(body);
          return send(res, 200, 'OK');
        case 'POST /control/clients/update': {
          const i = ag.clients.findIndex((c) => c.name === body.name);
          if (i < 0) return send(res, 400, 'client not found');
          ag.clients[i] = body.data;
          return send(res, 200, 'OK');
        }
        case 'GET /control/blocked_services/all':
          return send(res, 200, { blocked_services: SERVICES, groups: [] });
        case 'GET /control/querylog': {
          const search = url.searchParams.get('search');
          const limit = Number(url.searchParams.get('limit') || 100);
          const blocked = url.searchParams.get('response_status') === 'blocked';
          const data = ag.log.filter((e) => (!search || e.client === search || e.question.name.includes(search)) && (!blocked || e.reason.startsWith('Filtered')));
          return send(res, 200, { data: data.slice(0, limit) });
        }
        case 'GET /control/stats':
          return send(res, 200, {
            time_units: 'hours',
            dns_queries: new Array(24).fill(0),
            num_dns_queries: 4,
            num_blocked_filtering: 2,
            top_clients: [{ '192.168.1.10': 3 }, { '192.168.1.120': 1 }],
            top_blocked_domains: [{ 'www.youtube.com': 1 }],
            top_queried_domains: [{ 'www.youtube.com': 1 }],
          });
        case 'GET /control/filtering/status':
          return send(res, 200, { enabled: true, user_rules: ag.rules });
        case 'POST /control/filtering/set_rules':
          ag.rules = body.rules;
          return send(res, 200, 'OK');
        case 'POST /control/protection':
          ag.protection = body.enabled;
          ag.protectionDuration = body.duration;
          return send(res, 200, 'OK');
        case 'GET /control/status':
          return send(res, 200, { protection_enabled: ag.protection });
        default:
          return send(res, 404, 'not found');
      }
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});

after(() => new Promise((r) => srv.close(r)));

beforeEach(() => {
  ag = fresh();
  Object.assign(process.env, { SHINOBI_ADGUARD_URL: base, SHINOBI_ADGUARD_USER: 'admin', SHINOBI_ADGUARD_PASSWORD: 'secret', SHINOBI_ADGUARD_TZ: 'Europe/Zagreb' });
});

function memoryStore() {
  const data = new Map();
  return {
    data,
    get: (k) => (data.has(k) ? structuredClone(data.get(k)) : null),
    set: (k, v) => data.set(k, structuredClone(v)),
    delete: (k) => data.delete(k),
    update(k, fn) {
      const next = fn(this.get(k));
      data.set(k, structuredClone(next));
      return structuredClone(next);
    },
  };
}

function loadTools({ state = memoryStore(), pages: withPages = true } = {}) {
  const tools = new Map();
  const pages = new Map();
  const registry = {
    registerTool(def) {
      assert.match(def.name, /^plugin_[a-z][a-z0-9_]*$/);
      assert.ok(!tools.has(def.name), `duplicate ${def.name}`);
      tools.set(def.name, def);
    },
    state,
  };
  if (withPages) registry.registerPage = (def) => pages.set(def.id, def);
  register(registry);
  return { names: [...tools.keys()], state, pages, call: (n, args = {}) => tools.get(n).handler(args) };
}

const client = (name) => ag.clients.find((c) => c.name === name);

// ---- Tests ------------------------------------------------------------------

test('registers the nine adguard tools', () => {
  assert.deepEqual(loadTools().names.sort(), [
    'plugin_adguard_activity',
    'plugin_adguard_devices',
    'plugin_adguard_group',
    'plugin_adguard_name_device',
    'plugin_adguard_protection',
    'plugin_adguard_schedule',
    'plugin_adguard_services',
    'plugin_adguard_site',
    'plugin_adguard_stats',
  ]);
});

test('devices lists named clients with last seen, unnamed active ones and silent ones', async () => {
  const { call } = loadTools();
  const res = await call('plugin_adguard_devices');
  assert.equal(res.devices.length, 2);
  assert.ok(res.devices[0].lastSeen, 'TV has a recent query');
  assert.deepEqual(res.devices[0].blockedServices, ['youtube']);
  assert.deepEqual(res.silentForADay, ['Android box']);
  assert.match(res.hint, /Android box/);
  const desktop = res.unnamed.find((u) => u.ip === '192.168.1.120');
  assert.equal(desktop.hostname, 'DESKTOP-T9AG12L');
  assert.equal(desktop.queries, 1);
  assert.ok(res.unnamed.some((u) => u.ip === '192.168.1.150'), 'ARP-only devices are listed too');
});

test('name_device creates a client, then renames it by IP', async () => {
  const { call } = loadTools();
  const created = await call('plugin_adguard_name_device', { id: '192.168.1.120', name: 'Djecji PC' });
  assert.equal(created.created, true);
  assert.deepEqual(client('Djecji PC').ids, ['192.168.1.120']);
  const renamed = await call('plugin_adguard_name_device', { id: '192.168.1.120', name: 'Lukin PC' });
  assert.equal(renamed.renamed, true);
  assert.ok(client('Lukin PC'));
  assert.equal(client('Djecji PC'), undefined);
});

test('renaming a device keeps it in its groups', async () => {
  const { call, state } = loadTools();
  await call('plugin_adguard_group', { group: 'djeca', add: ['TV dnevna'] });
  await call('plugin_adguard_name_device', { id: 'TV dnevna', name: 'TV' });
  assert.deepEqual(state.get('groups').djeca, ['TV']);
});

test('groups resolve names case- and accent-insensitively and reject unknown devices', async () => {
  const { call } = loadTools();
  const res = await call('plugin_adguard_group', { group: 'Djeca', add: ['tv dnevna', 'ANDROID'] });
  assert.deepEqual(res.groups.Djeca, ['TV dnevna', 'Android box']);
  await assert.rejects(call('plugin_adguard_group', { group: 'djeca', add: ['PS5'] }), /no device or group "PS5"/);
});

test('allow for a group until a time unblocks now and re-blocks on time', async () => {
  const { call, state } = loadTools();
  await call('plugin_adguard_group', { group: 'djeca', add: ['TV dnevna', 'Android box'] });
  const res = await call('plugin_adguard_services', { action: 'allow', target: 'djeca', services: ['YouTube'], until: '19:00' });
  assert.deepEqual(client('TV dnevna').blocked_services, []);
  assert.deepEqual(client('Android box').blocked_services, []);
  assert.ok(res.revertsAt);
  const pending = state.get('pending');
  assert.equal(pending.length, 2);
  assert.ok(pending.every((p) => p.action === 'block' && p.services[0] === 'youtube'));

  // Simulate the deadline passing (timer missed, e.g. a restart): the next call re-blocks first.
  state.set('pending', pending.map((p) => ({ ...p, at: Date.now() - 1 })));
  await call('plugin_adguard_stats');
  assert.deepEqual(client('TV dnevna').blocked_services, ['youtube']);
  assert.deepEqual(client('Android box').blocked_services, ['youtube']);
  assert.deepEqual(state.get('pending'), []);
});

test('a short temporary change reverts by its own timer', async () => {
  const { call, state } = loadTools();
  await call('plugin_adguard_services', { action: 'allow', target: 'TV dnevna', services: ['youtube'], minutes: 1 });
  state.set('pending', state.get('pending').map((p) => ({ ...p, at: Date.now() + 50 })));
  // Re-register so the timers are armed from the shortened state, as after a restart.
  loadTools({ state });
  await new Promise((r) => setTimeout(r, 300));
  assert.deepEqual(client('TV dnevna').blocked_services, ['youtube']);
  assert.deepEqual(state.get('pending'), []);
});

test('a newer temporary change replaces the older undo for the same service', async () => {
  const { call, state } = loadTools();
  await call('plugin_adguard_services', { action: 'allow', target: 'TV dnevna', services: ['youtube'], minutes: 30 });
  await call('plugin_adguard_services', { action: 'allow', target: 'TV dnevna', services: ['youtube'], minutes: 90 });
  const pending = state.get('pending');
  assert.equal(pending.length, 1);
  assert.ok(pending[0].at > Date.now() + 80 * 60_000);
});

test('permanent block adds services and turns off global service settings', async () => {
  const { call, state } = loadTools();
  await call('plugin_adguard_services', { action: 'block', target: '192.168.1.11', services: ['tiktok', 'roblox'] });
  assert.deepEqual(client('Android box').blocked_services, ['roblox', 'tiktok', 'youtube']);
  assert.equal(client('Android box').use_global_blocked_services, false);
  assert.equal(state.get('pending'), null);
});

test('unknown services and targets fail with a useful message', async () => {
  const { call } = loadTools();
  await assert.rejects(call('plugin_adguard_services', { action: 'block', target: 'TV dnevna', services: ['myspace'] }), /unknown service "myspace"/);
  await assert.rejects(call('plugin_adguard_services', { action: 'block', target: 'kuhinja', services: ['youtube'] }), /Known: TV dnevna, Android box/);
  const list = await call('plugin_adguard_services', { action: 'list' });
  assert.ok(list.services.some((s) => s.id === 'youtube'));
});

test('schedule writes AdGuard pause windows in ms and can be cleared', async () => {
  const { call } = loadTools();
  const res = await call('plugin_adguard_schedule', {
    target: 'TV dnevna',
    windows: [
      { days: 'pon-pet', from: '17:00', to: '19:00' },
      { days: 'vikend', from: '10', to: '20h' },
    ],
  });
  const sched = client('TV dnevna').blocked_services_schedule;
  assert.equal(sched.time_zone, 'Europe/Zagreb');
  assert.deepEqual(sched.mon, { start: 17 * 3_600_000, end: 19 * 3_600_000 });
  assert.deepEqual(sched.sun, { start: 10 * 3_600_000, end: 20 * 3_600_000 });
  assert.equal(res.allowedWindows.length, 7);
  await call('plugin_adguard_schedule', { target: 'TV dnevna', clear: true });
  assert.deepEqual(client('TV dnevna').blocked_services_schedule, { time_zone: 'Europe/Zagreb' });
  await assert.rejects(call('plugin_adguard_schedule', { target: 'TV dnevna', windows: [{ days: 'mon', from: '19:00', to: '17:00' }] }), /ends before/);
});

test('activity summarises sites per device and lists blocked requests', async () => {
  const { call } = loadTools();
  const res = await call('plugin_adguard_activity', { target: 'TV dnevna' });
  assert.equal(res.entriesRead, 3);
  assert.equal(res.blocked, 2);
  assert.deepEqual(res.topSites[0], { site: 'youtube.com', requests: 1, blocked: 1 });
  assert.equal(res.latestBlocked[0].device, 'TV dnevna');
  const all = await call('plugin_adguard_activity', {});
  assert.equal(all.entriesRead, 4);
});

test('stats maps busiest IPs to device names', async () => {
  const { call } = loadTools();
  const res = await call('plugin_adguard_stats');
  assert.equal(res.requests, 4);
  assert.deepEqual(res.topDevices[0], { device: 'TV dnevna', ip: '192.168.1.10', requests: 3 });
  assert.equal(res.topDevices[1].device, '192.168.1.120');
});

test('site rules for a device, for everyone, and removal keep other rules intact', async () => {
  const { call } = loadTools();
  await call('plugin_adguard_site', { domain: 'https://www.Roblox.com/games', action: 'block', target: 'TV dnevna' });
  assert.deepEqual(ag.rules, ['||ads.example.org^', "||roblox.com^$client='TV dnevna'"]);
  await call('plugin_adguard_site', { domain: 'roblox.com', action: 'allow' });
  assert.deepEqual(ag.rules, ['||ads.example.org^', '@@||roblox.com^']);
  const res = await call('plugin_adguard_site', { domain: 'roblox.com', action: 'remove' });
  assert.deepEqual(ag.rules, ['||ads.example.org^']);
  assert.deepEqual(res.removed, ['@@||roblox.com^']);
});

test('protection pause sends a duration in ms', async () => {
  const { call } = loadTools();
  const res = await call('plugin_adguard_protection', { enabled: false, minutes: 10 });
  assert.equal(ag.protection, false);
  assert.equal(ag.protectionDuration, 600_000);
  assert.equal(res.resumesInMinutes, 10);
  await call('plugin_adguard_protection', { enabled: true });
  assert.equal(ag.protection, true);
});

test('wrong password and missing URL give clear errors', async () => {
  const { call } = loadTools();
  process.env.SHINOBI_ADGUARD_PASSWORD = 'nope';
  await assert.rejects(call('plugin_adguard_stats'), /login rejected/);
  delete process.env.SHINOBI_ADGUARD_URL;
  await assert.rejects(call('plugin_adguard_stats'), /SHINOBI_ADGUARD_URL is not set/);
});

test('an unreachable AdGuard rejects instead of hanging', async () => {
  const { call } = loadTools();
  process.env.SHINOBI_ADGUARD_URL = 'http://127.0.0.1:1';
  await assert.rejects(call('plugin_adguard_stats'), /cannot reach/);
});

test('temporary changes need the host state store; permanent ones do not', async () => {
  const { call } = loadTools({ state: null });
  await call('plugin_adguard_services', { action: 'block', target: 'TV dnevna', services: ['tiktok'] });
  await assert.rejects(call('plugin_adguard_services', { action: 'allow', target: 'TV dnevna', services: ['youtube'], minutes: 5 }), /state store/);
});

test('msUntil counts to the next wall-clock time in the given zone', () => {
  const now = new Date('2026-11-18T16:30:00Z'); // 17:30 in Zagreb (CET)
  assert.equal(msUntil('19:00', now, 'Europe/Zagreb'), 90 * 60_000);
  assert.equal(msUntil('17:00', now, 'Europe/Zagreb'), (24 * 60 - 30) * 60_000, 'a past time means tomorrow');
  assert.equal(msUntil('19h', now, 'UTC'), 150 * 60_000);
  assert.throws(() => msUntil('25:00', now, 'UTC'), /out of range/);
});

test('parseDays understands ranges, aliases and Croatian names', () => {
  assert.deepEqual(parseDays('mon-fri'), ['mon', 'tue', 'wed', 'thu', 'fri']);
  assert.deepEqual(parseDays('pon-pet'), ['mon', 'tue', 'wed', 'thu', 'fri']);
  assert.deepEqual(parseDays('vikend'), ['sat', 'sun']);
  assert.deepEqual(parseDays('fri-mon'), ['fri', 'sat', 'sun', 'mon']);
  assert.equal(parseDays('daily').length, 7);
  assert.deepEqual(parseDays('sub, ned'), ['sat', 'sun']);
  assert.throws(() => parseDays('someday'), /unknown day/);
});

test('helpers: fold, normalizeDomain, describeSchedule, config', () => {
  assert.equal(fold('Đurđa Čačić'), 'durda cacic');
  assert.equal(normalizeDomain('HTTPS://www.YouTube.com/watch?v=1'), 'youtube.com');
  assert.throws(() => normalizeDomain('not a domain'), /not a domain/);
  assert.deepEqual(describeSchedule({ time_zone: 'UTC', mon: { start: 0, end: 3_600_000 } }), ['mon 00:00-01:00']);
  assert.equal(adguardConfigFromEnv({ SHINOBI_ADGUARD_URL: 'http://x/ ' }).url, 'http://x');
});

test('dashboard page shows groups, one-tap buttons on own tools, temporary changes and silent devices', async () => {
  const { call, pages, names } = loadTools();
  await call('plugin_adguard_group', { group: 'djeca', add: ['TV dnevna', 'Android box'] });
  await call('plugin_adguard_services', { action: 'allow', target: 'Android box', services: ['youtube'], until: '19:00' });
  const { blocks, refreshSeconds } = await pages.get('adguard').render();
  assert.equal(refreshSeconds, 30);
  const stats = blocks.find((b) => b.type === 'stats');
  assert.equal(stats.items.find((i) => i.label === 'Protection').value, 'On');
  const buttons = blocks.filter((b) => b.type === 'actions').flatMap((b) => b.buttons);
  assert.ok(buttons.every((b) => names.includes(b.tool)), 'every button targets an adguard tool');
  const allow = buttons.find((b) => b.label === 'Allow youtube 1 h');
  assert.deepEqual(allow.args, { action: 'allow', target: 'djeca', services: ['youtube'], minutes: 60 });
  assert.ok(blocks.some((b) => b.type === 'heading' && b.text === 'Group: djeca'));
  const temp = blocks.filter((b) => b.type === 'list')[1];
  assert.equal(temp.items.length, 1);
  assert.match(temp.items[0].subtitle, /^blocked again at 19:00$/);
  const table = blocks.find((b) => b.type === 'table');
  assert.equal(table.rows.length, 2);
  assert.equal(table.rows.find((r) => r[0] === 'Android box')[4], 'never ⚠');
});

test('hosts without registerPage still load every tool', () => {
  const { names, pages } = loadTools({ pages: false });
  assert.equal(names.length, 9);
  assert.equal(pages.size, 0);
});
