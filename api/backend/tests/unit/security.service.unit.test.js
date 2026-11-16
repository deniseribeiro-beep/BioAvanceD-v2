import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
const securityService = require('../../src/services/security.service');
const logger = require('../../src/utils/logger');
const auditLogger = require('../../src/utils/auditLogger');
const { seedRolesAndPermissions, PERMISSION_CATALOG } = require('../../src/services/rbac-catalog-seed.service');

describe('SecurityService.getDefaultConfig', () => {
  it('returns object with authentication section', () => {
    const config = securityService.getDefaultConfig();
    expect(config).toHaveProperty('authentication');
    expect(typeof config.authentication.requireMFA).toBe('boolean');
  });

  it('returns object with passwordRules section', () => {
    const config = securityService.getDefaultConfig();
    expect(config).toHaveProperty('passwordRules');
    expect(config.passwordRules.minLength).toBeGreaterThanOrEqual(6);
  });

  it('returns object with session section', () => {
    const config = securityService.getDefaultConfig();
    expect(config).toHaveProperty('session');
    expect(typeof config.session.timeoutMinutes).toBe('number');
  });

  it('returns object with lgpd section', () => {
    const config = securityService.getDefaultConfig();
    expect(config).toHaveProperty('lgpd');
  });
});

describe('SecurityService.detectChanges', () => {
  it('returns empty array when configs are identical', () => {
    const cfg = { authentication: { requireMFA: true, maxLoginAttempts: 5 } };
    expect(securityService.detectChanges(cfg, cfg)).toEqual([]);
  });

  it('detects changed primitive value', () => {
    const oldCfg = { authentication: { requireMFA: true } };
    const newCfg = { authentication: { requireMFA: false } };
    const changes = securityService.detectChanges(oldCfg, newCfg);
    expect(changes.length).toBeGreaterThan(0);
    expect(changes[0].path).toContain('requireMFA');
    expect(changes[0].oldValue).toBe(true);
    expect(changes[0].newValue).toBe(false);
  });

  it('detects added top-level key', () => {
    const changes = securityService.detectChanges({}, { session: { timeoutMinutes: 30 } });
    expect(changes.length).toBeGreaterThan(0);
  });

  it('#953: skips the flat server-owned fields but still reports real group changes', () => {
    // configVersion/lastUpdatedAt/lastUpdatedBy are rewritten on every save by
    // definition, so they must never surface as user-visible policy changes.
    // Before #953 they lived under a `metadata` OBJECT and were skipped by the
    // typeof-object branch; flattened, they are scalars and only
    // SERVER_OWNED_KEYS keeps them out.
    const oldCfg = {
      authentication: { requireMFA: false },
      configVersion: 1,
      lastUpdatedAt: new Date('2020-01-01'),
      lastUpdatedBy: 'admin1'
    };
    const newCfg = {
      authentication: { requireMFA: true },
      configVersion: 2,
      lastUpdatedAt: new Date('2021-01-01'),
      lastUpdatedBy: 'admin2'
    };

    const changes = securityService.detectChanges(oldCfg, newCfg);
    const paths = changes.map(c => c.path);

    // The real change is reported...
    expect(paths).toContain('authentication.requireMFA');
    // ...and none of the three server-owned fields is.
    expect(paths).not.toContain('configVersion');
    expect(paths).not.toContain('lastUpdatedAt');
    expect(paths).not.toContain('lastUpdatedBy');
    expect(changes).toHaveLength(1);
  });
});

describe('SecurityService.getSeverityForChange', () => {
  it('returns critical for authentication.requireMFA', () => {
    expect(securityService.getSeverityForChange('authentication.requireMFA')).toBe('critical');
  });

  it('returns critical for session.timeoutMinutes', () => {
    expect(securityService.getSeverityForChange('session.timeoutMinutes')).toBe('critical');
  });

  it('returns critical for enhancedSecurity.enabled', () => {
    expect(securityService.getSeverityForChange('enhancedSecurity.enabled')).toBe('critical');
  });

  it('returns warning for non-critical paths', () => {
    expect(securityService.getSeverityForChange('logging.level')).toBe('warning');
    expect(securityService.getSeverityForChange('lgpd.allowDataExport')).toBe('warning');
  });
});

