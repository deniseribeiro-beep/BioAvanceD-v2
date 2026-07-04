import { describe, it, expect, vi } from 'vitest';
const fhirService = require('../../src/services/fhir.service');

describe('FHIRService.validateFHIRResource', () => {
  it('returns true for valid resource', () => {
    expect(fhirService.validateFHIRResource({ resourceType: 'Patient', id: '123' })).toBe(true);
  });

  it('throws when resourceType is missing', () => {
    expect(() => fhirService.validateFHIRResource({ id: '123' })).toThrow('resourceType');
  });

  it('throws when id is missing', () => {
    expect(() => fhirService.validateFHIRResource({ resourceType: 'Patient' })).toThrow('id');
  });
});

describe('FHIRService.extractFamilyName', () => {
  it('returns empty string for null', () => {
    expect(fhirService.extractFamilyName(null)).toBe('');
  });

  it('returns last word of full name', () => {
    expect(fhirService.extractFamilyName('Maria Silva Santos')).toBe('Santos');
  });

  it('returns single word for single-word name', () => {
    expect(fhirService.extractFamilyName('Maria')).toBe('Maria');
  });
});

describe('FHIRService.extractGivenNames', () => {
  it('returns empty array for null', () => {
    expect(fhirService.extractGivenNames(null)).toEqual([]);
  });

  it('returns all words except last', () => {
    expect(fhirService.extractGivenNames('Maria Silva Santos')).toEqual(['Maria', 'Silva']);
  });

  it('returns empty array for single-word name', () => {
    expect(fhirService.extractGivenNames('Maria')).toEqual([]);
  });
});

describe('FHIRService.mapSexToFHIR', () => {
  it('maps M to male', () => {
    expect(fhirService.mapSexToFHIR('M')).toBe('male');
  });

  it('maps F to female', () => {
    expect(fhirService.mapSexToFHIR('F')).toBe('female');
  });

  it('maps O to other', () => {
    expect(fhirService.mapSexToFHIR('O')).toBe('other');
  });

  it('returns unknown for unrecognized value', () => {
    expect(fhirService.mapSexToFHIR('X')).toBe('unknown');
    expect(fhirService.mapSexToFHIR(null)).toBe('unknown');
  });
});

describe('FHIRService.mapSampleStatusToFHIR', () => {
  it('maps Available to available', () => {
    expect(fhirService.mapSampleStatusToFHIR('Available')).toBe('available');
  });

  it('maps Withdrawn to unavailable', () => {
    expect(fhirService.mapSampleStatusToFHIR('Withdrawn')).toBe('unavailable');
  });

  it('maps Destroyed to unavailable', () => {
    expect(fhirService.mapSampleStatusToFHIR('Destroyed')).toBe('unavailable');
  });

  it('defaults to available for unknown status', () => {
    expect(fhirService.mapSampleStatusToFHIR('Unknown')).toBe('available');
  });
});

describe('FHIRService.mapQualityToFHIR', () => {
  it('maps GOOD to suitable', () => {
    expect(fhirService.mapQualityToFHIR('GOOD')).toBe('suitable');
  });

  it('maps COMPROMISED to not-suitable', () => {
    expect(fhirService.mapQualityToFHIR('COMPROMISED')).toBe('not-suitable');
  });

  it('maps UNKNOWN to not-assessed', () => {
    expect(fhirService.mapQualityToFHIR('UNKNOWN')).toBe('not-assessed');
  });

  it('maps numeric 1 to suitable', () => {
    expect(fhirService.mapQualityToFHIR(1)).toBe('suitable');
  });

  it('maps numeric 0 to not-assessed', () => {
    expect(fhirService.mapQualityToFHIR(0)).toBe('not-assessed');
  });

  it('maps numeric 2 to not-suitable', () => {
    expect(fhirService.mapQualityToFHIR(2)).toBe('not-suitable');
  });

  it('maps null to not-assessed', () => {
    expect(fhirService.mapQualityToFHIR(null)).toBe('not-assessed');
  });
});

