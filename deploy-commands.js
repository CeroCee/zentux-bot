// Zentux Bot — Command deploy script
require('dotenv').config();
const { REST, Routes, SlashCommandBuilder } = require('discord.js');

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID; // optional

if (!TOKEN || !CLIENT_ID) {
  console.error('Faltan DISCORD_TOKEN o CLIENT_ID en .env');
  process.exit(1);
}

const commands = [
  new SlashCommandBuilder()
    .setName('compra')
    .setDescription('Información de compra de Zentux')
    .toJSON()
];

const rest = new REST({ version: '10' }).setToken(TOKEN);

async function registerGuild() {
  if (!GUILD_ID) return false;
  console.log(`Registrando comandos en guild ${GUILD_ID}...`);
  await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
  console.log('Comandos registrados (guild).');
  return true;
}

async function registerGlobal() {
  console.log('Registrando comandos globalmente...');
  await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
  console.log('Comandos registrados (global). Puede tardar hasta 1h en aparecer.');
}

(async function main() {
  try {
    let done = false;
    if (GUILD_ID) {
      try {
        done = await registerGuild();
      } catch (err) {
        const code = err?.code ?? err?.status;
        console.error('Error guild:', err?.message ?? err);
        if (code === 50001 || code === 403) {
          console.warn('Missing Access en guild. Intentando registro global...');
        } else {
          throw err;
        }
      }
    }
    if (!done) await registerGlobal();
  } catch (err) {
    console.error('Fallo al registrar comandos:', err);
    process.exit(1);
  }
})();
