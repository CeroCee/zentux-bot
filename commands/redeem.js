const { EmbedBuilder, MessageFlags, SlashCommandBuilder } = require('discord.js');
const { db, queries, addCoins } = require('../database/db');
const { SHOP_ITEMS, KEY_HOURS } = require('./shop');

const LIMITED_ACCESS_ROLE_ID = process.env.LIMITED_ACCESS_ROLE_ID || '1424919985209217024';

const itemChoices = [
  ...KEY_HOURS.map((hours) => {
    const item = SHOP_ITEMS[`key_${hours}h`];
    return { name: `${item.name} — ${item.price} ZCoins`, value: item.id };
  }),
  { name: 'Protector de Racha — 150 ZCoins', value: 'streak_protector' }
];

const data = new SlashCommandBuilder()
  .setName('redeem')
  .setDescription('Compra una Key o un protector con ZCoins del bolsillo')
  .addStringOption((option) =>
    option
      .setName('item_id')
      .setDescription('Artículo que deseas comprar')
      .setRequired(true)
      .addChoices(...itemChoices)
  );

const debitCoinsQuery = db.prepare(`
  UPDATE users SET zcoins = zcoins - ?
  WHERE userId = ? AND zcoins >= ?
`);
const addProtectorQuery = db.prepare(`
  UPDATE users SET streak_protector = streak_protector + 1
  WHERE userId = ?
`);

function shopError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

const chargeItemTransaction = db.transaction((userId, itemId) => {
  const item = SHOP_ITEMS[itemId];
  if (!item) throw shopError('UNKNOWN_ITEM', 'Ese artículo no existe.');
  queries.createUser.run(userId);
  const debit = debitCoinsQuery.run(item.price, userId, item.price);
  if (debit.changes !== 1) {
    throw shopError('INSUFFICIENT_FUNDS', 'Saldo insuficiente en el bolsillo.');
  }
  if (item.type === 'protector') addProtectorQuery.run(userId);
  queries.registerCoinLog.run(userId, -item.price, `Compra: ${item.name}`);
  return { item, user: queries.getUser.get(userId) };
});

function chargeItem(userId, itemId) {
  return chargeItemTransaction(String(userId), String(itemId));
}

function refundItem(userId, item) {
  return addCoins(
    String(userId),
    item.price,
    `Reembolso: no se pudo generar ${item.name}`
  ).user;
}

async function buyProtector(interaction) {
  const { item, user } = chargeItem(interaction.user.id, 'streak_protector');
  const embed = new EmbedBuilder()
    .setColor(0x22c55e)
    .setTitle('🛡️ Protector comprado')
    .setDescription('Se guardó correctamente y se usará automáticamente cuando sea necesario.')
    .addFields(
      { name: 'Precio', value: `🪙 ${item.price} ZCoins`, inline: true },
      { name: 'Protectores', value: String(user.streak_protector), inline: true },
      { name: 'Bolsillo', value: `🪙 ${user.zcoins.toLocaleString('es-ES')}`, inline: true }
    )
    .setTimestamp();
  await interaction.editReply({ embeds: [embed] });
}

async function buyKey(interaction, item, licenseApi) {
  chargeItem(interaction.user.id, item.id);
  let licenseCommitted = false;
  try {
    const result = await licenseApi.purchaseShop({
      discordUserId: interaction.user.id,
      discordUsername: interaction.user.tag,
      hours: item.hours,
      zcoinsSpent: item.price
    });
    const license = result?.license;
    const licenseKey = license?.licenseKey;
    if (!licenseKey) throw new Error('El servidor no devolvió una Key válida.');
    licenseCommitted = true;

    const member = await interaction.guild.members.fetch(interaction.user.id);
    const limitedRole = interaction.guild.roles.cache.get(LIMITED_ACCESS_ROLE_ID)
      || await interaction.guild.roles.fetch(LIMITED_ACCESS_ROLE_ID).catch(() => null);
    let roleAssigned = false;
    if (limitedRole && !member.roles.cache.has(limitedRole.id)) {
      try {
        await member.roles.add(limitedRole, 'Licencia comprada con ZCoins en Zentux Shop');
        roleAssigned = true;
      } catch (error) {
        console.error(`No se pudo asignar Limited Access a ${interaction.user.id}:`, error.message);
      }
    } else if (limitedRole) {
      roleAssigned = true;
    }

    const user = queries.getUser.get(interaction.user.id);
    const expirationTimestamp = Math.floor(new Date(license.paidUntil).getTime() / 1000);
    const purchaseDescription = result.extended
      ? `Se agregaron **${item.hours} hora${item.hours === 1 ? '' : 's'}** a tu Key actual.\n\nConservas la misma Key:\n\`${licenseKey}\``
      : `Se creó y vinculó una **Key de ${item.hours} hora${item.hours === 1 ? '' : 's'}** a tu perfil.\n\nTu Key privada:\n\`${licenseKey}\``;

    const embed = new EmbedBuilder()
      .setColor(0x22c55e)
      .setTitle(result.extended ? '⏳ Tiempo agregado a tu Key' : '🔑 Key vinculada a tu perfil')
      .setDescription(purchaseDescription)
      .addFields(
        { name: 'Precio', value: `🪙 ${item.price.toLocaleString('es-ES')} ZCoins`, inline: true },
        { name: 'Bolsillo restante', value: `🪙 ${user.zcoins.toLocaleString('es-ES')}`, inline: true },
        { name: 'Vencimiento', value: `<t:${expirationTimestamp}:F> (<t:${expirationTimestamp}:R>)` },
        {
          name: 'Perfil y acceso',
          value: roleAssigned
            ? `Ya aparece en \`/info\` y recibiste <@&${LIMITED_ACCESS_ROLE_ID}>. No necesitas usar \`/canjear\`.`
            : 'La Key ya aparece en `/info`. El rol se asignará automáticamente en la próxima sincronización.'
        }
      )
      .setTimestamp();
    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    if (!licenseCommitted) {
      refundItem(interaction.user.id, item);
      error.purchaseRefunded = true;
    }
    throw error;
  }
}

async function execute(interaction, { licenseApi } = {}) {
  const itemId = interaction.options.getString('item_id', true);
  const item = SHOP_ITEMS[itemId];
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    if (!item) throw shopError('UNKNOWN_ITEM', 'Ese artículo no existe.');
    if (item.type === 'protector') {
      await buyProtector(interaction);
      return;
    }
    if (!licenseApi) throw new Error('El servicio de licencias no está configurado.');
    await buyKey(interaction, item, licenseApi);
  } catch (error) {
    if (error.code === 'INSUFFICIENT_FUNDS') {
      await interaction.editReply({
        content: 'No tienes suficientes ZCoins en el bolsillo. Retira fondos con `/bank withdraw` si tienes dinero guardado.',
        embeds: []
      });
      return;
    }
    if (error.code === 'UNKNOWN_ITEM') {
      await interaction.editReply({ content: 'Ese artículo ya no existe. Consulta `/shop`.', embeds: [] });
      return;
    }
    if (error.purchaseRefunded) {
      const message = error.code === 'user_has_license'
        ? 'Ya tienes otra licencia activa que no pertenece a Zentux Shop. No se cobraron ZCoins.'
        : `No se pudo procesar la licencia. Se reembolsaron automáticamente ${item.price} ZCoins a tu bolsillo.`;
      await interaction.editReply({
        content: message,
        embeds: []
      });
      return;
    }
    throw error;
  }
}

module.exports = { data, execute, buyKey, chargeItem, refundItem };
