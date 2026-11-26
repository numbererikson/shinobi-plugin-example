// Shinobi plugin: Minecraft (Bedrock) builder — "Majstor".
//
// Claude acts as the architect: it describes a building as a list of simple
// parts (boxes, cylinders, domes, pyramids, gable roofs, single blocks) in
// coordinates relative to a player, and this plugin turns them into console
// `fill`/`setblock` commands and runs them in the background through mc-bridge
// (see bridge/bridge.mjs). When a build finishes, the kids see it in the world
// and the owner gets a push notification.
//
// Env:
//   SHINOBI_MC_BRIDGE_URL    default http://mc-bridge:8790
//   SHINOBI_MC_BRIDGE_TOKEN  shared secret with the bridge (required)

const FILL_LIMIT = 32768; // Bedrock's maximum blocks per /fill
const MAX_COMMANDS = 6000;
const MAX_REACH = 60; // |x| and |z| from the anchor (one ticking area covers ±64)
const MIN_Y = -30;
const MAX_Y = 220;
const BATCH = 40;
const BUILDS_KEY = 'builds';
const DESIGNS_KEY = 'designs';
const WISHES_KEY = 'wishes';
const KEEP_DESIGNS = 100;
const KEEP_WISHES = 50;
const WISH_POLL_MS = 4000;
const WISH_COOLDOWN_MS = 30_000;
const KEEP_BUILDS = 50;
const BLOCK = /^(minecraft:)?[a-z][a-z0-9_]{1,63}$/;
const PLAYER = /^[A-Za-z0-9_ ]{1,32}$/;

export const clock = {
  now: () => new Date(),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  every: (ms, fn) => {
    const t = setInterval(fn, ms);
    t.unref?.();
    return t;
  },
};

// ---- geometry ---------------------------------------------------------------

class BuildError extends Error {}

function int(v, what) {
  const n = Number(v);
  if (!Number.isFinite(n)) throw new BuildError(`${what} must be a number`);
  return Math.round(n);
}

function point(p, what) {
  if (!Array.isArray(p) || p.length !== 3) throw new BuildError(`${what} must be [x, y, z]`);
  const [x, y, z] = p.map((v, i) => int(v, `${what}[${i}]`));
  if (Math.abs(x) > MAX_REACH || Math.abs(z) > MAX_REACH) throw new BuildError(`${what} is too far from the anchor (keep |x| and |z| ≤ ${MAX_REACH})`);
  if (y < MIN_Y || y > MAX_Y) throw new BuildError(`${what} height must be between ${MIN_Y} and ${MAX_Y}`);
  return [x, y, z];
}

function block(b, what = 'block') {
  const s = String(b ?? '').trim().toLowerCase();
  if (!BLOCK.test(s)) throw new BuildError(`${what} "${b}" is not a block id (e.g. brick_block, white_concrete, glass)`);
  return s.replace(/^minecraft:/, '');
}

function box(a, b, blk) {
  return { a: [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.min(a[2], b[2])], b: [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.max(a[2], b[2])], block: blk };
}

const volume = (f) => (f.b[0] - f.a[0] + 1) * (f.b[1] - f.a[1] + 1) * (f.b[2] - f.a[2] + 1);

/** Split a fill into pieces Bedrock accepts (≤ 32768 blocks each). */
export function splitFill(f) {
  if (volume(f) <= FILL_LIMIT) return [f];
  const size = [0, 1, 2].map((i) => f.b[i] - f.a[i] + 1);
  const axis = size.indexOf(Math.max(...size));
  const mid = f.a[axis] + Math.floor(size[axis] / 2) - 1;
  const left = { ...f, b: [...f.b] };
  const right = { ...f, a: [...f.a] };
  left.b[axis] = mid;
  right.a[axis] = mid + 1;
  return [...splitFill(left), ...splitFill(right)];
}

/** Circle rows: for each dz in [-r, r] the half-width dx of a filled disc. */
function discRows(r) {
  const rows = [];
  for (let dz = -r; dz <= r; dz++) rows.push([dz, Math.floor(Math.sqrt(Math.max(0, (r + 0.5) ** 2 - dz * dz)))]);
  return rows;
}

