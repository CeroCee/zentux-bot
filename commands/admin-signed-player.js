const {
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder
} = require('discord.js');

const data = new SlashCommandBuilder()
  .setName('admin-signed-player')
  .setDescription('Administra beneficios de Zentux Signed Players')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .setDMPermission(false)
  .addSubcommand((subcommand) =>
    subcommand
      .setName('reset')
      .setDescription('Permite que un Signed Player pueda generar una key nueva')
      .addUserOption((option) =>
        option
          .setName('usuario')
          .setDescription('Signed Player que necesitas resetear')
          .setRequired(true)
      )
  );

async function execute(interaction, { licenseApi } = {}) {
  if (!licenseApi) throw new Error('El servicio de licencias no está configurado.');

  const subcommand = interaction.options.getSubcommand(true);
  if (subcommand !== 'reset') {
    return interaction.reply({
      content: 'Subcomando no reconocido.',
      flags: MessageFlags.Ephemeral
    });
  }

  const target = interaction.options.getUser('usuario', true);
  const member = await interaction.guild.members.fetch(target.id).catch(() => null);

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const result = await licenseApi.resetSignedPlayer({
    guildId: interaction.guildId,
    discordUserId: target.id,
    resetBy: `admin:${interaction.user.id}`
  });

  const embed = new EmbedBuilder()
    .setColor(result.reset ? 0x22c55e : 0xf59e0b)
    .setTitle(result.reset ? '✅ Signed Player reseteado' : '⚠️ No había registro para resetear')
    .setDescription(
      result.reset
        ? `${target} ya puede usar **/signed-player key** para generar una key nueva.`
        : `${target} no tenía un claim de Signed Player guardado en el sistema.`
    )
    .addFields(
      { name: 'Usuario', value: `${target.tag}\n\`${target.id}\`` },
      { name: 'Tenía rol Signed Player', value: member ? (member.roles.cache.has(process.env.SIGNED_PLAYER_ROLE_ID || '1524136790594683001') ? 'Sí' : 'No') : 'No encontrado', inline: true },
      { name: 'Licencia anterior eliminada', value: result.licenseDeleted ? 'Sí' : 'No', inline: true },
      { name: 'Key anterior', value: result.licenseKey ? `\`${result.licenseKey}\`` : 'No disponible' }
    )
    .setTimestamp();

  return interaction.editReply({ embeds: [embed] });
}

module.exports = { data, execute };
