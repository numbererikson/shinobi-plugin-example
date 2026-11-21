import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';

import register, { quote, parseSongs, mpdConfigFromEnv, fold, matchFolders } from '../shinobi-plugin-music.mjs';

// ---- Fake MPD ---------------------------------------------------------------
// Speaks enough of the protocol for the plugin: greeting, OK/ACK framing,
// command lists, a tiny in-memory library with substring search.

const LIBRARY = [
  { file: 'Thompson/Cavoglave.mp3', artist: 'Marko Perković Thompson', title: 'Bojna Čavoglave', album: 'Moli mala', genre: 'Rock' },
  { file: 'Thompson/Lijepa li si.mp3', artist: 'Marko Perković Thompson', title: 'Lijepa li si', album: 'Bilo jednom u Hrvatskoj', genre: 'Rock' },
  { file: 'Led Zeppelin/Kashmir.mp3', artist: 'Led Zeppelin', title: 'Kashmir', album: 'Physical Graffiti', genre: 'Rock' },
  { file: 'Pop/Untagged song.mp3' },
  { file: 'Pop/Đorđe Balašević/Ne lomite mi bagrenje.mp3' },
  { file: 'Rap/Eminem/Lose Yourself.mp3' },
  { file: 'Rap/Eminem/Rock Bottom.mp3' },
  { file: 'Rap/2Pac/Changes.mp3' },
  { file: 'Trap/Some Trap Song.mp3' },
  { file: 'Domoljubne/Bojna Čavoglave (live).mp3' },
];

const freshOutputs = () => [
  { id: 0, name: 'Kucno kino', enabled: true },
  { id: 1, name: 'Mobitel stream', enabled: false },
];
const server = { log: [], queue: [], state: 'stop', volume: 50, current: -1, password: null, nextId: 1, outputs: freshOutputs() };
let tcp;
let port;

function unquote(s) {
  return s.replace(/\\(.)/g, '$1');
}

/** Parse `search tag "v" tag "v"` into [[tag, value], ...]. */
function parseFilters(rest) {
  const out = [];
  const re = /(\w+)\s+"((?:[^"\\]|\\.)*)"/g;
  let m;
  while ((m = re.exec(rest))) out.push([m[1].toLowerCase(), unquote(m[2])]);
  return out;
}

function matches(song, [tag, value]) {
  const needle = value.toLowerCase();
  const fields = tag === 'any' ? ['artist', 'title', 'album', 'genre'].map((k) => song[k]) : [song[tag]];
  return fields.some((f) => typeof f === 'string' && f.toLowerCase().includes(needle));
}

function songLines(song) {
  const lines = [`file: ${song.file}`];
  for (const [k, label] of [['artist', 'Artist'], ['title', 'Title'], ['album', 'Album'], ['genre', 'Genre']]) {
    if (song[k]) lines.push(`${label}: ${song[k]}`);
  }
  return lines;
}

