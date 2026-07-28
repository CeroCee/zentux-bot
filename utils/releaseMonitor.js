const { EmbedBuilder } = require('discord.js');

const GITHUB_API_BASE = 'https://api.github.com';
const DEFAULT_REPOSITORY = 'CeroCee/CeroCee-zentuxoptimizer-releases';
const DEFAULT_CHECK_MINUTES = 10;

const PRODUCT_DEFINITIONS = [
  {
    id: 'zentux-v7',
    name: 'Zentux v7',
    emoji: '🖱️',
    color: 0xef4444,
    assetPattern: /zentux[._ -]?v7.*\.exe$/i,
    noteHeadings: ['zentux v7', 'v7', 'autoclicker']
  },
  {
    id: 'zentux-optimizer',
    name: 'Zentux Optimizer',
    emoji: '⚡',
    color: 0xec4899,
    assetPattern: /zentux[._ -]?optimizer.*\.exe$/i,
    noteHeadings: ['zentux optimizer', 'optimizer', 'optimizador']
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
  const announcementBatchId = String(
    process.env.UPDATE_ANNOUNCEMENT_BATCH_ID
      || releaseConfig.announcementBatchId
      || 'default'
  ).trim() || 'default';

  return { enabled, repository, channelId, checkMinutes, announceLatestOnBoot, announcementBatchId };
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
    throw new Error(`No se encontró un latest release en ${repository}.`);
  }
  if (!response.ok) {
    const details = await response.text().catch(() => '');
    throw new Error(`GitHub respondió ${response.status}: ${details.slice(0, 200)}`);
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

function normalizeHeading(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[*_`#>:-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractProductNotes(releaseBody, product) {
  const body = String(releaseBody || '').trim();
  if (!body) {
    return 'Abre la app y entra en **Actualizaciones** para instalar esta nueva versión desde el updater interno.';
  }

  const lines = body.split(/\r?\n/);
  const headingIndexes = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!/^\s{0,3}#{1,6}\s+/.test(line)) continue;
    headingIndexes.push({
      index,
      heading: normalizeHeading(line.replace(/^\s{0,3}#{1,6}\s+/, ''))
    });
  }

  const matchedHeading = headingIndexes.find((entry) => (
    product.noteHeadings.some((heading) => entry.heading.includes(heading))
  ));

  if (matchedHeading) {
    const nextHeading = headingIndexes.find((entry) => entry.index > matchedHeading.index);
    const section = lines
      .slice(matchedHeading.index + 1, nextHeading ? nextHeading.index : undefined)
      .join('\n')
      .trim();
    if (section) return section.slice(0, 1000);
  }

  return body.slice(0, 1000);
}

function buildReleaseEmbed({ product, release, asset }) {
  const updatedAt = asset.updated_at || release.published_at;
  const updatedAtTimestamp = updatedAt ? Math.floor(new Date(updatedAt).getTime() / 1000) : null;
  const notes = extractProductNotes(release.body, product);

  return new EmbedBuilder()
    .setColor(product.color)
    .setTitle(`${product.emoji} Nueva actualización de ${product.name}`)
    .setDescription(
      [
        `Ya está disponible una nueva actualización de **${product.name}**.`,
        'Puedes instalarla directamente desde el panel de **Actualizaciones** dentro de la app.',
        '',
        `**Versión:** \`${release.tag_name || release.name || 'latest'}\``,
        `**Build detectado:** \`${asset.name}\``,
        updatedAtTimestamp ? `**Último build:** <t:${updatedAtTimestamp}:R>` : null
      ].filter(Boolean).join('\n')
    )
    .addFields({
      name: 'Mejoras y cambios',
      value: notes
    })
    .setFooter({ text: 'Zentux Updates • Actualiza desde la app oficial' })
    .setTimestamp(new Date());
}

async function sendProductAnnouncement({ channel, product, release, asset }) {
  const embed = buildReleaseEmbed({ product, release, asset });
  await channel.send({ embeds: [embed] });
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

    await sendProductAnnouncement({ channel, product, release, asset });
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
    const manualKey = `release_monitor:manual:${releaseConfig.announcementBatchId}:${releaseConfig.repository}:${releaseConfig.channelId}:${product.id}`;
    const regularKey = `release_monitor:${releaseConfig.repository}:${product.id}`;
    const previousManualFingerprint = database.getSetting(manualKey);

    if (previousManualFingerprint === fingerprint) {
      database.setSetting(regularKey, fingerprint);
      continue;
    }

    await sendProductAnnouncement({ channel, product, release, asset });
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
