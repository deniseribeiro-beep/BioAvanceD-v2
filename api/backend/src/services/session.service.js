const SessionModel = require('../models/Session');
const logger = require('../utils/logger');
// #1078: moved to utils/tokenHash so the password-reset writers share one
// implementation instead of adding a third copy. Byte-identical body; the
// only crypto use in this file was inside it, so the require went with it.
const { hashToken } = require('../utils/tokenHash');
const { getUserAnonId, maskIpAddress } = require('../utils/userAnonymization');
const { ensureSessionIndexes } = require('../utils/sessionIndexes');

// #1005: dict-02 P1X-0267's closed vocabulary. A filter outside it is refused
// rather than run, since it could only ever match nothing.
const REVOCATION_REASONS = ['user_request', 'admin_action', 'password_change', 'risk', 'expiration'];

// #1005: the audit list's sort allow-list, same reasoning as log.service's
// SORTABLE_LOG_FIELDS (#780): an unknown key sorts every row equal and returns
// the wrong page with a 200. createdAt is the default and the one every audit
// filter is index-served under (utils/sessionIndexes.js).
const AUDIT_SORTABLE_SESSION_FIELDS = new Set(['createdAt', 'revokedAt', 'lastActivity']);
const AUDIT_SESSION_MAX_LIMIT = 200;

const ACCESS_TOKEN_TTL_MS = 15 * 60 * 1000;
const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// #914 / RF014 AC#1. session.timeoutMinutes was one of 43 SecurityConfiguration
// keys that nothing read, so the admin UI wrote a policy and four hardcoded
// 30-minute literals decided the actual behaviour.
//
// SNAPSHOT, not a live per-request read. dict-02 P1X-0262 defines
// Session.inactiveTimeout as the EFFECTIVE limit and says it "deve derivar de
// SecurityConfiguration" -- a materialised value. It is also what keeps RF014
// AC#8 ("revogar sessões quando a alteração exigir") meaningful: under a live
// read a tightened timeout would apply on the next request and AC#8 would have
// nothing left to revoke on this path. Choosing live would have silently
// deleted a Crítica requirement rather than implemented one.
//
// Reads the collection DIRECTLY rather than through securityService.getConfig,
// which INSERTS a default document when none exists -- a write side effect has
// no business firing inside a login.
//
// Fails OPEN to 30 minutes: an unreadable policy must not lock everyone out,
// and 30 is both the previous literal and getDefaultConfig()'s own value, so
// the fallback is the documented default rather than an invented one.
const DEFAULT_INACTIVE_TIMEOUT_MS = 30 * 60 * 1000;

// #914 / RF014 AC#1, RNF021 AC#3. session.maxSessionDurationHours is dict-02
// P1X-0293, "Duração máxima absoluta", anchored on sessionStartedAt (P1X-0259,
// our createdAt). Before this nothing capped a session at all:
// rotateSessionTokens reset refreshExpiresAt to now + 7 days on every refresh,
// so a client that kept refreshing held one session indefinitely.
//
// The cap is carried by refreshExpiresAt itself rather than a new field: it is
// set once here to min(start + cap, start + REFRESH_TOKEN_TTL_MS) and rotation
// may only shorten it. isSessionActive (every authenticated request, through
// verifySession) and getSessionByRefreshToken already refuse a session past
// refreshExpiresAt, so both paths enforce the cap with no new check.
//
// Same snapshot-and-fail-open shape as the inactivity timeout above, for the
// same reasons: AC#8 needs a snapshot to revoke, and an unreadable policy falls
// back to getDefaultConfig()'s own value (12) rather than an invented one.
const DEFAULT_MAX_SESSION_DURATION_MS = 12 * 60 * 60 * 1000;

function positiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

