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
  PermissionFlagsBits,
  StringSelectMenuBuilder
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

const licenseApi = createLicenseApi({
  baseUrl: process.env.LICENSE_API_URL,
  secret: process.env.DISCORD_LICENSE_SECRET
});

const ROBLOX_LINKS = {
  robux_143: {
    label: 'Mensualidad 143 Robux',
    url: process.env.ROBLOX_LINK_143 || 'https://www.roblox.com/es/game-pass/1636360767/Mensualidad-143-Robux'
  },
  robux_multi: {
    label: 'MultiVersion 715 Robux',
    url: process.env.ROBLOX_LINK_MULTI || 'https://www.roblox.com/es/game-pass/1636114713/Mensualidad-MultiVersion-715-Robux'
  },
  robux_custom: {
    label: 'Custom 715 Robux',
    url: process.env.ROBLOX_LINK_CUSTOM || 'https://www.roblox.com/es/game-pass/1636070919/Mensualidad-715-Custom'
  }
};

const PAYPAL_LINKS = {
  paypal_299: {
    label: 'Mensualidad $2.99',
    url: process.env.PAYPAL_LINK_299 || 'https://www.paypal.com/webapps/billing/plans/subscribe?plan_id=P-0LB030257J995744NNFBZGLQ'
  },
  paypal_499: {
    label: 'MultiVersion $4.99',
    url: process.env.PAYPAL_LINK_499 || 'https://www.paypal.com/webapps/billing/plans/subscribe?plan_id=P-6B5181485U4307252NFBZFPA'
  }
};

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const redeemAttempts = new Map();
let roleSyncRunning = false;

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
    const embed = new EmbedBuilder()
      .setColor(0x35d07f)
      .setTitle('Licencia canjeada')
      .setDescription(`Se agrego el rol **${role.name}** a tu cuenta.`)
      .addFields(
        { name: 'Estado', value: 'Activa', inline: true },
        { name: 'Tiempo restante', value: formatRemaining(license.paidUntil), inline: true },
        { name: 'Expira', value: discordDate(license.paidUntil) }
      );
    await interaction.editReply({ embeds: [embed] });
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
    const member = await interaction.guild.members.fetch(interaction.user.id);
    if (!member.roles.cache.has(BUYER_ROLE_ID)) {
      return interaction.editReply({ content: 'Necesitas el rol **Zentux | Buyer**. Usa `/canjear codigo` primero.' });
    }

    const data = await licenseApi.info(interaction.user.id);
    const license = data.license;
    if (!license.active) {
      await member.roles.remove(BUYER_ROLE_ID, 'Licencia Zentux inactiva o vencida').catch(() => null);
    }

    const embed = new EmbedBuilder()
      .setColor(license.active ? 0x35d07f : 0xe5484d)
      .setTitle('Tu licencia Zentux')
      .addFields(
        { name: 'Codigo', value: `\`${license.licenseKey}\`` },
        { name: 'Estado', value: license.active ? 'Activa' : 'Inactiva o vencida', inline: true },
        { name: 'Tiempo restante', value: formatRemaining(license.paidUntil), inline: true },
        { name: 'Expira', value: discordDate(license.paidUntil) }
      )
      .setFooter({ text: 'Esta informacion solo es visible para ti.' });
    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error('Error en /info:', error.code || error.message);
    await interaction.editReply({ content: licenseErrorMessage(error) });
  }
}

async function handlePurchase(interaction) {
  await interaction.deferReply({ flags: EPHEMERAL });
  const embed = new EmbedBuilder()
    .setColor(0xe3262e)
    .setTitle('Zentux - Compra')
    .setDescription([
      '**Incluye:**',
      '- Optimizador',
      '- Autoclicker',
      '- Actualizaciones futuras',
      '- Multiversion',
      '',
      'Selecciona un metodo de pago.'
    ].join('\n'));
  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('compra_btn_robux').setLabel('Robux').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('compra_btn_dinero').setLabel('Dinero').setStyle(ButtonStyle.Success)
  );
  await interaction.editReply({ embeds: [embed], components: [buttons] });
}

async function handlePurchaseComponent(interaction) {
  if (interaction.isButton() && interaction.customId === 'compra_btn_robux') {
    const select = new StringSelectMenuBuilder()
      .setCustomId('compra_select_robux')
      .setPlaceholder('Elige tu plan en Robux')
      .addOptions(Object.entries(ROBLOX_LINKS).map(([value, item]) => ({ label: item.label, value })));
    return interaction.reply({
      content: 'Selecciona tu opcion de pago en Robux:',
      components: [new ActionRowBuilder().addComponents(select)],
      flags: EPHEMERAL
    });
  }

  if (interaction.isButton() && interaction.customId === 'compra_btn_dinero') {
    const select = new StringSelectMenuBuilder()
      .setCustomId('compra_select_paypal')
      .setPlaceholder('Elige tu plan en PayPal')
      .addOptions(Object.entries(PAYPAL_LINKS).map(([value, item]) => ({ label: item.label, value })));
    return interaction.reply({
      content: 'Selecciona tu opcion de pago en PayPal:',
      components: [new ActionRowBuilder().addComponents(select)],
      flags: EPHEMERAL
    });
  }

  if (interaction.isStringSelectMenu()) {
    const links = interaction.customId === 'compra_select_robux'
      ? ROBLOX_LINKS
      : interaction.customId === 'compra_select_paypal'
        ? PAYPAL_LINKS
        : null;
    if (!links) return false;
    const item = links[interaction.values[0]];
    if (!item) {
      return interaction.reply({ content: 'Opcion no reconocida.', flags: EPHEMERAL });
    }
    const button = new ButtonBuilder()
      .setLabel(interaction.customId.endsWith('robux') ? 'Abrir en Roblox' : 'Abrir en PayPal')
      .setStyle(ButtonStyle.Link)
      .setURL(item.url);
    return interaction.reply({
      content: `Plan seleccionado: **${item.label}**`,
      components: [new ActionRowBuilder().addComponents(button)],
      flags: EPHEMERAL
    });
  }
  return false;
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
  await syncBuyerRoles();
  setInterval(syncBuyerRoles, SYNC_MINUTES * 60 * 1000).unref();
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === 'canjear') return await handleRedeem(interaction);
      if (interaction.commandName === 'info') return await handleInfo(interaction);
      if (interaction.commandName === 'compra') return await handlePurchase(interaction);
    }
    await handlePurchaseComponent(interaction);
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
