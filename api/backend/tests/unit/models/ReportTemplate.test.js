import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const ReportTemplateModel = require('../../../src/models/ReportTemplate');

describe('ReportTemplateModel', () => {
  describe('validate', () => {
    it('requires code', () => {
      const { isValid, errors } = ReportTemplateModel.validate({ name: 'Custom', handlerKey: 'sample' });
      expect(isValid).toBe(false);
      expect(errors).toContain('code é obrigatório');
    });

    it('rejects a code with uppercase/space/leading-digit characters', () => {
      expect(ReportTemplateModel.validate({ code: 'Custom Type', name: 'x', handlerKey: 'sample' }).isValid).toBe(false);
      expect(ReportTemplateModel.validate({ code: '1sample', name: 'x', handlerKey: 'sample' }).isValid).toBe(false);
      expect(ReportTemplateModel.validate({ code: 'custom_type', name: 'x', handlerKey: 'sample' }).isValid).toBe(true);
    });

    it('requires name', () => {
      const { isValid, errors } = ReportTemplateModel.validate({ code: 'custom', handlerKey: 'sample' });
      expect(isValid).toBe(false);
      expect(errors).toContain('name é obrigatório');
    });

    it('requires a known handlerKey', () => {
      const { isValid, errors } = ReportTemplateModel.validate({ code: 'custom', name: 'Custom', handlerKey: 'notARealHandler' });
      expect(isValid).toBe(false);
      expect(errors).toContain('handlerKey inválido: notARealHandler');
    });

    it('rejects an unknown templateStatus', () => {
      const { isValid, errors } = ReportTemplateModel.validate({ code: 'custom', name: 'Custom', handlerKey: 'sample', templateStatus: 'draft' });
      expect(isValid).toBe(false);
      expect(errors).toContain('templateStatus inválido: draft');
    });

    it('accepts a minimal valid payload', () => {
      const { isValid, errors } = ReportTemplateModel.validate({ code: 'custom_sample', name: 'Amostras customizadas', handlerKey: 'sample' });
      expect(isValid).toBe(true);
      expect(errors).toEqual([]);
    });
  });

  describe('create', () => {
    it('normalizes code to lowercase and trims name/description', () => {
      const doc = ReportTemplateModel.create({ code: 'Custom_Sample', name: '  Amostras  ', description: '  desc  ', handlerKey: 'sample' });
      expect(doc.code).toBe('custom_sample');
      expect(doc.name).toBe('Amostras');
      expect(doc.description).toBe('desc');
    });

    it('defaults isSystemDefined to false and templateStatus to active', () => {
      const doc = ReportTemplateModel.create({ code: 'custom', name: 'Custom', handlerKey: 'sample' });
      expect(doc.isSystemDefined).toBe(false);
      expect(doc.templateStatus).toBe('active');
      expect(doc.handlerOptions).toEqual({});
    });

    it('honors an explicit isSystemDefined/handlerOptions (seed migration round trip)', () => {
      const doc = ReportTemplateModel.create({
        code: 'temperature_control',
        name: 'Controle de Temperatura',
        handlerKey: 'temperature',
        handlerOptions: { mode: 'control' },
        isSystemDefined: true,
      });
      expect(doc.isSystemDefined).toBe(true);
      expect(doc.handlerOptions).toEqual({ mode: 'control' });
    });

    it('stamps createdAt/updatedAt as Dates', () => {
      const doc = ReportTemplateModel.create({ code: 'custom', name: 'Custom', handlerKey: 'sample' });
      expect(doc.createdAt).toBeInstanceOf(Date);
      expect(doc.updatedAt).toBeInstanceOf(Date);
    });
  });
});
