const { SlashCommandBuilder } = require('discord.js');

const commands = [
  new SlashCommandBuilder()
    .setName('canjear')
    .setDescription('Vincula una licencia de Zentux con tu cuenta de Discord')
    .addStringOption((option) =>
      option
        .setName('codigo')
        .setDescription('Tu codigo de licencia de Zentux')
        .setRequired(true)
        .setMinLength(10)
        .setMaxLength(100)
    ),
  new SlashCommandBuilder()
    .setName('info')
    .setDescription('Consulta tu codigo, estado y tiempo restante'),
  new SlashCommandBuilder()
    .setName('download')
    .setDescription('Descarga las aplicaciones oficiales de Zentux'),
  new SlashCommandBuilder()
    .setName('compra')
    .setDescription('Compra una licencia de Zentux con Stripe o Robux')
];

module.exports = { commands };
