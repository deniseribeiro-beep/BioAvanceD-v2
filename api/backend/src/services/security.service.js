const { isDeepStrictEqual } = require('util');
const logger = require('../utils/logger');
const auditLogger = require('../utils/auditLogger');
const sessionService = require('./session.service');
const logLevel = require('../utils/logLevel');

/**
 * Service de Configurações de Segurança
 * Gerencia todas as configurações de segurança do sistema
 */
// #953: server-owned, flat top-level fields (dict-02 P1X-0321/0322/0323).
// detectChanges must not report them as user-visible policy changes -- they are
// rewritten on every save by definition. Before the flattening these lived under
// a `metadata` object and were skipped by the typeof-object branch instead.
const SERVER_OWNED_KEYS = ['configVersion', 'lastUpdatedAt', 'lastUpdatedBy'];

// The eight policy groups. updateConfig merges only these, one level deep
// (#904), so any other top-level key a caller sends is never stored.
const CONFIG_GROUPS = [
  'authentication',
  'passwordRules',
  'session',
  'loginAttempts',
  'logging',
  'privacy',
  'enhancedSecurity',
  'lgpd'
];

const TYPE_NAMES = { number: 'um número', boolean: 'verdadeiro ou falso', string: 'um texto' };

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Date);
}

function isNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

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

// #1248: three keys of the logging and privacy groups restate what the active
// RetentionPolicy (retentionPolicy.service, #440) already decides, and
// retentionSweep.service applies it nightly to `logs` and `audit_events`.
// dict-02 keeps them as SecurityConfiguration fields (P1X-0304 says
// logging.retentionDays "deve alinhar-se a RetentionPolicy"), so they stay in
// the document, but they are derived from the policy rather than edited:
//  - logging.retentionDays: the policy's retentionPeriod, in days.
//  - privacy.autoPurge: whether the sweep removes anything from the live
//    collections, which it does for 'destroy' and 'archive' (#1259).
//  - privacy.purgeAfterDays: the same period, while the action is 'destroy'.
// With no active policy covering Log or AuditEvent, nothing is purged:
// autoPurge is false and the two periods are null. A second retention
// authority is what #1248 rules out, so a write to these paths is dropped.
const RETENTION_GOVERNED_PATHS = ['logging.retentionDays', 'privacy.autoPurge', 'privacy.purgeAfterDays'];
const DAY_MS = 24 * 60 * 60 * 1000;

async function resolveRetentionGoverned(db) {
  const retentionPolicyService = require('./retentionPolicy.service');
  const { iso8601DurationToMs } = require('../utils/iso8601Duration');
  const unset = { 'logging.retentionDays': null, 'privacy.autoPurge': false, 'privacy.purgeAfterDays': null };
  try {
    const policy = await retentionPolicyService.getActivePolicy(db);
    const covered = policy && Array.isArray(policy.applicableEntityTypes)
      && policy.applicableEntityTypes.some((type) => type === 'Log' || type === 'AuditEvent');
    if (!covered) return { source: { entity: 'RetentionPolicy', policyId: null, version: null }, values: unset };
    const days = Math.round(iso8601DurationToMs(policy.retentionPeriod) / DAY_MS);
    return {
      source: {
        entity: 'RetentionPolicy',
        policyId: String(policy._id),
        version: policy.version || null,
        postRetentionAction: policy.postRetentionAction,
      },
      values: {
        'logging.retentionDays': days,
        'privacy.autoPurge': ['destroy', 'archive'].includes(policy.postRetentionAction),
        'privacy.purgeAfterDays': policy.postRetentionAction === 'destroy' ? days : null,
      },
    };
  } catch (error) {
    // The paths stay governed (read-only); only their values are unknown.
    logger.warn(`#1248: política de retenção ilegível: ${error.message}`);
    return { source: { entity: 'RetentionPolicy', policyId: null, version: null, unavailable: true }, values: null };
  }
}

