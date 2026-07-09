const {
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder
} = require('discord.js');

const MIN_BET = 50;
const MAX_BET = 10000;

const data = new SlashCommandBuilder()
  .setName('bet')
  .setDescription('Apuesta Z-Coins contra otro usuario')
  .setDMPermission(false)
  .addSubcommand((subcommand) =>
    subcommand
      .setName('challenge')
      .setDescription('Reta a otro usuario a una apuesta de dados')
      .addUserOption((option) =>
        option
          .setName('usuario')
          .setDescription('Usuario al que quieres retar')
          .setRequired(true)
      )
      .addIntegerOption((option) =>
        option
          .setName('cantidad')
          .setDescription('Cantidad de Z-Coins a apostar desde tu bolsillo')
          .setMinValue(MIN_BET)
          .setMaxValue(MAX_BET)
          .setRequired(true)
      )
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('accept')
      .setDescription('Acepta una apuesta pendiente')
      .addStringOption((option) =>
        option
          .setName('id')
          .setDescription('ID de la apuesta, ejemplo: BET-A1B2C3')
          .setRequired(true)
      )
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('decline')
      .setDescription('Rechaza una apuesta pendiente que te enviaron')
      .addStringOption((option) =>
        option
          .setName('id')
          .setDescription('ID de la apuesta, ejemplo: BET-A1B2C3')
          .setRequired(true)
      )
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('cancel')
      .setDescription('Cancela una apuesta pendiente que creaste')
      .addStringOption((option) =>
        option
          .setName('id')
          .setDescription('ID de la apuesta, ejemplo: BET-A1B2C3')
          .setRequired(true)
      )
  );

function formatCoins(value) {
  return Number(value || 0).toLocaleString('es-ES', {
    minimumFractionDigits: Number(value) % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2
  });
}

function normalizeBetId(value) {
  return String(value || '').trim().toUpperCase();
}

function betTimestamp(dateValue) {
  const timestamp = Math.floor(new Date(dateValue).getTime() / 1000);
  return Number.isFinite(timestamp) ? `<t:${timestamp}:R>` : 'muy pronto';
}

async function replyKnownError(interaction, error) {
  const messages = {
    invalid_user: 'No pude validar ese usuario de Discord.',
    invalid_amount: 'La cantidad de la apuesta no es valida.',
    same_user: 'No puedes apostar contra ti mismo.',
    bet_too_small: `La apuesta minima es de ${MIN_BET.toLocaleString('es-ES')} Z-Coins.`,
    bet_too_large: `La apuesta maxima es de ${MAX_BET.toLocaleString('es-ES')} Z-Coins.`,
    insufficient_funds: 'No hay suficientes Z-Coins en el bolsillo para hacer eso.',
    pending_bet_exists: 'Uno de los dos usuarios ya tiene una apuesta pendiente. Aceptala, rechazala o espera a que expire.',
    bet_not_found: 'No encontre esa apuesta. Revisa el ID.',
    bet_not_pending: 'Esa apuesta ya no esta pendiente.',
    not_your_bet: 'Esa apuesta no te corresponde.',
    bet_expired: 'Esa apuesta ya expiro y fue reembolsada.'
  };

  const message = messages[error.code];
  if (!message) throw error;

  await interaction.reply({
    content: message,
    flags: MessageFlags.Ephemeral
  });
}

async function handleChallenge(interaction, licenseApi) {
  const target = interaction.options.getUser('usuario', true);
  const amount = interaction.options.getInteger('cantidad', true);

  if (target.bot) {
    await interaction.reply({
      content: 'No puedes apostar contra un bot.',
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  try {
    const result = await licenseApi.economyBetCreate({
      challengerId: interaction.user.id,
      targetId: target.id,
      amount
    });
    const bet = result.bet;
    const embed = new EmbedBuilder()
      .setColor(0xa855f7)
      .setTitle('🎲 Apuesta creada')
      .setDescription(`${interaction.user} retó a ${target} a una apuesta de dados.`)
      .addFields(
        { name: 'Apuesta', value: `🪙 **${formatCoins(bet.amount)} Z-Coins**`, inline: true },
        { name: 'ID', value: `\`${bet.betId}\``, inline: true },
        { name: 'Expira', value: betTimestamp(bet.expiresAt), inline: true },
        {
          name: 'Cómo responder',
          value: `${target}, usa \`/bet accept id:${bet.betId}\` para aceptar o \`/bet decline id:${bet.betId}\` para rechazar.`
        }
      )
      .setFooter({ text: 'El dinero del retador queda apartado hasta que se resuelva.' })
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  } catch (error) {
    await replyKnownError(interaction, error);
  }
}

async function handleAccept(interaction, licenseApi) {
  const betId = normalizeBetId(interaction.options.getString('id', true));

  try {
    const result = await licenseApi.economyBetAccept({
      betId,
      targetId: interaction.user.id
    });
    const bet = result.bet;
    const winnerMention = `<@${bet.winnerId}>`;
    const loserId = bet.winnerId === bet.challengerId ? bet.targetId : bet.challengerId;
    const embed = new EmbedBuilder()
      .setColor(0x22c55e)
      .setTitle('🎲 Apuesta resuelta')
      .setDescription(`${winnerMention} ganó el bote de 🪙 **${formatCoins(bet.amount * 2)} Z-Coins**.`)
      .addFields(
        { name: 'Retador', value: `<@${bet.challengerId}> sacó **${bet.challengerRoll}**`, inline: true },
        { name: 'Retado', value: `<@${bet.targetId}> sacó **${bet.targetRoll}**`, inline: true },
        { name: 'Perdedor', value: `<@${loserId}>`, inline: true },
        { name: 'ID', value: `\`${bet.betId}\``, inline: true }
      )
      .setFooter({ text: 'Juego: dados altos. Robos no afectan este sistema.' })
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  } catch (error) {
    await replyKnownError(interaction, error);
  }
}

async function handleDecline(interaction, licenseApi) {
  const betId = normalizeBetId(interaction.options.getString('id', true));

  try {
    const result = await licenseApi.economyBetDecline({
      betId,
      targetId: interaction.user.id
    });
    const embed = new EmbedBuilder()
      .setColor(0xf97316)
      .setTitle('Apuesta rechazada')
      .setDescription(`La apuesta \`${result.bet.betId}\` fue rechazada y el dinero fue devuelto al retador.`)
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  } catch (error) {
    await replyKnownError(interaction, error);
  }
}

async function handleCancel(interaction, licenseApi) {
  const betId = normalizeBetId(interaction.options.getString('id', true));

  try {
    const result = await licenseApi.economyBetCancel({
      betId,
      challengerId: interaction.user.id
    });
    const embed = new EmbedBuilder()
      .setColor(0x64748b)
      .setTitle('Apuesta cancelada')
      .setDescription(`Cancelaste la apuesta \`${result.bet.betId}\`. Tus Z-Coins fueron devueltas al bolsillo.`)
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  } catch (error) {
    await replyKnownError(interaction, error);
  }
}

async function execute(interaction, { licenseApi } = {}) {
  if (!licenseApi) {
    await interaction.reply({
      content: 'El sistema de apuestas no esta disponible ahora mismo.',
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const subcommand = interaction.options.getSubcommand();
  if (subcommand === 'challenge') return handleChallenge(interaction, licenseApi);
  if (subcommand === 'accept') return handleAccept(interaction, licenseApi);
  if (subcommand === 'decline') return handleDecline(interaction, licenseApi);
  if (subcommand === 'cancel') return handleCancel(interaction, licenseApi);
}

module.exports = {
  data,
  execute
};
