// shinobi-plugin-music — voice-friendly control of a local MPD music player.
//
// Install: drop this single file into the Shinobi plugins directory
// (~/.shinobi/plugins/, or /data/plugins in the Docker image) and restart.
// Zero runtime dependencies: it speaks the MPD text protocol over node:net.
//
// The plugin never reads audio files itself. MPD owns the library (tags,
// database, playback); the plugin turns "play Thompson" into MPD commands and
// returns structured facts. The LLM owns the language.
//
// Connection (read from the host process environment at call time):
//   SHINOBI_MPD_SOCKET    path to MPD's unix socket (preferred in Docker)
//   SHINOBI_MPD_HOST      TCP host when no socket is set (default 127.0.0.1)
//   SHINOBI_MPD_PORT      TCP port (default 6600)
//   SHINOBI_MPD_PASSWORD  sent with MPD's `password` command when set

import net from 'node:net';

const TIMEOUT_MS = 5000;
const MAX_QUEUE = 2000;
const LIST_LIMIT = 200;

export class MpdError extends Error {
  constructor(ackLine) {
    super(`mpd: ${ackLine.replace(/^ACK\s+/, '')}`);
    this.name = 'MpdError';
  }
}

export function mpdConfigFromEnv(env = process.env) {
  const password = env.SHINOBI_MPD_PASSWORD || undefined;
  if (env.SHINOBI_MPD_SOCKET) return { path: env.SHINOBI_MPD_SOCKET, password };
  return {
    host: env.SHINOBI_MPD_HOST || '127.0.0.1',
    port: Number(env.SHINOBI_MPD_PORT || 6600),
    password,
  };
}

/** Quote an argument for the MPD protocol. */
export function quote(value) {
  return '"' + String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}

/** Open a connection and resolve once MPD's `OK MPD x.y.z` greeting arrives. */
function connect(config, timeoutMs) {
  const sock = config.path
    ? net.createConnection({ path: config.path })
    : net.createConnection({ host: config.host, port: config.port });
  sock.setEncoding('utf8');
  sock.setTimeout(timeoutMs, () => sock.destroy(new Error(`mpd: no response within ${timeoutMs}ms`)));

  let buf = '';
  let pending = null;
  let failure = null;

  const settle = (fn, value) => {
    const p = pending;
    pending = null;
    if (p) p[fn](value);
  };
  const fail = (err) => {
    failure ??= err;
    settle('reject', failure);
  };
  sock.on('error', fail);
  sock.on('close', () => fail(new Error('mpd: connection closed')));
  sock.on('data', (chunk) => {
    buf += chunk;
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      if (!pending) continue;
      if (pending.greeting) {
        if (line.startsWith('OK MPD')) settle('resolve', []);
        else settle('reject', new Error(`mpd: unexpected greeting: ${line}`));
      } else if (line === 'OK') {
        settle('resolve', pending.lines);
      } else if (line.startsWith('ACK ')) {
        settle('reject', new MpdError(line));
      } else {
        pending.lines.push(line);
      }
    }
  });

  const wait = (greeting) =>
    new Promise((resolve, reject) => {
      if (failure) return reject(failure);
      pending = { lines: [], resolve, reject, greeting };
    });

  const greeted = wait(true);
  const client = {
    command(cmd) {
      const result = wait(false);
      sock.write(cmd + '\n');
      return result;
    },
    close() {
      sock.removeAllListeners('close');
      sock.end();
      sock.destroy();
    },
  };
  return greeted.then(
    () => client,
    (err) => {
      client.close();
      throw err;
    },
  );
}

/** Run `fn(client)` on a fresh MPD connection, authenticating first if needed. */
export async function withMpd(config, fn, timeoutMs = TIMEOUT_MS) {
  const client = await connect(config, timeoutMs);
  try {
    if (config.password) await client.command(`password ${quote(config.password)}`);
    return await fn(client);
  } finally {
    client.close();
  }
}

function pairs(lines) {
  const out = [];
  for (const line of lines) {
    const i = line.indexOf(': ');
    if (i > 0) out.push([line.slice(0, i), line.slice(i + 2)]);
  }
  return out;
}

function toObject(lines) {
  const obj = {};
  for (const [k, v] of pairs(lines)) obj[k.toLowerCase()] = v;
  return obj;
}

