import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const ExcelJS = require('exceljs');
const logService = require('../../src/services/log.service');
const LogModel = require('../../src/models/Log');
const auditV2Service = require('../../src/services/audit-v2.service');
const securityAlertsService = require('../../src/services/securityAlerts.service');
const logger = require('../../src/utils/logger');

function makeCollection(overrides = {}) {
  const collection = {
    find: vi.fn().mockReturnThis(),
    sort: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    skip: vi.fn().mockReturnThis(),
    toArray: vi.fn().mockResolvedValue([]),
    countDocuments: vi.fn().mockResolvedValue(0),
    insertOne: vi.fn().mockResolvedValue({ insertedId: 'log-1' }),
    ...overrides,
  };
  return collection;
}

function makeDb(collection) {
  return { collection: vi.fn(() => collection) };
}

describe('log.service.js item 8 residual Excel timestamp branch', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('falls back to N/A when timestamp conversion throws without discarding the row', async () => {
    const db = {
      collection: vi.fn(() => ({
        find: vi.fn().mockReturnThis(),
        sort: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        skip: vi.fn().mockReturnThis(),
        toArray: vi.fn().mockResolvedValue([]),
        countDocuments: vi.fn().mockResolvedValue(0),
      })),
    };

    vi.spyOn(logService, 'getLogs').mockResolvedValue({
      logs: [{
        _id: 'log-symbol-timestamp',
        timestamp: Symbol('invalid-date-input'),
        action: 'READ',
        entity: 'Sample',
        result: 'success',
        severity: 'info',
        module: 'Audit',
        message: 'row survives timestamp conversion failure',
      }],
    });

    const buffer = await logService.exportLogsToExcel(db, {});

    expect(Buffer.isBuffer(buffer)).toBe(true);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const worksheet = workbook.getWorksheet('Logs');

    expect(worksheet.getCell('A2').value).toBe('log-symbol-timestamp');
    expect(worksheet.getCell('B2').value).toBe('N/A');
    expect(worksheet.getCell('D2').value).toBe('READ');
    expect(worksheet.getCell('K2').value).toBe('row survives timestamp conversion failure');
  });

  it('raises the audit-trail alert with userID when LogModel.create only carries userID', async () => {
    const collection = makeCollection();
    const db = makeDb(collection);
    vi.spyOn(logger, 'warn').mockImplementation(() => {});
    vi.spyOn(LogModel, 'validate').mockReturnValue({ isValid: true, errors: [] });
    vi.spyOn(LogModel, 'create').mockReturnValue({
      userID: 'legacy-user-only',
      action: 'CREATE',
      entity: 'Sample',
      auditHash: 'hash-1',
    });
    vi.spyOn(auditV2Service, 'ingestLogRecord').mockRejectedValue(new Error('mirror failed'));
    vi.spyOn(securityAlertsService, 'init').mockImplementation(() => {});
    const alertSpy = vi.spyOn(securityAlertsService, 'logSecurityAlert').mockResolvedValue('alert-1');

    await logService.createLog(db, { userID: 'legacy-user-only', action: 'CREATE', entity: 'Sample' }, null);

    expect(alertSpy).toHaveBeenCalledWith(expect.objectContaining({
      type: 'AUDIT_TRAIL_WRITE_FAILURE',
      userID: 'legacy-user-only',
    }));
  });

  it('appends a status filter onto an existing $and bucket', async () => {
    const collection = makeCollection();
    const db = makeDb(collection);

    await logService.getLogs(db, {
      resourceType: 'Sample',
      status: 'success',
    });

    const query = collection.find.mock.calls[0][0];
    expect(query.$and).toEqual(expect.arrayContaining([
      { $or: [{ resourceType: 'Sample' }, { entity: 'Sample' }] },
      { $or: [{ status: 'success' }, { result: 'success' }] },
    ]));
  });

  it('omits page from filters and still returns page 1 with an allow-listed sortField', async () => {
    const collection = makeCollection({
      toArray: vi.fn().mockResolvedValue([{ _id: 'log-sort' }]),
      countDocuments: vi.fn().mockResolvedValue(1),
    });
    const db = makeDb(collection);

    const result = await logService.getLogs(db, {
      sortBy: 'action',
      sortOrder: 'asc',
      limit: 10,
    });

    expect(collection.sort).toHaveBeenCalledWith({ action: 1 });
    expect(result).toMatchObject({
      page: 1,
      sortBy: 'action',
      sortOrder: 'asc',
    });
  });

  it('exports CSV rows without _id via logID and without userName via USR-SYSTEM', async () => {
    const collection = makeCollection();
    const db = makeDb(collection);
    vi.spyOn(logService, 'getLogs').mockResolvedValue({
      logs: [{
        logID: 'csv-log-1',
        action: 'READ',
        entity: 'Sample',
        result: 'success',
        severity: 'info',
        module: 'Audit',
        ipSource: '10.0.0.1',
        message: 'no id no user',
        timestampISO: '2026-01-01T00:00:00.000Z',
      }],
    });

    const csv = await logService.exportLogsToCSV(db, {});

    expect(csv).toContain('csv-log-1');
    expect(csv).toContain('USR-SYSTEM');
    expect(csv).toContain('no id no user');
  });
});
