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
    members: () => request('/api/discord/members'),
    logSettings: (guildId) => request('/api/discord/log-settings', { guildId }),
    setLogChannel: (payload) => request('/api/discord/log-settings/set', payload),
    infoAccess: (guildId, discordUserId) => request('/api/discord/info-access/check', { guildId, discordUserId }),
    setInfoAccess: (payload) => request('/api/discord/info-access/set', payload),
    pendingPurchases: (guildId) => request('/api/discord/purchases/pending', { guildId }),
    acknowledgePurchases: (guildId, licenseKeys) => request('/api/discord/purchases/ack', { guildId, licenseKeys })
  };
}

module.exports = { createLicenseApi, LicenseApiError };
