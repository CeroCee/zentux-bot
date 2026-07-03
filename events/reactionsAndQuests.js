const { Events } = require('discord.js');
const config = require('../config.json');
const { db, addCoins, addXp, getOrCreateUser } = require('../database/db');

const REACTION_REWARD = 10;
const MAX_DAILY_REACTION_REWARD = 100;
const REACTION_REASON = 'Reaccion en anuncios';
const REACTION_XP = 5;
const COMBO_REWARD = 100;
const COMBO_REASON = 'Combo diario: 3 misiones completadas';
const COMBO_QUEST_ID = 'daily_combo_bonus';
const COMBO_XP = 50;

const DAILY_QUESTS = Object.freeze({
  reaction: {
    id: 'daily_reactions',
    target: 3,
    increment: 1
  },
  voice: {
    id: 'daily_voice',
    target: 30,
    increment: 10
  },
  invite: {
    id: 'daily_invite',
    target: 1,
    increment: 1
  }
});

const registeredClients = new WeakSet();

const findQuestQuery = db.prepare(`
  SELECT progress, completed
  FROM quests
  WHERE userId = ? AND quest_id = ? AND date = ?
  LIMIT 1
`);

const createQuestQuery = db.prepare(`
  INSERT INTO quests (userId, quest_id, progress, completed, date)
  SELECT ?, ?, 0, 0, ?
  WHERE NOT EXISTS (
    SELECT 1
    FROM quests
    WHERE userId = ? AND quest_id = ? AND date = ?
  )
`);

const updateQuestQuery = db.prepare(`
  UPDATE quests
  SET
    progress = MIN(progress + ?, ?),
    completed = CASE WHEN progress + ? >= ? THEN 1 ELSE completed END
  WHERE userId = ? AND quest_id = ? AND date = ?
`);

const getDailyQuestsQuery = db.prepare(`
  SELECT quest_id, progress, completed, date
  FROM quests
  WHERE userId = ? AND date = ? AND quest_id != ?
  ORDER BY quest_id
`);

const createComboMarkerQuery = db.prepare(`
  INSERT INTO quests (userId, quest_id, progress, completed, date)
  VALUES (?, ?, 1, 1, ?)
`);

const getReactionEarningsQuery = db.prepare(`
  SELECT COALESCE(SUM(amount), 0) AS total
  FROM coin_logs
  WHERE userId = ?
    AND reason = ?
    AND DATE(timestamp) = ?
`);

const claimReactionQuery = db.prepare(`
  INSERT INTO reaction_claims (userId, messageId)
  VALUES (?, ?)
  ON CONFLICT(userId, messageId) DO NOTHING
`);

function currentDate() {
  return new Date().toISOString().slice(0, 10);
}

function normalizeUserId(userId) {
  const value = String(userId || '').trim();
  if (!value) throw new TypeError('userId es obligatorio.');
  return value;
}

function ensureDailyQuests(userId, date) {
  for (const quest of Object.values(DAILY_QUESTS)) {
    createQuestQuery.run(
      userId,
      quest.id,
      date,
      userId,
      quest.id,
      date
    );
  }
}

const checkQuestsTransaction = db.transaction((userId, type) => {
  const normalizedUserId = normalizeUserId(userId);
  const quest = DAILY_QUESTS[type];
  if (!quest) {
    throw new TypeError(`Tipo de mision no valido: ${type}`);
  }

  const date = currentDate();
  getOrCreateUser(normalizedUserId);
  ensureDailyQuests(normalizedUserId, date);

  updateQuestQuery.run(
    quest.increment,
    quest.target,
    quest.increment,
    quest.target,
    normalizedUserId,
    quest.id,
    date
  );

  const quests = getDailyQuestsQuery.all(
    normalizedUserId,
    date,
    COMBO_QUEST_ID
  );
  const allCompleted = Object.values(DAILY_QUESTS).every((definition) => {
    const record = quests.find((item) => item.quest_id === definition.id);
    return record?.completed === 1;
  });

  let comboAwarded = false;
  if (
    allCompleted
    && !findQuestQuery.get(normalizedUserId, COMBO_QUEST_ID, date)
  ) {
    createComboMarkerQuery.run(normalizedUserId, COMBO_QUEST_ID, date);
    addCoins(normalizedUserId, COMBO_REWARD, COMBO_REASON);
    addXp(normalizedUserId, COMBO_XP, 'Combo diario completado');
    comboAwarded = true;
  }

  return {
    date,
    quests,
    comboAwarded
  };
});

