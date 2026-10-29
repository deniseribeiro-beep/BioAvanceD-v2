import { describe, it, expect, vi, afterEach } from 'vitest';
const crypto = require('crypto');
const fs = require('fs');

const hl7AuditService = require('../../src/services/hl7Audit.service');
const integrityCheckService = require('../../src/services/integrityCheckService');
const logger = require('../../src/utils/logger');
const objectStorage = require('../../src/infrastructure/objectStorage');

function sha256Hex(input) {
  return crypto.createHash('sha256').update(String(input)).digest('hex');
}

function makeCollection({ findDocs = [], findOneImpl = async () => null, insertOneImpl = async () => ({}) } = {}) {
  return {
    find: vi.fn(() => ({ toArray: vi.fn(async () => findDocs) })),
    findOne: vi.fn(findOneImpl),
    insertOne: vi.fn(insertOneImpl)
  };
}

function makeDb({ samples = [], sampleFiles = [], findOneImpl, insertOneImpl } = {}) {
  const samplesCol = makeCollection({ findDocs: samples });
  const filesCol = makeCollection({ findDocs: sampleFiles });
  const logsCol = makeCollection({ findOneImpl, insertOneImpl });

  const db = {
    collection: vi.fn((name) => {
      if (name === 'samples') return samplesCol;
      if (name === 'sample_files') return filesCol;
      if (name === 'logs') return logsCol;
      throw new Error('unexpected collection: ' + name);
    })
  };

  return { db, samplesCol, filesCol, logsCol };
}

