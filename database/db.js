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
    level INTEGER NOT NULL DEFAULT 1,
    xp INTEGER NOT NULL DEFAULT 0,
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

  CREATE INDEX IF NOT EXISTS idx_quests_user_date
  ON quests (userId, date);

  CREATE INDEX IF NOT EXISTS idx_coin_logs_user
  ON coin_logs (userId);

  CREATE INDEX IF NOT EXISTS idx_coin_logs_timestamp
  ON coin_logs (timestamp);

  CREATE INDEX IF NOT EXISTS idx_reaction_claims_message
  ON reaction_claims (messageId);
`);

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
  registerCoinLog,
  getCoinLogs,
  closeDatabase
};
