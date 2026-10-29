import { afterEach, describe, it, expect, vi } from 'vitest';
const fs = require('fs');
const os = require('os');
const path = require('path');
const ExcelJS = require('exceljs');
const engine = require('../../src/services/batch-validation-engine.service');
// #768: the specimen fallback leg is asserted against a document built by the
// real model, not a hand-shaped literal -- see the collectedAt tests below.
const { SampleModel } = require('../../src/models/Sample');
const patientService = require('../../src/services/patient.service');

describe('BatchValidationEngine.normalizeHeader', () => {
  it('normalizes Portuguese header with accents', () => {
    expect(engine.normalizeHeader('Código Paciente')).toBe('codigopaciente');
  });

  it('lowercases and removes spaces', () => {
    expect(engine.normalizeHeader('Patient ID')).toBe('patientid');
  });

  it('returns empty string for null', () => {
    expect(engine.normalizeHeader(null)).toBe('');
  });

  it('returns empty string for undefined', () => {
    expect(engine.normalizeHeader(undefined)).toBe('');
  });

  it('removes special characters like hyphens and underscores', () => {
    expect(engine.normalizeHeader('col-name_v2')).toBe('colnamev2');
  });
});

describe('BatchValidationEngine.normalizeText', () => {
  it('returns null for null', () => {
    expect(engine.normalizeText(null)).toBeNull();
  });

  it('returns null for undefined', () => {
    expect(engine.normalizeText(undefined)).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(engine.normalizeText('')).toBeNull();
  });

  it('returns null for whitespace-only string', () => {
    expect(engine.normalizeText('   ')).toBeNull();
  });

  it('trims and returns non-empty string', () => {
    expect(engine.normalizeText('  hello  ')).toBe('hello');
  });

  it('coerces numbers to string', () => {
    expect(engine.normalizeText(42)).toBe('42');
  });
});

describe('BatchValidationEngine.normalizeDigits', () => {
  it('returns null for null', () => {
    expect(engine.normalizeDigits(null)).toBeNull();
  });

  it('strips non-digit characters', () => {
    expect(engine.normalizeDigits('123.456.789-00')).toBe('12345678900');
  });

  it('returns digits-only string for numeric input', () => {
    expect(engine.normalizeDigits(12345)).toBe('12345');
  });

  it('returns null for empty string', () => {
    expect(engine.normalizeDigits('')).toBeNull();
  });

  it('returns null for string with no digits', () => {
    expect(engine.normalizeDigits('abc')).toBeNull();
  });
});

describe('BatchValidationEngine.normalizeCpf', () => {
  it('returns null for CPF with wrong digit count', () => {
    expect(engine.normalizeCpf('123')).toBeNull();
  });

  it('returns 11-digit string for valid formatted CPF', () => {
    expect(engine.normalizeCpf('123.456.789-00')).toBe('12345678900');
  });

  it('returns 11-digit string for unformatted CPF', () => {
    expect(engine.normalizeCpf('12345678900')).toBe('12345678900');
  });

  it('returns null for null', () => {
    expect(engine.normalizeCpf(null)).toBeNull();
  });
});

describe('BatchValidationEngine.normalizePatientID', () => {
  it('returns null for non-8-digit ID', () => {
    expect(engine.normalizePatientID('123')).toBeNull();
    expect(engine.normalizePatientID('123456789')).toBeNull();
  });

  it('returns 8-digit string for valid patientID', () => {
    expect(engine.normalizePatientID('12345678')).toBe('12345678');
  });

  it('extracts 8 digits from formatted string', () => {
    expect(engine.normalizePatientID('1234-5678')).toBe('12345678');
  });

  it('returns null for null', () => {
    expect(engine.normalizePatientID(null)).toBeNull();
  });
});

describe('BatchValidationEngine.parseNumericValue', () => {
  it('returns null for null', () => {
    expect(engine.parseNumericValue(null)).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(engine.parseNumericValue('')).toBeNull();
  });

  it('parses integer', () => {
    expect(engine.parseNumericValue(42)).toBe(42);
  });

  it('parses float string', () => {
    expect(engine.parseNumericValue('3.14')).toBe(3.14);
  });

  it('parses Brazilian decimal format (comma separator)', () => {
    expect(engine.parseNumericValue('3,14')).toBe(3.14);
  });

  it('returns null for non-numeric string', () => {
    expect(engine.parseNumericValue('not-a-number')).toBeNull();
  });
});

