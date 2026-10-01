const logger = require('../utils/logger');
const auditLogger = require('../utils/auditLogger');
const sessionService = require('./session.service');

/**
 * Service de Configurações de Segurança
 * Gerencia todas as configurações de segurança do sistema
 */
// #953: server-owned, flat top-level fields (dict-02 P1X-0321/0322/0323).
// detectChanges must not report them as user-visible policy changes -- they are
// rewritten on every save by definition. Before the flattening these lived under
// a `metadata` object and were skipped by the typeof-object branch instead.
const SERVER_OWNED_KEYS = ['configVersion', 'lastUpdatedAt', 'lastUpdatedBy'];

// #649 / RF014 AC#8: "Revogar sessoes quando a alteracao exigir." The
// requirement is deliberately conditional -- "quando a alteracao exigir" -- and
// neither RF014 nor dict-02 enumerates which changes require it. So the list is
// built from one testable principle rather than guessed:
//
//   revoke when a TIGHTENING invalidates a guarantee an already-issued session
//   is currently relying on.
//
// That yields two entries today, and the shortness is the finding, not an
// oversight. session.timeoutMinutes and session.maxSessionDurationHours are the
// only SecurityConfiguration keys any code path actually enforces (#914 wired
// both; the session snapshots them at creation, so an existing session keeps
// the OLD, more generous limit until it is revoked -- which is precisely the
// gap AC#8 names).
//
// Deliberately NOT included, each for a stated reason:
//  - authentication.requireMFA / enhancedSecurity.requireMFAForAll: still inert
//    (#914 stays open on them). Revoking on a false->true flip would log every
//    user out and readmit them WITHOUT MFA -- disruption with zero security
//    delta, recorded as a critical audit action that changed nothing.
//  - loginAttempts.* / authentication.maxLoginAttempts: pre-authentication. A
//    live session never re-enters that gate, so revoking changes nothing.
//  - privacy.autoPurge and the lgpd group: retention switches, not session
//    guarantees.
//
// NOT reusing getSeverityForChange's criticalPaths: its only job is choosing an
// audit severity, it matches by loose substring, and it is wrong in both
// directions here -- it includes maxLoginAttempts and privacy.autoPurge and
// omits maxSessionDurationHours. Coupling session lifecycle to audit-log
// severity would mean a future logging tweak starts or stops logging people out.
const SESSION_INVALIDATING_PATHS = ['session.timeoutMinutes', 'session.maxSessionDurationHours'];

