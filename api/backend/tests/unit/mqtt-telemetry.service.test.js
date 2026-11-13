const fs = require('fs');
const logger = require('../../src/utils/logger');
const iotStreamingService = require('../../src/services/iot-streaming.service');
const mqttSignatureService = require('../../src/services/mqtt-signature.service');
const mqttIngestionAuditService = require('../../src/services/mqtt-ingestion-audit.service');
const mqttTelemetryService = require('../../src/services/mqtt-telemetry.service');
const influxTelemetryWriteRepository = require('../../src/infrastructure/persistence/influxdb/InfluxTelemetryWriteRepository');

function makeFakeClient() {
  const handlers = {};
  return {
    handlers,
    on: vi.fn((event, cb) => { handlers[event] = cb; }),
    subscribe: vi.fn((topic, cb) => cb(null)),
    end: vi.fn((force, cb) => cb())
  };
}

describe('mqtt-telemetry.service', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  describe('isEnabled', () => {
    it('returns true when MQTT_ENABLED=true', () => {
      vi.stubEnv('MQTT_ENABLED', 'true');
      expect(mqttTelemetryService.isEnabled()).toBe(true);
    });

    it('returns true when MQTT_ENABLED=TRUE (case-insensitive)', () => {
      vi.stubEnv('MQTT_ENABLED', 'TRUE');
      expect(mqttTelemetryService.isEnabled()).toBe(true);
    });

    it('returns true when MQTT_ENABLED=1', () => {
      vi.stubEnv('MQTT_ENABLED', '1');
      expect(mqttTelemetryService.isEnabled()).toBe(true);
    });

    it('returns false when MQTT_ENABLED is unset', () => {
      vi.stubEnv('MQTT_ENABLED', '');
      expect(mqttTelemetryService.isEnabled()).toBe(false);
    });

    it('returns false when MQTT_ENABLED=false', () => {
      vi.stubEnv('MQTT_ENABLED', 'false');
      expect(mqttTelemetryService.isEnabled()).toBe(false);
    });

    it('returns false when MQTT_ENABLED=0', () => {
      vi.stubEnv('MQTT_ENABLED', '0');
      expect(mqttTelemetryService.isEnabled()).toBe(false);
    });

    it('returns false when MQTT_ENABLED is garbage', () => {
      vi.stubEnv('MQTT_ENABLED', 'yes-please');
      expect(mqttTelemetryService.isEnabled()).toBe(false);
    });
  });

  describe('getConfig', () => {
    it('applies defaults when env vars are unset', () => {
      vi.stubEnv('MQTT_URL', '');
      vi.stubEnv('MQTT_TOPIC', '');
      vi.stubEnv('MQTT_TLS_ENABLED', '');
      vi.stubEnv('MQTT_TLS_REJECT_UNAUTHORIZED', '');
      vi.stubEnv('MQTT_CA_PATH', '');
      vi.stubEnv('MQTT_CERT_PATH', '');
      vi.stubEnv('MQTT_KEY_PATH', '');
      vi.stubEnv('MQTT_SIGNATURE_REQUIRED', '');

      const config = mqttTelemetryService.getConfig();

      expect(config.topic).toBe('bioavanced/telemetry/temperature/#');
      expect(config.tlsEnabled).toBe(false);
      expect(config.rejectUnauthorized).toBe(true);
      expect(config.ca).toBeUndefined();
      expect(config.cert).toBeUndefined();
      expect(config.key).toBeUndefined();
      expect(config.signatureRequired).toBe(false);
    });

    it('returns undefined for a TLS file field when fs.readFileSync throws (missing file)', () => {
      vi.stubEnv('MQTT_CA_PATH', '/nonexistent/ca.pem');
      vi.spyOn(fs, 'readFileSync').mockImplementation(() => {
        throw new Error('ENOENT: no such file');
      });
      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});

      const config = mqttTelemetryService.getConfig();

      expect(config.ca).toBeUndefined();
      expect(warnSpy).toHaveBeenCalled();
    });

    it('reads TLS file contents when fs.readFileSync succeeds', () => {
      vi.stubEnv('MQTT_CA_PATH', '/some/ca.pem');
      vi.spyOn(fs, 'readFileSync').mockReturnValue(Buffer.from('ca-contents'));

      const config = mqttTelemetryService.getConfig();

      expect(config.ca).toEqual(Buffer.from('ca-contents'));
    });
  });

  describe('start', () => {
    it('returns without connecting when isEnabled() is false', async () => {
      vi.stubEnv('MQTT_ENABLED', 'false');
      const infoSpy = vi.spyOn(logger, 'info').mockImplementation(() => {});

      await mqttTelemetryService.start({});

      expect(mqttTelemetryService.started).toBe(false);
      expect(infoSpy).toHaveBeenCalled();
    });

    it('warns and returns without connecting when enabled but no MQTT_URL', async () => {
      vi.stubEnv('MQTT_ENABLED', 'true');
      vi.stubEnv('MQTT_URL', '');
      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});

      await mqttTelemetryService.start({});

      expect(mqttTelemetryService.started).toBe(false);
      expect(warnSpy).toHaveBeenCalled();
    });

    it('returns immediately if already started', async () => {
      mqttTelemetryService.started = true;
      const infoSpy = vi.spyOn(logger, 'info').mockImplementation(() => {});

      await mqttTelemetryService.start({});

      expect(infoSpy).not.toHaveBeenCalled();
      mqttTelemetryService.started = false;
    });

  });

  describe('stop', () => {
    it('does nothing when there is no client', async () => {
      mqttTelemetryService.client = null;
      await expect(mqttTelemetryService.stop()).resolves.toBeUndefined();
    });

    it('ends the client and resets state', async () => {
      const infoSpy = vi.spyOn(logger, 'info').mockImplementation(() => {});
      const fakeClient = makeFakeClient();
      mqttTelemetryService.client = fakeClient;
      mqttTelemetryService.started = true;

      await mqttTelemetryService.stop();

      expect(fakeClient.end).toHaveBeenCalledWith(false, expect.any(Function));
      expect(mqttTelemetryService.client).toBeNull();
      expect(mqttTelemetryService.started).toBe(false);
      expect(infoSpy).toHaveBeenCalled();
    });
  });

  describe('handleMessage', () => {
    const db = {};

    it('returns early on empty payload buffer with no side effects', async () => {
      const auditSpy = vi.spyOn(mqttIngestionAuditService, 'append').mockResolvedValue();
      const processSpy = vi.spyOn(iotStreamingService, 'processTemperatureData').mockResolvedValue();

      await mqttTelemetryService.handleMessage(db, 'topic', Buffer.from(''), false);

      expect(auditSpy).not.toHaveBeenCalled();
      expect(processSpy).not.toHaveBeenCalled();
    });

    it('returns early on falsy/null payload buffer', async () => {
      const auditSpy = vi.spyOn(mqttIngestionAuditService, 'append').mockResolvedValue();
      const processSpy = vi.spyOn(iotStreamingService, 'processTemperatureData').mockResolvedValue();

      await mqttTelemetryService.handleMessage(db, 'topic', null, false);

      expect(auditSpy).not.toHaveBeenCalled();
      expect(processSpy).not.toHaveBeenCalled();
    });

    it('rejects as missing_signature when signature required but absent', async () => {
      const auditSpy = vi.spyOn(mqttIngestionAuditService, 'append').mockResolvedValue();
      const processSpy = vi.spyOn(iotStreamingService, 'processTemperatureData').mockResolvedValue();
      vi.spyOn(mqttSignatureService, 'hashPayload').mockReturnValue('hash123');
      vi.spyOn(logger, 'warn').mockImplementation(() => {});

      const payload = { sensorId: 'S1', temperatureValue: 5 };
      await mqttTelemetryService.handleMessage(db, 'topic', Buffer.from(JSON.stringify(payload), 'utf8'), true);

      expect(processSpy).not.toHaveBeenCalled();
      expect(auditSpy).toHaveBeenCalledWith(db, expect.objectContaining({
        status: 'rejected',
        reason: 'missing_signature'
      }));
    });

    it('rejects as invalid_signature when signature present but verifyHmac fails', async () => {
      const auditSpy = vi.spyOn(mqttIngestionAuditService, 'append').mockResolvedValue();
      const processSpy = vi.spyOn(iotStreamingService, 'processTemperatureData').mockResolvedValue();
      vi.spyOn(mqttSignatureService, 'hashPayload').mockReturnValue('hash123');
      vi.spyOn(mqttSignatureService, 'verifyHmac').mockReturnValue(false);
      vi.spyOn(logger, 'warn').mockImplementation(() => {});

      const payload = { sensorId: 'S1', temperatureValue: 5, signature: 'bad-sig' };
      await mqttTelemetryService.handleMessage(db, 'topic', Buffer.from(JSON.stringify(payload), 'utf8'), false);

      expect(processSpy).not.toHaveBeenCalled();
      expect(auditSpy).toHaveBeenCalledWith(db, expect.objectContaining({
        status: 'rejected',
        reason: 'invalid_signature',
        payloadSignature: 'bad-sig'
      }));
    });

    it('rejects as invalid_payload when sensorId is missing', async () => {
      const auditSpy = vi.spyOn(mqttIngestionAuditService, 'append').mockResolvedValue();
      const processSpy = vi.spyOn(iotStreamingService, 'processTemperatureData').mockResolvedValue();
      vi.spyOn(mqttSignatureService, 'hashPayload').mockReturnValue('hash123');
      vi.spyOn(logger, 'warn').mockImplementation(() => {});

      const payload = { temperatureValue: 5 };
      await mqttTelemetryService.handleMessage(db, 'topic', Buffer.from(JSON.stringify(payload), 'utf8'), false);

      expect(processSpy).not.toHaveBeenCalled();
      expect(auditSpy).toHaveBeenCalledWith(db, expect.objectContaining({
        status: 'rejected',
        reason: 'invalid_payload'
      }));
    });

    it('rejects as invalid_payload when temperatureValue is non-finite', async () => {
      const auditSpy = vi.spyOn(mqttIngestionAuditService, 'append').mockResolvedValue();
      const processSpy = vi.spyOn(iotStreamingService, 'processTemperatureData').mockResolvedValue();
      vi.spyOn(mqttSignatureService, 'hashPayload').mockReturnValue('hash123');
      vi.spyOn(logger, 'warn').mockImplementation(() => {});

      const payload = { sensorId: 'S1', temperatureValue: 'not-a-number' };
      await mqttTelemetryService.handleMessage(db, 'topic', Buffer.from(JSON.stringify(payload), 'utf8'), false);

      expect(processSpy).not.toHaveBeenCalled();
      expect(auditSpy).toHaveBeenCalledWith(db, expect.objectContaining({
        status: 'rejected',
        reason: 'invalid_payload'
      }));
    });

    it('processes a fully valid payload without signature when signatureRequired is false', async () => {
      const auditSpy = vi.spyOn(mqttIngestionAuditService, 'append').mockResolvedValue();
      const processSpy = vi.spyOn(iotStreamingService, 'processTemperatureData').mockResolvedValue('inserted-id-1');
      vi.spyOn(mqttSignatureService, 'hashPayload').mockReturnValue('hash123');

      const payload = { sensorId: 'S1', temperatureValue: 4.5 };
      await mqttTelemetryService.handleMessage(db, 'topic', Buffer.from(JSON.stringify(payload), 'utf8'), false);

      expect(processSpy).toHaveBeenCalledTimes(1);
      expect(processSpy).toHaveBeenCalledWith(db, expect.objectContaining({
        sensorId: 'S1',
        temperatureValue: 4.5
      }), { strippedFields: [] });
      expect(auditSpy).toHaveBeenCalledWith(db, expect.objectContaining({
        status: 'processed',
        reason: null,
        sensorId: 'S1',
        temperatureValue: 4.5,
        temperatureDataId: 'inserted-id-1'
      }));
    });

    // #1317 (RF009 AC7): MQTT no longer stands in the receipt time for a
    // missing device time, so the reading's clock reads as unknown.
    it('passes a payload without a timestamp on with a null one, and a sent one as a Date', async () => {
      vi.spyOn(mqttIngestionAuditService, 'append').mockResolvedValue();
      const processSpy = vi.spyOn(iotStreamingService, 'processTemperatureData').mockResolvedValue('id');
      vi.spyOn(mqttSignatureService, 'hashPayload').mockReturnValue('hash123');

      await mqttTelemetryService.handleMessage(db, 'topic', Buffer.from(JSON.stringify({ sensorId: 'S1', temperatureValue: 4.5 }), 'utf8'), false);
      await mqttTelemetryService.handleMessage(db, 'topic', Buffer.from(JSON.stringify({ sensorId: 'S1', temperatureValue: 4.5, timestamp: '2026-10-10T12:00:00.000Z' }), 'utf8'), false);

      expect(processSpy.mock.calls[0][1].timestamp).toBeNull();
      expect(processSpy.mock.calls[1][1].timestamp).toEqual(new Date('2026-10-10T12:00:00.000Z'));
    });

    // RF009 AC7 (#1317): the client's contract fields reach the reading, so
    // its idempotencyKey replays instead of being replaced by a derived one.
    it("passes a payload's idempotencyKey, deviceMessageId and sequenceNumber on to the reading", async () => {
      vi.spyOn(mqttIngestionAuditService, 'append').mockResolvedValue();
      const processSpy = vi.spyOn(iotStreamingService, 'processTemperatureData').mockResolvedValue('id');
      vi.spyOn(mqttSignatureService, 'hashPayload').mockReturnValue('hash123');

      const payload = { sensorId: 'S1', temperatureValue: 4.5, idempotencyKey: 'k-1', deviceMessageId: 'm-1', sequenceNumber: 7 };
      await mqttTelemetryService.handleMessage(db, 'topic', Buffer.from(JSON.stringify(payload), 'utf8'), false);

      expect(processSpy).toHaveBeenCalledWith(db, expect.objectContaining({ idempotencyKey: 'k-1', deviceMessageId: 'm-1', sequenceNumber: 7 }), { strippedFields: [] });
    });

    // RF009 AC8, RNF004 C7 (#1540): a field handleMessage does not read is
    // stripped, and only its name goes on to the reading's screening.
    it('strips a field outside the MQTT reading fields and passes its name on, never its value', async () => {
      vi.spyOn(mqttIngestionAuditService, 'append').mockResolvedValue();
      const processSpy = vi.spyOn(iotStreamingService, 'processTemperatureData').mockResolvedValue('id');
      vi.spyOn(mqttSignatureService, 'hashPayload').mockReturnValue('hash123');

      const payload = { sensorId: 'S1', temperatureValue: 4.5, sourceEventId: 'e-1', patientName: 'Maria da Silva', cpf: '12345678909' };
      await mqttTelemetryService.handleMessage(db, 'topic', Buffer.from(JSON.stringify(payload), 'utf8'), false);

      const [, temperatureData, options] = processSpy.mock.calls[0];
      expect(options).toEqual({ strippedFields: ['cpf', 'patientName'] });
      expect(temperatureData).toMatchObject({ sensorId: 'S1', temperatureValue: 4.5, sourceEventId: 'e-1' });
      expect(JSON.stringify(temperatureData)).not.toContain('Maria');
    });

    // A contract field the reading contract refuses is dropped, so the
    // reading is still stored and audited as processed, without it.
    it.each([
      ['a numeric deviceMessageId', { deviceMessageId: 12345 }, 'deviceMessageId'],
      ['a string sequenceNumber', { sequenceNumber: '7' }, 'sequenceNumber'],
      ['a blank idempotencyKey', { idempotencyKey: '  ' }, 'idempotencyKey'],
    ])('stores a reading carrying %s, with that field absent', async (_label, extra, field) => {
      vi.spyOn(logger, 'warn').mockImplementation(() => {});
      const auditSpy = vi.spyOn(mqttIngestionAuditService, 'append').mockResolvedValue();
      vi.spyOn(mqttSignatureService, 'hashPayload').mockReturnValue('hash123');
      const write = vi.spyOn(influxTelemetryWriteRepository, 'writeTemperatureReadingNow').mockResolvedValue(new Date());
      const others = { insertOne: vi.fn().mockResolvedValue({ insertedId: 'other-id' }) };
      const storeDb = { collection: vi.fn(() => others) };

      const payload = { sensorId: 'S1', temperatureValue: 4.5, ...extra };
      await mqttTelemetryService.handleMessage(storeDb, 'topic', Buffer.from(JSON.stringify(payload), 'utf8'), false);

      // #1391 (RF009 AC1): InfluxDB is the reading's only store.
      expect(write).toHaveBeenCalledTimes(1);
      expect(storeDb.collection).not.toHaveBeenCalledWith('temperatures');
      const stored = write.mock.calls[0][0];
      expect(stored[field] ?? null).not.toEqual(extra[field]);
      expect(stored.idempotencyKeySource).toBe('derived');
      expect(auditSpy).toHaveBeenCalledWith(storeDb, expect.objectContaining({ status: 'processed', temperatureDataId: stored.telemetryReadingId }));
    });

    it('control: a payload without them, or with a null idempotencyKey, passes neither key on', async () => {
      vi.spyOn(mqttIngestionAuditService, 'append').mockResolvedValue();
      const processSpy = vi.spyOn(iotStreamingService, 'processTemperatureData').mockResolvedValue('id');
      vi.spyOn(mqttSignatureService, 'hashPayload').mockReturnValue('hash123');

      await mqttTelemetryService.handleMessage(db, 'topic', Buffer.from(JSON.stringify({ sensorId: 'S1', temperatureValue: 4.5 }), 'utf8'), false);
      await mqttTelemetryService.handleMessage(db, 'topic', Buffer.from(JSON.stringify({ sensorId: 'S1', temperatureValue: 4.5, idempotencyKey: null }), 'utf8'), false);

      for (const [, temperatureData] of processSpy.mock.calls) {
        expect(temperatureData).not.toHaveProperty('idempotencyKey');
        expect(temperatureData).not.toHaveProperty('deviceMessageId');
      }
      expect(processSpy).toHaveBeenCalledTimes(2);
    });

    it('processes a fully valid payload with a verified signature', async () => {
      const auditSpy = vi.spyOn(mqttIngestionAuditService, 'append').mockResolvedValue();
      const processSpy = vi.spyOn(iotStreamingService, 'processTemperatureData').mockResolvedValue('inserted-id-2');
      vi.spyOn(mqttSignatureService, 'hashPayload').mockReturnValue('hash456');
      vi.spyOn(mqttSignatureService, 'verifyHmac').mockReturnValue(true);

      const payload = { sensorId: 'S2', temperatureValue: 10, signature: 'good-sig' };
      await mqttTelemetryService.handleMessage(db, 'topic', Buffer.from(JSON.stringify(payload), 'utf8'), true);

      expect(processSpy).toHaveBeenCalledTimes(1);
      expect(auditSpy).toHaveBeenCalledWith(db, expect.objectContaining({
        status: 'processed',
        payloadSignature: 'good-sig',
        signatureVerified: true,
        temperatureDataId: 'inserted-id-2'
      }));
    });

    it('catches malformed JSON, logs an error, and does not throw', async () => {
      const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});
      const auditSpy = vi.spyOn(mqttIngestionAuditService, 'append').mockResolvedValue();
      const processSpy = vi.spyOn(iotStreamingService, 'processTemperatureData').mockResolvedValue();

      await expect(
        mqttTelemetryService.handleMessage(db, 'topic', Buffer.from('{not valid json', 'utf8'), false)
      ).resolves.toBeUndefined();

      expect(errorSpy).toHaveBeenCalled();
      expect(auditSpy).not.toHaveBeenCalled();
      expect(processSpy).not.toHaveBeenCalled();
    });
  });
});
