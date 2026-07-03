const crypto = require('node:crypto');
const { EmbedBuilder, MessageFlags, SlashCommandBuilder } = require('discord.js');
const { db, queries, addCoins } = require('../database/db');
const { SHOP_ITEMS } = require('./shop');

const data = new SlashCommandBuilder()
  .setName('redeem')
  .setDescription('Compra un artículo de la tienda con ZCoins')
  .addStringOption((option) =>
    option
      .setName('item_id')
      .setDescription('ID del artículo que deseas comprar')
      .setRequired(true)
      .addChoices(
        { name: 'Caja Misteriosa — 250 ZCoins', value: 'mystery_box' },
        { name: 'Protector de Racha — 150 ZCoins', value: 'streak_protector' }
      )
  );

const debitCoinsQuery = db.prepare(`
  UPDATE users SET zcoins = zcoins - ?
  WHERE userId = ? AND zcoins >= ?
`);
const addProtectorQuery = db.prepare(`
  UPDATE users SET streak_protector = streak_protector + 1
  WHERE userId = ?
`);

function insufficientFundsError() {
  const error = new Error('Saldo insuficiente.');
  error.code = 'INSUFFICIENT_FUNDS';
  return error;
}

const purchaseProtectorTransaction = db.transaction((userId) => {
  const item = SHOP_ITEMS.streak_protector;
  queries.createUser.run(userId);
  const debit = debitCoinsQuery.run(item.price, userId, item.price);
  if (debit.changes !== 1) throw insufficientFundsError();
  addProtectorQuery.run(userId);
  queries.registerCoinLog.run(userId, -item.price, 'Compra: Protector de Racha');
  return queries.getUser.get(userId);
});

const purchaseMysteryBoxTransaction = db.transaction((userId) => {
  const item = SHOP_ITEMS.mystery_box;
  queries.createUser.run(userId);
  const debit = debitCoinsQuery.run(item.price, userId, item.price);
  if (debit.changes !== 1) throw insufficientFundsError();
  queries.registerCoinLog.run(userId, -item.price, 'Compra: Caja Misteriosa');
  return queries.getUser.get(userId);
});

function selectPrize(roll = crypto.randomInt(10_000)) {
  if (!Number.isInteger(roll) || roll < 0 || roll >= 10_000) {
    throw new RangeError('El roll debe ser un entero entre 0 y 9999.');
  }
  if (roll < 6_000) return { hours: 1, chance: '60%', jackpot: false };
  if (roll < 8_500) return { hours: 3, chance: '25%', jackpot: false };
  if (roll < 9_500) return { hours: 5, chance: '10%', jackpot: false };
  if (roll < 9_950) return { hours: 10, chance: '4.5%', jackpot: false };
  return { hours: 12, chance: '0.5%', jackpot: true };
}

function purchaseProtector(userId) {
  return purchaseProtectorTransaction(String(userId));
}

function purchaseMysteryBox(userId) {
  return purchaseMysteryBoxTransaction(String(userId));
}

function refundMysteryBox(userId) {
  return addCoins(
    String(userId),
    SHOP_ITEMS.mystery_box.price,
    'Reembolso: no se pudo generar la Key de la Caja Misteriosa'
  ).user;
}

function suspenseEmbed() {
  return new EmbedBuilder()
    .setColor(0xf59e0b)
    .setTitle('🎁 Abriendo tu Caja Misteriosa...')
    .setDescription('La caja está temblando... ¿será el Jackpot? ✨')
    .setFooter({ text: 'Calculando tu premio de forma segura' });
}

async function buyProtector(interaction) {
  const user = purchaseProtector(interaction.user.id);
  const embed = new EmbedBuilder()
    .setColor(0x22c55e)
    .setTitle('🛡️ Protector comprado')
    .setDescription('Tu Protector de Racha ya está guardado y se usará automáticamente.')
    .addFields(
      { name: 'Protectores disponibles', value: String(user.streak_protector), inline: true },
      { name: 'Balance', value: `🪙 ${user.zcoins.toLocaleString('es-ES')} ZCoins`, inline: true }
    )
    .setTimestamp();
  await interaction.editReply({ embeds: [embed] });
}

async function buyMysteryBox(interaction, licenseApi) {
  purchaseMysteryBox(interaction.user.id);
  await interaction.editReply({ embeds: [suspenseEmbed()] });
  const prize = selectPrize();
  let licenseGenerated = false;

  try {
    const [result] = await Promise.all([
      licenseApi.generateGiveaway({
        hours: prize.hours,
        count: 1,
        createdBy: interaction.user.id,
        source: 'mystery_box'
      }),
      new Promise((resolve) => setTimeout(resolve, 1_200))
    ]);
    const licenseKey = result?.licenses?.[0]?.licenseKey;
    if (!licenseKey) throw new Error('El servidor no devolvió una Key válida.');
    licenseGenerated = true;

    const user = prize.jackpot
      ? addCoins(interaction.user.id, 500, 'Jackpot Caja Misteriosa: devolución de 500 ZCoins').user
      : queries.getUser.get(interaction.user.id);
    const prizeText = prize.jackpot
      ? `Ganaste una **Key de 12 horas** y recuperaste **500 ZCoins**.`
      : `Ganaste una **Key de ${prize.hours} hora${prize.hours === 1 ? '' : 's'}**.`;

    const embed = new EmbedBuilder()
      .setColor(prize.jackpot ? 0xfacc15 : 0x7c3aed)
      .setTitle(prize.jackpot ? '🏆 ¡JACKPOT!' : '🔑 ¡Tu premio está listo!')
      .setDescription(`${prizeText}\n\nTu Key privada:\n\`${licenseKey}\``)
      .addFields(
        { name: 'Probabilidad', value: prize.chance, inline: true },
        { name: 'Balance', value: `🪙 ${user.zcoins.toLocaleString('es-ES')} ZCoins`, inline: true },
        { name: 'Cómo activarla', value: 'Usa `/canjear codigo:<KEY>`. Este mensaje solo es visible para ti.' }
      )
      .setFooter({ text: 'Guarda tu Key y no la compartas' })
      .setTimestamp();
    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    if (!licenseGenerated) {
      refundMysteryBox(interaction.user.id);
      error.purchaseRefunded = true;
    }
    throw error;
  }
}

async function execute(interaction, { licenseApi } = {}) {
  const itemId = interaction.options.getString('item_id', true);
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    if (itemId === SHOP_ITEMS.streak_protector.id) {
      await buyProtector(interaction);
      return;
    }
    if (itemId === SHOP_ITEMS.mystery_box.id) {
      if (!licenseApi) throw new Error('El servicio de licencias no está configurado.');
      await buyMysteryBox(interaction, licenseApi);
      return;
    }
    await interaction.editReply({ content: 'Ese artículo no existe. Usa `/shop` para ver los IDs.' });
  } catch (error) {
    if (error.code === 'INSUFFICIENT_FUNDS') {
      await interaction.editReply({ content: 'No tienes suficientes ZCoins. Consulta tu balance con `/coins`.', embeds: [] });
      return;
    }
    if (error.purchaseRefunded) {
      await interaction.editReply({
        content: 'No se pudo generar tu Key. Tus 250 ZCoins fueron reembolsados automáticamente; inténtalo de nuevo más tarde.',
        embeds: []
      });
      return;
    }
    throw error;
  }
}

module.exports = {
  data,
  execute,
  selectPrize,
  purchaseProtector,
  purchaseMysteryBox,
  refundMysteryBox
};
