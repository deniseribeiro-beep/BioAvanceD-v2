import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// src/workers/import-worker.js uses `const { Worker } = require('bullmq')` and
// several other require()-based destructured/plain imports, plus module-level
// mutable state (worker/notificationWorker/db). Per this repo's testing
// conventions, vi.mock()/vi.spyOn() do not reliably intercept require()-based
// destructured imports here. We inject fakes directly into Node's
// require.cache (same pattern as tests/unit/queue.config.test.js) BEFORE each
// fresh require of import-worker.js, clearing import-worker.js's own cache
// entry each time so the destructuring re-runs against our fakes and the
// module-level state starts clean per test.

const importWorkerPath = require.resolve('../../src/workers/import-worker');
const bullmqPath = require.resolve('bullmq');
const redisConfigPath = require.resolve('../../src/config/redis');
const queueConfigPath = require.resolve('../../src/config/queue');
const validateEnvPath = require.resolve('../../src/config/validateEnv');
const mongoPath = require.resolve('../../src/database/mongo');
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

let FakeWorker;
let fakeWorkerInstances;
let fakeValidateEnv;
let fakeRedisModule;
let fakeQueueConfig;
let fakeMongo;
let fakePatientWorker;
let fakeSampleWorker;
let fakeResultWorker;
let fakeTemperatureWorker;
let fakeImportAsyncService;
let fakeBatchValidationEngine;
let fakeAuditLogger;
let fakeNotificationService;
let fakeIotStreamingService;
let fakeDb;
let fakeLogger;

function makeWorkerResult(overrides = {}) {
  return {
    total: 10,
    success: 8,
    errors: [],
    processingTime: 100,
    fhirResourcesCreated: 2,
    fhirResourcesUpdated: 0,
    fhirResources: [],
    ...overrides,
  };
}

