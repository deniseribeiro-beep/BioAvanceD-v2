import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const SpecimenPreanalyticsModel = require('../../../src/models/SpecimenPreanalytics');

describe('SpecimenPreanalyticsModel', () => {
  describe('create', () => {
    it('requires specimenId', () => {
      expect(() => SpecimenPreanalyticsModel.create({})).toThrow('specimenId é obrigatório para SpecimenPreanalytics');
    });

    it('builds a full profile document with defaults for missing fields', () => {
      const doc = SpecimenPreanalyticsModel.create({ specimenId: 'SPEC-1' });

      expect(doc.specimenId).toBe('SPEC-1');
      expect(doc.matrixType).toBeNull();
      expect(doc.longTermStorage).toBeNull();
      expect(doc.recordedAt).toBeInstanceOf(Date);
      expect(doc.createdAt).toBeInstanceOf(Date);
    });

    it('honors an explicit recordedAt (for backfilled/historical snapshots)', () => {
      const doc = SpecimenPreanalyticsModel.create({ specimenId: 'SPEC-1', recordedAt: '2026-01-01T00:00:00.000Z' });
      expect(doc.recordedAt.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    });
  });

  describe('fromSprecData', () => {
    it('maps the sprec object import.service.js already parses onto this entity\'s fields', () => {
      const sprec = {
        matrixType: 'fluid',
        sampleType: 'BLD',
        primaryContainer: 'PED',
        preCentrifugation: 'C',
        centrifugation: 'A',
        secondCentrifugation: 'D',
        postCentrifugationDelay: 'E',
        longTermStorage: 'F',
      };

      const doc = SpecimenPreanalyticsModel.fromSprecData('SPEC-2', sprec);

      expect(doc).toMatchObject({
        specimenId: 'SPEC-2',
        matrixType: 'fluid',
        sampleType: 'BLD',
        primaryContainer: 'PED',
        preCentrifugation: 'C',
        centrifugation: 'A',
        secondCentrifugation: 'D',
        postCentrifugationDelay: 'E',
        longTermStorage: 'F',
      });
    });

    it('tolerates a partial sprec object (fields default to null, not thrown)', () => {
      const doc = SpecimenPreanalyticsModel.fromSprecData('SPEC-3', { matrixType: 'solid' });

      expect(doc.matrixType).toBe('solid');
      expect(doc.sampleType).toBeNull();
      expect(doc.longTermStorage).toBeNull();
    });
  });
});