/** Split a song listing (search, playlistinfo) into one object per `file:`. */
export function parseSongs(lines) {
  const songs = [];
  let cur = null;
  for (const [k, v] of pairs(lines)) {
    const key = k.toLowerCase();
    if (key === 'file') {
      cur = { file: v };
      songs.push(cur);
    } else if (cur && !(key in cur)) {
      cur[key] = v;
    }
  }
  return songs;
}

function songSummary(song) {
  if (!song || !song.file) return null;
  const out = { file: song.file };
  for (const key of ['artist', 'title', 'album', 'genre']) if (song[key]) out[key] = song[key];
  return out;
}

function filterArgs(filters) {
  return filters.map(([tag, value]) => `${tag} ${quote(value)}`).join(' ');
}

/**
 * When tags miss (untagged MP3s), retry the free-text and genre terms against
 * the file path, so `Muzika/Rock/...` or `Thompson - Cavoglave.mp3` still match.
 */
function pathFallback(filters) {
  if (!filters.some(([tag]) => tag === 'any' || tag === 'genre')) return null;
  return filters.map(([tag, value]) => (tag === 'any' || tag === 'genre' ? ['file', value] : [tag, value]));
}

async function readStatus(client) {
  const status = toObject(await client.command('status'));
  const current = parseSongs(await client.command('currentsong'))[0];
  return {
    state: status.state ?? 'unknown',
    volume: status.volume !== undefined ? Number(status.volume) : null,
    queueLength: Number(status.playlistlength ?? 0),
    random: status.random === '1',
    repeat: status.repeat === '1',
    elapsedSeconds: status.elapsed !== undefined ? Math.round(Number(status.elapsed)) : null,
    durationSeconds: status.duration !== undefined ? Math.round(Number(status.duration)) : null,
    current: songSummary(current),
  };
}

const LIST_TAGS = { artists: 'artist', albums: 'album', genres: 'genre' };

