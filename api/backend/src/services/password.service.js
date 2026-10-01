const bcrypt = require('bcryptjs');
const logger = require('../utils/logger');

const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_\-+=[\]{};':"\\|,.<>/?]).{8,}$/;

function validateStrength(password) {
  if (!password || typeof password !== 'string') {
    throw new Error('Senha é obrigatória');
  }

  if (!PASSWORD_REGEX.test(password)) {
    throw new Error('Senha deve ter pelo menos 8 caracteres, com letra maiúscula, letra minúscula, número e símbolo');
  }
}

// #1244: the reuse window is policy, not a constant. dict-02 P1X-0290
// passwordRules.preventReuse ("Impede reutilização") and P1X-0291
// maxReuseHistory ("Quantidade de hashes anteriores verificados"), and
// P1X-0203 passwordHistoryHashes keeps them "conforme política". Before this
// the depth was hard-coded at six sites that disagreed: four stored and
// checked 3, user-security.service stored 5 and checked all it held, and the
// token reset neither checked nor stored.
//
// Read directly from security_config, not through securityService.getConfig,
// which INSERTS a default document when none exists -- the reason
// session.service.js and auth.service.js give for their own policy reads.
//
// Fails CLOSED to getDefaultConfig()'s own values (preventReuse true, depth
// 5): an unreadable policy keeps the check on, and checks the documented
// default rather than an invented one. 20 is SecurityPage's own input bound,
// and validateConfig enforces the same 1..20.
const DEFAULT_REUSE_POLICY = Object.freeze({ preventReuse: true, maxReuseHistory: 5 });
const MAX_REUSE_HISTORY = 20;

function reuseDepth(value) {
  const depth = Number(value);
  return Number.isInteger(depth) && depth >= 1 && depth <= MAX_REUSE_HISTORY
    ? depth
    : DEFAULT_REUSE_POLICY.maxReuseHistory;
}

async function resolveReusePolicy(db) {
  try {
    const config = await db.collection('security_config').findOne({ _id: 'main' });
    const rules = (config && config.passwordRules) || {};
    return {
      // Only an explicit boolean false relaxes it.
      preventReuse: rules.preventReuse !== false,
      maxReuseHistory: reuseDepth(rules.maxReuseHistory),
    };
  } catch (error) {
    logger.warn('#1244: política de reutilização ilegível, usando o padrão (5):', error.message);
    return { ...DEFAULT_REUSE_POLICY };
  }
}

// The history holds the passwords BEFORE the current one, newest first, to the
// policy's depth. It is kept to that depth even while preventReuse is off, so
// switching the check back on finds a history to check.
function nextPasswordHistory(user = {}, policy = DEFAULT_REUSE_POLICY) {
  const history = Array.isArray(user.passwordHistory) ? user.passwordHistory : [];
  const previous = user.password ? [user.password, ...history] : history;
  return previous.slice(0, reuseDepth(policy.maxReuseHistory));
}

async function validateReuse(newPassword, user = {}, policy = DEFAULT_REUSE_POLICY) {
  if (policy.preventReuse === false) {
    return;
  }

  const history = Array.isArray(user.passwordHistory) ? user.passwordHistory : [];
  const hashesToCheck = [];

  // The current password always counts: "changing" to it is not a change.
  if (user.password) {
    hashesToCheck.push(user.password);
  }

  hashesToCheck.push(...history.slice(0, reuseDepth(policy.maxReuseHistory)));

  for (const hash of hashesToCheck) {
    if (hash && await bcrypt.compare(newPassword, hash)) {
      throw new Error('Senha já utilizada recentemente');
    }
  }
}

function isPasswordExpired(user) {
  if (!user || !user.lastPasswordChange) {
    return true;
  }
  const ninetyDaysMs = 90 * 24 * 60 * 60 * 1000;
  const lastChange = new Date(user.lastPasswordChange).getTime();
  if (Number.isNaN(lastChange)) {
    return true;
  }
  return (Date.now() - lastChange) > ninetyDaysMs;
}

module.exports = {
  DEFAULT_REUSE_POLICY,
  validateStrength,
  resolveReusePolicy,
  nextPasswordHistory,
  validateReuse,
  isPasswordExpired
};