describe('FHIRService.mapSensorStatusToFHIR', () => {
  it('maps normal to active', () => {
    expect(fhirService.mapSensorStatusToFHIR('normal')).toBe('active');
  });

  it('maps error to inactive', () => {
    expect(fhirService.mapSensorStatusToFHIR('error')).toBe('inactive');
  });

  it('maps maintenance to inactive', () => {
    expect(fhirService.mapSensorStatusToFHIR('maintenance')).toBe('inactive');
  });

  it('returns unknown for unrecognized status', () => {
    expect(fhirService.mapSensorStatusToFHIR('offline')).toBe('unknown');
  });
});

describe('FHIRService.mapReadingStatusToFHIR', () => {
  it('maps valid to final', () => {
    expect(fhirService.mapReadingStatusToFHIR('valid')).toBe('final');
  });

  it('maps invalid to cancelled', () => {
    expect(fhirService.mapReadingStatusToFHIR('invalid')).toBe('cancelled');
  });

  it('maps pending to preliminary', () => {
    expect(fhirService.mapReadingStatusToFHIR('pending')).toBe('preliminary');
  });

  it('defaults to final for unknown', () => {
    expect(fhirService.mapReadingStatusToFHIR('done')).toBe('final');
  });
});

describe('FHIRService.formatDate', () => {
  it('returns null for null', () => {
    expect(fhirService.formatDate(null)).toBeNull();
  });

  it('returns ISO date part for Date object', () => {
    const d = new Date('2026-06-15T10:00:00Z');
    expect(fhirService.formatDate(d)).toBe('2026-06-15');
  });

  it('returns date part for ISO string', () => {
    expect(fhirService.formatDate('2026-06-15T10:00:00Z')).toBe('2026-06-15');
  });
});

describe('FHIRService.formatDateTime', () => {
  it('returns null for null', () => {
    expect(fhirService.formatDateTime(null)).toBeNull();
  });

  it('returns ISO string for Date object', () => {
    const d = new Date('2026-06-15T10:00:00.000Z');
    expect(fhirService.formatDateTime(d)).toBe('2026-06-15T10:00:00.000Z');
  });

  it('parses ISO string correctly', () => {
    expect(fhirService.formatDateTime('2026-06-15')).toMatch(/2026-06-15/);
  });
});

describe('FHIRService.mapSampleTypeToSNOMED', () => {
  it('maps PLASMA to SNOMED code', () => {
    expect(fhirService.mapSampleTypeToSNOMED('PLASMA')).toBe('119361006');
  });

  it('maps URINE to SNOMED code', () => {
    expect(fhirService.mapSampleTypeToSNOMED('URINE')).toBe('122575003');
  });

  it('returns fallback for unknown type', () => {
    expect(fhirService.mapSampleTypeToSNOMED('UNKNOWN_TYPE')).toBe('118234003');
  });
});

describe('FHIRService.getSampleTypeDisplay', () => {
  it('returns label for known type', () => {
    expect(fhirService.getSampleTypeDisplay('PLASMA')).toBe('Plasma');
  });

  it('returns the raw sampleType as fallback for unknown type', () => {
    expect(fhirService.getSampleTypeDisplay('UNKNOWN_TYPE')).toBe('UNKNOWN_TYPE');
  });
});

