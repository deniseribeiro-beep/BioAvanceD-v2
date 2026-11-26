import { describe, it, expect } from 'vitest';

const {
  CATALOG_VERSION,
  SECURITY_SETTING_CATALOG,
  entriesOfKind,
  profileFields,
} = require('../../../src/governance/securitySettingCatalog');
const securityService = require('../../../src/services/security.service');
const configurationReleaseService = require('../../../src/services/configurationRelease.service');
const { CANONICAL_COLLECTIONS } = require('../../../src/config/collections');
const { createFakeDb } = require('../foundation/helpers/fake-db');

/**
 * RF014 AC1, CFG-002: every key of the security configuration has a
 * catalog entry with its type, scope, allowed values, default,
 * dependencies, owner and validity, and the allowed values the catalog
 * declares are the ones the validation run enforces.
 */
const entries = Object.values(SECURITY_SETTING_CATALOG);
const defaults = securityService.getDefaultConfig();
const GROUPS = ['authentication', 'passwordRules', 'session', 'loginAttempts', 'logging', 'privacy', 'enhancedSecurity', 'lgpd', 'telemetry'];

const valueOf = (config, path) => {
  const [group, key] = path.split('.');
  return config[group][key];
};
const candidate = (path, value, extra = {}) => {
  const [group, key] = path.split('.');
  return { ...extra, [group]: { ...(extra[group] || {}), [key]: value } };
};
// Every failure message the validation run gives for a candidate.
const findingsFor = (config) => {
  const { structural, semantic, dependency, security } = securityService.configFindings(config, {});
  return [...structural, ...semantic, ...dependency, ...security];
};
const keyOf = (path) => path.split('.')[1];
const refuses = (path, value, extra) => findingsFor(candidate(path, value, extra)).some((message) => message.includes(keyOf(path)));

