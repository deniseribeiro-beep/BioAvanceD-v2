import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
  let ingestTelemetry;
  let saveTelemetryPoint;
  let sendCriticalAlertEmail;
  let connectMongoDB;
  let consoleLogSpy;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();

    saveTelemetryPoint = vi.fn().mockResolvedValue(true);
    sendCriticalAlertEmail = vi.fn().mockResolvedValue({ id: 'email-1' });

    const temperatureIncidentsCollection = {
      findOne: vi.fn().mockResolvedValue(null),
      updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
      insertOne: vi.fn().mockResolvedValue({ insertedId: 'incident-1' }),
    };

    const usersCollection = {
      find: vi.fn().mockReturnValue({
        project: vi.fn().mockReturnValue({
          toArray: vi.fn().mockResolvedValue([]),
        }),
      }),
    };

    connectMongoDB = vi.fn().mockResolvedValue({
      collection: (name) => {
        if (name === 'temperatureIncidents') return temperatureIncidentsCollection;
        if (name === 'users') return usersCollection;
        return { findOne: vi.fn().mockResolvedValue(null) };
      },
    });

    vi.doMock('../../src/services/saveTelemetryPoint', () => ({ saveTelemetryPoint }));
    vi.doMock('../../src/services/sendCriticalAlertEmail', () => ({ sendCriticalAlertEmail }));
    vi.doMock('../../src/infrastructure/database/mongodb/connection', () => ({ connectMongoDB }));
    vi.doMock('../../src/models/SensorMetadata.schema', () => ({
      default: {
        findOne: vi.fn().mockReturnValue({
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
        }),
      },
      findOne: vi.fn().mockReturnValue({
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
      }),
    }));

    const controllerModule = await import('../../src/controllers/iot.controller.js');
    ingestTelemetry = controllerModule.ingestTelemetry;

    process.env.RESEND_API_KEY = 're_test_dummy_key';
    process.env.ALERT_EMAIL_TO = 'alerts@example.test';
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
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
    expect(connectMongoDB).toHaveBeenCalled();
    expect(consoleLogSpy).toHaveBeenCalledWith(
      '[ALERTA][IOT] Temperatura fora da política',
      expect.stringContaining('"sensorId":"sensor-1"')
    );
  });
});
