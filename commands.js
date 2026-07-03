const { ChannelType, PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');

const economyCommandModules = [
  require('./commands/coins'),
  require('./commands/daily'),
  require('./commands/transfer'),
  require('./commands/bank'),
  require('./commands/rob'),
  require('./commands/leaderboard'),
  require('./commands/admin-money'),
  require('./commands/admin-cooldown'),
  require('./commands/shop'),
  require('./commands/redeem')
];

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
    .setName('liberar')
    .setDescription('Administra el dispositivo vinculado a tu licencia')
    .addSubcommand((subcommand) =>
      subcommand
        .setName('key')
        .setDescription('Libera tu licencia del dispositivo donde fue utilizada')
    ),
  new SlashCommandBuilder()
    .setName('liberar-admin')
    .setDescription('Libera la licencia vinculada a otro comprador')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false)
    .addUserOption((option) =>
      option
        .setName('usuario')
        .setDescription('Comprador cuya licencia deseas liberar')
        .setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName('liberar-access')
    .setDescription('Concede o retira permiso para liberar licencias ajenas')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false)
    .addUserOption((option) =>
      option
        .setName('usuario')
        .setDescription('Persona que recibira o perdera el permiso')
        .setRequired(true)
    )
    .addBooleanOption((option) =>
      option
        .setName('permitir')
        .setDescription('true concede acceso; false lo retira')
        .setRequired(true)
    ),
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
    .addSubcommand((subcommand) =>
      subcommand
        .setName('generacion')
        .setDescription('Canal para keys generadas, reactivadas y borradas')
        .addChannelOption((option) =>
          option
            .setName('canal')
            .setDescription('Canal donde se enviara la auditoria de keys')
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true)
        )
    ),
  new SlashCommandBuilder()
    .setName('borrar')
    .setDescription('Elimina licencias del sistema de Zentux')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false)
    .addSubcommand((subcommand) =>
      subcommand
        .setName('key')
        .setDescription('Borra una o varias keys, separadas por comas')
        .addStringOption((option) =>
          option
            .setName('keys')
            .setDescription('KEY1, KEY2, KEY3...')
            .setRequired(true)
            .setMinLength(10)
            .setMaxLength(4000)
        )
    ),
  new SlashCommandBuilder()
    .setName('generar')
    .setDescription('Reclama el beneficio exclusivo de Zentux Content Creator')
    .setDMPermission(false)
    .addSubcommand((subcommand) =>
      subcommand
        .setName('key')
        .setDescription('Reclama tu key exclusiva de Zentux Content Creator')
    ),
  new SlashCommandBuilder()
    .setName('generar-giveaway')
    .setDescription('Genera licencias temporales para giveaways')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false)
    .addStringOption((option) =>
      option
        .setName('duracion')
        .setDescription('Duracion de las licencias')
        .setRequired(true)
        .addChoices(
          { name: '1 dia', value: '1' },
          { name: '7 dias', value: '7' },
          { name: '15 dias', value: '15' },
          { name: '30 dias', value: '30' },
          { name: '2 meses', value: '60' }
        )
    )
    .addIntegerOption((option) =>
      option
        .setName('cantidad')
        .setDescription('Cantidad de keys que deseas generar')
        .setMinValue(1)
        .setMaxValue(25)
        .setRequired(true)
    ),
  ...economyCommandModules.map((command) => command.data)
];

module.exports = { commands, economyCommandModules };
