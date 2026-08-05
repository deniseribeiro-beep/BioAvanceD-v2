const logger = require('../utils/logger');
const auditLogger = require('../utils/auditLogger');

/**
 * Service de Configurações de Segurança
 * Gerencia todas as configurações de segurança do sistema
 */
class SecurityService {
  /**
   * Retorna configurações padrão do sistema
   */
  getDefaultConfig() {
    return {
      // Autenticação e Acesso
      authentication: {
        requireMFA: true,
        mfaMethod: 'totp', // totp, sms, email
        allowPasswordReset: true,
        maxLoginAttempts: 5,
        lockoutDuration: 30, // minutos
        requireStrongPassword: true
      },
      
      // Regras de Senha
      passwordRules: {
        minLength: 8,
        requireUppercase: true,
        requireLowercase: true,
        requireNumbers: true,
        requireSpecialChars: true,
        expirationDays: 90,
        preventReuse: true,
        maxReuseHistory: 5
      },
      
      // Sessão
      session: {
        timeoutMinutes: 30, // timeout por inatividade
        maxSessionDuration: 12, // horas
        allowMultipleSessions: false,
        autoRenewal: true, // renovação automática enquanto usuário estiver ativo
        logExpiration: true // registrar logs quando sessão for expirada
      },
      
      // Tentativas de Login
      loginAttempts: {
        maxAttempts: 5,
        lockoutDuration: 30, // minutos
        trackIP: true,
        blockIPAfterAttempts: 10
      },
      
      // Logs
      logging: {
        level: 'info', // info, warning, error, critical
        logLoginAttempts: true,
        logAllActions: true,
        retentionDays: 365
      },
      
      // Privacidade
      privacy: {
        anonymizeLogs: true,
        dataRetentionDays: 365,
        autoPurge: false,
        purgeAfterDays: 730,
        anonymizeAfterDays: 90
      },
      
      // Modo de Segurança Reforçado
      enhancedSecurity: {
        enabled: false,
        requireMFAForAll: true,
        strictPasswordPolicy: true,
        sessionTimeoutMinutes: 15,
        logAllActions: true,
        blockUnusualActivity: true
      },
      
      // LGPD
      lgpd: {
        allowDataExport: true,
        allowDataDeletion: true,
        anonymizeOnExport: true,
        requireConsent: true,
        consentExpirationDays: 365
      },
      
      // Metadados
      metadata: {
        lastUpdated: new Date(),
        lastUpdatedBy: null,
        version: 1
      }
    };
  }

  /**
   * Busca configurações atuais do banco ou retorna padrões
   */
  async getConfig(db) {
    try {
      const configCollection = db.collection('security_config');
      const config = await configCollection.findOne({ _id: 'main' });

      if (!config) {
        // Se não existe, cria com valores padrão
        const defaultConfig = this.getDefaultConfig();
        await configCollection.insertOne({
          _id: 'main',
          ...defaultConfig,
          createdAt: new Date(),
          updatedAt: new Date()
        });
        return defaultConfig;
      }

      // Remove _id e campos internos antes de retornar
      const { _id, createdAt, ...configData } = config;
      return configData;
    } catch (error) {
      logger.error('Erro ao buscar configurações de segurança:', error.message);
      throw error;
    }
  }

  /**
   * Atualiza configurações de segurança
   */
  async updateConfig(db, newConfig, currentConfig, req) {
    try {
      const configCollection = db.collection('security_config');
      
      // Detecta mudanças para auditoria
      const changes = this.detectChanges(currentConfig, newConfig);
      
      // Valida configurações
      this.validateConfig(newConfig);
      
      // Mescla com configuração atual (mantém valores não fornecidos)
      const mergedConfig = {
        ...currentConfig,
        ...newConfig,
        metadata: {
          ...currentConfig.metadata,
          lastUpdated: new Date(),
          lastUpdatedBy: req.user?.userID || 'SYSTEM',
          version: (currentConfig.metadata?.version || 1) + 1
        }
      };

      // Atualiza no banco
      await configCollection.updateOne(
        { _id: 'main' },
        {
          $set: {
            ...mergedConfig,
            updatedAt: new Date()
          }
        },
        { upsert: true }
      );

      // Registra auditoria para cada mudança
      auditLogger.init(db);
      for (const change of changes) {
        const severity = this.getSeverityForChange(change.path);
        await auditLogger.log({
          action: 'UPDATE',
          resourceType: 'SecurityConfig',
          resourceId: 'main',
          status: 'success',
          severity: severity,
          message: `Configuração de segurança alterada: ${change.path}`,
          payload: {
            path: change.path,
            oldValue: change.oldValue,
            newValue: change.newValue
          },
          req: req,
          module: 'Segurança'
        });
      }

      return mergedConfig;
    } catch (error) {
      logger.error('Erro ao atualizar configurações de segurança:', error.message);
      throw error;
    }
  }

