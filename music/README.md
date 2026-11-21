# shinobi-plugin-music

Voice-friendly music control for a self-hosted Shinobi. Say "play Thompson,
Čavoglave", "play some rock" or "skip" to any MCP client (Claude app, Claude
Code, Codex) and the speaker at home plays it.

The plugin is a thin client for [MPD](https://www.musicpd.org/) (Music Player
Daemon). MPD owns the library, tags and playback; the plugin turns requests into
MPD commands and returns structured facts. It is a single ESM file with **zero
runtime dependencies** — it speaks the MPD text protocol over `node:net`.

## Tools

| Tool | Purpose |
| --- | --- |
| `plugin_music_play` | Queue every match for `artist` / `title` / `album` / `genre` / free-text `query`, shuffled by default, and play. No filters = resume. |
| `plugin_music_control` | `pause`, `resume`, `toggle`, `stop`, `next`, `previous` |
| `plugin_music_volume` | Absolute `level` (0-100) or relative `change` (±) |
| `plugin_music_status` | State, current song, volume, queue length, position |
| `plugin_music_library` | List `artists`, `albums` (optionally of one artist) or `genres` |
| `plugin_music_dislike` | "This one annoys me": skip the current song, drop it from the queue and ban it from future plays |
| `plugin_music_banned` | Show the banned list, or `restore` songs matching a substring |
| `plugin_music_output` | List outputs, or choose where music plays (`target` substring; `only` or `add`) |
| `plugin_music_rescan` | Rescan the music folder after adding files |

### Folders decide what "play rock" means

Organise the music folder as `Genre/Artist/song.mp3`:

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

A single term is looked up as a folder name first, and plays everything below
it: "rock" plays all of `Rock/` (every artist), "led zeppelin" only
`Rock/Led Zeppelin/`, "rap" all of `Rap/`, "eminem" only `Rap/Eminem/`. A folder
whose name equals the term beats one that merely contains it ("rap" never picks
`Trap/`), and a song called "Rock Bottom" does not turn a "rock" request into one
song.

If no folder matches, MPD's tag search runs (artist, title, album, genre), then
every spoken word is looked for in the file path, so untagged downloads still
play: artist "thompson" + title "cavoglave" finds
`Domoljubne/Thompson/Bojna Čavoglave.mp3`. Matching ignores case and Croatian
diacritics. A search with no match leaves the current queue untouched.

**No repeats.** The queue is shuffled once and played in order, so every song
plays once before any song comes back; then the whole list starts over.

**Nothing is ever deleted.** The plugin only speaks the MPD protocol, which has
no way to remove files. "Dislike" puts the song on a banned list kept in
Shinobi's per-plugin state (so it is backed up and synced with the rest of the
brain); banned files are filtered out of every future `plugin_music_play` and
can be restored with `plugin_music_banned`. The banned list needs a host with
`registry.state` (Shinobi ≥ 0.3.2); playback works without it.

## Dashboard page

On Shinobi 0.4.0 or newer the plugin adds **Apps → Music** to the dashboard sidebar. The page shows:
- what is playing, with its position, the volume, the queue and where the music goes;
- buttons for previous, play/pause, next, quieter/louder and "skip & never again";
- one button per genre folder ("Rock (124)");
- the output switch (speaker or phone stream);
- the banned list.

It refreshes every 5 seconds. Older hosts simply don't show it.

## Configuration

Read from the Shinobi host's environment on every call:

| Variable | Default | Meaning |
| --- | --- | --- |
| `SHINOBI_MPD_SOCKET` | — | Path to MPD's unix socket. Preferred, and the easiest way to reach a host MPD from the Docker image. |
| `SHINOBI_MPD_HOST` | `127.0.0.1` | TCP host when no socket is set |
| `SHINOBI_MPD_PORT` | `6600` | TCP port |
| `SHINOBI_MPD_PASSWORD` | — | Sent with MPD's `password` command |

## Setup on an Ubuntu host with Shinobi in Docker

Tested on an old laptop running Ubuntu with its headphone jack wired to a home
theater's AUX input. Every step runs over SSH; replace `tomislav` with your
user.

### 1. Make the sound card audible

```bash
sudo usermod -aG audio tomislav   # without this ALSA reports "no soundcards found"
exit                              # log in again so the group applies
aplay -l                          # card 0 = analog (headphone jack), card 1 = HDMI
```

