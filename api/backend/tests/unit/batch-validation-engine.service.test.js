import { afterEach, describe, expect, it, vi } from 'vitest';
const fs = require('fs');
const os = require('os');
const path = require('path');
const ExcelJS = require('exceljs');
const { ObjectId } = require('mongodb');

const batchValidationEngine = require('../../src/services/batch-validation-engine.service');
const { sealStagedRecord, revealStagedRecord } = require('../../src/utils/stagedRowCrypto');
const patientService = require('../../src/services/patient.service');
const sampleService = require('../../src/services/sample.service');
const biomarkerObservationService = require('../../src/services/biomarker-observation.service');
const StagingImport = require('../../src/services/stagingImport.store');

function createDb(patientsByFilter = {}) {
  // #853: `patients` never writes a `patientID` key (that's the
  // participantId's CSV-facing alias) -- the collection's real linkage key
  // is `participantId`. A stub that answered on `filter.patientID` matched
  // the buggy production filter instead of the real one, which is exactly
  // what hid this. The `patients` collection object is memoized (rather
  // than rebuilt per `db.collection('patients')` call) so a test can grab a
  // stable reference to `findOne` and assert on the exact filter shape the
  // product code handed it.
  const patientsCollection = {
    findOne: vi.fn(async (filter) => {
      if (filter.participantId && patientsByFilter.patientID === filter.participantId) {
        return patientsByFilter.patient;
      }

      if (filter.cpf && patientsByFilter.cpf === filter.cpf) {
        return patientsByFilter.patient;
      }

      if (filter.recordNumber && patientsByFilter.recordNumber === filter.recordNumber) {
        return patientsByFilter.patient;
      }

      if (filter._id && patientsByFilter._id === String(filter._id)) {
        return patientsByFilter.patient;
      }

      return null;
    }),
  };

  return {
    collection(name) {
      if (name !== 'patients') {
        return {
          findOne: vi.fn().mockResolvedValue(null),
        };
      }

      return patientsCollection;
    },
  };
}

describe('batch-validation-engine.service#buildSampleRow', () => {
  // #767: the same failure mode #525 documents for locationID, on the date
  // column. e2549bee renamed parseSampleRow's registerDate/registrationDate
  // fallback to the canonical registeredAt, but the header map here kept
  // pointing at 'registrationDate' -- a name import-lgpd.service.js has
  // contained zero occurrences of ever since. buildSampleRow is a pure
  // remap and persistSample feeds its output straight into parseSampleRow,
  // so the mapped value was never read and every batch-imported sample fell
  // through to `registeredAt = new Date()`. Asserted end-to-end across the
  // two functions rather than on the mapped key alone, because the mapped
  // key being "right" is exactly what was wrong -- it was right for a
  // consumer that no longer existed.
  it('maps every CSV date header onto the field parseSampleRow actually reads (#767)', () => {
    const importLGPDService = require('../../src/services/import-lgpd.service');

    ['registerdate', 'registrationdate', 'datacoleta'].forEach((header) => {
      const mapped = batchValidationEngine.buildSampleRow({
        [header]: '15/03/2024',
        sampleType: 'Sangue',
      });
      const parsed = importLGPDService.parseSampleRow(mapped);

      expect(parsed.registeredAt.getFullYear(), `header: ${header}`).toBe(2024);
      expect(parsed.registeredAt.getMonth(), `header: ${header}`).toBe(2); // March, 0-indexed
      expect(parsed.registeredAt.getDate(), `header: ${header}`).toBe(15);
    });
  });

  // The #767 failure mode on the participant column: `patientid` mapped onto
  // `patientID`, and parseSampleRow reads only `participantId`, so the id
  // never reached the sample whichever header the file used.
  it('maps every participant id header onto the field parseSampleRow actually reads', () => {
    const importLGPDService = require('../../src/services/import-lgpd.service');

    ['participantId', 'patientID', 'patient_id'].forEach((header) => {
      const mapped = batchValidationEngine.buildSampleRow({ [header]: '12345678', sampleType: 'Sangue' });
      const parsed = importLGPDService.parseSampleRow(mapped);

      expect(parsed.participantId, `header: ${header}`).toBe('12345678');
    });
  });

  // The same failure mode on the specimen column: `sampleid`/`specimenid`
  // mapped onto `sampleID`, which parseSampleRow never reads, so the file's
  // own id was dropped and createSample generated one with no trace of it.
  // It lands in sourceRecordId (v2.0.0 ELM-0011), never in specimenId.
  it('maps every specimen id header onto sourceRecordId, which parseSampleRow reads', () => {
    const importLGPDService = require('../../src/services/import-lgpd.service');

    ['sampleID', 'specimenId', 'specimen_id', 'sourceRecordId'].forEach((header) => {
      const mapped = batchValidationEngine.buildSampleRow({ [header]: ' LIMS-0042 ', sampleType: 'Sangue' });
      const parsed = importLGPDService.parseSampleRow(mapped);

      expect(parsed.sourceRecordId, `header: ${header}`).toBe('LIMS-0042');
      expect(parsed.specimenId, `header: ${header}`).toBeUndefined();
    });
  });

  // The same failure mode on the storage pair, and the one that kept every
  // valid row out: parseSampleRow reads boxId and positionCode, but the
  // header map had no entry for either, so createSample's required-location
  // check rejected every sample the async importer handed it.
  it('maps the boxId and positionCode headers onto the pair parseSampleRow reads', () => {
    const importLGPDService = require('../../src/services/import-lgpd.service');
    const boxId = '64b000000000000000000001';

    [
      { boxId, positionCode: 'A1' },
      { boxid: boxId, position: 'A1' },
      { box_id: boxId, wellPosition: 'A1' },
    ].forEach((row) => {
      const parsed = importLGPDService.parseSampleRow(batchValidationEngine.buildSampleRow({ ...row, sampleType: 'Sangue' }));

      expect(parsed.boxId, JSON.stringify(row)).toBe(boxId);
      expect(parsed.positionCode, JSON.stringify(row)).toBe('A1');
    });
  });

  it('leaves sourceRecordId null when the file carries no specimen id', () => {
    const importLGPDService = require('../../src/services/import-lgpd.service');

    const parsed = importLGPDService.parseSampleRow(batchValidationEngine.buildSampleRow({ sampleType: 'Sangue' }));
    expect(parsed.sourceRecordId).toBeNull();
    expect(importLGPDService.parseSampleRow({ sourceRecordId: '  ' }).sourceRecordId).toBeNull();
    expect(importLGPDService.parseSampleRow({ sourceRecordId: 4217 }).sourceRecordId).toBe('4217');
  });

  // #525: `locationid`/`idlocalizacao` headers used to map onto a
  // `locationID` field that import-lgpd.service.js#parseSampleRow never
  // reads (#459/#462 dropped the legacy field from runtime persistence in
  // favor of boxId/positionCode) — the mapping produced a value that was
  // silently discarded. Pinning that the header map no longer claims to
  // handle these columns at all.
  it('does not map legacy locationid/idlocalizacao headers onto any target field', () => {
    const mapped = batchValidationEngine.buildSampleRow({
      locationid: 'freezer-a1',
      idlocalizacao: 'freezer-a1',
      sampleType: 'Sangue',
    });

    expect(mapped.locationID).toBeUndefined();
    expect(mapped.sampleType).toBe('Sangue');
  });

  // #1536: parseSampleRow reads the eight SPREC keys, and the header map had
  // no entry for any, so every batch-imported sample certified on an
  // all-null SPREC. normalizeHeader folds snake_case and camelCase onto one
  // key, so both forms must reach the parsed sprec.
  it('maps every SPREC header, snake_case and camelCase, onto the field parseSampleRow reads (#1536)', () => {
    const importLGPDService = require('../../src/services/import-lgpd.service');
    const expected = {
      matrixType: 'fluid',
      sampleType: 'BLD',
      primaryContainer: 'SST',
      preCentrifugation: 'A',
      centrifugation: 'A',
      secondCentrifugation: 'A',
      postCentrifugationDelay: 'A',
      longTermStorage: 'C',
    };

    [
      {
        sprec_matrix_type: 'fluid',
        sprec_sample_type: 'BLD',
        sprec_primary_container: 'SST',
        sprec_pre_centrifugation: 'A',
        sprec_centrifugation: 'A',
        sprec_second_centrifugation: 'A',
        sprec_post_centrifugation_delay: 'A',
        sprec_long_term_storage: 'C',
      },
      {
        sprecMatrixType: 'fluid',
        sprecSampleTypeCode: 'BLD',
        sprecPrimaryContainer: 'SST',
        sprecPreCentrifugation: 'A',
        sprecCentrifugation: 'A',
        sprecSecondCentrifugation: 'A',
        sprecPostCentrifugationDelay: 'A',
        sprecLongTermStorage: 'C',
      },
    ].forEach((row) => {
      const parsed = importLGPDService.parseSampleRow(
        batchValidationEngine.buildSampleRow({ ...row, sampleType: 'PLASMA' })
      );

      expect(parsed.sprec, JSON.stringify(row)).toEqual(expected);
    });
  });
});

