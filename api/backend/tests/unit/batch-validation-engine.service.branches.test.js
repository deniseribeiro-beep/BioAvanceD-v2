import { afterEach, describe, expect, it, vi } from 'vitest';
// #1337: the arms of batch-validation-engine.service.js its other test files
// leave unrun -- absent optional values, empty ids, errors with no message.
// Loaded with `require`, like every other test of this service.
const fs = require('fs');
const os = require('os');
const path = require('path');
const ExcelJS = require('exceljs');
const { ObjectId } = require('mongodb');

const engine = require('../../src/services/batch-validation-engine.service');
const { revealStagedRecord } = require('../../src/utils/stagedRowCrypto');
const patientService = require('../../src/services/patient.service');
const sampleService = require('../../src/services/sample.service');
const biomarkerObservationService = require('../../src/services/biomarker-observation.service');
const StagingImport = require('../../src/services/stagingImport.store');
const logger = require('../../src/utils/logger');

const tempDirs = [];
function tempFile(name, contents) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bve-branches-'));
  tempDirs.push(dir);
  const filePath = path.join(dir, name);
  if (contents !== undefined) fs.writeFileSync(filePath, contents);
  return filePath;
}

afterEach(() => {
  vi.restoreAllMocks();
  while (tempDirs.length) fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
});

// A db whose patients collection never matches, and which counts lookups.
function emptyDb() {
  const patients = { findOne: vi.fn().mockResolvedValue(null) };
  const other = { findOne: vi.fn().mockResolvedValue(null) };
  return {
    patients,
    collection: (name) => (name === 'patients' ? patients : other),
  };
}

// A sample row that passes persistSample's validation and creates its patient.
const SAMPLE_ROW = {
  sampleType: 'Sangue',
  sampleOrigin: 'Coleta',
  quantity: '1',
  patientName: 'Ana Silva',
  birthDate: '1990-05-01',
  sex: 'F',
  email: 'ana@example.com',
  consentTemplateId: 'template-1',
};

describe('parsers and row helpers with absent input', () => {
  it('reads a whitespace-only number as no value', () => {
    expect(engine.parseNumericValue('   ')).toBeNull();
  });

  it('reads a null row as an empty semantic cascade', () => {
    expect(engine.extractSemanticCascadeFromRow(null)).toEqual({
      disease: null, phenotypes: [], biomarkers: [], warnings: [],
    });
  });

  // Every candidate scores 0 on an empty line, so the first one, ';', wins.
  it('picks the first candidate separator when the file has no non-blank line', () => {
    const filePath = tempFile('blank.csv', '\n   \n');
    expect(engine.detectCsvSeparator(filePath)).toBe(';');
  });

  it('warns about email, phone and clinicalUnit the parse dropped', () => {
    const warnings = engine.classifyPatientRow(
      { email: 'a@b.c', phone: '119', clinicalUnit: 'UTI' },
      { recordNumber: 'RN-1', unitAcronym: 'X', cpf: '1' }
    );
    expect(warnings).toEqual(expect.arrayContaining([
      'email foi normalizado', 'phone foi normalizado', 'clinicalUnit foi normalizada',
    ]));
  });

  it('warns that a sample quantity was dropped when the parse left none', () => {
    expect(engine.classifySampleRow({ quantity: '5' }, { extractionProtocol: 'P', quantity: null }))
      .toEqual(['quantity foi normalizada']);
  });

  it('detects patients from a null row by the file name fallback', () => {
    expect(engine.detectDataType([null], 'pacientes.csv')).toBe('patients');
    expect(engine.detectDataType([null], 'amostras.csv')).toBe('samples');
  });
});

describe('findLinkedPatient', () => {
  it('returns null when no criterion matches a patient', async () => {
    const db = emptyDb();
    const found = await engine.findLinkedPatient(db, { patientID: '12345678', cpf: '12345678901' });
    expect(found).toBeNull();
    expect(db.patients.findOne).toHaveBeenNthCalledWith(1, { participantId: '12345678' });
    expect(db.patients.findOne).toHaveBeenNthCalledWith(2, { cpf: '12345678901' });
  });
});

describe('buildBiomarkerObservationPayloads', () => {
  it('skips a token with no name and stamps an unparseable date with the current time', () => {
    const before = Date.now();
    const { payloads, warnings } = engine.buildBiomarkerObservationPayloads(
      { biomarkers: ':;alphaGal:3', collectedAt: 'not-a-date' },
      { participantId: '12345678', _id: 'p1' },
      { _id: 's1' }
    );
    expect(warnings).toEqual([]);
    expect(payloads).toHaveLength(1);
    expect(payloads[0].biomarkerType).toBe('alphaGal');
    expect(payloads[0].collectedAt.getTime()).toBeGreaterThanOrEqual(before);
  });

  it('falls back to the specimen registeredAt for a null row instead of throwing (#1427)', () => {
    const registeredAt = new Date('2025-01-02T00:00:00Z');
    const spy = vi.spyOn(engine, 'parseDateValue');
    expect(engine.buildBiomarkerObservationPayloads(null, {}, { registeredAt })).toEqual({ payloads: [], warnings: [] });
    expect(spy).toHaveBeenCalledWith(registeredAt);
  });
});

