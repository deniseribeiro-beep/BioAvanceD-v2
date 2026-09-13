import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ObjectId } from 'mongodb';

const consentValidator = require('../../../src/services/consent.validator');

// Note on getCollection: consent.validator.js calls getCollection(db, key) from
// ../utils/collectionResolver, which just resolves a preferred name and calls
// db.collection(name) — when db.listCollections is not a function it skips
// straight to db.collection(preferred). Our fake db objects below omit
// listCollections, so getCollection resolves to 'samples'/'consents' for real
// (no vi.mock needed) and db.collection(...) returns our fake collections.

function makeSamplesCollection(findOneImpl) {
  return {
    findOne: vi.fn(findOneImpl)
  };
}

function makeConsentsCollection(docs = []) {
  const cursor = {
    sort: vi.fn(function sort() { return this; }),
    limit: vi.fn(function limit() { return this; }),
    toArray: vi.fn(async () => docs)
  };
  return {
    find: vi.fn(() => cursor),
    __cursor: cursor
  };
}

function makeFakeDb({ samplesCollection, consentsCollection }) {
  return {
    // getCollection() resolves the 'consents' key to its canonical collection
    // name (config/collections.js maps it to 'patientConsents'), not the
    // literal string 'consents'. Match on collection identity rather than
    // hardcoding the resolved name so this stays correct if the mapping changes.
    collection: vi.fn((name) => {
      if (name === 'samples') return samplesCollection;
      return consentsCollection;
    })
  };
}

