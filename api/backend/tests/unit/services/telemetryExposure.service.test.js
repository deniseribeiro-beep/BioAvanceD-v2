import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const service = require('../../../src/services/telemetryExposure.service');
const influxRead = require('../../../src/infrastructure/persistence/influxdb/InfluxTelemetryReadRepository');
const sensorDatastream = require('../../../src/services/sensorDatastream.service');

// #1392 (RF009 AC5/AC6, RULE-027): a query-matching fake, as in
// physicalChain.service.test.js. Equality and `$in` match the way Mongo
// does; the Influx read and the policy lookup are spied.
function matches(doc, filter) {
  return Object.entries(filter).every(([key, value]) => {
    if (value && typeof value === 'object' && Array.isArray(value.$in)) return value.$in.includes(doc[key]);
    return doc[key] === value;
  });
}

function createFakeCollection() {
  const docs = [];
  return {
    docs,
    async createIndex() {},
    async insertOne(doc) { docs.push({ ...doc }); return { insertedId: docs.length }; },
    async findOne(filter) { return docs.find((doc) => matches(doc, filter)) || null; },
    find(filter = {}) { return { toArray: async () => docs.filter((doc) => matches(doc, filter)) }; },
  };
}

function createFakeDb() {
  const collections = {};
  return {
    collections,
    collection(name) {
      collections[name] = collections[name] || createFakeCollection();
      return collections[name];
    },
  };
}

const BASE = Date.parse('2026-09-01T00:00:00.000Z');
const M = (minutes) => new Date(BASE + minutes * 60 * 1000);

const sca = (over = {}) => ({ specimenContainerAssignmentId: 'sca-1', specimenId: 'SPC-1', containerId: 'CT-1', loadedAt: M(0), unloadedAt: null, ...over });
const cpa = (over = {}) => ({ containerPositionAssignmentId: 'cpa-1', containerId: 'CT-1', storagePositionId: 'rack-1:A01', placedAt: M(60), removedAt: null, ...over });
const rla = (over = {}) => ({ rackLocationAssignmentId: 'rla-1', storageRackId: 'rack-1', storageLocationId: 'loc-1', placedAt: M(120), removedAt: null, ...over });
const stream = (over = {}) => ({
  telemetryDatastreamId: 'ds-1', sensorId: 'S1', storageLocationId: 'loc-1', observedProperty: 'temperature',
  thresholdProfileId: 'pol-1', validityPeriod: { start: M(-10000), end: null }, ...over,
});
const reading = (minutes, celsius, over = {}) => ({
  timestamp: M(minutes), telemetryReadingId: `R-${minutes}`, datastreamId: 'ds-1', storageLocationId: 'loc-1', temperatureCelsius: celsius, ...over,
});

async function seed(db, { scas = [sca()], cpas = [cpa()], rlas = [rla()], streams = [stream()] } = {}) {
  for (const row of scas) await db.collection('specimenContainerAssignments').insertOne(row);
  for (const row of cpas) await db.collection('containerPositionAssignments').insertOne(row);
  for (const row of rlas) await db.collection('rackLocationAssignments').insertOne(row);
  for (const row of streams) await db.collection('telemetryDatastreams').insertOne(row);
}

async function expectRefusal(promise, code, statusCode) {
  await expect(promise).rejects.toMatchObject({ name: 'TelemetryExposureError', code, statusCode });
}

const LIMITS = [{ datastreamId: 'ds-1', thresholdProfileId: 'pol-1', minTemp: -90, maxTemp: -70 }];
const piece = (over = {}) => ({
  specimenId: 'SPC-1', specimenContainerAssignmentId: 'sca-1', containerPositionAssignmentId: 'cpa-1', rackLocationAssignmentId: 'rla-1',
  storageLocationId: 'loc-1', streams: LIMITS, calculatedAt: M(10000), ...over,
});