/** One part of a building → fills (in order: later fills overwrite earlier ones). */
export function expandPart(part) {
  const type = part?.type;
  const out = [];
  switch (type) {
    case 'box': {
      const f = box(point(part.from, 'box.from'), point(part.to, 'box.to'), block(part.block));
      out.push(f);
      const inner = box([f.a[0] + 1, f.a[1] + 1, f.a[2] + 1], [f.b[0] - 1, f.b[1] - 1, f.b[2] - 1], 'air');
      if (part.hollow && inner.a.every((v, i) => v <= inner.b[i])) {
        // Keep the floor and the roof unless asked otherwise.
        if (part.open_top) inner.b[1] = f.b[1];
        out.push(inner);
      }
      break;
    }
    case 'clear':
      out.push(box(point(part.from, 'clear.from'), point(part.to, 'clear.to'), 'air'));
      break;
    case 'block': {
      const p = point(part.at, 'block.at');
      out.push(box(p, p, block(part.block)));
      break;
    }
    case 'cylinder': {
      const [cx, cy, cz] = point(part.center, 'cylinder.center');
      const r = int(part.radius, 'cylinder.radius');
      const h = int(part.height, 'cylinder.height');
      if (r < 1 || r > 40 || h < 1) throw new BuildError('cylinder needs radius 1–40 and height ≥ 1');
      point([cx + r, cy + h - 1, cz + r], 'cylinder edge');
      point([cx - r, cy, cz - r], 'cylinder edge');
      const blk = block(part.block);
      for (const [dz, dx] of discRows(r)) out.push(box([cx - dx, cy, cz + dz], [cx + dx, cy + h - 1, cz + dz], blk));
      if (part.hollow && r >= 2) {
        for (const [dz, dx] of discRows(r - 1)) out.push(box([cx - dx, cy + 1, cz + dz], [cx + dx, cy + h - 1, cz + dz], 'air'));
      }
      break;
    }
    case 'dome':
    case 'sphere': {
      const [cx, cy, cz] = point(part.center, `${type}.center`);
      const r = int(part.radius, `${type}.radius`);
      if (r < 1 || r > 30) throw new BuildError(`${type} radius must be 1–30`);
      point([cx + r, cy + r, cz + r], `${type} edge`);
      point([cx - r, type === 'dome' ? cy : cy - r, cz - r], `${type} edge`);
      const blk = block(part.block);
      const from = type === 'dome' ? 0 : -r;
      for (let dy = from; dy <= r; dy++) {
        const rr = Math.floor(Math.sqrt(Math.max(0, (r + 0.5) ** 2 - dy * dy)));
        for (const [dz, dx] of discRows(rr)) out.push(box([cx - dx, cy + dy, cz + dz], [cx + dx, cy + dy, cz + dz], blk));
      }
      if (part.hollow && r >= 3) {
        const ir = r - 1;
        for (let dy = from; dy <= ir; dy++) {
          const rr = Math.floor(Math.sqrt(Math.max(0, (ir + 0.5) ** 2 - dy * dy)));
          for (const [dz, dx] of discRows(rr)) out.push(box([cx - dx, cy + dy, cz + dz], [cx + dx, cy + dy, cz + dz], 'air'));
        }
      }
      break;
    }
    case 'pyramid': {
      const [cx, cy, cz] = point(part.center, 'pyramid.center');
      const size = int(part.size, 'pyramid.size');
      if (size < 1 || size > 2 * MAX_REACH) throw new BuildError(`pyramid size must be 1–${2 * MAX_REACH}`);
      const step = Math.max(1, int(part.step ?? 1, 'pyramid.step'));
      const blk = block(part.block);
      let half = Math.floor(size / 2);
      point([cx + half, cy, cz + half], 'pyramid edge');
      point([cx - half, cy, cz - half], 'pyramid edge');
      for (let y = cy; half >= 0; y += step, half--) {
        point([cx, y + step - 1, cz], 'pyramid top');
        out.push(box([cx - half, y, cz - half], [cx + half, y + step - 1, cz + half], blk));
      }
      break;
    }
    case 'roof': {
      // Gable roof over the rectangle from..to (x/z), starting at from[1], ridge along `axis`.
      const a = point(part.from, 'roof.from');
      const b = point(part.to, 'roof.to');
      const axis = part.axis === 'x' ? 'x' : 'z';
      const blk = block(part.block);
      const [x1, x2] = [Math.min(a[0], b[0]), Math.max(a[0], b[0])];
      const [z1, z2] = [Math.min(a[2], b[2]), Math.max(a[2], b[2])];
      const y0 = a[1];
      for (let i = 0; ; i++) {
        const y = y0 + i;
        if (axis === 'z') {
          if (x1 + i > x2 - i) break;
          point([x1 + i, y, z1], 'roof');
          out.push(box([x1 + i, y, z1], [x2 - i, y, z2], blk));
        } else {
          if (z1 + i > z2 - i) break;
          point([x1, y, z1 + i], 'roof');
          out.push(box([x1, y, z1 + i], [x2, y, z2 - i], blk));
        }
      }
      break;
    }
    default:
      throw new BuildError(`unknown part type "${type}" (use box, clear, block, cylinder, dome, sphere, pyramid, roof)`);
  }
  return out;
}