describe('hl7Audit.service', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('buildHL7HashesForDate - FHIR sample hashing', () => {
    it('hashes FHIR resources and inserts a log with the correct sha256 hash', async () => {
      const fhirPayload = { resourceType: 'Observation', id: 'obs-1' };
      const doc = { _id: 'sample-1', fhir: fhirPayload };
      const { db, logsCol } = makeDb({ samples: [doc], sampleFiles: [] });

      const result = await hl7AuditService.buildHL7HashesForDate('2026-07-01', db);

      const expectedHash = sha256Hex(JSON.stringify(fhirPayload));

      expect(result.fhir).toHaveLength(1);
      expect(result.fhir[0]).toMatchObject({ type: 'fhir', sampleId: 'sample-1', hash: expectedHash });
      expect(result.hl7).toEqual([]);
      expect(logsCol.insertOne).toHaveBeenCalledTimes(1);
      expect(result.inserted).toHaveLength(1);
      expect(result.inserted[0]).toMatchObject({
        date: '2026-07-01',
        action: 'HL7_HASH',
        entity: 'HL7Audit',
        message: 'Hash fhir',
        payload: { type: 'fhir', sourceId: 'sample-1' },
        auditHash: expectedHash
      });
    });

    it('queries samples with the correct fhir-exists and date-range filter', async () => {
      const { db, samplesCol } = makeDb({ samples: [], sampleFiles: [] });

      await hl7AuditService.buildHL7HashesForDate('2026-07-01', db);

      expect(samplesCol.find).toHaveBeenCalledTimes(1);
      const filter = samplesCol.find.mock.calls[0][0];
      expect(filter.fhir).toEqual({ $exists: true });
      expect(filter.createdAt.$gte.toISOString()).toBe('2026-07-01T00:00:00.000Z');
      expect(filter.createdAt.$lte.toISOString()).toBe('2026-07-01T23:59:59.999Z');
    });

    it('returns empty fhir/hl7/inserted arrays when nothing matches the date', async () => {
      const { db, logsCol } = makeDb({ samples: [], sampleFiles: [] });

      const result = await hl7AuditService.buildHL7HashesForDate('2026-07-01', db);

      expect(result).toEqual({ fhir: [], hl7: [], inserted: [] });
      expect(logsCol.insertOne).not.toHaveBeenCalled();
    });

    it('logs the error and excludes the item when hashing a FHIR resource throws', async () => {
      const circular = {};
      circular.self = circular;
      const doc = { _id: 'sample-bad', fhir: circular };
      const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});
      const { db } = makeDb({ samples: [doc], sampleFiles: [] });

      const result = await hl7AuditService.buildHL7HashesForDate('2026-07-01', db);

      expect(result.fhir).toEqual([]);
      expect(errorSpy).toHaveBeenCalledWith('Erro ao gerar hash FHIR da amostra:', expect.any(String));
    });

    it('falls back to the raw thrown value when a FHIR hashing error has no .message', async () => {
      const doc = { _id: 'sample-bad2', fhir: { a: 1 } };
      const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});
      vi.spyOn(JSON, 'stringify').mockImplementation(() => { throw 'plain string failure'; });

      const { db } = makeDb({ samples: [doc], sampleFiles: [] });

      const result = await hl7AuditService.buildHL7HashesForDate('2026-07-01', db);

      expect(result.fhir).toEqual([]);
      expect(errorSpy).toHaveBeenCalledWith('Erro ao gerar hash FHIR da amostra:', 'plain string failure');
    });
  });

  describe('buildHL7HashesForDate - HL7 file hashing', () => {
    it('hashes real file content from disk when storagePath exists', async () => {
      const fileDoc = { _id: 'file-1', storagePath: 'C:/fake/path/report.hl7', fileName: 'report.hl7', fileSize: 42 };
      const fileContent = 'MSH|^~\\&|SENDER|...';
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'readFileSync').mockReturnValue(fileContent);

      const { db } = makeDb({ samples: [], sampleFiles: [fileDoc] });

      const result = await hl7AuditService.buildHL7HashesForDate('2026-07-01', db);

      const expectedHash = sha256Hex(fileContent);
      expect(result.hl7).toHaveLength(1);
      expect(result.hl7[0]).toMatchObject({ type: 'hl7', fileId: 'file-1', hash: expectedHash });
      expect(result.hl7[0].note).toBeUndefined();
      expect(fs.existsSync).toHaveBeenCalledWith('C:/fake/path/report.hl7');
      expect(fs.readFileSync).toHaveBeenCalledWith('C:/fake/path/report.hl7', 'utf8');
    });

    it('falls back to fileName|fileSize hashing when storagePath does not exist on disk', async () => {
      const fileDoc = { _id: 'file-2', storagePath: 'C:/missing/report.hl7', fileName: 'report.hl7', fileSize: 100 };
      vi.spyOn(fs, 'existsSync').mockReturnValue(false);
      const readSpy = vi.spyOn(fs, 'readFileSync');

      const { db } = makeDb({ samples: [], sampleFiles: [fileDoc] });

      const result = await hl7AuditService.buildHL7HashesForDate('2026-07-01', db);

      const expectedHash = sha256Hex('report.hl7|100');
      expect(result.hl7).toHaveLength(1);
      expect(result.hl7[0]).toMatchObject({ type: 'hl7', fileId: 'file-2', hash: expectedHash, note: 'arquivo não encontrado em disco' });
      expect(readSpy).not.toHaveBeenCalled();
    });

    it('falls back to fileName|0 hashing when storagePath is absent and fileSize is missing', async () => {
      const fileDoc = { _id: 'file-3', fileName: 'noPath.hl7' };
      const existsSpy = vi.spyOn(fs, 'existsSync');

      const { db } = makeDb({ samples: [], sampleFiles: [fileDoc] });

      const result = await hl7AuditService.buildHL7HashesForDate('2026-07-01', db);

      const expectedHash = sha256Hex('noPath.hl7|0');
      expect(result.hl7[0]).toMatchObject({ hash: expectedHash, note: 'arquivo não encontrado em disco' });
      // storagePath is falsy so fs.existsSync must be short-circuited and never called
      expect(existsSpy).not.toHaveBeenCalled();
    });

    it('logs the error and excludes the item when reading a storagePath file from disk throws', async () => {
      const fileDoc = { _id: 'file-bad', storagePath: 'C:/fake/path/report.hl7', fileName: 'report.hl7', fileSize: 42 };
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'readFileSync').mockImplementation(() => { throw new Error('disk read failed'); });
      const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});

      const { db } = makeDb({ samples: [], sampleFiles: [fileDoc] });

      const result = await hl7AuditService.buildHL7HashesForDate('2026-07-01', db);

      expect(result.hl7).toEqual([]);
      expect(errorSpy).toHaveBeenCalledWith('Erro ao gerar hash do arquivo HL7:', 'disk read failed');
    });

    it('falls back to the raw thrown value when an HL7 file read error has no .message', async () => {
      const fileDoc = { _id: 'file-bad2', storagePath: 'C:/fake/path/report2.hl7', fileName: 'report2.hl7', fileSize: 42 };
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'readFileSync').mockImplementation(() => { throw 'plain string disk failure'; });
      const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});

      const { db } = makeDb({ samples: [], sampleFiles: [fileDoc] });

      const result = await hl7AuditService.buildHL7HashesForDate('2026-07-01', db);

      expect(result.hl7).toEqual([]);
      expect(errorSpy).toHaveBeenCalledWith('Erro ao gerar hash do arquivo HL7:', 'plain string disk failure');
    });

    // RF007 AC2 (#1321): a row held only in the object store has no local path.
    const storeOnlyDoc = {
      _id: 'file-s3',
      storagePath: null,
      storageUri: 'objstore://samples/abc/sha256/' + 'a'.repeat(64),
      storageObjectVersion: 'sha256:' + 'a'.repeat(64),
      fileName: 'report.hl7',
      fileSize: 42
    };

    it('hashes the object-store bytes of a store-only row, reading nothing from disk (RF007 AC2, #1321)', async () => {
      const content = 'MSH|^~\\&|S3SENDER|...';
      const getObject = vi.fn(async () => Buffer.from(content, 'utf8'));
      vi.spyOn(objectStorage, 'getFileObjectStore').mockReturnValue({ getObject, putObject: vi.fn() });
      const existsSpy = vi.spyOn(fs, 'existsSync');
      const readSpy = vi.spyOn(fs, 'readFileSync');

      const { db } = makeDb({ samples: [], sampleFiles: [storeOnlyDoc] });

      const result = await hl7AuditService.buildHL7HashesForDate('2026-07-01', db);

      expect(getObject).toHaveBeenCalledWith(storeOnlyDoc.storageUri);
      expect(result.hl7).toHaveLength(1);
      expect(result.hl7[0]).toMatchObject({ type: 'hl7', fileId: 'file-s3', hash: sha256Hex(content) });
      expect(result.hl7[0].note).toBeUndefined();
      expect(existsSpy).not.toHaveBeenCalled();
      expect(readSpy).not.toHaveBeenCalled();
    });

    it('falls back to fileName|fileSize hashing when the object store answers ENOENT (RF007 AC2, #1321)', async () => {
      const missing = Object.assign(new Error('missing'), { code: 'ENOENT' });
      vi.spyOn(objectStorage, 'getFileObjectStore').mockReturnValue({ getObject: vi.fn(async () => { throw missing; }), putObject: vi.fn() });

      const { db } = makeDb({ samples: [], sampleFiles: [storeOnlyDoc] });

      const result = await hl7AuditService.buildHL7HashesForDate('2026-07-01', db);

      expect(result.hl7).toHaveLength(1);
      expect(result.hl7[0]).toMatchObject({ type: 'hl7', fileId: 'file-s3', hash: sha256Hex('report.hl7|42'), note: 'arquivo não encontrado em disco' });
    });

    it('logs and leaves out a store-only row whose object-store read fails otherwise (RF007 AC2, #1321)', async () => {
      const outage = Object.assign(new Error('S3 down'), { code: 'OBJECT_STORE_UNAVAILABLE' });
      vi.spyOn(objectStorage, 'getFileObjectStore').mockReturnValue({ getObject: vi.fn(async () => { throw outage; }), putObject: vi.fn() });
      const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});

      const { db } = makeDb({ samples: [], sampleFiles: [storeOnlyDoc] });

      const result = await hl7AuditService.buildHL7HashesForDate('2026-07-01', db);

      expect(result.hl7).toEqual([]);
      expect(errorSpy).toHaveBeenCalledWith('Erro ao gerar hash do arquivo HL7:', 'S3 down');
    });

    it('queries sample_files with the hl7 fileType/fileName filter and date range', async () => {
      const { db, filesCol } = makeDb({ samples: [], sampleFiles: [] });

      await hl7AuditService.buildHL7HashesForDate('2026-07-01', db);

      expect(filesCol.find).toHaveBeenCalledTimes(1);
      const filter = filesCol.find.mock.calls[0][0];
      expect(filter.uploadDate.$gte.toISOString()).toBe('2026-07-01T00:00:00.000Z');
      expect(filter.uploadDate.$lte.toISOString()).toBe('2026-07-01T23:59:59.999Z');
      expect(filter.$or).toEqual([{ fileType: /hl7/i }, { fileName: /\.hl7$/i }]);
    });
  });

  describe('buildHL7HashesForDate - combined results and dedup', () => {
    it('includes both fhir and hl7 items together in the returned shape', async () => {
      const doc = { _id: 'sample-1', fhir: { a: 1 } };
      const fileDoc = { _id: 'file-1', fileName: 'x.hl7', fileSize: 5 };
      vi.spyOn(fs, 'existsSync').mockReturnValue(false);

      const { db, logsCol } = makeDb({ samples: [doc], sampleFiles: [fileDoc] });

      const result = await hl7AuditService.buildHL7HashesForDate('2026-07-01', db);

      expect(result.fhir).toHaveLength(1);
      expect(result.hl7).toHaveLength(1);
      expect(result.inserted).toHaveLength(2);
      expect(logsCol.insertOne).toHaveBeenCalledTimes(2);
    });

    it('skips inserting a log for an item whose log already exists (dedup by sourceId)', async () => {
      const doc = { _id: 'sample-dup', fhir: { a: 1 } };
      const { db, logsCol } = makeDb({
        samples: [doc],
        sampleFiles: [],
        findOneImpl: async (query) => {
          if (query['payload.sourceId'] === 'sample-dup') {
            return { _id: 'existing-log' };
          }
          return null;
        }
      });

      const result = await hl7AuditService.buildHL7HashesForDate('2026-07-01', db);

      expect(logsCol.insertOne).not.toHaveBeenCalled();
      expect(result.inserted).toEqual([]);
      expect(result.fhir).toHaveLength(1);
    });

    it('inserts only the genuinely-new item when one of two items is a duplicate', async () => {
      const dupDoc = { _id: 'sample-dup', fhir: { a: 1 } };
      const newDoc = { _id: 'sample-new', fhir: { b: 2 } };
      const { db, logsCol } = makeDb({
        samples: [dupDoc, newDoc],
        sampleFiles: [],
        findOneImpl: async (query) => {
          if (query['payload.sourceId'] === 'sample-dup') return { _id: 'existing-log' };
          return null;
        }
      });

      const result = await hl7AuditService.buildHL7HashesForDate('2026-07-01', db);

      expect(logsCol.insertOne).toHaveBeenCalledTimes(1);
      expect(result.inserted).toHaveLength(1);
      expect(result.inserted[0].payload.sourceId).toBe('sample-new');
    });

    it('skips an item lacking both sampleId and fileId and logs a warning, without stopping the rest', async () => {
      const noIdDoc = { _id: null, fhir: { a: 1 } };
      const goodDoc = { _id: 'sample-good', fhir: { b: 2 } };
      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
      const { db, logsCol } = makeDb({ samples: [noIdDoc, goodDoc], sampleFiles: [] });

      const result = await hl7AuditService.buildHL7HashesForDate('2026-07-01', db);

      expect(warnSpy).toHaveBeenCalledWith('[HL7_AUDIT] Item sem sampleId/fileId ignorado para deduplicação');
      expect(logsCol.insertOne).toHaveBeenCalledTimes(1);
      expect(result.inserted).toHaveLength(1);
      expect(result.inserted[0].payload.sourceId).toBe('sample-good');
    });

    it('queries logs with the correct sourceId and HL7_HASH action per item', async () => {
      const doc = { _id: 'sample-1', fhir: { a: 1 } };
      const { db, logsCol } = makeDb({ samples: [doc], sampleFiles: [] });

      await hl7AuditService.buildHL7HashesForDate('2026-07-01', db);

      expect(logsCol.findOne).toHaveBeenCalledWith({ 'payload.sourceId': 'sample-1', action: 'HL7_HASH' });
    });
  });

  describe('buildHL7MerkleForDate', () => {
    it('writes HL7/FHIR hash logs first, then delegates to integrityCheckService.buildMerkleForDate and returns its result verbatim', async () => {
      const doc = { _id: 'sample-1', fhir: { a: 1 } };
      const { db, logsCol } = makeDb({ samples: [doc], sampleFiles: [] });

      const fakeMerkleResult = { date: '2026-07-01', root: 'deadbeef', leaves: ['deadbeef'], docs: [], getProofForHash: () => [] };
      const merkleSpy = vi
        .spyOn(integrityCheckService, 'buildMerkleForDate')
        .mockResolvedValue(fakeMerkleResult);

      const result = await hl7AuditService.buildHL7MerkleForDate('2026-07-01', db);

      // side effect: the hash-building step ran and inserted a log before the merkle call
      expect(logsCol.insertOne).toHaveBeenCalledTimes(1);
      expect(merkleSpy).toHaveBeenCalledTimes(1);
      expect(merkleSpy).toHaveBeenCalledWith('2026-07-01', db);
      expect(result).toBe(fakeMerkleResult);
    });
  });
});
