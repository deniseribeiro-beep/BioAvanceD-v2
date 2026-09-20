import { describe, it, expect, vi, afterEach } from 'vitest';
const fs = require('fs');
const os = require('os');
const path = require('path');
const ExcelJS = require('exceljs');
const importService = require('../../src/services/import.service');

function writeTempFile(content, ext = '.csv') {
  const filePath = path.join(os.tmpdir(), `import-service-test-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
  fs.writeFileSync(filePath, content, 'utf8');
  return filePath;
}

describe('ImportService.normalizeImportKey', () => {
  it('lowercases string', () => {
    expect(importService.normalizeImportKey('PatientID')).toBe('patientid');
  });

  it('removes accents', () => {
    expect(importService.normalizeImportKey('Código')).toBe('codigo');
  });

  it('removes spaces and special chars', () => {
    expect(importService.normalizeImportKey('Patient ID')).toBe('patientid');
    expect(importService.normalizeImportKey('col-name')).toBe('colname');
  });

  it('returns empty string for null', () => {
    expect(importService.normalizeImportKey(null)).toBe('');
  });

  it('handles empty string', () => {
    expect(importService.normalizeImportKey('')).toBe('');
  });

  it('keeps digits', () => {
    expect(importService.normalizeImportKey('col123')).toBe('col123');
  });
});

describe('ImportService.getRowValue', () => {
  it('returns value for matching alias (exact)', () => {
    const row = { patientID: '12345678' };
    expect(importService.getRowValue(row, ['patientID'])).toBe('12345678');
  });

  it('returns value for case-insensitive match', () => {
    const row = { PatientID: '12345678' };
    expect(importService.getRowValue(row, ['patientid'])).toBe('12345678');
  });

  it('returns value for accent-stripped alias', () => {
    const row = { 'Código Paciente': 'P001' };
    expect(importService.getRowValue(row, ['Código Paciente'])).toBe('P001');
  });

  it('returns undefined when no alias matches', () => {
    const row = { name: 'Test' };
    expect(importService.getRowValue(row, ['nonexistent'])).toBeUndefined();
  });

  it('returns undefined for empty row', () => {
    expect(importService.getRowValue({}, ['patientID'])).toBeUndefined();
  });

  it('returns undefined when aliases is empty', () => {
    expect(importService.getRowValue({ patientID: '1' }, [])).toBeUndefined();
  });

  it('tries multiple aliases and returns first match', () => {
    const row = { sampleid: 'SMP-001' };
    expect(importService.getRowValue(row, ['nonexistent', 'sampleID'])).toBe('SMP-001');
  });
});

describe('ImportService.getRequiredFields', () => {
  it('returns patient fields for patients type', () => {
    const fields = importService.getRequiredFields('patients');
    expect(fields).toContain('patientName');
    expect(fields).toContain('birthDate');
    expect(fields).toContain('sex');
  });

  it('returns sample fields for samples type', () => {
    const fields = importService.getRequiredFields('samples');
    expect(fields).toContain('participantId');
    expect(fields).toContain('sampleType');
  });

  it('returns temperature fields for temperature type', () => {
    const fields = importService.getRequiredFields('temperature');
    expect(fields).toContain('sensorId');
    expect(fields).toContain('temperatureValue');
    expect(fields).toContain('timestamp');
  });

  it('returns empty array for unknown type', () => {
    expect(importService.getRequiredFields('unknown')).toEqual([]);
  });

  it('returns empty array for null', () => {
    expect(importService.getRequiredFields(null)).toEqual([]);
  });
});

describe('ImportService.validateFileFormat', () => {
  it('accepts a .csv file for patients by extension', () => {
    const file = { originalname: 'patients.csv', mimetype: 'text/csv' };
    expect(importService.validateFileFormat(file, 'patients')).toBe(true);
  });

  it('accepts a file by mimetype even with mismatched extension', () => {
    const file = { originalname: 'patients.dat', mimetype: 'application/json' };
    expect(importService.validateFileFormat(file, 'patients')).toBe(true);
  });

  it('rejects .json for temperature (only csv allowed)', () => {
    const file = { originalname: 'temps.json', mimetype: 'application/json' };
    expect(importService.validateFileFormat(file, 'temperature')).toBe(false);
  });

  it('rejects .zip for locations (not in allowed extensions/mimetypes)', () => {
    const file = { originalname: 'archive.zip', mimetype: 'application/zip' };
    expect(importService.validateFileFormat(file, 'locations')).toBe(false);
  });

  it('returns false for an unknown allowedTypes key', () => {
    const file = { originalname: 'data.csv', mimetype: 'text/csv' };
    expect(importService.validateFileFormat(file, 'unknown-type')).toBe(false);
  });

  it('accepts .raw or .zip for results', () => {
    expect(importService.validateFileFormat({ originalname: 'run.raw', mimetype: 'application/octet-stream' }, 'results')).toBe(true);
    expect(importService.validateFileFormat({ originalname: 'run.zip', mimetype: 'application/zip' }, 'results')).toBe(true);
  });
});

describe('ImportService.validateCSVStructure', () => {
  it('resolves with rowCount and headers when all required fields are present', async () => {
    const filePath = writeTempFile('patientName,birthDate,sex\nJoão,1990-01-01,M\n');
    try {
      const result = await importService.validateCSVStructure({ path: filePath }, 'patients');
      expect(result.valid).toBe(true);
      expect(result.rowCount).toBe(1);
      expect(result.headers).toEqual(['patientName', 'birthDate', 'sex']);
    } finally {
      fs.unlinkSync(filePath);
    }
  });

  it('rejects when required fields are missing, naming the missing fields', async () => {
    const filePath = writeTempFile('patientName,sex\nJoão,M\n');
    try {
      await expect(importService.validateCSVStructure({ path: filePath }, 'patients'))
        .rejects.toThrow(/birthDate/);
    } finally {
      fs.unlinkSync(filePath);
    }
  });

  it('rejects for an unknown dataType instead of silently skipping structure validation (fail-closed)', async () => {
    const filePath = writeTempFile('foo,bar\n1,2\n');
    try {
      await expect(
        importService.validateCSVStructure({ path: filePath }, 'unknown-type')
      ).rejects.toThrow(/tipo de dados/i);
    } finally {
      fs.unlinkSync(filePath);
    }
  });

  it('rejects when the CSV parser stream itself emits an error', async () => {
    const handlers = {};
    const parserStream = {
      on: vi.fn((event, callback) => {
        handlers[event] = callback;
        if (event === 'error') {
          queueMicrotask(() => callback(new Error('synthetic csv stream failure')));
        }
        return parserStream;
      }),
    };
    vi.spyOn(fs, 'createReadStream').mockReturnValue({
      pipe: vi.fn(() => parserStream),
    });

    await expect(
      importService.validateCSVStructure({ path: '/synthetic/input.csv' }, 'patients')
    ).rejects.toThrow('synthetic csv stream failure');

    expect(handlers.error).toBeInstanceOf(Function);
  });
});

describe('ImportService.validateFHIRFile', () => {
  it('returns isFhir:false, valid:true for plain JSON without resourceType/entry', () => {
    const filePath = writeTempFile(JSON.stringify({ foo: 'bar' }), '.json');
    try {
      const result = importService.validateFHIRFile({ path: filePath });
      expect(result.isFhir).toBe(false);
      expect(result.valid).toBe(true);
    } finally {
      fs.unlinkSync(filePath);
    }
  });

  it('returns isFhir:true and marks a minimal Patient resource as validated', () => {
    const filePath = writeTempFile(JSON.stringify({ resourceType: 'Patient', id: '123' }), '.json');
    try {
      const result = importService.validateFHIRFile({ path: filePath });
      expect(result.isFhir).toBe(true);
      expect(typeof result.valid).toBe('boolean');
      expect(Array.isArray(result.issues)).toBe(true);
      expect(result.operationOutcome).toBeDefined();
    } finally {
      fs.unlinkSync(filePath);
    }
  });

  it('returns a structured invalid-JSON error result (not a thrown exception) for malformed JSON', () => {
    const filePath = writeTempFile('{ not valid json', '.json');
    try {
      const result = importService.validateFHIRFile({ path: filePath });
      expect(result.isFhir).toBe(false);
      expect(result.valid).toBe(false);
      expect(result.issues[0].severity).toBe('error');
      expect(result.resourcesValidated).toBe(0);
    } finally {
      fs.unlinkSync(filePath);
    }
  });

  it('returns a structured error result when the file does not exist', () => {
    const result = importService.validateFHIRFile({ path: path.join(os.tmpdir(), 'does-not-exist-import-service.json') });
    expect(result.isFhir).toBe(false);
    expect(result.valid).toBe(false);
    expect(result.issues[0].diagnostics).toBeTruthy();
  });
});

describe('ImportService.parsePatientCSV', () => {
  it('maps core textual and boolean-flag fields from a CSV row', () => {
    const row = {
      patientName: 'Maria Silva',
      birthDate: '1985-05-20',
      sex: 'F',
      weight: '65.5',
      heightCm: '170',
      recordNumber: '4321',
      hypertension: 'true',
      diabetesType1: '1',
      smoking: 'false',
      notes: 'Nenhuma observação'
    };
    const result = importService.parsePatientCSV(row);
    expect(result.patientName).toBe('Maria Silva');
    expect(result.sex).toBe('F');
    expect(result.weight).toBe(65.5);
    expect(result.heightCm).toBe(170);
    expect(result.recordNumber).toBe(4321);
    expect(result.hypertension).toBe(true);
    expect(result.diabetesType1).toBe(true);
    expect(result.smoking).toBe(false);
    expect(result.notes).toBe('Nenhuma observação');
    expect(result.birthDate instanceof Date).toBe(true);
  });

  it('defaults numeric fields to null and boolean flags to false when absent', () => {
    const result = importService.parsePatientCSV({ patientName: 'X', birthDate: '2000-01-01', sex: 'M' });
    expect(result.weight).toBeNull();
    expect(result.heightCm).toBeNull();
    expect(result.recordNumber).toBeNull();
    expect(result.hypertension).toBe(false);
    expect(result.geneticVariant).toBeNull();
    expect(result.notes).toBeNull();
  });

  it('produces an Invalid Date for an unparseable birthDate rather than throwing', () => {
    const result = importService.parsePatientCSV({ patientName: 'X', birthDate: 'not-a-date', sex: 'M' });
    expect(Number.isNaN(result.birthDate.getTime())).toBe(true);
  });
});

describe('ImportService.parseSampleCSV', () => {
  it('parses core identifying fields without SPREC/consent data', () => {
    const row = {
      participantId: '12345678',
      sampleType: 'Blood',
      sampleOrigin: 'Venous',
      barcode: 'BC-001',
      quantity: '5.5'
    };
    const { data, parseErrors } = importService.parseSampleCSV(row);
    expect(parseErrors).toEqual([]);
    expect(data.participantId).toBe('12345678');
    expect(data.sampleType).toBe('Blood');
    expect(data.sampleOrigin).toBe('Venous');
    expect(data.barcode).toBe('BC-001');
    expect(data.quantity).toBe(5.5);
    expect(data.registeredAt instanceof Date).toBe(true);
  });

  it('resolves aliased column names (e.g. tipoAmostra) via getRowValue', () => {
    const row = { tipoAmostra: 'Plasma', origemAmostra: 'Arterial', idPaciente: 'P-9' };
    const { data } = importService.parseSampleCSV(row);
    expect(data.sampleType).toBe('Plasma');
    expect(data.sampleOrigin).toBe('Arterial');
    expect(data.participantId).toBe('P-9');
  });

  it('resolves participantId via the patient_id legacy alias (#547: was shadowed by a duplicate canonical-key entry)', () => {
    const { data } = importService.parseSampleCSV({ patient_id: 'P-77' });
    expect(data.participantId).toBe('P-77');
  });

  it('resolves registeredAt via the dataRegistro legacy alias (#547: was shadowed by a duplicate canonical-key entry)', () => {
    const { data } = importService.parseSampleCSV({ dataRegistro: '2026-01-15' });
    expect(data.registeredAt instanceof Date).toBe(true);
    expect(data.registeredAt.toISOString().slice(0, 10)).toBe('2026-01-15');
  });

  it('collects a parse error and returns null for a non-numeric quantity', () => {
    const { data, parseErrors } = importService.parseSampleCSV({ quantity: 'not-a-number' });
    expect(data.quantity).toBeNull();
    expect(parseErrors).toEqual(expect.arrayContaining([expect.stringContaining('quantity')]));
  });

  it('collects a parse error for an unparseable registeredAt', () => {
    const { parseErrors } = importService.parseSampleCSV({ registeredAt: 'bogus-date' });
    expect(parseErrors).toEqual(expect.arrayContaining([expect.stringContaining('registeredAt')]));
  });

  it('defaults blank/whitespace-only string fields to null via normalizeString', () => {
    const { data } = importService.parseSampleCSV({ participantId: '   ', barcode: '' });
    expect(data.participantId).toBeNull();
    expect(data.barcode).toBeNull();
  });

  it('maps consentTemplateId and merkleRoot columns (#546: was set twice via a duplicate object key)', () => {
    const { data } = importService.parseSampleCSV({ consentTemplateId: 'tcle-42', merkleRoot: 'root-hash-1' });
    expect(data.consentTemplateId).toBe('tcle-42');
    expect(data.merkleRoot).toBe('root-hash-1');
  });

  it('maps the legacy lifecycleStatus column onto specimenStatus, not the trio', () => {
    const { data } = importService.parseSampleCSV({ lifecycleStatus: 'QUARANTINED' });
    expect(data.specimenStatus).toBe('quarantined');
    expect(data.lifecycleStatus).toBeUndefined();
  });

  it('reads a specimenStatus column directly when present', () => {
    const { data } = importService.parseSampleCSV({ specimenStatus: 'partial' });
    expect(data.specimenStatus).toBe('partial');
  });

  it('defaults specimenStatus to available when no status column is present', () => {
    const { data } = importService.parseSampleCSV({});
    expect(data.specimenStatus).toBe('available');
  });
});

describe('ImportService.parseTemperatureCSV', () => {
  it('maps a full temperature row, parsing numeric fields and defaulting the unit', () => {
    const row = {
      sensorId: 'SENSOR-1',
      temperatureValue: '-20.5',
      timestamp: '2024-01-01T00:00:00Z',
      batteryLevel: '85',
      locationId: 'LOC-1',
      facility: 'Lab A',
      zone: 'Freezer'
    };
    const result = importService.parseTemperatureCSV(row);
    expect(result.sensorId).toBe('SENSOR-1');
    expect(result.temperatureValue).toBe(-20.5);
    expect(result.temperatureUnit).toBe('°C');
    expect(result.batteryLevel).toBe(85);
    expect(result.locationId).toBe('LOC-1');
    expect(result.facility).toBe('Lab A');
    expect(result.timestamp instanceof Date).toBe(true);
  });

  it('falls back to sensorID (capital ID) alias when sensorId is absent', () => {
    const result = importService.parseTemperatureCSV({ sensorID: 'ALT-SENSOR', temperatureValue: '5' });
    expect(result.sensorId).toBe('ALT-SENSOR');
  });

  it('defaults timestamp to "now" when absent rather than leaving it undefined', () => {
    const before = Date.now();
    const result = importService.parseTemperatureCSV({ sensorId: 'S1', temperatureValue: '1' });
    expect(result.timestamp instanceof Date).toBe(true);
    expect(result.timestamp.getTime()).toBeGreaterThanOrEqual(before);
  });

  it('produces NaN for temperatureValue when it is missing, caught later by TemperatureModel.validate (issue #77)', () => {
    const result = importService.parseTemperatureCSV({ sensorId: 'S1' });
    expect(Number.isNaN(result.temperatureValue)).toBe(true);
  });
});

describe('ImportService.cleanupFile', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('deletes the file when it exists', () => {
    const existsSpy = vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    const unlinkSpy = vi.spyOn(fs, 'unlinkSync').mockImplementation(() => {});
    importService.cleanupFile('/some/temp/path.csv');
    expect(existsSpy).toHaveBeenCalledWith('/some/temp/path.csv');
    expect(unlinkSpy).toHaveBeenCalledWith('/some/temp/path.csv');
  });

  it('does not attempt to unlink when the file does not exist', () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(false);
    const unlinkSpy = vi.spyOn(fs, 'unlinkSync').mockImplementation(() => {});
    expect(() => importService.cleanupFile('/nonexistent/path.csv')).not.toThrow();
    expect(unlinkSpy).not.toHaveBeenCalled();
  });

  it('swallows errors thrown by unlinkSync instead of propagating them', () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    vi.spyOn(fs, 'unlinkSync').mockImplementation(() => { throw new Error('EPERM: permission denied'); });
    expect(() => importService.cleanupFile('/locked/path.csv')).not.toThrow();
  });
});

describe('ImportService.readSpreadsheetRows', () => {
  const tmpFiles = [];

  afterEach(() => {
    while (tmpFiles.length) {
      const f = tmpFiles.pop();
      try { fs.unlinkSync(f); } catch (_) { /* already gone */ }
    }
  });

  async function writeXlsx(build) {
    const workbook = new ExcelJS.Workbook();
    build(workbook);
    const filePath = path.join(os.tmpdir(), `import-service-xlsx-${Date.now()}-${Math.random().toString(36).slice(2)}.xlsx`);
    await workbook.xlsx.writeFile(filePath);
    tmpFiles.push(filePath);
    return filePath;
  }

  it('returns an empty array when the workbook has no worksheets', async () => {
    const filePath = await writeXlsx(() => {});

    const rows = await importService.readSpreadsheetRows(filePath);

    expect(rows).toEqual([]);
  });

  it('normalizes rich-text/hyperlink objects and Date values into plain strings', async () => {
    const filePath = await writeXlsx((workbook) => {
      const sheet = workbook.addWorksheet('Sheet1');
      sheet.addRow(['name', 'note', 'collectedAt']);
      sheet.addRow(['Amostra 1', { text: 'Nota rica', hyperlink: 'https://example.org' }, new Date('2026-01-01T00:00:00.000Z')]);
    });

    const rows = await importService.readSpreadsheetRows(filePath);

    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('Amostra 1');
    expect(rows[0].note).toBe('Nota rica');
    expect(rows[0].collectedAt).toBe('2026-01-01T00:00:00.000Z');
  });

describe('ImportService item 8 legitimate residual branches', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('readSpreadsheetRows returns an empty set for a workbook without worksheets', async () => {
    const filePath = path.join(os.tmpdir(), `import-empty-${Date.now()}.xlsx`);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.writeFile(filePath);

    try {
      await expect(importService.readSpreadsheetRows(filePath)).resolves.toEqual([]);
    } finally {
      fs.unlinkSync(filePath);
    }
  });

  it('readSpreadsheetRows normalizes blank cells, rich/text objects, dates and blank headers', async () => {
    const filePath = path.join(os.tmpdir(), `import-rows-${Date.now()}.xlsx`);
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Data');

    worksheet.getRow(1).values = ['name', '', 'registeredAt', 'notes'];
    worksheet.getCell('A2').value = { richText: [{ text: 'Synthetic' }] };
    worksheet.getCell('B2').value = 'ignored-under-blank-header';
    worksheet.getCell('C2').value = new Date('2026-01-02T03:04:05.000Z');
    worksheet.getCell('D2').value = null;
    worksheet.addRow([null, null, null, null]);

    await workbook.xlsx.writeFile(filePath);

    try {
      const rows = await importService.readSpreadsheetRows(filePath);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        name: 'Synthetic',
        registeredAt: '2026-01-02T03:04:05.000Z',
      });
      expect(rows[0]).not.toHaveProperty('ignored-under-blank-header');
    } finally {
      fs.unlinkSync(filePath);
    }
  });

  it('parseSampleCSV parses a valid legacy numeric location and rejects a malformed one without throwing', () => {
    let parsed = importService.parseSampleCSV({ locationID: '42' });
    expect(parsed.data.locationID).toBe(42);
    expect(parsed.parseErrors).toEqual([]);

    parsed = importService.parseSampleCSV({ locationID: 'not-a-number' });
    expect(parsed.data.locationID).toBeNull();
    expect(parsed.parseErrors).toEqual(expect.arrayContaining([
      expect.stringContaining('locationID inválido'),
    ]));
  });

  it('parseSampleCSV treats blank numeric/date inputs as absent and preserves explicit linkedProject text', () => {
    const { data, parseErrors } = importService.parseSampleCSV({
      quantity: '',
      rcsScore: '',
      registeredAt: '',
      linkedProject: '  Project-Item8  ',
    });

    expect(parseErrors).toEqual([]);
    expect(data.quantity).toBeNull();
    expect(data.externalQualityAssessment.score).toBeNull();
    expect(data.linkedProject).toBe('Project-Item8');
    expect(data.registeredAt).toBeInstanceOf(Date);
  });

  it('validateFHIRFile uses the generic invalid-file diagnostic when a thrown value has no message', () => {
    const read = vi.spyOn(fs, 'readFileSync').mockImplementation(() => {
      throw {};
    });

    const result = importService.validateFHIRFile({ path: '/synthetic/fhir.json' });

    expect(result.valid).toBe(false);
    expect(result.issues[0].diagnostics).toBe('Arquivo JSON inválido');
    expect(read).toHaveBeenCalled();
  });
});


describe('ImportService item 8 remaining spreadsheet branches', () => {
  it('readSpreadsheetRows resolves ExcelJS hyperlink/text objects through their visible text', async () => {
    const filePath = path.join(os.tmpdir(), `import-link-${Date.now()}.xlsx`);
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Data');
    worksheet.addRow(['source', 'registeredAt']);
    worksheet.getCell('A2').value = {
      text: 'Synthetic source',
      hyperlink: 'https://example.invalid/source',
    };
    worksheet.getCell('B2').value = new Date('2026-03-04T05:06:07.000Z');
    await workbook.xlsx.writeFile(filePath);

    try {
      const rows = await importService.readSpreadsheetRows(filePath);
      expect(rows).toEqual([{
        source: 'Synthetic source',
        registeredAt: '2026-03-04T05:06:07.000Z',
      }]);
    } finally {
      fs.unlinkSync(filePath);
    }
  });

  it('parseSampleCSV reports malformed float and date fields while keeping valid aliases normalized', () => {
    const parsed = importService.parseSampleCSV({
      patient_id: '12345678',
      tipoAmostra: ' PLASMA ',
      origemAmostra: ' VENOUS_BLOOD ',
      protocoloExtracao: ' EDTA ',
      quantidade: 'not-a-float',
      qualidade: 'not-a-float',
      dataRegistro: 'not-a-date',
    });

    expect(parsed.data).toMatchObject({
      participantId: '12345678',
      sampleType: 'PLASMA',
      sampleOrigin: 'VENOUS_BLOOD',
      extractionProtocol: 'EDTA',
      quantity: null,
    });
    expect(parsed.parseErrors).toEqual(expect.arrayContaining([
      expect.stringContaining('quantity inválido'),
      expect.stringContaining('quality inválido'),
      expect.stringContaining('registeredAt em formato inválido'),
    ]));
  });
});

});