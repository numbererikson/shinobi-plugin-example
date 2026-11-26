// Majstor behavior pack: lets a player ask for a build from inside the game.
//
//   /gradi dvorac        (or /majstor:gradi dvorac)
//   !gradi dvorac        in chat, where the server exposes chat events
//
// The script only prints the wish to the server console as one line
// `MAJSTOR_WISH {"id","player","text"}`; the Shinobi Minecraft plugin reads the
// console through mc-bridge, picks the design and builds it.
import { system, world, CommandPermissionLevel, CustomCommandParamType, CustomCommandStatus } from '@minecraft/server';

let counter = 0;
function wish(player, text) {
  const clean = String(text ?? '').replace(/[\r\n]+/g, ' ').trim().slice(0, 60);
  if (!clean) return false;
  counter += 1;
  console.warn(`MAJSTOR_WISH ${JSON.stringify({ id: `${system.currentTick}-${counter}`, player, text: clean })}`);
  return true;
}

system.beforeEvents.startup.subscribe((event) => {
  event.customCommandRegistry.registerCommand(
    {
      name: 'majstor:gradi',
      description: 'Majstor ti sagradi što želiš (npr. /gradi dvorac, /gradi popis)',
      permissionLevel: CommandPermissionLevel.Any,
      mandatoryParameters: [{ type: CustomCommandParamType.String, name: 'sto' }],
    },
    (origin, sto) => {
      const player = origin.sourceEntity;
      if (!player || player.typeId !== 'minecraft:player') return { status: CustomCommandStatus.Failure, message: 'Samo igrač može tražiti gradnju.' };
      wish(player.name, sto);
      return { status: CustomCommandStatus.Success, message: `Majstor je čuo: ${sto}` };
    },
  );
});

// Chat fallback ("!gradi dvorac"): only where the chat event exists.
try {
  world.afterEvents.chatSend?.subscribe((e) => {
    const m = /^!\s*(?:gradi|sagradi|majstor)\s+(.+)$/i.exec(e.message);
    if (m) wish(e.sender.name, m[1]);
  });
} catch {
  /* chat events not available on this server */
}
