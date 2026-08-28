/**
 * Unit tests for fhir-import-staging.service.js's batch-type isolation (#799).
 *
 * `import_batches` / `import_staging_records` are shared by two import paths:
 * the FHIR bundle staging in this service (`type: 'FHIR_BUNDLE'`) and, since
 * #787, the LGPD sample-import quarantine (`type: 'LGPD_SAMPLE_CSV'`). The two
 * are gated on different permissions -- the FHIR routes on `uploadFiles`, every
 * LGPD route on `createPatient`/`createSample` -- so a query that discriminates
 * on nothing but `_id` hands one path's data to a principal holding only the
 * other path's permission. The quarantined LGPD rows carry `row`, the
 * pre-anonymisation spreadsheet line, so the payload is civil identifiers.
 *
 * #794's LGPD reader (`import-lgpd.service.js#getQuarantineBatch`) was written
 * with the mirror-image filter for this reason; these tests pin the other half.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const fhirImportStagingService = require('../../src/services/fhir-import-staging.service');

function createCollection() {
  const docs = [];
  return {
    docs,
    insertOne: vi.fn(async (doc) => {
      const inserted = { _id: doc._id || `id-${docs.length + 1}`, ...doc };
      docs.push(inserted);
      return { insertedId: inserted._id };
    }),
    find: vi.fn((filter = {}) => {
      const matched = docs.filter((doc) => Object.entries(filter).every(([key, value]) => String(doc[key]) === String(value)));
      return { sort: vi.fn().mockReturnThis(), toArray: vi.fn(async () => matched) };
    }),
    findOne: vi.fn(async (filter = {}) => docs.find((doc) => Object.entries(filter).every(([key, value]) => String(doc[key]) === String(value))) || null),
    updateOne: vi.fn(async (filter = {}, update = {}, options = {}) => {
      let doc = docs.find((item) => Object.entries(filter).every(([key, value]) => String(item[key]) === String(value)));
      if (!doc && options.upsert) {
        doc = { _id: `id-${docs.length + 1}`, ...filter };
        docs.push(doc);
      }
      if (!doc) return { matchedCount: 0, modifiedCount: 0 };
      Object.assign(doc, update.$setOnInsert || {}, update.$set || {});
      return { matchedCount: 1, modifiedCount: 1 };
    }),
  };
}

function createDb() {
  const collections = {
    import_batches: createCollection(),
    import_staging_records: createCollection(),
    patients: createCollection(),
    samples: createCollection(),
    audit_logs: createCollection(),
  };
  return {
    collections,
    collection: (name) => collections[name] || (collections[name] = createCollection()),
  };
}

/** A quarantine batch exactly as import-lgpd.service.js#quarantineRejectedSampleRows writes it. */
async function seedLgpdQuarantineBatch(db) {
  const batch = await db.collection('import_batches').insertOne({
    type: 'LGPD_SAMPLE_CSV',
    source: 'LGPD',
    status: 'QUARANTINED',
    fileName: 'amostras.csv',
    counts: { total: 500, success: 460, errors: 40 },
    createdBy: 'operator-1',
  });
  const record = await db.collection('import_staging_records').insertOne({
    batchId: batch.insertedId,
    rowNumber: 7,
    status: 'ERROR',
    errors: [{ field: 'participantId', message: 'Identificacao do paciente ausente' }],
    // The pre-anonymisation spreadsheet row -- the civil-identifier payload.
    row: { Nome: 'Maria Silva', CPF: '12345678900', Nascimento: '1985-05-20' },
    normalized: { participantId: null },
  });
  return { batchId: batch.insertedId, recordId: record.insertedId };
}

/** A FHIR batch as stageBundle writes it, to prove the fix does not over-reach. */
async function seedFhirBatch(db) {
  const batch = await db.collection('import_batches').insertOne({
    type: 'FHIR_BUNDLE',
    source: 'FHIR',
    status: 'STAGED',
  });
  const record = await db.collection('import_staging_records').insertOne({
    batchId: batch.insertedId,
    rowNumber: 1,
    status: fhirImportStagingService.STATUS.VALID,
    errors: [],
    normalized: { participantId: 'PART-799', specimenId: 'SPEC-799', consentSigned: true },
  });
  return { batchId: batch.insertedId, recordId: record.insertedId };
}

async function expect404(promise) {
  await expect(promise).rejects.toMatchObject({ statusCode: 404 });
}

