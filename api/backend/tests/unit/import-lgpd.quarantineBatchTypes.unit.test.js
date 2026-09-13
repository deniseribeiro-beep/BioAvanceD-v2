/**
 * #915: patient quarantine batches are written but unreadable.
 *
 * #814 extended `quarantineRejectedSampleRows` to `importPatients`/
 * `importPatientsSmart`, writing rejected participant rows with
 * `type: 'LGPD_PATIENT_CSV'` -- deliberately distinct from the samples path's
 * `'LGPD_SAMPLE_CSV'` so the two never collide in the shared
 * `import_batches` collection. Both readers then filtered on the *sample*
 * type alone, so a patient batch was persisted and immediately unreachable:
 * absent from `GET /api/import-lgpd/batches` and 404 from
 * `GET /api/import-lgpd/batches/:batchId` even given the correct id.
 *
 * The authorization question #915 raised is answered by the rule the route
 * file already states for the sample batches: **the same permission as the
 * import that produced the batch**. Sample batches come from a
 * `createSample` import, patient batches from a `createPatient` import, so
 * the readers take an explicit type set and the controller derives it from
 * what the caller actually holds. Nobody sees a batch they could not have
 * produced themselves; the default stays sample-only.
 *
 * The mocks below really match `$in` rather than swallowing the filter --
 * a stub that ignored it could not tell the widened reader from the old one
 * (#797/#803).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const service = require('../../src/services/import-lgpd.service');
const controller = require('../../src/controllers/import-lgpd.controller');
const rbacAssignmentService = require('../../src/services/rbac-assignment.service');

const { QUARANTINE_BATCH_TYPES } = service;

const SAMPLE_BATCH = {
  _id: '64b7f9c2e4b0a1d2c3e4f5a6',
  type: 'LGPD_SAMPLE_CSV',
  source: 'LGPD',
  status: 'QUARANTINED',
  createdAt: new Date('2026-08-01T10:00:00Z'),
};

const PATIENT_BATCH = {
  _id: '64b7f9c2e4b0a1d2c3e4f5c8',
  type: 'LGPD_PATIENT_CSV',
  source: 'LGPD',
  status: 'QUARANTINED',
  createdAt: new Date('2026-08-20T10:00:00Z'),
};

const FHIR_BATCH = {
  _id: '64b7f9c2e4b0a1d2c3e4f5b7',
  type: 'FHIR_BUNDLE',
  source: 'FHIR',
  status: 'STAGED',
  createdAt: new Date('2026-08-25T10:00:00Z'),
};

/** Matches `{ field: value }` and `{ field: { $in: [...] } }` -- nothing else. */
function matches(doc, filter) {
  return Object.entries(filter).every(([key, expected]) => {
    if (expected && typeof expected === 'object' && Array.isArray(expected.$in)) {
      return expected.$in.some((v) => String(doc[key]) === String(v));
    }
    return String(doc[key]) === String(expected);
  });
}

function makeDb(batches, records = []) {
  const calls = {};
  const batchesCollection = {
    findOne: vi.fn(async (filter = {}) => {
      calls.findOne = filter;
      return batches.find((b) => matches(b, filter)) || null;
    }),
    find: vi.fn((filter = {}) => {
      calls.find = filter;
      let matched = batches.filter((b) => matches(b, filter));
      const cursor = {
        sort: vi.fn((spec) => {
          const [key, direction] = Object.entries(spec)[0];
          matched = [...matched].sort((a, b) =>
            direction === -1 ? (a[key] < b[key] ? 1 : -1) : (a[key] > b[key] ? 1 : -1)
          );
          return cursor;
        }),
        skip: vi.fn((n) => { matched = matched.slice(n); return cursor; }),
        limit: vi.fn((n) => { matched = matched.slice(0, n); return cursor; }),
        toArray: vi.fn(async () => matched),
      };
      return cursor;
    }),
    countDocuments: vi.fn(async (filter = {}) => batches.filter((b) => matches(b, filter)).length),
  };
  const recordsCollection = {
    find: vi.fn(() => ({ sort: () => ({ toArray: async () => records }) })),
  };
  return {
    collection: vi.fn((name) => (name === 'import_batches' ? batchesCollection : recordsCollection)),
    _calls: calls,
  };
}

