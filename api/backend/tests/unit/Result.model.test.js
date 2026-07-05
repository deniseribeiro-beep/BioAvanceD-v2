import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const ResultModel = require('../../src/models/Result');

describe('ResultModel', () => {
  describe('static constants', () => {
    it('ANALYSIS_METHODS contains expected literal values', () => {
      expect(ResultModel.ANALYSIS_METHODS).toEqual([
        'PCR em Tempo Real',
        'Sequenciamento NGS',
        'ELISA',
        'Espectrometria de Massa',
        'Microscopia'
      ]);
    });

    it('EQUIPMENT_STATUS contains expected literal values', () => {
      expect(ResultModel.EQUIPMENT_STATUS).toEqual([
        'Calibrado',
        'Manutenção',
        'Não Verificado'
      ]);
    });

    it('REAGENT_TYPES contains expected literal values', () => {
      expect(ResultModel.REAGENT_TYPES).toEqual([
        'Primer A',
        'Reagente B',
        'Kit Comercial'
      ]);
    });
  });

  describe('validate()', () => {
    it('returns isValid true and no errors for a fully valid payload', () => {
      const result = ResultModel.validate({
        sampleID: 'S1',
        fileType: 'PDF',
        resultFilePath: '/files/result.pdf'
      });

      expect(result).toEqual({ isValid: true, errors: [] });
    });

    it('accepts every valid fileType enum value', () => {
      for (const fileType of ['PDF', 'ZIP', 'CSV', 'RAW']) {
        const result = ResultModel.validate({
          sampleID: 'S1',
          fileType,
          resultFilePath: '/files/result'
        });
        expect(result.isValid).toBe(true);
      }
    });

    it('flags missing sampleID', () => {
      const result = ResultModel.validate({
        fileType: 'PDF',
        resultFilePath: '/files/result.pdf'
      });

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('sampleID é obrigatório');
    });

    it('flags missing fileType', () => {
      const result = ResultModel.validate({
        sampleID: 'S1',
        resultFilePath: '/files/result.pdf'
      });

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain(
        'fileType é obrigatório e deve ser: PDF, ZIP, CSV ou RAW (Enum conforme dicionário)'
      );
    });

    it('flags invalid (non-enum) fileType', () => {
      const result = ResultModel.validate({
        sampleID: 'S1',
        fileType: 'DOCX',
        resultFilePath: '/files/result.pdf'
      });

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain(
        'fileType é obrigatório e deve ser: PDF, ZIP, CSV ou RAW (Enum conforme dicionário)'
      );
    });

    it('flags missing resultFilePath', () => {
      const result = ResultModel.validate({
        sampleID: 'S1',
        fileType: 'PDF'
      });

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('resultFilePath é obrigatório e deve ser string');
    });

    it('flags non-string resultFilePath', () => {
      const result = ResultModel.validate({
        sampleID: 'S1',
        fileType: 'PDF',
        resultFilePath: 12345
      });

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('resultFilePath é obrigatório e deve ser string');
    });

    it('accumulates multiple error messages when several fields fail', () => {
      const result = ResultModel.validate({});

      expect(result.isValid).toBe(false);
      expect(result.errors).toHaveLength(3);
      expect(result.errors).toContain('sampleID é obrigatório');
      expect(result.errors).toContain(
        'fileType é obrigatório e deve ser: PDF, ZIP, CSV ou RAW (Enum conforme dicionário)'
      );
      expect(result.errors).toContain('resultFilePath é obrigatório e deve ser string');
    });
  });

  describe('create()', () => {
    it('maps all fields from a full data object', () => {
      const uploadedAt = new Date('2020-01-01T00:00:00.000Z');
      const input = {
        resultID: 42,
        sampleID: 'S1',
        fileType: 'PDF',
        resultFilePath: '/files/result.pdf',
        filePath: '/other/path.pdf',
        description: 'desc',
        analysisType: 'type A',
        method: 'PCR em Tempo Real',
        responsibleResearcher: 'Dr Who',
        equipmentID: 'EQ1',
        equipmentName: 'Sequencer',
        fileSize: 1024,
        uploadedAt
      };

      const created = ResultModel.create(input);

      expect(created.resultID).toBe(42);
      expect(created.sampleID).toBe('S1');
      expect(created.fileType).toBe('PDF');
      expect(created.resultFilePath).toBe('/files/result.pdf');
      expect(created.filePath).toBe('/other/path.pdf');
      expect(created.description).toBe('desc');
      expect(created.analysisType).toBe('type A');
      expect(created.method).toBe('PCR em Tempo Real');
      expect(created.responsibleResearcher).toBe('Dr Who');
      expect(created.equipmentID).toBe('EQ1');
      expect(created.equipmentName).toBe('Sequencer');
      expect(created.fileSize).toBe(1024);
      expect(created.uploadedAt).toBe(uploadedAt);
    });

    it('falls back filePath to resultFilePath when filePath is absent', () => {
      const created = ResultModel.create({
        sampleID: 'S1',
        fileType: 'PDF',
        resultFilePath: '/files/result.pdf'
      });

      expect(created.filePath).toBe('/files/result.pdf');
    });

    it('defaults resultID to null when absent', () => {
      const created = ResultModel.create({
        sampleID: 'S1',
        fileType: 'PDF',
        resultFilePath: '/files/result.pdf'
      });

      expect(created.resultID).toBeNull();
    });

    it('defaults optional descriptive fields to null when absent', () => {
      const created = ResultModel.create({
        sampleID: 'S1',
        fileType: 'PDF',
        resultFilePath: '/files/result.pdf'
      });

      expect(created.description).toBeNull();
      expect(created.analysisType).toBeNull();
      expect(created.method).toBeNull();
      expect(created.responsibleResearcher).toBeNull();
      expect(created.equipmentID).toBeNull();
      expect(created.equipmentName).toBeNull();
      expect(created.fileSize).toBeNull();
    });

    it('preserves falsy-but-valid values instead of coercing to null (#55)', () => {
      const created = ResultModel.create({
        resultID: 0,
        sampleID: 'S1',
        fileType: 'PDF',
        resultFilePath: '/files/result.pdf',
        equipmentID: 0,
        equipmentName: '',
        fileSize: 0
      });

      expect(created.resultID).toBe(0);
      expect(created.equipmentID).toBe(0);
      expect(created.equipmentName).toBe('');
      expect(created.fileSize).toBe(0);
    });

    it('defaults uploadedAt to a Date instance when not provided', () => {
      const created = ResultModel.create({
        sampleID: 'S1',
        fileType: 'PDF',
        resultFilePath: '/files/result.pdf'
      });

      expect(created.uploadedAt).toBeInstanceOf(Date);
    });

    it('sets createdAt and updatedAt as Date instances', () => {
      const created = ResultModel.create({
        sampleID: 'S1',
        fileType: 'PDF',
        resultFilePath: '/files/result.pdf'
      });

      expect(created.createdAt).toBeInstanceOf(Date);
      expect(created.updatedAt).toBeInstanceOf(Date);
    });
  });
});