describe('batch-validation-engine.service', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('classifica arquivo híbrido como samples quando existem marcadores de amostra', () => {
    const result = batchValidationEngine.detectDataType(
      [{ patientName: 'Paciente QA', sampleType: 'Sangue' }],
      'mixed-import.csv'
    );

    expect(result).toBe('samples');
  });

  it('reutiliza paciente existente e persiste specimen e biomarcadores vinculados', async () => {
    const patient = {
      _id: 'patient-object-id-1',
      participantId: '12345678',
      cpf: '12345678901',
      recordNumber: 'RN-001',
    };

    const db = createDb({
      patientID: '12345678',
      patient,
    });

    const createPatientSpy = vi.spyOn(patientService, 'createPatient');
    const createSampleSpy = vi.spyOn(sampleService, 'createSample').mockResolvedValue({
      _id: 'sample-object-id-1',
      specimenId: 'BR-2026-000001',
    });
    const createObservationSpy = vi.spyOn(biomarkerObservationService, 'createObservation').mockResolvedValue({
      _id: 'observation-object-id-1',
    });

    const result = await batchValidationEngine.persistSample(
      db,
      {
        patientID: '12345678',
        sampleType: 'Sangue',
        sampleOrigin: 'Coleta',
        extractionProtocol: 'Protocolo A',
        locationID: 'freezer-a1',
        quantity: '1',
        quality: '1',
        biomarkers: 'alphaGal:12.5',
        registrationDate: '2026-03-19T10:00:00.000Z',
      },
      2
    );

    // #853: the patients collection stores the linkage key as `participantId`
    // (never `patientID` -- see Patient.js's CANONICAL_FIELDS), and an 8-digit
    // patientID column is that canonical participantId. The first criterion
    // findLinkedPatient tries must therefore be filtered on `participantId`,
    // not `patientID`, or an existing patient is never found and this row
    // falls through to the not-found branch instead of linking.
    expect(db.collection('patients').findOne).toHaveBeenCalledWith({ participantId: '12345678' });

    expect(createPatientSpy).not.toHaveBeenCalled();
    expect(createSampleSpy).toHaveBeenCalledTimes(1);
    // createSample and createObservation both refuse a payload without
    // participantId (Sample.validate, BiomarkerObservation.validate), so the
    // linked patient's id has to reach them under that name.
    expect(createSampleSpy).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        participantId: '12345678',
        patientObjectId: 'patient-object-id-1',
      }),
      expect.objectContaining({
        batchImport: true,
        source: 'batch-import',
      })
    );
    expect(createObservationSpy).toHaveBeenCalledTimes(1);
    expect(createObservationSpy).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        participantId: '12345678',
        patientObjectId: 'patient-object-id-1',
        specimenId: 'BR-2026-000001',
        specimenObjectId: 'sample-object-id-1',
        linkedResourceId: 'patient-object-id-1',
      })
    );

    expect(result.classification).toBe('PARTIAL');
    expect(result.persistedIds).toEqual([
      'patient-object-id-1',
      'sample-object-id-1',
      'observation-object-id-1',
    ]);
  });

  it('cria paciente quando a linha de amostra traz dados suficientes e não encontra linkage', async () => {
    const db = createDb();

    const createPatientSpy = vi.spyOn(patientService, 'createPatient').mockResolvedValue({
      _id: 'patient-object-id-2',
      participantId: '87654321',
    });
    const createSampleSpy = vi.spyOn(sampleService, 'createSample').mockResolvedValue({
      _id: 'sample-object-id-2',
      specimenId: 'BR-2026-000002',
    });
    const createObservationSpy = vi.spyOn(biomarkerObservationService, 'createObservation').mockResolvedValue({
      _id: 'observation-object-id-2',
    });

    const result = await batchValidationEngine.persistSample(
      db,
      {
        patientName: 'Paciente Novo',
        birthDate: '1990-01-01',
        sex: 'F',
        email: 'paciente.novo@example.com',
        consentTemplateId: 'template-1',
        sampleType: 'Sangue',
        sampleOrigin: 'Coleta',
        extractionProtocol: 'Protocolo B',
        locationID: 'freezer-b1',
        quantity: '1',
        quality: '1',
        biomarkers: 'lysoGb3:4.2',
      },
      3
    );

    expect(createPatientSpy).toHaveBeenCalledTimes(1);
    expect(createSampleSpy).toHaveBeenCalledTimes(1);
    // The row carries no id; the participantId createPatient generated is the
    // one the specimen and the observation are recorded against.
    expect(createSampleSpy).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ participantId: '87654321' }),
      expect.anything()
    );
    expect(createObservationSpy).toHaveBeenCalledTimes(1);
    expect(createObservationSpy).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ participantId: '87654321', specimenId: 'BR-2026-000002' })
    );
    expect(result.classification).toBe('PARTIAL');
    expect(result.persistedIds).toContain('patient-object-id-2');
    expect(result.persistedIds).toContain('sample-object-id-2');
  });

  // #1376, #1192: the uploader's organization, resolved at upload, stamps the
  // sample and defaults its collection site, as POST /api/samples does.
  it("stamps the uploader's organization on the sample and defaults its collectionSite to it (#1376)", async () => {
    const db = createDb({
      patientID: '12345678',
      patient: { _id: 'patient-object-id-org', participantId: '12345678' },
    });
    const createSampleSpy = vi.spyOn(sampleService, 'createSample').mockResolvedValue({ _id: 'sample-org' });

    const result = await batchValidationEngine.persistSample(
      db,
      { patientID: '12345678', sampleType: 'Sangue', sampleOrigin: 'Coleta', quantity: '1' },
      2,
      { organizationId: 'org-a' }
    );

    expect(result.classification).not.toBe('INVALID');
    expect(createSampleSpy).toHaveBeenCalledTimes(1);
    const [, sampleData, options] = createSampleSpy.mock.calls[0];
    expect(options.organizationId).toBe('org-a');
    expect(options).toMatchObject({ batchImport: true, source: 'batch-import' });
    expect(sampleData.collectionSite).toBe('org-a');
  });

  // RNF018 AC5 (#1524): a JSON row's governanceEvidence references reach
  // createSample, which resolves them before it certifies; a row's own
  // governanceEvidenceResolution never does.
  it("passes a JSON row's governanceEvidence to createSample, which resolves it (RNF018 AC5, #1524)", async () => {
    const db = createDb({
      patientID: '12345678',
      patient: { _id: 'patient-object-id-ev', participantId: '12345678' },
    });
    const createSampleSpy = vi.spyOn(sampleService, 'createSample').mockResolvedValue({ _id: 'sample-ev' });
    const governanceEvidence = {
      documentation: [{ uri: 'urn:bioavanced:collection-governance-approval:appr-1', hash: 'sha256:' + 'a'.repeat(64) }],
    };

    await batchValidationEngine.persistSample(
      db,
      { patientID: '12345678', sampleType: 'Sangue', sampleOrigin: 'Coleta', quantity: '1', governanceEvidence },
      2
    );

    expect(createSampleSpy).toHaveBeenCalledTimes(1);
    expect(createSampleSpy.mock.calls[0][1].governanceEvidence).toEqual({
      documentation: [{ uri: 'urn:bioavanced:collection-governance-approval:appr-1', hash: 'sha256:' + 'a'.repeat(64) }],
    });
  });

  it('passes no governanceEvidence key for a row that presents none (RNF018 AC5, #1524)', async () => {
    const db = createDb({
      patientID: '12345678',
      patient: { _id: 'patient-object-id-ev', participantId: '12345678' },
    });
    const createSampleSpy = vi.spyOn(sampleService, 'createSample').mockResolvedValue({ _id: 'sample-ev' });

    await batchValidationEngine.persistSample(
      db,
      { patientID: '12345678', sampleType: 'Sangue', sampleOrigin: 'Coleta', quantity: '1' },
      2
    );

    expect(createSampleSpy).toHaveBeenCalledTimes(1);
    expect(Object.prototype.hasOwnProperty.call(createSampleSpy.mock.calls[0][1], 'governanceEvidence')).toBe(false);
  });

  it('never passes a governanceEvidenceResolution the row sends (RNF018 AC5, #1524)', async () => {
    const db = createDb({
      patientID: '12345678',
      patient: { _id: 'patient-object-id-ev', participantId: '12345678' },
    });
    const createSampleSpy = vi.spyOn(sampleService, 'createSample').mockResolvedValue({ _id: 'sample-ev' });

    await batchValidationEngine.persistSample(
      db,
      {
        patientID: '12345678',
        sampleType: 'Sangue',
        sampleOrigin: 'Coleta',
        quantity: '1',
        governanceEvidence: {
          documentation: [{ uri: 'urn:bioavanced:collection-governance-approval:appr-1', hash: 'sha256:' + 'a'.repeat(64) }],
        },
        governanceEvidenceResolution: {
          documentation: [{
            uri: 'urn:bioavanced:collection-governance-approval:appr-1',
            hash: 'sha256:' + 'a'.repeat(64),
            status: 'resolved',
          }],
        },
      },
      2
    );

    expect(createSampleSpy).toHaveBeenCalledTimes(1);
    expect(Object.prototype.hasOwnProperty.call(createSampleSpy.mock.calls[0][1], 'governanceEvidenceResolution')).toBe(false);
  });

  // #1376 box 4: the participant's organization is its own decision, so the
  // participant a sample row creates gets none from the upload.
  it('creates the participant with no organizationId while the sample carries it (#1376)', async () => {
    const db = createDb();
    const createPatientSpy = vi.spyOn(patientService, 'createPatient').mockResolvedValue({
      _id: 'patient-object-id-new',
      participantId: '87654321',
    });
    const createSampleSpy = vi.spyOn(sampleService, 'createSample').mockResolvedValue({ _id: 'sample-new' });

    await batchValidationEngine.persistSample(
      db,
      {
        patientName: 'Paciente Org',
        birthDate: '1990-01-01',
        sex: 'F',
        email: 'paciente.org@example.com',
        consentTemplateId: 'template-1',
        sampleType: 'Sangue',
        sampleOrigin: 'Coleta',
        quantity: '1',
      },
      3,
      { organizationId: 'org-a' }
    );

    expect(createPatientSpy).toHaveBeenCalledTimes(1);
    const patientOptions = createPatientSpy.mock.calls[0][2];
    expect(patientOptions).toMatchObject({ batchImport: true, source: 'batch-import' });
    expect(patientOptions).not.toHaveProperty('organizationId');
    expect(createSampleSpy.mock.calls[0][2].organizationId).toBe('org-a');
  });

  it('returns INVALID when required sample fields are missing', async () => {
    const db = createDb();
    const result = await batchValidationEngine.persistSample(db, {}, 4);

    expect(result.classification).toBe('INVALID');
    expect(result.errors).toContain('sampleType é obrigatório');
    expect(result.errors).toContain('sampleOrigin é obrigatório');
    expect(result.errors).toContain('quantity deve ser um número maior que zero');
  });

  it('returns INVALID when disease text is given without a structured ORPHA code', async () => {
    const db = createDb();
    const result = await batchValidationEngine.persistSample(
      db,
      {
        sampleType: 'Sangue',
        sampleOrigin: 'Coleta',
        quantity: '1',
        disease: 'Doença de Fabry',
      },
      6
    );

    expect(result.classification).toBe('INVALID');
    expect(result.errors).toContain('Doenca informada sem codigo ORPHA estruturado (campo orpha/orphaCode).');
  });

  it('returns INVALID when no patient links and the row lacks enough data to create one', async () => {
    const db = createDb();
    const createPatientSpy = vi.spyOn(patientService, 'createPatient');

    const result = await batchValidationEngine.persistSample(
      db,
      {
        sampleType: 'Sangue',
        sampleOrigin: 'Coleta',
        quantity: '1',
      },
      7
    );

    expect(createPatientSpy).not.toHaveBeenCalled();
    expect(result.classification).toBe('INVALID');
    expect(result.errors[0]).toMatch(/Paciente não encontrado/);
  });

  it('links an existing patient from a participantId column, the header the import template uses', async () => {
    const db = createDb({
      patientID: '12345678',
      patient: { _id: 'patient-object-id-6', participantId: '12345678' },
    });
    const createPatientSpy = vi.spyOn(patientService, 'createPatient');
    const createSampleSpy = vi.spyOn(sampleService, 'createSample').mockResolvedValue({
      _id: 'sample-object-id-6',
      specimenId: 'BR-2026-000006',
    });

    const result = await batchValidationEngine.persistSample(
      db,
      {
        participantId: '12345678',
        sampleType: 'Sangue',
        sampleOrigin: 'Coleta',
        quantity: '1',
      },
      10
    );

    expect(db.collection('patients').findOne).toHaveBeenCalledWith({ participantId: '12345678' });
    expect(createPatientSpy).not.toHaveBeenCalled();
    expect(createSampleSpy).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ participantId: '12345678', patientObjectId: 'patient-object-id-6' }),
      expect.anything()
    );
    expect(result.classification).not.toBe('INVALID');
    expect(result.persistedIds).toContain('sample-object-id-6');
  });

  it('hands createSample the file\'s SPREC columns, so the sample certifies on them (#1536)', async () => {
    const { resolveMethodologicalQuality } = require('../../src/services/quality-domain.service');
    const db = createDb({
      patientID: '12345678',
      patient: { _id: 'patient-object-id-1536', participantId: '12345678' },
    });
    const createSampleSpy = vi.spyOn(sampleService, 'createSample').mockResolvedValue({
      _id: 'sample-object-id-1536',
      specimenId: 'BR-2026-001536',
    });

    await batchValidationEngine.persistSample(
      db,
      {
        participantId: '12345678',
        sampleType: 'PLASMA',
        sampleOrigin: 'Coleta',
        quantity: '1',
        sprec_matrix_type: 'fluid',
        sprec_sample_type: 'BLD',
        sprec_primary_container: 'SST',
        sprec_pre_centrifugation: 'A',
        sprec_centrifugation: 'A',
        sprec_second_centrifugation: 'A',
        sprec_post_centrifugation_delay: 'A',
        sprec_long_term_storage: 'C',
      },
      11
    );

    const sprec = createSampleSpy.mock.calls[0][1].sprec;
    expect(sprec).toEqual({
      matrixType: 'fluid',
      sampleType: 'BLD',
      primaryContainer: 'SST',
      preCentrifugation: 'A',
      centrifugation: 'A',
      secondCentrifugation: 'A',
      postCentrifugationDelay: 'A',
      longTermStorage: 'C',
    });

    const quality = resolveMethodologicalQuality({ sprec });
    expect(quality.final_grade).toBe('A');
    expect(quality.rcs_score).toBe(100);
    expect(quality.governance_status).toBe(1);
  });

  // #1497 (RF004 AC2, ELM-0118): a row's collection column reaches
  // createSample, which checks it; a row without one leaves the key unset.
  describe('collectionId column (#1497)', () => {
    const persistWith = async (extraColumns) => {
      const db = createDb({
        patientID: '12345678',
        patient: { _id: 'patient-object-id-1497', participantId: '12345678' },
      });
      const createSampleSpy = vi.spyOn(sampleService, 'createSample').mockResolvedValue({
        _id: 'sample-object-id-1497',
        specimenId: 'BR-2026-001497',
      });
      await batchValidationEngine.persistSample(
        db,
        {
          participantId: '12345678',
          sampleType: 'PLASMA',
          sampleOrigin: 'Coleta',
          quantity: '1',
          ...extraColumns,
        },
        12
      );
      expect(createSampleSpy).toHaveBeenCalledTimes(1);
      return createSampleSpy.mock.calls[0][1];
    };

    it("hands createSample a collectionId header's value trimmed", async () => {
      const sampleData = await persistWith({ collectionId: ' COL-1 ' });
      expect(sampleData.collectionId).toBe('COL-1');
    });

    it('hands createSample a Coleção header as collectionId', async () => {
      const sampleData = await persistWith({ 'Coleção': 'COL-2' });
      expect(sampleData.collectionId).toBe('COL-2');
    });

    it('leaves collectionId unset when the row has no collection column', async () => {
      const sampleData = await persistWith({});
      expect(sampleData).not.toHaveProperty('collectionId');
    });
  });

  it('returns INVALID with the thrown error message when createSample rejects', async () => {
    const db = createDb({
      patientID: '12345678',
      patient: { _id: 'patient-object-id-3', participantId: '12345678' },
    });

    vi.spyOn(sampleService, 'createSample').mockRejectedValue(new Error('storage collision'));

    const result = await batchValidationEngine.persistSample(
      db,
      {
        patientID: '12345678',
        sampleType: 'Sangue',
        sampleOrigin: 'Coleta',
        quantity: '1',
      },
      8
    );

    expect(result.classification).toBe('INVALID');
    expect(result.errors).toEqual(['storage collision']);
  });

  it('returns INVALID with a fallback message when the persist step throws a non-Error value', async () => {
    const db = createDb({
      patientID: '12345678',
      patient: { _id: 'patient-object-id-4', participantId: '12345678' },
    });

    vi.spyOn(sampleService, 'createSample').mockRejectedValue('a plain string rejection');

    const result = await batchValidationEngine.persistSample(
      db,
      {
        patientID: '12345678',
        sampleType: 'Sangue',
        sampleOrigin: 'Coleta',
        quantity: '1',
      },
      9
    );

    expect(result.classification).toBe('INVALID');
    expect(result.errors).toEqual(['Erro ao processar follow-up clínico']);
  });
});