describe('SecurityService.validateConfig', () => {
  it('does not throw for empty config', () => {
    expect(() => securityService.validateConfig({})).not.toThrow();
  });

  it('does not throw for valid authentication settings', () => {
    expect(() => securityService.validateConfig({
      authentication: { maxLoginAttempts: 5, mfaMethod: 'totp' },
    })).not.toThrow();
  });

  it('throws for invalid maxLoginAttempts (too high)', () => {
    expect(() => securityService.validateConfig({
      authentication: { maxLoginAttempts: 99 },
    })).toThrow('inválidas');
  });

  // #1249: TOTP is the only method implemented.
  it('throws for sms and email, which no code implements', () => {
    for (const mfaMethod of ['sms', 'email']) {
      expect(() => securityService.validateConfig({ authentication: { mfaMethod } })).toThrow('inválidas');
    }
  });

  // #1255: ipAttempt.service reads blockIPAfterAttempts; 0 tracks without blocking.
  it('accepts blockIPAfterAttempts 0..100 as an integer and refuses anything else', () => {
    for (const ok of [0, 1, 10, 100]) {
      expect(() => securityService.validateConfig({ loginAttempts: { blockIPAfterAttempts: ok } })).not.toThrow();
    }
    for (const bad of [-1, 101, 2.5, '10']) {
      expect(() => securityService.validateConfig({ loginAttempts: { blockIPAfterAttempts: bad } })).toThrow('inválidas');
    }
  });

  // #1253: NIST SP 800-63B §5.1.1.2 floor.
  it('throws for a passwordRules.minLength below 8, and accepts 8', () => {
    expect(() => securityService.validateConfig({ passwordRules: { minLength: 7 } })).toThrow('inválidas');
    expect(() => securityService.validateConfig({ passwordRules: { minLength: 6 } })).toThrow('inválidas');
    expect(() => securityService.validateConfig({ passwordRules: { minLength: 8 } })).not.toThrow();
  });

  it('throws for invalid mfaMethod', () => {
    expect(() => securityService.validateConfig({
      authentication: { mfaMethod: 'fingerprint' },
    })).toThrow('inválidas');
  });

  it('throws for invalid passwordRules.minLength', () => {
    expect(() => securityService.validateConfig({
      passwordRules: { minLength: 3 },
    })).toThrow('inválidas');
  });

  it('throws for invalid passwordRules.expirationDays', () => {
    expect(() => securityService.validateConfig({
      passwordRules: { expirationDays: 400 },
    })).toThrow('inválidas');
  });

  // #1244: password.service reads this depth, so the config refuses what the
  // page's own 1..20 input would refuse.
  it.each([0, 21, 2.5, '5'])('throws for passwordRules.maxReuseHistory %j', (value) => {
    expect(() => securityService.validateConfig({
      passwordRules: { maxReuseHistory: value },
    })).toThrow('inválidas');
  });

  it.each([1, 5, 20])('accepts passwordRules.maxReuseHistory %j', (value) => {
    expect(() => securityService.validateConfig({
      passwordRules: { maxReuseHistory: value },
    })).not.toThrow();
  });

  it('throws for invalid session.maxSessionDurationHours', () => {
    expect(() => securityService.validateConfig({
      session: { maxSessionDurationHours: 48 },
    })).toThrow('inválidas');
  });

  it('throws for session.timeoutMinutes out of range', () => {
    expect(() => securityService.validateConfig({
      session: { timeoutMinutes: 600 },
    })).toThrow('inválidas');
  });

  it('throws for invalid logging.level', () => {
    expect(() => securityService.validateConfig({
      logging: { level: 'verbose' },
    })).toThrow('inválidas');
  });

  it('accepts valid passwordRules', () => {
    expect(() => securityService.validateConfig({
      passwordRules: { minLength: 12, expirationDays: 90 },
    })).not.toThrow();
  });

  // #909: the schema over getDefaultConfig()'s groups.
  it('accepts the whole default document, the shape SecurityPage sends back', () => {
    expect(() => securityService.validateConfig(securityService.getDefaultConfig())).not.toThrow();
  });

  it('refuses a key the group does not declare, naming its path', () => {
    expect(() => securityService.validateConfig({ authentication: { maxLoginAtempts: 3 } }))
      .toThrow('authentication.maxLoginAtempts não é uma configuração conhecida');
  });

  it.each([
    ['authentication', 'maxLoginAttempts', '5', 'um número'],
    ['session', 'timeoutMinutes', null, 'um número'],
    ['session', 'timeoutMinutes', Number.NaN, 'um número'],
    ['enhancedSecurity', 'enabled', 'true', 'verdadeiro ou falso'],
    ['lgpd', 'allowDataExport', 1, 'verdadeiro ou falso'],
    ['logging', 'level', 3, 'um texto'],
  ])('refuses %s.%s = %j as not %s', (group, key, value, typeName) => {
    expect(() => securityService.validateConfig({ [group]: { [key]: value } }))
      .toThrow(`${group}.${key} deve ser ${typeName}`);
  });

  it.each([['x'], [[]], [null], [5]])('refuses a group that is not an object: %j', (value) => {
    expect(() => securityService.validateConfig({ session: value })).toThrow('session deve ser um objeto');
  });

  it('range-checks 0, which the truthiness guards used to skip', () => {
    expect(() => securityService.validateConfig({ authentication: { maxLoginAttempts: 0 } })).toThrow('maxLoginAttempts deve estar entre 1 e 10');
    expect(() => securityService.validateConfig({ session: { timeoutMinutes: 0 } })).toThrow('timeoutMinutes deve estar entre 5 e 480');
    expect(() => securityService.validateConfig({ passwordRules: { minLength: 0 } })).toThrow('minLength deve estar entre 8 e 128');
    expect(() => securityService.validateConfig({ passwordRules: { expirationDays: 0 } })).not.toThrow();
  });

  // #1257: the MFA floor is a known key, 8..128, and never above minLength,
  // whether minLength arrives in the same request or is the stored one.
  it('#1257: range-checks minLengthWithMFA and refuses one above minLength', () => {
    expect(() => securityService.validateConfig({ passwordRules: { minLength: 15, minLengthWithMFA: 8 } })).not.toThrow();
    expect(() => securityService.validateConfig({ passwordRules: { minLengthWithMFA: 7 } })).toThrow('minLengthWithMFA deve estar entre 8 e 128');
    expect(() => securityService.validateConfig({ passwordRules: { minLength: 10, minLengthWithMFA: 12 } }))
      .toThrow('minLengthWithMFA não pode exceder minLength');
    expect(() => securityService.validateConfig({ passwordRules: { minLengthWithMFA: 12 } }, { passwordRules: { minLength: 10 } }))
      .toThrow('minLengthWithMFA não pode exceder minLength');
    expect(() => securityService.validateConfig({ passwordRules: { minLengthWithMFA: 12 } }, { passwordRules: { minLength: 15 } })).not.toThrow();
  });

  it('#1257: a new deployment stores the NIST SP 800-63B-4 defaults', () => {
    expect(securityService.getDefaultConfig().passwordRules).toMatchObject({
      minLength: 15, minLengthWithMFA: 8,
      requireUppercase: false, requireLowercase: false, requireNumbers: false, requireSpecialChars: false,
      expirationDays: 0,
    });
  });

  it('lets an unchanged echo of the stored document through, and nothing else', () => {
    const stored = { authentication: { legacyFlag: true }, session: { timeoutMinutes: null } };
    expect(() => securityService.validateConfig(
      { authentication: { legacyFlag: true, maxLoginAttempts: 4 }, session: { timeoutMinutes: null } },
      stored
    )).not.toThrow();
    // Control: the same keys with a new value are the caller's own.
    expect(() => securityService.validateConfig({ authentication: { legacyFlag: false } }, stored))
      .toThrow('authentication.legacyFlag não é uma configuração conhecida');
    expect(() => securityService.validateConfig({ session: { timeoutMinutes: '30' } }, stored))
      .toThrow('session.timeoutMinutes deve ser um número');
  });

  it('ignores the document\'s own top-level fields, which updateConfig never stores', () => {
    expect(() => securityService.validateConfig({ configVersion: 'x', governedBy: {}, updatedAt: 'y' })).not.toThrow();
  });
});