function execute(cmd) {
  server.log.push(cmd);
  const [name, ...restParts] = cmd.split(' ');
  const rest = restParts.join(' ');
  switch (name) {
    case 'password':
      if (server.password && unquote(rest.slice(1, -1)) !== server.password) return { ack: '[3@0] {password} incorrect password' };
      return { lines: [] };
    case 'search': {
      const filters = parseFilters(rest);
      return { lines: LIBRARY.filter((s) => filters.every((f) => matches(s, f))).flatMap(songLines) };
    }
    case 'clear':
      server.queue = [];
      server.current = -1;
      return { lines: [] };
    case 'add': {
      const file = unquote(rest.slice(1, -1));
      const song = LIBRARY.find((s) => s.file === file);
      if (!song) return { ack: '[50@0] {add} No such song' };
      server.queue.push({ ...song, id: server.nextId++ });
      return { lines: [] };
    }
    case 'shuffle':
      server.queue.reverse();
      return { lines: [] };
    case 'play':
      if (server.queue.length) {
        server.state = 'play';
        if (server.current < 0) server.current = 0;
      }
      return { lines: [] };
    case 'pause':
      server.state = rest === '1' ? 'pause' : 'play';
      return { lines: [] };
    case 'stop':
      server.state = 'stop';
      return { lines: [] };
    case 'next':
      if (server.current >= server.queue.length - 1) {
        server.current = -1;
        server.state = 'stop';
      } else {
        server.current += 1;
      }
      return { lines: [] };
    case 'deleteid': {
      const idx = server.queue.findIndex((s) => s.id === Number(rest));
      if (idx < 0) return { ack: '[50@0] {deleteid} No such song' };
      server.queue.splice(idx, 1);
      if (server.current > idx) server.current -= 1;
      return { lines: [] };
    }
    case 'outputs':
      return {
        lines: server.outputs.flatMap((o) => [`outputid: ${o.id}`, `outputname: ${o.name}`, 'plugin: fake', `outputenabled: ${o.enabled ? 1 : 0}`]),
      };
    case 'enableoutput':
    case 'disableoutput': {
      const out = server.outputs.find((o) => o.id === Number(rest));
      if (!out) return { ack: `[50@0] {${name}} No such audio output` };
      out.enabled = name === 'enableoutput';
      return { lines: [] };
    }
    case 'previous':
      server.current = Math.max(0, server.current - 1);
      return { lines: [] };
    case 'setvol':
      server.volume = Number(rest);
      return { lines: [] };
    case 'status': {
      const lines = [`volume: ${server.volume}`, 'repeat: 0', 'random: 0', `playlistlength: ${server.queue.length}`, `state: ${server.state}`];
      if (server.current >= 0 && server.queue[server.current]) lines.push(`songid: ${server.queue[server.current].id}`);
      return { lines };
    }
    case 'currentsong':
      return { lines: server.current >= 0 && server.queue[server.current] ? songLines(server.queue[server.current]) : [] };
    case 'list': {
      const tag = rest.trim().toLowerCase();
      const label = tag[0].toUpperCase() + tag.slice(1);
      const values = [...new Set(LIBRARY.map((s) => s[tag]).filter(Boolean))];
      return { lines: values.map((v) => `${label}: ${v}`) };
    }
    case 'update':
      return { lines: ['updating_db: 7'] };
    case 'listall': {
      const dirs = new Set();
      for (const s of LIBRARY) {
        const parts = s.file.split('/').slice(0, -1);
        for (let i = 1; i <= parts.length; i++) dirs.add(parts.slice(0, i).join('/'));
      }
      return { lines: [...[...dirs].map((d) => `directory: ${d}`), ...LIBRARY.map((s) => `file: ${s.file}`)] };
    }
    case 'random':
    case 'single':
    case 'repeat':
      server[name] = rest;
      return { lines: [] };
    default:
      return { ack: `[5@0] {${name}} unknown command "${name}"` };
  }
}

before(async () => {
  tcp = net.createServer((sock) => {
    sock.setEncoding('utf8');
    sock.write('OK MPD 0.23.5\n');
    let buf = '';
    let list = null;
    sock.on('data', (chunk) => {
      buf += chunk;
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const cmd = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (cmd === 'command_list_begin') {
          list = [];
          continue;
        }
        if (cmd === 'command_list_end') {
          const cmds = list;
          list = null;
          let failed = null;
          for (const c of cmds) {
            const r = execute(c);
            if (r.ack) {
              failed = r.ack;
              break;
            }
          }
          sock.write(failed ? `ACK ${failed}\n` : 'OK\n');
          continue;
        }
        if (list) {
          list.push(cmd);
          continue;
        }
        const r = execute(cmd);
        sock.write(r.ack ? `ACK ${r.ack}\n` : r.lines.map((l) => l + '\n').join('') + 'OK\n');
      }
    });
    sock.on('error', () => {});
  });
  await new Promise((resolve) => tcp.listen(0, '127.0.0.1', resolve));
  port = tcp.address().port;
  process.env.SHINOBI_MPD_HOST = '127.0.0.1';
  process.env.SHINOBI_MPD_PORT = String(port);
});

after(() => new Promise((resolve) => tcp.close(resolve)));

beforeEach(() => {
  Object.assign(server, { log: [], queue: [], state: 'stop', volume: 50, current: -1, password: null, nextId: 1, outputs: freshOutputs() });
  delete process.env.SHINOBI_MPD_PASSWORD;
});