// #1260, #1261: keys whose behaviour is fixed, whatever the document says.
// Nothing ever read them, so a value other than the one below changed
// nothing. They stay in the document (dict-02 keeps them), show read-only,
// and a write to them is dropped, exactly as for the retention keys.
//  - 'audit-required': RNF009 AC 1 requires auditing authentication,
//    configuration and every other critical event, so login attempts and
//    auditable actions are always recorded. Turning that off is not an option
//    the requirement leaves. enhancedSecurity.logAllActions (P1X-0314) is the
//    same switch inside the reinforced mode.
//  - 'always-anonymized': log reads always go through
//    userAnonymization.anonymizeLogs (log.service, reports.routes). P1X-0305's
//    "substitui identidade direta por anonId nos logs de consulta" is that
//    behaviour, and LGPD art. 6 III (necessidade) argues against a view that
//    drops it.
//  - 'not-applied': no job applies a retention or anonymisation period to
//    data other than logs; the RetentionPolicy sweep covers only Log and
//    AuditEvent (#1248). The page says so rather than offer a period that
//    nothing enforces.
// #1262, the lgpd group:
//  - 'consent-required': consent.enforcement and the lineage consent gate
//    enforce consent unconditionally. Consent for sensitive health data is a
//    legal basis (LGPD art. 11 I), not a preference, so requireConsent
//    (P1X-0319) is true.
//  - 'consent-no-expiry': a PatientConsent carries no expiry; its validity
//    is the ConsentPolicy's validFrom/validTo window. P1X-0320 applies "when
//    defined by the policy", and none defines a per-consent period.
//  - 'export-pseudonymised' (#1266): every export of the system writes
//    pseudonymised rows. The report exports keep only EXPORT_CATALOG's
//    allow-listed columns (no name, contact or document), HL7/FHIR/CDA
//    carry only the participantId, and every log export runs anonymizeLogs
//    (#1267). RNF007 AC 5 requires exactly that, so anonymizeOnExport
//    (P1X-0318) is true.
// lgpd.allowDataDeletion and lgpd.allowDataExport are not here: the patient
// delete and the personal-data exports read them.
const FIXED_PATHS = {
  'logging.logLoginAttempts': { value: true, reason: 'audit-required' },
  'logging.logAllActions': { value: true, reason: 'audit-required' },
  'enhancedSecurity.logAllActions': { value: true, reason: 'audit-required' },
  'privacy.anonymizeLogs': { value: true, reason: 'always-anonymized' },
  'privacy.dataRetentionDays': { value: null, reason: 'not-applied' },
  'privacy.anonymizeAfterDays': { value: null, reason: 'not-applied' },
  'lgpd.requireConsent': { value: true, reason: 'consent-required' },
  'lgpd.consentExpirationDays': { value: null, reason: 'consent-no-expiry' },
  'lgpd.anonymizeOnExport': { value: true, reason: 'export-pseudonymised' },
};
const GOVERNED_PATHS = [...RETENTION_GOVERNED_PATHS, ...Object.keys(FIXED_PATHS)];

function applyFixedValues(config) {
  for (const [path, { value }] of Object.entries(FIXED_PATHS)) {
    const [group, key] = path.split('.');
    if (config[group]) config[group][key] = value;
  }
}

function applyRetentionGoverned(config, governed) {
  const out = { ...config, governedBy: {} };
  for (const path of RETENTION_GOVERNED_PATHS) {
    const [group, key] = path.split('.');
    out.governedBy[path] = governed.source;
    if (governed.values) {
      out[group] = { ...(out[group] || {}), [key]: governed.values[path] };
    }
  }
  for (const [path, { value, reason }] of Object.entries(FIXED_PATHS)) {
    const [group, key] = path.split('.');
    out.governedBy[path] = { entity: 'Fixed', policyId: null, version: null, fixed: reason };
    // A document missing the whole group is not given a one-key group.
    if (out[group]) out[group] = { ...out[group], [key]: value };
  }
  return out;
}

function withoutRetentionGoverned(config) {
  const out = { ...config };
  for (const path of GOVERNED_PATHS) {
    const [group, key] = path.split('.');
    if (out[group] && Object.prototype.hasOwnProperty.call(out[group], key)) {
      const { [key]: _dropped, ...rest } = out[group];
      out[group] = rest;
    }
  }
  delete out.governedBy;
  return out;
}

// #1260: logging.level (P1X-0301) sets the backend logger's minimum level.
// An absent or unknown value leaves the current level, which starts at 'info'.
function applyLogLevel(config) {
  const level = config && config.logging && config.logging.level;
  if (level) logLevel.setMinLevel(level);
}

