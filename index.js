require('dotenv').config();
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {
  ActionRowBuilder,
  ApplicationCommandPermissionType,
  ButtonBuilder,
  ButtonStyle,
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  MessageFlags,
  Partials,
  PermissionFlagsBits,
  REST,
  Routes
} = require('discord.js');
const config = require('./config.json');
const database = require('./database/db');
const { commands, economyCommandModules } = require('./commands');
const { createLicenseApi, LicenseApiError } = require('./license-api');

const requiredEnvironment = [
  'GUILD_ID',
  'LICENSE_API_URL',
  'DISCORD_LICENSE_SECRET'
];
const missingEnvironment = requiredEnvironment.filter((name) => !process.env[name]);
const TOKEN = process.env.DISCORD_TOKEN || config.token;
if (!TOKEN) missingEnvironment.unshift('DISCORD_TOKEN o config.token');
const CLIENT_ID = process.env.CLIENT_ID || config.clientId;
if (!CLIENT_ID) missingEnvironment.unshift('CLIENT_ID o config.clientId');
if (missingEnvironment.length > 0) {
  console.error(`Faltan variables de entorno: ${missingEnvironment.join(', ')}`);
  process.exit(1);
}

const GUILD_ID = process.env.GUILD_ID;
const BUYER_ROLE_ID = process.env.PAID_BUYER_ROLE_ID || '1392620407483531465';
const REWARD_ACCESS_ROLE_ID = process.env.REWARD_ACCESS_ROLE_ID || '1523246114059587594';
const GIVEAWAY_ACCESS_ROLE_ID = process.env.GIVEAWAY_ACCESS_ROLE_ID || '1529323244891410432';
const CONTENT_CREATOR_ROLE_ID = process.env.CONTENT_CREATOR_ROLE_ID || '1392619993153142834';
const SIGNED_PLAYER_ROLE_ID = process.env.SIGNED_PLAYER_ROLE_ID || '1524136790594683001';
const SYNC_MINUTES = Math.max(1, Number.parseInt(process.env.LICENSE_SYNC_MINUTES || '5', 10) || 5);
const PURCHASE_SYNC_SECONDS = Math.max(15, Number.parseInt(process.env.PURCHASE_SYNC_SECONDS || '30', 10) || 30);
const EPHEMERAL = MessageFlags.Ephemeral;
const DISABLED_ZCOIN_COMMANDS = new Set([
  'coins',
  'daily',
  'transfer',
  'bank',
  'rob',
  'bet',
  'leaderboard',
  'admin-money',
  'admin-cooldown',
  'shop',
  'redeem'
]);
const BOT_DISPLAY_NAME = '𝒁𝒆𝒏𝒕𝒖𝒙';
const DOWNLOAD_URL = 'https://www.zentux.gg/';
const STRIPE_URL = 'https://buy.stripe.com/8x29ALdMMeKmcSs60q1wY01';
const ROBUX_URL = 'https://www.roblox.com/es/games/137296685067625/Zentux-Key-Center';
const COLORS = {
  primary: 0x7c3aed,
  success: 0x22c55e,
  danger: 0xef4444,
  store: 0xf5b800
};

const licenseApi = createLicenseApi({
  baseUrl: process.env.LICENSE_API_URL,
  secret: process.env.DISCORD_LICENSE_SECRET
});

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions
  ],
  partials: [
    Partials.User,
    Partials.Channel,
    Partials.Message,
    Partials.Reaction
  ]
});
client.licenseApi = licenseApi;

function loadEvents(discordClient) {
  const eventsDirectory = path.join(__dirname, 'events');
  if (!fs.existsSync(eventsDirectory)) return;

  const eventFiles = fs.readdirSync(eventsDirectory)
    .filter((fileName) => fileName.endsWith('.js'))
    .sort();

  for (const fileName of eventFiles) {
    const event = require(path.join(eventsDirectory, fileName));
    if (typeof event.register === 'function') {
      event.register(discordClient);
      console.log(`Evento cargado: ${event.name || fileName}`);
      continue;
    }

    if (!event.name || typeof event.execute !== 'function') {
      throw new TypeError(`El evento ${fileName} no exporta register() ni name/execute.`);
    }

    const listener = (...args) => event.execute(...args, discordClient);
    discordClient[event.once ? 'once' : 'on'](event.name, listener);
    console.log(`Evento cargado: ${event.name}`);
  }
}

loadEvents(client);
const economyCommands = new Map(
  economyCommandModules.map((command) => [command.data.name, command])
);
const redeemAttempts = new Map();
let roleSyncRunning = false;
let purchaseSyncRunning = false;
let contentCreatorSyncRunning = false;
let signedPlayerSyncRunning = false;
let licenseEventSyncRunning = false;
const pendingLicenseDeletes = new Map();

async function syncApplicationCommands() {
  const rest = new REST({ version: '10' }).setToken(TOKEN);
  const body = commands.map((command) => command.toJSON());
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
  console.log(`${body.length} comandos de Discord sincronizados.`);
}

function brandEmbed({ color = COLORS.primary, title, description }) {
  return new EmbedBuilder()
    .setColor(color)
    .setAuthor({
      name: 'Zentux',
      iconURL: client.user?.displayAvatarURL({ size: 128 })
    })
    .setTitle(title)
    .setDescription(description)
    .setFooter({ text: 'Zentux | Licencias seguras y soporte oficial' })
    .setTimestamp();
}

function getRedeemCooldown(userId) {
  const now = Date.now();
  const current = redeemAttempts.get(userId);
  if (!current || current.resetAt <= now) {
    const fresh = { attempts: 1, resetAt: now + 10 * 60 * 1000 };
    redeemAttempts.set(userId, fresh);
    return 0;
  }
  if (current.attempts >= 5) {
    return current.resetAt - now;
  }
  current.attempts += 1;
  return 0;
}

