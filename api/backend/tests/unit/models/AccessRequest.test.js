import { describe, it, expect } from 'vitest';
const AccessRequestModel = require('../../../src/models/AccessRequest');

describe('AccessRequestModel', () => {
  const validData = {
    requesterId: 'researcher-1',
    organizationId: 'org-1',
    studyId: 'study-1',
    protocolId: 'protocol-1',
    requestedPurpose: 'Estudo de biomarcadores oncológicos',
    requestedItems: [{ itemType: 'specimen', itemId: 'SPEC-1' }],
  };

  describe('validate', () => {
    it('deve validar dados mínimos válidos', () => {
      const result = AccessRequestModel.validate(validData);

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('deve rejeitar quando requesterId está ausente', () => {
      const { requesterId, ...rest } = validData;
      const result = AccessRequestModel.validate(rest);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('requesterId é obrigatório e deve ser string');
    });

    it('deve rejeitar quando studyId está ausente', () => {
      const { studyId, ...rest } = validData;
      const result = AccessRequestModel.validate(rest);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('studyId é obrigatório e deve ser string');
    });

    // RF024 AC1.
    it.each([
      ['organizationId', 'organizationId é obrigatório e deve ser string'],
      ['protocolId', 'protocolId é obrigatório e deve ser string'],
    ])('deve rejeitar quando %s está ausente', (field, message) => {
      const { [field]: _omitted, ...rest } = validData;
      const result = AccessRequestModel.validate(rest);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain(message);
    });

    it('deve rejeitar quando requestedPurpose está ausente', () => {
      const { requestedPurpose, ...rest } = validData;
      const result = AccessRequestModel.validate(rest);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('requestedPurpose é obrigatório e deve ser string');
    });

    it('deve rejeitar requestedItems vazio', () => {
      const result = AccessRequestModel.validate({ ...validData, requestedItems: [] });

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('requestedItems é obrigatório e deve ser um array não vazio');
    });

    it('deve rejeitar um itemType desconhecido', () => {
      const result = AccessRequestModel.validate({
        ...validData,
        requestedItems: [{ itemType: 'unknown', itemId: 'X-1' }],
      });

      expect(result.isValid).toBe(false);
      expect(result.errors[0]).toMatch(/itemType/);
    });

    it('deve rejeitar um item sem itemId', () => {
      const result = AccessRequestModel.validate({
        ...validData,
        requestedItems: [{ itemType: 'specimen' }],
      });

      expect(result.isValid).toBe(false);
      expect(result.errors[0]).toMatch(/itemId/);
    });

    it('deve rejeitar duoCode não-string quando informado', () => {
      const result = AccessRequestModel.validate({ ...validData, duoCode: 12345 });

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('duoCode deve ser string quando informado');
    });
  });

  describe('create', () => {
    it('gera accessRequestId e inicializa o ciclo de decisão/distribuição como pendente', () => {
      const created = AccessRequestModel.create(validData);

      expect(created.accessRequestId).toBeTruthy();
      expect(created.requestedItems).toEqual([{ itemType: 'specimen', itemId: 'SPEC-1', quantity: null }]);
      expect(created.consentCompatibility).toEqual([]);
      expect(created.committeeDecision).toEqual({
        decisionId: null,
        status: 'pending',
        justification: null,
        decidedBy: null,
        decidedAt: null,
        policyVersion: null,
        configurationReleaseId: null,
      });
      expect(created.approvalPeriod).toBeNull();
      expect(created.distributionStatus).toBe('pending');
      expect(created.distributionDecisionId).toBeNull();
      expect(created.duoCode).toBeNull();
      expect(created).toMatchObject({ organizationId: 'org-1', protocolId: 'protocol-1', protocolVersion: null });
    });

    it('preserva um duoCode informado, aparado de espaços', () => {
      const created = AccessRequestModel.create({ ...validData, duoCode: '  DUO:0000004  ' });

      expect(created.duoCode).toBe('DUO:0000004');
    });
  });

  describe('validateDecision', () => {
    it('aceita approved/rejected/conditioned com justificativa', () => {
      for (const status of ['approved', 'rejected', 'conditioned']) {
        const result = AccessRequestModel.validateDecision({ status, justification: 'motivo' });
        expect(result.isValid).toBe(true);
      }
    });

    it('rejeita status pending ou revoked pelo endpoint genérico de decisão', () => {
      for (const status of ['pending', 'revoked', 'bogus']) {
        const result = AccessRequestModel.validateDecision({ status, justification: 'motivo' });
        expect(result.isValid).toBe(false);
      }
    });

    it('exige justification não vazia', () => {
      const result = AccessRequestModel.validateDecision({ status: 'approved', justification: '   ' });

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('justification é obrigatório e deve ser string não vazia');
    });

    it('rejeita approvalPeriod.start inválido quando informado', () => {
      const result = AccessRequestModel.validateDecision({
        status: 'approved',
        justification: 'motivo',
        approvalPeriod: { start: 'not-a-date' },
      });

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('approvalPeriod.start deve ser uma data válida quando informado');
    });
  });
});
