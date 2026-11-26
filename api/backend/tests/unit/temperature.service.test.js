import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRequire } from 'module';
import { createHash } from 'crypto';

const require = createRequire(import.meta.url);

const TemperatureModel = require('../../src/models/Temperature');
const logger = require('../../src/utils/logger');
const influxTelemetryWriteRepository = require('../../src/infrastructure/persistence/influxdb/InfluxTelemetryWriteRepository');
const influxTelemetryReadRepository = require('../../src/infrastructure/persistence/influxdb/InfluxTelemetryReadRepository');
const notificationServiceV2 = require('../../src/services/NotificationService');
const notificationDispatchService = require('../../src/services/notificationDispatch.service');
const temperatureService = require('../../src/services/temperature.service');
const { canonicalJson } = require('../../src/services/telemetryReadingContract');

afterEach(() => {
  vi.restoreAllMocks();
});

function makeDb(collections = {}) {
  return {
    collection: vi.fn((name) => collections[name])
  };
}

// #1118: checkPolicyAndAlert now checks for an already-active threshold
// alert before inserting. Default the fixture to "none active", which is
// what every pre-#1118 test in this file assumed implicitly.
function alertFindOne(existing = null) {
  return vi.fn().mockResolvedValue(existing);
}

describe('temperatureService.createTemperatureReading', () => {
  it('throws a joined validation error message when validation fails', async () => {
    vi.spyOn(TemperatureModel, 'validate').mockReturnValue({
      isValid: false,
      errors: ['sensorId é obrigatório', 'temperatureValue é obrigatório e deve ser number']
    });

    await expect(
      temperatureService.createTemperatureReading({}, {})
    ).rejects.toThrow('sensorId é obrigatório, temperatureValue é obrigatório e deve ser number');
  });

  // #1391 (RF009 AC1): InfluxDB is the reading's only store, so a created
  // reading is the InfluxDB write's point and no Mongo copy is written.
  it('does not call checkPolicyAndAlert when no policyId/policyID present', async () => {
    const db = makeDb();
    const checkSpy = vi.spyOn(temperatureService, 'checkPolicyAndAlert').mockResolvedValue(undefined);
    const write = vi.spyOn(influxTelemetryWriteRepository, 'writeTemperatureReadingNow').mockResolvedValue(new Date('2026-10-10T12:00:01.000Z'));

    const result = await temperatureService.createTemperatureReading(db, {
      sensorId: 's1',
      temperatureValue: 5
    });

    expect(checkSpy).not.toHaveBeenCalled();
    expect(write).toHaveBeenCalledTimes(1);
    expect(result.telemetryReadingId).toBeTruthy();
    expect(result.telemetryReadingId).toBe(write.mock.calls[0][0].telemetryReadingId);
  });

  it('calls checkPolicyAndAlert when policyId is present', async () => {
    const db = makeDb();
    const checkSpy = vi.spyOn(temperatureService, 'checkPolicyAndAlert').mockResolvedValue(undefined);
    vi.spyOn(influxTelemetryWriteRepository, 'writeTemperatureReadingNow').mockResolvedValue(new Date('2026-10-10T12:00:01.000Z'));

    await temperatureService.createTemperatureReading(db, {
      sensorId: 's1',
      temperatureValue: 5,
      policyId: 'p1'
    });

    expect(checkSpy).toHaveBeenCalledTimes(1);
  });

  it('calls checkPolicyAndAlert when policyID (alternate casing) is present', async () => {
    const db = makeDb();
    const checkSpy = vi.spyOn(temperatureService, 'checkPolicyAndAlert').mockResolvedValue(undefined);
    vi.spyOn(influxTelemetryWriteRepository, 'writeTemperatureReadingNow').mockResolvedValue(new Date('2026-10-10T12:00:01.000Z'));

    await temperatureService.createTemperatureReading(db, {
      sensorId: 's1',
      temperatureValue: 5,
      policyID: 'p2'
    });

    expect(checkSpy).toHaveBeenCalledTimes(1);
  });

  // #1317 (RF009 AC1, RNF016 C3): InfluxDB is the authority; its
  // confirmation is persistedAt.
  it('writes the point to InfluxDB and stamps persistedAt from it', async () => {
    const persisted = new Date('2026-10-10T12:00:01.000Z');
    const db = makeDb();
    const write = vi.spyOn(influxTelemetryWriteRepository, 'writeTemperatureReadingNow').mockResolvedValue(persisted);

    const result = await temperatureService.createTemperatureReading(db, {
      sensorId: 'sensor-x',
      temperatureValue: 3.5
    });

    const stored = write.mock.calls[0][0];
    expect(stored).toMatchObject({ sensorId: 'sensor-x', temperatureValue: 3.5 });
    expect(stored.persistedAt).toBe(persisted);
    expect(result.persistedAt).toBe(persisted);
    expect(result.telemetryReadingId).toBe(stored.telemetryReadingId);
  });

  it('writes no Mongo temperatures copy', async () => {
    const insertOne = vi.fn().mockResolvedValue({ insertedId: 'copy-id' });
    const db = makeDb({ temperatures: { insertOne } });
    vi.spyOn(influxTelemetryWriteRepository, 'writeTemperatureReadingNow').mockResolvedValue(new Date('2026-10-10T12:00:01.000Z'));

    const result = await temperatureService.createTemperatureReading(db, {
      sensorId: 'sensor-x',
      temperatureValue: 3.5
    });

    expect(db.collection).not.toHaveBeenCalledWith('temperatures');
    expect(insertOne).not.toHaveBeenCalled();
    expect(result).not.toHaveProperty('_id');
  });

  it('a failed InfluxDB write stores nothing and answers 503, but still checks the alert policy', async () => {
    const db = makeDb();
    vi.spyOn(logger, 'error').mockImplementation(() => {});
    vi.spyOn(influxTelemetryWriteRepository, 'writeTemperatureReadingNow').mockRejectedValue(new Error('influx down'));
    const checkSpy = vi.spyOn(temperatureService, 'checkPolicyAndAlert').mockResolvedValue(undefined);

    const err = await temperatureService.createTemperatureReading(db, {
      sensorId: 'sensor-x',
      temperatureValue: 3.5,
      policyId: 'p1'
    }).catch((e) => e);

    expect(err).toMatchObject({ statusCode: 503, code: 'TELEMETRY_NOT_PERSISTED' });
    expect(db.collection).not.toHaveBeenCalledWith('temperatures');
    expect(checkSpy).toHaveBeenCalledTimes(1);
  });

  // #636: organizationId, when provided, must resolve to a real
  // Organization -- same write-time validation shape #634/#635 used.
  it('throws a 404 when organizationId does not resolve to a real Organization', async () => {
    const organizations = { findOne: vi.fn().mockResolvedValue(null) };
    const db = makeDb({ organizations });
    const write = vi.spyOn(influxTelemetryWriteRepository, 'writeTemperatureReadingNow');

    const err = await temperatureService.createTemperatureReading(db, {
      sensorId: 's1',
      temperatureValue: 5,
      organizationId: 'org-inexistente'
    }).catch((e) => e);

    expect(err).toBeInstanceOf(Error);
    expect(err.message).toContain('org-inexistente');
    expect(err.statusCode).toBe(404);
    expect(organizations.findOne).toHaveBeenCalledWith({ organizationId: 'org-inexistente' });
    expect(write).not.toHaveBeenCalled();
  });

  it('creates a reading with organizationId when it resolves to a real Organization', async () => {
    const organizations = { findOne: vi.fn().mockResolvedValue({ organizationId: 'org-1' }) };
    const db = makeDb({ organizations });
    vi.spyOn(influxTelemetryWriteRepository, 'writeTemperatureReadingNow').mockResolvedValue(new Date('2026-10-10T12:00:01.000Z'));

    const result = await temperatureService.createTemperatureReading(db, {
      sensorId: 's1',
      temperatureValue: 5,
      organizationId: 'org-1'
    });

    expect(result.organizationId).toBe('org-1');
  });

  it('leaves organizationId null when not provided (no backfill, unscoped/legacy by default)', async () => {
    const db = makeDb();
    vi.spyOn(influxTelemetryWriteRepository, 'writeTemperatureReadingNow').mockResolvedValue(new Date('2026-10-10T12:00:01.000Z'));

    const result = await temperatureService.createTemperatureReading(db, {
      sensorId: 's1',
      temperatureValue: 5
    });

    expect(result.organizationId).toBeNull();
  });

  // RF009 AC7 (#1391): recordClientReplay logs a failed key-store record and
  // the persisted reading goes on, as a failed lookup does.
  it('logs a failed key-store record and still returns the persisted reading', async () => {
    const ingestionIdempotencyKeys = {
      findOne: vi.fn().mockResolvedValue(null),
      createIndex: vi.fn().mockResolvedValue('ok'),
      updateOne: vi.fn().mockRejectedValue(new Error('key store down'))
    };
    const db = makeDb({ ingestionIdempotencyKeys });
    const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});
    const write = vi.spyOn(influxTelemetryWriteRepository, 'writeTemperatureReadingNow').mockResolvedValue(new Date());

    const result = await temperatureService.createTemperatureReading(db, {
      sensorId: 's1',
      temperatureValue: 1,
      idempotencyKey: 'client-key-1'
    });

    expect(ingestionIdempotencyKeys.updateOne).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalled();
    expect(result.telemetryReadingId).toBe(write.mock.calls[0][0].telemetryReadingId);
    expect(db.collection).not.toHaveBeenCalledWith('temperatures');
  });
});