function formatRemaining(paidUntil) {
  if (!paidUntil) return 'Sin tiempo disponible';
  const remainingMs = new Date(paidUntil).getTime() - Date.now();
  if (remainingMs <= 0) return 'Expirada';
  const totalMinutes = Math.ceil(remainingMs / 60000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function discordDate(paidUntil) {
  if (!paidUntil) return 'No disponible';
  const timestamp = Math.floor(new Date(paidUntil).getTime() / 1000);
  return `<t:${timestamp}:F> (<t:${timestamp}:R>)`;
}

function formatDiscordDate(value) {
  if (!value) return 'No disponible';
  return `<t:${Math.floor(new Date(value).getTime() / 1000)}:F>`;
}

function paymentMethod(license) {
  return ({
    roblox: 'Robux',
    stripe: 'Stripe',
    giveaway: 'Regalo',
    shop: 'Zentux Shop',
    reward: 'Zentux Rewards',
    custom: 'Licencia personalizada',
    content_creator: 'Beneficio Content Creator',
    signed_player: 'Beneficio Signed Player',
    paid: 'Compra directa'
  })[license.source] || 'No disponible';
}

function licenseOrigin(license) {
  if (license.source === 'content_creator') return 'Content Creator';
  if (license.source === 'signed_player') return 'Signed Player';
  if (license.source === 'shop') return 'Zentux Shop';
  if (license.source === 'reward') return 'Zentux Rewards';
  if (license.source === 'giveaway') return 'Regalada';
  if (license.source === 'custom') return 'Personalizada';
  return 'Comprada';
}

function formatPayment(license) {
  if (['giveaway', 'custom', 'content_creator', 'signed_player', 'reward'].includes(license.source)) return 'Gratis';
  if (!Number.isFinite(license.paymentAmount)) return 'No disponible';
  if (license.paymentCurrency === 'robux') return `${license.paymentAmount.toLocaleString('en-US')} Robux`;
  if (license.paymentCurrency === 'zcoins') return `${license.paymentAmount.toLocaleString('es-ES')} ZCoins`;
  const currency = String(license.paymentCurrency || 'usd').toUpperCase();
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(license.paymentAmount / 100);
}

function formatPlan(license) {
  if (['content_creator', 'signed_player'].includes(license.source)) return 'Mientras conserve el rol';
  if (license.durationHours) return `${license.durationHours} hora(s)`;
  if (!license.durationDays) return 'No disponible';
  return license.durationDays === 365 ? 'Anual (365 dias)' : `${license.durationDays} dia(s)`;
}

function remainingLabel(license) {
  if (license.source === 'content_creator') return 'Mientras conserves el rol Content Creator';
  if (license.source === 'signed_player') return 'Mientras conserves el rol Signed Player';
  return formatRemaining(license.paidUntil);
}

function expiryLabel(license) {
  if (license.source === 'content_creator') return 'Se desactiva al perder el rol Content Creator';
  if (license.source === 'signed_player') return 'Se desactiva al perder el rol Signed Player';
  return discordDate(license.paidUntil);
}

function purchaseFields(license) {
  return [
    { name: 'Comprador original', value: String(license.buyer || 'No disponible'), inline: true },
    { name: 'Metodo', value: paymentMethod(license), inline: true },
    { name: 'Importe', value: formatPayment(license), inline: true },
    { name: 'Plan', value: formatPlan(license), inline: true },
    { name: 'Tipo', value: licenseOrigin(license), inline: true },
    { name: 'Canjeada', value: formatDiscordDate(license.redeemedAt), inline: true }
  ];
}

async function getGuildAndRole() {
  const guild = client.guilds.cache.get(GUILD_ID) || await client.guilds.fetch(GUILD_ID);
  const role = guild.roles.cache.get(BUYER_ROLE_ID) || await guild.roles.fetch(BUYER_ROLE_ID);
  if (!role) throw new Error('No se encontro BUYER_ROLE_ID en el servidor.');
  const botMember = guild.members.me || await guild.members.fetchMe();
  if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) {
    throw new Error('El bot no tiene el permiso Manage Roles.');
  }
  if (botMember.roles.highest.comparePositionTo(role) <= 0) {
    throw new Error('El rol del bot debe estar por encima de Zentux | Buyer.');
  }
  return { guild, role };
}

async function getRewardAccessRole(guild) {
  const role = guild.roles.cache.get(REWARD_ACCESS_ROLE_ID)
    || await guild.roles.fetch(REWARD_ACCESS_ROLE_ID);
  if (!role) throw new Error('No se encontro REWARD_ACCESS_ROLE_ID en el servidor.');
  const botMember = guild.members.me || await guild.members.fetchMe();
  if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) {
    throw new Error('El bot no tiene el permiso Manage Roles.');
  }
  if (botMember.roles.highest.comparePositionTo(role) <= 0) {
    throw new Error('El rol del bot debe estar por encima del rol de Zentux Rewards.');
  }
  return role;
}

async function getGiveawayAccessRole(guild) {
  const role = guild.roles.cache.get(GIVEAWAY_ACCESS_ROLE_ID)
    || await guild.roles.fetch(GIVEAWAY_ACCESS_ROLE_ID);
  if (!role) throw new Error('No se encontro GIVEAWAY_ACCESS_ROLE_ID en el servidor.');
  const botMember = guild.members.me || await guild.members.fetchMe();
  if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) {
    throw new Error('El bot no tiene el permiso Manage Roles.');
  }
  if (botMember.roles.highest.comparePositionTo(role) <= 0) {
    throw new Error('El rol del bot debe estar por encima del rol de Giveaway Access.');
  }
  return role;
}

async function getRoleById(guild, roleId, label) {
  const role = guild.roles.cache.get(roleId) || await guild.roles.fetch(roleId);
  if (!role) throw new Error(`No se encontro ${label} en el servidor.`);
  return role;
}

async function getContentCreatorRole(guild) {
  return getRoleById(guild, CONTENT_CREATOR_ROLE_ID, 'CONTENT_CREATOR_ROLE_ID');
}

async function getSignedPlayerRole(guild) {
  return getRoleById(guild, SIGNED_PLAYER_ROLE_ID, 'SIGNED_PLAYER_ROLE_ID');
}

async function getRoleForLicenseSource(guild, source) {
  if (source === 'reward') return getRewardAccessRole(guild);
  if (source === 'giveaway') return getGiveawayAccessRole(guild);
  if (source === 'content_creator') return getContentCreatorRole(guild);
  if (source === 'signed_player') return getSignedPlayerRole(guild);
  const { role } = await getGuildAndRole();
  return role;
}

function shouldUseBuyerRole(source) {
  return !['giveaway', 'content_creator', 'signed_player', 'reward'].includes(source);
}

function hasLicenseAccessRole(member) {
  return Boolean(
    member?.roles.cache.has(BUYER_ROLE_ID)
    || member?.roles.cache.has(REWARD_ACCESS_ROLE_ID)
    || member?.roles.cache.has(GIVEAWAY_ACCESS_ROLE_ID)
    || member?.roles.cache.has(CONTENT_CREATOR_ROLE_ID)
    || member?.roles.cache.has(SIGNED_PLAYER_ROLE_ID)
  );
}

