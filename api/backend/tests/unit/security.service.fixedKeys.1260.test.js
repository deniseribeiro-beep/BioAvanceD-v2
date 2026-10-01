import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const securityService = require('../../src/services/security.service');
const retentionPolicyService = require('../../src/services/retentionPolicy.service');
const auditLogger = require('../../src/utils/auditLogger');
const logger = require('../../src/utils/logger');
const logLevel = require('../../src/utils/logLevel');

// #1260: logging.level drives the backend logger's minimum level, and the
// logging switches RNF009 makes mandatory are fixed at true.
// #1261: privacy.anonymizeLogs is fixed at true, and the two privacy periods
// no job applies are fixed at null. A write to a fixed key is dropped.

const stored = () => ({
  _id: 'main',
  logging: { level: 'warning', logLoginAttempts: false, logAllActions: false, retentionDays: 365 },
  privacy: { anonymizeLogs: false, dataRetentionDays: 30, autoPurge: false, purgeAfterDays: 730, anonymizeAfterDays: 10 },
  enhancedSecurity: { enabled: false, logAllActions: false },
  configVersion: 3,
});

function makeDb(doc = stored()) {
  const collection = {
    findOne: vi.fn().mockResolvedValue(doc),
    insertOne: vi.fn().mockResolvedValue({}),
    updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
  };
  return { collection: vi.fn(() => collection), _c: collection };
}

beforeEach(() => {
  logLevel.setMinLevel('info');
  vi.spyOn(retentionPolicyService, 'getActivePolicy').mockResolvedValue(null);
  vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
  vi.spyOn(auditLogger, 'log').mockResolvedValue({});
});

afterEach(() => {
  vi.restoreAllMocks();
  logLevel.setMinLevel('info');
});

describe('#1260 #1261 getConfig shows the fixed keys at their fixed values', () => {
  it('overrides stored false/periods and names the reason in governedBy', async () => {
    const config = await securityService.getConfig(makeDb());
    expect(config.logging.logLoginAttempts).toBe(true);
    expect(config.logging.logAllActions).toBe(true);
    expect(config.enhancedSecurity.logAllActions).toBe(true);
    expect(config.privacy.anonymizeLogs).toBe(true);
    expect(config.privacy.dataRetentionDays).toBeNull();
    expect(config.privacy.anonymizeAfterDays).toBeNull();
    expect(config.governedBy['logging.logLoginAttempts']).toEqual(
      expect.objectContaining({ entity: 'Fixed', fixed: 'audit-required' })
    );
    expect(config.governedBy['privacy.anonymizeLogs'].fixed).toBe('always-anonymized');
    expect(config.governedBy['privacy.dataRetentionDays'].fixed).toBe('not-applied');
  });

  it('does not invent a group the document lacks', async () => {
    const { enhancedSecurity: _omit, ...doc } = stored();
    const config = await securityService.getConfig(makeDb(doc));
    expect(config.enhancedSecurity).toBeUndefined();
  });
});

describe('#1260 #1261 updateConfig drops writes to the fixed keys', () => {
  it('stores the fixed values and audits no change for them', async () => {
    const db = makeDb();
    const current = await securityService.getConfig(db);
    await securityService.updateConfig(db, {
      logging: { level: 'error', logLoginAttempts: false, logAllActions: false },
      privacy: { anonymizeLogs: false, dataRetentionDays: 7, anonymizeAfterDays: 7 },
      enhancedSecurity: { logAllActions: false },
    }, current, { user: { userID: 'admin' } });

    const set = db._c.updateOne.mock.calls[0][1].$set;
    expect(set.logging.logLoginAttempts).toBe(true);
    expect(set.logging.logAllActions).toBe(true);
    expect(set.enhancedSecurity.logAllActions).toBe(true);
    expect(set.privacy.anonymizeLogs).toBe(true);
    expect(set.privacy.dataRetentionDays).toBeNull();
    expect(set.privacy.anonymizeAfterDays).toBeNull();

    const auditedPaths = auditLogger.log.mock.calls.map(([entry]) => entry.payload.path);
    // Control: a real change in the same PUT is audited.
    expect(auditedPaths).toContain('logging.level');
    for (const path of Object.keys(securityService.FIXED_PATHS)) {
      expect(auditedPaths).not.toContain(path);
    }
  });
});

describe('#1260 logging.level sets the logger minimum level', () => {
  it('getConfig applies the stored level', async () => {
    await securityService.getConfig(makeDb());
    expect(logLevel.getMinLevel()).toBe('warning');
  });

  it('a saved level applies at once', async () => {
    const db = makeDb();
    const current = await securityService.getConfig(db);
    await securityService.updateConfig(db, { logging: { level: 'error' } }, current, { user: { userID: 'admin' } });
    expect(logLevel.getMinLevel()).toBe('error');
  });

  it('syncLogLevel reads the stored level, and survives a failing read', async () => {
    await securityService.syncLogLevel(makeDb());
    expect(logLevel.getMinLevel()).toBe('warning');

    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const broken = { collection: () => ({ findOne: vi.fn().mockRejectedValue(new Error('down')) }) };
    await expect(securityService.syncLogLevel(broken)).resolves.toBeUndefined();
    expect(logLevel.getMinLevel()).toBe('warning');
    expect(warn).toHaveBeenCalled();
  });
});

describe('#1260 the logger honours the minimum level', () => {
  it('info and warn print only at or above the level; error always prints', () => {
    const out = vi.spyOn(console, 'log').mockImplementation(() => {});
    const warnOut = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const errOut = vi.spyOn(console, 'error').mockImplementation(() => {});

    logLevel.setMinLevel('warning');
    logger.info('hidden');
    logger.warn('shown');
    expect(out).not.toHaveBeenCalled();
    expect(warnOut).toHaveBeenCalledTimes(1);

    logLevel.setMinLevel('critical');
    logger.warn('hidden');
    logger.error('shown');
    expect(warnOut).toHaveBeenCalledTimes(1);
    expect(errOut).toHaveBeenCalledTimes(1);

    logLevel.setMinLevel('info');
    logger.info('shown');
    expect(out).toHaveBeenCalledTimes(1);
  });

  it('an unknown level is refused and changes nothing', () => {
    logLevel.setMinLevel('error');
    expect(logLevel.setMinLevel('verbose')).toBe(false);
    expect(logLevel.getMinLevel()).toBe('error');
  });
});
