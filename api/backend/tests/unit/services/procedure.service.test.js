import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { createProcedure, getProcedureById } = require('../../../src/services/procedure.service');
const { createFakeDb } = require('../ingestion/testHelpers');

const LOCAL_PROCEDURE_SYSTEM_URI = 'urn:biobank:local-procedure-terminology';
const LOCAL_CODE = 'LOCAL-001';
const LOCAL_CODING = { systemUri: LOCAL_PROCEDURE_SYSTEM_URI, code: LOCAL_CODE };

function activeConceptAndRelease(overrides = {}) {
  return {
    terminologyConcepts: [
      {
        systemUri: LOCAL_PROCEDURE_SYSTEM_URI,
        code: LOCAL_CODE,
        version: '2026-01',
        conceptStatus: 'active',
        referenceDatasetReleaseId: 'release-local-proc',
      },
    ],
    referenceDatasetReleases: [
      {
        referenceDatasetReleaseId: 'release-local-proc',
        datasetCode: 'LOCAL_PROCEDURE',
        releaseStatus: 'active',
      },
    ],
    ...overrides,
  };
}

describe('procedure.service', () => {
  describe('createProcedure', () => {
    it('(RF005 AC#4 / #714) persists a procedure whose coding resolves to an active release', async () => {
      const db = createFakeDb(activeConceptAndRelease());

      const stored = await createProcedure(db, {
        procedureCoding: [LOCAL_CODING],
        performed: '2026-01-01',
      });

      expect(stored.procedureCoding).toMatchObject([LOCAL_CODING]);
      expect(db.collections.procedures.docs).toHaveLength(1);
    });

    it('(RF005 AC#4 / #714) rejects a coding with no active release, without persisting', async () => {
      const db = createFakeDb(
        activeConceptAndRelease({
          referenceDatasetReleases: [
            {
              referenceDatasetReleaseId: 'release-local-proc',
              datasetCode: 'LOCAL_PROCEDURE',
              releaseStatus: 'superseded',
            },
          ],
        })
      );

      await expect(
        createProcedure(db, { procedureCoding: [LOCAL_CODING], performed: '2026-01-01' })
      ).rejects.toThrow(/não pertence a uma release de referência ativa/);
      expect(db.collections.procedures?.docs || []).toHaveLength(0);
    });

    it('propagates model validation failures instead of persisting an invalid document', async () => {
      const db = createFakeDb({});

      await expect(createProcedure(db, {})).rejects.toThrow('procedureCoding é obrigatório para Procedure');
      expect(db.collections.procedures?.docs || []).toHaveLength(0);
    });
  });

  describe('getProcedureById', () => {
    it('resolves by procedureId, not Mongo _id', async () => {
      const db = createFakeDb(activeConceptAndRelease());
      const created = await createProcedure(db, {
        procedureId: 'proc-fixed',
        procedureCoding: [LOCAL_CODING],
        performed: '2026-01-01',
      });

      const resolved = await getProcedureById(db, created.procedureId);

      expect(resolved.procedureId).toBe('proc-fixed');
    });

    it('returns null for a null/undefined id instead of querying', async () => {
      const db = createFakeDb({});
      expect(await getProcedureById(db, null)).toBeNull();
    });
  });
});