function licenseErrorMessage(error) {
  const messages = {
    not_found: 'Ese codigo no existe.',
    inactive: 'La licencia esta inactiva o vencida.',
    already_redeemed: 'Esa licencia ya fue canjeada por otra cuenta de Discord.',
    user_has_license: 'Tu cuenta de Discord ya tiene otra licencia vinculada.',
    not_linked: 'Tu cuenta no tiene una licencia vinculada.',
    unauthorized: 'El bot no esta autorizado por el servidor de licencias.',
    unavailable: 'El servidor de licencias no esta disponible. Intenta nuevamente.',
    already_claimed: 'Ya reclamaste tu key exclusiva para este beneficio.',
    restricted_license: 'Esa key pertenece a otra cuenta de Discord.'
  };
  return messages[error.code] || 'No se pudo procesar la licencia.';
}

async function handleRedeem(interaction) {
  if (!interaction.inGuild() || interaction.guildId !== GUILD_ID) {
    return interaction.reply({ content: 'Este comando solo funciona en el servidor oficial de Zentux.', flags: EPHEMERAL });
  }

  const cooldownMs = getRedeemCooldown(interaction.user.id);
  if (cooldownMs > 0) {
    const minutes = Math.ceil(cooldownMs / 60000);
    return interaction.reply({ content: `Demasiados intentos. Espera ${minutes} minuto(s).`, flags: EPHEMERAL });
  }

  await interaction.deferReply({ flags: EPHEMERAL });
  try {
    const code = interaction.options.getString('codigo', true).trim().toUpperCase();
    const member = await interaction.guild.members.fetch(interaction.user.id);

    const data = await licenseApi.redeem({
      licenseKey: code,
      discordUserId: interaction.user.id,
      discordUsername: interaction.user.tag
    });

    const license = data.license;
    const grantedRole = await getRoleForLicenseSource(interaction.guild, license.source);
    if (!member.roles.cache.has(grantedRole.id)) {
      await member.roles.add(grantedRole, `Licencia Zentux ${licenseOrigin(license).toLowerCase()} activa`);
    }
    redeemAttempts.delete(interaction.user.id);

    const embed = brandEmbed({
      color: COLORS.success,
      title: '✅ Licencia canjeada correctamente',
      description: `Tu licencia fue verificada y recibiste el rol **${grantedRole.name}**.`
    })
      .addFields(
        { name: '🟢 Estado', value: '**Activa**', inline: true },
        { name: '⏳ Tiempo restante', value: remainingLabel(license), inline: true },
        { name: '📅 Fecha de expiracion', value: expiryLabel(license) },
        ...purchaseFields(license)
      );
    await interaction.editReply({ embeds: [embed] });
    await sendLicenseLogs(interaction, license);
  } catch (error) {
    console.error('Error en /canjear:', error.code || error.message);
    await interaction.editReply({ content: licenseErrorMessage(error) });
  }
}

async function handleInfo(interaction) {
  if (!interaction.inGuild() || interaction.guildId !== GUILD_ID) {
    return interaction.reply({ content: 'Este comando solo funciona en el servidor oficial de Zentux.', flags: EPHEMERAL });
  }

  await interaction.deferReply({ flags: EPHEMERAL });
  try {
    const callerMember = await interaction.guild.members.fetch(interaction.user.id);
    const selectedUser = interaction.options.getUser('usuario');
    const adminSetting = interaction.options.getBoolean('admin');

    if (adminSetting !== null) {
      if (!callerMember.permissions.has(PermissionFlagsBits.Administrator)) {
        return interaction.editReply({ content: 'Solo un administrador puede conceder o retirar este acceso.' });
      }
      if (!selectedUser) {
        return interaction.editReply({ content: 'Selecciona una persona en la opcion `usuario`.' });
      }

      await licenseApi.setInfoAccess({
        guildId: interaction.guildId,
        discordUserId: selectedUser.id,
        grantedBy: interaction.user.id,
        enabled: adminSetting
      });
      const embed = brandEmbed({
        color: adminSetting ? COLORS.success : COLORS.danger,
        title: adminSetting ? '✅ Acceso concedido' : '🔒 Acceso retirado',
        description: adminSetting
          ? `${selectedUser} ahora puede consultar compradores con \`/info usuario\`.`
          : `${selectedUser} ya no puede consultar la informacion de otros compradores.`
      });
      return interaction.editReply({ embeds: [embed] });
    }

    const targetUser = selectedUser || interaction.user;
    const isLookingUpAnotherUser = targetUser.id !== interaction.user.id;
    if (isLookingUpAnotherUser && !callerMember.permissions.has(PermissionFlagsBits.Administrator)) {
      const access = await licenseApi.infoAccess(interaction.guildId, interaction.user.id);
      if (!access.allowed) {
        return interaction.editReply({ content: 'No tienes permiso para consultar la informacion de otros compradores.' });
      }
    }

    const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
    const data = await licenseApi.info(targetUser.id);
    const license = data.license;
    if (license.active) {
      const expectedRole = targetMember
        ? await getRoleForLicenseSource(interaction.guild, license.source)
        : null;
      if (targetMember && expectedRole && !targetMember.roles.cache.has(expectedRole.id)) {
        await targetMember.roles.add(expectedRole, 'Licencia Zentux activa vinculada desde web o Discord').catch((error) => {
          console.error(`No se pudo asignar rol de licencia a ${targetUser.id}:`, error.message);
        });
      }
    } else if (targetMember) {
      const expiredRole = await getRoleForLicenseSource(interaction.guild, license.source);
      await targetMember.roles.remove(expiredRole, 'Licencia Zentux inactiva o vencida').catch(() => null);
    }

    const embed = brandEmbed({
      color: license.active ? COLORS.success : COLORS.danger,
      title: isLookingUpAnotherUser ? '🔎 Informacion del comprador' : '🔐 Informacion de tu licencia',
      description: isLookingUpAnotherUser
        ? `Consulta privada de la licencia vinculada a ${targetUser}.`
        : 'Estos datos son privados y solamente puedes verlos tu.'
    })
      .addFields(
        { name: 'Usuario de Discord', value: `${targetUser.tag}\n\`${targetUser.id}\`` },
        { name: '🎟️ Codigo', value: `\`${license.licenseKey}\`` },
        { name: '📊 Estado', value: license.active ? '🟢 Activa' : '🔴 Inactiva o vencida', inline: true },
        { name: '⏳ Tiempo restante', value: remainingLabel(license), inline: true },
        { name: '📅 Expira', value: expiryLabel(license) },
        ...purchaseFields(license)
      );
    embed.setThumbnail(targetUser.displayAvatarURL({ size: 128 }));
    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error('Error en /info:', error.code || error.message);
    await interaction.editReply({ content: licenseErrorMessage(error) });
  }
}

