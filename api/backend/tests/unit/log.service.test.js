import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';

// Stage 2 consolidated CI checkpoint; no test semantics changed.
// Item 8 post-reconciliation verification checkpoint.
// Item 8 coverage checkpoint after legitimate residual tests.

const require2 = createRequire(import.meta.url);
const logService = require2('../../src/services/log.service');
const LogModel = require2('../../src/models/Log');
const logger = require2('../../src/utils/logger');
const auditV2Service = require2('../../src/services/audit-v2.service');
const securityAlertsService = require2('../../src/services/securityAlerts.service');

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
      // Isolate from the real audit-v2 ingest path (asserted separately below) so this
      // test's insertOne count reflects only the primary `logs` write.
      vi.spyOn(auditV2Service, 'ingestLogRecord').mockResolvedValue({});

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

    it('raises a critical security alert (not just a log line) when audit_events mirroring fails (#394)', async () => {
      const collection = makeCollection();
      const db = makeDb(collection);
      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
      vi.spyOn(auditV2Service, 'ingestLogRecord').mockRejectedValue(new Error('recordedAt must be an ISO string'));
      const initSpy = vi.spyOn(securityAlertsService, 'init').mockImplementation(() => {});
      const alertSpy = vi.spyOn(securityAlertsService, 'logSecurityAlert').mockResolvedValue('alert-1');

      const result = await logService.createLog(db, {
        userID: 'user-1',
        action: 'CREATE',
        entity: 'Sample'
      }, null);

      expect(warnSpy).toHaveBeenCalledWith('Falha ao espelhar log em audit_events:', 'recordedAt must be an ISO string');
      expect(initSpy).toHaveBeenCalledWith(db);
      expect(alertSpy).toHaveBeenCalledWith(expect.objectContaining({
        type: 'AUDIT_TRAIL_WRITE_FAILURE',
        severity: 'critical',
        action: 'AUDIT_V2_INGEST_FAILED',
        details: expect.objectContaining({ error: 'recordedAt must be an ISO string' })
      }));
      // The alert failing to raise must never block the primary log write from succeeding.
      expect(result._id).toBe('log-1');
    });

    it('normalizes a non-Error audit mirror failure and still emits the critical alert', async () => {
      const collection = makeCollection();
      const db = makeDb(collection);
      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
      vi.spyOn(auditV2Service, 'ingestLogRecord').mockRejectedValue('audit mirror string failure');
      vi.spyOn(securityAlertsService, 'init').mockImplementation(() => {});
      const alertSpy = vi.spyOn(securityAlertsService, 'logSecurityAlert').mockResolvedValue('alert-string');

      const result = await logService.createLog(db, {
        userID: 'user-item8',
        action: 'CREATE',
        entity: 'Sample'
      }, null);

      expect(warnSpy).toHaveBeenCalledWith(
        'Falha ao espelhar log em audit_events:',
        'audit mirror string failure'
      );
      expect(alertSpy).toHaveBeenCalledWith(expect.objectContaining({
        type: 'AUDIT_TRAIL_WRITE_FAILURE',
        details: expect.objectContaining({
          error: 'audit mirror string failure'
        })
      }));
      expect(result._id).toBe('log-1');
    });

    it('throws when validation fails and does not attempt to insert', async () => {
      const collection = makeCollection();
      const db = makeDb(collection);

      await expect(logService.createLog(db, { action: 'CREATE' }, null)).rejects.toThrow();
      expect(collection.insertOne).not.toHaveBeenCalled();
    });

    // #1106: the two failure kinds reach the same catch in auditLogger and
    // were indistinguishable there. They are cleanly separable at the source:
    // validation throws BEFORE logsCollection.insertOne is ever reached, so
    // the tag goes on at its only throw site rather than being guessed at
    // from a message string downstream.
    it('tags a validation failure with LOG_VALIDATION_FAILED (#1106)', async () => {
      const collection = makeCollection();
      const db = makeDb(collection);

      const error = await logService.createLog(db, { action: 'CREATE' }, null).catch((e) => e);

      expect(error.code).toBe('LOG_VALIDATION_FAILED');
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

    // The other half of the pair: an infrastructure failure must stay
    // UNTAGGED, or the discriminator says "validation" for everything.
    it('leaves an insertOne failure untagged, so the kinds stay distinguishable (#1106)', async () => {
      const collection = makeCollection({ insertOne: vi.fn().mockRejectedValue(new Error('db down')) });
      const db = makeDb(collection);
      vi.spyOn(logger, 'error').mockImplementation(() => {});

      const error = await logService.createLog(db, {
        userID: 'user-1',
        action: 'CREATE',
        entity: 'Sample'
      }, null).catch((e) => e);

      expect(error.message).toBe('db down');
      expect(error.code).toBeUndefined();
    });
  });

  describe('getLogs', () => {
    it('builds an $in filter when action is an array, plain value otherwise', async () => {
      const collection = makeCollection();
      const db = makeDb(collection);

      await logService.getLogs(db, { action: ['CREATE', 'UPDATE'] });
      expect(collection.find.mock.calls[0][0].action).toEqual({ $in: ['CREATE', 'UPDATE'] });

      await logService.getLogs(db, { action: 'CREATE' });
      expect(collection.find.mock.calls[1][0].action).toBe('CREATE');
    });

    it('builds an $in filter when entity is an array, plain value otherwise', async () => {
      const collection = makeCollection();
      const db = makeDb(collection);

      await logService.getLogs(db, { entity: ['Sample', 'Patient'] });
      expect(collection.find.mock.calls[0][0].entity).toEqual({ $in: ['Sample', 'Patient'] });

      await logService.getLogs(db, { entity: 'Sample' });
      expect(collection.find.mock.calls[1][0].entity).toBe('Sample');
    });

    it('builds an $in filter when severity is an array, plain value otherwise', async () => {
      const collection = makeCollection();
      const db = makeDb(collection);

      await logService.getLogs(db, { severity: ['info', 'error'] });
      expect(collection.find.mock.calls[0][0].severity).toEqual({ $in: ['info', 'error'] });

      await logService.getLogs(db, { severity: 'info' });
      expect(collection.find.mock.calls[1][0].severity).toBe('info');
    });

    it('builds an $in filter when result is an array, plain value otherwise', async () => {
      const collection = makeCollection();
      const db = makeDb(collection);

      await logService.getLogs(db, { result: ['success', 'failure'] });
      expect(collection.find.mock.calls[0][0].result).toEqual({ $in: ['success', 'failure'] });

      await logService.getLogs(db, { result: 'success' });
      expect(collection.find.mock.calls[1][0].result).toBe('success');
    });

    it('builds an $in filter when module is an array, plain value otherwise', async () => {
      const collection = makeCollection();
      const db = makeDb(collection);

      await logService.getLogs(db, { module: ['Sistema', 'Auth'] });
      expect(collection.find.mock.calls[0][0].module).toEqual({ $in: ['Sistema', 'Auth'] });

      await logService.getLogs(db, { module: 'Sistema' });
      expect(collection.find.mock.calls[1][0].module).toBe('Sistema');
    });

    it('filters by ip using the ip/ipSource/sourceIP aliases', async () => {
      const collection = makeCollection();
      const db = makeDb(collection);

      await logService.getLogs(db, { ip: '10.0.0.1' });
      expect(collection.find.mock.calls[0][0].ipSource).toEqual({ $regex: '10.0.0.1', $options: 'i' });

      await logService.getLogs(db, { ipSource: '10.0.0.2' });
      expect(collection.find.mock.calls[1][0].ipSource).toEqual({ $regex: '10.0.0.2', $options: 'i' });

      await logService.getLogs(db, { sourceIP: '10.0.0.3' });
      expect(collection.find.mock.calls[2][0].ipSource).toEqual({ $regex: '10.0.0.3', $options: 'i' });
    });

    it('merges a startDate/endDate range with an existing $and (resourceType + search combo)', async () => {
      const collection = makeCollection();
      const db = makeDb(collection);

      await logService.getLogs(db, {
        resourceType: 'Sample',
        search: 'foo',
        startDate: '2026-01-01',
        endDate: '2026-01-31'
      });

      const query = collection.find.mock.calls[0][0];
      expect(query.$and.length).toBeGreaterThanOrEqual(2);
      const dateClause = query.$and.find(c => c.$or && c.$or[0] && c.$or[0].timestamp);
      expect(dateClause.$or[0].timestamp.$gte).toEqual(new Date('2026-01-01'));
      expect(dateClause.$or[1].dateTime.$lte.getHours()).toBe(23);
    });

    it('merges a startDate/endDate range with an existing bare $or (no prior $and)', async () => {
      const collection = makeCollection();
      const db = makeDb(collection);

      await logService.getLogs(db, { userId: 'u1', startDate: '2026-01-01' });

      const query = collection.find.mock.calls[0][0];
      expect(query.$or).toBeUndefined();
      expect(query.$and).toHaveLength(2);
      expect(query.$and[0].$or[0]).toEqual({ userId: 'u1' });
      expect(query.$and[1].$or[0].timestamp.$gte).toEqual(new Date('2026-01-01'));
    });

    it('filters by userName using a case-insensitive regex', async () => {
      const collection = makeCollection();
      const db = makeDb(collection);

      await logService.getLogs(db, { userName: 'USR-1' });

      expect(collection.find.mock.calls[0][0].userName).toEqual({ $regex: 'USR-1', $options: 'i' });
    });

    it('sets a plain $or date range when no prior $or/$and filter exists', async () => {
      const collection = makeCollection();
      const db = makeDb(collection);

      await logService.getLogs(db, { startDate: '2026-01-01' });

      const query = collection.find.mock.calls[0][0];
      expect(query.$or).toEqual([
        { timestamp: { $gte: new Date('2026-01-01') } },
        { dateTime: { $gte: new Date('2026-01-01') } }
      ]);
    });

    it('applies a custom sortBy field without the default dateTime/timestamp tiebreaker', async () => {
      const collection = makeCollection();
      const db = makeDb(collection);

      await logService.getLogs(db, { sortBy: 'action', sortOrder: 'asc' });

      expect(collection.sort).toHaveBeenCalledWith({ action: 1 });
    });

    // #780: sortBy came straight off the request into the sort spec with no
    // validation. Mongo treats a key no document carries as equal across
    // every document, so on this paginated query an unrecognized field did
    // not produce "unsorted results" -- it produced the WRONG PAGE, with a
    // 200 and a plausible body, and no way for the caller to tell.
    it('ignores a sortBy naming a field no log document carries, falling back to the default ordering (#780)', async () => {
      const collection = makeCollection();
      const db = makeDb(collection);

      await logService.getLogs(db, { sortBy: 'dateTimeX' });

      expect(collection.sort).toHaveBeenCalledWith({ dateTime: -1, timestamp: -1 });
      expect(collection.sort).not.toHaveBeenCalledWith(
        expect.objectContaining({ dateTimeX: expect.anything() })
      );
    });

    // A dotted path and a $-prefixed name are the two shapes the issue asked
    // someone to confirm are inert in this driver position. The allow-list
    // dissolves the question rather than answering it: neither can reach the
    // sort spec at all now.
    it('ignores a dotted or $-prefixed sortBy rather than passing it to the driver (#780)', async () => {
      const collection = makeCollection();
      const db = makeDb(collection);

      await logService.getLogs(db, { sortBy: 'metadata.userID' });
      expect(collection.sort).toHaveBeenCalledWith({ dateTime: -1, timestamp: -1 });

      const other = makeCollection();
      await logService.getLogs(makeDb(other), { sortBy: '$natural' });
      expect(other.sort).toHaveBeenCalledWith({ dateTime: -1, timestamp: -1 });
    });

    // severity is the real field name; the issue's suggested allow-list
    // guessed `level`, which no log document has. The list is derived from
    // Log.js's own document builder for exactly that reason.
    it('accepts severity, a real field from the Log model (#780)', async () => {
      const collection = makeCollection();
      const db = makeDb(collection);

      await logService.getLogs(db, { sortBy: 'severity', sortOrder: 'asc' });

      expect(collection.sort).toHaveBeenCalledWith({ severity: 1 });
    });

    // The fallback has to be observable, or it is the same silent-acceptance
    // class the bug was (cf. #789). The effective ordering comes back in the
    // response so a caller can tell what was actually applied.
    it('reports the effective ordering in the response, including on fallback (#780)', async () => {
      const collection = makeCollection();

      const rejected = await logService.getLogs(makeDb(collection), { sortBy: 'nope', sortOrder: 'asc' });
      expect(rejected).toMatchObject({ sortBy: 'dateTime', sortOrder: 'desc' });

      const accepted = await logService.getLogs(makeDb(makeCollection()), { sortBy: 'action', sortOrder: 'asc' });
      expect(accepted).toMatchObject({ sortBy: 'action', sortOrder: 'asc' });
    });

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

    it('accepts resourceType/status arrays and reuses the existing $and bucket for both canonical aliases', async () => {
      const collection = makeCollection();
      const db = makeDb(collection);

      await logService.getLogs(db, {
        resourceType: ['Sample', 'Patient'],
        status: ['success', 'failure'],
      });

      const query = collection.find.mock.calls[0][0];
      expect(query.$and).toEqual([
        {
          $or: [
            { resourceType: { $in: ['Sample', 'Patient'] } },
            { entity: { $in: ['Sample', 'Patient'] } },
          ],
        },
        {
          $or: [
            { status: { $in: ['success', 'failure'] } },
            { result: { $in: ['success', 'failure'] } },
          ],
        },
      ]);
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

    it('logs and rethrows when the query fails', async () => {
      const collection = makeCollection({ find: vi.fn().mockImplementation(() => { throw new Error('user query failed'); }) });
      const db = makeDb(collection);
      const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});

      await expect(logService.getUserLogs(db, 'u1')).rejects.toThrow('user query failed');
      expect(errorSpy).toHaveBeenCalled();
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

    it('logs and rethrows when the query fails', async () => {
      const collection = makeCollection({ find: vi.fn().mockImplementation(() => { throw new Error('entity query failed'); }) });
      const db = makeDb(collection);
      const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});

      await expect(logService.getEntityLogs(db, 'Sample', 'abc')).rejects.toThrow('entity query failed');
      expect(errorSpy).toHaveBeenCalled();
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

    it('rejects when getLogs resolves to a non-object', async () => {
      const collection = makeCollection();
      const db = makeDb(collection);
      vi.spyOn(logService, 'getLogs').mockResolvedValue(null);
      const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});

      await expect(logService.exportLogsToExcel(db, {})).rejects.toThrow('Erro ao exportar logs: Resposta inválida do serviço de logs');
      expect(errorSpy).toHaveBeenCalled();
    });

    it('defaults to an empty logs array when result.logs is missing', async () => {
      const collection = makeCollection();
      const db = makeDb(collection);
      vi.spyOn(logService, 'getLogs').mockResolvedValue({});
      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});

      const buffer = await logService.exportLogsToExcel(db, {});

      expect(warnSpy).toHaveBeenCalledWith('Nenhum log encontrado para exportação');
      expect(Buffer.isBuffer(buffer)).toBe(true);
    });

    it('rejects when result.logs is not an array', async () => {
      const collection = makeCollection();
      const db = makeDb(collection);
      vi.spyOn(logService, 'getLogs').mockResolvedValue({ logs: 'not-an-array' });

      await expect(logService.exportLogsToExcel(db, {})).rejects.toThrow('Erro ao exportar logs: Dados de logs em formato inválido');
    });

    it('warns and still builds an empty workbook when there are no logs', async () => {
      const collection = makeCollection();
      const db = makeDb(collection);
      vi.spyOn(logService, 'getLogs').mockResolvedValue({ logs: [] });
      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});

      const buffer = await logService.exportLogsToExcel(db, {});

      expect(warnSpy).toHaveBeenCalledWith('Nenhum log encontrado para exportação');
      expect(Buffer.isBuffer(buffer)).toBe(true);
    });

    it('falls back to the un-anonymized logs and warns when anonymizeLogs throws', async () => {
      // log.service.js destructures `const { anonymizeLogs } = require(...)` at module
      // scope, so spying on the userAnonymization module object has no effect (the
      // destructured local binding already captured the original function) — fake the
      // whole dependency module via require.cache injection instead (see
      // testing-conventions/references/cjs-mocking.md).
      const depPath = require2.resolve('../../src/utils/userAnonymization');
      const servicePath = require2.resolve('../../src/services/log.service');
      const realDepModule = require2.cache[depPath];
      const realDepExports = realDepModule.exports;

      realDepModule.exports = {
        ...realDepExports,
        anonymizeLogs: vi.fn().mockRejectedValue(new Error('anon failed'))
      };
      delete require2.cache[servicePath];

      try {
        const freshLogService = require2(servicePath);
        const collection = makeCollection();
        const db = makeDb(collection);
        vi.spyOn(freshLogService, 'getLogs').mockResolvedValue({
          logs: [{ _id: 'id1', userName: 'USR-1', action: 'CREATE' }]
        });
        const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});

        const buffer = await freshLogService.exportLogsToExcel(db, {});

        expect(warnSpy).toHaveBeenCalledWith('Erro ao anonimizar logs, usando logs originais:', 'anon failed');
        expect(Buffer.isBuffer(buffer)).toBe(true);
      } finally {
        realDepModule.exports = realDepExports;
        delete require2.cache[servicePath];
        require2(servicePath);
      }
    });

    it('extracts ip/timestamp/id via their fallback branches for each row', async () => {
      const collection = makeCollection();
      const db = makeDb(collection);
      vi.spyOn(logService, 'getLogs').mockResolvedValue({
        logs: [
          // sourceIP alias, timestampISO alias, logID alias (no _id)
          { logID: 'log-a', sourceIP: '10.0.0.9', timestampISO: '2026-01-01T00:00:00.000Z' },
          // metadata.tracking.ip alias, real Date instance timestamp, string _id
          { _id: 'log-b', metadata: { tracking: { ip: '10.0.0.5' } }, timestamp: new Date('2026-02-02') },
          // invalid Date string timestamp -> 'N/A'
          { _id: 'log-c', timestamp: 'not-a-date' }
        ]
      });

      const buffer = await logService.exportLogsToExcel(db, {});

      expect(Buffer.isBuffer(buffer)).toBe(true);
    });

    it('falls back to N/A for a row and warns when per-row processing throws', async () => {
      const collection = makeCollection();
      const db = makeDb(collection);
      const badLog = {
        get _id() { throw new Error('row boom'); }
      };
      vi.spyOn(logService, 'getLogs').mockResolvedValue({ logs: [badLog] });
      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});

      const buffer = await logService.exportLogsToExcel(db, {});

      expect(warnSpy).toHaveBeenCalledWith('Erro ao processar linha de log:', 'row boom');
      expect(Buffer.isBuffer(buffer)).toBe(true);
    });
  });
});
