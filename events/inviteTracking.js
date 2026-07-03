const { Events, PermissionFlagsBits } = require('discord.js');
const { db, addXp, incrementInvites } = require('../database/db');
const { checkQuests } = require('./reactionsAndQuests');

const INVITE_XP = 25;
const inviteCache = new Map();
const registeredClients = new WeakSet();
let joinQueue = Promise.resolve();

function snapshotInvites(invites) {
  const snapshot = new Map();
  for (const invite of invites.values()) {
    snapshot.set(invite.code, {
      code: invite.code,
      uses: Number(invite.uses || 0),
      maxUses: Number(invite.maxUses || 0),
      inviterId: invite.inviterId || invite.inviter?.id || null
    });
  }
  return snapshot;
}

function findUsedInvite(before, after) {
  const increased = [];
  for (const current of after.values()) {
    const previousUses = before.get(current.code)?.uses || 0;
    if (current.uses > previousUses) {
      increased.push({ ...current, delta: current.uses - previousUses });
    }
  }
  increased.sort((a, b) => b.delta - a.delta);
  if (increased.length > 0) return increased[0];

  const consumed = [...before.values()].filter((invite) => (
    !after.has(invite.code)
    && invite.maxUses > 0
    && invite.uses < invite.maxUses
  ));
  return consumed.length === 1 ? consumed[0] : null;
}

async function fetchInviteSnapshot(guild) {
  const invites = await guild.invites.fetch();
  return snapshotInvites(invites);
}

const rewardInviteTransaction = db.transaction((inviterId) => {
  const quest = checkQuests(inviterId, 'invite');
  const xp = addXp(inviterId, INVITE_XP, 'Invitación verificada');
  const user = incrementInvites(inviterId, 1);
  return { quest, xp, user };
});

async function handleMemberJoin(member) {
  if (member.user.bot) return null;

  const before = inviteCache.get(member.guild.id);
  const after = await fetchInviteSnapshot(member.guild);
  inviteCache.set(member.guild.id, after);
  if (!before) return null;

  const usedInvite = findUsedInvite(before, after);
  const inviterId = usedInvite?.inviterId;
  if (!inviterId || inviterId === member.id) return null;

  const inviter = await member.guild.members.fetch(inviterId).catch(() => null);
  if (!inviter || inviter.user.bot) return null;

  const result = rewardInviteTransaction(inviterId);
  console.log(
    `Invitación verificada: ${inviter.user.tag} invitó a ${member.user.tag} con ${usedInvite.code}.`
  );
  if (result.quest.comboAwarded) {
    console.log(`Combo diario otorgado a ${inviterId} al completar la misión de invitaciones.`);
  }
  return { inviterId, inviteCode: usedInvite.code, ...result };
}

function register(client) {
  if (registeredClients.has(client)) return;
  registeredClients.add(client);

  client.once(Events.ClientReady, async (readyClient) => {
    for (const guild of readyClient.guilds.cache.values()) {
      const me = guild.members.me || await guild.members.fetchMe();
      if (!me.permissions.has(PermissionFlagsBits.ManageGuild)) {
        console.warn(
          `Invitaciones desactivadas en ${guild.name}: el bot necesita el permiso Administrar servidor.`
        );
        continue;
      }

      try {
        inviteCache.set(guild.id, await fetchInviteSnapshot(guild));
        console.log(`Seguimiento de invitaciones activo en ${guild.name}.`);
      } catch (error) {
        console.error(`No se pudieron cargar las invitaciones de ${guild.name}:`, error.message);
      }
    }
  });

  client.on(Events.GuildMemberAdd, (member) => {
    joinQueue = joinQueue
      .then(() => handleMemberJoin(member))
      .catch((error) => {
        console.error(`No se pudo atribuir la invitación de ${member.user.tag}:`, error.message);
      });
  });
}

module.exports = {
  name: Events.GuildMemberAdd,
  register,
  snapshotInvites,
  findUsedInvite,
  rewardInviteTransaction,
  INVITE_XP
};
