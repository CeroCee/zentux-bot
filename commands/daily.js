const {
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder
} = require('discord.js');
const { db, queries } = require('../database/db');

const DAY_MS = 24 * 60 * 60 * 1000;
const STREAK_BREAK_MS = 48 * 60 * 60 * 1000;
const DAILY_REWARDS = Object.freeze([25, 35, 45, 55, 65, 80, 100]);

const data = new SlashCommandBuilder()
  .setName('daily')
  .setDescription('Reclama tu recompensa diaria de ZCoins');

const updateDailyQuery = db.prepare(`
  UPDATE users
  SET
    zcoins = zcoins + ?,
    streak_days = ?,
    last_daily_claim = ?,
    streak_protector = ?
  WHERE userId = ?
`);

const claimDailyTransaction = db.transaction((userId, nowIso) => {
  queries.createUser.run(userId);
  const user = queries.getUser.get(userId);
  const nowMs = new Date(nowIso).getTime();
  const lastClaimMs = user.last_daily_claim
    ? new Date(user.last_daily_claim).getTime()
    : null;
  const elapsedMs = Number.isFinite(lastClaimMs) ? nowMs - lastClaimMs : null;

  if (elapsedMs !== null && elapsedMs < DAY_MS) {
    return {
      claimed: false,
      nextClaimAt: new Date(lastClaimMs + DAY_MS).toISOString(),
      user
    };
  }

  let streak = Math.max(0, user.streak_days);
  let protector = Math.max(0, user.streak_protector);
  let protectorUsed = false;

  if (elapsedMs === null) {
    streak = 1;
  } else if (elapsedMs > STREAK_BREAK_MS) {
    if (protector > 0) {
      protector -= 1;
      protectorUsed = true;
      streak += 1;
    } else {
      streak = 1;
    }
  } else {
    streak += 1;
  }

  if (streak < 1) streak = 1;

  const rewardDay = Math.min(streak, DAILY_REWARDS.length);
  const reward = DAILY_REWARDS[rewardDay - 1];
  updateDailyQuery.run(reward, streak, nowIso, protector, userId);
  queries.registerCoinLog.run(
    userId,
    reward,
    `Recompensa diaria: dia ${rewardDay}`
  );

  return {
    claimed: true,
    reward,
    rewardDay,
    protectorUsed,
    nextClaimAt: new Date(nowMs + DAY_MS).toISOString(),
    user: queries.getUser.get(userId)
  };
});

function claimDaily(userId, now = new Date()) {
  const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();
  if (!Number.isFinite(nowMs)) throw new TypeError('Fecha de daily no valida.');
  return claimDailyTransaction(String(userId), new Date(nowMs).toISOString());
}

async function execute(interaction) {
  const result = claimDaily(interaction.user.id);

  if (!result.claimed) {
    const timestamp = Math.floor(new Date(result.nextClaimAt).getTime() / 1000);
    await interaction.reply({
      content: `Ya reclamaste tu recompensa. Vuelve <t:${timestamp}:R>.`,
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const nextTimestamp = Math.floor(new Date(result.nextClaimAt).getTime() / 1000);
  const protectionText = result.protectorUsed
    ? '\n🛡️ Se consumio un protector para conservar tu racha.'
    : '';

  const embed = new EmbedBuilder()
    .setColor(0x22c55e)
    .setTitle('Recompensa diaria reclamada')
    .setDescription(
      `Recibiste 🪙 **${result.reward} ZCoins**.${protectionText}`
    )
    .addFields(
      {
        name: 'Racha actual',
        value: `🔥 ${result.user.streak_days} dia(s)`,
        inline: true
      },
      {
        name: 'Balance',
        value: `🪙 ${result.user.zcoins.toLocaleString('es-ES')}`,
        inline: true
      },
      {
        name: 'Proximo daily',
        value: `<t:${nextTimestamp}:R>`,
        inline: false
      }
    )
    .setFooter({ text: `Recompensa de la escala: dia ${result.rewardDay}` })
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
}

module.exports = {
  data,
  execute,
  claimDaily,
  DAILY_REWARDS
};
