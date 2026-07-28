const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');

const GITHUB_API_BASE = 'https://api.github.com';
const DEFAULT_REPOSITORY = 'CeroCee/CeroCee-zentuxoptimizer-releases';
const DEFAULT_CHECK_MINUTES = 10;
const PRODUCT_DEFINITIONS = [
  {
    id: 'zentux-v7',
    name: 'Zentux v7',
    emoji: '🖱️',
    color: 0xef4444,
    assetPattern: /zentux[._ -]?v7.*\.exe$/i
  },
  {
    id: 'zentux-optimizer',
    name: 'Zentux Optimizer',
    emoji: '⚡',
    color: 0xec4899,
    assetPattern: /zentux[._ -]?optimizer.*\.exe$/i
  }
];

function normalizeRepository(value) {
  const raw = String(value || '').trim();
  if (!raw) return DEFAULT_REPOSITORY;
  const githubUrlMatch = raw.match(/github\.com\/([^/\s]+)\/([^/\s#?]+)/i);
  if (githubUrlMatch) return `${githubUrlMatch[1]}/${githubUrlMatch[2].replace(/\.git$/i, '')}`;
  return raw.replace(/^\/+|\/+$/g, '').replace(/\.git$/i, '');
}

function resolveAnnouncementChannelId(config) {
  return String(
    process.env.UPDATE_ANNOUNCEMENT_CHANNEL_ID
      || config.updateAnnouncementChannelId
      || config.announcementChannelId
      || ''
  ).trim();
}

function getReleaseConfig(config = {}) {
  const releaseConfig = config.releaseAnnouncements || {};
  const repository = normalizeRepository(
    process.env.UPDATE_GITHUB_REPOSITORY
      || releaseConfig.repository
      || DEFAULT_REPOSITORY
  );
  const channelId = resolveAnnouncementChannelId(config);
  const checkMinutes = Math.max(
    1,
    Number.parseInt(process.env.UPDATE_CHECK_MINUTES || releaseConfig.checkMinutes || DEFAULT_CHECK_MINUTES, 10)
      || DEFAULT_CHECK_MINUTES
  );
  const enabled = String(
    process.env.UPDATE_MONITOR_ENABLED
      || releaseConfig.enabled
      || 'true'
  ).toLowerCase() !== 'false';
  const announceLatestOnBoot = String(
    process.env.UPDATE_ANNOUNCE_LATEST_ON_BOOT
      || releaseConfig.announceLatestOnBoot
      || 'false'
  ).toLowerCase() === 'true';

  return { enabled, repository, channelId, checkMinutes, announceLatestOnBoot };
}

async function fetchLatestRelease(repository) {
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'Zentux-Discord-Bot'
  };
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }

  const response = await fetch(`${GITHUB_API_BASE}/repos/${repository}/releases/latest`, { headers });
  if (response.status === 404) {
    throw new Error(`No se encontro un latest release en ${repository}.`);
  }
  if (!response.ok) {
    const details = await response.text().catch(() => '');
    throw new Error(`GitHub respondio ${response.status}: ${details.slice(0, 200)}`);
  }

  return response.json();
}

function findProductAsset(release, product) {
  const assets = Array.isArray(release?.assets) ? release.assets : [];
  return assets.find((asset) => product.assetPattern.test(asset.name || '')) || null;
}

function buildFingerprint(release, asset) {
  return [
    release.id,
    release.tag_name,
    release.published_at,
    asset.id,
    asset.name,
    asset.size,
    asset.updated_at
  ].map((part) => String(part || '')).join('|');
}

function formatFileSize(bytes) {
  const size = Number(bytes);
  if (!Number.isFinite(size) || size <= 0) return 'N/A';
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function buildReleaseEmbed({ product, release, asset }) {
  const releaseUrl = release.html_url || `https://github.com/${DEFAULT_REPOSITORY}/releases/latest`;
  const downloadUrl = asset.browser_download_url || releaseUrl;
  const publishedAt = release.published_at ? Math.floor(new Date(release.published_at).getTime() / 1000) : null;

  const embed = new EmbedBuilder()
    .setColor(product.color)
    .setTitle(`${product.emoji} Nueva actualización de ${product.name}`)
    .setDescription(
      [
        `Ya está disponible una nueva versión de **${product.name}**.`,
        '',
        `**Versión:** \`${release.tag_name || release.name || 'latest'}\``,
        `**Archivo:** \`${asset.name}\``,
        `**Tamaño:** ${formatFileSize(asset.size)}`,
        publishedAt ? `**Publicado:** <t:${publishedAt}:R>` : null
      ].filter(Boolean).join('\n')
    )
    .setFooter({ text: 'Zentux Updates • Descarga siempre desde fuentes oficiales' })
    .setTimestamp(new Date());

  if (release.body) {
    const notes = String(release.body).trim().slice(0, 900);
    if (notes) embed.addFields({ name: 'Notas del release', value: notes });
  }

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setStyle(ButtonStyle.Link)
      .setLabel('Descargar actualización')
      .setEmoji('⬇️')
      .setURL(downloadUrl),
    new ButtonBuilder()
      .setStyle(ButtonStyle.Link)
      .setLabel('Ver release')
      .setEmoji('🔗')
      .setURL(releaseUrl)
  );

  return { embed, row };
}

async function checkReleaseUpdates(client, { config, database, silent = false } = {}) {
  const releaseConfig = getReleaseConfig(config);
  if (!releaseConfig.enabled) return { checked: false, reason: 'disabled' };
  if (!releaseConfig.channelId) return { checked: false, reason: 'missing_channel' };

  const release = await fetchLatestRelease(releaseConfig.repository);
  const channel = await client.channels.fetch(releaseConfig.channelId).catch(() => null);
  if (!channel?.isTextBased?.()) return { checked: false, reason: 'invalid_channel' };

  let announced = 0;
  let tracked = 0;

  for (const product of PRODUCT_DEFINITIONS) {
    const asset = findProductAsset(release, product);
    if (!asset) continue;

    tracked += 1;
    const settingKey = `release_monitor:${releaseConfig.repository}:${product.id}`;
    const fingerprint = buildFingerprint(release, asset);
    const previousFingerprint = database.getSetting(settingKey);

    if (!previousFingerprint) {
      database.setSetting(settingKey, fingerprint);
      continue;
    }

    if (previousFingerprint === fingerprint) {
      continue;
    }

    database.setSetting(settingKey, fingerprint);
    if (silent) continue;

    const { embed, row } = buildReleaseEmbed({ product, release, asset });
    await channel.send({ embeds: [embed], components: [row] });
    announced += 1;
  }

  return { checked: true, repository: releaseConfig.repository, tracked, announced };
}

async function announceLatestReleaseOnce(client, { config, database } = {}) {
  const releaseConfig = getReleaseConfig(config);
  if (!releaseConfig.enabled || !releaseConfig.announceLatestOnBoot) {
    return { checked: false, reason: 'manual_announce_disabled' };
  }
  if (!releaseConfig.channelId) return { checked: false, reason: 'missing_channel' };

  const release = await fetchLatestRelease(releaseConfig.repository);
  const channel = await client.channels.fetch(releaseConfig.channelId).catch(() => null);
  if (!channel?.isTextBased?.()) return { checked: false, reason: 'invalid_channel' };

  let announced = 0;
  let tracked = 0;

  for (const product of PRODUCT_DEFINITIONS) {
    const asset = findProductAsset(release, product);
    if (!asset) continue;

    tracked += 1;
    const fingerprint = buildFingerprint(release, asset);
    const manualKey = `release_monitor:manual:${releaseConfig.repository}:${releaseConfig.channelId}:${product.id}`;
    const regularKey = `release_monitor:${releaseConfig.repository}:${product.id}`;
    const previousManualFingerprint = database.getSetting(manualKey);

    if (previousManualFingerprint === fingerprint) {
      database.setSetting(regularKey, fingerprint);
      continue;
    }

    const { embed, row } = buildReleaseEmbed({ product, release, asset });
    await channel.send({ embeds: [embed], components: [row] });
    database.setSetting(manualKey, fingerprint);
    database.setSetting(regularKey, fingerprint);
    announced += 1;
  }

  return { checked: true, repository: releaseConfig.repository, tracked, announced };
}

function startReleaseMonitor(client, { config, database }) {
  const releaseConfig = getReleaseConfig(config);
  if (!releaseConfig.enabled) {
    console.log('Monitor de updates desactivado.');
    return null;
  }
  if (!releaseConfig.channelId) {
    console.warn('Monitor de updates desactivado: falta UPDATE_ANNOUNCEMENT_CHANNEL_ID o config.updateAnnouncementChannelId.');
    return null;
  }

  const runCheck = (silent = false) => {
    checkReleaseUpdates(client, { config, database, silent }).then((result) => {
      if (result.checked) {
        console.log(
          `Monitor de updates: ${result.tracked} app(s) revisada(s), ${result.announced} anuncio(s).`
        );
      } else {
        console.warn(`Monitor de updates omitido: ${result.reason}.`);
      }
    }).catch((error) => {
      console.error('No se pudo revisar GitHub Releases:', error.message);
    });
  };

  if (releaseConfig.announceLatestOnBoot) {
    announceLatestReleaseOnce(client, { config, database }).then((result) => {
      if (result.checked) {
        console.log(
          `Anuncio manual de updates: ${result.tracked} app(s) revisada(s), ${result.announced} anuncio(s).`
        );
      } else {
        console.warn(`Anuncio manual de updates omitido: ${result.reason}.`);
      }
    }).catch((error) => {
      console.error('No se pudo enviar el anuncio manual de updates:', error.message);
    });
  }

  runCheck(false);
  const timer = setInterval(runCheck, releaseConfig.checkMinutes * 60 * 1000);
  timer.unref();
  console.log(
    `Monitor de updates activo: repo=${releaseConfig.repository}, cada ${releaseConfig.checkMinutes} min.`
  );
  return timer;
}

module.exports = {
  announceLatestReleaseOnce,
  checkReleaseUpdates,
  startReleaseMonitor
};
