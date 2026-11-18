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
- **Backups** of the brain to a private GitHub repo every night.
- Optional: **AdGuard Home** for ad and site blocking per device.

Every step after the Ubuntu install runs over SSH from another computer.
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
sudo apt update && sudo apt install -y docker.io git curl
sudo usermod -aG docker tomislav
exit                                   # reconnect so the docker group applies
```

Run Shinobi with a new dashboard token. **Save the printed token in a
password manager**: every client needs it.

```bash
TOKEN=$(openssl rand -hex 24) && echo "SAVE THIS: $TOKEN"
docker run -d --name shinobi --restart unless-stopped \
  -p 127.0.0.1:8765:8765 \
  -v shinobi-data:/data \
  -e SHINOBI_DASHBOARD_TOKEN="$TOKEN" \
  shinobiapps/shinobi:latest
curl http://127.0.0.1:8765/health      # {"ok":true,...}
```

The `shinobi-data` volume holds the database. Replacing the container never
touches it.

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
The dashboard is at `https://shinobi.example.com/?token=YOUR_TOKEN` (open it
once; a cookie keeps you logged in).

---

## 4. Connect the Claude app

claude.ai → **Settings → Connectors → Add custom connector**:

- Name: `Shinobi`
- URL: `https://shinobi.example.com/mcp?token=YOUR_TOKEN`

The connector syncs to the phone app. Tools appear in **new** chats. A chat
that was already open keeps the tool list it started with.

For Claude Code on a computer:

```bash
claude mcp add --transport http shinobi https://shinobi.example.com/mcp \
  --header "Authorization: Bearer YOUR_TOKEN"
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
( crontab -l 2>/dev/null; echo '0 3 * * * docker exec shinobi node /app/dist/cli.js sync push' ) | crontab -
```

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

Both plugins are single files dropped into Shinobi's plugin folder. The
container is then recreated with the MPD socket mounted. The database and
the token are kept.

```bash
curl -fsSLO https://raw.githubusercontent.com/numbererikson/shinobi-plugin-example/main/fitness/standalone/shinobi-plugin-fitness.mjs
curl -fsSLO https://raw.githubusercontent.com/numbererikson/shinobi-plugin-example/main/music/shinobi-plugin-music.mjs
docker exec shinobi mkdir -p /data/plugins
docker cp shinobi-plugin-fitness.mjs shinobi:/data/plugins/
docker cp shinobi-plugin-music.mjs shinobi:/data/plugins/

TOKEN=$(docker exec shinobi printenv SHINOBI_DASHBOARD_TOKEN)
echo ${#TOKEN}                         # must be 48; if 0, STOP: the token would be lost
docker stop shinobi && docker rm shinobi
docker run -d --name shinobi --restart unless-stopped -p 127.0.0.1:8765:8765 \
  -v shinobi-data:/data -v "$HOME/.mpd:/mpd" \
  -e SHINOBI_DASHBOARD_TOKEN="$TOKEN" -e SHINOBI_MPD_SOCKET=/mpd/socket \
  shinobiapps/shinobi:latest
```

Check it. The full log prints the token, so always filter it. Empty output
from the second command is good: only failures are logged.

```bash
docker ps --format '{{.Names}} {{.Status}}'           # shinobi Up ...
docker logs shinobi 2>&1 | grep -iE "plugin|music"
```

Test playback directly on the laptop:

```bash
curl -s http://127.0.0.1:8765/mcp \
  -H "Authorization: Bearer $(docker exec shinobi printenv SHINOBI_DASHBOARD_TOKEN)" \
  -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"plugin_music_play","arguments":{"query":"rock"}}}'
```

If it answers `"state": "pause"` instead of `"play"`, MPD could not open the
sound card. Check `journalctl --user -u mpd -n 15`. If you see `Cannot get
card index`, run the `sudo systemctl restart user@$(id -u)` line again.

Then, in a **new** chat in the Claude app: "play Led Zeppelin".

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

Its README moves all Shinobi settings into one `~/shinobi.env` file, so
recreating the container stays a one-liner.

---

## Maintenance

| Task | How |
| --- | --- |
| Update Shinobi | `docker pull shinobiapps/shinobi:latest`, then the stop/rm/run block from step 8 |
| Update a plugin | its `curl` + `docker cp` line from step 8, then `docker restart shinobi` |
| Laptop reinstalled | steps 1–8 again, then restore the brain from the backup (step 5 link) and copy the music back |
| Something is off | `docker logs shinobi 2>&1 \| grep -iv token \| tail`, `journalctl --user -u mpd -n 20` |

Per-plugin details: [music/README.md](music/README.md),
[fitness/README.md](fitness/README.md).
