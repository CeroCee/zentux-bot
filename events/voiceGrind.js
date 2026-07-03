const { Events } = require('discord.js');
const config = require('../config.json');
const { db, addCoins } = require('../database/db');
const { checkQuests } = require('./reactionsAndQuests');

const CHECK_INTERVAL_MS = 10 * 60 * 1000;
const VOICE_REWARD = 20;
const VOICE_REWARD_REASON = 'Voice Grind: 10 minutos activos';

const eligibleSince = new Map();
const registeredClients = new WeakSet();

const rewardVoiceTransaction = db.transaction((userId) => {
  addCoins(userId, VOICE_REWARD, VOICE_REWARD_REASON);
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

function trackingKey(voiceState) {
  return `${voiceState.guild.id}:${voiceState.id}`;
}

function hasActiveVoiceState(voiceState, allowedChannels) {
  const channel = voiceState?.channel;
  if (!channel || !allowedChannels.has(channel.id)) return false;
  if (channel.id === voiceState.guild.afkChannelId) return false;
  if (voiceState.member?.user?.bot) return false;

  return !voiceState.selfMute
    && !voiceState.serverMute
    && !voiceState.selfDeaf
    && !voiceState.serverDeaf
    && !voiceState.suppress;
}

function isEligible(voiceState, allowedChannels) {
  if (!hasActiveVoiceState(voiceState, allowedChannels)) return false;

  const activeHumans = voiceState.channel.members.filter((member) => (
    member.id !== voiceState.id
    && hasActiveVoiceState(member.voice, allowedChannels)
  ));

  return activeHumans.size >= 1;
}

function refreshChannel(channel, allowedChannels, now = Date.now()) {
  if (!channel?.isVoiceBased() || !allowedChannels.has(channel.id)) return;

  for (const member of channel.members.values()) {
    const key = trackingKey(member.voice);
    if (isEligible(member.voice, allowedChannels)) {
      if (!eligibleSince.has(key)) eligibleSince.set(key, now);
    } else {
      eligibleSince.delete(key);
    }
  }
}

function handleVoiceStateUpdate(oldState, newState, allowedChannels) {
  eligibleSince.delete(trackingKey(oldState));
  refreshChannel(oldState.channel, allowedChannels);
  refreshChannel(newState.channel, allowedChannels);
}

async function fetchAuthorizedChannels(client, allowedChannels) {
  const channels = [];
  for (const channelId of allowedChannels) {
    const channel = client.channels.cache.get(channelId)
      || await client.channels.fetch(channelId).catch(() => null);
    if (channel?.isVoiceBased()) channels.push(channel);
  }
  return channels;
}

async function checkVoiceRewards(client, allowedChannels, now = Date.now()) {
  const channels = await fetchAuthorizedChannels(client, allowedChannels);
  let rewardedUsers = 0;

  for (const channel of channels) {
    refreshChannel(channel, allowedChannels, now);

    for (const member of channel.members.values()) {
      const voiceState = member.voice;
      const key = trackingKey(voiceState);
      const startedAt = eligibleSince.get(key);

      if (!isEligible(voiceState, allowedChannels) || !startedAt) continue;
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

  const allowedChannels = authorizedChannelIds();

  client.on(Events.VoiceStateUpdate, (oldState, newState) => {
    handleVoiceStateUpdate(oldState, newState, allowedChannels);
  });

  client.once(Events.ClientReady, async () => {
    if (allowedChannels.size === 0) {
      console.warn('Voice Grind desactivado: authorizedVoiceChannels esta vacio en config.json.');
      return;
    }

    const channels = await fetchAuthorizedChannels(client, allowedChannels);
    for (const channel of channels) refreshChannel(channel, allowedChannels);

    const timer = setInterval(() => {
      checkVoiceRewards(client, allowedChannels).catch((error) => {
        console.error('Error verificando Voice Grind:', error);
      });
    }, CHECK_INTERVAL_MS);
    timer.unref();

    console.log(`Voice Grind activo en ${channels.length} canal(es).`);
  });
}

module.exports = {
  name: Events.VoiceStateUpdate,
  register,
  checkVoiceRewards,
  isEligible
};
