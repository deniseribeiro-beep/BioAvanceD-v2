import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const DrugService = require('../../src/services/DrugService');
const logService = require('../../src/services/log.service');

afterEach(() => {
  vi.restoreAllMocks();
});

describe('DrugService item 8 residual branches', () => {
  it('writes null resourceId/entityID when the ATC query is blank', async () => {
    const createLog = vi.spyOn(logService, 'createLog').mockResolvedValue({});
    const service = new DrugService({ some: 'db' });

    await service._logAtcDictionarySync({
      query: '',
      cacheMiss: false,
      upsertedCount: 0,
      status: 'warning',
      message: 'blank query sync',
      auditContext: null,
    });

    expect(createLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        resourceId: null,
        entityID: null,
        userID: 'USR-SYSTEM',
      }),
      null
    );
  });

  it('falls back cache name to generic_name when the display name is omitted', async () => {
    const collection = { bulkWrite: vi.fn().mockResolvedValue({}) };
    const service = new DrugService({});

    await service._cacheDrugs([
      {
        generic_name: 'Generic Only Drug',
        code: 'ATC:Z01AA01',
        atc_code: 'Z01AA01',
        atc_level_1: 'Z',
        atc_classifications: ['Z01AA01'],
      },
    ], collection);

    const op = collection.bulkWrite.mock.calls[0][0][0].updateOne;
    expect(op.filter.generic_name).toBe('Generic Only Drug');
    expect(op.update.$set.name).toBe('Generic Only Drug');
    expect(op.update.$set.generic_name).toBe('Generic Only Drug');
  });
});
