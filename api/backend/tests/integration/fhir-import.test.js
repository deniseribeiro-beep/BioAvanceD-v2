import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const jwt = require('jsonwebtoken');
const { ObjectId } = require('mongodb');
const fhirImportStagingService = require('../../src/services/fhir-import-staging.service');
// #1191: staged records are sealed at rest; a test that reads or edits one
// directly goes through the same reveal/seal the service uses.
const { sealStagedRecord, revealStagedRecord } = require('../../src/utils/stagedRowCrypto');
const FHIR_STAGING_SEALED_FIELDS = ['row', 'normalized', 'fhir', 'consentTracking'];
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
      // Mirrors the real MongoDB driver: insertOne mutates the passed-in
      // document in place to add the generated _id, rather than returning a
      // detached copy — product code across this repo (e.g. rcs-assessment
      // .service.js#recordAssessment) relies on reading `doc._id` straight
      // off the object it passed in immediately after this call.
      if (!doc._id) doc._id = `id-${docs.length + 1}`;
      docs.push(doc);
      return { insertedId: doc._id };
    }),
    insertMany: vi.fn(async (items) => {
      items.forEach((doc) => docs.push({ _id: doc._id || `id-${docs.length + 1}`, ...doc }));
      return { insertedCount: items.length };
    }),
    findOne: vi.fn(async (filter = {}) => docs.find((doc) => Object.entries(filter).every(([key, value]) => String(doc[key]) === String(value))) || null),
    find: vi.fn((filter = {}) => createCursor(docs.filter((doc) => Object.entries(filter).every(([key, value]) => String(doc[key]) === String(value))))),
    updateOne: vi.fn(async (filter = {}, update = {}, options = {}) => {
      let doc = docs.find((item) => Object.entries(filter).every(([key, value]) => String(item[key]) === String(value)));
      const isUpsertedInsert = !doc && options.upsert;
      if (isUpsertedInsert) {
        doc = { _id: `id-${docs.length + 1}`, ...filter };
        docs.push(doc);
      }
      if (!doc) return { matchedCount: 0, modifiedCount: 0 };
      Object.assign(doc, isUpsertedInsert ? (update.$setOnInsert || {}) : {}, update.$set || {});
      return isUpsertedInsert
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

  // #1191: normalized carries patientName/patientDocument/patientBirthDate/
  // patientEmail and fhir carries the whole Patient resource, so the staged
  // record is sealed at rest like the LGPD quarantine (#807). The service's
  // own result is read back through the same reveal every reader uses.
  it('#1191: stores no civil identity in plaintext, and hands it back revealed', async () => {
    const result = await fhirImportStagingService.stageBundle(db, signedBundle, { fileName: 'bundle.json' });

    const atRest = JSON.stringify(db.collections.import_staging_records.docs);
    expect(atRest).not.toContain('Paciente Staging');
    expect(atRest).not.toContain('13360378652');
    expect(atRest).not.toContain('paciente@example.org');
    expect(atRest).not.toContain('1990-01-01');
    expect(db.collections.import_staging_records.docs[0].sealedPayload).toBeTruthy();

    expect(result.records[0].normalized.patientName).toBe('Paciente Staging');
    expect(result.records[0].normalized.patientEmail).toBe('paciente@example.org');
    expect(result.records[0].fhir.patient.id).toBe('P-001');
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
        participantId: 'P-MIN',
        specimenId: 'S-MIN',
      },
    });
    expect(db.collections.import_batches.docs).toHaveLength(1);
    expect(db.collections.import_staging_records.docs).toHaveLength(1);
    expect(db.collections.patients.docs).toHaveLength(0);
    expect(db.collections.samples.docs).toHaveLength(0);
  });

  // RF011 AC6, RNF024 C6 (#1322): staging records its round-trip loss.
  it('registra roundTripLoss no registro e no batch: campos não mapeados e recursos não anexados', async () => {
    const bundle = {
      resourceType: 'Bundle',
      entry: [
        {
          resource: {
            resourceType: 'Patient',
            id: 'P-RT',
            name: [{ text: 'Paciente Round Trip' }],
            identifier: [{ value: 'DOC-RT' }],
            telecom: [{ system: 'email', value: 'rt@example.org' }],
          },
        },
        { resource: { resourceType: 'Organization', name: 'Biobanco RT' } },
        {
          resource: {
            resourceType: 'Specimen',
            id: 'S-RT',
            subject: { reference: 'Patient/P-RT' },
            type: { text: 'SANGUE' },
            collection: { quantity: { value: 5, unit: 'mL' } },
          },
        },
      ],
    };

    const result = await fhirImportStagingService.stageBundle(db, bundle, { fileName: 'round-trip.json' });

    const expectedRecordLoss = {
      unmappedCount: 2,
      unmapped: [
        { source: 'specimen', path: 'Specimen.collection.quantity.unit' },
        { source: 'specimen', path: 'Specimen.collection.quantity.value' },
      ],
      truncated: false,
    };
    const expectedBatchLoss = {
      unattachedResourceCount: 1,
      unattached: [{ resourceIndex: 1, resourceType: 'Organization' }],
    };
    expect(db.collections.import_staging_records.docs[0].roundTripLoss).toMatchObject(expectedRecordLoss);
    expect(db.collections.import_staging_records.docs[0].roundTripLoss.limitations.length).toBeGreaterThan(0);
    expect(db.collections.import_batches.docs[0].roundTripLoss).toEqual(expectedBatchLoss);
    expect(result.batch.roundTripLoss).toEqual(expectedBatchLoss);
    expect(result.records[0].roundTripLoss).toMatchObject(expectedRecordLoss);
  });

  // RF011 AC4 (#1322): a Provenance and a ResearchStudy are mapped on the
  // batch as field names and paths only, and are not unattached.
  it('registra mappedResources no batch para Provenance e ResearchStudy, sem valores, e não os lista como não anexados', async () => {
    const bundle = {
      resourceType: 'Bundle',
      entry: [
        {
          resource: {
            resourceType: 'Patient',
            id: 'P-RT',
            name: [{ text: 'Paciente Round Trip' }],
            identifier: [{ value: 'DOC-RT' }],
            telecom: [{ system: 'email', value: 'rt@example.org' }],
          },
        },
        { resource: { resourceType: 'Organization', name: 'Biobanco RT' } },
        {
          resource: {
            resourceType: 'Specimen',
            id: 'S-RT',
            subject: { reference: 'Patient/P-RT' },
            type: { text: 'SANGUE' },
            collection: { quantity: { value: 5, unit: 'mL' } },
          },
        },
        {
          resource: {
            resourceType: 'Provenance',
            id: 'WR-PROVENIENCIA-RT',
            target: [{ reference: 'DocumentReference/F-RT' }],
            recorded: '2026-10-01T09:00:00.000Z',
          },
        },
        {
          resource: {
            resourceType: 'ResearchStudy',
            id: 'ST-RT',
            title: 'Estudo Titulo Distintivo RT',
            status: 'active',
          },
        },
      ],
    };

    const result = await fhirImportStagingService.stageBundle(db, bundle, { fileName: 'mapped.json' });

    expect(result.batch.roundTripLoss).toEqual({
      unattachedResourceCount: 1,
      unattached: [{ resourceIndex: 1, resourceType: 'Organization' }],
    });
    expect(result.batch.mappedResources).toMatchObject({
      mappedResourceCount: 2,
      truncated: false,
      mappedResources: [
        { resourceIndex: 3, resourceType: 'Provenance', mappingId: 'MAP-V2-008', canonicalEntity: 'WorkflowRun', canonicalFields: ['createdAt', 'outputFileIds', 'workflowRunId'], unmappedCount: 0 },
        { resourceIndex: 4, resourceType: 'ResearchStudy', mappingId: 'MAP-V2-009', canonicalEntity: 'Study', canonicalFields: ['studyId', 'studyStatus', 'studyTitle'], unmappedCount: 0 },
      ],
    });
    const serialized = JSON.stringify(result.batch.mappedResources);
    expect(serialized).not.toContain('Estudo Titulo Distintivo RT');
    expect(serialized).not.toContain('WR-PROVENIENCIA-RT');
    const stored = db.collections.import_batches.docs[0];
    expect(stored.mappedResources).toEqual(result.batch.mappedResources);
    expect(stored.roundTripLoss).toEqual(result.batch.roundTripLoss);
    // A ResearchStudy with no relatedArtifact has no ethicsApprovalId, so no
    // Study candidate.
    expect(stored.studyCandidates).toEqual([]);
    expect(result.records).toHaveLength(1);
    expect(db.collections.import_staging_records.docs).toHaveLength(1);
    expect(result.batch.counts.total).toBe(1);
  });

  // #1322: a large Bundle stores a bounded roundTripLoss on each staged record.
  it('limita roundTripLoss a 50 caminhos por registro num Bundle com 2000 Observations', async () => {
    const observations = Array.from({ length: 2000 }, (_, i) => ({
      resource: {
        resourceType: 'Observation',
        subject: { reference: 'Patient/P-BIG' },
        category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/observation-category', code: 'laboratory' }] }],
        code: { coding: [{ system: 'http://loinc.org', code: `LAB-${i}`, display: 'Exame' }] },
        valueQuantity: { value: i, unit: 'mg/dL', system: 'http://unitsofmeasure.org' },
      },
    }));
    const bundle = {
      resourceType: 'Bundle',
      entry: [
        {
          resource: {
            resourceType: 'Patient',
            id: 'P-BIG',
            name: [{ text: 'Paciente Grande' }],
            identifier: [{ value: 'DOC-BIG' }],
            telecom: [{ system: 'email', value: 'grande@example.org' }],
          },
        },
        { resource: { resourceType: 'Specimen', id: 'S-BIG-1', subject: { reference: 'Patient/P-BIG' }, type: { text: 'SANGUE' } } },
        { resource: { resourceType: 'Specimen', id: 'S-BIG-2', subject: { reference: 'Patient/P-BIG' }, type: { text: 'SANGUE' } } },
        ...observations,
      ],
    };

    await fhirImportStagingService.stageBundle(db, bundle, { fileName: 'big.json' });

    const staged = db.collections.import_staging_records.docs;
    expect(staged).toHaveLength(2);
    staged.forEach((doc) => {
      // Per Observation: category coding system and code, code.coding[0].system, valueQuantity.system.
      expect(doc.roundTripLoss.unmappedCount).toBe(8000);
      expect(doc.roundTripLoss.unmapped.length).toBeLessThanOrEqual(50);
      expect(doc.roundTripLoss.truncated).toBe(true);
      // The sealed fhir payload of 2000 Observations is itself about 1 MB per
      // record; what roundTripLoss adds stays small.
      expect(Buffer.byteLength(JSON.stringify(doc.roundTripLoss))).toBeLessThan(16 * 1024);
    });
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
      specimenId: 'S-001',
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
      result.records.map((record) => [record.normalized.specimenId, record.validationErrors.map((error) => error.field)])
    );

    expect(errorsBySample['S-002']).toEqual(expect.arrayContaining(['patientEmail', 'collectionDate', 'matrix', 'sprecsRaw']));
    expect(errorsBySample['S-003']).toEqual(expect.arrayContaining(['participantId', 'patient']));
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
    expect(revealStagedRecord(db.collections.import_staging_records.docs[0]).normalized.rcsPreview.final_grade).toBe('A');
  });

  it('controller retorna 400 controlado, nunca 500, para erro de validação', async () => {
    const req = {
      app: { locals: { db } },
      body: { resourceType: 'Patient', id: 'P-INVALID' },
      user: { id: 'admin' },
      // #1385: what requireOrganizationScope sets for a global caller.
      organizationScope: { scope: 'global', organizationIds: [] },
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
      participantId: 'P-EMAIL',
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
        participantId: 'P-STAGING',
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
        participantId: 'P-STAGING',
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
    const stored = db.collections.import_staging_records.docs[0];
    const record = revealStagedRecord(stored);
    record.normalized.consentSigned = true;
    record.consentTracking.signedAt = new Date();
    Object.assign(stored, sealStagedRecord(record, { fields: FHIR_STAGING_SEALED_FIELDS }));

    const committed = await fhirImportStagingService.commitBatch(db, staged.batch._id);
    expect(committed.committed).toBe(1);
    expect(db.collections.samples.docs[0].specimenId).toBe('S-SIGNED-LATER');
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
    // #526: 1 upsert + 2 sealed-id pins (RcsAssessment, SpecimenPreanalytics).
    expect(db.collections.samples.updateOne).toHaveBeenCalledTimes(3);
    expect(db.collections.samples.updateOne.mock.calls[0][0]).toEqual({ specimenId: 'S-001' });
    expect(db.collections.samples.docs).toHaveLength(1);
    expect(db.collections.samples.docs[0].specimenId).toBe('S-001');
    expect(db.collections.samples.docs[0].final_grade).toBe('A');
    expect(db.collections.samples.docs[0].axis_penalties.length).toBeGreaterThan(0);
    expect(db.collections.samples.docs[0].calculation_trace.axes.length).toBeGreaterThan(0);
  });

  describe('ResearchStudy commit (RF011 AC4, #1322)', () => {
    const researchStudy = {
      resourceType: 'ResearchStudy',
      id: 'ST-FHIR-1',
      title: 'Estudo Importado',
      status: 'active',
      description: 'objetivo não guardado',
      relatedArtifact: [{ type: 'documentation', label: 'CEP-1' }],
    };
    const bundleWithStudy = { ...signedBundle, entry: [...signedBundle.entry, { resource: researchStudy }] };

    it('creates the Study with its four fields and audits it, for a caller who can create one', async () => {
      const staged = await fhirImportStagingService.stageBundle(db, bundleWithStudy, { fileName: 'bundle.json' });
      const result = await fhirImportStagingService.commitBatch(db, staged.batch._id, { canCreateStudy: true });

      expect(result.committed).toBe(1);
      expect(result.studies).toEqual({ created: 1, existing: 0, notCreatedReason: null });
      expect(db.collections.studies.docs).toHaveLength(1);
      expect(db.collections.studies.docs[0]).toMatchObject({
        studyId: 'ST-FHIR-1',
        studyTitle: 'Estudo Importado',
        studyStatus: 'active',
        ethicsApprovalId: ['CEP-1'],
      });
      expect(db.collections.studies.docs[0]).not.toHaveProperty('studyObjective');
      expect(db.collections.studies.docs[0]).not.toHaveProperty('resourceIndex');
      expect(db.collections.audit_logs.docs.filter((doc) => doc.action === 'FHIR_IMPORT_STUDY_COMMITTED')).toEqual([
        expect.objectContaining({ batchId: staged.batch._id, studyId: 'ST-FHIR-1' }),
      ]);
    });

    it('a second commit of the batch counts the Study as existing and creates no other', async () => {
      const staged = await fhirImportStagingService.stageBundle(db, bundleWithStudy, { fileName: 'bundle.json' });
      await fhirImportStagingService.commitBatch(db, staged.batch._id, { canCreateStudy: true });
      const again = await fhirImportStagingService.commitBatch(db, staged.batch._id, { canCreateStudy: true });

      expect(again.studies).toEqual({ created: 0, existing: 1, notCreatedReason: null });
      expect(db.collections.studies.docs).toHaveLength(1);
    });

    it('never changes an existing Study with the same studyId', async () => {
      db.collection('studies').docs.push({ _id: 'st-existing', studyId: 'ST-FHIR-1', studyTitle: 'Título Original', studyStatus: 'active', ethicsApprovalId: ['CEP-0'] });
      const staged = await fhirImportStagingService.stageBundle(db, bundleWithStudy, { fileName: 'bundle.json' });
      const result = await fhirImportStagingService.commitBatch(db, staged.batch._id, { canCreateStudy: true });

      expect(result.studies).toEqual({ created: 0, existing: 1, notCreatedReason: null });
      expect(db.collections.studies.docs).toHaveLength(1);
      expect(db.collections.studies.docs[0]).toMatchObject({ studyTitle: 'Título Original', ethicsApprovalId: ['CEP-0'] });
    });

    it('without canCreateStudy creates no Study, reports ROLE and still commits the record', async () => {
      const staged = await fhirImportStagingService.stageBundle(db, bundleWithStudy, { fileName: 'bundle.json' });
      const result = await fhirImportStagingService.commitBatch(db, staged.batch._id);

      expect(result.committed).toBe(1);
      expect(result.studies).toEqual({ created: 0, existing: 0, notCreatedReason: 'ROLE' });
      expect(db.collections.studies?.docs ?? []).toHaveLength(0);
      expect(db.collections.samples.docs).toHaveLength(1);
    });
  });

  it('#526: registra RcsAssessment e SpecimenPreanalytics referenciados ao comitar amostra nova', async () => {
    const staged = await fhirImportStagingService.stageBundle(db, signedBundle, { fileName: 'bundle.json' });
    const result = await fhirImportStagingService.commitBatch(db, staged.batch._id);

    expect(result.committed).toBe(1);
    expect(db.collections.rcsAssessments.insertOne).toHaveBeenCalledTimes(1);
    expect(db.collections.rcsAssessments.docs[0]).toMatchObject({
      specimenId: 'S-001',
      finalGrade: 'A',
    });
    expect(db.collections.specimenPreanalytics.insertOne).toHaveBeenCalledTimes(1);
    expect(db.collections.specimenPreanalytics.docs[0].specimenId).toBe('S-001');

    const committedSample = db.collections.samples.docs[0];
    expect(committedSample.sealedRcsAssessmentId).toBe(db.collections.rcsAssessments.docs[0]._id);
    expect(committedSample.sealedSpecimenPreanalyticsId).toBe(db.collections.specimenPreanalytics.docs[0]._id);
  });

  it('#526: não grava novo RcsAssessment/SpecimenPreanalytics ao comitar registro que apenas atualiza amostra já existente', async () => {
    const staged = await fhirImportStagingService.stageBundle(db, signedBundle, { fileName: 'bundle.json' });
    await fhirImportStagingService.commitBatch(db, staged.batch._id);
    expect(db.collections.rcsAssessments.docs).toHaveLength(1);
    expect(db.collections.specimenPreanalytics.docs).toHaveLength(1);

    // Re-staging + re-committing the same signed bundle hits samples.updateOne's
    // $set-only (match, not upsert-insert) branch the second time around —
    // recording should be a one-time, insert-time event, not repeated per commit.
    const restaged = await fhirImportStagingService.stageBundle(db, signedBundle, { fileName: 'bundle-2.json' });
    await fhirImportStagingService.commitBatch(db, restaged.batch._id);

    expect(db.collections.rcsAssessments.docs).toHaveLength(1);
    expect(db.collections.specimenPreanalytics.docs).toHaveLength(1);
  });

  it('RF006 AC7 (#1315): a re-commit that changes an existing specimen\'s status appends an OperationalStateDecision; a first commit and an unchanged re-commit append none', async () => {
    const staged = await fhirImportStagingService.stageBundle(db, signedBundle, { fileName: 'bundle.json' });
    await fhirImportStagingService.commitBatch(db, staged.batch._id);
    const decisions = () => db.collections.operationalStateDecisions?.docs ?? [];
    expect(decisions()).toHaveLength(0);

    const sample = db.collections.samples.docs.find((doc) => doc.specimenId === 'S-001');
    const committedStatus = sample.specimenStatus;
    const restaged = await fhirImportStagingService.stageBundle(db, signedBundle, { fileName: 'bundle-2.json' });
    await fhirImportStagingService.commitBatch(db, restaged.batch._id);
    expect(decisions()).toHaveLength(0);

    const flippedStatus = committedStatus === 'available' ? 'quarantined' : 'available';
    sample.specimenStatus = flippedStatus;
    const third = await fhirImportStagingService.stageBundle(db, signedBundle, { fileName: 'bundle-3.json' });
    await fhirImportStagingService.commitBatch(db, third.batch._id);
    expect(decisions()).toHaveLength(1);
    expect(decisions()[0]).toMatchObject({
      specimenId: 'S-001',
      previousStatus: flippedStatus,
      newStatus: committedStatus,
      rulesApplied: ['fhir_import_commit'],
    });
  });

  it('#527: registra campos de eixo não nulos no snapshot SpecimenPreanalytics de amostra sólida (tecido)', async () => {
    const solidSignedBundle = {
      resourceType: 'Bundle',
      entry: [
        {
          resource: {
            resourceType: 'Patient',
            id: 'P-SOLID-527',
            name: [{ text: 'Paciente Sólido 527' }],
            identifier: [{ system: 'cpf', value: '52752752752' }],
          },
        },
        {
          resource: {
            resourceType: 'Consent',
            id: 'C-SOLID-527',
            status: 'active',
            patient: { reference: 'Patient/P-SOLID-527' },
          },
        },
        {
          resource: {
            resourceType: 'Specimen',
            id: 'S-SOLID-527',
            subject: { reference: 'Patient/P-SOLID-527' },
            type: { text: 'TECIDO' },
            extension: [
              { url: 'urn:bioavanced:matrix', valueString: 'Tecido' },
              { url: 'urn:bioavanced:sprecs-raw', valueString: 'TIS-EXC-A-A-FFPE-24H-C' },
            ],
          },
        },
      ],
    };

    const staged = await fhirImportStagingService.stageBundle(db, solidSignedBundle, { fileName: 'bundle-solid.json' });
    await fhirImportStagingService.commitBatch(db, staged.batch._id);

    const profile = db.collections.specimenPreanalytics.docs[0];
    expect(profile.specimenId).toBe('S-SOLID-527');
    expect(profile.matrixType).toBe('solid');
    // Axis 2-6 for solid matrices come from parseSprecRaw's TIS-EXC-A-A-FFPE-24H-C
    // parse; SpecimenPreanalyticsModel.fieldsOf derives its dict-02 solid-branch
    // names (sprecCollectionType/warmIschemiaTime/coldIschemiaTime/
    // fixationStabilizationType/fixationTime) from the same generic axis-position
    // fields (primaryContainer/preCentrifugation/centrifugation/
    // secondCentrifugation/postCentrifugationDelay) the fluid branch already
    // populates — none of these should resolve to null.
    expect(profile.sprecCollectionType).toBe('EXC');
    expect(profile.warmIschemiaTime).toBe('A');
    expect(profile.coldIschemiaTime).toBe('A');
    expect(profile.fixationStabilizationType).toBe('FFPE');
    expect(profile.fixationTime).toBe('24H');
  });

  it('#527: registra campos de eixo "X" (não nulos) para amostra sólida em modo de processamento desconhecido', async () => {
    const solidUnknownSignedBundle = {
      resourceType: 'Bundle',
      entry: [
        {
          resource: {
            resourceType: 'Patient',
            id: 'P-SOLID-UNK-527',
            name: [{ text: 'Paciente Sólido Desconhecido 527' }],
            identifier: [{ system: 'cpf', value: '52752752753' }],
          },
        },
        {
          resource: {
            resourceType: 'Consent',
            id: 'C-SOLID-UNK-527',
            status: 'active',
            patient: { reference: 'Patient/P-SOLID-UNK-527' },
          },
        },
        {
          resource: {
            resourceType: 'Specimen',
            id: 'S-SOLID-UNK-527',
            subject: { reference: 'Patient/P-SOLID-UNK-527' },
            type: { text: 'TECIDO' },
            extension: [
              { url: 'urn:bioavanced:matrix', valueString: 'Tecido' },
              { url: 'urn:bioavanced:processing-unknown', valueBoolean: true },
            ],
          },
        },
      ],
    };

    const staged = await fhirImportStagingService.stageBundle(db, solidUnknownSignedBundle, { fileName: 'bundle-solid-unk.json' });
    await fhirImportStagingService.commitBatch(db, staged.batch._id);

    const profile = db.collections.specimenPreanalytics.docs[0];
    expect(profile.specimenId).toBe('S-SOLID-UNK-527');
    expect(profile.matrixType).toBe('solid');
    // buildRcsPayload's unknownSolid placeholder (processingUnknown branch) has
    // the same generic-axis-name requirement as parseSprecRaw's solid branch —
    // its axis 3-6 fields are the literal code 'X', not null.
    expect(profile.warmIschemiaTime).toBe('X');
    expect(profile.coldIschemiaTime).toBe('X');
    expect(profile.fixationStabilizationType).toBe('X');
    expect(profile.fixationTime).toBe('X');
  });

  it('rejeita staging quando banco de dados não está disponível', async () => {
    await expect(
      fhirImportStagingService.stageBundle(null, signedBundle, { fileName: 'bundle.json' })
    ).rejects.toThrow('Banco de dados não disponível');
  });

  it('aceita batchId como instância de ObjectId em getBatch', async () => {
    const staged = await fhirImportStagingService.stageBundle(db, signedBundle, { fileName: 'bundle.json' });
    const objectIdBatchId = new ObjectId();
    db.collections.import_batches.docs[0]._id = objectIdBatchId;
    db.collections.import_staging_records.docs.forEach((doc) => { doc.batchId = objectIdBatchId; });

    const result = await fhirImportStagingService.getBatch(db, objectIdBatchId);
    expect(result.batch._id).toBe(objectIdBatchId);
  });

  it('getBatch rejeita lote inexistente com 404', async () => {
    await expect(fhirImportStagingService.getBatch(db, 'lote-inexistente')).rejects.toMatchObject({ statusCode: 404 });
  });

  // #1385: a FHIR batch carries the organization it was staged under, and
  // every read and write of it checks that against the caller's scope. An
  // unstamped batch (legacy, or staged by a global caller who named none)
  // only global scope reaches; no scope argument is an internal caller.
  describe('#1385 organization scope', () => {
    const ORG_A = { scope: 'organization', organizationIds: ['org-a'] };
    const ORG_B = { scope: 'organization', organizationIds: ['org-b'] };
    const GLOBAL = { scope: 'global', organizationIds: [] };
    const emailBundle = {
      resourceType: 'Bundle',
      entry: [
        {
          resource: {
            resourceType: 'Patient',
            id: 'P-ORG',
            name: [{ text: 'Paciente Organização' }],
            identifier: [{ value: 'DOC-ORG' }],
            telecom: [{ system: 'email', value: 'org@example.org' }],
          },
        },
        { resource: { resourceType: 'Specimen', id: 'S-ORG', subject: { reference: 'Patient/P-ORG' }, type: { text: 'SANGUE' } } },
      ],
    };

    function stagingStatuses() {
      return db.collections.import_staging_records.docs.map((doc) => doc.status);
    }

    it('#1385: stageBundle stamps the batch and every staged record with its organizationId, and null when none is given', async () => {
      const staged = await fhirImportStagingService.stageBundle(db, signedBundle, { fileName: 'bundle.json', organizationId: 'org-a' });

      expect(staged.batch.organizationId).toBe('org-a');
      expect(db.collections.import_batches.docs[0].organizationId).toBe('org-a');
      expect(db.collections.import_staging_records.docs).toHaveLength(2);
      for (const doc of db.collections.import_staging_records.docs) {
        expect(doc.organizationId).toBe('org-a');
      }

      const unstamped = await fhirImportStagingService.stageBundle(db, emailBundle, { fileName: 'bundle.json' });
      expect(unstamped.batch.organizationId).toBeNull();
    });

    it('#1385: an org-a scope reads its own org-a batch', async () => {
      const staged = await fhirImportStagingService.stageBundle(db, signedBundle, { fileName: 'bundle.json', organizationId: 'org-a' });

      const result = await fhirImportStagingService.getBatch(db, staged.batch._id, { organizationScope: ORG_A });
      expect(String(result.batch._id)).toBe(String(staged.batch._id));
      expect(result.records).toHaveLength(2);
    });

    it('#1385: getBatch refuses an org-b scope on an org-a batch with 403', async () => {
      const staged = await fhirImportStagingService.stageBundle(db, signedBundle, { fileName: 'bundle.json', organizationId: 'org-a' });

      await expect(
        fhirImportStagingService.getBatch(db, staged.batch._id, { organizationScope: ORG_B })
      ).rejects.toMatchObject({ statusCode: 403 });
    });

    it('#1385: validateBatch refuses an org-b scope with 403 and moves no record', async () => {
      const staged = await fhirImportStagingService.stageBundle(db, emailBundle, { fileName: 'bundle.json', organizationId: 'org-a' });
      const before = stagingStatuses();
      db.collections.import_staging_records.updateOne.mockClear();

      await expect(
        fhirImportStagingService.validateBatch(db, staged.batch._id, { organizationScope: ORG_B })
      ).rejects.toMatchObject({ statusCode: 403 });
      expect(db.collections.import_staging_records.updateOne).not.toHaveBeenCalled();
      expect(stagingStatuses()).toEqual(before);
    });

    it('#1385: sendConsents refuses an org-b scope with 403 and sends no email', async () => {
      const staged = await fhirImportStagingService.stageBundle(db, emailBundle, { fileName: 'bundle.json', organizationId: 'org-a' });
      expect(staged.records[0].status).toBe('VALID');

      await expect(
        fhirImportStagingService.sendConsents(db, staged.batch._id, { userID: 'admin', organizationScope: ORG_B })
      ).rejects.toMatchObject({ statusCode: 403 });
      expect(notificationService.sendConsentEmail).not.toHaveBeenCalled();
    });

    it('#1385: getConsentStatus refuses an org-b scope with 403', async () => {
      const staged = await fhirImportStagingService.stageBundle(db, emailBundle, { fileName: 'bundle.json', organizationId: 'org-a' });

      await expect(
        fhirImportStagingService.getConsentStatus(db, staged.batch._id, { organizationScope: ORG_B })
      ).rejects.toMatchObject({ statusCode: 403 });
    });

    it('#1385: commitBatch refuses an org-b scope with 403, writes no sample and moves no record', async () => {
      const staged = await fhirImportStagingService.stageBundle(db, signedBundle, { fileName: 'bundle.json', organizationId: 'org-a' });
      expect(staged.records[0].status).toBe('READY_TO_COMMIT');
      const before = stagingStatuses();
      db.collections.import_staging_records.updateOne.mockClear();

      await expect(
        fhirImportStagingService.commitBatch(db, staged.batch._id, { organizationScope: ORG_B })
      ).rejects.toMatchObject({ statusCode: 403 });
      expect(db.collections.samples.updateOne).not.toHaveBeenCalled();
      expect(db.collections.samples.docs).toHaveLength(0);
      expect(db.collections.patients.updateOne).not.toHaveBeenCalled();
      expect(db.collections.import_staging_records.updateOne).not.toHaveBeenCalled();
      expect(stagingStatuses()).toEqual(before);
    });

    it('#1385: attachExternalDocument refuses an org-b scope with 403 and releases nothing', async () => {
      const staged = await fhirImportStagingService.stageBundle(db, emailBundle, { fileName: 'bundle.json', organizationId: 'org-a' });
      const recordId = db.collections.import_staging_records.docs[0]._id;
      db.collections.samples.docs.push({ _id: 'sample-org', specimenId: 'S-ORG' });
      const before = stagingStatuses();
      db.collections.import_staging_records.updateOne.mockClear();

      await expect(
        fhirImportStagingService.attachExternalDocument(db, staged.batch._id, recordId, { userID: 'admin', organizationScope: ORG_B })
      ).rejects.toMatchObject({ statusCode: 403 });
      expect(db.collections.import_staging_records.updateOne).not.toHaveBeenCalled();
      expect(db.collections.samples.updateOne).not.toHaveBeenCalled();
      expect(stagingStatuses()).toEqual(before);
    });

    it('#1385: an unstamped (legacy) batch is refused 403 to an organization scope and read by global scope', async () => {
      const staged = await fhirImportStagingService.stageBundle(db, signedBundle, { fileName: 'bundle.json' });
      delete db.collections.import_batches.docs[0].organizationId;

      await expect(
        fhirImportStagingService.getBatch(db, staged.batch._id, { organizationScope: ORG_A })
      ).rejects.toMatchObject({ statusCode: 403 });
      await expect(
        fhirImportStagingService.getBatch(db, staged.batch._id, { organizationScope: GLOBAL })
      ).resolves.toMatchObject({ batch: { _id: staged.batch._id } });
    });

    it('#1385: with no scope argument the caller is internal and unfiltered', async () => {
      const staged = await fhirImportStagingService.stageBundle(db, signedBundle, { fileName: 'bundle.json', organizationId: 'org-a' });

      await expect(fhirImportStagingService.getBatch(db, staged.batch._id)).resolves.toMatchObject({
        batch: { _id: staged.batch._id },
      });
    });

    it('#1385: validateImportConsentToken still resolves the token of a stamped batch', async () => {
      const staged = await fhirImportStagingService.stageBundle(db, emailBundle, { fileName: 'bundle.json', organizationId: 'org-a' });
      const consentResult = await fhirImportStagingService.sendConsents(db, staged.batch._id, { userID: 'admin' });
      const token = consentResult.records[0].consentTracking.token;

      const validated = await fhirImportStagingService.validateImportConsentToken(db, token);
      expect(validated.batch.organizationId).toBe('org-a');
      expect(String(validated.record._id)).toBe(String(db.collections.import_staging_records.docs[0]._id));
    });

    it('#1385: commitBatch gives a new sample the batch organizationId', async () => {
      const staged = await fhirImportStagingService.stageBundle(db, signedBundle, { fileName: 'bundle.json', organizationId: 'org-a' });

      const committed = await fhirImportStagingService.commitBatch(db, staged.batch._id, { organizationScope: ORG_A });
      expect(committed.committed).toBe(1);
      const sample = db.collections.samples.docs.find((doc) => doc.specimenId === 'S-001');
      expect(sample).toBeTruthy();
      expect(sample.organizationId).toBe('org-a');
    });
  });

  describe('getConsentStatus', () => {
    it('usa fallback de buildWorkflowSnapshot quando o registro ainda não tem campos de workflow persistidos', async () => {
      const staged = await fhirImportStagingService.stageBundle(db, signedBundle, { fileName: 'bundle.json' });

      const status = await fhirImportStagingService.getConsentStatus(db, staged.batch._id);

      expect(status.records[0].consentStatus).toBe('SIGNED');
      expect(status.records[0].workflowStatus).toBe('SIGNED');
      expect(status.records[1].consentStatus).toBe('NOT_REQUIRED');
      expect(status.records[1].workflowStatus).toBe('NEEDS_REVIEW');
    });

    it('usa os campos de workflow já persistidos no registro quando presentes', async () => {
      const bundle = {
        resourceType: 'Bundle',
        entry: [
          {
            resource: {
              resourceType: 'Patient',
              id: 'P-STATUS',
              name: [{ text: 'Paciente Status' }],
              identifier: [{ value: 'DOC-STATUS' }],
              telecom: [{ system: 'email', value: 'status@example.org' }],
            },
          },
          { resource: { resourceType: 'Specimen', id: 'S-STATUS', subject: { reference: 'Patient/P-STATUS' }, type: { text: 'SANGUE' } } },
        ],
      };
      const staged = await fhirImportStagingService.stageBundle(db, bundle, { fileName: 'bundle.json' });
      await fhirImportStagingService.sendConsents(db, staged.batch._id, { userID: 'admin' });

      const status = await fhirImportStagingService.getConsentStatus(db, staged.batch._id);

      expect(status.records[0].consentStatus).toBe('PENDING');
      expect(status.records[0].workflowStatus).toBe('TCLE_SENT');
    });
  });

  describe('attachExternalDocument', () => {
    it('rejeita quando o registro de staging não é encontrado', async () => {
      const staged = await fhirImportStagingService.stageBundle(db, signedBundle, { fileName: 'bundle.json' });

      await expect(
        fhirImportStagingService.attachExternalDocument(db, staged.batch._id, 'registro-inexistente', { userID: 'admin' })
      ).rejects.toMatchObject({ statusCode: 404 });
    });

    it('anexa documentação externa, libera o registro e atualiza a amostra correspondente', async () => {
      const bundle = {
        resourceType: 'Bundle',
        entry: [
          {
            resource: {
              resourceType: 'Patient',
              id: 'P-EXT',
              name: [{ text: 'Paciente Externo' }],
              identifier: [{ value: 'DOC-EXT' }],
            },
          },
          { resource: { resourceType: 'Specimen', id: 'S-EXT', subject: { reference: 'Patient/P-EXT' }, type: { text: 'SANGUE' } } },
        ],
      };
      const staged = await fhirImportStagingService.stageBundle(db, bundle, { fileName: 'bundle.json' });
      const recordId = db.collections.import_staging_records.docs[0]._id;
      db.collections.samples.docs.push({ _id: 'sample-ext', specimenId: 'S-EXT' });

      const result = await fhirImportStagingService.attachExternalDocument(db, staged.batch._id, recordId, {});

      const updatedRecord = db.collections.import_staging_records.docs.find((doc) => doc._id === recordId);
      expect(updatedRecord.status).toBe('COMMITTED');
      expect(updatedRecord.consentStatus).toBe('EXTERNAL_ATTACHED');
      expect(updatedRecord.externalDocument).toMatchObject({ attachedBy: null, validatedBy: null, note: null });
      const updatedSample = db.collections.samples.docs.find((doc) => doc.specimenId === 'S-EXT');
      expect(updatedSample.consentStatus).toBe('EXTERNAL_ATTACHED');
      expect(updatedSample.specimenStatus).toBe('available');
      expect(db.collections.audit_logs.docs.some((doc) => doc.action === 'FHIR_IMPORT_EXTERNAL_DOCUMENT_ATTACHED')).toBe(true);
      expect(result.records[0].workflowStatus).toBe('EXTERNAL_ATTACHED');
    });

    it('registra attachedBy/validatedBy e a nota quando fornecidos', async () => {
      const bundle = {
        resourceType: 'Bundle',
        entry: [
          { resource: { resourceType: 'Patient', id: 'P-EXT2', name: [{ text: 'Paciente Externo 2' }], identifier: [{ value: 'DOC-EXT2' }] } },
          { resource: { resourceType: 'Specimen', id: 'S-EXT2', subject: { reference: 'Patient/P-EXT2' }, type: { text: 'SANGUE' } } },
        ],
      };
      const staged = await fhirImportStagingService.stageBundle(db, bundle, { fileName: 'bundle.json' });
      const recordId = db.collections.import_staging_records.docs[0]._id;
      // #801: this fixture never seeded a sample, and passed only because
      // attachExternalDocument discarded its samples.updateOne result -- so a
      // matchedCount of 0 left the record COMMITTED with nothing behind it.
      // Now that the write is checked, the fixture has to be complete. The
      // sibling test above ("anexa documentação externa...") always seeded
      // one; this one is brought in line with it rather than the guard being
      // relaxed.
      db.collections.samples.docs.push({ _id: 'sample-ext2', specimenId: 'S-EXT2' });

      await fhirImportStagingService.attachExternalDocument(db, staged.batch._id, recordId, { userID: 'admin-1', note: '  Documento validado manualmente  ' });

      const updatedRecord = db.collections.import_staging_records.docs.find((doc) => doc._id === recordId);
      expect(updatedRecord.externalDocument).toMatchObject({
        attachedBy: 'admin-1',
        validatedBy: 'admin-1',
        note: 'Documento validado manualmente',
      });
    });
  });

  describe('validateBatch', () => {
    it('ignora registros já COMMITTED ou CONSENT_SEND_FAILED e recalcula os demais', async () => {
      const bundle = {
        resourceType: 'Bundle',
        entry: [
          { resource: { resourceType: 'Patient', id: 'P-VB1', name: [{ text: 'Paciente VB1' }], identifier: [{ value: 'DOC-VB1' }], telecom: [{ system: 'email', value: 'vb1@example.org' }] } },
          { resource: { resourceType: 'Specimen', id: 'S-VB1', subject: { reference: 'Patient/P-VB1' }, type: { text: 'SANGUE' } } },
        ],
      };
      const staged = await fhirImportStagingService.stageBundle(db, bundle, { fileName: 'bundle.json' });
      const record = db.collections.import_staging_records.docs[0];
      record.status = 'COMMITTED';

      const result = await fhirImportStagingService.validateBatch(db, staged.batch._id);

      expect(result.records[0].status).toBe('COMMITTED');
    });

    it('marca PENDING_CONSENT quando TCLE já foi enviado mas ainda não assinado', async () => {
      const bundle = {
        resourceType: 'Bundle',
        entry: [
          { resource: { resourceType: 'Patient', id: 'P-VB2', name: [{ text: 'Paciente VB2' }], identifier: [{ value: 'DOC-VB2' }], telecom: [{ system: 'email', value: 'vb2@example.org' }] } },
          { resource: { resourceType: 'Specimen', id: 'S-VB2', subject: { reference: 'Patient/P-VB2' }, type: { text: 'SANGUE' } } },
        ],
      };
      const staged = await fhirImportStagingService.stageBundle(db, bundle, { fileName: 'bundle.json' });
      await fhirImportStagingService.sendConsents(db, staged.batch._id, { userID: 'admin' });

      const result = await fhirImportStagingService.validateBatch(db, staged.batch._id);

      expect(result.records[0].status).toBe('PENDING_CONSENT');
      expect(result.records[0].warnings[0].message).toBe('TCLE assinado não encontrado para este paciente.');
    });

    it('marca VALID com aviso de TCLE pendente quando não há erro, assinatura nem envio', async () => {
      const bundle = {
        resourceType: 'Bundle',
        entry: [
          { resource: { resourceType: 'Patient', id: 'P-VB3', name: [{ text: 'Paciente VB3' }], identifier: [{ value: 'DOC-VB3' }], telecom: [{ system: 'email', value: 'vb3@example.org' }] } },
          { resource: { resourceType: 'Specimen', id: 'S-VB3', subject: { reference: 'Patient/P-VB3' }, type: { text: 'SANGUE' } } },
        ],
      };
      const staged = await fhirImportStagingService.stageBundle(db, bundle, { fileName: 'bundle.json' });

      const result = await fhirImportStagingService.validateBatch(db, staged.batch._id);

      expect(result.records[0].status).toBe('VALID');
      expect(result.records[0].warnings[0].message).toBe('TCLE ainda não enviado para assinatura.');
    });
  });

  describe('sendConsents branches adicionais', () => {
    it('pula registros já COMMITTED ou READY_TO_COMMIT', async () => {
      const staged = await fhirImportStagingService.stageBundle(db, signedBundle, { fileName: 'bundle.json' });

      const result = await fhirImportStagingService.sendConsents(db, staged.batch._id, { userID: 'admin' });

      expect(result.consentResults[0]).toMatchObject({ status: 'READY_TO_COMMIT', skipped: true });
    });

    it('pula registros com erros de validação bloqueantes (não apenas e-mail ausente)', async () => {
      const bundle = {
        resourceType: 'Bundle',
        entry: [
          { resource: { resourceType: 'Specimen', id: 'S-BLOCKED', type: { text: 'SANGUE' } } },
        ],
      };
      const staged = await fhirImportStagingService.stageBundle(db, bundle, { fileName: 'bundle.json' });

      const result = await fhirImportStagingService.sendConsents(db, staged.batch._id, { userID: 'admin' });

      expect(result.consentResults[0]).toMatchObject({ status: 'ERROR', skipped: true, reason: 'validation_errors' });
    });

    it('marca NEEDS_REVIEW quando o e-mail do paciente está ausente ou inválido no momento do envio', async () => {
      const bundle = {
        resourceType: 'Bundle',
        entry: [
          { resource: { resourceType: 'Patient', id: 'P-NOEMAIL', name: [{ text: 'Paciente Sem Email' }], identifier: [{ value: 'DOC-NOEMAIL' }] } },
          { resource: { resourceType: 'Consent', status: 'active', patient: { reference: 'Patient/P-NOEMAIL' } } },
          { resource: { resourceType: 'Specimen', id: 'S-NOEMAIL', subject: { reference: 'Patient/P-NOEMAIL' }, type: { text: 'SANGUE' } } },
        ],
      };
      const staged = await fhirImportStagingService.stageBundle(db, bundle, { fileName: 'bundle.json' });
      const record = db.collections.import_staging_records.docs[0];
      expect(record.status).toBe('READY_TO_COMMIT');
      record.status = 'VALID';
      record.errors = [];

      const result = await fhirImportStagingService.sendConsents(db, staged.batch._id, { userID: 'admin' });

      expect(result.consentResults[0]).toMatchObject({ status: 'NEEDS_REVIEW', sent: false });
      const updatedRecord = db.collections.import_staging_records.docs[0];
      expect(updatedRecord.consentStatus).toBe('NOT_REQUIRED');
      expect(updatedRecord.availabilityStatus).toBe('BLOCKED');
      expect(notificationService.sendConsentEmail).not.toHaveBeenCalled();
    });
  });

  describe('helpers de normalização com formatos FHIR alternativos', () => {
    it('resolve identificador por fallback quando nenhum identifier bate com o sistema preferido', async () => {
      const bundle = {
        resourceType: 'Bundle',
        entry: [
          {
            resource: {
              resourceType: 'Patient',
              id: 'P-ALTID',
              name: [{ text: 'Paciente Alt' }],
              identifier: [{ system: 'rg', value: 'RG-999' }],
            },
          },
          { resource: { resourceType: 'Specimen', id: 'S-ALTID', subject: { reference: 'Patient/P-ALTID' }, type: { text: 'SANGUE' } } },
        ],
      };
      const result = await fhirImportStagingService.stageBundle(db, bundle, { fileName: 'bundle.json' });

      expect(result.records[0].normalized.patientDocument).toBe('RG-999');
    });

    it('lê extensões via valueCode e ignora extensão sem nenhum valor conhecido', async () => {
      const bundle = {
        resourceType: 'Bundle',
        entry: [
          { resource: { resourceType: 'Patient', id: 'P-EXTVAL', name: [{ text: 'Paciente ExtVal' }], identifier: [{ value: 'DOC-EXTVAL' }] } },
          {
            resource: {
              resourceType: 'Specimen',
              id: 'S-EXTVAL',
              subject: { reference: 'Patient/P-EXTVAL' },
              type: { text: 'SANGUE' },
              extension: [
                { url: 'urn:bioavanced:matrix', valueCode: 'plasma-code' },
                { url: 'urn:bioavanced:unrelated-field' },
              ],
            },
          },
        ],
      };
      const result = await fhirImportStagingService.stageBundle(db, bundle, { fileName: 'bundle.json' });

      expect(result.records[0].normalized.matrix).toBe('plasma-code');
    });

    it('usa fallback de coding para diseaseName, hpoLabel, biomarkerType, value e unit quando os campos de texto estão ausentes', async () => {
      const bundle = {
        resourceType: 'Bundle',
        entry: [
          { resource: { resourceType: 'Patient', id: 'P-FALLBACK', name: [{ text: 'Paciente Fallback' }], identifier: [{ value: 'DOC-FALLBACK' }] } },
          { resource: { resourceType: 'Specimen', id: 'S-FALLBACK', subject: { reference: 'Patient/P-FALLBACK' }, type: { text: 'SANGUE' } } },
          {
            resource: {
              resourceType: 'Condition',
              subject: { reference: 'Patient/P-FALLBACK' },
              code: { coding: [{ system: 'http://hl7.org/fhir/sid/icd-10', code: 'Q90', display: 'Coding Display Only' }] },
            },
          },
          {
            resource: {
              resourceType: 'Observation',
              subject: { reference: 'Patient/P-FALLBACK' },
              specimen: { reference: 'Specimen/S-FALLBACK' },
              code: { coding: [{ code: 'BIOM-1' }] },
              valueString: 'positivo',
            },
          },
          {
            resource: {
              resourceType: 'Observation',
              subject: { reference: 'Patient/P-FALLBACK' },
              specimen: { reference: 'Specimen/S-FALLBACK' },
              code: { coding: [{ code: 'BIOM-2' }] },
              valueQuantity: { value: 3, code: 'mg/dL' },
            },
          },
        ],
      };
      const result = await fhirImportStagingService.stageBundle(db, bundle, { fileName: 'bundle.json' });
      const record = result.records[0];

      expect(record.normalized.diseases[0]).toMatchObject({ diseaseName: 'Coding Display Only', cid10: 'Q90' });
      expect(record.normalized.biomarkers[0]).toMatchObject({ biomarkerType: 'BIOM-1', value: 'positivo' });
      const unitFallbackBiomarker = record.normalized.biomarkers.find((biomarker) => biomarker.unit === 'mg/dL');
      expect(unitFallbackBiomarker).toMatchObject({ biomarkerType: 'BIOM-2' });
    });

    it('calcula SPREC no formato sólido (tecido) e no modo de processamento desconhecido para matriz sólida', async () => {
      const bundle = {
        resourceType: 'Bundle',
        entry: [
          { resource: { resourceType: 'Patient', id: 'P-SOLID', name: [{ text: 'Paciente Sólido' }], identifier: [{ value: 'DOC-SOLID' }] } },
          {
            resource: {
              resourceType: 'Specimen',
              id: 'S-SOLID',
              subject: { reference: 'Patient/P-SOLID' },
              type: { text: 'TECIDO' },
              extension: [
                { url: 'urn:bioavanced:matrix', valueString: 'Tecido' },
                { url: 'urn:bioavanced:sprecs-raw', valueString: 'TIS-EXC-A-A-FFPE-24H-C' },
              ],
            },
          },
        ],
      };
      const result = await fhirImportStagingService.stageBundle(db, bundle, { fileName: 'bundle.json' });

      expect(result.records[0].normalized.rcsPreview.calculation_trace.sprec).toMatchObject({ matrix_type: 'solid' });
    });

    it('modo de processamento desconhecido para matriz sólida usa o payload sólido de X', async () => {
      const bundle = {
        resourceType: 'Bundle',
        entry: [
          { resource: { resourceType: 'Patient', id: 'P-SOLID-UNK', name: [{ text: 'Paciente Sólido Desconhecido' }], identifier: [{ value: 'DOC-SOLID-UNK' }] } },
          {
            resource: {
              resourceType: 'Specimen',
              id: 'S-SOLID-UNK',
              subject: { reference: 'Patient/P-SOLID-UNK' },
              type: { text: 'TECIDO' },
              extension: [
                { url: 'urn:bioavanced:matrix', valueString: 'Tecido' },
                { url: 'urn:bioavanced:processing-unknown', valueBoolean: true },
              ],
            },
          },
        ],
      };
      const result = await fhirImportStagingService.stageBundle(db, bundle, { fileName: 'bundle.json' });

      expect(result.records[0].normalized.rcsPreview.calculation_trace.sprec).toMatchObject({ matrix_type: 'solid', sampleType: 'X' });
    });
  });
  describe('branch coverage (#1337)', () => {
    it('flags a Patient email that is present but malformed as INVALID_EMAIL', async () => {
      const bundle = {
        resourceType: 'Bundle',
        entry: [
          { resource: { resourceType: 'Patient', id: 'P-BADMAIL', name: [{ text: 'Paciente' }], identifier: [{ value: 'DOC-1' }], telecom: [{ system: 'email', value: 'not-an-email' }] } },
          { resource: { resourceType: 'Specimen', id: 'S-BADMAIL', subject: { reference: 'Patient/P-BADMAIL' }, type: { text: 'SANGUE' } } },
        ],
      };
      const result = await fhirImportStagingService.stageBundle(db, bundle, { fileName: 'bundle.json' });
      expect(result.records[0].status).toBe('ERROR');
      expect(result.records[0].errors).toEqual(expect.arrayContaining([expect.objectContaining({ field: 'patientEmail', code: 'INVALID_EMAIL' })]));
    });

    it('requires a specimenId when the Specimen has neither id nor identifier', async () => {
      const bundle = {
        resourceType: 'Bundle',
        entry: [
          { resource: { resourceType: 'Patient', id: 'P-NOID', name: [{ text: 'Paciente' }], identifier: [{ value: 'DOC-2' }] } },
          { resource: { resourceType: 'Specimen', subject: { reference: 'Patient/P-NOID' }, type: { text: 'SANGUE' } } },
        ],
      };
      const result = await fhirImportStagingService.stageBundle(db, bundle, { fileName: 'bundle.json' });
      expect(result.records[0].normalized.specimenId).toBe('');
      expect(result.records[0].errors).toEqual(expect.arrayContaining([expect.objectContaining({ field: 'specimenId' })]));
    });

    it('skips non-object entries and a Consent or Condition with no patient reference', async () => {
      const bundle = {
        resourceType: 'Bundle',
        entry: [
          { resource: 'not-a-resource' },
          { resource: { resourceType: 'Patient', id: 'P-SKIP', name: [{ text: 'Paciente' }], identifier: [{ value: 'DOC-3' }] } },
          { resource: { resourceType: 'Consent', status: 'active' } },
          { resource: { resourceType: 'Condition', code: { text: 'Sem paciente' } } },
          { resource: { resourceType: 'Specimen', id: 'S-SKIP', subject: { reference: 'Patient/P-SKIP' }, type: { text: 'SANGUE' } } },
        ],
      };
      const result = await fhirImportStagingService.stageBundle(db, bundle, { fileName: 'bundle.json' });
      expect(result.records).toHaveLength(1);
      expect(result.records[0].normalized.consentSigned).toBe(false);
      expect(result.records[0].normalized.diseases).toEqual([]);
    });

    const logger = require('../../src/utils/logger');
    const rcsAssessmentService = require('../../src/services/rcs-assessment.service');
    const specimenPreanalyticsService = require('../../src/services/specimen-preanalytics.service');
    const participantIdentityService = require('../../src/services/participantIdentity.service');
    const quarantineActionService = require('../../src/services/quarantine-action.service');

    function editStaged(stored, edit) {
      const record = revealStagedRecord(stored);
      edit(record);
      Object.keys(stored).forEach((key) => { delete stored[key]; });
      Object.assign(stored, sealStagedRecord(record, { fields: FHIR_STAGING_SEALED_FIELDS }));
    }

    function emailBundle(suffix, email = `${suffix.toLowerCase()}@example.org`) {
      return {
        resourceType: 'Bundle',
        entry: [
          {
            resource: {
              resourceType: 'Patient',
              id: `P-${suffix}`,
              name: [{ text: `Paciente ${suffix}` }],
              identifier: [{ value: `DOC-${suffix}` }],
              ...(email ? { telecom: [{ system: 'email', value: email }] } : {}),
            },
          },
          { resource: { resourceType: 'Specimen', id: `S-${suffix}`, subject: { reference: `Patient/P-${suffix}` }, type: { text: 'SANGUE' } } },
        ],
      };
    }

    it('getBatch answers 404 for a null or empty batch id, and looks a hex id up as an ObjectId', async () => {
      await expect(fhirImportStagingService.getBatch(db, null)).rejects.toMatchObject({ statusCode: 404 });
      await expect(fhirImportStagingService.getBatch(db, '')).rejects.toMatchObject({ statusCode: 404 });
      expect(db.collections.import_batches.findOne).toHaveBeenNthCalledWith(1, { _id: '', type: 'FHIR_BUNDLE' });

      const hexId = '507f1f77bcf86cd799439011';
      await expect(fhirImportStagingService.getBatch(db, hexId)).rejects.toMatchObject({ statusCode: 404 });
      const lookedUp = db.collections.import_batches.findOne.mock.calls[2][0]._id;
      expect(lookedUp).toBeInstanceOf(ObjectId);
      expect(String(lookedUp)).toBe(hexId);
    });

    it('skips an identifier with no value for the next one, reports a missing document when none has one, and finds a Patient with no id by its identifier', async () => {
      const bundle = {
        resourceType: 'Bundle',
        entry: [
          { resource: { resourceType: 'Patient', id: 'P-NOVAL', name: [{ text: 'Paciente Sem Valor' }], identifier: [{ system: 'rg' }] } },
          { resource: { resourceType: 'Specimen', id: 'S-NOVAL', subject: { reference: 'Patient/P-NOVAL' }, type: { text: 'SANGUE' } } },
          { resource: { resourceType: 'Patient', name: [{ text: 'Paciente Sem Id' }], identifier: [{ value: 'DOC-NOPID' }] } },
          { resource: { resourceType: 'Specimen', id: 'S-NOPID', subject: { reference: 'Patient/DOC-NOPID' }, type: { text: 'SANGUE' } } },
          { resource: { resourceType: 'Patient', id: 'P-SECOND', name: [{ text: 'Paciente Segundo' }], identifier: [{ system: 'rg' }, { system: 'rg', value: 'RG-2' }] } },
          { resource: { resourceType: 'Specimen', id: 'S-SECOND', subject: { reference: 'Patient/P-SECOND' }, type: { text: 'SANGUE' } } },
        ],
      };
      const result = await fhirImportStagingService.stageBundle(db, bundle, { fileName: 'bundle.json' });

      expect(result.records[0].normalized.patientDocument).toBe('');
      expect(result.records[0].errors).toEqual(expect.arrayContaining([expect.objectContaining({ field: 'document' })]));
      expect(result.records[1].normalized).toMatchObject({ participantId: 'DOC-NOPID', patientName: 'Paciente Sem Id', patientDocument: 'DOC-NOPID' });
      expect(result.records[1].errors.map((error) => error.field)).not.toContain('patient');
      expect(result.records[2].normalized.patientDocument).toBe('RG-2');
    });

    it('reads an extension from valueInteger or valueDecimal, and gives an empty string for one with no value or no url', async () => {
      const bundle = {
        resourceType: 'Bundle',
        entry: [
          { resource: { resourceType: 'Patient', id: 'P-EXTNUM', name: [{ text: 'Paciente ExtNum' }], identifier: [{ value: 'DOC-EXTNUM' }] } },
          {
            resource: {
              resourceType: 'Specimen',
              id: 'S-INT',
              subject: { reference: 'Patient/P-EXTNUM' },
              type: { text: 'SANGUE' },
              extension: [
                { valueString: 'Plasma sem url' },
                { url: 'urn:bioavanced:matrix' },
                { url: 'urn:bioavanced:storage-temperature', valueInteger: -80 },
              ],
            },
          },
          {
            resource: {
              resourceType: 'Specimen',
              id: 'S-DEC',
              subject: { reference: 'Patient/P-EXTNUM' },
              type: { text: 'SANGUE' },
              extension: [{ url: 'urn:bioavanced:storage-temperature', valueDecimal: -20.5 }],
            },
          },
        ],
      };
      const result = await fhirImportStagingService.stageBundle(db, bundle, { fileName: 'bundle.json' });

      expect(result.records[0].normalized).toMatchObject({ matrix: '', storageTemperature: '-80' });
      expect(result.records[1].normalized.storageTemperature).toBe('-20.5');
    });

    it('falls back through text, display and code for Conditions and Observations that lack them', async () => {
      const subject = { reference: 'Patient/P-CODES' };
      const bundle = {
        resourceType: 'Bundle',
        entry: [
          { resource: { resourceType: 'Patient', id: 'P-CODES', name: [{ text: 'Paciente Codes' }], identifier: [{ value: 'DOC-CODES' }] } },
          { resource: { resourceType: 'Specimen', id: 'S-CODES', subject, type: { text: 'SANGUE' } } },
          { resource: { resourceType: 'Condition', subject, code: { text: 'Só texto' } } },
          { resource: { resourceType: 'Condition', subject, code: { coding: [{ system: 'http://www.orpha.net', display: 'Síndrome Orpha' }] } } },
          { resource: { resourceType: 'Condition', subject, code: { coding: [{ system: 'https://omim.org/entry', code: '600000' }] } } },
          { resource: { resourceType: 'Observation', subject, code: { coding: [{ system: 'https://hpo.jax.org', display: 'Ataxia' }] } } },
          { resource: { resourceType: 'Observation', subject, code: { text: 'Fenótipo em texto', coding: [{ system: 'https://hpo.jax.org', code: 'HP:0000001' }] } } },
          { resource: { resourceType: 'Observation', subject, code: { coding: [{ system: 'https://hpo.jax.org', code: 'HP:0000002' }] } } },
          { resource: { resourceType: 'Observation', subject, valueCodeableConcept: { text: 'Positivo' } } },
          { resource: { resourceType: 'Observation', subject, code: { text: 'Sem valor' } } },
        ],
      };
      const result = await fhirImportStagingService.stageBundle(db, bundle, { fileName: 'bundle.json' });
      const { diseases, phenotypes, biomarkers } = result.records[0].normalized;

      expect(diseases.map(({ diseaseName, cid10, orphaCode, omimCode }) => ({ diseaseName, cid10, orphaCode, omimCode }))).toEqual([
        { diseaseName: 'Só texto', cid10: '', orphaCode: '', omimCode: '' },
        { diseaseName: 'Síndrome Orpha', cid10: '', orphaCode: '', omimCode: '' },
        { diseaseName: '', cid10: '', orphaCode: '', omimCode: '600000' },
      ]);
      expect(phenotypes.map(({ hpoCode, hpoLabel }) => ({ hpoCode, hpoLabel }))).toEqual([
        { hpoCode: '', hpoLabel: 'Ataxia' },
        { hpoCode: 'HP:0000001', hpoLabel: 'Fenótipo em texto' },
        { hpoCode: 'HP:0000002', hpoLabel: '' },
      ]);
      expect(biomarkers.map(({ biomarkerType, value }) => ({ biomarkerType, value }))).toEqual([
        { biomarkerType: '', value: 'Positivo' },
        { biomarkerType: 'Sem valor', value: null },
      ]);
    });

    it('treats a Consent with no status as unsigned and attaches an Observation that names only the Specimen', async () => {
      const bundle = emailBundle('NOSTATUS');
      bundle.entry.push(
        { resource: { resourceType: 'Consent', patient: { reference: 'Patient/P-NOSTATUS' } } },
        { resource: { resourceType: 'Observation', specimen: { reference: 'Specimen/S-NOSTATUS' }, code: { text: 'Só pela amostra' }, valueString: '7' } }
      );
      const result = await fhirImportStagingService.stageBundle(db, bundle, { fileName: 'bundle.json' });

      expect(result.records[0].status).toBe('VALID');
      expect(result.records[0].normalized.consentSigned).toBe(false);
      expect(result.records[0].normalized.biomarkers).toEqual([expect.objectContaining({ biomarkerType: 'Só pela amostra', value: '7' })]);
    });

    it('fills the rcsPreview defaults when the quality result carries none of the optional fields', async () => {
      vi.spyOn(qualityDomain, 'resolveMethodologicalQuality').mockReturnValue({ model_version: 'stub', final_grade: 'B' });

      const result = await fhirImportStagingService.stageBundle(db, emailBundle('RCSBARE'), { fileName: 'bundle.json' });

      expect(result.records[0].normalized.rcsPreview).toMatchObject({
        model_version: 'stub',
        final_grade: 'B',
        governance_failure_reasons: [],
        axis_penalties: [],
        calculation_trace: {},
        rcs_input: null,
      });
    });

    it('stageBundle answers 400 for an unreadable entry, a Bundle with no resources and one with no Specimen, and stores nothing', async () => {
      const unreadable = { resourceType: 'Bundle', entry: [{ get resource() { throw new Error('leitura falhou'); } }] };
      await expect(fhirImportStagingService.stageBundle(db, unreadable)).rejects.toMatchObject({ statusCode: 400, message: 'Bundle FHIR JSON inválido.' });
      await expect(fhirImportStagingService.stageBundle(db, { resourceType: 'Bundle', entry: [{}, { fullUrl: 'urn:uuid:1' }] }))
        .rejects.toMatchObject({ statusCode: 400, message: 'Bundle FHIR JSON inválido ou sem entradas.' });
      await expect(fhirImportStagingService.stageBundle(db, { resourceType: 'Bundle', entry: [{ resource: { resourceType: 'Patient', id: 'P-ONLY' } }] }))
        .rejects.toMatchObject({ statusCode: 400, message: 'Bundle FHIR não contém Specimen para staging.' });
      expect(db.collections.import_batches.docs).toHaveLength(0);
    });

    it('stageBundle names the batch fhir-bundle.json when no fileName is given', async () => {
      const result = await fhirImportStagingService.stageBundle(db, emailBundle('NOFILE'));

      expect(result.batch.fileName).toBe('fhir-bundle.json');
      expect(db.collections.import_batches.docs[0].fileName).toBe('fhir-bundle.json');
    });

    it('getConsentStatus reports PENDING_CONSENT for a valid email whose TCLE was not sent yet', async () => {
      const staged = await fhirImportStagingService.stageBundle(db, emailBundle('NOTSENT'), { fileName: 'bundle.json' });

      const status = await fhirImportStagingService.getConsentStatus(db, staged.batch._id);

      expect(status.records[0]).toMatchObject({ consentStatus: 'PENDING', quarantineReason: 'CONSENT_PENDING', workflowStatus: 'PENDING_CONSENT' });
    });

    it('getConsentStatus reads a record with no normalized data as under review, with null ids', async () => {
      const staged = await fhirImportStagingService.stageBundle(db, emailBundle('NONORM'), { fileName: 'bundle.json' });
      editStaged(db.collections.import_staging_records.docs[0], (record) => { delete record.normalized; });

      const status = await fhirImportStagingService.getConsentStatus(db, staged.batch._id);

      expect(status.records[0]).toMatchObject({
        specimenId: null,
        participantId: null,
        patientEmail: null,
        consentStatus: 'NOT_REQUIRED',
        quarantineReason: 'TRANSFER_REVIEW_REQUIRED',
        workflowStatus: 'NEEDS_REVIEW',
      });
    });

    it('summarize counts a stored WARNING as a warning and a stored NEEDS_EMAIL as an error', async () => {
      const bundle = {
        resourceType: 'Bundle',
        entry: [
          { resource: { resourceType: 'Specimen', id: 'S-WARN', type: { text: 'SANGUE' } } },
          { resource: { resourceType: 'Specimen', id: 'S-NEEDS', type: { text: 'SANGUE' } } },
        ],
      };
      const staged = await fhirImportStagingService.stageBundle(db, bundle, { fileName: 'bundle.json' });
      db.collections.import_staging_records.docs[0].status = 'WARNING';
      db.collections.import_staging_records.docs[1].status = 'NEEDS_EMAIL';

      const result = await fhirImportStagingService.sendConsents(db, staged.batch._id, { userID: 'admin' });

      expect(result.counts).toMatchObject({ total: 2, warnings: 1, errors: 1 });
      expect(result.status).toBe('VALIDATED_WITH_ERRORS');
    });

    it('validateBatch leaves a CONSENT_SEND_FAILED record as it is', async () => {
      notificationService.sendConsentEmail.mockRejectedValueOnce(new Error('Resend indisponível'));
      const staged = await fhirImportStagingService.stageBundle(db, emailBundle('SENDFAIL'), { fileName: 'bundle.json' });
      await fhirImportStagingService.sendConsents(db, staged.batch._id, { userID: 'admin' });

      const result = await fhirImportStagingService.validateBatch(db, staged.batch._id);

      expect(result.records[0].status).toBe('CONSENT_SEND_FAILED');
      expect(result.records[0].consentTracking.error).toBe('Resend indisponível');
    });

    it('validateBatch keeps a record whose only error is NEEDS_EMAIL in NEEDS_REVIEW with the review warning', async () => {
      const staged = await fhirImportStagingService.stageBundle(db, emailBundle('NOMAIL', null), { fileName: 'bundle.json' });
      db.collections.import_staging_records.docs[0].warnings = [];

      const result = await fhirImportStagingService.validateBatch(db, staged.batch._id);

      expect(result.records[0].status).toBe('NEEDS_REVIEW');
      expect(result.records[0].warnings).toEqual([{ field: 'consent', message: 'Registro sem e-mail permanece em revisão.' }]);
    });

    it('sendConsents refuses to build a token when CONSENT_SECRET is unset or blank', async () => {
      const staged = await fhirImportStagingService.stageBundle(db, emailBundle('NOSECRET'), { fileName: 'bundle.json' });
      const savedSecret = process.env.CONSENT_SECRET;
      try {
        delete process.env.CONSENT_SECRET;
        await expect(fhirImportStagingService.sendConsents(db, staged.batch._id, { userID: 'admin' }))
          .rejects.toThrow('CONSENT_SECRET é obrigatório para fluxos de consentimento.');
        process.env.CONSENT_SECRET = '   ';
        await expect(fhirImportStagingService.sendConsents(db, staged.batch._id, { userID: 'admin' }))
          .rejects.toThrow('CONSENT_SECRET é obrigatório para fluxos de consentimento.');
      } finally {
        process.env.CONSENT_SECRET = savedSecret;
      }
      expect(notificationService.sendConsentEmail).not.toHaveBeenCalled();
    });

    it('sendConsents links to localhost:5173 without FRONTEND_URL and signs empty ids as empty strings', async () => {
      await fhirImportStagingService.stageBundle(db, emailBundle('NOIDS'), { fileName: 'bundle.json' });
      db.collections.import_batches.docs[0]._id = '';
      const stored = db.collections.import_staging_records.docs[0];
      editStaged(stored, (record) => {
        record._id = '';
        record.batchId = '';
        record.normalized.participantId = '';
      });
      const savedUrl = process.env.FRONTEND_URL;
      let result;
      try {
        delete process.env.FRONTEND_URL;
        result = await fhirImportStagingService.sendConsents(db, '', { userID: 'admin' });
      } finally {
        if (savedUrl === undefined) delete process.env.FRONTEND_URL;
        else process.env.FRONTEND_URL = savedUrl;
      }

      const link = notificationService.sendConsentEmail.mock.calls[0][1];
      expect(link.startsWith('http://localhost:5173/patient/e-consent/import/')).toBe(true);
      const decoded = jwt.verify(decodeURIComponent(link.split('/patient/e-consent/import/')[1]), process.env.CONSENT_SECRET);
      expect(decoded).toMatchObject({ scope: 'fhir-import-consent', batchId: '', recordId: '', participantId: '' });
      expect(result.records[0].consentTracking.participantId).toBe('');

      const token = result.records[0].consentTracking.token;
      await expect(fhirImportStagingService.validateImportConsentToken(db, token)).resolves.toMatchObject({ record: { _id: '' } });
      await fhirImportStagingService.acceptImportConsentToken(db, token);
      expect(db.collections.audit_logs.docs.find((doc) => doc.action === 'FHIR_IMPORT_CONSENT_SIGNED').participantId).toBeNull();
    });

    it('sendConsents records sentBy null, provider resend and messageId null when neither the caller nor the provider names them', async () => {
      notificationService.sendConsentEmail.mockResolvedValueOnce({ success: true });
      const staged = await fhirImportStagingService.stageBundle(db, emailBundle('BAREMAIL'), { fileName: 'bundle.json' });

      const result = await fhirImportStagingService.sendConsents(db, staged.batch._id);

      expect(result.records[0].status).toBe('PENDING_CONSENT');
      expect(result.records[0].consentTracking).toMatchObject({ sentBy: null, provider: 'resend', messageId: null });
    });

    it('sendConsents marks CONSENT_SEND_FAILED with the provider reason, or a default one, when the email is not accepted', async () => {
      notificationService.sendConsentEmail
        .mockResolvedValueOnce({ success: false, reason: 'Cota excedida' })
        .mockResolvedValueOnce({ success: false });
      const bundle = emailBundle('REFUSED1');
      bundle.entry.push(...emailBundle('REFUSED2').entry);
      const staged = await fhirImportStagingService.stageBundle(db, bundle, { fileName: 'bundle.json' });

      const result = await fhirImportStagingService.sendConsents(db, staged.batch._id, { userID: 'admin' });

      expect(result.consentResults.map(({ status, sent, error }) => ({ status, sent, error }))).toEqual([
        { status: 'CONSENT_SEND_FAILED', sent: false, error: 'Cota excedida' },
        { status: 'CONSENT_SEND_FAILED', sent: false, error: 'Falha ao enviar TCLE por e-mail.' },
      ]);
    });

    it('sendConsents holds a record with no errors array and no normalized data for review', async () => {
      const staged = await fhirImportStagingService.stageBundle(db, emailBundle('BARE'), { fileName: 'bundle.json' });
      editStaged(db.collections.import_staging_records.docs[0], (record) => {
        delete record.errors;
        delete record.normalized;
      });

      const result = await fhirImportStagingService.sendConsents(db, staged.batch._id, { userID: 'admin' });

      expect(result.consentResults[0]).toMatchObject({ status: 'NEEDS_REVIEW', sent: false });
      expect(result.records[0].errors).toEqual([expect.objectContaining({ code: 'NEEDS_EMAIL' })]);
      expect(notificationService.sendConsentEmail).not.toHaveBeenCalled();
    });

    it('a failed audit write is logged as a warning and does not fail the operation', async () => {
      const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
      db.collections.audit_logs.insertOne
        .mockRejectedValueOnce(new Error('audit indisponível'))
        .mockRejectedValueOnce('audit recusado');
      const bundle = emailBundle('AUDIT1');
      bundle.entry.push(...emailBundle('AUDIT2').entry);
      const staged = await fhirImportStagingService.stageBundle(db, bundle, { fileName: 'bundle.json' });

      const result = await fhirImportStagingService.sendConsents(db, staged.batch._id, { userID: 'admin' });

      expect(result.records.map((record) => record.status)).toEqual(['PENDING_CONSENT', 'PENDING_CONSENT']);
      expect(warn).toHaveBeenCalledWith('[FHIR_IMPORT][AUDIT] Falha ao registrar auditoria', 'audit indisponível');
      expect(warn).toHaveBeenCalledWith('[FHIR_IMPORT][AUDIT] Falha ao registrar auditoria', 'audit recusado');
    });

    it('an absent consent token is refused 401 by validate and accept', async () => {
      await expect(fhirImportStagingService.validateImportConsentToken(db, undefined)).rejects.toMatchObject({ statusCode: 401 });
      await expect(fhirImportStagingService.acceptImportConsentToken(db, undefined)).rejects.toMatchObject({ statusCode: 401 });
    });

    it('validateImportConsentToken answers 404 for a token with no ids and for an unknown record of a real batch', async () => {
      const staged = await fhirImportStagingService.stageBundle(db, emailBundle('TOKEN404'), { fileName: 'bundle.json' });
      const noIds = jwt.sign({ scope: 'fhir-import-consent' }, process.env.CONSENT_SECRET, { expiresIn: '2h' });
      const unknownRecord = jwt.sign(
        { scope: 'fhir-import-consent', batchId: String(staged.batch._id), recordId: 'registro-inexistente', participantId: 'P-TOKEN404' },
        process.env.CONSENT_SECRET,
        { expiresIn: '2h' }
      );

      await expect(fhirImportStagingService.validateImportConsentToken(db, noIds))
        .rejects.toMatchObject({ statusCode: 404, message: 'Registro FHIR de importação não encontrado.' });
      expect(db.collections.import_batches.findOne).toHaveBeenLastCalledWith({ _id: '', type: 'FHIR_BUNDLE' });
      await expect(fhirImportStagingService.validateImportConsentToken(db, unknownRecord))
        .rejects.toMatchObject({ statusCode: 404, message: 'Registro FHIR de importação não encontrado.' });
    });

    it('validateImportConsentToken rethrows a batch lookup failure that is not a 404', async () => {
      const staged = await fhirImportStagingService.stageBundle(db, emailBundle('LOOKUP'), { fileName: 'bundle.json' });
      const sent = await fhirImportStagingService.sendConsents(db, staged.batch._id, { userID: 'admin' });
      db.collections.import_batches.findOne.mockRejectedValueOnce(new Error('mongo indisponível'));

      await expect(fhirImportStagingService.validateImportConsentToken(db, sent.records[0].consentTracking.token))
        .rejects.toThrow('mongo indisponível');
    });

    it('acceptImportConsentToken keeps a warning with no field and drops the consent one', async () => {
      const staged = await fhirImportStagingService.stageBundle(db, emailBundle('WARNKEEP'), { fileName: 'bundle.json' });
      const sent = await fhirImportStagingService.sendConsents(db, staged.batch._id, { userID: 'admin' });
      db.collections.import_staging_records.docs[0].warnings = [
        { message: 'Aviso sem campo' },
        { field: 'consent', message: 'TCLE enviado e aguardando assinatura.' },
      ];

      const accepted = await fhirImportStagingService.acceptImportConsentToken(db, sent.records[0].consentTracking.token);

      expect(accepted.record.warnings).toEqual([{ message: 'Aviso sem campo' }]);
    });

    it('acceptImportConsentToken returns the record it wrote when the re-read finds none, with no warnings array to filter', async () => {
      const staged = await fhirImportStagingService.stageBundle(db, emailBundle('NOREREAD'), { fileName: 'bundle.json' });
      const sent = await fhirImportStagingService.sendConsents(db, staged.batch._id, { userID: 'admin' });
      delete db.collections.import_staging_records.docs[0].warnings;
      const records = db.collections.import_staging_records;
      const realFindOne = records.findOne.getMockImplementation();
      // The token lookup and the sealed updateOne's own read find the record;
      // the re-read after the write finds none.
      records.findOne
        .mockImplementationOnce(realFindOne)
        .mockImplementationOnce(realFindOne)
        .mockImplementationOnce(async () => null);

      const accepted = await fhirImportStagingService.acceptImportConsentToken(db, sent.records[0].consentTracking.token);

      expect(accepted.updated).toBe(true);
      await expect(records.findOne.mock.results.at(-1).value).resolves.toBeNull();
      expect(accepted.record).toMatchObject({ status: 'READY_TO_COMMIT', consentStatus: 'SIGNED', warnings: [] });
      expect(accepted.record.normalized.consentSigned).toBe(true);
    });

    it('commitBatch skips a study candidate that fails validation', async () => {
      const staged = await fhirImportStagingService.stageBundle(db, signedBundle, { fileName: 'bundle.json' });
      db.collections.import_batches.docs[0].studyCandidates = [{ studyTitle: 'Estudo sem id', ethicsApprovalId: ['CEP-1'] }];

      const result = await fhirImportStagingService.commitBatch(db, staged.batch._id, { canCreateStudy: true });

      expect(result.committed).toBe(1);
      expect(result.studies).toEqual({ created: 0, existing: 0, notCreatedReason: null });
      expect(db.collections.studies?.docs ?? []).toHaveLength(0);
    });

    it('commitBatch keeps the phone without a holder lookup when it has no blind-index candidates', async () => {
      vi.spyOn(participantIdentityService, 'computeBlindIndexCandidates').mockReturnValue([]);
      const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
      const staged = await fhirImportStagingService.stageBundle(db, signedBundle, { fileName: 'bundle.json' });

      const result = await fhirImportStagingService.commitBatch(db, staged.batch._id);

      expect(result.committed).toBe(1);
      expect(participantIdentityService.computeBlindIndexCandidates).toHaveBeenCalledWith('phone', expect.any(String));
      expect(db.collections.participantIdentities.find).not.toHaveBeenCalled();
      expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('#1171'), expect.anything());
    });

    it('commitBatch inserts a new sample with empty RCS fields and records no assessment or profile when the record has no rcsPreview', async () => {
      const recordAssessment = vi.spyOn(rcsAssessmentService, 'recordAssessment');
      const recordProfile = vi.spyOn(specimenPreanalyticsService, 'recordProfile');
      const staged = await fhirImportStagingService.stageBundle(db, signedBundle, { fileName: 'bundle.json' });
      editStaged(db.collections.import_staging_records.docs[0], (record) => { delete record.normalized.rcsPreview; });

      const result = await fhirImportStagingService.commitBatch(db, staged.batch._id);

      expect(result.committed).toBe(1);
      expect(db.collections.samples.docs[0]).toMatchObject({ specimenId: 'S-001', sprec: {}, final_grade: '', rcs_score: null });
      expect(recordAssessment).not.toHaveBeenCalled();
      expect(recordProfile).not.toHaveBeenCalled();
    });

    it('commitBatch logs a failed RcsAssessment or SpecimenPreanalytics write and still commits the sample', async () => {
      const error = vi.spyOn(logger, 'error').mockImplementation(() => {});
      vi.spyOn(rcsAssessmentService, 'recordAssessment')
        .mockRejectedValueOnce(new Error('rcs indisponível'))
        .mockRejectedValueOnce('rcs recusado');
      vi.spyOn(specimenPreanalyticsService, 'recordProfile')
        .mockRejectedValueOnce('perfil recusado')
        .mockRejectedValueOnce(new Error('perfil indisponível'));
      const bundle = {
        resourceType: 'Bundle',
        entry: ['FAIL1', 'FAIL2'].flatMap((suffix) => [
          { resource: { resourceType: 'Patient', id: `P-${suffix}`, name: [{ text: `Paciente ${suffix}` }], identifier: [{ value: `DOC-${suffix}` }] } },
          { resource: { resourceType: 'Consent', status: 'active', patient: { reference: `Patient/P-${suffix}` } } },
          { resource: { resourceType: 'Specimen', id: `S-${suffix}`, subject: { reference: `Patient/P-${suffix}` }, type: { text: 'SANGUE' } } },
        ]),
      };
      const staged = await fhirImportStagingService.stageBundle(db, bundle, { fileName: 'bundle.json' });

      const result = await fhirImportStagingService.commitBatch(db, staged.batch._id);

      expect(result.committed).toBe(2);
      expect(db.collections.samples.docs.map((sample) => sample.specimenId)).toEqual(['S-FAIL1', 'S-FAIL2']);
      expect(db.collections.samples.docs.some((sample) => sample.sealedRcsAssessmentId || sample.sealedSpecimenPreanalyticsId)).toBe(false);
      expect(error.mock.calls).toEqual([
        ['Falha ao registrar RcsAssessment para a amostra importada via FHIR:', 'rcs indisponível'],
        ['Falha ao registrar SpecimenPreanalytics para a amostra importada via FHIR:', 'perfil recusado'],
        ['Falha ao registrar RcsAssessment para a amostra importada via FHIR:', 'rcs recusado'],
        ['Falha ao registrar SpecimenPreanalytics para a amostra importada via FHIR:', 'perfil indisponível'],
      ]);
    });

    it('attachExternalDocument answers 404 and commits nothing for a record with no normalized data', async () => {
      const staged = await fhirImportStagingService.stageBundle(db, emailBundle('EXTNONORM', null), { fileName: 'bundle.json' });
      const stored = db.collections.import_staging_records.docs[0];
      editStaged(stored, (record) => { delete record.normalized; });

      await expect(fhirImportStagingService.attachExternalDocument(db, staged.batch._id, stored._id, { userID: 'admin' }))
        .rejects.toMatchObject({ statusCode: 404, message: 'Nenhuma amostra encontrada para o specimenId deste registro; documentação externa não anexada.' });
      expect(stored.status).toBe('NEEDS_REVIEW');
    });

    it('attachExternalDocument releases a quarantined sample as SYSTEM when no user is given', async () => {
      const release = vi.spyOn(quarantineActionService, 'releaseActiveAction').mockResolvedValue(null);
      const staged = await fhirImportStagingService.stageBundle(db, emailBundle('EXTQ', null), { fileName: 'bundle.json' });
      const recordId = db.collections.import_staging_records.docs[0]._id;
      db.collections.samples.docs.push({ _id: 'sample-extq', specimenId: 'S-EXTQ', specimenStatus: 'quarantined' });

      await fhirImportStagingService.attachExternalDocument(db, staged.batch._id, recordId, {});

      expect(release).toHaveBeenCalledTimes(1);
      expect(release.mock.calls[0][1]).toMatchObject({ specimenId: 'S-EXTQ' });
      expect(release.mock.calls[0][2]).toBe('SYSTEM');
      expect(db.collections.samples.docs[0].specimenStatus).toBe('available');
    });
  });
});

