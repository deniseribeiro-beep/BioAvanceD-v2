import { describe, it, expect } from 'vitest';
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
