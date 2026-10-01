import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
const securityService = require('../../src/services/security.service');
const logger = require('../../src/utils/logger');
const auditLogger = require('../../src/utils/auditLogger');

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

describe('SecurityService.updateConfig', () => {
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
    const newConfig = { configVersion: 999, lastUpdatedBy: 'attacker', extra: 'x' };

    const result = await securityService.updateConfig(db, newConfig, currentConfig, { user: { userID: 'admin2' } });

    // Server-owned: derived from the STORED value, never from the caller's.
    expect(result.configVersion).toBe(4);
    expect(result.lastUpdatedBy).toBe('admin2');
    // And an unrecognised top-level key from the caller does not survive the merge.
    expect(result.extra).toBeUndefined();
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

  it('returns raw logs array (not CSV) when format is not csv', async () => {
    const logs = [{ action: 'CREATE', entity: 'Sample' }];
    const { db } = makeDbWithLogs(logs);

    const result = await securityService.exportLogs(db, {}, 'json');

    expect(Array.isArray(result)).toBe(true);
    expect(result).toEqual(logs);
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

  it('returns default permissions when no custom permissions are stored', async () => {
    const findOne = vi.fn().mockResolvedValue(null);
    const db = { collection: vi.fn(() => ({ findOne })) };

    const result = await securityService.getPermissions(db);

    expect(result['4'].manageSystem).toBe(true);
    expect(result['1'].createUser).toBeUndefined();
  });

  // #1149: this used to merge a `security_permissions` overlay over the
  // defaults. That overlay was written by the removed PUT and read by no
  // enforcement path, so echoing it showed a permission change that had not
  // happened. A stored overlay is now ignored, and the collection is not read.
  it('#1149: ignores a stored security_permissions overlay and never reads the collection', async () => {
    const findOne = vi.fn().mockResolvedValue({ permissions: { '2': { viewReports: false, createUser: true } } });
    const db = { collection: vi.fn(() => ({ findOne })) };

    const result = await securityService.getPermissions(db);

    expect(db.collection).not.toHaveBeenCalled();
    expect(findOne).not.toHaveBeenCalled();
    expect(result['2'].viewReports).toBe(true); // the default, not the overlay's false
    expect(result['2']).not.toHaveProperty('createUser');
  });

  // #1110: Usuario Externo was granted useAssistant: true by default. It
  // appeared nowhere else in the tracked tree -- no gate read it, no caller
  // sent it -- so it granted nothing while the UI told the user they had
  // assistant access. RF012 AC#10 excludes the feature from this scope.
  it('#1110: grants no useAssistant permission to any profile', async () => {
    const findOne = vi.fn().mockResolvedValue(null);
    const db = { collection: vi.fn(() => ({ findOne })) };

    const result = await securityService.getPermissions(db);

    for (const profile of Object.values(result)) {
      expect(profile).not.toHaveProperty('useAssistant');
    }
    // control: profile 1 still carries its one real grant
    expect(result['1'].viewReports).toBe(true);
  });
});

// #1149: updatePermissions, detectPermissionChanges and validatePermissions
// were removed with PUT /api/security/permissions, their only caller.
it('#1149: the permission write methods no longer exist', () => {
  expect(securityService.updatePermissions).toBeUndefined();
  expect(securityService.detectPermissionChanges).toBeUndefined();
  expect(securityService.validatePermissions).toBeUndefined();
});

// #649 / RF014 AC#8: "Revogar sessoes quando a alteracao exigir." The predicate is
// tightening-only and, today, single-entry -- session.timeoutMinutes is the one
// SecurityConfiguration key any code path enforces (#914). These three cases pin
// the predicate itself, which is the part that will be wrong if anyone widens the
// list without thinking about direction.
describe('SecurityService.updateConfig session revocation (#649)', () => {
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
