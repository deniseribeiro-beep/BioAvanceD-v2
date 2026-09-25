/**
 * #794 item 2 (RNF011 AC#4): listing quarantine batches.
 *
 * Slice 1 built `GET /api/import-lgpd/batches/:batchId`, which makes a batch
 * readable *if you already know its id*. Nothing hands an operator that id:
 * `stagingBatchId` is returned by the import API, but #808 established the
 * LGPD import has no frontend caller at all, so it has never reached a UI.
 * Without a list there is no navigable entry point, and a review page would be
 * unreachable code.
 *
 * Two properties matter beyond "it returns rows":
 *
 * 1. The **type filter**, for the same reason as `getQuarantineBatch` --
 *    `import_batches` is shared with the FHIR importer and the two paths are
 *    gated on different permissions (#799 was exactly this defect in the other
 *    direction). The mock below really matches on the filter, so it can see
 *    the difference (#797/#803).
 * 2. The list must **not** carry staged row data. The rows hold `row`, the
 *    pre-anonymisation spreadsheet line -- civil identifiers (#807). A summary
 *    listing has no need of them, and widening exposure from one batch to
 *    every batch is the wrong direction.
 */
import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const service = require('../../src/services/import-lgpd.service');

const LGPD_OLDER = {
  _id: 'batch-older',
  type: 'LGPD_SAMPLE_CSV',
  source: 'LGPD',
  status: 'QUARANTINED',
  fileName: 'lote-antigo.csv',
  counts: { total: 100, success: 98, errors: 2 },
  createdAt: new Date('2026-08-01T10:00:00Z'),
  createdBy: 'operator-1',
};

const LGPD_NEWER = {
  _id: 'batch-newer',
  type: 'LGPD_SAMPLE_CSV',
  source: 'LGPD',
  status: 'QUARANTINED',
  fileName: 'lote-novo.csv',
  counts: { total: 500, success: 460, errors: 40 },
  createdAt: new Date('2026-08-20T10:00:00Z'),
  createdBy: 'operator-2',
  sourceFile: { storedPath: '/x/quarantine/batch-newer.csv', originalName: 'lote-novo.csv' },
};

const FHIR_BATCH = {
  _id: 'batch-fhir',
  type: 'FHIR_BUNDLE',
  source: 'FHIR',
  status: 'STAGED',
  createdAt: new Date('2026-08-25T10:00:00Z'),
};

/**
 * Honours the filter, sort, skip and limit it is handed -- a stub that ignored
 * them could not see either property under test. Since #915 the type filter is
 * an `$in` over the readable type set, so the matcher understands `$in` too.
 */
function batchMatches(doc, filter) {
  return Object.entries(filter).every(([key, expected]) => {
    if (expected && typeof expected === 'object' && Array.isArray(expected.$in)) {
      return expected.$in.some((v) => String(doc[key]) === String(v));
    }
    return String(doc[key]) === String(expected);
  });
}

function makeDb(batches) {
  const calls = {};
  const batchesCollection = {
    find: vi.fn((filter = {}) => {
      calls.filter = filter;
      let matched = batches.filter((b) => batchMatches(b, filter));
      const cursor = {
        sort: vi.fn((spec) => {
          calls.sort = spec;
          const [key, direction] = Object.entries(spec)[0];
          matched = [...matched].sort((a, b) =>
            direction === -1 ? (a[key] < b[key] ? 1 : -1) : (a[key] > b[key] ? 1 : -1)
          );
          return cursor;
        }),
        skip: vi.fn((n) => { calls.skip = n; matched = matched.slice(n); return cursor; }),
        limit: vi.fn((n) => { calls.limit = n; matched = matched.slice(0, n); return cursor; }),
        toArray: vi.fn(async () => matched),
      };
      return cursor;
    }),
    countDocuments: vi.fn(async (filter = {}) => batches.filter((b) => batchMatches(b, filter)).length),
  };
  return {
    collection: vi.fn((name) => {
      if (name === 'import_batches') return batchesCollection;
      throw new Error(`listQuarantineBatches must not touch the ${name} collection`);
    }),
    _calls: calls,
  };
}

describe('ImportLGPDService.listQuarantineBatches (#794 item 2)', () => {
  it('returns only LGPD quarantine batches, newest first', async () => {
    const db = makeDb([LGPD_OLDER, FHIR_BATCH, LGPD_NEWER]);

    const result = await service.listQuarantineBatches(db);

    expect(result.batches.map((b) => b._id)).toEqual(['batch-newer', 'batch-older']);
    expect(db._calls.filter).toMatchObject({ type: { $in: ['LGPD_SAMPLE_CSV'] } });
    expect(db._calls.sort).toMatchObject({ createdAt: -1 });
  });

  it('never serves a FHIR batch through the LGPD listing', async () => {
    const db = makeDb([FHIR_BATCH]);

    const result = await service.listQuarantineBatches(db);

    expect(result.batches).toEqual([]);
    expect(result.total).toBe(0);
  });

  // The listing is a summary. It must not become a bulk export of the civil
  // identifiers the staged rows hold (#807).
  it('does not read the staging records collection at all', async () => {
    const db = makeDb([LGPD_NEWER]);

    await service.listQuarantineBatches(db);

    expect(db.collection).not.toHaveBeenCalledWith('import_staging_records');
  });

  it('reports the total independently of the page, for pagination', async () => {
    const db = makeDb([LGPD_OLDER, LGPD_NEWER]);

    const result = await service.listQuarantineBatches(db, { limit: 1, page: 1 });

    expect(result.batches).toHaveLength(1);
    expect(result.batches[0]._id).toBe('batch-newer');
    expect(result.total).toBe(2);
    expect(db._calls.limit).toBe(1);
    expect(db._calls.skip).toBe(0);
  });

  it('skips by page', async () => {
    const db = makeDb([LGPD_OLDER, LGPD_NEWER]);

    const result = await service.listQuarantineBatches(db, { limit: 1, page: 2 });

    expect(db._calls.skip).toBe(1);
    expect(result.batches[0]._id).toBe('batch-older');
  });

  it('clamps a nonsense limit rather than trusting the caller', async () => {
    const db = makeDb([LGPD_NEWER]);

    await service.listQuarantineBatches(db, { limit: 100000, page: 0 });

    expect(db._calls.limit).toBeLessThanOrEqual(100);
    expect(db._calls.skip).toBe(0);
  });

  // #800: org-scoped listing filters on organizationId; unstamped legacy
  // batches are excluded (Administrador/global only).
  it('filters by organizationId for an organization scope (#800)', async () => {
    const scoped = { ...LGPD_NEWER, organizationId: 'org-1' };
    const otherOrg = { ...LGPD_OLDER, organizationId: 'org-2' };
    const legacy = { ...LGPD_OLDER, _id: 'batch-legacy', organizationId: null };
    const db = makeDb([scoped, otherOrg, legacy]);

    const result = await service.listQuarantineBatches(db, {
      organizationScope: { scope: 'organization', organizationIds: ['org-1'] },
    });

    expect(result.batches.map((b) => b._id)).toEqual(['batch-newer']);
    expect(db._calls.filter).toMatchObject({
      organizationId: { $in: ['org-1'] },
    });
  });

  it('does not filter organizationId for a global scope (#800)', async () => {
    const db = makeDb([LGPD_NEWER, LGPD_OLDER]);

    await service.listQuarantineBatches(db, {
      organizationScope: { scope: 'global', organizationIds: [] },
    });

    expect(db._calls.filter.organizationId).toBeUndefined();
  });
});