async function handlePurchase(interaction) {
  const embed = brandEmbed({
    color: COLORS.store,
    title: '🛒 Compra tu licencia Zentux',
    description: [
      'Elige el metodo de pago que prefieras:',
      '',
      '💳 **Stripe** - Pago seguro con tarjeta.',
      '🎮 **Robux** - Compra desde Zentux Key Center en Roblox.',
      '',
      'Todas las licencias dan acceso al ecosistema de aplicaciones Zentux.'
    ].join('\n')
  });
  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setLabel('Comprar con Stripe')
      .setEmoji('💳')
      .setStyle(ButtonStyle.Link)
      .setURL(STRIPE_URL),
    new ButtonBuilder()
      .setLabel('Comprar con Robux')
      .setEmoji('🎮')
      .setStyle(ButtonStyle.Link)
      .setURL(ROBUX_URL)
  );
  await interaction.reply({ embeds: [embed], components: [buttons], flags: EPHEMERAL });
}

async function handleDownload(interaction) {
  const embed = brandEmbed({
    title: '🚀 Descarga Zentux',
    description: [
      'Descarga las aplicaciones oficiales y sus versiones mas recientes desde nuestro sitio web.',
      '',
      '✅ Descargas verificadas',
      '🛡️ Acceso seguro',
      '🔄 Actualizaciones oficiales'
    ].join('\n')
  });
  const button = new ButtonBuilder()
    .setLabel('Abrir zentux.gg')
    .setEmoji('📥')
    .setStyle(ButtonStyle.Link)
    .setURL(DOWNLOAD_URL);
  await interaction.reply({
    embeds: [embed],
    components: [new ActionRowBuilder().addComponents(button)],
    flags: EPHEMERAL
  });
}

async function handleReleaseCommand(interaction) {
  if (!interaction.inGuild() || interaction.guildId !== GUILD_ID) {
    return interaction.reply({ content: 'Este comando solo funciona en el servidor oficial de Zentux.', flags: EPHEMERAL });
  }

  await interaction.deferReply({ flags: EPHEMERAL });
  const subcommand = interaction.commandName === 'liberar'
    ? 'key'
    : interaction.commandName === 'liberar-admin'
      ? 'admin'
      : 'access';
  const callerMember = await interaction.guild.members.fetch(interaction.user.id);

  if (subcommand === 'access') {
    if (!callerMember.permissions.has(PermissionFlagsBits.Administrator)) {
      return interaction.editReply({ content: 'Solo un administrador puede conceder o retirar este permiso.' });
    }
    const targetUser = interaction.options.getUser('usuario', true);
    const enabled = interaction.options.getBoolean('permitir', true);
    await licenseApi.setReleaseAccess({
      guildId: interaction.guildId,
      discordUserId: targetUser.id,
      grantedBy: interaction.user.id,
      enabled
    });
    const embed = brandEmbed({
      color: enabled ? COLORS.success : COLORS.danger,
      title: enabled ? '✅ Permiso concedido' : '🔒 Permiso retirado',
      description: enabled
        ? `${targetUser} ahora puede usar \`/liberar admin\` con compradores.`
        : `${targetUser} ya no puede liberar licencias de otros compradores.`
    });
    return interaction.editReply({ embeds: [embed] });
  }

  let targetUser = interaction.user;
  if (subcommand === 'admin') {
    const allowed = await canReleaseOtherLicenses(interaction.guild, interaction.user.id);
    if (!allowed) {
      return interaction.editReply({ content: 'No tienes permiso para liberar licencias de otros compradores.' });
    }
    targetUser = interaction.options.getUser('usuario', true);
  } else if (!hasLicenseAccessRole(callerMember)) {
    return interaction.editReply({ content: 'Necesitas una licencia activa de Zentux.' });
  }

  const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
  if (!hasLicenseAccessRole(targetMember)) {
    return interaction.editReply({ content: 'Esa persona no tiene un rol de licencia activa.' });
  }

  const data = await licenseApi.info(targetUser.id);
  if (!data.license?.active) {
    return interaction.editReply({ content: 'La licencia vinculada no esta activa y no puede liberarse.' });
  }

  const embed = brandEmbed({
    color: COLORS.store,
    title: '🔓 Liberar licencia del dispositivo',
    description: [
      `Propietario: ${targetUser}`,
      `Licencia vinculada: \`${data.license.licenseKey}\``,
      '',
      'Esta accion quitara el dispositivo guardado y permitira activar la misma key en otro PC.',
      subcommand === 'key'
        ? '**Esta es la licencia vinculada a tu cuenta de Discord.**'
        : `**Liberacion administrativa solicitada por ${interaction.user}.**`
    ].join('\n')
  });
  const button = new ButtonBuilder()
    .setCustomId(`release_device:${interaction.user.id}:${targetUser.id}`)
    .setLabel('Liberar dispositivo')
    .setEmoji('🔓')
    .setStyle(ButtonStyle.Danger);
  await interaction.editReply({
    embeds: [embed],
    components: [new ActionRowBuilder().addComponents(button)]
  });
}

async function canReleaseOtherLicenses(guild, userId) {
  const member = await guild.members.fetch(userId).catch(() => null);
  if (member?.permissions.has(PermissionFlagsBits.Administrator)) return true;
  const access = await licenseApi.releaseAccess(guild.id, userId);
  return Boolean(access.allowed);
}

