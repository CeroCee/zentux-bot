// Zentux Bot — Slash command /compra with options
require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  Events,
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle
} = require('discord.js');

// Read secrets from environment variables
const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID; // Application ID (not the bot user ID)
// Optional: set GUILD_ID in .env to register faster during testing
const GUILD_ID = process.env.GUILD_ID;
// Links y recursos de pago
const ROBLOX_LINK_143 = process.env.ROBLOX_LINK_143 || 'https://www.roblox.com/es/game-pass/1636360767/Mensualidad-143-Robux';
const ROBLOX_LINK_MULTI = process.env.ROBLOX_LINK_MULTI || 'https://www.roblox.com/es/game-pass/1636114713/Mensualidad-MultiVersion-715-Robux';
const ROBLOX_LINK_CUSTOM = process.env.ROBLOX_LINK_CUSTOM || 'https://www.roblox.com/es/game-pass/1636070919/Mensualidad-715-Custom';
const ROBLOX_LINKS = {
  robux_143: { label: 'Mensualidad 143 Robux', url: ROBLOX_LINK_143 },
  robux_multi: { label: 'MultiVersion 715 Robux', url: ROBLOX_LINK_MULTI },
  robux_custom: { label: 'Custom 715 Robux', url: ROBLOX_LINK_CUSTOM }
};
const PAYPAL_LINK_299 = process.env.PAYPAL_LINK_299 || 'https://www.paypal.com/webapps/billing/plans/subscribe?plan_id=P-0LB030257J995744NNFBZGLQ';
const PAYPAL_LINK_499 = process.env.PAYPAL_LINK_499 || 'https://www.paypal.com/webapps/billing/plans/subscribe?plan_id=P-6B5181485U4307252NFBZFPA';
const PAYPAL_LINKS = {
  paypal_299: { label: 'Mensualidad $2.99', url: PAYPAL_LINK_299 },
  paypal_499: { label: 'MultiVersion $4.99', url: PAYPAL_LINK_499 }
};

if (!TOKEN || !CLIENT_ID) {
  console.error('Missing DISCORD_TOKEN or CLIENT_ID in environment. Create a .env file.');
  process.exit(1);
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// Define the /compra command
const compraCommand = new SlashCommandBuilder()
  .setName('compra')
  .setDescription('Información de compra de Zentux');

async function registerCommands() {
  try {
    const rest = new REST({ version: '10' }).setToken(TOKEN);
    const body = [compraCommand.toJSON()];

    if (GUILD_ID) {
      await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body });
      console.log('Slash command registrado en el servidor (guild).');
    } else {
      await rest.put(Routes.applicationCommands(CLIENT_ID), { body });
      console.log('Slash command registrado globalmente.');
    }
  } catch (err) {
    console.error('Error registrando comandos:', err);
  }
}

client.once(Events.ClientReady, async () => {
  console.log(`Bot listo como ${client.user.tag}`);
  // Registro de comandos movido a deploy-commands.js
});

client.on('interactionCreate', async (interaction) => {
  try {
    // Handle /compra
    if (interaction.isChatInputCommand() && interaction.commandName === 'compra') {
      await interaction.deferReply({ ephemeral: true });

      const embed = new EmbedBuilder()
        .setColor(0x8e44ad)
        .setTitle('🛒 Zentux — Compra')
        .setDescription(
          [
            '**Incluye:**',
            '• Optimizador',
            '• Autoclicker',
            '• Actualizaciones futuras',
            '• Multiversión',
            '',
            '**Planes y precios:**',
            'Robux: 143 / mes | Multi: 715 / mes',
            'USD: $2.99 / mes | Multi: $4.99 / mes',
            '',
            '**Custom:**',
            'Robux: 715 + 143 / mes',
            'USD: $10 + $2.99 / mes',
            '',
            '💡 Di opción y pago.'
          ].join('\n')
        );

      const buttons = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('compra_btn_robux')
          .setLabel('Robux')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId('compra_btn_dinero')
          .setLabel('Dinero')
          .setStyle(ButtonStyle.Success)
      );

      await interaction.editReply({ embeds: [embed], components: [buttons] });
      return;
    }

    // Botones: Robux / Dinero
    if (interaction.isButton()) {
      if (interaction.customId === 'compra_btn_robux') {
        const select = new StringSelectMenuBuilder()
          .setCustomId('compra_select_robux')
          .setPlaceholder('Elige tu plan en Robux')
          .addOptions(
            { label: ROBLOX_LINKS.robux_143.label, value: 'robux_143', emoji: '💠' },
            { label: ROBLOX_LINKS.robux_multi.label, value: 'robux_multi', emoji: '✨' },
            { label: ROBLOX_LINKS.robux_custom.label, value: 'robux_custom', emoji: '🛠️' }
          );

        const row = new ActionRowBuilder().addComponents(select);
        return void interaction.reply({ content: 'Selecciona tu opción de pago en Robux:', components: [row], ephemeral: true });
      }

      if (interaction.customId === 'compra_btn_dinero') {
        const select = new StringSelectMenuBuilder()
          .setCustomId('compra_select_paypal')
          .setPlaceholder('Elige tu plan en PayPal')
          .addOptions(
            { label: PAYPAL_LINKS.paypal_299.label, value: 'paypal_299', emoji: '💵' },
            { label: PAYPAL_LINKS.paypal_499.label, value: 'paypal_499', emoji: '💰' }
          );

        const row = new ActionRowBuilder().addComponents(select);
        return void interaction.reply({ content: 'Selecciona tu opción de pago en PayPal:', components: [row], ephemeral: true });
      }
    }

    if (interaction.isStringSelectMenu() && interaction.customId === 'compra_select_robux') {
      const selected = interaction.values[0];
      const linkData = ROBLOX_LINKS[selected];
      if (!linkData) {
        return void interaction.reply({ content: 'Opción no reconocida. Intenta de nuevo.', ephemeral: true });
      }

      const buttons = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setLabel('Abrir en Roblox').setStyle(ButtonStyle.Link).setURL(linkData.url)
      );

      return void interaction.reply({
        content: [
          `Plan seleccionado: ${linkData.label}`,
          'Por favor toma captura de la compra y envíala junto con la imagen del Zentux que quieres. Un moderador responderá para entregarte tu key.'
        ].join('\n'),
        components: [buttons],
        ephemeral: true
      });
    }

    if (interaction.isStringSelectMenu() && interaction.customId === 'compra_select_paypal') {
      const selected = interaction.values[0];
      const linkData = PAYPAL_LINKS[selected];
      if (!linkData) {
        return void interaction.reply({ content: 'Opción no reconocida. Intenta de nuevo.', ephemeral: true });
      }

      const buttons = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setLabel('Abrir en PayPal').setStyle(ButtonStyle.Link).setURL(linkData.url)
      );

      return void interaction.reply({
        content: [
          `Plan seleccionado: ${linkData.label}`,
          'Por favor toma captura de la compra y envíala junto con la imagen del Zentux que quieres. Un moderador responderá para entregarte tu key.'
        ].join('\n'),
        components: [buttons],
        ephemeral: true
      });
    }
  } catch (err) {
    console.error('Error manejando interacción:', err);
    try {
      if (interaction.isRepliable()) {
        const msg = 'Hubo un error procesando tu compra.';
        if (interaction.deferred) await interaction.editReply({ content: msg });
        else await interaction.reply({ content: msg, ephemeral: true });
      }
    } catch {}
  }
});

process.on('unhandledRejection', (err) => {
  console.error('Unhandled rejection:', err);
});

client.login(TOKEN);
