const {
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder
} = require('discord.js');
const { db, queries } = require('../database/db');

const data = new SlashCommandBuilder()
  .setName('transfer')
  .setDescription('Envia ZCoins a otro usuario')
  .addUserOption((option) =>
    option
      .setName('usuario')
      .setDescription('Usuario que recibira los ZCoins')
      .setRequired(true)
  )
  .addIntegerOption((option) =>
    option
      .setName('cantidad')
      .setDescription('Cantidad de ZCoins que deseas enviar')
      .setMinValue(1)
      .setRequired(true)
  );

const debitCoinsQuery = db.prepare(`
  UPDATE users
  SET zcoins = zcoins - ?
  WHERE userId = ? AND zcoins >= ?
`);

const transferTransaction = db.transaction((senderId, recipientId, amount) => {
  queries.createUser.run(senderId);
  queries.createUser.run(recipientId);

  const debit = debitCoinsQuery.run(amount, senderId, amount);
  if (debit.changes !== 1) {
    const error = new Error('Saldo insuficiente.');
    error.code = 'INSUFFICIENT_FUNDS';
    throw error;
  }

  queries.addCoins.run(amount, recipientId);
  queries.registerCoinLog.run(
    senderId,
    -amount,
    `Transferencia enviada a ${recipientId}`
  );
  queries.registerCoinLog.run(
    recipientId,
    amount,
    `Transferencia recibida de ${senderId}`
  );

  return {
    sender: queries.getUser.get(senderId),
    recipient: queries.getUser.get(recipientId)
  };
});

function transferCoins(senderId, recipientId, amount) {
  const normalizedAmount = Number(amount);
  if (!Number.isSafeInteger(normalizedAmount) || normalizedAmount <= 0) {
    throw new TypeError('La cantidad debe ser un entero positivo.');
  }
  if (String(senderId) === String(recipientId)) {
    const error = new Error('No puedes transferirte monedas a ti mismo.');
    error.code = 'SELF_TRANSFER';
    throw error;
  }

  return transferTransaction(
    String(senderId),
    String(recipientId),
    normalizedAmount
  );
}

async function execute(interaction) {
  const recipient = interaction.options.getUser('usuario', true);
  const amount = interaction.options.getInteger('cantidad', true);

  if (recipient.bot) {
    await interaction.reply({
      content: 'No puedes enviar ZCoins a un bot.',
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  try {
    const result = transferCoins(interaction.user.id, recipient.id, amount);
    const embed = new EmbedBuilder()
      .setColor(0x7c3aed)
      .setTitle('Transferencia completada')
      .setDescription(
        `Enviaste 🪙 **${amount.toLocaleString('es-ES')} ZCoins** a ${recipient}.`
      )
      .addFields({
        name: 'Tu nuevo balance',
        value: `🪙 ${result.sender.zcoins.toLocaleString('es-ES')}`
      })
      .setFooter({ text: 'Zentux Economy' })
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  } catch (error) {
    const messages = {
      INSUFFICIENT_FUNDS: 'No tienes suficientes ZCoins para esa transferencia.',
      SELF_TRANSFER: 'No puedes transferirte ZCoins a ti mismo.'
    };

    if (!messages[error.code]) throw error;
    await interaction.reply({
      content: messages[error.code],
      flags: MessageFlags.Ephemeral
    });
  }
}

module.exports = {
  data,
  execute,
  transferCoins
};
