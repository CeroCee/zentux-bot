class LicenseApiError extends Error {
  constructor(message, code, status) {
    super(message);
    this.name = 'LicenseApiError';
    this.code = code;
    this.status = status;
  }
}

function createLicenseApi({ baseUrl, secret }) {
  const normalizedBaseUrl = String(baseUrl || '').replace(/\/+$/, '');

  async function request(path, body = {}) {
    let response;
    try {
      response = await fetch(`${normalizedBaseUrl}${path}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-discord-secret': secret
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15000)
      });
    } catch (error) {
      throw new LicenseApiError('El servidor de licencias no esta disponible.', 'unavailable', 503);
    }

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new LicenseApiError(
        data.error || 'No se pudo consultar la licencia.',
        data.code || 'request_failed',
        response.status
      );
    }
    return data;
  }

  return {
    redeem: (payload) => request('/api/discord/redeem', payload),
    info: (discordUserId) => request('/api/discord/info', { discordUserId }),
    purchaseShop: (payload) => request('/api/discord/shop/purchase', payload),
    economyUser: (payload) => request('/api/economy/user', payload),
    economyMigrate: (users) => request('/api/economy/migrate', { users, source: 'discord-sqlite-v1' }),
    economyAdd: (payload) => request('/api/economy/add', payload),
    economyBank: (payload) => request('/api/economy/bank', payload),
    economyTransfer: (payload) => request('/api/economy/transfer', payload),
    economyRob: (payload) => request('/api/economy/rob', payload),
    economyBetCreate: (payload) => request('/api/economy/bet/create', payload),
    economyBetAccept: (payload) => request('/api/economy/bet/accept', payload),
    economyBetDecline: (payload) => request('/api/economy/bet/decline', payload),
    economyBetCancel: (payload) => request('/api/economy/bet/cancel', payload),
    economyBetExpire: () => request('/api/economy/bet/expire', {}),
    economyLeaderboard: (limit = 10) => request('/api/economy/leaderboard', { limit }),
    releaseDevice: (discordUserId) => request('/api/discord/release-device', { discordUserId }),
    members: () => request('/api/discord/members'),
    logSettings: (guildId) => request('/api/discord/log-settings', { guildId }),
    setLogChannel: (payload) => request('/api/discord/log-settings/set', payload),
    infoAccess: (guildId, discordUserId) => request('/api/discord/info-access/check', { guildId, discordUserId }),
    setInfoAccess: (payload) => request('/api/discord/info-access/set', payload),
    releaseAccess: (guildId, discordUserId) => request('/api/discord/release-access/check', { guildId, discordUserId }),
    setReleaseAccess: (payload) => request('/api/discord/release-access/set', payload),
    pendingPurchases: (guildId) => request('/api/discord/purchases/pending', { guildId }),
    acknowledgePurchases: (guildId, licenseKeys) => request('/api/discord/purchases/ack', { guildId, licenseKeys }),
    pendingLicenseEvents: (guildId) => request('/api/discord/license-events/pending', { guildId }),
    acknowledgeLicenseEvents: (guildId, eventIds) => request('/api/discord/license-events/ack', { guildId, eventIds }),
    deleteLicenses: (payload) => request('/api/discord/licenses/delete', payload),
    generateGiveaway: (payload) => request('/api/discord/generate-giveaway', payload),
    createContentCreator: (payload) => request('/api/discord/content/create', payload),
    contentCreators: (guildId) => request('/api/discord/content/active', { guildId }),
    deactivateContentCreator: (guildId, discordUserId) => request('/api/discord/content/deactivate', { guildId, discordUserId }),
    createSignedPlayer: (payload) => request('/api/discord/signed-player/create', payload),
    signedPlayers: (guildId) => request('/api/discord/signed-player/active', { guildId }),
    deactivateSignedPlayer: (guildId, discordUserId) => request('/api/discord/signed-player/deactivate', { guildId, discordUserId })
  };
}

module.exports = { createLicenseApi, LicenseApiError };
