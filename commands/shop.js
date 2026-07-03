const { EmbedBuilder, SlashCommandBuilder } = require('discord.js');

const PRICE_PER_HOUR = 175;
const KEY_HOURS = Object.freeze([1, 3, 5, 10, 12]);
const SHOP_ITEMS = Object.freeze({
  ...Object.fromEntries(KEY_HOURS.map((hours) => [
    `key_${hours}h`,
    Object.freeze({
      id: `key_${hours}h`,
      name: `Key de ${hours} hora${hours === 1 ? '' : 's'}`,
      hours,
      price: hours * PRICE_PER_HOUR,
      type: 'key'
    })
  ])),
  streak_protector: Object.freeze({
    id: 'streak_protector',
    name: 'Protector de Racha',
    price: 150,
    type: 'protector'
  })
});

const data = new SlashCommandBuilder()
  .setName('shop')
  .setDescription('Muestra el catálogo de Keys y protectores de Zentux');

async function execute(interaction) {
  const keyCatalog = KEY_HOURS.map((hours) => {
    const item = SHOP_ITEMS[`key_${hours}h`];
    return `🔑 **${item.name}** — 🪙 **${item.price.toLocaleString('es-ES')} ZCoins**\nID: \`${item.id}\``;
  }).join('\n\n');

  const embed = new EmbedBuilder()
    .setColor(0x7c3aed)
    .setTitle('🛒 Tienda Zentux')
    .setDescription(
      'Todas las Keys cuestan **175 ZCoins por hora**. Compra con `/redeem item_id:<ID>`; la entrega será privada.'
    )
    .addFields(
      { name: 'Catálogo de Keys de Software', value: keyCatalog },
      {
        name: '🛡️ Protector de Racha — 150 ZCoins',
        value: '**ID:** `streak_protector`\nProtege tu racha si pasan más de 48 horas sin usar `/daily`.'
      }
    )
    .setFooter({ text: 'Las compras usan únicamente las monedas del bolsillo' })
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
}

module.exports = { data, execute, SHOP_ITEMS, KEY_HOURS, PRICE_PER_HOUR };
