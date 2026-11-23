# shinobi-plugin-adguard

Run a home [AdGuard Home](https://adguard.com/adguard-home/overview.html) by
voice from any MCP client (Claude app, Claude Code, Codex). Examples:

- "let the kids watch YouTube until 19:00"
- "block TikTok on the kids' PC"
- "YouTube only 17–19 on weekdays"
- "what was the TV doing today?"
- "this shop won't load, unblock it"
- "pause ad blocking for 10 minutes"

The plugin is a thin client for AdGuard Home's own REST API, the one its web
UI uses. AdGuard keeps owning the rules. The plugin adds friendly device names,
**device groups** ("djeca"/"kids") and **timed undo**: a temporary change is
reverted on time by itself, even if Shinobi restarts in between. It is a
single ESM file with zero runtime dependencies.

## Tools

| Tool | Purpose |
| --- | --- |
| `plugin_adguard_devices` | Named devices with blocked services, allowed windows and last activity; groups; unnamed active devices (with hostnames AdGuard learned); devices silent for 24 h (probably no longer using AdGuard as DNS) |
| `plugin_adguard_name_device` | Name a device by IP, MAC or current name ("192.168.1.10 is TV dnevna"), or rename it |
| `plugin_adguard_group` | Create, change or delete a group of devices |
| `plugin_adguard_services` | `block` / `allow` services (youtube, tiktok, roblox, …) for a device or group, permanently or for `minutes` / `until` "19:00"; `list` shows the service names |
| `plugin_adguard_schedule` | Weekly allowed windows per device or group ("pon-pet 17:00–19:00", "vikend 10–20"); `clear` removes them |
| `plugin_adguard_activity` | Most visited sites, blocked count and latest blocked requests for a device, group or everyone |
| `plugin_adguard_stats` | House-wide totals, busiest devices by name, most blocked and visited domains |
| `plugin_adguard_site` | Block or allow one website for everyone or a device/group; `remove` deletes that rule |
| `plugin_adguard_protection` | Pause filtering for N minutes, or turn it back on |

Names and groups match regardless of case or diacritics ("djecji pc" finds
"Dječji PC").

**How "allowed windows" work.** AdGuard can pause service blocking on a weekly
schedule. A device with YouTube blocked and a window "mon–fri 17:00–19:00" can
watch YouTube only in that window. One window per day.

**How temporary changes work.** "Allow YouTube until 19:00" removes the block
now and records the undo in Shinobi's plugin state (`registry.state`, so it is
backed up with the brain). A timer re-applies the block at 19:00. If Shinobi
was down at that moment, the undo runs on the next start or tool call. A newer
temporary change for the same device and service replaces the older undo.

## Dashboard page

On Shinobi 0.4.0 or newer the plugin adds **Apps → AdGuard** to the dashboard sidebar. The page shows:
- protection status and request and blocked counts, with a 10-minute pause button;
- each group with its devices, plus one-tap **Allow youtube 1 h** and **Block youtube now** buttons for every service blocked in the group;
- running temporary changes and when they end;
- a device table with blocked services, allowed windows and last activity. Devices silent for a day are flagged ⚠.

It refreshes every 30 seconds.

## Configuration

Read from the Shinobi host's environment on every call:

| Variable | Meaning |
| --- | --- |
| `SHINOBI_ADGUARD_URL` | AdGuard Home web address, e.g. `http://192.168.1.100` |
| `SHINOBI_ADGUARD_USER` | AdGuard admin user |
| `SHINOBI_ADGUARD_PASSWORD` | AdGuard admin password |
| `SHINOBI_ADGUARD_TZ` | IANA time zone for "until 19:00" and schedules. Falls back to `TZ`, then the process zone. Docker containers run in UTC unless you set it. |

## Setup with Shinobi in Docker

From inside the container, AdGuard is reached at the host's LAN address; it
does not need to be published anywhere else.

Add the AdGuard settings to the `shinobi.env` next to `compose.yaml` (see
HOME-SETUP step 2). The password is typed at a hidden prompt:

```bash
cd ~/shinobi-server
{
  echo "SHINOBI_ADGUARD_URL=http://192.168.1.100"
  echo "SHINOBI_ADGUARD_USER=admin"                # your AdGuard login name
  read -r -s -p "AdGuard password: " P; echo >&2; echo "SHINOBI_ADGUARD_PASSWORD=$P"; unset P
  grep -q '^TZ=' shinobi.env || echo "TZ=Europe/Zagreb"
} >> shinobi.env
docker compose up -d                               # picks up the new settings
```

Then install the plugin: Dashboard → **Plugins → Catalog → AdGuard →
Install → Restart now**.

Check from the laptop. The token is read from the env file and not shown:

```bash
curl -s http://127.0.0.1:8765/mcp \
  -H "Authorization: Bearer $(grep ^SHINOBI_DASHBOARD_TOKEN= ~/shinobi-server/shinobi.env | cut -d= -f2)" \
  -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"plugin_adguard_devices","arguments":{}}}'
```

Then, in a new chat in the Claude app, start with "show me the devices on the
network". Name the ones you care about and make a group ("put the kids' PC,
PS5, TV and Android box into group djeca").

## Morning brief

On Shinobi 0.10.0 and newer, the server's daily morning brief includes a
network section:
- requests and the blocked share for the statistics period;
- the busiest device;
- a warning when protection is off;
- temporary changes still running, e.g. "YouTube allowed until 19:00";
- "AdGuard: not reachable" when it does not answer.

## Limits

- Only devices whose DNS points at AdGuard are covered. A device that joins
  another Wi-Fi network, or gets its DNS from the ISP router, silently drops
  out. `plugin_adguard_devices` flags named devices that have been quiet for
  24 hours.
- Give important devices a fixed IP (outside the router's DHCP range, or a
  reservation), so a name always means the same device.
- A determined user can change a device's DNS by hand. For a hard cut-off,
  such as no internet after bedtime, use the router's own parental control,
  which blocks by MAC address.

## Test

```bash
npm test   # node --test against an in-process fake AdGuard Home; no install needed
```
