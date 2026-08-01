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

    it('generates a fresh sprecProfileId (P1X-0057) on every create, even for the same specimenId', () => {
      const uuidV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      const first = SpecimenPreanalyticsModel.create({ specimenId: 'SPEC-1' });
      const second = SpecimenPreanalyticsModel.create({ specimenId: 'SPEC-1' });

      expect(first.sprecProfileId).toMatch(uuidV4);
      expect(second.sprecProfileId).toMatch(uuidV4);
      expect(first.sprecProfileId).not.toBe(second.sprecProfileId);
    });

    it('honors an explicit sprecProfileId (backfilled snapshots keep their original identity)', () => {
      const doc = SpecimenPreanalyticsModel.create({ specimenId: 'SPEC-1', sprecProfileId: 'fixed-id-1' });
      expect(doc.sprecProfileId).toBe('fixed-id-1');
    });

    it('defaults profileStatus (P1X-0059) to draft when not provided', () => {
      const doc = SpecimenPreanalyticsModel.create({ specimenId: 'SPEC-1' });
      expect(doc.profileStatus).toBe('draft');
    });

    it('honors an explicit profileStatus', () => {
      const doc = SpecimenPreanalyticsModel.create({ specimenId: 'SPEC-1', profileStatus: 'validado' });
      expect(doc.profileStatus).toBe('validado');
    });

    it('passes through sprecCode (ELM-0145) and sprecVersion (ELM-0146) unmodified when provided', () => {
      const doc = SpecimenPreanalyticsModel.create({
        specimenId: 'SPEC-1',
        sprecCode: 'BLD-PED-C-A-D-E-F',
        sprecVersion: '2.0',
      });
      expect(doc.sprecCode).toBe('BLD-PED-C-A-D-E-F');
      expect(doc.sprecVersion).toBe('2.0');
    });

    it('defaults sprecCode and sprecVersion to null when not provided', () => {
      const doc = SpecimenPreanalyticsModel.create({ specimenId: 'SPEC-1' });
      expect(doc.sprecCode).toBeNull();
      expect(doc.sprecVersion).toBeNull();
    });

    it('derives sprecSpecimenType (ELM-0147, fluid/solid axis element 1) from sampleType regardless of matrixType', () => {
      const fluid = SpecimenPreanalyticsModel.create({ specimenId: 'SPEC-1', matrixType: 'fluid', sampleType: 'BLD' });
      const solid = SpecimenPreanalyticsModel.create({ specimenId: 'SPEC-1', matrixType: 'solid', sampleType: 'TIS' });

      expect(fluid.sprecSpecimenType).toBe('BLD');
      expect(solid.sprecSpecimenType).toBe('TIS');
    });

    it('derives sprecPrimaryContainer (ELM-0148, fluid-only) from primaryContainer when matrixType is fluid', () => {
      const doc = SpecimenPreanalyticsModel.create({
        specimenId: 'SPEC-1', matrixType: 'fluid', primaryContainer: 'PED',
      });
      expect(doc.sprecPrimaryContainer).toBe('PED');
      expect(doc.sprecCollectionType).toBeNull();
    });

    it('derives sprecCollectionType (ELM-0149, solid-only) from primaryContainer when matrixType is solid', () => {
      const doc = SpecimenPreanalyticsModel.create({
        specimenId: 'SPEC-1', matrixType: 'solid', primaryContainer: 'BPS',
      });
      expect(doc.sprecCollectionType).toBe('BPS');
      expect(doc.sprecPrimaryContainer).toBeNull();
    });

    it('leaves sprecPrimaryContainer/sprecCollectionType null when matrixType is unknown', () => {
      const doc = SpecimenPreanalyticsModel.create({ specimenId: 'SPEC-1', primaryContainer: 'PED' });
      expect(doc.sprecPrimaryContainer).toBeNull();
      expect(doc.sprecCollectionType).toBeNull();
    });

    it('derives the solid-only ischemia/fixation fields (ELM-0154..0157) from the existing axis 3-6 slots only when matrixType is solid', () => {
      const solid = SpecimenPreanalyticsModel.create({
        specimenId: 'SPEC-1',
        matrixType: 'solid',
        preCentrifugation: 'B',
        centrifugation: 'C',
        secondCentrifugation: 'NBF',
        postCentrifugationDelay: 'D',
      });

      expect(solid.warmIschemiaTime).toBe('B');
      expect(solid.coldIschemiaTime).toBe('C');
      expect(solid.fixationStabilizationType).toBe('NBF');
      expect(solid.fixationTime).toBe('D');

      const fluid = SpecimenPreanalyticsModel.create({
        specimenId: 'SPEC-1',
        matrixType: 'fluid',
        preCentrifugation: 'B',
        centrifugation: 'C',
        secondCentrifugation: 'NBF',
        postCentrifugationDelay: 'D',
      });

      expect(fluid.warmIschemiaTime).toBeNull();
      expect(fluid.coldIschemiaTime).toBeNull();
      expect(fluid.fixationStabilizationType).toBeNull();
      expect(fluid.fixationTime).toBeNull();
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