describe('BatchValidationEngine.parseDateValue', () => {
  it('returns null for null', () => {
    expect(engine.parseDateValue(null)).toBeNull();
  });

  it('returns null for undefined', () => {
    expect(engine.parseDateValue(undefined)).toBeNull();
  });

  it('returns Date for ISO string', () => {
    const result = engine.parseDateValue('2026-01-15T00:00:00.000Z');
    expect(result).toBeInstanceOf(Date);
  });

  it('returns Date when given Date object', () => {
    const d = new Date('2026-06-30T00:00:00.000Z');
    expect(engine.parseDateValue(d)).toBe(d);
  });

  it('returns null for invalid date string', () => {
    expect(engine.parseDateValue('not-a-date')).toBeNull();
  });
});

describe('BatchValidationEngine.normalizeCoding', () => {
  it('returns null when both code and system cannot be resolved', () => {
    expect(engine.normalizeCoding(null, null, null)).toBeNull();
  });

  it('returns null when system is missing and fallback is null but code is present', () => {
    const result = engine.normalizeCoding({ code: 'X1', system: null }, null, null);
    expect(result).toBeNull();
  });

  it('returns coding object when code and system are present', () => {
    const result = engine.normalizeCoding({ code: 'HP:001', system: 'http://hpo.org' }, null, 'HPO Condition');
    expect(result).toHaveProperty('code', 'HP:001');
    expect(result).toHaveProperty('system', 'http://hpo.org');
    expect(result).toHaveProperty('display');
  });

  it('uses fallback system when raw has no system', () => {
    const result = engine.normalizeCoding({ code: 'ORPHA:123' }, 'http://orpha.net', 'Fabry Disease');
    expect(result.system).toBe('http://orpha.net');
  });

  it('uses fallback display when raw has no display', () => {
    const result = engine.normalizeCoding({ code: 'X1' }, 'http://example.com', 'My Label');
    expect(result.display).toBe('My Label');
  });
});