function checkQuests(userId, type) {
  return checkQuestsTransaction(userId, type);
}

const rewardReactionTransaction = db.transaction((userId, messageId) => {
  const normalizedUserId = normalizeUserId(userId);
  const normalizedMessageId = String(messageId || '').trim();
  if (!normalizedMessageId) throw new TypeError('messageId es obligatorio.');

  const claim = claimReactionQuery.run(normalizedUserId, normalizedMessageId);
  if (claim.changes !== 1) {
    return { rewarded: false, duplicate: true, earned: null, quest: null };
  }

  const date = currentDate();
  const earned = Number(
    getReactionEarningsQuery.get(normalizedUserId, REACTION_REASON, date).total
  );

  if (earned >= MAX_DAILY_REACTION_REWARD) {
    return { rewarded: false, duplicate: false, earned, quest: null };
  }

  addCoins(normalizedUserId, REACTION_REWARD, REACTION_REASON);
  const xp = addXp(normalizedUserId, REACTION_XP, REACTION_REASON);
  const quest = checkQuests(normalizedUserId, 'reaction');

  return {
    rewarded: true,
    duplicate: false,
    earned: earned + REACTION_REWARD,
    xp,
    quest
  };
});

function parseRewardsStartAt(value) {
  const timestamp = Date.parse(String(value || '').trim());
  if (!Number.isFinite(timestamp)) {
    throw new TypeError('reactionRewardsStartAt no contiene una fecha valida.');
  }
  return timestamp;
}

function isMessageEligible(message, rewardsStartAt) {
  return Number.isFinite(message?.createdTimestamp)
    && message.createdTimestamp >= rewardsStartAt;
}

async function handleReaction(reaction, user, announcementChannelId, rewardsStartAt) {
  if (!announcementChannelId) return;

  if (user.partial) {
    const fetchedUser = await user.fetch().catch(() => null);
    if (!fetchedUser) return;
    user = fetchedUser;
  }
  if (user.bot) return;

  if (reaction.partial) {
    const fetchedReaction = await reaction.fetch().catch(() => null);
    if (!fetchedReaction) return;
    reaction = fetchedReaction;
  }
  if (reaction.message.partial) {
    const fetchedMessage = await reaction.message.fetch().catch(() => null);
    if (!fetchedMessage) return;
  }

  if (reaction.message.channelId !== announcementChannelId) return;
  if (!isMessageEligible(reaction.message, rewardsStartAt)) return;

  const result = rewardReactionTransaction(user.id, reaction.message.id);
  if (result.quest?.comboAwarded) {
    console.log(`Combo diario otorgado a ${user.id}: +${COMBO_REWARD} ZCoins.`);
  }
}

function register(client) {
  if (registeredClients.has(client)) return;
  registeredClients.add(client);

  const announcementChannelId = String(
    process.env.ANNOUNCEMENTS_CHANNEL_ID
      || config.announcementChannelId
      || ''
  ).trim();
  const rewardsStartAt = parseRewardsStartAt(
    process.env.REACTION_REWARDS_START_AT
      || config.reactionRewardsStartAt
      || '2026-07-02T00:00:00-04:00'
  );

  client.on(Events.MessageReactionAdd, (reaction, user) => {
    handleReaction(reaction, user, announcementChannelId, rewardsStartAt).catch((error) => {
      console.error('Error procesando reaccion de anuncios:', error);
    });
  });

  client.once(Events.ClientReady, () => {
    if (!announcementChannelId) {
      console.warn('Recompensas de reacciones desactivadas: falta announcementChannelId.');
    }
  });
}

module.exports = {
  name: Events.MessageReactionAdd,
  register,
  checkQuests,
  DAILY_QUESTS,
  rewardReactionTransaction,
  parseRewardsStartAt,
  isMessageEligible
};
