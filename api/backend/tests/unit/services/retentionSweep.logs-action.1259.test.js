import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { createCollectionMock, createDbMock } = require('../../factories/db.factory');
const auditLogger = require('../../../src/utils/auditLogger');
const logger = require('../../../src/utils/logger');
const retentionSweepService = require('../../../src/services/retentionSweep.service');

// #1259: sweepLogs deleted expired `logs` rows on every postRetentionAction,
// so an 'archive', 'review' or 'anonymize' policy destroyed rows it was meant
// to keep. These pin each action against a stateful `logs` collection that
// honours both delete shapes the sweep issues (by cutoff, and by _id).

const DAY = 24 * 60 * 60 * 1000;

function statefulLogs(seed) {
  const docs = [...seed];
  const older = (doc, cutoff) => new Date(doc.createdAt).getTime() < new Date(cutoff).getTime();
  return createCollectionMock({
    find: vi.fn((query) => ({ toArray: vi.fn().mockResolvedValue(docs.filter((d) => older(d, query.createdAt.$lt))) })),
    deleteMany: vi.fn(async (query) => {
      const before = docs.length;
      for (let i = docs.length - 1; i >= 0; i -= 1) {
        const hit = query._id ? query._id.$in.includes(docs[i]._id) : older(docs[i], query.createdAt.$lt);
        if (hit) docs.splice(i, 1);
      }
      return { deletedCount: before - docs.length };
    }),
    __docs: docs,
  });
}

function statefulArchive() {
  const docs = [];
  return createCollectionMock({
    insertMany: vi.fn(async (items) => { docs.push(...items); return { insertedCount: items.length }; }),
    __docs: docs,
  });
}

function policies(active) {
  return createCollectionMock({
    find: vi.fn(() => ({
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue(active ? [active] : []),
    })),
  });
}

function setup(postRetentionAction) {
  const now = Date.now();
  const oldLog = { _id: 'log-old', createdAt: new Date(now - 40 * DAY), message: 'old' };
  const recentLog = { _id: 'log-recent', createdAt: new Date(now - DAY), message: 'recent' };
  const logs = statefulLogs([oldLog, recentLog]);
  const archive = statefulArchive();
  const db = createDbMock({
    retentionPolicies: policies({
      _id: 'policy-1259', version: 'v1', active: true,
      applicableEntityTypes: ['Log'], postRetentionAction, retentionPeriod: 'P30D',
    }),
    logs,
    logs_archive: archive,
  });
  return { db, logs, archive, oldLog };
}

describe('#1259 sweepLogs follows postRetentionAction', () => {
  beforeEach(() => {
    vi.spyOn(logger, 'info').mockImplementation(() => {});
    vi.spyOn(logger, 'warn').mockImplementation(() => {});
    vi.spyOn(logger, 'error').mockImplementation(() => {});
    vi.spyOn(auditLogger, 'log').mockResolvedValue();
  });

  afterEach(() => { vi.restoreAllMocks(); });

  it('control: destroy deletes only the expired row', async () => {
    const { db, logs, archive } = setup('destroy');
    const result = await retentionSweepService.runSweep(db);
    expect(result.logs).toEqual({ deleted: 1 });
    expect(logs.__docs.map((d) => d._id)).toEqual(['log-recent']);
    expect(archive.insertMany).not.toHaveBeenCalled();
  });

  it('archive moves the expired row unchanged into logs_archive, then out of logs', async () => {
    const { db, logs, archive, oldLog } = setup('archive');
    const result = await retentionSweepService.runSweep(db);
    expect(result.logs).toEqual({ archived: 1, skipped: false });
    expect(logs.__docs.map((d) => d._id)).toEqual(['log-recent']);
    expect(archive.__docs).toHaveLength(1);
    expect(archive.__docs[0]).toEqual(expect.objectContaining({ ...oldLog, archivedAt: expect.any(Date) }));
  });

  for (const action of ['review', 'anonymize']) {
    it(`${action} removes nothing and says why`, async () => {
      const { db, logs, archive } = setup(action);
      const result = await retentionSweepService.runSweep(db);
      expect(result.logs).toEqual({ deleted: 0, skipped: true, reason: `unsupported_post_retention_action:${action}` });
      expect(logs.__docs).toHaveLength(2);
      expect(logs.deleteMany).not.toHaveBeenCalled();
      expect(archive.insertMany).not.toHaveBeenCalled();
    });
  }
});