describe('FHIRService.patientToFHIR', () => {
  const fullPatient = {
    patientID: 'P100',
    patientName: 'Maria Silva Santos',
    sex: 'F',
    birthDate: '1990-05-20T00:00:00Z',
    weight: 65,
    heightCm: 170,
    recordNumber: 'REC-9',
    clinicalUnit: 'ICU',
    hypertension: true,
    diabetesType2: true,
    icdCode: 'E11',
  };

  it('builds a full FHIR Patient resource with all optional fields', () => {
    const result = fhirService.patientToFHIR(fullPatient);

    expect(result.resourceType).toBe('Patient');
    expect(result.id).toBe('P100');
    expect(result.identifier).toEqual([
      { system: 'http://bioavanced.local/patient-id', value: 'P100' },
      { system: 'http://bioavanced.local/record-number', value: 'REC-9' },
    ]);
    expect(result.name[0]).toEqual({
      use: 'official',
      family: 'Santos',
      given: ['Maria', 'Silva'],
    });
    expect(result.gender).toBe('female');
    expect(result.birthDate).toBe('1990-05-20');

    const extUrls = result.extension.map((e) => e.url);
    expect(extUrls).toEqual(
      expect.arrayContaining([
        'http://bioavanced.local/StructureDefinition/patient-weight',
        'http://bioavanced.local/StructureDefinition/patient-height',
        'http://bioavanced.local/StructureDefinition/clinical-unit',
        'http://bioavanced.local/StructureDefinition/conditions',
        'http://bioavanced.local/StructureDefinition/icd-code',
      ])
    );

    const conditionsExt = result.extension.find(
      (e) => e.url === 'http://bioavanced.local/StructureDefinition/conditions'
    );
    expect(conditionsExt.valueString).toBe('Hypertension, Diabetes Type 2');
  });

  it('builds a minimal FHIR Patient resource without optional fields', () => {
    const sparsePatient = {
      _id: 'abc123',
      patientName: 'Joao',
      sex: 'M',
      birthDate: null,
    };

    const result = fhirService.patientToFHIR(sparsePatient);

    expect(result.id).toBe('abc123');
    expect(result.identifier).toEqual([
      { system: 'http://bioavanced.local/patient-id', value: 'abc123' },
    ]);
    expect(result.name[0].family).toBe('Joao');
    expect(result.name[0].given).toEqual([]);
    expect(result.gender).toBe('male');
    expect(result.birthDate).toBeNull();
    expect(result.extension).toEqual([]);
  });

  it('throws and logs when given a non-object patient', () => {
    expect(() => fhirService.patientToFHIR(null)).toThrow();
  });
});

describe('FHIRService.sampleToFHIR', () => {
  const baseSample = {
    sampleID: 'S1',
    currentStatus: 'Available',
    sampleType: 'PLASMA',
    patientID: 'P100',
    registrationDate: '2026-01-01T00:00:00Z',
  };

  it('builds a Specimen resource with a default subject reference when no patientReference is given', () => {
    const result = fhirService.sampleToFHIR(baseSample);

    expect(result.resourceType).toBe('Specimen');
    expect(result.id).toBe('S1');
    expect(result.status).toBe('available');
    expect(result.type.coding[0]).toEqual({
      system: 'http://snomed.info/sct',
      code: '119361006',
      display: 'Plasma',
    });
    expect(result.subject).toEqual({ reference: 'Patient/P100' });
    expect(result.receivedTime).toBe('2026-01-01T00:00:00.000Z');
  });

  it('uses the given patientReference when supplied', () => {
    const ref = { reference: 'Patient/custom-ref' };
    const result = fhirService.sampleToFHIR(baseSample, ref);
    expect(result.subject).toBe(ref);
  });

  it('adds optional extensions/fields when present on the sample', () => {
    const sample = {
      ...baseSample,
      barcode: 'BC-1',
      sampleOrigin: 'Blood',
      extractionProtocol: 'Protocol-X',
      quantity: 500,
      quality: 'GOOD',
      locationID: 42,
      linkedProject: 'ProjA',
      accessionNumber: 'ACC-1',
      orderNumber: 'ORD-1',
      processingStatus: 'processed',
      linkedFiles: ['file1', 'file2'],
    };

    const result = fhirService.sampleToFHIR(sample);

    expect(result.identifier).toEqual(
      expect.arrayContaining([
        { system: 'http://bioavanced.local/barcode', value: 'BC-1' },
        { system: 'http://bioavanced.local/accession-number', value: 'ACC-1' },
      ])
    );
    expect(result.quantity).toEqual({
      value: 500,
      unit: 'µL',
      system: 'http://unitsofmeasure.org',
      code: 'uL',
    });
    expect(result.request).toEqual([{ reference: 'ServiceRequest/ORD-1' }]);

    const linkedFilesExt = result.extension.find(
      (e) => e.url === 'http://bioavanced.local/StructureDefinition/linked-files'
    );
    expect(linkedFilesExt.valueReference).toEqual([
      { reference: 'DocumentReference/file1' },
      { reference: 'DocumentReference/file2' },
    ]);
  });

  it('overrides receivedTime and sets processing/collection when protocolApplied/specimenCollection/receivedTime are present', () => {
    const sample = {
      ...baseSample,
      receivedTime: '2026-01-02T00:00:00Z',
      protocolApplied: 'Protocol-Y',
      specimenCollection: { method: { text: 'venipuncture' } },
    };

    const result = fhirService.sampleToFHIR(sample);

    expect(result.receivedTime).toBe('2026-01-02T00:00:00.000Z');
    expect(result.processing).toEqual([
      {
        description: 'Protocol-Y',
        time: '2026-01-02T00:00:00.000Z',
      },
    ]);
    expect(result.collection).toEqual(sample.specimenCollection);
  });

  it('throws and logs when given a non-object sample', () => {
    expect(() => fhirService.sampleToFHIR(null)).toThrow();
  });
});

