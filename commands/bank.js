const { EmbedBuilder, MessageFlags, SlashCommandBuilder } = require('discord.js');

function amountOption(option) {
  return option
    .setName('cantidad')
    .setDescription('Cantidad de ZCoins o escribe all')
    .setRequired(true)
    .setMaxLength(20);
}

const data = new SlashCommandBuilder()
  .setName('bank')
  .setDescription('Administra las monedas protegidas en tu banco')
  .addSubcommand((subcommand) =>
    subcommand
      .setName('deposit')
      .setDescription('Guarda ZCoins del bolsillo en el banco')
      .addStringOption(amountOption)
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('withdraw')
      .setDescription('Retira ZCoins del banco al bolsillo')
      .addStringOption(amountOption)
  );

async function execute(interaction, { licenseApi } = {}) {
  const action = interaction.options.getSubcommand(true);
  const amount = interaction.options.getString('cantidad', true).trim().toLowerCase();

  try {
    const result = await licenseApi.economyBank({
      discordUserId: interaction.user.id,
      direction: action,
      amount
    });
    const isDeposit = action === 'deposit';
    const embed = new EmbedBuilder()
      .setColor(0x3b82f6)
      .setTitle(isDeposit ? '🏦 Depósito completado' : '💵 Retiro completado')
      .setDescription(
        `${isDeposit ? 'Guardaste' : 'Retiraste'} 🪙 **${result.amount.toLocaleString('es-ES')} ZCoins**.`
      )
      .addFields(
        { name: 'Bolsillo', value: `🪙 ${result.user.zcoins.toLocaleString('es-ES')}`, inline: true },
        { name: 'Banco protegido', value: `🏦 ${result.user.bank.toLocaleString('es-ES')}`, inline: true }
      )
      .setTimestamp();
    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  } catch (error) {
    const messages = {
      invalid_amount: 'Usa un número positivo o `all`.',
      insufficient_funds: 'No tienes suficientes Z-Coins para realizar ese movimiento.'
    };
    if (!messages[error.code]) throw error;
    await interaction.reply({ content: messages[error.code], flags: MessageFlags.Ephemeral });
  }
}

module.exports = { data, execute };
