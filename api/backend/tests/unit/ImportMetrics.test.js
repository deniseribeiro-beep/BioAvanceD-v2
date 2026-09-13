import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const ImportMetrics = require('../../src/models/ImportMetrics');

describe('ImportMetrics', () => {
  describe('constructor - defaulting behavior', () => {
    it('applies defaults for all fields when data is empty', () => {
      const before = Date.now();
      const m = new ImportMetrics({});
      const after = Date.now();

      expect(m.metricsID).toBeNull();
      expect(m.jobID).toBeNull();
      expect(m.userID).toBeNull();
      expect(m.dataType).toBeNull();
      expect(m.date).toBeInstanceOf(Date);
      expect(m.date.getTime()).toBeGreaterThanOrEqual(before);
      expect(m.date.getTime()).toBeLessThanOrEqual(after);
      expect(m.totalJobs).toBe(0);
      expect(m.totalRecords).toBe(0);
      expect(m.successCount).toBe(0);
      expect(m.errorCount).toBe(0);
      expect(m.averageProcessingTime).toBe(0);
      expect(m.fhirResourcesCreated).toBe(0);
      expect(m.fhirResourcesUpdated).toBe(0);
      expect(m.breakdown).toEqual({ byStatus: {}, byDataType: {}, byHour: {} });
      expect(m.createdAt).toBeInstanceOf(Date);
      expect(m.updatedAt).toBeInstanceOf(Date);
      expect(m.createdAt.getTime()).toBeGreaterThanOrEqual(before);
      expect(m.updatedAt.getTime()).toBeGreaterThanOrEqual(before);
    });

    it('uses explicitly provided values for all fields', () => {
      const fixedDate = new Date('2025-01-01T00:00:00Z');
      const createdAt = new Date('2025-01-02T00:00:00Z');
      const updatedAt = new Date('2025-01-03T00:00:00Z');
      const breakdown = {
        byStatus: { success: 5 },
        byDataType: { patient: 3 },
        byHour: { 10: 2 },
      };

      const data = {
        metricsID: 'metrics-1',
        jobID: 'job-1',
        userID: 'user-1',
        dataType: 'patient',
        date: fixedDate,
        totalJobs: 7,
        totalRecords: 100,
        successCount: 90,
        errorCount: 10,
        averageProcessingTime: 12.5,
        fhirResourcesCreated: 20,
        fhirResourcesUpdated: 5,
        breakdown,
        createdAt,
        updatedAt,
      };

      const m = new ImportMetrics(data);

      expect(m.metricsID).toBe('metrics-1');
      expect(m.jobID).toBe('job-1');
      expect(m.userID).toBe('user-1');
      expect(m.dataType).toBe('patient');
      expect(m.date).toBe(fixedDate);
      expect(m.totalJobs).toBe(7);
      expect(m.totalRecords).toBe(100);
      expect(m.successCount).toBe(90);
      expect(m.errorCount).toBe(10);
      expect(m.averageProcessingTime).toBe(12.5);
      expect(m.fhirResourcesCreated).toBe(20);
      expect(m.fhirResourcesUpdated).toBe(5);
      expect(m.breakdown).toBe(breakdown);
      expect(m.createdAt).toBe(createdAt);
      expect(m.updatedAt).toBe(updatedAt);
    });

    it('documents that explicit falsy numeric values (0) are overwritten by defaults due to the || pattern', () => {
      // The constructor uses `data.totalJobs || 0` etc. This means an explicit 0
      // passed by a caller (e.g. to reset a counter) behaves identically to omitting
      // the field entirely, since 0 is falsy in JS. This is NOT a special case for 0
      // specifically -- 0 simply falls through to the same `|| 0` default that applies
      // when the field is missing. Documenting this as an intentional-or-not invariant:
      // callers cannot distinguish "explicitly reset to 0" from "not provided" via this API.
      const m = new ImportMetrics({
        dataType: 'patient',
        totalJobs: 0,
        totalRecords: 0,
        successCount: 0,
        errorCount: 0,
        averageProcessingTime: 0,
        fhirResourcesCreated: 0,
        fhirResourcesUpdated: 0,
      });

      expect(m.totalJobs).toBe(0);
      expect(m.totalRecords).toBe(0);
      expect(m.successCount).toBe(0);
      expect(m.errorCount).toBe(0);
      expect(m.averageProcessingTime).toBe(0);
      expect(m.fhirResourcesCreated).toBe(0);
      expect(m.fhirResourcesUpdated).toBe(0);
    });

    it('documents that explicit falsy string/id values are overwritten by defaults due to the || pattern', () => {
      // Same pattern applies to metricsID/jobID/userID/dataType: an explicit '' (empty
      // string) is falsy, so it falls through to the null default just like omission.
      const m = new ImportMetrics({
        metricsID: '',
        jobID: '',
        userID: '',
        dataType: '',
      });

      expect(m.metricsID).toBeNull();
      expect(m.jobID).toBeNull();
      expect(m.userID).toBeNull();
      expect(m.dataType).toBeNull();
    });

    it('uses provided breakdown object as-is without merging with default shape', () => {
      const partialBreakdown = { byStatus: { success: 1 } };
      const m = new ImportMetrics({ dataType: 'x', breakdown: partialBreakdown });

      // No default-merging occurs: byDataType/byHour are simply absent, not defaulted.
      expect(m.breakdown).toEqual({ byStatus: { success: 1 } });
      expect(m.breakdown.byDataType).toBeUndefined();
      expect(m.breakdown.byHour).toBeUndefined();
    });
  });

  describe('static create()', () => {
    it('delegates to the constructor and returns an ImportMetrics instance', () => {
      const data = { dataType: 'observation', totalJobs: 3 };
      const m = ImportMetrics.create(data);

      expect(m).toBeInstanceOf(ImportMetrics);
      expect(m.dataType).toBe('observation');
      expect(m.totalJobs).toBe(3);
    });

    it('applies the same defaulting behavior as calling new ImportMetrics()', () => {
      const m = ImportMetrics.create({});
      expect(m.dataType).toBeNull();
      expect(m.totalJobs).toBe(0);
      expect(m.breakdown).toEqual({ byStatus: {}, byDataType: {}, byHour: {} });
    });
  });

  describe('static validate()', () => {
    it('rejects data missing dataType', () => {
      const result = ImportMetrics.validate({});
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Tipo de dados (dataType) é obrigatório');
      expect(result.errors).toHaveLength(1);
    });

    it('rejects data with falsy dataType (empty string)', () => {
      const result = ImportMetrics.validate({ dataType: '' });
      expect(result.isValid).toBe(false);
      expect(result.errors).toHaveLength(1);
    });

    it('accepts data with a valid dataType', () => {
      const result = ImportMetrics.validate({ dataType: 'patient' });
      expect(result.isValid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('ignores other fields and only checks dataType', () => {
      const result = ImportMetrics.validate({
        dataType: 'observation',
        totalJobs: -1,
        breakdown: null,
      });
      expect(result.isValid).toBe(true);
      expect(result.errors).toEqual([]);
    });
  });

  describe('toJSON()', () => {
    it('returns a plain object with exactly the expected shape and values', () => {
      const fixedDate = new Date('2025-01-01T00:00:00Z');
      const breakdown = { byStatus: { success: 1 }, byDataType: {}, byHour: {} };

      const data = {
        metricsID: 'm1',
        jobID: 'j1',
        userID: 'u1',
        dataType: 'patient',
        date: fixedDate,
        totalJobs: 1,
        totalRecords: 2,
        successCount: 3,
        errorCount: 4,
        averageProcessingTime: 5.5,
        fhirResourcesCreated: 6,
        fhirResourcesUpdated: 7,
        breakdown,
        createdAt: fixedDate,
        updatedAt: fixedDate,
      };

      const m = new ImportMetrics(data);
      const json = m.toJSON();

      expect(json).toEqual({
        metricsID: 'm1',
        jobID: 'j1',
        userID: 'u1',
        dataType: 'patient',
        date: fixedDate,
        totalJobs: 1,
        totalRecords: 2,
        successCount: 3,
        errorCount: 4,
        averageProcessingTime: 5.5,
        fhirResourcesCreated: 6,
        fhirResourcesUpdated: 7,
        breakdown,
        createdAt: fixedDate,
        updatedAt: fixedDate,
      });
      expect(Object.keys(json).sort()).toEqual(
        [
          'metricsID',
          'jobID',
          'userID',
          'dataType',
          'date',
          'totalJobs',
          'totalRecords',
          'successCount',
          'errorCount',
          'averageProcessingTime',
          'fhirResourcesCreated',
          'fhirResourcesUpdated',
          'breakdown',
          'createdAt',
          'updatedAt',
        ].sort()
      );
    });

    it('passes through the default breakdown object when not provided', () => {
      const m = new ImportMetrics({ dataType: 'patient' });
      const json = m.toJSON();

      expect(json.breakdown).toEqual({ byStatus: {}, byDataType: {}, byHour: {} });
      // Same reference as the instance field, not a copy.
      expect(json.breakdown).toBe(m.breakdown);
    });
  });
});