/** Whole building → split fills, bounding box and block count. */
export function planBuild(parts, { clearFirst = false } = {}) {
  if (!Array.isArray(parts) || parts.length === 0) throw new BuildError('parts must be a non-empty list');
  let fills = parts.flatMap((p, i) => {
    try {
      return expandPart(p);
    } catch (err) {
      throw new BuildError(`part ${i + 1}: ${err.message}`);
    }
  });
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (const f of fills) for (let i = 0; i < 3; i++) {
    lo[i] = Math.min(lo[i], f.a[i]);
    hi[i] = Math.max(hi[i], f.b[i]);
  }
  if (clearFirst) {
    // Make room: air from the lowest point of the building up, with a 1-block margin.
    const clear = box([lo[0] - 1, Math.max(lo[1], 0), lo[2] - 1], [hi[0] + 1, hi[1] + 1, hi[2] + 1], 'air');
    fills = [clear, ...fills];
  }
  fills = fills.flatMap(splitFill);
  if (fills.length > MAX_COMMANDS) throw new BuildError(`too detailed: ${fills.length} commands (max ${MAX_COMMANDS}); use bigger parts`);
  const blocks = fills.filter((f) => f.block !== 'air').reduce((n, f) => n + volume(f), 0);
  return { fills, bbox: { from: lo, to: hi }, blocks };
}

// ---- console commands -------------------------------------------------------

const quote = (name) => (/\s/.test(name) ? `"${name}"` : name);
const anchorSel = (tag) => `@e[type=armor_stand,name=${tag}]`;

export function fillCommand(tag, f) {
  const rel = (v) => `~${v}`;
  return `execute as ${anchorSel(tag)} at @s run fill ${f.a.map(rel).join(' ')} ${f.b.map(rel).join(' ')} ${f.block}`;
}

/** Parse BDS console output of `list`. */
export function parsePlayerList(lines) {
  const strip = (l) => l.replace(/^\[[^\]]*\]\s*/, '').replace(/^(INFO|NO LOG FILE!)\s*/, '').trim();
  let idx = -1;
  for (let i = lines.length - 1; i >= 0; i--) if (/players online/i.test(lines[i])) { idx = i; break; }
  if (idx < 0) return null;
  const m = /There are (\d+)\/(\d+) players online/i.exec(lines[idx]);
  const count = m ? Number(m[1]) : 0;
  if (count === 0) return [];
  const next = strip(lines[idx + 1] ?? '');
  return next.split(',').map((s) => s.trim()).filter(Boolean);
}

// ---- bridge client ----------------------------------------------------------

export function bridgeConfigFromEnv(env = process.env) {
  return {
    url: (env.SHINOBI_MC_BRIDGE_URL || 'http://mc-bridge:8790').replace(/\/+$/, ''),
    token: env.SHINOBI_MC_BRIDGE_TOKEN || '',
  };
}

