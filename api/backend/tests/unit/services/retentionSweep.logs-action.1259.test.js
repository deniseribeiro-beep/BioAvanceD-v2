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

function statefulArchive(seed = []) {
  const docs = [...seed];
  return createCollectionMock({
    insertMany: vi.fn(async (items) => { docs.push(...items); return { insertedCount: items.length }; }),
    deleteMany: vi.fn(async (query) => {
      const before = docs.length;
      const cutoff = new Date(query.createdAt.$lt).getTime();
      for (let i = docs.length - 1; i >= 0; i -= 1) {
        if (new Date(docs[i].createdAt).getTime() < cutoff) docs.splice(i, 1);
      }
      return { deletedCount: before - docs.length };
    }),
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

// #1271: an archive policy cites the obligation keeping the archive and its
// period; this one keeps rows 365 days from their createdAt.
const ARCHIVE_BASIS = { archiveRetentionPeriod: 'P365D', archiveRetentionBasis: 'Obrigação regulatória citada no teste' };

function setup(postRetentionAction, extra = {}, archived = []) {
  const now = Date.now();
  const oldLog = { _id: 'log-old', createdAt: new Date(now - 40 * DAY), message: 'old' };
  const recentLog = { _id: 'log-recent', createdAt: new Date(now - DAY), message: 'recent' };
  const logs = statefulLogs([oldLog, recentLog]);
  const archive = statefulArchive(archived);
  const db = createDbMock({
    retentionPolicies: policies({
      _id: 'policy-1259', version: 'v1', active: true,
      applicableEntityTypes: ['Log'], postRetentionAction, retentionPeriod: 'P30D', ...extra,
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
    const { db, logs, archive, oldLog } = setup('archive', ARCHIVE_BASIS);
    const result = await retentionSweepService.runSweep(db);
    expect(result.logs).toEqual({ archived: 1, archivePurged: 0, skipped: false });
    expect(logs.__docs.map((d) => d._id)).toEqual(['log-recent']);
    expect(archive.__docs).toHaveLength(1);
    expect(archive.__docs[0]).toEqual(expect.objectContaining({ ...oldLog, archivedAt: expect.any(Date) }));
  });

  // #1271: LGPD art. 16 ends the treatment; I keeps it only for the cited
  // obligation's period, counted from the row's createdAt.
  it('#1271: archive deletes archived rows past archiveRetentionPeriod and keeps the rest', async () => {
    const now = Date.now();
    const pastObligation = { _id: 'arch-400', createdAt: new Date(now - 400 * DAY), archivedAt: new Date(now - 370 * DAY) };
    const withinObligation = { _id: 'arch-100', createdAt: new Date(now - 100 * DAY), archivedAt: new Date(now - 70 * DAY) };
    const { db, archive } = setup('archive', ARCHIVE_BASIS, [pastObligation, withinObligation]);
    const result = await retentionSweepService.runSweep(db);
    expect(result.logs).toEqual({ archived: 1, archivePurged: 1, skipped: false });
    expect(archive.__docs.map((d) => d._id)).toEqual(['arch-100', 'log-old']);
  });

  it('#1271: archive with no cited obligation deletes at the policy period instead, and purges what an earlier policy archived', async () => {
    const now = Date.now();
    const earlier = { _id: 'arch-100', createdAt: new Date(now - 100 * DAY), archivedAt: new Date(now - 70 * DAY) };
    const { db, logs, archive } = setup('archive', {}, [earlier]);
    const result = await retentionSweepService.runSweep(db);
    expect(result.logs).toEqual({ archived: 0, deleted: 1, archivePurged: 1, skipped: false, reason: 'no_archive_basis' });
    expect(logs.__docs.map((d) => d._id)).toEqual(['log-recent']);
    expect(archive.insertMany).not.toHaveBeenCalled();
    expect(archive.__docs).toHaveLength(0);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('LGPD art. 16, I'));
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