async function handleReleaseButton(interaction) {
  const [action, ownerId, targetId] = interaction.customId.split(':');
  if (interaction.user.id !== ownerId) {
    return interaction.reply({ content: 'Este boton pertenece a otra persona.', flags: EPHEMERAL });
  }

  if (action === 'release_device') {
    const embed = brandEmbed({
      color: COLORS.danger,
      title: '⚠️ Confirmar liberacion',
      description: ownerId === targetId
        ? '¿Estas seguro de que quieres quitar el dispositivo vinculado a tu licencia?'
        : `¿Estas seguro de que quieres liberar la licencia de <@${targetId}>?`
    });
    const buttons = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`release_confirm:${ownerId}:${targetId}`)
        .setLabel('Si, liberar')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(`release_cancel:${ownerId}:${targetId}`)
        .setLabel('Cancelar')
        .setStyle(ButtonStyle.Secondary)
    );
    return interaction.update({ embeds: [embed], components: [buttons] });
  }

  if (action === 'release_cancel') {
    const embed = brandEmbed({
      title: 'Liberacion cancelada',
      description: 'No se hizo ningun cambio en tu licencia.'
    });
    return interaction.update({ embeds: [embed], components: [] });
  }

  if (action === 'release_confirm') {
    if (ownerId !== targetId) {
      const allowed = await canReleaseOtherLicenses(interaction.guild, ownerId);
      if (!allowed) {
        return interaction.update({
          content: 'Tu permiso para liberar licencias ajenas fue retirado.',
          embeds: [],
          components: []
        });
      }
    }
    await interaction.deferUpdate();
    const data = await licenseApi.releaseDevice(targetId);
    const embed = brandEmbed({
      color: data.released ? COLORS.success : COLORS.primary,
      title: data.released ? '✅ Dispositivo liberado' : 'ℹ️ La licencia ya estaba libre',
      description: data.released
        ? `La key \`${data.license.licenseKey}\` de <@${targetId}> ya puede activarse en otro dispositivo.`
        : 'Tu licencia no tenia ningun dispositivo vinculado.'
    });
    return interaction.editReply({ embeds: [embed], components: [] });
  }
}

function parseLicenseKeys(value) {
  return [...new Set(
    String(value || '')
      .split(/[,;\r\n]+/)
      .map((key) => key.trim().replace(/^['"]|['"]$/g, '').toUpperCase())
      .filter(Boolean)
  )];
}

async function handleDeleteCommand(interaction) {
  if (!interaction.inGuild() || interaction.guildId !== GUILD_ID) {
    return interaction.reply({ content: 'Este comando solo funciona en el servidor oficial de Zentux.', flags: EPHEMERAL });
  }
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({ content: 'Solo los administradores pueden borrar licencias.', flags: EPHEMERAL });
  }

  const keys = parseLicenseKeys(interaction.options.getString('keys', true));
  if (keys.length === 0 || keys.length > 100) {
    return interaction.reply({ content: 'Escribe entre 1 y 100 keys validas, separadas por comas.', flags: EPHEMERAL });
  }

  const token = crypto.randomBytes(12).toString('hex');
  pendingLicenseDeletes.set(token, {
    ownerId: interaction.user.id,
    keys,
    expiresAt: Date.now() + 5 * 60 * 1000
  });
  const preview = keys.slice(0, 10).map((key) => `\`${key}\``).join('\n');
  const extra = keys.length > 10 ? `\n...y ${keys.length - 10} mas.` : '';
  const embed = brandEmbed({
    color: COLORS.danger,
    title: 'Confirmar borrado de licencias',
    description: `Vas a borrar **${keys.length}** licencia(s) permanentemente:\n\n${preview}${extra}\n\nEsta accion desactivara las keys inmediatamente.`
  });
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`delete_confirm:${token}`)
      .setLabel(`Borrar ${keys.length} key(s)`)
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`delete_cancel:${token}`)
      .setLabel('Cancelar')
      .setStyle(ButtonStyle.Secondary)
  );
  return interaction.reply({ embeds: [embed], components: [row], flags: EPHEMERAL });
}

async function handleDeleteButton(interaction) {
  const [action, token] = interaction.customId.split(':');
  const pending = pendingLicenseDeletes.get(token);
  if (!pending || pending.expiresAt < Date.now()) {
    pendingLicenseDeletes.delete(token);
    return interaction.reply({ content: 'Esta confirmacion ya vencio. Usa `/borrar key` nuevamente.', flags: EPHEMERAL });
  }
  if (pending.ownerId !== interaction.user.id || !interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({ content: 'No puedes confirmar esta operacion.', flags: EPHEMERAL });
  }
  if (action === 'delete_cancel') {
    pendingLicenseDeletes.delete(token);
    return interaction.update({ content: 'Borrado cancelado.', embeds: [], components: [] });
  }

  await interaction.deferUpdate();
  pendingLicenseDeletes.delete(token);
  const data = await licenseApi.deleteLicenses({
    licenseKeys: pending.keys,
    deletedBy: `Discord: ${interaction.user.tag} (${interaction.user.id})`
  });
  const missing = data.requested - data.deleted;
  const embed = brandEmbed({
    color: data.deleted > 0 ? COLORS.success : COLORS.danger,
    title: data.deleted > 0 ? 'Licencias borradas' : 'No se encontraron licencias',
    description: [
      `**Solicitadas:** ${data.requested}`,
      `**Borradas:** ${data.deleted}`,
      `**No encontradas:** ${missing}`
    ].join('\n')
  });
  await interaction.editReply({ embeds: [embed], components: [] });
  await syncLicenseEventLogs();
}

