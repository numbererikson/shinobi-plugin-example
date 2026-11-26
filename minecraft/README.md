# shinobi-plugin-minecraft

Claude builds in your home Minecraft (Bedrock) world. Say "build Jurassic Park
next to Luka" or send a photo of a cathedral in the Claude app. Claude works
out the building as simple parts (boxes, towers, domes, pyramids, gable
roofs), and this plugin places them next to the player in the background. The
kids see it go up on the console. When it's done, the server chat says
"Majstor: … je gotov!" and your phone gets a push.

| Tool | What it does |
| --- | --- |
| `plugin_minecraft_players` | Who is online. |
| `plugin_minecraft_build` | Build from parts next to a player. It returns straight away and the build runs in the background. `extend_build` adds to an earlier build. |
| `plugin_minecraft_builds` | Recent builds and their status. |
| `plugin_minecraft_remove` | Tear an earlier build down (fills its box with air). |
| `plugin_minecraft_say` | Send a chat message ("Večera je gotova!"). |
| `plugin_minecraft_wishes` | What the kids asked for in the game. Claude designs the ones Majstor didn't know (`for_wish`). |

There is also a **Minecraft** dashboard page: who is online, builds, open
wishes and a chat box.

## Kids ask from inside the game

With the [Majstor behavior pack](pack/) on the server, a player types
**`/gradi dvorac`** (or `/majstor:gradi dvorac`). Nobody needs to be at the
keyboard:
- **Ready-made designs:** kuća, dvorac, toranj, piramida, svjetionik, bazen
  (Croatian or English words).
- **Everything Claude built before**, by name: after "Osječka katedrala", `/gradi katedrala` works.
- **`/gradi popis`** lists what Majstor knows.
- **Anything else:** Majstor answers "još ne znam…" and keeps the wish. The
  next time you talk to Claude, it sees the wish (`plugin_minecraft_wishes`),
  designs it next to that kid, and from then on it is known.

Wish builds don't send you a push. Each player can start one build every 30 s.

The pack only prints the wish to the server console. The plugin reads the
console through mc-bridge every few seconds.

## How it reaches the server

The Minecraft server is the
[`itzg/minecraft-bedrock-server`](https://github.com/itzg/docker-minecraft-bedrock-server)
container. Shinobi never gets the Docker socket. A small sidecar,
[`bridge/bridge.mjs`](bridge/bridge.mjs) (`mc-bridge`), holds the socket and
offers two things over HTTP:
- `POST /commands`;
- `GET /logs`.

The bridge:
- needs a shared token;
- has no published port, so only containers on Shinobi's Docker network can reach it;
- accepts only these console commands:
  - `fill`, `setblock`, `clone`;
  - `say`, `tellraw`, `list`, `querytarget`, `tickingarea`;
  - summoning and killing armor stands;
  - the two `execute` anchors the plugin uses.

Anything else is refused with 403, including `op`, `gamemode`, `give`, `kill @a`, `stop` and other mobs.

> The Docker socket is root on the host. The command whitelist is what makes
> the bridge safe: don't add commands to it casually, and don't publish its port.

## Setup

The home-server guide has it step by step:
[HOME-SETUP.md → 12. Minecraft server for the kids, and the builder](../HOME-SETUP.md#12-minecraft-server-for-the-kids-and-the-builder).

In short:
1. Run `mc-bridge` next to the Minecraft container on the `shinobi-server_default` network, with `BRIDGE_TOKEN`.
2. Add these to `shinobi.env`:
   ```
   SHINOBI_MC_BRIDGE_URL=http://mc-bridge:8790
   SHINOBI_MC_BRIDGE_TOKEN=<the same token>
   ```
3. Install the plugin from **Plugins → Catalog**.

## Limits

- A build must fit within 60 blocks of the player in each direction (one
  ticking area keeps that region loaded while it builds), from 30 blocks below to 220 above.
- At most 6000 fill commands per build. Large boxes are split into pieces of
  ≤ 32768 blocks automatically.
- Coordinates: x = east, y = up (0 = the player's feet), z = south.
- The anchor is an armor stand named `Majstor_<id>`, left where the player
  stood, so later builds can extend the same spot. If someone knocks it
  over, `extend_build` for that build stops working. Start a new build instead.
- Builds run one at a time. A Shinobi restart drops the queue: those builds
  show as failed, so ask again.

## Test

```bash
npm test
```