/** In-memory stand-in for the host's per-plugin `registry.state`. */
function memoryStore() {
  const data = new Map();
  return {
    data,
    get: (key) => (data.has(key) ? structuredClone(data.get(key)) : null),
    set: (key, value) => data.set(key, structuredClone(value)),
    delete: (key) => data.delete(key),
    update(key, mutator) {
      const next = mutator(this.get(key));
      data.set(key, structuredClone(next));
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
  return {
    names: [...tools.keys()],
    state,
    pages,
    call: (name, args = {}) => tools.get(name).handler(args),
  };
}

// ---- Tests ------------------------------------------------------------------

test('registers the nine music tools', () => {
  const { names } = loadTools();
  assert.deepEqual(names.sort(), [
    'plugin_music_banned',
    'plugin_music_control',
    'plugin_music_dislike',
    'plugin_music_library',
    'plugin_music_output',
    'plugin_music_play',
    'plugin_music_rescan',
    'plugin_music_status',
    'plugin_music_volume',
  ]);
});

test('play by artist and title queues the match and starts playback', async () => {
  const { call } = loadTools();
  const res = await call('plugin_music_play', { artist: 'thompson', title: 'čavoglave' });
  assert.equal(res.found, 1);
  assert.equal(res.state, 'play');
  assert.equal(res.current.title, 'Bojna Čavoglave');
  assert.equal(res.shuffled, false);
  assert.ok(server.log.includes('search artist "thompson" title "čavoglave"'));
});

test('play by artist shuffles every song of that artist', async () => {
  const { call } = loadTools();
  const res = await call('plugin_music_play', { artist: 'Thompson' });
  assert.equal(res.found, 2);
  assert.equal(res.queueLength, 2);
  assert.equal(res.shuffled, true);
  assert.ok(server.log.includes('shuffle'));
});

test('play by genre queues all rock', async () => {
  const { call } = loadTools();
  const res = await call('plugin_music_play', { genre: 'rock', shuffle: false });
  assert.equal(res.found, 3);
  assert.equal(res.shuffled, false);
  assert.ok(!server.log.includes('shuffle'));
});

test('free-text query falls back to the file path for untagged files', async () => {
  const { call } = loadTools();
  const res = await call('plugin_music_play', { query: 'untagged' });
  assert.equal(res.found, 1);
  assert.ok(server.log.includes('search any "untagged"'), 'tags are tried before the path');
  assert.equal(res.matchedOn, 'file path');
  assert.equal(res.current.file, 'Pop/Untagged song.mp3');
});

test('no match leaves the current queue untouched', async () => {
  const { call } = loadTools();
  await call('plugin_music_play', { artist: 'Led Zeppelin' });
  const res = await call('plugin_music_play', { artist: 'Nobody At All' });
  assert.equal(res.found, 0);
  assert.equal(server.queue.length, 1);
  assert.equal(server.state, 'play');
});

test('play with no filters resumes', async () => {
  const { call } = loadTools();
  await call('plugin_music_play', { artist: 'Led Zeppelin' });
  await call('plugin_music_control', { action: 'pause' });
  assert.equal(server.state, 'pause');
  const res = await call('plugin_music_play', {});
  assert.equal(res.resumed, true);
  assert.equal(res.state, 'play');
});

test('control toggle flips between play and pause', async () => {
  const { call } = loadTools();
  await call('plugin_music_play', { artist: 'Led Zeppelin' });
  assert.equal((await call('plugin_music_control', { action: 'toggle' })).state, 'pause');
  assert.equal((await call('plugin_music_control', { action: 'toggle' })).state, 'play');
});

test('volume sets absolute levels and clamps relative changes', async () => {
  const { call } = loadTools();
  assert.equal((await call('plugin_music_volume', { level: 30 })).volume, 30);
  assert.equal((await call('plugin_music_volume', { change: 15 })).volume, 45);
  assert.equal((await call('plugin_music_volume', { change: 90 })).volume, 100);
  assert.equal((await call('plugin_music_volume', { change: -150 })).volume, 0);
  await assert.rejects(call('plugin_music_volume', {}), /level` or `change/);
});

test('library lists artists, genres and albums of one artist', async () => {
  const { call } = loadTools();
  const artists = await call('plugin_music_library', { list: 'artists' });
  assert.deepEqual(artists.artists, ['Led Zeppelin', 'Marko Perković Thompson']);
  const genres = await call('plugin_music_library', { list: 'genres' });
  assert.deepEqual(genres.genres, ['Rock']);
  const albums = await call('plugin_music_library', { list: 'albums', artist: 'thompson' });
  assert.deepEqual(albums.albums, ['Bilo jednom u Hrvatskoj', 'Moli mala']);
});

test('rescan triggers an MPD database update', async () => {
  const { call } = loadTools();
  assert.deepEqual(await call('plugin_music_rescan'), { rescanning: true, job: 7 });
});

test('password is sent first and a wrong one surfaces as an error', async () => {
  const { call } = loadTools();
  server.password = 'tajna';
  process.env.SHINOBI_MPD_PASSWORD = 'tajna';
  await call('plugin_music_status');
  assert.equal(server.log[0], 'password "tajna"');
  process.env.SHINOBI_MPD_PASSWORD = 'kriva';
  await assert.rejects(call('plugin_music_status'), /incorrect password/);
});

test('an unreachable MPD rejects instead of hanging', async () => {
  const { call } = loadTools();
  process.env.SHINOBI_MPD_PORT = '1';
  try {
    await assert.rejects(call('plugin_music_status'));
  } finally {
    process.env.SHINOBI_MPD_PORT = String(port);
  }
});

test('quote escapes quotes and backslashes', () => {
  assert.equal(quote('a "b" \\c'), '"a \\"b\\" \\\\c"');
});

test('parseSongs groups lines per file and keeps the first value of a tag', () => {
  const songs = parseSongs(['file: a.mp3', 'Artist: X', 'Artist: Y', 'file: b.mp3', 'Title: T']);
  assert.deepEqual(songs, [{ file: 'a.mp3', artist: 'X' }, { file: 'b.mp3', title: 'T' }]);
});

test('config prefers the unix socket when set', () => {
  assert.deepEqual(mpdConfigFromEnv({ SHINOBI_MPD_SOCKET: '/mpd/socket' }), { path: '/mpd/socket', password: undefined });
  assert.deepEqual(mpdConfigFromEnv({}), { host: '127.0.0.1', port: 6600, password: undefined });
});

test('dislike skips the song, drops it from the queue and bans it without touching files', async () => {
  const { call, state } = loadTools();
  await call('plugin_music_play', { artist: 'Thompson', shuffle: false });
  const first = server.queue[0];
  const res = await call('plugin_music_dislike');
  assert.equal(res.banned.file, first.file);
  assert.equal(res.deletedFile, false);
  assert.equal(server.queue.length, 1);
  assert.ok(!server.queue.some((s) => s.file === first.file));
  assert.equal(res.state, 'play');
  assert.deepEqual(state.get('banned').map((b) => b.file), [first.file]);
  assert.ok(!server.log.some((c) => /^(rm|delete)\b/.test(c)), 'never issues a file-level delete');
});

test('banned songs are never queued again', async () => {
  const { call } = loadTools();
  await call('plugin_music_play', { artist: 'Thompson', title: 'Čavoglave' });
  await call('plugin_music_dislike');
  const res = await call('plugin_music_play', { artist: 'Thompson' });
  assert.equal(res.found, 1);
  assert.equal(res.skippedBanned, 1);
  assert.equal(server.queue[0].title, 'Lijepa li si');
});

test('playing only banned songs leaves the queue alone and says why', async () => {
  const { call } = loadTools();
  await call('plugin_music_play', { title: 'Kashmir' });
  await call('plugin_music_dislike');
  await call('plugin_music_play', { title: 'Lijepa li si' });
  const res = await call('plugin_music_play', { title: 'Kashmir' });
  assert.equal(res.found, 0);
  assert.equal(res.skippedBanned, 1);
  assert.match(res.hint, /banned/);
  assert.equal(server.queue[0].title, 'Lijepa li si');
});

test('banned list can be shown and restored', async () => {
  const { call } = loadTools();
  await call('plugin_music_play', { title: 'Kashmir' });
  await call('plugin_music_dislike');
  assert.equal((await call('plugin_music_banned')).banned.length, 1);
  const res = await call('plugin_music_banned', { restore: 'kashmir' });
  assert.equal(res.restored.length, 1);
  assert.deepEqual(res.banned, []);
  assert.equal((await call('plugin_music_play', { title: 'Kashmir' })).found, 1);
});

test('dislike with nothing playing is a no-op', async () => {
  const { call, state } = loadTools();
  const res = await call('plugin_music_dislike');
  assert.equal(res.banned, null);
  assert.equal(state.get('banned'), null);
});

test('dislike needs the host state store', async () => {
  const { call } = loadTools({ state: null });
  await call('plugin_music_play', { title: 'Kashmir' });
  await assert.rejects(call('plugin_music_dislike'), /plugin state store/);
  assert.equal((await call('plugin_music_play', { title: 'Kashmir' })).found, 1, 'play still works without state');
});

test('output switches between the speaker and the phone stream', async () => {
  const { call } = loadTools();
  const listed = await call('plugin_music_output');
  assert.deepEqual(listed.outputs.map((o) => o.name), ['Kucno kino', 'Mobitel stream']);

  let res = await call('plugin_music_output', { target: 'mobitel' });
  assert.deepEqual(res.outputs.map((o) => o.enabled), [false, true]);

  res = await call('plugin_music_output', { target: 'kino', mode: 'add' });
  assert.deepEqual(res.outputs.map((o) => o.enabled), [true, true]);

  await assert.rejects(call('plugin_music_output', { target: 'kuhinja' }), /no output matches/);
});

test('a genre folder plays everything below it, subfolders included', async () => {
  const { call } = loadTools();
  const res = await call('plugin_music_play', { query: 'rap' });
  assert.equal(res.matchedOn, 'folder');
  assert.equal(res.found, 3);
  assert.deepEqual(server.queue.map((s) => s.file).sort(), ['Rap/2Pac/Changes.mp3', 'Rap/Eminem/Lose Yourself.mp3', 'Rap/Eminem/Rock Bottom.mp3']);
  assert.ok(!server.queue.some((s) => s.file.startsWith('Trap/')), 'an exact folder name beats a substring');
});

test('an artist folder plays only that artist', async () => {
  const { call } = loadTools();
  const res = await call('plugin_music_play', { artist: 'Eminem' });
  assert.equal(res.matchedOn, 'folder');
  assert.equal(res.found, 2);
  assert.ok(server.queue.every((s) => s.file.startsWith('Rap/Eminem/')));
});

test('folder names match without diacritics', async () => {
  const { call } = loadTools();
  const res = await call('plugin_music_play', { query: 'dorde balasevic' });
  assert.equal(res.matchedOn, 'folder');
  assert.equal(res.current.file, 'Pop/Đorđe Balašević/Ne lomite mi bagrenje.mp3');
});

test('a song title in a file name does not hijack a genre request', async () => {
  const { call } = loadTools();
  const res = await call('plugin_music_play', { genre: 'rock' });
  // No Rock/ folder here, so tags decide: the three Rock-tagged songs, not "Rock Bottom.mp3".
  assert.equal(res.matchedOn, 'tags');
  assert.equal(res.found, 3);
});

test('untagged artist and title are found in the path, diacritics ignored', async () => {
  const { call } = loadTools();
  const res = await call('plugin_music_play', { artist: 'eminem', title: 'lose yourself' });
  assert.equal(res.matchedOn, 'file path');
  assert.equal(res.current.file, 'Rap/Eminem/Lose Yourself.mp3');
  const live = await call('plugin_music_play', { query: 'cavoglave live' });
  assert.equal(live.current.file, 'Domoljubne/Bojna Čavoglave (live).mp3');
});

test('a shuffled queue plays each song once, then starts over', async () => {
  const { call } = loadTools();
  await call('plugin_music_play', { query: 'rap' });
  const tail = server.log.slice(server.log.indexOf('shuffle'));
  assert.deepEqual(tail.slice(0, 5), ['shuffle', 'random 0', 'single 0', 'repeat 1', 'play']);
});

test('fold lowercases and strips Croatian diacritics', () => {
  assert.equal(fold('Čavoglave Đorđe Šćepan Žuti'), 'cavoglave dorde scepan zuti');
});

test('matchFolders prefers an exact folder name and returns nothing for a file-name hit', () => {
  const files = ['Rock/A/x.mp3', 'Rock/B/y.mp3', 'Punk Rock/z.mp3', 'Rap/Rock Bottom.mp3'];
  assert.deepEqual(matchFolders(files, 'rock'), ['Rock/A/x.mp3', 'Rock/B/y.mp3']);
  assert.deepEqual(matchFolders(files, 'punk'), ['Punk Rock/z.mp3']);
  assert.deepEqual(matchFolders(files, 'bottom'), []);
});

test('dashboard page shows the player and only uses the plugin\'s own tools', async () => {
  const { call, pages, names } = loadTools();
  assert.deepEqual([...pages.keys()], ['music']);
  await call('plugin_music_play', { artist: 'Led Zeppelin' });
  await call('plugin_music_dislike');
  await call('plugin_music_play', { query: 'rap', shuffle: false });
  const { blocks, refreshSeconds } = await pages.get('music').render();
  assert.equal(refreshSeconds, 5);
  const stats = blocks.find((b) => b.type === 'stats');
  assert.equal(stats.items.find((i) => i.label === 'State').value, 'Playing');
  assert.equal(stats.items.find((i) => i.label === 'Plays on').value, 'Kucno kino');
  const buttons = blocks.filter((b) => b.type === 'actions').flatMap((b) => b.buttons);
  assert.ok(buttons.every((b) => names.includes(b.tool)), 'every button targets a music tool');
  assert.ok(buttons.some((b) => b.tool === 'plugin_music_play' && b.args.query === 'Rap' && b.label === 'Rap (3)'));
  assert.ok(buttons.some((b) => b.tool === 'plugin_music_output' && b.args.target === 'Mobitel stream'));
  const bannedList = blocks.find((b) => b.type === 'list');
  assert.equal(bannedList.items[0].title, 'Kashmir');
});

test('hosts without registerPage still load every tool', () => {
  const { names, pages } = loadTools({ pages: false });
  assert.equal(names.length, 9);
  assert.equal(pages.size, 0);
});