// #1249: dict-02 P1X-0295 session.autoRenewal "Permite renovação automática
// controlada" decides whether POST /api/auth/refresh renews a session; off, a
// session ends with its access token. P1X-0296 session.logExpiration
// "Registra expirações no AuditEvent" decides whether an expiry writes the
// audit row every other revocation writes (#1020). Both default to true, and
// only an explicit false turns one off.
async function resolveSessionPolicy(db) {
  const policy = {
    inactiveTimeoutMs: DEFAULT_INACTIVE_TIMEOUT_MS,
    maxSessionDurationMs: DEFAULT_MAX_SESSION_DURATION_MS,
    autoRenewal: true,
    logExpiration: true
  };
  try {
    const config = await db.collection('security_config').findOne({ _id: 'main' });
    const session = (config && config.session) || {};
    const minutes = positiveNumber(session.timeoutMinutes);
    if (minutes) policy.inactiveTimeoutMs = minutes * 60 * 1000;
    const hours = positiveNumber(session.maxSessionDurationHours);
    if (hours) policy.maxSessionDurationMs = hours * 60 * 60 * 1000;
    policy.autoRenewal = session.autoRenewal !== false;
    policy.logExpiration = session.logExpiration !== false;
  } catch (error) {
    logger.warn('#914: política de sessão ilegível, usando os padrões (30 min / 12 h):', error.message);
  }
  return policy;
}

/**
 * Service de Sessão
 * Gerencia sessões de usuário com controle de atividade
 */
class SessionService {
  constructor() {
    // Cache in-memory de sessões (em produção, pode usar Redis)
    this.sessions = new Map();
  }

  // #1249: the refresh route reads autoRenewal through this.
  resolveSessionPolicy(db) {
    return resolveSessionPolicy(db);
  }

  getTokenHash(token) {
    return hashToken(token);
  }

  extractClientInfo(req) {
    if (!req) {
      return {
        ipAddress: 'N/A',
        userAgent: null,
        deviceInfo: {
          browser: 'Desconhecido',
          os: 'Desconhecido',
          deviceName: 'Dispositivo Desconhecido'
        }
      };
    }

    const forwarded = req.headers?.['x-forwarded-for'];
    const realIp = req.headers?.['x-real-ip'];
    const reqIp = req.ip;
    const rawIp = (typeof forwarded === 'string' ? forwarded.split(',')[0].trim() : null) || realIp || reqIp || req.socket?.remoteAddress || 'N/A';
    const userAgent = req.headers?.['user-agent'] || null;

    return {
      ipAddress: rawIp,
      userAgent,
      deviceInfo: {
        browser: this.extractBrowser(userAgent),
        os: this.extractOS(userAgent),
        deviceName: this.extractDeviceName(userAgent)
      }
    };
  }

  extractBrowser(userAgent) {
    if (!userAgent) return 'Desconhecido';
    if (userAgent.includes('Edg/')) return 'Edge';
    if (userAgent.includes('Chrome/') && !userAgent.includes('Edg/')) return 'Chrome';
    if (userAgent.includes('Firefox/')) return 'Firefox';
    if (userAgent.includes('Safari/') && !userAgent.includes('Chrome/')) return 'Safari';
    return 'Desconhecido';
  }

  extractOS(userAgent) {
    if (!userAgent) return 'Desconhecido';
    if (userAgent.includes('Windows')) return 'Windows';
    if (userAgent.includes('Mac OS X')) return 'macOS';
    if (userAgent.includes('Android')) return 'Android';
    if (userAgent.includes('iPhone') || userAgent.includes('iPad')) return 'iOS';
    if (userAgent.includes('Linux')) return 'Linux';
    return 'Desconhecido';
  }

  extractDeviceName(userAgent) {
    if (!userAgent) return 'Dispositivo Desconhecido';
    if (userAgent.includes('Mobile') || userAgent.includes('Android') || userAgent.includes('iPhone')) {
      return 'Dispositivo Móvel';
    }
    return 'Desktop';
  }

