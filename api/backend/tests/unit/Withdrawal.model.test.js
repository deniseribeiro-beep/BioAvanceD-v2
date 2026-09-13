import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const WithdrawalModel = require('../../src/models/Withdrawal');

describe('WithdrawalModel', () => {
  describe('static constants', () => {
    it('WITHDRAWAL_TYPES contains expected literal values', () => {
      expect(WithdrawalModel.WITHDRAWAL_TYPES).toEqual({
        PARTIAL: 'partial',
        TOTAL: 'total'
      });
    });

    it('WITHDRAWAL_TYPE_ALIASES contains expected literal values', () => {
      expect(WithdrawalModel.WITHDRAWAL_TYPE_ALIASES).toEqual({
        parcial: 'partial',
        partial: 'partial',
        total: 'total'
      });
    });
  });

  describe('normalizeWithdrawalType()', () => {
    it('normalizes the "parcial" alias to "partial"', () => {
      expect(WithdrawalModel.normalizeWithdrawalType('parcial')).toBe('partial');
    });

    it('passes through "partial" unchanged', () => {
      expect(WithdrawalModel.normalizeWithdrawalType('partial')).toBe('partial');
    });

    it('passes through "total" unchanged', () => {
      expect(WithdrawalModel.normalizeWithdrawalType('total')).toBe('total');
    });

    it('trims whitespace and lowercases mixed-case input', () => {
      expect(WithdrawalModel.normalizeWithdrawalType('  PARCIAL  ')).toBe('partial');
    });

    it('returns the normalized-but-unrecognized value when no alias matches', () => {
      expect(WithdrawalModel.normalizeWithdrawalType('bogus')).toBe('bogus');
    });

    it('returns an empty string for null/undefined/empty input', () => {
      expect(WithdrawalModel.normalizeWithdrawalType(null)).toBe('');
      expect(WithdrawalModel.normalizeWithdrawalType(undefined)).toBe('');
      expect(WithdrawalModel.normalizeWithdrawalType('')).toBe('');
    });
  });

  describe('validate()', () => {
    it('returns isValid true and no errors for a fully valid payload', () => {
      const result = WithdrawalModel.validate({
        sampleID: 'S1',
        withdrawalType: 'partial',
        withdrawalResponsible: 'Dr. Smith'
      });

      expect(result).toEqual({ isValid: true, errors: [] });
    });

    it('accepts a withdrawalType alias ("parcial") as valid', () => {
      const result = WithdrawalModel.validate({
        sampleID: 'S1',
        withdrawalType: 'parcial',
        withdrawalResponsible: 'Dr. Smith'
      });

      expect(result.isValid).toBe(true);
    });

    it('accepts sampleID of 0 (falsy but explicitly provided)', () => {
      const result = WithdrawalModel.validate({
        sampleID: 0,
        withdrawalType: 'total',
        withdrawalResponsible: 'Dr. Smith'
      });

      expect(result.isValid).toBe(true);
    });

    it('flags a missing sampleID', () => {
      const result = WithdrawalModel.validate({
        withdrawalType: 'partial',
        withdrawalResponsible: 'Dr. Smith'
      });

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('sampleID é obrigatório');
    });

    it('flags a missing withdrawalType', () => {
      const result = WithdrawalModel.validate({
        sampleID: 'S1',
        withdrawalResponsible: 'Dr. Smith'
      });

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('withdrawalType é obrigatório e deve ser partial ou total');
    });

    it('flags a withdrawalType that does not resolve to partial/total', () => {
      const result = WithdrawalModel.validate({
        sampleID: 'S1',
        withdrawalType: 'bogus',
        withdrawalResponsible: 'Dr. Smith'
      });

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('withdrawalType é obrigatório e deve ser partial ou total');
    });

    it('flags a missing withdrawalResponsible', () => {
      const result = WithdrawalModel.validate({
        sampleID: 'S1',
        withdrawalType: 'partial'
      });

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('withdrawalResponsible é obrigatório e deve ser string');
    });

    it('flags a non-string withdrawalResponsible', () => {
      const result = WithdrawalModel.validate({
        sampleID: 'S1',
        withdrawalType: 'partial',
        withdrawalResponsible: 123
      });

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('withdrawalResponsible é obrigatório e deve ser string');
    });

    it('accumulates all applicable errors at once', () => {
      const result = WithdrawalModel.validate({});

      expect(result.isValid).toBe(false);
      expect(result.errors).toEqual([
        'sampleID é obrigatório',
        'withdrawalType é obrigatório e deve ser partial ou total',
        'withdrawalResponsible é obrigatório e deve ser string'
      ]);
    });
  });

  describe('create()', () => {
    it('builds a normalized withdrawal record from full input', () => {
      const record = WithdrawalModel.create({
        withdrawalID: 'W1',
        sampleID: 'S1',
        withdrawalType: 'parcial',
        withdrawalResponsible: 'Dr. Smith',
        withdrawalDate: '2026-01-01T00:00:00.000Z',
        sampleDestination: 'Lab A',
        linkedProject: 'Project X',
        quantity: 5,
        notes: 'some notes'
      });

      expect(record).toMatchObject({
        withdrawalID: 'W1',
        sampleID: 'S1',
        withdrawalType: 'partial',
        withdrawalResponsible: 'Dr. Smith',
        withdrawalDate: '2026-01-01T00:00:00.000Z',
        sampleDestination: 'Lab A',
        linkedProject: 'Project X',
        quantity: 5,
        notes: 'some notes'
      });
      expect(record.createdAt).toBeInstanceOf(Date);
      expect(record.updatedAt).toBeInstanceOf(Date);
    });

    it('defaults optional fields to null and withdrawalDate to now when omitted', () => {
      const before = Date.now();
      const record = WithdrawalModel.create({
        sampleID: 'S1',
        withdrawalType: 'total',
        withdrawalResponsible: 'Dr. Smith'
      });
      const after = Date.now();

      expect(record.withdrawalID).toBeNull();
      expect(record.sampleDestination).toBeNull();
      expect(record.linkedProject).toBeNull();
      expect(record.quantity).toBeNull();
      expect(record.notes).toBeNull();
      expect(record.withdrawalDate).toBeInstanceOf(Date);
      expect(record.withdrawalDate.getTime()).toBeGreaterThanOrEqual(before);
      expect(record.withdrawalDate.getTime()).toBeLessThanOrEqual(after);
    });
  });
});
