import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

// Dedicated file, split out while import-lgpd.controller.test.js couldn't
// load (issue #101, now fixed). Covers importSamples' success flag (issue #24).
const controller = require('../../src/controllers/import-lgpd.controller');
const importLGPDService = require('../../src/services/import-lgpd.service');

function createRes() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn()
  };
}

function createDb() {
  return { collection: vi.fn() };
}

describe('import-lgpd.controller importSamples success flag (issue #24)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns success:false when some rows fail', async () => {
    const db = createDb();
    const file = { path: '/tmp/s.csv', originalname: 's.csv' };
    const req = { organizationScope: { scope: 'global' }, app: { locals: { db } }, file, body: {} };
    const res = createRes();

    vi.spyOn(importLGPDService, 'validateFileFormat').mockReturnValue(true);
    vi.spyOn(importLGPDService, 'importSamples').mockResolvedValue({
      total: 2,
      success: 1,
      errors: [{ index: 1, row: 2, errors: ['dup barcode'], data: { participantId: '12345678' } }]
    });
    vi.spyOn(importLGPDService, 'cleanupFile').mockImplementation(() => {});

    await controller.importSamples(req, res);

    const body = res.json.mock.calls[0][0];
    expect(body.success).toBe(false);
  });

  it('returns success:false when every row fails', async () => {
    const db = createDb();
    const file = { path: '/tmp/s.csv', originalname: 's.csv' };
    const req = { organizationScope: { scope: 'global' }, app: { locals: { db } }, file, body: {} };
    const res = createRes();

    vi.spyOn(importLGPDService, 'validateFileFormat').mockReturnValue(true);
    vi.spyOn(importLGPDService, 'importSamples').mockResolvedValue({
      total: 2,
      success: 0,
      errors: [
        { index: 0, row: 1, errors: ['dup barcode'], data: { participantId: '11111111' } },
        { index: 1, row: 2, errors: ['dup barcode'], data: { participantId: '22222222' } }
      ]
    });
    vi.spyOn(importLGPDService, 'cleanupFile').mockImplementation(() => {});

    await controller.importSamples(req, res);

    const body = res.json.mock.calls[0][0];
    expect(body.success).toBe(false);
  });

  it('returns success:true when all rows import cleanly', async () => {
    const db = createDb();
    const file = { path: '/tmp/s.csv', originalname: 's.csv' };
    const req = { organizationScope: { scope: 'global' }, app: { locals: { db } }, file, body: {} };
    const res = createRes();

    vi.spyOn(importLGPDService, 'validateFileFormat').mockReturnValue(true);
    vi.spyOn(importLGPDService, 'importSamples').mockResolvedValue({
      total: 2,
      success: 2,
      errors: []
    });
    vi.spyOn(importLGPDService, 'cleanupFile').mockImplementation(() => {});

    await controller.importSamples(req, res);

    const body = res.json.mock.calls[0][0];
    expect(body.success).toBe(true);
  });
});
