const { Events } = require('discord.js');
const {
  db,
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

const prepareVoiceReward = db.transaction((userId, minutes = 1) => {
  const normalizedMinutes = Number(minutes);
  if (!Number.isSafeInteger(normalizedMinutes) || normalizedMinutes <= 0) {
    throw new TypeError('Los minutos de voz deben ser un entero positivo.');
  }

  const before = getOrCreateUser(userId);
  const coins = normalizedMinutes * COINS_PER_MINUTE;
  const reason = `Voice Grind: ${normalizedMinutes} minuto(s) en voz`;
  const afterVoice = incrementVoiceMinutes(userId, normalizedMinutes);
  const quest = checkQuests(userId, 'voice', normalizedMinutes);

  const previousXpSteps = Math.floor(before.total_vc_minutes / XP_INTERVAL_MINUTES);
  const currentXpSteps = Math.floor(afterVoice.total_vc_minutes / XP_INTERVAL_MINUTES);
  const xpEarned = currentXpSteps - previousXpSteps;
  if (xpEarned > 0) addXp(userId, xpEarned, reason);

  return {
    coins,
    minutes: normalizedMinutes,
    xpEarned,
    quest,
    user: getOrCreateUser(userId)
  };
});

async function rewardVoiceTransaction(userId, minutes, licenseApi, referenceId) {
  const result = prepareVoiceReward(userId, minutes);
  await licenseApi.economyAdd({
    discordUserId: userId,
    amount: result.coins,
    currency: 'zcoins',
    bucket: 'pocket',
    reason: `Voice Grind: ${result.minutes} minuto(s) en voz`,
    referenceId
  });

  if (result.quest?.comboAwarded) {
    await licenseApi.economyAdd({
      discordUserId: userId,
      amount: 100,
      currency: 'zcoins',
      bucket: 'pocket',
      reason: 'Combo diario: 3 misiones completadas',
      referenceId: `combo:${userId}:${result.quest.date}`
    });
  }

  return result;
}

// Voice Grind es global: cualquier canal de voz o escenario del servidor cuenta.
function isAuthorizedVoiceChannel(channel) {
  return Boolean(channel?.isVoiceBased?.());
}

async function createAuthorizedScope(client) {
  // Conservamos esta funcion por compatibilidad con el modulo anterior, pero
  // ya no se usan listas de canales o categorias permitidas.
  for (const guild of client.guilds.cache.values()) {
    await guild.channels.fetch().catch(() => null);
  }
  return { allVoiceChannels: true };
}

function trackingKey(voiceState) {
  return `${voiceState.guild.id}:${voiceState.id}`;
}

function hasActiveVoiceState(voiceState) {
  if (!voiceState?.guild || !voiceState?.id || !voiceState.channelId) return false;
  if (voiceState.member?.user?.bot) return false;
  return true;
}

function isEligible(voiceState) {
  // Solo se excluyen bots. Solo, muteado, ensordecido y AFK siguen contando.
  return hasActiveVoiceState(voiceState);
}

function getActiveVoiceStates(client) {
  const activeStates = new Map();

  for (const guild of client.guilds.cache.values()) {
    for (const voiceState of guild.voiceStates.cache.values()) {
      if (!isEligible(voiceState)) continue;
      activeStates.set(trackingKey(voiceState), voiceState);
    }

    // Refuerzo para canales temporales: Discord puede poblar channel.members
    // antes que guild.voiceStates durante un reinicio del proceso.
    for (const channel of guild.channels.cache.values()) {
      if (!isAuthorizedVoiceChannel(channel)) continue;
      for (const member of channel.members.values()) {
        if (!isEligible(member.voice)) continue;
        activeStates.set(trackingKey(member.voice), member.voice);
      }
    }
  }

  return activeStates;
}

function seedActiveVoiceSessions(client, now = Date.now()) {
  const activeStates = getActiveVoiceStates(client);
  for (const key of activeStates.keys()) {
    if (!eligibleSince.has(key)) eligibleSince.set(key, now);
  }
  return activeStates.size;
}

async function creditElapsedVoiceTime(voiceState, licenseApi, now = Date.now()) {
  const key = trackingKey(voiceState);
  const startedAt = eligibleSince.get(key);
  if (!startedAt) return null;

  const completedMinutes = Math.floor((now - startedAt) / ONE_MINUTE_MS);
  if (completedMinutes < 1) return null;

  const result = await rewardVoiceTransaction(
    voiceState.id,
    completedMinutes,
    licenseApi,
    `voice:${voiceState.guild.id}:${voiceState.id}:${startedAt}:${completedMinutes}`
  );
  eligibleSince.set(key, startedAt + (completedMinutes * ONE_MINUTE_MS));
  return result;
}

async function handleVoiceStateUpdate(oldState, newState, scope, licenseApi, now = Date.now()) {
  const key = trackingKey(newState);
  const wasEligible = isEligible(oldState, scope);
  const isNowEligible = isEligible(newState, scope);

  if (!wasEligible && isNowEligible) {
    if (!eligibleSince.has(key)) eligibleSince.set(key, now);
    return;
  }

  if (wasEligible && !isNowEligible) {
    try {
      await creditElapsedVoiceTime(oldState, licenseApi, now);
    } catch (error) {
      console.error(`No se pudo cerrar la sesion de voz de ${oldState.id}:`, error.message);
    } finally {
      eligibleSince.delete(key);
    }
  }
}

async function fetchAuthorizedChannels(client) {
  const channels = [];
  for (const guild of client.guilds.cache.values()) {
    await guild.channels.fetch().catch(() => null);
    for (const channel of guild.channels.cache.values()) {
      if (isAuthorizedVoiceChannel(channel)) channels.push(channel);
    }
  }
  return channels;
}

async function checkVoiceRewards(client, scope, now = Date.now()) {
  const activeStates = getActiveVoiceStates(client);
  const activeKeys = new Set(activeStates.keys());
  let rewardedUsers = 0;
  let creditedMinutes = 0;

  for (const [key, voiceState] of activeStates) {
    if (!eligibleSince.has(key)) eligibleSince.set(key, now);

    try {
      const result = await creditElapsedVoiceTime(voiceState, client.licenseApi, now);
      if (!result) continue;
      rewardedUsers += 1;
      creditedMinutes += result.minutes;
    } catch (error) {
      console.error(`No se pudieron acreditar ZCoins a ${voiceState.id}:`, error.message);
    }
  }

  for (const key of eligibleSince.keys()) {
    if (!activeKeys.has(key)) eligibleSince.delete(key);
  }

  if (rewardedUsers > 0) {
    const creditedCoins = (creditedMinutes * COINS_PER_MINUTE).toFixed(2);
    console.log(
      `Voice Grind global: ${rewardedUsers} usuario(s), ${creditedMinutes} minuto(s), +${creditedCoins} ZCoins.`
    );
  }

  return rewardedUsers;
}

function register(client) {
  if (registeredClients.has(client)) return;
  registeredClients.add(client);

  const scope = { allVoiceChannels: true };
  let rewardCheckRunning = false;

  client.on(Events.VoiceStateUpdate, (oldState, newState) => {
    handleVoiceStateUpdate(oldState, newState, scope, client.licenseApi).catch((error) => {
      console.error('No se pudo procesar una sesion de voz:', error.message);
    });
  });

  client.once(Events.ClientReady, async () => {
    await createAuthorizedScope(client);
    const channels = await fetchAuthorizedChannels(client);
    const seededUsers = seedActiveVoiceSessions(client);

    const timer = setInterval(() => {
      if (rewardCheckRunning) return;
      rewardCheckRunning = true;
      checkVoiceRewards(client, scope)
        .catch((error) => console.error('Error verificando Voice Grind:', error))
        .finally(() => {
          rewardCheckRunning = false;
        });
    }, CHECK_INTERVAL_MS);
    timer.unref();

    console.log(
      `Voice Grind global activo en ${channels.length} canal(es); ${seededUsers} usuario(s) detectados al iniciar.`
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
  rewardVoiceTransaction,
  seedActiveVoiceSessions,
  getActiveVoiceStates
};
