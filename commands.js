const { ChannelType, PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');

const economyCommandModules = [
  require('./commands/admin-signed-player')
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
    .setName('signed-player')
    .setDescription('Reclama el beneficio exclusivo de Zentux Signed Players')
    .setDMPermission(false)
    .addSubcommand((subcommand) =>
      subcommand
        .setName('key')
        .setDescription('Reclama tu key exclusiva de Zentux Signed Player')
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
  new SlashCommandBuilder()
    .setName('giveaway')
    .setDescription('Crea y administra giveaways con boton de participacion')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false)
    .addSubcommand((subcommand) =>
      subcommand
        .setName('start')
        .setDescription('Crea un giveaway con boton para participar')
        .addStringOption((option) =>
          option
            .setName('premio')
            .setDescription('Premio del giveaway, ejemplo: 500 Robux o 1 key de 7 dias')
            .setRequired(true)
            .setMinLength(1)
            .setMaxLength(200)
        )
        .addStringOption((option) =>
          option
            .setName('duracion')
            .setDescription('Duracion: 10m, 2h, 1d, 1w')
            .setRequired(true)
            .setMinLength(2)
            .setMaxLength(20)
        )
        .addIntegerOption((option) =>
          option
            .setName('ganadores')
            .setDescription('Cantidad de ganadores')
            .setRequired(true)
            .setMinValue(1)
            .setMaxValue(25)
        )
        .addChannelOption((option) =>
          option
            .setName('canal')
            .setDescription('Canal donde se publicara el giveaway')
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(false)
        )
        .addStringOption((option) =>
          option
            .setName('descripcion')
            .setDescription('Texto opcional que aparecera debajo del premio')
            .setRequired(false)
            .setMaxLength(500)
        )
        .addStringOption((option) =>
          option
            .setName('ganador_id')
            .setDescription('Opcional: ID o mencion del ganador fijo')
            .setRequired(false)
            .setMinLength(17)
            .setMaxLength(200)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('end')
        .setDescription('Finaliza un giveaway inmediatamente')
        .addStringOption((option) =>
          option
            .setName('mensaje')
            .setDescription('ID del mensaje del giveaway')
            .setRequired(true)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('reroll')
        .setDescription('Elige nuevos ganadores de un giveaway terminado')
        .addStringOption((option) =>
          option
            .setName('mensaje')
            .setDescription('ID del mensaje del giveaway')
            .setRequired(true)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('cancel')
        .setDescription('Cancela un giveaway activo sin elegir ganadores')
        .addStringOption((option) =>
          option
            .setName('mensaje')
            .setDescription('ID del mensaje del giveaway')
            .setRequired(true)
        )
    ),
  ...economyCommandModules.map((command) => command.data)
];

module.exports = { commands, economyCommandModules };
