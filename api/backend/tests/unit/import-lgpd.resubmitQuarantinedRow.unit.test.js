/**
 * #1352 (RNF011 AC#4, "sem correção silenciosa"): correct-and-resubmit one
 * quarantined sample row.
 *
 * The row itself runs through processSampleRow, the import's own path (#817),
 * which import-lgpd.service.importSamples.unit.test.js covers. Here it is
 * stubbed, and these cases pin what the resubmit adds around it: the input
 * checks, the atomic claim, the record and batch transitions, and the
 * context the row is run under.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { ObjectId } = require('mongodb');
const service = require('../../src/services/import-lgpd.service');
const { revealStagedRecord } = require('../../src/utils/stagedRowCrypto');

const CORRECTED = { sampleType: 'PLASMA', sampleOrigin: 'VENOUS_BLOOD', participantId: '12345678' };

function matches(doc, filter) {
  return Object.entries(filter).every(([key, want]) => {
    const have = doc[key];
    if (want instanceof ObjectId || have instanceof ObjectId) return String(have) === String(want);
    return have === want;
  });
}

/** Enough of a Mongo collection for findOne/updateOne/countDocuments. */
function fakeCollection(docs) {
  return {
    docs,
    findOne: vi.fn(async (filter) => docs.find((d) => matches(d, filter)) || null),
    countDocuments: vi.fn(async (filter) => docs.filter((d) => matches(d, filter)).length),
    updateOne: vi.fn(async (filter, update) => {
      const doc = docs.find((d) => matches(d, filter));
      if (!doc) return { matchedCount: 0, modifiedCount: 0 };
      Object.assign(doc, update.$set || {});
      for (const [path, by] of Object.entries(update.$inc || {})) {
        const [head, tail] = path.split('.');
        doc[head] = doc[head] || {};
        doc[head][tail] = (doc[head][tail] || 0) + by;
      }
      for (const [key, value] of Object.entries(update.$push || {})) {
        doc[key] = [...(doc[key] || []), value];
      }
      return { matchedCount: 1, modifiedCount: 1 };
    }),
  };
}

function makeDb({ batchType = 'LGPD_SAMPLE_CSV', status = 'ERROR', otherErrorRecords = 0 } = {}) {
  const batchId = new ObjectId();
  const recordId = new ObjectId();
  const batch = {
    _id: batchId,
    type: batchType,
    status: 'QUARANTINED',
    counts: { total: 3, success: 1, errors: 1 + otherErrorRecords },
    importOptions: { startBoxId: 'box-start', autoIncrement: true, groupFields: { sampleOrigin: 'VENOUS_BLOOD' } },
  };
  const records = [
    { _id: recordId, batchId, rowNumber: 7, status, errors: ['old error'], row: { sampleType: 'NOPE' } },
    ...Array.from({ length: otherErrorRecords }, (_, i) => ({ _id: new ObjectId(), batchId, rowNumber: 10 + i, status: 'ERROR' })),
  ];
  const collections = {
    import_batches: fakeCollection([batch]),
    import_staging_records: fakeCollection(records),
  };
  return {
    batchId,
    recordId,
    batch,
    record: records[0],
    db: { collection: (name) => collections[name] },
  };
}

