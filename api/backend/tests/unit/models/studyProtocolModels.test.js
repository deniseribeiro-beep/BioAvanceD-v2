import { describe, it, expect } from 'vitest';

const StudyModel = require('../../../src/models/Study');
const ProtocolModel = require('../../../src/models/Protocol');

describe('StudyModel', () => {
  const baseStudy = { studyId: 'study-1', studyTitle: 'Estudo teste' };

  describe('validate — ethicsApprovalId (RF021 AC#3, ELM-0060)', () => {
    it('missing ethicsApprovalId -> isValid false', () => {
      const result = StudyModel.validate({ ...baseStudy });

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('ethicsApprovalId é obrigatório e deve ser um array não vazio de strings');
    });

    it('ethicsApprovalId not an array (string) -> isValid false', () => {
      const result = StudyModel.validate({ ...baseStudy, ethicsApprovalId: 'CAAE-123' });

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('ethicsApprovalId é obrigatório e deve ser um array não vazio de strings');
    });

    it('ethicsApprovalId empty array -> isValid false', () => {
      const result = StudyModel.validate({ ...baseStudy, ethicsApprovalId: [] });

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('ethicsApprovalId é obrigatório e deve ser um array não vazio de strings');
    });

    it('ethicsApprovalId array with a non-string entry -> isValid false', () => {
      const result = StudyModel.validate({ ...baseStudy, ethicsApprovalId: ['CAAE-123', 42] });

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('ethicsApprovalId[1] deve ser uma string não vazia');
    });

    it('ethicsApprovalId array with an empty-string entry -> isValid false', () => {
      const result = StudyModel.validate({ ...baseStudy, ethicsApprovalId: ['   '] });

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('ethicsApprovalId[0] deve ser uma string não vazia');
    });

    it('valid ethicsApprovalId array -> isValid true, no ethicsApprovalId errors', () => {
      const result = StudyModel.validate({ ...baseStudy, ethicsApprovalId: ['CAAE-123', 'Parecer-456'] });

      expect(result.isValid).toBe(true);
      expect(result.errors).toEqual([]);
    });
  });

  describe('create — ethicsApprovalId', () => {
    it('trims each entry and stores as an array', () => {
      const result = StudyModel.create({ ...baseStudy, ethicsApprovalId: ['  CAAE-123  ', 'Parecer-456'] });

      expect(result.ethicsApprovalId).toEqual(['CAAE-123', 'Parecer-456']);
    });
  });
});

describe('ProtocolModel', () => {
  const baseProtocol = { protocolId: 'protocol-1', protocolName: 'Protocolo teste' };

  describe('validate — effectivePeriod (RF021 AC#3, ELM-0072)', () => {
    it('missing effectivePeriod -> isValid false', () => {
      const result = ProtocolModel.validate({ ...baseProtocol });

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('effectivePeriod.start é obrigatório e deve ser uma data válida');
    });

    it('effectivePeriod not an object (string) -> isValid false', () => {
      const result = ProtocolModel.validate({ ...baseProtocol, effectivePeriod: '2026-01-01' });

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('effectivePeriod.start é obrigatório e deve ser uma data válida');
    });

    it('effectivePeriod.start missing -> isValid false', () => {
      const result = ProtocolModel.validate({ ...baseProtocol, effectivePeriod: { end: '2027-01-01' } });

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('effectivePeriod.start é obrigatório e deve ser uma data válida');
    });

    it('effectivePeriod.start not a valid date -> isValid false', () => {
      const result = ProtocolModel.validate({ ...baseProtocol, effectivePeriod: { start: 'not-a-date' } });

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('effectivePeriod.start é obrigatório e deve ser uma data válida');
    });

    it('effectivePeriod.end present but not a valid date -> isValid false', () => {
      const result = ProtocolModel.validate({
        ...baseProtocol,
        effectivePeriod: { start: '2026-01-01', end: 'not-a-date' },
      });

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('effectivePeriod.end deve ser uma data válida');
    });

    it('effectivePeriod.end before start -> isValid false', () => {
      const result = ProtocolModel.validate({
        ...baseProtocol,
        effectivePeriod: { start: '2026-06-01', end: '2026-01-01' },
      });

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('effectivePeriod.end não pode ser anterior a effectivePeriod.start');
    });

    it('effectivePeriod with only start (still valid / ongoing) -> isValid true', () => {
      const result = ProtocolModel.validate({ ...baseProtocol, effectivePeriod: { start: '2026-01-01' } });

      expect(result.isValid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('effectivePeriod with start and end >= start -> isValid true', () => {
      const result = ProtocolModel.validate({
        ...baseProtocol,
        effectivePeriod: { start: '2026-01-01', end: '2026-12-31' },
      });

      expect(result.isValid).toBe(true);
      expect(result.errors).toEqual([]);
    });
  });

  describe('create — effectivePeriod', () => {
    it('stores start/end as Date instances', () => {
      const result = ProtocolModel.create({
        ...baseProtocol,
        effectivePeriod: { start: '2026-01-01', end: '2026-12-31' },
      });

      expect(result.effectivePeriod.start).toBeInstanceOf(Date);
      expect(result.effectivePeriod.end).toBeInstanceOf(Date);
      expect(result.effectivePeriod.start.toISOString()).toBe(new Date('2026-01-01').toISOString());
    });

    it('open-ended (no end) -> end stored as null, not undefined', () => {
      const result = ProtocolModel.create({ ...baseProtocol, effectivePeriod: { start: '2026-01-01' } });

      expect(result.effectivePeriod.end).toBeNull();
      expect(result.effectivePeriod.end).not.toBeUndefined();
    });
  });
});