describe('BatchValidationEngine.extractSemanticCascadeFromRow', () => {
  it('returns empty disease/phenotypes/biomarkers for empty row', () => {
    const result = engine.extractSemanticCascadeFromRow({});
    expect(result.disease).toBeNull();
    expect(result.phenotypes).toHaveLength(0);
    expect(result.biomarkers).toHaveLength(0);
  });

  it('extracts ORPHA disease code from row', () => {
    const result = engine.extractSemanticCascadeFromRow({ orpha: 'ORPHA:123', orphaname: 'Fabry' });
    expect(result.disease).not.toBeNull();
    expect(result.disease.code).toContain('123');
  });

  it('extracts HPO phenotypes from semicolon-separated list', () => {
    const result = engine.extractSemanticCascadeFromRow({ hpo: 'HP:001;HP:002' });
    expect(result.phenotypes.length).toBeGreaterThan(0);
  });

  it('adds warning when phenotypes present without disease', () => {
    const result = engine.extractSemanticCascadeFromRow({ hpo: 'HP:001' });
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('treats unknown column headers as no-match and returns null disease', () => {
    // 'Código Orpha' normalizes to 'codigoorpha' which doesn't match 'orpha'
    const result = engine.extractSemanticCascadeFromRow({ 'Código Orpha': 'ORPHA:999' });
    // behavior: unknown header → disease is null
    expect(result.disease).toBeNull();
  });
});

describe('BatchValidationEngine.buildSampleRow', () => {
  it('maps known Portuguese and English headers to canonical keys', () => {
    const result = engine.buildSampleRow({
      'Tipo de Amostra': 'Sangue',
      'Origem da SA': 'Coleta',
      'Codigo de Barras': 'BC-1',
      Quantidade: '5',
    });

    expect(result).toEqual({
      sampleType: 'Sangue',
      sampleOrigin: 'Coleta',
      barcode: 'BC-1',
      quantity: '5',
    });
  });

  it('ignores columns with no header mapping', () => {
    const result = engine.buildSampleRow({ unknownColumn: 'value' });
    expect(result).toEqual({});
  });

  it('handles empty row', () => {
    expect(engine.buildSampleRow({})).toEqual({});
    expect(engine.buildSampleRow()).toEqual({});
  });
});

describe('BatchValidationEngine.classifyPatientRow', () => {
  it('warns when patientID was supplied (ignored, auto-generated)', () => {
    const warnings = engine.classifyPatientRow({ patientID: '123' }, {});
    expect(warnings).toContain('patientID fornecido será ignorado; o sistema gera o identificador automaticamente');
  });

  it('warns when email/phone/clinicalUnit differ from normalized values', () => {
    const warnings = engine.classifyPatientRow(
      { email: ' Foo@Bar.com ', phone: ' 123 ', clinicalUnit: ' unit ' },
      { email: 'foo@bar.com', phone: '123456', clinicalUnit: 'UNIT' }
    );

    expect(warnings).toContain('email foi normalizado');
    expect(warnings).toContain('phone foi normalizado');
    expect(warnings).toContain('clinicalUnit foi normalizada');
  });

  it('warns when a non-empty recordNumber was discarded', () => {
    const warnings = engine.classifyPatientRow({ recordNumber: 'RN-1' }, { recordNumber: null });
    expect(warnings).toContain('recordNumber foi descartado por ser vazio ou inválido');
  });

  it('warns for each missing default-valued field except cpf', () => {
    const warnings = engine.classifyPatientRow({}, { phone: null, recordNumber: null, clinicalUnit: null, unitAcronym: null, cpf: null });
    expect(warnings).toContain('phone ausente; registro persistirá com valor padrão');
    expect(warnings).toContain('recordNumber ausente; registro persistirá com valor padrão');
    expect(warnings.some((w) => w.startsWith('cpf'))).toBe(false);
  });

  it('produces no warnings for a fully-matching, fully-populated row', () => {
    const patientData = {
      email: 'a@b.com', phone: '123', clinicalUnit: 'X', unitAcronym: 'X', cpf: '1', recordNumber: 'RN',
    };
    const warnings = engine.classifyPatientRow(
      { email: 'a@b.com', phone: '123', clinicalUnit: 'X' },
      patientData
    );
    expect(warnings).toEqual([]);
  });
});

describe('BatchValidationEngine.classifySampleRow', () => {
  it('warns when extractionProtocol is missing', () => {
    const warnings = engine.classifySampleRow({}, { extractionProtocol: null });
    expect(warnings).toContain('extractionProtocol ausente; será mantido como nulo');
  });

  it('warns when quantity was normalized', () => {
    const warnings = engine.classifySampleRow({ quantity: '5,0' }, { quantity: 5 });
    expect(warnings).toContain('quantity foi normalizada');
  });

  it('produces no warnings when protocol present and quantity matches', () => {
    const warnings = engine.classifySampleRow({ quantity: '5' }, { extractionProtocol: 'P1', quantity: '5' });
    expect(warnings).toEqual([]);
  });
});

describe('BatchValidationEngine.buildPatientLinkageQuery', () => {
  // #853: the input key stays `patientID` -- that is the operator-facing CSV
  // column -- but the emitted filter is keyed on `participantId`, the field
  // the patients collection actually writes.
  it('builds criteria in participantId, cpf, recordNumber, _id order', () => {
    const criteria = engine.buildPatientLinkageQuery(
      {},
      // patientData is parsePatientRow's output, which names the id participantId.
      { participantId: '12345678', cpf: '12345678901', recordNumber: '42', _id: '507f1f77bcf86cd799439011' }
    );

    expect(criteria[0]).toEqual({ participantId: '12345678' });
    expect(criteria[1]).toEqual({ cpf: '12345678901' });
    expect(criteria[2]).toEqual({ recordNumber: '42' });
    expect(criteria[3]).toEqual({ recordNumber: 42 });
    expect(criteria[4]._id).toBeDefined();
  });

  it('falls back to rawRow fields when patientData lacks them', () => {
    const criteria = engine.buildPatientLinkageQuery({ patientID: '12345678' }, {});
    expect(criteria).toEqual([{ participantId: '12345678' }]);
  });

  it('returns empty array when nothing resolves', () => {
    const criteria = engine.buildPatientLinkageQuery({}, {});
    expect(criteria).toEqual([]);
  });

  it('skips invalid objectId candidates', () => {
    const criteria = engine.buildPatientLinkageQuery({}, { _id: 'not-an-object-id' });
    expect(criteria).toEqual([]);
  });

  it('skips the numeric recordNumber variant when the recordNumber is non-numeric text', () => {
    const criteria = engine.buildPatientLinkageQuery({}, { recordNumber: 'RN-ABC' });
    expect(criteria).toEqual([{ recordNumber: 'RN-ABC' }]);
  });

  it('falls back to rawRow objectId fields when patientData lacks an _id', () => {
    const criteria = engine.buildPatientLinkageQuery({ patientObjectId: '507f1f77bcf86cd799439011' }, {});
    expect(criteria).toEqual([{ _id: expect.anything() }]);
  });
});

describe('BatchValidationEngine.buildBiomarkerObservationPayloads', () => {
  it('returns a payload per valid biomarker field', () => {
    const { payloads, warnings } = engine.buildBiomarkerObservationPayloads(
      { biomarkers: 'alphaGal:12.5,lysoGb3:4.2' },
      { participantId: '12345678', _id: 'patient-1' },
      { specimenId: 'S1', _id: 'sample-1' }
    );

    expect(payloads).toHaveLength(2);
    expect(warnings).toEqual([]);
    const alpha = payloads.find((p) => p.biomarkerType === 'alphaGal');
    expect(alpha.value).toBe(12.5);
    expect(alpha.patientObjectId).toBe('patient-1');
    expect(alpha.specimenObjectId).toBe('sample-1');
  });

  it('warns and skips a biomarker with a negative or non-finite value', () => {
    const { payloads, warnings } = engine.buildBiomarkerObservationPayloads(
      { biomarkers: 'alphaGal:-5' },
      {},
      {}
    );

    expect(payloads).toHaveLength(0);
    expect(warnings).toEqual(['Biomarcador alphaGal foi ignorado por conter valor inválido.']);
  });

  it('returns no payloads when no biomarker fields are present', () => {
    const { payloads, warnings } = engine.buildBiomarkerObservationPayloads({}, {}, {});
    expect(payloads).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it('warns and skips a biomarker token with no value (no colon separator)', () => {
    const { payloads, warnings } = engine.buildBiomarkerObservationPayloads(
      { biomarkers: 'alphaGal' },
      {},
      {}
    );

    expect(payloads).toHaveLength(0);
    expect(warnings).toEqual(['Biomarcador alphaGal foi ignorado por não informar valor.']);
  });

  // The patient is the one persistSample linked or created, and the specimen
  // is createSample's return, so the ids come from their canonical fields; a
  // patientID column on the row is only a linkage input.
  it('takes the participantId from the linked patient and the specimenId from the created specimen', () => {
    const { payloads } = engine.buildBiomarkerObservationPayloads(
      { patientID: '99999999', biomarkers: 'alphaGal:1' },
      { participantId: '12345678', _id: 'patient-1' },
      { specimenId: 'BR-2026-000001', _id: 'sample-1' }
    );

    expect(payloads[0].participantId).toBe('12345678');
    expect(payloads[0].specimenId).toBe('BR-2026-000001');
  });

  it('falls back to the specimen _id when it carries no specimenId', () => {
    const { payloads } = engine.buildBiomarkerObservationPayloads(
      { biomarkers: 'alphaGal:1' },
      { participantId: '12345678' },
      { _id: 'sample-1' }
    );

    expect(payloads[0].specimenId).toBe('sample-1');
  });

  it('falls back to specimen.barcode when no other specimen identifier is present', () => {
    const { payloads } = engine.buildBiomarkerObservationPayloads(
      { biomarkers: 'alphaGal:1' },
      {},
      { barcode: 'BC-9' }
    );

    expect(payloads[0].sampleID).toBe('BC-9');
  });

  // #768: this used to pass a specimen shaped `{ registrationDate }` -- a
  // shape Sample.create() never produces. It passed while proving nothing,
  // because it hand-built the only input that could reach a leg no real
  // document satisfies. Sample.js:38 declares `registeredAt` as the only
  // (required) date field, and Sample.create() always populates it, so
  // `registeredAt` is what the specimen leg has to read.
  it('uses collectedAt from the specimen registeredAt when the row has no date fields', () => {
    const { payloads } = engine.buildBiomarkerObservationPayloads(
      { biomarkers: 'alphaGal:1' },
      {},
      { registeredAt: '2026-02-01T00:00:00.000Z' }
    );

    expect(payloads[0].collectedAt.toISOString()).toBe('2026-02-01T00:00:00.000Z');
  });

  // The regression guard the old test could not be: a specimen built by the
  // real model, not hand-shaped to fit the fallback chain. persistSample
  // passes createSample()'s return value straight in as `specimen`, so this
  // is the document shape the leg actually receives in production.
  it('reads the specimen date from a document built by Sample.create()', () => {
    const specimen = SampleModel.create({
      specimenId: 'SPEC-768',
      participantId: 'P-768',
      sampleType: 'plasma',
      sampleOrigin: 'blood',
      extractionProtocol: 'EP-1',
      quantity: 10,
      registeredAt: '2026-02-01T00:00:00.000Z',
    });

    expect(specimen.registeredAt).toBeInstanceOf(Date);
    expect(specimen.registrationDate).toBeUndefined();
    expect(specimen.registerDate).toBeUndefined();

    const { payloads } = engine.buildBiomarkerObservationPayloads(
      { biomarkers: 'alphaGal:1' },
      {},
      specimen
    );

    expect(payloads[0].collectedAt.toISOString()).toBe('2026-02-01T00:00:00.000Z');
  });

  // The rawRow legs stay: persistSample hands buildBiomarkerObservationPayloads
  // the *un-canonicalized* CSV row (buildSampleRow is what maps headers), so a
  // file whose column is literally spelled `registrationDate` reaches them.
  // Unlike the specimen legs, these are real user input, not a dead name.
  it('still honours a raw CSV column literally named registrationDate', () => {
    const { payloads } = engine.buildBiomarkerObservationPayloads(
      { biomarkers: 'alphaGal:1', registrationDate: '2026-03-05T00:00:00.000Z' },
      {},
      {}
    );

    expect(payloads[0].collectedAt.toISOString()).toBe('2026-03-05T00:00:00.000Z');
  });
});

describe('BatchValidationEngine.detectDataType', () => {
  it('detects patients type from patient-only hints', () => {
    const result = engine.detectDataType([{ patientName: 'X', cpf: '123' }], 'file.csv');
    expect(result).toBe('patients');
  });

  it('falls back to filename hints when rows have no recognized headers', () => {
    const result = engine.detectDataType([{ unknownColumn: 'x' }], 'amostras-2026.csv');
    expect(result).toBe('samples');
  });

  it('defaults to patients when nothing matches', () => {
    const result = engine.detectDataType([{ unknownColumn: 'x' }], 'export.csv');
    expect(result).toBe('patients');
  });

  it('defaults to patients when called with no rows or fileName', () => {
    expect(engine.detectDataType()).toBe('patients');
  });
});

describe('BatchValidationEngine.persistPatient', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns INVALID with per-field errors when required fields are missing', async () => {
    const result = await engine.persistPatient({}, {}, 5);

    expect(result.classification).toBe('INVALID');
    expect(result.rowNumber).toBe(5);
    expect(result.errors).toContain('patientName é obrigatório');
    expect(result.errors).toContain('sex é obrigatório');
    expect(result.errors).toContain('email é obrigatório e deve ser válido');
    expect(result.errors).toContain('consentTemplateId é obrigatório');
  });

  it('persists a valid patient row and returns VALID with persistedId when no optional fields are missing', async () => {
    vi.spyOn(patientService, 'createPatient').mockResolvedValue({ _id: 'new-patient-id' });

    const row = {
      patientName: 'Ana Silva',
      birthDate: '1990-05-01',
      sex: 'F',
      email: 'ana@example.com',
      consentTemplateId: 'template-1',
      phone: '123',
      recordNumber: 'RN-1',
      clinicalUnit: 'UNIT',
      unitAcronym: 'UN',
      cpf: '12345678900',
    };

    const result = await engine.persistPatient({}, row, 7);

    expect(result.classification).toBe('VALID');
    expect(result.persistedId).toBe('new-patient-id');
    expect(patientService.createPatient).toHaveBeenCalledTimes(1);
  });

  it('returns PARTIAL with warnings when patientID was supplied and ignored', async () => {
    vi.spyOn(patientService, 'createPatient').mockResolvedValue({ _id: 'new-patient-id-2' });

    const result = await engine.persistPatient(
      { patientID: 'should-be-ignored' },
      {
        patientName: 'Bruno Costa',
        birthDate: '1985-02-02',
        sex: 'M',
        email: 'bruno@example.com',
        consentTemplateId: 'template-1',
      },
      8
    );

    expect(result.classification).toBe('PARTIAL');
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('returns INVALID with the thrown error message when createPatient rejects', async () => {
    vi.spyOn(patientService, 'createPatient').mockRejectedValue(new Error('duplicate email'));

    const result = await engine.persistPatient(
      {},
      {
        patientName: 'Carla Dias',
        birthDate: '1992-03-03',
        sex: 'F',
        email: 'carla@example.com',
        consentTemplateId: 'template-1',
      },
      9
    );

    expect(result.classification).toBe('INVALID');
    expect(result.errors).toEqual(['duplicate email']);
  });

  it('returns INVALID when email is present but has no "@"', async () => {
    const result = await engine.persistPatient(
      {},
      {
        patientName: 'Dan Souza',
        birthDate: '1990-01-01',
        sex: 'M',
        email: 'not-an-email',
        consentTemplateId: 'template-1',
      },
      10
    );

    expect(result.classification).toBe('INVALID');
    expect(result.errors).toContain('email é obrigatório e deve ser válido');
  });

  it('returns INVALID when birthDate is present but not a parseable date', async () => {
    const result = await engine.persistPatient(
      {},
      {
        patientName: 'Elis Souza',
        birthDate: 'not-a-date',
        sex: 'F',
        email: 'elis@example.com',
        consentTemplateId: 'template-1',
      },
      11
    );

    expect(result.classification).toBe('INVALID');
    expect(result.errors).toContain('birthDate é obrigatório e deve ser válida');
  });

  it('uses the mappedRow over rawRow when both are supplied', async () => {
    vi.spyOn(patientService, 'createPatient').mockResolvedValue({ _id: 'mapped-id' });

    const result = await engine.persistPatient(
      {},
      { patientName: 'Ignored Raw Row' },
      12,
      {},
      {
        patientName: 'Mapped Row',
        birthDate: '1990-01-01',
        sex: 'F',
        email: 'mapped@example.com',
        consentTemplateId: 'template-1',
      }
    );

    expect(patientService.createPatient).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ patientName: 'Mapped Row' }),
      expect.anything()
    );
  });
});

