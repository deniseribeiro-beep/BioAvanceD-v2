import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { ObjectId } = require('mongodb');
const jwt = require('jsonwebtoken');
const fhirImportStagingService = require('../../src/services/fhir-import-staging.service');
const qualityDomain = require('../../src/services/quality-domain.service');

function sameValue(left, right) {
  return String(left) === String(right);
}

function matches(doc, filter = {}) {
  return Object.entries(filter).every(([key, value]) => sameValue(doc[key], value));
}

function cursor(rows = []) {
  const state = [...rows];
  return {
    sort: vi.fn(() => cursor(state)),
    toArray: vi.fn(async () => state),
  };
}

function collection() {
  const docs = [];
  return {
    docs,
    insertOne: vi.fn(async (doc) => {
      if (!doc._id) doc._id = new ObjectId();
      docs.push(doc);
      return { insertedId: doc._id };
    }),
    insertMany: vi.fn(async (items) => {
      for (const doc of items) {
        if (!doc._id) doc._id = new ObjectId();
        docs.push(doc);
      }
      return { insertedCount: items.length };
    }),
    findOne: vi.fn(async (filter = {}) => docs.find((doc) => matches(doc, filter)) || null),
    find: vi.fn((filter = {}) => cursor(docs.filter((doc) => matches(doc, filter)))),
    updateOne: vi.fn(async (filter = {}, update = {}, options = {}) => {
      let doc = docs.find((item) => matches(item, filter));
      const inserted = !doc && options.upsert;
      if (inserted) {
        doc = { _id: new ObjectId(), ...filter };
        docs.push(doc);
      }
      if (!doc) return { matchedCount: 0, modifiedCount: 0 };
      Object.assign(doc, update.$setOnInsert || {}, update.$set || {});
      return inserted
        ? { matchedCount: 0, modifiedCount: 0, upsertedId: doc._id, upsertedCount: 1 }
        : { matchedCount: 1, modifiedCount: 1 };
    }),
  };
}

function createDb() {
  const collections = {
    import_batches: collection(),
    import_staging_records: collection(),
    audit_logs: collection(),
  };
  return {
    collections,
    collection(name) {
      return collections[name] || (collections[name] = collection());
    },
  };
}

async function seedBatch(db, record) {
  const batchId = new ObjectId();
  await db.collection('import_batches').insertOne({
    _id: batchId,
    type: 'FHIR_BUNDLE',
    status: 'STAGED',
  });
  await db.collection('import_staging_records').insertOne({
    _id: record._id || new ObjectId(),
    batchId,
    rowNumber: 1,
    errors: [],
    normalized: {},
    ...record,
  });
  return {
    batchId,
    record: db.collection('import_staging_records').docs[0],
  };
}

