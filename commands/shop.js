const { EmbedBuilder, SlashCommandBuilder } = require('discord.js');

const SHOP_ITEMS = Object.freeze({
  mystery_box: Object.freeze({ id: 'mystery_box', name: 'Caja Misteriosa', price: 250 }),
  streak_protector: Object.freeze({ id: 'streak_protector', name: 'Protector de Racha', price: 150 })
});

const data = new SlashCommandBuilder()
  .setName('shop')
  .setDescription('Muestra la tienda de Zentux y los premios disponibles');

async function execute(interaction) {
  const embed = new EmbedBuilder()
    .setColor(0x7c3aed)
    .setTitle('🛒 Tienda Zentux')
    .setDescription('Compra con `/redeem item_id:<ID>`. Las Keys se entregan de forma privada y se activan con `/canjear`.')
    .addFields(
      {
        name: '🎁 Caja Misteriosa — 250 ZCoins',
        value: [
          '**ID:** `mystery_box`',
          'Contiene una Key de software elegida al azar:',
          '• Key 1 hora — **60%**',
          '• Key 3 horas — **25%**',
          '• Key 5 horas — **10%**',
          '• Key 10 horas — **4.5%**',
          '• Jackpot: Key 12 horas + 500 ZCoins — **0.5%**'
        ].join('\n')
      },
      {
        name: '🛡️ Protector de Racha — 150 ZCoins',
        value: [
          '**ID:** `streak_protector`',
          'Conserva tu racha diaria cuando pasan más de 48 horas sin reclamar `/daily`.'
        ].join('\n')
      },
      {
        name: '🔑 Catálogo de Keys',
        value: 'Keys de **1h, 3h, 5h, 10h y 12h** disponibles como premios de la Caja Misteriosa.'
      }
    )
    .setFooter({ text: 'Zentux Economy • Las compras no se pueden transferir' })
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
}

module.exports = { data, execute, SHOP_ITEMS };
