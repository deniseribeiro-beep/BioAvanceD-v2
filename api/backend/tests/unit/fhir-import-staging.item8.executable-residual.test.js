import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { ObjectId } = require('mongodb');
const service = require('../../src/services/fhir-import-staging.service');
const qualityDomain = require('../../src/services/quality-domain.service');
const notificationService = require('../../src/services/NotificationService');

function sameValue(left, right) {
  return String(left) === String(right);
}

function matches(doc, filter = {}) {
  return Object.entries(filter).every(([key, value]) => sameValue(doc[key], value));
}

function cursor(rows = []) {
  const copy = [...rows];
  return {
    sort: vi.fn(() => cursor(copy)),
    toArray: vi.fn().mockResolvedValue(copy),
  };
}

function createCollection(initial = []) {
  const docs = [...initial];
  return {
    docs,
    insertOne: vi.fn(async (doc) => {
      if (!doc._id) doc._id = new ObjectId();
      docs.push(doc);
      return { insertedId: doc._id };
    }),
    insertMany: vi.fn(async (items) => {
      items.forEach((doc) => {
        if (!doc._id) doc._id = new ObjectId();
        docs.push(doc);
      });
      return { insertedCount: items.length };
    }),
    findOne: vi.fn(async (filter = {}) => docs.find((doc) => matches(doc, filter)) || null),
    find: vi.fn((filter = {}) => cursor(docs.filter((doc) => matches(doc, filter)))),
    updateOne: vi.fn(async (filter = {}, update = {}, options = {}) => {
      let doc = docs.find((item) => matches(item, filter));
      if (!doc && options.upsert) {
        doc = { _id: new ObjectId(), ...filter, ...(update.$setOnInsert || {}) };
        docs.push(doc);
        Object.assign(doc, update.$set || {});
        return { matchedCount: 0, modifiedCount: 0, upsertedId: doc._id, upsertedCount: 1 };
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
    audit_logs: createCollection(),
  };
  return {
    collections,
    collection(name) {
      return collections[name] || (collections[name] = createCollection());
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
    _id: new ObjectId(),
    batchId,
    rowNumber: 1,
    errors: [],
    warnings: [],
    ...record,
  });
  return {
    batchId,
    record: db.collection('import_staging_records').docs[0],
  };
}

describe('fhir-import-staging.service item 8 executable residual branches', () => {
  const originalSecret = process.env.CONSENT_SECRET;

  beforeEach(() => {
    process.env.CONSENT_SECRET = 'item8-executable-fhir-secret';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalSecret === undefined) delete process.env.CONSENT_SECRET;
    else process.env.CONSENT_SECRET = originalSecret;
  });

  it('handles an omitted batch id through the normal not-found boundary instead of throwing during id normalization', async () => {
    const db = createDb();

    await expect(service.getBatch(db, undefined)).rejects.toMatchObject({
      message: 'Lote de importação FHIR não encontrado.',
      statusCode: 404,
    });
  });

  it('stages an unsigned valid-email record with a consent warning and a biomarker whose value is genuinely absent', async () => {
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

    const result = await service.stageBundle(db, {
      resourceType: 'Bundle',
      entry: [
        {
          resource: {
            resourceType: 'Patient',
            id: 'P-ITEM8-WARNING',
            identifier: [{ system: 'urn:cpf', value: 'DOC-ITEM8-WARNING' }],
            name: [{ text: 'Paciente Sintético' }],
            telecom: [{ system: 'email', value: 'synthetic@example.test' }],
          },
        },
        {
          resource: {
            resourceType: 'Observation',
            id: 'OBS-ITEM8-NOVALUE',
            subject: { reference: 'Patient/P-ITEM8-WARNING' },
            code: { text: 'Marker without a reported value' },
          },
        },
        {
          resource: {
            resourceType: 'Specimen',
            id: 'SPEC-ITEM8-WARNING',
            subject: { reference: 'Patient/P-ITEM8-WARNING' },
            type: { text: 'PLASMA' },
          },
        },
      ],
    });

    expect(result.records).toHaveLength(1);
    expect(result.records[0].status).toBe(service.STATUS.VALID);
    expect(result.records[0].warnings).toEqual([
      expect.objectContaining({ field: 'consent' }),
    ]);
    expect(result.records[0].normalized.biomarkers).toEqual([
      expect.objectContaining({
        biomarkerType: 'Marker without a reported value',
        value: null,
      }),
    ]);
  });

  it('uses an existing normalized record when sending consent instead of the empty-object fallback', async () => {
    const db = createDb();
    const { batchId, record } = await seedBatch(db, {
      status: service.STATUS.VALID,
      normalized: {
        participantId: 'P-CONSENT-ITEM8',
        patientName: 'Paciente Sintético',
        patientEmail: 'synthetic-consent@example.test',
        consentSigned: false,
      },
    });
    vi.spyOn(notificationService, 'sendConsentEmail').mockResolvedValue({
      success: true,
      provider: 'test-provider',
      messageId: 'message-item8',
    });

    const result = await service.sendConsents(db, batchId, { userID: 'operator-item8' });

    expect(notificationService.sendConsentEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        participantId: 'P-CONSENT-ITEM8',
        email: 'synthetic-consent@example.test',
      }),
      expect.stringContaining('/patient/e-consent/import/')
    );
    expect(result.consentResults).toEqual([
      expect.objectContaining({
        recordId: record._id,
        status: service.STATUS.PENDING_CONSENT,
        sent: true,
      }),
    ]);
  });

  it('counts WARNING and NEEDS_EMAIL statuses through sendConsents refresh without rewriting them', async () => {
    const db = createDb();
    const { batchId } = await seedBatch(db, {
      status: service.STATUS.WARNING,
      errors: [{ code: 'SYNTHETIC_BLOCK', message: 'blocking' }],
      normalized: { participantId: 'P-WARN' },
    });
    await db.collection('import_staging_records').insertOne({
      _id: new ObjectId(),
      batchId,
      rowNumber: 2,
      status: service.STATUS.NEEDS_EMAIL,
      errors: [{ code: 'OTHER_BLOCK', message: 'blocking' }],
      warnings: [],
      normalized: { participantId: 'P-NEEDS-EMAIL' },
    });

    const result = await service.sendConsents(db, batchId);

    expect(result.counts.warnings).toBeGreaterThanOrEqual(1);
    expect(result.counts.errors).toBeGreaterThanOrEqual(1);
    expect(result.consentResults).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ skipped: true, reason: 'validation_errors' }),
      ])
    );
  });

  it('falls back to an empty normalized object when sendConsents receives a VALID record without normalized', async () => {
    const db = createDb();
    const { batchId, record } = await seedBatch(db, {
      status: service.STATUS.VALID,
      errors: [],
      // intentionally omit normalized → record.normalized || {}
    });

    const result = await service.sendConsents(db, batchId);

    expect(result.consentResults).toEqual([
      expect.objectContaining({
        recordId: record._id,
        status: service.STATUS.NEEDS_REVIEW,
        sent: false,
      }),
    ]);
    expect(db.collection('import_staging_records').docs[0].status).toBe(service.STATUS.NEEDS_REVIEW);
  });
});