describe('SecurityService.formatLogsAsCSV', () => {
  it('returns header-only CSV for empty logs', () => {
    const result = securityService.formatLogsAsCSV([]);
    expect(result).toContain('timestamp');
    expect(result).toContain('userID');
    expect(result).toContain('action');
  });

  it('returns CSV with one data row for one log', () => {
    const log = { action: 'CREATE', entity: 'Sample', severity: 'info', module: 'Test', message: 'msg' };
    const result = securityService.formatLogsAsCSV([log]);
    const lines = result.trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('CREATE');
    expect(lines[1]).toContain('Sample');
  });

  it('escapes double quotes in message', () => {
    const log = { message: 'say "hello"' };
    const result = securityService.formatLogsAsCSV([log]);
    expect(result).toContain('""hello""');
  });

  it('handles missing fields gracefully', () => {
    const log = {};
    expect(() => securityService.formatLogsAsCSV([log])).not.toThrow();
  });
});

describe('SecurityService.getConfig', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns stripped config (no _id/createdAt) when a config exists in db', async () => {
    const stored = { _id: 'main', createdAt: new Date(), updatedAt: new Date(), authentication: { requireMFA: true } };
    const findOne = vi.fn().mockResolvedValue(stored);
    const db = { collection: vi.fn(() => ({ findOne })) };

    const result = await securityService.getConfig(db);

    expect(result).not.toHaveProperty('_id');
    expect(result).not.toHaveProperty('createdAt');
    expect(result.authentication.requireMFA).toBe(true);
  });

  it('creates and returns default config when none exists in db', async () => {
    const findOne = vi.fn().mockResolvedValue(null);
    const insertOne = vi.fn().mockResolvedValue({});
    const db = { collection: vi.fn(() => ({ findOne, insertOne })) };

    const result = await securityService.getConfig(db);

    expect(insertOne).toHaveBeenCalledTimes(1);
    const insertedArg = insertOne.mock.calls[0][0];
    expect(insertedArg._id).toBe('main');
    expect(result).toHaveProperty('authentication');
    expect(result).not.toHaveProperty('_id');
  });

  it('logs and rethrows when db access fails', async () => {
    const error = new Error('db down');
    const findOne = vi.fn().mockRejectedValue(error);
    const db = { collection: vi.fn(() => ({ findOne })) };
    const errSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});

    await expect(securityService.getConfig(db)).rejects.toThrow('db down');
    expect(errSpy).toHaveBeenCalled();
  });
});

