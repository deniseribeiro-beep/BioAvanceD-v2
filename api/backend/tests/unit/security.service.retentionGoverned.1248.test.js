import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const securityService = require('../../src/services/security.service');
const retentionPolicyService = require('../../src/services/retentionPolicy.service');
const auditLogger = require('../../src/utils/auditLogger');
const logger = require('../../src/utils/logger');

// #1248: logging.retentionDays, privacy.autoPurge and privacy.purgeAfterDays
// restated the active RetentionPolicy and were followed by nothing. They are
// now derived from it on read, follow it on every save, and a write to them
// is dropped.

const stored = () => ({
  _id: 'main',
  logging: { level: 'info', logLoginAttempts: true, logAllActions: true, retentionDays: 365 },
  privacy: { anonymizeLogs: true, dataRetentionDays: 365, autoPurge: false, purgeAfterDays: 730, anonymizeAfterDays: 90 },
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

const policy = (postRetentionAction, extra = {}) => ({
  _id: 'pol-1248', version: 'v7', active: true,
  applicableEntityTypes: ['Log', 'AuditEvent'], postRetentionAction, retentionPeriod: 'P400D', ...extra,
});

beforeEach(() => {
  vi.spyOn(logger, 'warn').mockImplementation(() => {});
  vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
  vi.spyOn(auditLogger, 'log').mockResolvedValue({});
  // RF014 AC2: the release step is tested in configurationRelease.service's
  // own tests; this db double models only the security_config document.
  vi.spyOn(securityService, 'activateRelease').mockResolvedValue({ configurationReleaseId: 'rel-test', effectivePeriod: { start: new Date(), end: null } });
});

afterEach(() => { vi.restoreAllMocks(); });

describe('#1248 getConfig derives the retention keys from the active RetentionPolicy', () => {
  it('destroy: the period, purging, and purgeAfterDays', async () => {
    vi.spyOn(retentionPolicyService, 'getActivePolicy').mockResolvedValue(policy('destroy'));
    const config = await securityService.getConfig(makeDb());
    expect(config.logging.retentionDays).toBe(400);
    expect(config.privacy.autoPurge).toBe(true);
    expect(config.privacy.purgeAfterDays).toBe(400);
    expect(config.governedBy['logging.retentionDays']).toEqual(expect.objectContaining({ entity: 'RetentionPolicy', policyId: 'pol-1248', version: 'v7' }));
    // #1260, #1261: the fixed keys share governedBy with the retention keys.
    expect(Object.keys(config.governedBy).sort()).toEqual(
      [...securityService.RETENTION_GOVERNED_PATHS, ...Object.keys(securityService.FIXED_PATHS)].sort()
    );
  });

  it('archive: removes from the live collections, but purges nothing', async () => {
    vi.spyOn(retentionPolicyService, 'getActivePolicy').mockResolvedValue(policy('archive'));
    const config = await securityService.getConfig(makeDb());
    expect(config.privacy.autoPurge).toBe(true);
    expect(config.privacy.purgeAfterDays).toBeNull();
    expect(config.logging.retentionDays).toBe(400);
  });

  it('review: nothing is removed', async () => {
    vi.spyOn(retentionPolicyService, 'getActivePolicy').mockResolvedValue(policy('review'));
    expect((await securityService.getConfig(makeDb())).privacy.autoPurge).toBe(false);
  });

  it('no active policy, or one covering neither Log nor AuditEvent: nothing is purged and the periods are null', async () => {
    for (const active of [null, policy('destroy', { applicableEntityTypes: ['Sample'] })]) {
      vi.spyOn(retentionPolicyService, 'getActivePolicy').mockResolvedValue(active);
      const config = await securityService.getConfig(makeDb());
      expect(config.privacy.autoPurge).toBe(false);
      expect(config.logging.retentionDays).toBeNull();
      expect(config.privacy.purgeAfterDays).toBeNull();
      expect(config.governedBy['privacy.autoPurge'].policyId).toBeNull();
    }
  });

  it('keys no policy governs keep their stored values', async () => {
    vi.spyOn(retentionPolicyService, 'getActivePolicy').mockResolvedValue(policy('destroy'));
    const config = await securityService.getConfig(makeDb());
    // privacy.anonymizeAfterDays and dataRetentionDays left this list with
    // #1261: no job applies them, so they are fixed at null.
    expect(config.logging.level).toBe('info');
  });

  it('an unreadable policy leaves the stored values but still marks the keys governed', async () => {
    vi.spyOn(retentionPolicyService, 'getActivePolicy').mockRejectedValue(new Error('down'));
    const config = await securityService.getConfig(makeDb());
    expect(config.logging.retentionDays).toBe(365);
    expect(config.governedBy['logging.retentionDays']).toEqual(expect.objectContaining({ unavailable: true }));
  });

  it('the default document gets the same overlay', async () => {
    vi.spyOn(retentionPolicyService, 'getActivePolicy').mockResolvedValue(policy('destroy'));
    const db = makeDb(null);
    const config = await securityService.getConfig(db);
    expect(config.logging.retentionDays).toBe(400);
    expect(config.governedBy).toBeDefined();
  });
});

describe('#1248 updateConfig drops writes to the retention keys and stores what the policy says', () => {
  it('a PUT setting them changes nothing and audits nothing for them, while another key in the same PUT applies', async () => {
    vi.spyOn(retentionPolicyService, 'getActivePolicy').mockResolvedValue(policy('destroy'));
    const db = makeDb();
    const current = await securityService.getConfig(db);
    const result = await securityService.updateConfig(db, {
      logging: { retentionDays: 10, level: 'error' },
      privacy: { autoPurge: false, purgeAfterDays: 5 },
      governedBy: { 'logging.retentionDays': null },
    }, current, { user: { userID: 'admin' } });

    const $set = db._c.updateOne.mock.calls[0][1].$set;
    expect($set.logging.retentionDays).toBe(400);
    expect($set.logging.level).toBe('error');
    expect($set.privacy.autoPurge).toBe(true);
    expect($set.privacy.purgeAfterDays).toBe(400);
    expect($set.governedBy).toBeUndefined();

    const auditedPaths = auditLogger.log.mock.calls.map(([entry]) => entry.payload && entry.payload.path).filter(Boolean);
    expect(auditedPaths).toContain('logging.level');
    for (const path of securityService.RETENTION_GOVERNED_PATHS) expect(auditedPaths).not.toContain(path);

    expect(result.governedBy['logging.retentionDays'].version).toBe('v7');
    expect(result.logging.retentionDays).toBe(400);
  });
});
