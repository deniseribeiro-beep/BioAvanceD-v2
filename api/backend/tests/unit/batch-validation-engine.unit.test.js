import { afterEach, describe, it, expect, vi } from 'vitest';
const fs = require('fs');
const os = require('os');
const path = require('path');
const engine = require('../../src/services/batch-validation-engine.service');
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
  it('builds criteria in patientID, cpf, recordNumber, _id order', () => {
    const criteria = engine.buildPatientLinkageQuery(
      {},
      { patientID: '12345678', cpf: '12345678901', recordNumber: '42', _id: '507f1f77bcf86cd799439011' }
    );

    expect(criteria[0]).toEqual({ patientID: '12345678' });
    expect(criteria[1]).toEqual({ cpf: '12345678901' });
    expect(criteria[2]).toEqual({ recordNumber: '42' });
    expect(criteria[3]).toEqual({ recordNumber: 42 });
    expect(criteria[4]._id).toBeDefined();
  });

  it('falls back to rawRow fields when patientData lacks them', () => {
    const criteria = engine.buildPatientLinkageQuery({ patientID: '12345678' }, {});
    expect(criteria).toEqual([{ patientID: '12345678' }]);
  });

  it('returns empty array when nothing resolves', () => {
    const criteria = engine.buildPatientLinkageQuery({}, {});
    expect(criteria).toEqual([]);
  });

  it('skips invalid objectId candidates', () => {
    const criteria = engine.buildPatientLinkageQuery({}, { _id: 'not-an-object-id' });
    expect(criteria).toEqual([]);
  });
});

describe('BatchValidationEngine.buildBiomarkerObservationPayloads', () => {
  it('returns a payload per valid biomarker field', () => {
    const { payloads, warnings } = engine.buildBiomarkerObservationPayloads(
      { alphaGal: '12.5', lysoGb3: '4.2' },
      { patientID: 'P1', _id: 'patient-1' },
      { sampleID: 'S1', _id: 'sample-1' }
    );

    expect(payloads).toHaveLength(2);
    expect(warnings).toEqual([]);
    const alpha = payloads.find((p) => p.biomarkerType === 'alphaGal');
    expect(alpha.value).toBe(12.5);
    expect(alpha.unit).toBe('U/mL');
    expect(alpha.patientObjectId).toBe('patient-1');
    expect(alpha.specimenObjectId).toBe('sample-1');
  });

  it('warns and skips a biomarker with a negative or non-finite value', () => {
    const { payloads, warnings } = engine.buildBiomarkerObservationPayloads(
      { alphaGal: '-5' },
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
});