// RF014 AC2: the release step is tested in configurationRelease.service's
// own tests; the db doubles below model only the security_config document.
function stubRelease() {
  return vi.spyOn(securityService, 'activateRelease').mockResolvedValue({ configurationReleaseId: 'rel-test', effectivePeriod: { start: new Date(), end: null } });
}

describe('SecurityService.updateConfig', () => {
  beforeEach(() => {
    stubRelease();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('merges config, persists it and logs audit entries for each change', async () => {
    const updateOne = vi.fn().mockResolvedValue({});
    const db = { collection: vi.fn(() => ({ updateOne })) };
    vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
    const logSpy = vi.spyOn(auditLogger, 'log').mockResolvedValue({});

    const currentConfig = { authentication: { requireMFA: false }, configVersion: 1 };
    const newConfig = { authentication: { requireMFA: true } };
    const req = { user: { userID: 'u1' } };

    const result = await securityService.updateConfig(db, newConfig, currentConfig, req);

    expect(updateOne).toHaveBeenCalledTimes(1);
    expect(result.authentication.requireMFA).toBe(true);
    expect(result.configVersion).toBe(2);
    expect(result.lastUpdatedBy).toBe('u1');
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy.mock.calls[0][0].severity).toBe('critical');
  });

  // #1116: the audit row for a security-config change must carry the
  // canonical entity name. dict-02 Entidade says SecurityConfiguration in 49
  // rows and never SecurityConfig, and #1115 already maps /api/security there
  // in audit.middleware.js ENTITY_MAP -- so this explicit writer was the last
  // thing still emitting the short form, splitting one entity across two
  // resourceType values in the same collection.
  it('audits a security-config change under the canonical SecurityConfiguration entity', async () => {
    const updateOne = vi.fn().mockResolvedValue({});
    const db = { collection: vi.fn(() => ({ updateOne })) };
    vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
    const logSpy = vi.spyOn(auditLogger, 'log').mockResolvedValue({});

    const currentConfig = { authentication: { requireMFA: false }, configVersion: 1 };
    const newConfig = { authentication: { requireMFA: true } };
    const req = { user: { userID: 'u1' } };

    await securityService.updateConfig(db, newConfig, currentConfig, req);

    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy.mock.calls[0][0].resourceType).toBe('SecurityConfiguration');
  });

  // #1249: loginAttempts.maxAttempts/lockoutDurationMinutes duplicate the
  // authentication pair the lockout reads; the stored copy follows it.
  it('stores the loginAttempts duplicate pair equal to the enforced authentication pair', async () => {
    const updateOne = vi.fn().mockResolvedValue({});
    const db = { collection: vi.fn(() => ({ updateOne })) };
    vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
    vi.spyOn(auditLogger, 'log').mockResolvedValue({});

    const currentConfig = {
      authentication: { maxLoginAttempts: 5, lockoutDurationMinutes: 30 },
      loginAttempts: { maxAttempts: 5, lockoutDurationMinutes: 30, trackIP: true },
      configVersion: 1,
    };
    const result = await securityService.updateConfig(db, {
      authentication: { maxLoginAttempts: 3, lockoutDurationMinutes: 60 },
      loginAttempts: { maxAttempts: 9 },
    }, currentConfig, {});

    expect(result.loginAttempts).toEqual({ maxAttempts: 3, lockoutDurationMinutes: 60, trackIP: true });
    expect(updateOne.mock.calls[0][1].$set.loginAttempts).toEqual({ maxAttempts: 3, lockoutDurationMinutes: 60, trackIP: true });
  });

  it('uses SYSTEM as lastUpdatedBy when req has no user', async () => {
    const updateOne = vi.fn().mockResolvedValue({});
    const db = { collection: vi.fn(() => ({ updateOne })) };
    vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
    vi.spyOn(auditLogger, 'log').mockResolvedValue({});

    const result = await securityService.updateConfig(db, {}, {}, {});

    expect(result.lastUpdatedBy).toBe('SYSTEM');
  });

  it('rejects and does not write to db when newConfig fails validation', async () => {
    const updateOne = vi.fn().mockResolvedValue({});
    const db = { collection: vi.fn(() => ({ updateOne })) };
    const errSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});

    const currentConfig = { authentication: { maxLoginAttempts: 5 } };
    const newConfig = { authentication: { maxLoginAttempts: 99 } };

    await expect(securityService.updateConfig(db, newConfig, currentConfig, {})).rejects.toThrow('inválidas');
    expect(updateOne).not.toHaveBeenCalled();
    expect(errSpy).toHaveBeenCalled();
  });

  it('deep-merges a partial group update, preserving sibling flags in that group (#904)', async () => {
    const updateOne = vi.fn().mockResolvedValue({});
    const db = { collection: vi.fn(() => ({ updateOne })) };
    vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
    vi.spyOn(auditLogger, 'log').mockResolvedValue({});

    const currentConfig = {
      session: {
        timeoutMinutes: 30,
        maxSessionDurationHours: 12,
        allowMultipleSessions: false,
        autoRenewal: true,
        logExpiration: true
      },
      configVersion: 1
    };
    const newConfig = { session: { timeoutMinutes: 45 } };

    const result = await securityService.updateConfig(db, newConfig, currentConfig, {});

    expect(result.session.timeoutMinutes).toBe(45);
    expect(result.session.allowMultipleSessions).toBe(false);
    expect(result.session.autoRenewal).toBe(true);
    expect(result.session.logExpiration).toBe(true);
    expect(result.session.maxSessionDurationHours).toBe(12);

    const setArg = updateOne.mock.calls[0][1].$set;
    expect(setArg.session.allowMultipleSessions).toBe(false);
    expect(setArg.session.autoRenewal).toBe(true);
    expect(setArg.session.logExpiration).toBe(true);
  });

  it('#953: ignores caller-supplied server-owned fields and rewrites them itself', async () => {
    const updateOne = vi.fn().mockResolvedValue({});
    const db = { collection: vi.fn(() => ({ updateOne })) };
    vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
    vi.spyOn(auditLogger, 'log').mockResolvedValue({});

    const currentConfig = { configVersion: 3, lastUpdatedBy: 'admin1' };
    const newConfig = { configVersion: 999, lastUpdatedBy: 'attacker' };

    const result = await securityService.updateConfig(db, newConfig, currentConfig, { user: { userID: 'admin2' } });

    // Server-owned: derived from the STORED value, never from the caller's.
    expect(result.configVersion).toBe(4);
    expect(result.lastUpdatedBy).toBe('admin2');
  });
});

