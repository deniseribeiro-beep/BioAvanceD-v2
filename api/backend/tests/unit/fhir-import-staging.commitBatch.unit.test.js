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

// #1171: plus `$in`, for the phoneHash lookup.
function matches(doc, filter) {
  return Object.entries(filter).every(([key, value]) => (
    value && typeof value === 'object' && Array.isArray(value.$in)
      ? value.$in.includes(doc[key])
      : String(doc[key]) === String(value)
  ));
}

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
      const matched = docs.filter((doc) => matches(doc, filter));
      return { sort: vi.fn().mockReturnThis(), toArray: vi.fn(async () => matched) };
    }),
    findOne: vi.fn(async (filter = {}) => docs.find((doc) => matches(doc, filter)) || null),
    updateOne: vi.fn(async (filter = {}, update = {}, options = {}) => {
      let doc = docs.find((item) => matches(item, filter));
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
    // RF005/RNF007, dict-07 row 1 (#1104): all three civil-identity fields
    // are ciphertext-only now. The plaintext is dropped once the ciphertext
    // exists, so each value lives in its *Encrypted sibling and stays
    // matchable via its blind index.
    const identityCrypto = require('../../src/services/participantIdentity.service');
    expect(identity.patientName).toBeNull();
    expect(identity.identityDocument).toBeNull();
    expect(identityCrypto.decryptIdentity(identity)).toMatchObject({
      patientName: 'Maria Silva',
      identityDocument: '12345678900',
    });
    expect(identity.birthDate).toBeNull();
    expect(identity.birthDateEncrypted).toBeTruthy();
    expect(identity.birthDateHash).toBeTruthy();
    // #1386: the inserted record's own id (P1X-0348), not fieldsOf's null.
    expect(identity.participantIdentityId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(identity.identityStatus).toBe('active');
  });

  // #1171: every later consent path (/generate-link, resend, the publication
  // sweep, the queue worker) reads the contact from the identity record only
  // (#1166), so a committed FHIR participant must have it recorded there.
  it('#1171: records the FHIR contact on the identity record, encrypted', async () => {
    const participantIdentityService = require('../../src/services/participantIdentity.service');
    db.collections.import_staging_records.docs[0].normalized.patientPhone = '(11) 97777-6666';

    await fhirImportStagingService.commitBatch(db, batchId);

    const identity = db.collections.participantIdentities.docs.find((doc) => doc.participantId === 'PART-563');
    expect(identity.emailEncrypted).toBeTruthy();
    expect(identity.phoneHash).toBe(participantIdentityService.computeBlindIndex('phone', '11977776666'));
    const decrypted = participantIdentityService.decryptIdentity(identity);
    expect(decrypted.email).toBe('maria@example.com');
    expect(decrypted.phone).toBe('11977776666');
  });

  // #1171: the phoneHash index would refuse the upsert, and commitBatch has no
  // per-record catch, so one duplicate phone would abort the rest of the
  // batch. The record commits without the phone instead.
  it('#1171: commits without the phone when another participant already holds it', async () => {
    const participantIdentityService = require('../../src/services/participantIdentity.service');
    db.collections.import_staging_records.docs[0].normalized.patientPhone = '11977776666';
    await db.collection('participantIdentities').insertOne({
      participantId: 'OTHER-1',
      phoneHash: participantIdentityService.computeBlindIndex('phone', '11977776666'),
    });

    const result = await fhirImportStagingService.commitBatch(db, batchId);

    expect(result.committed).toBe(1);
    const identity = participantIdentityService.decryptIdentity(
      db.collections.participantIdentities.docs.find((doc) => doc.participantId === 'PART-563')
    );
    expect(identity.email).toBe('maria@example.com');
    expect(identity.phone ?? null).toBeNull();
    expect(identity.phoneHash ?? null).toBeNull();
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

  // RF026 AC7: closed is final. A re-commit over an existing closed specimen
  // leaves its status alone and records no OperationalStateDecision; over an
  // open one it still moves the status and records the change.
  it('leaves an existing closed specimen closed and records no decision for it', async () => {
    await db.collection('samples').insertOne({ specimenId: 'SPEC-563', participantId: 'PART-563', specimenStatus: 'closed' });

    const result = await fhirImportStagingService.commitBatch(db, batchId);

    expect(result.committed).toBe(1);
    const sample = db.collections.samples.docs.find((doc) => doc.specimenId === 'SPEC-563');
    expect(sample.specimenStatus).toBe('closed');
    expect(db.collections.operationalStateDecisions?.insertOne ?? vi.fn()).not.toHaveBeenCalled();
    expect(db.collections.quarantineActions?.insertOne ?? vi.fn()).not.toHaveBeenCalled();
  });

  it('still moves an existing open specimen and records the decision', async () => {
    await db.collection('samples').insertOne({ specimenId: 'SPEC-563', participantId: 'PART-563', specimenStatus: 'reserved' });

    await fhirImportStagingService.commitBatch(db, batchId);

    const sample = db.collections.samples.docs.find((doc) => doc.specimenId === 'SPEC-563');
    expect(['available', 'quarantined']).toContain(sample.specimenStatus);
    const [decision] = db.collections.operationalStateDecisions.insertOne.mock.calls[0];
    expect(decision).toMatchObject({ specimenId: 'SPEC-563', previousStatus: 'reserved', newStatus: sample.specimenStatus });
  });
});
