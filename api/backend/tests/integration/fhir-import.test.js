import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const jwt = require('jsonwebtoken');
const fhirImportStagingService = require('../../src/services/fhir-import-staging.service');
const notificationService = require('../../src/services/NotificationService');
const qualityDomain = require('../../src/services/quality-domain.service');
const fhirImportStagingController = require('../../src/controllers/fhir-import-staging.controller');

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

function createCollection() {
  const docs = [];
  return {
    docs,
    insertOne: vi.fn(async (doc) => {
      const inserted = { _id: doc._id || `id-${docs.length + 1}`, ...doc };
      docs.push(inserted);
      return { insertedId: inserted._id };
    }),
    insertMany: vi.fn(async (items) => {
      items.forEach((doc) => docs.push({ _id: doc._id || `id-${docs.length + 1}`, ...doc }));
      return { insertedCount: items.length };
    }),
    findOne: vi.fn(async (filter = {}) => docs.find((doc) => Object.entries(filter).every(([key, value]) => String(doc[key]) === String(value))) || null),
    find: vi.fn((filter = {}) => createCursor(docs.filter((doc) => Object.entries(filter).every(([key, value]) => String(doc[key]) === String(value))))),
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

function createJsonRes() {
  return {
    statusCode: 200,
    body: null,
    status: vi.fn(function status(code) {
      this.statusCode = code;
      return this;
    }),
    json: vi.fn(function json(payload) {
      this.body = payload;
      return this;
    }),
  };
}

const signedBundle = {
  resourceType: 'Bundle',
  entry: [
    {
      resource: {
        resourceType: 'Patient',
        id: 'P-001',
        name: [{ text: 'Paciente Staging' }],
        identifier: [{ system: 'cpf', value: '13360378652' }],
        birthDate: '1990-01-01',
        gender: 'female',
        telecom: [
          { system: 'email', value: 'paciente@example.org' },
          { system: 'phone', value: '+5511999999999' },
        ],
      },
    },
    {
      resource: {
        resourceType: 'Consent',
        id: 'C-001',
        status: 'active',
        patient: { reference: 'Patient/P-001' },
      },
    },
    {
      resource: {
        resourceType: 'Specimen',
        id: 'S-001',
        subject: { reference: 'Patient/P-001' },
        type: { text: 'PLASMA' },
        receivedTime: '2026-05-18T12:00:00.000Z',
        container: [{ identifier: [{ value: 'BARCODE-001' }] }],
        extension: [
          { url: 'urn:bioavanced:matrix', valueString: 'Plasma' },
          { url: 'urn:bioavanced:storage-temperature', valueString: '-20C' },
          { url: 'urn:bioavanced:sprecs-raw', valueString: 'BLD-SST-A-A-A-A-C' },
          { url: 'urn:bioavanced:rcs-gov-required', valueBoolean: true },
        ],
      },
    },
    {
      resource: {
        resourceType: 'Condition',
        subject: { reference: 'Patient/P-001' },
        code: {
          text: 'Doença rara teste',
          coding: [
            { system: 'http://hl7.org/fhir/sid/icd-10', code: 'E75.2', display: 'Doença rara teste' },
            { system: 'http://www.orpha.net', code: 'ORPHA:123', display: 'Doença rara teste' },
            { system: 'https://omim.org/entry', code: '123456', display: 'Doença rara teste' },
          ],
        },
      },
    },
    {
      resource: {
        resourceType: 'Observation',
        status: 'final',
        subject: { reference: 'Patient/P-001' },
        specimen: { reference: 'Specimen/S-001' },
        code: { text: 'Biomarcador teste' },
        valueQuantity: { value: 12.5, unit: 'ng/mL' },
      },
    },
    {
      resource: {
        resourceType: 'Observation',
        status: 'final',
        subject: { reference: 'Patient/P-001' },
        code: {
          coding: [{ system: 'http://purl.obolibrary.org/obo/hp.owl', code: 'HP:0001250', display: 'Seizure' }],
        },
      },
    },
    {
      resource: {
        resourceType: 'Specimen',
        id: 'S-ERR',
        subject: { reference: 'Patient/P-MISSING' },
      },
    },
  ],
};

describe('FHIR import staging', () => {
  let db;

  beforeEach(() => {
    vi.restoreAllMocks();
    db = createDb();
    process.env.CONSENT_SECRET = 'test-consent-secret';
    vi.spyOn(notificationService, 'sendConsentEmail').mockResolvedValue({
      success: true,
      provider: 'resend',
      messageId: 'email-001',
    });
  });

  it('cria lote temporário sem gravar pacientes/amostras definitivos', async () => {
    const result = await fhirImportStagingService.stageBundle(db, signedBundle, { fileName: 'bundle.json' });

    expect(result.batch._id).toBeTruthy();
    expect(db.collections.import_batches.insertOne).toHaveBeenCalledTimes(1);
    expect(db.collections.import_staging_records.insertMany).toHaveBeenCalledTimes(1);
    expect(db.collections.patients.insertOne).not.toHaveBeenCalled();
    expect(db.collections.samples.insertOne).not.toHaveBeenCalled();
    expect(db.collections.patients.updateOne).not.toHaveBeenCalled();
    expect(db.collections.samples.updateOne).not.toHaveBeenCalled();
    expect(result.records.map((record) => record.status)).toEqual(['READY_TO_COMMIT', 'ERROR']);
    expect(result.records[1].validationErrors.some((error) => error.field === 'patient')).toBe(true);
    expect(result.records[1].validationErrors.some((error) => error.field === 'patientName')).toBe(true);
  });

  it('aceita Bundle mínimo com Patient + Specimen e cria batch/staging sem persistir definitivo', async () => {
    const minimalBundle = {
      resourceType: 'Bundle',
      entry: [
        {
          resource: {
            resourceType: 'Patient',
            id: 'P-MIN',
            name: [{ text: 'Paciente Mínimo' }],
            identifier: [{ value: 'DOC-MIN' }],
            telecom: [{ system: 'email', value: 'minimo@example.org' }],
          },
        },
        {
          resource: {
            resourceType: 'Specimen',
            id: 'S-MIN',
            subject: { reference: 'Patient/P-MIN' },
            type: { text: 'SANGUE' },
          },
        },
      ],
    };

    const result = await fhirImportStagingService.stageBundle(db, minimalBundle, { fileName: 'minimal.json' });

    expect(result.batch.type).toBe('FHIR_BUNDLE');
    expect(result.records).toHaveLength(1);
    expect(result.records[0]).toMatchObject({
      status: 'VALID',
      normalized: {
        patientID: 'P-MIN',
        sampleID: 'S-MIN',
      },
    });
    expect(db.collections.import_batches.docs).toHaveLength(1);
    expect(db.collections.import_staging_records.docs).toHaveLength(1);
    expect(db.collections.patients.docs).toHaveLength(0);
    expect(db.collections.samples.docs).toHaveLength(0);
  });

  it('mapeia Patient, Specimen, Condition, Observation e Consent para staging', async () => {
    const result = await fhirImportStagingService.stageBundle(db, signedBundle, { fileName: 'bundle.json' });
    const record = result.records[0];

    expect(record.normalized).toMatchObject({
      patientName: 'Paciente Staging',
      patientDocument: '13360378652',
      patientBirthDate: '1990-01-01',
      patientSex: 'female',
      patientEmail: 'paciente@example.org',
      patientPhone: '+5511999999999',
      sampleID: 'S-001',
      sampleType: 'PLASMA',
      matrix: 'Plasma',
      storageTemperature: '-20C',
      sprecsRaw: 'BLD-SST-A-A-A-A-C',
      barcode: 'BARCODE-001',
      consentSigned: true,
    });
    expect(record.normalized.rcsPreview).toMatchObject({
      model_version: 'RCS-GOV-1.0',
      final_grade: 'A',
      governance_status: 1,
    });
    expect(record.normalized.rcsPreview.axis_penalties.length).toBeGreaterThan(0);
    expect(record.normalized.rcsPreview.calculation_trace.axes.length).toBeGreaterThan(0);
    expect(record.normalized.diseases[0]).toMatchObject({
      diseaseName: 'Doença rara teste',
      cid10: 'E75.2',
      orphaCode: 'ORPHA:123',
      omimCode: '123456',
    });
    expect(record.normalized.biomarkers[0]).toMatchObject({
      biomarkerType: 'Biomarcador teste',
      value: 12.5,
      unit: 'ng/mL',
    });
    expect(record.normalized.phenotypes[0]).toMatchObject({
      hpoCode: 'HP:0001250',
      hpoLabel: 'Seizure',
    });
  });

  it('rejeita JSON solto que não seja Bundle FHIR', async () => {
    await expect(
      fhirImportStagingService.stageBundle(db, { resourceType: 'Patient', id: 'P-001' }, { fileName: 'patient.json' })
    ).rejects.toMatchObject({
      statusCode: 400,
      message: 'A importação em lote exige um FHIR R4 Bundle JSON.',
    });
  });

  it('rejeita array solto fora de Bundle FHIR', async () => {
    await expect(
      fhirImportStagingService.stageBundle(db, [{ resourceType: 'Patient', id: 'P-001' }], { fileName: 'array.json' })
    ).rejects.toMatchObject({
      statusCode: 400,
      message: 'A importação em lote exige um FHIR R4 Bundle JSON.',
    });
  });

  it('rejeita Bundle sem entry em array com erro 400 controlado', async () => {
    await expect(
      fhirImportStagingService.stageBundle(db, { resourceType: 'Bundle', entry: {} }, { fileName: 'bundle.json' })
    ).rejects.toMatchObject({
      statusCode: 400,
      message: 'A importação em lote exige um FHIR R4 Bundle JSON com entry em array.',
    });
  });

  it('marca erros por campo quando amostra não tem vínculo, e-mail para TCLE ou campos RCS-GOV exigidos', async () => {
    const bundle = {
      resourceType: 'Bundle',
      entry: [
        {
          resource: {
            resourceType: 'Patient',
            id: 'P-002',
            name: [{ text: 'Paciente Sem Email' }],
            identifier: [{ value: 'DOC-2' }],
          },
        },
        {
          resource: {
            resourceType: 'Specimen',
            id: 'S-002',
            subject: { reference: 'Patient/P-002' },
            type: { text: 'SANGUE' },
            extension: [{ url: 'urn:bioavanced:rcs-gov-required', valueBoolean: true }],
          },
        },
        {
          resource: {
            resourceType: 'Specimen',
            id: 'S-003',
            type: { text: 'SALIVA' },
          },
        },
      ],
    };

    const result = await fhirImportStagingService.stageBundle(db, bundle, { fileName: 'bundle.json' });
    const errorsBySample = Object.fromEntries(
      result.records.map((record) => [record.normalized.sampleID, record.validationErrors.map((error) => error.field)])
    );

    expect(errorsBySample['S-002']).toEqual(expect.arrayContaining(['patientEmail', 'collectionDate', 'matrix', 'sprecsRaw']));
    expect(errorsBySample['S-003']).toEqual(expect.arrayContaining(['patientID', 'patient']));
  });

  it('calcula preview RCS-GOV no staging e não trata processamento desconhecido como severidade zero', async () => {
    const bundle = {
      resourceType: 'Bundle',
      entry: [
        {
          resource: {
            resourceType: 'Patient',
            id: 'P-RCS',
            name: [{ text: 'Paciente RCS' }],
            identifier: [{ value: 'DOC-RCS' }],
            telecom: [{ system: 'email', value: 'rcs@example.org' }],
          },
        },
        {
          resource: {
            resourceType: 'Specimen',
            id: 'S-RCS',
            subject: { reference: 'Patient/P-RCS' },
            type: { text: 'PLASMA' },
            extension: [
              { url: 'urn:bioavanced:matrix', valueString: 'Plasma' },
              { url: 'urn:bioavanced:processing-unknown', valueBoolean: true },
              { url: 'urn:bioavanced:rcs-gov-required', valueBoolean: true },
            ],
          },
        },
      ],
    };

    const result = await fhirImportStagingService.stageBundle(db, bundle, { fileName: 'bundle.json' });
    const preview = result.records[0].normalized.rcsPreview;

    expect(preview.model_version).toBe('RCS-GOV-1.0');
    expect(preview.final_grade).toBe('E');
    expect(preview.governance_status).toBe(0);
    expect(preview.governance_failure_reasons).toContain('Unknown SPREC code');
    expect(preview.axis_penalties).toEqual([]);
    expect(preview.calculation_trace.governance_trace).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ severity_value: 0 })])
    );
  });

  it('chama motor RCS-GOV durante staging', async () => {
    const spy = vi.spyOn(qualityDomain, 'resolveMethodologicalQuality');

    await fhirImportStagingService.stageBundle(db, signedBundle, { fileName: 'bundle.json' });

    expect(spy).toHaveBeenCalled();
    expect(db.collections.import_staging_records.docs[0].normalized.rcsPreview.final_grade).toBe('A');
  });

  it('controller retorna 400 controlado, nunca 500, para erro de validação', async () => {
    const req = {
      app: { locals: { db } },
      body: { resourceType: 'Patient', id: 'P-INVALID' },
      user: { id: 'admin' },
    };
    const res = createJsonRes();

    await fhirImportStagingController.stage(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({
      success: false,
      message: 'A importação em lote exige um FHIR R4 Bundle JSON.',
    });
  });

  it('envia TCLE por e-mail e mantém commit bloqueado enquanto assinatura estiver pendente', async () => {
    const bundle = {
      resourceType: 'Bundle',
      entry: [
        {
          resource: {
            resourceType: 'Patient',
            id: 'P-EMAIL',
            name: [{ text: 'Paciente Email' }],
            identifier: [{ value: 'DOC-EMAIL' }],
            telecom: [{ system: 'email', value: 'paciente@example.org' }],
          },
        },
        {
          resource: {
            resourceType: 'Specimen',
            id: 'S-EMAIL',
            subject: { reference: 'Patient/P-EMAIL' },
            type: { text: 'SANGUE' },
          },
        },
      ],
    };

    const staged = await fhirImportStagingService.stageBundle(db, bundle, { fileName: 'bundle.json' });
    expect(staged.records[0].status).toBe('VALID');

    const sent = await fhirImportStagingService.sendConsents(db, staged.batch._id, { userID: 'admin' });
    expect(notificationService.sendConsentEmail).toHaveBeenCalledTimes(1);
    expect(notificationService.sendConsentEmail.mock.calls[0][1]).toContain('/patient/e-consent/import/');
    const sentUrl = notificationService.sendConsentEmail.mock.calls[0][1];
    const sentToken = sentUrl.split('/patient/e-consent/import/')[1];
    const decoded = jwt.verify(decodeURIComponent(sentToken), process.env.CONSENT_SECRET);
    expect(decoded).toMatchObject({
      scope: 'fhir-import-consent',
      batchId: String(staged.batch._id),
      recordId: String(db.collections.import_staging_records.docs[0]._id),
      patientId: 'P-EMAIL',
    });
    expect(sent.records[0].status).toBe('PENDING_CONSENT');
    expect(sent.records[0].consentTracking.provider).toBe('resend');
    expect(db.collections.audit_logs.docs.some((doc) => doc.action === 'FHIR_IMPORT_CONSENT_SENT')).toBe(true);

    const commitWhilePending = await fhirImportStagingService.commitBatch(db, staged.batch._id);
    expect(commitWhilePending.committed).toBe(0);
    expect(db.collections.patients.updateOne).not.toHaveBeenCalled();
    expect(db.collections.samples.updateOne).not.toHaveBeenCalled();
  });

  it('rejeita token inválido ou expirado e impede uso de token canônico no staging', async () => {
    const bundle = {
      resourceType: 'Bundle',
      entry: [
        {
          resource: {
            resourceType: 'Patient',
            id: 'P-STAGING',
            name: [{ text: 'Paciente Staging' }],
            identifier: [{ value: 'DOC-STAGING' }],
            telecom: [{ system: 'email', value: 'staging@example.org' }],
          },
        },
        {
          resource: {
            resourceType: 'Specimen',
            id: 'S-STAGING',
            subject: { reference: 'Patient/P-STAGING' },
            type: { text: 'SANGUE' },
          },
        },
      ],
    };

    const staged = await fhirImportStagingService.stageBundle(db, bundle, { fileName: 'bundle.json' });
    const consentResult = await fhirImportStagingService.sendConsents(db, staged.batch._id, { userID: 'admin' });
    const goodToken = consentResult.records[0].consentTracking.token;

    await expect(fhirImportStagingService.validateImportConsentToken(db, 'token-invalido')).rejects.toMatchObject({ statusCode: 401 });

    const expiredToken = jwt.sign(
      {
        scope: 'fhir-import-consent',
        batchId: String(staged.batch._id),
        recordId: String(db.collections.import_staging_records.docs[0]._id),
        patientId: 'P-STAGING',
      },
      process.env.CONSENT_SECRET,
      { expiresIn: '-1s' }
    );
    await expect(fhirImportStagingService.validateImportConsentToken(db, expiredToken)).rejects.toMatchObject({ statusCode: 401 });

    const canonicalToken = jwt.sign(
      {
        scope: 'fhir-consent',
        batchId: String(staged.batch._id),
        recordId: String(db.collections.import_staging_records.docs[0]._id),
        patientId: 'P-STAGING',
      },
      process.env.CONSENT_SECRET,
      { expiresIn: '2h' }
    );
    await expect(fhirImportStagingService.validateImportConsentToken(db, canonicalToken)).rejects.toMatchObject({ statusCode: 401 });
    await expect(fhirImportStagingService.acceptImportConsentToken(db, goodToken)).resolves.toMatchObject({ updated: true });
  });

  it('aceita consentimento apenas no staging, não grava pacientes/amostras definitivos antes do commit e mantém idempotência', async () => {
    const bundle = {
      resourceType: 'Bundle',
      entry: [
        {
          resource: {
            resourceType: 'Patient',
            id: 'P-READY',
            name: [{ text: 'Paciente Ready' }],
            identifier: [{ value: 'DOC-READY' }],
            telecom: [{ system: 'email', value: 'ready@example.org' }],
          },
        },
        {
          resource: {
            resourceType: 'Specimen',
            id: 'S-READY',
            subject: { reference: 'Patient/P-READY' },
            type: { text: 'PLASMA' },
          },
        },
      ],
    };

    const staged = await fhirImportStagingService.stageBundle(db, bundle, { fileName: 'bundle.json' });
    const consentResult = await fhirImportStagingService.sendConsents(db, staged.batch._id, { userID: 'admin' });
    const token = consentResult.records[0].consentTracking.token;

    const accepted = await fhirImportStagingService.acceptImportConsentToken(db, token);
    expect(accepted.record.status).toBe('READY_TO_COMMIT');
    expect(accepted.record.normalized.consentSigned).toBe(true);
    expect(accepted.record.consentTracking.signedAt).toBeTruthy();
    expect(accepted.record.quarantineStatus).toBe('RELEASED');
    expect(accepted.record.quarantineReason).toBeNull();
    expect(accepted.record.availabilityStatus).toBe('AVAILABLE');
    expect(accepted.record.warnings.some((warning) => warning.field === 'consent')).toBe(false);
    expect(db.collections.patients.docs).toHaveLength(0);
    expect(db.collections.samples.docs).toHaveLength(0);

    const acceptedAgain = await fhirImportStagingService.acceptImportConsentToken(db, token);
    expect(acceptedAgain.updated).toBe(false);
    expect(db.collections.import_staging_records.docs[0].status).toBe('READY_TO_COMMIT');
  });

  it('libera commit somente após TCLE assinado no staging', async () => {
    const bundle = {
      resourceType: 'Bundle',
      entry: [
        {
          resource: {
            resourceType: 'Patient',
            id: 'P-SIGNED-LATER',
            name: [{ text: 'Paciente Assinatura' }],
            identifier: [{ value: 'DOC-SIGNED' }],
            telecom: [{ system: 'email', value: 'assinatura@example.org' }],
          },
        },
        {
          resource: {
            resourceType: 'Specimen',
            id: 'S-SIGNED-LATER',
            subject: { reference: 'Patient/P-SIGNED-LATER' },
            type: { text: 'PLASMA' },
          },
        },
      ],
    };

    const staged = await fhirImportStagingService.stageBundle(db, bundle, { fileName: 'bundle.json' });
    await fhirImportStagingService.sendConsents(db, staged.batch._id, { userID: 'admin' });
    const record = db.collections.import_staging_records.docs[0];
    record.normalized.consentSigned = true;
    record.consentTracking.signedAt = new Date();

    const committed = await fhirImportStagingService.commitBatch(db, staged.batch._id);
    expect(committed.committed).toBe(1);
    expect(db.collections.samples.docs[0].sampleID).toBe('S-SIGNED-LATER');
    expect(db.collections.audit_logs.docs.some((doc) => doc.action === 'FHIR_IMPORT_RECORD_COMMITTED')).toBe(true);
  });

  it('falha de e-mail não quebra o lote inteiro', async () => {
    notificationService.sendConsentEmail
      .mockRejectedValueOnce(new Error('Resend indisponível'))
      .mockResolvedValueOnce({ success: true, provider: 'resend', messageId: 'email-002' });

    const bundle = {
      resourceType: 'Bundle',
      entry: [
        {
          resource: {
            resourceType: 'Patient',
            id: 'P-FAIL',
            name: [{ text: 'Paciente Falha' }],
            identifier: [{ value: 'DOC-FAIL' }],
            telecom: [{ system: 'email', value: 'falha@example.org' }],
          },
        },
        {
          resource: {
            resourceType: 'Patient',
            id: 'P-OK',
            name: [{ text: 'Paciente Ok' }],
            identifier: [{ value: 'DOC-OK' }],
            telecom: [{ system: 'email', value: 'ok@example.org' }],
          },
        },
        { resource: { resourceType: 'Specimen', id: 'S-FAIL', subject: { reference: 'Patient/P-FAIL' }, type: { text: 'SANGUE' } } },
        { resource: { resourceType: 'Specimen', id: 'S-OK', subject: { reference: 'Patient/P-OK' }, type: { text: 'SANGUE' } } },
      ],
    };

    const staged = await fhirImportStagingService.stageBundle(db, bundle, { fileName: 'bundle.json' });
    const result = await fhirImportStagingService.sendConsents(db, staged.batch._id, { userID: 'admin' });

    expect(result.records.map((record) => record.status)).toEqual(['CONSENT_SEND_FAILED', 'PENDING_CONSENT']);
  });

  it('commit salva somente registros READY_TO_COMMIT', async () => {
    const staged = await fhirImportStagingService.stageBundle(db, signedBundle, { fileName: 'bundle.json' });
    const result = await fhirImportStagingService.commitBatch(db, staged.batch._id);

    expect(result.committed).toBe(1);
    expect(db.collections.patients.updateOne).toHaveBeenCalledTimes(1);
    expect(db.collections.samples.updateOne).toHaveBeenCalledTimes(1);
    expect(db.collections.samples.updateOne.mock.calls[0][0]).toEqual({ sampleID: 'S-001' });
    expect(db.collections.samples.docs).toHaveLength(1);
    expect(db.collections.samples.docs[0].sampleID).toBe('S-001');
    expect(db.collections.samples.docs[0].final_grade).toBe('A');
    expect(db.collections.samples.docs[0].axis_penalties.length).toBeGreaterThan(0);
    expect(db.collections.samples.docs[0].calculation_trace.axes.length).toBeGreaterThan(0);
  });
});
