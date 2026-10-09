/**
 * #800 on this branch: LGPD quarantine batches are scoped by organization.
 *
 * #800 was closed by a fix on another branch, which this branch never had,
 * so any createSample holder could read any organization's quarantined rows,
 * civil identifiers included. And with #1352's resubmit, they could also
 * write them back as samples. A batch is now stamped with its importer's
 * organizations (`organizationIds`). An organization-scoped caller reaches
 * only batches stamped with one of its organizations. An unstamped batch
 * (legacy, or opened by global scope) is reachable only by global scope.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { ObjectId } = require('mongodb');
const service = require('../../src/services/import-lgpd.service');
const controller = require('../../src/controllers/import-lgpd.controller');
const rbacAssignment = require('../../src/services/rbac-assignment.service');

const ORG_A = { scope: 'organization', organizationIds: ['org-a'] };
const GLOBAL = { scope: 'global', organizationIds: [] };

function dbWithBatch(batch) {
  const listed = { filter: null };
  const batches = {
    findOne: vi.fn(async () => batch),
    find: vi.fn((filter) => {
      listed.filter = filter;
      return { sort: () => ({ skip: () => ({ limit: () => ({ toArray: async () => [] }) }) }) };
    }),
    countDocuments: vi.fn(async () => 0),
    insertOne: vi.fn(async (doc) => ({ insertedId: doc._id || new ObjectId() })),
  };
  const records = {
    find: vi.fn(() => ({ sort: () => ({ toArray: async () => [] }) })),
    insertMany: vi.fn(async () => ({})),
    findOne: vi.fn(async () => null),
  };
  return {
    listed,
    batches,
    db: { collection: (name) => (name === 'import_batches' ? batches : records) },
  };
}

describe('LGPD quarantine organization scope (#800 on this branch)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getQuarantineBatch', () => {
    const id = String(new ObjectId());

    it('serves a batch stamped with one of the caller organizations', async () => {
      const { db } = dbWithBatch({ _id: id, type: 'LGPD_SAMPLE_CSV', organizationIds: ['org-a', 'org-b'] });
      await expect(service.getQuarantineBatch(db, id, { organizationScope: ORG_A })).resolves.toMatchObject({ records: [] });
    });

    it("403s another organization's batch, and an unstamped one, for an organization-scoped caller", async () => {
      for (const organizationIds of [['org-b'], [], undefined]) {
        const { db } = dbWithBatch({ _id: id, type: 'LGPD_SAMPLE_CSV', organizationIds });
        const error = await service.getQuarantineBatch(db, id, { organizationScope: ORG_A }).catch((e) => e);
        expect(error.statusCode, JSON.stringify(organizationIds)).toBe(403);
      }
    });

    it('serves an unstamped batch to global scope', async () => {
      const { db } = dbWithBatch({ _id: id, type: 'LGPD_SAMPLE_CSV' });
      await expect(service.getQuarantineBatch(db, id, { organizationScope: GLOBAL })).resolves.toBeTruthy();
    });
  });

  describe('listQuarantineBatches', () => {
    it("filters an organization-scoped caller to its organizations' batches", async () => {
      const { db, listed } = dbWithBatch(null);
      await service.listQuarantineBatches(db, { organizationScope: ORG_A });
      expect(listed.filter.organizationIds).toEqual({ $in: ['org-a'] });
    });

    it('leaves global scope unfiltered', async () => {
      const { db, listed } = dbWithBatch(null);
      await service.listQuarantineBatches(db, { organizationScope: GLOBAL });
      expect(listed.filter).not.toHaveProperty('organizationIds');
    });
  });

  describe('the batch writers stamp the importer organizations', () => {
    it('quarantineRejectedSampleRows', async () => {
      const { db, batches } = dbWithBatch(null);
      await service.quarantineRejectedSampleRows(db, {
        rows: [{ a: 1 }],
        results: { total: 1, success: 0, errors: [{ index: 0, row: 2, errors: ['x'] }] },
        actor: { userID: 'u1', organizationIds: ['org-a'] },
      });
      expect(batches.insertOne.mock.calls[0][0].organizationIds).toEqual(['org-a']);
    });

    it('recordFailedImportBatch, and none when the actor carries none', async () => {
      const { db, batches } = dbWithBatch(null);
      await service.recordFailedImportBatch(db, { error: new Error('bad header'), actor: { userID: 'u1', organizationIds: ['org-a'] } });
      await service.recordFailedImportBatch(db, { error: new Error('bad header'), actor: { userID: 'u1' } });
      expect(batches.insertOne.mock.calls.map((call) => call[0].organizationIds)).toEqual([['org-a'], []]);
    });
  });

  it("resubmit 403s another organization's batch before running the row", async () => {
    const batchId = new ObjectId();
    const { db } = dbWithBatch({ _id: batchId, type: 'LGPD_SAMPLE_CSV', organizationIds: ['org-b'] });
    const processSpy = vi.spyOn(service, 'processSampleRow');

    const error = await service
      .resubmitQuarantinedSampleRow(
        db,
        String(batchId),
        String(new ObjectId()),
        { sampleType: 'PLASMA', sampleOrigin: 'VENOUS_BLOOD', participantId: '12345678' },
        { organizationScope: ORG_A }
      )
      .catch((e) => e);

    expect(error.statusCode).toBe(403);
    expect(processSpy).not.toHaveBeenCalled();
  });

  describe('controller.resolveImportOrganizationIds', () => {
    const req = { user: { userID: 'u1' } };

    it('stamps the organizations of an organization-scoped importer', async () => {
      vi.spyOn(rbacAssignment, 'resolveUserOrganizationScope').mockResolvedValue({ scope: 'organization', organizationIds: ['org-a', 'org-b'] });
      await expect(controller.resolveImportOrganizationIds({}, req)).resolves.toEqual(['org-a', 'org-b']);
    });

    it('stamps none for global scope, and none when the lookup throws', async () => {
      const spy = vi.spyOn(rbacAssignment, 'resolveUserOrganizationScope').mockResolvedValue(GLOBAL);
      await expect(controller.resolveImportOrganizationIds({}, req)).resolves.toEqual([]);
      spy.mockRejectedValue(new Error('mongo down'));
      await expect(controller.resolveImportOrganizationIds({}, req)).resolves.toEqual([]);
    });
  });
});
