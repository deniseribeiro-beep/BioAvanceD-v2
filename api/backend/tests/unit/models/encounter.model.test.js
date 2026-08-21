import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const EncounterModel = require('../../../src/models/Encounter');

describe('EncounterModel', () => {
  describe('create', () => {
    it('requires participantId, encounterType, and encounterPeriod.start', () => {
      expect(() => EncounterModel.create({})).toThrow(
        'participantId é obrigatório para Encounter, encounterType é obrigatório para Encounter, encounterPeriod.start é obrigatório para Encounter'
      );
    });

    it('builds a full encounter document with a generated encounterId', () => {
      const doc = EncounterModel.create({
        participantId: 'PART-1',
        encounterType: 'outpatient',
        encounterPeriod: { start: '2026-01-01T00:00:00.000Z' },
      });

      expect(doc.encounterId).toMatch(/^[0-9a-f-]{36}$/);
      expect(doc.participantId).toBe('PART-1');
      expect(doc.encounterType).toBe('outpatient');
      expect(doc.encounterPeriod.start).toBeInstanceOf(Date);
      expect(doc.encounterPeriod.end).toBeNull();
      expect(doc.serviceProvider).toBeNull();
      expect(doc.encounterLocation).toEqual([]);
      expect(doc.createdAt).toBeInstanceOf(Date);
      expect(doc.updatedAt).toBeInstanceOf(Date);
    });

    it('honors an explicit encounterId instead of generating one', () => {
      const doc = EncounterModel.create({
        encounterId: 'fixed-id',
        participantId: 'PART-1',
        encounterType: 'outpatient',
        encounterPeriod: { start: '2026-01-01' },
      });

      expect(doc.encounterId).toBe('fixed-id');
    });

    it('carries an optional serviceProvider and encounterLocation[]', () => {
      const doc = EncounterModel.create({
        participantId: 'PART-1',
        encounterType: 'inpatient',
        encounterPeriod: { start: '2026-01-01', end: '2026-01-05' },
        serviceProvider: 'Organization/org-1',
        encounterLocation: ['Location/loc-1', 'Location/loc-2'],
      });

      expect(doc.serviceProvider).toBe('Organization/org-1');
      expect(doc.encounterLocation).toEqual(['Location/loc-1', 'Location/loc-2']);
      expect(doc.encounterPeriod.end).toBeInstanceOf(Date);
    });

    it('accepts a CodeableConcept-shaped encounterType, not just a plain string', () => {
      const doc = EncounterModel.create({
        participantId: 'PART-1',
        encounterType: { code: 'AMB', system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode' },
        encounterPeriod: { start: '2026-01-01' },
      });

      expect(doc.encounterType).toEqual({ code: 'AMB', system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode' });
    });
  });
});
