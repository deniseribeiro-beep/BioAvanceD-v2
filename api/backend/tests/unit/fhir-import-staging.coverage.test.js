import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { ObjectId } = require('mongodb');
const jwt = require('jsonwebtoken');
const fhirImportStagingService = require('../../src/services/fhir-import-staging.service');
const notificationService = require('../../src/services/NotificationService');
const qualityDomain = require('../../src/services/quality-domain.service');
const logger = require('../../src/utils/logger');

function createCursor(items) {
  let current = [...items];
  return {
    sort: vi.fn((criteria = {}) => {
      const [field, direction = 1] = Object.entries(criteria)[0] || [];
      if (field) {
        current.sort((a, b) => {
          const left = a[field] ?? 0;
          const right = b[field] ?? 0;
          if (left === right) return 0;
          return direction >= 0 ? (left > right ? 1 : -1) : (left > right ? -1 : 1);
        });
      }
      return createCursor(current);
    }),
    toArray: vi.fn(async () => current),
  };
}

function matches(doc, filter = {}) {
  return Object.entries(filter).every(([key, value]) => String(doc[key]) === String(value));
}

function createCollection() {
  const docs = [];
  return {
    docs,
    insertOne: vi.fn(async (doc) => {
      if (!doc._id) doc._id = `id-${docs.length + 1}`;
      docs.push(doc);
      return { insertedId: doc._id };
    }),
    insertMany: vi.fn(async (items) => {
      items.forEach((doc) => {
        if (!doc._id) doc._id = `id-${docs.length + 1}`;
        docs.push(doc);
      });
      return { insertedCount: items.length };
    }),
    findOne: vi.fn(async (filter = {}) => docs.find((doc) => matches(doc, filter)) || null),
    find: vi.fn((filter = {}) => createCursor(docs.filter((doc) => matches(doc, filter)))),
    updateOne: vi.fn(async (filter = {}, update = {}, options = {}) => {
      let doc = docs.find((item) => matches(item, filter));
      const inserted = !doc && options.upsert;
      if (inserted) {
        doc = { _id: `id-${docs.length + 1}`, ...filter };
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
    import_batches: createCollection(),
    import_staging_records: createCollection(),
    patients: createCollection(),
    samples: createCollection(),
    audit_logs: createCollection(),
    quarantineActions: createCollection(),
  };
  return {
    collections,
    collection: (name) => collections[name] || (collections[name] = createCollection()),
  };
}

async function seedFhirBatch(db, records = []) {
  const batchId = new ObjectId();
  await db.collection('import_batches').insertOne({
    _id: batchId,
    type: 'FHIR_BUNDLE',
    status: 'STAGED',
  });
  for (const record of records) {
    await db.collection('import_staging_records').insertOne({
      batchId,
      rowNumber: db.collection('import_staging_records').docs.length + 1,
      status: fhirImportStagingService.STATUS.VALID,
      errors: [],
      normalized: {},
      ...record,
    });
  }
  return batchId;
}

describe('fhir-import-staging item 8 canonical boundary branches', () => {
  const originalFrontendUrl = process.env.FRONTEND_URL;
  const originalConsentSecret = process.env.CONSENT_SECRET;

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.CONSENT_SECRET = 'item8-fhir-consent-secret';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalFrontendUrl === undefined) delete process.env.FRONTEND_URL;
    else process.env.FRONTEND_URL = originalFrontendUrl;
    if (originalConsentSecret === undefined) delete process.env.CONSENT_SECRET;
    else process.env.CONSENT_SECRET = originalConsentSecret;
  });

  it('rejects database-less access and resolves a real ObjectId batch identifier unchanged', async () => {
    await expect(fhirImportStagingService.getBatch(null, 'missing')).rejects.toThrow(
      'Banco de dados não disponível'
    );

    const db = createDb();
    const batchId = await seedFhirBatch(db);
    const result = await fhirImportStagingService.getBatch(db, batchId);
    expect(result.batch._id).toBe(batchId);
  });

  it('normalizes only truthy Bundle resources and rejects empty/no-Specimen bundles', async () => {
    expect(fhirImportStagingService.normalizeEntries({
      resourceType: 'Bundle',
      entry: [
        { resource: null },
        { resource: 0 },
        { resource: { resourceType: 'Patient', id: 'P-1' } },
      ],
    })).toEqual([{ resourceType: 'Patient', id: 'P-1' }]);

    const db = createDb();
    await expect(fhirImportStagingService.stageBundle(db, {
      resourceType: 'Bundle',
      entry: [],
    })).rejects.toThrow('sem entradas');

    await expect(fhirImportStagingService.stageBundle(db, {
      resourceType: 'Bundle',
      entry: [{ resource: { resourceType: 'Patient', id: 'P-ONLY' } }],
    })).rejects.toThrow('não contém Specimen');
  });

  it('normalizes alternate FHIR references, identifiers, codings, telecom/name and extension value types', async () => {
    const db = createDb();
    vi.spyOn(qualityDomain, 'resolveMethodologicalQuality').mockReturnValue({
      model_version: 'RCS-GOV-1.0',
      governance_status: 1,
      governance_failure_reasons: null,
      rcs_score: 91,
      p_bio: 0.9,
      final_grade: 'A',
      grade_route: 'score',
      axis_penalties: null,
      calculation_trace: null,
    });

    const result = await fhirImportStagingService.stageBundle(db, {
      resourceType: 'Bundle',
      entry: [
        { resource: 42 },
        {
          resource: {
            resourceType: 'Patient',
            id: 'P-ALT',
            identifier: [{ system: 'urn:cpf', value: 'DOC-ALT' }],
            name: [{ given: ['Ana', 'Maria'], family: 'Silva' }],
            birthDate: '1991-02-03',
            gender: 'female',
            telecom: [
              { system: 'email', value: 'ana@example.org' },
              { system: 'phone', value: '+5511000000000' },
            ],
          },
        },
        {
          resource: {
            resourceType: 'Consent',
            status: 'accepted',
            subject: { reference: 'urn:uuid:P-ALT' },
          },
        },
        {
          resource: {
            resourceType: 'Condition',
            patient: { reference: 'Patient/P-ALT' },
            code: {
              coding: [{
                system: 'http://hl7.org/fhir/sid/icd-10',
                code: 'Z99',
                display: 'CID fallback display',
              }],
            },
          },
        },
        {
          resource: {
            resourceType: 'Observation',
            patient: { reference: 'Patient/P-ALT' },
            specimen: { reference: 'Specimen/SPEC-ALT' },
            code: { coding: [{ code: 'BIO-1', display: 'Biomarker display' }] },
            valueString: 'positive',
          },
        },
        {
          resource: {
            resourceType: 'Observation',
            subject: { reference: 'Patient/P-ALT' },
            code: {
              text: 'Phenotype text fallback',
              coding: [{ system: 'http://purl.obolibrary.org/obo/hp.owl', code: 'HP:0000001' }],
            },
          },
        },
        {
          resource: {
            resourceType: 'Specimen',
            identifier: [{ value: 'SPEC-ALT' }],
            subject: { reference: 'Patient/P-ALT' },
            type: { coding: [{ display: 'SERUM' }] },
            collection: { collectedDate: '2026-09-18' },
            accessionIdentifier: { value: 'ACCESSION-ALT' },
            extension: [
              { url: 'urn:bioavanced:matrix', valueCode: 'blood' },
              { url: 'urn:bioavanced:storage-temperature', valueInteger: -80 },
              { url: 'urn:bioavanced:sprecs', valueString: 'BLD-X-X-X-X-X-X' },
              { url: 'urn:bioavanced:rcs-gov-required', valueBoolean: false },
              { url: 'urn:bioavanced:processing-unknown', valueBoolean: true },
            ],
          },
        },
      ],
    }, { userID: 'fhir-operator' });

    expect(result.batch.fileName).toBe('fhir-bundle.json');
    expect(result.batch.createdBy).toBe('fhir-operator');
    expect(result.records).toHaveLength(1);

    const record = result.records[0];
    expect(record.status).toBe(fhirImportStagingService.STATUS.READY_TO_COMMIT);
    expect(record.normalized).toMatchObject({
      participantId: 'P-ALT',
      patientName: 'Ana Maria Silva',
      patientDocument: 'DOC-ALT',
      patientEmail: 'ana@example.org',
      patientPhone: '+5511000000000',
      specimenId: 'SPEC-ALT',
      sampleType: 'SERUM',
      collectionDate: '2026-09-18',
      matrix: 'blood',
      storageTemperature: '-80',
      barcode: 'ACCESSION-ALT',
      consentSigned: true,
    });
    expect(record.normalized.diseases[0]).toMatchObject({
      diseaseName: 'CID fallback display',
      cid10: 'Z99',
    });
    expect(record.normalized.biomarkers[0]).toMatchObject({
      biomarkerType: 'Biomarker display',
      value: 'positive',
      unit: '',
    });
    expect(record.normalized.phenotypes[0]).toMatchObject({
      hpoCode: 'HP:0000001',
      hpoLabel: 'Phenotype text fallback',
    });
    expect(record.normalized.rcsPreview.axis_penalties).toEqual([]);
    expect(record.normalized.rcsPreview.calculation_trace).toEqual({});
  });

  it('revalidates every governed staging status and warning branch without mutating terminal records', async () => {
    const db = createDb();
    const batchId = await seedFhirBatch(db, [
      { _id: 'committed', status: fhirImportStagingService.STATUS.COMMITTED },
      { _id: 'send-failed', status: fhirImportStagingService.STATUS.CONSENT_SEND_FAILED },
      {
        _id: 'needs-review',
        errors: [{ field: 'patientEmail', code: 'NEEDS_EMAIL' }],
        normalized: { consentSigned: false },
      },
      {
        _id: 'error',
        errors: [{ field: 'sampleType', code: 'INVALID' }],
        normalized: { consentSigned: false },
      },
      {
        _id: 'ready',
        errors: [],
        normalized: { consentSigned: true },
      },
      {
        _id: 'pending',
        errors: [],
        normalized: { consentSigned: false },
        consentTracking: { sentAt: new Date('2026-09-18T12:00:00.000Z') },
      },
      {
        _id: 'valid',
        errors: 'not-an-array',
        normalized: { consentSigned: false },
      },
    ]);

    const result = await fhirImportStagingService.validateBatch(db, batchId);
    const byId = Object.fromEntries(result.records.map((record) => [String(record._id), record]));

    expect(byId.committed.status).toBe(fhirImportStagingService.STATUS.COMMITTED);
    expect(byId['send-failed'].status).toBe(fhirImportStagingService.STATUS.CONSENT_SEND_FAILED);
    expect(byId['needs-review'].status).toBe(fhirImportStagingService.STATUS.NEEDS_REVIEW);
    expect(byId['needs-review'].warnings[0].message).toContain('sem e-mail');
    expect(byId.error.status).toBe(fhirImportStagingService.STATUS.ERROR);
    expect(byId.error.warnings).toEqual([]);
    expect(byId.ready.status).toBe(fhirImportStagingService.STATUS.READY_TO_COMMIT);
    expect(byId.pending.status).toBe(fhirImportStagingService.STATUS.PENDING_CONSENT);
    expect(byId.pending.warnings[0].message).toContain('assinado não encontrado');
    expect(byId.valid.status).toBe(fhirImportStagingService.STATUS.VALID);
    expect(byId.valid.warnings[0].message).toContain('ainda não enviado');
  });

  it('covers send-consent skip, validation, missing-email, provider failure/defaults and success metadata fallbacks', async () => {
    const db = createDb();
    const batchId = await seedFhirBatch(db, [
      { _id: 'skip-committed', status: fhirImportStagingService.STATUS.COMMITTED },
      { _id: 'skip-ready', status: fhirImportStagingService.STATUS.READY_TO_COMMIT },
      {
        _id: 'blocked',
        errors: [{ field: 'sampleType', code: 'INVALID' }],
        normalized: { patientEmail: 'blocked@example.org' },
      },
      {
        _id: 'missing-email',
        normalized: { patientEmail: '' },
      },
      {
        _id: 'provider-reason',
        normalized: { participantId: 'P-1', patientName: 'One', patientEmail: 'one@example.org' },
      },
      {
        _id: 'provider-default',
        normalized: { participantId: 'P-2', patientName: 'Two', patientEmail: 'two@example.org' },
      },
      {
        _id: 'success-defaults',
        normalized: { patientName: 'Three', patientEmail: 'three@example.org' },
      },
    ]);

    process.env.FRONTEND_URL = 'https://frontend.example.org/';
    vi.spyOn(notificationService, 'sendConsentEmail')
      .mockResolvedValueOnce({ success: false, reason: 'provider unavailable' })
      .mockResolvedValueOnce({ success: false })
      .mockResolvedValueOnce({ success: true, provider: '', messageId: '' });

    const result = await fhirImportStagingService.sendConsents(db, batchId);
    const byId = Object.fromEntries(result.consentResults.map((item) => [String(item.recordId), item]));

    expect(byId['skip-committed']).toMatchObject({ skipped: true, status: fhirImportStagingService.STATUS.COMMITTED });
    expect(byId['skip-ready']).toMatchObject({ skipped: true, status: fhirImportStagingService.STATUS.READY_TO_COMMIT });
    expect(byId.blocked).toMatchObject({ skipped: true, reason: 'validation_errors' });
    expect(byId['missing-email']).toMatchObject({ sent: false, status: fhirImportStagingService.STATUS.NEEDS_REVIEW });
    expect(byId['provider-reason']).toMatchObject({ sent: false, status: fhirImportStagingService.STATUS.CONSENT_SEND_FAILED, error: 'provider unavailable' });
    expect(byId['provider-default']).toMatchObject({ sent: false, status: fhirImportStagingService.STATUS.CONSENT_SEND_FAILED, error: 'Falha ao enviar TCLE por e-mail.' });
    expect(byId['success-defaults']).toMatchObject({ sent: true, status: fhirImportStagingService.STATUS.PENDING_CONSENT });

    const successRecord = db.collections.import_staging_records.docs.find((record) => record._id === 'success-defaults');
    expect(successRecord.consentTracking.participantId).toBe('');
    expect(successRecord.consentTracking.sentBy).toBeNull();
    expect(successRecord.consentTracking.provider).toBe('resend');
    expect(successRecord.consentTracking.messageId).toBeNull();

    const successfulEmailCall = notificationService.sendConsentEmail.mock.calls[2];
    expect(successfulEmailCall[1]).toContain('https://frontend.example.org/patient/e-consent/import/');
  });

  it('fails closed when CONSENT_SECRET is absent before dispatching a consent email', async () => {
    const db = createDb();
    const batchId = await seedFhirBatch(db, [{
      _id: 'secret-required',
      normalized: { participantId: 'P-1', patientEmail: 'one@example.org' },
    }]);
    delete process.env.CONSENT_SECRET;
    const emailSpy = vi.spyOn(notificationService, 'sendConsentEmail').mockResolvedValue({ success: true });

    await expect(fhirImportStagingService.sendConsents(db, batchId))
      .rejects.toThrow('CONSENT_SECRET é obrigatório');
    expect(emailSpy).not.toHaveBeenCalled();
  });

  it('keeps consent delivery successful when audit persistence fails with a raw rejection', async () => {
    const db = createDb();
    const batchId = await seedFhirBatch(db, [{
      _id: 'audit-failure',
      normalized: { participantId: 'P-1', patientEmail: 'one@example.org' },
    }]);
    vi.spyOn(notificationService, 'sendConsentEmail').mockResolvedValue({ success: true });
    db.collections.audit_logs.insertOne.mockRejectedValue('raw audit failure');
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});

    const result = await fhirImportStagingService.sendConsents(db, batchId);

    expect(result.consentResults[0]).toMatchObject({ sent: true });
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[FHIR_IMPORT][AUDIT]'),
      'raw audit failure'
    );
  });

  it('propagates non-404 batch lookup failures during import-consent token validation', async () => {
    const db = createDb();
    db.collections.import_batches.findOne.mockRejectedValue(
      Object.assign(new Error('batch database failure'), { statusCode: 500 })
    );
    const token = jwt.sign({
      scope: 'fhir-import-consent',
      batchId: 'batch-id',
      recordId: 'record-id',
      participantId: 'P-1',
    }, process.env.CONSENT_SECRET, { expiresIn: '2h' });

    await expect(fhirImportStagingService.validateImportConsentToken(db, token))
      .rejects.toThrow('batch database failure');
  });

  it('returns the locally-updated consent record if the final refresh cannot find it', async () => {
    const db = createDb();
    const batchId = await seedFhirBatch(db, [{
      _id: 'record-refresh-miss',
      normalized: { participantId: 'P-1', consentSigned: false },
      warnings: 'not-an-array',
    }]);
    const record = db.collections.import_staging_records.docs[0];
    db.collections.import_staging_records.findOne
      .mockResolvedValueOnce(record)
      .mockResolvedValueOnce(null);

    const token = jwt.sign({
      scope: 'fhir-import-consent',
      batchId: String(batchId),
      recordId: String(record._id),
      participantId: 'P-1',
    }, process.env.CONSENT_SECRET, { expiresIn: '2h' });

    const result = await fhirImportStagingService.acceptImportConsentToken(db, token);

    expect(result.updated).toBe(true);
    expect(result.record.status).toBe(fhirImportStagingService.STATUS.READY_TO_COMMIT);
    expect(result.record.warnings).toEqual([]);
  });

  it('refuses external documentation while blocking validation errors remain', async () => {
    const db = createDb();
    const batchId = await seedFhirBatch(db, [{
      _id: 'blocked-external-doc',
      errors: [{ field: 'sampleType', code: 'INVALID' }],
      normalized: { participantId: 'P-1', specimenId: 'SPEC-1' },
    }]);

    await expect(fhirImportStagingService.attachExternalDocument(
      db,
      batchId,
      'blocked-external-doc',
      { userID: 'reviewer' }
    )).rejects.toMatchObject({
      statusCode: 400,
      message: expect.stringContaining('erros de validação bloqueantes'),
    });
  });
});
