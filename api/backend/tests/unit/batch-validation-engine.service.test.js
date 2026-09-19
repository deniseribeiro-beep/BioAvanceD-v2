import { afterEach, describe, expect, it, vi } from 'vitest';
const fs = require('fs');
const os = require('os');
const path = require('path');
const ExcelJS = require('exceljs');
const { ObjectId } = require('mongodb');

const batchValidationEngine = require('../../src/services/batch-validation-engine.service');
const patientService = require('../../src/services/patient.service');
const sampleService = require('../../src/services/sample.service');
const biomarkerObservationService = require('../../src/services/biomarker-observation.service');
const StagingImport = require('../../src/models/StagingImport');

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
      patientID: '12345678',
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
      sampleID: 'sample-001',
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
    expect(createSampleSpy).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        patientID: '12345678',
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
        patientID: '12345678',
        patientObjectId: 'patient-object-id-1',
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
      patientID: '87654321',
    });
    const createSampleSpy = vi.spyOn(sampleService, 'createSample').mockResolvedValue({
      _id: 'sample-object-id-2',
      sampleID: 'sample-002',
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
    expect(createObservationSpy).toHaveBeenCalledTimes(1);
    expect(result.classification).toBe('PARTIAL');
    expect(result.persistedIds).toContain('patient-object-id-2');
    expect(result.persistedIds).toContain('sample-object-id-2');
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

  it('returns INVALID with the thrown error message when createSample rejects', async () => {
    const db = createDb({
      patientID: '12345678',
      patient: { _id: 'patient-object-id-3', patientID: '12345678' },
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
      patient: { _id: 'patient-object-id-4', patientID: '12345678' },
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
  // so a rename of the persisted field to a name the schema does not declare
  // would stay green here forever -- the schema never runs. This one goes
  // through the real model instead (mirrors
  // tests/unit/staging-import.service.test.js:179-192, which pins the same
  // failure mode for the sibling service): errors/errorEntry must land on
  // `importErrors`, the field the StagingImport schema (strict: true)
  // actually declares, or Mongoose silently strips the whole $push.
  it('writes to a field that actually exists on the StagingImport schema (#900)', () => {
    const entry = { row: 4, classification: 'INVALID', errors: ['sampleType é obrigatório'] };
    const doc = new StagingImport({
      jobId: 'schema-check-batch-validation',
      fileName: 'data.csv',
      status: 'processing',
      totalRows: 1,
      processedRows: 1,
      importErrors: [entry],
      rawData: { storagePath: '/tmp/data.csv' },
    });

    expect(doc.toObject().importErrors).toHaveLength(1);
    expect(doc.toObject().importErrors[0]).toMatchObject(entry);
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
      patient: { _id: 'patient-object-id-5', patientID: '12345678' },
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
      insertOne: vi.fn(async () => ({ insertedId: 'batch-813' })),
    };
    const stagingRecords = {
      insertMany: vi.fn(async (docs) => ({ insertedCount: docs.length })),
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

    expect(batchId).toBe('batch-813');
    expect(importBatches.insertOne).toHaveBeenCalledTimes(1);
    const doc = importBatches.insertOne.mock.calls[0][0];
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

    await batchValidationEngine.quarantineRejectedRows(db, {
      jobId: 'job-813',
      dataType: 'samples',
      fileName: 'amostras.csv',
      rejected: REJECTED,
      counts: { total: 10, success: 8 },
    });

    expect(stagingRecords.insertMany).toHaveBeenCalledTimes(1);
    const docs = stagingRecords.insertMany.mock.calls[0][0];
    expect(docs).toHaveLength(2);
    expect(docs[0]).toMatchObject({
      batchId: 'batch-813',
      rowNumber: 2,
      status: 'ERROR',
      errors: ['sampleType inválido'],
      // The whole point: the row itself, not just its line number.
      row: { participantId: '12345678', sampleType: 'NOPE' },
    });
    expect(docs[1].rowNumber).toBe(5);
    expect(docs[1].row).toEqual({ participantId: '87654321', sampleType: '' });
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

  // #807/#814: a patient row carries patientName/birthDate/email -- civil
  // identifiers, which are encrypted at rest everywhere else (#566). Staging
  // them here would widen a known plaintext-at-rest problem to the most
  // sensitive of the import paths, which is exactly what #814 says to settle
  // (via #807) before quarantining a patient path. Samples are pseudonymous
  // (participantId), which is why #787 was able to quarantine them.
  it('refuses to quarantine patient rows while #807 is open', async () => {
    const { db, importBatches, stagingRecords } = quarantineDb();

    const batchId = await batchValidationEngine.quarantineRejectedRows(db, {
      jobId: 'job-813',
      dataType: 'patients',
      fileName: 'pacientes.csv',
      rejected: [{ rowNumber: 2, row: { patientName: 'Maria', birthDate: '01/01/1990' }, errors: ['x'] }],
      counts: { total: 3, success: 2 },
    });

    expect(batchId).toBeNull();
    expect(importBatches.insertOne).not.toHaveBeenCalled();
    expect(stagingRecords.insertMany).not.toHaveBeenCalled();
  });

  // Quarantine is a record-keeping step appended to an import that already
  // ran. A failure to write it must not turn a partially-successful import
  // into a failed one -- same posture as the LGPD path's own writer.
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
    // authenticate, requirePermission('uploadFiles'), the controller handler.
    expect(layer.route.stack).toHaveLength(3);

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

describe('batch-validation-engine.service item 8 attempt/progress residuals', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('records a non-final failed attempt without prematurely marking the import failed', async () => {
    const updateOne = vi.spyOn(StagingImport, 'updateOne').mockResolvedValue({});

    await batchValidationEngine.recordAttemptFailure('job-retry', {
      attemptNumber: 1,
      attemptsAllowed: 3,
      message: 'temporary database failure',
    });

    expect(updateOne).toHaveBeenCalledWith(
      { jobId: 'job-retry' },
      {
        $set: {
          status: 'processing',
          updatedAt: expect.any(Date),
        },
        $push: {
          importErrors: {
            message: 'Tentativa 1/3 falhou: temporary database failure',
            occurredAt: expect.any(Date),
          },
        },
      }
    );
  });

  it('marks the last allowed attempt failed and preserves the fallback error message', async () => {
    const updateOne = vi.spyOn(StagingImport, 'updateOne').mockResolvedValue({});

    await batchValidationEngine.recordAttemptFailure('job-final', {
      attemptNumber: 3,
      attemptsAllowed: 3,
    });

    expect(updateOne).toHaveBeenCalledWith(
      { jobId: 'job-final' },
      expect.objectContaining({
        $set: expect.objectContaining({ status: 'failed' }),
        $push: {
          importErrors: expect.objectContaining({
            message: 'Tentativa 3/3 falhou: erro desconhecido',
            occurredAt: expect.any(Date),
          }),
        },
      })
    );
  });

  it('returns null without persistence when rejected rows exist but no database handle is available', async () => {
    const result = await batchValidationEngine.quarantineRejectedRows(null, {
      jobId: 'job-no-db',
      dataType: 'samples',
      rejected: [{ rowNumber: 2, row: { sampleType: '' }, errors: ['sampleType é obrigatório'] }],
    });

    expect(result).toBeNull();
  });
});