describe('SecurityService.exportLogs', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function makeDbWithLogs(logs) {
    const toArray = vi.fn().mockResolvedValue(logs);
    const limit = vi.fn(() => ({ toArray }));
    const sort = vi.fn(() => ({ limit }));
    const find = vi.fn(() => ({ sort }));
    return { db: { collection: vi.fn(() => ({ find })) }, find };
  }

  // #1267: both formats go through the read-time anonymisation getLogs
  // applies (RNF007 AC 5); before it the JSON export was the raw documents.
  it('returns the anonymised logs array (not CSV) when format is not csv', async () => {
    const logs = [{ action: 'CREATE', entity: 'Sample' }];
    const { db } = makeDbWithLogs(logs);

    const result = await securityService.exportLogs(db, {}, 'json');

    expect(Array.isArray(result)).toBe(true);
    expect(result[0]).toEqual(expect.objectContaining({ action: 'CREATE', entity: 'Sample', userName: 'USR-SYSTEM' }));
  });

  it('#1267: a row stored with a real user id, a name and personal metadata leaves pseudonymised', async () => {
    const logs = [{
      action: 'UPDATE',
      userID: 'u-real-1',
      userName: 'Maria Silva',
      metadata: { user: { userName: 'Maria Silva', email: 'maria@example.org', userRole: 'Administrador' } },
    }];
    const { db } = makeDbWithLogs(logs);

    const [row] = await securityService.exportLogs(db, {}, 'json');

    expect(row.userName).toMatch(/^USR-/);
    expect(row.userID).toBe(row.userName);
    expect(JSON.stringify(row)).not.toContain('Maria Silva');
    expect(JSON.stringify(row)).not.toContain('maria@example.org');
    expect(JSON.stringify(row)).not.toContain('u-real-1');
  });

  it('returns CSV header-only string for empty result set', async () => {
    const { db } = makeDbWithLogs([]);

    const result = await securityService.exportLogs(db, {}, 'csv');

    expect(result).toBe('timestamp,userID,action,entity,severity,module,message\n');
  });

  it('applies severity, module, action(uppercased) and entity filters to the query', async () => {
    const { db, find } = makeDbWithLogs([]);

    await securityService.exportLogs(db, { severity: 'critical', module: 'Segurança', action: 'update', entity: 'SecurityConfig' }, 'csv');

    expect(find).toHaveBeenCalledWith({
      severity: 'critical',
      module: 'Segurança',
      action: 'UPDATE',
      entity: 'SecurityConfig'
    });
  });

  it('builds a timestamp range query from startDate and endDate filters', async () => {
    const { db, find } = makeDbWithLogs([]);

    await securityService.exportLogs(db, { startDate: '2026-01-01', endDate: '2026-02-01' }, 'csv');

    const queryArg = find.mock.calls[0][0];
    expect(queryArg.timestamp.$gte).toEqual(new Date('2026-01-01'));
    expect(queryArg.timestamp.$lte).toEqual(new Date('2026-02-01'));
  });

  it('builds a timestamp query with only $lte when only endDate is provided', async () => {
    const { db, find } = makeDbWithLogs([]);

    await securityService.exportLogs(db, { endDate: '2026-02-01' }, 'csv');

    const queryArg = find.mock.calls[0][0];
    expect(queryArg.timestamp.$lte).toEqual(new Date('2026-02-01'));
    expect(queryArg.timestamp.$gte).toBeUndefined();
  });

  it('applies only the module filter to the query', async () => {
    const { db, find } = makeDbWithLogs([]);

    await securityService.exportLogs(db, { module: 'Segurança' }, 'csv');

    expect(find).toHaveBeenCalledWith({ module: 'Segurança' });
  });

  it('logs and rethrows when the logs collection query fails', async () => {
    const error = new Error('query failed');
    const find = vi.fn(() => { throw error; });
    const db = { collection: vi.fn(() => ({ find })) };
    const errSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});

    await expect(securityService.exportLogs(db, {}, 'csv')).rejects.toThrow('query failed');
    expect(errSpy).toHaveBeenCalled();
  });
});

