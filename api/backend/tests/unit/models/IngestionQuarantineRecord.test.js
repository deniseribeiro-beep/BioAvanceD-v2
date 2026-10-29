import { describe, it, expect } from 'vitest';
const IngestionQuarantineRecordModel = require('../../../src/models/IngestionQuarantineRecord');

describe('IngestionQuarantineRecordModel', () => {
  const validData = {
    entityType: 'Specimen',
    violations: [{ code: 'NON_CANONICAL_FIELD', field: 'patientID', message: 'Campo não canônico: patientID' }],
  };

  describe('validate', () => {
    it('validates minimal required fields', () => {
      const result = IngestionQuarantineRecordModel.validate(validData);
      expect(result.isValid).toBe(true);
    });

    it('rejects a missing entityType', () => {
      const { entityType, ...rest } = validData;
      const result = IngestionQuarantineRecordModel.validate(rest);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('entityType é obrigatório e deve ser string');
    });

    it('rejects an empty violations array', () => {
      const result = IngestionQuarantineRecordModel.validate({ ...validData, violations: [] });
      expect(result.isValid).toBe(false);
    });

    it('rejects a non-array violations value', () => {
      const result = IngestionQuarantineRecordModel.validate({ ...validData, violations: 'not-an-array' });
      expect(result.isValid).toBe(false);
    });

    it('rejects an unknown severity', () => {
      const result = IngestionQuarantineRecordModel.validate({ ...validData, severity: 'catastrophic' });
      expect(result.isValid).toBe(false);
    });

    it('rejects an unknown resolutionStatus', () => {
      const result = IngestionQuarantineRecordModel.validate({ ...validData, resolutionStatus: 'shrugged_off' });
      expect(result.isValid).toBe(false);
    });
  });

  describe('create', () => {
    it('defaults severity to error and resolutionStatus to open', () => {
      const doc = IngestionQuarantineRecordModel.create(validData);
      expect(doc.ingestionQuarantineRecordId).toMatch(/^[0-9a-f-]{36}$/);
      expect(doc.severity).toBe('error');
      expect(doc.resolutionStatus).toBe('open');
      expect(doc.detectedAt).toBeInstanceOf(Date);
      expect(doc.resolvedAt).toBeNull();
      expect(doc.payload).toBeNull();
    });

    it('preserves an explicit payload, provenance, and idempotencyKey', () => {
      const provenance = { sourceSystem: 'urn:system:x', createdBy: 'Actor/1', retrievedAt: new Date(), purpose: 'p' };
      const doc = IngestionQuarantineRecordModel.create({
        ...validData,
        payload: { patientID: '1' },
        provenance,
        idempotencyKey: 'key-1',
      });
      expect(doc.payload).toEqual({ patientID: '1' });
      expect(doc.provenance).toEqual(provenance);
      expect(doc.idempotencyKey).toBe('key-1');
    });

    // RF029 AC7 (#1318): the client's missingness declaration is kept as received.
    it('keeps a missingDataReasons declaration as received', () => {
      const missingDataReasons = [{ fieldPath: 'doi', reasonCode: 'withheld' }];
      const doc = IngestionQuarantineRecordModel.create({ ...validData, missingDataReasons });
      expect(doc.missingDataReasons).toEqual([{ fieldPath: 'doi', reasonCode: 'withheld' }]);
    });

    it('stores null when no missingDataReasons was declared', () => {
      const doc = IngestionQuarantineRecordModel.create(validData);
      expect(doc.missingDataReasons).toBeNull();
    });

    it('keeps a malformed missingDataReasons unchanged, and validate still passes', () => {
      const doc = IngestionQuarantineRecordModel.create({ ...validData, missingDataReasons: 'x' });
      expect(doc.missingDataReasons).toBe('x');
      expect(IngestionQuarantineRecordModel.validate(doc).isValid).toBe(true);
    });
  });
});
