import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';

import register, { quote, parseSongs, mpdConfigFromEnv } from '../shinobi-plugin-music.mjs';

// ---- Fake MPD ---------------------------------------------------------------
// Speaks enough of the protocol for the plugin: greeting, OK/ACK framing,
// command lists, a tiny in-memory library with substring search.

const LIBRARY = [
  { file: 'Thompson/Cavoglave.mp3', artist: 'Marko Perković Thompson', title: 'Bojna Čavoglave', album: 'Moli mala', genre: 'Rock' },
  { file: 'Thompson/Lijepa li si.mp3', artist: 'Marko Perković Thompson', title: 'Lijepa li si', album: 'Bilo jednom u Hrvatskoj', genre: 'Rock' },
  { file: 'Led Zeppelin/Kashmir.mp3', artist: 'Led Zeppelin', title: 'Kashmir', album: 'Physical Graffiti', genre: 'Rock' },
  { file: 'Pop/Untagged song.mp3' },
];

const server = { log: [], queue: [], state: 'stop', volume: 50, current: -1, password: null };
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
      server.queue.push(song);
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
      server.current = Math.min(server.queue.length - 1, server.current + 1);
      return { lines: [] };
    case 'previous':
      server.current = Math.max(0, server.current - 1);
      return { lines: [] };
    case 'setvol':
      server.volume = Number(rest);
      return { lines: [] };
    case 'status':
      return {
        lines: [`volume: ${server.volume}`, 'repeat: 0', 'random: 0', `playlistlength: ${server.queue.length}`, `state: ${server.state}`],
      };
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
  Object.assign(server, { log: [], queue: [], state: 'stop', volume: 50, current: -1, password: null });
  delete process.env.SHINOBI_MPD_PASSWORD;
});

function loadTools() {
  const tools = new Map();
  register({
    registerTool(def) {
      assert.match(def.name, /^plugin_[a-z][a-z0-9_]*$/);
      assert.ok(!tools.has(def.name), `duplicate ${def.name}`);
      tools.set(def.name, def);
    },
    state: null,
  });
  return {
    names: [...tools.keys()],
    call: (name, args = {}) => tools.get(name).handler(args),
  };
}

// ---- Tests ------------------------------------------------------------------

test('registers the six music tools', () => {
  const { names } = loadTools();
  assert.deepEqual(names.sort(), [
    'plugin_music_control',
    'plugin_music_library',
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