describe('consent.validator - validateAccess', () => {
  beforeEach(() => {
    // Reset the singleton's db before each test so init() must be called explicitly.
    consentValidator.db = null;
  });

  it('throws when init() was never called', async () => {
    await expect(consentValidator.validateAccess('123')).rejects.toThrow(
      'Banco de dados não inicializado para validação de consentimento'
    );
  });

  it('throws when specimenId is missing/falsy', async () => {
    const samplesCollection = makeSamplesCollection(async () => null);
    const consentsCollection = makeConsentsCollection();
    consentValidator.init(makeFakeDb({ samplesCollection, consentsCollection }));

    await expect(consentValidator.validateAccess(null)).rejects.toThrow(
      'specimenId é obrigatório para validar consentimento'
    );
  });

  it('finds the sample via the valid ObjectId path', async () => {
    const objectId = new ObjectId();
    const sample = { _id: objectId, participantId: 'p1' };
    const samplesCollection = makeSamplesCollection(async (query) => {
      if (query._id) return sample;
      return null;
    });
    const consentDoc = { responses: {} };
    const consentsCollection = makeConsentsCollection([consentDoc]);
    consentValidator.init(makeFakeDb({ samplesCollection, consentsCollection }));

    const result = await consentValidator.validateAccess(objectId.toString());

    expect(result).toBe(true);
    expect(samplesCollection.findOne).toHaveBeenCalledTimes(1);
  });

  it('falls through to specimenId lookup when ObjectId lookup misses', async () => {
    const specimenIdStr = 'SPEC-001';
    const samplesCollection = makeSamplesCollection(async (query) => {
      if (query._id) return null; // stage 1: ObjectId lookup skipped (not valid hex)
      if (query.specimenId) return { specimenId: specimenIdStr, participantId: 'p2' };
      return null;
    });
    const consentsCollection = makeConsentsCollection([{ responses: {} }]);
    consentValidator.init(makeFakeDb({ samplesCollection, consentsCollection }));

    const result = await consentValidator.validateAccess(specimenIdStr);

    expect(result).toBe(true);
    expect(samplesCollection.findOne).toHaveBeenCalledTimes(1);
  });

  it('falls through to barcode lookup when both ObjectId and specimenId lookups miss', async () => {
    // A 24-digit numeric string is valid hex (ObjectId.isValid true), so it
    // genuinely exercises the ObjectId stage (miss) before falling through to
    // the specimenId stage (miss) and then the barcode stage (hit).
    const idStr = '888888888888888888888888';
    const samplesCollection = makeSamplesCollection(async (query) => {
      if (query._id) return null; // stage 1: ObjectId lookup misses
      if (query.specimenId) return null; // stage 2: specimenId lookup misses
      if (query.barcode) return { barcode: idStr, participantId: 'p3' }; // stage 3: barcode lookup hits
      return null;
    });
    const consentsCollection = makeConsentsCollection([{ responses: {} }]);
    consentValidator.init(makeFakeDb({ samplesCollection, consentsCollection }));

    const result = await consentValidator.validateAccess(idStr);

    expect(result).toBe(true);
    expect(samplesCollection.findOne).toHaveBeenCalledTimes(3);
  });

  it('throws "Amostra não encontrada" when all three lookups miss', async () => {
    const samplesCollection = makeSamplesCollection(async () => null);
    const consentsCollection = makeConsentsCollection([]);
    consentValidator.init(makeFakeDb({ samplesCollection, consentsCollection }));

    await expect(consentValidator.validateAccess('does-not-exist')).rejects.toThrow(
      'Amostra não encontrada para validação de consentimento'
    );
  });

  it('throws when sample is found but has no participantId', async () => {
    const samplesCollection = makeSamplesCollection(async (query) => {
      if (query.barcode) return { barcode: 'BC-2' }; // no participantId
      return null;
    });
    const consentsCollection = makeConsentsCollection([]);
    consentValidator.init(makeFakeDb({ samplesCollection, consentsCollection }));

    await expect(consentValidator.validateAccess('BC-2')).rejects.toThrow(
      'Amostra sem participantId para validação de consentimento'
    );
  });

  it('throws "Consentimento inexistente ou revogado" when consents query returns empty', async () => {
    const sample = { _id: new ObjectId(), participantId: 'p4' };
    const samplesCollection = makeSamplesCollection(async (query) => (query._id ? sample : null));
    const consentsCollection = makeConsentsCollection([]);
    consentValidator.init(makeFakeDb({ samplesCollection, consentsCollection }));

    await expect(consentValidator.validateAccess(sample._id.toString())).rejects.toThrow(
      'Consentimento inexistente ou revogado para este participante'
    );
  });

  it('succeeds (returns true) with a valid active consent and no requiredScope', async () => {
    const sample = { _id: new ObjectId(), participantId: 'p5' };
    const samplesCollection = makeSamplesCollection(async (query) => (query._id ? sample : null));
    const consentsCollection = makeConsentsCollection([{ responses: { genetic: true } }]);
    consentValidator.init(makeFakeDb({ samplesCollection, consentsCollection }));

    const result = await consentValidator.validateAccess(sample._id.toString());

    expect(result).toBe(true);
  });

  it('succeeds when requiredScope is present and true in responses', async () => {
    const sample = { _id: new ObjectId(), participantId: 'p6' };
    const samplesCollection = makeSamplesCollection(async (query) => (query._id ? sample : null));
    const consentsCollection = makeConsentsCollection([{ responses: { genetic: true } }]);
    consentValidator.init(makeFakeDb({ samplesCollection, consentsCollection }));

    const result = await consentValidator.validateAccess(sample._id.toString(), 'genetic');

    expect(result).toBe(true);
  });

  it('throws with the exact scope name when requiredScope is false in responses', async () => {
    const sample = { _id: new ObjectId(), participantId: 'p7' };
    const samplesCollection = makeSamplesCollection(async (query) => (query._id ? sample : null));
    const consentsCollection = makeConsentsCollection([{ responses: { genetic: false } }]);
    consentValidator.init(makeFakeDb({ samplesCollection, consentsCollection }));

    await expect(
      consentValidator.validateAccess(sample._id.toString(), 'genetic')
    ).rejects.toThrow('Consentimento não permite o escopo solicitado: genetic');
  });

  it('throws with the exact scope name when requiredScope is missing from responses', async () => {
    const sample = { _id: new ObjectId(), participantId: 'p8' };
    const samplesCollection = makeSamplesCollection(async (query) => (query._id ? sample : null));
    const consentsCollection = makeConsentsCollection([{ responses: {} }]);
    consentValidator.init(makeFakeDb({ samplesCollection, consentsCollection }));

    await expect(
      consentValidator.validateAccess(sample._id.toString(), 'imaging')
    ).rejects.toThrow('Consentimento não permite o escopo solicitado: imaging');
  });

  it('queries consents sorted by signedAt/createdAt desc and limited to 1', async () => {
    const sample = { _id: new ObjectId(), participantId: 'p9' };
    const samplesCollection = makeSamplesCollection(async (query) => (query._id ? sample : null));
    const consentsCollection = makeConsentsCollection([{ responses: {} }]);
    consentValidator.init(makeFakeDb({ samplesCollection, consentsCollection }));

    await consentValidator.validateAccess(sample._id.toString());

    expect(consentsCollection.find).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'ACTIVE' })
    );
    expect(consentsCollection.__cursor.sort).toHaveBeenCalledWith({ signedAt: -1, createdAt: -1 });
    expect(consentsCollection.__cursor.limit).toHaveBeenCalledWith(1);
  });
});