// RULE-025 (#1582): the route hands over a contract-only reading and the
// names of the fields stripped from it. A trustworthy reading is stored and
// flagged; an untrustworthy one is still refused whole.
describe('RULE-025 in createTemperatureReading (#1582)', () => {
  function screenedDb() {
    const issues = [];
    const db = makeDb({
      telemetryIngestionEvents: { insertOne: vi.fn().mockResolvedValue({}) },
      telemetryValidationIssues: { insertMany: vi.fn(async (docs) => { issues.push(...docs); return {}; }) }
    });
    return { db, issues };
  }

  it('(a) stores a contract-only reading and flags its stripped fields', async () => {
    const { db, issues } = screenedDb();
    const write = vi.spyOn(influxTelemetryWriteRepository, 'writeTemperatureReadingNow').mockResolvedValue(new Date());
    const data = { sensorId: 's1', temperatureValue: 5 };

    await temperatureService.createTemperatureReading(db, { ...data, organizationId: null }, { strippedFields: ['patientName'] });

    expect(write).toHaveBeenCalledTimes(1);
    const flagged = issues.filter((issue) => issue.issueCode === 'personal_data_stripped');
    expect(flagged).toEqual([expect.objectContaining({ fieldPath: 'patientName', disposition: 'quarantined' })]);
    expect(write.mock.calls[0][0].payloadHash).toBe(createHash('sha256').update(canonicalJson(data)).digest('hex'));
  });

  it('(b) refuses an implausible reading whole', async () => {
    const { db, issues } = screenedDb();
    const write = vi.spyOn(influxTelemetryWriteRepository, 'writeTemperatureReadingNow').mockResolvedValue(new Date());

    await expect(temperatureService.createTemperatureReading(db, { sensorId: 's1', temperatureValue: 900 }, { strippedFields: ['patientName'] }))
      .rejects.toMatchObject({ statusCode: 422 });

    expect(write).not.toHaveBeenCalled();
    expect(issues.map((issue) => issue.issueCode)).toEqual(expect.arrayContaining(['invalid_value', 'personal_data_stripped']));
  });

  it('(c) no stripped field raises no personal_data_stripped issue', async () => {
    const { db, issues } = screenedDb();
    const write = vi.spyOn(influxTelemetryWriteRepository, 'writeTemperatureReadingNow').mockResolvedValue(new Date());

    await temperatureService.createTemperatureReading(db, { sensorId: 's1', temperatureValue: 5 });

    expect(write).toHaveBeenCalledTimes(1);
    expect(issues.filter((issue) => issue.issueCode === 'personal_data_stripped')).toHaveLength(0);
  });
});

