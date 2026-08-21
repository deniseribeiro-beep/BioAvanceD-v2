import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const ProcedureModel = require('../../../src/models/Procedure');

const SNOMED_CODING = { systemUri: 'http://snomed.info/sct', code: '80146002' };

describe('ProcedureModel', () => {
  describe('create', () => {
    it('requires a non-empty procedureCoding and performed', () => {
      expect(() => ProcedureModel.create({})).toThrow(
        'procedureCoding é obrigatório para Procedure (1..*, cada item precisa de systemUri e code), performed é obrigatório para Procedure'
      );
    });

    it('drops procedureCoding entries missing systemUri or code, and fails if none remain', () => {
      expect(() => ProcedureModel.create({ procedureCoding: [{ code: 'no-system' }], performed: '2026-01-01' })).toThrow(
        'procedureCoding é obrigatório'
      );
    });

    it('builds a full procedure document with a generated procedureId', () => {
      const doc = ProcedureModel.create({ procedureCoding: [SNOMED_CODING], performed: '2026-01-01' });

      expect(doc.procedureId).toMatch(/^[0-9a-f-]{36}$/);
      expect(doc.procedureCoding).toEqual([SNOMED_CODING]);
      expect(doc.performed).toBe('2026-01-01');
      expect(doc.bodySite).toEqual([]);
    });

    it('carries bodySite entries when given', () => {
      const doc = ProcedureModel.create({
        procedureCoding: [SNOMED_CODING],
        performed: '2026-01-01',
        bodySite: [{ systemUri: 'http://purl.obolibrary.org/obo/uberon.owl', code: 'UBERON:0001062' }],
      });

      expect(doc.bodySite).toEqual([{ systemUri: 'http://purl.obolibrary.org/obo/uberon.owl', code: 'UBERON:0001062' }]);
    });
  });
});
