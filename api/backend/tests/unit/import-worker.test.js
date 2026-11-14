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
const jobMetricsPath = require.resolve('../../src/infrastructure/metrics/jobMetrics');

let FakeWorker;
let fakeWorkerInstances;
let fakeValidateEnv;
let fakeRedisModule;
let fakeQueueConfig;
let fakeMongo;
let fakeMongooseConnection;
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
let fakeNeo4jConnection;
// #1468: what the fake withJobMetrics saw per processed job. The real
// recordJob would add an updateOne to fakeDb's shared collection; its own
// behaviour is proven in tests/unit/infrastructure/metrics/jobMetrics.test.js.
let metricCalls;

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

  // #826: the worker needs the Mongoose connection too -- connectDB() above is
  // the native driver only, and StagingImport (reached via
  // batch-validation-engine) is a Mongoose model whose writes silently buffer
  // and time out after 10s without it.
  fakeMongooseConnection = {
    connectMongoDB: vi.fn().mockResolvedValue({ readyState: 1 }),
    getMongoDBConnection: vi.fn(),
    closeMongoDBConnection: vi.fn().mockResolvedValue(undefined),
  };
  require.cache[mongooseConnectionPath] = {
    id: mongooseConnectionPath,
    filename: mongooseConnectionPath,
    loaded: true,
    exports: fakeMongooseConnection,
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
    recordAttemptFailure: vi.fn().mockResolvedValue(undefined),
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

  fakeNeo4jConnection = {
    connectNeo4j: vi.fn().mockResolvedValue({ marker: 'fake-neo4j-driver' }),
  };
  require.cache[neo4jConnectionPath] = {
    id: neo4jConnectionPath,
    filename: neo4jConnectionPath,
    loaded: true,
    exports: fakeNeo4jConnection,
  };

  metricCalls = [];
  const { currentRequestId } = require('../../src/utils/requestContext');
  require.cache[jobMetricsPath] = {
    id: jobMetricsPath,
    filename: jobMetricsPath,
    loaded: true,
    exports: {
      withJobMetrics: (worker, getDb, processor) => (job, ...rest) => {
        metricCalls.push({ worker, job: job && job.name, requestId: currentRequestId() });
        return processor(job, ...rest);
      },
    },
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
  delete require.cache[mongooseConnectionPath];
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
  delete require.cache[neo4jConnectionPath];
  delete require.cache[jobMetricsPath];
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
      // #826: the Mongoose connection is opened once, alongside the native one.
      expect(fakeMongooseConnection.connectMongoDB).toHaveBeenCalledTimes(1);
      expect(FakeWorker).toHaveBeenCalledTimes(2); // import-queue + notification-queue, once
    });

    it('throws "Redis não configurado" in development when validateRedisOnly is falsy, without connecting Mongo', async () => {
      process.env.NODE_ENV = 'development';
      fakeValidateEnv.validateRedisOnly.mockReturnValue(false);
      const importWorker = freshImportWorkerModule();

      await expect(importWorker.initWorker()).rejects.toThrow('Redis não configurado');
      expect(fakeMongo.connectDB).not.toHaveBeenCalled();
      expect(fakeMongooseConnection.connectMongoDB).not.toHaveBeenCalled();
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

    it('#971: defaults the import-queue Worker to concurrency 1, so two jobs cannot interleave a duplicate check with its insert', async () => {
      process.env.NODE_ENV = 'test';
      delete process.env.WORKER_CONCURRENCY;
      const importWorker = freshImportWorkerModule();

      await importWorker.initWorker();

      // Every duplicate check on the import path is a non-atomic
      // read-then-write (checkDuplicatePatient / findOne({barcode}) followed
      // by insertOne). Within one job the loop awaits each insert, so rows in
      // one file are safe; ACROSS jobs nothing serialises them, and
      // participants have no unique index to catch the loser. Until one
      // exists (#941), the default has to be 1.
      expect(fakeWorkerInstances[0].opts.concurrency).toBe(1);
    });

    it('#971: still honours an explicit WORKER_CONCURRENCY override, so the safe default is not a hard cap', async () => {
      process.env.NODE_ENV = 'test';
      process.env.WORKER_CONCURRENCY = '4';
      const importWorker = freshImportWorkerModule();

      try {
        await importWorker.initWorker();
        expect(fakeWorkerInstances[0].opts.concurrency).toBe(4);
      } finally {
        delete process.env.WORKER_CONCURRENCY;
      }
    });
  });

  // RF022 AC4/AC9, RNF014 C7: with FOUNDATION_READINESS_REQUIRED, initWorker
  // consumes no queue unless the newest ReadinessReport is ready for this
  // build's release. The real readiness module reads an in-memory db.
  describe('#1551 initWorker Foundation readiness gate', () => {
    const env = require('../../src/config/env');
    const { createFakeDb } = require('./foundation/helpers/fake-db');
    const ReadinessReportModel = require('../../src/models/ReadinessReport');
    const { CANONICAL_MODEL_RELEASE_ID } = require('../../src/foundation/readiness');
    let requiredBefore;

    beforeEach(() => {
      requiredBefore = env.FOUNDATION_READINESS_REQUIRED;
      env.FOUNDATION_READINESS_REQUIRED = true;
      process.env.NODE_ENV = 'test';
    });
    afterEach(() => {
      env.FOUNDATION_READINESS_REQUIRED = requiredBefore;
    });

    async function dbWithReport(gateResults, canonicalModelReleaseId = CANONICAL_MODEL_RELEASE_ID) {
      const db = createFakeDb();
      if (gateResults) {
        await db.collection('readinessReports').insertOne(ReadinessReportModel.create({
          foundationDataRunId: 'run-1',
          canonicalModelReleaseId,
          environment: env.NODE_ENV,
          gateResults,
        }));
      }
      return db;
    }

    async function expectRefusal(db) {
      fakeMongo.connectDB.mockResolvedValue(db);
      const importWorker = freshImportWorkerModule();

      await expect(importWorker.initWorker()).rejects.toMatchObject({ name: 'FoundationNotReadyError' });
      expect(FakeWorker).not.toHaveBeenCalled();
      expect(fakeQueueConfig.initRedis).not.toHaveBeenCalled();
      expect(fakeMongooseConnection.connectMongoDB).not.toHaveBeenCalled();
    }

    it('refuses with no ReadinessReport before any Worker is built', async () => {
      await expectRefusal(await dbWithReport(null));
    });

    it('refuses a blocked ReadinessReport before any Worker is built', async () => {
      await expectRefusal(await dbWithReport([{ gate: 'version', result: 'fail', p0: true }]));
    });

    it('refuses a ready ReadinessReport of another release before any Worker is built', async () => {
      await expectRefusal(await dbWithReport([{ gate: 'version', result: 'pass', p0: true }], 'release-1.3.0'));
    });

    it('builds both Workers on a ready ReadinessReport for this release', async () => {
      fakeMongo.connectDB.mockResolvedValue(await dbWithReport([{ gate: 'version', result: 'pass', p0: true }]));
      const importWorker = freshImportWorkerModule();

      await expect(importWorker.initWorker()).resolves.toBeTruthy();
      expect(FakeWorker).toHaveBeenCalledTimes(2);
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

    // #1323: RNF015 C1 -- the job runs under the request id it was enqueued with.
    it('runs the job under the request id carried in its data', async () => {
      const { currentRequestId } = require('../../src/utils/requestContext');
      let seen;
      fakePatientWorker.process.mockImplementation(async () => {
        seen = currentRequestId();
        return makeWorkerResult();
      });
      const processor = await getProcessor();
      const job = {
        id: 'j-req',
        name: 'import',
        data: {
          jobID: 'j-req',
          dataType: 'patients',
          filePath: '/tmp/p.csv',
          fileName: 'p.csv',
          options: {},
          requestId: 'req-job-0002',
        },
      };

      await processor(job);

      expect(fakePatientWorker.process).toHaveBeenCalled();
      expect(seen).toBe('req-job-0002');
    });

    // #1468: RNF015 C1/C3 -- each processed job is recorded under its queue
    // and name, inside its request context.
    it('#1468 records the processed job as import-queue:<name> under its request id', async () => {
      const processor = await getProcessor();
      const job = {
        id: 'j-metric',
        name: 'import',
        data: {
          jobID: 'j-metric',
          dataType: 'patients',
          filePath: '/tmp/p.csv',
          fileName: 'p.csv',
          options: {},
          requestId: 'req-job-0003',
        },
      };

      await processor(job);

      expect(metricCalls).toEqual([{ worker: 'import-queue', job: 'import', requestId: 'req-job-0003' }]);
    });

    it('routes "samples" to the sample worker with userID and a connected Neo4j driver threaded through options (#483)', async () => {
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
          options: { foo: 'bar' },
        },
      };

      await processor(job);

      expect(fakeNeo4jConnection.connectNeo4j).toHaveBeenCalledTimes(1);
      expect(fakeSampleWorker.process).toHaveBeenCalledWith(fakeDb, 'j4', '/tmp/samples.csv', {
        foo: 'bar',
        userID: 'u1',
        neo4jDriver: { marker: 'fake-neo4j-driver' },
      });
      expect(fakePatientWorker.process).not.toHaveBeenCalled();
    });

    it('routes "samples" with neo4jDriver: null (fail-open) when Neo4j is unavailable (#483)', async () => {
      fakeNeo4jConnection.connectNeo4j.mockRejectedValue(new Error('Neo4j indisponível'));
      const processor = await getProcessor();
      const job = {
        id: 'j4b',
        name: 'import',
        data: {
          jobID: 'j4b',
          userID: 'u1',
          dataType: 'samples',
          filePath: '/tmp/samples.csv',
          fileName: 'samples.csv',
          options: {},
        },
      };

      await processor(job);

      expect(fakeSampleWorker.process).toHaveBeenCalledWith(fakeDb, 'j4b', '/tmp/samples.csv', {
        userID: 'u1',
        neo4jDriver: null,
      });
      expect(fakeLogger.warn).toHaveBeenCalledWith(expect.stringContaining('Neo4j indisponível'));
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
        expect.objectContaining({ jobID: 'j7' }),
        // #1105: the worker declares its own dict-02 P1X-0331 origin.
        { source: 'worker' }
      );
      expect(fakeNotificationService.notifyJobCompleted).toHaveBeenCalledWith(
        'u7',
        expect.objectContaining({ jobID: 'j7', status: 'completed' })
      );
    });

    // #931: processingTime was already computed by the sub-workers but never
    // reached the job document; skippedRecords surfaces results.skipped
    // (dropped at the worker boundary until now).
    it('#931: on success, the completion payload carries real processingTime and skippedRecords from the result', async () => {
      const processor = await getProcessor();
      fakePatientWorker.process.mockResolvedValue(makeWorkerResult({ skipped: 3, processingTime: 12.5 }));

      const updateOneMock = vi.fn().mockResolvedValue({ acknowledged: true });
      fakeDb.collection.mockReturnValue({ updateOne: updateOneMock });

      const job = {
        id: 'j7d',
        name: 'import',
        data: {
          jobID: 'j7d',
          userID: 'u7d',
          dataType: 'patients',
          filePath: '/tmp/p.csv',
          fileName: 'p.csv',
          options: {},
        },
      };

      await processor(job);

      const completeWrite = updateOneMock.mock.calls[1][1].$set;
      expect(completeWrite.processingTime).toBe(12.5);
      expect(completeWrite.skippedRecords).toBe(3);
    });

    // #931/#1007: an older or partial result carrying neither field must not
    // write `undefined` onto the job document -- and, since #1007, must not
    // write a fabricated `0` either. processingTime keeps its `|| 0` default
    // (ResultsPage guards that one on truthiness, not on definedness); the two
    // COUNTED fields are omitted instead, so ResultsPage's `!== undefined`
    // gate can do the job #925 wrote it for.
    it('#931/#1007: on success, the completion payload defaults processingTime to 0 but OMITS skippedRecords/duplicatesFound when the result lacks them', async () => {
      const processor = await getProcessor();
      fakePatientWorker.process.mockResolvedValue({
        total: 10,
        success: 8,
        errors: [],
      });

      const updateOneMock = vi.fn().mockResolvedValue({ acknowledged: true });
      fakeDb.collection.mockReturnValue({ updateOne: updateOneMock });

      const job = {
        id: 'j7e',
        name: 'import',
        data: {
          jobID: 'j7e',
          userID: 'u7e',
          dataType: 'patients',
          filePath: '/tmp/p.csv',
          fileName: 'p.csv',
          options: {},
        },
      };

      await processor(job);

      const completeWrite = updateOneMock.mock.calls[1][1].$set;
      expect(completeWrite.processingTime).toBe(0);
      expect('skippedRecords' in completeWrite).toBe(false);
      expect('duplicatesFound' in completeWrite).toBe(false);
    });

    // #931: duplicatesFound is the third field, and the one that needed a
    // decision rather than plumbing. It is a LABELLED SUBSET of errorCount --
    // all three detection sites in import-lgpd.service push onto `errors` and
    // `continue`, so the row is already counted there. The arithmetic below
    // is the property under test, and it is deliberate: success + errors +
    // duplicates exceeds total.
    it('#931: duplicatesFound is written as a subset of errorCount, not a separate bucket', async () => {
      const processor = await getProcessor();
      fakePatientWorker.process.mockResolvedValue(
        makeWorkerResult({
          total: 10,
          success: 6,
          // 4 rejections, of which 3 were duplicates
          errors: [{ row: 2 }, { row: 3 }, { row: 4 }, { row: 5 }],
          duplicates: 3,
          skipped: 0,
          processingTime: 1,
        })
      );

      const updateOneMock = vi.fn().mockResolvedValue({ acknowledged: true });
      fakeDb.collection.mockReturnValue({ updateOne: updateOneMock });

      const job = {
        id: 'j7f',
        name: 'import',
        data: {
          jobID: 'j7f',
          userID: 'u7f',
          dataType: 'patients',
          filePath: '/tmp/p.csv',
          fileName: 'p.csv',
          options: {},
        },
      };

      await processor(job);

      const completeWrite = updateOneMock.mock.calls[1][1].$set;
      expect(completeWrite.duplicatesFound).toBe(3);
      // Still inside errorCount, not carved out of it.
      expect(completeWrite.errorCount).toBe(4);
      expect(completeWrite.successCount).toBe(6);
      expect(completeWrite.totalRecords).toBe(10);
      expect(completeWrite.duplicatesFound).toBeLessThanOrEqual(completeWrite.errorCount);
      // The arithmetic the label "(dos quais)" exists to explain.
      expect(
        completeWrite.successCount + completeWrite.errorCount + completeWrite.duplicatesFound
      ).toBeGreaterThan(completeWrite.totalRecords);
    });

    // #1007: ResultsPage gates the "Ignorados"/"Duplicados" tiles on
    // `!== undefined` precisely so an UNCOUNTED job omits the tile instead of
    // claiming zero (#925). `|| 0` here guaranteed definedness, so the gate
    // could never fire and every `results` job -- the only kind ResultsPage
    // can display -- was shown "Ignorados: 0" as an affirmative claim about a
    // number nothing measured. result-worker.js and temperature-worker.js
    // return neither field in any branch; patient-worker/sample-worker always
    // do (import-lgpd.service initialises both to 0), so the LGPD tiles keep
    // showing a real, measured zero.
    it('#1007: a worker result that counted neither field omits skippedRecords and duplicatesFound entirely', async () => {
      const processor = await getProcessor();
      // The literal shape ResultWorker.process returns -- no `skipped`, no
      // `duplicates`, in any of its .zip/.raw/.csv branches.
      fakeResultWorker.process.mockResolvedValue({
        total: 10,
        success: 8,
        errors: [],
        unprocessedFormats: 0,
        processingTime: 4.2,
        fhirResourcesCreated: 2,
        fhirResourcesUpdated: 0,
        fhirResources: [],
      });

      const updateOneMock = vi.fn().mockResolvedValue({ acknowledged: true });
      fakeDb.collection.mockReturnValue({ updateOne: updateOneMock });

      const job = {
        id: 'j7g',
        name: 'import',
        data: {
          jobID: 'j7g',
          userID: 'u7g',
          dataType: 'results',
          filePath: '/tmp/r.csv',
          fileName: 'r.csv',
          options: {},
        },
      };

      await processor(job);

      const completeWrite = updateOneMock.mock.calls[1][1].$set;
      // Absent, not zero -- `in` rather than a value assertion, because a
      // literal 0 is exactly what this issue is about.
      expect('skippedRecords' in completeWrite).toBe(false);
      expect('duplicatesFound' in completeWrite).toBe(false);
      // The rest of the completion payload is unaffected.
      expect(completeWrite.status).toBe('completed');
      expect(completeWrite.totalRecords).toBe(10);
      expect(completeWrite.successCount).toBe(8);
    });

    // #1007 control: a worker that DID count keeps writing both fields,
    // including a genuine zero. Expected behaviour is identical before and
    // after the fix, so this must be green in the pre-fix run -- it is what
    // separates a real reproduction from a setup-shaped red.
    it('#1007 control: a worker result that counted both fields still writes them, zero included', async () => {
      const processor = await getProcessor();
      fakePatientWorker.process.mockResolvedValue(
        makeWorkerResult({ skipped: 0, duplicates: 0, processingTime: 1.5 })
      );

      const updateOneMock = vi.fn().mockResolvedValue({ acknowledged: true });
      fakeDb.collection.mockReturnValue({ updateOne: updateOneMock });

      const job = {
        id: 'j7h',
        name: 'import',
        data: {
          jobID: 'j7h',
          userID: 'u7h',
          dataType: 'patients',
          filePath: '/tmp/p.csv',
          fileName: 'p.csv',
          options: {},
        },
      };

      await processor(job);

      const completeWrite = updateOneMock.mock.calls[1][1].$set;
      expect('skippedRecords' in completeWrite).toBe(true);
      expect('duplicatesFound' in completeWrite).toBe(true);
      expect(completeWrite.skippedRecords).toBe(0);
      expect(completeWrite.duplicatesFound).toBe(0);
    });

    // #890: a result-import run that finishes normally but writes nothing
    // because every processed entry hit an unimplemented/unsupported format
    // stub must be reported as 'completed_no_data', not a plain 'completed'
    // at 100% having written zero records.
    it('on success with success:0 and unprocessedFormats>0 (results dataType): marks completed_no_data', async () => {
      const processor = await getProcessor();
      fakeResultWorker.process.mockResolvedValue({
        total: 1,
        success: 0,
        errors: [{ code: 'FORMAT_NOT_IMPLEMENTED', error: 'x' }],
        unprocessedFormats: 1,
        processingTime: 0,
        fhirResourcesCreated: 0,
        fhirResourcesUpdated: 0,
        fhirResources: [],
      });

      const updateOneMock = vi.fn().mockResolvedValue({ acknowledged: true });
      fakeDb.collection.mockReturnValue({ updateOne: updateOneMock });

      const job = {
        id: 'j7b',
        name: 'import',
        data: {
          jobID: 'j7b',
          userID: 'u7b',
          dataType: 'results',
          filePath: '/tmp/r.raw',
          fileName: 'r.raw',
          options: {},
        },
      };

      await processor(job);

      expect(updateOneMock).toHaveBeenCalledTimes(2);
      const completeWrite = updateOneMock.mock.calls[1][1].$set;
      expect(completeWrite.status).toBe('completed_no_data');
      expect(completeWrite.progress).toBe(100);
      expect(completeWrite.unprocessedFormats).toBe(1);

      expect(fakeNotificationService.notifyJobCompleted).toHaveBeenCalledWith(
        'u7b',
        expect.objectContaining({ jobID: 'j7b', status: 'completed_no_data' })
      );
      // The AuditLog action stays the literal 'completed' -- bounding blast
      // radius on unaudited consumers (#890).
      expect(fakeAuditLogger.logImport).toHaveBeenCalledWith(
        null,
        'Result',
        'completed',
        1,
        0,
        1,
        expect.objectContaining({ jobID: 'j7b' }),
        // #1105: the worker declares its own dict-02 P1X-0331 origin.
        { source: 'worker' }
      );
    });

    it('on success with success:0 but unprocessedFormats:0 (row errors with cause, not unimplemented format): stays completed', async () => {
      const processor = await getProcessor();
      fakeResultWorker.process.mockResolvedValue({
        total: 1,
        success: 0,
        errors: [{ row: 1, error: 'x' }],
        unprocessedFormats: 0,
        processingTime: 0,
        fhirResourcesCreated: 0,
        fhirResourcesUpdated: 0,
        fhirResources: [],
      });

      const updateOneMock = vi.fn().mockResolvedValue({ acknowledged: true });
      fakeDb.collection.mockReturnValue({ updateOne: updateOneMock });

      const job = {
        id: 'j7c',
        name: 'import',
        data: {
          jobID: 'j7c',
          userID: 'u7c',
          dataType: 'results',
          filePath: '/tmp/r.csv',
          fileName: 'r.csv',
          options: {},
        },
      };

      await processor(job);

      const completeWrite = updateOneMock.mock.calls[1][1].$set;
      expect(completeWrite.status).toBe('completed');
      expect(completeWrite.unprocessedFormats).toBe(0);
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
        expect.objectContaining({ jobID: 'j8', dataType: 'patients' }),
        // #1105: the worker declares its own dict-02 P1X-0331 origin.
        { source: 'worker' }
      );
      expect(fakeNotificationService.notifyJobFailed).toHaveBeenCalledWith(
        'u8',
        expect.objectContaining({ jobID: 'j8', status: 'failed', error: 'worker exploded' })
      );
    });

    // #900: the assertion above passes on a job literal with no `opts`, which
    // resolves to attempt 1 of 1 -- terminal. That makes it blind to the
    // attempt-awareness itself, so this pins the non-terminal case explicitly.
    // bullmq runs this catch once per ATTEMPT, so without the guard one failing
    // job flipped the record to 'failed' at t=0 and pushed the user up to three
    // "import failed" notifications for a run that could still succeed.
    it('on a NON-final attempt: does not mark failed and does not notify, but still re-throws', async () => {
      const processor = await getProcessor();
      const boom = new Error('transient blip');
      fakePatientWorker.process.mockRejectedValue(boom);

      const updateOneMock = vi.fn().mockResolvedValue({ acknowledged: true });
      fakeDb.collection.mockReturnValue({ updateOne: updateOneMock });

      const job = {
        id: 'j8b',
        name: 'import',
        attemptsMade: 0,
        opts: { attempts: 3 },
        data: {
          jobID: 'j8b',
          userID: 'u8b',
          dataType: 'patients',
          filePath: '/tmp/p.csv',
          fileName: 'p.csv',
          options: {},
        },
      };

      // The re-throw must survive -- it is what drives bullmq's retry.
      await expect(processor(job)).rejects.toThrow('transient blip');

      expect(updateOneMock).toHaveBeenCalledTimes(2);
      const failWrite = updateOneMock.mock.calls[1][1].$set;
      expect(failWrite.status).toBe('processing');
      expect(failWrite.completedAt).toBeUndefined();
      expect(failWrite.errors[0].error).toContain('Tentativa 1/3');

      expect(fakeNotificationService.notifyJobFailed).not.toHaveBeenCalled();
      // The audit entry is deliberately per-attempt: the failure really happened.
      expect(fakeAuditLogger.logError).toHaveBeenCalled();
    });

    it('on the FINAL attempt: marks failed and notifies once', async () => {
      const processor = await getProcessor();
      const boom = new Error('last straw');
      fakePatientWorker.process.mockRejectedValue(boom);

      const updateOneMock = vi.fn().mockResolvedValue({ acknowledged: true });
      fakeDb.collection.mockReturnValue({ updateOne: updateOneMock });

      const job = {
        id: 'j8c',
        name: 'import',
        attemptsMade: 2,
        opts: { attempts: 3 },
        data: {
          jobID: 'j8c',
          userID: 'u8c',
          dataType: 'patients',
          filePath: '/tmp/p.csv',
          fileName: 'p.csv',
          options: {},
        },
      };

      await expect(processor(job)).rejects.toThrow('last straw');

      const failWrite = updateOneMock.mock.calls[1][1].$set;
      expect(failWrite.status).toBe('failed');
      expect(failWrite.errors[0].error).toContain('Tentativa 3/3');
      expect(fakeNotificationService.notifyJobFailed).toHaveBeenCalledTimes(1);
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

    // #900: bullmq's Worker runs the processor's catch once per attempt, not
    // once per job -- moveToFailed() runs on every attempt and decides
    // retry-vs-fail inside itself, after the processor has already rejected.
    // Marking the StagingImport document 'failed' on attempt 1 of an
    // `attempts: 3` job was wrong: the document read FAILED through a run
    // that could still finish `completed`. These cases pin the replacement:
    // recordAttemptFailure() decides final-vs-not from attemptsMade/opts.attempts.
    it('on batch-import failure, attempt 1 of 3 (not final): still retries, processor rejects with the original error', async () => {
      const processor = await getProcessor();
      const boom = new Error('batch exploded');
      fakeBatchValidationEngine.processBatchImport.mockRejectedValue(boom);

      const updateOneMock = vi.fn().mockResolvedValue({ acknowledged: true });
      fakeDb.collection.mockReturnValue({ updateOne: updateOneMock });

      const job = {
        id: 'b3',
        name: 'batch-import',
        data: { stagingImportId: 'stg-3' },
        attemptsMade: 0,
        opts: { attempts: 3 },
      };

      await expect(processor(job)).rejects.toThrow('batch exploded');

      expect(fakeBatchValidationEngine.recordAttemptFailure).toHaveBeenCalledWith('stg-3', {
        attemptNumber: 1,
        attemptsAllowed: 3,
        message: 'batch exploded',
      });
      expect(fakeBatchValidationEngine.updateProgress).not.toHaveBeenCalledWith('stg-3', { status: 'failed' });
      expect(updateOneMock).not.toHaveBeenCalled();
      expect(fakeAuditLogger.logError).not.toHaveBeenCalled();
      expect(fakeNotificationService.notifyJobFailed).not.toHaveBeenCalled();
    });

    it('on batch-import failure, attempt 2 of 3 (middle, not final): still retries', async () => {
      const processor = await getProcessor();
      const boom = new Error('batch exploded again');
      fakeBatchValidationEngine.processBatchImport.mockRejectedValue(boom);

      const job = {
        id: 'b3b',
        name: 'batch-import',
        data: { stagingImportId: 'stg-3b' },
        attemptsMade: 1,
        opts: { attempts: 3 },
      };

      await expect(processor(job)).rejects.toThrow('batch exploded again');

      expect(fakeBatchValidationEngine.recordAttemptFailure).toHaveBeenCalledWith('stg-3b', {
        attemptNumber: 2,
        attemptsAllowed: 3,
        message: 'batch exploded again',
      });
    });

    it('on batch-import failure, attempt 3 of 3 (final): marks failed, recorded message carries the thrown error text, and re-throws', async () => {
      const processor = await getProcessor();
      const boom = new Error('batch exploded for good');
      fakeBatchValidationEngine.processBatchImport.mockRejectedValue(boom);

      const job = {
        id: 'b3c',
        name: 'batch-import',
        data: { stagingImportId: 'stg-3c' },
        attemptsMade: 2,
        opts: { attempts: 3 },
      };

      await expect(processor(job)).rejects.toThrow('batch exploded for good');

      expect(fakeBatchValidationEngine.recordAttemptFailure).toHaveBeenCalledWith('stg-3c', {
        attemptNumber: 3,
        attemptsAllowed: 3,
        message: 'batch exploded for good',
      });
    });

    it.each([
      ['opts: {}', {}],
      ['opts: { attempts: 0 }', { attempts: 0 }],
    ])('on batch-import failure with %s on a first attempt: treated as final (Math.max guard)', async (_label, opts) => {
      const processor = await getProcessor();
      const boom = new Error('batch exploded, no retries configured');
      fakeBatchValidationEngine.processBatchImport.mockRejectedValue(boom);

      const job = {
        id: 'b3d',
        name: 'batch-import',
        data: { stagingImportId: 'stg-3d' },
        attemptsMade: 0,
        opts,
      };

      await expect(processor(job)).rejects.toThrow('batch exploded, no retries configured');

      expect(fakeBatchValidationEngine.recordAttemptFailure).toHaveBeenCalledWith('stg-3d', {
        attemptNumber: 1,
        attemptsAllowed: 1,
        message: 'batch exploded, no retries configured',
      });
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

      // #1166: with the worker's own connection, which the job needs to
      // resolve the participant's name and contact.
      expect(fakeNotificationService.processConsentNotificationJob).toHaveBeenCalledWith({
        userId: 'u1',
        patientId: 'p1',
      }, fakeDb);
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

    it('#1468 records a notification job as notification-queue:<name> under a fresh id when it carries none', async () => {
      process.env.NODE_ENV = 'test';
      const { WELL_FORMED } = require('../../src/utils/requestContext');
      const importWorker = freshImportWorkerModule();
      await importWorker.initWorker();
      const notificationProcessor = fakeWorkerInstances[1].processor;

      await notificationProcessor({ name: 'consent-notification' });

      expect(metricCalls).toHaveLength(1);
      expect(metricCalls[0]).toMatchObject({ worker: 'notification-queue', job: 'consent-notification' });
      expect(WELL_FORMED.test(metricCalls[0].requestId)).toBe(true);
    });
  });
});