export default function register(registry) {
  const config = () => mpdConfigFromEnv();

  registry.registerTool({
    name: 'plugin_music_play',
    description:
      'Play music from the local library on the home speaker. Matches are case-insensitive substrings of tags (artist, title, album, genre) or, for untagged files, of the file path. `query` searches everything ("thompson cavoglave" style requests: put the artist in `artist` and the song in `title` when you can tell them apart). Replaces the queue with every match, shuffled by default, and starts playback. With no filters it resumes playback. Returns found count and the now-playing song.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Free text matched against all tags' },
        artist: { type: 'string' },
        title: { type: 'string' },
        album: { type: 'string' },
        genre: { type: 'string', description: 'e.g. rock, pop, folk' },
        shuffle: { type: 'boolean', default: true },
      },
      additionalProperties: false,
    },
    handler: (args) =>
      withMpd(config(), async (client) => {
        const filters = [];
        for (const tag of ['artist', 'title', 'album', 'genre']) {
          if (typeof args[tag] === 'string' && args[tag].trim()) filters.push([tag, args[tag].trim()]);
        }
        if (typeof args.query === 'string' && args.query.trim()) filters.push(['any', args.query.trim()]);

        if (filters.length === 0) {
          await client.command('play');
          return { found: null, resumed: true, ...(await readStatus(client)) };
        }

        let songs = parseSongs(await client.command(`search ${filterArgs(filters)}`));
        let matchedOn = 'tags';
        if (songs.length === 0) {
          const fallback = pathFallback(filters);
          if (fallback) {
            songs = parseSongs(await client.command(`search ${filterArgs(fallback)}`));
            matchedOn = 'file path';
          }
        }
        if (songs.length === 0) {
          return {
            found: 0,
            playing: false,
            hint: 'Nothing matched. The current queue was left untouched. Call plugin_music_library to see which artists and genres exist, or plugin_music_rescan if files were just added.',
          };
        }

        const queued = songs.slice(0, MAX_QUEUE);
        const shuffle = args.shuffle !== false && queued.length > 1;
        const cmds = ['clear', ...queued.map((s) => `add ${quote(s.file)}`)];
        if (shuffle) cmds.push('shuffle');
        cmds.push('play');
        await client.command(['command_list_begin', ...cmds, 'command_list_end'].join('\n'));

        return { found: songs.length, queued: queued.length, matchedOn, shuffled: shuffle, ...(await readStatus(client)) };
      }),
  });

  registry.registerTool({
    name: 'plugin_music_control',
    description: 'Transport control for the home speaker: pause, resume, toggle, stop, next, previous. Returns the player status afterwards.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['pause', 'resume', 'toggle', 'stop', 'next', 'previous'] },
      },
      required: ['action'],
      additionalProperties: false,
    },
    handler: (args) =>
      withMpd(config(), async (client) => {
        let cmd;
        switch (args.action) {
          case 'pause':
            cmd = 'pause 1';
            break;
          case 'resume':
            cmd = 'play';
            break;
          case 'toggle': {
            const { state } = toObject(await client.command('status'));
            cmd = state === 'play' ? 'pause 1' : 'play';
            break;
          }
          case 'stop':
          case 'next':
          case 'previous':
            cmd = args.action;
            break;
          default:
            throw new Error(`unknown action: ${args.action}`);
        }
        await client.command(cmd);
        return readStatus(client);
      }),
  });

  registry.registerTool({
    name: 'plugin_music_volume',
    description: 'Set the volume to an absolute `level` (0-100) or move it by a relative `change` (e.g. +10, -15). Returns the resulting volume.',
    inputSchema: {
      type: 'object',
      properties: {
        level: { type: 'number', minimum: 0, maximum: 100 },
        change: { type: 'number', minimum: -100, maximum: 100 },
      },
      additionalProperties: false,
    },
    handler: (args) =>
      withMpd(config(), async (client) => {
        let target;
        if (typeof args.level === 'number') {
          target = args.level;
        } else if (typeof args.change === 'number') {
          const { volume } = toObject(await client.command('status'));
          if (volume === undefined || Number(volume) < 0) throw new Error('mpd reports no volume control on this output');
          target = Number(volume) + args.change;
        } else {
          throw new Error('pass `level` or `change`');
        }
        target = Math.max(0, Math.min(100, Math.round(target)));
        await client.command(`setvol ${target}`);
        return { volume: target };
      }),
  });

  registry.registerTool({
    name: 'plugin_music_status',
    description: 'What is playing on the home speaker: state, current song, volume, queue length, position.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: () => withMpd(config(), (client) => readStatus(client)),
  });

  registry.registerTool({
    name: 'plugin_music_library',
    description: 'Browse the local music library: list artists, albums (optionally of one artist) or genres. Use it to resolve what the user asked for before plugin_music_play, or to answer "what music do I have".',
    inputSchema: {
      type: 'object',
      properties: {
        list: { type: 'string', enum: ['artists', 'albums', 'genres'] },
        artist: { type: 'string', description: 'Only with list=albums: albums whose artist contains this text' },
        limit: { type: 'number', minimum: 1, maximum: 1000, default: LIST_LIMIT },
      },
      required: ['list'],
      additionalProperties: false,
    },
    handler: (args) =>
      withMpd(config(), async (client) => {
        const tag = LIST_TAGS[args.list];
        if (!tag) throw new Error(`unknown list: ${args.list}`);
        const limit = Math.max(1, Math.min(1000, Math.round(args.limit ?? LIST_LIMIT)));
        let values;
        if (tag === 'album' && typeof args.artist === 'string' && args.artist.trim()) {
          const songs = parseSongs(await client.command(`search artist ${quote(args.artist.trim())}`));
          values = songs.map((s) => s.album).filter(Boolean);
        } else {
          values = pairs(await client.command(`list ${tag}`)).map(([, v]) => v);
        }
        const unique = [...new Set(values.filter((v) => v.trim()))].sort((a, b) => a.localeCompare(b));
        return { [args.list]: unique.slice(0, limit), total: unique.length, truncated: unique.length > limit };
      }),
  });

  registry.registerTool({
    name: 'plugin_music_rescan',
    description: 'Ask MPD to rescan the music folder after files were added, renamed or removed. The scan runs in the background; new songs become playable within seconds to minutes depending on library size.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: () =>
      withMpd(config(), async (client) => {
        const res = toObject(await client.command('update'));
        return { rescanning: true, job: res.updating_db !== undefined ? Number(res.updating_db) : null };
      }),
  });
}
