/**
 * Item 8 wave C: easy TEST_V2 leftovers (|| defaults / catch without message)
 * for 1–2-arm inventory files without a dedicated residual suite.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

afterEach(() => {
  vi.restoreAllMocks();
});

describe('item8 waveC residual easy fallbacks', () => {
  it('cid.controller treats a missing q as an empty search string before the min-length gate', async () => {
    const controller = require('../../src/controllers/cid.controller');
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
    await controller.search({ app: { locals: { db: {} } }, query: {} }, res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      items: [],
      pagination: expect.objectContaining({ query: '', total: 0 }),
    }));
  });

  it('user-security.controller uses the Portuguese DB-unavailable fallback without req.t', async () => {
    const controller = require('../../src/controllers/user-security.controller');
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
    await controller.getStatus({ app: { locals: {} }, user: { userID: 'u1' } }, res);
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      error: 'Banco de dados não disponível',
    }));
  });

  it('saveTelemetryPoint logs a raw failure without error.message', async () => {
    const logger = require('../../src/utils/logger');
    const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});
    const influxPath = require.resolve('../../src/infrastructure/database/influxdb/connection');
    const pointPath = require.resolve('../../src/services/saveTelemetryPoint');
    const originalInflux = require.cache[influxPath];

    require.cache[influxPath] = {
      id: influxPath,
      filename: influxPath,
      loaded: true,
      exports: {
        connectInfluxDB: vi.fn(async () => {
          throw 'plain influx failure';
        }),
        getInfluxWriteApi: vi.fn(),
      },
    };
    delete require.cache[pointPath];

    try {
      const { saveTelemetryPoint } = require('../../src/services/saveTelemetryPoint');
      await expect(saveTelemetryPoint('sensor-1', 4.2)).rejects.toBe('plain influx failure');
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('plain influx failure')
      );
    } finally {
      require.cache[influxPath] = originalInflux;
      delete require.cache[pointPath];
    }
  });

  it('sendCriticalAlertEmail rejects a non-email recipient after the blank check', async () => {
    const previousKey = process.env.RESEND_API_KEY;
    process.env.RESEND_API_KEY = 're_test_key';
    const send = require('../../src/services/sendCriticalAlertEmail');
    const fn = send.sendCriticalAlertEmail || send;
    try {
      await expect(fn('sensor-1', 9, 8, 'not-an-email'))
        .rejects.toThrow(/recipientEmail inválido/);
    } finally {
      if (previousKey === undefined) delete process.env.RESEND_API_KEY;
      else process.env.RESEND_API_KEY = previousKey;
    }
  });

  it('sendIncidentAlertEmail warns when recipients normalize to no valid addresses', async () => {
    const previousKey = process.env.RESEND_API_KEY;
    process.env.RESEND_API_KEY = 're_test_key';
    const logger = require('../../src/utils/logger');
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const mod = require('../../src/services/sendIncidentAlertEmail');
    const fn = mod.sendIncidentAlertEmail || mod;
    try {
      const result = await fn(
        {
          sensorName: 'S',
          currentTemperature: 1,
          maxTemperature: 2,
          minTemperature: 0,
          sensorKey: 'k',
          openedAt: new Date().toISOString(),
        },
        ['not-an-email', 'also-bad'],
        0
      );
      expect(result.success).toBe(false);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('Nenhum destinatário válido'));
    } finally {
      if (previousKey === undefined) delete process.env.RESEND_API_KEY;
      else process.env.RESEND_API_KEY = previousKey;
    }
  });

  it('retentionSweep.sweepLogs defaults deletedCount to zero', async () => {
    const service = require('../../src/services/retentionSweep.service');
    const db = {
      collection: () => ({
        deleteMany: async () => ({}),
      }),
    };
    await expect(service.sweepLogs(db, new Date())).resolves.toEqual({ deleted: 0 });
  });

  it('mqtt-signature returns null/false when the signing secret is absent', () => {
    const previous = process.env.MQTT_SIGNING_SECRET;
    delete process.env.MQTT_SIGNING_SECRET;
    const service = require('../../src/services/mqtt-signature.service');
    try {
      expect(service.computeHmac('payload')).toBeNull();
      expect(service.verifyHmac('payload', 'deadbeef')).toBe(false);
    } finally {
      if (previous === undefined) delete process.env.MQTT_SIGNING_SECRET;
      else process.env.MQTT_SIGNING_SECRET = previous;
    }
  });

  it('ingestion quarantine requires an ingestionQuarantineRecordId', async () => {
    const { resolveQuarantineRecord } = require('../../src/ingestion/quarantine');
    await expect(resolveQuarantineRecord({
      db: {},
      resolutionStatus: 'accepted',
      resolvedBy: 'actor-1',
    })).rejects.toThrow(/ingestionQuarantineRecordId é obrigatório/);
  });

  it('barcodeSymbology strips the AIM Data Matrix ]d2 prefix', () => {
    const { stripScannerPrefix } = require('../../src/utils/barcodeSymbology');
    expect(stripScannerPrefix(']d2ABC123')).toBe('ABC123');
  });

  it('mongoTransaction rejects a db handle without startSession after capability passes', async () => {
    const { withMongoTransaction } = require('../../src/utils/mongoTransaction');
    const db = {
      client: {
        db: () => ({
          command: async () => ({ setName: 'rs0' }),
        }),
      },
    };
    await expect(withMongoTransaction(db, async () => 'x'))
      .rejects.toThrow(/Transação Mongo indisponível/);
  });

  it('notificationDispatch returns quietly when no matching rule exists', async () => {
    const service = require('../../src/services/notificationDispatch.service');
    const logger = require('../../src/utils/logger');
    vi.spyOn(logger, 'warn').mockImplementation(() => {});
    vi.spyOn(logger, 'error').mockImplementation(() => {});
    const db = {
      collection: () => ({
        findOne: async () => null,
        find: () => ({
          sort: () => ({
            limit: () => ({
              toArray: async () => [],
            }),
          }),
        }),
      }),
    };
    await expect(service.dispatchNotification(db, {
      eventType: 'temperature_alert',
      sourceEventType: 'TemperatureAlert',
      sourceEventId: '1',
      payload: { sensorId: 's1' },
    })).resolves.toBeNull();
  });
});