  /**
   * Cria uma nova sessão
   */
  async createSession(db, userID, accessToken, refreshToken, req = null) {
    try {
      const sessionID = `session_${userID}_${Date.now()}`;
      const now = new Date();
      const policy = await resolveSessionPolicy(db);
      // #914: the absolute cap -- see resolveSessionPolicy.
      const refreshExpiresAt = new Date(now.getTime() + Math.min(policy.maxSessionDurationMs, REFRESH_TOKEN_TTL_MS));
      const expiresAt = new Date(Math.min(now.getTime() + ACCESS_TOKEN_TTL_MS, refreshExpiresAt.getTime()));
      const clientInfo = this.extractClientInfo(req);
      const accessTokenHash = hashToken(accessToken);
      const refreshTokenHash = hashToken(refreshToken);

      const sessionData = {
        sessionID,
        userID,
        tokenHash: accessTokenHash,
        refreshTokenHash,
        ipAddress: clientInfo.ipAddress,
        userAgent: clientInfo.userAgent,
        deviceInfo: clientInfo.deviceInfo,
        expiresAt,
        refreshExpiresAt,
        inactiveTimeout: policy.inactiveTimeoutMs // #914: from session.timeoutMinutes
      };

      const session = SessionModel.create(sessionData);
      // #914: createdAt is sessionStartedAt, the cap's anchor; pin it to the
      // same instant the cap was computed from.
      session.createdAt = now;
      
      // Salva no cache
      this.sessions.set(sessionID, session);
      
      // Salva no banco (opcional, para persistência)
      const sessionsCollection = db.collection('sessions');
      await sessionsCollection.insertOne(session);

      return session;
    } catch (error) {
      logger.error('Erro ao criar sessão:', error.message);
      throw error;
    }
  }

  /**
   * Atualiza a última atividade de uma sessão
   */
  async updateActivity(db, accessToken) {
    try {
      const accessTokenHash = hashToken(accessToken);

      // Busca sessão no cache
      let session = null;
      for (const [sessionID, sess] of this.sessions.entries()) {
        if (sess.tokenHash === accessTokenHash) {
          session = sess;
          break;
        }
      }

      // Se não encontrou no cache, busca no banco
      if (!session) {
        const sessionsCollection = db.collection('sessions');
        session = await sessionsCollection.findOne({ tokenHash: accessTokenHash });
        if (!session) {
          // Compatibilidade com sessões antigas que armazenavam token em texto plano
          session = await sessionsCollection.findOne({ token: accessToken });
        }
        
        if (session) {
          // Adiciona ao cache
          this.sessions.set(session.sessionID, session);
        }
      }

      if (!session) {
        return null;
      }

      // Verifica se a sessão ainda está ativa
      if (!SessionModel.isSessionActive(session)) {
        // #974: this is an inactivity/expiry eviction, not a revoke -- same
        // event cleanupExpiredSessions records, so it carries the same
        // 'expiration'/'system' pair. Without it, a session the clock killed
        // was byte-identical to one an administrator killed, which is the
        // whole subject of #974.
        await this.invalidateSession(db, session.sessionID, 'expiration', 'system');
        return null;
      }

      // Atualiza última atividade
      session.lastActivity = new Date();
      session.isActive = true;

      // Atualiza no cache
      this.sessions.set(session.sessionID, session);

      // Atualiza no banco
      try {
        const sessionsCollection = db.collection('sessions');
        await sessionsCollection.updateOne(
          { sessionID: session.sessionID },
          { $set: { lastActivity: session.lastActivity, isActive: true, updatedAt: new Date() } }
        );
      } catch (dbError) {
        logger.warn('Erro ao atualizar sessão no banco:', dbError.message);
      }

      return session;
    } catch (error) {
      logger.error('Erro ao atualizar atividade:', error.message);
      throw error;
    }
  }

  /**
   * Verifica se uma sessão está ativa
   */
  async verifySession(db, accessToken) {
    try {
      const accessTokenHash = hashToken(accessToken);

      // Busca no cache primeiro
      let session = null;
      for (const [sessionID, sess] of this.sessions.entries()) {
        if (sess.tokenHash === accessTokenHash) {
          session = sess;
          break;
        }
      }

      // Se não encontrou, busca no banco
      if (!session) {
        const sessionsCollection = db.collection('sessions');
        // #1005: the per-request lookup; ensured here so a process builds the
        // index on its first cache miss, not only once someone opens the audit list.
        ensureSessionIndexes(sessionsCollection);
        session = await sessionsCollection.findOne({ tokenHash: accessTokenHash });
        if (!session) {
          // Compatibilidade com sessões antigas
          session = await sessionsCollection.findOne({ token: accessToken });
        }
        
        if (session) {
          this.sessions.set(session.sessionID, session);
        }
      }

      if (!session) {
        return { valid: false, reason: 'session_not_found' };
      }

      if (session.isRevoked || session.revokedAt || session.isActive === false) {
        return { valid: false, reason: 'session_revoked' };
      }

      // Verifica se está ativa
      if (!SessionModel.isSessionActive(session)) {
        // #974: same expiry eviction as updateActivity above.
        await this.invalidateSession(db, session.sessionID, 'expiration', 'system');
        return { valid: false, reason: 'session_expired' };
      }

      return { valid: true, session };
    } catch (error) {
      logger.error('Erro ao verificar sessão:', error.message);
      return { valid: false, reason: 'error' };
    }
  }

