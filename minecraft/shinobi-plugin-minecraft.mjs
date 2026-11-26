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
const KEEP_BUILDS = 50;
const BLOCK = /^(minecraft:)?[a-z][a-z0-9_]{1,63}$/;
const PLAYER = /^[A-Za-z0-9_ ]{1,32}$/;

export const clock = { now: () => new Date(), sleep: (ms) => new Promise((r) => setTimeout(r, ms)) };

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
      if (typeof registry.notify === 'function') {
        await registry.notify({ title: 'Majstor je gotov', body: `${record.name} (${record.blocks} blocks) stoji pored igrača ${record.player}.` }).catch(() => undefined);
      }
    } catch (err) {
      saveBuild({ ...record, status: 'failed', finished_at: clock.now().toISOString(), error: String(err.message ?? err).slice(0, 300) });
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
      'a cathedral is ~40–120 parts. To add to an earlier build, pass extend_build (its id) — coordinates are then relative to that build\'s anchor.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'What it is, e.g. "Osječka katedrala"' },
        player: { type: 'string', description: 'Build next to this player (default: the only/first player online)' },
        extend_build: { type: 'integer', description: 'Add to an earlier build (uses its anchor)' },
        clear_first: { type: 'boolean', default: false },
        parts: { type: 'array', items: { type: 'object' }, minItems: 1 },
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
      enqueue({ record, plan, tag, existingAnchor });
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

  // ---- morning brief ----
  if (typeof registry.brief === 'function') {
    registry.brief({
      id: 'builds',
      order: 40,
      render: () => {
        const since = clock.now().getTime() - 24 * 3600 * 1000;
        const recent = builds().filter((b) => b.status === 'done' && Date.parse(b.finished_at ?? '') >= since && !b.name.startsWith('remove #'));
        return recent.length ? `⛏️ Minecraft: built ${recent.map((b) => b.name).join(', ')}` : null;
      },
    });
  }
}
