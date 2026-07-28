const { EmbedBuilder } = require('discord.js');

const GITHUB_API_BASE = 'https://api.github.com';
const DEFAULT_CHECK_MINUTES = 10;
const DEFAULT_REPOSITORY = 'CeroCee/zentux-updates';

const DEFAULT_PRODUCTS = [
  {
    id: 'zentux-optimizer',
    name: 'Zentux Optimizer',
    repository: 'CeroCee/zentux-updates',
    icon: 'Optimizer',
    color: 0xec4899,
    assetPattern: /zentuxoptimizer.*\.exe$/i,
    noteHeadings: ['zentux optimizer', 'optimizer', 'optimizador']
  },
  {
    id: 'zentux-v7',
    name: 'Zentux v7',
    repository: 'CeroCee/zentux-releases1',
    icon: 'v7',
    color: 0xef4444,
    assetPattern: /zentux[._ -]?v7.*\.exe$/i,
    noteHeadings: ['zentux v7', 'v7', 'autoclicker']
  }
];

function normalizeRepository(value) {
  const raw = String(value || '').trim();
  if (!raw) return DEFAULT_REPOSITORY;
  const githubUrlMatch = raw.match(/github\.com\/([^/\s]+)\/([^/\s#?]+)/i);
  if (githubUrlMatch) return `${githubUrlMatch[1]}/${githubUrlMatch[2].replace(/\.git$/i, '')}`;
  return raw.replace(/^\/+|\/+$/g, '').replace(/\.git$/i, '');
}

function buildAssetPattern(value, fallback) {
  if (!value) return fallback;
  if (value instanceof RegExp) return value;

  try {
    return new RegExp(String(value), 'i');
  } catch {
    return fallback;
  }
}

function resolveAnnouncementChannelId(config) {
  return String(
    process.env.UPDATE_ANNOUNCEMENT_CHANNEL_ID
      || config.updateAnnouncementChannelId
      || config.announcementChannelId
      || ''
  ).trim();
}

function resolveProducts(releaseConfig = {}) {
  const configuredProducts = Array.isArray(releaseConfig.products) && releaseConfig.products.length
    ? releaseConfig.products
    : DEFAULT_PRODUCTS;

  return configuredProducts
    .map((configuredProduct) => {
      const defaultProduct = DEFAULT_PRODUCTS.find((product) => product.id === configuredProduct.id) || {};
      const envRepositoryKey = configuredProduct.id === 'zentux-optimizer'
        ? 'UPDATE_OPTIMIZER_REPOSITORY'
        : configuredProduct.id === 'zentux-v7'
          ? 'UPDATE_V7_REPOSITORY'
          : '';

      return {
        ...defaultProduct,
        ...configuredProduct,
        repository: normalizeRepository(
          (envRepositoryKey && process.env[envRepositoryKey])
            || configuredProduct.repository
            || defaultProduct.repository
            || releaseConfig.repository
            || DEFAULT_REPOSITORY
        ),
        assetPattern: buildAssetPattern(configuredProduct.assetPattern, defaultProduct.assetPattern || /.*/i),
        noteHeadings: configuredProduct.noteHeadings || defaultProduct.noteHeadings || []
      };
    })
    .filter((product) => product.id && product.name && product.repository);
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
  const products = resolveProducts({ ...releaseConfig, repository });

  return {
    enabled,
    repository,
    channelId,
    checkMinutes,
    announceLatestOnBoot,
    announcementBatchId,
    products
  };
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

async function fetchLatestReleaseCached(repository, cache) {
  if (!cache.has(repository)) {
    cache.set(repository, fetchLatestRelease(repository));
  }
  return cache.get(repository);
}

function findProductAsset(release, product) {
  const assets = Array.isArray(release?.assets) ? release.assets : [];
  return assets.find((asset) => product.assetPattern.test(asset.name || '')) || assets[0] || null;
}

function buildFingerprint(release, asset) {
  return [
    release.id,
    release.tag_name,
    release.published_at,
    asset?.id,
    asset?.name,
    asset?.size,
    asset?.updated_at
  ].map((part) => String(part || '')).join('|');
}

function normalizeHeading(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[*_`#>:-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isGenericReleaseLine(line) {
  const normalized = normalizeHeading(String(line || '').replace(/^[-*]\s+/, ''));
  if (!normalized) return true;
  return [
    'initial public release for zentux apps',
    'included',
    'zentuxoptimizer pro',
    'zentux optimizer pro',
    'zentux autoclicker',
    'one active zentux license unlocks all supported zentux products'
  ].some((genericLine) => normalized === genericLine);
}

function cleanReleaseNotes(notes) {
  const usefulLines = String(notes || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => !isGenericReleaseLine(line));

  const cleaned = usefulLines.join('\n').trim();
  if (!cleaned) {
    return 'No hay notas detalladas publicadas para esta actualizacion todavia. Abre la app y entra en **Actualizaciones** para instalar el build mas reciente.';
  }

  return cleaned.slice(0, 1000);
}

function extractProductNotes(releaseBody, product) {
  const body = String(releaseBody || '').trim();
  if (!body) {
    return 'Abre la app y entra en **Actualizaciones** para instalar esta nueva version desde el updater interno.';
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
    if (section) return cleanReleaseNotes(section);
  }

  return cleanReleaseNotes(body);
}

function buildReleaseEmbed({ product, release, asset }) {
  const updatedAt = asset?.updated_at || release.published_at;
  const updatedAtTimestamp = updatedAt ? Math.floor(new Date(updatedAt).getTime() / 1000) : null;
  const notes = extractProductNotes(release.body, product);
  const versionLabel = release.name || release.tag_name || 'latest';

  return new EmbedBuilder()
    .setColor(product.color)
    .setTitle(`${product.icon} | Nueva actualizacion de ${product.name}`)
    .setDescription(
      [
        `Ya esta disponible una nueva actualizacion de **${product.name}**.`,
        'Puedes instalarla directamente desde el panel de **Actualizaciones** dentro de la app.',
        '',
        `**Version:** \`${versionLabel}\``,
        release.tag_name ? `**Tag:** \`${release.tag_name}\`` : null,
        asset?.name ? `**Build detectado:** \`${asset.name}\`` : null,
        updatedAtTimestamp ? `**Publicado:** <t:${updatedAtTimestamp}:R>` : null
      ].filter(Boolean).join('\n')
    )
    .addFields({
      name: 'Mejoras y cambios',
      value: notes
    })
    .setFooter({ text: 'Zentux Updates | Actualiza desde la app oficial' })
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

  const channel = await client.channels.fetch(releaseConfig.channelId).catch(() => null);
  if (!channel?.isTextBased?.()) return { checked: false, reason: 'invalid_channel' };

  const releaseCache = new Map();
  let announced = 0;
  let tracked = 0;

  for (const product of releaseConfig.products) {
    const release = await fetchLatestReleaseCached(product.repository, releaseCache);
    const asset = findProductAsset(release, product);

    tracked += 1;
    const settingKey = `release_monitor:${product.repository}:${product.id}`;
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

  return { checked: true, tracked, announced };
}

async function announceLatestReleaseOnce(client, { config, database } = {}) {
  const releaseConfig = getReleaseConfig(config);
  if (!releaseConfig.enabled || !releaseConfig.announceLatestOnBoot) {
    return { checked: false, reason: 'manual_announce_disabled' };
  }
  if (!releaseConfig.channelId) return { checked: false, reason: 'missing_channel' };

  const channel = await client.channels.fetch(releaseConfig.channelId).catch(() => null);
  if (!channel?.isTextBased?.()) return { checked: false, reason: 'invalid_channel' };

  const releaseCache = new Map();
  let announced = 0;
  let tracked = 0;

  for (const product of releaseConfig.products) {
    const release = await fetchLatestReleaseCached(product.repository, releaseCache);
    const asset = findProductAsset(release, product);

    tracked += 1;
    const fingerprint = buildFingerprint(release, asset);
    const manualKey = `release_monitor:manual:${releaseConfig.announcementBatchId}:${product.repository}:${releaseConfig.channelId}:${product.id}`;
    const regularKey = `release_monitor:${product.repository}:${product.id}`;
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

  return { checked: true, tracked, announced };
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

  const productSummary = releaseConfig.products
    .map((product) => `${product.name}=${product.repository}`)
    .join(', ');

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
    `Monitor de updates activo: ${productSummary}, cada ${releaseConfig.checkMinutes} min.`
  );
  return timer;
}

module.exports = {
  announceLatestReleaseOnce,
  checkReleaseUpdates,
  startReleaseMonitor
};
