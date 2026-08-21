import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const ClinicalObservationModel = require('../../../src/models/ClinicalObservation');

const LOINC_CODING = { systemUri: 'http://loinc.org', code: '718-7', display: 'Hemoglobin' };

describe('ClinicalObservationModel', () => {
  describe('create', () => {
    it('requires participantId, observationCoding, effectiveDateTime, and observationStatus', () => {
      expect(() => ClinicalObservationModel.create({})).toThrow(
        'participantId é obrigatório para ClinicalObservation, observationCoding é obrigatório para ClinicalObservation (systemUri e code), effectiveDateTime é obrigatório para ClinicalObservation, observationStatus é obrigatório para ClinicalObservation'
      );
    });

    it('builds a full observation document with a generated observationId', () => {
      const doc = ClinicalObservationModel.create({
        participantId: 'PART-1',
        observationCoding: LOINC_CODING,
        effectiveDateTime: '2026-01-01',
        observationStatus: 'final',
      });

      expect(doc.observationId).toMatch(/^[0-9a-f-]{36}$/);
      expect(doc.observationCoding).toEqual(LOINC_CODING);
      expect(doc.value).toBeNull();
      expect(doc.normalizedValue).toBeNull();
      expect(doc.referenceRange).toEqual([]);
      expect(doc.interpretation).toEqual([]);
      expect(doc.deviceId).toBeNull();
      expect(doc.specimenId).toBeNull();
      expect(doc.encounterId).toBeNull();
    });

    it('preserves value and normalizedValue as distinct fields (dict-02: não sobrescrever o original)', () => {
      const doc = ClinicalObservationModel.create({
        participantId: 'PART-1',
        observationCoding: LOINC_CODING,
        effectiveDateTime: '2026-01-01',
        observationStatus: 'final',
        value: 13.2,
        unit: { systemUri: 'http://unitsofmeasure.org', code: 'g/dL' },
        normalizedValue: { value: 132, unit: 'g/L' },
      });

      expect(doc.value).toBe(13.2);
      expect(doc.normalizedValue).toEqual({ value: 132, unit: 'g/L' });
    });

    it('carries deviceId/specimenId/diagnosticReportId/encounterId when given', () => {
      const doc = ClinicalObservationModel.create({
        participantId: 'PART-1',
        observationCoding: LOINC_CODING,
        effectiveDateTime: '2026-01-01',
        observationStatus: 'final',
        deviceId: 'dev-1',
        specimenId: 'SPEC-1',
        diagnosticReportId: 'DiagnosticReport/dr-1',
        encounterId: 'enc-1',
      });

      expect(doc.deviceId).toBe('dev-1');
      expect(doc.specimenId).toBe('SPEC-1');
      expect(doc.diagnosticReportId).toBe('DiagnosticReport/dr-1');
      expect(doc.encounterId).toBe('enc-1');
    });
  });
});
