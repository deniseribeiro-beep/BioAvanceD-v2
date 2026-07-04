import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';

const require2 = createRequire(import.meta.url);
const logService = require2('../../src/services/log.service');
const LogModel = require2('../../src/models/Log');
const logger = require2('../../src/utils/logger');

function makeCollection(overrides = {}) {
  return {
    insertOne: vi.fn().mockResolvedValue({ insertedId: 'log-1' }),
    find: vi.fn().mockReturnThis(),
    sort: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    skip: vi.fn().mockReturnThis(),
    toArray: vi.fn().mockResolvedValue([]),
    countDocuments: vi.fn().mockResolvedValue(0),
    ...overrides
  };
}

function makeDb(collection) {
  return { collection: vi.fn().mockReturnValue(collection) };
}

describe('LogService', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('sanitizeLogData', () => {
    it('strips patient names from the message (regex consumes to end-of-string when no digits follow) but keeps a valid entityID', () => {
      const result = logService.sanitizeLogData({
        entity: 'Patient',
        entityID: '12345678',
        message: 'Paciente João da Silva atualizado'
      });

      expect(result.message).toBe('Paciente');
      expect(result.entityID).toBe('12345678');
    });

    it('stops stripping at the first digit in the message', () => {
      const result = logService.sanitizeLogData({
        entity: 'Patient',
        entityID: '12345678',
        message: 'Paciente João da Silva 12345678 atualizado'
      });

      expect(result.message).toBe('Paciente12345678 atualizado');
    });

    it('extracts an 8-digit id from a malformed entityID', () => {
      const result = logService.sanitizeLogData({
        entity: 'Patient',
        entityID: 'patient-12345678-extra'
      });

      expect(result.entityID).toBe('12345678');
    });

    it('falls back to N/A when no 8-digit id can be extracted', () => {
      const result = logService.sanitizeLogData({
        entity: 'Patient',
        entityID: 'not-an-id'
      });

      expect(result.entityID).toBe('N/A');
    });

    it('leaves non-Patient entities untouched', () => {
      const data = { entity: 'Sample', entityID: 'abc', message: 'Paciente X criado' };
      const result = logService.sanitizeLogData(data);

      expect(result.entityID).toBe('abc');
      expect(result.message).toBe('Paciente X criado');
    });

    it('preserves metadata.tracking data', () => {
      const tracking = { ip: '10.0.0.1', userAgent: 'test' };
      const result = logService.sanitizeLogData({ metadata: { tracking } });

      expect(result.metadata.tracking).toEqual(tracking);
      expect(result.metadata.tracking).not.toBe(tracking);
    });

    it('does not mutate the original object', () => {
      const original = { entity: 'Patient', entityID: '12345678', message: 'Paciente Foo' };
      logService.sanitizeLogData(original);

      expect(original.message).toBe('Paciente Foo');
    });
  });

  describe('createLog', () => {
    it('creates and inserts a valid log, computing an audit hash when missing', async () => {
      const collection = makeCollection();
      const db = makeDb(collection);

      const result = await logService.createLog(db, {
        userID: 'user-1',
        action: 'CREATE',
        entity: 'Sample'
      }, null);

      expect(collection.insertOne).toHaveBeenCalledTimes(1);
      const insertedLog = collection.insertOne.mock.calls[0][0];
      expect(insertedLog.auditHash).toBeTruthy();
      expect(result._id).toBe('log-1');
    });

    it('throws when validation fails and does not attempt to insert', async () => {
      const collection = makeCollection();
      const db = makeDb(collection);

      await expect(logService.createLog(db, { action: 'CREATE' }, null)).rejects.toThrow();
      expect(collection.insertOne).not.toHaveBeenCalled();
    });

    it('logs a warning but does not throw when insertOne returns no insertedId', async () => {
      const collection = makeCollection({ insertOne: vi.fn().mockResolvedValue({}) });
      const db = makeDb(collection);
      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});

      const result = await logService.createLog(db, {
        userID: 'user-1',
        action: 'CREATE',
        entity: 'Sample'
      }, null);

      expect(warnSpy).toHaveBeenCalled();
      expect(result._id).toBeNull();
    });

    it('logs and rethrows when insertOne fails', async () => {
      const collection = makeCollection({ insertOne: vi.fn().mockRejectedValue(new Error('db down')) });
      const db = makeDb(collection);
      const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});

      await expect(logService.createLog(db, {
        userID: 'user-1',
        action: 'CREATE',
        entity: 'Sample'
      }, null)).rejects.toThrow('db down');

      expect(errorSpy).toHaveBeenCalled();
    });
  });

  describe('getLogs', () => {
    it('builds a userId $or filter from userId/userID/user aliases', async () => {
      const collection = makeCollection();
      const db = makeDb(collection);

      await logService.getLogs(db, { userId: 'u1' });

      expect(collection.find).toHaveBeenCalledWith(
        expect.objectContaining({
          $or: [
            { userId: 'u1' },
            { userID: 'u1' },
            { 'metadata.userID': 'u1' }
          ]
        })
      );
    });

    it('combines resourceType and status filters under $and without clobbering each other', async () => {
      const collection = makeCollection();
      const db = makeDb(collection);

      await logService.getLogs(db, { resourceType: 'Sample', status: 'success' });

      const query = collection.find.mock.calls[0][0];
      expect(query.$and).toHaveLength(2);
      expect(query.$and[0]).toEqual({ $or: [{ resourceType: 'Sample' }, { entity: 'Sample' }] });
      expect(query.$and[1]).toEqual({ $or: [{ status: 'success' }, { result: 'success' }] });
    });

    it('merges an existing $or with a text search into $and', async () => {
      const collection = makeCollection();
      const db = makeDb(collection);

      await logService.getLogs(db, { userId: 'u1', search: 'foo' });

      const query = collection.find.mock.calls[0][0];
      expect(query.$or).toBeUndefined();
      expect(query.$and).toHaveLength(2);
      expect(query.$and[0].$or).toEqual([
        { userId: 'u1' },
        { userID: 'u1' },
        { 'metadata.userID': 'u1' }
      ]);
    });

    it('applies default pagination and sorting when none is given', async () => {
      const collection = makeCollection({ toArray: vi.fn().mockResolvedValue([{ id: 1 }]), countDocuments: vi.fn().mockResolvedValue(1) });
      const db = makeDb(collection);

      const result = await logService.getLogs(db, {});

      expect(collection.limit).toHaveBeenCalledWith(50);
      expect(collection.skip).toHaveBeenCalledWith(0);
      expect(collection.sort).toHaveBeenCalledWith({ dateTime: -1, timestamp: -1 });
      expect(result.page).toBe(1);
      expect(result.totalPages).toBe(1);
    });

    it('computes skip from page and limit when skip is not explicit', async () => {
      const collection = makeCollection();
      const db = makeDb(collection);

      await logService.getLogs(db, { page: 3, limit: 20 });

      expect(collection.skip).toHaveBeenCalledWith(40);
    });

    it('logs and rethrows when the query fails', async () => {
      const collection = makeCollection({ find: vi.fn().mockImplementation(() => { throw new Error('query failed'); }) });
      const db = makeDb(collection);
      const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});

      await expect(logService.getLogs(db, {})).rejects.toThrow('query failed');
      expect(errorSpy).toHaveBeenCalled();
    });
  });

  describe('getUserLogs', () => {
    it('queries by userID/userId/userName aliases and returns serialized logs', async () => {
      const collection = makeCollection({ toArray: vi.fn().mockResolvedValue([{ userID: 'u1' }]) });
      const db = makeDb(collection);

      const result = await logService.getUserLogs(db, 'u1', 25);

      expect(collection.find).toHaveBeenCalledWith({
        $or: [{ userID: 'u1' }, { userId: 'u1' }, { userName: 'u1' }]
      });
      expect(collection.limit).toHaveBeenCalledWith(25);
      expect(result).toHaveLength(1);
    });
  });

  describe('getEntityLogs', () => {
    it('queries by entity/resourceType and entityID/resourceId', async () => {
      const collection = makeCollection();
      const db = makeDb(collection);

      await logService.getEntityLogs(db, 'Sample', 'abc', 10);

      expect(collection.find).toHaveBeenCalledWith({
        $and: [
          { $or: [{ entity: 'Sample' }, { resourceType: 'Sample' }] },
          { $or: [{ entityID: 'abc' }, { resourceId: 'abc' }] }
        ]
      });
    });
  });

  describe('exportLogsToCSV', () => {
    it('produces a CSV with headers and rows for the returned logs', async () => {
      const collection = makeCollection({
        toArray: vi.fn().mockResolvedValue([{
          _id: 'id1',
          timestamp: '2026-01-01T00:00:00.000Z',
          userName: 'USR-1',
          action: 'CREATE',
          entity: 'Sample',
          entityID: 'e1',
          result: 'success',
          severity: 'info',
          module: 'Sistema',
          ipSource: '10.0.0.1',
          message: 'created'
        }]),
        countDocuments: vi.fn().mockResolvedValue(1)
      });
      const db = makeDb(collection);

      const csv = await logService.exportLogsToCSV(db, {});

      expect(csv).toContain('ID');
      // userName gets replaced by the real anonymization pipeline (no matching userID -> USR-SYSTEM)
      expect(csv).toContain('USR-SYSTEM');
      expect(csv).toContain('created');
    });

    it('logs and rethrows on failure', async () => {
      const collection = makeCollection({ find: vi.fn().mockImplementation(() => { throw new Error('boom'); }) });
      const db = makeDb(collection);
      const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});

      await expect(logService.exportLogsToCSV(db, {})).rejects.toThrow('boom');
      expect(errorSpy).toHaveBeenCalled();
    });
  });

  describe('exportLogsToExcel', () => {
    it('builds an xlsx buffer with header and data rows', async () => {
      const collection = makeCollection({
        toArray: vi.fn().mockResolvedValue([{
          _id: 'id1',
          timestampFormatted: '01/01/2026 00:00:00',
          userName: 'USR-1',
          action: 'CREATE',
          entity: 'Sample',
          entityID: 'e1',
          result: 'success',
          severity: 'info',
          module: 'Sistema',
          ipSource: '10.0.0.1',
          message: 'created',
          payload: { foo: 'bar' }
        }]),
        countDocuments: vi.fn().mockResolvedValue(1)
      });
      const db = makeDb(collection);

      const buffer = await logService.exportLogsToExcel(db, {});

      expect(Buffer.isBuffer(buffer)).toBe(true);
      expect(buffer.length).toBeGreaterThan(0);
    });

    it('logs an error and throws a wrapped message on failure', async () => {
      const collection = makeCollection({ find: vi.fn().mockImplementation(() => { throw new Error('boom'); }) });
      const db = makeDb(collection);
      const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});

      await expect(logService.exportLogsToExcel(db, {})).rejects.toThrow('Erro ao exportar logs: boom');
      expect(errorSpy).toHaveBeenCalled();
    });
  });
});
