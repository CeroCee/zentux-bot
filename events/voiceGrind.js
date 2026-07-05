const { Events } = require('discord.js');
const config = require('../config.json');
const { db, addCoins, addXp, incrementVoiceMinutes } = require('../database/db');
const { checkQuests } = require('./reactionsAndQuests');

const VOICE_INTERVAL_MINUTES = 15;
const CHECK_INTERVAL_MS = VOICE_INTERVAL_MINUTES * 60 * 1000;
const VOICE_REWARD = 5;
const VOICE_REWARD_REASON = 'Voice Grind: 15 minutos activos';
const VOICE_XP = 3;

const eligibleSince = new Map();
const registeredClients = new WeakSet();

const rewardVoiceTransaction = db.transaction((userId) => {
  addCoins(userId, VOICE_REWARD, VOICE_REWARD_REASON);
  addXp(userId, VOICE_XP, VOICE_REWARD_REASON);
  incrementVoiceMinutes(userId, VOICE_INTERVAL_MINUTES);
  checkQuests(userId, 'voice');
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

  return scope;
}

function trackingKey(voiceState) {
  return `${voiceState.guild.id}:${voiceState.id}`;
}

function hasActiveVoiceState(voiceState, scope) {
  const channel = voiceState?.channel;
  if (!isAuthorizedVoiceChannel(channel, scope)) return false;
  if (channel.id === voiceState.guild.afkChannelId) return false;
  if (voiceState.member?.user?.bot) return false;

  return !voiceState.selfMute
    && !voiceState.serverMute
    && !voiceState.selfDeaf
    && !voiceState.serverDeaf
    && !voiceState.suppress;
}

function isEligible(voiceState, scope) {
  if (!hasActiveVoiceState(voiceState, scope)) return false;

  const activeHumans = voiceState.channel.members.filter((member) => (
    member.id !== voiceState.id
    && hasActiveVoiceState(member.voice, scope)
  ));

  return activeHumans.size >= 1;
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

function handleVoiceStateUpdate(oldState, newState, scope) {
  eligibleSince.delete(trackingKey(oldState));
  refreshChannel(oldState.channel, scope);
  refreshChannel(newState.channel, scope);
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
  let rewardedUsers = 0;

  for (const channel of channels) {
    refreshChannel(channel, scope, now);

    for (const member of channel.members.values()) {
      const voiceState = member.voice;
      const key = trackingKey(voiceState);
      const startedAt = eligibleSince.get(key);

      if (!isEligible(voiceState, scope) || !startedAt) continue;
      if (now - startedAt < CHECK_INTERVAL_MS) continue;

      try {
        rewardVoiceTransaction(member.id);
        eligibleSince.set(key, now);
        rewardedUsers += 1;
      } catch (error) {
        console.error(`No se pudieron acreditar ZCoins a ${member.id}:`, error.message);
      }
    }
  }

  if (rewardedUsers > 0) {
    console.log(`Voice Grind: ${rewardedUsers} usuario(s) recibieron +${VOICE_REWARD} ZCoins.`);
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
  isEligible,
  isAuthorizedVoiceChannel,
  createAuthorizedScope,
  rewardVoiceTransaction
};
