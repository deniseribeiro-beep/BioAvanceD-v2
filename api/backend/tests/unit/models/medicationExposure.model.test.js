import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const MedicationExposureModel = require('../../../src/models/MedicationExposure');

const ATC_CODING = { systemUri: 'http://www.whocc.no/atc', code: 'N02BE01' };

describe('MedicationExposureModel', () => {
  describe('create', () => {
    it('requires a non-empty medicationCoding, recordType, and medicationStatus', () => {
      expect(() => MedicationExposureModel.create({})).toThrow(
        'medicationCoding é obrigatório para MedicationExposure (1..*, cada item precisa de systemUri e code), recordType é obrigatório para MedicationExposure, medicationStatus é obrigatório para MedicationExposure'
      );
    });

    it('drops medicationCoding entries missing systemUri or code, and fails if none remain', () => {
      expect(() =>
        MedicationExposureModel.create({
          medicationCoding: [{ code: 'no-system' }],
          recordType: 'administered',
          medicationStatus: 'active',
        })
      ).toThrow('medicationCoding é obrigatório');
    });

    it('builds a full exposure document with a generated medicationRecordId', () => {
      const doc = MedicationExposureModel.create({
        medicationCoding: [ATC_CODING],
        recordType: 'administered',
        medicationStatus: 'active',
      });

      expect(doc.medicationRecordId).toMatch(/^[0-9a-f-]{36}$/);
      expect(doc.medicationCoding).toEqual([ATC_CODING]);
      expect(doc.dose).toBeNull();
      expect(doc.medicationPeriod).toBeNull();
      expect(doc.indication).toEqual([]);
    });

    it('carries dose/route/frequency/medicationPeriod/indication when given', () => {
      const doc = MedicationExposureModel.create({
        medicationCoding: [ATC_CODING],
        recordType: 'prescribed',
        medicationStatus: 'active',
        dose: { value: 5, unit: 'mg' },
        route: { code: 'oral' },
        frequency: { code: 'BID' },
        medicationPeriod: { start: '2026-01-01', end: '2026-02-01' },
        indication: ['cond-1', 'cond-2'],
      });

      expect(doc.dose).toEqual({ value: 5, unit: 'mg' });
      expect(doc.route).toEqual({ code: 'oral' });
      expect(doc.frequency).toEqual({ code: 'BID' });
      expect(doc.medicationPeriod.start).toBeInstanceOf(Date);
      expect(doc.medicationPeriod.end).toBeInstanceOf(Date);
      expect(doc.indication).toEqual(['cond-1', 'cond-2']);
    });
  });
});
