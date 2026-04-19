import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const saveTelemetryPoint = vi.fn();
const sendCriticalAlertEmail = vi.fn();
const connectMongoDB = vi.fn();

vi.mock('../../src/services/saveTelemetryPoint', () => ({
  saveTelemetryPoint,
}));

vi.mock('../../src/services/saveTelemetryPoint.js', () => ({
  saveTelemetryPoint,
}));

vi.mock('../../src/services/sendCriticalAlertEmail', () => ({
  sendCriticalAlertEmail,
}));

vi.mock('../../src/services/sendCriticalAlertEmail.js', () => ({
  sendCriticalAlertEmail,
}));

vi.mock('../../src/infrastructure/database/mongodb/connection', () => ({
  connectMongoDB,
}));

vi.mock('../../src/infrastructure/database/mongodb/connection.js', () => ({
  connectMongoDB,
}));

const SensorMetadata = require('../../src/models/SensorMetadata.schema');
const { ingestTelemetry } = require('../../src/controllers/iot.controller');

function createResponse() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

describe('iot.controller', () => {
  let consoleLogSpy;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    process.env.RESEND_API_KEY = 'test-resend-key';
    process.env.ALERT_EMAIL_TO = 'alerts@example.test';

    saveTelemetryPoint.mockResolvedValue(true);
    sendCriticalAlertEmail.mockResolvedValue({ id: 'email-1' });
    connectMongoDB.mockResolvedValue(undefined);

    vi.spyOn(SensorMetadata, 'findOne').mockReturnValue({
      populate: vi.fn().mockReturnThis(),
      lean: vi.fn().mockResolvedValue({
        sensorId: 'sensor-1',
        alertEmail: 'alerts@example.test',
        temperaturePolicy: {
          _id: 'policy-1',
          minTemp: 2,
          maxTemp: 8,
        },
      }),
    });
  });

  afterEach(() => {
    consoleLogSpy?.mockRestore();
    delete process.env.RESEND_API_KEY;
    delete process.env.ALERT_EMAIL_TO;
  });

  it('deve rejeitar payload de telemetria incompleto', async () => {
    const req = { body: { sensorId: '', temperature: 'abc' } };
    const res = createResponse();

    await ingestTelemetry(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({
      success: false,
      error: 'sensorId e temperature são obrigatórios',
    });
    expect(saveTelemetryPoint).not.toHaveBeenCalled();
  });

  it('deve gravar telemetria e disparar alerta crítico quando temperatura excede a política', async () => {
    const req = {
      body: {
        sensorId: 'sensor-1',
        temperature: 12.5,
        timestamp: '2026-04-08T12:00:00.000Z',
      },
    };
    const res = createResponse();

    await ingestTelemetry(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ success: true, accepted: true });
    expect(SensorMetadata.findOne).toHaveBeenCalledWith({ sensorId: 'sensor-1' });
    expect(consoleLogSpy).toHaveBeenCalledWith(
      '[ALERTA][IOT] Temperatura fora da política',
      expect.stringContaining('"sensorId":"sensor-1"')
    );
  });
});