import { describe, it, expect, vi, beforeEach } from 'vitest';

const backupPolicyService = require('../../../src/services/backup-policy.service');
const logger = require('../../../src/utils/logger');
const auditLogger = require('../../../src/utils/auditLogger');

describe('BackupPolicyService.getDefaultPolicy', () => {
  it('returns RNF010-aligned defaults', () => {
    const policy = backupPolicyService.getDefaultPolicy();
    expect(policy.retentionDays).toBeGreaterThanOrEqual(30);
    expect(policy.rpoHours).toBe(24);
    expect(policy.rtoHours).toBe(12);
    expect(policy.encryptionEnabled).toBe(true);
    expect(typeof policy.cronExpression).toBe('string');
  });
});

describe('BackupPolicyService.getPolicy', () => {
  it('seeds and returns default policy when none exists', async () => {
    const insertOne = vi.fn().mockResolvedValue({ insertedId: 'main' });
    const findOne = vi.fn().mockResolvedValue(null);
    const db = { collection: vi.fn(() => ({ findOne, insertOne })) };

    const policy = await backupPolicyService.getPolicy(db);

    expect(insertOne).toHaveBeenCalledTimes(1);
    expect(policy.retentionDays).toBeGreaterThanOrEqual(30);
  });

  it('returns existing policy without _id/createdAt', async () => {
    const findOne = vi.fn().mockResolvedValue({
      _id: 'main',
      createdAt: new Date('2026-01-01'),
      cronExpression: '0 4 * * *',
      retentionDays: 45,
      encryptionEnabled: true,
      rpoHours: 12,
      rtoHours: 6,
    });
    const db = { collection: vi.fn(() => ({ findOne })) };

    const policy = await backupPolicyService.getPolicy(db);

    expect(policy).not.toHaveProperty('_id');
    expect(policy).not.toHaveProperty('createdAt');
    expect(policy.retentionDays).toBe(45);
  });

  it('logs and rethrows when the collection throws', async () => {
    const errSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});
    const db = { collection: vi.fn(() => { throw new Error('boom'); }) };

    await expect(backupPolicyService.getPolicy(db)).rejects.toThrow('boom');
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});

describe('BackupPolicyService.validatePolicy', () => {
  it('rejects retentionDays below the RNF010 AC#4 floor (30 days)', () => {
    expect(() => backupPolicyService.validatePolicy({ retentionDays: 10 })).toThrow(/retentionDays/);
  });

  it('accepts retentionDays at the floor', () => {
    expect(() => backupPolicyService.validatePolicy({ retentionDays: 30 })).not.toThrow();
  });

  it('rejects rpoHours above the RNF010 AC#2 ceiling (24h)', () => {
    expect(() => backupPolicyService.validatePolicy({ rpoHours: 48 })).toThrow(/rpoHours/);
  });

  it('rejects rtoHours above the RNF010 AC#3 ceiling (12h)', () => {
    expect(() => backupPolicyService.validatePolicy({ rtoHours: 24 })).toThrow(/rtoHours/);
  });

  it('rejects a malformed cron expression', () => {
    expect(() => backupPolicyService.validatePolicy({ cronExpression: 'not-a-cron' })).toThrow(/cronExpression/);
  });

  // #1325: the five-field pattern accepts it, but the scheduler could not apply it.
  it('rejects a five-field cron expression node-cron refuses', () => {
    expect(() => backupPolicyService.validatePolicy({ cronExpression: '99 99 * * *' })).toThrow(/cronExpression/);
    expect(() => backupPolicyService.validatePolicy({ cronExpression: '0 3 * * *' })).not.toThrow();
  });

  // #1325: updatePolicy stores the raw value, so a non-string must not pass.
  it('rejects a cron expression that is not a string', () => {
    expect(() => backupPolicyService.validatePolicy({ cronExpression: ['0 1 * * *'] })).toThrow(/cronExpression/);
  });

  it('rejects a non-boolean encryptionEnabled', () => {
    expect(() => backupPolicyService.validatePolicy({ encryptionEnabled: 'yes' })).toThrow(/encryptionEnabled/);
  });

  it('accepts a partial, empty payload (no fields to validate)', () => {
    expect(() => backupPolicyService.validatePolicy({})).not.toThrow();
  });
});

describe('BackupPolicyService.detectChanges', () => {
  it('returns empty array when nothing changed', () => {
    const current = { cronExpression: '0 3 * * *', retentionDays: 30 };
    expect(backupPolicyService.detectChanges(current, {})).toEqual([]);
  });

  it('detects a changed field', () => {
    const current = { cronExpression: '0 3 * * *', retentionDays: 30 };
    const changes = backupPolicyService.detectChanges(current, { retentionDays: 60 });
    expect(changes).toEqual([{ field: 'retentionDays', oldValue: 30, newValue: 60 }]);
  });

  it('ignores fields not present in the incoming payload', () => {
    const current = { cronExpression: '0 3 * * *', retentionDays: 30 };
    const changes = backupPolicyService.detectChanges(current, { cronExpression: undefined });
    expect(changes).toEqual([]);
  });
});

describe('BackupPolicyService.updatePolicy', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('merges the update, persists it, and logs one audit entry per changed field', async () => {
    vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
    const logSpy = vi.spyOn(auditLogger, 'log').mockResolvedValue({});
    const updateOne = vi.fn().mockResolvedValue({});
    const db = { collection: vi.fn(() => ({ updateOne })) };

    const current = backupPolicyService.getDefaultPolicy();
    const { merged, changed } = await backupPolicyService.updatePolicy(
      db,
      { retentionDays: 60, rpoHours: 12 },
      current,
      { user: { userID: 'admin-1' } }
    );

    expect(updateOne).toHaveBeenCalledTimes(1);
    expect(merged.retentionDays).toBe(60);
    expect(merged.rpoHours).toBe(12);
    expect(merged.updatedBy).toBe('admin-1');
    expect(changed.sort()).toEqual(['retentionDays', 'rpoHours']);
    expect(logSpy).toHaveBeenCalledTimes(2);
    expect(logSpy).toHaveBeenCalledWith(expect.objectContaining({
      resourceType: 'BackupPolicy',
      action: 'UPDATE',
      payload: { field: 'retentionDays', oldValue: 30, newValue: 60 },
    }));
  });

  it('does not call auditLogger when nothing actually changed', async () => {
    const initSpy = vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
    const logSpy = vi.spyOn(auditLogger, 'log').mockResolvedValue({});
    const updateOne = vi.fn().mockResolvedValue({});
    const db = { collection: vi.fn(() => ({ updateOne })) };

    const current = backupPolicyService.getDefaultPolicy();
    const { changed } = await backupPolicyService.updatePolicy(db, { retentionDays: current.retentionDays }, current, { user: {} });

    expect(changed).toEqual([]);
    expect(initSpy).not.toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalled();
  });

  it('rejects an invalid update before touching the database', async () => {
    const updateOne = vi.fn();
    const db = { collection: vi.fn(() => ({ updateOne })) };
    const current = backupPolicyService.getDefaultPolicy();

    await expect(backupPolicyService.updatePolicy(db, { retentionDays: 5 }, current, { user: {} })).rejects.toThrow(/retentionDays/);
    expect(updateOne).not.toHaveBeenCalled();
  });
});