describe('temperatureService.checkPolicyAndAlert', () => {
  it('does not query for or apply a policy when no policyId/policyID is present (#73)', async () => {
    const findOne = vi.fn().mockResolvedValue({ minTemp: 0, maxTemp: 10 });
    const insertOne = vi.fn();
    const db = makeDb({ temperaturePolicies: { findOne }, alerts: { insertOne, findOne: alertFindOne() } });

    await expect(
      temperatureService.checkPolicyAndAlert(db, { temperatureValue: 999 })
    ).resolves.toBeUndefined();

    expect(findOne).not.toHaveBeenCalled();
    expect(insertOne).not.toHaveBeenCalled();
  });

  it('resolves without inserting an alert when no policy is found', async () => {
    const findOne = vi.fn().mockResolvedValue(null);
    const insertOne = vi.fn();
    const db = makeDb({ temperaturePolicies: { findOne }, alerts: { insertOne, findOne: alertFindOne() } });

    await expect(
      temperatureService.checkPolicyAndAlert(db, { policyId: 'p1', temperatureValue: 5 })
    ).resolves.toBeUndefined();

    expect(insertOne).not.toHaveBeenCalled();
  });

  it('does not create an alert when the reading is within thresholds', async () => {
    const policy = { minTemp: 0, maxTemp: 10 };
    const findOne = vi.fn().mockResolvedValue(policy);
    const insertOne = vi.fn();
    // #1079: the in-range branch now resolves active threshold alerts, so
    // this fixture needs updateMany or the call lands in the catch and the
    // assertion below passes for the wrong reason.
    const updateMany = vi.fn().mockResolvedValue({ modifiedCount: 0 });
    const db = makeDb({ temperaturePolicies: { findOne }, alerts: { insertOne, updateMany, findOne: alertFindOne() } });

    await temperatureService.checkPolicyAndAlert(db, {
      policyId: 'p1',
      temperatureValue: 5
    });

    expect(insertOne).not.toHaveBeenCalled();
  });

  // #1198: a policy's limits are Celsius, and a manually recorded reading may
  // carry degF or K (TemperatureModel accepts all three). The comparison used
  // the reading's bare number, so 41 degF -- 5 degC, inside 2..8 -- alerted.
  describe('#1198: the reading is compared in Celsius', () => {
    function inRangeDb() {
      const findOne = vi.fn().mockResolvedValue({ minTemp: 2, maxTemp: 8 });
      const insertOne = vi.fn().mockResolvedValue({ insertedId: 'alert1' });
      const updateMany = vi.fn().mockResolvedValue({ modifiedCount: 0 });
      const db = makeDb({ temperaturePolicies: { findOne }, alerts: { insertOne, updateMany, findOne: alertFindOne() } });
      return { db, insertOne };
    }

    it('a °F reading inside the policy range raises no alert', async () => {
      const { db, insertOne } = inRangeDb();

      await temperatureService.checkPolicyAndAlert(db, {
        policyId: 'p1',
        temperatureValue: 41,
        temperatureUnit: '°F'
      });

      expect(insertOne).not.toHaveBeenCalled();
    });

    it('a K reading inside the policy range raises no alert', async () => {
      const { db, insertOne } = inRangeDb();

      await temperatureService.checkPolicyAndAlert(db, {
        policyId: 'p1',
        temperatureValue: 278.15,
        temperatureUnit: 'K'
      });

      expect(insertOne).not.toHaveBeenCalled();
    });

    it('CONTROL: a °F reading outside the range still alerts, recording the value as read', async () => {
      const { db, insertOne } = inRangeDb();
      vi.spyOn(notificationServiceV2, 'sendCriticalTempAlert').mockResolvedValue(undefined);
      vi.spyOn(notificationDispatchService, 'dispatchNotification').mockResolvedValue(null);

      await temperatureService.checkPolicyAndAlert(db, {
        policyId: 'p1',
        sensorId: 'sensor-a',
        temperatureValue: 50,
        temperatureUnit: '°F'
      });

      expect(insertOne).toHaveBeenCalledTimes(1);
      expect(insertOne.mock.calls[0][0].temperatureValue).toBe(50);
    });
  });

  it('inserts an alert and notifies when the reading is outside policy thresholds', async () => {
    const policy = { minTemp: 0, maxTemp: 10 };
    const findOne = vi.fn().mockResolvedValue(policy);
    const insertOne = vi.fn().mockResolvedValue({ insertedId: 'alert1' });
    const db = makeDb({ temperaturePolicies: { findOne }, alerts: { insertOne, findOne: alertFindOne() } });
    const notifySpy = vi.spyOn(notificationServiceV2, 'sendCriticalTempAlert').mockResolvedValue(undefined);
    const dispatchSpy = vi.spyOn(notificationDispatchService, 'dispatchNotification').mockResolvedValue(null);

    await temperatureService.checkPolicyAndAlert(db, {
      policyId: 'p1',
      sensorId: 'sensor-a',
      sampleId: 'sample-1',
      temperatureValue: 99
    });

    expect(insertOne).toHaveBeenCalledTimes(1);
    const alertDoc = insertOne.mock.calls[0][0];
    expect(alertDoc.sensorId).toBe('sensor-a');
    expect(alertDoc.policyId).toBe('p1');
    expect(alertDoc.temperatureValue).toBe(99);
    expect(alertDoc.threshold).toEqual({ min: 0, max: 10 });
    expect(alertDoc.status).toBe('active');

    expect(notifySpy).toHaveBeenCalledWith('sample-1', 99);

    // #646 Wave 3 (RF015/RNF026) - the rule-driven notification engine is
    // also fired from this real critical-alert trigger, alongside (not
    // instead of) the legacy sendCriticalTempAlert call above.
    expect(dispatchSpy).toHaveBeenCalledWith(db, {
      eventType: 'environmental_excursion',
      sourceEventType: 'TemperatureAlert',
      sourceEventId: 'alert1',
      payload: { sensorId: 'sensor-a', temperatureValue: 99, minThreshold: 0, maxThreshold: 10 }
    });
  });

  it('does not let a rejected notification dispatch break the alert flow (fire-and-forget)', async () => {
    const policy = { minTemp: 0, maxTemp: 10 };
    const findOne = vi.fn().mockResolvedValue(policy);
    const insertOne = vi.fn().mockResolvedValue({ insertedId: 'alert1' });
    const db = makeDb({ temperaturePolicies: { findOne }, alerts: { insertOne, findOne: alertFindOne() } });
    vi.spyOn(notificationServiceV2, 'sendCriticalTempAlert').mockResolvedValue(undefined);
    vi.spyOn(notificationDispatchService, 'dispatchNotification').mockRejectedValue(new Error('no active rule collection'));

    await expect(
      temperatureService.checkPolicyAndAlert(db, { policyId: 'p1', sensorId: 'sensor-a', temperatureValue: 99 })
    ).resolves.toBeUndefined();

    expect(insertOne).toHaveBeenCalledTimes(1);
  });

  // #1079: the alerts collection has two writers with disjoint shapes.
  // scheduler.service.js emits type: 'missing_reading'/'stale_reading' and
  // both of its lifecycle helpers filter on { sensorId, type, status }, so
  // this writer's untyped document could be matched by neither -- threshold
  // breaches were never deduplicated and never resolved.
  it('#1079: tags the alert with a threshold_breach type so the scheduler lifecycle helpers can match it', async () => {
    const policy = { minTemp: 0, maxTemp: 10 };
    const findOne = vi.fn().mockResolvedValue(policy);
    const insertOne = vi.fn().mockResolvedValue({ insertedId: 'alert1' });
    const updateMany = vi.fn().mockResolvedValue({ modifiedCount: 0 });
    const db = makeDb({ temperaturePolicies: { findOne }, alerts: { insertOne, updateMany, findOne: alertFindOne() } });
    vi.spyOn(notificationServiceV2, 'sendCriticalTempAlert').mockResolvedValue(undefined);
    vi.spyOn(notificationDispatchService, 'dispatchNotification').mockResolvedValue(null);

    await temperatureService.checkPolicyAndAlert(db, {
      policyId: 'p1',
      sensorId: 'sensor-a',
      temperatureValue: 99
    });

    expect(insertOne).toHaveBeenCalledTimes(1);
    expect(insertOne.mock.calls[0][0].type).toBe('threshold_breach');
  });

  it('#1079: resolves active threshold alerts for the sensor once a reading is back within range', async () => {
    const policy = { minTemp: 0, maxTemp: 10 };
    const findOne = vi.fn().mockResolvedValue(policy);
    const insertOne = vi.fn();
    const updateMany = vi.fn().mockResolvedValue({ modifiedCount: 2 });
    const db = makeDb({ temperaturePolicies: { findOne }, alerts: { insertOne, updateMany, findOne: alertFindOne() } });

    await temperatureService.checkPolicyAndAlert(db, {
      policyId: 'p1',
      sensorId: 'sensor-a',
      temperatureValue: 5
    });

    expect(insertOne).not.toHaveBeenCalled();
    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(updateMany.mock.calls[0][0]).toEqual({ sensorId: 'sensor-a', type: 'threshold_breach', status: 'active' });
    expect(updateMany.mock.calls[0][1].$set.status).toBe('resolved');
    expect(updateMany.mock.calls[0][1].$set.resolvedAt).toBeInstanceOf(Date);
  });

  // Control: the resolve must not fire while the reading is still bad, or a
  // sensor sitting out of range would clear its own alert on every reading.
  it('#1079: does not resolve anything while the reading is still out of range', async () => {
    const policy = { minTemp: 0, maxTemp: 10 };
    const findOne = vi.fn().mockResolvedValue(policy);
    const insertOne = vi.fn().mockResolvedValue({ insertedId: 'alert1' });
    const updateMany = vi.fn().mockResolvedValue({ modifiedCount: 0 });
    const db = makeDb({ temperaturePolicies: { findOne }, alerts: { insertOne, updateMany, findOne: alertFindOne() } });
    vi.spyOn(notificationServiceV2, 'sendCriticalTempAlert').mockResolvedValue(undefined);
    vi.spyOn(notificationDispatchService, 'dispatchNotification').mockResolvedValue(null);

    await temperatureService.checkPolicyAndAlert(db, {
      policyId: 'p1',
      sensorId: 'sensor-a',
      temperatureValue: 99
    });

    expect(updateMany).not.toHaveBeenCalled();
  });

  // #1118: split from #1079. That commit gave the threshold alert a `type`
  // so the scheduler lifecycle helpers COULD match it, and wired the resolve
  // half -- but left the insert unconditional, so an episode still wrote one
  // document per reading. A freezer out of range for a day at a one-minute
  // poll is 1,440 rows, and since #1079 bounded getActiveAlerts at
  // `limit || 1000` a single sustained excursion can fill the whole default
  // page with one sensor and push every other sensor off it.
  //
  // Shape 1 of the three the issue lists: dedup the ROW, keep both
  // notifications firing per reading. Shape 2 (dedup the notifications too)
  // was not taken -- for a cold chain, silencing an operator who missed the
  // first alert while the excursion continues is a safety call and Denise's,
  // and RF009 AC#6 says to raise an alert without saying how often.
  //
  // The dedup filter deliberately matches ensureActiveAlert's own
  // ({ sensorId, type, status: "active" }) rather than inventing a second
  // predicate -- same reason #1079 gave for mirroring the resolve.
  describe('#1118: one alert row per episode, not per reading', () => {
    const policy = { minTemp: 0, maxTemp: 10 };
    const BREACH = { policyId: 'p1', sensorId: 'sensor-a', temperatureValue: 99 };

    function quietNotifications() {
      vi.spyOn(notificationServiceV2, 'sendCriticalTempAlert').mockResolvedValue(undefined);
      vi.spyOn(notificationDispatchService, 'dispatchNotification').mockResolvedValue(null);
    }

    it('does not insert a second alert while one is already active', async () => {
      const findOne = vi.fn().mockResolvedValue(policy);
      const insertOne = vi.fn().mockResolvedValue({ insertedId: 'alert1' });
      const updateMany = vi.fn().mockResolvedValue({ modifiedCount: 0 });
      const alertFind = alertFindOne({ _id: 'existing-alert', status: 'active' });
      const db = makeDb({
        temperaturePolicies: { findOne },
        alerts: { insertOne, updateMany, findOne: alertFind },
      });
      quietNotifications();

      await temperatureService.checkPolicyAndAlert(db, BREACH);

      expect(insertOne).not.toHaveBeenCalled();
    });

    it('looks for the active alert with the same filter ensureActiveAlert uses', async () => {
      const findOne = vi.fn().mockResolvedValue(policy);
      const insertOne = vi.fn().mockResolvedValue({ insertedId: 'alert1' });
      const updateMany = vi.fn().mockResolvedValue({ modifiedCount: 0 });
      const alertFind = alertFindOne(null);
      const db = makeDb({
        temperaturePolicies: { findOne },
        alerts: { insertOne, updateMany, findOne: alertFind },
      });
      quietNotifications();

      await temperatureService.checkPolicyAndAlert(db, BREACH);

      expect(alertFind).toHaveBeenCalledTimes(1);
      expect(alertFind.mock.calls[0][0]).toEqual({
        sensorId: 'sensor-a',
        type: 'threshold_breach',
        status: 'active',
      });
    });

    // Shape 1 is defined by this: the ROW is deduped, the operator is not.
    it('still fires both notifications on a reading whose insert was skipped', async () => {
      const findOne = vi.fn().mockResolvedValue(policy);
      const insertOne = vi.fn();
      const updateMany = vi.fn().mockResolvedValue({ modifiedCount: 0 });
      const db = makeDb({
        temperaturePolicies: { findOne },
        alerts: { insertOne, updateMany, findOne: alertFindOne({ _id: 'existing-alert' }) },
      });
      const critical = vi.spyOn(notificationServiceV2, 'sendCriticalTempAlert').mockResolvedValue(undefined);
      const dispatch = vi.spyOn(notificationDispatchService, 'dispatchNotification').mockResolvedValue(null);

      await temperatureService.checkPolicyAndAlert(db, BREACH);

      expect(critical).toHaveBeenCalledTimes(1);
      expect(dispatch).toHaveBeenCalledTimes(1);
    });

    // The issue named this as the thing blocking shape 1. Nothing in src/
    // reads sourceEventId back, so reusing the existing id breaks no
    // consumer -- but it must still point at a real alert, not undefined.
    it('points sourceEventId at the EXISTING alert when the insert is skipped', async () => {
      const findOne = vi.fn().mockResolvedValue(policy);
      const insertOne = vi.fn();
      const updateMany = vi.fn().mockResolvedValue({ modifiedCount: 0 });
      const db = makeDb({
        temperaturePolicies: { findOne },
        alerts: { insertOne, updateMany, findOne: alertFindOne({ _id: 'existing-alert' }) },
      });
      vi.spyOn(notificationServiceV2, 'sendCriticalTempAlert').mockResolvedValue(undefined);
      const dispatch = vi.spyOn(notificationDispatchService, 'dispatchNotification').mockResolvedValue(null);

      await temperatureService.checkPolicyAndAlert(db, BREACH);

      expect(dispatch.mock.calls[0][1].sourceEventId).toBe('existing-alert');
    });

    // CONTROL: green before and after. If this reds, the dedup closed the
    // insert path outright rather than making it conditional (#695).
    it('CONTROL: still inserts when no alert is active for the sensor', async () => {
      const findOne = vi.fn().mockResolvedValue(policy);
      const insertOne = vi.fn().mockResolvedValue({ insertedId: 'alert1' });
      const updateMany = vi.fn().mockResolvedValue({ modifiedCount: 0 });
      const db = makeDb({
        temperaturePolicies: { findOne },
        alerts: { insertOne, updateMany, findOne: alertFindOne(null) },
      });
      quietNotifications();

      await temperatureService.checkPolicyAndAlert(db, BREACH);

      expect(insertOne).toHaveBeenCalledTimes(1);
      expect(insertOne.mock.calls[0][0].type).toBe('threshold_breach');
    });

    // CONTROL: the dedup must not suppress the RESOLVE, which is the other
    // half of #1079 and runs on the in-range branch.
    it('CONTROL: an in-range reading still resolves, untouched by the dedup', async () => {
      const findOne = vi.fn().mockResolvedValue(policy);
      const insertOne = vi.fn();
      const updateMany = vi.fn().mockResolvedValue({ modifiedCount: 2 });
      const db = makeDb({
        temperaturePolicies: { findOne },
        alerts: { insertOne, updateMany, findOne: alertFindOne({ _id: 'existing-alert' }) },
      });

      await temperatureService.checkPolicyAndAlert(db, {
        policyId: 'p1',
        sensorId: 'sensor-a',
        temperatureValue: 5,
      });

      expect(updateMany).toHaveBeenCalledTimes(1);
      expect(insertOne).not.toHaveBeenCalled();
    });
  });

  it('swallows internal errors (e.g. policiesCollection.findOne rejecting) and resolves', async () => {
    const findOne = vi.fn().mockRejectedValue(new Error('db unreachable'));
    const db = makeDb({ temperaturePolicies: { findOne } });
    const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});

    await expect(
      temperatureService.checkPolicyAndAlert(db, { policyId: 'p1', temperatureValue: 5 })
    ).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalled();
  });
});

