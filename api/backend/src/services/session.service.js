const SessionModel = require('../models/Session');
const logger = require('../utils/logger');
const crypto = require('crypto');

const ACCESS_TOKEN_TTL_MS = 15 * 60 * 1000;
const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
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
        inactiveTimeout: 30 * 60 * 1000 // 30 minutos
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
        await this.invalidateSession(db, session.sessionID);
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
        await this.invalidateSession(db, session.sessionID);
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
  async invalidateSession(db, sessionID) {
    try {
      // Remove do cache
      this.sessions.delete(sessionID);

      // Marca como inativa no banco
      try {
        const sessionsCollection = db.collection('sessions');
        await sessionsCollection.updateOne(
          { sessionID },
          { $set: { isActive: false, isRevoked: true, revokedAt: new Date(), updatedAt: new Date() } }
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
  async invalidateUserSessions(db, userID) {
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
          { $set: { isActive: false, isRevoked: true, revokedAt: new Date(), updatedAt: new Date() } }
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
              { lastActivity: { $lt: new Date(now.getTime() - 30 * 60 * 1000) } }
            ],
            isActive: true
          },
          { $set: { isActive: false, isRevoked: true, revokedAt: new Date(), updatedAt: new Date() } }
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

  async revokeSessionById(db, userID, sessionID) {
    const sessionsCollection = db.collection('sessions');

    const result = await sessionsCollection.updateOne(
      { userID: String(userID), sessionID, isActive: true },
      {
        $set: {
          isActive: false,
          isRevoked: true,
          revokedAt: new Date(),
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

  async revokeAllOtherSessions(db, userID, currentAccessToken) {
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

