require('dotenv').config();
const path = require('node:path');
const { Client, Events, GatewayIntentBits } = require('discord.js');

const BOT_DISPLAY_NAME = '𝒁𝒆𝒏𝒕𝒖𝒙';
const DESCRIPTION = [
  'Bot oficial de Zentux para administrar tu experiencia:',
  '/canjear vincula tu licencia y entrega el rol Buyer.',
  '/info muestra el estado y tiempo restante de tu licencia.',
  '/download abre las descargas oficiales.',
  '/compra muestra las opciones de pago con Stripe y Robux.'
].join('\n');

if (!process.env.DISCORD_TOKEN || !process.env.GUILD_ID) {
  console.error('Faltan DISCORD_TOKEN o GUILD_ID.');
  process.exit(1);
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once(Events.ClientReady, async () => {
  try {
    const avatarPath = path.join(__dirname, 'assets', 'ZENTUXLOGOBOT.png');
    await client.user.setAvatar(avatarPath);
    await client.application.fetch();
    await client.application.edit({ description: DESCRIPTION });

    const guild = await client.guilds.fetch(process.env.GUILD_ID);
    const me = await guild.members.fetchMe();
    await me.setNickname(BOT_DISPLAY_NAME, 'Identidad oficial de Zentux');
    console.log('Perfil de Zentux actualizado correctamente.');
  } catch (error) {
    console.error('No se pudo actualizar el perfil:', error.message);
    process.exitCode = 1;
  } finally {
    client.destroy();
  }
});

client.login(process.env.DISCORD_TOKEN);