// RF009 AC1 (#1317): the history reads InfluxDB through temperatureReport,
// not the Mongo `temperatures` copy. A point carries no organizationId, so an
// org-scoped caller is scoped to their organizations' sensors.
describe('temperatureService.getTemperatureHistory', () => {
  function givenReport(result = { rows: [], total: 0 }) {
    return vi.spyOn(influxTelemetryReadRepository, 'temperatureReport').mockResolvedValue(result);
  }

  function sensorsCollection(sensors) {
    const toArray = vi.fn().mockResolvedValue(sensors);
    return { find: vi.fn().mockReturnValue({ toArray }) };
  }

  it('uses default limit and skip and an unbounded, unscoped read', async () => {
    const report = givenReport();
    const db = makeDb({});

    const result = await temperatureService.getTemperatureHistory(db, {});

    expect(report).toHaveBeenCalledWith({ start: null, stop: null, sensorIds: null, critical: null, limit: 1000, offset: 0 });
    expect(result.limit).toBe(1000);
    expect(result.skip).toBe(0);
  });

  it('reads no Mongo temperatures collection', async () => {
    givenReport();
    const db = makeDb({});

    await temperatureService.getTemperatureHistory(db, { sensorId: 'sensor-1', startDate: '2024-01-01' });

    expect(db.collection).not.toHaveBeenCalledWith('temperatures');
  });

  // #917: `sensorID` is a live input alias (api.ts sends it).
  it('restricts the read to the given sensorId, or its sensorID alias', async () => {
    const report = givenReport();
    const db = makeDb({});

    await temperatureService.getTemperatureHistory(db, { sensorId: 'sensor-1' });
    await temperatureService.getTemperatureHistory(db, { sensorID: 'sensor-2' });

    expect(report.mock.calls[0][0].sensorIds).toEqual(['sensor-1']);
    expect(report.mock.calls[1][0].sensorIds).toEqual(['sensor-2']);
  });

  // A Flux stop is exclusive, where the Mongo read's endDate was $lte.
  it('reads from startDate up to and including endDate', async () => {
    const report = givenReport();
    const db = makeDb({});

    const start = '2024-01-01';
    const end = '2024-01-31';
    await temperatureService.getTemperatureHistory(db, { startDate: start, endDate: end });

    const call = report.mock.calls[0][0];
    expect(call.start).toEqual(new Date(start));
    expect(call.stop).toEqual(new Date(new Date(end).getTime() + 1));
  });

  it('leaves the stop open when only startDate is given', async () => {
    const report = givenReport();
    const db = makeDb({});

    const start = '2024-02-01';
    await temperatureService.getTemperatureHistory(db, { sensorId: 'sensor-9', startDate: start });

    const call = report.mock.calls[0][0];
    expect(call.start).toEqual(new Date(start));
    expect(call.stop).toBeNull();
    expect(call.sensorIds).toEqual(['sensor-9']);
  });

  it('answers an empty page without a query when a date is invalid', async () => {
    const report = givenReport();
    const db = makeDb({});

    const result = await temperatureService.getTemperatureHistory(db, { endDate: 'not-a-date' });

    expect(result).toEqual({ temperatures: [], total: 0, limit: 1000, skip: 0 });
    expect(report).not.toHaveBeenCalled();
  });

  // #636 (F3-G09): an org-scoped caller sees only their organizations'
  // sensors' readings.
  it('scopes an organization-scoped caller to their organizations\' sensors', async () => {
    const report = givenReport();
    const db = makeDb({
      sensors: sensorsCollection([
        { sensorId: 'S-org1', organizationId: 'org-1' },
        { sensorId: 'S-org2', organizationId: 'org-2' },
        { organizationId: 'org-1' },
      ]),
    });

    await temperatureService.getTemperatureHistory(db, {
      organizationScope: { scope: 'organization', organizationIds: ['org-1'] }
    });

    expect(report.mock.calls[0][0].sensorIds).toEqual(['S-org1']);
  });

  it('gives an org-scoped caller no sensor when the requested sensorId is not theirs', async () => {
    const report = givenReport();
    const db = makeDb({ sensors: sensorsCollection([{ sensorId: 'S-org1', organizationId: 'org-1' }]) });

    await temperatureService.getTemperatureHistory(db, {
      sensorId: 'S-org2',
      organizationScope: { scope: 'organization', organizationIds: ['org-1'] }
    });

    expect(report.mock.calls[0][0].sensorIds).toEqual([]);
  });

  it('gives an org-scoped caller whose organizations hold no sensor no sensor', async () => {
    const report = givenReport();
    const db = makeDb({ sensors: sensorsCollection([{ sensorId: 'S-org2', organizationId: 'org-2' }]) });

    await temperatureService.getTemperatureHistory(db, {
      organizationScope: { scope: 'organization', organizationIds: ['org-1'] }
    });

    expect(report.mock.calls[0][0].sensorIds).toEqual([]);
  });

  it('does not scope a global-scope caller (Administrador) and reads no sensors', async () => {
    const report = givenReport();
    const db = makeDb({});

    await temperatureService.getTemperatureHistory(db, { organizationScope: { scope: 'global' } });

    expect(report.mock.calls[0][0].sensorIds).toBeNull();
    expect(db.collection).not.toHaveBeenCalledWith('sensors');
  });

  it('passes custom limit and skip through, and returns the read\'s rows and total', async () => {
    const rows = [{ telemetryReadingId: 'r1' }, { telemetryReadingId: 'r2' }];
    const report = givenReport({ rows, total: 42 });
    const db = makeDb({});

    const result = await temperatureService.getTemperatureHistory(db, { limit: 5, skip: 10 });

    expect(report.mock.calls[0][0]).toMatchObject({ limit: 5, offset: 10 });
    expect(result).toEqual({ temperatures: rows, total: 42, limit: 5, skip: 10 });
  });

  // Flux refuses a negative n or offset.
  it('falls back to the default limit and skip when they are negative', async () => {
    const report = givenReport();
    const db = makeDb({});

    await temperatureService.getTemperatureHistory(db, { limit: -5, skip: -1 });

    expect(report.mock.calls[0][0]).toMatchObject({ limit: 1000, offset: 0 });
  });

  it('rejects when the InfluxDB read fails, rather than answering an empty page', async () => {
    vi.spyOn(influxTelemetryReadRepository, 'temperatureReport').mockRejectedValue(new Error('influx down'));
    vi.spyOn(logger, 'error').mockImplementation(() => {});
    const db = makeDb({});

    await expect(temperatureService.getTemperatureHistory(db, {})).rejects.toThrow('influx down');
  });
});