function installFakes() {
  fakeWorkerInstances = [];

  FakeWorker = vi.fn(function FakeWorkerCtor(queueName, processorFn, opts) {
    this.queueName = queueName;
    this.processor = processorFn;
    this.opts = opts;
    this.listeners = {};
    this.on = vi.fn((event, handler) => {
      this.listeners[event] = handler;
    });
    this.close = vi.fn().mockResolvedValue(undefined);
    fakeWorkerInstances.push(this);
  });

  require.cache[bullmqPath] = {
    id: bullmqPath,
    filename: bullmqPath,
    loaded: true,
    exports: { Worker: FakeWorker },
  };

  fakeValidateEnv = {
    validateRedisOnly: vi.fn().mockReturnValue(true),
  };
  require.cache[validateEnvPath] = {
    id: validateEnvPath,
    filename: validateEnvPath,
    loaded: true,
    exports: fakeValidateEnv,
  };

  fakeRedisModule = { marker: 'fake-redis-instance' };
  require.cache[redisConfigPath] = {
    id: redisConfigPath,
    filename: redisConfigPath,
    loaded: true,
    exports: fakeRedisModule,
  };

  fakeQueueConfig = {
    initRedis: vi.fn().mockReturnValue({ connMarker: 'fake-connection' }),
  };
  require.cache[queueConfigPath] = {
    id: queueConfigPath,
    filename: queueConfigPath,
    loaded: true,
    exports: fakeQueueConfig,
  };

  fakeDb = {
    collection: vi.fn(() => ({
      updateOne: vi.fn().mockResolvedValue({ acknowledged: true }),
    })),
  };
  fakeMongo = {
    connectDB: vi.fn().mockResolvedValue(fakeDb),
  };
  require.cache[mongoPath] = {
    id: mongoPath,
    filename: mongoPath,
    loaded: true,
    exports: fakeMongo,
  };

  fakePatientWorker = { process: vi.fn().mockResolvedValue(makeWorkerResult()) };
  require.cache[patientWorkerPath] = {
    id: patientWorkerPath,
    filename: patientWorkerPath,
    loaded: true,
    exports: fakePatientWorker,
  };

  fakeSampleWorker = { process: vi.fn().mockResolvedValue(makeWorkerResult()) };
  require.cache[sampleWorkerPath] = {
    id: sampleWorkerPath,
    filename: sampleWorkerPath,
    loaded: true,
    exports: fakeSampleWorker,
  };

  fakeResultWorker = { process: vi.fn().mockResolvedValue(makeWorkerResult()) };
  require.cache[resultWorkerPath] = {
    id: resultWorkerPath,
    filename: resultWorkerPath,
    loaded: true,
    exports: fakeResultWorker,
  };

  fakeTemperatureWorker = { process: vi.fn().mockResolvedValue(makeWorkerResult()) };
  require.cache[temperatureWorkerPath] = {
    id: temperatureWorkerPath,
    filename: temperatureWorkerPath,
    loaded: true,
    exports: fakeTemperatureWorker,
  };

  fakeImportAsyncService = { saveMetrics: vi.fn().mockResolvedValue(undefined) };
  require.cache[importAsyncServicePath] = {
    id: importAsyncServicePath,
    filename: importAsyncServicePath,
    loaded: true,
    exports: fakeImportAsyncService,
  };

  fakeBatchValidationEngine = {
    processBatchImport: vi.fn().mockResolvedValue({
      processedRows: 5,
      validRows: 5,
      invalidRows: 0,
      partialRows: 0,
    }),
    updateProgress: vi.fn().mockResolvedValue(undefined),
  };
  require.cache[batchValidationEnginePath] = {
    id: batchValidationEnginePath,
    filename: batchValidationEnginePath,
    loaded: true,
    exports: fakeBatchValidationEngine,
  };

  fakeAuditLogger = {
    init: vi.fn(),
    logImport: vi.fn().mockResolvedValue(undefined),
    logError: vi.fn().mockResolvedValue(undefined),
  };
  require.cache[auditLoggerPath] = {
    id: auditLoggerPath,
    filename: auditLoggerPath,
    loaded: true,
    exports: fakeAuditLogger,
  };

  fakeNotificationService = {
    notifyJobStarted: vi.fn().mockResolvedValue(undefined),
    notifyJobCompleted: vi.fn().mockResolvedValue(undefined),
    notifyJobFailed: vi.fn().mockResolvedValue(undefined),
    processConsentNotificationJob: vi.fn().mockResolvedValue(undefined),
  };
  require.cache[notificationServicePath] = {
    id: notificationServicePath,
    filename: notificationServicePath,
    loaded: true,
    exports: fakeNotificationService,
  };

  fakeIotStreamingService = {
    processTemperatureData: vi.fn().mockResolvedValue(undefined),
  };
  require.cache[iotStreamingServicePath] = {
    id: iotStreamingServicePath,
    filename: iotStreamingServicePath,
    loaded: true,
    exports: fakeIotStreamingService,
  };

  fakeLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
  require.cache[loggerPath] = {
    id: loggerPath,
    filename: loggerPath,
    loaded: true,
    exports: fakeLogger,
  };
}

function freshImportWorkerModule() {
  delete require.cache[importWorkerPath];
  return require(importWorkerPath);
}

function clearAllCaches() {
  delete require.cache[importWorkerPath];
  delete require.cache[bullmqPath];
  delete require.cache[redisConfigPath];
  delete require.cache[queueConfigPath];
  delete require.cache[validateEnvPath];
  delete require.cache[mongoPath];
  delete require.cache[patientWorkerPath];
  delete require.cache[sampleWorkerPath];
  delete require.cache[resultWorkerPath];
  delete require.cache[temperatureWorkerPath];
  delete require.cache[importAsyncServicePath];
  delete require.cache[batchValidationEnginePath];
  delete require.cache[auditLoggerPath];
  delete require.cache[notificationServicePath];
  delete require.cache[iotStreamingServicePath];
  delete require.cache[loggerPath];
}

