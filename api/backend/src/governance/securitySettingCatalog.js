/**
 * RF014 AC1, CFG-002: the setting catalog of the security configuration.
 * "Cada opção possui tipo, escopo, valor permitido, default, dependências,
 * versão e responsável", one entry per key of the nine policy groups.
 *
 * Each entry carries:
 *  - type: the JSON type a value must have (security.service's structural gate).
 *  - scope: 'environment', the scope of the profile the releases belong to.
 *  - allowedValues, one of:
 *      { kind: 'range', min, max, integer? }  a number in [min, max];
 *      { kind: 'enum', values }               one of `values`;
 *      { kind: 'any' }                        any value of its type: no rule
 *                                             narrows it today;
 *      { kind: 'fixed', value, reason, invariantId? }
 *                                             only `value`; another value is
 *                                             refused (RF014 AC6);
 *      { kind: 'governed', by }               derived from another authority,
 *                                             and a write is dropped (#1248);
 *      { kind: 'follows', path }              copied from `path` on every save.
 *  - default: the value a new deployment starts with.
 *  - dependencies: the rules tying it to other keys, as { path, rule }.
 *  - owner: who may change it ('role:administrator', or the authority that
 *    fixes or derives it).
 *  - validity: where its period of validity comes from.
 *
 * The ranges and enums restate security.service's configFindings, which
 * enforces them; securitySettingCatalog.test.js probes each bound against
 * it, so the two cannot drift apart silently.
 */
const { invariantForPath } = require('./invariants');

const CATALOG_VERSION = '1.1.0';

const ADMIN = 'role:administrator';
const RELEASE_VALIDITY = 'ConfigurationRelease.effectivePeriod';
const RETENTION = 'RetentionPolicy';

const boolean = (value) => ({ type: 'boolean', allowedValues: { kind: 'enum', values: [true, false] }, default: value });
const range = (value, min, max, integer = false) => ({
  type: 'number',
  allowedValues: integer ? { kind: 'range', min, max, integer: true } : { kind: 'range', min, max },
  default: value,
});
const anyNumber = (value) => ({ type: 'number', allowedValues: { kind: 'any' }, default: value });
const fixed = (type, value, reason) => ({ type, allowedValues: { kind: 'fixed', value, reason }, default: value });
const governed = (type, value) => ({ type, allowedValues: { kind: 'governed', by: RETENTION }, default: value });
const follows = (path, value) => ({ type: 'number', allowedValues: { kind: 'follows', path }, default: value });