// #1391 (RF009 AC1): a reading is read from InfluxDB by its
// telemetryReadingId. A point carries no organizationId, so an org-scoped
// caller is scoped to their organizations' sensors.
describe('temperatureService.getReadingById', () => {
  const READING_ID = '0b6f7e2c-4a1d-4c3e-9f0a-1b2c3d4e5f60';
  const ORG_SCOPE = { scope: 'organization', organizationIds: ['org-1'] };

  function givenReading(reading) {
    return vi.spyOn(influxTelemetryReadRepository, 'readingById').mockResolvedValue(reading);
  }

  function sensorsCollection(sensors) {
    const toArray = vi.fn().mockResolvedValue(sensors);
    return { find: vi.fn().mockReturnValue({ toArray }) };
  }

  it('answers null when InfluxDB holds no reading with that id', async () => {
    const byId = givenReading(null);
    const db = makeDb({});

    const result = await temperatureService.getReadingById(db, READING_ID, ORG_SCOPE);

    expect(result).toBeNull();
    expect(byId).toHaveBeenCalledWith(READING_ID);
  });

  it('puts the reading in scope for a global-scope caller without reading sensors', async () => {
    const reading = { telemetryReadingId: READING_ID, sensorId: 'S-other' };
    givenReading(reading);
    const db = makeDb({});

    const result = await temperatureService.getReadingById(db, READING_ID, { scope: 'global' });

    expect(result).toEqual({ reading, inScope: true });
    expect(db.collection).not.toHaveBeenCalledWith('sensors');
  });

  it('puts the reading in scope for an org-scoped caller whose organization holds its sensor', async () => {
    const reading = { telemetryReadingId: READING_ID, sensorId: 'S-org1' };
    givenReading(reading);
    const db = makeDb({ sensors: sensorsCollection([{ sensorId: 'S-org1', organizationId: 'org-1' }]) });

    const result = await temperatureService.getReadingById(db, READING_ID, ORG_SCOPE);

    expect(result).toEqual({ reading, inScope: true });
  });

  it('puts a reading of another organization\'s sensor out of scope for an org-scoped caller', async () => {
    givenReading({ telemetryReadingId: READING_ID, sensorId: 'S-org2' });
    const db = makeDb({
      sensors: sensorsCollection([
        { sensorId: 'S-org1', organizationId: 'org-1' },
        { sensorId: 'S-org2', organizationId: 'org-2' },
      ]),
    });

    const result = await temperatureService.getReadingById(db, READING_ID, ORG_SCOPE);

    expect(result.inScope).toBe(false);
  });

  it('puts a reading with no sensorId out of scope for an org-scoped caller', async () => {
    givenReading({ telemetryReadingId: READING_ID, sensorId: null });
    const db = makeDb({ sensors: sensorsCollection([{ sensorId: 'S-org1', organizationId: 'org-1' }]) });

    const result = await temperatureService.getReadingById(db, READING_ID, ORG_SCOPE);

    expect(result.inScope).toBe(false);
  });

  it('rejects when the InfluxDB read fails, rather than answering no reading', async () => {
    vi.spyOn(influxTelemetryReadRepository, 'readingById').mockRejectedValue(new Error('influx down'));
    const db = makeDb({});

    await expect(temperatureService.getReadingById(db, READING_ID, ORG_SCOPE)).rejects.toThrow('influx down');
  });
});

