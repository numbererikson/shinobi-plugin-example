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
import { existsSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

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

/**
 * Announcements ("say this on the speaker"). The plugin drops the text into a
 * folder shared with the host; a tiny host helper turns it into a WAV with
 * espeak-ng inside the music folder and answers with `<id>.done`. MPD then
 * plays it between songs. Defaults follow the MPD socket mount (/mpd/say).
 */
export function sayConfigFromEnv(env = process.env) {
  const dir = env.SHINOBI_SAY_DIR || (env.SHINOBI_MPD_SOCKET ? join(dirname(env.SHINOBI_MPD_SOCKET), 'say') : null);
  const folder = (env.SHINOBI_SAY_FOLDER || '_shinobi_say').replace(/^\/+|\/+$/g, '');
  const presets = (env.SHINOBI_SAY_PRESETS || '')
    .split('|')
    .map((p) => p.trim())
    .filter(Boolean)
    .slice(0, 8);
  return { dir, folder, presets, ttsTimeoutMs: Number(env.SHINOBI_SAY_TIMEOUT_MS) || 15_000 };
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

/** Lowercase and strip diacritics, so "cavoglave" finds "Čavoglave" and "dorde" finds "Đorđe". */
export function fold(text) {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .trim();
}

/** Every file in the library, from `listall` (directories are implied by the paths). */
async function listFiles(client) {
  return pairs(await client.command('listall'))
    .filter(([k]) => k.toLowerCase() === 'file')
    .map(([, v]) => v);
}

/**
 * Folder match: the library is organised as `Genre/Artist/song.mp3`, so a single
 * spoken term ("rock", "led zeppelin", "eminem") is first looked up as a folder
 * name. A folder whose name equals the term wins over one that merely contains
 * it ("rap" picks `Rap/`, not `Trap/`). Every file below the matched folders is
 * returned, subfolders included, so "rock" plays all of `Rock/` and "led
 * zeppelin" only `Rock/Led Zeppelin/`.
 */
export function matchFolders(files, term) {
  const needle = fold(term);
  if (!needle) return [];
  const dirs = new Set();
  for (const file of files) {
    const parts = file.split('/').slice(0, -1);
    for (let i = 1; i <= parts.length; i++) dirs.add(parts.slice(0, i).join('/'));
  }
  const segment = (dir) => fold(dir.slice(dir.lastIndexOf('/') + 1));
  let hits = [...dirs].filter((d) => segment(d) === needle);
  if (hits.length === 0) hits = [...dirs].filter((d) => segment(d).includes(needle));
  if (hits.length === 0) return [];
  return files.filter((f) => hits.some((d) => f.startsWith(d + '/')));
}

/**
 * Path match for untagged files: every requested word must appear somewhere in
 * the file path, in any order, diacritics ignored, so artist "thompson" + title "cavoglave"
 * finds `Domoljubne/Thompson/Bojna Čavoglave.mp3`.
 */
export function matchPaths(files, terms) {
  const needles = terms.flatMap((t) => fold(t).split(/\s+/)).filter(Boolean);
  if (needles.length === 0) return [];
  return files.filter((f) => {
    const path = fold(f);
    return needles.every((n) => path.includes(n));
  });
}

function shuffleInPlace(items) {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
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

async function listOutputs(client) {
  const outs = [];
  for (const [k, v] of pairs(await client.command('outputs'))) {
    if (k === 'outputid') outs.push({ id: Number(v) });
    else if (outs.length && k === 'outputname') outs[outs.length - 1].name = v;
    else if (outs.length && k === 'outputenabled') outs[outs.length - 1].enabled = v === '1';
  }
  return outs;
}

const LIST_TAGS = { artists: 'artist', albums: 'album', genres: 'genre' };

const BANNED_KEY = 'banned';

export default function register(registry) {
  const config = () => mpdConfigFromEnv();

  // The "don't play this again" list lives in Shinobi's per-plugin state, never
  // on disk next to the music: banning only hides a file from future queues.
  const store = registry.state;
  const banned = () => (store ? store.get(BANNED_KEY) ?? [] : []);
  const requireStore = () => {
    if (!store) throw new Error('this Shinobi host has no plugin state store (needs Shinobi >= 0.3.2)');
    return store;
  };

  registry.registerTool({
    name: 'plugin_music_play',
    description:
      'Play music from the local library on the home speaker. The library is organised in folders like `Rock/Led Zeppelin/` or `Rap/Eminem/`: a single term ("rock", "led zeppelin", "eminem") passed as `query` plays everything in the folder of that name, subfolders included. Otherwise matches are case-insensitive, diacritic-insensitive substrings of tags (artist, title, album, genre) or of the file path; for a specific song put the artist in `artist` and the song in `title`. Replaces the queue with every match, shuffled once so nothing repeats until all have played, and starts playback. With no filters it resumes playback. Returns found count, what it matched on (folder, tags, file path) and the now-playing song.',
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

        // 1. One term ("rock", "eminem") → a folder of that name, whole subtree.
        // 2. MPD tag search. 3. Every term somewhere in the file path (untagged files).
        let songs = [];
        let matchedOn = null;
        let files = null;
        const allFiles = async () => (files ??= await listFiles(client));
        if (filters.length === 1 && filters[0][0] !== 'title') {
          songs = matchFolders(await allFiles(), filters[0][1]).map((file) => ({ file }));
          if (songs.length) matchedOn = 'folder';
        }
        if (songs.length === 0) {
          songs = parseSongs(await client.command(`search ${filterArgs(filters)}`));
          if (songs.length) matchedOn = 'tags';
        }
        if (songs.length === 0) {
          songs = matchPaths(await allFiles(), filters.map(([, value]) => value)).map((file) => ({ file }));
          if (songs.length) matchedOn = 'file path';
        }
        const bannedFiles = new Set(banned().map((b) => b.file));
        // Announcement clips live in the music folder but are never music.
        const sayFolder = sayConfigFromEnv().folder + '/';
        songs = songs.filter((s) => !s.file.startsWith(sayFolder));
        const matched = songs.length;
        songs = songs.filter((s) => !bannedFiles.has(s.file));
        if (songs.length === 0) {
          return {
            found: 0,
            skippedBanned: matched,
            playing: false,
            hint:
              matched > 0
                ? 'Every match is on the banned list. The current queue was left untouched. plugin_music_banned can list or restore them.'
                : 'Nothing matched. The current queue was left untouched. Call plugin_music_library to see which artists and genres exist, or plugin_music_rescan if files were just added.',
          };
        }

        const wantShuffle = args.shuffle !== false;
        // Sample before truncating, so a huge folder is not always its first MAX_QUEUE files.
        const queued = (wantShuffle && songs.length > MAX_QUEUE ? shuffleInPlace([...songs]) : songs).slice(0, MAX_QUEUE);
        const shuffle = wantShuffle && queued.length > 1;
        // The queue is shuffled once and played in order: every song plays once
        // before any repeats (random mode off), then the whole list starts over.
        const cmds = ['clear', ...queued.map((s) => `add ${quote(s.file)}`)];
        if (shuffle) cmds.push('shuffle');
        cmds.push('random 0', 'single 0', 'repeat 1', 'play');
        await client.command(['command_list_begin', ...cmds, 'command_list_end'].join('\n'));

        return {
          found: songs.length,
          skippedBanned: matched - songs.length,
          queued: queued.length,
          matchedOn,
          shuffled: shuffle,
          ...(await readStatus(client)),
        };
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
    name: 'plugin_music_dislike',
    description:
      'The user does not want to hear the current song ("this one annoys me", "remove it"). Skips it, removes it from the current queue and puts it on the banned list so plugin_music_play never queues it again. The file itself is NEVER deleted; plugin_music_banned can restore it.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: () =>
      withMpd(config(), async (client) => {
        const s = requireStore();
        const { songid } = toObject(await client.command('status'));
        const song = songSummary(parseSongs(await client.command('currentsong'))[0]);
        if (!song || songid === undefined) return { banned: null, hint: 'Nothing is playing.' };

        s.update(BANNED_KEY, (cur) => {
          const list = cur ?? [];
          if (list.some((b) => b.file === song.file)) return list;
          return [...list, { ...song, bannedAt: new Date().toISOString() }];
        });
        await client.command('next');
        await client.command(`deleteid ${songid}`);
        return { banned: song, deletedFile: false, ...(await readStatus(client)) };
      }),
  });

  registry.registerTool({
    name: 'plugin_music_banned',
    description:
      'Show the banned ("don\'t play again") list, or restore songs to it. `restore` is a case-insensitive substring matched against file, artist and title; every match is taken off the list.',
    inputSchema: {
      type: 'object',
      properties: {
        restore: { type: 'string' },
      },
      additionalProperties: false,
    },
    handler: (args) => {
      if (typeof args.restore === 'string' && args.restore.trim()) {
        const needle = args.restore.trim().toLowerCase();
        const hit = (b) => [b.file, b.artist, b.title].some((v) => typeof v === 'string' && v.toLowerCase().includes(needle));
        let restored = [];
        const list = requireStore().update(BANNED_KEY, (cur) => {
          const all = cur ?? [];
          restored = all.filter(hit);
          return all.filter((b) => !hit(b));
        });
        return { restored, banned: list };
      }
      return { banned: banned() };
    },
  });

  registry.registerTool({
    name: 'plugin_music_output',
    description:
      'List the player outputs (e.g. the home speaker and a phone/browser stream) or choose where music plays. `target` is a case-insensitive substring of an output name. mode "only" (default) enables that output and disables the rest; "add" enables it alongside the others.',
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string' },
        mode: { type: 'string', enum: ['only', 'add'], default: 'only' },
      },
      additionalProperties: false,
    },
    handler: (args) =>
      withMpd(config(), async (client) => {
        const readOutputs = () => listOutputs(client);
        const outputs = await readOutputs();
        if (typeof args.target !== 'string' || !args.target.trim()) return { outputs };

        const needle = args.target.trim().toLowerCase();
        const chosen = outputs.filter((o) => (o.name ?? '').toLowerCase().includes(needle));
        if (chosen.length === 0) {
          throw new Error(`no output matches "${args.target}". Available: ${outputs.map((o) => o.name).join(', ')}`);
        }
        const chosenIds = new Set(chosen.map((o) => o.id));
        const cmds = chosen.map((o) => `enableoutput ${o.id}`);
        if (args.mode !== 'add') {
          for (const o of outputs) if (!chosenIds.has(o.id)) cmds.push(`disableoutput ${o.id}`);
        }
        await client.command(['command_list_begin', ...cmds, 'command_list_end'].join('\n'));
        return { outputs: await readOutputs() };
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

  registry.registerTool({
    name: 'plugin_music_say',
    description:
      'Say a short message out loud on the home speaker ("tell my wife in the basement that lunch is ready" → text "Ručak je gotov"). Speaks Croatian by default. If music is playing it is interrupted for the message and then continues where it was. Put only the words to be spoken in `text`.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'The words to speak, max 500 characters' },
        wait: { type: 'boolean', description: 'Wait until the message has finished playing (default false)' },
      },
      required: ['text'],
      additionalProperties: false,
    },
    handler: (args) => speak(config(), sayConfigFromEnv(), args.text, { wait: args.wait === true }),
  });

  // Dashboard page (Shinobi >= 0.4.0): sidebar → Apps → Music.
  if (typeof registry.registerPage === 'function') {
    registry.registerPage({
      id: 'music',
      title: 'Music',
      icon: 'music',
      order: 10,
      render: () => renderMusicPage(config(), banned()),
    });
  }
}

const fmtTime = (secs) => `${Math.floor(secs / 60)}:${String(Math.floor(secs % 60)).padStart(2, '0')}`;
const fileTitle = (file) => file.slice(file.lastIndexOf('/') + 1).replace(/\.[a-z0-9]{2,4}$/i, '');

/** Blocks for the dashboard page; buttons call this plugin's own tools. */
export async function renderMusicPage(config, bannedList) {
  const say = sayConfigFromEnv();
  const { status, outputs, files } = await withMpd(config, async (client) => ({
    status: await readStatus(client),
    outputs: await listOutputs(client),
    files: await listFiles(client),
  }));

  const song = status.current;
  const stateLabel = { play: 'Playing', pause: 'Paused', stop: 'Stopped' }[status.state] ?? status.state;
  const enabled = outputs.filter((o) => o.enabled).map((o) => o.name);
  const blocks = [
    {
      type: 'stats',
      items: [
        { label: 'Now playing', value: song ? song.title ?? fileTitle(song.file) : '—', hint: song?.artist ?? (song ? song.file.split('/').slice(0, -1).join(' / ') : undefined) },
        { label: 'State', value: stateLabel, tone: status.state === 'play' ? 'ok' : 'muted' },
        { label: 'Volume', value: status.volume === null || status.volume < 0 ? '—' : `${status.volume}%` },
        { label: 'Queue', value: `${status.queueLength} songs` },
        { label: 'Plays on', value: enabled.join(', ') || 'nothing', tone: enabled.length ? 'default' : 'warn' },
      ],
    },
  ];
  if (status.durationSeconds) {
    blocks.push({ type: 'progress', label: 'Position', value: status.elapsedSeconds ?? 0, max: status.durationSeconds, hint: `${fmtTime(status.elapsedSeconds ?? 0)} / ${fmtTime(status.durationSeconds)}` });
  }
  blocks.push({
    type: 'actions',
    buttons: [
      { label: '⏮ Previous', tool: 'plugin_music_control', args: { action: 'previous' } },
      { label: status.state === 'play' ? '⏸ Pause' : '▶ Play', tool: 'plugin_music_control', args: { action: 'toggle' }, variant: 'primary' },
      { label: '⏭ Next', tool: 'plugin_music_control', args: { action: 'next' } },
      { label: '− Quieter', tool: 'plugin_music_volume', args: { change: -10 } },
      { label: '+ Louder', tool: 'plugin_music_volume', args: { change: 10 } },
      { label: '👎 Skip & never again', tool: 'plugin_music_dislike', variant: 'danger', confirm: 'Skip this song and keep it out of future queues? The file stays on disk.' },
    ],
  });

  // One button per top-level folder (the genre folders): Rock, Rap, …
  const folders = new Map();
  for (const f of files) {
    const i = f.indexOf('/');
    if (i > 0 && f.slice(0, i) !== say.folder) folders.set(f.slice(0, i), (folders.get(f.slice(0, i)) ?? 0) + 1);
  }
  if (say.dir) {
    blocks.push({ type: 'heading', text: 'Announce' });
    blocks.push({ type: 'input', placeholder: 'Type a message to say on the speaker', button: '🔊 Say', tool: 'plugin_music_say', arg: 'text', maxLength: 500 });
    if (say.presets.length) {
      blocks.push({ type: 'actions', buttons: say.presets.map((p) => ({ label: `🔊 ${p}`, tool: 'plugin_music_say', args: { text: p } })) });
    }
  }

  blocks.push({ type: 'heading', text: 'Play a folder' });
  if (folders.size) {
    blocks.push({
      type: 'actions',
      buttons: [...folders.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .slice(0, 12)
        .map(([name, count]) => ({ label: `${name} (${count})`, tool: 'plugin_music_play', args: { query: name } })),
    });
  } else {
    blocks.push({ type: 'text', text: 'No folders in the music library yet.', tone: 'muted' });
  }

  if (outputs.length > 1) {
    blocks.push({ type: 'heading', text: 'Where it plays' });
    blocks.push({
      type: 'actions',
      buttons: outputs.map((o) => ({
        label: `${o.enabled && enabled.length === 1 ? '● ' : ''}${o.name}`,
        tool: 'plugin_music_output',
        args: { target: o.name, mode: 'only' },
        variant: o.enabled && enabled.length === 1 ? 'primary' : 'default',
      })),
    });
  }

  blocks.push({ type: 'heading', text: `Banned songs (${bannedList.length})` });
  blocks.push({
    type: 'list',
    items: bannedList.slice(-30).reverse().map((b) => ({ title: b.title ?? fileTitle(b.file), subtitle: b.artist ? `${b.artist} — ${b.file}` : b.file })),
    empty: 'Nothing banned.',
  });

  return { blocks, refreshSeconds: 5 };
}

// ---- announcements ------------------------------------------------------------

const SAY_POLL_MS = 200;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(check, timeoutMs, message) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const v = await check();
    if (v) return v;
    if (Date.now() > end) throw new Error(message);
    await sleep(SAY_POLL_MS);
  }
}

/**
 * Speak `text` on the speaker: hand it to the host helper, wait for the WAV,
 * slot it in after the current song, play it, then put the interrupted song
 * back at the second it was at. Returns once the message starts playing
 * unless `wait` is set.
 */
export async function speak(mpd, say, rawText, { wait = false } = {}) {
  const text = String(rawText ?? '').replace(/\s+/g, ' ').trim();
  if (!text) throw new Error('nothing to say');
  if (text.length > 500) throw new Error('message too long (max 500 characters)');
  if (!say.dir) throw new Error('announcements need SHINOBI_MPD_SOCKET (or SHINOBI_SAY_DIR) so the host helper can be reached');
  if (!existsSync(say.dir)) {
    throw new Error(`announcement folder ${say.dir} is missing: set up the host helper (music README → Announcements)`);
  }

  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const txt = join(say.dir, `${id}.txt`);
  const done = join(say.dir, `${id}.done`);
  writeFileSync(join(say.dir, `${id}.tmp`), text + '\n', 'utf8');
  renameSync(join(say.dir, `${id}.tmp`), txt); // the helper only ever sees complete files
  try {
    await waitFor(() => existsSync(done), say.ttsTimeoutMs, 'the speech helper did not answer: is shinobi-say.path running on the host? (music README → Announcements)');
  } finally {
    for (const f of [txt, done]) {
      try {
        unlinkSync(f);
      } catch {
        /* already gone */
      }
    }
  }

  const uri = `${say.folder}/${id}.wav`;
  const started = await withMpd(mpd, async (client) => {
    await client.command(`update ${quote(say.folder)}`);
    const clip = await waitFor(
      async () => {
        try {
          return parseSongs(await client.command(`lsinfo ${quote(uri)}`))[0] ?? null;
        } catch {
          return null;
        }
      },
      8000,
      'MPD did not pick up the message file: is the music folder shared with the speech helper?',
    );
    const before = toObject(await client.command('status'));
    const playing = before.state === 'play' || before.state === 'pause';
    const pos = playing && before.song !== undefined ? Number(before.song) + 1 : Number(before.playlistlength ?? 0);
    const added = toObject(await client.command(`addid ${quote(uri)} ${pos}`));
    const msgId = added.id;
    await client.command(`playid ${msgId}`);
    const seconds = Number(clip.duration ?? clip.time ?? 10);
    return { before, msgId, seconds };
  });

  const restore = async () => {
    const { before, msgId, seconds } = started;
    // Wait until MPD has moved past the message (or the user did something else).
    await waitFor(
      () => withMpd(mpd, async (client) => {
        const st = toObject(await client.command('status'));
        return st.songid !== msgId || st.state !== 'play';
      }),
      (seconds + 15) * 1000,
      'message did not finish',
    ).catch(() => null);
    await withMpd(mpd, async (client) => {
      if ((before.state === 'play' || before.state === 'pause') && before.songid !== undefined) {
        try {
          await client.command(`playid ${before.songid}`);
          if (before.elapsed !== undefined) await client.command(`seekid ${before.songid} ${Number(before.elapsed).toFixed(1)}`);
          if (before.state === 'pause') await client.command('pause 1');
        } catch {
          /* the old song was removed meanwhile: just keep playing */
        }
      } else {
        await client.command('stop');
      }
      try {
        await client.command(`deleteid ${msgId}`);
      } catch {
        /* already removed */
      }
    });
  };

  const result = { spoken: text, interruptedMusic: started.before.state === 'play', seconds: Math.round(started.seconds) };
  if (wait) {
    await restore();
    return { ...result, finished: true };
  }
  restore().catch(() => {
    /* best effort: the message itself already played */
  });
  return { ...result, finished: false };
}

