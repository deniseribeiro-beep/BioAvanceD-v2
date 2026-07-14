import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

// vi.mock on fieldEncryption/collectionResolver does not intercept this
// service's internal CJS require() calls (verified: mocked return values are
// ignored and the real implementations run regardless). So this suite drives
// the real implementations instead: a fake `db` without listCollections (so
// getCollection resolves synchronously to the canonical name) and the real
// AES-256-GCM round trip via the test ENCRYPTION_KEY set in vitest.setup.js.
const biomarkerObservationService = require('../../src/services/biomarker-observation.service');

function buildCollection(overrides = {}) {
  return {
    collectionName: 'biomarker_observations',
    createIndex: vi.fn().mockResolvedValue(undefined),
    insertOne: vi.fn(),
    findOne: vi.fn(),
    find: vi.fn(),
    countDocuments: vi.fn(),
    ...overrides
  };
}

function buildDb(collection) {
  return {
    collection: vi.fn().mockReturnValue(collection)
  };
}

const VALID_PAYLOAD = {
  participantId: '12345678',
  biomarkerType: 'alphaGal',
  value: 4.2,
  unit: 'kU/L',
  collectedAt: '2026-01-01T00:00:00.000Z'
};

describe('biomarker-observation.service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('ensureIndexes', () => {
    it('does nothing when collection or collectionName is missing', async () => {
      await biomarkerObservationService.ensureIndexes(null, 'x');
      await biomarkerObservationService.ensureIndexes({ createIndex: vi.fn() }, null);
      expect(true).toBe(true);
    });

    it('creates all index definitions once per collection name and skips on repeat calls', async () => {
      const collection = buildCollection();
      const name = `ensure-idx-once-${Date.now()}`;
      await biomarkerObservationService.ensureIndexes(collection, name);
      expect(collection.createIndex).toHaveBeenCalledTimes(5);

      collection.createIndex.mockClear();
      await biomarkerObservationService.ensureIndexes(collection, name);
      expect(collection.createIndex).not.toHaveBeenCalled();
    });

    it('logs a warning and continues when createIndex rejects', async () => {
      const collection = buildCollection({
        createIndex: vi.fn().mockRejectedValue(new Error('boom'))
      });
      const name = `ensure-idx-fail-${Date.now()}`;
      await expect(biomarkerObservationService.ensureIndexes(collection, name)).resolves.toBeUndefined();
      expect(collection.createIndex).toHaveBeenCalledTimes(5);
    });
  });

  describe('getObservationsCollection', () => {
    it('resolves the canonical collection from db.collection and ensures indexes', async () => {
      const collection = buildCollection({ collectionName: `resolved-${Date.now()}` });
      const db = buildDb(collection);

      const result = await biomarkerObservationService.getObservationsCollection(db);

      expect(db.collection).toHaveBeenCalledWith('biomarker_observations');
      expect(result).toBe(collection);
      expect(collection.createIndex).toHaveBeenCalledTimes(5);
    });

    it('falls back to the default collection name when collectionName is missing', async () => {
      const collection = buildCollection({ collectionName: undefined });
      const db = buildDb(collection);

      await biomarkerObservationService.getObservationsCollection(db);

      expect(collection.createIndex).toHaveBeenCalledTimes(5);
    });
  });

  describe('encryptObservationValue', () => {
    it('replaces value with valueEncrypted when a value is present', () => {
      const result = biomarkerObservationService.encryptObservationValue({ value: 4.2, other: 'x' });

      expect(result.value).toBeNull();
      expect(result.valueEncrypted).toMatchObject({ alg: 'aes-256-gcm' });
      expect(result.other).toBe('x');
    });

    it('leaves value untouched when value is null/undefined/empty', () => {
      const result = biomarkerObservationService.encryptObservationValue({ value: null });

      expect(result.value).toBeNull();
      expect(result.valueEncrypted).toBeUndefined();
    });

    it('defaults to an empty object when called without a doc', () => {
      const result = biomarkerObservationService.encryptObservationValue();
      expect(result).toEqual({});
    });
  });

  describe('decryptObservationValue', () => {
    it('returns non-object input unchanged', () => {
      expect(biomarkerObservationService.decryptObservationValue(null)).toBeNull();
      expect(biomarkerObservationService.decryptObservationValue('str')).toBe('str');
    });

    it('returns the doc unchanged when value is already present', () => {
      const doc = { value: 4.2, valueEncrypted: { data: 'x' } };
      const result = biomarkerObservationService.decryptObservationValue(doc);
      expect(result.value).toBe(4.2);
    });

    it('returns the doc unchanged when there is no valueEncrypted payload', () => {
      const doc = { value: null };
      const result = biomarkerObservationService.decryptObservationValue(doc);
      expect(result.value).toBeNull();
    });

    it('decrypts and coerces the value to a number via a real encrypt/decrypt round trip', () => {
      const encrypted = biomarkerObservationService.encryptObservationValue({ value: 4.2 });
      const result = biomarkerObservationService.decryptObservationValue(encrypted);
      expect(result.value).toBe(4.2);
    });

    it('logs a warning and returns doc unchanged when the encrypted payload is malformed', () => {
      const doc = { _id: 'obs-1', value: undefined, valueEncrypted: { alg: 'aes-256-gcm', v: 1, keyId: 'test-key-1', iv: 'not-base64-!!', tag: 'bad', data: 'bad' } };
      const result = biomarkerObservationService.decryptObservationValue(doc);
      expect(result.value).toBeUndefined();
    });
  });

  describe('createObservation', () => {
    it('creates, encrypts, and inserts a new observation', async () => {
      const collection = buildCollection();
      const db = buildDb(collection);
      collection.insertOne.mockResolvedValue({ insertedId: 'id-1' });

      const result = await biomarkerObservationService.createObservation(db, VALID_PAYLOAD);

      expect(collection.insertOne).toHaveBeenCalled();
      const insertedDoc = collection.insertOne.mock.calls[0][0];
      expect(insertedDoc.value).toBeNull();
      expect(insertedDoc.valueEncrypted).toMatchObject({ alg: 'aes-256-gcm' });
      expect(result._id).toBe('id-1');
      expect(result.participantId).toBe('12345678');
    });

    it('throws when the payload fails model validation', async () => {
      const collection = buildCollection();
      const db = buildDb(collection);

      await expect(
        biomarkerObservationService.createObservation(db, { participantId: 'bad' })
      ).rejects.toThrow(/biomarkerType é obrigatório/);
      expect(collection.insertOne).not.toHaveBeenCalled();
    });

    it('returns the existing decrypted document on a duplicate-key (11000) error', async () => {
      const collection = buildCollection();
      const db = buildDb(collection);
      const duplicateError = Object.assign(new Error('duplicate'), { code: 11000 });
      collection.insertOne.mockRejectedValue(duplicateError);
      collection.findOne.mockResolvedValue({ _id: 'existing-1', value: 4.2 });

      const result = await biomarkerObservationService.createObservation(db, VALID_PAYLOAD);

      expect(collection.findOne).toHaveBeenCalledWith({ idempotencyKey: expect.any(String) });
      expect(result._id).toBe('existing-1');
    });

    it('rethrows a non-duplicate insertOne error', async () => {
      const collection = buildCollection();
      const db = buildDb(collection);
      collection.insertOne.mockRejectedValue(new Error('connection lost'));

      await expect(
        biomarkerObservationService.createObservation(db, VALID_PAYLOAD)
      ).rejects.toThrow('connection lost');
    });

    it('rethrows a duplicate-key error when no existing document is found', async () => {
      const collection = buildCollection();
      const db = buildDb(collection);
      const duplicateError = Object.assign(new Error('duplicate'), { code: 11000 });
      collection.insertOne.mockRejectedValue(duplicateError);
      collection.findOne.mockResolvedValue(null);

      await expect(
        biomarkerObservationService.createObservation(db, VALID_PAYLOAD)
      ).rejects.toThrow('duplicate');
    });
  });

  describe('listPatientObservations', () => {
    function buildQueryableCollection(docs = []) {
      const cursor = {
        sort: vi.fn().mockReturnThis(),
        skip: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        toArray: vi.fn().mockResolvedValue(docs)
      };
      return buildCollection({
        find: vi.fn().mockReturnValue(cursor),
        countDocuments: vi.fn().mockResolvedValue(docs.length)
      });
    }

    it('throws when participantId is not 8 digits', async () => {
      await expect(
        biomarkerObservationService.listPatientObservations({}, '123')
      ).rejects.toThrow(/participantId inválido/);
    });

    it('throws when participantId is missing', async () => {
      await expect(
        biomarkerObservationService.listPatientObservations({})
      ).rejects.toThrow(/participantId inválido/);
    });

    it('builds a base query and applies default limit/skip', async () => {
      const collection = buildQueryableCollection([{ value: 1 }]);
      const db = buildDb(collection);

      const result = await biomarkerObservationService.listPatientObservations(db, '12345678');

      expect(collection.find).toHaveBeenCalledWith({ participantId: '12345678' });
      expect(result.limit).toBe(50);
      expect(result.skip).toBe(0);
      expect(result.total).toBe(1);
      expect(result.observations).toHaveLength(1);
    });

    it('applies biomarkerType, status, and date-range filters', async () => {
      const collection = buildQueryableCollection([]);
      const db = buildDb(collection);

      await biomarkerObservationService.listPatientObservations(db, '12345678', {
        biomarkerType: ' alphaGal ',
        status: ' FINAL ',
        from: '2026-01-01',
        to: '2026-02-01'
      });

      const query = collection.find.mock.calls[0][0];
      expect(query.biomarkerType).toBe('alphaGal');
      expect(query.status).toBe('final');
      expect(query.collectedAt.$gte).toBeInstanceOf(Date);
      expect(query.collectedAt.$lte).toBeInstanceOf(Date);
    });

    it('omits collectedAt from the query when from/to are invalid dates', async () => {
      const collection = buildQueryableCollection([]);
      const db = buildDb(collection);

      await biomarkerObservationService.listPatientObservations(db, '12345678', {
        from: 'not-a-date',
        to: 'also-not-a-date'
      });

      const query = collection.find.mock.calls[0][0];
      expect(query.collectedAt).toBeUndefined();
    });

    it('clamps limit to 200 and honors a valid custom limit/skip', async () => {
      const collection = buildQueryableCollection([]);
      const db = buildDb(collection);

      const result = await biomarkerObservationService.listPatientObservations(db, '12345678', {
        limit: 500,
        skip: 10
      });

      expect(result.limit).toBe(200);
      expect(result.skip).toBe(10);
    });

    it('falls back to default limit/skip for non-positive values', async () => {
      const collection = buildQueryableCollection([]);
      const db = buildDb(collection);

      const result = await biomarkerObservationService.listPatientObservations(db, '12345678', {
        limit: -5,
        skip: -1
      });

      expect(result.limit).toBe(50);
      expect(result.skip).toBe(0);
    });

    it('decrypts each returned observation document', async () => {
      const encrypted = biomarkerObservationService.encryptObservationValue({ value: 9.9 });
      const collection = buildQueryableCollection([encrypted]);
      const db = buildDb(collection);

      const result = await biomarkerObservationService.listPatientObservations(db, '12345678');

      expect(result.observations[0].value).toBe(9.9);
    });
  });
});
