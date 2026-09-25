import { afterEach, describe, expect, it, vi } from 'vitest';

const importWorkerPath = require.resolve('../../src/workers/import-worker');
const bullmqPath = require.resolve('bullmq');
const redisConfigPath = require.resolve('../../src/config/redis');
const queueConfigPath = require.resolve('../../src/config/queue');
const validateEnvPath = require.resolve('../../src/config/validateEnv');
const mongoPath = require.resolve('../../src/database/mongo');
const mongooseConnectionPath = require.resolve('../../src/infrastructure/database/mongodb/connection');
const patientWorkerPath = require.resolve('../../src/workers/workers/patient-worker');
const sampleWorkerPath = require.resolve('../../src/workers/workers/sample-worker');
const resultWorkerPath = require.resolve('../../src/workers/workers/result-worker');
const temperatureWorkerPath = require.resolve('../../src/workers/workers/temperature-worker');
const importAsyncServicePath = require.resolve('../../src/services/import-async.service');
const batchValidationEnginePath = require.resolve('../../src/services/batch-validation-engine.service');
const auditLoggerPath = require.resolve('../../src/utils/auditLogger');
const notificationServicePath = require.resolve('../../src/services/notification.service');
const iotStreamingServicePath = require.resolve('../../src/services/iot-streaming.service');
const loggerPath = require.resolve('../../src/utils/logger');
const neo4jConnectionPath = require.resolve('../../src/infrastructure/database/neo4j/connection');

let fakeWorkerInstances;
let fakeLogger;

function installFakes() {
  fakeWorkerInstances = [];
  const FakeWorker = vi.fn(function FakeWorkerCtor(queueName) {
    this.queueName = queueName;
    this.listeners = {};
    this.on = vi.fn((event, handler) => {
      this.listeners[event] = handler;
    });
    this.close = vi.fn().mockResolvedValue(undefined);
    fakeWorkerInstances.push(this);
  });

  require.cache[bullmqPath] = {
    id: bullmqPath, filename: bullmqPath, loaded: true,
    exports: { Worker: FakeWorker },
  };
  require.cache[validateEnvPath] = {
    id: validateEnvPath, filename: validateEnvPath, loaded: true,
    exports: { validateRedisOnly: vi.fn().mockReturnValue(true) },
  };
  require.cache[redisConfigPath] = {
    id: redisConfigPath, filename: redisConfigPath, loaded: true,
    exports: { marker: 'fake-redis' },
  };
  require.cache[queueConfigPath] = {
    id: queueConfigPath, filename: queueConfigPath, loaded: true,
    exports: { initRedis: vi.fn().mockReturnValue({ connMarker: 'fake-connection' }) },
  };
  require.cache[mongoPath] = {
    id: mongoPath, filename: mongoPath, loaded: true,
    exports: {
      connectDB: vi.fn().mockResolvedValue({
        collection: vi.fn(() => ({ updateOne: vi.fn().mockResolvedValue({}) })),
      }),
    },
  };
  require.cache[mongooseConnectionPath] = {
    id: mongooseConnectionPath, filename: mongooseConnectionPath, loaded: true,
    exports: {
      connectMongoDB: vi.fn().mockResolvedValue({ readyState: 1 }),
      getMongoDBConnection: vi.fn(),
      closeMongoDBConnection: vi.fn().mockResolvedValue(undefined),
    },
  };
  for (const [path, exports] of [
    [patientWorkerPath, { process: vi.fn() }],
    [sampleWorkerPath, { process: vi.fn() }],
    [resultWorkerPath, { process: vi.fn() }],
    [temperatureWorkerPath, { process: vi.fn() }],
    [importAsyncServicePath, {}],
    [batchValidationEnginePath, {}],
    [auditLoggerPath, { init: vi.fn(), log: vi.fn() }],
    [notificationServicePath, { processConsentNotificationJob: vi.fn() }],
    [iotStreamingServicePath, {}],
    [neo4jConnectionPath, { connectNeo4j: async () => null }],
  ]) {
    require.cache[path] = { id: path, filename: path, loaded: true, exports };
  }

  fakeLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  require.cache[loggerPath] = {
    id: loggerPath, filename: loggerPath, loaded: true, exports: fakeLogger,
  };
}

function freshImportWorker() {
  installFakes();
  delete require.cache[importWorkerPath];
  return require('../../src/workers/import-worker');
}

afterEach(() => {
  vi.restoreAllMocks();
  delete require.cache[importWorkerPath];
});

describe('import-worker item 8 residual branches', () => {
  it('logs the failure stack when the import-queue failed listener receives an Error with stack', async () => {
    process.env.NODE_ENV = 'test';
    const importWorker = freshImportWorker();
    await importWorker.initWorker();

    const failed = fakeWorkerInstances[0].listeners.failed;
    const err = new Error('queued job exploded');
    failed({ id: 'job-stack' }, err);

    expect(fakeLogger.error).toHaveBeenCalledWith('❌ Job job-stack falhou:', 'queued job exploded');
    expect(fakeLogger.error).toHaveBeenCalledWith(`Rastreamento: ${err.stack}`);
  });

  it('closes both workers when closeWorker runs after init', async () => {
    process.env.NODE_ENV = 'test';
    const importWorker = freshImportWorker();
    await importWorker.initWorker();
    const [importInstance, notificationInstance] = fakeWorkerInstances;

    await importWorker.closeWorker();

    expect(importInstance.close).toHaveBeenCalledTimes(1);
    expect(notificationInstance.close).toHaveBeenCalledTimes(1);
    expect(fakeLogger.info).toHaveBeenCalledWith('✅ Worker fechado');
    expect(fakeLogger.info).toHaveBeenCalledWith('✅ Worker de notificações fechado');
  });
});
