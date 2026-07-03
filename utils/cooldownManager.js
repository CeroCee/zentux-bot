const { db } = require('../database/db');

db.exec(`
  CREATE TABLE IF NOT EXISTS command_cooldowns (
    userId TEXT NOT NULL,
    commandName TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    PRIMARY KEY (userId, commandName)
  );

  CREATE INDEX IF NOT EXISTS idx_command_cooldowns_expiry
  ON command_cooldowns (expires_at);
`);

const legacyRobTable = db.prepare(`
  SELECT 1
  FROM sqlite_master
  WHERE type = 'table' AND name = 'rob_cooldowns'
`).get();

if (legacyRobTable) {
  db.prepare(`
    INSERT OR IGNORE INTO command_cooldowns (userId, commandName, expires_at)
    SELECT userId, 'rob', (CAST(strftime('%s', last_rob_at) AS INTEGER) * 1000) + ?
    FROM rob_cooldowns
    WHERE (CAST(strftime('%s', last_rob_at) AS INTEGER) * 1000) + ? > ?
  `).run(2 * 60 * 60 * 1000, 2 * 60 * 60 * 1000, Date.now());
  db.exec('DROP TABLE rob_cooldowns;');
}

db.prepare(`
  INSERT OR IGNORE INTO command_cooldowns (userId, commandName, expires_at)
  SELECT userId, 'daily', (CAST(strftime('%s', last_daily_claim) AS INTEGER) * 1000) + ?
  FROM users
  WHERE last_daily_claim IS NOT NULL
    AND (CAST(strftime('%s', last_daily_claim) AS INTEGER) * 1000) + ? > ?
`).run(24 * 60 * 60 * 1000, 24 * 60 * 60 * 1000, Date.now());

const upsertCooldownQuery = db.prepare(`
  INSERT INTO command_cooldowns (userId, commandName, expires_at)
  VALUES (?, ?, ?)
  ON CONFLICT(userId, commandName) DO UPDATE SET expires_at = excluded.expires_at
`);
const getCooldownQuery = db.prepare(`
  SELECT expires_at FROM command_cooldowns WHERE userId = ? AND commandName = ?
`);
const clearCommandQuery = db.prepare(`
  DELETE FROM command_cooldowns WHERE userId = ? AND commandName = ?
`);
const clearAllQuery = db.prepare(`
  DELETE FROM command_cooldowns WHERE userId = ?
`);
const clearExpiredForUserQuery = db.prepare(`
  DELETE FROM command_cooldowns WHERE userId = ? AND expires_at <= ?
`);
const listCooldownsQuery = db.prepare(`
  SELECT commandName, expires_at
  FROM command_cooldowns
  WHERE userId = ? AND expires_at > ?
  ORDER BY expires_at ASC, commandName ASC
`);

function normalizeUserId(userId) {
  const value = String(userId || '').trim();
  if (!value) throw new TypeError('userId es obligatorio.');
  return value;
}

function normalizeCommandName(commandName) {
  const value = String(commandName || '').trim().toLowerCase().replace(/^\/+/, '');
  if (!value) throw new TypeError('commandName es obligatorio.');
  return value;
}

function setCooldown(userId, commandName, durationInSeconds, nowMs = Date.now()) {
  const normalizedUserId = normalizeUserId(userId);
  const normalizedCommand = normalizeCommandName(commandName);
  const duration = Number(durationInSeconds);
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new TypeError('durationInSeconds debe ser mayor que cero.');
  }
  const expiresAt = Math.floor(Number(nowMs) + duration * 1000);
  upsertCooldownQuery.run(normalizedUserId, normalizedCommand, expiresAt);
  return expiresAt;
}

function getCooldown(userId, commandName, nowMs = Date.now()) {
  const normalizedUserId = normalizeUserId(userId);
  const normalizedCommand = normalizeCommandName(commandName);
  const record = getCooldownQuery.get(normalizedUserId, normalizedCommand);
  if (!record) return null;
  const remainingMs = Number(record.expires_at) - Number(nowMs);
  if (remainingMs <= 0) {
    clearCommandQuery.run(normalizedUserId, normalizedCommand);
    return null;
  }
  return remainingMs;
}

function clearCooldown(userId, commandName) {
  const normalizedUserId = normalizeUserId(userId);
  if (commandName === undefined || commandName === null || String(commandName).trim() === '') {
    return clearAllQuery.run(normalizedUserId).changes;
  }
  return clearCommandQuery.run(
    normalizedUserId,
    normalizeCommandName(commandName)
  ).changes;
}

function getAllCooldowns(userId, nowMs = Date.now()) {
  const normalizedUserId = normalizeUserId(userId);
  clearExpiredForUserQuery.run(normalizedUserId, Number(nowMs));
  return listCooldownsQuery.all(normalizedUserId, Number(nowMs)).map((record) => ({
    commandName: record.commandName,
    expiresAt: Number(record.expires_at),
    remainingMs: Number(record.expires_at) - Number(nowMs)
  }));
}

module.exports = {
  setCooldown,
  getCooldown,
  clearCooldown,
  getAllCooldowns
};