// #1260, #1261, #1262, #1266: the reasons are security.service's, where
// each is argued.
const ENTRIES = {
  'authentication.requireMFA': boolean(true),
  'authentication.mfaMethod': { type: 'string', allowedValues: { kind: 'enum', values: ['totp'] }, default: 'totp' },
  'authentication.allowPasswordReset': boolean(true),
  'authentication.maxLoginAttempts': range(5, 1, 10),
  'authentication.lockoutDurationMinutes': anyNumber(30),
  'authentication.requireStrongPassword': boolean(true),

  'passwordRules.minLength': range(15, 8, 128),
  'passwordRules.minLengthWithMFA': {
    ...range(8, 8, 128),
    dependencies: [{ path: 'passwordRules.minLength', rule: 'at most passwordRules.minLength' }],
  },
  'passwordRules.requireUppercase': boolean(false),
  'passwordRules.requireLowercase': boolean(false),
  'passwordRules.requireNumbers': boolean(false),
  'passwordRules.requireSpecialChars': boolean(false),
  'passwordRules.expirationDays': range(0, 0, 365),
  'passwordRules.preventReuse': boolean(true),
  'passwordRules.maxReuseHistory': range(5, 1, 20, true),

  'session.timeoutMinutes': range(30, 5, 480),
  'session.maxSessionDurationHours': range(12, 1, 24),
  'session.allowMultipleSessions': boolean(true),
  'session.autoRenewal': boolean(true),
  'session.logExpiration': boolean(true),

  // #1249: the stored copy follows the authentication pair the lockout reads.
  'loginAttempts.maxAttempts': {
    ...follows('authentication.maxLoginAttempts', 5),
    dependencies: [{ path: 'authentication.maxLoginAttempts', rule: 'equal to authentication.maxLoginAttempts' }],
  },
  'loginAttempts.lockoutDurationMinutes': {
    ...follows('authentication.lockoutDurationMinutes', 30),
    dependencies: [{ path: 'authentication.lockoutDurationMinutes', rule: 'equal to authentication.lockoutDurationMinutes' }],
  },
  'loginAttempts.trackIP': boolean(true),
  'loginAttempts.blockIPAfterAttempts': range(10, 0, 100, true),

  'logging.level': { type: 'string', allowedValues: { kind: 'enum', values: ['info', 'warning', 'error', 'critical'] }, default: 'info' },
  'logging.logLoginAttempts': fixed('boolean', true, 'audit-required'),
  'logging.logAllActions': fixed('boolean', true, 'audit-required'),
  'logging.retentionDays': governed('number', 365),

  'privacy.anonymizeLogs': fixed('boolean', true, 'always-anonymized'),
  'privacy.dataRetentionDays': fixed('number', null, 'not-applied'),
  'privacy.autoPurge': governed('boolean', false),
  'privacy.purgeAfterDays': governed('number', 730),
  'privacy.anonymizeAfterDays': fixed('number', null, 'not-applied'),

  'enhancedSecurity.enabled': boolean(false),
  'enhancedSecurity.requireMFAForAll': boolean(true),
  'enhancedSecurity.strictPasswordPolicy': boolean(true),
  'enhancedSecurity.sessionTimeoutMinutes': anyNumber(15),
  'enhancedSecurity.logAllActions': fixed('boolean', true, 'audit-required'),
  'enhancedSecurity.blockUnusualActivity': boolean(true),

  'lgpd.allowDataExport': boolean(true),
  'lgpd.allowDataDeletion': boolean(true),
  'lgpd.anonymizeOnExport': fixed('boolean', true, 'export-pseudonymised'),
  'lgpd.requireConsent': fixed('boolean', true, 'consent-required'),
  'lgpd.consentExpirationDays': fixed('number', null, 'consent-no-expiry'),

  // RNF025 AC6 (#1520): the clock-drift limit telemetry screening and the
  // ingestion timeliness metric read. `[inference]` The docs name no key:
  // the name follows the minute-keyed keys (lockoutDurationMinutes,
  // timeoutMinutes) and V2E-0602's "configured limit"; the floor is the
  // smallest whole minute; the ceiling of one day is in no doc: past a day
  // the check would no longer flag a device clock set to the wrong date.
  'telemetry.clockDriftLimitMinutes': range(5, 1, 1440, true),
};

function ownerOf(allowedValues) {
  if (allowedValues.kind === 'fixed') return allowedValues.invariantId || 'GovernanceInvariantCatalog';
  if (allowedValues.kind === 'governed') return allowedValues.by;
  return ADMIN;
}

function validityOf(allowedValues) {
  if (allowedValues.kind === 'governed') return `${RETENTION}.effectivePeriod`;
  if (allowedValues.kind === 'fixed') return 'CanonicalModelRelease';
  return RELEASE_VALIDITY;
}

const SECURITY_SETTING_CATALOG = Object.freeze(Object.fromEntries(Object.entries(ENTRIES).map(([path, entry]) => {
  const allowedValues = { ...entry.allowedValues };
  if (allowedValues.kind === 'fixed') {
    const invariant = invariantForPath(path);
    if (invariant) allowedValues.invariantId = invariant.invariantId;
  }
  return [path, Object.freeze({
    path,
    type: entry.type,
    scope: 'environment',
    allowedValues: Object.freeze(allowedValues),
    default: entry.default,
    dependencies: Object.freeze(entry.dependencies || []),
    owner: ownerOf(allowedValues),
    validity: validityOf(allowedValues),
  })];
})));

function entriesOfKind(kind) {
  return Object.values(SECURITY_SETTING_CATALOG).filter((entry) => entry.allowedValues.kind === kind);
}

/**
 * The ConfigurationProfile fields the catalog fills (V2E-0015..0018):
 * settings and defaults by group and key, allowedValues by path, and the
 * dependencies as a list.
 */
function profileFields() {
  const settings = {};
  const defaults = {};
  const allowedValues = {};
  const dependencies = [];
  for (const entry of Object.values(SECURITY_SETTING_CATALOG)) {
    const [group, key] = entry.path.split('.');
    settings[group] = settings[group] || {};
    defaults[group] = defaults[group] || {};
    settings[group][key] = entry.type;
    defaults[group][key] = entry.default;
    allowedValues[entry.path] = entry.allowedValues;
    for (const dependency of entry.dependencies) {
      dependencies.push({ path: entry.path, dependsOn: dependency.path, rule: dependency.rule });
    }
  }
  return { settings, defaults, allowedValues, dependencies };
}

module.exports = {
  CATALOG_VERSION,
  SECURITY_SETTING_CATALOG,
  entriesOfKind,
  profileFields,
};
