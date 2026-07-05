const { ChannelType, Events } = require('discord.js');
const config = require('../config.json');
const {
  db,
  addCoins,
  addXp,
  getOrCreateUser,
  incrementVoiceMinutes
} = require('../database/db');
const { checkQuests } = require('./reactionsAndQuests');

const ONE_MINUTE_MS = 60 * 1000;
const CHECK_INTERVAL_MS = ONE_MINUTE_MS;
const COINS_PER_MINUTE = 0.5;
const XP_INTERVAL_MINUTES = 5;

const eligibleSince = new Map();
const registeredClients = new WeakSet();

const rewardVoiceTransaction = db.transaction((userId, minutes = 1) => {
  const normalizedMinutes = Number(minutes);
  if (!Number.isSafeInteger(normalizedMinutes) || normalizedMinutes <= 0) {
    throw new TypeError('Los minutos de voz deben ser un entero positivo.');
  }

  const before = getOrCreateUser(userId);
  const coins = normalizedMinutes * COINS_PER_MINUTE;
  const reason = `Voice Grind: ${normalizedMinutes} minuto(s) en voz`;
  addCoins(userId, coins, reason);
  const afterVoice = incrementVoiceMinutes(userId, normalizedMinutes);
  checkQuests(userId, 'voice', normalizedMinutes);

  const previousXpSteps = Math.floor(before.total_vc_minutes / XP_INTERVAL_MINUTES);
  const currentXpSteps = Math.floor(afterVoice.total_vc_minutes / XP_INTERVAL_MINUTES);
  const xpEarned = currentXpSteps - previousXpSteps;
  if (xpEarned > 0) addXp(userId, xpEarned, reason);

  return {
    coins,
    minutes: normalizedMinutes,
    xpEarned,
    user: getOrCreateUser(userId)
  };
});

function authorizedChannelIds() {
  return new Set(
    (Array.isArray(config.authorizedVoiceChannels)
      ? config.authorizedVoiceChannels
      : [])
      .map((channelId) => String(channelId).trim())
      .filter(Boolean)
  );
}

function configuredCategoryIds() {
  return new Set(
    (Array.isArray(config.authorizedVoiceCategories)
      ? config.authorizedVoiceCategories
      : [])
      .map((categoryId) => String(categoryId).trim())
      .filter(Boolean)
  );
}

function normalizeChannelName(name) {
  return String(name || '').normalize('NFKC').trim().toLowerCase();
}

function configuredCategoryNames() {
  return new Set(
    (Array.isArray(config.authorizedVoiceCategoryNames)
      ? config.authorizedVoiceCategoryNames
      : [])
      .map(normalizeChannelName)
      .filter(Boolean)
  );
}

function isAuthorizedVoiceChannel(channel, scope) {
  if (!channel?.isVoiceBased()) return false;
  return scope.channelIds.has(channel.id)
    || (channel.parentId && scope.categoryIds.has(channel.parentId));
}

async function createAuthorizedScope(client) {
  const scope = {
    channelIds: authorizedChannelIds(),
    categoryIds: configuredCategoryIds()
  };

  // Los canales temporales conservan la categoria del canal "JOIN HERE".
  // Heredamos automaticamente las categorias de los canales configurados para
  // que TempVoice pueda crear y borrar salas sin editar config.json cada vez.
  for (const channelId of scope.channelIds) {
    const channel = client.channels.cache.get(channelId)
      || await client.channels.fetch(channelId).catch(() => null);
    if (channel?.isVoiceBased() && channel.parentId) {
      scope.categoryIds.add(channel.parentId);
    }
  }

  const categoryNames = configuredCategoryNames();
  if (categoryNames.size > 0) {
    for (const guild of client.guilds.cache.values()) {
      const guildChannels = await guild.channels.fetch().catch(() => guild.channels.cache);
      for (const channel of guildChannels.values()) {
        if (
          channel?.type === ChannelType.GuildCategory
          && categoryNames.has(normalizeChannelName(channel.name))
        ) {
          scope.categoryIds.add(channel.id);
        }
      }
    }
  }

  return scope;
}

function trackingKey(voiceState) {
  return `${voiceState.guild.id}:${voiceState.id}`;
}

function hasActiveVoiceState(voiceState, scope) {
  const channel = voiceState?.channel;
  if (!isAuthorizedVoiceChannel(channel, scope)) return false;
  if (voiceState.member?.user?.bot) return false;
  return true;
}

function isEligible(voiceState, scope) {
  return hasActiveVoiceState(voiceState, scope);
}

