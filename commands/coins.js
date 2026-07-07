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

async function execute(interaction, { licenseApi } = {}) {
  await interaction.deferReply();

  if (!licenseApi) {
    throw new Error('El servicio de economia no esta configurado.');
  }

  const target = interaction.options.getUser('usuario') || interaction.user;
  const localUser = getOrCreateUser(target.id);
  const response = await licenseApi.economyUser({
    discordUserId: target.id,
    discordUsername: target.username,
    discordAvatarUrl: target.displayAvatarURL({ size: 256 })
  });
  const user = response.user;
  const requiredXp = xpForNextLevel(localUser.level);
  const filled = Math.min(10, Math.floor((localUser.xp / requiredXp) * 10));
  const progressBar = `${'▰'.repeat(filled)}${'▱'.repeat(10 - filled)}`;

  const embed = new EmbedBuilder()
    .setColor(0xf5b800)
    .setAuthor({
      name: `Economía de ${target.username}`,
      iconURL: target.displayAvatarURL({ size: 128 })
    })
    .setTitle('Balance de Zentux')
    .addFields(
      { name: 'Bolsillo', value: `🪙 **${user.zcoins.toLocaleString('es-ES')}**`, inline: true },
      { name: 'Banco protegido', value: `🏦 **${user.bank.toLocaleString('es-ES')}**`, inline: true },
      {
        name: 'Total',
        value: `💰 **${(user.zcoins + user.bank).toLocaleString('es-ES')}**`,
        inline: true
      },
      { name: 'Zenitx comprados', value: `💜 **${user.zenitx.toLocaleString('es-ES')}**`, inline: true },
      { name: 'Racha diaria', value: `🔥 **${localUser.streak_days} día(s)**`, inline: true },
      { name: 'Nivel', value: `⭐ **${localUser.level}**`, inline: true },
      { name: 'Experiencia', value: `✨ **${localUser.xp}/${requiredXp} XP**\n${progressBar}` }
    )
    .setFooter({ text: 'Zentux Economy' })
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}

module.exports = { data, execute };
