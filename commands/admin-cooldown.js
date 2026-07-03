const {
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder
} = require('discord.js');
const { db } = require('../database/db');
const {
  getCooldown,
  clearCooldown,
  getAllCooldowns
} = require('../utils/cooldownManager');

const DAY_MS = 24 * 60 * 60 * 1000;
const resetDailyAvailabilityQuery = db.prepare(`
  UPDATE users SET last_daily_claim = ? WHERE userId = ? AND last_daily_claim IS NOT NULL
`);

function commandOption(option) {
  return option
    .setName('comando')
    .setDescription('Comando sin /; déjalo vacío para usar todos')
    .setMaxLength(50)
    .setRequired(false);
}

function userOption(option) {
  return option
    .setName('usuario')
    .setDescription('Usuario cuyos cooldowns deseas administrar')
    .setRequired(true);
}

const data = new SlashCommandBuilder()
  .setName('admin-cooldown')
  .setDescription('Consulta o reinicia cooldowns persistentes')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .setDMPermission(false)
  .addSubcommand((subcommand) =>
    subcommand
      .setName('check')
      .setDescription('Consulta los cooldowns activos de un usuario')
      .addUserOption(userOption)
      .addStringOption(commandOption)
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('reset')
      .setDescription('Elimina uno o todos los cooldowns de un usuario')
      .addUserOption(userOption)
      .addStringOption(commandOption)
  );

function normalizeCommand(commandName) {
  return commandName
    ? String(commandName).trim().toLowerCase().replace(/^\/+/, '')
    : null;
}

function formatDuration(milliseconds) {
  let seconds = Math.max(0, Math.ceil(Number(milliseconds) / 1000));
  const hours = Math.floor(seconds / 3600);
  seconds %= 3600;
  const minutes = Math.floor(seconds / 60);
  seconds %= 60;
  const parts = [];
  if (hours) parts.push(`${hours}h`);
  if (minutes) parts.push(`${minutes}m`);
  parts.push(`${seconds}s`);
  return parts.join(' ');
}

function makeDailyImmediatelyAvailable(userId, nowMs = Date.now()) {
  return resetDailyAvailabilityQuery.run(
    new Date(nowMs - DAY_MS).toISOString(),
    String(userId)
  ).changes;
}

async function handleCheck(interaction, target, commandName) {
  let cooldowns;
  if (commandName) {
    const remainingMs = getCooldown(target.id, commandName);
    cooldowns = remainingMs === null
      ? []
      : [{ commandName, remainingMs, expiresAt: Date.now() + remainingMs }];
  } else {
    cooldowns = getAllCooldowns(target.id);
  }

  const description = cooldowns.length
    ? cooldowns.map((cooldown) => (
      `⏳ **/${cooldown.commandName}** — ${formatDuration(cooldown.remainingMs)} • <t:${Math.floor(cooldown.expiresAt / 1000)}:R>`
    )).join('\n')
    : '✅ Este usuario no tiene cooldowns activos para la consulta solicitada.';

  const embed = new EmbedBuilder()
    .setColor(cooldowns.length ? 0xf59e0b : 0x22c55e)
    .setTitle('Cooldowns activos')
    .setDescription(description)
    .setAuthor({ name: target.username, iconURL: target.displayAvatarURL({ size: 64 }) })
    .setTimestamp();
  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

async function handleReset(interaction, target, commandName) {
  const cleared = clearCooldown(target.id, commandName || undefined);
  if (!commandName || commandName === 'daily') {
    makeDailyImmediatelyAvailable(target.id);
  }

  const scope = commandName ? `/${commandName}` : 'todos los comandos';
  const embed = new EmbedBuilder()
    .setColor(0x22c55e)
    .setTitle('✅ Cooldown reiniciado')
    .setDescription(`Se eliminaron los cooldowns de ${target} para **${scope}**.`)
    .addFields({ name: 'Registros eliminados', value: String(cleared) })
    .setTimestamp();
  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

async function execute(interaction) {
  const subcommand = interaction.options.getSubcommand(true);
  const target = interaction.options.getUser('usuario', true);
  const commandName = normalizeCommand(interaction.options.getString('comando'));
  if (subcommand === 'check') {
    await handleCheck(interaction, target, commandName);
    return;
  }
  await handleReset(interaction, target, commandName);
}

module.exports = {
  data,
  execute,
  formatDuration,
  makeDailyImmediatelyAvailable
};
