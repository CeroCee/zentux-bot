const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder
} = require('discord.js');

const MIN_BET = 50;
const MAX_BET = 10000;
const BIG_WIN_THRESHOLD = 1000;
const DICE_FACES = ['🎲', '⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
const RESULT_MESSAGES = [
  '🍀 La suerte estuvo de tu lado.',
  '💀 Los dados no perdonaron.',
  '🎲 Qué tirada tan increíble.',
  '🔥 Victoria aplastante.',
  '😈 Hoy los dados estaban de tu lado.',
  '💸 Mala suerte, será la próxima.'
];

const COLORS = {
  created: 0x8b5cf6,
  success: 0x22c55e,
  danger: 0xef4444,
  warning: 0xf97316,
  muted: 0x64748b,
  gold: 0xf5b800
};

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

function formatPrize(amount) {
  const wager = formatCoins(amount);
  const pot = formatCoins(Number(amount || 0) * 2);
  return `**${wager} + ${wager}**\n=\n🪙 **${pot} Z-Coins**`;
}

function normalizeBetId(value) {
  return String(value || '').trim().toUpperCase();
}

function betTimestamp(dateValue) {
  const timestamp = Math.floor(new Date(dateValue).getTime() / 1000);
  return Number.isFinite(timestamp) ? `<t:${timestamp}:R>` : 'muy pronto';
}

function randomDiceFace() {
  return DICE_FACES[Math.floor(Math.random() * DICE_FACES.length)];
}

function randomResultMessage() {
  return RESULT_MESSAGES[Math.floor(Math.random() * RESULT_MESSAGES.length)];
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createBetButtons(bet) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`bet:accept:${bet.betId}:${bet.targetId}`)
        .setLabel('Aceptar apuesta')
        .setEmoji('✅')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`bet:decline:${bet.betId}:${bet.targetId}`)
        .setLabel('Rechazar apuesta')
        .setEmoji('❌')
        .setStyle(ButtonStyle.Danger)
    )
  ];
}

function createChallengeEmbed({ bet, challenger, target }) {
  return new EmbedBuilder()
    .setColor(COLORS.created)
    .setTitle('🎲 Apuesta creada')
    .setDescription([
      '━━━━━━━━━━━━━━',
      `${target}, tienes un reto pendiente.`,
      '',
      'Presiona un botón para aceptar o rechazar.',
      '━━━━━━━━━━━━━━'
    ].join('\n'))
    .addFields(
      { name: '⚔️ Retador', value: `${challenger}`, inline: true },
      { name: '⚔️ Rival', value: `${target}`, inline: true },
      { name: '🎮 Juego', value: '**Dados altos**', inline: true },
      { name: '💰 Bote total', value: formatPrize(bet.amount), inline: false },
      { name: '⏳ Tiempo restante', value: betTimestamp(bet.expiresAt), inline: true },
      { name: '🆔 ID', value: `\`${bet.betId}\``, inline: true }
    )
    .setFooter({ text: 'El dinero del retador queda apartado hasta que la apuesta se resuelva.' })
    .setTimestamp();
}

function createRollingEmbed({ dotCount = 1, leftFace = '🎲', rightFace = '🎲' } = {}) {
  return new EmbedBuilder()
    .setColor(COLORS.created)
    .setTitle(`🎲 Lanzando los dados${'.'.repeat(dotCount)}`)
    .setDescription([
      '',
      `# ${leftFace} VS ${rightFace}`,
      '',
      'Los dados están girando...'
    ].join('\n'))
    .setFooter({ text: 'Zentux Bets • Dados altos' })
    .setTimestamp();
}

function createResultEmbed(bet) {
  const challengerWon = bet.winnerId === bet.challengerId;
  const pot = Number(bet.amount || 0) * 2;
  const isBigWin = pot >= BIG_WIN_THRESHOLD;
  const title = isBigWin ? '💎 BIG WIN • 🏆 Resultado Final' : '🏆 Resultado Final';
  const color = isBigWin ? COLORS.gold : challengerWon ? COLORS.success : COLORS.danger;

  return new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setDescription([
      `😈 **Retador**`,
      `<@${bet.challengerId}>`,
      `🎲 **${bet.challengerRoll}**`,
      '',
      '# VS',
      '',
      `👤 **Rival**`,
      `<@${bet.targetId}>`,
      `🎲 **${bet.targetRoll}**`,
      '',
      '━━━━━━━━━━━━━━',
      '💰 **Premio**',
      formatPrize(bet.amount),
      '',
      '🏆 **Ganador**',
      `<@${bet.winnerId}>`,
      '',
      '━━━━━━━━━━━━━━',
      randomResultMessage()
    ].join('\n'))
    .setFooter({ text: isBigWin ? '👑 HIGH ROLLER • Zentux Bets' : 'Zentux Bets • Dados altos' })
    .setTimestamp();
}