describe('SecurityService.getPermissions', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // #1341: the roles and permissions come from the collections the RBAC seed
  // writes, through the real seed, so the payload is what enforcement reads.
  function createSeedDb() {
    const store = {};
    const matches = (doc, filter) => Object.keys(filter).every((k) => doc[k] === filter[k]);
    const collectionOf = (name) => {
      if (!store[name]) {
        const docs = [];
        store[name] = {
          docs,
          async insertOne(doc) { docs.push(doc); return { insertedId: docs.length }; },
          async findOne(filter = {}) { return docs.find((d) => matches(d, filter)) || null; },
          async updateOne(filter, update) {
            const doc = docs.find((d) => matches(d, filter));
            if (doc && update.$set) Object.assign(doc, update.$set);
            return { matchedCount: doc ? 1 : 0 };
          },
          find(filter = {}) { return { toArray: async () => docs.filter((d) => matches(d, filter)) }; },
        };
      }
      return store[name];
    };
    return { store, collection: vi.fn(collectionOf) };
  }

  async function seededDb() {
    const db = createSeedDb();
    await seedRolesAndPermissions(db);
    return db;
  }

  it('#1341: lists every seeded role, the additive auditor included, with its displayName', async () => {
    const db = await seededDb();

    const { roles } = await securityService.getPermissions(db);

    expect(roles.map((r) => r.roleCode)).toEqual(['administrator', 'coordinator', 'technician', 'external_user', 'auditor']);
    const auditor = roles.find((r) => r.roleCode === 'auditor');
    expect(auditor.hierarchyLevel).toBeNull();
    expect(auditor.permissionCodes).toEqual(['viewAuditLogs']);
    for (const role of roles) expect(typeof role.displayName).toBe('string');
  });

  it("#1341: a role's codes are the ones its stored permissionIds name, not a hardcoded map", async () => {
    const db = await seededDb();
    const idOf = (code) => db.store.permissions.docs.find((p) => p.permissionCode === code).permissionId;
    const technician = db.store.roles.docs.find((r) => r.roleCode === 'technician');
    technician.permissionIds = [idOf('viewReports'), idOf('manageBackup')];

    const { roles } = await securityService.getPermissions(db);

    expect(roles.find((r) => r.roleCode === 'technician').permissionCodes).toEqual(['manageBackup', 'viewReports']);
  });

  // The old map listed manageSecurity, which the catalog does not have, and
  // #1110 removed useAssistant, which nothing gated.
  it('#1341: lists every stored permission with its catalog displayName, and no code the catalog lacks', async () => {
    const db = await seededDb();

    const { roles, permissions } = await securityService.getPermissions(db);

    expect(permissions).toHaveLength(db.store.permissions.docs.length);
    for (const p of permissions) {
      expect(PERMISSION_CATALOG[p.permissionCode]).toBeDefined();
      expect(p.displayName).toBe(PERMISSION_CATALOG[p.permissionCode].displayName);
    }
    const granted = new Set(roles.flatMap((r) => r.permissionCodes));
    expect(granted.has('manageSecurity')).toBe(false);
    expect(granted.has('useAssistant')).toBe(false);
  });

  // #1149: the `security_permissions` overlay the removed PUT wrote is
  // never read, since no enforcement path read it.
  it('#1149: never reads the security_permissions collection', async () => {
    const db = await seededDb();

    await securityService.getPermissions(db);

    expect(db.collection.mock.calls.map(([name]) => name)).not.toContain('security_permissions');
  });
});

