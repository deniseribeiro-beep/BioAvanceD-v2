import { describe, it, expect } from 'vitest';
const PatientConsentModel = require('../../../src/models/PatientConsent');

describe('PatientConsentModel', () => {
  describe('validate', () => {
    const validData = {
      participantId: 'p-1',
      consentTemplateId: 'ct-1',
      responses: { q1: 'yes' },
    };

    it('deve validar dados completos e válidos', () => {
      const result = PatientConsentModel.validate({
        ...validData,
        status: 'ACTIVE',
        ipAddress: '127.0.0.1',
        userAgent: 'vitest',
        signatureName: 'Jane Doe',
        signatureImageBase64: 'base64==',
        signatureMimeType: 'image/png',
        signatureHash: 'hash123',
      });

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('deve validar dados mínimos válidos', () => {
      const result = PatientConsentModel.validate(validData);

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('deve rejeitar quando participantId está ausente', () => {
      const { participantId, ...rest } = validData;
      const result = PatientConsentModel.validate(rest);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('participantId é obrigatório e deve ser string');
    });

    it('deve rejeitar quando participantId não é string', () => {
      const result = PatientConsentModel.validate({ ...validData, participantId: 123 });

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('participantId é obrigatório e deve ser string');
    });

    it('deve rejeitar quando consentTemplateId está ausente', () => {
      const { consentTemplateId, ...rest } = validData;
      const result = PatientConsentModel.validate(rest);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('consentTemplateId é obrigatório e deve ser string');
    });

    it('deve rejeitar quando consentTemplateId não é string', () => {
      const result = PatientConsentModel.validate({ ...validData, consentTemplateId: 123 });

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('consentTemplateId é obrigatório e deve ser string');
    });

    it('deve rejeitar status inválido', () => {
      const result = PatientConsentModel.validate({ ...validData, status: 'PENDING' });

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('status deve ser ACTIVE ou REVOKED');
    });

    it('deve aceitar status REVOKED', () => {
      const result = PatientConsentModel.validate({ ...validData, status: 'REVOKED' });

      expect(result.isValid).toBe(true);
    });

    it('deve rejeitar quando responses está ausente', () => {
      const { responses, ...rest } = validData;
      const result = PatientConsentModel.validate(rest);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('responses é obrigatório e deve ser um objeto');
    });

    it('deve rejeitar quando responses é um array', () => {
      const result = PatientConsentModel.validate({ ...validData, responses: ['a'] });

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('responses é obrigatório e deve ser um objeto');
    });

    it('deve rejeitar quando responses não é objeto', () => {
      const result = PatientConsentModel.validate({ ...validData, responses: 'not-an-object' });

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('responses é obrigatório e deve ser um objeto');
    });

    it('deve rejeitar ipAddress não string', () => {
      const result = PatientConsentModel.validate({ ...validData, ipAddress: 123 });

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('ipAddress deve ser string');
    });

    it('deve rejeitar userAgent não string', () => {
      const result = PatientConsentModel.validate({ ...validData, userAgent: 123 });

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('userAgent deve ser string');
    });

    it('deve rejeitar signatureName não string', () => {
      const result = PatientConsentModel.validate({ ...validData, signatureName: 123 });

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('signatureName deve ser string');
    });

    it('deve rejeitar signatureImageBase64 não string', () => {
      const result = PatientConsentModel.validate({ ...validData, signatureImageBase64: 123 });

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('signatureImageBase64 deve ser string');
    });

    it('deve rejeitar signatureMimeType não string', () => {
      const result = PatientConsentModel.validate({ ...validData, signatureMimeType: 123 });

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('signatureMimeType deve ser string');
    });

    it('deve rejeitar signatureHash não string', () => {
      const result = PatientConsentModel.validate({ ...validData, signatureHash: 123 });

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('signatureHash deve ser string');
    });

    it('deve acumular múltiplos erros', () => {
      const result = PatientConsentModel.validate({});

      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThanOrEqual(3);
    });

    it('deve aceitar quando studyId está ausente (RF021 AC#4, #593 — opcional)', () => {
      const result = PatientConsentModel.validate(validData);

      expect(result.isValid).toBe(true);
    });

    it('deve rejeitar studyId não string', () => {
      const result = PatientConsentModel.validate({ ...validData, studyId: 123 });

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('studyId deve ser string');
    });
  });

  describe('create', () => {
    it('deve criar registro com defaults quando campos opcionais ausentes', () => {
      const record = PatientConsentModel.create({
        participantId: 'p-1',
        consentTemplateId: 'ct-1',
      });

      expect(record.participantId).toBe('p-1');
      expect(record.consentTemplateId).toBe('ct-1');
      expect(record.status).toBe('ACTIVE');
      expect(record.revokedAt).toBeNull();
      expect(record.ipAddress).toBeNull();
      expect(record.userAgent).toBeNull();
      expect(record.signatureName).toBeNull();
      expect(record.signatureImageBase64).toBeNull();
      expect(record.signatureMimeType).toBeNull();
      expect(record.signatureHash).toBeNull();
      expect(record.responses).toEqual({});
      expect(record.signedAt).toBeInstanceOf(Date);
      expect(record.createdAt).toBeInstanceOf(Date);
      expect(record.updatedAt).toBeInstanceOf(Date);
      expect(record.studyId).toBeNull();
    });

    it('deve armazenar studyId quando fornecido (RF021 AC#4, #593)', () => {
      const record = PatientConsentModel.create({
        participantId: 'p-1',
        consentTemplateId: 'ct-1',
        studyId: 'study-1',
      });

      expect(record.studyId).toBe('study-1');
    });

    it('deve usar valores fornecidos quando presentes', () => {
      const signedAt = '2026-01-01T00:00:00.000Z';
      const revokedAt = '2026-02-01T00:00:00.000Z';

      const record = PatientConsentModel.create({
        participantId: 'p-2',
        consentTemplateId: 'ct-2',
        signedAt,
        status: 'REVOKED',
        revokedAt,
        ipAddress: '10.0.0.1',
        userAgent: 'agent',
        signatureName: 'John',
        signatureImageBase64: 'img',
        signatureMimeType: 'image/jpeg',
        signatureHash: 'hash',
        responses: { q1: 'no' },
      });

      expect(record.status).toBe('REVOKED');
      expect(record.signedAt).toEqual(new Date(signedAt));
      expect(record.revokedAt).toEqual(new Date(revokedAt));
      expect(record.ipAddress).toBe('10.0.0.1');
      expect(record.userAgent).toBe('agent');
      expect(record.signatureName).toBe('John');
      expect(record.signatureImageBase64).toBe('img');
      expect(record.signatureMimeType).toBe('image/jpeg');
      expect(record.signatureHash).toBe('hash');
      expect(record.responses).toEqual({ q1: 'no' });
    });
  });
});
