const SessionModel = require('../models/Session');
const logger = require('../utils/logger');
const crypto = require('crypto');

const ACCESS_TOKEN_TTL_MS = 15 * 60 * 1000;
const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

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

async function resolveInactiveTimeoutMs(db) {
  try {
    const config = await db.collection('security_config').findOne({ _id: 'main' });
    const minutes = Number(config && config.session && config.session.timeoutMinutes);
    if (Number.isFinite(minutes) && minutes > 0) {
      return minutes * 60 * 1000;
    }
  } catch (error) {
    logger.warn('#914: política de sessão ilegível, usando 30 min:', error.message);
  }
  return DEFAULT_INACTIVE_TIMEOUT_MS;
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
      const expiresAt = new Date(now.getTime() + ACCESS_TOKEN_TTL_MS);
      const refreshExpiresAt = new Date(now.getTime() + REFRESH_TOKEN_TTL_MS);
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
        inactiveTimeout: await resolveInactiveTimeoutMs(db) // #914: from session.timeoutMinutes
      };

      const session = SessionModel.create(sessionData);
      
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
   * Invalida uma sessão
   */
  async invalidateSession(db, sessionID, reason = null, revokedBy = null) {
    try {
      // Remove do cache
      this.sessions.delete(sessionID);

      // Marca como inativa no banco
      try {
        const sessionsCollection = db.collection('sessions');
        await sessionsCollection.updateOne(
          { sessionID },
          { $set: { isActive: false, isRevoked: true, revokedAt: new Date(), revocationReason: reason, revokedBy: revokedBy == null ? revokedBy : String(revokedBy), updatedAt: new Date() } }
        );
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
  async invalidateUserSessions(db, userID, reason = null, revokedBy = null) {
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
        await sessionsCollection.updateMany(
          { userID: ownerID, isActive: true },
          { $set: { isActive: false, isRevoked: true, revokedAt: new Date(), revocationReason: reason, revokedBy: revokedBy == null ? revokedBy : String(revokedBy), updatedAt: new Date() } }
        );
      } catch (dbError) {
        logger.warn('Erro ao invalidar sessões do usuário no banco:', dbError.message);
      }
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
        await sessionsCollection.updateMany(
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

  async revokeSessionById(db, userID, sessionID, reason = null, revokedBy = null) {
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
  async revokeAllSessionsForPolicyChange(db, exceptAccessToken, revokedBy) {
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

    return (result && result.modifiedCount) || 0;
  }

  // #958: reason/revokedBy are optional and default to what this helper
  // hardcoded before, so its two existing callers (auth.routes DELETE
  // /sessions/all-others and user-security.service, per #920) are unchanged
  // byte for byte. The password-change paths pass 'password_change', which is
  // in P1X-0267's closed vocabulary and was previously unwritable here.
  // Refs #974, which added the same optional pair to the other three helpers
  // and deliberately left this one alone.
  async revokeAllOtherSessions(db, userID, currentAccessToken, reason = 'user_request', revokedBy = null) {
    const sessionsCollection = db.collection('sessions');
    const currentHash = hashToken(currentAccessToken);

    await sessionsCollection.updateMany(
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

  async rotateSessionTokens(db, sessionID, nextAccessToken, nextRefreshToken) {
    const sessionsCollection = db.collection('sessions');
    const now = new Date();

    const update = {
      tokenHash: hashToken(nextAccessToken),
      refreshTokenHash: hashToken(nextRefreshToken),
      lastActivity: now,
      updatedAt: now,
      expiresAt: new Date(now.getTime() + ACCESS_TOKEN_TTL_MS),
      refreshExpiresAt: new Date(now.getTime() + REFRESH_TOKEN_TTL_MS),
      isActive: true,
      isRevoked: false,
      revokedAt: null
    };

    await sessionsCollection.updateOne({ sessionID }, { $set: update });

    const cached = this.sessions.get(sessionID) || {};
    this.sessions.set(sessionID, { ...cached, sessionID, ...update });
  }
}

module.exports = new SessionService();