// #1149: updatePermissions, detectPermissionChanges and validatePermissions
// were removed with PUT /api/security/permissions, their only caller.
it('#1149: the permission write methods no longer exist', () => {
  expect(securityService.updatePermissions).toBeUndefined();
  expect(securityService.detectPermissionChanges).toBeUndefined();
  expect(securityService.validatePermissions).toBeUndefined();
});

// #649 / RNF008 C7: "Invalidar cache/sessão quando papéis ou políticas exigirem." The predicate is
// tightening-only and, today, single-entry -- session.timeoutMinutes is the one
// SecurityConfiguration key any code path enforces (#914). These three cases pin
// the predicate itself, which is the part that will be wrong if anyone widens the
// list without thinking about direction.
describe('SecurityService.updateConfig session revocation (#649)', () => {
  beforeEach(() => {
    stubRelease();
  });

  function makeDb() {
    const sessions = { updateMany: vi.fn().mockResolvedValue({ modifiedCount: 4 }) };
    const config = { updateOne: vi.fn().mockResolvedValue({}), insertOne: vi.fn().mockResolvedValue({}) };
    return {
      sessions,
      config,
      db: { collection: vi.fn((name) => (name === 'sessions' ? sessions : config)) },
    };
  }

  const req = { user: { userID: 'admin-1' }, headers: { authorization: 'Bearer admin-token' } };

  it('revokes when the session timeout is TIGHTENED', async () => {
    const { db, sessions } = makeDb();

    await securityService.updateConfig(
      db,
      { session: { timeoutMinutes: 15 } },
      { session: { timeoutMinutes: 30 } },
      req
    );

    expect(sessions.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ isActive: true }),
      expect.objectContaining({
        $set: expect.objectContaining({ isRevoked: true, revocationReason: 'admin_action', revokedBy: 'admin-1' }),
      })
    );
  });

  it('does NOT revoke when the timeout is LOOSENED -- relaxing a limit invalidates no issued token', async () => {
    const { db, sessions } = makeDb();

    await securityService.updateConfig(
      db,
      { session: { timeoutMinutes: 45 } },
      { session: { timeoutMinutes: 30 } },
      req
    );

    expect(sessions.updateMany).not.toHaveBeenCalled();
  });

  it('#914: revokes when the absolute session cap is TIGHTENED, not when it is loosened', async () => {
    const tightened = makeDb();
    await securityService.updateConfig(
      tightened.db,
      { session: { maxSessionDurationHours: 4 } },
      { session: { maxSessionDurationHours: 12 } },
      req
    );
    expect(tightened.sessions.updateMany).toHaveBeenCalled();

    const loosened = makeDb();
    await securityService.updateConfig(
      loosened.db,
      { session: { maxSessionDurationHours: 24 } },
      { session: { maxSessionDurationHours: 12 } },
      req
    );
    expect(loosened.sessions.updateMany).not.toHaveBeenCalled();
  });

  it('does NOT revoke on requireMFA, which is still inert -- it would readmit everyone WITHOUT MFA', async () => {
    const { db, sessions } = makeDb();

    await securityService.updateConfig(
      db,
      { authentication: { requireMFA: true } },
      { authentication: { requireMFA: false } },
      req
    );

    expect(sessions.updateMany).not.toHaveBeenCalled();
  });
});

