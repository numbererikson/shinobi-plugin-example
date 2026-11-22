// shinobi-plugin-adguard — run a home AdGuard Home by voice.
//
// Install: drop this single file into the Shinobi plugins directory
// (~/.shinobi/plugins/, or /data/plugins in the Docker image) and restart.
// Zero runtime dependencies: it talks to AdGuard Home's own REST API (the one
// its web UI uses) with the built-in fetch.
//
// "Let the kids watch YouTube until 19:00", "block TikTok on the kids' PC",
// "what has the TV been doing today", "pause ad blocking for 10 minutes".
// AdGuard owns the rules; the plugin turns requests into API calls, keeps
// device groups ("kids") and undoes temporary changes on time.
//
// Connection (read from the host process environment at call time):
//   SHINOBI_ADGUARD_URL       AdGuard Home web address, e.g. http://192.168.1.100
//   SHINOBI_ADGUARD_USER      AdGuard admin user
//   SHINOBI_ADGUARD_PASSWORD  AdGuard admin password
//   SHINOBI_ADGUARD_TZ        IANA time zone for "until 19:00" and schedules
//                             (default: TZ, then the process zone)

const TIMEOUT_MS = 8000;
const GROUPS_KEY = 'groups';
const PENDING_KEY = 'pending';
const RETRY_MS = 60_000;
const TIMER_SLACK_MS = 1000;
const MAX_TIMER_MS = 2_000_000_000; // setTimeout limit is ~24.8 days
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const DAY_MS = 86_400_000;

// ---- config & HTTP ----------------------------------------------------------

export function adguardConfigFromEnv(env = process.env) {
  const url = (env.SHINOBI_ADGUARD_URL || '').trim().replace(/\/+$/, '');
  return {
    url,
    user: env.SHINOBI_ADGUARD_USER || '',
    password: env.SHINOBI_ADGUARD_PASSWORD || '',
    timeZone: env.SHINOBI_ADGUARD_TZ || env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
  };
}

export class AdguardError extends Error {
  constructor(message) {
    super(`adguard: ${message}`);
    this.name = 'AdguardError';
  }
}

