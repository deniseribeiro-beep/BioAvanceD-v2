import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// #1098: server.js's startServer() had never actually been executed by a
// test -- every prior server.js test (#1040, #1047) required the module and
// inspected its side effects at require time (the process-handler and
// signal-handler registrations), but none called the exported startServer()
// itself. That left the whole pre-I/O prologue this file pins -- #972/#1097's
// critical-variable guard, #1085's encryption gate, #1154's non-fatal audit
// warning, and #977's non-fatal Redis posture -- provable only by reading the
// source, not by a red test catching a regression to any of it.
//
// startServer() pulls its collaborators with require()-based
// destructuring/imports (module top, lines 1-17) plus three lazily-required
// ones inside the function body (./src/config/queue,
// ./src/services/notification.service, ./src/services/iot-streaming.service),
// so -- same as tests/unit/worker.entrypoint.test.js for src/workers/worker.js
// -- fakes go into require.cache before a fresh require of server.js, rather
// than through vi.mock(). server.js itself only auto-invokes startServer() at
// module load when NODE_ENV !== "test" (or RUN_SERVER_IN_TEST === "1"); this
// file leaves both conditions false and calls and awaits the exported
// startServer() directly instead, since (unlike worker.js) server.js exports
// startServer rather than self-invoking it as a side effect nothing outside
// the module can await.
//
// http.createServer(app) and `new Server(httpServer, ...)` (socket.io) are
// allowed to run for real against a fake `app` object -- verified directly
// against this repo's installed http/socket.io before relying on it here --
// so the only thing standing between this test and a real bound OS port is
// `http.Server.prototype.listen`, spied to a no-op that returns `this`
// (server.js never inspects the return value here).

const serverPath = require.resolve('../../server');
const appPath = require.resolve('../../app');
const loggerPath = require.resolve('../../src/utils/logger');
const mongoPath = require.resolve('../../src/database/mongo');
const neo4jConnectionPath = require.resolve('../../src/infrastructure/database/neo4j/connection');
const mongooseConnectionPath = require.resolve('../../src/infrastructure/database/mongodb/connection');
const lineageRepositoryPath = require.resolve('../../src/infrastructure/database/neo4j/LineageRepository');
const topologicalQuarantinePath = require.resolve('../../src/infrastructure/queue/TopologicalQuarantine');
const telemetryMonitorPath = require.resolve('../../src/infrastructure/services/TelemetryMonitor');
const mqttTelemetryServicePath = require.resolve('../../src/services/mqtt-telemetry.service');
const portManagerPath = require.resolve('../../src/utils/portManager');
const schedulerServicePath = require.resolve('../../src/services/scheduler.service');
const integrationSecurityMiddlewarePath = require.resolve('../../src/infrastructure/middleware/integrationSecurityMiddleware');
const reportTemplateSeedPath = require.resolve('../../src/services/report-template-seed.service');
const rbacCatalogSeedPath = require.resolve('../../src/services/rbac-catalog-seed.service');
const validateEnvPath = require.resolve('../../src/config/validateEnv');
const queueConfigPath = require.resolve('../../src/config/queue');
const notificationServicePath = require.resolve('../../src/services/notification.service');
const iotStreamingServicePath = require.resolve('../../src/services/iot-streaming.service');
// config/env.js is exempt from the require.cache eviction below on purpose,
// same reasoning as tests/unit/worker.entrypoint.test.js: it is a plain
// literal module.exports object that this file WRITES to (env.FOO = ...)
// instead of going through process.env, so evicting it would silently
// discard every assignment this file just made -- server.js would then read
// defaults and an assertion would fail for a reason nothing here names.
const envPath = require.resolve('../../src/config/env');
const env = require(envPath);

const STUBBED_PATHS = [
  appPath,
  loggerPath,
  mongoPath,
  mongooseConnectionPath,
  neo4jConnectionPath,
  lineageRepositoryPath,
  topologicalQuarantinePath,
  telemetryMonitorPath,
  mqttTelemetryServicePath,
  portManagerPath,
  schedulerServicePath,
  integrationSecurityMiddlewarePath,
  reportTemplateSeedPath,
  rbacCatalogSeedPath,
  validateEnvPath,
  queueConfigPath,
  notificationServicePath,
  iotStreamingServicePath,
];

