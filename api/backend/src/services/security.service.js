const crypto = require('crypto');
const { isDeepStrictEqual } = require('util');
const env = require('../config/env');
const logger = require('../utils/logger');
const auditLogger = require('../utils/auditLogger');
const sessionService = require('./session.service');
const configurationReleaseService = require('./configurationRelease.service');
const configurationValidationService = require('./configurationValidation.service');
const { invariantForPath } = require('../governance/invariants');
const { CATALOG_VERSION, SECURITY_SETTING_CATALOG, entriesOfKind, profileFields } = require('../governance/securitySettingCatalog');
const logLevel = require('../utils/logLevel');
const { getCollection } = require('../utils/collectionResolver');

/**
 * Service de Configurações de Segurança
 * Gerencia todas as configurações de segurança do sistema
 */
// #953: server-owned, flat top-level fields (dict-02 P1X-0321/0322/0323).
// detectChanges must not report them as user-visible policy changes -- they are
// rewritten on every save by definition. Before the flattening these lived under
// a `metadata` object and were skipped by the typeof-object branch instead.
// #966, RF014 AC2: the identity, environment, release and validity fields are
// server-owned too, written from the active ConfigurationRelease.
const SERVER_OWNED_KEYS = [
  'configVersion', 'lastUpdatedAt', 'lastUpdatedBy',
  'securityConfigId', 'environment', 'effectivePeriod', 'configurationReleaseId',
];

// RF014 AC2/AC4: every saved change is a ConfigurationRelease of this
// profile, one per environment (plano §4 F1.2, "Uma release ativa por
// ambiente"). The environment is the one the Foundation job records,
// env.NODE_ENV (FoundationDataRun P1X-0399: development|test|staging|production).
const SECURITY_PROFILE_NAME = 'security-configuration';

function settingsOf(config) {
  const settings = {};
  for (const group of CONFIG_GROUPS) {
    if (config && config[group]) settings[group] = { ...config[group] };
  }
  return settings;
}

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

// The read model's own top-level fields. SecurityPage echoes them back on
// every save; updateConfig never stores them from the caller.
const DOCUMENT_FIELDS = [
  'configVersion', 'lastUpdatedAt', 'lastUpdatedBy', 'securityConfigId', 'environment',
  'effectivePeriod', 'configurationReleaseId', 'governedBy', 'updatedAt', 'createdAt', '_id'
];

const TYPE_NAMES ={ number: 'um número', boolean: 'verdadeiro ou falso', string: 'um texto' };

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

// #1254: every security_config document stored before the key was wired holds
// session.allowMultipleSessions false, the old code default, while the system
// allowed several sessions per user. Read as stored, the switch would make every
// such deployment single-session at its next boot, a flip no administrator
// chose (#1011 kept administrator MFA optional for the same reason). So a stored
// false that no audit row shows an administrator setting is rewritten to true,
// once. The marker in systemBootstrap makes it once: after it, a false is an
// administrator's choice, even after the retention sweep has moved or deleted
// the row that recorded it.
const ALLOW_MULTIPLE_SESSIONS_MARKER = 'allow_multiple_sessions_default_v1';
const ALLOW_MULTIPLE_SESSIONS_PATH = 'session.allowMultipleSessions';
// #1116 renamed the audit rows' resourceType; rows written before keep the old
// spelling. logs_archive holds the rows the retention sweep moved (#1259).
const SECURITY_CONFIG_AUDIT_FILTER = Object.freeze({
  resourceType: { $in: ['SecurityConfiguration', 'SecurityConfig'] },
  'payload.path': ALLOW_MULTIPLE_SESSIONS_PATH,
});

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
// RF014 AC1: the setting catalog lists them as governed by RetentionPolicy.
const RETENTION_GOVERNED_PATHS = entriesOfKind('governed').map(({ path }) => path);
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
// nothing. They stay in the document (dict-02 keeps them) and show read-only.
// A write echoing the fixed value is accepted; a write at another value is
// refused (RF014 AC6, fixedKeyAttempts below).
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
// RF014 AC1: the values and reasons are the setting catalog's
// (securitySettingCatalog.js), which holds every key's allowed values.
const FIXED_PATHS = Object.fromEntries(entriesOfKind('fixed')
  .map(({ path, allowedValues }) => [path, { value: allowedValues.value, reason: allowedValues.reason }]));
