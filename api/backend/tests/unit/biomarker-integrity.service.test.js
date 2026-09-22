import { describe, it, expect, vi, afterEach } from 'vitest';
const crypto = require('crypto');
const { ObjectId } = require('mongodb');

const biomarkerIntegrityService = require('../../src/services/biomarker-integrity.service');
const integrityCheckService = require('../../src/services/integrityCheckService');
const merkleTree = require('../../src/utils/merkleTree');

function sha256Hex(input) {
  return crypto.createHash('sha256').update(String(input)).digest('hex');
}

function makeCollection({ findOneImpl = async () => null, insertOneImpl = async () => ({ insertedId: 'new-id' }), findDocs = [] } = {}) {
  return {
    createIndex: vi.fn(async () => ({})),
    insertOne: vi.fn(insertOneImpl),
    findOne: vi.fn(findOneImpl),
    find: vi.fn(() => ({
      sort: vi.fn().mockReturnThis(),
      toArray: vi.fn(async () => findDocs)
    }))
  };
}

function makeDb({ findOneImpl, insertOneImpl, findDocs } = {}) {
  const col = makeCollection({ findOneImpl, insertOneImpl, findDocs });
  const db = {
    collection: vi.fn(() => col)
  };
  return { db, col };
}

describe('biomarker-integrity.service', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('computeBiomarkerHash', () => {
    it('produces the expected sha256 hash of participantId|value|isoTimestamp', () => {
      const timestamp = '2026-07-01T10:00:00.000Z';
      const hash = biomarkerIntegrityService.computeBiomarkerHash({
        participantId: 'p1',
        value: 5,
        timestamp
      });
      const expected = sha256Hex(`p1|5|${new Date(timestamp).toISOString()}`);
      expect(hash).toBe(expected);
    });

    it('trims participantId and normalizes it as part of the payload', () => {
      const timestamp = '2026-07-01T10:00:00.000Z';
      const hash = biomarkerIntegrityService.computeBiomarkerHash({
        participantId: '  p1  ',
        value: 5,
        timestamp
      });
      const expected = sha256Hex(`p1|5|${new Date(timestamp).toISOString()}`);
      expect(hash).toBe(expected);
    });

    it('throws when participantId is missing', () => {
      expect(() =>
        biomarkerIntegrityService.computeBiomarkerHash({ value: 5, timestamp: '2026-07-01T10:00:00.000Z' })
      ).toThrow('participantId é obrigatório para integridade de biomarcador');
    });

    it('throws when participantId is blank/whitespace only', () => {
      expect(() =>
        biomarkerIntegrityService.computeBiomarkerHash({ participantId: '   ', value: 5, timestamp: '2026-07-01T10:00:00.000Z' })
      ).toThrow('participantId é obrigatório para integridade de biomarcador');
    });

    it('throws when timestamp is invalid', () => {
      expect(() =>
        biomarkerIntegrityService.computeBiomarkerHash({ participantId: 'p1', value: 5, timestamp: 'not-a-date' })
      ).toThrow('timestamp inválido para integridade de biomarcador');
    });

    it('throws when value is non-finite (NaN)', () => {
      expect(() =>
        biomarkerIntegrityService.computeBiomarkerHash({ participantId: 'p1', value: 'abc', timestamp: '2026-07-01T10:00:00.000Z' })
      ).toThrow('valor de biomarcador inválido');
    });

    it('throws when value is Infinity', () => {
      expect(() =>
        biomarkerIntegrityService.computeBiomarkerHash({ participantId: 'p1', value: Infinity, timestamp: '2026-07-01T10:00:00.000Z' })
      ).toThrow('valor de biomarcador inválido');
    });

    it('accepts a Date instance for timestamp directly', () => {
      const d = new Date('2026-07-01T10:00:00.000Z');
      const hash = biomarkerIntegrityService.computeBiomarkerHash({ participantId: 'p1', value: 5, timestamp: d });
      const expected = sha256Hex(`p1|5|${d.toISOString()}`);
      expect(hash).toBe(expected);
    });
  });

  describe('ensureIndexes', () => {
    it('creates the three expected indexes on the biomarker_integrity collection', async () => {
      const { db, col } = makeDb();

      await biomarkerIntegrityService.ensureIndexes(db);

      expect(db.collection).toHaveBeenCalledWith('biomarker_integrity');
      expect(col.createIndex).toHaveBeenCalledTimes(3);
      expect(col.createIndex).toHaveBeenCalledWith(
        { participantId: 1, biomarkerType: 1, timestamp: -1 },
        { name: 'biomarker_integrity_patient_type_ts_idx_v1' }
      );
      expect(col.createIndex).toHaveBeenCalledWith(
        { day: 1, timestamp: 1 },
        { name: 'biomarker_integrity_day_ts_idx_v1' }
      );
      expect(col.createIndex).toHaveBeenCalledWith(
        { integrityHash: 1 },
        { name: 'biomarker_integrity_hash_idx_v1' }
      );
    });

    it('does not throw when one of the index creations rejects (Promise.allSettled)', async () => {
      const col = makeCollection();
      col.createIndex = vi.fn()
        .mockResolvedValueOnce({})
        .mockRejectedValueOnce(new Error('index conflict'))
        .mockResolvedValueOnce({});
      const db = { collection: vi.fn(() => col) };

      await expect(biomarkerIntegrityService.ensureIndexes(db)).resolves.toBeUndefined();
    });
  });

  describe('appendBiomarkerHash', () => {
    it('throws when db is missing', async () => {
      await expect(biomarkerIntegrityService.appendBiomarkerHash(null, { participantId: 'p1', biomarkerType: 'glucose', value: 5 }))
        .rejects.toThrow('Banco de dados não disponível');
    });

    it('throws when participantId is missing', async () => {
      const { db } = makeDb();
      await expect(biomarkerIntegrityService.appendBiomarkerHash(db, { biomarkerType: 'glucose', value: 5 }))
        .rejects.toThrow('participantId e biomarkerType são obrigatórios');
    });

    it('throws when biomarkerType is missing', async () => {
      const { db } = makeDb();
      await expect(biomarkerIntegrityService.appendBiomarkerHash(db, { participantId: 'p1', value: 5 }))
        .rejects.toThrow('participantId e biomarkerType são obrigatórios');
    });

    it('throws when value is non-finite', async () => {
      const { db } = makeDb();
      await expect(biomarkerIntegrityService.appendBiomarkerHash(db, { participantId: 'p1', biomarkerType: 'glucose', value: 'xx' }))
        .rejects.toThrow('valor de biomarcador inválido');
    });

    it('throws when timestamp is invalid', async () => {
      const { db } = makeDb();
      await expect(biomarkerIntegrityService.appendBiomarkerHash(db, { participantId: 'p1', biomarkerType: 'glucose', value: 5, timestamp: 'bogus' }))
        .rejects.toThrow('timestamp inválido para integridade de biomarcador');
    });

    it('builds and inserts a document with day sliced from ISO timestamp, then returns _id + document', async () => {
      const { db, col } = makeDb();
      const timestamp = '2026-07-01T10:00:00.000Z';

      const result = await biomarkerIntegrityService.appendBiomarkerHash(db, {
        participantId: 'p1',
        biomarkerType: 'glucose',
        value: 5,
        timestamp,
        source: 'lab_x',
        eventType: 'create'
      });

      expect(col.createIndex).toHaveBeenCalledTimes(3);
      expect(col.insertOne).toHaveBeenCalledTimes(1);
      const insertedDoc = col.insertOne.mock.calls[0][0];
      expect(insertedDoc.day).toBe('2026-07-01');
      expect(insertedDoc.participantId).toBe('p1');
      expect(insertedDoc.biomarkerType).toBe('glucose');
      expect(insertedDoc.value).toBe(5);
      expect(insertedDoc.source).toBe('lab_x');
      expect(insertedDoc.eventType).toBe('create');
      expect(insertedDoc.algorithm).toBe('sha256');
      expect(insertedDoc.integrityHash).toBe(
        biomarkerIntegrityService.computeBiomarkerHash({ participantId: 'p1', value: 5, timestamp })
      );
      expect(result._id).toBe('new-id');
      expect(result.participantId).toBe('p1');
      expect(result.integrityHash).toBe(insertedDoc.integrityHash);
    });

    it('defaults source and eventType when not provided', async () => {
      const { db, col } = makeDb();

      await biomarkerIntegrityService.appendBiomarkerHash(db, {
        participantId: 'p1',
        biomarkerType: 'glucose',
        value: 5,
        timestamp: '2026-07-01T10:00:00.000Z'
      });

      const insertedDoc = col.insertOne.mock.calls[0][0];
      expect(insertedDoc.source).toBe('patient_biomarkers');
      expect(insertedDoc.eventType).toBe('update');
    });
  });

  describe('getBiomarkerHashesForDate', () => {
    it('throws when db is missing', async () => {
      await expect(biomarkerIntegrityService.getBiomarkerHashesForDate(null, '2026-07-01'))
        .rejects.toThrow('Banco de dados não disponível');
    });

    it('throws when date is missing', async () => {
      const { db } = makeDb();
      await expect(biomarkerIntegrityService.getBiomarkerHashesForDate(db, ''))
        .rejects.toThrow('Data é obrigatória');
    });

    it('throws on an invalid date format', async () => {
      const { db } = makeDb();
      await expect(biomarkerIntegrityService.getBiomarkerHashesForDate(db, 'not-a-date'))
        .rejects.toThrow('Formato de data inválido. Esperado YYYY-MM-DD');
    });

    it('queries with the correct $or date-range filter and sort, returning the docs', async () => {
      const docs = [{ _id: '1' }, { _id: '2' }];
      const { db, col } = makeDb({ findDocs: docs });

      const result = await biomarkerIntegrityService.getBiomarkerHashesForDate(db, '2026-07-01');

      expect(result).toBe(docs);
      const findCall = col.find.mock.calls[0][0];
      expect(findCall.$or).toEqual([
        { day: '2026-07-01' },
        { timestamp: { $gte: new Date('2026-07-01T00:00:00.000Z'), $lte: new Date('2026-07-01T23:59:59.999Z') } }
      ]);
      const sortMock = col.find.mock.results[0].value.sort;
      expect(sortMock).toHaveBeenCalledWith({ timestamp: 1, _id: 1 });
    });
  });

  describe('verifyBiomarkerById', () => {
    it('throws when db is missing', async () => {
      await expect(biomarkerIntegrityService.verifyBiomarkerById(null, '507f1f77bcf86cd799439011'))
        .rejects.toThrow('Banco de dados não disponível');
    });

    it('throws a 400 error for an invalid ObjectId', async () => {
      const { db } = makeDb();
      await expect(biomarkerIntegrityService.verifyBiomarkerById(db, 'not-an-object-id'))
        .rejects.toMatchObject({ statusCode: 400, message: 'ID de integridade de biomarcador inválido' });
    });

    it('throws a 404 error when the document is not found', async () => {
      const { db } = makeDb({ findOneImpl: async () => null });
      const validId = new ObjectId().toString();

      await expect(biomarkerIntegrityService.verifyBiomarkerById(db, validId))
        .rejects.toMatchObject({ statusCode: 404, message: 'Registro de integridade de biomarcador não encontrado' });
    });

    it('detects tampering: contentUntampered is false when the stored hash does not match the recalculated one', async () => {
      const validId = new ObjectId();
      const timestamp = '2026-07-01T10:00:00.000Z';
      const storedDoc = {
        _id: validId,
        participantId: 'p1',
        biomarkerType: 'glucose',
        value: 5,
        timestamp,
        day: '2026-07-01',
        integrityHash: 'tampered-hash-value'
      };
      const { db } = makeDb({ findOneImpl: async () => storedDoc });

      const fakeMerkleResult = {
        root: 'merkle-root',
        leaves: ['tampered-hash-value'],
        getProofForHash: vi.fn(() => ['proof-step'])
      };
      vi.spyOn(integrityCheckService, 'buildMerkleForDate').mockResolvedValue(fakeMerkleResult);
      vi.spyOn(merkleTree, 'verifyProof').mockReturnValue(true);

      const result = await biomarkerIntegrityService.verifyBiomarkerById(db, validId.toString());

      expect(result.contentUntampered).toBe(false);
      expect(result.verified).toBe(false);
    });

    it('returns a full verified=true result on a valid round trip with matching hash and valid proof', async () => {
      const validId = new ObjectId();
      const timestamp = '2026-07-01T10:00:00.000Z';
      const integrityHash = biomarkerIntegrityService.computeBiomarkerHash({ participantId: 'p1', value: 5, timestamp });
      const storedDoc = {
        _id: validId,
        participantId: 'p1',
        biomarkerType: 'glucose',
        value: 5,
        timestamp,
        day: '2026-07-01',
        integrityHash
      };
      const { db } = makeDb({ findOneImpl: async () => storedDoc });

      const fakeMerkleResult = {
        root: 'merkle-root',
        leaves: [integrityHash, 'other-hash'],
        getProofForHash: vi.fn(() => ['proof-step'])
      };
      const merkleSpy = vi.spyOn(integrityCheckService, 'buildMerkleForDate').mockResolvedValue(fakeMerkleResult);
      const verifySpy = vi.spyOn(merkleTree, 'verifyProof').mockReturnValue(true);

      const result = await biomarkerIntegrityService.verifyBiomarkerById(db, validId.toString());

      expect(merkleSpy).toHaveBeenCalledWith('2026-07-01', db);
      expect(fakeMerkleResult.getProofForHash).toHaveBeenCalledWith(integrityHash);
      expect(verifySpy).toHaveBeenCalledWith(integrityHash, ['proof-step'], 'merkle-root');
      expect(result).toMatchObject({
        biomarkerIntegrityId: validId.toString(),
        participantId: 'p1',
        biomarkerType: 'glucose',
        day: '2026-07-01',
        integrityHash,
        recalculatedHash: integrityHash,
        contentUntampered: true,
        merkleRoot: 'merkle-root',
        leafCount: 2,
        proof: ['proof-step'],
        proofValid: true,
        verified: true
      });
    });

    it('returns verified=false when contentUntampered is true but proofValid is false', async () => {
      const validId = new ObjectId();
      const timestamp = '2026-07-01T10:00:00.000Z';
      const integrityHash = biomarkerIntegrityService.computeBiomarkerHash({ participantId: 'p1', value: 5, timestamp });
      const storedDoc = {
        _id: validId,
        participantId: 'p1',
        biomarkerType: 'glucose',
        value: 5,
        timestamp,
        day: '2026-07-01',
        integrityHash
      };
      const { db } = makeDb({ findOneImpl: async () => storedDoc });

      const fakeMerkleResult = {
        root: 'merkle-root',
        leaves: [integrityHash],
        getProofForHash: vi.fn(() => ['proof-step'])
      };
      vi.spyOn(integrityCheckService, 'buildMerkleForDate').mockResolvedValue(fakeMerkleResult);
      vi.spyOn(merkleTree, 'verifyProof').mockReturnValue(false);

      const result = await biomarkerIntegrityService.verifyBiomarkerById(db, validId.toString());

      expect(result.contentUntampered).toBe(true);
      expect(result.proofValid).toBe(false);
      expect(result.verified).toBe(false);
    });

    it('falls back to deriving day from timestamp when doc.day is absent', async () => {
      const validId = new ObjectId();
      const timestamp = '2026-07-01T10:00:00.000Z';
      const integrityHash = biomarkerIntegrityService.computeBiomarkerHash({ participantId: 'p1', value: 5, timestamp });
      const storedDoc = {
        _id: validId,
        participantId: 'p1',
        biomarkerType: 'glucose',
        value: 5,
        timestamp,
        integrityHash
        // no `day` field
      };
      const { db } = makeDb({ findOneImpl: async () => storedDoc });

      const fakeMerkleResult = {
        root: 'merkle-root',
        leaves: [integrityHash],
        getProofForHash: vi.fn(() => [])
      };
      const merkleSpy = vi.spyOn(integrityCheckService, 'buildMerkleForDate').mockResolvedValue(fakeMerkleResult);
      vi.spyOn(merkleTree, 'verifyProof').mockReturnValue(true);

      const result = await biomarkerIntegrityService.verifyBiomarkerById(db, validId.toString());

      expect(result.day).toBe('2026-07-01');
      expect(merkleSpy).toHaveBeenCalledWith('2026-07-01', db);
    });
  });
});