describe('workers/import-worker', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    installFakes();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.env.NODE_ENV = originalNodeEnv;
    clearAllCaches();
  });

  describe('initWorker', () => {
    it('returns the cached worker on a second call without re-validating Redis or reconnecting Mongo', async () => {
      process.env.NODE_ENV = 'test';
      const importWorker = freshImportWorkerModule();

      const first = await importWorker.initWorker();
      const second = await importWorker.initWorker();

      expect(second).toBe(first);
      expect(fakeValidateEnv.validateRedisOnly).toHaveBeenCalledTimes(1);
      expect(fakeMongo.connectDB).toHaveBeenCalledTimes(1);
      expect(FakeWorker).toHaveBeenCalledTimes(2); // import-queue + notification-queue, once
    });

    it('throws "Redis não configurado" in development when validateRedisOnly is falsy, without connecting Mongo', async () => {
      process.env.NODE_ENV = 'development';
      fakeValidateEnv.validateRedisOnly.mockReturnValue(false);
      const importWorker = freshImportWorkerModule();

      await expect(importWorker.initWorker()).rejects.toThrow('Redis não configurado');
      expect(fakeMongo.connectDB).not.toHaveBeenCalled();
      expect(fakeLogger.warn).toHaveBeenCalled();
    });

    it('throws "Redis não foi inicializado" when initRedis() returns falsy', async () => {
      process.env.NODE_ENV = 'test';
      fakeQueueConfig.initRedis.mockReturnValue(null);
      const importWorker = freshImportWorkerModule();

      await expect(importWorker.initWorker()).rejects.toThrow('Redis não foi inicializado');
    });

    it('constructs the import-queue Worker and the notification-queue Worker on success', async () => {
      process.env.NODE_ENV = 'test';
      const importWorker = freshImportWorkerModule();

      await importWorker.initWorker();

      expect(FakeWorker).toHaveBeenCalledTimes(2);
      expect(fakeWorkerInstances[0].queueName).toBe('import-queue');
      expect(fakeWorkerInstances[1].queueName).toBe('notification-queue');
    });
  });

  describe('closeWorker', () => {
    it('closes both workers and resets module state so initWorker creates fresh instances afterward', async () => {
      process.env.NODE_ENV = 'test';
      const importWorker = freshImportWorkerModule();

      await importWorker.initWorker();
      const importWorkerInstance = fakeWorkerInstances[0];
      const notificationWorkerInstance = fakeWorkerInstances[1];

      await importWorker.closeWorker();

      expect(importWorkerInstance.close).toHaveBeenCalledTimes(1);
      expect(notificationWorkerInstance.close).toHaveBeenCalledTimes(1);

      // State reset: a subsequent initWorker() does NOT hit the early-return
      // short-circuit and constructs new Worker instances.
      await importWorker.initWorker();
      expect(FakeWorker).toHaveBeenCalledTimes(4);
    });

    it('is a no-op (does not throw) when called before any worker was initialized', async () => {
      process.env.NODE_ENV = 'test';
      const importWorker = freshImportWorkerModule();

      await expect(importWorker.closeWorker()).resolves.toBeUndefined();
    });
  });

  describe('import-queue processor', () => {
    async function getProcessor() {
      process.env.NODE_ENV = 'test';
      const importWorker = freshImportWorkerModule();
      await importWorker.initWorker();
      return fakeWorkerInstances[0].processor;
    }

    it('throws when dataType is missing/empty', async () => {
      const processor = await getProcessor();
      const job = { id: 'j1', name: 'import', data: { jobID: 'j1', userID: 'u1', dataType: '' } };

      await expect(processor(job)).rejects.toThrow(/dataType ausente no job/);
    });

    it('throws for an unsupported dataType', async () => {
      const processor = await getProcessor();
      const job = {
        id: 'j2',
        name: 'import',
        data: { jobID: 'j2', userID: 'u1', dataType: 'bogus-type' },
      };

      await expect(processor(job)).rejects.toThrow('Tipo de dados não suportado: bogus-type');
    });

    it('normalizes dataType (trim + lowercase) and routes " Patients " to the patients worker', async () => {
      const processor = await getProcessor();
      const job = {
        id: 'j3',
        name: 'import',
        data: {
          jobID: 'j3',
          userID: 'u1',
          dataType: ' Patients ',
          filePath: '/tmp/patients.csv',
          fileName: 'patients.csv',
          options: { foo: 'bar' },
        },
      };

      const result = await processor(job);

      expect(fakePatientWorker.process).toHaveBeenCalledWith(fakeDb, 'j3', '/tmp/patients.csv', { foo: 'bar' });
      expect(result).toEqual(makeWorkerResult());
    });

    it('routes "samples" to the sample worker with the right args', async () => {
      const processor = await getProcessor();
      const job = {
        id: 'j4',
        name: 'import',
        data: {
          jobID: 'j4',
          userID: 'u1',
          dataType: 'samples',
          filePath: '/tmp/samples.csv',
          fileName: 'samples.csv',
          options: {},
        },
      };

      await processor(job);

      expect(fakeSampleWorker.process).toHaveBeenCalledWith(fakeDb, 'j4', '/tmp/samples.csv', {});
      expect(fakePatientWorker.process).not.toHaveBeenCalled();
    });

    it('routes "results" to the result worker with the right args', async () => {
      const processor = await getProcessor();
      const job = {
        id: 'j5',
        name: 'import',
        data: {
          jobID: 'j5',
          userID: 'u1',
          dataType: 'results',
          filePath: '/tmp/results.csv',
          fileName: 'results.csv',
          options: {},
        },
      };

      await processor(job);

      expect(fakeResultWorker.process).toHaveBeenCalledWith(fakeDb, 'j5', '/tmp/results.csv', {});
    });

    it('routes "temperature-iot" to iotStreamingService.processTemperatureData instead of a *Worker.process', async () => {
      const processor = await getProcessor();
      const job = {
        id: 'j6',
        name: 'import',
        data: {
          jobID: 'j6',
          userID: 'u1',
          dataType: 'temperature-iot',
          fileName: 'iot.json',
          temperatureData: { sensorId: 's1', value: 4.2 },
        },
      };

      const result = await processor(job);

      expect(fakeIotStreamingService.processTemperatureData).toHaveBeenCalledWith(
        fakeDb,
        { sensorId: 's1', value: 4.2 }
      );
      expect(fakeTemperatureWorker.process).not.toHaveBeenCalled();
      expect(result).toEqual({
        total: 1,
        success: 1,
        errors: [],
        processingTime: 0,
        fhirResourcesCreated: 1,
        fhirResourcesUpdated: 0,
        fhirResources: [],
      });
    });

    it('on success: updates job status to completed, saves metrics, logs import, and notifies completion', async () => {
      const processor = await getProcessor();
      const updateOneMock = vi.fn().mockResolvedValue({ acknowledged: true });
      fakeDb.collection.mockReturnValue({ updateOne: updateOneMock });

      const job = {
        id: 'j7',
        name: 'import',
        data: {
          jobID: 'j7',
          userID: 'u7',
          dataType: 'patients',
          filePath: '/tmp/p.csv',
          fileName: 'p.csv',
          options: {},
        },
      };

      await processor(job);

      // First updateOne call = 'processing', second = 'completed'
      expect(updateOneMock).toHaveBeenCalledTimes(2);
      expect(updateOneMock.mock.calls[1][1].$set.status).toBe('completed');

      expect(fakeImportAsyncService.saveMetrics).toHaveBeenCalledWith(
        fakeDb,
        expect.objectContaining({ jobID: 'j7', userID: 'u7', dataType: 'patients' })
      );
      expect(fakeAuditLogger.logImport).toHaveBeenCalledWith(
        null,
        'Patient',
        'completed',
        10,
        8,
        0,
        expect.objectContaining({ jobID: 'j7' })
      );
      expect(fakeNotificationService.notifyJobCompleted).toHaveBeenCalledWith(
        'u7',
        expect.objectContaining({ jobID: 'j7', status: 'completed' })
      );
    });

    it('on failure: updates job status to failed, logs error, notifies failure, and re-throws', async () => {
      const processor = await getProcessor();
      const boom = new Error('worker exploded');
      fakePatientWorker.process.mockRejectedValue(boom);

      const updateOneMock = vi.fn().mockResolvedValue({ acknowledged: true });
      fakeDb.collection.mockReturnValue({ updateOne: updateOneMock });

      const job = {
        id: 'j8',
        name: 'import',
        data: {
          jobID: 'j8',
          userID: 'u8',
          dataType: 'patients',
          filePath: '/tmp/p.csv',
          fileName: 'p.csv',
          options: {},
        },
      };

      await expect(processor(job)).rejects.toThrow('worker exploded');

      // First updateOne = 'processing', second = 'failed'
      expect(updateOneMock).toHaveBeenCalledTimes(2);
      expect(updateOneMock.mock.calls[1][1].$set.status).toBe('failed');

      expect(fakeAuditLogger.logError).toHaveBeenCalledWith(
        null,
        'Patient',
        boom,
        expect.objectContaining({ jobID: 'j8', dataType: 'patients' })
      );
      expect(fakeNotificationService.notifyJobFailed).toHaveBeenCalledWith(
        'u8',
        expect.objectContaining({ jobID: 'j8', status: 'failed', error: 'worker exploded' })
      );
    });
  });

  describe('import-queue processor: batch-import path', () => {
    async function getProcessor() {
      process.env.NODE_ENV = 'test';
      const importWorker = freshImportWorkerModule();
      await importWorker.initWorker();
      return fakeWorkerInstances[0].processor;
    }

    it('marks batch progress as "completed" when there are valid or partial rows', async () => {
      const processor = await getProcessor();
      fakeBatchValidationEngine.processBatchImport.mockResolvedValue({
        processedRows: 5,
        validRows: 3,
        invalidRows: 2,
        partialRows: 0,
      });

      const job = { id: 'b1', name: 'batch-import', data: { stagingImportId: 'stg-1' } };

      const result = await processor(job);

      expect(fakeBatchValidationEngine.updateProgress).toHaveBeenCalledWith('stg-1', {
        status: 'completed',
        processedRows: 5,
      });
      expect(result).toEqual({ processedRows: 5, validRows: 3, invalidRows: 2, partialRows: 0 });
    });

    it('marks batch progress as "failed" when invalidRows > 0 and validRows === 0 and partialRows === 0', async () => {
      const processor = await getProcessor();
      fakeBatchValidationEngine.processBatchImport.mockResolvedValue({
        processedRows: 5,
        validRows: 0,
        invalidRows: 5,
        partialRows: 0,
      });

      const job = { id: 'b2', name: 'batch-import', data: { stagingImportId: 'stg-2' } };

      await processor(job);

      expect(fakeBatchValidationEngine.updateProgress).toHaveBeenCalledWith('stg-2', {
        status: 'failed',
        processedRows: 5,
      });
    });

    it('on batch-import failure: marks batch progress as "failed" and re-throws (#46)', async () => {
      const processor = await getProcessor();
      const boom = new Error('batch exploded');
      fakeBatchValidationEngine.processBatchImport.mockRejectedValue(boom);

      const updateOneMock = vi.fn().mockResolvedValue({ acknowledged: true });
      fakeDb.collection.mockReturnValue({ updateOne: updateOneMock });

      const job = { id: 'b3', name: 'batch-import', data: { stagingImportId: 'stg-3' } };

      await expect(processor(job)).rejects.toThrow('batch exploded');

      expect(fakeBatchValidationEngine.updateProgress).toHaveBeenCalledWith('stg-3', {
        status: 'failed',
      });
      expect(updateOneMock).not.toHaveBeenCalled();
      expect(fakeAuditLogger.logError).not.toHaveBeenCalled();
      expect(fakeNotificationService.notifyJobFailed).not.toHaveBeenCalled();
    });
  });

  describe('notification-queue processor', () => {
    it('delegates "consent-notification" jobs to notificationService.processConsentNotificationJob', async () => {
      process.env.NODE_ENV = 'test';
      const importWorker = freshImportWorkerModule();
      await importWorker.initWorker();
      const notificationProcessor = fakeWorkerInstances[1].processor;

      const job = { name: 'consent-notification', data: { userId: 'u1', patientId: 'p1' } };
      await notificationProcessor(job);

      expect(fakeNotificationService.processConsentNotificationJob).toHaveBeenCalledWith({
        userId: 'u1',
        patientId: 'p1',
      });
    });

    it('returns null (without calling the notification service) for an unknown job name', async () => {
      process.env.NODE_ENV = 'test';
      const importWorker = freshImportWorkerModule();
      await importWorker.initWorker();
      const notificationProcessor = fakeWorkerInstances[1].processor;

      const job = { name: 'some-other-job', data: {} };
      const result = await notificationProcessor(job);

      expect(result).toBeNull();
      expect(fakeNotificationService.processConsentNotificationJob).not.toHaveBeenCalled();
    });
  });
});
