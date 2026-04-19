import { describe, it, expect } from 'vitest';

const PatientConsentModel = require('../../src/models/PatientConsent');
const ConsentTemplateModel = require('../../src/models/ConsentTemplate');
const ConsentPolicyModel = require('../../src/models/ConsentPolicy');

describe('Consent models', () => {
  describe('PatientConsentModel', () => {
    it('valida um consentimento ativo com respostas válidas', () => {
      const result = PatientConsentModel.validate({
        patientId: 'patient-001',
        templateId: 'template-001',
        status: 'ACTIVE',
        responses: { research: true },
        ipAddress: '127.0.0.1',
        userAgent: 'QA-Agent/1.0',
        signatureName: 'Paciente Teste',
        signatureHash: 'hash-123',
      });

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('rejeita payload sem patientId/templateId/responses', () => {
      const result = PatientConsentModel.validate({});

      expect(result.isValid).toBe(false);
      expect(result.errors).toEqual(expect.arrayContaining([
        'patientId é obrigatório e deve ser string',
        'templateId é obrigatório e deve ser string',
        'responses é obrigatório e deve ser um objeto'
      ]));
    });

    it('normaliza status default para ACTIVE ao criar', () => {
      const consent = PatientConsentModel.create({
        patientId: 'patient-001',
        templateId: 'template-001',
        responses: { research: true },
      });

      expect(consent.status).toBe('ACTIVE');
      expect(consent.signedAt).toBeInstanceOf(Date);
      expect(consent.createdAt).toBeInstanceOf(Date);
      expect(consent.updatedAt).toBeInstanceOf(Date);
    });
  });

  describe('ConsentTemplateModel', () => {
    it('valida template com content e permissions válidos', () => {
      const result = ConsentTemplateModel.validate({
        title: 'TCLE Pesquisa',
        content: '<p>Texto do consentimento</p>',
        version: 'v2',
        caae: '12345678.9.0000.0000',
        active: true,
        permissions: [
          { key: 'research', label: 'Uso em pesquisa', required: true },
        ],
      });

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('aceita htmlContent como fallback de content', () => {
      const result = ConsentTemplateModel.validate({
        title: 'TCLE Alternativo',
        htmlContent: '<p>Conteúdo HTML</p>',
      });

      expect(result.isValid).toBe(true);
    });

    it('rejeita permissions malformadas', () => {
      const result = ConsentTemplateModel.validate({
        title: 'TCLE Ruim',
        content: '<p>Conteúdo</p>',
        permissions: [{ key: '', label: 123 }],
      });

      expect(result.isValid).toBe(false);
      expect(result.errors.some((error) => error.includes('permissions[0].key'))).toBe(true);
      expect(result.errors.some((error) => error.includes('permissions[0].label'))).toBe(true);
    });

    it('cria template com defaults esperados', () => {
      const template = ConsentTemplateModel.create({
        title: 'TCLE Pesquisa',
        content: '  <p>Texto</p>  ',
      });

      expect(template.title).toBe('TCLE Pesquisa');
      expect(template.content).toBe('<p>Texto</p>');
      expect(template.htmlContent).toBe('<p>Texto</p>');
      expect(template.version).toBe('v1');
      expect(template.active).toBe(true);
    });
  });

  describe('ConsentPolicyModel', () => {
    it('valida política com intervalo de vigência e permissões granulares', () => {
      const result = ConsentPolicyModel.validate({
        title: 'Política TCLE',
        htmlContent: '<p>Política</p>',
        version: 'v1',
        caae: '123.456',
        validFrom: '2026-04-01T00:00:00.000Z',
        validTo: '2026-04-30T23:59:59.000Z',
        active: true,
        granularPermissions: [
          { key: 'research', label: 'Uso em pesquisa', required: true },
          { key: 'commercial', label: 'Uso comercial', required: false },
        ],
      });

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('rejeita datas invertidas', () => {
      const result = ConsentPolicyModel.validate({
        title: 'Política TCLE',
        htmlContent: '<p>Política</p>',
        version: 'v1',
        validFrom: '2026-05-01T00:00:00.000Z',
        validTo: '2026-04-01T00:00:00.000Z',
        granularPermissions: [],
      });

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('validTo deve ser maior ou igual a validFrom');
    });

    it('cria política com defaults esperados', () => {
      const policy = ConsentPolicyModel.create({
        title: 'Política TCLE',
        htmlContent: '<p>Política</p>',
        version: 'v1',
        validFrom: '2026-04-01T00:00:00.000Z',
        validTo: '2026-04-30T23:59:59.000Z',
        granularPermissions: [],
      });

      expect(policy.active).toBe(true);
      expect(policy.validFrom).toBeInstanceOf(Date);
      expect(policy.validTo).toBeInstanceOf(Date);
      expect(policy.createdAt).toBeInstanceOf(Date);
      expect(policy.updatedAt).toBeInstanceOf(Date);
    });
  });
});