describe('fhir-import-staging.service -- batch-type isolation (#799)', () => {
  let db;

  beforeEach(() => {
    db = createDb();
  });

  describe('getBatch', () => {
    it('404s on an LGPD quarantine batch instead of returning its civil identifiers', async () => {
      const { batchId } = await seedLgpdQuarantineBatch(db);

      await expect404(fhirImportStagingService.getBatch(db, batchId));
    });

    it('still returns a FHIR batch and its records', async () => {
      const { batchId } = await seedFhirBatch(db);

      const { batch, records } = await fhirImportStagingService.getBatch(db, batchId);

      expect(batch.type).toBe('FHIR_BUNDLE');
      expect(records).toHaveLength(1);
    });
  });

  describe('the readers and writers that resolve through getBatch', () => {
    it('getConsentStatus 404s on an LGPD batch', async () => {
      const { batchId } = await seedLgpdQuarantineBatch(db);

      await expect404(fhirImportStagingService.getConsentStatus(db, batchId));
    });

    it('commitBatch 404s on an LGPD batch', async () => {
      const { batchId } = await seedLgpdQuarantineBatch(db);

      await expect404(fhirImportStagingService.commitBatch(db, batchId));
    });

    it('sendConsents 404s on an LGPD batch', async () => {
      const { batchId } = await seedLgpdQuarantineBatch(db);

      await expect404(fhirImportStagingService.sendConsents(db, batchId));
    });

    // validateBatch is a *write*: it rewrites every record's status and then
    // refreshBatchCounts overwrites the batch's own status and counts. Pointed
    // at a quarantine batch it replaces `QUARANTINED` with a FHIR lifecycle
    // status and replaces the file-level counts (500 rows, 460 imported) with
    // counts over the quarantined rows alone -- destroying the record of what
    // the operator actually submitted.
    it('validateBatch 404s on an LGPD batch and leaves its status and counts intact', async () => {
      const { batchId } = await seedLgpdQuarantineBatch(db);

      await expect404(fhirImportStagingService.validateBatch(db, batchId));

      const batch = db.collections.import_batches.docs[0];
      expect(batch.status).toBe('QUARANTINED');
      expect(batch.counts).toEqual({ total: 500, success: 460, errors: 40 });
    });
  });

  // attachExternalDocument never calls getBatch -- it queries
  // import_staging_records directly on { _id, batchId }, so the discriminator
  // has to be added here separately. It is the most damaging of the group: it
  // marks the row RELEASED/AVAILABLE and then writes to `samples` keyed on
  // normalized.specimenId, which an LGPD quarantine record does not have.
  describe('attachExternalDocument', () => {
    it('404s on an LGPD quarantine record', async () => {
      const { batchId, recordId } = await seedLgpdQuarantineBatch(db);

      await expect404(fhirImportStagingService.attachExternalDocument(db, batchId, recordId, {}));
    });

    it('does not release the LGPD row from quarantine, nor touch samples', async () => {
      const { batchId, recordId } = await seedLgpdQuarantineBatch(db);

      await expect404(fhirImportStagingService.attachExternalDocument(db, batchId, recordId, {}));

      const record = db.collections.import_staging_records.docs[0];
      expect(record.status).toBe('ERROR');
      expect(record.quarantineStatus).toBeUndefined();
      expect(record.availabilityStatus).toBeUndefined();
      expect(db.collections.samples.updateOne).not.toHaveBeenCalled();
    });
  });

  // #802: validateImportConsentToken (called by acceptImportConsentToken, the
  // e-consent signing endpoint) used to look up `import_batches` on a bare
  // `{ _id }` filter -- no `type: FHIR_BUNDLE` discriminator -- so a forged or
  // stale token naming an LGPD quarantine batch's _id could resolve `batch` to
  // that other path's document instead of 404ing. These tests pin the fix,
  // which routes the lookup through findFhirBatch (the same discriminated
  // helper getBatch/getConsentStatus/commitBatch/sendConsents/validateBatch
  // already use).
  describe('validateImportConsentToken', () => {
    function signConsentToken({ batchId, recordId, participantId }) {
      const jwt = require('jsonwebtoken');
      return jwt.sign(
        {
          scope: 'fhir-import-consent',
          batchId: String(batchId),
          recordId: String(recordId),
          participantId: String(participantId || ''),
        },
        process.env.CONSENT_SECRET,
        { expiresIn: '2h' }
      );
    }

    const originalConsentSecret = process.env.CONSENT_SECRET;

    beforeEach(() => {
      process.env.CONSENT_SECRET = originalConsentSecret || 'test-consent-secret';
    });

    it('404s a token naming an LGPD quarantine batch instead of returning its batch', async () => {
      const { batchId, recordId } = await seedLgpdQuarantineBatch(db);
      // The LGPD record's own normalized.participantId (null in the seed) is
      // irrelevant here -- proving the point requires a token whose
      // participantId *would* satisfy the combined guard's equality check if
      // the batch lookup itself did not discriminate on type, so a
      // pre-fix reader that skipped straight to the participantId
      // comparison could not accidentally pass this test for the wrong
      // reason.
      const token = signConsentToken({ batchId, recordId, participantId: '' });

      const promise = fhirImportStagingService.validateImportConsentToken(db, token);

      await expect(promise).rejects.toMatchObject({
        statusCode: 404,
        message: 'Registro FHIR de importação não encontrado.',
      });
      // Pin what a caller does with the settled promise: acceptImportConsentToken
      // destructures `{ batch }` straight from this call's return value, so if
      // the rejection above did not actually happen the LGPD document would be
      // exactly what a bug here would hand back.
      await promise.catch(() => {});
    });

    it('still resolves a genuine FHIR_BUNDLE batch with a matching staging record and participantId', async () => {
      const { batchId, recordId } = await seedFhirBatch(db);
      const token = signConsentToken({ batchId, recordId, participantId: 'PART-799' });

      const result = await fhirImportStagingService.validateImportConsentToken(db, token);

      expect(result.batch.type).toBe('FHIR_BUNDLE');
      expect(String(result.batch._id)).toBe(String(batchId));
      expect(String(result.record._id)).toBe(String(recordId));
      expect(result.record.normalized.participantId).toBe('PART-799');
    });
  });
});
