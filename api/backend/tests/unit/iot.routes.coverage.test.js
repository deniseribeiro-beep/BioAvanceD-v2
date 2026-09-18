import { afterEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const routePath = require.resolve('../../src/interface/routes/iot.routes');
const controllerPath = require.resolve('../../src/controllers/iot.controller');
const gatePath = require.resolve('../../src/utils/testSupportGate');
const machineGatePath = require.resolve('../../src/utils/machineIngestGate');

function setCached(modulePath, exports) {
  require.cache[modulePath] = {
    id: modulePath,
    filename: modulePath,
    loaded: true,
    exports,
  };
}

function loadRouter(enabled = true) {
  setCached(controllerPath, {
    ingestTelemetry: vi.fn((_req, res) => res.status(200).json({ success: true })),
  });
  setCached(gatePath, {
    testSupportRoutesEnabled: vi.fn(() => enabled),
    requireTestSupportSecret: (_req, _res, next) => next(),
  });
  setCached(machineGatePath, {
    requireMachineIngestSecret: (_req, _res, next) => next(),
  });
  delete require.cache[routePath];
  return require(routePath);
}

function makeApp(router, telemetryMonitor) {
  const app = express();
  app.use(express.json());
  if (telemetryMonitor !== undefined) app.locals.telemetryMonitor = telemetryMonitor;
  app.use('/iot', router);
  return app;
}

afterEach(() => {
  for (const modulePath of [routePath, controllerPath, gatePath, machineGatePath]) {
    delete require.cache[modulePath];
  }
});

describe('iot.routes test-support item 8 branches', () => {
  it('does not register monitor routes when the registration gate is disabled', async () => {
    const response = await request(makeApp(loadRouter(false), {}))
      .post('/iot/telemetry-monitor/run-cycle');
    expect(response.status).toBe(404);
  });

  it('run-cycle returns 503 without a monitor, 200 on success, and 500 on both Error/string failures', async () => {
    let response = await request(makeApp(loadRouter(true), undefined))
      .post('/iot/telemetry-monitor/run-cycle');
    expect(response.status).toBe(503);

    const monitor = { checkMissingReadings: vi.fn().mockResolvedValue(undefined) };
    response = await request(makeApp(loadRouter(true), monitor))
      .post('/iot/telemetry-monitor/run-cycle');
    expect(response.status).toBe(200);
    expect(monitor.checkMissingReadings).toHaveBeenCalledOnce();

    monitor.checkMissingReadings.mockRejectedValueOnce(new Error('missing-readings failed'));
    response = await request(makeApp(loadRouter(true), monitor))
      .post('/iot/telemetry-monitor/run-cycle');
    expect(response.status).toBe(500);
    expect(response.body.error).toBe('missing-readings failed');

    monitor.checkMissingReadings.mockRejectedValueOnce('raw missing failure');
    response = await request(makeApp(loadRouter(true), monitor))
      .post('/iot/telemetry-monitor/run-cycle');
    expect(response.status).toBe(500);
    expect(response.body.error).toBe('raw missing failure');
  });

  it('find-critical-freezers applies only provided overrides and restores them after success', async () => {
    const monitor = {
      criticalDurationHours: 12,
      lookbackHours: 24,
      expectedReadingIntervalMinutes: 5,
      findCriticalFreezers: vi.fn().mockResolvedValue([{ freezerId: 'F-1' }]),
    };
    const response = await request(makeApp(loadRouter(true), monitor))
      .post('/iot/telemetry-monitor/find-critical-freezers')
      .send({ criticalDurationHours: '2', expectedReadingIntervalMinutes: '1' });

    expect(response.status).toBe(200);
    expect(response.body.criticalFreezers).toEqual([{ freezerId: 'F-1' }]);
    expect(monitor.findCriticalFreezers).toHaveBeenCalledOnce();
    expect(monitor.criticalDurationHours).toBe(12);
    expect(monitor.lookbackHours).toBe(24);
    expect(monitor.expectedReadingIntervalMinutes).toBe(5);
  });

  it('find-critical-freezers covers missing monitor and string-error fallback while restoring overrides', async () => {
    let response = await request(makeApp(loadRouter(true), undefined))
      .post('/iot/telemetry-monitor/find-critical-freezers');
    expect(response.status).toBe(503);

    const monitor = {
      criticalDurationHours: 12,
      lookbackHours: 24,
      expectedReadingIntervalMinutes: 5,
      findCriticalFreezers: vi.fn().mockRejectedValue('raw critical failure'),
    };
    response = await request(makeApp(loadRouter(true), monitor))
      .post('/iot/telemetry-monitor/find-critical-freezers')
      .send({ lookbackHours: '3' });

    expect(response.status).toBe(500);
    expect(response.body.error).toBe('raw critical failure');
    expect(monitor.lookbackHours).toBe(24);
  });

  it('run-cycle-full covers missing monitor, success with overrides, and Error fallback', async () => {
    let response = await request(makeApp(loadRouter(true), undefined))
      .post('/iot/telemetry-monitor/run-cycle-full');
    expect(response.status).toBe(503);

    const monitor = {
      criticalDurationHours: 12,
      lookbackHours: 24,
      expectedReadingIntervalMinutes: 5,
      runCycle: vi.fn().mockResolvedValue(undefined),
    };
    response = await request(makeApp(loadRouter(true), monitor))
      .post('/iot/telemetry-monitor/run-cycle-full')
      .send({ criticalDurationHours: '4', lookbackHours: '6', expectedReadingIntervalMinutes: '2' });
    expect(response.status).toBe(200);
    expect(monitor.criticalDurationHours).toBe(12);
    expect(monitor.lookbackHours).toBe(24);
    expect(monitor.expectedReadingIntervalMinutes).toBe(5);

    monitor.runCycle.mockRejectedValueOnce(new Error('cycle failed'));
    response = await request(makeApp(loadRouter(true), monitor))
      .post('/iot/telemetry-monitor/run-cycle-full');
    expect(response.status).toBe(500);
    expect(response.body.error).toBe('cycle failed');
  });
});