Unmute the analog path. Control names differ per laptop; `amixer -c 0 scontrols`
lists them, and a missing one just prints "Unable to find simple control":

```bash
amixer -c 0 sset Master 100% unmute       # 80% is already -19 dB: keep the laptop at max
amixer -c 0 sset Headphone 100% unmute
amixer -c 0 sset 'Speaker+LO' 100% unmute
amixer -c 0 sset PCM 100% unmute
amixer -c 0 sset 'Auto-Mute Mode' Disabled
speaker-test -D plughw:0,0 -t wav -c 2 -l 1   # says "Front Left", "Front Right"
```

Save the mixer so it survives a reboot, and control loudness on the receiver
or by voice (`plugin_music_volume`) from now on:

```bash
sudo alsactl store
```

If `speaker-test` finishes in about a second and nothing is heard, it played to
a dummy device: check the audio group. If it takes about ten seconds but stays
silent, check the mixer, the cable (headphone jack, not the dock) and the
receiver's input.

### 2. MPD as a user service

MPD runs as the login user and writes straight to the ALSA card, so no desktop
session or PipeWire is needed. It exposes only a unix socket.

```bash
sudo apt install -y mpd
sudo systemctl disable --now mpd.service mpd.socket   # the system instance is not used
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
systemctl --user status mpd --no-pager | head -5
```

If a song is found but the player drops straight to `pause`, check
`journalctl --user -u mpd -n 15`. `Cannot get card index for 0` means the user
service manager started before you joined the `audio` group (lingering keeps it
alive across logins). Restart it once; this drops the SSH session:

```bash
sudo systemctl restart user@$(id -u)
```

`auto_update` makes MPD pick up files dropped into `~/Muzika` on its own;
`plugin_music_rescan` forces a scan.

### 3. Share the music folder with Windows

```bash
sudo apt install -y samba
sudo tee -a /etc/samba/smb.conf <<'EOF'

[Muzika]
   path = /home/tomislav/Muzika
   read only = no
   valid users = tomislav
EOF
sudo smbpasswd -a tomislav     # a new password, used only for this share
sudo systemctl restart smbd
```

In Windows File Explorer open `\\<host-ip>\Muzika`, log in as `tomislav` and
tick "Remember my credentials". A password is required: Windows 11 blocks
password-less (guest) shares. Copy files in as `Genre/Artist/song.mp3`.

### 4. Plug it into Shinobi

Copy the plugin into the Shinobi data volume and recreate the container with
the socket directory mounted (the data volume and the dashboard token are kept):

```bash
curl -fsSLO https://raw.githubusercontent.com/numbererikson/shinobi-plugin-example/main/music/shinobi-plugin-music.mjs
docker cp shinobi-plugin-music.mjs shinobi:/data/plugins/
TOKEN=$(docker exec shinobi printenv SHINOBI_DASHBOARD_TOKEN)
echo ${#TOKEN}                 # must not be 0, or the old token is lost
docker stop shinobi && docker rm shinobi
docker run -d --name shinobi --restart unless-stopped -p 127.0.0.1:8765:8765 \
  -v shinobi-data:/data -v "$HOME/.mpd:/mpd" \
  -e SHINOBI_DASHBOARD_TOKEN="$TOKEN" -e SHINOBI_MPD_SOCKET=/mpd/socket \
  shinobiapps/shinobi:latest
```

The container runs as root, so it can use the socket whatever its file mode.

Check that it came up and loaded the plugin (the full log also prints the
dashboard token, so filter it):

```bash
docker ps --format '{{.Names}} {{.Status}}'          # shinobi Up ...
docker logs shinobi 2>&1 | grep -iE "plugin|music"
```

Then open a **new** chat in the Claude app (an existing chat keeps the tool
list it started with) and say "play Led Zeppelin".

To update the plugin later, repeat only the `curl` and `docker cp` lines and
`docker restart shinobi`.

### Listening on the phone

The second output streams the same music as MP3 over HTTP on port 8000. On the
home Wi-Fi, open `http://<host-ip>:8000` in the phone's browser or VLC, then say
"play on the phone" (`plugin_music_output`, target `mobitel`, mode `only`) or
"play on the speaker". Control works from anywhere the Claude app reaches
Shinobi; the stream itself has no authentication, so it stays on the home
network.

## Test

```bash
npm test   # node --test against an in-process fake MPD; no install needed
```