  /**
   * Detecta mudanças entre configurações antigas e novas
   */
  detectChanges(oldConfig, newConfig) {
    const changes = [];

    const compareObjects = (oldObj, newObj, path = '') => {
      for (const key in newObj) {
        const currentPath = path ? `${path}.${key}` : key;
        
        if (typeof newObj[key] === 'object' && newObj[key] !== null && !Array.isArray(newObj[key]) && !(newObj[key] instanceof Date)) {
          if (oldObj[key]) {
            compareObjects(oldObj[key], newObj[key], currentPath);
          } else {
            changes.push({
              path: currentPath,
              oldValue: undefined,
              newValue: newObj[key]
            });
          }
        } else {
          if (oldObj[key] !== newObj[key] && key !== 'metadata') {
            changes.push({
              path: currentPath,
              oldValue: oldObj[key],
              newValue: newObj[key]
            });
          }
        }
      }
    };

    compareObjects(oldConfig, newConfig);
    return changes;
  }

  /**
   * Determina severidade do log baseado no tipo de mudança
   */
  getSeverityForChange(path) {
    const criticalPaths = [
      'authentication.requireMFA',
      'authentication.maxLoginAttempts',
      'session.timeoutMinutes',
      'loginAttempts.maxAttempts',
      'privacy.autoPurge',
      'enhancedSecurity.enabled'
    ];

    if (criticalPaths.some(cp => path.includes(cp))) {
      return 'critical';
    }

    return 'warning';
  }

  /**
   * Valida configurações antes de salvar
   */
  validateConfig(config) {
    const errors = [];

    // Validações de autenticação
    if (config.authentication) {
      if (config.authentication.maxLoginAttempts && (config.authentication.maxLoginAttempts < 1 || config.authentication.maxLoginAttempts > 10)) {
        errors.push('maxLoginAttempts deve estar entre 1 e 10');
      }
      if (config.authentication.mfaMethod && !['totp', 'sms', 'email'].includes(config.authentication.mfaMethod)) {
        errors.push('mfaMethod deve ser: totp, sms ou email');
      }
    }

    // Validações de senha
    if (config.passwordRules) {
      if (config.passwordRules.minLength && (config.passwordRules.minLength < 6 || config.passwordRules.minLength > 128)) {
        errors.push('minLength deve estar entre 6 e 128');
      }
      if (config.passwordRules.expirationDays && (config.passwordRules.expirationDays < 0 || config.passwordRules.expirationDays > 365)) {
        errors.push('expirationDays deve estar entre 0 e 365');
      }
    }

    // Validações de sessão
    if (config.session) {
      if (config.session.timeoutMinutes && (config.session.timeoutMinutes < 5 || config.session.timeoutMinutes > 480)) {
        errors.push('timeoutMinutes deve estar entre 5 e 480');
      }
      if (config.session.maxSessionDuration && (config.session.maxSessionDuration < 1 || config.session.maxSessionDuration > 24)) {
        errors.push('maxSessionDuration deve estar entre 1 e 24 horas');
      }
    }

    // Validações de logs
    if (config.logging) {
      if (config.logging.level && !['info', 'warning', 'error', 'critical'].includes(config.logging.level)) {
        errors.push('level deve ser: info, warning, error ou critical');
      }
    }

    if (errors.length > 0) {
      throw new Error(`Configurações inválidas: ${errors.join(', ')}`);
    }
  }

  /**
   * Exporta logs filtrados
   */
  async exportLogs(db, filters, format = 'csv') {
    try {
      const logsCollection = db.collection('logs');
      const query = {};

      // Aplica filtros
      if (filters.severity) {
        query.severity = filters.severity;
      }
      if (filters.module) {
        query.module = filters.module;
      }
      if (filters.action) {
        query.action = filters.action.toUpperCase();
      }
      if (filters.entity) {
        query.entity = filters.entity;
      }
      if (filters.startDate || filters.endDate) {
        query.timestamp = {};
        if (filters.startDate) {
          query.timestamp.$gte = new Date(filters.startDate);
        }
        if (filters.endDate) {
          query.timestamp.$lte = new Date(filters.endDate);
        }
      }

      const logs = await logsCollection.find(query).sort({ timestamp: -1 }).limit(10000).toArray();

      if (format === 'csv') {
        return this.formatLogsAsCSV(logs);
      } else {
        return logs;
      }
    } catch (error) {
      logger.error('Erro ao exportar logs:', error.message);
      throw error;
    }
  }

