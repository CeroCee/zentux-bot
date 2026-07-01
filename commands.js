const { ChannelType, PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');

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
    .setDescription('Consulta tu licencia o la informacion de un comprador')
    .addUserOption((option) =>
      option
        .setName('usuario')
        .setDescription('Comprador que deseas consultar o autorizar')
        .setRequired(false)
    )
    .addBooleanOption((option) =>
      option
        .setName('admin')
        .setDescription('Solo administradores: true concede acceso, false lo retira')
        .setRequired(false)
    ),
  new SlashCommandBuilder()
    .setName('download')
    .setDescription('Descarga las aplicaciones oficiales de Zentux'),
  new SlashCommandBuilder()
    .setName('compra')
    .setDescription('Compra una licencia de Zentux con Stripe o Robux'),
  new SlashCommandBuilder()
    .setName('logs')
    .setDescription('Configura los canales privados de actividad de Zentux')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false)
    .addSubcommand((subcommand) =>
      subcommand
        .setName('compras')
        .setDescription('Canal para informacion comercial de licencias')
        .addChannelOption((option) =>
          option
            .setName('canal')
            .setDescription('Canal donde se enviaran los logs de compras')
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('canjes')
        .setDescription('Canal para informacion de licencias canjeadas')
        .addChannelOption((option) =>
          option
            .setName('canal')
            .setDescription('Canal donde se enviaran los logs de canjes')
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true)
        )
    )
];

module.exports = { commands };
