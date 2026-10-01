const bcrypt = require('bcryptjs');
const logger = require('../utils/logger');

// #1246: strength is policy too. dict-02 P1X-0284..0288 (passwordRules.
// minLength and the four require* flags), RF014 AC#2 "Configurar ... regras de
// senha". Before this the Security page stored them and nothing read them,
// and two validators disagreed: this file's fixed regex (8, four classes)
// served four routes, and utils/passwordValidator.js (12, no digit) served
// the token reset and PUT /api/user-security/password.
//
// The defaults are getDefaultConfig()'s, which the frontend and this file's
// old regex already enforced; the 12-character validator was the outlier.
// Same direct read and fail-closed shape as the reuse keys below. 8..128 is
// validateConfig's own minLength range.
//
// #1253: the floor is 8, not 6. NIST SP 800-63B (June 2017, updated
// 2020-03-02) §5.1.1.2: memorized secrets chosen by the subscriber "SHALL be
// at least 8 characters in length". The same section says verifiers "SHOULD
// NOT impose other composition rules", so a policy with every class off is
// within the standard. A stored 6 or 7 now reads as the default 8.
const DEFAULT_STRENGTH_POLICY = Object.freeze({
  minLength: 8,
  requireUppercase: true,
  requireLowercase: true,
  requireNumbers: true,
  requireSpecialChars: true,
});
const SPECIAL_CHARACTER = /[!@#$%^&*()_\-+=[\]{};':"\\|,.<>/?]/;

function strengthMinLength(value) {
  const length = Number(value);
  return Number.isInteger(length) && length >= 8 && length <= 128 ? length : DEFAULT_STRENGTH_POLICY.minLength;
}

function validateStrength(password, policy = DEFAULT_STRENGTH_POLICY) {
  if (!password || typeof password !== 'string') {
    throw new Error('Senha é obrigatória');
  }

  const minLength = strengthMinLength(policy.minLength);
  const required = [
    [policy.requireUppercase !== false, /[A-Z]/, 'letra maiúscula'],
    [policy.requireLowercase !== false, /[a-z]/, 'letra minúscula'],
    [policy.requireNumbers !== false, /\d/, 'número'],
    [policy.requireSpecialChars !== false, SPECIAL_CHARACTER, 'símbolo'],
  ].filter(([on]) => on);

  const tooShort = password.length < minLength;
  const missing = required.filter(([, pattern]) => !pattern.test(password));
  if (tooShort || missing.length > 0) {
    const classes = required.map(([, , label]) => label);
    const tail = classes.length ? `, com ${classes.slice(0, -1).join(', ')}${classes.length > 1 ? ' e ' : ''}${classes[classes.length - 1]}` : '';
    throw new Error(`Senha deve ter pelo menos ${minLength} caracteres${tail}`);
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

const DEFAULT_PASSWORD_POLICY = Object.freeze({
  ...DEFAULT_STRENGTH_POLICY,
  ...DEFAULT_REUSE_POLICY,
  expirationDays: 90,
  allowPasswordReset: true,
});

// One read for every passwordRules key a password write needs (#1244, #1246).
// Only an explicit boolean false relaxes a flag.
//
// #1249: two authentication keys belong to the same policy. dict-02 P1X-0283
// requireStrongPassword "Habilita política forte de senha" is the master
// switch over the four composition flags (minLength stays its own key), and
// P1X-0280 allowPasswordReset "Permite fluxo de redefinição de senha" gates
// the emailed-token reset. Both default to true, so nothing changes until an
// administrator turns one off.
async function resolvePasswordPolicy(db) {
  try {
    const config = await db.collection('security_config').findOne({ _id: 'main' });
    const rules = (config && config.passwordRules) || {};
    const authentication = (config && config.authentication) || {};
    // #1247: enhancedSecurity.strictPasswordPolicy (dict-02 P1X-0312), while
    // the mode is on, holds every composition flag on whatever the rest say.
    const enhanced = (config && config.enhancedSecurity) || {};
    const strict = enhanced.enabled === true && enhanced.strictPasswordPolicy !== false;
    const strong = authentication.requireStrongPassword !== false;
    const flag = (value) => strict || (strong && value !== false);
    return {
      minLength: strengthMinLength(rules.minLength),
      requireUppercase: flag(rules.requireUppercase),
      requireLowercase: flag(rules.requireLowercase),
      requireNumbers: flag(rules.requireNumbers),
      requireSpecialChars: flag(rules.requireSpecialChars),
      preventReuse: rules.preventReuse !== false,
      maxReuseHistory: reuseDepth(rules.maxReuseHistory),
      expirationDays: expirationDays(rules.expirationDays),
      allowPasswordReset: authentication.allowPasswordReset !== false,
    };
  } catch (error) {
    logger.warn('#1244/#1246: política de senha ilegível, usando os padrões:', error.message);
    return { ...DEFAULT_PASSWORD_POLICY };
  }
}

// #1249: the emailed-token reset and the self-service reset request refuse
// while allowPasswordReset is off. An administrator's set-password and a
// forced change at login are not this flow and stay available.
const PASSWORD_RESET_DISABLED = Object.freeze({
  success: false,
  code: 'PASSWORD_RESET_DISABLED',
  error: 'Redefinição de senha desativada pela política de segurança'
});

async function isPasswordResetAllowed(db) {
  return (await resolvePasswordPolicy(db)).allowPasswordReset;
}

// What a client may be told before it submits a password: the strength rules
// only. The reuse keys stay server-side.
function publicStrengthRules(policy) {
  const { minLength, requireUppercase, requireLowercase, requireNumbers, requireSpecialChars } = policy;
  return { minLength, requireUppercase, requireLowercase, requireNumbers, requireSpecialChars };
}

// The history holds the passwords BEFORE the current one, newest first, to the
// policy's depth. It is kept to that depth even while preventReuse is off, so
// switching the check back on finds a history to check.
function nextPasswordHistory(user = {}, policy = DEFAULT_REUSE_POLICY) {
  const history = Array.isArray(user.passwordHistory) ? user.passwordHistory : [];
  const previous = user.password ? [user.password, ...history] : history;
  return previous.slice(0, reuseDepth(policy.maxReuseHistory));
}

// #1253: the current password counts even while preventReuse is off.
// preventReuse (dict-02 P1X-0290) and maxReuseHistory (P1X-0291, "hashes
// anteriores") govern the history. "Changing" to the current password is not
// a change, and it used to clear forceReset and restart the expiry clock with
// the same secret in place.
async function validateReuse(newPassword, user = {}, policy = DEFAULT_REUSE_POLICY) {
  const history = Array.isArray(user.passwordHistory) ? user.passwordHistory : [];
  const hashesToCheck = [];

  if (user.password) {
    hashesToCheck.push(user.password);
  }

  if (policy.preventReuse !== false) {
    hashesToCheck.push(...history.slice(0, reuseDepth(policy.maxReuseHistory)));
  }

  for (const hash of hashesToCheck) {
    if (hash && await bcrypt.compare(newPassword, hash)) {
      throw new Error('Senha já utilizada recentemente');
    }
  }
}

// #1251: passwordRules.expirationDays (dict-02 P1X-0289, "zero pode
// representar sem expiração"), anchored on UserAccount.passwordChangedAt
// (P1X-0204, "usada para expiração e auditoria"). Before this the window was a
// hard-coded 90 days, nothing called this function, and four writers stored
// the date as lastPasswordChange, which is not the canonical name.
//
// The anchor falls back to lastPasswordChange (documents written before the
// rename) and then createdAt. A user with none of the three cannot be dated
// and is NOT expired: the old reading (no date means expired) would have
// forced a change on every such account at its next login. 0..365 is
// validateConfig's own range; anything else falls back to the default 90.
const DEFAULT_EXPIRATION_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

function expirationDays(value) {
  const days = Number(value);
  return Number.isInteger(days) && days >= 0 && days <= 365 ? days : DEFAULT_EXPIRATION_DAYS;
}

function passwordChangedAt(user) {
  for (const value of [user && user.passwordChangedAt, user && user.lastPasswordChange, user && user.createdAt]) {
    if (value) {
      const time = new Date(value).getTime();
      if (!Number.isNaN(time)) return new Date(time);
    }
  }
  return null;
}

function isPasswordExpired(user, policy = { expirationDays: DEFAULT_EXPIRATION_DAYS }, now = Date.now()) {
  const days = expirationDays(policy.expirationDays);
  if (days === 0) return false;
  const changedAt = passwordChangedAt(user);
  if (!changedAt) return false;
  return now - changedAt.getTime() > days * DAY_MS;
}

module.exports = {
  DEFAULT_REUSE_POLICY,
  DEFAULT_STRENGTH_POLICY,
  DEFAULT_PASSWORD_POLICY,
  validateStrength,
  resolvePasswordPolicy,
  publicStrengthRules,
  PASSWORD_RESET_DISABLED,
  isPasswordResetAllowed,
  nextPasswordHistory,
  validateReuse,
  passwordChangedAt,
  isPasswordExpired
};
