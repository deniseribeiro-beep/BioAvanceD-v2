import { describe, it, expect } from 'vitest';
const importService = require('../../src/services/import.service');

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
    expect(fields).toContain('patientID');
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
