import { afterEach, describe, expect, it, vi } from 'vitest';

const fs = require('fs');
const path = require('path');
const importService = require('../../src/services/import.service');
const fhirValidator = require('../../src/services/fhir-validator.service');

afterEach(() => {
  vi.restoreAllMocks();
});

describe('import.service item 8 residual parser branches', () => {
  it('normalizes import keys and resolves row aliases defensively', () => {
    expect(importService.normalizeImportKey(null)).toBe('');
    expect(importService.normalizeImportKey(' Código Paciente-Á ')).toBe('codigopacientea');

    expect(importService.getRowValue({ 'Código Paciente': 'P1' }, ['codigoPaciente'])).toBe('P1');
    expect(importService.getRowValue({ other: 'x' }, ['codigoPaciente'])).toBeUndefined();
    expect(importService.getRowValue(null, null)).toBeUndefined();
  });

  it('validates file formats by extension, MIME type and unknown data type', () => {
    expect(importService.validateFileFormat({
      originalname: 'patients.CSV',
      mimetype: 'application/octet-stream',
    }, 'patients')).toBe(true);

    expect(importService.validateFileFormat({
      originalname: 'patients.bin',
      mimetype: 'application/json',
    }, 'patients')).toBe(true);

    expect(importService.validateFileFormat({
      originalname: 'results.raw',
      mimetype: 'application/octet-stream',
    }, 'results')).toBe(true);

    expect(importService.validateFileFormat({
      originalname: 'x.bin',
      mimetype: 'application/octet-stream',
    }, 'unknown')).toBe(false);
  });

  it('returns required fields for every supported type and empty for unknown types', () => {
    expect(importService.getRequiredFields('patients')).toContain('patientName');
    expect(importService.getRequiredFields('samples')).toContain('participantId');
    expect(importService.getRequiredFields('temperature')).toContain('sensorId');
    expect(importService.getRequiredFields('results')).toContain('specimenId');
    expect(importService.getRequiredFields('locations')).toContain('equipmentType');
    expect(importService.getRequiredFields('unknown')).toEqual([]);
  });

  it('classifies non-FHIR JSON without invoking payload validation', () => {
    vi.spyOn(fs, 'readFileSync').mockReturnValue('{"hello":"world"}');
    vi.spyOn(fhirValidator, 'isFhirResource').mockReturnValue(false);
    const validate = vi.spyOn(fhirValidator, 'validatePayload');

    expect(importService.validateFHIRFile({ path: '/tmp/x.json' })).toEqual({
      isFhir: false,
      valid: true,
    });
    expect(validate).not.toHaveBeenCalled();
  });

  it('returns FHIR validation details and OperationOutcome for valid FHIR-shaped input', () => {
    vi.spyOn(fs, 'readFileSync').mockReturnValue('{"resourceType":"Patient"}');
    vi.spyOn(fhirValidator, 'isFhirResource').mockReturnValue(true);
    vi.spyOn(fhirValidator, 'validatePayload').mockReturnValue({
      valid: false,
      issues: [{ severity: 'error', code: 'required' }],
      resourcesValidated: 2,
    });
    vi.spyOn(fhirValidator, 'buildOperationOutcome').mockReturnValue({ resourceType: 'OperationOutcome' });

    expect(importService.validateFHIRFile({ path: '/tmp/fhir.json' })).toEqual({
      isFhir: true,
      valid: false,
      issues: [{ severity: 'error', code: 'required' }],
      resourcesValidated: 2,
      operationOutcome: { resourceType: 'OperationOutcome' },
    });
  });

  it('defaults optional FHIR result fields and handles malformed JSON', () => {
    vi.spyOn(fs, 'readFileSync')
      .mockReturnValueOnce('{"resourceType":"Patient"}')
      .mockReturnValueOnce('{bad json');
    vi.spyOn(fhirValidator, 'isFhirResource').mockReturnValue(true);
    vi.spyOn(fhirValidator, 'validatePayload').mockReturnValue({ valid: true });
    const outcome = vi.spyOn(fhirValidator, 'buildOperationOutcome')
      .mockReturnValue({ resourceType: 'OperationOutcome' });

    const valid = importService.validateFHIRFile({ path: '/tmp/fhir.json' });
    expect(valid.issues).toEqual([]);
    expect(valid.resourcesValidated).toBe(0);

    const invalid = importService.validateFHIRFile({ path: '/tmp/bad.json' });
    expect(invalid).toMatchObject({
      isFhir: false,
      valid: false,
      resourcesValidated: 0,
    });
    expect(invalid.issues[0].diagnostics).toBeTruthy();
    expect(outcome).toHaveBeenCalled();
  });

  it('parses patient CSV optional values and boolean aliases', () => {
    const full = importService.parsePatientCSV({
      patientName: 'Ana',
      birthDate: '2026-01-01',
      sex: 'F',
      email: 'a@test',
      consentTemplateId: 'T1',
      cpf: '123',
      weight: '60.5',
      heightCm: '165',
      recordNumber: '42',
      clinicalUnit: 'U1',
      diagnosticHypothesis: 'Dx',
      icdCode: 'A00',
      hypertension: 'true',
      obesity: '1',
      diabetesType1: 'false',
      diabetesType2: '1',
      copd: 'true',
      ckd: '1',
      smoking: 'true',
      alcoholUse: '1',
      asthma: 'true',
      antibioticUse: '1',
      insulinUse: 'true',
      antiviralUse: '1',
      geneticVariant: 'v',
      notes: 'n',
    });

    expect(full).toMatchObject({
      patientName: 'Ana',
      email: 'a@test',
      weight: 60.5,
      heightCm: 165,
      recordNumber: 42,
      hypertension: true,
      obesity: true,
      diabetesType1: false,
      diabetesType2: true,
      copd: true,
      ckd: true,
      smoking: true,
      alcoholUse: true,
      asthma: true,
      antibioticUse: true,
      insulinUse: true,
      antiviralUse: true,
    });
    expect(full.birthDate).toBeInstanceOf(Date);

    const minimal = importService.parsePatientCSV({
      patientName: 'B',
      birthDate: '2026-01-02',
      sex: 'M',
    });
    expect(minimal).toMatchObject({
      email: null,
      consentTemplateId: null,
      cpf: null,
      weight: null,
      heightCm: null,
      recordNumber: null,
      clinicalUnit: null,
      diagnosticHypothesis: null,
      icdCode: null,
      hypertension: false,
      obesity: false,
      geneticVariant: null,
      notes: null,
    });
  });

  it('parses sample CSV aliases, nulls and invalid number/date fields into parseErrors', () => {
    const { data, parseErrors } = importService.parseSampleCSV({
      participantId: ' 12345678 ',
      tipoAmostra: ' PLASMA ',
      origemAmostra: ' VENOUS_BLOOD ',
      protocoloExtracao: ' EDTA ',
      codigoBarras: ' BC-1 ',
      qualityScore: 'not-a-number',
      dataRegistro: 'bad-date',
      volume: 'bad-volume',
      locationId: 'bad-location',
      projeto: ' P1 ',
      sprecMatrixType: ' SER ',
      sprecSampleType: '',
      statusAtual: 'AVAILABLE',
    });

    expect(data).toMatchObject({
      participantId: '12345678',
      sampleType: 'PLASMA',
      sampleOrigin: 'VENOUS_BLOOD',
      extractionProtocol: 'EDTA',
      barcode: 'BC-1',
      quantity: null,
      locationID: null,
      linkedProject: 'P1',
    });
    expect(data.registeredAt).toBeInstanceOf(Date);
    expect(data.sprec.matrixType).toBe('SER');
    expect(data.sprec.sampleType).toBeNull();
    expect(parseErrors).toEqual(expect.arrayContaining([
      'rcsScore inválido',
      'registeredAt em formato inválido',
      'quantity inválido',
      'locationID inválido',
    ]));
  });

  it('parses valid sample numeric/date fields and preserves non-string values', () => {
    const date = '2026-05-01T10:00:00Z';
    const { data, parseErrors } = importService.parseSampleCSV({
      participantId: '12345678',
      sampleType: 'PLASMA',
      sampleOrigin: 'VENOUS_BLOOD',
      quantity: '2.5',
      locationID: '12',
      registeredAt: date,
      rcsScore: '0.75',
      scoreBasedGrade: 'A',
      sprec_code: 'ABC',
      sprec_version: '2.0',
      merkleRoot: 'root',
    });

    expect(parseErrors).toEqual([]);
    expect(data.quantity).toBe(2.5);
    expect(data.locationID).toBe(12);
    expect(data.registeredAt).toEqual(new Date(date));
    expect(data.externalQualityAssessment).toMatchObject({
      score: 0.75,
      category: 'A',
      source: 'external-import',
      canonical: false,
    });
    expect(data.sprec).toMatchObject({
      sprecCode: 'ABC',
      sprecVersion: '2.0',
    });
    expect(data.merkleRoot).toBe('root');
  });

  it('parses temperature CSV fallbacks and optional values', () => {
    const explicit = importService.parseTemperatureCSV({
      sensorID: 'S1',
      temperatureValue: '-80.5',
      temperatureUnit: 'K',
      timestamp: '2026-01-01T00:00:00Z',
      readingStatus: 'warning',
      sensorStatus: 'offline',
      signalQuality: 'good',
      batteryLevel: '88',
      locationID: 'L1',
      facility: 'F',
      zone: 'Z',
    });
    expect(explicit).toMatchObject({
      sensorId: 'S1',
      temperatureValue: -80.5,
      temperatureUnit: 'K',
      readingStatus: 'warning',
      sensorStatus: 'offline',
      batteryLevel: 88,
      locationId: 'L1',
    });
    expect(explicit.timestamp).toBeInstanceOf(Date);

    const defaults = importService.parseTemperatureCSV({
      sensorId: 'S2',
      temperatureValue: '-70',
    });
    expect(defaults).toMatchObject({
      sensorId: 'S2',
      temperatureUnit: '°C',
      readingStatus: 'valid',
      sensorStatus: 'normal',
      signalQuality: null,
      batteryLevel: null,
      locationId: null,
      facility: null,
      zone: null,
    });
    expect(defaults.timestamp).toBeInstanceOf(Date);
  });

  it('keeps legacy locations import disabled', async () => {
    await expect(importService.importLocations()).rejects.toThrow(/somente-leitura/);
  });

  it('cleanupFile removes existing files, ignores missing files and swallows unlink errors', () => {
    const exists = vi.spyOn(fs, 'existsSync');
    const unlink = vi.spyOn(fs, 'unlinkSync');

    exists.mockReturnValueOnce(false);
    expect(() => importService.cleanupFile('/tmp/missing')).not.toThrow();
    expect(unlink).not.toHaveBeenCalled();

    exists.mockReturnValueOnce(true);
    unlink.mockImplementationOnce(() => {});
    expect(() => importService.cleanupFile('/tmp/file')).not.toThrow();
    expect(unlink).toHaveBeenCalledWith('/tmp/file');

    exists.mockReturnValueOnce(true);
    unlink.mockImplementationOnce(() => { throw new Error('unlink failed'); });
    expect(() => importService.cleanupFile('/tmp/file')).not.toThrow();
  });
});