// #1262, #1266: an lgpd permission switch, read directly from the document.
// Absent means the default, true; an unreadable document refuses.
async function readLgpdSwitch(db, key) {
  try {
    const doc = await db.collection('security_config')
      .findOne({ _id: 'main' }, { projection: { [`lgpd.${key}`]: 1 } });
    return doc?.lgpd?.[key] !== false;
  } catch (error) {
    logger.warn(`#1266: configuração LGPD ilegível, lgpd.${key} tratado como desabilitado: ${error.message}`);
    return false;
  }
}

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
   * #1260: applies the stored logging.level to this process's logger. server.js
   * runs it at boot and on a poll, so a level saved through another replica
   * reaches this one. Reads the document directly: getConfig would insert the
   * default document as a side effect of a background read.
   */
  async syncLogLevel(db) {
    try {
      const doc = await db.collection('security_config')
        .findOne({ _id: 'main' }, { projection: { 'logging.level': 1 } });
      applyLogLevel(doc);
    } catch (error) {
      logger.warn(`#1260: nível de log não sincronizado: ${error.message}`);
    }
  }

  /**
   * #1262: lgpd.allowDataDeletion (P1X-0317, "permite execução de eliminação
   * quando juridicamente aplicável") gates the patient delete. Read directly,
   * for the reason syncLogLevel gives. An absent key is the default, true.
   * An unreadable document refuses: a deletion cannot be undone, so the
   * failure falls on the side that can be retried.
   */
  async isDataDeletionAllowed(db) {
    return readLgpdSwitch(db, 'allowDataDeletion');
  }

  /**
   * #1266: lgpd.allowDataExport (P1X-0316) gates the exports of personal
   * data: the report exports and the sample-file HL7/FHIR/CDA exports. The
   * audit-log exports are not personal-data exports and stay open to their
   * readers. Same reading rules as isDataDeletionAllowed; a refused export
   * can simply be retried.
   */
  async isDataExportAllowed(db) {
    return readLgpdSwitch(db, 'allowDataExport');
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
        return applyRetentionGoverned(defaultConfig, await resolveRetentionGoverned(db));
      }

      // Remove _id e campos internos antes de retornar
      const { _id, createdAt, ...configData } = config;
      applyLogLevel(configData);
      // #1248: the retention keys come from the active RetentionPolicy.
      return applyRetentionGoverned(configData, await resolveRetentionGoverned(db));
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
      
      // #1248: the retention keys are not this document's to set. Dropped
      // before change detection, so no audit row claims a change that
      // never applies; currentConfig loses governedBy for the same reason.
      // Dropped rather than rejected (#1264 item 6): SecurityPage sends the
      // whole config, governed and fixed keys included, on every save, so a
      // 4xx on their presence would refuse every save. The response carries
      // the real values and governedBy, so an API caller sees what applied.
      newConfig = withoutRetentionGoverned(newConfig || {});
      currentConfig = withoutRetentionGoverned(currentConfig || {});

      // Detecta mudanças para auditoria
      const changes = this.detectChanges(currentConfig, newConfig);
      
      // Valida configurações
      this.validateConfig(newConfig, currentConfig);

      // Mescla com configuração atual, grupo a grupo (um nível de profundidade),
      // para não apagar flags do grupo que o chamador não enviou (#904)
      const mergedConfig = {};
      for (const group of CONFIG_GROUPS) {
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
      // #1248: the stored copy of the retention keys follows the policy on
      // every save, the way #1249's loginAttempts pair follows the enforced
      // one, so the document never disagrees with what the sweep does.
      const governed = await resolveRetentionGoverned(db);
      if (governed.values) {
        for (const path of RETENTION_GOVERNED_PATHS) {
          const [group, key] = path.split('.');
          if (mergedConfig[group]) mergedConfig[group][key] = governed.values[path];
        }
      }
      // #1260, #1261: the fixed keys are stored at their fixed value too.
      applyFixedValues(mergedConfig);

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

      // #1260: the logger follows the saved level at once in this process;
      // syncLogLevel's poll carries it to the others.
      applyLogLevel(mergedConfig);

      return applyRetentionGoverned(mergedConfig, governed);
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
  validateConfig(config, currentConfig = {}) {
    const errors = [];

    // #909: a path-aware schema over getDefaultConfig()'s groups. Every key a
    // group carries must be one the default declares, holding the default's
    // type: a finite number, a boolean or a string. Before this, an unknown key
    // or a wrong type was merged and stored (a null from an emptied numeric
    // input included), and the readers fell back to their own defaults
    // without saying so.
    //
    // An unchanged echo passes: SecurityPage sends the whole document back on
    // every save, so a value identical to the stored one (a legacy key, or a
    // null an older build stored) is not the caller's to fix in this request.
    // updateConfig strips the governed and fixed keys before calling this.
    const defaults = this.getDefaultConfig();
    for (const group of CONFIG_GROUPS) {
      if (!Object.prototype.hasOwnProperty.call(config, group) || config[group] === undefined) continue;
      const values = config[group];
      if (!isPlainObject(values)) {
        errors.push(`${group} deve ser um objeto`);
        continue;
      }
      const stored = isPlainObject(currentConfig && currentConfig[group]) ? currentConfig[group] : {};
      for (const [key, value] of Object.entries(values)) {
        if (value === undefined) continue;
        if (Object.prototype.hasOwnProperty.call(stored, key) && isDeepStrictEqual(stored[key], value)) continue;
        if (!Object.prototype.hasOwnProperty.call(defaults[group], key)) {
          errors.push(`${group}.${key} não é uma configuração conhecida`);
          continue;
        }
        const expected = typeof defaults[group][key];
        const ok = expected === 'number' ? isNumber(value) : typeof value === expected;
        if (!ok) errors.push(`${group}.${key} deve ser ${TYPE_NAMES[expected]}`);
      }
    }

    // The ranges below check a number whenever one is present, 0 included;
    // until #909 each was guarded by truthiness, so 0 skipped it.

    // Validações de autenticação
    if (config.authentication) {
      if (isNumber(config.authentication.maxLoginAttempts) && (config.authentication.maxLoginAttempts < 1 || config.authentication.maxLoginAttempts > 10)) {
        errors.push('maxLoginAttempts deve estar entre 1 e 10');
      }
      // #1249: TOTP is the only method implemented (dict-02 P1X-0279 says so),
      // so the policy cannot name one that would never be offered.
      if (typeof config.authentication.mfaMethod === 'string' && config.authentication.mfaMethod !== 'totp') {
        errors.push('mfaMethod deve ser: totp (único método implementado)');
      }
    }

    // #1255: ipAttempt.service reads this now. 0 tracks without blocking
    // (dict-02 P1X-0300 is 0..1 Condicional); a fraction or a negative would
    // be silently read as 0, so it is refused here instead.
    if (config.loginAttempts) {
      const blockAfter = config.loginAttempts.blockIPAfterAttempts;
      if (blockAfter !== undefined && blockAfter !== null
        && !(Number.isInteger(blockAfter) && blockAfter >= 0 && blockAfter <= 100)) {
        errors.push('blockIPAfterAttempts deve ser um inteiro entre 0 e 100');
      }
    }

    // Validações de senha
    if (config.passwordRules) {
      // #1253: 8 is NIST SP 800-63B §5.1.1.2's floor (see password.service).
      if (isNumber(config.passwordRules.minLength) && (config.passwordRules.minLength < 8 || config.passwordRules.minLength > 128)) {
        errors.push('minLength deve estar entre 8 e 128');
      }
      if (isNumber(config.passwordRules.expirationDays) && (config.passwordRules.expirationDays < 0 || config.passwordRules.expirationDays > 365)) {
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
      if (isNumber(config.session.timeoutMinutes) && (config.session.timeoutMinutes < 5 || config.session.timeoutMinutes > 480)) {
        errors.push('timeoutMinutes deve estar entre 5 e 480');
      }
      if (isNumber(config.session.maxSessionDurationHours) && (config.session.maxSessionDurationHours < 1 || config.session.maxSessionDurationHours > 24)) {
        errors.push('maxSessionDurationHours deve estar entre 1 e 24 horas');
      }
    }

    // Validações de logs
    if (config.logging) {
      if (typeof config.logging.level === 'string' && !['info', 'warning', 'error', 'critical'].includes(config.logging.level)) {
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

      const rawLogs = await logsCollection.find(query).sort({ timestamp: -1 }).limit(10000).toArray();
      // #1267: the same read-time anonymisation logService.getLogs applies
      // (RNF007 AC 5). Without it the export carried raw staff ids, and any
      // row a direct createLog writer stored unsanitised.
      const { anonymizeLogs } = require('../utils/userAnonymization');
      const logs = await anonymizeLogs(rawLogs, db);

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
module.exports.RETENTION_GOVERNED_PATHS = RETENTION_GOVERNED_PATHS;
module.exports.FIXED_PATHS = FIXED_PATHS;