describe('fhir-import-staging.service.js item 8 residual branches', () => {
  const originalSecret = process.env.CONSENT_SECRET;

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.CONSENT_SECRET = 'item8-fhir-residual-secret';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalSecret === undefined) delete process.env.CONSENT_SECRET;
    else process.env.CONSENT_SECRET = originalSecret;
  });

  it('keeps solid-matrix SPREC on the generic canonical axes when processing is unknown', async () => {
    const db = createDb();
    vi.spyOn(qualityDomain, 'resolveMethodologicalQuality').mockReturnValue({
      model_version: 'RCS-GOV-1.0',
      input_status: 'valid',
      input_errors: [],
      governance_status: 1,
      governance_outcome: 'admissible',
      governance_failure_reasons: [],
      governance_rule_codes: [],
      p_bio: 0.9,
      rcs_score: 90,
      score_based_grade: 'A',
      final_grade: 'A',
      grade_route: 'score',
      axis_penalties: [],
      calculation_trace: {},
    });

    const staged = await fhirImportStagingService.stageBundle(db, {
      resourceType: 'Bundle',
      entry: [
        {
          resource: {
            resourceType: 'Patient',
            id: 'P-SOLID',
            identifier: [{ system: 'urn:cpf', value: 'DOC-SOLID' }],
            name: [{ text: 'Paciente Sólido' }],
          },
        },
        {
          resource: {
            resourceType: 'Consent',
            status: 'SIGNED',
            patient: { reference: 'Patient/P-SOLID' },
          },
        },
        {
          resource: {
            resourceType: 'Specimen',
            id: 'SPEC-SOLID',
            subject: { reference: 'Patient/P-SOLID' },
            type: { text: 'TISSUE' },
            collection: { collectedDateTime: '2026-09-19T12:00:00Z' },
            extension: [
              { url: 'urn:bioavanced:matrix', valueString: 'solid tissue' },
              { url: 'urn:bioavanced:sprecs', valueString: 'TIS-A' },
              { url: 'urn:bioavanced:rcs-gov-required', valueBoolean: true },
              { url: 'urn:bioavanced:processing-unknown', valueBoolean: true },
            ],
          },
        },
      ],
    });

    expect(staged.records).toHaveLength(1);
    expect(staged.records[0].status).toBe(fhirImportStagingService.STATUS.READY_TO_COMMIT);
    expect(staged.records[0].normalized.rcsPreview.sprec).toEqual({
      matrixType: 'solid',
      sampleType: 'TIS',
      primaryContainer: 'A',
      preCentrifugation: 'X',
      centrifugation: 'X',
      secondCentrifugation: 'X',
      postCentrifugationDelay: 'X',
      longTermStorage: 'X',
    });
  });

  it('derives a released external-document workflow when explicit snapshot fields are absent', async () => {
    const db = createDb();
    const { batchId } = await seedBatch(db, {
      status: fhirImportStagingService.STATUS.NEEDS_REVIEW,
      normalized: {
        specimenId: 'SPEC-EXTERNAL',
        participantId: 'P-EXTERNAL',
        patientEmail: '',
        consentSigned: false,
      },
      externalDocument: {
        validatedAt: new Date('2026-09-19T12:00:00Z'),
      },
    });

    const result = await fhirImportStagingService.getConsentStatus(db, batchId);

    expect(result.records[0]).toMatchObject({
      specimenId: 'SPEC-EXTERNAL',
      participantId: 'P-EXTERNAL',
      consentStatus: 'EXTERNAL_ATTACHED',
      quarantineStatus: 'RELEASED',
      quarantineReason: null,
      availabilityStatus: 'AVAILABLE',
      workflowStatus: 'EXTERNAL_ATTACHED',
      consentSigned: false,
    });
  });

  it('treats an already-signed READY_TO_COMMIT import-consent token as idempotent', async () => {
    const db = createDb();
    const { batchId, record } = await seedBatch(db, {
      status: fhirImportStagingService.STATUS.READY_TO_COMMIT,
      normalized: {
        participantId: 'P-IDEMPOTENT',
        consentSigned: true,
      },
      warnings: [],
    });

    const token = jwt.sign({
      scope: 'fhir-import-consent',
      batchId: String(batchId),
      recordId: String(record._id),
      participantId: 'P-IDEMPOTENT',
    }, process.env.CONSENT_SECRET, { expiresIn: '2h' });

    const writesBefore = db.collections.import_staging_records.updateOne.mock.calls.length;
    const result = await fhirImportStagingService.acceptImportConsentToken(db, token);

    expect(result.updated).toBe(false);
    expect(result.record).toBe(record);
    expect(db.collections.import_staging_records.updateOne.mock.calls.length).toBe(writesBefore);
  });

  it('rejects a signed token with the wrong scope before reading any import batch', async () => {
    const db = createDb();
    const token = jwt.sign({
      scope: 'another-scope',
      batchId: String(new ObjectId()),
      recordId: String(new ObjectId()),
      participantId: 'P-SCOPE',
    }, process.env.CONSENT_SECRET, { expiresIn: '2h' });

    await expect(fhirImportStagingService.validateImportConsentToken(db, token))
      .rejects.toMatchObject({
        message: 'Token inválido para consentimento de importação.',
        statusCode: 401,
      });
    expect(db.collections.import_batches.findOne).not.toHaveBeenCalled();
  });

  it('maps malformed or unverifiable import-consent tokens to the opaque 401 error', async () => {
    const db = createDb();

    await expect(fhirImportStagingService.validateImportConsentToken(db, 'not-a-jwt'))
      .rejects.toMatchObject({
        message: 'Token inválido ou expirado',
        statusCode: 401,
      });
    expect(db.collections.import_batches.findOne).not.toHaveBeenCalled();
  });
});


describe('fhir-import-staging.service.js item 8 branch-95 source-located guards', () => {
  const originalSecret = process.env.CONSENT_SECRET;

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.CONSENT_SECRET = 'item8-fhir-branch95-secret';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalSecret === undefined) delete process.env.CONSENT_SECRET;
    else process.env.CONSENT_SECRET = originalSecret;
  });

  it('preserves the canonical bad-request status from normalizeEntries instead of wrapping it again', async () => {
    const db = createDb();

    await expect(fhirImportStagingService.stageBundle(db, null))
      .rejects.toMatchObject({
        message: 'A importação em lote exige um FHIR R4 Bundle JSON.',
        statusCode: 400,
      });

    expect(db.collections.import_batches.docs).toHaveLength(0);
  });

  it('counts WARNING and NEEDS_EMAIL records independently in consent-status reconciliation', async () => {
    const db = createDb();
    const batchId = new ObjectId();
    await db.collection('import_batches').insertOne({
      _id: batchId,
      type: 'FHIR_BUNDLE',
      status: 'STAGED',
    });

    await db.collection('import_staging_records').insertMany([
      {
        _id: new ObjectId(),
        batchId,
        status: fhirImportStagingService.STATUS.WARNING,
        errors: [],
        warnings: [{ field: 'synthetic', message: 'warning' }],
        normalized: { participantId: 'P-WARN', specimenId: 'S-WARN' },
      },
      {
        _id: new ObjectId(),
        batchId,
        status: fhirImportStagingService.STATUS.NEEDS_EMAIL,
        errors: [{ code: 'NEEDS_EMAIL', message: 'email required' }],
        warnings: [],
        normalized: { participantId: 'P-EMAIL', specimenId: 'S-EMAIL' },
      },
    ]);

    const result = await fhirImportStagingService.getConsentStatus(db, batchId);

    expect(result.counts.warnings).toBe(1);
    expect(result.counts.errors).toBe(1);
  });
});
