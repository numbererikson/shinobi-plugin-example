import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import register, { clock, expandPart, planBuild, splitFill, fillCommand, parsePlayerList, bridgeConfigFromEnv } from '../shinobi-plugin-minecraft.mjs';
import { createBridge, isAllowedCommand, demuxLogs } from '../bridge/bridge.mjs';

const TOKEN = 'test-token-0123456789';

// ---- bridge whitelist ---------------------------------------------------------

test('bridge allows building, chat and the plugin anchors', () => {
  for (const c of [
    'fill ~1 ~0 ~6 ~5 ~4 ~10 brick_block',
    '/setblock 1 2 3 glass',
    'say Majstor: hello',
    'list',
    'tickingarea add circle ~0 ~0 ~0 4 mc_1',
    'tickingarea remove mc_1',
    'execute at Lukakrizan run summon armor_stand Majstor_1 ~ ~ ~',
    'execute at "Luka K" run summon armor_stand Majstor_2 ~ ~ ~',
    'execute as @e[type=armor_stand,name=Majstor_1] at @s run fill ~0 ~0 ~6 ~3 ~3 ~9 stone',
    'kill @e[type=armor_stand,name=Majstor_1]',
  ]) assert.ok(isAllowedCommand(c), c);
});

test('bridge refuses everything else', () => {
  for (const c of [
    'op Lukakrizan',
    'stop',
    'gamemode creative Lukakrizan',
    'give Lukakrizan diamond 64',
    'summon creeper ~ ~ ~',
    'summon tnt ~ ~ ~',
    'kill @a',
    'kill @e',
    'allowlist off',
    'execute at Lukakrizan run op Lukakrizan',
    'execute as @a[name="a run fill 0 0 0 0 0 0 air"] run op x',
    'execute as @a at @s run fill ~ ~ ~ ~ ~ ~ air',
    'execute at Lukakrizan run execute at Lukakrizan run op x',
    'fill 0 0 0 1 1 1 stone\nop x',
    'say ' + 'x'.repeat(500),
    '',
    42,
  ]) assert.equal(isAllowedCommand(c), false, String(c));
});

test('demuxLogs handles multiplexed and raw logs', () => {
  const frame = (s) => {
    const body = Buffer.from(s);
    const head = Buffer.alloc(8);
    head[0] = 1;
    head.writeUInt32BE(body.length, 4);
    return Buffer.concat([head, body]);
  };
  assert.deepEqual(demuxLogs(Buffer.concat([frame('a\nb\n'), frame('c\n')])), ['a', 'b', 'c']);
  assert.deepEqual(demuxLogs(Buffer.from('x\ny\n')), ['x', 'y']);
});

// ---- geometry -------------------------------------------------------------------

test('splitFill keeps every piece under the Bedrock limit and covers the volume', () => {
  const f = { a: [-60, 0, -60], b: [60, 40, 60], block: 'stone' };
  const parts = splitFill(f);
  const vol = (p) => (p.b[0] - p.a[0] + 1) * (p.b[1] - p.a[1] + 1) * (p.b[2] - p.a[2] + 1);
  assert.ok(parts.every((p) => vol(p) <= 32768));
  assert.equal(parts.reduce((n, p) => n + vol(p), 0), vol(f));
});

test('hollow box carves the inside', () => {
  const fills = expandPart({ type: 'box', from: [0, 0, 6], to: [4, 4, 10], block: 'brick_block', hollow: true });
  assert.deepEqual(fills, [
    { a: [0, 0, 6], b: [4, 4, 10], block: 'brick_block' },
    { a: [1, 1, 7], b: [3, 3, 9], block: 'air' },
  ]);
  const open = expandPart({ type: 'box', from: [0, 0, 6], to: [4, 4, 10], block: 'stone', hollow: true, open_top: true });
  assert.deepEqual(open[1].b, [3, 4, 9]);
});

test('shapes stay inside their bounds', () => {
  const plan = planBuild([
    { type: 'cylinder', center: [0, 0, 20], radius: 4, height: 10, block: 'stone', hollow: true },
    { type: 'dome', center: [0, 10, 20], radius: 4, block: 'copper_block' },
    { type: 'pyramid', center: [20, 0, 20], size: 9, block: 'sandstone' },
    { type: 'roof', from: [-10, 5, 0], to: [-4, 5, 10], axis: 'z', block: 'deepslate_tiles' },
    { type: 'block', at: [0, 15, 20], block: 'minecraft:gold_block' },
  ]);
  assert.deepEqual(plan.bbox, { from: [-10, 0, 0], to: [24, 15, 24] });
  assert.ok(plan.blocks > 0);
  assert.ok(plan.fills.every((f) => /^[a-z0-9_]+$/.test(f.block)));
  const roof = expandPart({ type: 'roof', from: [0, 5, 0], to: [6, 5, 10], axis: 'z', block: 'stone' });
  assert.equal(roof.length, 4);
  assert.deepEqual(roof.at(-1), { a: [3, 8, 0], b: [3, 8, 10], block: 'stone' });
});

