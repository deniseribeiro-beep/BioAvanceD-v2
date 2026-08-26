/**
 * Unit tests for fhir-import-staging.service.js#commitBatch's Patient/
 * ParticipantIdentity dual-write (RF005/RNF007, #363/#563). commitBatch's
 * Patient upsert previously had no accompanying ParticipantIdentity write
 * at all — every other create path in this app (patient.service.js#
 * createPatient, import.service.js#upsertPatient, import-lgpd.service.js's
 * two create paths) already dual-writes; this was the one gap left in the
 * import/FHIR consumer group.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { ObjectId } = require('mongodb');
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

describe('fhir-import-staging.service#commitBatch — ParticipantIdentity dual-write (#563)', () => {
  let db;
  let batchId;

  beforeEach(async () => {
    db = createDb();
    // #799: `type` is not decoration here -- stageBundle has written
    // `type: 'FHIR_BUNDLE'` since this service's first commit, and the readers
    // now filter on it so an LGPD quarantine batch cannot be resolved through
    // a FHIR endpoint. A batch fixture without it is a shape the writer never
    // produces.
    const batch = await db.collection('import_batches').insertOne({ type: 'FHIR_BUNDLE', status: 'VALIDATED' });
    batchId = batch.insertedId;
    await db.collection('import_staging_records').insertOne({
      batchId,
      rowNumber: 1,
      status: fhirImportStagingService.STATUS.VALID,
      errors: [],
      normalized: {
        participantId: 'PART-563',
        patientName: 'Maria Silva',
        patientBirthDate: '1985-05-20',
        patientDocument: '12345678900',
        patientEmail: 'maria@example.com',
        consentSigned: true,
        specimenId: 'SPEC-563',
        sampleType: 'blood',
      },
    });
  });

  it('dual-writes ParticipantIdentity alongside the Patient upsert on commit', async () => {
    const result = await fhirImportStagingService.commitBatch(db, batchId);

    expect(result.committed).toBe(1);

    // #571/#575: patientName/birthDate/identityDocument are civil identity
    // — they land only on ParticipantIdentity, never on Patient (a
    // non-canonical field there per PatientModel's allowlist).
    const patient = db.collections.patients.docs.find((doc) => doc.participantId === 'PART-563');
    expect(patient).toBeTruthy();
    expect(patient.patientName).toBeUndefined();
    expect(patient.cpf).toBeUndefined();

    const identity = db.collections.participantIdentities.docs.find((doc) => doc.participantId === 'PART-563');
    expect(identity).toBeTruthy();
    expect(identity.patientName).toBe('Maria Silva');
    expect(identity.identityDocument).toBe('12345678900');
    expect(identity.birthDate).toBeInstanceOf(Date);
  });

  it('#571: carries sex onto Patient when the FHIR resource provides Patient.gender', async () => {
    db.collections.import_staging_records.docs[0].normalized.patientSex = 'F';

    await fhirImportStagingService.commitBatch(db, batchId);

    const patient = db.collections.patients.docs.find((doc) => doc.participantId === 'PART-563');
    expect(patient.sex).toBe('F');
  });

  it('is idempotent: re-committing an already-committed batch does not duplicate the ParticipantIdentity record', async () => {
    await fhirImportStagingService.commitBatch(db, batchId);
    await db.collection('import_staging_records').updateOne(
      { batchId },
      { $set: { status: fhirImportStagingService.STATUS.READY_TO_COMMIT } }
    );
    await fhirImportStagingService.commitBatch(db, batchId);

    const identities = db.collections.participantIdentities.docs.filter((doc) => doc.participantId === 'PART-563');
    expect(identities).toHaveLength(1);
  });
});
