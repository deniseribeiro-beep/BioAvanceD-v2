import { describe, it, expect, afterEach, vi } from 'vitest';
import { createRequire } from 'module';

const require2 = createRequire(import.meta.url);
const sampleCollectionGate = require2('../../src/services/sample-collection-gate.service');
const collectionGovernanceService = require2('../../src/services/collectionGovernance.service');

const { assertSampleCollectionAdmits, COLLECTION_REQUIRED, COLLECTION_NOT_ADMITTED } = sampleCollectionGate;

function makeDb(collectionDoc) {
  const findOne = vi.fn().mockResolvedValue(collectionDoc);
  return {
    findOne,
    collection: (name) => {
      if (name !== 'collections') throw new Error(`Unexpected collection name: ${name}`);
      return { findOne };
    },
  };
}

const biobank = () => ({ collectionId: 'COL-1', governanceRegime: 'biobank', governanceContext: { biobankId: 'BB-1' } });
const biorepository = () => ({
  collectionId: 'COL-2',
  governanceRegime: 'biorepository',
  governanceContext: { studyId: 'STUDY-1', protocolId: 'PROT-1' },
});

afterEach(() => {
  vi.restoreAllMocks();
});

// RF004 AC2, ELM-0118 (Specimen.collectionId 1..1 Core, #1538): the one
// collection gate createSample and the sample imports run.
describe('sample-collection-gate.assertSampleCollectionAdmits', () => {
  it.each([
    ['undefined', undefined],
    ['null', null],
    ['an empty string', ''],
    ['a blank string', '   '],
  ])('refuses a sample whose collectionId is %s with a 422 COLLECTION_REQUIRED, reading no collection', async (_label, collectionId) => {
    const db = makeDb(biobank());

    await expect(assertSampleCollectionAdmits(db, { participantId: 'P-1', collectionId }))
      .rejects.toMatchObject({
        statusCode: 422,
        code: COLLECTION_REQUIRED,
        message: expect.stringMatching(/collectionId é obrigatório/),
      });
    expect(db.findOne).not.toHaveBeenCalled();
  });

  it('refuses a collectionId that resolves to no collection with a 404', async () => {
    const db = makeDb(null);

    await expect(assertSampleCollectionAdmits(db, { collectionId: 'COL-404' }))
      .rejects.toMatchObject({ statusCode: 404, message: 'collectionId COL-404 não encontrado' });
    expect(db.findOne).toHaveBeenCalledWith({ collectionId: 'COL-404' });
  });

  it('refuses a collection whose governance refuses registration with a 422 COLLECTION_NOT_ADMITTED carrying the refusal', async () => {
    vi.spyOn(collectionGovernanceService, 'registrationRefusal').mockResolvedValue('motivo');
    const db = makeDb(biobank());

    await expect(assertSampleCollectionAdmits(db, { collectionId: 'COL-1' }))
      .rejects.toMatchObject({ statusCode: 422, code: COLLECTION_NOT_ADMITTED, message: 'motivo' });
  });

  it("refuses a biorepository sample naming another study than the collection context's with a 422 COLLECTION_NOT_ADMITTED (RF004 AC4)", async () => {
    vi.spyOn(collectionGovernanceService, 'registrationRefusal').mockResolvedValue(null);
    const db = makeDb(biorepository());

    await expect(assertSampleCollectionAdmits(db, { collectionId: 'COL-2', studyId: 'STUDY-OTHER' }))
      .rejects.toMatchObject({
        statusCode: 422,
        code: COLLECTION_NOT_ADMITTED,
        message: 'studyId STUDY-OTHER difere do studyId do biorrepositório da coleção (STUDY-1)',
      });
  });

  it('resolves an admitted collection to its document', async () => {
    vi.spyOn(collectionGovernanceService, 'registrationRefusal').mockResolvedValue(null);
    const doc = biorepository();
    const db = makeDb(doc);

    await expect(assertSampleCollectionAdmits(db, { collectionId: 'COL-2', studyId: 'STUDY-1', protocolId: 'PROT-1' }))
      .resolves.toBe(doc);
  });
});