describe('#915 quarantine readers are type-scoped, not sample-only', () => {
  describe('listQuarantineBatches', () => {
    it('still lists sample batches only when no type set is given', async () => {
      const db = makeDb([SAMPLE_BATCH, PATIENT_BATCH, FHIR_BATCH]);

      const result = await service.listQuarantineBatches(db);

      expect(result.batches.map((b) => b._id)).toEqual([SAMPLE_BATCH._id]);
      expect(db._calls.find).toMatchObject({ type: { $in: [QUARANTINE_BATCH_TYPES.SAMPLE] } });
    });

    it('lists patient batches too when the caller may read them', async () => {
      const db = makeDb([SAMPLE_BATCH, PATIENT_BATCH, FHIR_BATCH]);

      const result = await service.listQuarantineBatches(db, {
        types: [QUARANTINE_BATCH_TYPES.SAMPLE, QUARANTINE_BATCH_TYPES.PATIENT],
      });

      // Newest first, and the FHIR batch is still excluded even though it is
      // the newest of the three.
      expect(result.batches.map((b) => b._id)).toEqual([PATIENT_BATCH._id, SAMPLE_BATCH._id]);
      expect(result.total).toBe(2);
    });

    it('lists patient batches only, for a caller that may read no sample batch', async () => {
      const db = makeDb([SAMPLE_BATCH, PATIENT_BATCH]);

      const result = await service.listQuarantineBatches(db, {
        types: [QUARANTINE_BATCH_TYPES.PATIENT],
      });

      expect(result.batches.map((b) => b._id)).toEqual([PATIENT_BATCH._id]);
    });

    it('never serves a FHIR batch, whatever type set is asked for', async () => {
      const db = makeDb([FHIR_BATCH]);

      const result = await service.listQuarantineBatches(db, {
        types: [QUARANTINE_BATCH_TYPES.SAMPLE, QUARANTINE_BATCH_TYPES.PATIENT],
      });

      expect(result.batches).toEqual([]);
      expect(result.total).toBe(0);
    });

    it('rejects an unknown type rather than widening the filter to it', async () => {
      const db = makeDb([FHIR_BATCH]);

      const result = await service.listQuarantineBatches(db, { types: ['FHIR_BUNDLE'] });

      // An unrecognised type is dropped, and an empty set falls back to the
      // sample default rather than becoming an unfiltered `$in: []`/no-filter.
      expect(db._calls.find).toMatchObject({ type: { $in: [QUARANTINE_BATCH_TYPES.SAMPLE] } });
      expect(result.batches).toEqual([]);
    });
  });

  describe('getQuarantineBatch', () => {
    it('404s a patient batch id when only sample batches are readable', async () => {
      const db = makeDb([PATIENT_BATCH]);

      await expect(service.getQuarantineBatch(db, PATIENT_BATCH._id)).rejects.toMatchObject({
        statusCode: 404,
      });
      expect(db._calls.findOne).toMatchObject({ type: { $in: [QUARANTINE_BATCH_TYPES.SAMPLE] } });
    });

    it('returns the patient batch and its staged rows when it is readable', async () => {
      const rows = [{ rowNumber: 2, status: 'ERROR', normalized: null }];
      const db = makeDb([PATIENT_BATCH], rows);

      const result = await service.getQuarantineBatch(db, PATIENT_BATCH._id, {
        types: [QUARANTINE_BATCH_TYPES.SAMPLE, QUARANTINE_BATCH_TYPES.PATIENT],
      });

      // `type` is on the batch document itself, so a caller holding both
      // permissions can tell a participant batch from a specimen one.
      expect(result.batch).toMatchObject({ type: QUARANTINE_BATCH_TYPES.PATIENT });
      // A smart-import staged row carries `normalized: null` -- it must survive
      // the read rather than being dropped.
      expect(result.records).toEqual(rows);
    });

    it('still 404s a FHIR batch id for a caller holding both LGPD permissions', async () => {
      const db = makeDb([FHIR_BATCH]);

      await expect(
        service.getQuarantineBatch(db, FHIR_BATCH._id, {
          types: [QUARANTINE_BATCH_TYPES.SAMPLE, QUARANTINE_BATCH_TYPES.PATIENT],
        })
      ).rejects.toMatchObject({ statusCode: 404 });
    });
  });

  describe('controller derives the readable type set from the caller permissions', () => {
    function createRes() {
      return { status: vi.fn().mockReturnThis(), json: vi.fn() };
    }

    beforeEach(() => {
      vi.restoreAllMocks();
    });

    it('asks for patient batches too when the caller holds createPatient', async () => {
      const db = makeDb([]);
      vi.spyOn(rbacAssignmentService, 'userHasPermission').mockResolvedValue(true);
      const listSpy = vi
        .spyOn(service, 'listQuarantineBatches')
        .mockResolvedValue({ batches: [], total: 0, page: 1, limit: 20, totalPages: 1 });

      const req = { app: { locals: { db } }, query: {}, user: { userID: 'u-1' } };
      await controller.listQuarantineBatches(req, createRes());

      expect(listSpy).toHaveBeenCalledWith(
        db,
        expect.objectContaining({
          types: [QUARANTINE_BATCH_TYPES.SAMPLE, QUARANTINE_BATCH_TYPES.PATIENT],
        })
      );
    });

    it('asks for sample batches only when the caller lacks createPatient', async () => {
      const db = makeDb([]);
      vi.spyOn(rbacAssignmentService, 'userHasPermission').mockResolvedValue(false);
      const getSpy = vi
        .spyOn(service, 'getQuarantineBatch')
        .mockResolvedValue({ batch: SAMPLE_BATCH, records: [] });

      const req = {
        app: { locals: { db } },
        params: { batchId: SAMPLE_BATCH._id },
        user: { userID: 'u-2' },
      };
      await controller.getQuarantineBatch(req, createRes());

      expect(getSpy).toHaveBeenCalledWith(db, SAMPLE_BATCH._id, {
        types: [QUARANTINE_BATCH_TYPES.SAMPLE],
      });
    });

    it('falls back to sample-only when the permission lookup itself fails', async () => {
      const db = makeDb([]);
      vi.spyOn(rbacAssignmentService, 'userHasPermission').mockRejectedValue(new Error('rbac down'));
      const listSpy = vi
        .spyOn(service, 'listQuarantineBatches')
        .mockResolvedValue({ batches: [], total: 0, page: 1, limit: 20, totalPages: 1 });

      const req = { app: { locals: { db } }, query: {}, user: { userID: 'u-3' } };
      const res = createRes();
      await controller.listQuarantineBatches(req, res);

      // Fails closed to the narrower set rather than 500ing or widening.
      expect(listSpy).toHaveBeenCalledWith(
        db,
        expect.objectContaining({ types: [QUARANTINE_BATCH_TYPES.SAMPLE] })
      );
      expect(res.status).toHaveBeenCalledWith(200);
    });
  });
});
