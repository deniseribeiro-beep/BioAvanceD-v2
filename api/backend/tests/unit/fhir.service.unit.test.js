import { describe, it, expect } from 'vitest';
const fhirService = require('../../src/services/fhir.service');

describe('FHIRService.validateFHIRResource', () => {
  it('returns true for valid resource', () => {
    expect(fhirService.validateFHIRResource({ resourceType: 'Patient', id: '123' })).toBe(true);
  });

  it('throws when resourceType is missing', () => {
    expect(() => fhirService.validateFHIRResource({ id: '123' })).toThrow('Recurso FHIR inválido');
  });

  it('throws when id is missing', () => {
    expect(() => fhirService.validateFHIRResource({ resourceType: 'Patient' })).toThrow('Recurso FHIR inválido');
  });
});

describe('FHIRService.toFhirPatient', () => {
  it('builds a FHIR Patient resource from a participant plus its resolved identity', () => {
    const participant = {
      participantId: 'P100',
      sex: 'female',
    };
    const identity = {
      patientName: 'Maria Silva Santos',
      birthDate: '1990-05-20',
    };

    const result = fhirService.toFhirPatient(participant, identity);

    expect(result.resourceType).toBe('Patient');
    expect(result.id).toBe('P100');
    expect(result.identifier).toEqual([{ value: 'P100' }]);
    expect(result.name).toEqual([{ use: 'official', text: 'Maria Silva Santos' }]);
    expect(result.birthDate).toBe('1990-05-20');
    expect(result.gender).toBe('female');
  });

  it('falls back to empty identifier/name and unknown gender when fields and identity are absent', () => {
    const result = fhirService.toFhirPatient({});

    expect(result.id).toBeUndefined();
    expect(result.identifier).toEqual([]);
    expect(result.name).toEqual([]);
    expect(result.birthDate).toBeUndefined();
    expect(result.gender).toBe('unknown');
  });

  it('falls back to empty name/birthDate when a participant is given but no identity is resolved', () => {
    const result = fhirService.toFhirPatient({ participantId: 'P100', sex: 'male' });

    expect(result.name).toEqual([]);
    expect(result.birthDate).toBeUndefined();
    expect(result.gender).toBe('male');
  });

  it('throws when given a non-object participant', () => {
    expect(() => fhirService.toFhirPatient(null)).toThrow();
  });
});

describe('FHIRService.toFhirSpecimen', () => {
  it('builds a FHIR Specimen resource from a specimen', () => {
    const specimen = {
      specimenId: 'S1',
      participantId: 'P100',
      registeredAt: '2026-01-01T00:00:00Z',
      specimenStatus: 'available',
    };

    const result = fhirService.toFhirSpecimen(specimen);

    expect(result.resourceType).toBe('Specimen');
    expect(result.id).toBe('S1');
    expect(result.identifier).toEqual([{ value: 'S1' }]);
    expect(result.subject).toEqual({ reference: 'Patient/P100' });
    expect(result.receivedTime).toBe('2026-01-01T00:00:00Z');
    expect(result.status).toBe('available');
  });

  it('falls back to empty identifier, no subject, and available status when fields are absent', () => {
    const result = fhirService.toFhirSpecimen({});

    expect(result.identifier).toEqual([]);
    expect(result.subject).toBeUndefined();
    expect(result.receivedTime).toBeUndefined();
    expect(result.status).toBe('available');
  });

  it('throws when given a non-object specimen', () => {
    expect(() => fhirService.toFhirSpecimen(null)).toThrow();
  });

  it('uses specimenStatus when present', () => {
    const specimen = {
      specimenId: 'S1',
      specimenStatus: 'quarantined',
    };

    const result = fhirService.toFhirSpecimen(specimen);

    expect(result.status).toBe('quarantined');
  });
});

describe('FHIRService.toFhirConsent', () => {
  it('builds an active Consent resource when consent is granted', () => {
    const result = fhirService.toFhirConsent({ consentTemplateId: 'CT-1', consentGranted: true });

    expect(result.resourceType).toBe('Consent');
    expect(result.id).toBe('CT-1');
    expect(result.status).toBe('active');
  });

  it('builds an inactive Consent resource when consent is not granted', () => {
    const result = fhirService.toFhirConsent({ consentTemplateId: 'CT-2', consentGranted: false });

    expect(result.status).toBe('inactive');
  });

  it('throws when given a non-object consent', () => {
    expect(() => fhirService.toFhirConsent(null)).toThrow();
  });
});

describe('FHIRService.resultToFHIR', () => {
  it('builds Observation and DiagnosticReport resources keyed off resultID', () => {
    const { observation, diagnosticReport } = fhirService.resultToFHIR({ resultID: 'R1' });

    expect(observation.resourceType).toBe('Observation');
    expect(observation.id).toBe('R1');
    expect(diagnosticReport.resourceType).toBe('DiagnosticReport');
    expect(diagnosticReport.id).toBe('dr-R1');
  });

  it('falls back to _id then the literal "result" when resultID is absent', () => {
    const { observation, diagnosticReport } = fhirService.resultToFHIR({ _id: 'abc' });
    expect(observation.id).toBe('abc');
    expect(diagnosticReport.id).toBe('dr-abc');

    const fallback = fhirService.resultToFHIR({});
    expect(fallback.observation.id).toBe('result');
    expect(fallback.diagnosticReport.id).toBe('dr-result');
  });

  it('throws when given a non-object result', () => {
    expect(() => fhirService.resultToFHIR(null)).toThrow();
  });
});

describe('FHIRService.temperatureToFHIR', () => {
  it('builds Device and Observation resources keyed off sensorId', () => {
    const { device, observation } = fhirService.temperatureToFHIR({
      sensorId: 'SENSOR-1',
      _id: 'T1',
    });

    expect(device.resourceType).toBe('Device');
    expect(device.id).toBe('device-SENSOR-1');
    expect(observation.resourceType).toBe('Observation');
    expect(observation.id).toBe('temp-T1');
  });

  it('falls back to unknown sensor and timestamp/reading defaults when fields are absent', () => {
    const { device, observation } = fhirService.temperatureToFHIR({ timestamp: 'ts-1' });
    expect(device.id).toBe('device-unknown');
    expect(observation.id).toBe('temp-ts-1');

    const fallback = fhirService.temperatureToFHIR({});
    expect(fallback.observation.id).toBe('temp-reading');
  });

  it('throws when given a non-object temperature', () => {
    expect(() => fhirService.temperatureToFHIR(null)).toThrow();
  });
});
