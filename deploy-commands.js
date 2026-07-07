require('dotenv').config();
const { ApplicationCommandPermissionType, REST, Routes } = require('discord.js');
const { commands } = require('./commands');

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const SIGNED_PLAYER_ROLE_ID = process.env.SIGNED_PLAYER_ROLE_ID || '1524136790594683001';

if (!TOKEN || !CLIENT_ID) {
  console.error('Faltan DISCORD_TOKEN o CLIENT_ID en .env');
  process.exit(1);
}

const rest = new REST({ version: '10' }).setToken(TOKEN);
const body = commands.map((command) => command.toJSON());

async function main() {
  if (GUILD_ID) {
    console.log('Eliminando comandos globales antiguos...');
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: [] });
    console.log(`Registrando ${body.length} comandos en el servidor ${GUILD_ID}...`);
    const registered = await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body });
    const signedCommand = registered.find((command) => command.name === 'signed-player');
    if (signedCommand) {
      try {
        await rest.put(Routes.applicationCommandPermissions(CLIENT_ID, GUILD_ID, signedCommand.id), {
          body: {
            permissions: [
              { id: GUILD_ID, type: ApplicationCommandPermissionType.Role, permission: false },
              { id: SIGNED_PLAYER_ROLE_ID, type: ApplicationCommandPermissionType.Role, permission: true }
            ]
          }
        });
        console.log('Permisos de /signed-player limitados al rol Signed Players.');
      } catch (error) {
        console.error('No se pudieron aplicar permisos visibles de /signed-player:', error.message);
      }
    }
    console.log('Comandos del servidor registrados.');
    return;
  }

  console.log(`Registrando ${body.length} comandos globales...`);
  await rest.put(Routes.applicationCommands(CLIENT_ID), { body });
  console.log('Comandos globales registrados. Pueden tardar en aparecer.');
}

main().catch((error) => {
  console.error('No se pudieron registrar los comandos:', error);
  process.exit(1);
});
