const {
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder
} = require('discord.js');

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

async function execute(interaction, { licenseApi } = {}) {
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
    const result = await licenseApi.economyTransfer({
      fromUserId: interaction.user.id,
      toUserId: recipient.id,
      amount
    });
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
      insufficient_funds: 'No tienes suficientes Z-Coins para esa transferencia.',
      same_user: 'No puedes transferirte Z-Coins a ti mismo.'
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
  execute
};