test('clear_first adds an air box around the building', () => {
  const plan = planBuild([{ type: 'box', from: [0, 0, 6], to: [4, 4, 10], block: 'stone' }], { clearFirst: true });
  assert.deepEqual(plan.fills[0], { a: [-1, 0, 5], b: [5, 5, 11], block: 'air' });
});

test('bad plans are rejected with a useful message', () => {
  assert.throws(() => planBuild([]), /non-empty/);
  assert.throws(() => planBuild([{ type: 'box', from: [0, 0, 0], to: [100, 1, 1], block: 'stone' }]), /part 1: .*too far/);
  assert.throws(() => planBuild([{ type: 'box', from: [0, 0, 0], to: [1, 1, 1], block: 'stone; op x' }]), /not a block id/);
  assert.throws(() => planBuild([{ type: 'spaceship' }]), /unknown part type/);
  assert.throws(() => planBuild([{ type: 'box', from: [0, 0], to: [1, 1, 1], block: 'stone' }]), /\[x, y, z\]/);
});

test('fill commands are relative to the anchor and pass the bridge', () => {
  const cmd = fillCommand('Majstor_3', { a: [-2, 0, 6], b: [2, 4, 10], block: 'glass' });
  assert.equal(cmd, 'execute as @e[type=armor_stand,name=Majstor_3] at @s run fill ~-2 ~0 ~6 ~2 ~4 ~10 glass');
  assert.ok(isAllowedCommand(cmd));
});

test('parsePlayerList reads the BDS console', () => {
  assert.deepEqual(parsePlayerList(['[2026-11-26 10:00:00:000 INFO] There are 2/10 players online:', 'Lukakrizan, Mia']), ['Lukakrizan', 'Mia']);
  assert.deepEqual(parsePlayerList(['There are 0/10 players online:', '']), []);
  assert.equal(parsePlayerList(['Server started.']), null);
});

test('bridge config defaults', () => {
  assert.deepEqual(bridgeConfigFromEnv({}), { url: 'http://mc-bridge:8790', token: '' });
  assert.equal(bridgeConfigFromEnv({ SHINOBI_MC_BRIDGE_URL: 'http://x:1/' }).url, 'http://x:1');
});

// ---- plugin end-to-end against the real bridge with a fake Docker ---------------

let server;
let mc;

function fakeDocker() {
  const state = { players: ['Lukakrizan'], ran: [], logs: [] };
  let execId = 0;
  const pending = new Map();
  return {
    state,
    async call(method, path, body) {
      const out = await route(method, path, body);
      return Buffer.isBuffer(out) ? out : Buffer.from(JSON.stringify(out));
    },
  };
  async function route(method, path, body) {
    {
      if (method === 'POST' && /\/containers\/minecraft\/exec$/.test(path)) {
        pending.set(String(++execId), body.Cmd[1]);
        return { Id: String(execId) };
      }
      const start = /^\/exec\/(\d+)\/start$/.exec(path);
      if (method === 'POST' && start) {
        const cmd = pending.get(start[1]);
        state.ran.push(cmd);
        if (cmd === 'list') state.logs.push(`There are ${state.players.length}/10 players online:`, state.players.join(', '));
        return {};
      }
      if (method === 'GET' && /^\/exec\/\d+\/json$/.test(path)) return { Running: false, ExitCode: 0 };
      if (method === 'GET' && path.startsWith('/containers/minecraft/logs')) return Buffer.from(state.logs.join('\n') + '\n');
      throw new Error(`unexpected docker call ${method} ${path}`);
    }
  }
}

before(async () => {
  clock.sleep = () => new Promise((r) => setImmediate(r));
});

beforeEach(async () => {
  if (server) await new Promise((r) => server.close(r));
  mc = fakeDocker();
  server = createBridge({ token: TOKEN, docker: mc });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  process.env.SHINOBI_MC_BRIDGE_URL = `http://127.0.0.1:${server.address().port}`;
  process.env.SHINOBI_MC_BRIDGE_TOKEN = TOKEN;
});

after(() => new Promise((r) => server.close(r)));

