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

Matching is a case-insensitive substring match, so "thompson" finds "Marko
Perković Thompson". If tags give nothing, free-text and genre terms are retried
against the file path, so an untagged `Rock/Some band - Song.mp3` still plays
for "rock". A search with no match leaves the current queue untouched.

**Nothing is ever deleted.** The plugin only speaks the MPD protocol, which has
no way to remove files. "Dislike" puts the song on a banned list kept in
Shinobi's per-plugin state (so it is backed up and synced with the rest of the
brain); banned files are filtered out of every future `plugin_music_play` and
can be restored with `plugin_music_banned`. The banned list needs a host with
`registry.state` (Shinobi ≥ 0.3.2); playback works without it.

## Configuration

Read from the Shinobi host's environment on every call:

| Variable | Default | Meaning |
| --- | --- | --- |
| `SHINOBI_MPD_SOCKET` | — | Path to MPD's unix socket. Preferred, and the easiest way to reach a host MPD from the Docker image. |
| `SHINOBI_MPD_HOST` | `127.0.0.1` | TCP host when no socket is set |
| `SHINOBI_MPD_PORT` | `6600` | TCP port |
| `SHINOBI_MPD_PASSWORD` | — | Sent with MPD's `password` command |

## Setup on an Ubuntu host with Shinobi in Docker

MPD runs on the host as the desktop user, so it plays through PipeWire to the
machine's audio output, and exposes only a unix socket — no network port.

```bash
sudo apt install -y mpd
sudo systemctl disable --now mpd.service mpd.socket   # the system instance is not used
sudo usermod -aG audio "$USER"                        # audio access without a desktop login
sudo loginctl enable-linger "$USER"                   # user services start at boot
mkdir -p ~/Muzika ~/.mpd/playlists ~/.config/mpd
cat > ~/.config/mpd/mpd.conf <<'EOF'
music_directory    "~/Muzika"
playlist_directory "~/.mpd/playlists"
db_file            "~/.mpd/database"
state_file         "~/.mpd/state"
bind_to_address    "~/.mpd/socket"
auto_update        "yes"
audio_output {
    type "pipewire"
    name "Kucno kino"
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
```

The second output streams the same music as MP3 over HTTP on port 8000: open
`http://<host-ip>:8000` once in a phone's browser or VLC on the home network,
then switch with `plugin_music_output` ("play on the phone" / "play on the
speaker"). The stream has no authentication — keep it on the home network.

`auto_update` makes MPD pick up files dropped into `~/Muzika` on its own;
`plugin_music_rescan` forces a scan.

Copy the plugin into the Shinobi data volume and recreate the container with
the socket directory mounted (the data volume is untouched):

```bash
docker cp shinobi-plugin-music.mjs shinobi:/data/plugins/
TOKEN=$(docker exec shinobi printenv SHINOBI_DASHBOARD_TOKEN)
docker stop shinobi && docker rm shinobi
docker run -d --name shinobi --restart unless-stopped -p 127.0.0.1:8765:8765 \
  -v shinobi-data:/data -v "$HOME/.mpd:/mpd" \
  -e SHINOBI_DASHBOARD_TOKEN="$TOKEN" -e SHINOBI_MPD_SOCKET=/mpd/socket \
  shinobiapps/shinobi:latest
```

The container runs as root, so it can use the socket whatever its file mode.

## Test

```bash
npm test   # node --test against an in-process fake MPD; no install needed
```
