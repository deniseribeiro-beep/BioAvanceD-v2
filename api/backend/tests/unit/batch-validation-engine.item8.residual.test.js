import { afterEach, describe, expect, it, vi } from 'vitest';
import { ObjectId } from 'mongodb';

const engine = require('../../src/services/batch-validation-engine.service');
const importLGPDService = require('../../src/services/import-lgpd.service');
const patientService = require('../../src/services/patient.service');
const sampleService = require('../../src/services/sample.service');
const biomarkerObservationService = require('../../src/services/biomarker-observation.service');
const StagingImport = require('../../src/models/StagingImport');
const fs = require('fs');

afterEach(() => {
  vi.restoreAllMocks();
});

describe('batch-validation-engine additional item8 residual branches', () => {
  it('covers text/digits/cpf/patient/object-id/numeric/date normalizers', () => {
    expect(engine.normalizeText(undefined)).toBeNull();
    expect(engine.normalizeText('   ')).toBeNull();
    expect(engine.normalizeText(' x ')).toBe('x');

    expect(engine.normalizeDigits(null)).toBeNull();
    expect(engine.normalizeDigits('abc')).toBeNull();
    expect(engine.normalizeDigits('12.34-5')).toBe('12345');

    expect(engine.normalizeCpf('123.456.789-01')).toBe('12345678901');
    expect(engine.normalizeCpf('123')).toBeNull();
    expect(engine.normalizePatientID('12.345.678')).toBe('12345678');
    expect(engine.normalizePatientID('123')).toBeNull();

    expect(engine.normalizeRecordNumber('')).toBeNull();
    expect(engine.normalizeRecordNumber(' 42 ')).toBe('42');

    const oid = new ObjectId().toString();
    expect(engine.normalizeObjectId(oid)).toBe(oid);
    expect(engine.normalizeObjectId('bad')).toBeNull();

    expect(engine.parseNumericValue(' 1,25 ')).toBe(1.25);
    expect(engine.parseNumericValue('bad')).toBeNull();
    expect(engine.parseNumericValue('')).toBeNull();

    const date = new Date('2026-01-01T00:00:00Z');
    expect(engine.parseDateValue(date)).toBe(date);
    expect(engine.parseDateValue('2026-01-02')).toBeInstanceOf(Date);
    expect(engine.parseDateValue('bad')).toBeNull();
    expect(engine.parseDateValue(null)).toBeNull();
  });

  it('normalizes coding aliases/defaults and rejects missing code/system', () => {
    expect(engine.normalizeCoding(null, 'sys')).toBeNull();
    expect(engine.normalizeCoding({ code: ' C1 ', display: '' }, 'sys', 'Fallback')).toEqual({
      system: 'sys', code: 'C1', display: 'Fallback',
    });
    expect(engine.normalizeCoding({ codigo: 'C2', nome: 'Nome', system: 'custom' }, 'sys')).toEqual({
      system: 'custom', code: 'C2', display: 'Nome',
    });
    expect(engine.normalizeCoding({ id: 'C3' }, null)).toBeNull();
    expect(engine.normalizeCoding('C4', 'sys')).toEqual({
      system: 'sys', code: 'C4', display: 'C4',
    });
  });

  it('extracts semantic cascade and warns when phenotype/biomarker lacks ORPHA', () => {
    const empty = engine.extractSemanticCascadeFromRow();
    expect(empty).toEqual({ disease: null, phenotypes: [], biomarkers: [], warnings: [] });

    const loose = engine.extractSemanticCascadeFromRow({
      HPO: 'HP:0001;HP:0002',
      biomarkers: 'LOINC1|LOINC2',
    });
    expect(loose.disease).toBeNull();
    expect(loose.phenotypes).toHaveLength(2);
    expect(loose.biomarkers).toHaveLength(2);
    expect(loose.warnings).toHaveLength(1);

    const coded = engine.extractSemanticCascadeFromRow({
      diagnosisOrphaCode: 'ORPHA:123',
      orphaname: 'Synthetic disease',
      fenotipo: 'HP:1',
      biomarcador: '1234-5',
    });
    expect(coded.disease).toMatchObject({
      system: 'http://www.orpha.net',
      code: 'ORPHA:123',
      display: 'Synthetic disease',
    });
    expect(coded.warnings).toEqual([]);
  });

  it('reads JSON arrays, FHIR-like entry bundles, single objects and primitives', async () => {
    const read = vi.spyOn(fs, 'readFileSync');
    read.mockReturnValueOnce(JSON.stringify([{ a: 1 }, null, 'x', { b: 2 }]));
    await expect(engine.readJsonRows('/tmp/a.json')).resolves.toEqual([{ a: 1 }, { b: 2 }]);

    read.mockReturnValueOnce(JSON.stringify({
      entry: [{ resource: { resourceType: 'Patient' } }, { x: 1 }, null],
    }));
    await expect(engine.readJsonRows('/tmp/b.json')).resolves.toEqual([
      { resourceType: 'Patient' }, { x: 1 },
    ]);

    read.mockReturnValueOnce(JSON.stringify({ hello: 'world' }));
    await expect(engine.readJsonRows('/tmp/c.json')).resolves.toEqual([{ hello: 'world' }]);

    read.mockReturnValueOnce(JSON.stringify(42));
    await expect(engine.readJsonRows('/tmp/d.json')).resolves.toEqual([]);
  });

  it('detects CSV separator including empty-file fallback and tie order', () => {
    const read = vi.spyOn(fs, 'readFileSync');
    read.mockReturnValueOnce('');
    expect(engine.detectCsvSeparator('/tmp/empty.csv')).toBe(';');

    read.mockReturnValueOnce('a,b,c\n1,2,3');
    expect(engine.detectCsvSeparator('/tmp/comma.csv')).toBe(',');

    read.mockReturnValueOnce('a\tb\tc');
    expect(engine.detectCsvSeparator('/tmp/tab.tsv')).toBe('\t');

    read.mockReturnValueOnce('a|b|c|d');
    expect(engine.detectCsvSeparator('/tmp/pipe.txt')).toBe('|');
  });

  it('dispatches file readers by extension and cascades CSV -> JSON -> XLSX for unknown files', async () => {
    const json = vi.spyOn(engine, 'readJsonRows').mockResolvedValue(['json']);
    const csv = vi.spyOn(engine, 'readCsvRows').mockResolvedValue(['csv']);
    const xlsx = vi.spyOn(engine, 'readXlsxRows').mockResolvedValue(['xlsx']);

    await expect(engine.readRowsFromFile('/x/a.json')).resolves.toEqual(['json']);
    await expect(engine.readRowsFromFile('/x/a.csv')).resolves.toEqual(['csv']);
    await expect(engine.readRowsFromFile('/x/a.tsv')).resolves.toEqual(['csv']);
    await expect(engine.readRowsFromFile('/x/a.xlsx')).resolves.toEqual(['xlsx']);

    csv.mockRejectedValueOnce(new Error('not csv'));
    json.mockResolvedValueOnce(['json-fallback']);
    await expect(engine.readRowsFromFile('/x/a.bin')).resolves.toEqual(['json-fallback']);

    csv.mockRejectedValueOnce(new Error('not csv'));
    json.mockRejectedValueOnce(new Error('not json'));
    xlsx.mockResolvedValueOnce(['xlsx-fallback']);
    await expect(engine.readRowsFromFile('/x/a.bin')).resolves.toEqual(['xlsx-fallback']);
  });

  it('builds patient linkage criteria in priority order and includes numeric record variants', () => {
    const oid = new ObjectId().toString();
    const criteria = engine.buildPatientLinkageQuery({
      patient_id: '12.345.678',
      cpf: '123.456.789-01',
      record_number: '0042',
      patientObjectId: oid,
    });

    expect(criteria[0]).toEqual({ participantId: '12345678' });
    expect(criteria[1]).toEqual({ cpf: '12345678901' });
    expect(criteria[2]).toEqual({ recordNumber: '0042' });
    expect(criteria[3]).toEqual({ recordNumber: 42 });
    expect(criteria[4]._id.toString()).toBe(oid);

    expect(engine.buildPatientLinkageQuery({ recordNumber: 'ABC' }))
      .toEqual([{ recordNumber: 'ABC' }]);
    expect(engine.buildPatientLinkageQuery({})).toEqual([]);
  });

  it('findLinkedPatient stops at first exact match and returns null otherwise', async () => {
    const findOne = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ participantId: '12345678' });
    const db = { collection: vi.fn(() => ({ findOne })) };

    await expect(engine.findLinkedPatient(db, {
      patientID: '12345678',
      recordNumber: '42',
    })).resolves.toEqual({ participantId: '12345678' });
    expect(findOne).toHaveBeenCalledTimes(2);

    findOne.mockReset().mockResolvedValue(null);
    await expect(engine.findLinkedPatient(db, {})).resolves.toBeNull();
  });

  it('builds biomarker payloads and warnings for missing/invalid/valid values', () => {
    expect(engine.buildBiomarkerObservationPayloads({}, {}, {}))
      .toEqual({ payloads: [], warnings: [] });

    const missing = engine.buildBiomarkerObservationPayloads(
      { biomarkers: 'CRP;IL6=bad;LDL=-1;GLU=5.5', collectedAt: '2026-01-01' },
      { participantId: 'P1', _id: 'PO1' },
      { sampleID: 'S1', _id: 'SO1', registeredAt: new Date() }
    );

    expect(missing.warnings).toEqual(expect.arrayContaining([
      expect.stringContaining('CRP'),
      expect.stringContaining('IL6'),
      expect.stringContaining('LDL'),
    ]));
    expect(missing.payloads).toHaveLength(1);
    expect(missing.payloads[0]).toMatchObject({
      participantId: 'P1',
      patientObjectId: 'PO1',
      biomarkerType: 'GLU',
      value: 5.5,
      sampleID: 'S1',
      specimenId: 'S1',
      status: 'final',
    });
  });

  it('persistPatient rejects incomplete rows, returns partial/valid success and catches persistence error', async () => {
    const parse = vi.spyOn(importLGPDService, 'parsePatientRow');
    parse.mockReturnValueOnce({
      patientName: null, birthDate: null, sex: null, email: null, consentTemplateId: null,
    });
    let result = await engine.persistPatient({}, {}, 2);
    expect(result.classification).toBe('INVALID');
    expect(result.errors).toHaveLength(5);

    parse.mockReturnValueOnce({
      patientName: ' Ana ',
      birthDate: new Date('2026-01-01'),
      sex: 'F',
      email: ' A@TEST.COM ',
      consentTemplateId: ' T1 ',
    });
    vi.spyOn(engine, 'classifyPatientRow').mockReturnValueOnce(['normalized']);
    const create = vi.spyOn(patientService, 'createPatient').mockResolvedValueOnce({ _id: 'P1' });
    result = await engine.persistPatient({}, {}, 3, { actor: 'x' });
    expect(result).toMatchObject({ classification: 'PARTIAL', persistedId: 'P1' });
    expect(create.mock.calls[0][1]).toMatchObject({
      patientName: 'Ana', email: 'a@test.com', consentTemplateId: 'T1',
    });

    parse.mockReturnValueOnce({
      patientName: 'Ana',
      birthDate: new Date('2026-01-01'),
      sex: 'F',
      email: 'a@test.com',
      consentTemplateId: 'T1',
    });
    engine.classifyPatientRow.mockReturnValueOnce([]);
    create.mockResolvedValueOnce({ _id: { toString: () => 'P2' } });
    result = await engine.persistPatient({}, {}, 4);
    expect(result).toMatchObject({ classification: 'VALID', persistedId: 'P2' });

    parse.mockReturnValueOnce({
      patientName: 'Ana',
      birthDate: new Date('2026-01-01'),
      sex: 'F',
      email: 'a@test.com',
      consentTemplateId: 'T1',
    });
    engine.classifyPatientRow.mockReturnValueOnce([]);
    create.mockRejectedValueOnce(new Error('patient write failed'));
    result = await engine.persistPatient({}, {}, 5);
    expect(result).toMatchObject({
      classification: 'INVALID',
      errors: ['patient write failed'],
    });
  });

  it('persistSample rejects structural errors and loose disease text without ORPHA', async () => {
    vi.spyOn(importLGPDService, 'parseSampleRow').mockReturnValue({
      patientID: null,
      sampleType: null,
      sampleOrigin: null,
      extractionProtocol: null,
      quantity: 0,
      quality: null,
    });
    vi.spyOn(engine, 'buildSampleRow').mockReturnValue({});
    vi.spyOn(engine, 'classifySampleRow').mockReturnValue([]);

    const result = await engine.persistSample({}, { disease: 'Rare disease' }, 7);
    expect(result.classification).toBe('INVALID');
    expect(result.errors).toEqual(expect.arrayContaining([
      'sampleType é obrigatório',
      'sampleOrigin é obrigatório',
      'quantity deve ser um número maior que zero',
      expect.stringContaining('ORPHA'),
    ]));
  });

  it('persistSample refuses creation of a new patient when linkage misses and identity is insufficient', async () => {
    vi.spyOn(importLGPDService, 'parseSampleRow').mockReturnValue({
      patientID: '12345678',
      sampleType: 'PLASMA',
      sampleOrigin: 'VENOUS',
      extractionProtocol: 'EDTA',
      quantity: 1,
      quality: 1,
    });
    vi.spyOn(importLGPDService, 'parsePatientRow').mockReturnValue({
      patientName: null, birthDate: null, sex: null, email: null, consentTemplateId: null,
    });
    vi.spyOn(engine, 'buildSampleRow').mockReturnValue({});
    vi.spyOn(engine, 'classifySampleRow').mockReturnValue([]);
    vi.spyOn(engine, 'findLinkedPatient').mockResolvedValue(null);

    const result = await engine.persistSample({}, { orpha: 'ORPHA:1' }, 8);
    expect(result.classification).toBe('INVALID');
    expect(result.errors[0]).toContain('Paciente não encontrado');
  });

  it('persistSample creates missing patient, sample and biomarker observations and aggregates warnings', async () => {
    vi.spyOn(importLGPDService, 'parseSampleRow').mockReturnValue({
      patientID: null,
      sampleType: 'PLASMA',
      sampleOrigin: 'VENOUS',
      extractionProtocol: null,
      quantity: 1,
      quality: 1,
    });
    vi.spyOn(importLGPDService, 'parsePatientRow').mockReturnValue({
      patientName: ' Ana ',
      birthDate: new Date('2026-01-01'),
      sex: 'F',
      email: ' A@TEST.COM ',
      phone: ' 123 ',
      clinicalUnit: ' Unit ',
      unitAcronym: ' U ',
      consentTemplateId: ' T1 ',
    });
    vi.spyOn(engine, 'buildSampleRow').mockReturnValue({});
    vi.spyOn(engine, 'classifySampleRow').mockReturnValue(['sample normalized']);
    vi.spyOn(engine, 'findLinkedPatient').mockResolvedValue(null);
    vi.spyOn(patientService, 'createPatient').mockResolvedValue({ _id: 'P1', patientID: '12345678' });
    vi.spyOn(sampleService, 'createSample').mockResolvedValue({ _id: 'S1', sampleID: 'SM1' });
    vi.spyOn(engine, 'buildBiomarkerObservationPayloads').mockReturnValue({
      payloads: [{ biomarkerType: 'CRP', value: 1 }],
      warnings: ['bio warning'],
    });
    vi.spyOn(biomarkerObservationService, 'createObservation')
      .mockResolvedValue({ _id: { toString: () => 'O1' } });

    const result = await engine.persistSample({}, { orpha: 'ORPHA:1' }, 9, { actor: 'x' });
    expect(result).toMatchObject({
      classification: 'PARTIAL',
      persistedId: 'S1',
      persistedIds: ['P1', 'S1', 'O1'],
    });
    expect(result.warnings).toEqual(['sample normalized', 'bio warning']);
  });

  it('quarantineRejectedRows short-circuits empty/db/patient rows, persists sample rows, and swallows staging failures', async () => {
    await expect(engine.quarantineRejectedRows({}, { rejected: [] })).resolves.toBeNull();
    await expect(engine.quarantineRejectedRows(null, { rejected: [{ rowNumber: 1 }] })).resolves.toBeNull();
    await expect(engine.quarantineRejectedRows({}, {
      dataType: 'patients', rejected: [{ rowNumber: 1 }],
    })).resolves.toBeNull();

    const insertOne = vi.fn().mockResolvedValue({ insertedId: 'B1' });
    const insertMany = vi.fn().mockResolvedValue({ insertedCount: 1 });
    const db = {
      collection: vi.fn((name) => name === 'import_batches' ? { insertOne } : { insertMany }),
    };
    await expect(engine.quarantineRejectedRows(db, {
      jobId: 5,
      dataType: 'samples',
      fileName: 's.csv',
      rejected: [{ rowNumber: 2, sheet: 'S1', errors: ['bad'], row: { x: 1 } }],
      counts: { total: 2, success: 1 },
    })).resolves.toBe('B1');
    expect(insertMany).toHaveBeenCalledWith([
      expect.objectContaining({
        batchId: 'B1',
        rowNumber: 2,
        sheet: 'S1',
        errors: ['bad'],
        row: { x: 1 },
      }),
    ]);

    insertOne.mockRejectedValueOnce(new Error('staging down'));
    await expect(engine.quarantineRejectedRows(db, {
      dataType: 'samples', rejected: [{ rowNumber: 1 }],
    })).resolves.toBeNull();
  });

  it('findAsyncBatchImport and getQuarantineBatch validate ownership/type and ids', async () => {
    const oid = new ObjectId();
    const recordsCursor = {
      sort: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([{ rowNumber: 1 }]),
    };
    const batches = { findOne: vi.fn().mockResolvedValue({ _id: oid, type: 'ASYNC_BATCH_IMPORT' }) };
    const records = { find: vi.fn(() => recordsCursor) };
    const db = { collection: vi.fn((name) => name === 'import_batches' ? batches : records) };

    await expect(engine.findAsyncBatchImport(db, oid)).resolves.toMatchObject({ _id: oid });
    expect(batches.findOne).toHaveBeenCalledWith({ _id: oid, type: 'ASYNC_BATCH_IMPORT' });

    batches.findOne.mockResolvedValueOnce(null);
    await expect(engine.findAsyncBatchImport(db, oid)).rejects.toMatchObject({ statusCode: 404 });

    await expect(engine.getQuarantineBatch(db, 'bad')).rejects.toMatchObject({ statusCode: 400 });

    batches.findOne.mockResolvedValueOnce({ _id: oid, type: 'ASYNC_BATCH_IMPORT' });
    await expect(engine.getQuarantineBatch(db, oid.toString())).resolves.toEqual({
      batch: { _id: oid, type: 'ASYNC_BATCH_IMPORT' },
      records: [{ rowNumber: 1 }],
    });
  });

  it('updateProgress forwards patch plus updatedAt to StagingImport', async () => {
    const update = vi.spyOn(StagingImport, 'updateOne').mockResolvedValue({});
    await engine.updateProgress('job-1', { status: 'processing', processedRows: 2 });
    expect(update).toHaveBeenCalledWith(
      { jobId: 'job-1' },
      { $set: { status: 'processing', processedRows: 2, updatedAt: expect.any(Date) } }
    );
  });
});