describe('FHIRService.resultToFHIR', () => {
  const baseResult = {
    resultID: 'R1',
    testCode: 'GLU',
    testName: 'Glucose',
    sampleID: 'S1',
    testDate: '2026-02-01T00:00:00Z',
    resultValue: '95 mg/dL',
  };

  it('builds Observation and DiagnosticReport with a default subject reference', () => {
    const { observation, diagnosticReport } = fhirService.resultToFHIR(baseResult);

    expect(observation.resourceType).toBe('Observation');
    expect(observation.id).toBe('R1');
    expect(observation.status).toBe('final');
    expect(observation.code.coding[0]).toEqual({
      system: 'http://loinc.org',
      code: 'GLU',
      display: 'Glucose',
    });
    expect(observation.subject).toEqual({ reference: 'Specimen/S1' });
    expect(observation.valueString).toBe('95 mg/dL');

    expect(diagnosticReport.resourceType).toBe('DiagnosticReport');
    expect(diagnosticReport.id).toBe('dr-R1');
    expect(diagnosticReport.subject).toEqual({ reference: 'Specimen/S1' });
    expect(diagnosticReport.result).toEqual([{ reference: 'Observation/R1' }]);
  });

  it('uses the given sampleReference and falls back to defaults for missing testCode/testName', () => {
    const ref = { reference: 'Specimen/custom-ref' };
    const result = { resultID: 'R2', sampleID: 'S2' };

    const { observation, diagnosticReport } = fhirService.resultToFHIR(result, ref);

    expect(observation.subject).toBe(ref);
    expect(diagnosticReport.subject).toBe(ref);
    expect(observation.code.coding[0].code).toBe('UNKNOWN');
    expect(observation.code.coding[0].display).toBe('Unknown Test');
    expect(observation.valueString).toBeNull();
  });

  it('throws and logs when given a non-object result', () => {
    expect(() => fhirService.resultToFHIR(null)).toThrow();
  });

  it('adds file extensions to observation when filePath/fileType are present', () => {
    const result = { ...baseResult, filePath: '/files/r1.pdf', fileType: 'pdf' };
    const { observation } = fhirService.resultToFHIR(result);

    const extUrls = observation.extension.map((e) => e.url);
    expect(extUrls).toEqual(
      expect.arrayContaining([
        'http://bioavanced.local/StructureDefinition/result-file',
        'http://bioavanced.local/StructureDefinition/result-file-type',
      ])
    );
  });
});