async function handleGenerate(interaction) {
  if (!interaction.inGuild() || interaction.guildId !== GUILD_ID) {
    return interaction.reply({ content: 'Este comando solo funciona en el servidor oficial de Zentux.', flags: EPHEMERAL });
  }

  await interaction.deferReply({ flags: EPHEMERAL });
  const member = await interaction.guild.members.fetch(interaction.user.id);

  if (interaction.commandName === 'generar-giveaway') {
    if (!member.permissions.has(PermissionFlagsBits.Administrator)) {
      return interaction.editReply({ content: 'Solo los administradores pueden generar keys de giveaway.' });
    }
    const days = Number.parseInt(interaction.options.getString('duracion', true), 10);
    const count = interaction.options.getInteger('cantidad', true);
    const data = await licenseApi.generateGiveaway({ days, count, createdBy: interaction.user.id });
    const keys = data.licenses.map((license) => license.licenseKey);
    const embed = brandEmbed({
      color: COLORS.store,
      title: '🎁 Keys de giveaway generadas',
      description: `Se generaron **${keys.length}** licencia(s) de **${days} dias**.\n\n\`\`\`\n${keys.join('\n')}\n\`\`\``
    });
    return interaction.editReply({ embeds: [embed] });
  }

  if (interaction.commandName === 'signed-player') {
    if (!member.roles.cache.has(SIGNED_PLAYER_ROLE_ID)) {
      return interaction.editReply({ content: 'Necesitas el rol **Zentux | Signed Players** para reclamar esta key.' });
    }

    const data = await licenseApi.createSignedPlayer({
      guildId: interaction.guildId,
      discordUserId: interaction.user.id,
      discordUsername: member.displayName || interaction.user.username
    });
    const embed = brandEmbed({
      color: COLORS.success,
      title: data.reactivated ? 'âœ… Beneficio Signed Player reactivado' : 'âœ… Key de Signed Player creada',
      description: [
        `Tu key exclusiva es:\n\`${data.license.licenseKey}\``,
        '',
        '**Vigencia:** mientras conserves el rol Zentux | Signed Players.',
        'Solo tu cuenta de Discord puede vincular esta licencia.'
      ].join('\n')
    });
    return interaction.editReply({ embeds: [embed] });
  }

  if (!member.roles.cache.has(CONTENT_CREATOR_ROLE_ID)) {
    return interaction.editReply({ content: 'Necesitas el rol **Zentux | Content Creator** para reclamar esta key.' });
  }

  const data = await licenseApi.createContentCreator({
    guildId: interaction.guildId,
    discordUserId: interaction.user.id,
    discordUsername: interaction.user.username
  });
  const embed = brandEmbed({
    color: COLORS.success,
    title: data.reactivated ? '✅ Beneficio reactivado' : '✅ Key de Content Creator creada',
    description: [
      `Tu key exclusiva es:\n\`${data.license.licenseKey}\``,
      '',
      '**Vigencia:** mientras conserves el rol Zentux | Content Creator.',
      'Solo tu cuenta de Discord puede vincular esta licencia.'
    ].join('\n')
  });
  return interaction.editReply({ embeds: [embed] });
}

async function syncContentCreatorLicenses() {
  if (contentCreatorSyncRunning) return;
  contentCreatorSyncRunning = true;
  try {
    const guild = client.guilds.cache.get(GUILD_ID) || await client.guilds.fetch(GUILD_ID);
    const data = await licenseApi.contentCreators(GUILD_ID);
    let deactivated = 0;
    let buyerRolesRemoved = 0;

    for (const creator of data.creators || []) {
      const member = await guild.members.fetch(creator.discordUserId).catch(() => null);
      if (member?.roles.cache.has(CONTENT_CREATOR_ROLE_ID)) {
        if (member.roles.cache.has(BUYER_ROLE_ID)) {
          await member.roles.remove(BUYER_ROLE_ID, 'Content Creator usa su propio rol, no Buyer').catch(() => null);
          buyerRolesRemoved += 1;
        }
        continue;
      }

      await licenseApi.deactivateContentCreator(GUILD_ID, creator.discordUserId);
      deactivated += 1;
      if (member?.roles.cache.has(BUYER_ROLE_ID)) {
        const fallback = await licenseApi.info(creator.discordUserId).catch(() => null);
        if (!fallback?.license?.active) {
          await member.roles.remove(BUYER_ROLE_ID, 'Perdio el rol Zentux Content Creator').catch(() => null);
        }
      }
    }

    if (deactivated > 0) console.log(`Licencias Content Creator desactivadas: ${deactivated}.`);
    if (buyerRolesRemoved > 0) console.log(`Roles Buyer retirados de Content Creators: ${buyerRolesRemoved}.`);
  } catch (error) {
    console.error('No se pudieron sincronizar los Content Creators:', error.code || error.message);
  } finally {
    contentCreatorSyncRunning = false;
  }
}

async function syncSignedPlayerLicenses() {
  if (signedPlayerSyncRunning) return;
  signedPlayerSyncRunning = true;
  try {
    const guild = client.guilds.cache.get(GUILD_ID) || await client.guilds.fetch(GUILD_ID);
    const data = await licenseApi.signedPlayers(GUILD_ID);
    let deactivated = 0;
    let buyerRolesRemoved = 0;

    for (const player of data.players || []) {
      const member = await guild.members.fetch(player.discordUserId).catch(() => null);
      if (member?.roles.cache.has(SIGNED_PLAYER_ROLE_ID)) {
        if (member.roles.cache.has(BUYER_ROLE_ID)) {
          await member.roles.remove(BUYER_ROLE_ID, 'Signed Player usa su propio rol, no Buyer').catch(() => null);
          buyerRolesRemoved += 1;
        }
        continue;
      }

      await licenseApi.deactivateSignedPlayer(GUILD_ID, player.discordUserId);
      deactivated += 1;
      if (member?.roles.cache.has(BUYER_ROLE_ID)) {
        const fallback = await licenseApi.info(player.discordUserId).catch(() => null);
        if (!fallback?.license?.active) {
          await member.roles.remove(BUYER_ROLE_ID, 'Perdio el rol Zentux Signed Player').catch(() => null);
        }
      }
    }

    if (deactivated > 0) console.log(`Licencias Signed Player desactivadas: ${deactivated}.`);
    if (buyerRolesRemoved > 0) console.log(`Roles Buyer retirados de Signed Players: ${buyerRolesRemoved}.`);
  } catch (error) {
    console.error('No se pudieron sincronizar los Signed Players:', error.code || error.message);
  } finally {
    signedPlayerSyncRunning = false;
  }
}

async function sendLog(channelId, embed) {
  if (!channelId) return;
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased()) return;
  await channel.send({ embeds: [embed] });
}

async function sendLicenseLogs(interaction, license) {
  try {
    const data = await licenseApi.logSettings(interaction.guildId);
    const config = data.config || {};
    const redemptionEmbed = brandEmbed({
      color: COLORS.success,
      title: '✅ Licencia canjeada',
      description: `${interaction.user} completo un canje de licencia.`
    }).addFields(
      { name: 'Canjeada por', value: `${interaction.user.tag}\n\`${interaction.user.id}\`` },
      { name: 'Codigo', value: `\`${license.licenseKey}\`` },
      { name: 'Fecha del canje', value: formatDiscordDate(license.redeemedAt), inline: true },
      { name: 'Duracion', value: formatPlan(license), inline: true },
      { name: 'Origen', value: licenseOrigin(license), inline: true },
      { name: 'Vencimiento', value: discordDate(license.paidUntil) }
    );

    await sendLog(config.redemptionLogChannelId, redemptionEmbed);
  } catch (error) {
    console.error('No se pudieron enviar los logs de licencia:', error.code || error.message);
  }
}