  /**
   * #1020: one audit row per revocation event, written HERE rather than at
   * each of the ~14 call sites, so a new caller cannot forget it.
   *
   * The reason rides in `message` and the owner's pseudonym in `resourceId`,
   * never in `payload`: audit-v2's ingestLogRecord copies a fixed field set
   * into the tamper-evident chain and drops the rest (#1005's finding). The
   * pseudonym is kept out of `message` because sanitizeMessage's phone
   * pattern rewrites an all-digit USR-XXXXXXXX to "[telefone]".
   *
   * 'expiration' is audited while session.logExpiration is on (#1249, dict-02
   * P1X-0296), which is the default; #1020 had left it out as housekeeping.
   * It reaches here only when a session actually changed, so a stale session
   * hit by many requests writes one row. Nothing is written when no session
   * actually changed.
   *
   * The actor is `req`'s user when the caller has one, otherwise `revokedBy`
   * (a process name like 'system' is attributed to USR-SYSTEM). An audit
   * failure never undoes or fails the revocation.
   */
  async recordRevocationAudit(db, { reason, revokedBy = null, ownerID = null, count = 1, req = null } = {}) {
    if (!count) return;
    try {
      if (reason === 'expiration' && !(await resolveSessionPolicy(db)).logExpiration) return;
      const auditLogger = require('../utils/auditLogger');
      auditLogger.init(db);
      const actorReq = req
        || (revokedBy && revokedBy !== 'system' ? { user: { userID: String(revokedBy) } } : null);
      await auditLogger.log({
        action: 'UPDATE',
        resourceType: 'Session',
        resourceId: ownerID ? await getUserAnonId({ _id: String(ownerID) }, db) : null,
        status: 'success',
        severity: reason === 'risk' || reason === 'admin_action' ? 'warning' : 'info',
        message: `Sessão revogada: motivo ${reason || 'não informado'}; sessões afetadas ${count}`,
        req: actorReq,
        // source stays the default 'api': every audited revocation, an expiry
        // included, is found by an API request.
        module: 'Sessões',
      });
    } catch (error) {
      logger.warn('[SESSIONS][AUDIT] Falha ao auditar revogação de sessão (#1020): ' + (error?.message || error));
    }
  }

  /**
   * Invalida uma sessão
   */
  async invalidateSession(db, sessionID, reason = null, revokedBy = null, { req = null } = {}) {
    try {
      // Remove do cache
      const cachedOwner = this.sessions.get(sessionID)?.userID;
      this.sessions.delete(sessionID);

      // Marca como inativa no banco
      try {
        const sessionsCollection = db.collection('sessions');
        const result = await sessionsCollection.updateOne(
          { sessionID },
          { $set: { isActive: false, isRevoked: true, revokedAt: new Date(), revocationReason: reason, revokedBy: revokedBy == null ? revokedBy : String(revokedBy), updatedAt: new Date() } }
        );
        if (result?.modifiedCount) {
          const ownerID = cachedOwner
            ?? (await sessionsCollection.findOne({ sessionID }, { projection: { userID: 1 } }))?.userID;
          await this.recordRevocationAudit(db, { reason, revokedBy, ownerID, count: 1, req });
        }
      } catch (dbError) {
        logger.warn('Erro ao invalidar sessão no banco:', dbError.message);
      }
    } catch (error) {
      logger.error('Erro ao invalidar sessão:', error.message);
      throw error;
    }
  }