describe('batch-validation-engine.service processBatchImport', () => {
  let tmpDir;

  afterEach(() => {
    vi.restoreAllMocks();
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
    tmpDir = undefined;
  });

  function writeTmpFile(fileName, content) {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-import-'));
    const filePath = path.join(tmpDir, fileName);
    fs.writeFileSync(filePath, content, 'utf8');
    return filePath;
  }

  it('throws when no StagingImport document is found for the jobId', async () => {
    vi.spyOn(StagingImport, 'findOne').mockResolvedValue(null);

    await expect(batchValidationEngine.processBatchImport({}, 'missing-job')).rejects.toThrow(
      'StagingImport não encontrado para jobId missing-job'
    );
  });

  it('throws when the staged file no longer exists on disk', async () => {
    vi.spyOn(StagingImport, 'findOne').mockResolvedValue({
      jobId: 'job-1',
      fileName: 'rows.json',
      rawData: { storagePath: '/nonexistent/path/rows.json' },
    });

    await expect(batchValidationEngine.processBatchImport({}, 'job-1')).rejects.toThrow(
      'Arquivo bruto do staging não encontrado'
    );
  });

  it('throws when the file contains no rows', async () => {
    const filePath = writeTmpFile('empty.json', JSON.stringify([]));
    vi.spyOn(StagingImport, 'findOne').mockResolvedValue({
      jobId: 'job-2',
      fileName: 'empty.json',
      rawData: { storagePath: filePath },
    });
    vi.spyOn(StagingImport, 'updateOne').mockResolvedValue({});

    await expect(batchValidationEngine.processBatchImport({}, 'job-2')).rejects.toThrow(
      'Arquivo não contém registros válidos para processar'
    );
  });

  it('processes a patients JSON file end to end, mixing VALID and INVALID rows', async () => {
    const filePath = writeTmpFile('patients.json', JSON.stringify([
      {
        patientName: 'Ana Silva',
        birthDate: '1990-05-01',
        sex: 'F',
        email: 'ana@example.com',
        consentTemplateId: 'template-1',
      },
      { patientName: 'Sem Dados' },
    ]));

    vi.spyOn(StagingImport, 'findOne').mockResolvedValue({
      jobId: 'job-3',
      fileName: 'patients.json',
      rawData: { storagePath: filePath },
    });
    const updateOneSpy = vi.spyOn(StagingImport, 'updateOne').mockResolvedValue({});
    vi.spyOn(patientService, 'createPatient').mockResolvedValue({ _id: 'new-patient-id' });

    const result = await batchValidationEngine.processBatchImport({}, 'job-3');

    expect(result.dataType).toBe('patients');
    expect(result.totalRows).toBe(2);
    expect(result.processedRows).toBe(2);
    // "Ana Silva" row is missing optional fields (phone/recordNumber/etc.), so
    // classifyPatientRow attaches warnings and it lands PARTIAL rather than VALID.
    expect(result.partialRows).toBe(1);
    expect(result.invalidRows).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.persistedIds).toEqual(['new-patient-id']);

    const finalUpdateCall = updateOneSpy.mock.calls.find(
      ([, update]) => update.$set?.status === 'completed'
    );
    expect(finalUpdateCall).toBeTruthy();
  });

  // #900: every other test in this file spies over StagingImport.updateOne,
  // so a rename of the persisted field to a name the document does not
  // declare would stay green here forever. errors/errorEntry must land on
  // `importErrors`. Under the Mongoose schema (strict) a write elsewhere was
  // silently stripped; the #830 native store throws on it instead.
  it('writes to a field that actually exists on the StagingImport document (#900)', () => {
    const entry = { row: 4, classification: 'INVALID', errors: ['sampleType é obrigatório'] };
    const doc = StagingImport.buildDocument({
      jobId: 'schema-check-batch-validation',
      fileName: 'data.csv',
      status: 'processing',
      totalRows: 1,
      processedRows: 1,
      importErrors: [entry],
      rawData: { storagePath: '/tmp/data.csv' },
    });

    expect(doc.importErrors).toHaveLength(1);
    expect(doc.importErrors[0]).toMatchObject(entry);
    expect(StagingImport.FIELDS).toContain('importErrors');
  });

  it('refuses an update to an undeclared field instead of stripping it (#830)', async () => {
    await expect(
      StagingImport.updateOne({ jobId: 'x' }, { $push: { errors: { row: 1 } } }, { collection: () => ({}) })
    ).rejects.toThrow(/não declarado/);
  });

  // The wiring, not the writer: a quarantine helper nothing calls is exactly
  // the failure this issue is about one level up. Proves processBatchImport
  // hands over the *original row objects*, not the line numbers it already had.
  it('hands the rejected rows, with their data, to the quarantine on a samples import', async () => {
    const goodRow = { participantId: '12345678', sampleType: 'Sangue', sampleOrigin: 'Coleta', barcode: 'B-1' };
    const badRow = { participantId: '87654321', sampleType: '', sampleOrigin: 'Coleta', barcode: 'B-2' };
    const filePath = writeTmpFile('samples.json', JSON.stringify([goodRow, badRow]));

    vi.spyOn(StagingImport, 'findOne').mockResolvedValue({
      jobId: 'job-813-wiring',
      fileName: 'samples.json',
      rawData: { storagePath: filePath },
    });
    vi.spyOn(StagingImport, 'updateOne').mockResolvedValue({});
    vi.spyOn(batchValidationEngine, 'persistSample').mockImplementation(async (db, rawRow) => (
      rawRow.sampleType
        ? { classification: 'VALID', errors: [], warnings: [], persistedId: 'sample-1' }
        : { classification: 'INVALID', errors: ['sampleType é obrigatório'], warnings: [] }
    ));
    const quarantineSpy = vi
      .spyOn(batchValidationEngine, 'quarantineRejectedRows')
      .mockResolvedValue('batch-813-wiring');

    const result = await batchValidationEngine.processBatchImport({}, 'job-813-wiring');

    expect(result.dataType).toBe('samples');
    expect(quarantineSpy).toHaveBeenCalledTimes(1);

    const [, payload] = quarantineSpy.mock.calls[0];
    expect(payload.dataType).toBe('samples');
    expect(payload.jobId).toBe('job-813-wiring');
    expect(payload.fileName).toBe('samples.json');
    expect(payload.rejected).toHaveLength(1);
    expect(payload.rejected[0]).toMatchObject({
      rowNumber: 2,
      errors: ['sampleType é obrigatório'],
      row: badRow,
    });
    // The successful row must not be dragged into quarantine with it.
    expect(payload.rejected[0].row).not.toEqual(goodRow);

    // And the job document points at its own quarantine rather than orphaning it.
    expect(result.quarantineBatchId).toBe('batch-813-wiring');
  });

  // #1376: the worker has no request; the organization staged at upload is
  // the one each sample row is persisted with.
  it('passes the staged rawData.organizationId to persistSample (#1376)', async () => {
    const filePath = writeTmpFile('samples-org.json', JSON.stringify([
      { participantId: '12345678', sampleType: 'Sangue', sampleOrigin: 'Coleta', barcode: 'B-1' },
    ]));

    vi.spyOn(StagingImport, 'findOne').mockResolvedValue({
      jobId: 'job-1376',
      fileName: 'samples-org.json',
      rawData: { storagePath: filePath, organizationId: 'org-a' },
    });
    vi.spyOn(StagingImport, 'updateOne').mockResolvedValue({});
    const persistSpy = vi.spyOn(batchValidationEngine, 'persistSample').mockResolvedValue({
      classification: 'VALID', errors: [], warnings: [], persistedId: 'sample-1',
    });

    await batchValidationEngine.processBatchImport({}, 'job-1376');

    expect(persistSpy).toHaveBeenCalledTimes(1);
    expect(persistSpy.mock.calls[0][3]).toEqual({ organizationId: 'org-a' });
  });

  // #1385: the quarantine batch carries the organization staged at upload.
  it('passes the staged rawData.organizationId to quarantineRejectedRows (#1385)', async () => {
    const filePath = writeTmpFile('samples-org-quarantine.json', JSON.stringify([
      { participantId: '87654321', sampleType: '', sampleOrigin: 'Coleta', barcode: 'B-2' },
    ]));

    vi.spyOn(StagingImport, 'findOne').mockResolvedValue({
      jobId: 'job-1385',
      fileName: 'samples-org-quarantine.json',
      rawData: { storagePath: filePath, organizationId: 'org-a' },
    });
    vi.spyOn(StagingImport, 'updateOne').mockResolvedValue({});
    vi.spyOn(batchValidationEngine, 'persistSample').mockResolvedValue({
      classification: 'INVALID', errors: ['sampleType é obrigatório'], warnings: [],
    });
    const quarantineSpy = vi
      .spyOn(batchValidationEngine, 'quarantineRejectedRows')
      .mockResolvedValue('batch-1385');

    await batchValidationEngine.processBatchImport({}, 'job-1385');

    expect(quarantineSpy).toHaveBeenCalledTimes(1);
    expect(quarantineSpy.mock.calls[0][1].organizationId).toBe('org-a');
  });

  it('does not open a quarantine batch when every row succeeded', async () => {
    const filePath = writeTmpFile('samples-clean.json', JSON.stringify([
      { participantId: '12345678', sampleType: 'Sangue', sampleOrigin: 'Coleta', barcode: 'B-1' },
    ]));

    vi.spyOn(StagingImport, 'findOne').mockResolvedValue({
      jobId: 'job-813-clean',
      fileName: 'samples-clean.json',
      rawData: { storagePath: filePath },
    });
    vi.spyOn(StagingImport, 'updateOne').mockResolvedValue({});
    vi.spyOn(batchValidationEngine, 'persistSample').mockResolvedValue({
      classification: 'VALID', errors: [], warnings: [], persistedId: 'sample-1',
    });
    const quarantineSpy = vi.spyOn(batchValidationEngine, 'quarantineRejectedRows');

    const result = await batchValidationEngine.processBatchImport({}, 'job-813-clean');

    expect(result.invalidRows).toBe(0);
    // Called (unconditionally, with an empty list) but must open no batch --
    // asserting the *outcome* rather than the call keeps this true whichever
    // way the guard is arranged.
    expect(result.quarantineBatchId).toBeUndefined();
    for (const call of quarantineSpy.mock.calls) {
      expect(call[1].rejected).toEqual([]);
    }
  });

  it('marks the job failed when every row is invalid', async () => {
    const filePath = writeTmpFile('patients-invalid.json', JSON.stringify([
      { patientName: 'Sem Dados' },
    ]));

    vi.spyOn(StagingImport, 'findOne').mockResolvedValue({
      jobId: 'job-4',
      fileName: 'patients-invalid.json',
      rawData: { storagePath: filePath },
    });
    const updateOneSpy = vi.spyOn(StagingImport, 'updateOne').mockResolvedValue({});

    const result = await batchValidationEngine.processBatchImport({}, 'job-4');

    expect(result.validRows).toBe(0);
    expect(result.invalidRows).toBe(1);

    const finalUpdateCall = updateOneSpy.mock.calls.find(
      ([, update]) => update.$set?.status === 'failed'
    );
    expect(finalUpdateCall).toBeTruthy();
  });

  it('reports progress via job.updateProgress when a job is supplied', async () => {
    const filePath = writeTmpFile('patients-progress.json', JSON.stringify([
      {
        patientName: 'Ana Silva',
        birthDate: '1990-05-01',
        sex: 'F',
        email: 'ana@example.com',
        consentTemplateId: 'template-1',
      },
    ]));

    vi.spyOn(StagingImport, 'findOne').mockResolvedValue({
      jobId: 'job-5',
      fileName: 'patients-progress.json',
      rawData: { storagePath: filePath },
    });
    vi.spyOn(StagingImport, 'updateOne').mockResolvedValue({});
    vi.spyOn(patientService, 'createPatient').mockResolvedValue({ _id: 'new-patient-id' });

    const updateProgress = vi.fn().mockResolvedValue();
    await batchValidationEngine.processBatchImport({}, 'job-5', { updateProgress });

    expect(updateProgress).toHaveBeenCalledWith(100);
  });

  // #1041: readXlsxRows carries the true sheet row on `rows.sourceLines`;
  // processBatchImport must prefer it over the plain array-position
  // arithmetic (start + offset + rowBaseNumber), which drifts as soon as a
  // blank sheet row doesn't occupy an array slot. Without the fix this row's
  // reported number would be 3 (array position: the surviving invalid row is
  // at array index 1, +2 base = 3), which names no row in the sheet -- the
  // blank row occupies sheet row 3, so the invalid row is actually sheet row 4.
  it('reports the true sheet row number for an XLSX import with an interior blank row (#1041)', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-import-xlsx-'));
    const filePath = path.join(tmpDir, 'patients.xlsx');
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Pacientes');
    worksheet.addRow(['patientName', 'birthDate', 'sex', 'email', 'consentTemplateId']);
    worksheet.addRow(['Ana Silva', '1990-05-01', 'F', 'ana@example.com', 'template-1']);
    worksheet.addRow([null, null, null, null, null]);
    worksheet.addRow(['Sem Dados', null, null, null, null]);
    await workbook.xlsx.writeFile(filePath);

    vi.spyOn(StagingImport, 'findOne').mockResolvedValue({
      jobId: 'job-1041',
      fileName: 'patients.xlsx',
      rawData: { storagePath: filePath },
    });
    vi.spyOn(StagingImport, 'updateOne').mockResolvedValue({});
    vi.spyOn(patientService, 'createPatient').mockResolvedValue({ _id: 'new-patient-id' });

    const result = await batchValidationEngine.processBatchImport({}, 'job-1041');

    expect(result.totalRows).toBe(2);
    expect(result.errors).toHaveLength(1);
    // Sheet row 4, not the array-ordinal 3 the pre-#1041 arithmetic gave.
    // Numeric, because this same value becomes
    // import_staging_records.rowNumber, which getQuarantineBatch sorts.
    expect(result.errors[0].row).toBe(4);
    expect(result.errors[0].sheet).toBe('Pacientes');
  });

  it('processes a samples JSON file end to end with a fully-valid, warning-free row', async () => {
    const filePath = writeTmpFile('samples.json', JSON.stringify([
      {
        patientID: '12345678',
        sampleType: 'Sangue',
        sampleOrigin: 'Coleta',
        extractionProtocol: 'Protocolo A',
        quantity: '1',
      },
    ]));

    vi.spyOn(StagingImport, 'findOne').mockResolvedValue({
      jobId: 'job-6',
      fileName: 'samples.json',
      rawData: { storagePath: filePath },
    });
    vi.spyOn(StagingImport, 'updateOne').mockResolvedValue({});
    const db = createDb({
      patientID: '12345678',
      patient: { _id: 'patient-object-id-5', participantId: '12345678' },
    });
    vi.spyOn(sampleService, 'createSample').mockResolvedValue({ _id: 'sample-object-id-5' });

    const result = await batchValidationEngine.processBatchImport(db, 'job-6');

    expect(result.dataType).toBe('samples');
    expect(result.validRows).toBe(1);
    expect(result.partialRows).toBe(0);
    expect(result.invalidRows).toBe(0);
  });
});