describe('temperatureService.getActiveAlerts', () => {
  it('returns [] immediately without calling .collection when db is falsy', async () => {
    const result = await temperatureService.getActiveAlerts(null);
    expect(result).toEqual([]);
  });

  it('returns the array from toArray() on success', async () => {
    const docs = [{ status: 'active', sensorId: 's1' }];
    const toArray = vi.fn().mockResolvedValue(docs);
    // #1079: the read is bounded now, so the chain gains a .limit() stage.
    const limit = vi.fn().mockReturnValue({ toArray });
    const sort = vi.fn().mockReturnValue({ limit, toArray });
    const find = vi.fn().mockReturnValue({ sort });
    const db = makeDb({ alerts: { find } });

    // #1062: getActiveAlerts now takes the caller's resolved scope and
    // filters on it. Called without one it fails CLOSED and returns []
    // without querying, which is pinned separately below -- so this case
    // supplies a scope and asserts the scoped query.
    const result = await temperatureService.getActiveAlerts(db, {
      organizationScope: { scope: 'organization', organizationIds: ['org-a'] },
    });

    expect(find).toHaveBeenCalledWith({ status: 'active', organizationId: { $in: ['org-a'] } });
    expect(sort).toHaveBeenCalledWith({ timestamp: -1 });
    expect(result).toEqual(docs);
  });

  // #1062: fail-closed. A missing scope means requireOrganizationScope is
  // not on the route; returning [] is the refusal, and it must not fall
  // through to an unfiltered query the way this module's sibling read does.
  it('returns [] without querying when no organizationScope is supplied (fail-closed)', async () => {
    const find = vi.fn();
    const db = { collection: vi.fn().mockReturnValue({ find }) };

    const result = await temperatureService.getActiveAlerts(db);

    expect(result).toEqual([]);
    expect(find).not.toHaveBeenCalled();
  });

  // #1079: the only read of this collection was unbounded -- no limit, no
  // projection, toArray() over a set that only ever grew.
  it('#1079: bounds the active-alert read with the default limit', async () => {
    const toArray = vi.fn().mockResolvedValue([]);
    const limit = vi.fn().mockReturnValue({ toArray });
    const sort = vi.fn().mockReturnValue({ limit, toArray });
    const find = vi.fn().mockReturnValue({ sort });
    const db = makeDb({ alerts: { find } });

    await temperatureService.getActiveAlerts(db, {
      organizationScope: { scope: 'organization', organizationIds: ['org-a'] },
    });

    expect(limit).toHaveBeenCalledWith(1000);
  });

  it('#1079: honours a caller-supplied limit, same as getTemperatureHistory', async () => {
    const toArray = vi.fn().mockResolvedValue([]);
    const limit = vi.fn().mockReturnValue({ toArray });
    const sort = vi.fn().mockReturnValue({ limit, toArray });
    const find = vi.fn().mockReturnValue({ sort });
    const db = makeDb({ alerts: { find } });

    await temperatureService.getActiveAlerts(db, {
      organizationScope: { scope: 'organization', organizationIds: ['org-a'] },
      limit: 50,
    });

    expect(limit).toHaveBeenCalledWith(50);
  });
  it('swallows a thrown error from .find and returns []', async () => {
    const find = vi.fn(() => {
      throw new Error('sensors offline');
    });
    const db = makeDb({ alerts: { find } });
    const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});

    const result = await temperatureService.getActiveAlerts(db);

    expect(result).toEqual([]);
    expect(errorSpy).toHaveBeenCalled();
  });
});