export function makeBridge(config, fetchImpl = globalThis.fetch) {
  async function call(method, path, body) {
    if (!config.token) throw new Error('SHINOBI_MC_BRIDGE_TOKEN is not set (see the Minecraft plugin README)');
    let res;
    try {
      res = await fetchImpl(config.url + path, {
        method,
        headers: { Authorization: `Bearer ${config.token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(120_000),
      });
    } catch (err) {
      throw new Error(`Minecraft bridge not reachable at ${config.url} (${err.message ?? err})`);
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Minecraft bridge: ${data.error ?? res.status}`);
    return data;
  }
  return {
    run: (commands) => call('POST', '/commands', { commands }),
    logs: (since) => call('GET', `/logs?since=${since}`),
  };
}

// ---- ready-made designs and wishes from the game ------------------------------

/** Built-in designs a kid can ask for without anyone at the keyboard. */
export const TEMPLATES = [
  {
    name: 'kuća',
    words: ['kuca', 'kucica', 'house', 'home'],
    parts: [
      { type: 'box', from: [-4, 0, 6], to: [4, 5, 14], block: 'brick_block', hollow: true },
      { type: 'clear', from: [0, 1, 6], to: [0, 2, 6] },
      { type: 'box', from: [-3, 2, 6], to: [-2, 3, 6], block: 'glass' },
      { type: 'box', from: [2, 2, 6], to: [3, 3, 6], block: 'glass' },
      { type: 'roof', from: [-5, 6, 5], to: [5, 6, 15], axis: 'z', block: 'deepslate_tiles' },
    ],
  },
  {
    name: 'dvorac',
    words: ['dvorac', 'zamak', 'castle', 'tvrdava'],
    parts: [
      { type: 'box', from: [-12, 0, 8], to: [12, 8, 32], block: 'smooth_stone', hollow: true, open_top: true },
      { type: 'cylinder', center: [-12, 0, 8], radius: 3, height: 14, block: 'cobblestone', hollow: true },
      { type: 'cylinder', center: [12, 0, 8], radius: 3, height: 14, block: 'cobblestone', hollow: true },
      { type: 'cylinder', center: [-12, 0, 32], radius: 3, height: 14, block: 'cobblestone', hollow: true },
      { type: 'cylinder', center: [12, 0, 32], radius: 3, height: 14, block: 'cobblestone', hollow: true },
      { type: 'pyramid', center: [-12, 14, 8], size: 7, block: 'red_concrete' },
      { type: 'pyramid', center: [12, 14, 8], size: 7, block: 'red_concrete' },
      { type: 'pyramid', center: [-12, 14, 32], size: 7, block: 'red_concrete' },
      { type: 'pyramid', center: [12, 14, 32], size: 7, block: 'red_concrete' },
      { type: 'clear', from: [-2, 1, 8], to: [2, 5, 8] },
    ],
  },
  {
    name: 'toranj',
    words: ['toranj', 'kula', 'tower'],
    parts: [
      { type: 'cylinder', center: [0, 0, 10], radius: 4, height: 24, block: 'smooth_stone', hollow: true },
      { type: 'pyramid', center: [0, 24, 10], size: 9, block: 'deepslate_tiles' },
      { type: 'clear', from: [0, 1, 6], to: [0, 3, 6] },
    ],
  },
  {
    name: 'piramida',
    words: ['piramida', 'pyramid', 'egipat'],
    parts: [{ type: 'pyramid', center: [0, 0, 22], size: 31, block: 'sandstone' }],
  },
  {
    name: 'svjetionik',
    words: ['svjetionik', 'lighthouse', 'svjetiljka'],
    parts: [
      { type: 'cylinder', center: [0, 0, 10], radius: 3, height: 20, block: 'white_concrete' },
      { type: 'cylinder', center: [0, 6, 10], radius: 3, height: 3, block: 'red_concrete' },
      { type: 'cylinder', center: [0, 14, 10], radius: 3, height: 3, block: 'red_concrete' },
      { type: 'cylinder', center: [0, 20, 10], radius: 3, height: 3, block: 'glass' },
      { type: 'block', at: [0, 21, 10], block: 'sea_lantern' },
      { type: 'dome', center: [0, 23, 10], radius: 3, block: 'red_concrete' },
    ],
  },
  {
    name: 'bazen',
    words: ['bazen', 'pool', 'kupanje'],
    parts: [
      { type: 'box', from: [-6, -4, 6], to: [6, 0, 18], block: 'quartz_block' },
      { type: 'box', from: [-5, -3, 7], to: [5, 0, 17], block: 'water' },
    ],
  },
];

const fold = (s) => String(s).normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/g, 'd').toLowerCase();
const words = (s) => fold(s).split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3);
/** Same word, or the same stem with a short ending (katedralu ~ katedrala, kuću ~ kuća). */
function sameWord(a, b) {
  if (a === b) return true;
  const k = Math.min(5, Math.min(a.length, b.length) - 1);
  return k >= 3 && a.slice(0, k) === b.slice(0, k) && Math.abs(a.length - b.length) <= 3;
}

/**
 * What a wish asks for: a ready-made template, or a design Claude built
 * earlier (newest first). null when nothing fits.
 */
export function findDesign(text, designs = []) {
  const want = words(text);
  if (want.length === 0) return null;
  for (const t of TEMPLATES) if (want.some((w) => t.words.some((tw) => sameWord(w, tw)))) return { name: t.name, parts: t.parts, clear_first: true };
  for (const d of designs) {
    const have = words(d.name);
    if (want.some((w) => w.length >= 4 && have.some((h) => sameWord(w, h)))) return d;
  }
  return null;
}

/** Wish lines the Majstor behavior pack prints to the server console. */
export function parseWishLines(lines) {
  const out = [];
  for (const line of lines) {
    const i = line.indexOf('MAJSTOR_WISH ');
    if (i < 0) continue;
    try {
      const w = JSON.parse(line.slice(i + 13).trim());
      if (w && typeof w.id === 'string' && typeof w.player === 'string' && typeof w.text === 'string') {
        out.push({ id: w.id.slice(0, 40), player: w.player.slice(0, 32), text: w.text.replace(/[\r\n]+/g, ' ').trim().slice(0, 60) });
      }
    } catch {
      /* not ours */
    }
  }
  return out;
}

const HELP_WORDS = new Set(['popis', 'lista', 'help', 'pomoc', 'sto']);

// ---- plugin -----------------------------------------------------------------

export default function register(registry) {
  const store = registry.state;
  const bridge = () => makeBridge(bridgeConfigFromEnv());
  const builds = () => (store ? store.get(BUILDS_KEY) ?? [] : []);
  const saveBuild = (b) =>
    store?.update(BUILDS_KEY, (list) => {
      const rest = (list ?? []).filter((x) => x.id !== b.id);
      return [b, ...rest].sort((x, y) => y.id - x.id).slice(0, KEEP_BUILDS);
    });
  const nextId = () => (builds()[0]?.id ?? 0) + 1;
  const designs = () => (store ? store.get(DESIGNS_KEY) ?? [] : []);
  const saveDesign = (d) =>
    store?.update(DESIGNS_KEY, (list) => [d, ...(list ?? []).filter((x) => fold(x.name) !== fold(d.name))].slice(0, KEEP_DESIGNS));
  const wishes = () => (store ? store.get(WISHES_KEY) ?? [] : []);
  const saveWish = (w) => store?.update(WISHES_KEY, (list) => [w, ...(list ?? []).filter((x) => x.id !== w.id)].slice(0, KEEP_WISHES));

  // A restart drops the in-memory queue: whatever was still pending is lost.
  if (store && builds().some((b) => b.status === 'queued' || b.status === 'running')) {
    store.update(BUILDS_KEY, (list) =>
      (list ?? []).map((b) => (b.status === 'queued' || b.status === 'running' ? { ...b, status: 'failed', error: 'interrupted by a Shinobi restart — ask again' } : b)),
    );
  }

  async function players() {
    const b = bridge();
    const since = Math.floor(clock.now().getTime() / 1000) - 2;
    await b.run(['list']);
    for (let i = 0; i < 6; i++) {
      await clock.sleep(400);
      const names = parsePlayerList((await b.logs(since)).lines ?? []);
      if (names) return names;
    }
    throw new Error('the server did not answer `list`');
  }

  // Builds run one at a time in the background; the tool call returns at once.
  let chain = Promise.resolve();
  function enqueue(job) {
    chain = chain.then(() => runBuild(job)).catch(() => undefined);
  }

  async function runBuild(job) {
    const b = bridge();
    const tag = job.tag;
    const record = { ...job.record, status: 'running', started_at: clock.now().toISOString() };
    saveBuild(record);
    const area = `mc_${record.id}`;
    try {
      if (!job.existingAnchor) await b.run([`execute at ${quote(record.player)} run summon armor_stand ${tag} ~ ~ ~`]);
      const c = job.plan.bbox;
      const mid = [0, 1, 2].map((i) => Math.round((c.from[i] + c.to[i]) / 2));
      await b.run([`execute as ${anchorSel(tag)} at @s run tickingarea add circle ~${mid[0]} ~${mid[1]} ~${mid[2]} 4 ${area}`]);
      await clock.sleep(3000);
      await b.run([`say Majstor: gradim ${record.name}...`]);
      const commands = job.plan.fills.map((f) => fillCommand(tag, f));
      for (let i = 0; i < commands.length; i += BATCH) await b.run(commands.slice(i, i + BATCH));
      await b.run([`tickingarea remove ${area}`, `say Majstor: ${record.name} je gotov!`]);
      const done = { ...record, status: 'done', finished_at: clock.now().toISOString() };
      saveBuild(done);
      if (job.design) saveDesign({ name: record.name, parts: job.design.parts, clear_first: job.design.clear_first === true });
      if (job.wish) saveWish({ ...job.wish, status: 'built', build_id: record.id });
      if (!job.wish && typeof registry.notify === 'function') {
        await registry.notify({ title: 'Majstor je gotov', body: `${record.name} (${record.blocks} blocks) stoji pored igrača ${record.player}.` }).catch(() => undefined);
      }
    } catch (err) {
      saveBuild({ ...record, status: 'failed', finished_at: clock.now().toISOString(), error: String(err.message ?? err).slice(0, 300) });
      if (job.wish) saveWish({ ...job.wish, status: 'failed', build_id: record.id });
      await b.run([`tickingarea remove ${area}`]).catch(() => undefined);
    }
  }

  registry.registerTool({
    name: 'plugin_minecraft_players',
    description: 'Who is on the home Minecraft (Bedrock) server right now. Use the names as `player` for plugin_minecraft_build.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: async () => ({ players: await players() }),
  });

  registry.registerTool({
    name: 'plugin_minecraft_say',
    description: 'Send a chat message on the Minecraft server, shown to every player as "Majstor: …".',
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string', maxLength: 200 } },
      required: ['text'],
      additionalProperties: false,
    },
    handler: async (args) => {
      const text = String(args.text ?? '').replace(/[\r\n]+/g, ' ').trim().slice(0, 200);
      if (!text) throw new Error('text is empty');
      await bridge().run([`say Majstor: ${text}`]);
      return { said: text };
    },
  });

  registry.registerTool({
    name: 'plugin_minecraft_build',
    description:
      'Build something in the home Minecraft (Bedrock) world next to a player, from simple parts. You are the architect: ' +
      'turn the request (a description or a photo of a real building) into parts. The build runs in the background; the tool returns at once ' +
      'and the owner gets a push notification when it is done.\n' +
      'COORDINATES are relative to an anchor placed at the player\'s feet: x = east(+)/west(-), y = up (0 = the ground the player stands on), ' +
      'z = south(+)/north(-). Keep |x| and |z| ≤ 60; start a few blocks away (e.g. z ≥ 6) so the player is not inside it. 1 block ≈ 1 m.\n' +
      'PARTS (later parts overwrite earlier ones, so carve windows/doors after walls):\n' +
      '- {"type":"box","from":[x,y,z],"to":[x,y,z],"block":"brick_block","hollow":true} — walls+floor+ceiling; "open_top":true leaves it roofless\n' +
      '- {"type":"clear","from":[..],"to":[..]} — air (doors, windows, room inside)\n' +
      '- {"type":"block","at":[x,y,z],"block":"gold_block"}\n' +
      '- {"type":"cylinder","center":[x,y,z],"radius":4,"height":20,"block":"stone","hollow":true} — towers (center = bottom middle)\n' +
      '- {"type":"dome","center":[x,y,z],"radius":6,"block":"copper_block","hollow":true} — half sphere; "sphere" for a full one\n' +
      '- {"type":"pyramid","center":[x,y,z],"size":21,"block":"sandstone","step":1} — spires/pyramids (size = base width)\n' +
      '- {"type":"roof","from":[x,y,z],"to":[x,y,z],"axis":"z","block":"deepslate_tiles"} — gable roof over from..to starting at from.y, ridge along axis\n' +
      'BLOCKS are Bedrock ids, e.g. brick_block, stone_bricks, smooth_stone, sandstone, quartz_block, glass, oak_planks, deepslate_tiles, ' +
      'white_concrete / red_concrete / blue_concrete / lime_concrete (any colour), gold_block, iron_block, sea_lantern, glowstone, water, air.\n' +
      'Set clear_first:true to clear trees/terrain inside the bounding box first. Aim for recognisable shape and colours over tiny detail; ' +
      'a cathedral is ~40–120 parts. To add to an earlier build, pass extend_build (its id) — coordinates are then relative to that build\'s anchor. ' +
      'Every new build is remembered by name, so the kids can ask for it again in the game ("/gradi katedrala").',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'What it is, e.g. "Osječka katedrala"' },
        player: { type: 'string', description: 'Build next to this player (default: the only/first player online)' },
        extend_build: { type: 'integer', description: 'Add to an earlier build (uses its anchor)' },
        clear_first: { type: 'boolean', default: false },
        parts: { type: 'array', items: { type: 'object' }, minItems: 1 },
        for_wish: { type: 'string', description: 'Id of a kid\'s wish this build fulfils (from plugin_minecraft_wishes); build next to that player' },
      },
      required: ['name', 'parts'],
      additionalProperties: false,
    },
    handler: async (args) => {
      if (!store) throw new Error('this Shinobi host has no plugin state store');
      const name = String(args.name ?? '').replace(/[\r\n]+/g, ' ').trim().slice(0, 60);
      if (!name) throw new Error('name is required');
      let plan;
      try {
        plan = planBuild(args.parts, { clearFirst: args.clear_first === true });
      } catch (err) {
        if (err instanceof BuildError) throw new Error(`build plan rejected: ${err.message}`);
        throw err;
      }
      let tag;
      let player;
      let existingAnchor = false;
      if (args.extend_build !== undefined) {
        const prev = builds().find((x) => x.id === Number(args.extend_build));
        if (!prev) throw new Error(`no build #${args.extend_build}`);
        tag = prev.tag;
        player = prev.player;
        existingAnchor = true;
      } else {
        const online = await players();
        const wished = args.for_wish !== undefined ? wishes().find((w) => w.id === String(args.for_wish)) : undefined;
        if (args.for_wish !== undefined && !wished) throw new Error(`no wish ${args.for_wish}`);
        if (wished && !args.player) args = { ...args, player: wished.player };
        if (args.player) {
          player = online.find((p) => p.toLowerCase() === String(args.player).toLowerCase());
          if (!player) throw new Error(`${args.player} is not online (online: ${online.join(', ') || 'nobody'})`);
        } else {
          if (online.length === 0) throw new Error('nobody is online — the build needs a player to stand next to');
          player = online[0];
        }
        if (!PLAYER.test(player)) throw new Error(`unsupported player name "${player}"`);
      }
      const id = nextId();
      tag ??= `Majstor_${id}`;
      const record = {
        id,
        name,
        player,
        tag,
        status: 'queued',
        created_at: clock.now().toISOString(),
        commands: plan.fills.length,
        blocks: plan.blocks,
        bbox: plan.bbox,
        extends: existingAnchor ? Number(args.extend_build) : null,
      };
      saveBuild(record);
      const wish = args.for_wish !== undefined ? wishes().find((w) => w.id === String(args.for_wish)) : undefined;
      enqueue({ record, plan, tag, existingAnchor, design: existingAnchor ? null : { parts: args.parts, clear_first: args.clear_first === true }, wish });
      const seconds = Math.ceil(plan.fills.length * 0.08) + 5;
      return { build_id: id, status: 'queued', player, blocks: plan.blocks, commands: plan.fills.length, bbox: plan.bbox, estimated_seconds: seconds };
    },
  });

  registry.registerTool({
    name: 'plugin_minecraft_builds',
    description: 'Recent Minecraft builds with their status (queued, running, done, failed), size and the player they were built next to.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: () => ({
      builds: builds().map(({ id, name, player, status, blocks, created_at, finished_at, error, extends: ext }) => ({ id, name, player, status, blocks, created_at, finished_at, error, extends: ext })),
    }),
  });

  registry.registerTool({
    name: 'plugin_minecraft_remove',
    description: 'Remove an earlier build: fills its bounding box with air (anything else inside that box goes too). Only when the owner asks to tear it down.',
    inputSchema: {
      type: 'object',
      properties: { build_id: { type: 'integer' } },
      required: ['build_id'],
      additionalProperties: false,
    },
    handler: async (args) => {
      const prev = builds().find((x) => x.id === Number(args.build_id));
      if (!prev) throw new Error(`no build #${args.build_id}`);
      const plan = planBuild([{ type: 'clear', from: prev.bbox.from, to: prev.bbox.to }]);
      const id = nextId();
      const record = { id, name: `remove #${prev.id} ${prev.name}`, player: prev.player, tag: prev.tag, status: 'queued', created_at: clock.now().toISOString(), commands: plan.fills.length, blocks: 0, bbox: prev.bbox, extends: prev.id };
      saveBuild(record);
      enqueue({ record, plan, tag: prev.tag, existingAnchor: true });
      return { build_id: id, status: 'queued', removing: prev.id };
    },
  });

  // ---- wishes typed in the game (Majstor behavior pack) ----
  const lastWish = new Map();
  const seenWishes = new Set();
  let wishSince = Math.floor(clock.now().getTime() / 1000);

  async function handleWish(w) {
    if (seenWishes.has(w.id)) return;
    seenWishes.add(w.id);
    if (seenWishes.size > 500) seenWishes.delete(seenWishes.values().next().value);
    if (!PLAYER.test(w.player)) return;
    const b = bridge();
    const now = clock.now().getTime();
    if (HELP_WORDS.has(fold(w.text))) {
      const names = [...TEMPLATES.map((t) => t.name), ...designs().slice(0, 10).map((d) => d.name)];
      await b.run([`say Majstor: mogu sagraditi: ${names.join(', ')}`.slice(0, 380)]);
      return;
    }
    if (now - (lastWish.get(w.player) ?? 0) < WISH_COOLDOWN_MS) {
      await b.run([`say Majstor: ${w.player}, polako, još gradim prethodno!`]);
      return;
    }
    lastWish.set(w.player, now);
    const wish = { ...w, at: clock.now().toISOString(), status: 'new' };
    const design = findDesign(w.text, designs());
    if (!design) {
      saveWish({ ...wish, status: 'unknown' });
      await b.run([`say Majstor: još ne znam sagraditi "${w.text}". Zapamtio sam želju! Napiši /gradi popis za ono što znam.`]);
      return;
    }
    const plan = planBuild(design.parts, { clearFirst: design.clear_first === true });
    const id = nextId();
    const tag = `Majstor_${id}`;
    const record = { id, name: design.name, player: w.player, tag, status: 'queued', created_at: wish.at, commands: plan.fills.length, blocks: plan.blocks, bbox: plan.bbox, extends: null, wish: w.text };
    saveBuild(record);
    saveWish({ ...wish, status: 'building', build_id: id });
    enqueue({ record, plan, tag, existingAnchor: false, wish: { ...wish, build_id: id } });
  }

  async function pollWishes() {
    if (!bridgeConfigFromEnv().token || !store) return;
    const since = wishSince;
    wishSince = Math.floor(clock.now().getTime() / 1000) - 1;
    const lines = (await bridge().logs(since)).lines ?? [];
    for (const w of parseWishLines(lines)) await handleWish(w).catch(() => undefined);
  }

  let polling = false;
  clock.every(WISH_POLL_MS, () => {
    if (polling) return;
    polling = true;
    return pollWishes()
      .catch(() => undefined)
      .finally(() => {
        polling = false;
      });
  });

  registry.registerTool({
    name: 'plugin_minecraft_wishes',
    description:
      'What the kids asked Majstor for in the game ("/gradi dvorac"). Wishes it could build by itself are marked built; ' +
      '"unknown" ones need you: design them with plugin_minecraft_build and pass for_wish (the wish id) so it goes up next to that kid ' +
      'and is remembered for next time.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: () => ({ wishes: wishes(), templates: TEMPLATES.map((t) => t.name), designs: designs().map((d) => d.name) }),
  });

  // ---- dashboard page ----
  if (typeof registry.registerPage === 'function') {
    registry.registerPage({
      id: 'minecraft',
      title: 'Minecraft',
      icon: 'home',
      order: 25,
      render: async () => {
        const blocks = [];
        let online = null;
        let error = null;
        try {
          online = await players();
        } catch (err) {
          error = String(err.message ?? err);
        }
        const list = builds();
        blocks.push({
          type: 'stats',
          items: [
            { label: 'Server', value: error ? 'offline' : 'online', tone: error ? 'error' : 'ok' },
            { label: 'Players', value: online ? String(online.length) : '—', hint: online?.join(', ') || undefined },
            { label: 'Builds', value: String(list.filter((b) => b.status === 'done').length) },
            { label: 'Working', value: String(list.filter((b) => b.status === 'running' || b.status === 'queued').length) },
          ],
        });
        if (error) blocks.push({ type: 'text', tone: 'error', text: error });
        blocks.push({ type: 'input', label: 'Message to the players', placeholder: 'Večera je gotova!', button: 'Send', tool: 'plugin_minecraft_say', arg: 'text', maxLength: 200 });
        const open = wishes().filter((w) => w.status === 'unknown').slice(0, 10);
        if (open.length) {
          blocks.push({ type: 'heading', text: 'Wishes Majstor could not build yet' });
          blocks.push({ type: 'list', items: open.map((w) => ({ title: w.text, subtitle: `${w.player} · ${String(w.at).slice(0, 16).replace('T', ' ')}`, badge: 'ask Claude' })) });
        }
        blocks.push({ type: 'heading', text: 'Builds' });
        blocks.push({
          type: 'table',
          columns: ['#', 'What', 'Next to', 'Status', 'Blocks', 'When'],
          rows: list.map((b) => [String(b.id), b.name, b.player, b.status + (b.error ? `: ${b.error}` : ''), String(b.blocks), (b.finished_at ?? b.created_at).slice(0, 16).replace('T', ' ')]),
          empty: 'Nothing built yet. Ask Claude: "sagradi piramidu pored Luke".',
        });
        return { blocks, refreshSeconds: 15 };
      },
    });
  }
}
