/**
 * Modelo de Sessão para controle de atividade do usuário
 */
class SessionModel {
  static create(data) {
    return {
      sessionID: data.sessionID || null,
      userID: data.userID,
      token: data.token,
      lastActivity: new Date(),
      createdAt: new Date(),
      expiresAt: data.expiresAt || new Date(Date.now() + 12 * 60 * 60 * 1000), // 12 horas
      inactiveTimeout: data.inactiveTimeout || 30 * 60 * 1000, // 30 minutos em ms
      isActive: true
    };
  }

  static validate(data) {
    const errors = [];

    if (!data.userID) {
      errors.push('userID é obrigatório');
    }

    if (!data.token) {
      errors.push('token é obrigatório');
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * Verifica se a sessão está ativa (não expirou e não está inativa)
   */
  static isSessionActive(session) {
    if (!session || !session.isActive) {
      return false;
    }

    const now = new Date();
    
    // Verifica expiração por tempo total
    if (session.expiresAt && new Date(session.expiresAt) < now) {
      return false;
    }

    // Verifica expiração por inatividade
    const inactiveTime = now.getTime() - new Date(session.lastActivity).getTime();
    if (inactiveTime > session.inactiveTimeout) {
      return false;
    }

    return true;
  }
}

module.exports = SessionModel;

