import { afterEach, describe, expect, it, vi } from 'vitest';

const {
  deepSort,
  stableSerialize,
  generateSampleHash,
  generateSampleHashFromSample,
} = require('../../src/services/MerkleService');
const rcsAssessmentService = require('../../src/services/rcs-assessment.service');
const specimenPreanalyticsService = require('../../src/services/specimen-preanalytics.service');
const {
  serializeLogSimple,
  serializeValue,
  isObjectId,
} = require('../../src/utils/logSerializer');

afterEach(() => {
  vi.restoreAllMocks();
});

describe('item 8 simple branch coverage', () => {
  describe('MerkleService', () => {
    it('covers Date sorting and alternate participant/pharmacology field names', () => {
      const date = new Date('2026-01-02T03:04:05.000Z');
      expect(deepSort(date)).toBe('2026-01-02T03:04:05.000Z');
      expect(stableSerialize({ b: date, a: 1 })).toBe(
        '{"a":1,"b":"2026-01-02T03:04:05.000Z"}'
      );

      const snakeCaseHash = generateSampleHash({
        participant_identity: {
          participant_id: ' 12345678 ',
          participant_name: ' Paciente ',
        },
        pharmacologyData: {
          treatment_status: 'naive',
          medication_name: 'medicação',
          atc_code: 'ATC:a01aa01',
          atc_level_1: 'a',
          last_dose_date: '2026-01-01',
          washout_start_date: '2026-01-02',
          washout_end_date: '2026-01-03',
        },
      });

      const thirdAliasHash = generateSampleHash({
        participant_identity: {
          participantId: '12345678',
          patientName: 'Paciente',
        },
        pharmacologyData: {
          treatmentStatus: '',
          drug_name: 'medicação',
          medication_code: 'a01aa01',
          medication_drug_class: 'a',
        },
      });

      expect(snakeCaseHash).toMatch(/^[a-f0-9]{64}$/);
      expect(thirdAliasHash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('covers pinned sparse RCS and SPREC snapshots and their null fallbacks', async () => {
      const getAssessmentById = vi
        .spyOn(rcsAssessmentService, 'getAssessmentById')
        .mockResolvedValue({});
      const getProfileById = vi
        .spyOn(specimenPreanalyticsService, 'getProfileById')
        .mockResolvedValue({});
      const newestRcs = vi.spyOn(rcsAssessmentService, 'getAssessmentsForSpecimen');
      const newestSprec = vi.spyOn(specimenPreanalyticsService, 'getProfilesForSpecimen');

      const sample = {
        specimenId: 'SPEC-SIMPLE-1',
        participantId: '12345678',
        sealedRcsAssessmentId: 'rcs-1',
        sealedSpecimenPreanalyticsId: 'sprec-1',
        rcsScore: 99,
        finalGrade: 'A',
        sprec: { matrixType: 'legacy' },
      };

      const hash = await generateSampleHashFromSample({}, sample);

      expect(hash).toMatch(/^[a-f0-9]{64}$/);
      expect(getAssessmentById).toHaveBeenCalledWith({}, 'rcs-1');
      expect(getProfileById).toHaveBeenCalledWith({}, 'sprec-1');
      expect(newestRcs).not.toHaveBeenCalled();
      expect(newestSprec).not.toHaveBeenCalled();
    });
  });

  describe('logSerializer', () => {
    it('covers circular references and ObjectId-like detection failures', () => {
      const circular = { name: 'root' };
      circular.self = circular;
      expect(serializeValue(circular)).toEqual({
        name: 'root',
        self: '[Referência circular]',
      });

      const brokenObjectIdLike = {
        toString() {
          throw new Error('cannot stringify');
        },
        toHexString() {
          return 'unused';
        },
        valueOf() {
          return this;
        },
      };
      expect(isObjectId(brokenObjectIdLike)).toBe(false);

      const notObjectIdLike = {
        toString() {
          return '507f1f77bcf86cd799439011';
        },
        toHexString() {
          return '507f1f77bcf86cd799439011';
        },
        // Override Object.prototype.valueOf so this exercises the
        // "missing characteristic method" branch instead of satisfying all
        // three ObjectId-like method checks via inheritance.
        valueOf: null,
      };
      expect(isObjectId(notObjectIdLike)).toBe(false);
    });

    it('covers simple serializer alternate object/date/entity identifier paths', () => {
      const nullPrototypeId = Object.create(null);
      nullPrototypeId.kind = 'opaque';

      const throwingEntity = {
        safe: 'value',
        toString() {
          throw new Error('boom');
        },
      };

      const result = serializeLogSimple({
        _id: nullPrototypeId,
        timestamp: new Date('2026-02-01T00:00:00.000Z'),
        dateTime: new Date('2026-02-02T00:00:00.000Z'),
        createdAt: new Date('2026-02-03T00:00:00.000Z'),
        updatedAt: new Date('2026-02-04T00:00:00.000Z'),
        payload: { nested: { value: 1 } },
        metadata: { nested: { value: 2 } },
        entityID: { _value: 42 },
        userID: { toString: () => 'user-upper' },
        userId: { toString: () => 'user-lower' },
      });

      expect(result.timestamp).toBe('2026-02-01T00:00:00.000Z');
      expect(result.dateTime).toBe('2026-02-02T00:00:00.000Z');
      expect(result.createdAt).toBe('2026-02-03T00:00:00.000Z');
      expect(result.updatedAt).toBe('2026-02-04T00:00:00.000Z');
      expect(result.entityID).toBe('42');
      expect(result.userID).toBe('user-upper');
      expect(result.userId).toBe('user-lower');

      expect(serializeLogSimple({ entityID: nullPrototypeId }).entityID)
        .toBe('{"kind":"opaque"}');
      expect(serializeLogSimple({ entityID: throwingEntity }).entityID)
        .toContain('"safe":"value"');
      expect(serializeLogSimple({ entityID: Symbol('entity') }).entityID)
        .toBe('Symbol(entity)');
      expect(serializeLogSimple({ _type: 'already-serialized', _value: 'x' }))
        .toEqual({ _type: 'already-serialized', _value: 'x' });
      expect(serializeLogSimple({ timestamp: 'already-a-string' }).timestamp)
        .toBe('already-a-string');
      expect(serializeLogSimple({ timestamp: { _type: 'Date', _value: 'x' } }).timestamp)
        .toEqual({ _type: 'Date', _value: 'x' });
    });
  });
});
