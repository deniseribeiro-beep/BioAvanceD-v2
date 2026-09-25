import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const fs = require('fs');
const mqttModulePath = require.resolve('mqtt');
const originalMqttCacheEntry = require.cache[mqttModulePath];
const mqtt = { connect: vi.fn() };
require.cache[mqttModulePath] = {
  id: mqttModulePath,
  filename: mqttModulePath,
  loaded: true,
  exports: mqtt,
};
const logger = require('../../src/utils/logger');
const iotStreamingService = require('../../src/services/iot-streaming.service');
const mqttSignatureService = require('../../src/services/mqtt-signature.service');
const mqttIngestionAuditService = require('../../src/services/mqtt-ingestion-audit.service');
const service = require('../../src/services/mqtt-telemetry.service');

if (originalMqttCacheEntry) {
  require.cache[mqttModulePath] = originalMqttCacheEntry;
} else {
  delete require.cache[mqttModulePath];
}

function fakeClient() {
  const handlers = {};
  return {
    handlers,
    on: vi.fn((name, fn) => { handlers[name] = fn; }),
    subscribe: vi.fn((topic, cb) => cb(null)),
    end: vi.fn((force, cb) => cb()),
  };
}

afterEach(() => {
  mqtt.connect.mockReset();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  service.client = null;
  service.started = false;
});

describe('mqtt telemetry item 8 residual canonical branches', () => {
  it('starts a TLS client, wires all handlers and covers subscribe/client raw errors', async () => {
    vi.stubEnv('MQTT_ENABLED', 'true');
    vi.stubEnv('MQTT_URL', 'mqtts://broker.example');
    vi.stubEnv('MQTT_TLS_ENABLED', 'true');
    vi.stubEnv('MQTT_TLS_REJECT_UNAUTHORIZED', 'false');
    vi.stubEnv('MQTT_CA_PATH', '/ca');
    vi.stubEnv('MQTT_CERT_PATH', '/cert');
    vi.stubEnv('MQTT_KEY_PATH', '/key');
    vi.spyOn(fs, 'readFileSync').mockImplementation((file) => Buffer.from(String(file)));
    const client = fakeClient();
    mqtt.connect.mockReturnValue(client);
    const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});
    const handleSpy = vi.spyOn(service, 'handleMessage').mockResolvedValue();

    await service.start({ db: true });

    expect(mqtt.connect).toHaveBeenCalledWith('mqtts://broker.example', expect.objectContaining({
      rejectUnauthorized: false,
      ca: Buffer.from('/ca'),
      cert: Buffer.from('/cert'),
      key: Buffer.from('/key'),
    }));
    expect(service.started).toBe(true);

    client.subscribe.mockImplementationOnce((topic, cb) => cb('raw subscribe failure'));
    client.handlers.connect();
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Falha ao assinar'), 'raw subscribe failure');

    client.handlers.error('raw mqtt error');
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Erro no cliente MQTT'), 'raw mqtt error');

    await client.handlers.message('topic/1', Buffer.from('{}'));
    expect(handleSpy).toHaveBeenCalled();
  });

  it('contains a raw synchronous mqtt.connect failure without starting the service', async () => {
    vi.stubEnv('MQTT_ENABLED', 'true');
    vi.stubEnv('MQTT_URL', 'mqtt://broker');
    mqtt.connect.mockImplementation(() => { throw 'raw connect failure'; });
    const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});

    await service.start({});

    expect(service.started).toBe(false);
    expect(service.client).toBeNull();
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Falha controlada'), 'raw connect failure');
  });

  it('normalizes sensorID/temperature/locationID aliases and preserves zero battery', async () => {
    const audit = vi.spyOn(mqttIngestionAuditService, 'append').mockResolvedValue();
    const process = vi.spyOn(iotStreamingService, 'processTemperatureData').mockResolvedValue('temp-1');
    vi.spyOn(mqttSignatureService, 'hashPayload').mockReturnValue('hash');

    const payload = {
      sensorID: 'S-ALIAS',
      temperature: 0,
      batteryLevel: 0,
      locationID: 'LOC-1',
      timestamp: '2026-09-19T12:00:00.000Z',
    };
    await service.handleMessage({}, 'topic', Buffer.from(JSON.stringify(payload)), false);

    expect(process).toHaveBeenCalledWith({}, expect.objectContaining({
      sensorId: 'S-ALIAS',
      temperatureValue: 0,
      temperatureUnit: '°C',
      batteryLevel: 0,
      locationId: 'LOC-1',
      readingStatus: 'valid',
      sensorStatus: 'normal',
    }));
    expect(audit).toHaveBeenCalledWith({}, expect.objectContaining({ status: 'processed', temperatureDataId: 'temp-1' }));
  });

  it('falls back from sensorId/sensorID to deviceId and from temperature to value', async () => {
    vi.spyOn(mqttIngestionAuditService, 'append').mockResolvedValue();
    const process = vi.spyOn(iotStreamingService, 'processTemperatureData').mockResolvedValue('temp-2');
    vi.spyOn(mqttSignatureService, 'hashPayload').mockReturnValue('hash');

    await service.handleMessage({}, 'topic', Buffer.from(JSON.stringify({
      deviceId: 'DEVICE-1',
      value: -70,
      temperatureUnit: 'K',
      readingStatus: 'estimated',
      sensorStatus: 'warning',
      signalQuality: 99,
      facility: 'FAC',
      zone: 'Z1',
    })), false);

    expect(process).toHaveBeenCalledWith({}, expect.objectContaining({
      sensorId: 'DEVICE-1',
      temperatureValue: -70,
      temperatureUnit: 'K',
      readingStatus: 'estimated',
      sensorStatus: 'warning',
      signalQuality: 99,
      facility: 'FAC',
      zone: 'Z1',
    }));
  });

  it('records signatureVerified from a valid signature when the payload is otherwise invalid', async () => {
    const audit = vi.spyOn(mqttIngestionAuditService, 'append').mockResolvedValue();
    vi.spyOn(iotStreamingService, 'processTemperatureData').mockResolvedValue();
    vi.spyOn(mqttSignatureService, 'hashPayload').mockReturnValue('hash');
    vi.spyOn(mqttSignatureService, 'verifyHmac').mockReturnValue(true);

    await service.handleMessage({}, 'topic', Buffer.from(JSON.stringify({
      signature: 'good',
      temperatureValue: 1,
    })), false);

    expect(audit).toHaveBeenCalledWith({}, expect.objectContaining({
      status: 'rejected',
      reason: 'empty_sensorId',
      signatureVerified: true,
    }));
  });
});