function stub(path, exports) {
  require.cache[path] = { id: path, filename: path, loaded: true, exports };
}

function setValidCriticalEnv() {
  env.MONGO_URI = 'mongodb://localhost:27017/bioavance-test';
  env.JWT_SECRET = 'test-jwt-secret';
  env.USER_ANON_SALT = 'test-user-anon-salt';
  env.CONSENT_SECRET = 'test-consent-secret';
}

let signalListenersBefore;
let nodeEnvBefore;
let runServerInTestBefore;
let criticalEnvBefore;
let exitSpy;
let listenSpy;

let fakeLogger;
let fakeApp;
let fakeConnectDB;
let fakeConnectMongoDB;
let fakeConnectNeo4j;
let fakePortManager;
let fakeValidateEncryptionAndHalt;
let fakeValidateAuditSigningAndWarn;
let fakeInitScheduler;
let fakeInitializeSecuritySystem;
let fakeSeedReportTemplates;
let fakeSeedRolesAndPermissions;
let fakeMqttStart;
let fakeTopoStartWorker;
let fakeTelemetryStart;
let fakeInitQueue;
let fakeTestConnection;
let fakeNotificationInitSocketIO;
let fakeIotInitSocketIO;

function stubHappyPathCollaborators() {
  fakeLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  fakeApp = { locals: {}, get: vi.fn(() => undefined) };
  fakeConnectDB = vi.fn().mockResolvedValue({ fakeDb: true });
  fakeConnectMongoDB = vi.fn().mockResolvedValue({ readyState: 1 });
  fakeConnectNeo4j = vi.fn().mockResolvedValue({ fakeNeo4jDriver: true });
  fakePortManager = { getAvailablePort: vi.fn().mockResolvedValue(4321) };
  fakeValidateEncryptionAndHalt = vi.fn();
  fakeValidateAuditSigningAndWarn = vi.fn().mockResolvedValue(undefined);
  fakeInitScheduler = vi.fn();
  fakeInitializeSecuritySystem = vi.fn().mockResolvedValue(undefined);
  fakeSeedReportTemplates = vi.fn().mockResolvedValue({ templates: [] });
  fakeSeedRolesAndPermissions = vi.fn().mockResolvedValue({ roles: [], permissions: [] });
  fakeMqttStart = vi.fn().mockResolvedValue(undefined);
  fakeTopoStartWorker = vi.fn().mockResolvedValue(undefined);
  fakeTelemetryStart = vi.fn();
  fakeInitQueue = vi.fn(() => ({}));
  fakeTestConnection = vi.fn().mockResolvedValue(true);
  fakeNotificationInitSocketIO = vi.fn();
  fakeIotInitSocketIO = vi.fn();

  function FakeTopologicalQuarantine(options) {
    this.options = options;
  }
  FakeTopologicalQuarantine.prototype.startWorker = function startWorker() {
    return fakeTopoStartWorker();
  };

  function FakeTelemetryMonitor(options) {
    this.options = options;
  }
  FakeTelemetryMonitor.prototype.start = function start() {
    return fakeTelemetryStart();
  };

  function FakeLineageRepository(db) {
    this.db = db;
  }

  stub(appPath, fakeApp);
  stub(loggerPath, fakeLogger);
  stub(mongoPath, { connectDB: fakeConnectDB, connectNewDB: vi.fn(), closeConnection: vi.fn() });
  stub(mongooseConnectionPath, { connectMongoDB: fakeConnectMongoDB, getMongoDBConnection: vi.fn(), closeMongoDBConnection: vi.fn() });
  stub(neo4jConnectionPath, {
    connectNeo4j: fakeConnectNeo4j,
    getNeo4jDriver: vi.fn(),
    closeNeo4jConnection: vi.fn(),
  });
  stub(lineageRepositoryPath, FakeLineageRepository);
  stub(topologicalQuarantinePath, FakeTopologicalQuarantine);
  stub(telemetryMonitorPath, FakeTelemetryMonitor);
  stub(mqttTelemetryServicePath, { start: fakeMqttStart });
  stub(portManagerPath, fakePortManager);
  stub(schedulerServicePath, {
    initScheduler: fakeInitScheduler,
    stopScheduler: vi.fn(),
    startConsentSyncSchedule: vi.fn(),
  });
  stub(integrationSecurityMiddlewarePath, { initializeSecuritySystem: fakeInitializeSecuritySystem });
  stub(reportTemplateSeedPath, { seedReportTemplates: fakeSeedReportTemplates });
  stub(rbacCatalogSeedPath, { seedRolesAndPermissions: fakeSeedRolesAndPermissions });
  stub(validateEnvPath, {
    validateEncryptionAndHalt: fakeValidateEncryptionAndHalt,
    validateAuditSigningAndWarn: fakeValidateAuditSigningAndWarn,
  });
  stub(queueConfigPath, { initQueue: fakeInitQueue, testConnection: fakeTestConnection });
  stub(notificationServicePath, { initSocketIO: fakeNotificationInitSocketIO });
  stub(iotStreamingServicePath, { initSocketIO: fakeIotInitSocketIO });
}