const GOVERNED_PATHS = [...RETENTION_GOVERNED_PATHS, ...Object.keys(FIXED_PATHS)];

// RF014 AC6, CFG-008: the fixed keys a request tries to set to anything but
// their fixed value, each with the governance invariant that fixes it (none
// for a key fixed only because no job applies it).
function fixedKeyAttempts(config) {
  const attempts = [];
  for (const [path, { value }] of Object.entries(FIXED_PATHS)) {
    const [group, key] = path.split('.');
    const values = config && config[group];
    if (!isPlainObject(values) || !Object.prototype.hasOwnProperty.call(values, key)) continue;
    if (values[key] === undefined || isDeepStrictEqual(values[key], value)) continue;
    const invariant = invariantForPath(path);
    attempts.push({ path, invariantId: invariant ? invariant.invariantId : null });
  }
  return attempts;
}

const EMPTY_FINDINGS = Object.freeze({ structural: [], semantic: [], dependency: [], security: [], unknownPaths: [] });

// The candidate a refused request proposed: the stored groups with the
// request's groups over them, one level deep, as updateConfig merges.
function mergeGroups(currentConfig, newConfig) {
  const merged = {};
  for (const group of CONFIG_GROUPS) {
    if (currentConfig[group] || newConfig[group]) {
      merged[group] = { ...(isPlainObject(currentConfig[group]) ? currentConfig[group] : {}), ...(isPlainObject(newConfig[group]) ? newConfig[group] : {}) };
    }
  }
  return merged;
}

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
      // #1257: NIST SP 800-63B-4 §3.1.1.2 (see password.service): 15 for an
      // account that signs in without MFA, 8 for one enrolled in MFA, no
      // composition rules and no periodic expiry. A new deployment's values;
      // a stored document keeps its own.
      passwordRules: {
        minLength: 15,
        minLengthWithMFA: 8,
        requireUppercase: false,
        requireLowercase: false,
        requireNumbers: false,
        requireSpecialChars: false,
        expirationDays: 0,
        preventReuse: true,
        maxReuseHistory: 5
      },
      
      // Sessão
      session: {
        timeoutMinutes: 30, // timeout por inatividade
        maxSessionDurationHours: 12,
        // #1254: true, what the system has always done. dict-02 P1X-0294 states
        // no default and its example is true; false is an administrator's
        // choice (session.service ends the other sessions at sign-in).
        allowMultipleSessions: true,
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
      lastUpdatedBy: null,

      // #966: P1X-0276 securityConfigId, a uuid assigned when the document
      // is first stored (the Mongo _id stays 'main', which every reader
      // keys on). P1X-0277 environment, the deployment it governs.
      // P1X-0324 effectivePeriod, copied from the active release.
      securityConfigId: null,
      environment: env.NODE_ENV,
      effectivePeriod: null,
      // CFG-004: "Toda execução ou decisão registra configurationReleaseId".
      configurationReleaseId: null
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
   * #1254: the one-time rewrite of an unchosen allowMultipleSessions false
   * (see ALLOW_MULTIPLE_SESSIONS_MARKER). Run at boot; idempotent.
   */
  async reconcileAllowMultipleSessions(db) {
    const bootstrap = db.collection('systemBootstrap');
    if (await bootstrap.findOne({ _id: ALLOW_MULTIPLE_SESSIONS_MARKER })) {
      return { status: 'already_reconciled' };
    }

    const configCollection = db.collection('security_config');
    const config = await configCollection.findOne({ _id: 'main' });
    let outcome = 'no_document';
    if (config) {
      outcome = 'kept';
      if (config.session && config.session.allowMultipleSessions === false) {
        const chosen = await db.collection('logs').findOne(SECURITY_CONFIG_AUDIT_FILTER)
          || await db.collection('logs_archive').findOne(SECURITY_CONFIG_AUDIT_FILTER);
        if (chosen) {
          outcome = 'kept_administrator_choice';
        } else {
          await configCollection.updateOne(
            { _id: 'main', [ALLOW_MULTIPLE_SESSIONS_PATH]: false },
            { $set: { [ALLOW_MULTIPLE_SESSIONS_PATH]: true, updatedAt: new Date() } }
          );
          outcome = 'rewritten';
          auditLogger.init(db);
          await auditLogger.log({
            action: 'UPDATE',
            resourceType: 'SecurityConfiguration',
            resourceId: 'main',
            status: 'success',
            severity: this.getSeverityForChange(ALLOW_MULTIPLE_SESSIONS_PATH),
            message: `Configuração de segurança alterada: ${ALLOW_MULTIPLE_SESSIONS_PATH} (padrão sem escolha de administrador corrigido)`,
            payload: { path: ALLOW_MULTIPLE_SESSIONS_PATH, oldValue: false, newValue: true, reason: 'unchosen_default' },
            req: null,
            module: 'Segurança'
          });
        }
      }
    }

    await bootstrap.updateOne(
      { _id: ALLOW_MULTIPLE_SESSIONS_MARKER },
      { $set: { status: outcome, completedAt: new Date() } },
      { upsert: true }
    );
    return { status: outcome };
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
        const defaultConfig = { ...this.getDefaultConfig(), securityConfigId: crypto.randomUUID() };
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
  async updateConfig(db, newConfig, currentConfig, req, options = {}) {
    try {
      const configCollection = db.collection('security_config');
      
      // #1248: the retention keys are not this document's to set. Dropped
      // before change detection, so no audit row claims a change that
      // never applies; currentConfig loses governedBy for the same reason.
      // Dropped rather than rejected (#1264 item 6): SecurityPage sends the
      // whole config, governed and fixed keys included, on every save, so a
      // 4xx on their presence would refuse every save. The response carries
      // the real values and governedBy, so an API caller sees what applied.
      // RF014 AC6, CFG-008: a fixed key sent at its fixed value is the page's
      // echo and is dropped with the rest; one sent at any other value is an
      // attempt to override a governance rule, refused below and recorded.
      const fixedAttempts = fixedKeyAttempts(newConfig || {});
      const proposedConfig = newConfig || {};
      newConfig = withoutRetentionGoverned(proposedConfig);
      currentConfig = withoutRetentionGoverned(currentConfig || {});

      // Detecta mudanças para auditoria
      const changes = this.detectChanges(currentConfig, newConfig);

      // RF014 AC3/AC4: the gates the ConfigurationValidationRun records. A
      // failed run is refused before anything is merged or stored; the
      // refused candidate is kept as a draft release with its run.
      const validation = configurationValidationService.evaluate({
        findings: this.configFindings(newConfig, currentConfig),
        fixedAttempts,
      });
      if (validation.error) {
        // The draft keeps what was proposed, refused fixed values included.
        await this.recordRefusal(db, validation, mergeGroups(currentConfig, proposedConfig), req);
        throw validation.error;
      }

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

      // RF014 AC2/AC4: the change is a new ConfigurationRelease, activated
      // before the document follows it, so a refused activation (409) leaves
      // the configuration in force untouched. The document stays the read
      // model every reader keys on ({ _id: 'main' }); the releases are the
      // record of what was in force and when.
      const release = await this.activateRelease(db, {
        settings: settingsOf(mergedConfig),
        actorId: mergedConfig.lastUpdatedBy,
        changes,
        rollbackTargetId: options.rollbackTargetId || null,
        validationRun: validation.run,
      });
      mergedConfig.securityConfigId = currentConfig.securityConfigId || crypto.randomUUID();
      mergedConfig.environment = env.NODE_ENV;
      mergedConfig.configurationReleaseId = release.configurationReleaseId;
      mergedConfig.effectivePeriod = release.effectivePeriod;

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
            newValue: change.newValue,
            configurationReleaseId: release.configurationReleaseId,
            ...(options.rollbackTargetId ? { rollbackTargetId: options.rollbackTargetId } : {})
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
   * RF014: this environment's security-configuration profile, created on
   * first use. Its settings, defaults, allowedValues and dependencies are
   * the setting catalog's (RF014 AC1), refreshed when the catalog changes.
   */
  async securityProfile(db) {
    return configurationReleaseService.ensureEnvironmentProfile(db, {
      profileName: SECURITY_PROFILE_NAME,
      environment: env.NODE_ENV,
      describe: () => ({ ...profileFields(), ownerId: 'SYSTEM' }),
    });
  }

  /**
   * Activates a release of `settings`. Before the first release, the stored
   * document is recorded as the baseline release, so the first change can
   * be rolled back.
   */
  /**
   * RF014 AC4, CFG-008: records a refused candidate, its failed run and the
   * refusal's events. Recording is the evidence, not the refusal: if it
   * fails, the change is still refused and the failure is logged.
   */
  async recordRefusal(db, validation, candidate, req) {
    try {
      const profile = await this.securityProfile(db);
      await configurationValidationService.recordRefusal(db, {
        run: validation.run,
        violated: validation.violated,
        profileId: profile.profileId,
        settings: settingsOf(candidate),
        actorId: req?.user?.userID || 'SYSTEM',
      });
    } catch (recordError) {
      logger.error(`RF014: falha ao registrar a ConfigurationValidationRun recusada ${validation.run.configurationValidationRunId}:`, recordError.message);
    }
  }

  async activateRelease(db, { settings, actorId, changes = [], rollbackTargetId = null, validationRun = null }) {
    const profile = await this.securityProfile(db);
    const stored = await db.collection('security_config').findOne({ _id: 'main' });
    const paths = changes.map((change) => change.path);
    const impactSummary = rollbackTargetId
      ? `Rollback para a release ${rollbackTargetId}${paths.length ? `: ${paths.join(', ')}` : ''}.`
      : (paths.length ? `Alterado: ${paths.join(', ')}.` : 'Nenhuma chave alterada.');
    // RF014 AC3/AC4: the candidate is activated only once its
    // ConfigurationValidationRun passes. The baseline records what was
    // already in force and is not a candidate, so it is not validated.
    const run = validationRun || configurationValidationService.evaluate({ findings: EMPTY_FINDINGS }).run;
    return configurationValidationService.activateValidated(db, {
      run,
      actorId,
      activate: (configurationReleaseId) => configurationReleaseService.activate(db, {
        configurationReleaseId,
        profileId: profile.profileId,
        settings,
        actorId,
        impactSummary,
        rollbackTargetId,
        baseline: stored ? {
          settings: settingsOf(stored),
          approvedBy: stored.lastUpdatedBy || 'SYSTEM',
          since: stored.lastUpdatedAt instanceof Date ? stored.lastUpdatedAt : undefined,
        } : null,
      }),
    });
  }

  /** RF014 AC4: this environment's releases, newest first. */
  async listReleases(db, { limit = 50 } = {}) {
    const profile = await this.securityProfile(db);
    return configurationReleaseService.listReleases(db, profile.profileId, { limit });
  }

  /** RF014 AC1: the setting catalog, with its version. */
  settingCatalog() {
    return { catalogVersion: CATALOG_VERSION, settings: Object.values(SECURITY_SETTING_CATALOG) };
  }

  /**
   * RF014 AC4: governed rollback. Restores an earlier release's settings as
   * a new release (rollbackTargetId names the one restored), through the
   * same validation, audit and session revocation as any other change.
   */
  async rollbackConfig(db, configurationReleaseId, req) {
    const profile = await this.securityProfile(db);
    const target = await configurationReleaseService.rollbackTarget(db, profile.profileId, configurationReleaseId);
    const currentConfig = await this.getConfig(db);
    return this.updateConfig(db, target.settings, currentConfig, req, { rollbackTargetId: target.configurationReleaseId });
  }

  /**
   * Detecta mudanças entre configurações antigas e novas
   */
  detectChanges(oldConfig, newConfig) {
    const changes = [];

    const compareObjects = (oldObj, newObj, path = '') => {
      for (const key in newObj) {
        const currentPath = path ? `${path}.${key}` : key;
        // A server-owned object (effectivePeriod) is skipped whole: the page
        // echoes it back as strings, and its parts are not policy.
        if (!path && SERVER_OWNED_KEYS.includes(key)) continue;

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
  /**
   * RF014 AC3, RULE-015: the ConfigurationValidationRun's gates over a
   * candidate configuration, one list of failure messages per gate.
   * `unknownPaths` names the keys outside the profile's catalog, which
   * INV-SCOPE-001 also refuses. validateConfig throws on any of them.
   */
  configFindings(config, currentConfig = {}) {
    const structural = [];
    const semantic = [];
    const dependency = [];
    const security = [];
    const unknownPaths = [];

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
        structural.push(`${group} deve ser um objeto`);
        continue;
      }
      const stored = isPlainObject(currentConfig && currentConfig[group]) ? currentConfig[group] : {};
      for (const [key, value] of Object.entries(values)) {
        if (value === undefined) continue;
        if (Object.prototype.hasOwnProperty.call(stored, key) && isDeepStrictEqual(stored[key], value)) continue;
        if (!Object.prototype.hasOwnProperty.call(defaults[group], key)) {
          structural.push(`${group}.${key} não é uma configuração conhecida`);
          unknownPaths.push(`${group}.${key}`);
          continue;
        }
        const expected = typeof defaults[group][key];
        const ok = expected === 'number' ? isNumber(value) : typeof value === expected;
        if (!ok) structural.push(`${group}.${key} deve ser ${TYPE_NAMES[expected]}`);
      }
    }

    // RNF018 AC2, RNF028 AC5: a top-level key outside the groups and the
    // document's own fields is refused, not silently dropped. Outbox,
    // provenance, store authority and RCS are not configurable here. A key
    // the stored document already has passes as the page's echo; updateConfig
    // stores only the groups, so such a key is never written.
    for (const key of Object.keys(config || {})) {
      if (CONFIG_GROUPS.includes(key) || DOCUMENT_FIELDS.includes(key)) continue;
      if (config[key] === undefined) continue;
      if (Object.prototype.hasOwnProperty.call(currentConfig || {}, key)) continue;
      structural.push(`${key} não é uma configuração conhecida`);
      unknownPaths.push(key);
    }

    // The ranges below check a number whenever one is present, 0 included;
    // until #909 each was guarded by truthiness, so 0 skipped it.

    // Validações de autenticação
    if (config.authentication) {
      if (isNumber(config.authentication.maxLoginAttempts) && (config.authentication.maxLoginAttempts < 1 || config.authentication.maxLoginAttempts > 10)) {
        semantic.push('maxLoginAttempts deve estar entre 1 e 10');
      }
      // #1249: TOTP is the only method implemented (dict-02 P1X-0279 says so),
      // so the policy cannot name one that would never be offered.
      if (typeof config.authentication.mfaMethod === 'string' && config.authentication.mfaMethod !== 'totp') {
        security.push('mfaMethod deve ser: totp (único método implementado)');
      }
    }

    // #1255: ipAttempt.service reads this now. 0 tracks without blocking
    // (dict-02 P1X-0300 is 0..1 Condicional); a fraction or a negative would
    // be silently read as 0, so it is refused here instead.
    if (config.loginAttempts) {
      const blockAfter = config.loginAttempts.blockIPAfterAttempts;
      if (blockAfter !== undefined && blockAfter !== null
        && !(Number.isInteger(blockAfter) && blockAfter >= 0 && blockAfter <= 100)) {
        semantic.push('blockIPAfterAttempts deve ser um inteiro entre 0 e 100');
      }
    }

    // Validações de senha
    if (config.passwordRules) {
      // #1253: 8 is NIST SP 800-63B §5.1.1.2's floor (see password.service).
      if (isNumber(config.passwordRules.minLength) && (config.passwordRules.minLength < 8 || config.passwordRules.minLength > 128)) {
        security.push('minLength deve estar entre 8 e 128');
      }
      // #1257: the same 8 floor, which SP 800-63B-4 sets for a password used
      // with MFA. Above minLength is refused rather than silently capped
      // (password.service caps it), so the page never shows a value not in
      // force; an unchanged minLength is read from the stored document.
      const mfaMin = config.passwordRules.minLengthWithMFA;
      if (isNumber(mfaMin)) {
        const singleFactorMin = isNumber(config.passwordRules.minLength)
          ? config.passwordRules.minLength
          : currentConfig?.passwordRules?.minLength;
        if (mfaMin < 8 || mfaMin > 128) {
          security.push('minLengthWithMFA deve estar entre 8 e 128');
        } else if (isNumber(singleFactorMin) && mfaMin > singleFactorMin) {
          dependency.push('minLengthWithMFA não pode exceder minLength');
        }
      }
      if (isNumber(config.passwordRules.expirationDays) && (config.passwordRules.expirationDays < 0 || config.passwordRules.expirationDays > 365)) {
        semantic.push('expirationDays deve estar entre 0 e 365');
      }
      // #1244: password.service now reads this depth, so an out-of-range
      // value is refused here rather than silently replaced by the default
      // there. 1..20 is SecurityPage's own input bound.
      const reuseHistory = config.passwordRules.maxReuseHistory;
      if (reuseHistory !== undefined && reuseHistory !== null
        && !(Number.isInteger(reuseHistory) && reuseHistory >= 1 && reuseHistory <= 20)) {
        semantic.push('maxReuseHistory deve ser um inteiro entre 1 e 20');
      }
    }

    // Validações de sessão
    if (config.session) {
      if (isNumber(config.session.timeoutMinutes) && (config.session.timeoutMinutes < 5 || config.session.timeoutMinutes > 480)) {
        semantic.push('timeoutMinutes deve estar entre 5 e 480');
      }
      if (isNumber(config.session.maxSessionDurationHours) && (config.session.maxSessionDurationHours < 1 || config.session.maxSessionDurationHours > 24)) {
        semantic.push('maxSessionDurationHours deve estar entre 1 e 24 horas');
      }
    }

    // Validações de logs
    if (config.logging) {
      if (typeof config.logging.level === 'string' && !['info', 'warning', 'error', 'critical'].includes(config.logging.level)) {
        semantic.push('level deve ser: info, warning, error ou critical');
      }
    }

    return { structural, semantic, dependency, security, unknownPaths };
  }

  validateConfig(config, currentConfig = {}) {
    const { structural, semantic, dependency, security } = this.configFindings(config, currentConfig);
    const errors = [...structural, ...semantic, ...dependency, ...security];
    if (errors.length > 0) {
      throw new Error(`Configurações inválidas: ${errors.join(', ')}`);
    }
  }

  /**
   * Exporta logs filtrados
   */
  async exportLogs(db, filters, format = 'csv') {
    try {
      // #1271: source=archive exports logs_archive (log.service).
      const { logSourceCollection } = require('./log.service');
      const logsCollection = db.collection(logSourceCollection(filters.source));
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
   * Retorna os papéis e as permissões que cada um concede.
   *
   * #1341: read from the seeded `roles` and `permissions` collections, the
   * rows enforcement reads (userHasPermission), which the RBAC seed sets to
   * PERMISSION_CATALOG on every boot. This used to be a hardcoded accessType
   * map that listed a code the catalog does not have (manageSecurity), left
   * out most of the catalog, and had no slot for the additive `auditor`
   * role. Read-only: role grants are catalog-owned, and the user-to-role
   * link is what an Administrador manages (RF003 AC3).
   *
   * #1149: a `security_permissions` overlay that the removed PUT wrote is
   * not read. No enforcement path ever read it.
   */
  async getPermissions(db) {
    const rolesCollection = await getCollection(db, 'roles');
    const permissionsCollection = await getCollection(db, 'permissions');
    const [roleDocs, permissionDocs] = await Promise.all([
      rolesCollection.find({}).toArray(),
      permissionsCollection.find({}).toArray(),
    ]);

    const codeById = new Map(permissionDocs.map((p) => [p.permissionId, p.permissionCode]));
    const permissions = permissionDocs
      .map((p) => ({
        permissionCode: p.permissionCode,
        displayName: p.displayName,
        resourceType: p.resourceType,
        allowedActions: p.allowedActions || [],
      }))
      .sort((a, b) => a.permissionCode.localeCompare(b.permissionCode));

    // Primary roles by hierarchyLevel, highest first; additive roles
    // (hierarchyLevel null, #429) after them.
    const rank = (r) => (typeof r.hierarchyLevel === 'number' ? r.hierarchyLevel : -1);
    const roles = roleDocs
      .map((r) => ({
        roleCode: r.roleCode,
        displayName: r.displayName,
        hierarchyLevel: typeof r.hierarchyLevel === 'number' ? r.hierarchyLevel : null,
        permissionCodes: (r.permissionIds || [])
          .map((id) => codeById.get(id))
          .filter(Boolean)
          .sort(),
      }))
      .sort((a, b) => rank(b) - rank(a) || a.roleCode.localeCompare(b.roleCode));

    return { roles, permissions };
  }

}

module.exports = new SecurityService();
module.exports.RETENTION_GOVERNED_PATHS = RETENTION_GOVERNED_PATHS;
module.exports.FIXED_PATHS = FIXED_PATHS;

