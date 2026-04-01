const SessionModel = require('../models/Session');
const logger = require('../utils/logger');

/**
 * Service de Sessão
 * Gerencia sessões de usuário com controle de atividade
 */
class SessionService {
  constructor() {
    // Cache in-memory de sessões (em produção, pode usar Redis)
    this.sessions = new Map();
  }

  /**
   * Cria uma nova sessão
   */
  async createSession(db, userID, token, expiresIn = '12h') {
    try {
      const sessionID = `session_${userID}_${Date.now()}`;
      const expiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000); // 12 horas

      const sessionData = {
        sessionID,
        userID,
        token,
        expiresAt,
        inactiveTimeout: 30 * 60 * 1000 // 30 minutos
      };

      const session = SessionModel.create(sessionData);
      
      // Salva no cache
      this.sessions.set(sessionID, session);
      
      // Salva no banco (opcional, para persistência)
      try {
        const sessionsCollection = db.collection('sessions');
        await sessionsCollection.insertOne(session);
      } catch (dbError) {
        logger.warn('Erro ao salvar sessão no banco (usando apenas cache):', dbError.message);
      }

      return session;
    } catch (error) {
      logger.error('Erro ao criar sessão:', error.message);
      throw error;
    }
  }

  /**
   * Atualiza a última atividade de uma sessão
   */
  async updateActivity(db, token) {
    try {
      // Busca sessão no cache
      let session = null;
      for (const [sessionID, sess] of this.sessions.entries()) {
        if (sess.token === token) {
          session = sess;
          break;
        }
      }

      // Se não encontrou no cache, busca no banco
      if (!session) {
        const sessionsCollection = db.collection('sessions');
        session = await sessionsCollection.findOne({ token });
        
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
          { $set: { lastActivity: session.lastActivity, isActive: true } }
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
  async verifySession(db, token) {
    try {
      // Busca no cache primeiro
      let session = null;
      for (const [sessionID, sess] of this.sessions.entries()) {
        if (sess.token === token) {
          session = sess;
          break;
        }
      }

      // Se não encontrou, busca no banco
      if (!session) {
        const sessionsCollection = db.collection('sessions');
        session = await sessionsCollection.findOne({ token });
        
        if (session) {
          this.sessions.set(session.sessionID, session);
        }
      }

      if (!session) {
        return { valid: false, reason: 'session_not_found' };
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
          { $set: { isActive: false } }
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
      // Remove do cache
      for (const [sessionID, session] of this.sessions.entries()) {
        if (session.userID === userID) {
          this.sessions.delete(sessionID);
        }
      }

      // Marca como inativas no banco
      try {
        const sessionsCollection = db.collection('sessions');
        await sessionsCollection.updateMany(
          { userID, isActive: true },
          { $set: { isActive: false } }
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
          { $set: { isActive: false } }
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
}

module.exports = new SessionService();

