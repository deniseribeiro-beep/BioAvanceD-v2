const logger = require('../utils/logger');
const { hmacBlindIndex } = require('../utils/fieldEncryption');

/**
 * #1255: the IP-attempt store behind loginAttempts.trackIP (dict-02 P1X-0299,
 * "Rastreia origem por IP, respeitando política de privacidade") and
 * loginAttempts.blockIPAfterAttempts (P1X-0300, "Quantidade de falhas para
 * bloqueio de IP"). Until this file both keys were shown on the Security page
 * and read by nothing (#986 recorded the gap and closed without a store).
 *
 * #1256 builds enhancedSecurity.blockUnusualActivity (P1X-0315) on the same
 * rows: see detectUnusualActivity below.
 *
 * ONE ROW PER SOURCE, ONE WINDOW AT A TIME. A row counts the failed password
 * and MFA attempts from one source address inside a fixed window, and records
 * which accounts those attempts named. The window and the block both last
 * authentication.lockoutDurationMinutes, the enforced half of the pair #1249
 * made loginAttempts.lockoutDurationMinutes follow, so an IP block and an
 * account lockout expire on the same clock.
 *
 * PRIVACY (LGPD; P1X-0299's own wording). The address is personal data, and
 * the store only ever needs equality on it, so it keeps an HMAC of it under the
 * field-encryption key (hmacBlindIndex), never the address. The same goes for
 * the account identifiers. Rows carry an expiresAt and a TTL index removes them
 * once the window or the block ends, whichever is later. The audit row a block
 * writes carries the address the way every audit row does, under the audit
 * log's own retention (#1248 points the Security page's privacy group there).
 * With no ENCRYPTION_KEY there is no key to hash under, so nothing is stored
 * and nothing is blocked; production refuses to start without that key
 * (assertFieldEncryptionConfigured).
 *
 * THE ADDRESS IS req.ip, never X-Forwarded-For read by hand. Express derives
 * req.ip through app.js's `trust proxy` setting, so a client can only move it
 * through a proxy the deployment trusts. A raw header would let an attacker
 * rotate past the block, or name a victim's address and lock the victim out.
 *
 * SUCCESS DOES NOT CLEAR A SOURCE'S COUNT, unlike an account's. Clearing on any
 * successful login would let an attacker holding one valid account reset the
 * counter between guesses at the others (OWASP Authentication Cheat Sheet,
 * "Login Throttling"). The window decays it instead.
 *
 * Every function here fails OPEN and never throws: an unreadable policy or an
 * unreachable store must not lock every user out, the same reason
 * auth.service's resolveLockoutPolicy gives (#952). The per-account lockout
 * still applies whatever happens here.
 */

const COLLECTION = 'login_ip_attempts';
const DEFAULT_LOCKOUT_MINUTES = 30;
const DEFAULT_MAX_LOGIN_ATTEMPTS = 5;

let ttlIndexEnsured = false;

async function ensureTtlIndex(collection) {
  if (ttlIndexEnsured) return;
  try {
    // mongoose runs with autoIndex:false (#941), so the TTL index is built
    // here, once per process, the way phone-codes.routes.js builds its own.
    await collection.createIndex({ expiresAt: 1 }, { name: 'login_ip_attempts_ttl', expireAfterSeconds: 0 });
    ttlIndexEnsured = true;
  } catch (error) {
    logger.warn(`#1255: índice TTL de ${COLLECTION} não criado: ${error.message}`);
  }
}

function positiveNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * The policy, read straight from the collection for the reason
 * resolveMfaEnrolmentPolicy gives: securityService.getConfig inserts a default
 * document when none exists. With no document the canonical defaults apply
 * (trackIP true, block after 10).
 */
async function resolveIpPolicy(db) {
  try {
    const config = (await db.collection('security_config').findOne({ _id: 'main' })) || {};
    const loginAttempts = config.loginAttempts || {};
    const auth = config.authentication || {};
    const enhanced = config.enhancedSecurity || {};
    const blockAfter = loginAttempts.blockIPAfterAttempts === undefined || loginAttempts.blockIPAfterAttempts === null
      ? 10
      : Number(loginAttempts.blockIPAfterAttempts);
    return {
      trackIP: loginAttempts.trackIP !== false,
      // P1X-0300 is 0..1 Condicional: 0 (or anything not positive) tracks
      // without blocking.
      blockAfter: Number.isFinite(blockAfter) && blockAfter > 0 ? Math.floor(blockAfter) : 0,
      windowMs: positiveNumber(auth.lockoutDurationMinutes, DEFAULT_LOCKOUT_MINUTES) * 60 * 1000,
      // #1256: read only while the enhanced mode is on (#1247's rule).
      blockUnusualActivity: enhanced.enabled === true && enhanced.blockUnusualActivity !== false,
      distinctAccountThreshold: positiveNumber(auth.maxLoginAttempts, DEFAULT_MAX_LOGIN_ATTEMPTS),
    };
  } catch (error) {
    logger.warn(`#1255: política de IP ilegível, sem rastreio nesta tentativa: ${error.message}`);
    return null;
  }
}

function sourceKey(req) {
  const address = req && typeof req.ip === 'string' ? req.ip : '';
  if (!address) return null;
  return hmacBlindIndex(`login-source:${address}`);
}

function accountKey(identifier) {
  if (typeof identifier !== 'string' || !identifier.trim()) return null;
  return hmacBlindIndex(`login-account:${identifier.trim().toLowerCase()}`);
}

