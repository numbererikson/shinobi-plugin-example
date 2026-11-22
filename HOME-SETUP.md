# Home server from an old laptop: Shinobi + training + music

One guide, top to bottom, for turning an old laptop into a home server that
the Claude app talks to from anywhere:

- **Shinobi**: the shared MCP brain (projects, decisions, notes), reachable
  at `https://shinobi.<your-domain>/mcp` through a Cloudflare Tunnel, no open ports.
- **Fitness plugin**: a training assistant ("what do I train today", log a
  workout, weight, pain).
- **Music plugin**: "play rock", "play Led Zeppelin", "next", "this one
  annoys me", playing through the laptop's headphone jack into a home
  theater's AUX input, or as a stream to a phone on the home Wi-Fi.
- **Backups** of the brain to a private GitHub repo every night, with a phone
  alert when one fails.
- Optional: **AdGuard Home** for ad and site blocking per device.
- **Remember plugin**: personal memory ("what's the Wi-Fi password?") and
  reminders that arrive as push notifications on the phone.

Needs **Shinobi 0.8.0 or newer**. Every step after the Ubuntu install runs
over SSH from another computer.
Replace `tomislav` with the laptop user, `192.168.1.100` with the laptop's IP
and `example.com` with your domain.

## What you need

| Thing | Notes |
| --- | --- |
| An old laptop | Any x86-64 with 4 GB RAM is plenty. Leave it plugged in, lid closed. |
| A USB stick (8 GB) | For the Ubuntu installer. |
| A domain on Cloudflare | Free plan. The domain's DNS must be on Cloudflare (status **Active**). |
| A Claude plan with custom connectors | For the Claude app on phone and desktop. |
| A GitHub account | For the private backup repo. |
| A 3.5 mm cable | Laptop headphone jack → home theater AUX. |

---

## 1. Ubuntu on the laptop

1. Download **Ubuntu Server 24.04 LTS** (or Desktop, both work) and write it
   to the USB stick with [Rufus](https://rufus.ie) or balenaEtcher.
2. Boot the laptop from USB (HP: **F9** boot menu, **F10** BIOS). Install with
   the whole disk, and tick **Install OpenSSH server**.
3. Remove the stick and reboot.

> **HP "Boot Device Not Found" after install:** older HP BIOSes refuse a GPT
> disk without the protective-MBR boot flag. Boot the USB again → "Try
> Ubuntu" / shell, then `sudo parted /dev/sda disk_set pmbr_boot on` (check
> the disk name with `lsblk`) and reboot.

Keep it running with the lid closed:

```bash
sudo sed -i 's/^#\?HandleLidSwitch=.*/HandleLidSwitch=ignore/; s/^#\?HandleLidSwitchExternalPower=.*/HandleLidSwitchExternalPower=ignore/' /etc/systemd/logind.conf
sudo systemctl restart systemd-logind
```

Give the laptop a fixed address: in the router's DHCP settings, reserve an
IP (e.g. `192.168.1.100`) for the laptop's MAC address. From now on:

```bash
ssh tomislav@192.168.1.100
```

---

## 2. Docker and Shinobi

```bash
sudo apt update && sudo apt install -y docker.io docker-compose-v2 git curl
sudo usermod -aG docker tomislav
exit                                   # reconnect so the docker group applies
```

Shinobi runs from a folder with two files: `compose.yaml` (how to run it)
and `shinobi.env` (settings and the dashboard token, readable only by you).

```bash
mkdir ~/shinobi-server && cd ~/shinobi-server
curl -fsSLO https://raw.githubusercontent.com/numbererikson/shinobi/main/compose.yaml
umask 077
{
  echo "SHINOBI_DASHBOARD_TOKEN=$(openssl rand -hex 24)"
  echo "SHINOBI_TIMEZONE=Europe/Zagreb"
  echo "TZ=Europe/Zagreb"
} > shinobi.env
docker compose up -d
docker compose ps                      # shinobi ... (healthy) after ~20 s
curl http://127.0.0.1:8765/health      # {"ok":true,...}
```

**Save the token in a password manager**: every client needs it. Show it
with `grep TOKEN ~/shinobi-server/shinobi.env`. It is never printed in logs.

The `shinobi-data` volume holds the database, plugins and keys. Recreating
or upgrading the container never touches it.

---

## 3. Cloudflare Tunnel: reach it from anywhere