export function makeClient(config, fetchImpl = globalThis.fetch) {
  if (!config.url) throw new AdguardError('SHINOBI_ADGUARD_URL is not set');
  const headers = { Accept: 'application/json' };
  if (config.user || config.password) {
    headers.Authorization = 'Basic ' + Buffer.from(`${config.user}:${config.password}`).toString('base64');
  }
  async function request(method, path, body) {
    let res;
    try {
      res = await fetchImpl(config.url + path, {
        method,
        headers: body === undefined ? headers : { ...headers, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      throw new AdguardError(`cannot reach ${config.url} (${err instanceof Error ? err.message : String(err)})`);
    }
    const text = await res.text();
    if (res.status === 401 || res.status === 403) throw new AdguardError('login rejected: check SHINOBI_ADGUARD_USER / SHINOBI_ADGUARD_PASSWORD');
    if (!res.ok) throw new AdguardError(`${method} ${path} → ${res.status} ${text.slice(0, 200).trim()}`);
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  return {
    get: (path) => request('GET', path),
    post: (path, body) => request('POST', path, body ?? {}),
  };
}

// ---- pure helpers -----------------------------------------------------------

/** Lowercase, strip diacritics: "Lukin računalo" matches "lukin racunalo". */
export function fold(text) {
  return String(text)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .trim();
}

function parseClock(text) {
  const m = /^(\d{1,2})(?:[:.h](\d{2}))?h?$/.exec(String(text).trim().toLowerCase());
  if (!m) throw new AdguardError(`time "${text}" is not HH:MM`);
  const h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  if (h > 24 || min > 59 || (h === 24 && min > 0)) throw new AdguardError(`time "${text}" is out of range`);
  return h * 60 + min;
}

/** Wall-clock minutes since midnight and weekday (0 = Sunday) in a time zone. */
export function localClock(now, timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short', hourCycle: 'h23' })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday);
  return { minutes: Number(parts.hour) * 60 + Number(parts.minute) + Number(parts.second) / 60, weekday };
}

/** Milliseconds from `now` until the next wall-clock `until` ("19:00") in `timeZone`. */
export function msUntil(until, now, timeZone) {
  const target = parseClock(until);
  let delta = target - localClock(now, timeZone).minutes;
  if (delta <= 0) delta += 24 * 60;
  return Math.round(delta * 60_000);
}

/** Parse "mon-fri", "weekend", "daily", "sat,sun", "pon-pet" into AdGuard day keys. */
export function parseDays(spec) {
  const alias = {
    daily: DAYS, everyday: DAYS, all: DAYS, svaki: DAYS, svakodnevno: DAYS,
    weekdays: ['mon', 'tue', 'wed', 'thu', 'fri'], workdays: ['mon', 'tue', 'wed', 'thu', 'fri'], radnim: ['mon', 'tue', 'wed', 'thu', 'fri'],
    weekend: ['sat', 'sun'], vikend: ['sat', 'sun'],
  };
  const hr = { pon: 'mon', uto: 'tue', sri: 'wed', cet: 'thu', pet: 'fri', sub: 'sat', ned: 'sun' };
  const order = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  const key = (t) => {
    const s = fold(t).slice(0, 3);
    if (order.includes(s)) return s;
    if (hr[s]) return hr[s];
    throw new AdguardError(`unknown day "${t}"`);
  };
  const out = new Set();
  for (const raw of String(spec).split(/[,\s]+/).filter(Boolean)) {
    const word = fold(raw);
    if (alias[word]) {
      alias[word].forEach((d) => out.add(d));
    } else if (word.includes('-')) {
      const [a, b] = word.split('-').map(key);
      let i = order.indexOf(a);
      for (let n = 0; n < 7; n++) {
        out.add(order[i]);
        if (order[i] === b) break;
        i = (i + 1) % 7;
      }
    } else {
      out.add(key(word));
    }
  }
  if (out.size === 0) throw new AdguardError('no days given');
  return [...out];
}

function clientRuleModifier(names) {
  return names.map((n) => `'${n.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`).join('|');
}

export function normalizeDomain(domain) {
  const d = String(domain).trim().toLowerCase().replace(/^[a-z]+:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '');
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(d)) throw new AdguardError(`"${domain}" is not a domain`);
  return d;
}

function baseDomain(host) {
  const parts = host.replace(/\.$/, '').split('.');
  return parts.length <= 2 ? parts.join('.') : parts.slice(-2).join('.');
}

// ---- plugin -----------------------------------------------------------------

export default function register(registry) {
  const store = registry.state;
  const config = () => adguardConfigFromEnv();
  const api = () => makeClient(config());
  const groups = () => (store ? store.get(GROUPS_KEY) ?? {} : {});
  const pending = () => (store ? store.get(PENDING_KEY) ?? [] : []);
  const requireStore = () => {
    if (!store) throw new Error('this Shinobi host has no plugin state store (needs Shinobi >= 0.3.2)');
    return store;
  };

  async function clientsData(a) {
    const data = (await a.get('/control/clients')) ?? {};
    return { clients: data.clients ?? [], auto: data.auto_clients ?? [] };
  }

  /** Resolve a device name, IP or group name to persistent AdGuard clients. */
  function resolveTarget(target, clients) {
    const want = fold(target);
    const grp = Object.entries(groups()).find(([name]) => fold(name) === want);
    if (grp) {
      const members = grp[1].map((m) => clients.find((c) => fold(c.name) === fold(m))).filter(Boolean);
      if (members.length === 0) throw new AdguardError(`group "${grp[0]}" has no devices that exist in AdGuard`);
      return { kind: 'group', name: grp[0], clients: members };
    }
    const byId = clients.filter((c) => (c.ids ?? []).some((id) => fold(id) === want));
    if (byId.length) return { kind: 'device', name: byId[0].name, clients: byId.slice(0, 1) };
    const exact = clients.filter((c) => fold(c.name) === want);
    if (exact.length) return { kind: 'device', name: exact[0].name, clients: exact.slice(0, 1) };
    const partial = clients.filter((c) => fold(c.name).includes(want));
    if (partial.length === 1) return { kind: 'device', name: partial[0].name, clients: partial };
    const known = [...Object.keys(groups()), ...clients.map((c) => c.name)];
    throw new AdguardError(
      partial.length > 1
        ? `"${target}" matches several devices: ${partial.map((c) => c.name).join(', ')}`
        : `no device or group "${target}". Known: ${known.join(', ') || 'none yet; name devices with plugin_adguard_name_device'}`,
    );
  }

  async function updateClient(a, client, mutate) {
    const data = structuredClone(client);
    mutate(data);
    await a.post('/control/clients/update', { name: client.name, data });
    return data;
  }

  async function serviceCatalog(a) {
    let data;
    try {
      data = await a.get('/control/blocked_services/all');
    } catch {
      data = await a.get('/control/blocked_services/services');
    }
    const list = Array.isArray(data) ? data.map((id) => ({ id, name: id })) : (data?.blocked_services ?? []);
    return list.map((s) => ({ id: s.id, name: s.name ?? s.id }));
  }

  function resolveServices(requested, catalog) {
    return requested.map((r) => {
      const want = fold(r).replace(/\s+/g, '');
      const hit = catalog.find((s) => fold(s.id) === want || fold(s.name).replace(/\s+/g, '') === want);
      if (!hit) throw new AdguardError(`unknown service "${r}". Call plugin_adguard_devices or ask for the service list (plugin_adguard_services with action "list").`);
      return hit.id;
    });
  }

  function applyServices(client, ids, action) {
    const current = new Set(client.blocked_services ?? []);
    for (const id of ids) action === 'block' ? current.add(id) : current.delete(id);
    client.use_global_blocked_services = false;
    client.blocked_services = [...current].sort();
  }

  // -- temporary changes: undo on time, survive restarts --------------------

  const timers = new Map();

  async function runDue(slackMs = 0) {
    if (!store) return;
    // Timers can fire a millisecond before Date.now() reaches their deadline;
    // the timer path passes some slack so its own entry is never skipped.
    const now = Date.now() + slackMs;
    const due = pending().filter((p) => p.at <= now);
    if (due.length === 0) return;
    const a = api();
    const { clients } = await clientsData(a);
    const done = [];
    for (const p of due) {
      const client = clients.find((c) => c.name === p.client);
      if (client) await updateClient(a, client, (c) => applyServices(c, p.services, p.action));
      done.push(p.id);
    }
    store.update(PENDING_KEY, (list) => (list ?? []).filter((p) => !done.includes(p.id)));
  }

  function arm(entry) {
    clearTimeout(timers.get(entry.id));
    const delay = Math.min(Math.max(entry.at - Date.now(), 0), MAX_TIMER_MS);
    const t = setTimeout(async () => {
      timers.delete(entry.id);
      try {
        await runDue(TIMER_SLACK_MS);
      } catch {
        /* AdGuard unreachable: retried below */
      }
      // Still pending (AdGuard was down, or the entry moved later): try again.
      const still = pending().find((p) => p.id === entry.id);
      if (still) arm({ ...still, at: Math.max(still.at, Date.now() + RETRY_MS) });
    }, delay);
    t.unref?.();
    timers.set(entry.id, t);
  }

  // Re-arm undo timers left by a previous run (Shinobi restarted mid-window).
  if (store) {
    for (const p of pending()) arm(p);
  }

  /** Every tool runs overdue undos first, so a missed timer never leaves a rule stuck. */
  const withAdguard = (fn) => async (args) => {
    try {
      await runDue();
    } catch {
      /* reported by the call below if AdGuard is really down */
    }
    return fn(args ?? {}, api());
  };

  // -- tools ----------------------------------------------------------------

  registry.registerTool({
    name: 'plugin_adguard_devices',
    description:
      'List the home network as AdGuard Home sees it: named devices (with their blocked services, allowed-time schedule and when they last asked AdGuard anything), device groups such as "djeca"/"kids", and unnamed devices that are active. A named device silent for a long time is probably not using AdGuard as its DNS any more. Call this first to learn device and group names.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: withAdguard(async (_args, a) => {
      const { clients, auto } = await clientsData(a);
      const named = [];
      for (const c of clients) {
        const id = (c.ids ?? [])[0];
        let lastSeen = null;
        if (id) {
          const log = await a.get(`/control/querylog?limit=1&search=${encodeURIComponent(id)}`);
          lastSeen = log?.data?.[0]?.time ?? null;
        }
        named.push({
          name: c.name,
          ids: c.ids ?? [],
          blockedServices: c.use_global_blocked_services ? '(global settings)' : (c.blocked_services ?? []),
          allowedWindows: describeSchedule(c.blocked_services_schedule),
          lastSeen,
        });
      }
      const knownIds = new Set(clients.flatMap((c) => (c.ids ?? []).map(fold)));
      const stats = (await a.get('/control/stats').catch(() => null)) ?? {};
      const activeIps = (stats.top_clients ?? []).flatMap((o) => Object.entries(o)).map(([ip, count]) => ({ ip, count }));
      const unnamed = [];
      for (const { ip, count } of activeIps) {
        if (knownIds.has(fold(ip))) continue;
        const hint = auto.find((x) => x.ip === ip);
        unnamed.push({ ip, queries: count, hostname: hint?.name || null });
      }
      for (const x of auto) {
        if (!knownIds.has(fold(x.ip)) && !unnamed.some((u) => u.ip === x.ip)) unnamed.push({ ip: x.ip, queries: 0, hostname: x.name || null, source: x.source });
      }
      const dayAgo = Date.now() - DAY_MS;
      const silent = named.filter((n) => !n.lastSeen || Date.parse(n.lastSeen) < dayAgo).map((n) => n.name);
      return {
        devices: named,
        groups: groups(),
        unnamed,
        silentForADay: silent,
        hint: silent.length
          ? `No DNS queries for 24 h from: ${silent.join(', ')}. Either switched off, or their DNS no longer points at AdGuard (e.g. after joining another Wi-Fi network).`
          : undefined,
      };
    }),
  });

  registry.registerTool({
    name: 'plugin_adguard_name_device',
    description:
      'Give a device a friendly name in AdGuard ("the one on 192.168.1.10 is the living-room TV"). Creates the device, or renames it if that IP/MAC/name already belongs to one. Names are what every other tool and group uses.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'IP address, MAC address or current name of the device' },
        name: { type: 'string', description: 'Friendly name, e.g. "TV dnevna", "Djecji PC"' },
      },
      required: ['id', 'name'],
      additionalProperties: false,
    },
    handler: withAdguard(async (args, a) => {
      const name = String(args.name).trim();
      const id = String(args.id).trim();
      if (!name || !id) throw new AdguardError('id and name are required');
      const { clients } = await clientsData(a);
      const existing = clients.find((c) => fold(c.name) === fold(id) || (c.ids ?? []).some((x) => fold(x) === fold(id)));
      if (existing) {
        await updateClient(a, existing, (c) => {
          c.name = name;
        });
        if (store) {
          store.update(GROUPS_KEY, (g) => {
            const out = g ?? {};
            for (const k of Object.keys(out)) out[k] = out[k].map((m) => (m === existing.name ? name : m));
            return out;
          });
        }
        return { renamed: true, from: existing.name, name, ids: existing.ids };
      }
      await a.post('/control/clients/add', {
        name,
        ids: [id],
        use_global_settings: true,
        filtering_enabled: true,
        parental_enabled: false,
        safebrowsing_enabled: false,
        use_global_blocked_services: true,
        blocked_services: [],
        tags: [],
        upstreams: [],
      });
      return { created: true, name, ids: [id] };
    }),
  });

  registry.registerTool({
    name: 'plugin_adguard_group',
    description:
      'Manage device groups kept by this plugin, e.g. "djeca" = kids PC + PS5 + TV + Android box, so one request ("block YouTube for the kids") covers them all. Add or remove device names, or delete the group. Returns all groups.',
    inputSchema: {
      type: 'object',
      properties: {
        group: { type: 'string' },
        add: { type: 'array', items: { type: 'string' }, description: 'Device names to add' },
        remove: { type: 'array', items: { type: 'string' }, description: 'Device names to remove' },
        delete: { type: 'boolean', description: 'Delete the whole group' },
      },
      required: ['group'],
      additionalProperties: false,
    },
    handler: withAdguard(async (args, a) => {
      const s = requireStore();
      const { clients } = await clientsData(a);
      const toNames = (list) =>
        (list ?? []).map((n) => {
          const r = resolveTarget(n, clients);
          if (r.kind !== 'device') throw new AdguardError(`"${n}" is a group; groups cannot contain groups`);
          return r.name;
        });
      const add = toNames(args.add);
      const remove = toNames(args.remove);
      const next = s.update(GROUPS_KEY, (g) => {
        const out = g ?? {};
        const key = Object.keys(out).find((k) => fold(k) === fold(args.group)) ?? String(args.group).trim();
        if (args.delete) {
          delete out[key];
          return out;
        }
        const members = new Set(out[key] ?? []);
        add.forEach((n) => members.add(n));
        remove.forEach((n) => members.delete(n));
        out[key] = [...members];
        return out;
      });
      return { groups: next };
    }),
  });

  registry.registerTool({
    name: 'plugin_adguard_services',
    description:
      'Block or allow services (youtube, tiktok, instagram, roblox, fortnite, netflix, …) for a device or group. Give `minutes` or `until` ("19:00", local time) to make it temporary: "let the kids watch YouTube until 19:00" = action allow, target djeca, services [youtube], until 19:00 — the plugin puts the block back by itself at 19:00, even across restarts. Without a duration the change is permanent. action "list" returns the service names AdGuard knows.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['block', 'allow', 'list'] },
        target: { type: 'string', description: 'Device name, IP or group' },
        services: { type: 'array', items: { type: 'string' } },
        minutes: { type: 'number', minimum: 1 },
        until: { type: 'string', description: 'Local wall-clock time HH:MM' },
      },
      required: ['action'],
      additionalProperties: false,
    },
    handler: withAdguard(async (args, a) => {
      const catalog = await serviceCatalog(a);
      if (args.action === 'list') return { services: catalog };
      if (!args.target || !Array.isArray(args.services) || args.services.length === 0) {
        throw new AdguardError('target and services are required');
      }
      const ids = resolveServices(args.services, catalog);
      const { clients } = await clientsData(a);
      const target = resolveTarget(args.target, clients);
      let durationMs = null;
      if (args.until) durationMs = msUntil(args.until, new Date(), config().timeZone);
      else if (args.minutes) durationMs = Math.round(args.minutes * 60_000);
      if (durationMs !== null) requireStore();

      const results = [];
      for (const client of target.clients) {
        const data = await updateClient(a, client, (c) => applyServices(c, ids, args.action));
        results.push({ device: client.name, blockedServices: data.blocked_services });
      }

      let revertsAt = null;
      if (durationMs !== null) {
        const at = Date.now() + durationMs;
        revertsAt = new Date(at).toISOString();
        const reverse = args.action === 'block' ? 'allow' : 'block';
        const entries = target.clients.map((c) => ({
          id: `${c.name}|${ids.join(',')}|${at}`,
          client: c.name,
          services: ids,
          action: reverse,
          at,
        }));
        store.update(PENDING_KEY, (list) => {
          // A newer temporary change for the same device and service replaces the older undo.
          const kept = (list ?? []).filter((p) => !entries.some((e) => e.client === p.client && p.services.some((s) => ids.includes(s))));
          return [...kept, ...entries];
        });
        entries.forEach(arm);
      }
      return { action: args.action, target: target.name, services: ids, devices: results, revertsAt, timeZone: config().timeZone };
    }),
  });

  registry.registerTool({
    name: 'plugin_adguard_schedule',
    description:
      'Weekly allowed time for a device or group: outside these windows its blocked services stay blocked, inside them they are allowed (AdGuard\'s "pause service blocking" schedule). E.g. "YouTube for the kids only 17-19 on weekdays and 10-20 at weekends" = two windows. One window per day. `clear: true` removes the schedule (services then stay blocked all the time). Make sure the services are blocked with plugin_adguard_services first.',
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string' },
        windows: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              days: { type: 'string', description: 'e.g. "mon-fri", "weekend", "daily", "sat,sun", "pon-pet"' },
              from: { type: 'string', description: 'HH:MM' },
              to: { type: 'string', description: 'HH:MM (24:00 = end of day)' },
            },
            required: ['days', 'from', 'to'],
            additionalProperties: false,
          },
        },
        clear: { type: 'boolean' },
      },
      required: ['target'],
      additionalProperties: false,
    },
    handler: withAdguard(async (args, a) => {
      const tz = config().timeZone;
      const schedule = { time_zone: tz };
      if (!args.clear) {
        if (!Array.isArray(args.windows) || args.windows.length === 0) throw new AdguardError('give windows, or clear: true');
        for (const w of args.windows) {
          const start = parseClock(w.from) * 60_000;
          const end = parseClock(w.to) * 60_000;
          if (end <= start) throw new AdguardError(`window ${w.from}-${w.to} ends before it starts`);
          for (const d of parseDays(w.days)) schedule[d] = { start, end };
        }
      }
      const { clients } = await clientsData(a);
      const target = resolveTarget(args.target, clients);
      for (const client of target.clients) {
        await updateClient(a, client, (c) => {
          c.blocked_services_schedule = schedule;
        });
      }
      return { target: target.name, devices: target.clients.map((c) => c.name), allowedWindows: describeSchedule(schedule) };
    }),
  });

  registry.registerTool({
    name: 'plugin_adguard_activity',
    description:
      'What a device (or group, or the whole house) has been doing: most visited sites from the AdGuard query log, how many requests were blocked and the latest blocked ones. Answers "what was the kids\' PC doing today" or "why does this site not load".',
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'Device, IP or group; omit for everyone' },
        blockedOnly: { type: 'boolean' },
        limit: { type: 'integer', minimum: 10, maximum: 1000, default: 300, description: 'How many recent log entries to read' },
      },
      additionalProperties: false,
    },
    handler: withAdguard(async (args, a) => {
      const limit = Math.min(Math.max(Number(args.limit) || 300, 10), 1000);
      const status = args.blockedOnly ? '&response_status=blocked' : '';
      let searches = [''];
      let targetName = 'everyone';
      if (args.target) {
        const { clients } = await clientsData(a);
        const target = resolveTarget(args.target, clients);
        targetName = target.name;
        searches = target.clients.map((c) => (c.ids ?? [])[0]).filter(Boolean);
      }
      const entries = [];
      for (const s of searches) {
        const q = s ? `&search=${encodeURIComponent(s)}` : '';
        const log = await a.get(`/control/querylog?limit=${limit}${q}${status}`);
        entries.push(...(log?.data ?? []));
      }
      const isBlocked = (e) => typeof e.reason === 'string' && e.reason.startsWith('Filtered');
      const sites = new Map();
      for (const e of entries) {
        const host = e.question?.name;
        if (!host) continue;
        const key = baseDomain(host);
        const cur = sites.get(key) ?? { site: key, requests: 0, blocked: 0 };
        cur.requests += 1;
        if (isBlocked(e)) cur.blocked += 1;
        sites.set(key, cur);
      }
      const times = entries.map((e) => e.time).filter(Boolean).sort();
      return {
        target: targetName,
        entriesRead: entries.length,
        from: times[0] ?? null,
        to: times[times.length - 1] ?? null,
        blocked: entries.filter(isBlocked).length,
        topSites: [...sites.values()].sort((x, y) => y.requests - x.requests).slice(0, 25),
        latestBlocked: entries
          .filter(isBlocked)
          .slice(0, 10)
          .map((e) => ({ time: e.time, site: e.question?.name, device: e.client_info?.name || e.client, reason: e.reason })),
      };
    }),
  });

  registry.registerTool({
    name: 'plugin_adguard_stats',
    description: 'House-wide AdGuard numbers for its statistics period: total and blocked requests, busiest devices (by name), most blocked and most visited domains.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: withAdguard(async (_args, a) => {
      const s = (await a.get('/control/stats')) ?? {};
      const { clients } = await clientsData(a);
      const nameOf = (ip) => clients.find((c) => (c.ids ?? []).includes(ip))?.name ?? ip;
      const flat = (list) => (list ?? []).flatMap((o) => Object.entries(o));
      return {
        requests: s.num_dns_queries ?? null,
        blocked: s.num_blocked_filtering ?? null,
        periodHours: s.time_units === 'days' ? (s.dns_queries?.length ?? 0) * 24 : (s.dns_queries?.length ?? null),
        topDevices: flat(s.top_clients).slice(0, 10).map(([ip, n]) => ({ device: nameOf(ip), ip, requests: n })),
        topBlocked: flat(s.top_blocked_domains).slice(0, 10).map(([d, n]) => ({ domain: d, count: n })),
        topVisited: flat(s.top_queried_domains).slice(0, 10).map(([d, n]) => ({ domain: d, count: n })),
      };
    }),
  });

  registry.registerTool({
    name: 'plugin_adguard_site',
    description:
      'Block or allow a single website for everyone or for one device/group ("block roblox.com on the kids PC", "unblock this shop, it does not load"). action "remove" deletes the plugin\'s rule for that domain again. Uses AdGuard custom filtering rules.',
    inputSchema: {
      type: 'object',
      properties: {
        domain: { type: 'string' },
        action: { type: 'string', enum: ['block', 'allow', 'remove'] },
        target: { type: 'string', description: 'Device or group; omit for everyone' },
      },
      required: ['domain', 'action'],
      additionalProperties: false,
    },
    handler: withAdguard(async (args, a) => {
      const domain = normalizeDomain(args.domain);
      const status = (await a.get('/control/filtering/status')) ?? {};
      const rules = status.user_rules ?? [];
      const mine = (r) => r.replace(/^@@/, '').startsWith(`||${domain}^`);
      let kept = rules.filter((r) => !mine(r));
      let added = null;
      if (args.action !== 'remove') {
        let suffix = '';
        if (args.target) {
          const { clients } = await clientsData(a);
          const target = resolveTarget(args.target, clients);
          suffix = `$client=${clientRuleModifier(target.clients.map((c) => c.name))}`;
        }
        added = `${args.action === 'allow' ? '@@' : ''}||${domain}^${suffix}`;
        kept = [...kept, added];
      }
      await a.post('/control/filtering/set_rules', { rules: kept });
      return { domain, action: args.action, rule: added, removed: rules.filter(mine) };
    }),
  });

  registry.registerTool({
    name: 'plugin_adguard_protection',
    description: 'Turn AdGuard filtering off for a while ("a site does not work, pause ad blocking for 10 minutes") or back on. Pausing affects every device. Without minutes it stays off until turned on.',
    inputSchema: {
      type: 'object',
      properties: {
        enabled: { type: 'boolean' },
        minutes: { type: 'number', minimum: 1, maximum: 1440 },
      },
      required: ['enabled'],
      additionalProperties: false,
    },
    handler: withAdguard(async (args, a) => {
      const body = { enabled: Boolean(args.enabled) };
      if (!args.enabled && args.minutes) body.duration = Math.round(args.minutes * 60_000);
      await a.post('/control/protection', body);
      const st = (await a.get('/control/status')) ?? {};
      return { protectionEnabled: st.protection_enabled ?? body.enabled, resumesInMinutes: body.duration ? body.duration / 60_000 : null };
    }),
  });

  // ---- dashboard page (Shinobi >= 0.4.0): sidebar → Apps → AdGuard --------

  if (typeof registry.registerPage === 'function') {
    registry.registerPage({
      id: 'adguard',
      title: 'AdGuard',
      icon: 'shield',
      order: 20,
      render: async () => {
        try {
          await runDue();
        } catch {
          /* shown below if AdGuard is really unreachable */
        }
        const a = api();
        const tz = config().timeZone;
        const [{ clients }, stats, status] = await Promise.all([
          clientsData(a),
          a.get('/control/stats').catch(() => null),
          a.get('/control/status').catch(() => null),
        ]);
        const clock = (ms) => new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(ms));
        const blocks = [];

        const total = stats?.num_dns_queries ?? null;
        const blockedCount = stats?.num_blocked_filtering ?? null;
        const on = status?.protection_enabled !== false;
        blocks.push({
          type: 'stats',
          items: [
            { label: 'Protection', value: on ? 'On' : 'Paused', tone: on ? 'ok' : 'warn' },
            { label: 'Requests', value: total ?? '—', hint: 'statistics period' },
            { label: 'Blocked', value: blockedCount ?? '—', hint: total ? `${Math.round(((blockedCount ?? 0) / total) * 100)}%` : undefined },
            { label: 'Named devices', value: clients.length },
          ],
        });
        blocks.push({
          type: 'actions',
          buttons: on
            ? [{ label: 'Pause filtering 10 min', tool: 'plugin_adguard_protection', args: { enabled: false, minutes: 10 }, confirm: 'Turn off ad and site blocking for every device for 10 minutes?' }]
            : [{ label: 'Resume filtering', tool: 'plugin_adguard_protection', args: { enabled: true }, variant: 'primary' }],
        });

        // Groups with one-tap temporary allow for each service blocked in the group.
        for (const [name, members] of Object.entries(groups())) {
          const devs = members.map((m) => clients.find((c) => fold(c.name) === fold(m))).filter(Boolean);
          const svc = [...new Set(devs.flatMap((c) => (c.use_global_blocked_services ? [] : (c.blocked_services ?? []))))].sort();
          blocks.push({ type: 'heading', text: `Group: ${name}` });
          blocks.push({
            type: 'list',
            items: devs.map((c) => ({
              title: c.name,
              subtitle: c.use_global_blocked_services ? 'global settings' : (c.blocked_services ?? []).join(', ') || 'nothing blocked',
            })),
            empty: 'No devices in this group.',
          });
          const buttons = [];
          for (const s of svc.slice(0, 4)) {
            buttons.push({ label: `Allow ${s} 1 h`, tool: 'plugin_adguard_services', args: { action: 'allow', target: name, services: [s], minutes: 60 }, variant: 'primary' });
          }
          for (const s of svc.slice(0, 4)) {
            buttons.push({ label: `Block ${s} now`, tool: 'plugin_adguard_services', args: { action: 'block', target: name, services: [s] } });
          }
          if (buttons.length) blocks.push({ type: 'actions', buttons });
        }

        const temp = pending();
        blocks.push({ type: 'heading', text: 'Temporary changes' });
        blocks.push({
          type: 'list',
          items: temp
            .slice()
            .sort((x, y) => x.at - y.at)
            .map((p) => ({
              title: `${p.client}: ${p.services.join(', ')}`,
              subtitle: `${p.action === 'block' ? 'blocked again' : 'allowed again'} at ${clock(p.at)}`,
              badge: p.action === 'block' ? 'allowed now' : 'blocked now',
              tone: p.action === 'block' ? 'warn' : 'muted',
            })),
          empty: 'None. Every block is as configured.',
        });

        const rows = [];
        for (const c of clients) {
          const id = (c.ids ?? [])[0];
          let last = '';
          if (id) {
            const log = await a.get(`/control/querylog?limit=1&search=${encodeURIComponent(id)}`).catch(() => null);
            const t = log?.data?.[0]?.time;
            if (t) last = Date.now() - Date.parse(t) > DAY_MS ? 'over a day ago ⚠' : clock(Date.parse(t));
            else last = 'never ⚠';
          }
          rows.push([
            c.name,
            (c.ids ?? []).join(', '),
            c.use_global_blocked_services ? 'global' : (c.blocked_services ?? []).join(', ') || '—',
            describeSchedule(c.blocked_services_schedule).join('; ') || '—',
            last,
          ]);
        }
        blocks.push({ type: 'heading', text: 'Devices' });
        blocks.push({ type: 'table', columns: ['Device', 'IP', 'Blocked', 'Allowed windows', 'Last seen'], rows, empty: 'No named devices yet. Ask Claude to name them.' });
        blocks.push({ type: 'text', text: '⚠ = no DNS requests for a day: the device is off, or no longer uses AdGuard as its DNS.', tone: 'muted' });

        return { blocks, refreshSeconds: 30 };
      },
    });
  }
}

export function describeSchedule(schedule) {
  if (!schedule) return [];
  const fmt = (ms) => {
    const m = Math.round(ms / 60_000);
    return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  };
  return ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
    .filter((d) => schedule[d] && schedule[d].end > schedule[d].start)
    .map((d) => `${d} ${fmt(schedule[d].start)}-${fmt(schedule[d].end)}`);
}