async function handleLogs(interaction) {
  if (!interaction.inGuild() || interaction.guildId !== GUILD_ID) {
    return interaction.reply({ content: 'Este comando solo funciona en el servidor oficial de Zentux.', flags: EPHEMERAL });
  }
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({ content: 'Necesitas el permiso Administrador para configurar los logs.', flags: EPHEMERAL });
  }

  const subcommand = interaction.options.getSubcommand(true);
  const channel = interaction.options.getChannel('canal', true);
  const type = subcommand === 'compras'
    ? 'purchases'
    : subcommand === 'generacion'
      ? 'generation'
      : 'redemptions';
  await interaction.deferReply({ flags: EPHEMERAL });
  await licenseApi.setLogChannel({ guildId: interaction.guildId, type, channelId: channel.id });

  const label = type === 'purchases' ? 'compras' : type === 'generation' ? 'generacion y borrado de keys' : 'canjes';
  const embed = brandEmbed({
    color: COLORS.success,
    title: '✅ Canal de logs configurado',
    description: `Los logs de **${label}** se enviaran a ${channel}.`
  });
  await interaction.editReply({ embeds: [embed] });
  if (type === 'purchases') await syncPurchaseLogs();
  if (type === 'generation') await syncLicenseEventLogs();
}

async function syncLicenseEventLogs() {
  if (licenseEventSyncRunning) return;
  licenseEventSyncRunning = true;
  try {
    const settings = await licenseApi.logSettings(GUILD_ID);
    const channelId = settings.config?.generationLogChannelId;
    if (!channelId) return;

    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel?.isTextBased()) return;
    const data = await licenseApi.pendingLicenseEvents(GUILD_ID);
    const deliveredIds = [];

    for (const event of data.events || []) {
      const license = event.metadata || {};
      const isDeleted = event.eventType === 'deleted';
      const isReactivated = event.eventType === 'reactivated';
      const title = isDeleted
        ? 'Licencia borrada'
        : isReactivated
          ? 'Licencia reactivada'
          : 'Licencia generada';
      const embed = brandEmbed({
        color: isDeleted ? COLORS.danger : isReactivated ? COLORS.store : COLORS.success,
        title,
        description: `Evento registrado por el sistema de licencias Zentux.`
      }).addFields(
        { name: 'Key', value: `\`${event.licenseKey}\`` },
        { name: 'Origen', value: paymentMethod(license), inline: true },
        { name: 'Plan', value: formatPlan(license), inline: true },
        { name: 'Importe', value: formatPayment(license), inline: true },
        { name: 'Comprador / referencia', value: String(license.buyer || license.discordUsername || 'No disponible'), inline: true },
        { name: 'Estado anterior', value: String(license.status || 'No disponible'), inline: true },
        { name: 'Fecha del evento', value: formatDiscordDate(event.createdAt), inline: true },
        { name: 'Vencimiento', value: discordDate(license.paidUntil), inline: false }
      );
      if (isDeleted) {
        embed.addFields({ name: 'Borrada por', value: String(license.deletedBy || 'Sistema') });
      }
      try {
        await channel.send({ embeds: [embed] });
        deliveredIds.push(event.id);
      } catch (error) {
        console.error(`No se pudo enviar el evento de licencia ${event.id}:`, error.message);
        break;
      }
    }

    if (deliveredIds.length > 0) {
      await licenseApi.acknowledgeLicenseEvents(GUILD_ID, deliveredIds);
      console.log(`Logs de generacion enviados: ${deliveredIds.length}.`);
    }
  } catch (error) {
    console.error('No se pudieron sincronizar los logs de generacion:', error.code || error.message);
  } finally {
    licenseEventSyncRunning = false;
  }
}

async function syncPurchaseLogs() {
  if (purchaseSyncRunning) return;
  purchaseSyncRunning = true;
  try {
    const settings = await licenseApi.logSettings(GUILD_ID);
    const channelId = settings.config?.purchaseLogChannelId;
    if (!channelId) return;

    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel?.isTextBased()) return;
    const data = await licenseApi.pendingPurchases(GUILD_ID);
    const deliveredKeys = [];

    for (const license of data.purchases || []) {
      const embed = brandEmbed({
        color: COLORS.store,
        title: '💳 Nueva compra | Key generada',
        description: 'El servidor genero una licencia nueva y lista para entregar.'
      }).addFields(
        { name: 'Codigo generado', value: `\`${license.licenseKey}\`` },
        { name: 'Comprador', value: String(license.buyer || 'No disponible'), inline: true },
        { name: 'Metodo de pago', value: paymentMethod(license), inline: true },
        { name: 'Importe', value: formatPayment(license), inline: true },
        { name: 'Plan', value: formatPlan(license), inline: true },
        { name: 'Estado', value: license.active ? 'Activa' : 'Inactiva', inline: true },
        { name: 'Generada', value: formatDiscordDate(license.createdAt), inline: true },
        { name: 'Vencimiento', value: discordDate(license.paidUntil) }
      );
      await channel.send({ embeds: [embed] });
      deliveredKeys.push(license.licenseKey);
    }

    if (deliveredKeys.length > 0) {
      await licenseApi.acknowledgePurchases(GUILD_ID, deliveredKeys);
      console.log(`Logs de compras enviados: ${deliveredKeys.length}.`);
    }
  } catch (error) {
    console.error('No se pudieron sincronizar los logs de compras:', error.code || error.message);
  } finally {
    purchaseSyncRunning = false;
  }
}

