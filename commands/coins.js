const { EmbedBuilder, SlashCommandBuilder } = require('discord.js');
const { getOrCreateUser, xpForNextLevel } = require('../database/db');

const data = new SlashCommandBuilder()
  .setName('coins')
  .setDescription('Consulta el balance, la racha, la XP y el nivel de un usuario')
  .addUserOption((option) =>
    option
      .setName('usuario')
      .setDescription('Usuario cuyo balance deseas consultar')
      .setRequired(false)
  );

async function execute(interaction) {
  const target = interaction.options.getUser('usuario') || interaction.user;
  const user = getOrCreateUser(target.id);
  const requiredXp = xpForNextLevel(user.level);
  const filled = Math.min(10, Math.floor((user.xp / requiredXp) * 10));
  const progressBar = `${'▰'.repeat(filled)}${'▱'.repeat(10 - filled)}`;

  const embed = new EmbedBuilder()
    .setColor(0xf5b800)
    .setAuthor({
      name: `Economía de ${target.username}`,
      iconURL: target.displayAvatarURL({ size: 128 })
    })
    .setTitle('Balance de Zentux')
    .addFields(
      { name: 'ZCoins', value: `🪙 **${user.zcoins.toLocaleString('es-ES')}**`, inline: true },
      { name: 'Racha diaria', value: `🔥 **${user.streak_days} día(s)**`, inline: true },
      { name: 'Nivel', value: `⭐ **${user.level}**`, inline: true },
      { name: 'Experiencia', value: `✨ **${user.xp}/${requiredXp} XP**\n${progressBar}` }
    )
    .setFooter({ text: 'Zentux Economy' })
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
}

module.exports = { data, execute };
