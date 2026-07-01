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
    .setDescription('Muestra el estado y tiempo restante de tu licencia')
];

module.exports = { commands };
