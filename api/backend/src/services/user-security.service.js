const bcrypt = require('bcryptjs');
const speakeasy = require('speakeasy');
const logger = require('../utils/logger');
const { ObjectId } = require('mongodb');
const { hashToken } = require('../utils/tokenHash');

/**
 * Service de Segurança do Usuário
 * Gerencia configurações de segurança pessoais do usuário
 */
class UserSecurityService {
  /**
   * Calcula o score de segurança da conta
   */
  calculateSecurityScore(user, mfaMethods, passwordStatus) {
    let score = 0;
    
    // MFA primário ativo: +40 pontos
    if (user.mfaEnabled) {
      score += 40;
    }
    
    // Códigos de recuperação disponíveis: +10 pontos
    const alternativeCount = (mfaMethods.recoveryCodes?.remaining || 0) > 0 ? 1 : 0;
    score += Math.min(alternativeCount * 10, 20);
    
    // Senha forte: +20 pontos
    if (passwordStatus.strength === 'strong') {
      score += 20;
    } else if (passwordStatus.strength === 'medium') {
      score += 15;
    } else {
      score += 10;
    }
    
    // Senha não expirada: +10 pontos
    if (passwordStatus.expiresAt) {
      const daysUntilExpiration = Math.ceil(
        (new Date(passwordStatus.expiresAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
      );
      if (daysUntilExpiration > 10) {
        score += 10;
      }
    } else {
      score += 10;
    }
    
    // Recovery codes disponíveis: +10 pontos
    if ((mfaMethods.recoveryCodes?.remaining || 0) >= 5) {
      score += 10;
    }
    
    return Math.min(score, 100);
  }

  /**
   * Obtém status geral de segurança
   */
  async getSecurityStatus(db, userID) {
    try {
      const usersCollection = db.collection('users');
      const user = await usersCollection.findOne({ _id: new ObjectId(userID) });
      
      if (!user) {
        throw new Error('Usuário não encontrado');
      }

      // Busca métodos MFA
      const mfaMethods = await this.getMFAStatus(db, userID);
      
      // Busca status da senha
      const passwordStatus = await this.getPasswordStatus(db, userID);
      
      // Calcula score
      const securityScore = this.calculateSecurityScore(user, mfaMethods, passwordStatus);
      
      const overallLevel = securityScore >= 80 ? 'strong' : securityScore >= 50 ? 'medium' : 'weak';
      
      const alternativeMethodsCount = (mfaMethods.recoveryCodes?.remaining || 0) > 0 ? 1 : 0;
      
      return {
        securityScore,
        overallLevel,
        alternativeMethodsCount
      };
    } catch (error) {
      logger.error('Erro ao obter status de segurança:', error.message);
      throw error;
    }
  }

  /**
   * Obtém status do MFA
   */
  async getMFAStatus(db, userID) {
    try {
      const usersCollection = db.collection('users');
      const user = await usersCollection.findOne({ _id: new ObjectId(userID) });
      
      if (!user) {
        throw new Error('Usuário não encontrado');
      }

      // Busca recovery codes
      const recoveryCodesCollection = db.collection('recovery_codes');
      const recoveryCodes = await recoveryCodesCollection.findOne({ userID: new ObjectId(userID) });
      
      return {
        primaryEnabled: user.mfaEnabled || false,
        primarySetupDate: user.mfaSetupDate || null,
        recoveryCodes: {
          remaining: recoveryCodes?.remaining || 0,
          codes: null // Nunca retorna códigos em listagem
        }
      };
    } catch (error) {
      logger.error('Erro ao obter status MFA:', error.message);
      throw error;
    }
  }

  /**
   * Mascara número de telefone
   */
  maskPhone(phone) {
    if (!phone) return null;
    const cleaned = phone.toString().replace(/\D/g, '');
    if (cleaned.length < 10) return phone;
    
    if (cleaned.length === 11) {
      // +55 (11) 99999-9999
      return `+55 (${cleaned.substring(0, 2)}) ${cleaned.substring(2, 7)}-${cleaned.substring(7)}`;
    } else if (cleaned.length === 10) {
      // (11) 9999-9999
      return `(${cleaned.substring(0, 2)}) ${cleaned.substring(2, 6)}-${cleaned.substring(6)}`;
    }
    return phone;
  }

  /**
   * Obtém status da senha
   */
  async getPasswordStatus(db, userID) {
    try {
      const usersCollection = db.collection('users');
      const user = await usersCollection.findOne({ _id: new ObjectId(userID) });
      
      if (!user) {
        throw new Error('Usuário não encontrado');
      }

      // Calcula força da senha (baseado em políticas)
      const strength = this.calculatePasswordStrength(user.password);
      const strengthScore = strength === 'strong' ? 5 : strength === 'medium' ? 3 : 1;
      
      // #1251: the policy's expirationDays and the same anchor login uses
      // (passwordChangedAt, then the pre-rename lastPasswordChange, then
      // createdAt). 0 days means no expiry, reported as null.
      const passwordService = require('./password.service');
      const policy = await passwordService.resolvePasswordPolicy(db);
      const lastChanged = passwordService.passwordChangedAt(user) || new Date();
      const expiresAt = policy.expirationDays === 0
        ? null
        : new Date(lastChanged.getTime() + policy.expirationDays * 24 * 60 * 60 * 1000);
      
      return {
        lastChanged: lastChanged,
        expiresAt: expiresAt,
        strength: strength,
        strengthScore: strengthScore
      };
    } catch (error) {
      logger.error('Erro ao obter status da senha:', error.message);
      throw error;
    }
  }

  /**
   * Calcula força da senha (estimativa baseada em hash)
   */
  calculatePasswordStrength(password) {
    // Como não temos a senha original, assumimos que se passou pela validação é forte
    // Em produção, isso deveria ser calculado no momento da criação da senha
    if (!password) return 'weak';
    
    // Se o hash é longo (bcrypt/argon2), assume senha forte
    // Bcrypt gera hashes de 60 caracteres
    if (password.length >= 60) {
      return 'strong';
    }
    return 'medium';
  }

  /**
   * Obtém sessões ativas do usuário
   */
  async getSessions(db, userID, currentToken, requestInfo = null) {
    try {
      const sessionsCollection = db.collection('sessions');
      
      // Busca sessões no banco
      const dbSessions = await sessionsCollection.find({
        userID: userID.toString(),
        isActive: true
      }).sort({ lastActivity: -1 }).toArray();
      
      // Se não houver sessões no banco, tenta buscar do cache do sessionService
      let sessions = dbSessions;
      if (sessions.length === 0) {
        // Busca do cache do sessionService
        const sessionService = require('./session.service');
        const cacheSessions = Array.from(sessionService.sessions.values())
          .filter(s => s.userID === userID.toString() && s.isActive);
        sessions = cacheSessions;
      }
      
      // Busca informações do user-agent e IP de cada sessão
      const sessionsWithDetails = sessions.map(session => {
        // Tenta obter user-agent do sessionData ou metadata
        const userAgent = session.sessionData?.userAgent || 
                         session.metadata?.userAgent || 
                         session.userAgent || 
                         requestInfo?.userAgent ||
                         null;
        const ip = session.sessionData?.ip || 
                  session.metadata?.ip || 
                  session.ip || 
                  requestInfo?.ip ||
                  null;
        
        const isCurrent = session.token === currentToken;
        
        return {
          id: session.sessionID || session._id?.toString() || `session_${Date.now()}`,
          deviceName: this.extractDeviceName(userAgent),
          browser: this.extractBrowser(userAgent),
          os: this.extractOS(userAgent),
          location: this.getLocationFromIP(ip),
          lastAccess: session.lastActivity || session.createdAt || new Date(),
          isCurrent: isCurrent
        };
      });
      
      // Se não houver sessões, retorna pelo menos a sessão atual
      if (sessionsWithDetails.length === 0 && currentToken) {
        const currentUserAgent = requestInfo?.userAgent || null;
        return [{
          id: 'current',
          deviceName: this.extractDeviceName(currentUserAgent) || 'Dispositivo Atual',
          browser: this.extractBrowser(currentUserAgent) || 'Desconhecido',
          os: this.extractOS(currentUserAgent) || 'Desconhecido',
          location: this.getLocationFromIP(requestInfo?.ip || null),
          lastAccess: new Date(),
          isCurrent: true
        }];
      }
      
      return sessionsWithDetails;
    } catch (error) {
      logger.error('Erro ao obter sessões:', error.message);
      throw error;
    }
  }

  /**
   * Extrai nome do dispositivo do user-agent
   */
  extractDeviceName(userAgent) {
    if (!userAgent) return 'Dispositivo Desconhecido';
    
    // Tenta identificar dispositivo
    if (userAgent.includes('Mobile') || userAgent.includes('Android') || userAgent.includes('iPhone')) {
      return 'Dispositivo Móvel';
    }
    if (userAgent.includes('Windows')) {
      return 'Windows';
    }
    if (userAgent.includes('Mac')) {
      return 'Mac';
    }
    if (userAgent.includes('Linux')) {
      return 'Linux';
    }
    return 'Computador';
  }

  /**
   * Extrai navegador do user-agent
   */
  extractBrowser(userAgent) {
    if (!userAgent) return 'Desconhecido';
    
    if (userAgent.includes('Chrome') && !userAgent.includes('Edg')) {
      return 'Chrome';
    }
    if (userAgent.includes('Firefox')) {
      return 'Firefox';
    }
    if (userAgent.includes('Safari') && !userAgent.includes('Chrome')) {
      return 'Safari';
    }
    if (userAgent.includes('Edg')) {
      return 'Edge';
    }
    return 'Desconhecido';
  }

  /**
   * Extrai SO do user-agent
   */
  extractOS(userAgent) {
    if (!userAgent) return 'Desconhecido';
    
    if (userAgent.includes('Windows')) {
      if (userAgent.includes('Windows NT 10.0')) return 'Windows 10/11';
      if (userAgent.includes('Windows NT 6.3')) return 'Windows 8.1';
      if (userAgent.includes('Windows NT 6.2')) return 'Windows 8';
      return 'Windows';
    }
    if (userAgent.includes('Mac OS X')) {
      return 'macOS';
    }
    if (userAgent.includes('Android')) {
      return 'Android';
    }
    if (userAgent.includes('Linux')) {
      return 'Linux';
    }
    if (userAgent.includes('iPhone') || userAgent.includes('iPad')) {
      return 'iOS';
    }
    return 'Desconhecido';
  }

  /**
   * Obtém localização aproximada do IP (simplificado)
   */
  getLocationFromIP(ip) {
    if (!ip) return null;
    
    // Em produção, isso poderia usar um serviço de geolocalização
    // Por enquanto, retorna apenas o IP mascarado
    if (ip.includes('::1') || ip.includes('127.0.0.1') || ip.includes('localhost')) {
      return 'Local';
    }
    
    // Mascara IP para privacidade (mostra apenas primeiros octetos)
    const parts = ip.split('.');
    if (parts.length === 4) {
      return `${parts[0]}.${parts[1]}.xxx.xxx`;
    }
    
    return 'Desconhecido';
  }

  /**
   * Obtém atividades recentes do usuário
   */
  async getActivities(db, userID, limit = 20) {
    try {
      const auditLogsCollection = db.collection('audit_logs');
      const userAnonId = await this.getUserAnonId(db, userID);
      
      // Busca logs do usuário (pode ser por userAnonId ou userID direto)
      const activities = await auditLogsCollection.find({
        $or: [
          { userAnonId: userAnonId },
          { userID: userID.toString() },
          { 'metadata.userID': userID.toString() }
        ]
      })
      .sort({ timestamp: -1 })
      .limit(limit)
      .toArray();
      
      return activities.map(log => {
        let type = 'login';
        let description = log.message || 'Ação realizada';
        
        if (log.message?.includes('login') || log.message?.includes('Login') || log.action === 'LOGIN') {
          type = 'login';
          description = 'Login realizado com sucesso';
        } else if (log.message?.includes('MFA') || log.message?.includes('mfa') || log.entity === 'MFA') {
          type = 'mfa_change';
          description = 'Configuração MFA alterada';
        } else if (log.message?.includes('senha') || log.message?.includes('password') || log.message?.includes('Password') || log.entity === 'Password') {
          type = 'password_change';
          description = 'Senha alterada';
        } else if (log.severity === 'warning' || log.severity === 'critical') {
          type = 'suspicious';
          description = 'Atividade suspeita detectada';
        } else if (log.result === 'error' || log.result === 'failure') {
          type = 'failed_attempt';
          description = 'Tentativa falha';
        }
        
        // Extrai IP do log
        const ip = log.ip || log.metadata?.ip || log.requestInfo?.ip || null;
        
        return {
          type: type,
          description: description,
          timestamp: log.timestamp || log.createdAt || new Date(),
          location: this.getLocationFromIP(ip)
        };
      });
    } catch (error) {
      logger.error('Erro ao obter atividades:', error.message);
      throw error;
    }
  }

  /**
   * Obtém userAnonId do usuário
   */
  async getUserAnonId(db, userID) {
    try {
      const { getUserAnonId } = require('../utils/userAnonymization');
      const user = { _id: userID };
      return await getUserAnonId(user, db);
    } catch (error) {
      logger.error('Erro ao obter userAnonId:', error.message);
      throw error;
    }
  }

  /**
   * Atualiza senha do usuário
   */
  async updatePassword(db, userID, currentPassword, newPassword) {
    try {
      const usersCollection = db.collection('users');
      const user = await usersCollection.findOne({ _id: new ObjectId(userID) });
      
      if (!user) {
        throw new Error('Usuário não encontrado');
      }

      // #995 (RF001 AC#2): the FIFTH site verifying a user-supplied password
      // with its own bcrypt.compare. This one is a second, independent
      // change-password implementation -- PUT /api/user-security/password,
      // reached from UserSecurityPage -- and unlike auth.controller's it did not
      // even zero failedLoginAttempts, so it neither counted up nor cleared.
      //
      // Required lazily, matching this file's own style for cross-service
      // requires (sessionService below does the same); auth.service pulls in
      // speakeasy/QRCode/jwt and there is no reason to load them at module load.
      const authService = require('./auth.service');

      // The gate runs before the compare, for the same reason as at the other
      // four sites -- after it, a lock denies only the eventual correct guess
      // while every wrong one still burns a bcrypt round. This route is
      // authenticated and takes its subject from the caller's own userID, so the
      // message stays this route's own rather than the generic one the two
      // unauthenticated sites must use.
      if (authService.isAccountLocked(user)) {
        throw new Error('Senha atual incorreta');
      }

      // Valida senha atual
      const isCurrentPasswordValid = await bcrypt.compare(currentPassword, user.password);
      if (!isCurrentPasswordValid) {
        await authService.recordFailedPasswordAttempt(db, usersCollection, user);
        throw new Error('Senha atual incorreta');
      }

      // #1244: reuse follows passwordRules through the one shared check.
      // This site used to compare every stored hash but never the current
      // password, and kept 5 where the others kept 3. Its own message is
      // kept, since UserSecurityPage shows it.
      const passwordService = require('./password.service');
      const passwordPolicy = await passwordService.resolvePasswordPolicy(db);
      // #1246: the policy's strength rules, as every other password write
      // checks them; this site had its own 12-character validator.
      passwordService.validateStrength(newPassword, passwordPolicy);
      try {
        await passwordService.validateReuse(newPassword, user, passwordPolicy);
      } catch (reuseError) {
        throw new Error('Você não pode reutilizar uma senha recente');
      }

      // Hash da nova senha
      const saltRounds = 12;
      const newPasswordHash = await bcrypt.hash(newPassword, saltRounds);

      // Atualiza senha e histórico
      const newPasswordHistory = passwordService.nextPasswordHistory(user, passwordPolicy);
      
      await usersCollection.updateOne(
        { _id: new ObjectId(userID) },
        {
          $set: {
            password: newPasswordHash,
            passwordHistory: newPasswordHistory,
            passwordChangedAt: new Date(),
            // #1250: the owner replaced it, which is what forceReset asks
            // for; auth.controller's changePassword clears it the same way.
            forceReset: false,
            // #995: a successful change clears the counter AND the lock, the
            // same pairing processLogin's success path uses. This site cleared
            // neither, so it could only ever count up.
            ...authService.clearedLockoutFields(),
            updatedAt: new Date()
          }
        }
      );
    } catch (error) {
      logger.error('Erro ao atualizar senha:', error.message);
      throw error;
    }
  }

  /**
   * Gera códigos de recuperação
   */
  async generateRecoveryCodes(db, userID) {
    try {
      const recoveryCodesCollection = db.collection('recovery_codes');
      
      // Gera 10 códigos únicos
      const codes = [];
      for (let i = 0; i < 10; i++) {
        const code = this.generateRecoveryCode();
        codes.push(code);
      }
      
      // Hash dos códigos antes de salvar
      const hashedCodes = await Promise.all(
        codes.map(code => bcrypt.hash(code, 10))
      );
      
      // Remove códigos antigos e salva novos
      await recoveryCodesCollection.updateOne(
        { userID: new ObjectId(userID) },
        {
          $set: {
            codes: hashedCodes,
            remaining: 10,
            usedCodes: [],
            createdAt: new Date(),
            updatedAt: new Date()
          }
        },
        { upsert: true }
      );
      
      // Retorna códigos em texto claro apenas uma vez
      return codes;
    } catch (error) {
      logger.error('Erro ao gerar códigos de recuperação:', error.message);
      throw error;
    }
  }

  /**
   * Gera um código de recuperação único
   */
  generateRecoveryCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Remove I, O, 0, 1 para evitar confusão
    let code = '';
    for (let i = 0; i < 8; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  }

  /**
   * Revoga uma sessão específica
   */
  async revokeSession(db, userID, sessionId) {
    try {
      const sessionsCollection = db.collection('sessions');
      const { ObjectId } = require('mongodb');

      // Suporta documentos que usam sessionID ou apenas _id
      const query = {
        userID: userID.toString(),
        $or: [
          { sessionID: sessionId }
        ]
      };
      if (ObjectId.isValid(sessionId)) {
        query.$or.push({ _id: new ObjectId(sessionId) });
      }

      const result = await sessionsCollection.updateOne(
        query,
        {
          $set: {
            isActive: false,
            isRevoked: true,
            revokedAt: new Date(),
            revocationReason: 'user_request',
            revokedBy: String(userID),
            // #974: every other session-revoke write in the tree sets this
            // (session.service.js :217 :295 :331 :385 :438 :482 :523); this
            // one did not, so a revocation through this route was invisible
            // to any "when was this session document last touched" query.
            updatedAt: new Date()
          }
        }
      );
      
      if (result.matchedCount === 0) {
        throw new Error('Sessão não encontrada');
      }

      // Limpa cache em memória do sessionService
      const sessionService = require('./session.service');
      if (sessionService.sessions) {
        // Tenta remover pelo sessionID; se não existir, remove pela correspondência de _id
        if (!sessionService.sessions.delete(sessionId)) {
          for (const [sid, s] of sessionService.sessions.entries()) {
            if (sid === sessionId || s.sessionID === sessionId || (s._id && s._id.toString && s._id.toString() === sessionId)) {
              sessionService.sessions.delete(sid);
            }
          }
        }
      }
    } catch (error) {
      logger.error('Erro ao revogar sessão:', error.message);
      throw error;
    }
  }

  /**
   * Revoga todas as sessões do usuário (exceto a atual)
   *
   * Refs #920: delega para session.service.js#revokeAllOtherSessions em vez
   * de reimplementar o write. As duas rotas de "encerrar outras sessões"
   * (esta e DELETE /sessions/all-others) precisam produzir o mesmo formato
   * de documento revogado -- delegar impede que voltem a divergir.
   */
  async revokeAllSessions(db, userID, currentToken) {
    try {
      const sessionService = require('./session.service');
      await sessionService.revokeAllOtherSessions(db, userID, currentToken);
    } catch (error) {
      logger.error('Erro ao revogar todas as sessões:', error.message);
      throw error;
    }
  }

  /**
   * Solicita reset de senha com tempo de expiração configurável
   */
  async requestPasswordReset(db, userID, expirationHours = 1) {
    try {
      const usersCollection = db.collection('users');
      const jwt = require('jsonwebtoken');
      // #873: this was '../../config/env', which resolves to the
      // compatibility re-export under api/backend/config/ rather than to the
      // canonical module under src/config/. Every other importer in
      // src/services/ uses '../config/env'; this one line was the outlier.
      // It worked, because the re-export hands back the same object -- but
      // #863's guard resolves require paths exactly, so going through the
      // re-export took this file out of the guard's collection entirely and
      // left its reads unchecked.
      const env = require('../config/env');
      
      const user = await usersCollection.findOne({ _id: new ObjectId(userID) });
      
      if (!user) {
        throw new Error('Usuário não encontrado');
      }

      // Gera token de recuperação com tempo de expiração configurável
      const expirationMs = expirationHours * 60 * 60 * 1000;
      const expiresAt = new Date(Date.now() + expirationMs);
      
      const resetToken = jwt.sign(
        {
          userID: user._id.toString(),
          email: user.email,
          type: 'password-reset',
          expirationHours: expirationHours
        },
        env.JWT_SECRET,
        { expiresIn: `${expirationHours}h` }
      );

      // Salva token no banco
      await usersCollection.updateOne(
        { _id: new ObjectId(userID) },
        {
          $set: {
            // #1078: same hash-at-rest rule as auth.service's writer. Note
            // this path mints a token valid for up to 24h, so the window in
            // which a raw stored value would have been readable was the
            // longer of the two.
            passwordResetTokenHash: hashToken(resetToken),
            passwordResetExpires: expiresAt,
            updatedAt: new Date()
          }
        }
      );

      // #1203: the second instance of that issue's bug. The route answers
      // "Link de reset de senha enviado com sucesso" and nothing was sent;
      // the controller strips resetToken from the response, so the link
      // reached nobody. AWAITED here, unlike auth.service's unauthenticated
      // sibling: the caller is the authenticated account owner, so there is
      // no existence to hide, and a failed send must surface as the route's
      // 400 rather than as a success toast.
      const resetLink = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/reset-password?token=${resetToken}`;
      const notificationService = require('./NotificationService');
      await notificationService.sendPasswordReset(user.email, resetLink, { expiresInMinutes: Math.round(expirationHours * 60) });

      logger.info(`Token de reset de senha gerado para usuário ${userID}, expira em ${expirationHours} horas`);

      return {
        resetToken, // Em produção, não retornar o token, apenas enviar por email
        expiresAt,
        expirationHours
      };
    } catch (error) {
      logger.error('Erro ao solicitar reset de senha:', error.message);
      throw error;
    }
  }
}

module.exports = new UserSecurityService();