describe('FHIRService.temperatureToFHIR', () => {
  it('builds Device and Observation resources from a temperature reading', () => {
    const temperature = {
      sensorId: 'SENSOR-1',
      sensorStatus: 'normal',
      locationId: 7,
      facility: 'Lab A',
      zone: 'Freezer-1',
      _id: 'T1',
      readingStatus: 'valid',
      timestamp: '2026-03-01T10:00:00Z',
      temperatureValue: -20,
      temperatureUnit: '°C',
      signalQuality: 'good',
      batteryLevel: 80,
    };

    const { device, observation } = fhirService.temperatureToFHIR(temperature);

    expect(device.resourceType).toBe('Device');
    expect(device.id).toBe('device-SENSOR-1');
    expect(device.status).toBe('active');
    const deviceExtUrls = device.extension.map((e) => e.url);
    expect(deviceExtUrls).toEqual(
      expect.arrayContaining([
        'http://bioavanced.local/StructureDefinition/location-id',
        'http://bioavanced.local/StructureDefinition/facility',
        'http://bioavanced.local/StructureDefinition/zone',
      ])
    );

    expect(observation.resourceType).toBe('Observation');
    expect(observation.status).toBe('final');
    expect(observation.device).toEqual({ reference: 'Device/device-SENSOR-1' });
    expect(observation.valueQuantity).toEqual({
      value: -20,
      unit: '°C',
      system: 'http://unitsofmeasure.org',
      code: '[degC]',
    });
    const obsExtUrls = observation.extension.map((e) => e.url);
    expect(obsExtUrls).toEqual(
      expect.arrayContaining([
        'http://bioavanced.local/StructureDefinition/signal-quality',
        'http://bioavanced.local/StructureDefinition/battery-level',
      ])
    );
  });

  it('uses [degF] code and inactive status for error sensors reporting Fahrenheit', () => {
    const temperature = {
      sensorId: 'SENSOR-2',
      sensorStatus: 'error',
      readingStatus: 'invalid',
      timestamp: '2026-03-01T10:00:00Z',
      temperatureValue: 32,
      temperatureUnit: '°F',
    };

    const { device, observation } = fhirService.temperatureToFHIR(temperature);

    expect(device.status).toBe('inactive');
    expect(observation.status).toBe('cancelled');
    expect(observation.valueQuantity.code).toBe('[degF]');
    expect(observation.valueQuantity.unit).toBe('°F');
    expect(device.extension).toEqual([]);
    expect(observation.extension).toEqual([]);
  });

  it('throws and logs when given a non-object temperature', () => {
    expect(() => fhirService.temperatureToFHIR(null)).toThrow();
  });
});

describe('FHIRService.findResourceByIdentifier', () => {
  it('queries the collection by fhir.identifier system/value and returns the match', async () => {
    const found = { _id: 'x1', fhir: { identifier: [{ system: 'sys', value: '42' }] } };
    const findOne = vi.fn().mockResolvedValue(found);
    const db = { collection: vi.fn().mockReturnValue({ findOne }) };

    const result = await fhirService.findResourceByIdentifier(db, 'patients', 'sys', 42);

    expect(db.collection).toHaveBeenCalledWith('patients');
    expect(findOne).toHaveBeenCalledWith({
      'fhir.identifier': {
        $elemMatch: { system: 'sys', value: '42' },
      },
    });
    expect(result).toBe(found);
  });

  it('throws and logs when the db call rejects', async () => {
    const db = {
      collection: vi.fn().mockReturnValue({
        findOne: vi.fn().mockRejectedValue(new Error('db down')),
      }),
    };

    await expect(
      fhirService.findResourceByIdentifier(db, 'patients', 'sys', '1')
    ).rejects.toThrow('db down');
  });
});