  /**
   * Invalida todas as sessões de um usuário
   */
  async invalidateUserSessions(db, userID, reason = null, revokedBy = null, { req = null } = {}) {
    try {
      // #963: coage como os irmãos (listUserSessions, revokeSessionById,
      // revokeAllOtherSessions) já fazem. O campo gravado é sempre string
      // -- Session.js faz String(data.userID), alimentado pelo
      // user._id.toString() de auth.service.js -- então receber um ObjectId
      // aqui não casava nada, não lançava nada, e deixava o chamador
      // devolver 200 sobre uma revogação que não aconteceu.
      const ownerID = String(userID);

      // Remove do cache
      for (const [sessionID, session] of this.sessions.entries()) {
        if (String(session.userID) === ownerID) {
          this.sessions.delete(sessionID);
        }
      }

      // Marca como inativas no banco
      try {
        const sessionsCollection = db.collection('sessions');
        const result = await sessionsCollection.updateMany(
          { userID: ownerID, isActive: true },
          { $set: { isActive: false, isRevoked: true, revokedAt: new Date(), revocationReason: reason, revokedBy: revokedBy == null ? revokedBy : String(revokedBy), updatedAt: new Date() } }
        );
        const count = (result && result.modifiedCount) || 0;
        await this.recordRevocationAudit(db, { reason, revokedBy, ownerID, count, req });
        // #1020: callers such as the admin revoke route report how many went.
        return count;
      } catch (dbError) {
        logger.warn('Erro ao invalidar sessões do usuário no banco:', dbError.message);
      }
      return 0;
    } catch (error) {
      logger.error('Erro ao invalidar sessões do usuário:', error.message);
      throw error;
    }
  }

  /**
   * Limpa sessões expiradas (tarefa de manutenção)
   */
  async cleanupExpiredSessions(db) {
    try {
      const now = new Date();
      const expiredSessions = [];

      // Limpa do cache
      for (const [sessionID, session] of this.sessions.entries()) {
        if (!SessionModel.isSessionActive(session)) {
          expiredSessions.push(sessionID);
          this.sessions.delete(sessionID);
        }
      }

      // Limpa do banco
      try {
        const sessionsCollection = db.collection('sessions');
        const swept = await sessionsCollection.updateMany(
          {
            $or: [
              { expiresAt: { $lt: now } },
              // #914: compare against each session's OWN inactiveTimeout. This was a
              // global 30-minute literal, so the maintenance sweep contradicted any
              // configured timeout -- a 45-minute policy still had its sessions evicted
              // at 30. $ifNull covers documents written before the field existed.
              {
                $expr: {
                  $lt: [
                    '$lastActivity',
                    {
                      $subtract: [
                        now,
                        { $ifNull: ['$inactiveTimeout', DEFAULT_INACTIVE_TIMEOUT_MS] }
                      ]
                    }
                  ]
                }
              }
            ],
            isActive: true
          },
          { $set: { isActive: false, isRevoked: true, revokedAt: new Date(), revocationReason: 'expiration', revokedBy: 'system', updatedAt: new Date() } }
        );
        await this.recordRevocationAudit(db, { reason: 'expiration', revokedBy: 'system', count: swept?.modifiedCount || 0 });
      } catch (dbError) {
        logger.warn('Erro ao limpar sessões expiradas no banco:', dbError.message);
      }

      return expiredSessions.length;
    } catch (error) {
      logger.error('Erro ao limpar sessões expiradas:', error.message);
      throw error;
    }
  }

  async listUserSessions(db, userID, currentAccessToken) {
    const sessionsCollection = db.collection('sessions');
    const currentHash = currentAccessToken ? hashToken(currentAccessToken) : null;

    const sessions = await sessionsCollection
      .find({
        userID: String(userID),
        isActive: true,
        isRevoked: { $ne: true }
      })
      .sort({ lastActivity: -1 })
      .toArray();

    return sessions.map((session) => ({
      id: session.sessionID,
      browser: session.deviceInfo?.browser || this.extractBrowser(session.userAgent),
      os: session.deviceInfo?.os || this.extractOS(session.userAgent),
      deviceName: session.deviceInfo?.deviceName || this.extractDeviceName(session.userAgent),
      ipAddress: session.ipAddress || 'N/A',
      location: session.ipAddress || 'N/A',
      lastAccess: session.lastActivity || session.createdAt,
      createdAt: session.createdAt,
      isCurrent: currentHash
        ? session.tokenHash === currentHash || (currentAccessToken && session.token === currentAccessToken)
        : false
    }));
  }

