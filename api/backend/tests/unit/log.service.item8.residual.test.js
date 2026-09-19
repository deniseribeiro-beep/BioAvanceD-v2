import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const ExcelJS = require('exceljs');
const logService = require('../../src/services/log.service');

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
});
