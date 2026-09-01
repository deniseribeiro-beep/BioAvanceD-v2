/**
 * Unit tests for fhir-import-staging.service.js#attachExternalDocument's
 * validation gate (#801).
 *
 * Before this fix, attachExternalDocument read nothing about the record's
 * own state -- not `status`, not `errors`, not `warnings` -- before driving
 * it straight to COMMITTED/RELEASED/AVAILABLE and writing `samples`. The
 * endpoint's legitimate purpose is bypassing the *consent* gate out of band;
 * it must not double as a bypass of the *validation* gate (RNF011 AC#4,
 * "sem correção silenciosa"), and a `samples.updateOne` that matches nothing
 * (no `upsert` on this write, unlike commitBatch's) must not be allowed to
 * leave the staging record marked COMMITTED with no sample behind it.
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

/** A FHIR batch as stageBundle writes it, plus one staging record. */
async function seedFhirBatch(db, recordOverrides = {}) {
  const batch = await db.collection('import_batches').insertOne({ type: 'FHIR_BUNDLE', status: 'STAGED' });
  const record = await db.collection('import_staging_records').insertOne({
    batchId: batch.insertedId,
    rowNumber: 1,
    status: fhirImportStagingService.STATUS.NEEDS_REVIEW,
    errors: [],
    normalized: { participantId: 'PART-801', specimenId: 'SPEC-801' },
    ...recordOverrides,
  });
  return { batchId: batch.insertedId, recordId: record.insertedId };
}

describe('fhir-import-staging.service#attachExternalDocument -- validation gate (#801)', () => {
  let db;

  beforeEach(() => {
    db = createDb();
  });

  it('refuses a record with a blocking validation error and leaves it un-mutated', async () => {
    const { batchId, recordId } = await seedFhirBatch(db, {
      errors: [{ field: 'specimenId', message: 'specimenId é obrigatório no Specimen.id ou identifier.value.' }],
    });
    // A sample would otherwise be found here -- proves the refusal comes
    // from the blocking-error check, not incidentally from the matchedCount
    // guard added alongside it.
    await db.collection('samples').insertOne({ specimenId: 'SPEC-801', specimenStatus: 'available' });

    await expect(
      fhirImportStagingService.attachExternalDocument(db, batchId, recordId, {})
    ).rejects.toMatchObject({ statusCode: 400 });

    const record = db.collections.import_staging_records.docs[0];
    expect(record.status).toBe(fhirImportStagingService.STATUS.NEEDS_REVIEW);
    expect(record.consentStatus).toBeUndefined();
    expect(record.quarantineStatus).toBeUndefined();
    expect(record.availabilityStatus).toBeUndefined();
    expect(record.externalDocument).toBeUndefined();
    expect(db.collections.samples.updateOne).not.toHaveBeenCalled();
  });

  it('still attaches when the only error is NEEDS_EMAIL (the consent bypass keeps working)', async () => {
    const { batchId, recordId } = await seedFhirBatch(db, {
      errors: [{ field: 'patientEmail', code: 'NEEDS_EMAIL', message: 'E-mail do paciente é obrigatório quando TCLE precisa ser enviado.' }],
    });
    await db.collection('samples').insertOne({ specimenId: 'SPEC-801', specimenStatus: 'available' });

    const result = await fhirImportStagingService.attachExternalDocument(db, batchId, recordId, { userID: 'op-1', note: 'Termo assinado em papel' });

    expect(result.batch.type).toBe('FHIR_BUNDLE');
    const record = db.collections.import_staging_records.docs[0];
    expect(record.status).toBe(fhirImportStagingService.STATUS.COMMITTED);
    expect(record.consentStatus).toBe('EXTERNAL_ATTACHED');
    expect(record.quarantineStatus).toBe('RELEASED');
    expect(record.quarantineReason).toBeNull();
    expect(record.availabilityStatus).toBe('AVAILABLE');
    expect(record.externalDocument).toMatchObject({ attachedBy: 'op-1', note: 'Termo assinado em papel' });

    const sample = db.collections.samples.docs.find((doc) => doc.specimenId === 'SPEC-801');
    expect(sample.consentStatus).toBe('EXTERNAL_ATTACHED');
    expect(sample.specimenStatus).toBe('available');
  });

  it('refuses when the samples.updateOne write matches nothing, and does not leave the record COMMITTED', async () => {
    const { batchId, recordId } = await seedFhirBatch(db);
    // Deliberately no matching `samples` document for SPEC-801.

    await expect(
      fhirImportStagingService.attachExternalDocument(db, batchId, recordId, {})
    ).rejects.toMatchObject({ statusCode: 404 });

    const record = db.collections.import_staging_records.docs[0];
    expect(record.status).not.toBe(fhirImportStagingService.STATUS.COMMITTED);
    expect(record.status).toBe(fhirImportStagingService.STATUS.NEEDS_REVIEW);
    expect(record.consentStatus).toBeUndefined();
    expect(record.quarantineStatus).toBeUndefined();
    expect(record.externalDocument).toBeUndefined();
  });
});