  async revokeSessionById(db, userID, sessionID, reason = null, revokedBy = null, { req = null } = {}) {
    const sessionsCollection = db.collection('sessions');

    const result = await sessionsCollection.updateOne(
      { userID: String(userID), sessionID, isActive: true },
      {
        $set: {
          isActive: false,
          isRevoked: true,
          revokedAt: new Date(),
          revocationReason: reason,
          revokedBy: revokedBy == null ? revokedBy : String(revokedBy),
          updatedAt: new Date()
        }
      }
    );

    if (result.matchedCount === 0) {
      return false;
    }

    this.sessions.delete(sessionID);
    await this.recordRevocationAudit(db, { reason, revokedBy, ownerID: userID, count: 1, req });
    return true;
  }

  // #649 / RF014 AC#8. Every other revoke helper here is scoped to ONE userID;
  // a policy change is global, so this is a new function rather than a new
  // argument on an existing one.
  //
  // Keeps the acting administrator's own session. revokeAllOtherSessions
  // established the keep-mine shape, and an admin who tightens session policy
  // and logs themselves out mid-configuration is a foreseeable self-lockout on
  // the only role that can undo it.
  async revokeAllSessionsForPolicyChange(db, exceptAccessToken, revokedBy, { req = null } = {}) {
    const sessionsCollection = db.collection('sessions');
    const exceptHash = hashToken(exceptAccessToken);

    const result = await sessionsCollection.updateMany(
      {
        isActive: true,
        $and: [
          { tokenHash: { $ne: exceptHash } },
          { token: { $ne: exceptAccessToken } }
        ]
      },
      {
        $set: {
          isActive: false,
          isRevoked: true,
          revokedAt: new Date(),
          // 'admin_action' rather than a new 'policy_change': P1X-0267 is a
          // CLOSED vocabulary in the owner's canonical dictionary, and a policy
          // change is an administrator acting. Extending that enum is a
          // dictionary amendment, not an implementation choice.
          revocationReason: 'admin_action',
          revokedBy: String(revokedBy || 'system'),
          updatedAt: new Date()
        }
      }
    );

    for (const [sid, session] of this.sessions.entries()) {
      if (session.tokenHash !== exceptHash && session.token !== exceptAccessToken) {
        this.sessions.delete(sid);
      }
    }

    const count = (result && result.modifiedCount) || 0;
    // Global: many owners, so no single owner pseudonym for resourceId.
    await this.recordRevocationAudit(db, { reason: 'admin_action', revokedBy: revokedBy || 'system', count, req });
    return count;
  }

  // #958: reason/revokedBy are optional and default to what this helper
  // hardcoded before, so its two existing callers (auth.routes DELETE
  // /sessions/all-others and user-security.service, per #920) are unchanged
  // byte for byte. The password-change paths pass 'password_change', which is
  // in P1X-0267's closed vocabulary and was previously unwritable here.
  // Refs #974, which added the same optional pair to the other three helpers
  // and deliberately left this one alone.
  async revokeAllOtherSessions(db, userID, currentAccessToken, reason = 'user_request', revokedBy = null, { req = null } = {}) {
    const sessionsCollection = db.collection('sessions');
    const currentHash = hashToken(currentAccessToken);

    const result = await sessionsCollection.updateMany(
      {
        userID: String(userID),
        isActive: true,
        $and: [
          { tokenHash: { $ne: currentHash } },
          { token: { $ne: currentAccessToken } }
        ]
      },
      {
        $set: {
          isActive: false,
          isRevoked: true,
          revokedAt: new Date(),
          revocationReason: reason,
          revokedBy: revokedBy === null ? String(userID) : String(revokedBy),
          updatedAt: new Date()
        }
      }
    );

    for (const [sid, session] of this.sessions.entries()) {
      if (
        String(session.userID) === String(userID) &&
        session.tokenHash !== currentHash &&
        session.token !== currentAccessToken
      ) {
        this.sessions.delete(sid);
      }
    }

    await this.recordRevocationAudit(db, {
      reason,
      revokedBy: revokedBy === null ? String(userID) : String(revokedBy),
      ownerID: userID,
      count: (result && result.modifiedCount) || 0,
      req,
    });
  }