describe('BatchValidationEngine file readers', () => {
  let tmpDir;

  afterEach(() => {
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
    tmpDir = undefined;
  });

  function writeTmpFile(fileName, content) {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-validation-'));
    const filePath = path.join(tmpDir, fileName);
    fs.writeFileSync(filePath, content, 'utf8');
    return filePath;
  }

  it('readJsonRows parses a top-level array', async () => {
    const filePath = writeTmpFile('rows.json', JSON.stringify([{ a: 1 }, { a: 2 }]));
    const rows = await engine.readJsonRows(filePath);
    expect(rows).toEqual([{ a: 1 }, { a: 2 }]);
  });

  it('readJsonRows extracts FHIR bundle entry.resource', async () => {
    const filePath = writeTmpFile('bundle.json', JSON.stringify({ entry: [{ resource: { a: 1 } }, { a: 2 }] }));
    const rows = await engine.readJsonRows(filePath);
    expect(rows).toEqual([{ a: 1 }, { a: 2 }]);
  });

  it('readJsonRows wraps a single object payload', async () => {
    const filePath = writeTmpFile('single.json', JSON.stringify({ a: 1 }));
    const rows = await engine.readJsonRows(filePath);
    expect(rows).toEqual([{ a: 1 }]);
  });

  it('detectCsvSeparator picks the separator with most occurrences on the first line', () => {
    const filePath = writeTmpFile('semicolon.csv', 'a;b;c\n1;2;3\n');
    expect(engine.detectCsvSeparator(filePath)).toBe(';');
  });

  // #1041: an interior blank line arrives from csv-parser as `{}`, which the
  // old `typeof row === 'object'` guard kept. It then occupied an array slot,
  // was counted in totalRows, classified INVALID, and persisted as a durable
  // quarantine record whose `row` was an empty object -- an operator-visible
  // rejected row for a line that carries no data at all.
  //
  // The order here is the one #1041 insists on: line tracking FIRST, filter
  // SECOND. Filtering alone would introduce the blank-row drift this reader
  // did not previously have, because `index + 2` stayed aligned precisely
  // BECAUSE the `{}` occupied a slot. Same shape as import-lgpd.service.js's
  // #1023 reader, which increments its counter on every data event and pushes
  // to sourceLines only for the rows it keeps.
  it('readCsvRows drops an interior blank line instead of quarantining it as an empty row (#1041)', async () => {
    const filePath = writeTmpFile('rows.csv', 'a,b\n1,x\n\n3,z\n');

    const rows = await engine.readCsvRows(filePath);

    expect(rows).toEqual([{ a: '1', b: 'x' }, { a: '3', b: 'z' }]);
  });

  it('readCsvRows reports the true physical line for rows after an interior blank line (#1041)', async () => {
    const filePath = writeTmpFile('rows.csv', 'a,b\n1,x\n\n3,z\n');

    const rows = await engine.readCsvRows(filePath);

    // Header is physical line 1, so the two data rows are lines 2 and 4.
    // Dropping the blank without tracking would report them as 2 and 3.
    expect(rows.sourceLines).toEqual([2, 4]);
    expect(Object.prototype.propertyIsEnumerable.call(rows, 'sourceLines')).toBe(false);
  });

  // #1065: csv-parser emits one data event per RECORD, so a quoted field with an
  // embedded newline spans two physical lines in one event. A per-event counter
  // reports every later row one line low; the line must come from the record's
  // byteOffset instead.
  it('readCsvRows reports the true physical line for rows after a quoted embedded newline (#1065)', async () => {
    const filePath = writeTmpFile('rows.csv', 'a,b\n"multi\nline",x\n3,z\n');

    const rows = await engine.readCsvRows(filePath);

    expect(rows).toEqual([{ a: 'multi\nline', b: 'x' }, { a: '3', b: 'z' }]);
    // Header is line 1; the quoted record occupies lines 2-3, so `3,z` is line 4.
    expect(rows.sourceLines).toEqual([2, 4]);
  });

  it('readCsvRows keeps the physical line exact across stream chunks and multi-byte text (#1065)', async () => {
    // ~110 KB: past fs.createReadStream's 64 KB highWaterMark, so the newline
    // index is built from more than one chunk. Accented text makes byte and
    // character offsets diverge, which a string-index implementation misreports.
    const filler = Array.from({ length: 3000 }, (_, i) => `${i},ação-${i}-çãõéíú`);
    const content = ['a,b', ...filler, '"x\ny\nz",após', 'último,fim', ''].join('\n');
    const filePath = writeTmpFile('big.csv', content);

    const rows = await engine.readCsvRows(filePath);

    expect(rows).toHaveLength(3002);
    // Filler rows are lines 2..3001, the quoted record spans 3002-3004.
    expect(rows.sourceLines[2999]).toBe(3001);
    expect(rows.sourceLines[3000]).toBe(3002);
    expect(rows.sourceLines[3001]).toBe(3005);
  });

  // #1175: .pipe() does not forward the SOURCE stream's 'error', so a read
  // failure after the separator sniff (the file removed in between) was an
  // uncaught exception that crashed the process instead of a rejection.
  it('readCsvRows rejects when the read stream fails after the separator sniff (#1175)', async () => {
    const missingPath = path.join(os.tmpdir(), `batch-validation-missing-${Date.now()}.csv`);
    const readFileSyncSpy = vi.spyOn(fs, 'readFileSync').mockReturnValueOnce('a,b\n1,2\n');

    await expect(engine.readCsvRows(missingPath)).rejects.toMatchObject({ code: 'ENOENT' });
    readFileSyncSpy.mockRestore();
  });

  it('readCsvRows parses rows using the detected separator', async () => {
    const filePath = writeTmpFile('data.csv', 'a;b\n1;2\n3;4\n');
    const rows = await engine.readCsvRows(filePath);
    expect(rows).toEqual([{ a: '1', b: '2' }, { a: '3', b: '4' }]);
  });

  it('readRowsFromFile dispatches by extension to JSON parsing', async () => {
    const filePath = writeTmpFile('rows.json', JSON.stringify([{ a: 1 }]));
    const rows = await engine.readRowsFromFile(filePath, 'rows.json');
    expect(rows).toEqual([{ a: 1 }]);
  });

  it('readRowsFromFile dispatches by extension to CSV parsing', async () => {
    const filePath = writeTmpFile('rows.csv', 'a,b\n1,2\n');
    const rows = await engine.readRowsFromFile(filePath, 'rows.csv');
    expect(rows).toEqual([{ a: '1', b: '2' }]);
  });

  it('readJsonRows returns an empty array for a non-object, non-array JSON payload', async () => {
    const filePath = writeTmpFile('scalar.json', JSON.stringify(42));
    const rows = await engine.readJsonRows(filePath);
    expect(rows).toEqual([]);
  });

  async function writeXlsxFile(sheets) {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-validation-xlsx-'));
    const filePath = path.join(tmpDir, 'rows.xlsx');
    const workbook = new ExcelJS.Workbook();
    sheets.forEach(({ name, rows }) => {
      const worksheet = workbook.addWorksheet(name);
      rows.forEach((row) => worksheet.addRow(row));
    });
    await workbook.xlsx.writeFile(filePath);
    return filePath;
  }

  it('readXlsxRows maps header row to values across worksheet rows', async () => {
    const filePath = await writeXlsxFile([
      { name: 'Sheet1', rows: [['patientID', 'sampleType'], ['12345678', 'Sangue'], ['87654321', 'Plasma']] },
    ]);

    const rows = await engine.readXlsxRows(filePath);

    expect(rows).toEqual([
      { patientID: '12345678', sampleType: 'Sangue' },
      { patientID: '87654321', sampleType: 'Plasma' },
    ]);
  });

  it('readXlsxRows skips worksheets with no header row', async () => {
    const filePath = await writeXlsxFile([
      { name: 'Empty', rows: [] },
      { name: 'Data', rows: [['a'], ['1']] },
    ]);

    const rows = await engine.readXlsxRows(filePath);
    expect(rows).toEqual([{ a: '1' }]);
  });

  it('readXlsxRows skips fully empty data rows and cells with only-blank values', async () => {
    const filePath = await writeXlsxFile([
      { name: 'Sheet1', rows: [['a', 'b'], [null, null], ['1', '']] },
    ]);

    const rows = await engine.readXlsxRows(filePath);
    expect(rows).toEqual([{ a: '1' }]);
  });

  // #1041: the reader's loop variable is the true sheet row number, but it
  // used to be discarded one line after being computed -- the consumer
  // reconstructed a row number from pure array arithmetic instead, which
  // drifts as soon as a blank row occupies a sheet row without occupying an
  // array slot. Pinning that the surviving row after the blank one reports
  // its true sheet row (4: header=1, kept row=2, blank=3, kept row=4), not
  // the shifted ordinal (3) that array-position arithmetic would produce.
  it('readXlsxRows carries the true sheet row number on sourceLines, unshifted by an interior blank row (#1041)', async () => {
    const filePath = await writeXlsxFile([
      { name: 'Sheet1', rows: [['a', 'b'], ['1', 'x'], [null, null], ['3', 'z']] },
    ]);

    const rows = await engine.readXlsxRows(filePath);

    expect(rows).toEqual([{ a: '1', b: 'x' }, { a: '3', b: 'z' }]);
    // The surviving rows are sheet rows 2 and 4. The pre-#1041 arithmetic
    // reported them as 2 and 3, shifted down by the blank row at 3.
    expect(rows.sourceLines).toEqual([2, 4]);
    expect(rows.sourceSheets).toEqual(['Sheet1', 'Sheet1']);
  });

  // #1041: readXlsxRows flattens every worksheet into one array, so a bare
  // row number on the second sheet's rows would correspond to no gutter in
  // any sheet. sourceLines must disambiguate which sheet each entry's row
  // number belongs to.
  it('readXlsxRows disambiguates the source sheet in sourceLines for a multi-worksheet workbook (#1041)', async () => {
    const filePath = await writeXlsxFile([
      { name: 'Sheet1', rows: [['a'], ['1'], ['2']] },
      { name: 'Sheet2', rows: [['a'], ['9']] },
    ]);

    const rows = await engine.readXlsxRows(filePath);

    expect(rows).toEqual([{ a: '1' }, { a: '2' }, { a: '9' }]);
    // Sheet2's only data row is sheet row 2, NOT array position 4. The
    // number alone is therefore ambiguous across sheets, which is why the
    // sheet name is carried beside it rather than folded into it -- see the
    // reader's comment: rowNumber must stay numeric for
    // getQuarantineBatch's `.sort({ rowNumber: 1 })`.
    expect(rows.sourceLines).toEqual([2, 3, 2]);
    expect(rows.sourceSheets).toEqual(['Sheet1', 'Sheet1', 'Sheet2']);
  });

  // #1041: sourceLines is attached non-enumerable specifically so it cannot
  // affect `toEqual`'s own-enumerable-key comparison. Re-asserting the
  // pre-existing assertion at the test above (interior blank row within a
  // single sheet) stays green is the direct proof of that for this reader.
  it('readXlsxRows keeps the plain toEqual row shape intact despite the added sourceLines property (#1041)', async () => {
    const filePath = await writeXlsxFile([
      { name: 'Sheet1', rows: [['a', 'b'], [null, null], ['1', '']] },
    ]);

    const rows = await engine.readXlsxRows(filePath);
    expect(rows).toEqual([{ a: '1' }]);
    expect(Object.keys(rows)).toEqual(['0']);
    expect(Object.prototype.propertyIsEnumerable.call(rows, 'sourceLines')).toBe(false);
    expect(Object.prototype.propertyIsEnumerable.call(rows, 'sourceSheets')).toBe(false);
  });

  it('readRowsFromFile dispatches by extension to XLSX parsing', async () => {
    const filePath = await writeXlsxFile([{ name: 'Sheet1', rows: [['a'], ['1']] }]);
    const rows = await engine.readRowsFromFile(filePath, 'rows.xlsx');
    expect(rows).toEqual([{ a: '1' }]);
  });

  it('readRowsFromFile falls back to JSON when the CSV attempt fails for an unrecognized extension', async () => {
    const filePath = writeTmpFile('data.unknownext', JSON.stringify([{ a: 1 }]));

    // Force the CSV attempt's own detectCsvSeparator read to fail so the
    // dispatch falls through to readJsonRows, which succeeds on this content.
    const readFileSyncSpy = vi.spyOn(fs, 'readFileSync').mockImplementationOnce(() => {
      throw new Error('forced CSV read failure for test');
    });

    const rows = await engine.readRowsFromFile(filePath, 'data.unknownext');

    readFileSyncSpy.mockRestore();
    expect(rows).toEqual([{ a: 1 }]);
  });

  it('readRowsFromFile falls back to XLSX when both CSV and JSON parsing of an unrecognized extension fail', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-validation-xlsx-'));
    const filePath = path.join(tmpDir, 'data.unknownext');
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Sheet1');
    worksheet.addRow(['a']);
    worksheet.addRow(['1']);
    await workbook.xlsx.writeFile(filePath);

    // detectCsvSeparator (called first, inside readCsvRows) reads the file itself,
    // so failing that one readFileSync call is enough to make the CSV attempt reject.
    const readFileSyncSpy = vi.spyOn(fs, 'readFileSync').mockImplementationOnce(() => {
      throw new Error('forced CSV read failure for test');
    });
    const jsonParseSpy = vi.spyOn(JSON, 'parse').mockImplementationOnce(() => {
      throw new SyntaxError('forced invalid JSON for test');
    });

    const rows = await engine.readRowsFromFile(filePath, 'data.unknownext');

    readFileSyncSpy.mockRestore();
    jsonParseSpy.mockRestore();
    expect(rows).toEqual([{ a: '1' }]);
  });
});
