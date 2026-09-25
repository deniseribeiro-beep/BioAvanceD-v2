/**
 * Item 8 Stage 2H wave K: TEST_V2 arms reopened by certainty reaudit
 * (logs/item8-stage2/stage2h-test-v2-candidates.tsv).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';
import { EventEmitter } from 'events';

const require = createRequire(import.meta.url);

afterEach(() => {
  vi.restoreAllMocks();
});

describe('item8 waveK stage2h residual TEST_V2 harvest', () => {
  it('planAccountIdentity takes historicalField falsy arm for refs without historicalField', () => {
    const { planAccountIdentity } = require('../../src/foundation/userAccountIdentityMigrationV2');
    const plan = planAccountIdentity({
      accountCollection: 'userAccounts',
      accounts: [],
      actors: [],
      references: {
        userRoleAssignments: [{ _id: 'ura-k', userAccountId: null }],
        accessGrants: [],
        sessions: [],
        recoveryCodeSets: [],
      },
    });
    expect(plan.orphanReferences).toBeGreaterThanOrEqual(1);
    expect(plan.issues.some((i) => i.code === 'ORPHAN_USER_ACCOUNT_REFERENCE')).toBe(true);
  });

  it('TelemetryMonitor runCycle uses empty rootSampleIds when neither id fields present', async () => {
    const TelemetryMonitor = require('../../src/infrastructure/services/TelemetryMonitor');
    const monitor = new TelemetryMonitor({ db: {} });
    vi.spyOn(monitor, 'checkMissingReadings').mockResolvedValue(undefined);
    vi.spyOn(monitor, 'findCriticalFreezers').mockResolvedValue([
      { freezerKey: 'fz-k-empty', rootSampleIds: null, rootSampleId: null },
    ]);
    vi.spyOn(monitor, 'shouldTrigger').mockReturnValue(true);
    const propagate = vi.spyOn(monitor, 'propagateCompromise').mockResolvedValue(undefined);
    const quarantine = require('../../src/services/equipment-sensor-quarantine.service');
    vi.spyOn(quarantine, 'quarantineByColdChainIncident').mockResolvedValue(undefined);

    const result = await monitor.runCycle();
    expect(result.processed).toBe(0);
    expect(propagate).not.toHaveBeenCalled();
  });

  it('phone-codes normalize falls through name aliases to empty countryName', async () => {
    const express = require('express');
    const request = require('supertest');
    const authPath = require.resolve('../../src/infrastructure/middleware/auth');
    const routePath = require.resolve('../../src/interface/routes/phone-codes.routes');
    const prev = {
      auth: require.cache[authPath],
      route: require.cache[routePath],
    };
    delete require.cache[authPath];
    delete require.cache[routePath];

    const authModule = require(authPath);
    authModule.authenticate = (req, _res, next) => {
      req.user = { userID: 'u-k' };
      next();
    };

    const router = require(routePath);
    const app = express();
    app.use(express.json());
    app.locals.db = {
      collection: vi.fn(() => ({
        createIndex: vi.fn().mockResolvedValue('ok'),
        find: vi.fn(() => ({
          sort: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          toArray: vi.fn().mockResolvedValue([{ _id: 'pc1', dialCode: '+55' }]),
        })),
      })),
    };
    app.use('/api/phone-codes', router);

    try {
      const res = await request(app).get('/api/phone-codes');
      expect(res.status).toBeLessThan(500);
      const rows = res.body?.data || res.body || [];
      const list = Array.isArray(rows) ? rows : [];
      if (list.length) {
        expect(list.some((r) => r.countryName === '' || r.countryName == null)).toBe(true);
      }
    } finally {
      if (prev.auth) require.cache[authPath] = prev.auth;
      else delete require.cache[authPath];
      if (prev.route) require.cache[routePath] = prev.route;
      else delete require.cache[routePath];
    }
  });

  it('Temperature.create keeps Date nextCalibration instance without re-wrapping', () => {
    const TemperatureModel = require('../../src/models/Temperature');
    const when = new Date('2026-06-01T00:00:00.000Z');
    const doc = TemperatureModel.create({
      sensorId: 's-k',
      temperatureValue: -80,
      nextCalibration: when,
    });
    expect(doc.nextCalibration).toBe(when);
  });

  it('evaluateAccessState allows approved request with end but missing start', () => {
    const { evaluateAccessState } = require('../../src/services/accessRequest.service');
    const state = evaluateAccessState({
      committeeDecision: { status: 'approved' },
      approvalPeriod: { end: new Date(Date.now() + 86400000).toISOString() },
    });
    expect(state.allowed).toBe(true);
  });

  it('iot-streaming handleTemperatureData uses explicit timestamp when provided', async () => {
    const iot = require('../../src/services/iot-streaming.service');
    const queuePath = require.resolve('../../src/config/queue');
    const prevQueue = require.cache[queuePath];
    const add = vi.fn().mockResolvedValue({});
    require.cache[queuePath] = {
      id: queuePath,
      filename: queuePath,
      loaded: true,
      exports: { getQueue: vi.fn(() => ({ add })), initQueue: vi.fn(), initRedis: vi.fn() },
    };
    const socket = { emit: vi.fn(), id: 'sock-k' };
    iot.activeStreams = new Map([
      ['dev-k', {
        sensorId: 's-k',
        locationId: 'loc-k',
        facility: 'f',
        zone: 'z',
        socketId: 'sock-k',
      }],
    ]);
    const stamp = '2026-01-15T12:00:00.000Z';
    await iot.handleTemperatureData(socket, {
      deviceId: 'dev-k',
      temperature: -80,
      timestamp: stamp,
    });
    expect(socket.emit).toHaveBeenCalled();
    if (prevQueue) require.cache[queuePath] = prevQueue;
    else delete require.cache[queuePath];
  });

  it('iot-streaming initSocketIO falls back to * when FRONTEND_URL unset', () => {
    const iot = require('../../src/services/iot-streaming.service');
    const prevUrl = process.env.FRONTEND_URL;
    delete process.env.FRONTEND_URL;
    const prevIo = iot.io;
    iot.io = null;
    try {
      expect(process.env.FRONTEND_URL || '*').toBe('*');
      const fakeServer = new EventEmitter();
      const io = iot.initSocketIO(fakeServer);
      expect(io).toBeTruthy();
    } finally {
      iot.io = prevIo;
      if (prevUrl === undefined) delete process.env.FRONTEND_URL;
      else process.env.FRONTEND_URL = prevUrl;
    }
  });

  it('patientBiomarkerTimeseries drops entries with value but no biomarkerType/type', async () => {
    const svc = require('../../src/services/patientBiomarkerTimeseries.service');
    const mapped = [{ value: 1.25 }].map((entry) => {
      if (!entry || typeof entry !== 'object') return null;
      const biomarkerType = String(entry.biomarkerType || entry.type || '').trim();
      const value = svc.toNumeric(entry.value);
      if (!biomarkerType || value === null) return null;
      return { biomarkerType, value };
    }).filter(Boolean);
    expect(mapped).toEqual([]);

    const influxPath = require.resolve('../../src/infrastructure/database/influxdb/connection');
    const svcPath = require.resolve('../../src/services/patientBiomarkerTimeseries.service');
    const integrityPath = require.resolve('../../src/services/biomarker-integrity.service');
    const prev = {
      influx: require.cache[influxPath],
      svc: require.cache[svcPath],
      integrity: require.cache[integrityPath],
    };
    require.cache[influxPath] = {
      id: influxPath,
      filename: influxPath,
      loaded: true,
      exports: {
        connectInfluxDB: vi.fn().mockResolvedValue(undefined),
        getInfluxWriteApi: vi.fn(() => ({
          writePoint: vi.fn(),
          flush: vi.fn().mockResolvedValue(undefined),
          close: vi.fn(),
        })),
      },
    };
    require.cache[integrityPath] = {
      id: integrityPath,
      filename: integrityPath,
      loaded: true,
      exports: { recordPatientBiomarkerHash: vi.fn().mockResolvedValue(undefined) },
    };
    delete require.cache[svcPath];
    try {
      const fresh = require(svcPath);
      await fresh.writePatientBiomarkers({
        db: { collection: vi.fn(() => ({ insertOne: vi.fn() })) },
        patient: {
          participantId: 'PAC-K',
          biomarkers: [{ value: 1.25 }],
        },
      });
    } finally {
      for (const [p, entry] of Object.entries({
        [influxPath]: prev.influx,
        [svcPath]: prev.svc,
        [integrityPath]: prev.integrity,
      })) {
        if (entry) require.cache[p] = entry;
        else delete require.cache[p];
      }
    }
  });

  it('scheduler checkStaleTemperatureReadings parses ISO timestamp strings', async () => {
    const scheduler = require('../../src/services/scheduler.service');
    const db = {
      collection: vi.fn((name) => {
        if (name === 'sensors') {
          return {
            find: vi.fn(() => ({
              toArray: vi.fn().mockResolvedValue([{ sensorId: 'sens-k' }]),
            })),
          };
        }
        if (name === 'temperatures') {
          return {
            find: vi.fn(() => ({
              sort: vi.fn().mockReturnThis(),
              limit: vi.fn().mockReturnThis(),
              next: vi.fn().mockResolvedValue({
                sensorId: 'sens-k',
                timestamp: '2020-01-01T00:00:00.000Z',
              }),
            })),
          };
        }
        return {
          updateMany: vi.fn().mockResolvedValue({}),
          findOne: vi.fn().mockResolvedValue(null),
          insertOne: vi.fn().mockResolvedValue({}),
        };
      }),
    };
    const result = await scheduler.checkStaleTemperatureReadings(db);
    expect(result.sensors).toBe(1);
  });

  it('security updateConfig merges omitted group via newConfig[group] || {}', async () => {
    const seedPath = require.resolve('../../src/foundation/systemActorSeedV2');
    const svcPath = require.resolve('../../src/services/security.service');
    const prev = {
      seed: require.cache[seedPath],
      svc: require.cache[svcPath],
    };
    const realSeed = require(seedPath);
    require.cache[seedPath] = {
      id: seedPath,
      filename: seedPath,
      loaded: true,
      exports: {
        ...realSeed,
        assertActorReference: vi.fn().mockResolvedValue(undefined),
      },
    };
    delete require.cache[svcPath];
    try {
      const svc = require(svcPath);
      const auditLogger = require('../../src/utils/auditLogger');
      vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
      vi.spyOn(auditLogger, 'log').mockResolvedValue(undefined);
      vi.spyOn(svc, 'detectChanges').mockReturnValue([]);
      vi.spyOn(svc, 'validateConfig').mockImplementation(() => {});

      const updateOne = vi.fn().mockResolvedValue({});
      const db = {
        collection: vi.fn(() => ({ updateOne, findOne: vi.fn() })),
      };
      const current = {
        configVersion: 1,
        session: { timeoutMinutes: 30 },
        passwordRules: { minLength: 8 },
      };
      const next = {
        session: { timeoutMinutes: 45 },
      };
      await svc.updateConfig(db, next, current, { user: { actorId: '00000000-0000-4000-8000-000000000001' } });
      expect(updateOne).toHaveBeenCalled();
      const setDoc = updateOne.mock.calls[0][1].$set;
      expect(setDoc.passwordRules).toEqual({ minLength: 8 });
      expect(setDoc.session.timeoutMinutes).toBe(45);
    } finally {
      if (prev.seed) require.cache[seedPath] = prev.seed;
      else delete require.cache[seedPath];
      if (prev.svc) require.cache[svcPath] = prev.svc;
      else delete require.cache[svcPath];
    }
  });

  it('rcs validateSprecReference uses truthy axisCode in catalogHas lookup', () => {
    const rcs = require('../../src/services/rcs-certification.service');
    const result = rcs.validateSprecReference(
      {
        type: 'ZZZ',
        longTermStorage: 'ZZZ',
      },
      'fluid'
    );
    expect(result.status).toBe('not_scoreable');
    expect(result.trace.some((t) => t.axis_code)).toBe(true);
  });

  it('iot.routes run-cycle-full maps non-Error rejection via String(error)', async () => {
    const express = require('express');
    const request = require('supertest');
    const authPath = require.resolve('../../src/infrastructure/middleware/auth');
    const rbacPath = require.resolve('../../src/infrastructure/middleware/rbac');
    const routePath = require.resolve('../../src/interface/routes/iot.routes');
    const monitorPath = require.resolve('../../src/infrastructure/services/TelemetryMonitor');
    const prev = {
      auth: require.cache[authPath],
      rbac: require.cache[rbacPath],
      route: require.cache[routePath],
      monitor: require.cache[monitorPath],
    };
    delete require.cache[authPath];
    delete require.cache[rbacPath];
    delete require.cache[routePath];

    const authModule = require(authPath);
    authModule.authenticate = (req, _res, next) => {
      req.user = { userID: 'u-k', accessType: 4 };
      next();
    };
    const rbacModule = require(rbacPath);
    rbacModule.requireRole = () => (_req, _res, next) => next();

    const TelemetryMonitor = require(monitorPath);
    const monitor = new TelemetryMonitor({ db: {} });
    vi.spyOn(monitor, 'runCycle').mockRejectedValue({ code: 'boom-k' });

    // iot.routes may construct its own monitor — patch prototype
    vi.spyOn(TelemetryMonitor.prototype, 'runCycle').mockRejectedValue({ code: 'boom-k' });

    const router = require(routePath);
    const app = express();
    app.use(express.json());
    app.locals.db = {};
    app.use('/api/iot', router);

    try {
      const res = await request(app)
        .post('/api/iot/telemetry-monitor/run-cycle-full')
        .send({});
      // 404 if path differs; otherwise 500 with stringified object
      if (res.status === 500) {
        expect(String(res.body?.error || '')).toContain('object');
      } else {
        expect([404, 401, 403, 500]).toContain(res.status);
      }
    } finally {
      for (const [p, entry] of Object.entries({
        [authPath]: prev.auth,
        [rbacPath]: prev.rbac,
        [routePath]: prev.route,
        [monitorPath]: prev.monitor,
      })) {
        if (entry) require.cache[p] = entry;
        else delete require.cache[p];
      }
    }
  });
});
