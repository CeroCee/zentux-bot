const { EmbedBuilder, SlashCommandBuilder } = require('discord.js');
const {
  getLeaderboard,
  getLeaderboardPosition
} = require('../database/db');

const CATEGORIES = Object.freeze({
  wealth: {
    title: '🪙 Riqueza (ZCoins)',
    description: 'Total combinado del bolsillo y el banco.',
    color: 0xf5b800,
    format: (score) => `${Number(score).toLocaleString('es-ES')} ZCoins`
  },
  voice: {
    title: '🎙️ Tiempo en Voz',
    description: 'Tiempo acumulado en canales de voz autorizados.',
    color: 0x5865f2,
    format: (score) => `${(Number(score) / 60).toFixed(1)} horas`
  },
  reactions: {
    title: '🎨 Reacciones a Anuncios',
    description: 'Reacciones únicas registradas en publicaciones de anuncios.',
    color: 0xec4899,
    format: (score) => `${Number(score).toLocaleString('es-ES')} reacciones`
  },
  invites: {
    title: '✉️ Invitaciones',
    description: 'Miembros que entraron mediante una invitación atribuida.',
    color: 0x22c55e,
    format: (score) => `${Number(score).toLocaleString('es-ES')} invitaciones`
  }
});

const POSITION_BADGES = Object.freeze([
  '🥇', '🥈', '🥉', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'
]);

const data = new SlashCommandBuilder()
  .setName('leaderboard')
  .setDescription('Muestra las clasificaciones globales de Zentux')
  .setDMPermission(false)
  .addStringOption((option) =>
    option
      .setName('categoria')
      .setDescription('Clasificación que deseas consultar')
      .setRequired(true)
      .addChoices(
        { name: '🪙 Riqueza (ZCoins)', value: 'wealth' },
        { name: '🎙️ Tiempo en Voz', value: 'voice' },
        { name: '🎨 Reacciones a Anuncios', value: 'reactions' },
        { name: '✉️ Invitaciones', value: 'invites' }
      )
  );

async function displayName(client, userId) {
  const user = client.users.cache.get(userId)
    || await client.users.fetch(userId).catch(() => null);
  return user ? `@${user.username}` : `Usuario ${userId}`;
}

async function execute(interaction) {
  const categoryId = interaction.options.getString('categoria', true);
  const category = CATEGORIES[categoryId];
  const current = getLeaderboardPosition(categoryId, interaction.user.id);
  const leaders = getLeaderboard(categoryId, 10);
  const names = await Promise.all(
    leaders.map((entry) => displayName(interaction.client, entry.userId))
  );

  const lines = leaders.map((entry, index) => {
    const isCurrentUser = entry.userId === interaction.user.id;
    return `${POSITION_BADGES[index]} **${names[index]}** — ${category.format(entry.score)}${isCurrentUser ? '  ← **Tú**' : ''}`;
  });

  const embed = new EmbedBuilder()
    .setColor(category.color)
    .setTitle(category.title)
    .setDescription(`${category.description}\n\n${lines.join('\n') || 'Todavía no hay datos registrados.'}`)
    .setFooter({
      text: `Tu posición: #${current.position} • ${category.format(current.score)}`,
      iconURL: interaction.user.displayAvatarURL({ size: 64 })
    })
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
}

module.exports = { data, execute, CATEGORIES, POSITION_BADGES };