/**
 * The gate. True only while trackIP is on and the source's row holds a block
 * that has not expired. Turning trackIP off lifts every block with it: the key
 * is read "only while trackIP is on" (#1255).
 */
async function isSourceBlocked(db, req) {
  try {
    const key = sourceKey(req);
    if (!key) return false;
    const policy = await resolveIpPolicy(db);
    if (!policy || !policy.trackIP) return false;
    const row = await db.collection(COLLECTION).findOne({ _id: key });
    return Boolean(row && row.blockedUntil && new Date(row.blockedUntil).getTime() > Date.now());
  } catch (error) {
    logger.warn(`#1255: leitura do bloqueio por IP falhou (ignorada): ${error.message}`);
    return false;
  }
}

/**
 * #1256's definition of unusual activity: one source failing against at least
 * distinctAccountThreshold DIFFERENT accounts inside one window. That is
 * password spraying or credential stuffing (OWASP Credential Stuffing
 * Prevention Cheat Sheet; NIST SP 800-63B §5.2.2 asks verifiers to limit
 * failed attempts, and spraying is the shape built to stay under every
 * per-account limit). The threshold is authentication.maxLoginAttempts, the
 * number of failures the policy already treats as an attack on one account,
 * spread here across that many accounts.
 */
function detectUnusualActivity(row, policy) {
  if (!policy.blockUnusualActivity || !row) return false;
  const distinct = Array.isArray(row.accounts) ? row.accounts.length : 0;
  return distinct >= policy.distinctAccountThreshold;
}

async function reportUnusualActivityBlock(db, req, row) {
  const notificationDispatchService = require('./notificationDispatch.service');
  const auditLogger = require('../utils/auditLogger');
  try {
    await auditLogger.log({
      action: 'LOGIN',
      resourceType: 'Authentication',
      status: 'error',
      severity: 'critical',
      message: 'Origem bloqueada por atividade incomum: falhas de login contra várias contas',
      payload: { reason: 'unusual_activity', distinctAccounts: row.accounts.length, failures: row.failures },
      req,
      module: 'Autenticação',
    });
  } catch (error) {
    logger.warn(`#1256: auditoria do bloqueio por atividade incomum falhou: ${error.message}`);
  }
  // #650's shape for the MFA lockout: fire-and-forget with an explicit catch,
  // so a missing NotificationRule never delays the block (#685).
  void notificationDispatchService.dispatchNotification(db, {
    eventType: 'unusual_activity_block',
    sourceEventType: 'Authentication',
    sourceEventId: row._id,
    payload: { distinctAccounts: row.accounts.length, failures: row.failures, blockedUntil: row.blockedUntil },
  }).catch((dispatchError) => {
    logger.error('[NOTIFICATION_DISPATCH] Falha ao disparar notificação de atividade incomum:', dispatchError.message || dispatchError);
  });
}

/**
 * Count one failed attempt from req's source, naming `identifier` (the
 * username or e-mail typed, existing or not: an unknown name is exactly what
 * a stuffing list is full of). Blocks the source when the count reaches
 * blockIPAfterAttempts, or when #1256's detector fires. Never throws.
 */
async function recordFailedSourceAttempt(db, req, identifier) {
  try {
    const key = sourceKey(req);
    if (!key) return;
    const policy = await resolveIpPolicy(db);
    if (!policy || !policy.trackIP) return;

    const collection = db.collection(COLLECTION);
    await ensureTtlIndex(collection);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + policy.windowMs);

    // A window that has ended starts over, unless a block is still running.
    await collection.updateOne(
      {
        _id: key,
        windowStart: { $lte: new Date(now.getTime() - policy.windowMs) },
        $or: [{ blockedUntil: null }, { blockedUntil: { $lte: now } }],
      },
      { $set: { windowStart: now, failures: 0, accounts: [], blockedUntil: null, blockReason: null } }
    );

    const update = {
      $inc: { failures: 1 },
      $set: { expiresAt, lastFailureAt: now },
      $setOnInsert: { windowStart: now, blockedUntil: null, blockReason: null },
    };
    const account = accountKey(identifier);
    if (account) update.$addToSet = { accounts: account };
    else update.$setOnInsert.accounts = [];

    const row = await collection.findOneAndUpdate({ _id: key }, update, { upsert: true, returnDocument: 'after' });
    if (!row) return;
    const alreadyBlocked = row.blockedUntil && new Date(row.blockedUntil).getTime() > now.getTime();
    if (alreadyBlocked) return;

    let reason = null;
    if (detectUnusualActivity(row, policy)) reason = 'unusual_activity';
    else if (policy.blockAfter > 0 && row.failures >= policy.blockAfter) reason = 'attempts';
    if (!reason) return;

    const blockedUntil = new Date(now.getTime() + policy.windowMs);
    await collection.updateOne(
      { _id: key },
      { $set: { blockedUntil, blockReason: reason, expiresAt: blockedUntil } }
    );
    logger.warn(`#1255: origem bloqueada até ${blockedUntil.toISOString()} (${reason})`);
    if (reason === 'unusual_activity') {
      await reportUnusualActivityBlock(db, req, { ...row, blockedUntil });
    }
  } catch (error) {
    logger.warn(`#1255: falha ao contabilizar tentativa por IP (ignorada): ${error.message}`);
  }
}

module.exports = {
  COLLECTION,
  resolveIpPolicy,
  isSourceBlocked,
  recordFailedSourceAttempt,
  detectUnusualActivity,
  // test seam
  _resetTtlIndexFlag: () => { ttlIndexEnsured = false; },
};