  /**
   * Formata logs como CSV
   */
  formatLogsAsCSV(logs) {
    if (logs.length === 0) {
      return 'timestamp,userID,action,entity,severity,module,message\n';
    }

    const headers = ['timestamp', 'userID', 'action', 'entity', 'severity', 'module', 'message'];
    const rows = logs.map(log => {
      return [
        log.timestamp ? new Date(log.timestamp).toISOString() : '',
        log.userID || '',
        log.action || '',
        log.entity || '',
        log.severity || '',
        log.module || '',
        (log.message || '').replace(/"/g, '""') // Escape quotes
      ].map(field => `"${field}"`).join(',');
    });

    return headers.join(',') + '\n' + rows.join('\n');
  }

  /**
   * Retorna permissões por perfil
   */
  async getPermissions(db) {
    try {
      // Permissões padrão baseadas em accessType
      const defaultPermissions = {
        '1': { // Usuário Externo
          viewReports: true,
          useAssistant: true
        },
        '2': { // Técnico
          createSample: true,
          withdrawSample: true,
          viewTemperature: true,
          uploadFiles: true,
          viewReports: true
        },
        '3': { // Coordenador
          createUser: true,
          createPatient: true,
          createSample: true,
          withdrawSample: true,
          viewTemperature: true,
          uploadFiles: true,
          viewReports: true
        },
        '4': { // Administrador
          createUser: true,
          createPatient: true,
          createSample: true,
          withdrawSample: true,
          viewTemperature: true,
          uploadFiles: true,
          viewReports: true,
          manageSystem: true,
          manageBackup: true,
          manageSecurity: true,
          resetMFA: true
        }
      };

      // Busca permissões customizadas do banco
      const permissionsCollection = db.collection('security_permissions');
      const customPermissions = await permissionsCollection.findOne({ _id: 'main' });

      if (customPermissions && customPermissions.permissions) {
        // Mescla com padrões (mantém padrões se não existir customização)
        const merged = { ...defaultPermissions };
        for (const profile in customPermissions.permissions) {
          merged[profile] = {
            ...defaultPermissions[profile],
            ...customPermissions.permissions[profile]
          };
        }
        return merged;
      }

      return defaultPermissions;
    } catch (error) {
      logger.error('Erro ao buscar permissões:', error.message);
      throw error;
    }
  }

  /**
   * Atualiza permissões por perfil
   */
  async updatePermissions(db, newPermissions, currentPermissions, req) {
    try {
      const permissionsCollection = db.collection('security_permissions');
      
      // Converte chaves numéricas para strings se necessário
      const normalizedPermissions = {};
      for (const profile in newPermissions) {
        const profileKey = String(profile);
        normalizedPermissions[profileKey] = newPermissions[profile];
      }
      
      // Detecta mudanças
      const changes = this.detectPermissionChanges(currentPermissions, normalizedPermissions);
      
      // Valida permissões
      this.validatePermissions(normalizedPermissions);
      
      // Atualiza no banco
      await permissionsCollection.updateOne(
        { _id: 'main' },
        {
          $set: {
            permissions: normalizedPermissions,
            updatedAt: new Date(),
            lastUpdatedBy: req.user?.userID || 'SYSTEM'
          }
        },
        { upsert: true }
      );

      // Registra auditoria
      auditLogger.init(db);
      for (const change of changes) {
        await auditLogger.log({
          action: 'UPDATE',
          resourceType: 'Permissions',
          resourceId: change.profile,
          status: 'success',
          severity: 'critical',
          message: `Permissões alteradas para perfil: ${change.profile}`,
          payload: {
            profile: change.profile,
            permission: change.permission,
            oldValue: change.oldValue,
            newValue: change.newValue
          },
          req: req,
          module: 'Segurança'
        });
      }

      return normalizedPermissions;
    } catch (error) {
      logger.error('Erro ao atualizar permissões:', error.message);
      throw error;
    }
  }

  /**
   * Detecta mudanças em permissões
   */
  detectPermissionChanges(oldPermissions, newPermissions) {
    const changes = [];

    for (const profile in newPermissions) {
      if (!oldPermissions[profile]) {
        // Novo perfil
        for (const permission in newPermissions[profile]) {
          changes.push({
            profile,
            permission,
            oldValue: false,
            newValue: newPermissions[profile][permission]
          });
        }
      } else {
        // Perfil existente - compara permissões
        for (const permission in newPermissions[profile]) {
          const oldValue = oldPermissions[profile][permission] || false;
          const newValue = newPermissions[profile][permission];
          if (oldValue !== newValue) {
            changes.push({
              profile,
              permission,
              oldValue,
              newValue
            });
          }
        }
      }
    }

    return changes;
  }

  /**
   * Valida permissões
   */
  validatePermissions(permissions) {
    const validProfiles = ['1', '2', '3', '4'];
    const validPermissionKeys = [
      'createUser', 'createPatient', 'createSample', 'withdrawSample',
      'viewTemperature', 'uploadFiles', 'viewReports',
      'manageSystem', 'manageBackup', 'manageSecurity', 'resetMFA'
    ];

    for (const profile in permissions) {
      if (!validProfiles.includes(profile)) {
        throw new Error(`Perfil inválido: ${profile}`);
      }

      for (const permission in permissions[profile]) {
        if (!validPermissionKeys.includes(permission)) {
          throw new Error(`Permissão inválida: ${permission}`);
        }
        if (typeof permissions[profile][permission] !== 'boolean') {
          throw new Error(`Valor de permissão deve ser booleano: ${permission}`);
        }
      }
    }
  }
}

module.exports = new SecurityService();

