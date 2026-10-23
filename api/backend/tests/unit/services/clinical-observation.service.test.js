import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const {
  createClinicalObservation,
  getClinicalObservationsForParticipant,
  getClinicalObservationById,
} = require('../../../src/services/clinical-observation.service');
const { createFakeDb } = require('../ingestion/testHelpers');

const LOINC_CODING = { systemUri: 'http://loinc.org', code: '718-7' };

describe('clinical-observation.service', () => {
  describe('createClinicalObservation', () => {
    it('persists an observation with no specimenId/deviceId supplied', async () => {
      const db = createFakeDb({});

      const stored = await createClinicalObservation(db, {
        participantId: 'PART-1',
        observationCoding: LOINC_CODING,
        effectiveDateTime: '2026-01-01',
        observationStatus: 'final',
      });

      expect(stored.participantId).toBe('PART-1');
      expect(db.collections.clinicalObservations.docs).toHaveLength(1);
    });

    it('persists an observation whose specimenId/deviceId resolve to real samples/devices', async () => {
      const db = createFakeDb({
        samples: [{ specimenId: 'SPEC-1' }],
        devices: [{ deviceId: 'dev-1' }],
      });

      const stored = await createClinicalObservation(db, {
        participantId: 'PART-1',
        observationCoding: LOINC_CODING,
        effectiveDateTime: '2026-01-01',
        observationStatus: 'final',
        specimenId: 'SPEC-1',
        deviceId: 'dev-1',
      });

      expect(stored.specimenId).toBe('SPEC-1');
      expect(stored.deviceId).toBe('dev-1');
    });

    it('rejects (RF005/#691) a specimenId that does not resolve to a real sample, without persisting anything', async () => {
      const db = createFakeDb({ samples: [], devices: [] });

      await expect(
        createClinicalObservation(db, {
          participantId: 'PART-1',
          observationCoding: LOINC_CODING,
          effectiveDateTime: '2026-01-01',
          observationStatus: 'final',
          specimenId: 'SPEC-UNKNOWN',
        })
      ).rejects.toThrow(/Referência inexistente.*specimenId/);
      expect(db.collections.clinicalObservations?.docs || []).toHaveLength(0);
    });

    it('rejects a deviceId that does not resolve to a real device', async () => {
      const db = createFakeDb({ samples: [], devices: [] });

      await expect(
        createClinicalObservation(db, {
          participantId: 'PART-1',
          observationCoding: LOINC_CODING,
          effectiveDateTime: '2026-01-01',
          observationStatus: 'final',
          deviceId: 'dev-unknown',
        })
      ).rejects.toThrow(/Referência inexistente.*deviceId/);
    });

    it('propagates model validation failures before ever checking references', async () => {
      const db = createFakeDb({});

      await expect(createClinicalObservation(db, {})).rejects.toThrow('participantId é obrigatório para ClinicalObservation');
    });
  });

  describe('createClinicalObservation diagnosticReportId (#695, ELM-0232)', () => {
    const base = { participantId: 'PART-1', observationCoding: LOINC_CODING, effectiveDateTime: '2026-01-01', observationStatus: 'final' };

    it('persists a typed DiagnosticReport/dr-1 that resolves to a real report', async () => {
      const db = createFakeDb({ diagnosticReports: [{ diagnosticReportId: 'dr-1' }] });

      const stored = await createClinicalObservation(db, { ...base, diagnosticReportId: 'DiagnosticReport/dr-1' });

      expect(stored.diagnosticReportId).toBe('DiagnosticReport/dr-1');
      expect(db.collections.clinicalObservations.docs).toHaveLength(1);
    });

    it('persists a bare dr-1 that resolves to a real report', async () => {
      const db = createFakeDb({ diagnosticReports: [{ diagnosticReportId: 'dr-1' }] });

      const stored = await createClinicalObservation(db, { ...base, diagnosticReportId: 'dr-1' });

      expect(stored.diagnosticReportId).toBe('dr-1');
      expect(db.collections.clinicalObservations.docs).toHaveLength(1);
    });

    it('rejects a diagnosticReportId that does not resolve, without persisting anything', async () => {
      const db = createFakeDb({ diagnosticReports: [] });

      await expect(createClinicalObservation(db, { ...base, diagnosticReportId: 'dr-unknown' })).rejects.toThrow(
        /Referência inexistente.*diagnosticReportId/
      );
      expect(db.collections.clinicalObservations?.docs || []).toHaveLength(0);
    });

    it('rejects DiagnosticReport/ with no id as malformed, without persisting anything', async () => {
      const db = createFakeDb({ diagnosticReports: [{ diagnosticReportId: 'dr-1' }] });

      await expect(createClinicalObservation(db, { ...base, diagnosticReportId: 'DiagnosticReport/' })).rejects.toThrow(
        'Referência malformada: diagnosticReportId="DiagnosticReport/"'
      );
      expect(db.collections.clinicalObservations?.docs || []).toHaveLength(0);
    });
  });

  describe('getClinicalObservationsForParticipant', () => {
    it('scopes results to the requested participantId only', async () => {
      const db = createFakeDb({});
      await createClinicalObservation(db, { participantId: 'PART-1', observationCoding: LOINC_CODING, effectiveDateTime: '2026-01-01', observationStatus: 'final' });
      await createClinicalObservation(db, { participantId: 'PART-2', observationCoding: LOINC_CODING, effectiveDateTime: '2026-01-01', observationStatus: 'final' });

      const observations = await getClinicalObservationsForParticipant(db, 'PART-1');

      expect(observations).toHaveLength(1);
      expect(observations[0].participantId).toBe('PART-1');
    });
  });

  describe('getClinicalObservationById', () => {
    it('resolves by observationId, not Mongo _id', async () => {
      const db = createFakeDb({});
      const created = await createClinicalObservation(db, {
        observationId: 'obs-fixed',
        participantId: 'PART-1',
        observationCoding: LOINC_CODING,
        effectiveDateTime: '2026-01-01',
        observationStatus: 'final',
      });

      const resolved = await getClinicalObservationById(db, created.observationId);

      expect(resolved.observationId).toBe('obs-fixed');
    });

    it('returns null for a null/undefined id instead of querying', async () => {
      const db = createFakeDb({});
      expect(await getClinicalObservationById(db, null)).toBeNull();
    });
  });
});