describe('the security setting catalog covers the configuration', () => {
  it('has one entry for every key of every policy group, and no other', () => {
    const configured = GROUPS.flatMap((group) => Object.keys(defaults[group]).map((key) => `${group}.${key}`));
    expect(Object.keys(SECURITY_SETTING_CATALOG).sort()).toEqual(configured.sort());
  });

  it('gives every entry the seven attributes AC1 names', () => {
    for (const entry of entries) {
      expect(['boolean', 'number', 'string'], entry.path).toContain(entry.type);
      expect(entry.scope, entry.path).toBe('environment');
      expect(['range', 'enum', 'any', 'fixed', 'governed', 'follows'], entry.path).toContain(entry.allowedValues.kind);
      expect(entry, entry.path).toHaveProperty('default');
      expect(Array.isArray(entry.dependencies), entry.path).toBe(true);
      expect(typeof entry.owner, entry.path).toBe('string');
      expect(typeof entry.validity, entry.path).toBe('string');
    }
    expect(CATALOG_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('declares the type of each default, and the default a new deployment starts with', () => {
    for (const entry of entries) {
      const configured = valueOf(defaults, entry.path);
      expect(typeof configured, entry.path).toBe(entry.type);
      // A fixed key's default is its fixed value, whatever the document holds.
      if (entry.allowedValues.kind === 'fixed') expect(entry.default, entry.path).toBe(entry.allowedValues.value);
      else expect(entry.default, entry.path).toBe(configured);
    }
  });

  it('is the source of the fixed and the retention-governed keys', () => {
    expect(Object.keys(securityService.FIXED_PATHS).sort()).toEqual(entriesOfKind('fixed').map(({ path }) => path).sort());
    expect([...securityService.RETENTION_GOVERNED_PATHS].sort()).toEqual(['logging.retentionDays', 'privacy.autoPurge', 'privacy.purgeAfterDays']);
    expect(SECURITY_SETTING_CATALOG['logging.logAllActions'].allowedValues).toEqual({ kind: 'fixed', value: true, reason: 'audit-required', invariantId: 'INV-AUDIT-001' });
    expect(SECURITY_SETTING_CATALOG['logging.logAllActions'].owner).toBe('INV-AUDIT-001');
    expect(SECURITY_SETTING_CATALOG['privacy.dataRetentionDays'].owner).toBe('GovernanceInvariantCatalog');
    expect(SECURITY_SETTING_CATALOG['privacy.autoPurge'].owner).toBe('RetentionPolicy');
  });
});

describe('the catalog\'s allowed values are the ones the validation run enforces', () => {
  it('accepts each range\'s bounds and refuses one step past either', () => {
    const ranges = entriesOfKind('range');
    expect(ranges.length).toBeGreaterThan(0);
    for (const { path, allowedValues: { min, max } } of ranges) {
      // minLengthWithMFA is also bounded by minLength; let minLength allow it.
      const extra = path === 'passwordRules.minLengthWithMFA' ? { passwordRules: { minLength: 128 } } : {};
      expect(refuses(path, min, extra), `${path} = ${min}`).toBe(false);
      expect(refuses(path, max, extra), `${path} = ${max}`).toBe(false);
      expect(refuses(path, min - 1, extra), `${path} = ${min - 1}`).toBe(true);
      expect(refuses(path, max + 1, extra), `${path} = ${max + 1}`).toBe(true);
    }
  });

  it('refuses a fraction where the range is integer', () => {
    for (const { path, allowedValues: { min, integer } } of entriesOfKind('range')) {
      if (integer) expect(refuses(path, min + 0.5), path).toBe(true);
    }
  });

  it('accepts each enum value and refuses one outside it', () => {
    for (const { path, type, allowedValues: { values } } of entriesOfKind('enum')) {
      for (const value of values) expect(refuses(path, value), `${path} = ${value}`).toBe(false);
      expect(refuses(path, type === 'boolean' ? 'yes' : 'not-in-the-catalog'), path).toBe(true);
    }
  });

  it('declares no rule for an "any" key, and the run imposes none beyond its type', () => {
    for (const { path } of entriesOfKind('any')) {
      expect(refuses(path, 0), path).toBe(false);
      expect(refuses(path, 100000), path).toBe(false);
      expect(refuses(path, 'thirty'), path).toBe(true);
    }
  });

  it('enforces the minLengthWithMFA dependency it declares', () => {
    expect(SECURITY_SETTING_CATALOG['passwordRules.minLengthWithMFA'].dependencies)
      .toEqual([{ path: 'passwordRules.minLength', rule: 'at most passwordRules.minLength' }]);
    expect(findingsFor({ passwordRules: { minLength: 15, minLengthWithMFA: 16 } })).toContain('minLengthWithMFA não pode exceder minLength');
    expect(findingsFor({ passwordRules: { minLength: 15, minLengthWithMFA: 15 } })).toEqual([]);
  });
});

describe('the security profile carries the catalog', () => {
  const profilesOf = (db) => db.collection(CANONICAL_COLLECTIONS.configurationProfiles).docs;

  it('fills settings, defaults, allowedValues and dependencies from it', async () => {
    const db = createFakeDb();
    const profile = await securityService.securityProfile(db);
    const fields = profileFields();
    expect(profile.allowedValues).toEqual(fields.allowedValues);
    expect(profile.allowedValues['session.timeoutMinutes']).toEqual({ kind: 'range', min: 5, max: 480 });
    expect(profile.settings.logging.level).toBe('string');
    expect(profile.defaults.session.timeoutMinutes).toBe(30);
    expect(profile.dependencies).toContainEqual({ path: 'passwordRules.minLengthWithMFA', dependsOn: 'passwordRules.minLength', rule: 'at most passwordRules.minLength' });
  });

  it('refreshes a profile stored before the catalog, keeping its profileId, and leaves a current one alone', async () => {
    const db = createFakeDb();
    const stored = await securityService.securityProfile(db);
    Object.assign(profilesOf(db)[0], { allowedValues: {} });

    const refreshed = await securityService.securityProfile(db);
    expect(refreshed.profileId).toBe(stored.profileId);
    expect(refreshed.allowedValues).toEqual(profileFields().allowedValues);
    expect(refreshed.updatedAt).toBeInstanceOf(Date);
    expect(profilesOf(db)).toHaveLength(1);

    // Control: a current profile is read, not rewritten.
    const before = profilesOf(db)[0].updatedAt;
    const again = await configurationReleaseService.ensureEnvironmentProfile(db, {
      profileName: 'security-configuration',
      environment: refreshed.scopeId,
      describe: () => ({ ...profileFields(), ownerId: 'SYSTEM' }),
    });
    expect(again.updatedAt).toEqual(before);
  });

  it('serves the catalog with its version', () => {
    const served = securityService.settingCatalog();
    expect(served.catalogVersion).toBe(CATALOG_VERSION);
    expect(served.settings).toHaveLength(entries.length);
    expect(served.settings.find(({ path }) => path === 'logging.level').allowedValues.values).toEqual(['info', 'warning', 'error', 'critical']);
  });
});
