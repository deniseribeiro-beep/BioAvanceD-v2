import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { createCollectionMock, createDbMock } = require('../../factories/db.factory');
const retentionPolicyService = require('../../../src/services/retentionPolicy.service');
const auditLogger = require('../../../src/utils/auditLogger');
const logger = require('../../../src/utils/logger');
const retentionSweepService = require('../../../src/services/retentionSweep.service');

// Stateful mocks with real query-matching semantics (not canned responses) --
// this is what actually proves the sweep filters by cutoff instead of
// sweeping everything, and that archived audit_events land untouched in the
// archive collection rather than being mutated/dropped.
function matchesLt(doc, field, cutoff) {
  return new Date(doc[field]).getTime() < new Date(cutoff).getTime();
}

function statefulLogsMock(seed = []) {
  const docs = [...seed];
  return createCollectionMock({
    deleteMany: vi.fn(async (query) => {
      const cutoff = query.createdAt.$lt;
      const before = docs.length;
      for (let i = docs.length - 1; i >= 0; i -= 1) {
        if (matchesLt(docs[i], 'createdAt', cutoff)) docs.splice(i, 1);
      }
      return { deletedCount: before - docs.length };
    }),
  });
}

function statefulAuditEventsMock(seed = []) {
  const docs = [...seed];
  return createCollectionMock({
    find: vi.fn().mockImplementation((query = {}) => {
      const cutoff = query.recordedAt?.$lt;
      const filtered = cutoff ? docs.filter((d) => matchesLt(d, 'recordedAt', cutoff)) : docs.slice();
      return { toArray: vi.fn().mockResolvedValue(filtered) };
    }),
    deleteMany: vi.fn(async (query) => {
      const ids = query._id.$in.map(String);
      const before = docs.length;
      for (let i = docs.length - 1; i >= 0; i -= 1) {
        if (ids.includes(String(docs[i]._id))) docs.splice(i, 1);
      }
      return { deletedCount: before - docs.length };
    }),
    __docs: docs,
  });
}

function statefulArchiveMock() {
  const docs = [];
  return createCollectionMock({
    insertMany: vi.fn(async (items) => {
      docs.push(...items);
      return { insertedCount: items.length };
    }),
    __docs: docs,
  });
}

function statefulPoliciesMock(activePolicy) {
  return createCollectionMock({
    find: vi.fn().mockImplementation(() => ({
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue(activePolicy ? [activePolicy] : []),
    })),
  });
}

describe('retentionSweep.service', () => {
  beforeEach(() => {
    vi.spyOn(logger, 'info').mockImplementation(() => {});
    vi.spyOn(logger, 'warn').mockImplementation(() => {});
    vi.spyOn(logger, 'error').mockImplementation(() => {});
    vi.spyOn(auditLogger, 'log').mockResolvedValue();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('skips the sweep when there is no active retention policy', async () => {
    const db = createDbMock({ retentionPolicies: statefulPoliciesMock(null) });

    const result = await retentionSweepService.runSweep(db);

    expect(result).toEqual({ ranAt: expect.any(String), skipped: true, reason: 'no_active_policy' });
    expect(auditLogger.log).not.toHaveBeenCalled();
  });

  it('deletes only Log documents older than the policy cutoff', async () => {
    const now = Date.now();
    const oldLog = { _id: 'log-old', createdAt: new Date(now - 40 * 24 * 60 * 60 * 1000) };
    const recentLog = { _id: 'log-recent', createdAt: new Date(now - 1 * 24 * 60 * 60 * 1000) };

    const activePolicy = {
      _id: 'policy-1',
      version: 'v1',
      active: true,
      applicableEntityTypes: ['Log'],
      postRetentionAction: 'destroy',
      retentionPeriod: 'P30D',
    };

    const logsCollection = statefulLogsMock([oldLog, recentLog]);
    const db = createDbMock({
      retentionPolicies: statefulPoliciesMock(activePolicy),
      logs: logsCollection,
    });

    const result = await retentionSweepService.runSweep(db);

    expect(result.logs).toEqual({ deleted: 1 });
    expect(logsCollection.deleteMany).toHaveBeenCalledWith({ createdAt: { $lt: expect.any(Date) } });
    expect(auditLogger.log).toHaveBeenCalledWith(expect.objectContaining({
      action: 'RETENTION_SWEEP',
      severity: 'critical',
      // #1105: runSweep is cron-driven (scheduler.service.js:202), so it
      // declares 'scheduler' rather than inheriting Log.js:124's 'api'.
      source: 'scheduler',
    }));
  });

  it('archives expired AuditEvent documents instead of deleting them, when postRetentionAction is archive', async () => {
    const now = Date.now();
    const oldEvent = { _id: 'evt-old', eventHash: 'hash-old', recordedAt: new Date(now - 400 * 24 * 60 * 60 * 1000).toISOString() };
    const recentEvent = { _id: 'evt-recent', eventHash: 'hash-recent', recordedAt: new Date(now - 1 * 24 * 60 * 60 * 1000).toISOString() };

    const activePolicy = {
      _id: 'policy-2',
      version: 'v2',
      active: true,
      applicableEntityTypes: ['AuditEvent'],
      postRetentionAction: 'archive',
      retentionPeriod: 'P365D',
    };

    const eventsCollection = statefulAuditEventsMock([oldEvent, recentEvent]);
    const archiveCollection = statefulArchiveMock();
    const db = createDbMock({
      retentionPolicies: statefulPoliciesMock(activePolicy),
      audit_events: eventsCollection,
      audit_events_archive: archiveCollection,
    });

    const result = await retentionSweepService.runSweep(db);

    expect(result.auditEvents).toEqual({ archived: 1, skipped: false });
    expect(archiveCollection.__docs).toHaveLength(1);
    expect(archiveCollection.__docs[0]).toMatchObject({ _id: 'evt-old', eventHash: 'hash-old' });
    expect(eventsCollection.__docs.map((d) => d._id)).toEqual(['evt-recent']);
  });

  it('refuses to touch AuditEvent documents when postRetentionAction is not archive', async () => {
    const activePolicy = {
      _id: 'policy-3',
      version: 'v3',
      active: true,
      applicableEntityTypes: ['AuditEvent'],
      postRetentionAction: 'destroy',
      retentionPeriod: 'P30D',
    };

    const eventsCollection = statefulAuditEventsMock([
      { _id: 'evt-old', recordedAt: new Date(Date.now() - 400 * 24 * 60 * 60 * 1000).toISOString() },
    ]);
    const archiveCollection = statefulArchiveMock();
    const db = createDbMock({
      retentionPolicies: statefulPoliciesMock(activePolicy),
      audit_events: eventsCollection,
      audit_events_archive: archiveCollection,
    });

    const result = await retentionSweepService.runSweep(db);

    expect(result.auditEvents).toEqual({
      archived: 0,
      skipped: true,
      reason: 'unsupported_post_retention_action:destroy',
    });
    expect(eventsCollection.deleteMany).not.toHaveBeenCalled();
    expect(archiveCollection.insertMany).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('não é suportado para AuditEvent'));
  });
});