// #813 (RNF011 AC#4 / RF029 AC#6): the importer an operator actually reaches
// -- /import -> POST /api/import/batch -> this engine -- classified rows
// VALID/PARTIAL/INVALID and pushed `{row: <line number>, errors}` onto
// StagingImport.importErrors. The field is named `row` but holds an integer, so the
// rejected row's *data* was never persisted anywhere: an operator could read
// what was wrong with a row but never see, correct or resubmit the row itself.
// That is "closer to a well-organised log than to staging" (#794).
describe('#813 quarantine of rejected rows', () => {
  function quarantineDb() {
    const importBatches = {
      insertOne: vi.fn(async (doc) => ({ insertedId: doc._id })),
    };
    const stagingRecords = {
      insertMany: vi.fn(async (docs) => ({ insertedCount: docs.length })),
      deleteMany: vi.fn(async () => ({ deletedCount: 0 })),
    };
    const db = {
      collection: vi.fn((name) => {
        if (name === 'import_batches') return importBatches;
        if (name === 'import_staging_records') return stagingRecords;
        return { findOne: vi.fn().mockResolvedValue(null), insertOne: vi.fn(), insertMany: vi.fn() };
      }),
    };
    return { db, importBatches, stagingRecords };
  }

  const REJECTED = [
    {
      rowNumber: 2,
      row: { participantId: '12345678', sampleType: 'NOPE' },
      errors: ['sampleType inválido'],
    },
    {
      rowNumber: 5,
      row: { participantId: '87654321', sampleType: '' },
      errors: ['sampleType é obrigatório'],
    },
  ];

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('writes one import_batches document describing the quarantined batch', async () => {
    const { db, importBatches } = quarantineDb();

    const batchId = await batchValidationEngine.quarantineRejectedRows(db, {
      jobId: 'job-813',
      dataType: 'samples',
      fileName: 'amostras.csv',
      rejected: REJECTED,
      counts: { total: 10, success: 8 },
    });

    expect(importBatches.insertOne).toHaveBeenCalledTimes(1);
    const doc = importBatches.insertOne.mock.calls[0][0];
    expect(batchId).toBe(doc._id);
    expect(doc).toMatchObject({
      status: 'QUARANTINED',
      source: 'ASYNC_BATCH',
      fileName: 'amostras.csv',
      jobId: 'job-813',
      counts: { total: 10, success: 8, errors: 2 },
    });
    // #799: import_batches is shared with the LGPD and FHIR importers, whose
    // readers filter on `type`. A batch from this importer must be
    // distinguishable, not silently listed as one of theirs.
    expect(doc.type).toBe('ASYNC_BATCH_IMPORT');
    expect(doc.type).not.toBe('LGPD_SAMPLE_CSV');
  });

  it('writes one staging record per rejected row, carrying the original row data', async () => {
    const { db, stagingRecords } = quarantineDb();

    const batchId = await batchValidationEngine.quarantineRejectedRows(db, {
      jobId: 'job-813',
      dataType: 'samples',
      fileName: 'amostras.csv',
      rejected: REJECTED,
      counts: { total: 10, success: 8 },
    });

    expect(stagingRecords.insertMany).toHaveBeenCalledTimes(1);
    const stored = stagingRecords.insertMany.mock.calls[0][0];
    // #807: sealed at rest -- no row value in the stored document.
    expect(JSON.stringify(stored)).not.toContain('NOPE');
    expect(stored[0].sealedPayload).toMatchObject({ alg: 'aes-256-gcm' });
    const docs = stored.map(revealStagedRecord);
    expect(docs).toHaveLength(2);
    expect(docs[0].batchId).toBe(batchId);
    expect(docs[0]).toMatchObject({
      rowNumber: 2,
      status: 'ERROR',
      errors: ['sampleType inválido'],
      // The whole point: the row itself, not just its line number.
      row: { participantId: '12345678', sampleType: 'NOPE' },
    });
    expect(docs[1].rowNumber).toBe(5);
    expect(docs[1].row).toEqual({ participantId: '87654321', sampleType: '' });
  });

  // #1385: the batch and each of its rows carry the uploader's organization.
  it('#1385: stamps organizationId on the batch document and every row', async () => {
    const { db, importBatches, stagingRecords } = quarantineDb();

    await batchValidationEngine.quarantineRejectedRows(db, {
      jobId: 'job-1385',
      dataType: 'samples',
      fileName: 'amostras.csv',
      rejected: REJECTED,
      counts: { total: 10, success: 8 },
      organizationId: 'org-a',
    });

    expect(importBatches.insertOne.mock.calls[0][0].organizationId).toBe('org-a');
    const rows = stagingRecords.insertMany.mock.calls[0][0];
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.organizationId).toBe('org-a');
    }
  });

  it('#1385: stamps organizationId null when none is given', async () => {
    const { db, importBatches, stagingRecords } = quarantineDb();

    await batchValidationEngine.quarantineRejectedRows(db, {
      jobId: 'job-1385',
      dataType: 'samples',
      fileName: 'amostras.csv',
      rejected: REJECTED,
      counts: { total: 10, success: 8 },
    });

    expect(importBatches.insertOne.mock.calls[0][0].organizationId).toBeNull();
    for (const row of stagingRecords.insertMany.mock.calls[0][0]) {
      expect(row.organizationId).toBeNull();
    }
  });

  it('writes nothing when no row was rejected', async () => {
    const { db, importBatches, stagingRecords } = quarantineDb();

    const batchId = await batchValidationEngine.quarantineRejectedRows(db, {
      jobId: 'job-813',
      dataType: 'samples',
      fileName: 'amostras.csv',
      rejected: [],
      counts: { total: 10, success: 10 },
    });

    expect(batchId).toBeNull();
    expect(importBatches.insertOne).not.toHaveBeenCalled();
    expect(stagingRecords.insertMany).not.toHaveBeenCalled();
  });

  // #813's patients half, unblocked by #807: a patient row carries
  // patientName/birthDate/email, so it is quarantined like a sample row but
  // sealed at rest, as participantIdentities stores the same values (#566).
  it('quarantines patient rows too, with the civil values sealed at rest', async () => {
    const { db, importBatches, stagingRecords } = quarantineDb();

    const batchId = await batchValidationEngine.quarantineRejectedRows(db, {
      jobId: 'job-813',
      dataType: 'patients',
      fileName: 'pacientes.csv',
      rejected: [{ rowNumber: 2, row: { patientName: 'Maria Souza', birthDate: '01/01/1990' }, errors: ['x'] }],
      counts: { total: 3, success: 2 },
    });

    expect(batchId).toBe(importBatches.insertOne.mock.calls[0][0]._id);
    expect(importBatches.insertOne.mock.calls[0][0]).toMatchObject({ type: 'ASYNC_BATCH_IMPORT', dataType: 'patients' });
    const stored = stagingRecords.insertMany.mock.calls[0][0];
    expect(stored).toHaveLength(1);
    expect(JSON.stringify(stored)).not.toContain('Maria Souza');
    expect(JSON.stringify(stored)).not.toContain('01/01/1990');
    expect(stored[0]).toMatchObject({ rowNumber: 2, status: 'ERROR', errors: ['x'] });
    expect(revealStagedRecord(stored[0]).row).toEqual({ patientName: 'Maria Souza', birthDate: '01/01/1990' });
  });

  // Quarantine is a record-keeping step appended to an import that already
  // ran. A failure to write it must not turn a partially-successful import
  // into a failed one -- same posture as the LGPD path's own writer.
  // #1295: the batch was written before its rows, so a reader that found the
  // batch (the e2e spec polling by jobId, or the quarantine route) could read
  // it with no rows yet. The rows go first; the batch makes them visible.
  it('writes the staging rows before the batch that points at them', async () => {
    const { db, importBatches, stagingRecords } = quarantineDb();

    const batchId = await batchValidationEngine.quarantineRejectedRows(db, {
      jobId: 'job-1295',
      dataType: 'samples',
      fileName: 'amostras.csv',
      rejected: REJECTED,
      counts: { total: 10, success: 8 },
    });

    expect(stagingRecords.insertMany.mock.invocationCallOrder[0]).toBeLessThan(
      importBatches.insertOne.mock.invocationCallOrder[0]
    );
    expect(revealStagedRecord(stagingRecords.insertMany.mock.calls[0][0][0]).batchId).toBe(batchId);
  });

  it('removes the written rows when the batch itself cannot be written', async () => {
    const { db, importBatches, stagingRecords } = quarantineDb();
    importBatches.insertOne.mockRejectedValue(new Error('mongo down'));

    const batchId = await batchValidationEngine.quarantineRejectedRows(db, {
      jobId: 'job-1295',
      dataType: 'samples',
      fileName: 'amostras.csv',
      rejected: REJECTED,
      counts: { total: 10, success: 8 },
    });

    expect(batchId).toBeNull();
    const stagedBatchId = revealStagedRecord(stagingRecords.insertMany.mock.calls[0][0][0]).batchId;
    expect(stagingRecords.deleteMany).toHaveBeenCalledWith({ batchId: stagedBatchId });
  });

  it('swallows a staging failure instead of failing the import', async () => {
    const { db, importBatches } = quarantineDb();
    importBatches.insertOne.mockRejectedValue(new Error('mongo down'));

    await expect(
      batchValidationEngine.quarantineRejectedRows(db, {
        jobId: 'job-813',
        dataType: 'samples',
        fileName: 'amostras.csv',
        rejected: REJECTED,
        counts: { total: 10, success: 8 },
      })
    ).resolves.toBeNull();
  });
});

