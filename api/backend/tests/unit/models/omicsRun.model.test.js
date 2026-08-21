import { describe, it, expect } from 'vitest';

const OmicsRunModel = require('../../../src/models/OmicsRun');

describe('OmicsRunModel (RF027 AC#5, dict-02 ELM-0343..0352)', () => {
  const baseRun = {
    modality: 'genomics',
  };

  describe('validate', () => {
    it('valid minimal payload -> isValid true, no errors', () => {
      const result = OmicsRunModel.validate({ ...baseRun });
      expect(result.isValid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('modality missing -> isValid false', () => {
      const result = OmicsRunModel.validate({ ...baseRun, modality: undefined });
      expect(result.isValid).toBe(false);
    });

    it('modality out of enum -> isValid false', () => {
      const result = OmicsRunModel.validate({ ...baseRun, modality: 'astrology' });
      expect(result.isValid).toBe(false);
    });

    it.each(['genomics', 'transcriptomics', 'proteomics', 'metabolomics', 'microbiome'])('modality %s -> isValid true', (modality) => {
      const result = OmicsRunModel.validate({ modality });
      expect(result.isValid).toBe(true);
    });

    it('referenceAssembly/mixsChecklist/fileLinks omitted -> still valid (0..1/0..* per dict-02)', () => {
      const result = OmicsRunModel.validate({ ...baseRun });
      expect(result.isValid).toBe(true);
    });

    it('referenceAssembly provided -> isValid true (AC#5)', () => {
      const result = OmicsRunModel.validate({ ...baseRun, referenceAssembly: 'GRCh38' });
      expect(result.isValid).toBe(true);
    });

    it('referenceAssembly empty string -> isValid false', () => {
      const result = OmicsRunModel.validate({ ...baseRun, referenceAssembly: '' });
      expect(result.isValid).toBe(false);
    });

    it('mixsChecklist provided -> isValid true', () => {
      const result = OmicsRunModel.validate({ modality: 'microbiome', mixsChecklist: 'MIxS 6.0' });
      expect(result.isValid).toBe(true);
    });

    it('fileLinks not an array -> isValid false', () => {
      const result = OmicsRunModel.validate({ ...baseRun, fileLinks: 'not-an-array' });
      expect(result.isValid).toBe(false);
    });

    it('fileLinks entry missing role -> isValid false', () => {
      const result = OmicsRunModel.validate({ ...baseRun, fileLinks: [{ fileId: 'file-1' }] });
      expect(result.isValid).toBe(false);
    });

    it('fileLinks entry missing fileId -> isValid false', () => {
      const result = OmicsRunModel.validate({ ...baseRun, fileLinks: [{ role: 'read' }] });
      expect(result.isValid).toBe(false);
    });

    it('fileLinks with valid entries -> isValid true', () => {
      const result = OmicsRunModel.validate({
        ...baseRun,
        fileLinks: [{ role: 'read', fileId: 'file-1' }, { role: 'alignment', fileId: 'file-2' }],
      });
      expect(result.isValid).toBe(true);
    });
  });

  describe('create', () => {
    it('generates a uuid omicsRunId, preserves modality, defaults optional fields', () => {
      const result = OmicsRunModel.create({ ...baseRun });

      expect(result.omicsRunId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      expect(result.modality).toBe('genomics');
      expect(result.referenceAssembly).toBeNull();
      expect(result.mixsChecklist).toBeNull();
      expect(result.fileLinks).toEqual([]);
    });

    it('preserves referenceAssembly when provided', () => {
      const result = OmicsRunModel.create({ ...baseRun, referenceAssembly: 'GRCh38' });
      expect(result.referenceAssembly).toBe('GRCh38');
    });

    it('does not mutate the caller-provided fileLinks array', () => {
      const fileLinks = [{ role: 'read', fileId: 'file-1' }];
      const result = OmicsRunModel.create({ ...baseRun, fileLinks });

      result.fileLinks.push({ role: 'alignment', fileId: 'file-2' });
      expect(fileLinks).toEqual([{ role: 'read', fileId: 'file-1' }]);
    });
  });
});
