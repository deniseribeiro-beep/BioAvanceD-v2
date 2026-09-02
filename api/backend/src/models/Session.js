/**
 * Modelo de Sessão para controle de atividade do usuário
 */
class SessionModel {
  static create(data) {
    return {
      sessionID: data.sessionID || null,
      userID: String(data.userID),
      tokenHash: data.tokenHash,
      refreshTokenHash: data.refreshTokenHash,
      userAgent: data.userAgent || null,
      ipAddress: data.ipAddress || null,
      deviceInfo: data.deviceInfo || null,
      lastActivity: new Date(),
      createdAt: new Date(),
      expiresAt: data.expiresAt || new Date(Date.now() + 12 * 60 * 60 * 1000), // 12 horas
      refreshExpiresAt: data.refreshExpiresAt || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      inactiveTimeout: data.inactiveTimeout || 30 * 60 * 1000, // 30 minutos em ms
      isActive: true,
      isRevoked: false,
      revokedAt: null,
      revokedBy: null,
      revocationReason: null,
      updatedAt: new Date()
    };
  }

  static validate(data) {
    const errors = [];

    if (!data.userID) {
      errors.push('userID é obrigatório');
    }

    if (!data.tokenHash) {
      errors.push('tokenHash é obrigatório');
    }

    if (!data.refreshTokenHash) {
      errors.push('refreshTokenHash é obrigatório');
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
    if (!session || !session.isActive || session.isRevoked) {
      return false;
    }

    const now = new Date();
    
    // Verifica expiração por tempo total
    if (session.expiresAt && new Date(session.expiresAt) < now) {
      return false;
    }

    if (session.refreshExpiresAt && new Date(session.refreshExpiresAt) < now) {
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