function requiresSessionRevocation(changes) {
  return changes.some((change) => {
    if (!SESSION_INVALIDATING_PATHS.includes(change.path)) return false;
    const oldValue = Number(change.oldValue);
    const newValue = Number(change.newValue);
    // Direction matters and detectChanges hands it to us for free. Relaxing a
    // limit never invalidates an already-issued token; only tightening does.
    if (!Number.isFinite(oldValue) || !Number.isFinite(newValue)) return false;
    return newValue < oldValue;
  });
}

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
        lockoutDurationMinutes: 30,
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
        maxSessionDurationHours: 12,
        allowMultipleSessions: false,
        autoRenewal: true, // renovação automática enquanto usuário estiver ativo
        logExpiration: true // registrar logs quando sessão for expirada
      },
      
      // Tentativas de Login
      loginAttempts: {
        maxAttempts: 5,
        lockoutDurationMinutes: 30,
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
      
      // #953: dict-02 P1X-0321/0322/0323 declare these as FLAT top-level fields
      // of SecurityConfiguration. The code had invented a `metadata` group that
      // appears nowhere in the dictionary, and renamed two of its three members.
      configVersion: 1,
      lastUpdatedAt: new Date(),
      lastUpdatedBy: null
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
      
      // Mescla com configuração atual, grupo a grupo (um nível de profundidade),
      // para não apagar flags do grupo que o chamador não enviou (#904)
      const knownGroups = [
        'authentication',
        'passwordRules',
        'session',
        'loginAttempts',
        'logging',
        'privacy',
        'enhancedSecurity',
        'lgpd'
      ];

      const mergedConfig = {};
      for (const group of knownGroups) {
        if (currentConfig[group] || newConfig[group]) {
          mergedConfig[group] = {
            ...currentConfig[group],
            ...(newConfig[group] || {})
          };
        }
      }

      // #1249: loginAttempts.maxAttempts and lockoutDurationMinutes duplicate
      // the authentication pair the lockout reads (#952, resolveLockoutPolicy).
      // The stored copy follows the enforced one on every save, so the two
      // never disagree; the Security page edits only the authentication keys.
      if (mergedConfig.authentication && mergedConfig.loginAttempts) {
        const { maxLoginAttempts, lockoutDurationMinutes } = mergedConfig.authentication;
        if (maxLoginAttempts !== undefined) mergedConfig.loginAttempts.maxAttempts = maxLoginAttempts;
        if (lockoutDurationMinutes !== undefined) mergedConfig.loginAttempts.lockoutDurationMinutes = lockoutDurationMinutes;
      }

      // #953: flat, per dict-02 P1X-0321/0322/0323. Note these are assigned
      // AFTER the knownGroups loop above, which copies only the eight group
      // objects -- so a caller-supplied configVersion/lastUpdatedAt/lastUpdatedBy
      // in newConfig is still ignored, exactly as the `...currentConfig.metadata`
      // spread used to guarantee. The protection survives the flattening, but for
      // a different reason, which is why it is stated here.
      mergedConfig.configVersion = (currentConfig.configVersion || 1) + 1;
      mergedConfig.lastUpdatedAt = new Date();
      mergedConfig.lastUpdatedBy = req.user?.userID || 'SYSTEM';

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
          // #1116: dict-02 Entidade is SecurityConfiguration (49 rows) and
          // never SecurityConfig. This was the last writer emitting the short
          // form, so the same entity was landing in the logs collection under
          // two resourceType values -- #1115's ENTITY_MAP already resolves
          // /api/security to the canonical name for the automatic rows.
          // Rows written before this keep the old spelling: the trail is
          // immutable and hash-chained (#1094/#1105), so a query over
          // resourceType has to accept both regardless.
          resourceType: 'SecurityConfiguration',
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

      // #649: after the write and the audit rows, so a revocation failure cannot
      // lose the policy change or its audit trail.
      if (requiresSessionRevocation(changes)) {
        try {
          const actingToken = (req && req.headers && req.headers.authorization || '').replace('Bearer ', '');
          const revoked = await sessionService.revokeAllSessionsForPolicyChange(
            db,
            actingToken,
            req && req.user && req.user.userID || 'SYSTEM',
            { req }
          );
          logger.info(`#649: política de sessão restringida, ${revoked} sessão(ões) revogada(s)`);
        } catch (revokeError) {
          logger.error('#649: falha ao revogar sessões após alteração de política:', revokeError.message);
        }
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
          if (oldObj[key] !== newObj[key] && !SERVER_OWNED_KEYS.includes(key)) {
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
      // #1249: TOTP is the only method implemented (dict-02 P1X-0279 says so),
      // so the policy cannot name one that would never be offered.
      if (config.authentication.mfaMethod && config.authentication.mfaMethod !== 'totp') {
        errors.push('mfaMethod deve ser: totp (único método implementado)');
      }
    }

    // Validações de senha
    if (config.passwordRules) {
      // #1253: 8 is NIST SP 800-63B §5.1.1.2's floor (see password.service).
      if (config.passwordRules.minLength && (config.passwordRules.minLength < 8 || config.passwordRules.minLength > 128)) {
        errors.push('minLength deve estar entre 8 e 128');
      }
      if (config.passwordRules.expirationDays && (config.passwordRules.expirationDays < 0 || config.passwordRules.expirationDays > 365)) {
        errors.push('expirationDays deve estar entre 0 e 365');
      }
      // #1244: password.service now reads this depth, so an out-of-range
      // value is refused here rather than silently replaced by the default
      // there. 1..20 is SecurityPage's own input bound.
      const reuseHistory = config.passwordRules.maxReuseHistory;
      if (reuseHistory !== undefined && reuseHistory !== null
        && !(Number.isInteger(reuseHistory) && reuseHistory >= 1 && reuseHistory <= 20)) {
        errors.push('maxReuseHistory deve ser um inteiro entre 1 e 20');
      }
    }

    // Validações de sessão
    if (config.session) {
      if (config.session.timeoutMinutes && (config.session.timeoutMinutes < 5 || config.session.timeoutMinutes > 480)) {
        errors.push('timeoutMinutes deve estar entre 5 e 480');
      }
      if (config.session.maxSessionDurationHours && (config.session.maxSessionDurationHours < 1 || config.session.maxSessionDurationHours > 24)) {
        errors.push('maxSessionDurationHours deve estar entre 1 e 24 horas');
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
  async getPermissions(_db) {
    // Permissões padrão baseadas em accessType
    const defaultPermissions = {
      '1': { // Usuário Externo
        viewReports: true
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

    // #1149: this map is returned as-is. It used to be merged with a
    // `security_permissions` overlay that PUT /api/security/permissions
    // wrote. No enforcement path ever read that collection: requirePermission
    // reads the in-process catalog and userHasPermission reads the seeded
    // roles/permissions (see #1123). So an edit changed nothing, yet it was
    // shown back as the profile's permissions and audited as a critical
    // change. The write surface is gone, and this read no longer echoes
    // rows it left behind. Those rows are kept, not deleted, as part of the
    // record of what was once saved.
    return defaultPermissions;
  }

}

module.exports = new SecurityService();

