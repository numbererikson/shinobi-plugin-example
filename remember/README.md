# shinobi-plugin-remember

Personal memory and reminders for [Shinobi](https://github.com/numbererikson/shinobi),
driven from any Claude chat. Single file, zero runtime dependencies.

- **Memory:** "remember that the Wi-Fi password is XY123", "what's the Wi-Fi
  password?", "what do you remember about Marko?", "forget the parking spot".
  Values are encrypted at rest.
- **Reminders:** "remind me tomorrow at 9 to call the bank", "every Monday at
  9 remind me to send the report". They arrive as a push notification with
  **Done** and **Snooze 1h**, and no chat has to be open.
- **Dashboard page:** sidebar → **Remember** (right after Music). It shows due
  and upcoming reminders with buttons, and the list of remembered keys. Values
  are never shown on the page.

Needs **Shinobi 0.7.0+** for reminders (`registry.schedule` + `registry.notify`).
On an older host the memory tools still work and the page warns that
reminders will not fire.

## Install (Docker home server)

```bash
curl -fsSLO https://raw.githubusercontent.com/numbererikson/shinobi-plugin-example/main/remember/shinobi-plugin-remember.mjs
docker cp shinobi-plugin-remember.mjs shinobi:/data/plugins/
docker restart shinobi
docker logs shinobi 2>&1 | grep -i remember      # empty = loaded fine
```

To get push notifications, subscribe a device first: dashboard → **Push**. On
iPhone this only works from the app added to the home screen (Share → Add to
Home Screen).

## Tools

| Tool | What it does |
| --- | --- |
| `plugin_remember_save` | Remember a fact: `key`, `value`, optional `category`, optional `expires_at`. Saving an existing key replaces it. |
| `plugin_remember_recall` | Find facts whose key, category or value contains every word of `query` (case- and accent-insensitive). Without a query it lists everything. |
| `plugin_remember_forget` | Forget a fact by key. |
| `plugin_remember_remind` | `text` + `at` (local `YYYY-MM-DD HH:MM`) + optional `recurrence`: `daily`, `weekdays`, `weekly:monday,thursday`, `monthly:15`. |
| `plugin_remember_reminders` | Due and upcoming reminders, plus the current local time (Claude uses it to resolve "in 3 hours"). |
| `plugin_remember_done` | Finish a one-time reminder, or skip the next occurrence of a repeating one. |
| `plugin_remember_snooze` | Push a reminder back N minutes (default 60). On a repeating one this adds a one-time copy. |
| `plugin_remember_cancel` | Cancel a reminder, or stop a repeating series. |
| `plugin_remember_settings` | Show or change the time zone (default `Europe/Zagreb`). Also shows where the encryption key lives. |
| `plugin_remember_import` | Import a LIMAlife backup JSON (memories + open reminders). |

## How it behaves

- **Time zone.** Times you give and see are local to the plugin's time zone,
  `Europe/Zagreb` by default (change it with `plugin_remember_settings`). The
  Docker container runs UTC, and that doesn't matter here.
- **Firing.** A schedule checks every minute in the Shinobi dashboard process.
  A reminder fires once. A one-time reminder then waits as **Due** until you
  press Done or Snooze. A repeating one moves straight to its next occurrence.
  If the server was down, a missed reminder fires on the first check after it
  comes back; a repeating one jumps to its next future occurrence.
- **Buttons.** Pressing one button on a notification retires the other, so
  Done and Snooze never both happen. iOS doesn't show buttons on web
  notifications, so tapping the notification opens the Remember page, which
  has the same buttons.
- **Done on a repeating reminder** from a notification only acknowledges that
  occurrence. From the page or a chat it skips the next one. **Cancel** stops
  the series.
- Finished reminders are kept for 30 days, then dropped.

## Encryption

Values use AES-256-GCM. The key is **not** in Shinobi's database, so the
nightly `shinobi sync` never carries readable secrets:

| Setting | Meaning |
| --- | --- |
| `SHINOBI_REMEMBER_KEY` | 64 hex characters. Wins when set. |
| `SHINOBI_REMEMBER_KEY_FILE` | Key file path. Default: `<config dir>/remember.key`, which in Docker is `/data/remember.key` on the `shinobi-data` volume. Created on first use with mode 0600. |

**Back up the key file** (`docker cp shinobi:/data/remember.key .`). A database
restored without it still has the reminders and the memory keys, but the
values cannot be read. Until you confirm the backup ("I've backed it up" on
the Remember page, or tell Claude), the page shows a warning. A new key file
asks again.

## Moving from LIMAlife

1. ShinobiApps → `/limalife/admin/backup` → **Export** downloads
   `limalife-backup-YYYY-MM-DD.json`.
2. In a Claude chat: "import this LIMAlife backup into Remember", then paste
   the file contents. Claude calls `plugin_remember_import`.
3. Existing keys are kept (pass `overwrite: true` to replace them). Expired
   memories and finished reminders are skipped, and the report lists every
   skip.

## Test

```bash
npm test
```