describe('telemetryExposure.service (#1392, RF009 AC5/AC6, RULE-027)', () => {
  let db;
  let readings;
  let policies;

  beforeEach(() => {
    db = createFakeDb();
    readings = [];
    policies = new Map([['pol-1', { _id: 'pol-1', minTemp: -90, maxTemp: -70 }]]);
    vi.spyOn(influxRead, 'readingsAtLocation').mockImplementation(async () => readings);
    vi.spyOn(sensorDatastream, 'policiesByProfileId').mockImplementation(async () => policies);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('the path through the assignment chain', () => {
    it("a piece is the three assignments' intervals intersected and clipped to the window, and is stored", async () => {
      await seed(db, { scas: [sca({ unloadedAt: M(600) })], cpas: [cpa({ removedAt: M(500) })] });

      const [summary, ...rest] = await service.summarizeExposure(db, { specimenId: 'SPC-1', windowStart: M(-100), windowEnd: M(1000) });

      expect(rest).toEqual([]);
      expect(summary).toMatchObject({
        specimenId: 'SPC-1', storageAssignmentId: null, windowStart: M(120), windowEnd: M(500),
        specimenContainerAssignmentId: 'sca-1', containerPositionAssignmentId: 'cpa-1', rackLocationAssignmentId: 'rla-1',
        datastreamIds: ['ds-1'], calculationVersion: '1.0.0',
      });
      expect(influxRead.readingsAtLocation).toHaveBeenCalledWith({ storageLocationId: 'loc-1', start: M(120), stop: M(500) });
      expect(db.collection('telemetryExposureSummaries').docs).toEqual([summary]);

      const [clipped] = await service.summarizeExposure(db, { specimenId: 'SPC-1', windowStart: M(200), windowEnd: M(300) });
      expect(clipped).toMatchObject({ windowStart: M(200), windowEnd: M(300) });
    });

    it('counts a reading at the piece start and not one at its end (half-open)', async () => {
      await seed(db, { cpas: [cpa({ removedAt: M(500) })] });
      readings = [reading(119, -80), reading(120, -80), reading(300, -82), reading(500, -40)];

      const [summary] = await service.summarizeExposure(db, { specimenId: 'SPC-1', windowEnd: M(1000) });

      expect(summary).toMatchObject({ observationCount: 2, minimumValue: -82, maximumValue: -80, meanValue: -81, excursionCount: 0 });
    });

    it('gives a container moved between positions one summary per position', async () => {
      await seed(db, {
        cpas: [cpa({ removedAt: M(300) }), cpa({ containerPositionAssignmentId: 'cpa-2', storagePositionId: 'rack-1:B02', placedAt: M(300) })],
        rlas: [rla({ placedAt: M(0) })],
      });

      const summaries = await service.summarizeExposure(db, { specimenId: 'SPC-1', windowEnd: M(600) });

      expect(summaries.map((s) => [s.containerPositionAssignmentId, s.windowStart, s.windowEnd])).toEqual([
        ['cpa-1', M(60), M(300)],
        ['cpa-2', M(300), M(600)],
      ]);
    });

    it('reads each location for its own piece when the rack moves', async () => {
      await seed(db, {
        cpas: [cpa({ placedAt: M(0) })],
        rlas: [rla({ placedAt: M(0), removedAt: M(300) }), rla({ rackLocationAssignmentId: 'rla-2', storageLocationId: 'loc-2', placedAt: M(300) })],
        streams: [stream(), stream({ telemetryDatastreamId: 'ds-2', sensorId: 'S2', storageLocationId: 'loc-2' })],
      });

      const summaries = await service.summarizeExposure(db, { specimenId: 'SPC-1', windowEnd: M(600) });

      expect(summaries.map((s) => [s.rackLocationAssignmentId, s.datastreamIds])).toEqual([['rla-1', ['ds-1']], ['rla-2', ['ds-2']]]);
      expect(influxRead.readingsAtLocation.mock.calls.map(([query]) => query)).toEqual([
        { storageLocationId: 'loc-1', start: M(0), stop: M(300) },
        { storageLocationId: 'loc-2', start: M(300), stop: M(600) },
      ]);
    });

    it('clips open assignments to windowEnd, or to now without one', async () => {
      await seed(db);

      const [toWindow] = await service.summarizeExposure(db, { specimenId: 'SPC-1', windowEnd: M(650) }, { now: M(700) });
      const [toNow] = await service.summarizeExposure(db, { specimenId: 'SPC-1' }, { now: M(700) });

      expect(toWindow).toMatchObject({ windowStart: M(120), windowEnd: M(650) });
      expect(toNow).toMatchObject({ windowStart: M(120), windowEnd: M(700), calculatedAt: M(700) });
    });

    it('answers 422 EXPOSURE_PATH_EMPTY when no piece overlaps the window, and stores nothing', async () => {
      await seed(db, { scas: [sca({ unloadedAt: M(600) })] });

      await expectRefusal(service.summarizeExposure(db, { specimenId: 'SPC-1', windowStart: M(600), windowEnd: M(900) }), 'EXPOSURE_PATH_EMPTY', 422);
      await expectRefusal(service.summarizeExposure(db, { specimenId: 'SPC-OTHER', windowEnd: M(900) }), 'EXPOSURE_PATH_EMPTY', 422);
      expect(db.collection('telemetryExposureSummaries').docs).toEqual([]);
    });

    it('adds no piece for a position id without a rack prefix', async () => {
      await seed(db, { cpas: [cpa({ storagePositionId: 'A01' }), cpa({ containerPositionAssignmentId: 'cpa-2', storagePositionId: ':A01' })] });
      await db.collection('rackLocationAssignments').insertOne(rla({ rackLocationAssignmentId: 'rla-blank', storageRackId: '' }));

      await expectRefusal(service.summarizeExposure(db, { specimenId: 'SPC-1', windowEnd: M(900) }), 'EXPOSURE_PATH_EMPTY', 422);
    });

    it('answers 400 INVALID_INPUT for an unparseable date or an empty window', async () => {
      await seed(db);

      await expectRefusal(service.summarizeExposure(db, { specimenId: 'SPC-1', windowStart: 'nope' }), 'INVALID_INPUT', 400);
      await expectRefusal(service.summarizeExposure(db, { specimenId: 'SPC-1', windowEnd: 'nope' }), 'INVALID_INPUT', 400);
      await expectRefusal(service.summarizeExposure(db, { specimenId: 'SPC-1', windowStart: M(300), windowEnd: M(300) }), 'INVALID_INPUT', 400);
      await expectRefusal(service.summarizeExposure(db, { specimenId: 'SPC-1', windowStart: M(300), windowEnd: M(200) }), 'INVALID_INPUT', 400);
    });
  });

  describe('a reproducible summary', () => {
    it('summarizes zero readings at a monitored location as count 0, no statistics and coverage 0', async () => {
      await seed(db);

      const [summary] = await service.summarizeExposure(db, { specimenId: 'SPC-1', windowEnd: M(600) });

      expect(summary).toMatchObject({
        observationCount: 0, minimumValue: null, maximumValue: null, meanValue: null,
        coverageRatio: 0, excursionCount: 0, timeOutsideThresholdSeconds: 0,
      });
    });

    it('refuses with 422 EXPOSURE_NOT_REPRODUCIBLE a location with no temperature datastream valid in the piece', async () => {
      await seed(db, { streams: [stream({ validityPeriod: { start: M(-100), end: M(100) } }), stream({ telemetryDatastreamId: 'ds-h', observedProperty: 'humidity' })] });

      await expectRefusal(service.summarizeExposure(db, { specimenId: 'SPC-1', windowEnd: M(600) }), 'EXPOSURE_NOT_REPRODUCIBLE', 422);
      expect(db.collection('telemetryExposureSummaries').docs).toEqual([]);
    });

    it('refuses with 422 a datastream whose profile names no policy, or one without finite limits', async () => {
      await seed(db);
      policies = new Map();
      await expectRefusal(service.summarizeExposure(db, { specimenId: 'SPC-1', windowEnd: M(600) }), 'EXPOSURE_NOT_REPRODUCIBLE', 422);

      policies = new Map([['pol-1', { _id: 'pol-1', minTemp: -90, maxTemp: null }]]);
      await expectRefusal(service.summarizeExposure(db, { specimenId: 'SPC-1', windowEnd: M(600) }), 'EXPOSURE_NOT_REPRODUCIBLE', 422);
    });

    it("refuses with 422 a reading of a datastream that is not the location's", async () => {
      await seed(db);
      readings = [reading(200, -80), reading(210, -80, { datastreamId: 'ds-foreign' })];

      await expectRefusal(service.summarizeExposure(db, { specimenId: 'SPC-1', windowEnd: M(600) }), 'EXPOSURE_NOT_REPRODUCIBLE', 422);
    });

    it('counts two excursions in readings in/out/out/in/out, a reading at maxTemp inside, and sums their seconds', () => {
      const summary = service.computeSummary(piece({
        start: M(0), end: M(50),
        readings: [reading(0, -70), reading(10, -60), reading(20, -65), reading(30, -80), reading(40, -50)],
      }));

      expect(summary).toMatchObject({
        observationCount: 5, minimumValue: -80, maximumValue: -50, meanValue: -65,
        excursionCount: 2, timeOutsideThresholdSeconds: 1800, coverageRatio: 1,
      });
    });

    it('caps a reading\'s coverage at 20 minutes, and a gap over 20 minutes splits a run', () => {
      const summary = service.computeSummary(piece({
        start: M(0), end: M(60),
        readings: [reading(0, -50), reading(30, -50)],
      }));

      expect(service.COVERAGE_GAP_MS).toBe(20 * 60 * 1000);
      expect(summary).toMatchObject({ excursionCount: 2, timeOutsideThresholdSeconds: 2400 });
      expect(summary.coverageRatio).toBeCloseTo(40 / 60, 10);
    });

    it('summarizes 200,000 readings in one piece without overflowing the stack', () => {
      const many = Array.from({ length: 200000 }, (_, index) => ({
        timestamp: new Date(BASE + index * 1000), telemetryReadingId: `R-${index}`, datastreamId: 'ds-1', temperatureCelsius: -80 - (index % 5),
      }));

      const summary = service.computeSummary(piece({ start: M(0), end: new Date(BASE + 200000 * 1000), readings: many }));

      expect(summary).toMatchObject({ observationCount: 200000, minimumValue: -84, maximumValue: -80, meanValue: -82, coverageRatio: 1 });
    });

    it('judges readings that share a timestamp and carry no id as one group, whatever their delivery order', () => {
      const streams = [...LIMITS, { datastreamId: 'ds-2', thresholdProfileId: 'pol-1', minTemp: -90, maxTemp: -70 }];
      const tied = [
        reading(0, -80, { telemetryReadingId: null }),
        reading(0, -60, { telemetryReadingId: null, datastreamId: 'ds-2' }),
      ];

      const delivered = service.computeSummary(piece({ start: M(0), end: M(60), streams, readings: tied }));
      const reversed = service.computeSummary(piece({ start: M(0), end: M(60), streams, readings: [...tied].reverse() }));

      expect(reversed.sourceReadingSetHash).toBe(delivered.sourceReadingSetHash);
      expect(delivered).toMatchObject({ timeOutsideThresholdSeconds: 1200, excursionCount: 1 });
      expect(reversed).toMatchObject({ timeOutsideThresholdSeconds: 1200, excursionCount: 1 });
    });

    it('hashes the reading set in any delivery order, and changes the hashes with a value or the path', () => {
      const ordered = [reading(0, -80), reading(10, -81), reading(20, -79)];
      const base = service.computeSummary(piece({ start: M(0), end: M(30), readings: ordered }));
      const reversed = service.computeSummary(piece({ start: M(0), end: M(30), readings: [...ordered].reverse() }));
      const changed = service.computeSummary(piece({ start: M(0), end: M(30), readings: [ordered[0], reading(10, -81.5), ordered[2]] }));
      const otherRack = service.computeSummary(piece({ start: M(0), end: M(30), readings: ordered, rackLocationAssignmentId: 'rla-2' }));

      expect(base.sourceReadingSetHash).toMatch(/^sha256:[0-9a-f]{64}$/);
      expect(reversed.sourceReadingSetHash).toBe(base.sourceReadingSetHash);
      expect(reversed.sourceQueryHash).toBe(base.sourceQueryHash);
      expect(reversed.exposurePathHash).toBe(base.exposurePathHash);
      expect(changed.sourceReadingSetHash).not.toBe(base.sourceReadingSetHash);
      expect(otherRack.exposurePathHash).not.toBe(base.exposurePathHash);
    });
  });
});