describe('ImportLGPDService.resubmitQuarantinedSampleRow (#1352)', () => {
  let processSpy;

  beforeEach(() => {
    vi.spyOn(service, 'buildSampleRowCollaborators').mockResolvedValue({ samplesCollection: 'S' });
    processSpy = vi.spyOn(service, 'processSampleRow').mockResolvedValue({ ok: true, sampleId: 'sample-9' });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('runs the corrected row through processSampleRow under the batch options, at slot 0 and its own row number', async () => {
    const { db, batchId, recordId } = makeDb();

    await service.resubmitQuarantinedSampleRow(db, String(batchId), String(recordId), CORRECTED, {
      actor: { userID: 'u1' },
    });

    expect(processSpy).toHaveBeenCalledTimes(1);
    const [, row, context] = processSpy.mock.calls[0];
    expect(row).toEqual(CORRECTED);
    expect(context).toMatchObject({
      samplesCollection: 'S',
      startBoxId: 'box-start',
      autoIncrement: true,
      groupFields: { sampleOrigin: 'VENOUS_BLOOD' },
      slotIndex: 0,
      rowNumber: 7,
      actor: { userID: 'u1' },
    });
  });

  it('marks an accepted row RESUBMITTED with the sample, who and when, and resolves a batch left with no ERROR record', async () => {
    const { db, batchId, recordId, batch, record } = makeDb();

    const result = await service.resubmitQuarantinedSampleRow(db, String(batchId), String(recordId), CORRECTED, {
      actor: { userID: 'u1' },
    });

    expect(result).toEqual({ sampleId: 'sample-9', recordStatus: 'RESUBMITTED', batchStatus: 'RESOLVED' });
    expect(record).toMatchObject({ status: 'RESUBMITTED', sampleId: 'sample-9', resubmittedBy: 'u1' });
    expect(record.resubmittedAt).toBeInstanceOf(Date);
    expect(record.resubmitAttempts).toHaveLength(1);
    expect(revealStagedRecord(record).row).toEqual(CORRECTED);
    expect(batch).toMatchObject({ status: 'RESOLVED', counts: { total: 3, success: 2, errors: 0, resubmitted: 1 } });
  });

  it('keeps the batch QUARANTINED while another record is still in ERROR', async () => {
    const { db, batchId, recordId, batch } = makeDb({ otherErrorRecords: 1 });

    const result = await service.resubmitQuarantinedSampleRow(db, String(batchId), String(recordId), CORRECTED);

    expect(result.batchStatus).toBe('QUARANTINED');
    expect(batch.status).toBe('QUARANTINED');
    expect(batch.counts.errors).toBe(1);
  });

  it('returns a rejected correction to ERROR with the new errors and the corrected row, and answers 422', async () => {
    processSpy.mockResolvedValue({ ok: false, errors: ['atcCode inválido: X'], data: {} });
    const { db, batchId, recordId, batch, record } = makeDb();

    const error = await service
      .resubmitQuarantinedSampleRow(db, String(batchId), String(recordId), CORRECTED)
      .catch((e) => e);

    expect(error.statusCode).toBe(422);
    expect(error.errors).toEqual(['atcCode inválido: X']);
    expect(record).toMatchObject({ status: 'ERROR', errors: ['atcCode inválido: X'] });
    expect(record.resubmitAttempts[0]).toMatchObject({ ok: false, errors: ['atcCode inválido: X'] });
    expect(revealStagedRecord(record).row).toEqual(CORRECTED);
    expect(batch).toMatchObject({ status: 'QUARANTINED', counts: { success: 1, errors: 1 } });
  });

  it('refuses a record not in ERROR with 409 and runs nothing', async () => {
    const { db, batchId, recordId } = makeDb({ status: 'RESUBMITTED' });

    const error = await service
      .resubmitQuarantinedSampleRow(db, String(batchId), String(recordId), CORRECTED)
      .catch((e) => e);

    expect(error.statusCode).toBe(409);
    expect(processSpy).not.toHaveBeenCalled();
  });

  it('puts the record back in ERROR when the row path throws', async () => {
    processSpy.mockRejectedValue(new Error('mongo down'));
    const { db, batchId, recordId, record } = makeDb();

    await expect(
      service.resubmitQuarantinedSampleRow(db, String(batchId), String(recordId), CORRECTED)
    ).rejects.toThrow('mongo down');
    expect(record.status).toBe('ERROR');
  });

  it('404s a patient batch, an unknown record and a malformed id is a 400', async () => {
    const patient = makeDb({ batchType: 'LGPD_PATIENT_CSV' });
    const a = await service
      .resubmitQuarantinedSampleRow(patient.db, String(patient.batchId), String(patient.recordId), CORRECTED)
      .catch((e) => e);
    expect(a.statusCode).toBe(404);

    const sample = makeDb();
    const b = await service
      .resubmitQuarantinedSampleRow(sample.db, String(sample.batchId), String(new ObjectId()), CORRECTED)
      .catch((e) => e);
    expect(b.statusCode).toBe(404);

    const c = await service.resubmitQuarantinedSampleRow(sample.db, 'nope', String(sample.recordId), CORRECTED).catch((e) => e);
    expect(c.statusCode).toBe(400);
    expect(processSpy).not.toHaveBeenCalled();
  });

  it('400s a row that is not a flat object of scalars, or that misses the import header rule', async () => {
    const { db, batchId, recordId } = makeDb();
    const bad = [
      null,
      [],
      { ...CORRECTED, nested: { $ne: null } },
      { ...CORRECTED, $where: '1' },
      { ...CORRECTED, 'a.b': 'x' },
      { sampleOrigin: 'VENOUS_BLOOD', participantId: '12345678' },
      { sampleType: 'PLASMA', sampleOrigin: 'VENOUS_BLOOD' },
    ];
    for (const row of bad) {
      const error = await service.resubmitQuarantinedSampleRow(db, String(batchId), String(recordId), row).catch((e) => e);
      expect(error.statusCode, JSON.stringify(row)).toBe(400);
    }
    expect(processSpy).not.toHaveBeenCalled();
  });
});
