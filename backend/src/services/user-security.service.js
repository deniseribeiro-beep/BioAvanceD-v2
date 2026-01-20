const bcrypt = require('bcryptjs');
const speakeasy = require('speakeasy');
const logger = require('../utils/logger');
const { ObjectId } = require('mongodb');

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
    
    // Métodos alternativos: +10 pontos cada (máx 20)
    const alternativeCount = (mfaMethods.phoneEnabled ? 1 : 0) + 
                           (mfaMethods.passkeys?.length || 0) + 
                           ((mfaMethods.recoveryCodes?.remaining || 0) > 0 ? 1 : 0);
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
      
      const alternativeMethodsCount = 
        (mfaMethods.phoneEnabled ? 1 : 0) + 
        (mfaMethods.passkeys?.length || 0) + 
        ((mfaMethods.recoveryCodes?.remaining || 0) > 0 ? 1 : 0);
      
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
      
      // Busca passkeys
      const passkeysCollection = db.collection('passkeys');
      const passkeys = await passkeysCollection.find({ userID: new ObjectId(userID), active: true }).toArray();
      
      // Busca telefone MFA
      const phoneMFA = user.phoneMFAEnabled || false;
      // Garante que o telefone seja tratado como string
      const phoneRaw = user.phone ? user.phone.toString() : null;
      const phoneNumber = phoneRaw ? this.maskPhone(phoneRaw) : null;
      
      return {
        primaryEnabled: user.mfaEnabled || false,
        primarySetupDate: user.mfaSetupDate || null,
        phoneEnabled: phoneMFA,
        phoneNumber: phoneNumber,
        passkeys: passkeys.map(pk => ({
          id: pk._id.toString(),
          name: pk.deviceName || null
        })),
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
      
      // Calcula expiração (90 dias padrão)
      const lastChanged = user.passwordChangedAt || user.createdAt || new Date();
      const lastChangedDate = lastChanged instanceof Date ? lastChanged : new Date(lastChanged);
      const expiresAt = new Date(lastChangedDate.getTime() + 90 * 24 * 60 * 60 * 1000);
      
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
    if (userAgent.includes('Linux')) {
      return 'Linux';
    }
    if (userAgent.includes('Android')) {
      return 'Android';
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
   * Atualiza MFA (telefone ou passkey)
   */
  async updateMFA(db, userID, method, enabled) {
    try {
      const usersCollection = db.collection('users');
      
      if (method === 'phone') {
        if (enabled) {
          // Ao habilitar, verifica se tem telefone cadastrado
          const user = await usersCollection.findOne({ _id: new ObjectId(userID) });
          if (!user || !user.phone) {
            throw new Error('É necessário cadastrar um telefone antes de habilitar MFA por telefone');
          }
          await usersCollection.updateOne(
            { _id: new ObjectId(userID) },
            { $set: { phoneMFAEnabled: true, updatedAt: new Date() } }
          );
        } else {
          // Ao desabilitar, apenas desativa o MFA por telefone (não remove o telefone)
          await usersCollection.updateOne(
            { _id: new ObjectId(userID) },
            { $set: { phoneMFAEnabled: false, updatedAt: new Date() } }
          );
        }
      } else if (method === 'passkey') {
        // Passkeys são gerenciadas individualmente
        throw new Error('Use endpoints específicos de passkey para gerenciar passkeys');
      }
    } catch (error) {
      logger.error('Erro ao atualizar MFA:', error.message);
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
      
      // Valida senha atual
      const isCurrentPasswordValid = await bcrypt.compare(currentPassword, user.password);
      if (!isCurrentPasswordValid) {
        throw new Error('Senha atual incorreta');
      }
      
      // Valida complexidade da senha
      const PasswordValidator = require('../utils/passwordValidator');
      PasswordValidator.validateOrThrow(newPassword);
      
      // Verifica se não está reutilizando senha (últimas 5)
      const passwordHistory = user.passwordHistory || [];
      for (const oldHash of passwordHistory) {
        const isReused = await bcrypt.compare(newPassword, oldHash);
        if (isReused) {
          throw new Error('Você não pode reutilizar uma senha recente');
        }
      }
      
      // Hash da nova senha
      const saltRounds = 12;
      const newPasswordHash = await bcrypt.hash(newPassword, saltRounds);
      
      // Atualiza senha e histórico
      const newPasswordHistory = [user.password, ...passwordHistory].slice(0, 5);
      
      await usersCollection.updateOne(
        { _id: new ObjectId(userID) },
        {
          $set: {
            password: newPasswordHash,
            passwordHistory: newPasswordHistory,
            passwordChangedAt: new Date(),
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
   * Atualiza telefone do usuário
   */
  async updatePhone(db, userID, phone) {
    try {
      // Valida formato do telefone
      const cleaned = phone.toString().replace(/\D/g, '');
      
      if (!cleaned || cleaned.length < 10 || cleaned.length > 11) {
        throw new Error('Telefone inválido. Use o formato: (XX) XXXXX-XXXX ou (XX) XXXX-XXXX');
      }
      
      const usersCollection = db.collection('users');
      
      // Verifica se o usuário existe
      const user = await usersCollection.findOne({ _id: new ObjectId(userID) });
      if (!user) {
        throw new Error('Usuário não encontrado');
      }
      
      // Atualiza telefone (sem habilitar MFA automaticamente)
      // MFA deve ser habilitado separadamente pelo usuário
      const updateResult = await usersCollection.updateOne(
        { _id: new ObjectId(userID) },
        { 
          $set: { 
            phone: cleaned,
            updatedAt: new Date() 
          } 
        }
      );
      
      if (updateResult.matchedCount === 0) {
        throw new Error('Usuário não encontrado para atualização');
      }
      
      if (updateResult.modifiedCount === 0) {
        logger.warn('Telefone não foi modificado (pode ser o mesmo valor)');
      }
      
      logger.info(`Telefone atualizado para usuário ${userID}: ${this.maskPhone(cleaned)}`);
      
      // Busca o estado atual do usuário para retornar o status correto do MFA
      const updatedUser = await usersCollection.findOne({ _id: new ObjectId(userID) });
      
      return {
        phone: cleaned,
        phoneMasked: this.maskPhone(cleaned),
        phoneMFAEnabled: updatedUser?.phoneMFAEnabled || false
      };
    } catch (error) {
      logger.error('Erro ao atualizar telefone:', error.message);
      throw error;
    }
  }

  /**
   * Adiciona passkey (FIDO2/WebAuthn)
   */
  async addPasskey(db, userID, passkeyData) {
    try {
      const passkeysCollection = db.collection('passkeys');
      
      // Verifica se já existe uma passkey com o mesmo credentialId
      const existing = await passkeysCollection.findOne({
        userID: new ObjectId(userID),
        credentialId: passkeyData.credentialId
      });
      
      if (existing) {
        throw new Error('Esta passkey já está cadastrada');
      }
      
      // Extrai nome do dispositivo do userAgent se não fornecido
      let deviceName = passkeyData.deviceName || 'Dispositivo Desconhecido';
      if (deviceName && (deviceName.includes('user-agent') || deviceName.length > 100)) {
        // Tenta extrair informações do userAgent
        const ua = deviceName.toLowerCase();
        if (ua.includes('windows')) deviceName = 'Windows';
        else if (ua.includes('mac')) deviceName = 'macOS';
        else if (ua.includes('linux')) deviceName = 'Linux';
        else if (ua.includes('android')) deviceName = 'Android';
        else if (ua.includes('iphone') || ua.includes('ipad')) deviceName = 'iOS';
        else deviceName = 'Dispositivo';
      }
      
      const passkey = {
        userID: new ObjectId(userID),
        credentialId: passkeyData.credentialId,
        publicKey: passkeyData.publicKey || null, // Pode ser null se extraído do attestationObject
        attestationObject: passkeyData.attestationObject || null,
        deviceName: deviceName,
        createdAt: new Date(),
        updatedAt: new Date(),
        lastUsed: null,
        active: true
      };
      
      const result = await passkeysCollection.insertOne(passkey);
      
      return {
        _id: result.insertedId,
        ...passkey
      };
    } catch (error) {
      logger.error('Erro ao adicionar passkey:', error.message);
      throw error;
    }
  }

  /**
   * Remove passkey
   */
  async removePasskey(db, userID, passkeyId) {
    try {
      const passkeysCollection = db.collection('passkeys');
      
      const result = await passkeysCollection.updateOne(
        { 
          _id: new ObjectId(passkeyId),
          userID: new ObjectId(userID)
        },
        { 
          $set: { 
            active: false,
            removedAt: new Date()
          } 
        }
      );
      
      if (result.matchedCount === 0) {
        throw new Error('Passkey não encontrada');
      }
    } catch (error) {
      logger.error('Erro ao remover passkey:', error.message);
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
      
      const result = await sessionsCollection.updateOne(
        {
          sessionID: sessionId,
          userID: userID.toString()
        },
        {
          $set: {
            isActive: false,
            revokedAt: new Date()
          }
        }
      );
      
      if (result.matchedCount === 0) {
        throw new Error('Sessão não encontrada');
      }

      // Limpa cache em memória do sessionService
      const sessionService = require('./session.service');
      if (sessionService.sessions) {
        sessionService.sessions.delete(sessionId);
      }
    } catch (error) {
      logger.error('Erro ao revogar sessão:', error.message);
      throw error;
    }
  }

  /**
   * Revoga todas as sessões do usuário (exceto a atual)
   */
  async revokeAllSessions(db, userID, currentToken) {
    try {
      const sessionsCollection = db.collection('sessions');
      
      await sessionsCollection.updateMany(
        {
          userID: userID.toString(),
          token: { $ne: currentToken }, // Não revoga a sessão atual
          isActive: true
        },
        {
          $set: {
            isActive: false,
            revokedAt: new Date()
          }
        }
      );

      // Limpa cache em memória do sessionService (exceto sessão atual)
      const sessionService = require('./session.service');
      if (sessionService.sessions) {
        for (const [sessionID, session] of sessionService.sessions.entries()) {
          if (session.userID === userID.toString() && session.token !== currentToken) {
            sessionService.sessions.delete(sessionID);
          }
        }
      }
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
      const env = require('../../config/env');
      
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
            passwordResetToken: resetToken,
            passwordResetExpires: expiresAt,
            updatedAt: new Date()
          }
        }
      );

      // Aqui você pode enviar o email com o link de reset
      // Por enquanto, apenas retorna o token (em produção, enviar por email)
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