  /**
   * #1005: the audit read path over sessions, revoked ones included, across
   * every user. listUserSessions and user-security's getSessions are both
   * self-scoped and drop revoked rows, so before this nothing could answer
   * "which sessions were revoked, when, by whom, and why".
   *
   * LGPD shaping, per dict-02 v2.0.0: the owner and the revoking actor leave
   * as the same USR-XXXX pseudonym the audit log uses (RNF009 AC#2), the IP is
   * masked (P1X-0256), and token hashes never leave. `revokedBy: 'system'`
   * stays literal, as it names a process, not a person.
   *
   * Filters: userId, revocationReason, isRevoked, isActive, from/to on
   * createdAt. Throws a 422-shaped error on an invalid one.
   */
  async listSessionsForAudit(db, filters = {}) {
    const sessionsCollection = db.collection('sessions');
    ensureSessionIndexes(sessionsCollection);

    const invalid = (message) => Object.assign(new Error(message), { statusCode: 422 });
    const query = {};

    // #1241, kept deliberately: a reader who knows a raw id can link it to its
    // pseudonym through this filter. Readers are administrators and auditors,
    // the controller's own audit function, and LGPD Art. 13 §4 defines
    // pseudonymisation as data that can be re-associated only with information
    // the controller keeps "em ambiente controlado e seguro". Pulling one
    // named account's sessions is what an audit of that account is.
    // log.service#getLogs takes the same raw filter for GET /api/logs.
    const userId = filters.userId || filters.userID;
    if (userId) query.userID = String(userId);

    if (filters.revocationReason) {
      if (!REVOCATION_REASONS.includes(filters.revocationReason)) {
        throw invalid(`revocationReason inválido. Use: ${REVOCATION_REASONS.join(', ')}`);
      }
      query.revocationReason = filters.revocationReason;
    }

    for (const flag of ['isRevoked', 'isActive']) {
      const raw = filters[flag];
      if (raw === undefined || raw === '') continue;
      if (raw !== true && raw !== false && raw !== 'true' && raw !== 'false') {
        throw invalid(`${flag} deve ser true ou false`);
      }
      const value = raw === true || raw === 'true';
      // Rows written before isRevoked existed carry no field; they were not revoked.
      query[flag] = flag === 'isRevoked' && !value ? { $ne: true } : value;
    }

    const range = {};
    for (const [key, op] of [['from', '$gte'], ['to', '$lte']]) {
      if (!filters[key]) continue;
      const date = new Date(filters[key]);
      if (Number.isNaN(date.getTime())) throw invalid(`${key} não é uma data válida`);
      range[op] = date;
    }
    if (Object.keys(range).length) query.createdAt = range;

    const requestedSort = typeof filters.sortBy === 'string' ? filters.sortBy.trim() : '';
    if (requestedSort && !AUDIT_SORTABLE_SESSION_FIELDS.has(requestedSort)) {
      throw invalid(`sortBy inválido. Use: ${[...AUDIT_SORTABLE_SESSION_FIELDS].join(', ')}`);
    }
    const sortField = requestedSort || 'createdAt';
    const sortOrder = filters.sortOrder === 'asc' ? 1 : -1;

    const limit = Math.min(Math.max(parseInt(filters.limit, 10) || 50, 1), AUDIT_SESSION_MAX_LIMIT);
    const page = Math.max(parseInt(filters.page, 10) || 1, 1);
    const skip = (page - 1) * limit;

    const [rows, total] = await Promise.all([
      sessionsCollection
        .find(query, { projection: { tokenHash: 0, refreshTokenHash: 0, token: 0, refreshToken: 0, sessionID: 0 } })
        // One literal per allow-listed key, so the sort-keys guard can follow
        // every branch. No _id tiebreak: {createdAt:-1} serves a createdAt
        // sort only as the sole key.
        .sort(sortField === 'revokedAt' ? { revokedAt: sortOrder }
          : sortField === 'lastActivity' ? { lastActivity: sortOrder }
            : { createdAt: sortOrder })
        .skip(skip)
        .limit(limit)
        .toArray(),
      sessionsCollection.countDocuments(query),
    ]);

    const anonIds = new Map();
    const anon = async (id) => {
      const key = String(id);
      if (!anonIds.has(key)) anonIds.set(key, await getUserAnonId({ _id: key }, db));
      return anonIds.get(key);
    };

    const sessions = [];
    for (const session of rows) {
      const revokedBy = session.revokedBy == null
        ? null
        : session.revokedBy === 'system' ? 'system' : await anon(session.revokedBy);
      sessions.push({
        // Not sessionID: that is `session_<userID>_<ms>` and would carry the
        // raw owner id straight past the pseudonym. The document _id is opaque.
        id: session._id != null ? String(session._id) : null,
        user: session.userID ? await anon(session.userID) : 'USR-SYSTEM',
        ipAddress: maskIpAddress(session.ipAddress),
        browser: session.deviceInfo?.browser || this.extractBrowser(session.userAgent),
        os: session.deviceInfo?.os || this.extractOS(session.userAgent),
        deviceType: session.deviceInfo?.type || null,
        createdAt: session.createdAt || null,
        lastActivity: session.lastActivity || null,
        expiresAt: session.expiresAt || null,
        isActive: session.isActive === true,
        isRevoked: session.isRevoked === true,
        revokedAt: session.revokedAt || null,
        revokedBy,
        revocationReason: session.revocationReason || null,
      });
    }

    return {
      sessions,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      sortBy: sortField,
      sortOrder: sortOrder === 1 ? 'asc' : 'desc',
    };
  }

