import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { createProcedure, getProcedureById } = require('../../../src/services/procedure.service');
const { createFakeDb } = require('../ingestion/testHelpers');

const SNOMED_CODING = { systemUri: 'http://snomed.info/sct', code: '80146002' };

describe('procedure.service', () => {
  describe('createProcedure', () => {
    it('persists a procedure document', async () => {
      const db = createFakeDb({});

      const stored = await createProcedure(db, { procedureCoding: [SNOMED_CODING], performed: '2026-01-01' });

      expect(stored.procedureCoding).toEqual([SNOMED_CODING]);
      expect(db.collections.procedures.docs).toHaveLength(1);
    });

    it('propagates model validation failures instead of persisting an invalid document', async () => {
      const db = createFakeDb({});

      await expect(createProcedure(db, {})).rejects.toThrow('procedureCoding é obrigatório para Procedure');
      expect(db.collections.procedures?.docs || []).toHaveLength(0);
    });
  });

  describe('getProcedureById', () => {
    it('resolves by procedureId, not Mongo _id', async () => {
      const db = createFakeDb({});
      const created = await createProcedure(db, { procedureId: 'proc-fixed', procedureCoding: [SNOMED_CODING], performed: '2026-01-01' });

      const resolved = await getProcedureById(db, created.procedureId);

      expect(resolved.procedureId).toBe('proc-fixed');
    });

    it('returns null for a null/undefined id instead of querying', async () => {
      const db = createFakeDb({});
      expect(await getProcedureById(db, null)).toBeNull();
    });
  });
});