async function loadServerAndStart() {
  delete require.cache[serverPath];
  const { startServer } = require(serverPath);
  await startServer();
}

// #1583: under a loaded machine the suite exceeds vitest's default 5000 ms
// even though each case passes alone — raise the suite budget.
describe('#1098 server.js startServer() -- pinning the pre-I/O boot prologue', { timeout: 20000 }, () => {
  beforeEach(() => {
    signalListenersBefore = {
      SIGINT: process.listeners('SIGINT').slice(),
      SIGTERM: process.listeners('SIGTERM').slice(),
      uncaughtException: process.listeners('uncaughtException').slice(),
      unhandledRejection: process.listeners('unhandledRejection').slice(),
    };

    nodeEnvBefore = process.env.NODE_ENV;
    runServerInTestBefore = process.env.RUN_SERVER_IN_TEST;
    process.env.NODE_ENV = 'test';
    delete process.env.RUN_SERVER_IN_TEST;

    criticalEnvBefore = {
      MONGO_URI: env.MONGO_URI,
      JWT_SECRET: env.JWT_SECRET,
      USER_ANON_SALT: env.USER_ANON_SALT,
      CONSENT_SECRET: env.CONSENT_SECRET,
    };
    setValidCriticalEnv();

    stubHappyPathCollaborators();

    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined);
    listenSpy = vi
      .spyOn(require('http').Server.prototype, 'listen')
      .mockImplementation(function mockListen() {
        return this;
      });
  });

  afterEach(() => {
    vi.restoreAllMocks();

    if (nodeEnvBefore === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = nodeEnvBefore;
    if (runServerInTestBefore === undefined) delete process.env.RUN_SERVER_IN_TEST;
    else process.env.RUN_SERVER_IN_TEST = runServerInTestBefore;

    env.MONGO_URI = criticalEnvBefore.MONGO_URI;
    env.JWT_SECRET = criticalEnvBefore.JWT_SECRET;
    env.USER_ANON_SALT = criticalEnvBefore.USER_ANON_SALT;
    env.CONSENT_SECRET = criticalEnvBefore.CONSENT_SECRET;

    for (const event of ['SIGINT', 'SIGTERM', 'uncaughtException', 'unhandledRejection']) {
      for (const listener of process.listeners(event)) {
        if (!signalListenersBefore[event].includes(listener)) {
          process.removeListener(event, listener);
        }
      }
    }

    delete require.cache[serverPath];
    for (const path of STUBBED_PATHS) {
      delete require.cache[path];
    }
  });

  // #972/#1097: the guard's own `if` block has no return/throw -- it logs and
  // calls process.exit(1), and since exit is spied as a no-op here, execution
  // falls through the rest of the function exactly as it would if a real
  // process.exit(1) had NOT actually terminated the process synchronously in
  // time. That is why this asserts ORDERING (exit requested before any I/O
  // collaborator runs) rather than "getAvailablePort/connectDB were never
  // called" -- the second claim is false under a mocked exit and would be
  // asserting a property this test's own fixture cannot produce.
  describe('#972/#1097 critical variables missing -- exits(1) before any I/O', () => {
    const cases = [
      ['MONGO_URI', undefined],
      ['JWT_SECRET', undefined],
      ['USER_ANON_SALT', undefined],
      ['CONSENT_SECRET', undefined],
      ['CONSENT_SECRET', '   '],
    ];

    it.each(cases)('exits(1) and names the critical variables when %s is missing (value: %j)', async (field, value) => {
      env[field] = value;

      await loadServerAndStart();

      expect(exitSpy).toHaveBeenCalledWith(1);
      const errorMessages = fakeLogger.error.mock.calls.map((args) => String(args[0]));
      expect(errorMessages.some((msg) => msg.includes('MONGO_URI') && msg.includes('JWT_SECRET') && msg.includes('USER_ANON_SALT') && msg.includes('CONSENT_SECRET'))).toBe(true);

      // Ordering, not absence (see the describe-level comment above): exit
      // must have been requested strictly before either I/O collaborator ran,
      // Unconditional on purpose: under the no-op exit both collaborators
      // always run, so a guard on "were they invoked" could only ever let an
      // assertion silently skip.
      expect(fakePortManager.getAvailablePort).toHaveBeenCalled();
      expect(fakeConnectDB).toHaveBeenCalled();
      expect(exitSpy.mock.invocationCallOrder[0])
        .toBeLessThan(fakePortManager.getAvailablePort.mock.invocationCallOrder[0]);
      expect(exitSpy.mock.invocationCallOrder[0])
        .toBeLessThan(fakeConnectDB.mock.invocationCallOrder[0]);
    });
  });

  // #1085: unlike the guard above, validateEncryptionAndHalt's refusal is a
  // real synchronous throw, caught by startServer()'s own try/catch -- so
  // this IS a genuine "never reached" case, not an ordering-only one.
  describe('#1085 encryption gate halts before any I/O collaborator runs', () => {
    it('exits(1) via the startup catch and never calls connectDB or getAvailablePort', async () => {
      fakeValidateEncryptionAndHalt.mockImplementation(() => {
        throw new Error('ENCRYPTION_KEY ausente');
      });

      await loadServerAndStart();

      expect(exitSpy).toHaveBeenCalledWith(1);
      const errorMessages = fakeLogger.error.mock.calls.map((args) => String(args[0]));
      expect(errorMessages.some((msg) => msg.includes('Erro fatal ao iniciar servidor'))).toBe(true);
      expect(fakePortManager.getAvailablePort).not.toHaveBeenCalled();
      expect(fakeConnectDB).not.toHaveBeenCalled();
    });
  });

  // #1154: deliberately the opposite severity from #1085, at the same
  // position in the sequence -- a rejected validateAuditSigningAndWarn() must
  // NOT reach process.exit, because the call site attaches `.catch(() => {})`
  // itself rather than letting the rejection propagate.
  describe('#1154 audit-signing warning never halts the boot', () => {
    it('does not exit and still reaches listen() when validateAuditSigningAndWarn rejects', async () => {
      fakeValidateAuditSigningAndWarn.mockReturnValue(Promise.reject(new Error('audit signing misconfigured')));

      await loadServerAndStart();

      expect(exitSpy).not.toHaveBeenCalled();
      expect(listenSpy).toHaveBeenCalledTimes(1);
    });
  });

  // #977/#979: a Redis configuration or connectivity failure here is logged
  // and swallowed, never fatal, and the HTTP server still starts. Both
  // processes survive a Redis connectivity loss; src/workers/worker.js alone
  // stays fatal on a configuration fault (pinned in
  // tests/unit/worker.entrypoint.test.js).
  describe('#977 Redis failures are not fatal for this process', () => {
    it('does not exit and still calls listen() when initQueue throws', async () => {
      fakeInitQueue.mockImplementation(() => {
        throw new Error('REDIS_PASSWORD não está definido no .env');
      });

      await loadServerAndStart();

      expect(exitSpy).not.toHaveBeenCalled();
      expect(listenSpy).toHaveBeenCalledTimes(1);
      const errorMessages = fakeLogger.error.mock.calls.map((args) => String(args[0]));
      expect(errorMessages.some((msg) => msg.includes('Erro ao iniciar Redis'))).toBe(true);
    });

    it('does not exit and still calls listen() when testConnection resolves false', async () => {
      fakeTestConnection.mockResolvedValue(false);

      await loadServerAndStart();

      expect(exitSpy).not.toHaveBeenCalled();
      expect(listenSpy).toHaveBeenCalledTimes(1);
      const warnMessages = fakeLogger.warn.mock.calls.map((args) => String(args[0]));
      expect(warnMessages.some((msg) => msg.includes('Redis indisponível'))).toBe(true);
    });
  });

  // RF022 AC4/AC9, RNF014 C7: with FOUNDATION_READINESS_REQUIRED the API
  // starts only on a ready ReadinessReport. The real readiness module runs
  // here against an in-memory db carrying (or not) the report.
  describe('RF022 Foundation readiness gate', () => {
    const { createFakeDb } = require('./foundation/helpers/fake-db');
    const ReadinessReportModel = require('../../src/models/ReadinessReport');
    const { CANONICAL_MODEL_RELEASE_ID } = require('../../src/foundation/readiness');
    let requiredBefore;

    beforeEach(() => {
      requiredBefore = env.FOUNDATION_READINESS_REQUIRED;
      env.FOUNDATION_READINESS_REQUIRED = true;
    });
    afterEach(() => {
      env.FOUNDATION_READINESS_REQUIRED = requiredBefore;
    });

    async function dbWithReport(gateResults) {
      const db = createFakeDb();
      if (gateResults) {
        await db.collection('readinessReports').insertOne(ReadinessReportModel.create({
          foundationDataRunId: 'run-1',
          canonicalModelReleaseId: CANONICAL_MODEL_RELEASE_ID,
          environment: env.NODE_ENV,
          gateResults,
        }));
      }
      return db;
    }

    it('exits(1) before listen() when no ReadinessReport exists', async () => {
      fakeConnectDB.mockResolvedValue(await dbWithReport(null));

      await loadServerAndStart();

      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(listenSpy).not.toHaveBeenCalled();
      expect(fakeConnectMongoDB).not.toHaveBeenCalled();
    });

    it('exits(1) before listen() when the newest report is blocked', async () => {
      fakeConnectDB.mockResolvedValue(await dbWithReport([{ gate: 'version', result: 'fail', p0: true }]));

      await loadServerAndStart();

      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(listenSpy).not.toHaveBeenCalled();
    });

    it('starts on a ready report, leaving the configuration seeds to the Foundation job (AC4)', async () => {
      fakeConnectDB.mockResolvedValue(await dbWithReport([{ gate: 'version', result: 'pass', p0: true }]));

      await loadServerAndStart();

      expect(exitSpy).not.toHaveBeenCalled();
      expect(listenSpy).toHaveBeenCalledTimes(1);
      expect(fakeSeedRolesAndPermissions).not.toHaveBeenCalled();
      expect(fakeSeedReportTemplates).not.toHaveBeenCalled();
    });

    it('does not read a report at all when the flag is off, and seeds at boot as before', async () => {
      env.FOUNDATION_READINESS_REQUIRED = false;
      fakeConnectDB.mockResolvedValue(await dbWithReport(null));

      await loadServerAndStart();

      expect(exitSpy).not.toHaveBeenCalled();
      expect(listenSpy).toHaveBeenCalledTimes(1);
      expect(fakeSeedRolesAndPermissions).toHaveBeenCalledTimes(1);
      expect(fakeSeedReportTemplates).toHaveBeenCalledTimes(1);
    });
  });

  describe('happy path', () => {
    it('does not exit and calls listen() exactly once when every collaborator succeeds', async () => {
      await loadServerAndStart();

      expect(exitSpy).not.toHaveBeenCalled();
      expect(listenSpy).toHaveBeenCalledTimes(1);
      expect(fakeConnectDB).toHaveBeenCalled();
      expect(fakePortManager.getAvailablePort).toHaveBeenCalled();
    });

    // #830: Mongoose-model reads in the API no longer depend on some other
    // route having connected Mongoose first.
    it('opens the Mongoose connection during boot, after the native connectDB()', async () => {
      await loadServerAndStart();

      expect(fakeConnectMongoDB).toHaveBeenCalledTimes(1);
      expect(fakeConnectDB.mock.invocationCallOrder[0])
        .toBeLessThan(fakeConnectMongoDB.mock.invocationCallOrder[0]);
    });
  });
});