  async getSessionByRefreshToken(db, refreshToken) {
    const sessionsCollection = db.collection('sessions');
    const refreshTokenHash = hashToken(refreshToken);

    return sessionsCollection.findOne({
      refreshTokenHash,
      isActive: true,
      isRevoked: { $ne: true },
      refreshExpiresAt: { $gt: new Date() }
    });
  }

  async rotateSessionTokens(db, sessionID, nextAccessToken, nextRefreshToken, session = null) {
    const sessionsCollection = db.collection('sessions');
    const now = new Date();

    // #914: rotation may shorten refreshExpiresAt, never extend it -- that
    // field carries the absolute cap set at createSession. The caller hands us
    // the document getSessionByRefreshToken already read; the findOne covers
    // any other caller. A document with no ceiling keeps the old sliding window
    // rather than failing a refresh on a missing field.
    const current = session || await sessionsCollection.findOne({ sessionID });
    const slidingRefreshMs = now.getTime() + REFRESH_TOKEN_TTL_MS;
    const ceilingMs = current && current.refreshExpiresAt ? new Date(current.refreshExpiresAt).getTime() : NaN;
    const refreshExpiresAtMs = Number.isFinite(ceilingMs) ? Math.min(slidingRefreshMs, ceilingMs) : slidingRefreshMs;

    const update = {
      tokenHash: hashToken(nextAccessToken),
      refreshTokenHash: hashToken(nextRefreshToken),
      lastActivity: now,
      updatedAt: now,
      expiresAt: new Date(Math.min(now.getTime() + ACCESS_TOKEN_TTL_MS, refreshExpiresAtMs)),
      refreshExpiresAt: new Date(refreshExpiresAtMs),
      isActive: true,
      isRevoked: false,
      revokedAt: null,
      // #974: 4d6807c8 added revocationReason/revokedBy but did not extend
      // this reset, so a rotated session kept a stale reason beside
      // isRevoked: false. Unreachable via the only caller --
      // getSessionByRefreshToken filters isRevoked: { $ne: true } -- so this
      // is closing the gap fail-closed, not fixing live behaviour.
      revocationReason: null,
      revokedBy: null
    };

    await sessionsCollection.updateOne({ sessionID }, { $set: update });

    const cached = this.sessions.get(sessionID) || {};
    this.sessions.set(sessionID, { ...cached, sessionID, ...update });
  }
}

module.exports = new SessionService();

