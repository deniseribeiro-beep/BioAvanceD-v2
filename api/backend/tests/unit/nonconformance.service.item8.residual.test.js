import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const NonconformanceModel = require('../../src/models/Nonconformance');
const notificationDispatch = require('../../src/services/notificationDispatch.service');
const logger = require('../../src/utils/logger');
const service = require('../../src/services/nonconformance.service');

afterEach(() => {
  vi.restoreAllMocks();
});

describe('nonconformance.service item 8 residual branches', () => {
  it('logs notification dispatch failures without an Error.message', async () => {
    vi.spyOn(NonconformanceModel, 'validate').mockReturnValue({ isValid: true, errors: [] });
    vi.spyOn(NonconformanceModel, 'create').mockReturnValue({ nonconformanceId: 'nc-1' });
    vi.spyOn(notificationDispatch, 'dispatchNotification').mockRejectedValue('plain nc notify failure');
    const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});
    const insertOne = vi.fn().mockResolvedValue({ insertedId: 'nc-1' });
    const db = { collection: () => ({ insertOne }) };

    await service.open(db, {
      nonconformanceType: 'process',
      description: 'synthetic nonconformance',
      detectedAt: new Date().toISOString(),
      detectedBy: 'actor-1',
      affectedEntityIds: [],
    });
    await new Promise((resolve) => setImmediate(resolve));

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('[NOTIFICATION_DISPATCH]'),
      'plain nc notify failure'
    );
  });

  it('rejects effectiveness verification when validation fails or the record is missing', async () => {
    vi.spyOn(NonconformanceModel, 'validateEffectivenessVerification')
      .mockReturnValueOnce({ isValid: false, errors: ['missing evidence'] })
      .mockReturnValue({ isValid: true, errors: [] });

    await expect(service.verifyEffectiveness({}, 'nc-missing', {}))
      .rejects.toThrow('missing evidence');

    const findOne = vi.fn().mockResolvedValue(null);
    const db = { collection: () => ({ findOne }) };
    await expect(service.verifyEffectiveness(db, 'nc-missing', { effective: true, verifiedBy: 'a' }))
      .rejects.toThrow('Não conformidade não encontrada');
  });
});