function memoryStore() {
  const data = new Map();
  return {
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

function load(state = memoryStore()) {
  const tools = new Map();
  const pages = new Map();
  const notes = [];
  register({
    registerTool(def) {
      assert.match(def.name, /^plugin_[a-z][a-z0-9_]*$/);
      tools.set(def.name, def);
    },
    registerPage: (def) => pages.set(def.id, def),
    notify: async (n) => notes.push(n),
    state,
  });
  return { tools, pages, notes, call: (n, args = {}) => tools.get(n).handler(args) };
}

async function waitFor(fn) {
  for (let i = 0; i < 500; i++) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error('timed out');
}

test('registers the tools', () => {
  const { tools, pages } = load();
  assert.deepEqual([...tools.keys()].sort(), ['plugin_minecraft_build', 'plugin_minecraft_builds', 'plugin_minecraft_players', 'plugin_minecraft_remove', 'plugin_minecraft_say']);
  assert.ok(pages.has('minecraft'));
});

test('players and say go through the bridge', async () => {
  const { call } = load();
  assert.deepEqual(await call('plugin_minecraft_players'), { players: ['Lukakrizan'] });
  await call('plugin_minecraft_say', { text: 'Večera!\nodmah' });
  assert.equal(mc.state.ran.at(-1), 'say Majstor: Večera! odmah');
});

test('build runs in the background, then notifies', async () => {
  const { call, notes } = load();
  const res = await call('plugin_minecraft_build', {
    name: 'Kućica',
    parts: [
      { type: 'box', from: [-3, 0, 6], to: [3, 4, 12], block: 'brick_block', hollow: true },
      { type: 'clear', from: [0, 1, 6], to: [0, 2, 6] },
      { type: 'roof', from: [-4, 5, 5], to: [4, 5, 13], axis: 'z', block: 'deepslate_tiles' },
    ],
  });
  assert.equal(res.status, 'queued');
  assert.equal(res.player, 'Lukakrizan');
  const done = await waitFor(async () => (await call('plugin_minecraft_builds')).builds.find((b) => b.status === 'done'));
  assert.equal(done.name, 'Kućica');
  const ran = mc.state.ran;
  assert.ok(ran.includes('execute at Lukakrizan run summon armor_stand Majstor_1 ~ ~ ~'));
  assert.ok(ran.some((c) => c.startsWith('execute as @e[type=armor_stand,name=Majstor_1] at @s run tickingarea add circle')));
  assert.ok(ran.includes('execute as @e[type=armor_stand,name=Majstor_1] at @s run fill ~-3 ~0 ~6 ~3 ~4 ~12 brick_block'));
  assert.ok(ran.includes('tickingarea remove mc_1'));
  assert.equal(ran.at(-1), 'say Majstor: Kućica je gotov!');
  assert.equal(notes.length, 1);
  assert.match(notes[0].body, /Kućica/);
});

test('extend_build reuses the anchor; remove clears the box', async () => {
  const { call } = load();
  await call('plugin_minecraft_build', { name: 'Toranj', parts: [{ type: 'cylinder', center: [0, 0, 10], radius: 3, height: 12, block: 'stone' }] });
  await waitFor(async () => (await call('plugin_minecraft_builds')).builds.find((b) => b.id === 1 && b.status === 'done'));
  const summons = () => mc.state.ran.filter((c) => c.includes('summon')).length;
  assert.equal(summons(), 1);
  const ext = await call('plugin_minecraft_build', { name: 'Kupola', extend_build: 1, parts: [{ type: 'dome', center: [0, 12, 10], radius: 3, block: 'gold_block' }] });
  await waitFor(async () => (await call('plugin_minecraft_builds')).builds.find((b) => b.id === ext.build_id && b.status === 'done'));
  assert.equal(summons(), 1);
  assert.ok(mc.state.ran.at(-3).includes('name=Majstor_1'));
  const rm = await call('plugin_minecraft_remove', { build_id: 1 });
  await waitFor(async () => (await call('plugin_minecraft_builds')).builds.find((b) => b.id === rm.build_id && b.status === 'done'));
  assert.ok(mc.state.ran.includes('execute as @e[type=armor_stand,name=Majstor_1] at @s run fill ~-3 ~0 ~7 ~3 ~11 ~13 air'));
});

test('build refuses when the player is not online', async () => {
  const { call } = load();
  await assert.rejects(call('plugin_minecraft_build', { name: 'X', player: 'Mia', parts: [{ type: 'block', at: [0, 0, 6], block: 'stone' }] }), /Mia is not online/);
  mc.state.players = [];
  await assert.rejects(call('plugin_minecraft_build', { name: 'X', parts: [{ type: 'block', at: [0, 0, 6], block: 'stone' }] }), /nobody is online/);
  await assert.rejects(call('plugin_minecraft_build', { name: 'X', parts: [{ type: 'block', at: [0, 0, 600], block: 'stone' }] }), /build plan rejected/);
});

test('wrong token is refused by the bridge', async () => {
  process.env.SHINOBI_MC_BRIDGE_TOKEN = 'wrong-token-000000000';
  const { call } = load();
  await assert.rejects(call('plugin_minecraft_say', { text: 'hi' }), /unauthorized/);
});

test('dashboard page renders', async () => {
  const { pages, call } = load();
  const page = await pages.get('minecraft').render();
  assert.equal(page.blocks[0].type, 'stats');
  assert.equal(page.blocks[0].items[0].value, 'online');
  await call('plugin_minecraft_say', { text: 'x' });
});

test('builds cut off by a restart are marked failed', async () => {
  const state = memoryStore();
  state.set('builds', [{ id: 2, name: 'A', status: 'running' }, { id: 1, name: 'B', status: 'done' }]);
  const { call } = load(state);
  const { builds } = await call('plugin_minecraft_builds');
  assert.equal(builds[0].status, 'failed');
  assert.match(builds[0].error, /restart/);
  assert.equal(builds[1].status, 'done');
});