// #1254: a stored allowMultipleSessions false that no audit row shows an
// administrator setting is the old code default, and is rewritten to true once.
describe('SecurityService.reconcileAllowMultipleSessions (#1254)', () => {
  let auditSpy;
  beforeEach(() => {
    auditSpy = vi.spyOn(auditLogger, 'log').mockResolvedValue(undefined);
    vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  function makeDb({ marker = null, config = null, liveRow = null, archivedRow = null } = {}) {
    const collections = {
      systemBootstrap: { findOne: vi.fn().mockResolvedValue(marker), updateOne: vi.fn().mockResolvedValue({}) },
      security_config: { findOne: vi.fn().mockResolvedValue(config), updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }) },
      logs: { findOne: vi.fn().mockResolvedValue(liveRow) },
      logs_archive: { findOne: vi.fn().mockResolvedValue(archivedRow) },
    };
    return { db: { collection: vi.fn((name) => collections[name]) }, ...collections };
  }

  it('rewrites an unchosen false to true, audits it, and marks the rewrite done', async () => {
    const { db, security_config, systemBootstrap, logs } = makeDb({ config: { _id: 'main', session: { allowMultipleSessions: false } } });

    await expect(securityService.reconcileAllowMultipleSessions(db)).resolves.toEqual({ status: 'rewritten' });

    expect(logs.findOne).toHaveBeenCalledWith({
      resourceType: { $in: ['SecurityConfiguration', 'SecurityConfig'] },
      'payload.path': 'session.allowMultipleSessions',
    });
    expect(security_config.updateOne).toHaveBeenCalledWith(
      { _id: 'main', 'session.allowMultipleSessions': false },
      { $set: expect.objectContaining({ 'session.allowMultipleSessions': true }) }
    );
    expect(auditSpy).toHaveBeenCalledWith(expect.objectContaining({
      resourceType: 'SecurityConfiguration',
      payload: expect.objectContaining({ path: 'session.allowMultipleSessions', oldValue: false, newValue: true }),
    }));
    expect(systemBootstrap.updateOne).toHaveBeenCalledWith(
      { _id: 'allow_multiple_sessions_default_v1' },
      { $set: expect.objectContaining({ status: 'rewritten' }) },
      { upsert: true }
    );
  });

  it.each([
    ['the live trail', { liveRow: { _id: 'l1' } }],
    ['the archive', { archivedRow: { _id: 'a1' } }],
  ])('keeps a false an administrator set, found in %s', async (_where, rows) => {
    const { db, security_config } = makeDb({ config: { _id: 'main', session: { allowMultipleSessions: false } }, ...rows });

    await expect(securityService.reconcileAllowMultipleSessions(db)).resolves.toEqual({ status: 'kept_administrator_choice' });
    expect(security_config.updateOne).not.toHaveBeenCalled();
    expect(auditSpy).not.toHaveBeenCalled();
  });

  it('runs once: with the marker present it reads and writes nothing else', async () => {
    const { db, security_config, systemBootstrap } = makeDb({
      marker: { _id: 'allow_multiple_sessions_default_v1' },
      config: { _id: 'main', session: { allowMultipleSessions: false } },
    });

    await expect(securityService.reconcileAllowMultipleSessions(db)).resolves.toEqual({ status: 'already_reconciled' });
    expect(security_config.findOne).not.toHaveBeenCalled();
    expect(systemBootstrap.updateOne).not.toHaveBeenCalled();
  });

  it.each([
    ['true', { _id: 'main', session: { allowMultipleSessions: true } }, 'kept'],
    ['no document (a new deployment)', null, 'no_document'],
  ])('leaves %s alone and still marks it done', async (_label, config, status) => {
    const { db, security_config, systemBootstrap } = makeDb({ config });

    await expect(securityService.reconcileAllowMultipleSessions(db)).resolves.toEqual({ status });
    expect(security_config.updateOne).not.toHaveBeenCalled();
    expect(systemBootstrap.updateOne).toHaveBeenCalledTimes(1);
  });

  it('a new deployment stores true', () => {
    expect(securityService.getDefaultConfig().session.allowMultipleSessions).toBe(true);
  });
});
