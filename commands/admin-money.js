const {
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder
} = require('discord.js');
const { db, queries } = require('../database/db');

const updatePocketQuery = db.prepare(`UPDATE users SET zcoins = ? WHERE userId = ?`);
const updateBankQuery = db.prepare(`UPDATE users SET bank = ? WHERE userId = ?`);

function adminMoneyError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

const modifyMoneyTransaction = db.transaction(({
  adminName,
  targetId,
  action,
  destination,
  amount,
  reason
}) => {
  const normalizedAmount = Number(amount);
  if (!Number.isSafeInteger(normalizedAmount) || normalizedAmount <= 0) {
    throw adminMoneyError('INVALID_AMOUNT', 'La cantidad debe ser un entero positivo.');
  }
  if (!['add', 'remove', 'set'].includes(action)) {
    throw adminMoneyError('INVALID_ACTION', 'Acción no válida.');
  }
  if (!['pocket', 'bank'].includes(destination)) {
    throw adminMoneyError('INVALID_DESTINATION', 'Destino no válido.');
  }

  queries.createUser.run(String(targetId));
  const before = queries.getUser.get(String(targetId));
  const current = destination === 'pocket' ? before.zcoins : before.bank;
  let next;
  if (action === 'add') next = current + normalizedAmount;
  else if (action === 'remove') next = current - normalizedAmount;
  else next = normalizedAmount;

  if (!Number.isFinite(next) || next < 0) {
    throw adminMoneyError('INSUFFICIENT_FUNDS', 'La operación dejaría el saldo en negativo.');
  }

  const updateQuery = destination === 'pocket' ? updatePocketQuery : updateBankQuery;
  updateQuery.run(next, String(targetId));
  const delta = next - current;
  const defaultReason = `${action} ${normalizedAmount} en ${destination}`;
  const providedReason = String(reason || '').trim();
  const auditReason = `[Admin: ${String(adminName).trim()}] ${providedReason || defaultReason}`;
  queries.registerCoinLog.run(String(targetId), delta, auditReason);

  return {
    before,
    user: queries.getUser.get(String(targetId)),
    delta,
    auditReason
  };
});

function modifyMoney(input) {
  return modifyMoneyTransaction(input);
}

const data = new SlashCommandBuilder()
  .setName('admin-money')
  .setDescription('Administra el bolsillo o banco de un usuario')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .setDMPermission(false)
  .addStringOption((option) =>
    option
      .setName('accion')
      .setDescription('Operación que deseas realizar')
      .setRequired(true)
      .addChoices(
        { name: 'Añadir', value: 'add' },
        { name: 'Quitar', value: 'remove' },
        { name: 'Fijar cantidad exacta', value: 'set' }
      )
  )
  .addStringOption((option) =>
    option
      .setName('destino')
      .setDescription('Saldo que deseas modificar')
      .setRequired(true)
      .addChoices(
        { name: 'Efectivo / Bolsillo', value: 'pocket' },
        { name: 'Banco', value: 'bank' }
      )
  )
  .addUserOption((option) =>
    option
      .setName('usuario')
      .setDescription('Usuario objetivo')
      .setRequired(true)
  )
  .addIntegerOption((option) =>
    option
      .setName('cantidad')
      .setDescription('Cantidad entera positiva')
      .setMinValue(1)
      .setRequired(true)
  )
  .addStringOption((option) =>
    option
      .setName('motivo')
      .setDescription('Razón de la modificación')
      .setMaxLength(300)
      .setRequired(false)
  );

async function execute(interaction, { licenseApi } = {}) {
  const target = interaction.options.getUser('usuario', true);
  const action = interaction.options.getString('accion', true);
  const destination = interaction.options.getString('destino', true);
  const amount = interaction.options.getInteger('cantidad', true);
  const reason = interaction.options.getString('motivo');
  const adminName = interaction.member?.displayName || interaction.user.username;

  try {
    const beforeResponse = await licenseApi.economyUser({
      discordUserId: target.id,
      discordUsername: target.username,
      discordAvatarUrl: target.displayAvatarURL({ size: 256 })
    });
    const before = beforeResponse.user;
    const current = destination === 'pocket' ? before.zcoins : before.bank;
    const next = action === 'add' ? current + amount : action === 'remove' ? current - amount : amount;
    if (next < 0) throw adminMoneyError('INSUFFICIENT_FUNDS', 'La operación dejaría el saldo en negativo.');
    const delta = next - current;
    const defaultReason = `${action} ${amount} en ${destination}`;
    const auditReason = `[Admin: ${adminName}] ${String(reason || '').trim() || defaultReason}`;
    const response = delta === 0
      ? beforeResponse
      : await licenseApi.economyAdd({
          discordUserId: target.id,
          amount: delta,
          currency: 'zcoins',
          bucket: destination,
          reason: auditReason
        });
    const result = { before, user: response.user, delta, auditReason };
    const destinationLabel = destination === 'pocket' ? 'Bolsillo' : 'Banco';
    const newBalance = destination === 'pocket' ? result.user.zcoins : result.user.bank;
    const embed = new EmbedBuilder()
      .setColor(0x7c3aed)
      .setTitle('🛠️ Dinero actualizado')
      .setDescription(`Se modificó el saldo de ${target}.`)
      .addFields(
        { name: 'Destino', value: destinationLabel, inline: true },
        { name: 'Cambio real', value: `${result.delta >= 0 ? '+' : ''}${result.delta.toLocaleString('es-ES')} ZCoins`, inline: true },
        { name: 'Nuevo saldo', value: `${newBalance.toLocaleString('es-ES')} ZCoins`, inline: true },
        { name: 'Auditoría', value: result.auditReason }
      )
      .setTimestamp();
    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  } catch (error) {
    if (!['INVALID_AMOUNT', 'INVALID_ACTION', 'INVALID_DESTINATION', 'INSUFFICIENT_FUNDS'].includes(error.code)) {
      throw error;
    }
    await interaction.reply({ content: error.message, flags: MessageFlags.Ephemeral });
  }
}

module.exports = { data, execute, modifyMoney };