// #939: nothing could read an ASYNC_BATCH_IMPORT quarantine batch back --
// the LGPD and FHIR readers both filter to their own `type`. These tests
// pin getQuarantineBatch, the by-id reader added for this importer, mirroring
// fhir-import-staging.batchTypeIsolation.unit.test.js's approach of
// asserting on the filter object handed to the driver rather than on a
// canned return value.
describe('#939 reading a quarantined ASYNC_BATCH_IMPORT batch back', () => {
  function createReaderDb(seedDocs = []) {
    const batchDocs = seedDocs.filter((doc) => doc.__collection === 'import_batches');
    const recordDocs = seedDocs.filter((doc) => doc.__collection === 'import_staging_records');

    const importBatches = {
      findOne: vi.fn(async (filter = {}) => {
        return (
          batchDocs.find((doc) =>
            Object.entries(filter).every(([key, value]) => String(doc[key]) === String(value))
          ) || null
        );
      }),
    };

    const importStagingRecords = {
      find: vi.fn((filter = {}) => {
        const matched = recordDocs
          .filter((doc) => Object.entries(filter).every(([key, value]) => String(doc[key]) === String(value)))
          .slice()
          .sort((a, b) => a.rowNumber - b.rowNumber);
        return {
          sort: vi.fn().mockReturnThis(),
          toArray: vi.fn(async () => matched),
        };
      }),
    };

    const db = {
      collection: vi.fn((name) => {
        if (name === 'import_batches') return importBatches;
        if (name === 'import_staging_records') return importStagingRecords;
        return { findOne: vi.fn().mockResolvedValue(null), find: vi.fn() };
      }),
    };

    return { db, importBatches, importStagingRecords };
  }

  it("queries import_batches with { type: 'ASYNC_BATCH_IMPORT' }, not just _id", async () => {
    const batchId = new ObjectId();
    const { db, importBatches } = createReaderDb([
      { __collection: 'import_batches', _id: batchId, type: 'ASYNC_BATCH_IMPORT', status: 'QUARANTINED' },
    ]);

    const result = await batchValidationEngine.getQuarantineBatch(db, String(batchId));

    expect(result.batch.status).toBe('QUARANTINED');
    expect(importBatches.findOne).toHaveBeenCalledTimes(1);
    const [filter] = importBatches.findOne.mock.calls[0];
    expect(filter).toMatchObject({ type: 'ASYNC_BATCH_IMPORT' });
    expect(String(filter._id)).toBe(String(batchId));
  });

  // #799's failure mode in the opposite direction: a batch belonging to
  // another importer must not be readable through this endpoint.
  it('404s on a batch of a different type instead of returning it', async () => {
    const batchId = new ObjectId();
    const { db } = createReaderDb([
      { __collection: 'import_batches', _id: batchId, type: 'LGPD_SAMPLE_CSV', status: 'QUARANTINED' },
    ]);

    await expect(batchValidationEngine.getQuarantineBatch(db, String(batchId))).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it('returns import_staging_records rows sorted by rowNumber', async () => {
    const batchId = new ObjectId();
    const { db, importStagingRecords } = createReaderDb([
      { __collection: 'import_batches', _id: batchId, type: 'ASYNC_BATCH_IMPORT', status: 'QUARANTINED' },
      { __collection: 'import_staging_records', _id: new ObjectId(), batchId, rowNumber: 5 },
      { __collection: 'import_staging_records', _id: new ObjectId(), batchId, rowNumber: 2 },
    ]);

    const { records } = await batchValidationEngine.getQuarantineBatch(db, String(batchId));

    expect(records.map((record) => record.rowNumber)).toEqual([2, 5]);
    expect(importStagingRecords.find.mock.results[0].value.sort).toHaveBeenCalledWith({ rowNumber: 1 });
  });

  // #807: rows are sealed at rest; the reader hands them back as staged, and
  // a row staged before #807 (plaintext) reads back unchanged.
  it('unseals the staged row for the reader, and passes a legacy row through', async () => {
    const batchId = new ObjectId();
    const sealed = sealStagedRecord({ batchId, rowNumber: 2, status: 'ERROR', row: { patientName: 'Maria Souza' } });
    const { db } = createReaderDb([
      { __collection: 'import_batches', _id: batchId, type: 'ASYNC_BATCH_IMPORT', status: 'QUARANTINED' },
      { __collection: 'import_staging_records', ...sealed },
      { __collection: 'import_staging_records', batchId, rowNumber: 5, status: 'ERROR', row: { participantId: '1' } },
    ]);

    const { records } = await batchValidationEngine.getQuarantineBatch(db, String(batchId));

    expect(records[0].row).toEqual({ patientName: 'Maria Souza' });
    expect(records[0]).not.toHaveProperty('sealedPayload');
    expect(records[1].row).toEqual({ participantId: '1' });
  });

  // #1385: an organization scope reaches only a batch stamped with one of
  // its organizations; an unstamped batch only global scope reaches; no
  // scope passed is an internal caller.
  it('#1385: 403s an org-b scope on an org-a batch', async () => {
    const batchId = new ObjectId();
    const { db, importStagingRecords } = createReaderDb([
      { __collection: 'import_batches', _id: batchId, type: 'ASYNC_BATCH_IMPORT', status: 'QUARANTINED', organizationId: 'org-a' },
    ]);

    await expect(
      batchValidationEngine.getQuarantineBatch(db, String(batchId), {
        organizationScope: { scope: 'organization', organizationIds: ['org-b'] },
      })
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(importStagingRecords.find).not.toHaveBeenCalled();
  });

  it('#1385: 403s an organization scope on an unstamped (legacy) batch', async () => {
    const batchId = new ObjectId();
    const { db } = createReaderDb([
      { __collection: 'import_batches', _id: batchId, type: 'ASYNC_BATCH_IMPORT', status: 'QUARANTINED' },
    ]);

    await expect(
      batchValidationEngine.getQuarantineBatch(db, String(batchId), {
        organizationScope: { scope: 'organization', organizationIds: ['org-a'] },
      })
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it('#1385: an org-a scope reads its org-a batch, and global and no scope read any batch', async () => {
    const stampedId = new ObjectId();
    const legacyId = new ObjectId();
    const { db } = createReaderDb([
      { __collection: 'import_batches', _id: stampedId, type: 'ASYNC_BATCH_IMPORT', status: 'QUARANTINED', organizationId: 'org-a' },
      { __collection: 'import_batches', _id: legacyId, type: 'ASYNC_BATCH_IMPORT', status: 'QUARANTINED' },
    ]);
    const orgA = { scope: 'organization', organizationIds: ['org-a'] };
    const global = { scope: 'global', organizationIds: [] };

    await expect(batchValidationEngine.getQuarantineBatch(db, String(stampedId), { organizationScope: orgA }))
      .resolves.toMatchObject({ batch: { organizationId: 'org-a' } });
    await expect(batchValidationEngine.getQuarantineBatch(db, String(legacyId), { organizationScope: global }))
      .resolves.toMatchObject({ batch: { status: 'QUARANTINED' } });
    await expect(batchValidationEngine.getQuarantineBatch(db, String(legacyId)))
      .resolves.toMatchObject({ batch: { status: 'QUARANTINED' } });
  });

  it('#1385: 404 stays ahead of 403 for a batch of another type', async () => {
    const batchId = new ObjectId();
    const { db } = createReaderDb([
      { __collection: 'import_batches', _id: batchId, type: 'LGPD_SAMPLE_CSV', status: 'QUARANTINED' },
    ]);

    await expect(
      batchValidationEngine.getQuarantineBatch(db, String(batchId), {
        organizationScope: { scope: 'organization', organizationIds: ['org-b'] },
      })
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('400s on an id that is not a valid ObjectId', async () => {
    const { db } = createReaderDb([]);

    await expect(batchValidationEngine.getQuarantineBatch(db, 'not-an-object-id')).rejects.toMatchObject({
      statusCode: 400,
    });
  });
});

// Follows the route-registration idiom cited at import-lgpd.controller.test.js
// (~835-861): inspect router.stack for the registered path. That idiom alone
// only proves the path exists, not which permission code gates it -- since
// requirePermission('X') returns a fresh anonymous closure per call, the
// closure itself carries no visible trace of X. To pin the gate itself
// (not just that *a* gate is present), this spies on
// rbac-assignment.service#userHasPermission -- the one place the captured
// `permission` argument actually surfaces -- before import.routes.js (and
// the rbac.js it requires) load for the first time in this file, then
// drives the registered handler chain through a request an authenticated
// user with no granted permissions would send.
describe('#939 GET /batch/quarantine/:id route registration', () => {
  it('routes GET /batch/quarantine/:id, and its permission gate checks uploadFiles specifically', async () => {
    const rbacAssignmentService = require('../../src/services/rbac-assignment.service');
    const userHasPermissionSpy = vi.spyOn(rbacAssignmentService, 'userHasPermission').mockResolvedValue(false);

    const router = require('../../src/interface/routes/import.routes');

    const layer = router.stack.find(
      (item) => item.route && item.route.path === '/batch/quarantine/:id' && item.route.methods.get
    );
    expect(layer).toBeTruthy();
    // authenticate, requirePermission('uploadFiles'), requireOrganizationScope
    // (#1385), the controller handler.
    expect(layer.route.stack).toHaveLength(4);

    const req = { method: 'GET', user: { userID: 'user-939' }, app: { locals: { db: {} } } };
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();

    // Middleware [0] is `authenticate`; invoking it would require a real JWT.
    // req.user is set directly above to stand in for what `authenticate`
    // would attach, so only the permission gate (index 1) is driven here.
    await layer.route.stack[1].handle(req, res, next);

    expect(userHasPermissionSpy).toHaveBeenCalledWith(req.app.locals.db, 'user-939', 'uploadFiles');
    // mockResolvedValue(false) above means the gate must have denied, not
    // called next() -- proves the mock was actually consulted, not bypassed.
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);

    userHasPermissionSpy.mockRestore();
  });
});
