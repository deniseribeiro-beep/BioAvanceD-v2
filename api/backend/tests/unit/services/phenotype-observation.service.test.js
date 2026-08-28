import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const {
  createPhenotypeObservation,
  getPhenotypeObservationsForParticipant,
  getPhenotypeObservationsForEncounter,
} = require('../../../src/services/phenotype-observation.service');
const { createFakeDb } = require('../ingestion/testHelpers');

const SYSTEM_URI = 'http://purl.obolibrary.org/obo/hp.owl';
const CODE = 'HP:0000001';

function activeConceptAndRelease(overrides = {}) {
  return {
    terminologyConcepts: [
      { systemUri: SYSTEM_URI, code: CODE, version: '2026-01-01', conceptStatus: 'active', referenceDatasetReleaseId: 'release-1' },
    ],
    referenceDatasetReleases: [{ referenceDatasetReleaseId: 'release-1', datasetCode: 'HPO', releaseStatus: 'active' }],
    ...overrides,
  };
}

describe('phenotype-observation.service', () => {
  describe('createPhenotypeObservation', () => {
    it('persists an observation whose hpoCoding resolves to an active release', async () => {
      const db = createFakeDb(activeConceptAndRelease());

      const stored = await createPhenotypeObservation(db, {
        participantId: 'PART-1',
        hpoCoding: { systemUri: SYSTEM_URI, code: CODE },
        presenceStatus: 'present',
        effectiveDateTime: '2026-01-01',
      });

      expect(stored.participantId).toBe('PART-1');
      expect(db.collections.phenotypeObservations.docs).toHaveLength(1);
    });

    it('rejects an hpoCoding whose release is not active, without persisting anything', async () => {
      const db = createFakeDb(
        activeConceptAndRelease({
          referenceDatasetReleases: [{ referenceDatasetReleaseId: 'release-1', datasetCode: 'HPO', releaseStatus: 'rejected' }],
        })
      );

      await expect(
        createPhenotypeObservation(db, {
          participantId: 'PART-1',
          hpoCoding: { systemUri: SYSTEM_URI, code: CODE },
          presenceStatus: 'absent',
          effectiveDateTime: '2026-01-01',
        })
      ).rejects.toThrow(/não pertence a uma release de referência ativa/);
      expect(db.collections.phenotypeObservations?.docs || []).toHaveLength(0);
    });

    it('propagates model validation failures (e.g. missing presenceStatus) before the code check', async () => {
      const db = createFakeDb(activeConceptAndRelease());

      await expect(
        createPhenotypeObservation(db, { participantId: 'PART-1', hpoCoding: { systemUri: SYSTEM_URI, code: CODE }, effectiveDateTime: '2026-01-01' })
      ).rejects.toThrow(/presenceStatus é obrigatório/);
    });

    it('#866 (RF005 AC#5): stamps the resolved TerminologyConcept version onto hpoCoding when the caller omitted it', async () => {
      const db = createFakeDb(activeConceptAndRelease());

      await createPhenotypeObservation(db, {
        participantId: 'PART-1',
        hpoCoding: { systemUri: SYSTEM_URI, code: CODE },
        presenceStatus: 'present',
        effectiveDateTime: '2026-01-01',
      });

      expect(db.collections.phenotypeObservations.docs[0].hpoCoding.version).toBe('2026-01-01');
    });

    it('#866: never overwrites a version the caller explicitly supplied', async () => {
      // checkActiveCode resolves an explicit version via an exact
      // systemUri+code+version match, so the seeded concept's version must
      // equal the caller-supplied one for the code check to pass at all --
      // this still proves the caller's own value reaches the stored
      // document untouched, via the `if (!coding.version)` guard, rather
      // than being unconditionally re-assigned from the validator result.
      const db = createFakeDb(
        activeConceptAndRelease({
          terminologyConcepts: [
            {
              systemUri: SYSTEM_URI,
              code: CODE,
              version: 'caller-supplied-version',
              conceptStatus: 'active',
              referenceDatasetReleaseId: 'release-1',
            },
          ],
        })
      );

      await createPhenotypeObservation(db, {
        participantId: 'PART-1',
        hpoCoding: { systemUri: SYSTEM_URI, code: CODE, version: 'caller-supplied-version' },
        presenceStatus: 'present',
        effectiveDateTime: '2026-01-01',
      });

      expect(db.collections.phenotypeObservations.docs[0].hpoCoding.version).toBe('caller-supplied-version');
    });

    it('#866: leaves version absent (not null/invented) when the validator resolves the code without a version', async () => {
      const db = createFakeDb(
        activeConceptAndRelease({
          terminologyConcepts: [
            { systemUri: SYSTEM_URI, code: CODE, conceptStatus: 'active', referenceDatasetReleaseId: 'release-1' },
          ],
        })
      );

      await createPhenotypeObservation(db, {
        participantId: 'PART-1',
        hpoCoding: { systemUri: SYSTEM_URI, code: CODE },
        presenceStatus: 'present',
        effectiveDateTime: '2026-01-01',
      });

      expect(db.collections.phenotypeObservations.docs).toHaveLength(1);
      expect('version' in db.collections.phenotypeObservations.docs[0].hpoCoding).toBe(false);
    });
  });

  describe('getPhenotypeObservationsForParticipant', () => {
    it('scopes results to the requested participantId only', async () => {
      const db = createFakeDb(activeConceptAndRelease());
      await createPhenotypeObservation(db, {
        participantId: 'PART-1',
        hpoCoding: { systemUri: SYSTEM_URI, code: CODE },
        presenceStatus: 'present',
        effectiveDateTime: '2026-01-01',
      });
      await createPhenotypeObservation(db, {
        participantId: 'PART-2',
        hpoCoding: { systemUri: SYSTEM_URI, code: CODE },
        presenceStatus: 'present',
        effectiveDateTime: '2026-01-01',
      });

      const observations = await getPhenotypeObservationsForParticipant(db, 'PART-1');

      expect(observations).toHaveLength(1);
      expect(observations[0].participantId).toBe('PART-1');
    });
  });

  describe('getPhenotypeObservationsForEncounter', () => {
    it('scopes results to the requested encounterId (P1X-0075)', async () => {
      const db = createFakeDb(activeConceptAndRelease());
      await createPhenotypeObservation(db, {
        participantId: 'PART-1',
        hpoCoding: { systemUri: SYSTEM_URI, code: CODE },
        presenceStatus: 'present',
        effectiveDateTime: '2026-01-01',
        encounterId: 'enc-1',
      });
      await createPhenotypeObservation(db, {
        participantId: 'PART-1',
        hpoCoding: { systemUri: SYSTEM_URI, code: CODE },
        presenceStatus: 'present',
        effectiveDateTime: '2026-01-01',
      });

      const observations = await getPhenotypeObservationsForEncounter(db, 'enc-1');

      expect(observations).toHaveLength(1);
      expect(observations[0].encounterId).toBe('enc-1');
    });

    it('returns an empty array for a null/undefined encounterId instead of querying', async () => {
      const db = createFakeDb({});
      expect(await getPhenotypeObservationsForEncounter(db, null)).toEqual([]);
    });
  });
});
