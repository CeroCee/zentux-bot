const crypto = require('node:crypto');
const { EmbedBuilder, MessageFlags, SlashCommandBuilder } = require('discord.js');
const { db, queries } = require('../database/db');
const { setCooldown, getCooldown } = require('../utils/cooldownManager');

const ROB_COOLDOWN_MS = 2 * 60 * 60 * 1000;
const ROB_COOLDOWN_SECONDS = ROB_COOLDOWN_MS / 1000;
const MINIMUM_POCKET = 100;
const FAILURE_FINE_BPS = 1_500;

const data = new SlashCommandBuilder()
  .setName('rob')
  .setDescription('Intenta robar ZCoins del bolsillo de otro usuario')
  .setDMPermission(false)
  .addUserOption((option) =>
    option
      .setName('usuario')
      .setDescription('Usuario al que intentarás robar')
      .setRequired(true)
  );

function robError(code, message, extra = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, extra);
  return error;
}

const robTransaction = db.transaction((robberId, victimId, nowIso, successRoll, stealBps) => {
  if (robberId === victimId) throw robError('SELF_ROB', 'No puedes robarte a ti mismo.');
  queries.createUser.run(robberId);
  queries.createUser.run(victimId);

  const nowMs = new Date(nowIso).getTime();
  const remainingMs = getCooldown(robberId, 'rob', nowMs);
  if (remainingMs !== null) {
    throw robError('COOLDOWN', 'Todavía estás en cooldown.', {
      retryAt: new Date(nowMs + remainingMs).toISOString()
    });
  }

  const robber = queries.getUser.get(robberId);
  const victim = queries.getUser.get(victimId);
  if (robber.zcoins < MINIMUM_POCKET) {
    throw robError('ROBBER_TOO_POOR', 'Necesitas al menos 100 ZCoins en el bolsillo.');
  }
  if (victim.zcoins < MINIMUM_POCKET) {
    throw robError('VICTIM_TOO_POOR', 'La víctima necesita al menos 100 ZCoins en el bolsillo.');
  }

  setCooldown(robberId, 'rob', ROB_COOLDOWN_SECONDS, nowMs);
  const success = successRoll < 4_000;
  if (success) {
    const amount = Math.max(1, Math.floor((victim.zcoins * stealBps) / 10_000));
    queries.addCoins.run(-amount, victimId);
    queries.addCoins.run(amount, robberId);
    queries.registerCoinLog.run(robberId, amount, `Robo exitoso a ${victimId}`);
    queries.registerCoinLog.run(victimId, -amount, `Víctima de robo por ${robberId}`);
    return {
      success: true,
      amount,
      percentage: stealBps / 100,
      robber: queries.getUser.get(robberId),
      victim: queries.getUser.get(victimId),
      nextAttemptAt: new Date(nowMs + ROB_COOLDOWN_MS).toISOString()
    };
  }

  const fine = Math.max(1, Math.floor((robber.zcoins * FAILURE_FINE_BPS) / 10_000));
  queries.addCoins.run(-fine, robberId);
  queries.addCoins.run(fine, victimId);
  queries.registerCoinLog.run(robberId, -fine, `Multa por robo fallido contra ${victimId}`);
  queries.registerCoinLog.run(victimId, fine, `Compensación por intento de robo de ${robberId}`);
  return {
    success: false,
    amount: fine,
    percentage: FAILURE_FINE_BPS / 100,
    robber: queries.getUser.get(robberId),
    victim: queries.getUser.get(victimId),
    nextAttemptAt: new Date(nowMs + ROB_COOLDOWN_MS).toISOString()
  };
});

function attemptRob(robberId, victimId, options = {}) {
  const now = options.now ? new Date(options.now) : new Date();
  if (!Number.isFinite(now.getTime())) throw new TypeError('Fecha inválida.');
  const successRoll = options.successRoll ?? crypto.randomInt(10_000);
  const stealBps = options.stealBps ?? crypto.randomInt(2_000, 5_001);
  if (!Number.isInteger(successRoll) || successRoll < 0 || successRoll >= 10_000) {
    throw new RangeError('successRoll debe estar entre 0 y 9999.');
  }
  if (!Number.isInteger(stealBps) || stealBps < 2_000 || stealBps > 5_000) {
    throw new RangeError('stealBps debe estar entre 2000 y 5000.');
  }
  return robTransaction(
    String(robberId),
    String(victimId),
    now.toISOString(),
    successRoll,
    stealBps
  );
}

async function execute(interaction, { licenseApi } = {}) {
  const victim = interaction.options.getUser('usuario', true);
  if (victim.bot) {
    await interaction.reply({ content: 'No puedes robarle a un bot.', flags: MessageFlags.Ephemeral });
    return;
  }

  try {
    const remainingMs = getCooldown(interaction.user.id, 'rob');
    if (remainingMs !== null) {
      const error = robError('COOLDOWN', 'Todavía estás en cooldown.', {
        retryAt: new Date(Date.now() + remainingMs).toISOString()
      });
      throw error;
    }
    const response = await licenseApi.economyRob({
      robberId: interaction.user.id,
      victimId: victim.id
    });
    const result = response.result;
    setCooldown(interaction.user.id, 'rob', ROB_COOLDOWN_SECONDS);
    result.nextAttemptAt = new Date(Date.now() + ROB_COOLDOWN_MS).toISOString();
    const nextTimestamp = Math.floor(new Date(result.nextAttemptAt).getTime() / 1000);
    const embed = new EmbedBuilder()
      .setColor(result.success ? 0x22c55e : 0xef4444)
      .setTitle(result.success ? '💰 ¡Robo exitoso!' : '🚨 ¡Te atraparon!')
      .setDescription(
        result.success
          ? `${interaction.user} robó 🪙 **${result.amount.toLocaleString('es-ES')} ZCoins** (${result.percentage}%) del bolsillo de ${victim}.`
          : `${interaction.user} pagó una multa de 🪙 **${result.amount.toLocaleString('es-ES')} ZCoins** (${result.percentage}%) directamente a ${victim}.`
      )
      .addFields(
        { name: 'Bolsillo del ladrón', value: `🪙 ${result.robber.zcoins.toLocaleString('es-ES')}`, inline: true },
        { name: 'Próximo intento', value: `<t:${nextTimestamp}:R>`, inline: true }
      )
      .setTimestamp();
    await interaction.reply({ embeds: [embed] });
  } catch (error) {
    const messages = {
      SELF_ROB: 'No puedes robarte a ti mismo.',
      same_user: 'No puedes robarte a ti mismo.',
      ROBBER_TOO_POOR: 'Necesitas al menos 100 ZCoins en el bolsillo para arriesgarte.',
      robber_too_poor: 'Necesitas al menos 100 ZCoins en el bolsillo para arriesgarte.',
      VICTIM_TOO_POOR: 'Ese usuario necesita al menos 100 ZCoins en el bolsillo para poder ser robado.',
      victim_too_poor: 'Ese usuario necesita al menos 100 ZCoins en el bolsillo para poder ser robado.'
    };
    if (error.code === 'COOLDOWN') {
      const timestamp = Math.floor(new Date(error.retryAt).getTime() / 1000);
      await interaction.reply({ content: `Podrás volver a robar <t:${timestamp}:R>.`, flags: MessageFlags.Ephemeral });
      return;
    }
    if (!messages[error.code]) throw error;
    await interaction.reply({ content: messages[error.code], flags: MessageFlags.Ephemeral });
  }
}

module.exports = { data, execute, attemptRob, ROB_COOLDOWN_MS, MINIMUM_POCKET };
