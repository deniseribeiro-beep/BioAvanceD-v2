import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const TemperatureModel = require('../../src/models/Temperature');
const logger = require('../../src/utils/logger');
const notificationServiceV2 = require('../../src/services/NotificationService');
const notificationDispatchService = require('../../src/services/notificationDispatch.service');
const temperatureService = require('../../src/services/temperature.service');

afterEach(() => {
  vi.restoreAllMocks();
});

function makeDb(collections = {}) {
  return { collection: vi.fn((name) => collections[name]) };
}

describe('temperature.service item 8 residual branches', () => {
  it('falls back to sensorID and logs notification failures without a message', async () => {
    const policy = { minThreshold: 0, maxThreshold: 10 };
    const findOne = vi.fn().mockResolvedValue(policy);
    const insertOne = vi.fn().mockResolvedValue({ insertedId: 'alert-sid' });
    const db = makeDb({ policies: { findOne }, alerts: { insertOne } });

    vi.spyOn(TemperatureModel, 'validateReading').mockReturnValue(false);
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});
    vi.spyOn(notificationServiceV2, 'sendCriticalTempAlert').mockRejectedValue('plain notify failure');
    vi.spyOn(notificationDispatchService, 'dispatchNotification').mockRejectedValue('plain dispatch failure');

    await temperatureService.checkPolicyAndAlert(db, {
      policyId: 'p1',
      sensorID: 'legacy-sensor',
      temperatureValue: 99,
      organizationId: 'org-1',
    });

    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    expect(insertOne).toHaveBeenCalledWith(expect.objectContaining({
      sensorId: 'legacy-sensor',
      organizationId: 'org-1',
    }));
    expect(warnSpy).toHaveBeenCalledWith(
      'Alerta de temperatura gerado:',
      expect.objectContaining({ sensorId: 'legacy-sensor' })
    );
    expect(errorSpy).toHaveBeenCalledWith(
      '[NOTIFICATION] Falha ao disparar alerta crítico:',
      'plain notify failure'
    );
    expect(errorSpy).toHaveBeenCalledWith(
      '[NOTIFICATION_DISPATCH] Falha ao disparar notificação baseada em regra:',
      'plain dispatch failure'
    );
    expect(notificationDispatchService.dispatchNotification).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        payload: expect.objectContaining({ sensorId: 'legacy-sensor' }),
      })
    );
  });
});