function refreshChannel(channel, scope, now = Date.now()) {
  if (!isAuthorizedVoiceChannel(channel, scope)) return;

  for (const member of channel.members.values()) {
    const key = trackingKey(member.voice);
    if (isEligible(member.voice, scope)) {
      if (!eligibleSince.has(key)) eligibleSince.set(key, now);
    } else {
      eligibleSince.delete(key);
    }
  }
}

function creditElapsedVoiceTime(voiceState, now = Date.now()) {
  const key = trackingKey(voiceState);
  const startedAt = eligibleSince.get(key);
  if (!startedAt) return null;

  const completedMinutes = Math.floor((now - startedAt) / ONE_MINUTE_MS);
  if (completedMinutes < 1) return null;

  const result = rewardVoiceTransaction(voiceState.id, completedMinutes);
  eligibleSince.set(key, startedAt + (completedMinutes * ONE_MINUTE_MS));
  return result;
}

function handleVoiceStateUpdate(oldState, newState, scope, now = Date.now()) {
  const key = trackingKey(newState);
  const wasEligible = isEligible(oldState, scope);
  const isNowEligible = isEligible(newState, scope);

  if (!wasEligible && isNowEligible) {
    if (!eligibleSince.has(key)) eligibleSince.set(key, now);
    return;
  }

  if (wasEligible && !isNowEligible) {
    try {
      creditElapsedVoiceTime(oldState, now);
    } catch (error) {
      console.error(`No se pudo cerrar la sesion de voz de ${oldState.id}:`, error.message);
    } finally {
      eligibleSince.delete(key);
    }
  }
}

async function fetchAuthorizedChannels(client, scope) {
  const channels = new Map();

  for (const guild of client.guilds.cache.values()) {
    const guildChannels = await guild.channels.fetch().catch(() => guild.channels.cache);
    for (const channel of guildChannels.values()) {
      if (isAuthorizedVoiceChannel(channel, scope)) channels.set(channel.id, channel);
    }
  }

  return [...channels.values()];
}

async function checkVoiceRewards(client, scope, now = Date.now()) {
  const channels = await fetchAuthorizedChannels(client, scope);
  const activeKeys = new Set();
  let rewardedUsers = 0;
  let creditedMinutes = 0;

  for (const channel of channels) {
    refreshChannel(channel, scope, now);

    for (const member of channel.members.values()) {
      const voiceState = member.voice;
      const key = trackingKey(voiceState);
      if (!isEligible(voiceState, scope)) continue;
      activeKeys.add(key);

      try {
        const result = creditElapsedVoiceTime(voiceState, now);
        if (!result) continue;
        rewardedUsers += 1;
        creditedMinutes += result.minutes;
      } catch (error) {
        console.error(`No se pudieron acreditar ZCoins a ${member.id}:`, error.message);
      }
    }
  }

  for (const key of eligibleSince.keys()) {
    if (!activeKeys.has(key)) eligibleSince.delete(key);
  }

  if (rewardedUsers > 0) {
    const creditedCoins = (creditedMinutes * COINS_PER_MINUTE).toFixed(2);
    console.log(
      `Voice Grind: ${rewardedUsers} usuario(s), ${creditedMinutes} minuto(s), +${creditedCoins} ZCoins.`
    );
  }

  return rewardedUsers;
}

function register(client) {
  if (registeredClients.has(client)) return;
  registeredClients.add(client);

  let scope = {
    channelIds: authorizedChannelIds(),
    categoryIds: configuredCategoryIds()
  };

  client.on(Events.VoiceStateUpdate, (oldState, newState) => {
    handleVoiceStateUpdate(oldState, newState, scope);
  });

  client.once(Events.ClientReady, async () => {
    scope = await createAuthorizedScope(client);
    if (scope.channelIds.size === 0 && scope.categoryIds.size === 0) {
      console.warn('Voice Grind desactivado: no hay canales ni categorias autorizadas en config.json.');
      return;
    }

    const channels = await fetchAuthorizedChannels(client, scope);
    for (const channel of channels) refreshChannel(channel, scope);

    const timer = setInterval(() => {
      checkVoiceRewards(client, scope).catch((error) => {
        console.error('Error verificando Voice Grind:', error);
      });
    }, CHECK_INTERVAL_MS);
    timer.unref();

    console.log(
      `Voice Grind activo en ${channels.length} canal(es) de ${scope.categoryIds.size} categoria(s).`
    );
  });
}

module.exports = {
  name: Events.VoiceStateUpdate,
  register,
  checkVoiceRewards,
  creditElapsedVoiceTime,
  isEligible,
  isAuthorizedVoiceChannel,
  createAuthorizedScope,
  rewardVoiceTransaction
};
