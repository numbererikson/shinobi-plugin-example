// mc-bridge: the only thing that can talk to the Minecraft Bedrock server.
//
// Runs next to the server with the Docker socket mounted, so Shinobi itself
// never gets Docker access. It accepts a short whitelist of console commands
// (building, chat, player lists) over HTTP with a bearer token, runs them one
// by one with `send-command` inside the server container, and hands back
// recent console lines so callers can read command output (e.g. `list`).
//
//   POST /commands  {"commands": ["fill ...", ...]}  → {"ok": true, "ran": n}
//   GET  /logs?since=<unix seconds>                  → {"lines": [...]}
//   GET  /health                                      → {"ok": true}
//
// Env: BRIDGE_TOKEN (required), MC_CONTAINER (default "minecraft"),
//      PORT (default 8790), DOCKER_SOCKET (default /var/run/docker.sock).
import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { timingSafeEqual } from 'node:crypto';

const MAX_COMMANDS = 20000;
const MAX_COMMAND_LENGTH = 400;

// First word → extra check. Anything else is refused.
const ALLOWED = {
  fill: () => true,
  setblock: () => true,
  clone: () => true,
  say: () => true,
  tellraw: () => true,
  list: () => true,
  querytarget: () => true,
  tickingarea: () => true,
  summon: (rest) => /^armor_stand\b/.test(rest),
  kill: (rest) => /^@e\[type=armor_stand,name=[A-Za-z0-9_]+\]$/.test(rest),
};

const EXECUTE = /^execute (?:as @e\[type=armor_stand,name=[A-Za-z0-9_]+\] at @s|at (?:"[A-Za-z0-9_ ]{1,32}"|[A-Za-z0-9_]{1,32})) run (.+)$/;

/** True when the console command only builds, chats or reads (also inside `execute … run`). */
export function isAllowedCommand(command) {
  if (typeof command !== 'string') return false;
  const cmd = command.trim().replace(/^\//, '');
  if (!cmd || cmd.length > MAX_COMMAND_LENGTH || /[\r\n]/.test(cmd)) return false;
  const [word, ...rest] = cmd.split(' ');
  const tail = rest.join(' ');
  if (word === 'execute') {
    // Only the two anchors the plugin uses; anything fancier could hide a
    // second ` run ` inside a quoted selector.
    const m = EXECUTE.exec(cmd);
    return m !== null && !m[1].startsWith('execute ') && isAllowedCommand(m[1]);
  }
  const check = ALLOWED[word];
  return check ? check(tail) : false;
}

/** Docker Engine API over the unix socket. */
export function makeDocker(socketPath) {
  function call(method, path, body) {
    return new Promise((resolve, reject) => {
      const data = body === undefined ? undefined : JSON.stringify(body);
      const req = http.request(
        {
          socketPath,
          path,
          method,
          headers: data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {},
        },
        (res) => {
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => {
            const buf = Buffer.concat(chunks);
            if ((res.statusCode ?? 500) >= 400) reject(new Error(`docker ${method} ${path}: ${res.statusCode} ${buf.toString().slice(0, 200)}`));
            else resolve(buf);
          });
        },
      );
      req.on('error', reject);
      req.setTimeout(15000, () => req.destroy(new Error('docker API timeout')));
      if (data) req.write(data);
      req.end();
    });
  }
  return { call };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Run one console command in the server container and wait until it has been handed over. */
export async function sendCommand(docker, container, command) {
  const created = JSON.parse((await docker.call('POST', `/containers/${encodeURIComponent(container)}/exec`, {
    AttachStdout: false,
    AttachStderr: false,
    Cmd: ['send-command', command],
  })).toString());
  await docker.call('POST', `/exec/${created.Id}/start`, { Detach: true });
  for (let i = 0; i < 200; i++) {
    const info = JSON.parse((await docker.call('GET', `/exec/${created.Id}/json`)).toString());
    if (!info.Running) {
      if (info.ExitCode) throw new Error(`send-command exited with ${info.ExitCode} (is the Minecraft server running?)`);
      return 0;
    }
    await sleep(10);
  }
  throw new Error('send-command did not finish');
}

/** Docker log stream → text lines (handles both the multiplexed and the TTY format). */
export function demuxLogs(buf) {
  const parts = [];
  let i = 0;
  const looksMux = buf.length >= 8 && (buf[0] === 1 || buf[0] === 2) && buf[1] === 0 && buf[2] === 0 && buf[3] === 0;
  if (!looksMux) return buf.toString('utf8').split('\n').filter(Boolean);
  while (i + 8 <= buf.length) {
    const size = buf.readUInt32BE(i + 4);
    parts.push(buf.subarray(i + 8, i + 8 + size));
    i += 8 + size;
  }
  return Buffer.concat(parts).toString('utf8').split('\n').filter(Boolean);
}

function sameSecret(a, b) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function createBridge({ token, container = 'minecraft', docker }) {
  let queue = Promise.resolve();
  return http.createServer((req, res) => {
    const reply = (status, body) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    const url = new URL(req.url ?? '/', 'http://bridge');
    if (url.pathname === '/health') return reply(200, { ok: true });
    if (!sameSecret(req.headers.authorization ?? '', `Bearer ${token}`)) return reply(401, { ok: false, error: 'unauthorized' });

    if (req.method === 'GET' && url.pathname === '/logs') {
      const since = Math.max(0, Math.floor(Number(url.searchParams.get('since')) || 0));
      docker
        .call('GET', `/containers/${encodeURIComponent(container)}/logs?stdout=1&stderr=1&since=${since}&tail=400`)
        .then((buf) => reply(200, { lines: demuxLogs(buf) }))
        .catch((err) => reply(502, { ok: false, error: String(err.message ?? err) }));
      return;
    }

    if (req.method === 'POST' && url.pathname === '/commands') {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        let commands;
        try {
          commands = JSON.parse(Buffer.concat(chunks).toString()).commands;
        } catch {
          return reply(400, { ok: false, error: 'invalid JSON' });
        }
        if (!Array.isArray(commands) || commands.length === 0 || commands.length > MAX_COMMANDS) {
          return reply(400, { ok: false, error: `commands must be a non-empty array of at most ${MAX_COMMANDS}` });
        }
        const refused = commands.find((c) => !isAllowedCommand(c));
        if (refused !== undefined) return reply(403, { ok: false, error: `command not allowed: ${String(refused).slice(0, 80)}` });
        // One batch at a time, in order, so builds never interleave.
        queue = queue.then(async () => {
          let ran = 0;
          try {
            for (const c of commands) {
              await sendCommand(docker, container, c.trim().replace(/^\//, ''));
              ran++;
            }
            reply(200, { ok: true, ran });
          } catch (err) {
            reply(502, { ok: false, ran, error: String(err.message ?? err) });
          }
        });
      });
      return;
    }
    reply(404, { ok: false, error: 'not found' });
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const token = process.env.BRIDGE_TOKEN ?? '';
  if (token.length < 16) {
    console.error('mc-bridge: BRIDGE_TOKEN must be set (16+ characters)');
    process.exit(1);
  }
  const port = Number(process.env.PORT ?? 8790);
  const server = createBridge({
    token,
    container: process.env.MC_CONTAINER ?? 'minecraft',
    docker: makeDocker(process.env.DOCKER_SOCKET ?? '/var/run/docker.sock'),
  });
  server.listen(port, '0.0.0.0', () => console.log(`mc-bridge listening on :${port}`));
}