function createDeclinedEmbed(bet) {
  return new EmbedBuilder()
    .setColor(COLORS.warning)
    .setTitle('❌ Apuesta rechazada')
    .setDescription([
      `La apuesta \`${bet.betId}\` fue rechazada.`,
      '',
      `🪙 **${formatCoins(bet.amount)} Z-Coins** fueron devueltas al retador.`
    ].join('\n'))
    .setTimestamp();
}

function createCancelledEmbed(bet) {
  return new EmbedBuilder()
    .setColor(COLORS.muted)
    .setTitle('🛑 Apuesta cancelada')
    .setDescription([
      `La apuesta \`${bet.betId}\` fue cancelada.`,
      '',
      `🪙 **${formatCoins(bet.amount)} Z-Coins** volvieron al bolsillo del retador.`
    ].join('\n'))
    .setTimestamp();
}

async function animateDiceMessage(message, bet) {
  for (let frame = 0; frame < 6; frame += 1) {
    await message.edit({
      embeds: [
        createRollingEmbed({
          dotCount: (frame % 3) + 1,
          leftFace: randomDiceFace(),
          rightFace: randomDiceFace()
        })
      ],
      components: []
    });
    await wait(500);
  }

  await message.edit({
    embeds: [createResultEmbed(bet)],
    components: []
  });
}

async function replyKnownError(interaction, error) {
  const messages = {
    invalid_user: 'No pude validar ese usuario de Discord.',
    invalid_amount: 'La cantidad de la apuesta no es válida.',
    same_user: 'No puedes apostar contra ti mismo.',
    bet_too_small: `La apuesta mínima es de ${MIN_BET.toLocaleString('es-ES')} Z-Coins.`,
    bet_too_large: `La apuesta máxima es de ${MAX_BET.toLocaleString('es-ES')} Z-Coins.`,
    insufficient_funds: 'No hay suficientes Z-Coins en el bolsillo para hacer eso.',
    pending_bet_exists: 'Uno de los dos usuarios ya tiene una apuesta pendiente. Acéptala, recházala o espera a que expire.',
    bet_not_found: 'No encontré esa apuesta. Revisa el ID.',
    bet_not_pending: 'Esa apuesta ya no está pendiente.',
    not_your_bet: 'Esa apuesta no te corresponde.',
    bet_expired: 'Esa apuesta ya expiró y fue reembolsada.'
  };

  const message = messages[error.code];
  if (!message) throw error;

  const payload = {
    content: message,
    flags: MessageFlags.Ephemeral
  };

  if (interaction.deferred || interaction.replied) {
    await interaction.followUp(payload);
  } else {
    await interaction.reply(payload);
  }
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

    await interaction.reply({
      content: `${target}`,
      embeds: [createChallengeEmbed({ bet, challenger: interaction.user, target })],
      components: createBetButtons(bet)
    });
  } catch (error) {
    await replyKnownError(interaction, error);
  }
}

async function resolveAcceptedBet({ interaction, licenseApi, betId, targetId, message }) {
  const result = await licenseApi.economyBetAccept({ betId, targetId });
  const bet = result.bet;

  if (message) {
    await message.edit({ embeds: [createRollingEmbed()], components: [] });
    await animateDiceMessage(message, bet);
    return;
  }

  await interaction.reply({ embeds: [createRollingEmbed()], components: [] });
  const reply = await interaction.fetchReply();
  await animateDiceMessage(reply, bet);
}

async function handleAccept(interaction, licenseApi) {
  const betId = normalizeBetId(interaction.options.getString('id', true));

  try {
    await resolveAcceptedBet({
      interaction,
      licenseApi,
      betId,
      targetId: interaction.user.id
    });
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

    await interaction.reply({ embeds: [createDeclinedEmbed(result.bet)] });
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

    await interaction.reply({ embeds: [createCancelledEmbed(result.bet)] });
  } catch (error) {
    await replyKnownError(interaction, error);
  }
}

async function handleButton(interaction, { licenseApi } = {}) {
  const [, action, rawBetId, targetId] = interaction.customId.split(':');
  const betId = normalizeBetId(rawBetId);

  if (!licenseApi || !['accept', 'decline'].includes(action)) return false;

  if (interaction.user.id !== targetId) {
    await interaction.reply({
      content: 'Solo el rival de esta apuesta puede usar este botón.',
      flags: MessageFlags.Ephemeral
    });
    return true;
  }

  await interaction.deferUpdate();

  try {
    if (action === 'accept') {
      await resolveAcceptedBet({
        interaction,
        licenseApi,
        betId,
        targetId: interaction.user.id,
        message: interaction.message
      });
      return true;
    }

    const result = await licenseApi.economyBetDecline({
      betId,
      targetId: interaction.user.id
    });
    await interaction.message.edit({
      embeds: [createDeclinedEmbed(result.bet)],
      components: []
    });
    return true;
  } catch (error) {
    await replyKnownError(interaction, error);
    return true;
  }
}

async function execute(interaction, { licenseApi } = {}) {
  if (!licenseApi) {
    await interaction.reply({
      content: 'El sistema de apuestas no está disponible ahora mismo.',
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
  execute,
  handleButton,
  createChallengeEmbed,
  createResultEmbed,
  createRollingEmbed,
  formatPrize
};
