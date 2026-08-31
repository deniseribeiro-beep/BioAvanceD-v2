import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const sensorService = require('../../src/services/sensor.service');

const isQuarantineTriggerStatusMock = vi.fn();
const quarantineBySensorStatusMock = vi.fn();

describe('sensor.service quarantine flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sensorService.setQuarantineService({
      isQuarantineTriggerStatus: isQuarantineTriggerStatusMock,
      quarantineBySensorStatus: quarantineBySensorStatusMock
    });
  });

  it('Caminho feliz: status normal nao chama quarentena', async () => {
    const existingSensor = {
      sensorId: 'S-100',
      maintenanceStatus: 'operational'
    };

    const findOne = vi.fn(async () => existingSensor);
    const updateOne = vi.fn(async () => ({ matchedCount: 1 }));
    const sensorsCollection = { findOne, updateOne };

    const startSession = vi.fn();
    const db = {
      collection: vi.fn(() => sensorsCollection),
      client: { startSession }
    };

    isQuarantineTriggerStatusMock.mockReturnValue(false);

    const result = await sensorService.updateSensor(db, 'S-100', {
      maintenanceStatus: 'operational'
    });

    expect(result.success).toBe(true);
    expect(result.quarantine).toEqual({ triggered: false });

    expect(isQuarantineTriggerStatusMock).toHaveBeenCalledWith('operational');
    expect(quarantineBySensorStatusMock).not.toHaveBeenCalled();
    expect(startSession).not.toHaveBeenCalled();
    expect(updateOne).toHaveBeenCalledTimes(1);
    expect(updateOne).toHaveBeenCalledWith(
      { $or: [{ sensorId: 'S-100' }, { sensorID: 'S-100' }, { _id: 'S-100' }] },
      { $set: expect.objectContaining({ maintenanceStatus: 'operational' }) }
    );
  });

  it('Gatilho: status offline chama transacao e quarentena com parametros corretos', async () => {
    const existingSensor = {
      sensorId: 'S-200',
      maintenanceStatus: 'operational',
      locationId: 'LOC-1'
    };

    const findOne = vi.fn(async () => existingSensor);
    const updateOne = vi.fn(async () => ({ matchedCount: 1 }));
    const sensorsCollection = { findOne, updateOne };

    const withTransaction = vi.fn(async (cb) => cb());
    const endSession = vi.fn(async () => undefined);
    const session = { withTransaction, endSession };
    const startSession = vi.fn(() => session);

    const db = {
      collection: vi.fn(() => sensorsCollection),
      client: { startSession }
    };

    isQuarantineTriggerStatusMock.mockReturnValue(true);
    quarantineBySensorStatusMock.mockResolvedValue({
      triggered: true,
      matched: 3,
      quarantined: 3,
      movements: 3,
      reason: 'status:offline'
    });

    const result = await sensorService.updateSensor(db, 'S-200', {
      maintenanceStatus: 'offline'
    });

    expect(result.success).toBe(true);
    expect(result.quarantine.triggered).toBe(true);

    expect(startSession).toHaveBeenCalledTimes(1);
    expect(withTransaction).toHaveBeenCalledTimes(1);
    expect(endSession).toHaveBeenCalledTimes(1);

    expect(isQuarantineTriggerStatusMock).toHaveBeenCalledWith('offline');
    expect(quarantineBySensorStatusMock).toHaveBeenCalledTimes(1);
    expect(quarantineBySensorStatusMock).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        sensorId: 'S-200',
        maintenanceStatus: 'offline'
      }),
      'offline',
      expect.objectContaining({
        session,
        updateData: expect.objectContaining({ maintenanceStatus: 'offline' })
      })
    );

    expect(updateOne).toHaveBeenCalledWith(
      { $or: [{ sensorId: 'S-200' }, { sensorID: 'S-200' }, { _id: 'S-200' }] },
      { $set: expect.objectContaining({ maintenanceStatus: 'offline' }) },
      { session }
    );
  });

  // #875: updateSensor's allowlist must not break the quarantine trigger for
  // callers still sending the legacy `status` alias -- it should normalize
  // onto maintenanceStatus (the real Sensor.create() field) before $set,
  // not persist `status` itself (not a model field).
  it('#875: normalizes the status alias onto maintenanceStatus before $set, still triggering quarantine', async () => {
    const existingSensor = {
      sensorId: 'S-300',
      maintenanceStatus: 'operational'
    };

    const findOne = vi.fn(async () => existingSensor);
    const updateOne = vi.fn(async () => ({ matchedCount: 1 }));
    const sensorsCollection = { findOne, updateOne };

    const withTransaction = vi.fn(async (cb) => cb());
    const endSession = vi.fn(async () => undefined);
    const session = { withTransaction, endSession };
    const startSession = vi.fn(() => session);

    const db = {
      collection: vi.fn(() => sensorsCollection),
      client: { startSession }
    };

    isQuarantineTriggerStatusMock.mockReturnValue(true);
    quarantineBySensorStatusMock.mockResolvedValue({
      triggered: true,
      matched: 1,
      quarantined: 1,
      movements: 1,
      reason: 'status:offline'
    });

    const result = await sensorService.updateSensor(db, 'S-300', {
      status: 'offline'
    });

    expect(result.quarantine.triggered).toBe(true);
    expect(isQuarantineTriggerStatusMock).toHaveBeenCalledWith('offline');

    const setArg = updateOne.mock.calls[0][1].$set;
    expect(setArg.maintenanceStatus).toBe('offline');
    expect(setArg).not.toHaveProperty('status');
  });
});
