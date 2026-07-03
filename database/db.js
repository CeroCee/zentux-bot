const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

const databaseDirectory = __dirname;
const databasePath = path.resolve(
  process.env.ZENTUX_DB_PATH || path.join(databaseDirectory, 'zentux.db')
);

fs.mkdirSync(path.dirname(databasePath), { recursive: true });

const db = new Database(databasePath);

db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('busy_timeout = 5000');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    userId TEXT PRIMARY KEY,
    zcoins INTEGER NOT NULL DEFAULT 0,
    bank INTEGER NOT NULL DEFAULT 0,
    level INTEGER NOT NULL DEFAULT 1,
    xp INTEGER NOT NULL DEFAULT 0,
    total_vc_minutes INTEGER NOT NULL DEFAULT 0,
    total_reactions INTEGER NOT NULL DEFAULT 0,
    total_invites INTEGER NOT NULL DEFAULT 0,
    streak_days INTEGER NOT NULL DEFAULT 0,
    last_daily_claim TEXT,
    streak_protector INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS quests (
    userId TEXT NOT NULL,
    quest_id TEXT NOT NULL,
    progress INTEGER NOT NULL DEFAULT 0,
    completed INTEGER NOT NULL DEFAULT 0,
    date TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS coin_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userId TEXT NOT NULL,
    amount INTEGER NOT NULL,
    reason TEXT NOT NULL,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS reaction_claims (
    userId TEXT NOT NULL,
    messageId TEXT NOT NULL,
    claimed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (userId, messageId)
  );

  CREATE TABLE IF NOT EXISTS xp_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userId TEXT NOT NULL,
    amount INTEGER NOT NULL,
    reason TEXT NOT NULL,
    timestamp DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS rob_cooldowns (
    userId TEXT PRIMARY KEY,
    last_rob_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_quests_user_date
  ON quests (userId, date);

  CREATE INDEX IF NOT EXISTS idx_coin_logs_user
  ON coin_logs (userId);

  CREATE INDEX IF NOT EXISTS idx_coin_logs_timestamp
  ON coin_logs (timestamp);

  CREATE INDEX IF NOT EXISTS idx_reaction_claims_message
  ON reaction_claims (messageId);

  CREATE INDEX IF NOT EXISTS idx_xp_logs_user
  ON xp_logs (userId);
`);

const requiredUserColumns = {
  bank: 'INTEGER NOT NULL DEFAULT 0',
  total_vc_minutes: 'INTEGER NOT NULL DEFAULT 0',
  total_reactions: 'INTEGER NOT NULL DEFAULT 0',
  total_invites: 'INTEGER NOT NULL DEFAULT 0'
};
const existingUserColumns = new Set(
  db.pragma('table_info(users)').map((column) => column.name)
);
for (const [columnName, definition] of Object.entries(requiredUserColumns)) {
  if (!existingUserColumns.has(columnName)) {
    db.exec(`ALTER TABLE users ADD COLUMN ${columnName} ${definition};`);
  }
}

const queries = {
  getUser: db.prepare(`
    SELECT *
    FROM users
    WHERE userId = ?
  `),

  createUser: db.prepare(`
    INSERT INTO users (userId)
    VALUES (?)
    ON CONFLICT(userId) DO NOTHING
  `),

  addCoins: db.prepare(`
    UPDATE users
    SET zcoins = zcoins + ?
    WHERE userId = ?
  `),

  depositCoins: db.prepare(`
    UPDATE users
    SET zcoins = zcoins - ?, bank = bank + ?
    WHERE userId = ? AND zcoins >= ?
  `),

  withdrawCoins: db.prepare(`
    UPDATE users
    SET bank = bank - ?, zcoins = zcoins + ?
    WHERE userId = ? AND bank >= ?
  `),

  incrementVoiceMinutes: db.prepare(`
    UPDATE users SET total_vc_minutes = total_vc_minutes + ? WHERE userId = ?
  `),

  incrementReactions: db.prepare(`
    UPDATE users SET total_reactions = total_reactions + ? WHERE userId = ?
  `),

  incrementInvites: db.prepare(`
    UPDATE users SET total_invites = total_invites + ? WHERE userId = ?
  `),

  topWealth: db.prepare(`
    SELECT userId, zcoins, bank, (zcoins + bank) AS score
    FROM users
    ORDER BY score DESC, userId ASC
    LIMIT ?
  `),

  topVoice: db.prepare(`
    SELECT userId, total_vc_minutes AS score
    FROM users
    ORDER BY score DESC, userId ASC
    LIMIT ?
  `),

  topReactions: db.prepare(`
    SELECT userId, total_reactions AS score
    FROM users
    ORDER BY score DESC, userId ASC
    LIMIT ?
  `),

  topInvites: db.prepare(`
    SELECT userId, total_invites AS score
    FROM users
    ORDER BY score DESC, userId ASC
    LIMIT ?
  `),

  updateXp: db.prepare(`
    UPDATE users
    SET xp = ?, level = ?
    WHERE userId = ?
  `),

  registerXpLog: db.prepare(`
    INSERT INTO xp_logs (userId, amount, reason)
    VALUES (?, ?, ?)
  `),

  registerCoinLog: db.prepare(`
    INSERT INTO coin_logs (userId, amount, reason)
    VALUES (?, ?, ?)
  `),

  getCoinLogs: db.prepare(`
    SELECT *
    FROM coin_logs
    WHERE userId = ?
    ORDER BY id DESC
    LIMIT ?
  `)
};

function validateUserId(userId) {
  const normalizedUserId = String(userId || '').trim();
  if (!normalizedUserId) {
    throw new TypeError('userId es obligatorio.');
  }
  return normalizedUserId;
}

function validateAmount(amount) {
  const normalizedAmount = Number(amount);
  if (!Number.isSafeInteger(normalizedAmount)) {
    throw new TypeError('amount debe ser un numero entero valido.');
  }
  return normalizedAmount;
}

function getUser(userId) {
  return queries.getUser.get(validateUserId(userId)) || null;
}

function getOrCreateUser(userId) {
  const normalizedUserId = validateUserId(userId);
  queries.createUser.run(normalizedUserId);
  return queries.getUser.get(normalizedUserId);
}

function registerCoinLog(userId, amount, reason) {
  const normalizedUserId = validateUserId(userId);
  const normalizedAmount = validateAmount(amount);
  const normalizedReason = String(reason || '').trim();
  if (!normalizedReason) {
    throw new TypeError('reason es obligatorio.');
  }

  const result = queries.registerCoinLog.run(
    normalizedUserId,
    normalizedAmount,
    normalizedReason
  );

  return {
    id: Number(result.lastInsertRowid),
    userId: normalizedUserId,
    amount: normalizedAmount,
    reason: normalizedReason
  };
}

const addCoinsTransaction = db.transaction((userId, amount, reason) => {
  const normalizedUserId = validateUserId(userId);
  const normalizedAmount = validateAmount(amount);
  const normalizedReason = String(reason || '').trim();
  if (!normalizedReason) {
    throw new TypeError('reason es obligatorio.');
  }

  queries.createUser.run(normalizedUserId);
  queries.addCoins.run(normalizedAmount, normalizedUserId);
  const logResult = queries.registerCoinLog.run(
    normalizedUserId,
    normalizedAmount,
    normalizedReason
  );

  return {
    user: queries.getUser.get(normalizedUserId),
    logId: Number(logResult.lastInsertRowid)
  };
});

function addCoins(userId, amount, reason = 'Sin especificar') {
  return addCoinsTransaction(userId, amount, reason);
}

function resolveBankAmount(value, available) {
  if (String(value).trim().toLowerCase() === 'all') {
    if (available <= 0) {
      const error = new Error('No hay fondos disponibles.');
      error.code = 'NO_FUNDS';
      throw error;
    }
    return available;
  }

  const amount = Number(value);
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    const error = new TypeError('La cantidad debe ser un entero positivo o "all".');
    error.code = 'INVALID_AMOUNT';
    throw error;
  }
  return amount;
}

const depositCoinsTransaction = db.transaction((userId, value) => {
  const normalizedUserId = validateUserId(userId);
  queries.createUser.run(normalizedUserId);
  const current = queries.getUser.get(normalizedUserId);
  const amount = resolveBankAmount(value, current.zcoins);
  const result = queries.depositCoins.run(amount, amount, normalizedUserId, amount);
  if (result.changes !== 1) {
    const error = new Error('Saldo insuficiente en el bolsillo.');
    error.code = 'INSUFFICIENT_POCKET';
    throw error;
  }
  queries.registerCoinLog.run(normalizedUserId, -amount, 'Depósito al banco');
  return { amount, user: queries.getUser.get(normalizedUserId) };
});

const withdrawCoinsTransaction = db.transaction((userId, value) => {
  const normalizedUserId = validateUserId(userId);
  queries.createUser.run(normalizedUserId);
  const current = queries.getUser.get(normalizedUserId);
  const amount = resolveBankAmount(value, current.bank);
  const result = queries.withdrawCoins.run(amount, amount, normalizedUserId, amount);
  if (result.changes !== 1) {
    const error = new Error('Saldo insuficiente en el banco.');
    error.code = 'INSUFFICIENT_BANK';
    throw error;
  }
  queries.registerCoinLog.run(normalizedUserId, amount, 'Retiro del banco');
  return { amount, user: queries.getUser.get(normalizedUserId) };
});

function depositCoins(userId, amount) {
  return depositCoinsTransaction(userId, amount);
}

function withdrawCoins(userId, amount) {
  return withdrawCoinsTransaction(userId, amount);
}

function incrementStatistic(userId, amount, query) {
  const normalizedUserId = validateUserId(userId);
  const normalizedAmount = validateAmount(amount);
  if (normalizedAmount <= 0) throw new TypeError('El incremento debe ser mayor que cero.');
  queries.createUser.run(normalizedUserId);
  query.run(normalizedAmount, normalizedUserId);
  return queries.getUser.get(normalizedUserId);
}

function incrementVoiceMinutes(userId, minutes = 10) {
  return incrementStatistic(userId, minutes, queries.incrementVoiceMinutes);
}

function incrementReactions(userId, amount = 1) {
  return incrementStatistic(userId, amount, queries.incrementReactions);
}

function incrementInvites(userId, amount = 1) {
  return incrementStatistic(userId, amount, queries.incrementInvites);
}

const leaderboardQueries = {
  wealth: queries.topWealth,
  voice: queries.topVoice,
  reactions: queries.topReactions,
  invites: queries.topInvites
};

const leaderboardExpressions = {
  wealth: '(zcoins + bank)',
  voice: 'total_vc_minutes',
  reactions: 'total_reactions',
  invites: 'total_invites'
};

const leaderboardPositionQueries = Object.fromEntries(
  Object.entries(leaderboardExpressions).map(([category, expression]) => [
    category,
    db.prepare(`
      SELECT position, score
      FROM (
        SELECT
          userId,
          ${expression} AS score,
          ROW_NUMBER() OVER (ORDER BY ${expression} DESC, userId ASC) AS position
        FROM users
      )
      WHERE userId = ?
    `)
  ])
);

function normalizeLeaderboardCategory(category) {
  const value = String(category || '').trim().toLowerCase();
  if (!leaderboardQueries[value]) {
    throw new TypeError(`Categoría de leaderboard no válida: ${category}`);
  }
  return value;
}

function getLeaderboard(category, limit = 10) {
  const normalizedCategory = normalizeLeaderboardCategory(category);
  const normalizedLimit = Math.min(Math.max(Number.parseInt(limit, 10) || 10, 1), 100);
  return leaderboardQueries[normalizedCategory].all(normalizedLimit);
}

function getLeaderboardPosition(category, userId) {
  const normalizedCategory = normalizeLeaderboardCategory(category);
  const normalizedUserId = validateUserId(userId);
  queries.createUser.run(normalizedUserId);
  return leaderboardPositionQueries[normalizedCategory].get(normalizedUserId);
}

function getTopWealth(limit = 10) { return getLeaderboard('wealth', limit); }
function getTopVoice(limit = 10) { return getLeaderboard('voice', limit); }
function getTopReactions(limit = 10) { return getLeaderboard('reactions', limit); }
function getTopInvites(limit = 10) { return getLeaderboard('invites', limit); }

function xpForNextLevel(level) {
  const normalizedLevel = Math.max(1, Number.parseInt(level, 10) || 1);
  return normalizedLevel * 100;
}

const addXpTransaction = db.transaction((userId, amount, reason) => {
  const normalizedUserId = validateUserId(userId);
  const normalizedAmount = validateAmount(amount);
  const normalizedReason = String(reason || '').trim();
  if (normalizedAmount <= 0) throw new TypeError('La XP debe ser mayor que cero.');
  if (!normalizedReason) throw new TypeError('reason es obligatorio.');

  queries.createUser.run(normalizedUserId);
  const before = queries.getUser.get(normalizedUserId);
  let level = Math.max(1, before.level);
  let xp = Math.max(0, before.xp) + normalizedAmount;
  let levelsGained = 0;

  while (xp >= xpForNextLevel(level)) {
    xp -= xpForNextLevel(level);
    level += 1;
    levelsGained += 1;
  }

  queries.updateXp.run(xp, level, normalizedUserId);
  const logResult = queries.registerXpLog.run(
    normalizedUserId,
    normalizedAmount,
    normalizedReason
  );

  return {
    user: queries.getUser.get(normalizedUserId),
    levelsGained,
    previousLevel: before.level,
    logId: Number(logResult.lastInsertRowid)
  };
});

function addXp(userId, amount, reason = 'Actividad') {
  return addXpTransaction(userId, amount, reason);
}

function getCoinLogs(userId, limit = 25) {
  const normalizedUserId = validateUserId(userId);
  const normalizedLimit = Math.min(
    Math.max(Number.parseInt(limit, 10) || 25, 1),
    100
  );
  return queries.getCoinLogs.all(normalizedUserId, normalizedLimit);
}

function closeDatabase() {
  if (db.open) {
    db.close();
  }
}

module.exports = {
  db,
  queries,
  getUser,
  getOrCreateUser,
  addCoins,
  depositCoins,
  withdrawCoins,
  incrementVoiceMinutes,
  incrementReactions,
  incrementInvites,
  getLeaderboard,
  getLeaderboardPosition,
  getTopWealth,
  getTopVoice,
  getTopReactions,
  getTopInvites,
  addXp,
  xpForNextLevel,
  registerCoinLog,
  getCoinLogs,
  closeDatabase
};