// RF011 AC5, RNF024 AC2 (#1479): a staged and committed import records the
// mapping release each profile it declares is registered under.
describe('FHIR import staging records the mapping release it was read with', () => {
  const PROFILE = 'https://bioadvanced.dev/fhir/StructureDefinition/rf011-ac5';
  let db;

  function profileRow(overrides) {
    return { canonicalUrl: PROFILE, fhirVersion: '4.0.1', profileVersion: '1.0.0', status: 'active', ...overrides };
  }

  function declaring(bundle, profiles) {
    return {
      ...bundle,
      meta: { profile: profiles.bundle || [] },
      entry: bundle.entry.map((entry) => {
        const declared = profiles[entry.resource.resourceType];
        return declared ? { resource: { ...entry.resource, meta: { profile: declared } } } : entry;
      }),
    };
  }

  beforeEach(() => {
    vi.restoreAllMocks();
    db = createDb();
    process.env.CONSENT_SECRET = 'test-consent-secret';
    vi.spyOn(notificationService, 'sendConsentEmail').mockResolvedValue({ success: true, provider: 'resend', messageId: 'email-001' });
    db.collection('fhirProfileRegistries').docs.push(
      profileRow({ mappingReleaseId: 'REL-ACTIVE' }),
      profileRow({ profileVersion: '2.0.0', mappingReleaseId: 'REL-BUNDLE' }),
      profileRow({ profileVersion: '3.0.0', status: 'draft', mappingReleaseId: 'REL-DRAFT' }),
      profileRow({ profileVersion: '4.0.0', mappingReleaseId: 'REL-MISSING' }),
    );
    db.collection('interoperabilityMappingReleases').docs.push(
      { interoperabilityMappingReleaseId: 'REL-ACTIVE', mappingVersion: '2.1.0' },
      { interoperabilityMappingReleaseId: 'REL-BUNDLE', mappingVersion: '5.0.0' },
      { interoperabilityMappingReleaseId: 'REL-DRAFT', mappingVersion: '9.0.0' },
    );
  });

  it('records on the batch and on each record only the releases their declared profiles name', async () => {
    const bundle = declaring(signedBundle, {
      bundle: [`${PROFILE}|2.0.0`],
      Patient: [`${PROFILE}|1.0.0`],
      Specimen: [`${PROFILE}|4.0.0`],
      Observation: [`${PROFILE}|3.0.0`],
    });
    const result = await fhirImportStagingService.stageBundle(db, bundle, { fileName: 'bundle.json' });

    expect(result.batch.mappingReleases).toEqual([
      { mappingReleaseId: 'REL-ACTIVE', mappingVersion: '2.1.0' },
      { mappingReleaseId: 'REL-BUNDLE', mappingVersion: '5.0.0' },
    ]);
    expect(db.collections.import_batches.docs[0].mappingReleases).toEqual(result.batch.mappingReleases);
    const bySpecimen = Object.fromEntries(db.collections.import_staging_records.docs
      .map((doc) => [revealStagedRecord(doc).normalized.specimenId, doc.mappingReleases]));
    expect(bySpecimen['S-001']).toEqual([{ mappingReleaseId: 'REL-ACTIVE', mappingVersion: '2.1.0' }]);
    expect(bySpecimen['S-ERR']).toEqual([]);
  });

  it('records no release for a Bundle that declares no registered profile', async () => {
    const result = await fhirImportStagingService.stageBundle(db, declaring(signedBundle, { Patient: [`${PROFILE}|7.7.7`] }), { fileName: 'bundle.json' });
    expect(result.batch.mappingReleases).toEqual([]);
    expect(db.collections.import_staging_records.docs.every((doc) => Array.isArray(doc.mappingReleases) && doc.mappingReleases.length === 0)).toBe(true);
  });

  it('keeps the release on the committed record and names it in the commit audit', async () => {
    const staged = await fhirImportStagingService.stageBundle(db, declaring(signedBundle, { Patient: [`${PROFILE}|1.0.0`] }), { fileName: 'bundle.json' });
    const committed = await fhirImportStagingService.commitBatch(db, staged.batch._id);
    expect(committed.committed).toBe(1);

    const expected = [{ mappingReleaseId: 'REL-ACTIVE', mappingVersion: '2.1.0' }];
    const committedRecord = db.collections.import_staging_records.docs.find((doc) => doc.status === 'COMMITTED');
    expect(committedRecord.mappingReleases).toEqual(expected);
    const auditDoc = db.collections.audit_logs.docs.find((doc) => doc.action === 'FHIR_IMPORT_RECORD_COMMITTED');
    expect(auditDoc.mappingReleases).toEqual(expected);
  });
});