async function syncBuyerRoles() {
  if (roleSyncRunning) return;
  roleSyncRunning = true;
  try {
    const [{ guild, role }, data] = await Promise.all([
      getGuildAndRole(),
      licenseApi.members()
    ]);
    const rewardRole = await getRewardAccessRole(guild);
    const giveawayRole = await getGiveawayAccessRole(guild);
    const contentCreatorRole = guild.roles.cache.get(CONTENT_CREATOR_ROLE_ID)
      || await guild.roles.fetch(CONTENT_CREATOR_ROLE_ID).catch(() => null);
    const signedPlayerRole = guild.roles.cache.get(SIGNED_PLAYER_ROLE_ID)
      || await guild.roles.fetch(SIGNED_PLAYER_ROLE_ID).catch(() => null);

    let added = 0;
    let removed = 0;
    for (const record of data.members || []) {
      const member = await guild.members.fetch(record.discordUserId).catch(() => null);
      if (!member) continue;

      const expectedRole = record.source === 'reward'
        ? rewardRole
        : record.source === 'giveaway'
          ? giveawayRole
          : record.source === 'content_creator'
            ? contentCreatorRole
            : record.source === 'signed_player'
              ? signedPlayerRole
              : role;
      if (!expectedRole) continue;
      const otherRoles = [role, rewardRole, giveawayRole, contentCreatorRole, signedPlayerRole]
        .filter((candidate) => candidate && candidate.id !== expectedRole.id);
      const hasExpectedRole = member.roles.cache.has(expectedRole.id);

      if (record.active && !hasExpectedRole) {
        await member.roles.add(expectedRole, 'Sincronizacion de licencia Zentux activa');
        added += 1;
      } else if (!record.active && hasExpectedRole) {
        await member.roles.remove(expectedRole, 'Licencia Zentux vencida, inactiva o eliminada');
        removed += 1;
      }

      for (const otherRole of otherRoles) {
        if (!shouldUseBuyerRole(record.source) && otherRole.id === BUYER_ROLE_ID) {
          if (member.roles.cache.has(otherRole.id)) {
            await member.roles.remove(otherRole, `${licenseOrigin(record)} usa su propio rol, no Buyer`);
            removed += 1;
          }
          continue;
        }

        if (member.roles.cache.has(otherRole.id)) {
          await member.roles.remove(otherRole, 'Ajuste del tipo de acceso de la licencia Zentux');
          removed += 1;
        }
      }
    }
    console.log(`Sincronizacion de roles: ${added} agregados, ${removed} retirados.`);
  } catch (error) {
    console.error('No se pudieron sincronizar los roles:', error.code || error.message);
  } finally {
    roleSyncRunning = false;
  }
}

async function expirePendingBets() {
  if (DISABLED_ZCOIN_COMMANDS.has('bet')) return;
  try {
    const result = await licenseApi.economyBetExpire();
    const count = result.expired?.length || 0;
    if (count > 0) console.log(`Apuestas expiradas y reembolsadas: ${count}.`);
  } catch (error) {
    console.error('No se pudieron expirar apuestas pendientes:', error.code || error.message);
  }
}

client.once(Events.ClientReady, async (readyClient) => {
  console.log('Sistema de Z-Coins retirado: se omite la migracion de economia local.');
  console.log(`Bot listo como ${readyClient.user.tag}`);
  await syncApplicationCommands();
  readyClient.user.setPresence({
    activities: [{ name: '/download | /compra' }],
    status: 'online'
  });
  const guild = readyClient.guilds.cache.get(GUILD_ID) || await readyClient.guilds.fetch(GUILD_ID);
  const me = guild.members.me || await guild.members.fetchMe();
  if (me.nickname !== BOT_DISPLAY_NAME) {
    await me.setNickname(BOT_DISPLAY_NAME, 'Identidad oficial de Zentux').catch((error) => {
      console.error('No se pudo actualizar el apodo del bot:', error.message);
    });
  }
  await syncBuyerRoles();
  await syncPurchaseLogs();
  await syncLicenseEventLogs();
  await syncContentCreatorLicenses();
  await syncSignedPlayerLicenses();
  await expirePendingBets();
  setInterval(syncBuyerRoles, SYNC_MINUTES * 60 * 1000).unref();
  setInterval(syncPurchaseLogs, PURCHASE_SYNC_SECONDS * 1000).unref();
  setInterval(syncLicenseEventLogs, PURCHASE_SYNC_SECONDS * 1000).unref();
  setInterval(syncContentCreatorLicenses, SYNC_MINUTES * 60 * 1000).unref();
  setInterval(syncSignedPlayerLicenses, SYNC_MINUTES * 60 * 1000).unref();
  setInterval(expirePendingBets, 60 * 1000).unref();
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isButton() && interaction.customId.startsWith('release_')) {
      return await handleReleaseButton(interaction);
    }
    if (interaction.isButton() && interaction.customId.startsWith('delete_')) {
      return await handleDeleteButton(interaction);
    }
    if (interaction.isButton() && interaction.customId.startsWith('bet:')) {
      return await interaction.reply({
        content: 'El sistema de Z-Coins y apuestas fue retirado de Zentux.',
        flags: EPHEMERAL
      });
    }
    if (interaction.isChatInputCommand()) {
      if (DISABLED_ZCOIN_COMMANDS.has(interaction.commandName)) {
        return await interaction.reply({
          content: 'El sistema de Z-Coins fue retirado de Zentux. Este comando ya no está disponible.',
          flags: EPHEMERAL
        });
      }
      const economyCommand = economyCommands.get(interaction.commandName);
      if (economyCommand) return await economyCommand.execute(interaction, { licenseApi });
      if (interaction.commandName === 'canjear') return await handleRedeem(interaction);
      if (interaction.commandName === 'info') return await handleInfo(interaction);
      if (interaction.commandName === 'compra') return await handlePurchase(interaction);
      if (interaction.commandName === 'download') return await handleDownload(interaction);
      if (interaction.commandName === 'liberar') return await handleReleaseCommand(interaction);
      if (interaction.commandName === 'liberar-admin') return await handleReleaseCommand(interaction);
      if (interaction.commandName === 'liberar-access') return await handleReleaseCommand(interaction);
      if (interaction.commandName === 'generar') return await handleGenerate(interaction);
      if (interaction.commandName === 'signed-player') return await handleGenerate(interaction);
      if (interaction.commandName === 'generar-giveaway') return await handleGenerate(interaction);
      if (interaction.commandName === 'logs') return await handleLogs(interaction);
      if (interaction.commandName === 'borrar') return await handleDeleteCommand(interaction);
    }
  } catch (error) {
    console.error('Error manejando interaccion:', error);
    if (!interaction.isRepliable()) return;
    const payload = {
      content: error.code ? licenseErrorMessage(error) : 'Ocurrio un error inesperado.',
      flags: EPHEMERAL
    };
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ content: payload.content, components: [], embeds: [] }).catch(() => null);
    } else {
      await interaction.reply(payload).catch(() => null);
    }
  }
});

process.on('unhandledRejection', (error) => {
  console.error('Unhandled rejection:', error);
});

function shutdown(signal) {
  console.log(`${signal} recibido. Cerrando Zentux de forma segura...`);
  database.closeDatabase();
  client.destroy();
  process.exit(0);
}

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));

client.login(TOKEN);