Cloudflare dashboard → **Zero Trust** (first time: pick the **Free** plan).

1. **Networks → Connectors → Create a tunnel** → **Cloudflared** → name
   `shinobi` → Save.
2. Under "Install and run a connector", set the OS dropdown to **Debian /
   64-bit** (it defaults to Windows). Run the two shown blocks on the laptop:
   first the apt install, then `sudo cloudflared service install eyJ...`.
3. When the connector shows **Connected**, open **Published application
   routes → Add**:
   - Subdomain `shinobi`, domain `example.com`
   - Service: type **HTTP**, URL **`localhost:8765`**
4. Cloudflare → your domain → **SSL/TLS → Edge Certificates → Minimum TLS
   Version = 1.2**. A 1.3 minimum breaks every call from Claude's cloud.

Test from the phone: `https://shinobi.example.com/health` → `{"ok":true}`.
Open `https://shinobi.example.com`: a sign-in page asks for the token once,
then the browser stays signed in for 30 days.

**Optional, recommended before sharing the address:** put Cloudflare Access
in front of the dashboard. It adds an email login that lasts a month per
device, and it leaves `/mcp` and the OAuth pages open for Claude:
[cloudflare-access.md](https://github.com/numbererikson/shinobi/blob/main/docs/cloudflare-access.md).

---

## 4. Connect the Claude app

claude.ai → **Settings → Connectors → Add custom connector**:

- Name: `Shinobi`
- URL: `https://shinobi.example.com/mcp/home` (only the URL: no token, no headers)

`/mcp/home` carries the home tools only (music, AdGuard, Remember, fitness),
so everyday chats are not crowded with development tools. `/mcp` carries
everything. Use that one for Claude Code.

Press **Connect**. A Shinobi page asks "Allow Claude?". Enter your dashboard
token once, or just press **Allow** if this browser is already signed in to
the dashboard. Claude gets its own revocable access, listed in the dashboard
under **Settings → Connected apps**. Never put the token in the URL: Shinobi
does not accept it there.

The connector syncs to the phone app. Tools appear in **new** chats. A chat
that was already open keeps the tool list it started with.

For Claude Code on a computer:

```bash
read -s -p "Shinobi token: " T; echo
claude mcp add --transport http shinobi https://shinobi.example.com/mcp \
  --header "Authorization: Bearer $T"
unset T
```

---

## 5. Nightly backup to GitHub

1. On GitHub create a **private** repo, e.g. `shinobi-sync`.
2. GitHub → Settings → Developer settings → **Fine-grained token** with
   access to that one repo only, permission **Contents: Read and write**.
3. On the laptop (type the token at the prompt, it is not echoed):

```bash
read -s -p "GitHub token: " PAT; echo
docker exec shinobi git clone "https://$PAT@github.com/YOUR_USER/shinobi-sync.git" /data/sync
unset PAT
docker exec shinobi git -C /data/sync config user.name "shinobi-server"
docker exec shinobi git -C /data/sync config user.email "shinobi@localhost"
docker exec shinobi node /app/dist/cli.js sync init /data/sync
docker exec shinobi node /app/dist/cli.js sync push
```

From now on Shinobi pushes a snapshot **every night at 03:17** by itself
(`SHINOBI_BACKUP_CRON` in `shinobi.env` changes the time). If a push fails,
or there has been no backup for 26 hours, the phone gets a push notification
(set up in step 10), and the **Sync** panel at the bottom of the sidebar
shows the error. An old `docker exec … sync push` line in `crontab -e` can
be deleted.

A server that is down cannot warn about itself. Add a free uptime monitor
(UptimeRobot, Better Stack, …) on `https://shinobi.example.com/health`.

To restore after a reinstall, see Shinobi's
[recovery runbook](https://github.com/numbererikson/shinobi/blob/main/docs/recovery-runbook.md).

---

## 6. Sound: make the headphone jack work

Plug the cable into the laptop's **headphone jack** (not a dock) and set the
home theater to **AUX**.

```bash
sudo usermod -aG audio tomislav        # without this: "no soundcards found"
exit                                   # reconnect so the group applies
aplay -l                               # card 0 = analog (headphone jack), card 1 = HDMI
```

Unmute everything on card 0 and keep the laptop at maximum. Loudness is set
on the home theater or by voice. Some control names differ per laptop
(`amixer -c 0 scontrols` lists them). "Unable to find simple control" for one
of them is harmless.

```bash
amixer -c 0 sset Master 100% unmute
amixer -c 0 sset Headphone 100% unmute
amixer -c 0 sset 'Speaker+LO' 100% unmute
amixer -c 0 sset PCM 100% unmute
amixer -c 0 sset 'Auto-Mute Mode' Disabled
sudo alsactl store                     # survive reboots
speaker-test -D plughw:0,0 -t wav -c 2 -l 1   # a voice says "Front Left", "Front Right"
```

- Test ends in about a second and nothing is heard: it played to a dummy
  device. Check the audio group.
- It takes about ten seconds but stays silent: check the mixer, the cable and
  the receiver's input.

---

## 7. Music player (MPD) and the music folder

```bash
sudo apt install -y mpd
sudo systemctl disable --now mpd.service mpd.socket   # only the per-user MPD is used
sudo loginctl enable-linger tomislav                  # user services start at boot
mkdir -p ~/Muzika/Rock ~/Muzika/Rap ~/.mpd/playlists ~/.config/mpd
cat > ~/.config/mpd/mpd.conf <<'EOF'
music_directory    "~/Muzika"
playlist_directory "~/.mpd/playlists"
db_file            "~/.mpd/database"
state_file         "~/.mpd/state"
bind_to_address    "~/.mpd/socket"
auto_update        "yes"
audio_output {
    type        "alsa"
    name        "Kucno kino"
    device      "plughw:0,0"
    mixer_type  "software"
}
audio_output {
    type     "httpd"
    name     "Mobitel stream"
    encoder  "lame"
    port     "8000"
    bitrate  "192"
    format   "44100:16:2"
    always_on "yes"
    tags     "yes"
}
EOF
systemctl --user enable --now mpd
sudo systemctl restart user@$(id -u)   # picks up the audio group; drops SSH, reconnect
systemctl --user status mpd --no-pager | head -3      # active (running)
```

### Share the folder with Windows

```bash
sudo apt install -y samba
sudo tee -a /etc/samba/smb.conf <<'EOF'

[Muzika]
   path = /home/tomislav/Muzika
   read only = no
   valid users = tomislav
EOF
sudo smbpasswd -a tomislav             # a new password, only for this share
sudo systemctl restart smbd
```

In Windows File Explorer open `\\192.168.1.100\Muzika`, log in as `tomislav`
and tick **Remember my credentials**. Windows 11 refuses password-less shares,
so the password is required.

### How to lay out the music

```
Muzika/
  Rock/
    Led Zeppelin/
    AC-DC/
  Rap/
    Eminem/
    2Pac/
  Domoljubne/
    Thompson/
```

- "play rock": everything under `Rock/`, shuffled.
- "play Led Zeppelin": only `Rock/Led Zeppelin/`.
- "play rap": all of `Rap/`.
- "play Eminem": only `Rap/Eminem/`.

Each song plays once before anything repeats. Missing tags don't matter;
words are matched against folder and file names, accents ignored
("cavoglave" finds "Čavoglave"). New files show up on their own within
seconds.

> **The music folder has no backup.** Keep a copy of your MP3s on another
> computer or disk.

---

## 8. Install the plugins

The music plugin talks to MPD through its socket, so give the container that
folder first. In `~/shinobi-server/compose.yaml` remove the `#` in front of
`- ${HOME}/.mpd:/mpd`, then:

```bash
cd ~/shinobi-server
echo "SHINOBI_MPD_SOCKET=/mpd/socket" >> shinobi.env
docker compose up -d
```

Then in the dashboard: **Plugins → Plugins on this server → Catalog** →
**Install** next to Music and Fitness → **Restart now**. The sidebar shows
the new modules after the reload. **Settings → Modules** switches any of them
off without uninstalling.

Check it. Empty output from the second command is good: only failures are
logged.

```bash
docker compose ps                                     # shinobi ... (healthy)
docker compose logs shinobi 2>&1 | grep -iE "plugin|music"
```

Test playback directly on the laptop:

```bash
curl -s http://127.0.0.1:8765/mcp \
  -H "Authorization: Bearer $(grep ^SHINOBI_DASHBOARD_TOKEN= ~/shinobi-server/shinobi.env | cut -d= -f2)" \
  -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"plugin_music_play","arguments":{"query":"rock"}}}'
```

If it answers `"state": "pause"` instead of `"play"`, MPD could not open the
sound card. Check `journalctl --user -u mpd -n 15`. If you see `Cannot get
card index`, run the `sudo systemctl restart user@$(id -u)` line again.

Then, in a **new** chat in the Claude app: "play Led Zeppelin".

### Announcements on the speaker (optional)

To have Claude say things out loud ("tell my wife lunch is ready"), install
espeak-ng and the small host helper. The steps are in
[music/README.md → Announcements](music/README.md#announcements-plugin_music_say).

### Everyday phrases

| Say | Does |
| --- | --- |
| "play rock / Eminem / Čavoglave" | queue and play |
| "next", "pause", "resume", "louder", "quieter" | transport and volume |
| "this one annoys me" | skip and never play it again (the file is **not** deleted) |
| "what did I ban?" / "bring back …" | banned list / restore |
| "play on the phone" | on the home Wi-Fi, first open `http://192.168.1.100:8000` on the phone |
| "play on the speaker" | back to the home theater |
| "rescan the music" | after adding many files at once |
| "tell my wife lunch is ready" | says it on the speaker (needs the announcements helper) |
| "what do I train today?", "log my workout" | fitness plugin |

---

## 9. Optional: AdGuard Home (ads and blocked sites per device)

```bash
curl -s -S -L https://raw.githubusercontent.com/AdguardTeam/AdGuardHome/master/scripts/install.sh | sh -s -- -v
sudo mkdir -p /etc/systemd/resolved.conf.d
printf '[Resolve]\nDNS=127.0.0.1\nDNSStubListener=no\n' | sudo tee /etc/systemd/resolved.conf.d/adguardhome.conf
sudo mv /etc/resolv.conf /etc/resolv.conf.backup
sudo ln -s /run/systemd/resolve/resolv.conf /etc/resolv.conf
sudo systemctl reload-or-restart systemd-resolved
```

Open `http://192.168.1.100:3000` for the first-run wizard: admin web on port
80, DNS on port 53. Then open **Filters → DNS blocklists** and add "AdGuard
DNS filter" and "HaGeZi Pro".

Point devices at it. Many ISP routers (e.g. HT's) don't let you change the DNS
they hand out, so set it per device: DNS `192.168.1.100`, alternate
`1.1.1.1`. Reserve each device's IP in the router so AdGuard can tell them
apart. Under **Settings → Client settings**, add a device by IP to give it
its own rules, e.g. **Blocked services → YouTube** for a TV or a kid's box.

> Don't turn on AdGuard's own DHCP server next to the router's: two DHCP
> servers on one network leave Wi-Fi devices without internet.

### Run AdGuard by voice

The [AdGuard plugin](adguard/README.md) lets the Claude app manage this:
- "let the kids watch YouTube until 19:00": blocked again at 19:00 by itself;
- "YouTube only 17–19 on weekdays";
- "what was the kids' PC doing today?";
- "pause ad blocking for 10 minutes".

Install it from **Plugins → Catalog** and add its settings to
`~/shinobi-server/shinobi.env` as its README shows.

---

## 10. Reminders, memory and phone notifications

Needs **Shinobi 0.7.0 or newer** (see Maintenance → Update Shinobi).

### Install the Remember plugin

Dashboard → **Plugins → Catalog** → **Install** next to Remember →
**Restart now**. The sidebar now shows **Remember** right after Music.

Memory values are encrypted with a key the plugin creates on first use at
`/data/remember.key`. It sits on the `shinobi-data` volume, but **not** in the
nightly backup (the backup only carries the database). Copy it somewhere safe
once:

```bash
docker cp shinobi:/data/remember.key ~/remember.key.backup
```

Without it, a restored backup still has the reminders and the names of the
remembered facts, but their values cannot be read. The Remember page keeps a
warning up until you press **I've backed it up**.

### Push notifications on the phone

Reminders arrive as push notifications, so the phone has to subscribe once.

**iPhone** (iOS 16.4 or newer). Push only works from the dashboard added to
the home screen, not from a Safari tab:

1. In **Safari** open `https://shinobi.example.com`.
2. **Share** (square with an arrow) → **Add to Home Screen** → **Add**. If you
   see an **Open as Web App** switch, leave it on.
3. Open **Shinobi from the home-screen icon**. The installed app does not
   share Safari's login, so it shows a sign-in page. Enter the dashboard
   token and press **Sign in**. To show the token on the laptop:
   `grep TOKEN ~/shinobi-server/shinobi.env`.
4. Tap **☰** (top left) → **Push notifications** → **Subscribe this
   device**, then **Allow** when iOS asks.
5. Tap **Test push**. A "Shinobi" notification should arrive.

If iOS never asks: **Settings → Notifications → Shinobi → Allow
Notifications**, then open the app again and repeat step 4.

If **Test push** fails, the reason is on the Push page under the device
("last error") and in the log:

```bash
docker logs shinobi 2>&1 | grep web-push | tail -3
```

| Reason | Fix |
| --- | --- |
| `403` / `BadJwtToken` | Shinobi older than 0.7.2 sends a contact address Apple rejects. Update Shinobi (no re-subscribe needed). |
| `410` | The subscription expired. It is removed automatically; press **Subscribe this device** again. |
| `ENOTFOUND` / timeout | The laptop cannot reach the push service. Check its internet and DNS (AdGuard). |

iOS does not show action buttons on web notifications (at least through
current reports). Tapping a reminder opens the **Remember** page, which has
**Done** and **Snooze**. Android and desktop browsers show the buttons on the
notification itself.

**Android:** open the dashboard in Chrome → **⋮ → Install app** (or Add to
Home screen), then steps 3–5 above.

### Everyday phrases

| Say (in a **new** Claude chat) | Does |
| --- | --- |
| "remember that the Wi-Fi password is XY123" | saves it, encrypted |
| "what's the Wi-Fi password?", "what do you remember about Marko?" | recall |
| "forget the parking spot" | deletes it |
| "remind me in 2 minutes to try this" | quick test of the whole chain |
| "remind me tomorrow at 9 to call the bank" | one-time reminder |
| "every Monday at 9 remind me to send the report" | repeating reminder |
| "what reminders do I have?" / "cancel the bank one" | list / cancel |

Times are Zagreb time by default ("set Remember's time zone to Europe/London"
changes it). Details: [remember/README.md](remember/README.md).

---

## Maintenance

| Task | How |
| --- | --- |
| Update Shinobi | `cd ~/shinobi-server && docker compose pull && docker compose up -d` |
| Update a plugin | Dashboard → **Plugins → Check for updates → Update → Restart now** |
| Laptop reinstalled | steps 1–10 again, restore the brain from the backup (step 5 link), copy `remember.key.backup` back to `/data/remember.key`, and copy the music back |
| Phone app asks for the token again | the sign-in lasts 30 days. Enter the token again on the sign-in page |
| Something is off | `cd ~/shinobi-server && docker compose logs --tail 30 shinobi`, `journalctl --user -u mpd -n 20` |

### Moving an older `docker run` install to compose

For a server set up before 0.8.0. The database, plugins and keys stay on
the same `shinobi-data` volume.

```bash
mkdir -p ~/shinobi-server && cd ~/shinobi-server
curl -fsSLO https://raw.githubusercontent.com/numbererikson/shinobi/main/compose.yaml
[ -f ~/shinobi.env ] && mv ~/shinobi.env shinobi.env       # the env file from the AdGuard README, if you made one
[ -f shinobi.env ] || (umask 077; echo "SHINOBI_DASHBOARD_TOKEN=$(docker exec shinobi printenv SHINOBI_DASHBOARD_TOKEN)" > shinobi.env)
grep -c '^SHINOBI_DASHBOARD_TOKEN=.\{48\}$' shinobi.env  # must print 1, or STOP
grep -q '^SHINOBI_TIMEZONE=' shinobi.env || echo "SHINOBI_TIMEZONE=Europe/Zagreb" >> shinobi.env
sed -i 's|# - ${HOME}/.mpd:/mpd|- ${HOME}/.mpd:/mpd|' compose.yaml   # only if you use the music plugin
docker pull shinobiapps/shinobi:latest
docker stop shinobi && docker rm shinobi && docker compose up -d
docker compose ps                                          # (healthy) after ~20 s
crontab -l | grep -v 'sync push' | crontab -               # the nightly backup is built in now
```

In the Claude app, change the connector URL to
`https://shinobi.example.com/mcp/home`: remove the connector, add it again
and press **Connect**.

Per-plugin details: [music/README.md](music/README.md),
[fitness/README.md](fitness/README.md), [adguard/README.md](adguard/README.md),
[remember/README.md](remember/README.md).