describe('readXlsxRows', () => {
  it('skips a blank header and a row whose only value sits under it', async () => {
    const filePath = tempFile('rows.xlsx');
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('S1');
    sheet.getCell('A1').value = 'patientName';
    sheet.getCell('B1').value = '   ';
    sheet.getCell('B2').value = 'orphan';
    sheet.getCell('A3').value = 'Ana';
    await workbook.xlsx.writeFile(filePath);

    const rows = await engine.readXlsxRows(filePath);
    expect(rows).toEqual([{ patientName: 'Ana' }]);
    expect(rows.sourceLines).toEqual([3]);
  });

  it('names a header from a formula cell whose cached text is empty', async () => {
    const filePath = tempFile('formula.xlsx');
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('S1');
    sheet.getCell('A1').value = { formula: '""', result: '' };
    sheet.getCell('A2').value = 'x';
    await workbook.xlsx.writeFile(filePath);

    const rows = await engine.readXlsxRows(filePath);
    expect(rows).toHaveLength(1);
    expect(Object.values(rows[0])).toEqual(['x']);
  });
});

describe('readRowsFromFile extension fallback', () => {
  it('takes the extension from the storage path when no file name is given', async () => {
    const filePath = tempFile('rows.json', JSON.stringify([{ a: 1 }]));
    await expect(engine.readRowsFromFile(filePath)).resolves.toEqual([{ a: 1 }]);
  });

  it('rejects when neither a file name nor a storage path is given', async () => {
    await expect(engine.readRowsFromFile('', '')).rejects.toThrow();
  });
});

describe('persistPatient', () => {
  const PATIENT_ROW = {
    patientName: 'Ana Silva',
    birthDate: '1990-05-01',
    sex: 'F',
    email: 'ana@example.com',
    consentTemplateId: 'template-1',
  };

  it('returns a null persistedId when the created patient has an empty _id', async () => {
    vi.spyOn(patientService, 'createPatient').mockResolvedValue({ _id: '' });
    const result = await engine.persistPatient({}, PATIENT_ROW, 2);
    expect(result.persistedId).toBeNull();
    expect(result.errors).toEqual([]);
  });

  it('falls back to a fixed message when the create error has none', async () => {
    vi.spyOn(logger, 'error').mockImplementation(() => {});
    vi.spyOn(patientService, 'createPatient').mockRejectedValue(new Error(''));
    const result = await engine.persistPatient({}, PATIENT_ROW, 2);
    expect(result.classification).toBe('INVALID');
    expect(result.errors).toEqual(['Erro ao persistir paciente']);
  });
});

describe('persistSample', () => {
  it('carries barcode, linkedProject, ORPHA and the patient contact fields through', async () => {
    const db = emptyDb();
    const createPatient = vi.spyOn(patientService, 'createPatient')
      .mockResolvedValue({ _id: 'p1', participantId: '12345678' });
    const createSample = vi.spyOn(sampleService, 'createSample').mockResolvedValue({ _id: 's1' });

    const result = await engine.persistSample(db, {
      ...SAMPLE_ROW,
      barcode: ' BC-1 ',
      linkedProject: ' Proj ',
      orpha: 'ORPHA:558',
      phone: ' 1199 ',
      clinicalUnit: ' UTI ',
      unitAcronym: ' U ',
    }, 2);

    expect(result.errors).toEqual([]);
    expect(createPatient.mock.calls[0][1]).toMatchObject({ phone: '1199', clinicalUnit: 'UTI', unitAcronym: 'U' });
    expect(createSample.mock.calls[0][1]).toMatchObject({
      barcode: 'BC-1',
      linkedProject: 'Proj',
      semanticCascade: { disease: { system: 'http://www.orpha.net', code: 'ORPHA:558' } },
    });
  });

  it('keeps the row participantId when the linked patient has none, and drops empty ids', async () => {
    const db = emptyDb();
    db.patients.findOne.mockResolvedValue({ _id: '' });
    const createSample = vi.spyOn(sampleService, 'createSample').mockResolvedValue({ _id: '' });
    vi.spyOn(biomarkerObservationService, 'createObservation').mockResolvedValue({ _id: '' });

    const result = await engine.persistSample(db, {
      ...SAMPLE_ROW, participantId: '12345678', biomarkers: 'alphaGal:3',
    }, 2);

    expect(createSample.mock.calls[0][1]).toMatchObject({ participantId: '12345678', patientObjectId: '' });
    expect(result.persistedId).toBeNull();
    expect(result.persistedIds).toEqual([]);
  });

  it('leaves the participantId empty when neither the patient nor the row has one', async () => {
    const db = emptyDb();
    db.collection = () => ({ findOne: vi.fn().mockResolvedValue({ _id: 'p1' }) });
    vi.spyOn(patientService, 'createPatient');
    const createSample = vi.spyOn(sampleService, 'createSample').mockResolvedValue(null);
    vi.spyOn(biomarkerObservationService, 'createObservation').mockResolvedValue(null);

    const result = await engine.persistSample(db, {
      ...SAMPLE_ROW, cpf: '12345678901', biomarkers: 'alphaGal:3',
    }, 2);

    expect(createSample.mock.calls[0][1].participantId).toBe('');
    expect(result.persistedId).toBeNull();
    expect(result.persistedIds).toEqual(['p1']);
  });
});

