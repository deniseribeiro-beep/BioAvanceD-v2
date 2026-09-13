/**
 * #794 item 3 prerequisite: a quarantined batch must record the import
 * options it was produced under.
 *
 * Correct-and-resubmit means re-running one rejected row through the same
 * path the import used. `importSamples` places each row with
 * `getNextAvailableStorageSlot(db, startBoxId, results.success)` — the
 * running success count *within that batch* is the slot index — and takes
 * `startBoxId`, `autoIncrement` and `groupFields` from the caller's
 * `options`. None of that was persisted anywhere: the batch document carried
 * only type/source/status/fileName/counts/createdBy/timestamps.
 *
 * So a resubmit had no way to reproduce the placement intent of the import
 * that rejected the row — the information was gone the moment the request
 * ended. This is the smallest piece that has to exist before any resubmit
 * can be correct rather than merely plausible.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const importLGPDService = require('../../src/services/import-lgpd.service');

/** Captures what quarantineRejectedSampleRows writes, without a real Mongo. */
function createDb() {
  const inserted = { batches: [], records: [] };
  return {
    inserted,
    collection(name) {
      if (name === 'import_batches') {
        return {
          insertOne: vi.fn(async (doc) => {
            inserted.batches.push(doc);
            return { insertedId: 'batch-1' };
          }),
        };
      }
      if (name === 'import_staging_records') {
        return {
          insertMany: vi.fn(async (docs) => {
            inserted.records.push(...docs);
            return { insertedCount: docs.length };
          }),
        };
      }
      throw new Error(`unexpected collection: ${name}`);
    },
  };
}

// #1023: `index` is the array index into `rows`, and it is now REQUIRED on
// every results.errors entry that quarantine has to resolve back to a source
// row. It used to be derived as `row - 2`, which was only ever correct while
// `row` was the filtered-array index plus a header. `row` is now the PHYSICAL
// line in the uploaded file, so the two numbers diverge by one per blank row
// preceding this one -- which is the whole defect #1023 fixed. `row: 4` with
// `index: 2` is exactly that case: the third data row, sitting on physical
// line 4 because a blank line precedes it.
//
// No fallback is offered in the service on purpose: `row - 2` applied to a
// physical line number computes a WRONG index silently, which is worse than
// the undefined this fixture would otherwise produce.
const results = {
  total: 3,
  success: 2,
  errors: [{ row: 4, index: 2, errors: ['participantId inexistente'], data: { participantId: '00000042' } }],
};

const rows = [{ a: 1 }, { a: 2 }, { specimenId: 'S-3', participantId: '00000042' }];

describe('#794: quarantined batches record the import options they were produced under', () => {
  let db;

  beforeEach(() => {
    db = createDb();
  });

  it('persists startBoxId, autoIncrement and groupFields on the batch document', async () => {
    await importLGPDService.quarantineRejectedSampleRows(db, {
      fileName: 'amostras.csv',
      rows,
      results,
      actor: { userID: 'u-1' },
      importOptions: {
        startBoxId: '65f0a1b2c3d4e5f6a7b8c9d0',
        autoIncrement: true,
        groupFields: { studyId: 'ST-1' },
      },
    });

    expect(db.inserted.batches).toHaveLength(1);
    expect(db.inserted.batches[0].importOptions).toEqual({
      startBoxId: '65f0a1b2c3d4e5f6a7b8c9d0',
      autoIncrement: true,
      groupFields: { studyId: 'ST-1' },
    });
  });

  // The slot cursor is the reason this matters: a row rejected at batch
  // position N was never allocated, so a resubmit needs to know the batch was
  // auto-incrementing from a specific box at all before it can decide what
  // position the corrected row should take.
  it('records how many rows had already succeeded, the slot cursor a resubmit needs', async () => {
    await importLGPDService.quarantineRejectedSampleRows(db, {
      fileName: 'amostras.csv',
      rows,
      results,
      importOptions: { startBoxId: 'box-1', autoIncrement: true, groupFields: {} },
    });

    expect(db.inserted.batches[0].counts).toMatchObject({ total: 3, success: 2, errors: 1 });
    expect(db.inserted.batches[0].importOptions.autoIncrement).toBe(true);
  });

  it('writes an explicit null-shaped importOptions when the import passed none', async () => {
    await importLGPDService.quarantineRejectedSampleRows(db, { fileName: 'a.csv', rows, results });

    expect(db.inserted.batches[0].importOptions).toEqual({
      startBoxId: null,
      autoIncrement: false,
      groupFields: {},
    });
  });

  // groupFields is caller-supplied and lands in a document a later resubmit
  // reads back; it must not be able to smuggle operators into the batch doc.
  it('stores only plain scalar group fields, dropping anything operator-shaped', async () => {
    await importLGPDService.quarantineRejectedSampleRows(db, {
      fileName: 'a.csv',
      rows,
      results,
      importOptions: {
        startBoxId: 'box-1',
        autoIncrement: false,
        groupFields: { studyId: 'ST-1', bad: { $ne: null }, nested: { deep: 1 } },
      },
    });

    expect(db.inserted.batches[0].importOptions.groupFields).toEqual({ studyId: 'ST-1' });
  });

  // #1023: the pin for the half that had none. The fixture above is NOT a
  // regression test for it -- with row:4 / index:2 the old `rows[row - 2]`
  // arithmetic resolves to rows[2] as well, so both the old and new code pass
  // it. This case makes the two disagree: two blank lines precede the row, so
  // the physical line is 5 while the array index is still 2. Under the old
  // arithmetic rows[5 - 2] is rows[3], which does not exist in a 3-element
  // array -- the quarantined record would silently carry `row: null` and be
  // uncorrectable, which is the RNF011 AC#4 guarantee quarantine exists for.
  it('resolves the quarantined source row by array index, not by re-deriving it from the physical line', async () => {
    const shiftedResults = {
      total: 3,
      success: 2,
      errors: [{ row: 5, index: 2, errors: ['participantId inexistente'], data: { participantId: '00000042' } }],
    };

    await importLGPDService.quarantineRejectedSampleRows(db, {
      fileName: 'a.csv',
      rows,
      results: shiftedResults,
      importOptions: { startBoxId: 'box-1', autoIncrement: true, groupFields: {} },
    });

    expect(db.inserted.records).toHaveLength(1);
    expect(db.inserted.records[0]).toMatchObject({
      rowNumber: 5,
      row: { specimenId: 'S-3', participantId: '00000042' },
    });
  });

  it('still returns the batch id and stages the rejected rows unchanged', async () => {
    const batchId = await importLGPDService.quarantineRejectedSampleRows(db, {
      fileName: 'a.csv',
      rows,
      results,
      importOptions: { startBoxId: 'box-1', autoIncrement: true, groupFields: {} },
    });

    expect(batchId).toBe('batch-1');
    expect(db.inserted.records).toHaveLength(1);
    expect(db.inserted.records[0]).toMatchObject({
      rowNumber: 4,
      status: 'ERROR',
      row: { specimenId: 'S-3', participantId: '00000042' },
    });
  });
});
