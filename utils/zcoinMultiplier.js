const DOUBLE_ZCOINS_ROLE_ID = process.env.DOUBLE_ZCOINS_ROLE_ID || '1340756256243318897';

async function memberHasDoubleZCoinsRole(guild, userId) {
  if (!guild || !userId) return false;
  const member = guild.members.cache.get(userId)
    || await guild.members.fetch(userId).catch(() => null);
  return Boolean(member?.roles.cache.has(DOUBLE_ZCOINS_ROLE_ID));
}

async function applyZCoinMultiplier({ guild, userId, amount, reason }) {
  const numericAmount = Number(amount);
  if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
    return {
      amount: numericAmount,
      multiplier: 1,
      bonus: 0,
      reason
    };
  }

  const hasMultiplier = await memberHasDoubleZCoinsRole(guild, userId);
  if (!hasMultiplier) {
    return {
      amount: numericAmount,
      multiplier: 1,
      bonus: 0,
      reason
    };
  }

  const multipliedAmount = numericAmount * 2;
  return {
    amount: multipliedAmount,
    multiplier: 2,
    bonus: multipliedAmount - numericAmount,
    reason: `${reason} (x2 Z-Coins)`
  };
}

module.exports = {
  DOUBLE_ZCOINS_ROLE_ID,
  applyZCoinMultiplier,
  memberHasDoubleZCoinsRole
};
