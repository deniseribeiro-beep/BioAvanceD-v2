import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
const { ObjectId } = require('mongodb');

const { RegisterSample, RegisterSampleForbiddenError } = require('../../src/core/use-cases/RegisterSample');
const sampleService = require('../../src/services/sample.service');
const env = require('../../src/config/env');

function makeConsentsCollection(activeConsent) {
  return {
    findOne: vi.fn().mockResolvedValue(activeConsent || null)
  };
}

function makeSamplesCollection() {
  return {
    deleteOne: vi.fn().mockResolvedValue({ deletedCount: 1 })
  };
}

// RegisterSample.js does `const { getCollection } = require('../../utils/collectionResolver')`
// at module load time, so vi.spyOn(collectionResolver, 'getCollection') does NOT intercept the
// call inside RegisterSample (it holds its own reference to the original function). Instead we
// build a fake `db` whose `.collection(name)` is what getCollection ultimately calls, since
// `db.listCollections` is undefined and resolveCollectionName short-circuits to the canonical name.
function makeDb(collectionsByName) {
  return {
    collection: vi.fn((name) => {
      const collection = collectionsByName[name];
      if (!collection) {
        throw new Error(`unexpected collection requested: ${name}`);
      }
      return collection;
    })
  };
}

describe('RegisterSample', () => {
  let db;
  let originalLineageMode;

  beforeEach(() => {
    db = {}; // plain opaque handle for tests that never touch a collection
    originalLineageMode = env.LINEAGE_MODE;
  });

  afterEach(() => {
    env.LINEAGE_MODE = originalLineageMode;
    vi.restoreAllMocks();
  });

  describe('shouldForceStrictMode', () => {
    it('is strict when env.LINEAGE_MODE is fail-closed', () => {
      env.LINEAGE_MODE = 'fail-closed';
      const useCase = new RegisterSample({ db });
      expect(useCase.shouldForceStrictMode({})).toBe(true);
    });

    it('is permissive by default (fail-open) with no risk indicators', () => {
      env.LINEAGE_MODE = 'fail-open';
      const useCase = new RegisterSample({ db });
      expect(useCase.shouldForceStrictMode({})).toBe(false);
    });

    it('is strict when isRareDisease is true', () => {
      env.LINEAGE_MODE = 'fail-open';
      const useCase = new RegisterSample({ db });
      expect(useCase.shouldForceStrictMode({ isRareDisease: true })).toBe(true);
    });

    it.each(['high', 'critical', 'alto', 'crítico', 'critico', 'severe', 'HIGH', 'Crítico'])(
      'is strict when riskLevel is high-risk value "%s" (case-insensitive)',
      (riskLevel) => {
        env.LINEAGE_MODE = 'fail-open';
        const useCase = new RegisterSample({ db });
        expect(useCase.shouldForceStrictMode({ riskLevel })).toBe(true);
      }
    );

    it('is strict when riskGrade (not riskLevel) is a high-risk value', () => {
      env.LINEAGE_MODE = 'fail-open';
      const useCase = new RegisterSample({ db });
      expect(useCase.shouldForceStrictMode({ riskGrade: 'critical' })).toBe(true);
    });

    it('is permissive when riskLevel is a low-risk value', () => {
      env.LINEAGE_MODE = 'fail-open';
      const useCase = new RegisterSample({ db });
      expect(useCase.shouldForceStrictMode({ riskLevel: 'low' })).toBe(false);
    });

    it('is strict when riskScore >= 7', () => {
      env.LINEAGE_MODE = 'fail-open';
      const useCase = new RegisterSample({ db });
      expect(useCase.shouldForceStrictMode({ riskScore: 7 })).toBe(true);
    });

    it('is permissive when riskScore < 7', () => {
      env.LINEAGE_MODE = 'fail-open';
      const useCase = new RegisterSample({ db });
      expect(useCase.shouldForceStrictMode({ riskScore: 6.9 })).toBe(false);
    });

    it('defaults to fail-open (permissive) when env.LINEAGE_MODE is unset', () => {
      env.LINEAGE_MODE = undefined;
      const useCase = new RegisterSample({ db });
      expect(useCase.shouldForceStrictMode({})).toBe(false);
    });
  });

  describe('buildRiskContext', () => {
    it('reports riskScore as null when sampleData has no finite riskScore', () => {
      const useCase = new RegisterSample({ db });
      expect(useCase.buildRiskContext({}, false).riskScore).toBeNull();
    });

    it('reports the numeric riskScore when sampleData has one', () => {
      const useCase = new RegisterSample({ db });
      expect(useCase.buildRiskContext({ riskScore: '8' }, true).riskScore).toBe(8);
    });
  });

  describe('assertConsent', () => {
    it('throws RegisterSampleForbiddenError in strict mode when participantId is missing', async () => {
      const useCase = new RegisterSample({ db });
      await expect(useCase.assertConsent({}, true)).rejects.toThrow(RegisterSampleForbiddenError);
    });

    it('does not throw and skips consent lookup in permissive mode when participantId is missing', async () => {
      const noLookupDb = makeDb({});
      const useCase = new RegisterSample({ db: noLookupDb });
      await expect(useCase.assertConsent({}, false)).resolves.toBeUndefined();
      expect(noLookupDb.collection).not.toHaveBeenCalled();
    });

    it('looks up the consents collection with participantId and allowed statuses when participantId is present', async () => {
      const consentsCollection = makeConsentsCollection({ _id: 'c1', participantId: 'P1', status: 'ACTIVE' });
      const consentsDb = makeDb({ patientConsents: consentsCollection });
      const useCase = new RegisterSample({ db: consentsDb });

      await useCase.assertConsent({ participantId: 'P1' }, true);

      expect(consentsDb.collection).toHaveBeenCalledWith('patientConsents');
      expect(consentsCollection.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          participantId: 'P1',
          status: { $in: ['ACTIVE', 'VALID', 'GRANTED'] }
        }),
        expect.any(Object)
      );
    });

    it('throws in strict mode when no active consent is found', async () => {
      const consentsCollection = makeConsentsCollection(null);
      const consentsDb = makeDb({ patientConsents: consentsCollection });
      const useCase = new RegisterSample({ db: consentsDb });

      await expect(useCase.assertConsent({ participantId: 'P1' }, true)).rejects.toThrow(
        RegisterSampleForbiddenError
      );
    });

    it('does not throw in permissive mode when no active consent is found', async () => {
      const consentsCollection = makeConsentsCollection(null);
      const consentsDb = makeDb({ patientConsents: consentsCollection });
      const useCase = new RegisterSample({ db: consentsDb });

      await expect(useCase.assertConsent({ participantId: 'P1' }, false)).resolves.toBeUndefined();
    });
  });

  describe('execute (happy path)', () => {
    it('creates the sample, records lineage, and returns sample/lineageMode/riskContext', async () => {
      env.LINEAGE_MODE = 'fail-open';
      const createdSample = { _id: new ObjectId(), barcode: 'BC-1' };
      vi.spyOn(sampleService, 'createSample').mockResolvedValue(createdSample);

      const lineageRepository = {
        validateBeforePersistence: vi.fn().mockResolvedValue(undefined),
        recordCustodyEvent: vi.fn().mockResolvedValue(undefined)
      };

      const useCase = new RegisterSample({ db, lineageRepository });
      const command = {
        sampleData: { barcode: 'BC-1' },
        options: { foo: 'bar' },
        actor: { userId: 'U1' }
      };

      const result = await useCase.execute(command);

      expect(sampleService.createSample).toHaveBeenCalledWith(db, command.sampleData, command.options);
      expect(lineageRepository.validateBeforePersistence).toHaveBeenCalledWith(
        expect.objectContaining({
          specimenId: String(createdSample._id),
          barcode: 'BC-1',
          eventType: 'register',
          actorId: 'U1'
        })
      );
      expect(lineageRepository.recordCustodyEvent).toHaveBeenCalled();
      expect(result).toEqual({
        sample: createdSample,
        lineageMode: 'permissive',
        riskContext: expect.objectContaining({ strictMode: false })
      });
    });

    it('throws when db is not provided', async () => {
      const useCase = new RegisterSample({ db: null });
      await expect(useCase.execute({ sampleData: {} })).rejects.toThrow(
        'Banco de dados indisponível para registro de amostra'
      );
    });

    it('succeeds end-to-end in strict mode and reports lineageMode "strict"', async () => {
      env.LINEAGE_MODE = 'fail-closed';
      const consentsCollection = makeConsentsCollection({ _id: 'c1', status: 'ACTIVE' });
      const consentsDb = makeDb({ patientConsents: consentsCollection });
      const createdSample = { _id: new ObjectId() };
      vi.spyOn(sampleService, 'createSample').mockResolvedValue(createdSample);

      const lineageRepository = {
        validateBeforePersistence: vi.fn().mockResolvedValue(undefined),
        recordCustodyEvent: vi.fn().mockResolvedValue(undefined)
      };

      const useCase = new RegisterSample({ db: consentsDb, lineageRepository });
      const result = await useCase.execute({ sampleData: { participantId: 'P1', barcode: 'BC-X' } });

      expect(result.lineageMode).toBe('strict');
    });

    it('falls back to an empty sampleData object when the command has none', async () => {
      env.LINEAGE_MODE = 'fail-open';
      const createdSample = { _id: new ObjectId(), barcode: 'BC-EMPTY' };
      vi.spyOn(sampleService, 'createSample').mockResolvedValue(createdSample);

      const lineageRepository = {
        validateBeforePersistence: vi.fn().mockResolvedValue(undefined),
        recordCustodyEvent: vi.fn().mockResolvedValue(undefined)
      };

      const useCase = new RegisterSample({ db, lineageRepository });

      const result = await useCase.execute({});

      expect(result.lineageMode).toBe('permissive');
    });

    it('falls back to sampleData.barcode when createdSample has no barcode of its own', async () => {
      env.LINEAGE_MODE = 'fail-open';
      const createdSample = { _id: new ObjectId() };
      vi.spyOn(sampleService, 'createSample').mockResolvedValue(createdSample);

      const lineageRepository = {
        validateBeforePersistence: vi.fn().mockResolvedValue(undefined),
        recordCustodyEvent: vi.fn().mockResolvedValue(undefined)
      };

      const useCase = new RegisterSample({ db, lineageRepository });

      await useCase.execute({ sampleData: { barcode: 'BC-FALLBACK' } });

      expect(lineageRepository.validateBeforePersistence).toHaveBeenCalledWith(
        expect.objectContaining({ barcode: 'BC-FALLBACK' })
      );
    });

    it('falls back to null barcode when neither createdSample nor sampleData has one', async () => {
      env.LINEAGE_MODE = 'fail-open';
      const createdSample = { _id: new ObjectId() };
      vi.spyOn(sampleService, 'createSample').mockResolvedValue(createdSample);

      const lineageRepository = {
        validateBeforePersistence: vi.fn().mockResolvedValue(undefined),
        recordCustodyEvent: vi.fn().mockResolvedValue(undefined)
      };

      const useCase = new RegisterSample({ db, lineageRepository });

      await useCase.execute({ sampleData: {} });

      expect(lineageRepository.validateBeforePersistence).toHaveBeenCalledWith(
        expect.objectContaining({ barcode: null })
      );
    });
  });

  describe('handleLineage', () => {
    it('throws forbidden when no lineageRepository and strict mode', async () => {
      const useCase = new RegisterSample({ db });
      await expect(useCase.handleLineage({ specimenId: '1' }, true)).rejects.toThrow(
        RegisterSampleForbiddenError
      );
    });

    it('enqueues quarantine and does not throw when no lineageRepository and permissive mode', async () => {
      const quarantineQueue = { enqueue: vi.fn().mockResolvedValue(undefined) };
      const useCase = new RegisterSample({ db, quarantineQueue });

      await expect(useCase.handleLineage({ specimenId: '1' }, false)).resolves.toBeUndefined();

      expect(quarantineQueue.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({ specimenId: '1' }),
        expect.objectContaining({ reason: 'lineage_repository_unavailable' })
      );
    });

    it('calls validateBeforePersistence then recordCustodyEvent when lineageRepository is present', async () => {
      const calls = [];
      const lineageRepository = {
        validateBeforePersistence: vi.fn().mockImplementation(async () => {
          calls.push('validate');
        }),
        recordCustodyEvent: vi.fn().mockImplementation(async () => {
          calls.push('record');
        })
      };
      const useCase = new RegisterSample({ db, lineageRepository });

      await useCase.handleLineage({ specimenId: '1' }, false);

      expect(calls).toEqual(['validate', 'record']);
    });

    it('throws forbidden in strict mode when lineageRepository validation fails', async () => {
      const lineageRepository = {
        validateBeforePersistence: vi.fn().mockRejectedValue(new Error('neo4j down')),
        recordCustodyEvent: vi.fn()
      };
      const useCase = new RegisterSample({ db, lineageRepository });

      await expect(useCase.handleLineage({ specimenId: '1' }, true)).rejects.toThrow(
        RegisterSampleForbiddenError
      );
      expect(lineageRepository.recordCustodyEvent).not.toHaveBeenCalled();
    });

    it('enqueues quarantine and does not throw in permissive mode when lineageRepository fails', async () => {
      const lineageRepository = {
        validateBeforePersistence: vi.fn().mockRejectedValue(new Error('neo4j down')),
        recordCustodyEvent: vi.fn()
      };
      const quarantineQueue = { enqueue: vi.fn().mockResolvedValue(undefined) };
      const useCase = new RegisterSample({ db, lineageRepository, quarantineQueue });

      await expect(useCase.handleLineage({ specimenId: '1' }, false)).resolves.toBeUndefined();

      expect(quarantineQueue.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({ specimenId: '1' }),
        expect.objectContaining({ reason: 'neo4j down' })
      );
    });

    it('falls back to a default quarantine reason when the rejection has no message', async () => {
      const lineageRepository = {
        validateBeforePersistence: vi.fn().mockRejectedValue({ code: 'ECONNRESET' }),
        recordCustodyEvent: vi.fn()
      };
      const quarantineQueue = { enqueue: vi.fn().mockResolvedValue(undefined) };
      const useCase = new RegisterSample({ db, lineageRepository, quarantineQueue });

      await expect(useCase.handleLineage({ specimenId: '1' }, false)).resolves.toBeUndefined();

      expect(quarantineQueue.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({ specimenId: '1' }),
        expect.objectContaining({ reason: 'neo4j_validation_failed' })
      );
    });
  });

  describe('enqueueQuarantine', () => {
    it('logs a warning and does not throw when no quarantineQueue is configured', async () => {
      const useCase = new RegisterSample({ db });
      await expect(useCase.enqueueQuarantine({ specimenId: '1' }, 'some_reason')).resolves.toBeUndefined();
    });

    it('logs a warning and does not throw when quarantineQueue lacks an enqueue function', async () => {
      const useCase = new RegisterSample({ db, quarantineQueue: {} });
      await expect(useCase.enqueueQuarantine({ specimenId: '1' }, 'some_reason')).resolves.toBeUndefined();
    });
  });

  describe('rollback on failure in strict mode', () => {
    it('rolls back via deleteOne on the samples collection using the created sample id', async () => {
      env.LINEAGE_MODE = 'fail-closed';
      const sampleId = new ObjectId();
      const createdSample = { _id: sampleId, barcode: 'BC-3' };
      vi.spyOn(sampleService, 'createSample').mockResolvedValue(createdSample);

      const consentsCollection = makeConsentsCollection({ _id: 'c1', status: 'ACTIVE' });
      const samplesCollection = makeSamplesCollection();
      const rollbackDb = makeDb({ patientConsents: consentsCollection, samples: samplesCollection });

      const useCase = new RegisterSample({ db: rollbackDb }); // no lineageRepository -> strict throws forbidden in handleLineage

      const command = {
        sampleData: { barcode: 'BC-3', participantId: 'P1' },
        options: {}
      };

      await expect(useCase.execute(command)).rejects.toThrow(RegisterSampleForbiddenError);

      expect(samplesCollection.deleteOne).toHaveBeenCalledWith(
        expect.objectContaining({ _id: expect.any(ObjectId) })
      );
    });

    // Issue #8: claimed that a non-lineage-matching error thrown from inside
    // handleLineage's repository calls would be re-thrown raw in strict mode,
    // after rollback, giving an inconsistent error shape. handleLineage's own
    // strict-mode catch (RegisterSample.js ~line 155) wraps *any* error
    // unconditionally, regardless of isLineageError -- so this should already
    // surface as a consistent RegisterSampleForbiddenError (403).
    it('normalizes a non-lineage-matching repository error to RegisterSampleForbiddenError in strict mode, after rollback', async () => {
      env.LINEAGE_MODE = 'fail-closed';
      const sampleId = new ObjectId();
      const createdSample = { _id: sampleId, barcode: 'BC-9' };
      vi.spyOn(sampleService, 'createSample').mockResolvedValue(createdSample);

      const consentsCollection = makeConsentsCollection({ _id: 'c1', status: 'ACTIVE' });
      const samplesCollection = makeSamplesCollection();
      const rollbackDb = makeDb({ patientConsents: consentsCollection, samples: samplesCollection });

      const lineageRepository = {
        validateBeforePersistence: vi.fn().mockRejectedValue(new Error('unexpected repository failure')),
        recordCustodyEvent: vi.fn()
      };
      const useCase = new RegisterSample({ db: rollbackDb, lineageRepository });

      const command = {
        sampleData: { barcode: 'BC-9', participantId: 'P1' },
        options: {}
      };

      await expect(useCase.execute(command)).rejects.toThrow(RegisterSampleForbiddenError);

      expect(samplesCollection.deleteOne).toHaveBeenCalledWith(
        expect.objectContaining({ _id: expect.any(ObjectId) })
      );
    });

    it('re-throws the raw error in strict mode when it is not a lineage error and no sample was created', async () => {
      env.LINEAGE_MODE = 'fail-closed';
      const consentsCollection = makeConsentsCollection({ _id: 'c1', status: 'ACTIVE' });
      const consentsDb = makeDb({ patientConsents: consentsCollection });
      const rawError = new Error('unrelated db write conflict');
      vi.spyOn(sampleService, 'createSample').mockRejectedValue(rawError);

      const useCase = new RegisterSample({ db: consentsDb });

      await expect(useCase.execute({ sampleData: { participantId: 'P1' } })).rejects.toThrow(
        'unrelated db write conflict'
      );
    });

    it('wraps a lineage-flavored error thrown before handleLineage as RegisterSampleForbiddenError in strict mode', async () => {
      env.LINEAGE_MODE = 'fail-closed';
      const consentsCollection = makeConsentsCollection({ _id: 'c1', status: 'ACTIVE' });
      const consentsDb = makeDb({ patientConsents: consentsCollection });
      const lineageError = new Error('neo4j connection refused');
      vi.spyOn(sampleService, 'createSample').mockRejectedValue(lineageError);

      const useCase = new RegisterSample({ db: consentsDb });

      await expect(useCase.execute({ sampleData: { participantId: 'P1' } })).rejects.toThrow(
        RegisterSampleForbiddenError
      );
    });

    it('logs and swallows an error from the rollback deleteOne call itself', async () => {
      env.LINEAGE_MODE = 'fail-closed';
      const sampleId = new ObjectId();
      const createdSample = { _id: sampleId, barcode: 'BC-5' };
      vi.spyOn(sampleService, 'createSample').mockResolvedValue(createdSample);

      const consentsCollection = makeConsentsCollection({ _id: 'c1', status: 'ACTIVE' });
      const samplesCollection = {
        deleteOne: vi.fn().mockRejectedValue(new Error('delete failed'))
      };
      const rollbackDb = makeDb({ patientConsents: consentsCollection, samples: samplesCollection });

      const useCase = new RegisterSample({ db: rollbackDb });

      await expect(
        useCase.execute({ sampleData: { barcode: 'BC-5', participantId: 'P1' }, options: {} })
      ).rejects.toThrow(RegisterSampleForbiddenError);

      expect(samplesCollection.deleteOne).toHaveBeenCalled();
    });

    it('logs the swallowed rollback error verbatim when it has no message', async () => {
      const samplesCollection = { deleteOne: vi.fn().mockRejectedValue('plain string failure') };
      const rollbackDb = makeDb({ samples: samplesCollection });
      const useCase = new RegisterSample({ db: rollbackDb });

      await expect(useCase.rollbackMongoSample(String(new ObjectId()))).resolves.toBeUndefined();
      expect(samplesCollection.deleteOne).toHaveBeenCalled();
    });

    it('rolls back using the raw specimenId as filter when it is not a valid ObjectId', async () => {
      const samplesCollection = { deleteOne: vi.fn().mockResolvedValue({ deletedCount: 1 }) };
      const rollbackDb = makeDb({ samples: samplesCollection });
      const useCase = new RegisterSample({ db: rollbackDb });

      await useCase.rollbackMongoSample('not-a-valid-object-id');

      expect(samplesCollection.deleteOne).toHaveBeenCalledWith({ _id: 'not-a-valid-object-id' });
    });
  });

  describe('tryObjectId', () => {
    it('returns null when ObjectId construction throws despite isValid reporting true', () => {
      const useCase = new RegisterSample({ db });
      const isValidSpy = vi.spyOn(ObjectId, 'isValid').mockReturnValue(true);

      expect(useCase.tryObjectId('not-actually-a-valid-hex-id')).toBeNull();

      isValidSpy.mockRestore();
    });
  });

  describe('isLineageError', () => {
    const useCase = new RegisterSample({ db: {} });

    it.each([
      ['neo4j timeout', true],
      ['lineage repository unavailable', true],
      ['consentimento inválido', true],
      ['falha topológica', true],
      ['falha topologica', true],
      ['generic unrelated failure', false]
    ])('classifies "%s" as lineage error = %s', (message, expected) => {
      expect(useCase.isLineageError(new Error(message))).toBe(expected);
    });

    it('treats a missing error/message as not a lineage error', () => {
      expect(useCase.isLineageError(undefined)).toBe(false);
    });
  });
});