describe('recordAttemptFailure', () => {
  it('marks the import failed on the final attempt', async () => {
    const updateOne = vi.spyOn(StagingImport, 'updateOne').mockResolvedValue({});
    await engine.recordAttemptFailure('job-1', { attemptNumber: 3, attemptsAllowed: 3, message: 'boom' });
    const [filter, update] = updateOne.mock.calls[0];
    expect(filter).toEqual({ jobId: 'job-1' });
    expect(update.$set.status).toBe('failed');
    expect(update.$push.importErrors.message).toBe('Tentativa 3/3 falhou: boom');
  });

  it('leaves it processing on an earlier attempt, with a default message', async () => {
    const updateOne = vi.spyOn(StagingImport, 'updateOne').mockResolvedValue({});
    await engine.recordAttemptFailure('job-2', { attemptNumber: 1, attemptsAllowed: 3 });
    const [, update] = updateOne.mock.calls[0];
    expect(update.$set.status).toBe('processing');
    expect(update.$push.importErrors.message).toBe('Tentativa 1/3 falhou: erro desconhecido');
  });

  it('accepts no options at all', async () => {
    const updateOne = vi.spyOn(StagingImport, 'updateOne').mockResolvedValue({});
    await engine.recordAttemptFailure('job-3');
    expect(updateOne.mock.calls[0][1].$push.importErrors.message)
      .toBe('Tentativa undefined/undefined falhou: erro desconhecido');
  });
});

describe('quarantineRejectedRows', () => {
  function quarantineDb({ insertOneError, deleteManyError } = {}) {
    const stagingRecords = {
      insertMany: vi.fn().mockResolvedValue({}),
      deleteMany: deleteManyError ? vi.fn().mockRejectedValue(deleteManyError) : vi.fn().mockResolvedValue({}),
    };
    const importBatches = {
      insertOne: insertOneError ? vi.fn().mockRejectedValue(insertOneError) : vi.fn().mockResolvedValue({}),
    };
    return {
      stagingRecords,
      importBatches,
      db: { collection: (name) => (name === 'import_batches' ? importBatches : stagingRecords) },
    };
  }

  it('writes nothing without a db', async () => {
    await expect(engine.quarantineRejectedRows(null, { rejected: [{ rowNumber: 2 }] })).resolves.toBeNull();
  });

  it('stores nulls and empty lists for a rejection with no errors, row, job, file or counts', async () => {
    vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const { db, stagingRecords, importBatches } = quarantineDb();
    const batchId = await engine.quarantineRejectedRows(db, { dataType: 'samples', rejected: [{ rowNumber: 2 }] });

    expect(batchId).toBeInstanceOf(ObjectId);
    const [record] = stagingRecords.insertMany.mock.calls[0][0].map(revealStagedRecord);
    expect(record).toMatchObject({ rowNumber: 2, errors: [], validationErrors: [], row: null });
    expect(importBatches.insertOne.mock.calls[0][0]).toMatchObject({
      jobId: null, fileName: null, counts: { total: null, success: null, errors: 1 },
    });
  });

  it('returns null and swallows a failing cleanup when the batch insert fails without a message', async () => {
    const error = vi.spyOn(logger, 'error').mockImplementation(() => {});
    const { db, stagingRecords } = quarantineDb({ insertOneError: 'boom', deleteManyError: new Error('gone') });
    const batchId = await engine.quarantineRejectedRows(db, { jobId: 'j', rejected: [{ rowNumber: 2, errors: ['e'] }] });

    expect(batchId).toBeNull();
    expect(stagingRecords.deleteMany).toHaveBeenCalledTimes(1);
    expect(error.mock.calls[0][1]).toBe('boom');
  });
});

describe('getQuarantineBatch', () => {
  it('rejects a missing batch id as invalid (400)', async () => {
    await expect(engine.getQuarantineBatch({}, undefined)).rejects.toMatchObject({ statusCode: 400 });
  });
});

describe('processBatchImport without a file name', () => {
  it('reads the rows by the storage path and numbers them from line 2', async () => {
    const filePath = tempFile('rows.json', JSON.stringify([{ patientName: 'Sem Dados' }]));
    vi.spyOn(logger, 'info').mockImplementation(() => {});
    vi.spyOn(StagingImport, 'findOne').mockResolvedValue({ jobId: 'job-nf', rawData: { storagePath: filePath } });
    vi.spyOn(StagingImport, 'updateOne').mockResolvedValue({});
    vi.spyOn(engine, 'quarantineRejectedRows').mockResolvedValue(null);

    const result = await engine.processBatchImport({}, 'job-nf');

    expect(result.dataType).toBe('patients');
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].row).toBe(2);
  });
});
