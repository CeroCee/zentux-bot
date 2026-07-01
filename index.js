require('dotenv').config();
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  MessageFlags,
  PermissionFlagsBits
} = require('discord.js');
const { createLicenseApi, LicenseApiError } = require('./license-api');

const requiredEnvironment = [
  'DISCORD_TOKEN',
  'GUILD_ID',
  'BUYER_ROLE_ID',
  'LICENSE_API_URL',
  'DISCORD_LICENSE_SECRET'
];
const missingEnvironment = requiredEnvironment.filter((name) => !process.env[name]);
if (missingEnvironment.length > 0) {
  console.error(`Faltan variables de entorno: ${missingEnvironment.join(', ')}`);
  process.exit(1);
}

const TOKEN = process.env.DISCORD_TOKEN;
const GUILD_ID = process.env.GUILD_ID;
const BUYER_ROLE_ID = process.env.BUYER_ROLE_ID;
const SYNC_MINUTES = Math.max(1, Number.parseInt(process.env.LICENSE_SYNC_MINUTES || '5', 10) || 5);
const EPHEMERAL = MessageFlags.Ephemeral;
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

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const redeemAttempts = new Map();
let roleSyncRunning = false;

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
    custom: 'Licencia personalizada',
    paid: 'Compra directa'
  })[license.source] || 'No disponible';
}

function licenseOrigin(license) {
  if (license.source === 'giveaway') return 'Regalada';
  if (license.source === 'custom') return 'Personalizada';
  return 'Comprada';
}

function formatPayment(license) {
  if (license.source === 'giveaway' || license.source === 'custom') return 'Gratis';
  if (!Number.isFinite(license.paymentAmount)) return 'No disponible';
  if (license.paymentCurrency === 'robux') return `${license.paymentAmount.toLocaleString('en-US')} Robux`;
  const currency = String(license.paymentCurrency || 'usd').toUpperCase();
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(license.paymentAmount / 100);
}

function formatPlan(license) {
  if (!license.durationDays) return 'No disponible';
  return license.durationDays === 365 ? 'Anual (365 dias)' : `${license.durationDays} dia(s)`;
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

function licenseErrorMessage(error) {
  const messages = {
    not_found: 'Ese codigo no existe.',
    inactive: 'La licencia esta inactiva o vencida.',
    already_redeemed: 'Esa licencia ya fue canjeada por otra cuenta de Discord.',
    user_has_license: 'Tu cuenta de Discord ya tiene otra licencia vinculada.',
    not_linked: 'Tu cuenta no tiene una licencia vinculada.',
    unauthorized: 'El bot no esta autorizado por el servidor de licencias.',
    unavailable: 'El servidor de licencias no esta disponible. Intenta nuevamente.'
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
    const data = await licenseApi.redeem({
      licenseKey: code,
      discordUserId: interaction.user.id,
      discordUsername: interaction.user.tag
    });

    const { role } = await getGuildAndRole();
    const member = await interaction.guild.members.fetch(interaction.user.id);
    if (!member.roles.cache.has(role.id)) {
      await member.roles.add(role, 'Licencia Zentux canjeada y activa');
    }
    redeemAttempts.delete(interaction.user.id);

    const license = data.license;
    const embed = brandEmbed({
      color: COLORS.success,
      title: '✅ Licencia canjeada correctamente',
      description: `Tu licencia fue verificada y recibiste el rol **${role.name}**.`
    })
      .addFields(
        { name: '🟢 Estado', value: '**Activa**', inline: true },
        { name: '⏳ Tiempo restante', value: formatRemaining(license.paidUntil), inline: true },
        { name: '📅 Fecha de expiracion', value: discordDate(license.paidUntil) },
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
    if (!targetMember?.roles.cache.has(BUYER_ROLE_ID)) {
      return interaction.editReply({ content: 'Esa persona no es un comprador activo de Zentux.' });
    }

    const data = await licenseApi.info(targetUser.id);
    const license = data.license;
    if (!license.active) {
      await targetMember.roles.remove(BUYER_ROLE_ID, 'Licencia Zentux inactiva o vencida').catch(() => null);
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
        { name: '⏳ Tiempo restante', value: formatRemaining(license.paidUntil), inline: true },
        { name: '📅 Expira', value: discordDate(license.paidUntil) },
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
    const purchaseEmbed = brandEmbed({
      color: COLORS.store,
      title: '💳 Nueva licencia vinculada',
      description: `${interaction.user} vinculo una licencia a Discord.`
    }).addFields(
      { name: 'Usuario de Discord', value: `${interaction.user.tag}\n\`${interaction.user.id}\`` },
      { name: 'Codigo', value: `\`${license.licenseKey}\`` },
      ...purchaseFields(license),
      { name: 'Vence', value: discordDate(license.paidUntil) }
    );

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

    await Promise.all([
      sendLog(config.purchaseLogChannelId, purchaseEmbed),
      sendLog(config.redemptionLogChannelId, redemptionEmbed)
    ]);
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
  const type = subcommand === 'compras' ? 'purchases' : 'redemptions';
  await interaction.deferReply({ flags: EPHEMERAL });
  await licenseApi.setLogChannel({ guildId: interaction.guildId, type, channelId: channel.id });

  const label = type === 'purchases' ? 'compras' : 'canjes';
  const embed = brandEmbed({
    color: COLORS.success,
    title: '✅ Canal de logs configurado',
    description: `Los logs de **${label}** se enviaran a ${channel}.`
  });
  await interaction.editReply({ embeds: [embed] });
}

async function syncBuyerRoles() {
  if (roleSyncRunning) return;
  roleSyncRunning = true;
  try {
    const [{ guild, role }, data] = await Promise.all([
      getGuildAndRole(),
      licenseApi.members()
    ]);

    let added = 0;
    let removed = 0;
    for (const record of data.members || []) {
      const member = await guild.members.fetch(record.discordUserId).catch(() => null);
      if (!member) continue;
      const hasRole = member.roles.cache.has(role.id);
      if (record.active && !hasRole) {
        await member.roles.add(role, 'Sincronizacion de licencia Zentux activa');
        added += 1;
      } else if (!record.active && hasRole) {
        await member.roles.remove(role, 'Licencia Zentux vencida, inactiva o eliminada');
        removed += 1;
      }
    }
    console.log(`Sincronizacion de roles: ${added} agregados, ${removed} retirados.`);
  } catch (error) {
    console.error('No se pudieron sincronizar los roles:', error.code || error.message);
  } finally {
    roleSyncRunning = false;
  }
}

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`Bot listo como ${readyClient.user.tag}`);
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
  setInterval(syncBuyerRoles, SYNC_MINUTES * 60 * 1000).unref();
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === 'canjear') return await handleRedeem(interaction);
      if (interaction.commandName === 'info') return await handleInfo(interaction);
      if (interaction.commandName === 'compra') return await handlePurchase(interaction);
      if (interaction.commandName === 'download') return await handleDownload(interaction);
      if (interaction.commandName === 'logs') return await handleLogs(interaction);
    }
  } catch (error) {
    console.error('Error manejando interaccion:', error);
    if (!interaction.isRepliable()) return;
    const payload = { content: 'Ocurrio un error inesperado.', flags: EPHEMERAL };
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

client.login(TOKEN);
