const crypto = require('crypto');
const { getCollection } = require('../utils/collectionResolver');
const logger = require('../utils/logger');
const TelemetryExposureSummaryModel = require('../models/TelemetryExposureSummary');
const { canonicalJson } = require('../models/ConfigurationRelease');
const influxRead = require('../infrastructure/persistence/influxdb/InfluxTelemetryReadRepository');
const sensorDatastream = require('./sensorDatastream.service');
const { ensureTelemetryExposureSummaryIndexes } = require('../utils/telemetryExposureSummaryIndexes');

// #1392 (RF009 AC5/AC6, RULE-027, VAL-019): a specimen's temperature
// exposure, computed only through its normalized physical chain. Each piece
// of the path is the intersection of one SpecimenContainerAssignment, one
// ContainerPositionAssignment and one RackLocationAssignment, clipped to the
// requested window; every interval is half-open. A piece reads the readings
// bound to its rack's StorageLocation in that interval, judges each against
// the TemperaturePolicy its own datastream's thresholdProfileId names, and
// is stored as one TelemetryExposureSummary with the hashes that reproduce
// it. A piece that cannot name its datastreams and versioned limits is
// refused, RULE-027's "Block non-reproducible summary". The decisions are
// recorded in docs/decisions/2026-10-21-telemetry-exposure-summary.md.
//
// The fakes these lookups are tested with do not apply queries, so each
// result is filtered again in JS.

class TelemetryExposureError extends Error {
  constructor(message, code, statusCode) {
    super(message);
    this.name = 'TelemetryExposureError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

// A reading covers the time until the next one, at most the scheduler's
// stale threshold (DEFAULT_STALE_MINUTES, scheduler.service.js).
const COVERAGE_GAP_MS = 20 * 60 * 1000;
const MEASUREMENTS = ['freezer_temperature', 'temperature'];
const { CALCULATION_VERSION } = TelemetryExposureSummaryModel;

const ensuredDbs = new WeakSet();

// Latched before the await, like ensurePhysicalChainIndexes: a persistent
// failure is logged once, and the summary is still written without it.
async function ensureExposureIndexes(db) {
  if (!db || ensuredDbs.has(db)) return;
  ensuredDbs.add(db);
  try {
    await ensureTelemetryExposureSummaryIndexes(await getCollection(db, 'telemetryExposureSummaries'));
  } catch (error) {
    logger.warn(`[TELEMETRY_EXPOSURE] Falha ao criar índices: ${error.message}`);
  }
}

function notReproducible(message) {
  return new TelemetryExposureError(message, 'EXPOSURE_NOT_REPRODUCIBLE', 422);
}

function hashOf(value) {
  return `sha256:${crypto.createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

function timeOf(value) {
  return value === undefined || value === null || value === '' ? null : new Date(value).getTime();
}

function windowOf(windowStart, windowEnd, now) {
  const parse = (value, fallback, field) => {
    if (value === undefined || value === null || value === '') return new Date(fallback);
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      throw new TelemetryExposureError(`${field} deve ser uma data ISO 8601`, 'INVALID_INPUT', 400);
    }
    return date;
  };
  const start = parse(windowStart, 0, 'windowStart');
  const end = parse(windowEnd, now, 'windowEnd');
  if (Number.isNaN(end.getTime()) || end <= start) {
    throw new TelemetryExposureError('windowEnd deve ser posterior a windowStart ([windowStart, windowEnd))', 'INVALID_INPUT', 400);
  }
  return { start, end };
}

// Every piece of the specimen's path inside the window: one per
// (SCA, CPA, RLA) whose three intervals and the window intersect. A position
// id is the rack's `<storageRackId>:<position>`, read as resolveSpecimenLocation
// reads it.
async function pathPieces(db, specimenId, window) {
  const scas = (await (await getCollection(db, 'specimenContainerAssignments')).find({ specimenId }).toArray())
    .filter((sca) => sca && String(sca.specimenId) === specimenId);
  const cpaCollection = await getCollection(db, 'containerPositionAssignments');
  const rlaCollection = await getCollection(db, 'rackLocationAssignments');
  const pieces = [];
  for (const sca of scas) {
    const cpas = (await cpaCollection.find({ containerId: sca.containerId }).toArray())
      .filter((cpa) => cpa && cpa.containerId === sca.containerId);
    for (const cpa of cpas) {
      const positionId = String(cpa.storagePositionId || '');
      const separator = positionId.lastIndexOf(':');
      if (separator <= 0) continue;
      const storageRackId = positionId.slice(0, separator);
      const rlas = (await rlaCollection.find({ storageRackId }).toArray())
        .filter((rla) => rla && rla.storageRackId === storageRackId);
      for (const rla of rlas) {
        const start = Math.max(timeOf(sca.loadedAt), timeOf(cpa.placedAt), timeOf(rla.placedAt), window.start.getTime());
        const end = Math.min(
          timeOf(sca.unloadedAt) ?? Infinity, timeOf(cpa.removedAt) ?? Infinity, timeOf(rla.removedAt) ?? Infinity, window.end.getTime()
        );
        if (!(start < end)) continue;
        pieces.push({ start: new Date(start), end: new Date(end), sca, cpa, rla });
      }
    }
  }
  const idsOf = (piece) => [
    piece.sca.specimenContainerAssignmentId, piece.cpa.containerPositionAssignmentId, piece.rla.rackLocationAssignmentId,
  ].map(String);
  return pieces.sort((a, b) => (a.start - b.start)
    || idsOf(a).join('\u0000').localeCompare(idsOf(b).join('\u0000')));
}

// The temperature datastreams of the location valid at some instant of the
// piece, each with its TemperaturePolicy's limits.
async function pieceStreams(db, storageLocationId, piece) {
  const rows = await (await getCollection(db, 'telemetryDatastreams')).find({
    storageLocationId, observedProperty: sensorDatastream.TEMPERATURE_PROPERTY,
  }).toArray();
  const streams = rows.filter((stream) => {
    if (!stream || stream.observedProperty !== sensorDatastream.TEMPERATURE_PROPERTY) return false;
    if (String(stream.storageLocationId) !== storageLocationId) return false;
    const from = timeOf(stream.validityPeriod?.start);
    const to = timeOf(stream.validityPeriod?.end) ?? Infinity;
    return from !== null && from < piece.end.getTime() && piece.start.getTime() < to;
  });
  if (streams.length === 0) {
    throw notReproducible(`Nenhum TelemetryDatastream de temperatura no local ${storageLocationId} no intervalo`);
  }
  const policies = await sensorDatastream.policiesByProfileId(db, streams.map((stream) => stream.thresholdProfileId));
  return streams.map((stream) => {
    const policy = policies.get(String(stream.thresholdProfileId));
    const minTemp = Number(policy?.minTemp);
    const maxTemp = Number(policy?.maxTemp);
    if (!policy || policy.minTemp === null || policy.maxTemp === null || !Number.isFinite(minTemp) || !Number.isFinite(maxTemp)) {
      throw notReproducible(`O TelemetryDatastream ${stream.telemetryDatastreamId} não cita uma TemperaturePolicy com minTemp e maxTemp`);
    }
    return {
      datastreamId: String(stream.telemetryDatastreamId), thresholdProfileId: String(stream.thresholdProfileId), minTemp, maxTemp,
    };
  });
}

// A total order, so the result never depends on delivery order: time, then
// telemetryReadingId (a reading without one last), datastreamId and value.
function compareReadings(a, b) {
  const byKey = (x, y) => (x < y ? -1 : x > y ? 1 : 0);
  if (a.t !== b.t) return a.t - b.t;
  if (a.telemetryReadingId !== b.telemetryReadingId) {
    if (a.telemetryReadingId === null) return 1;
    if (b.telemetryReadingId === null) return -1;
    const byId = byKey(String(a.telemetryReadingId), String(b.telemetryReadingId));
    if (byId) return byId;
  }
  return byKey(a.datastreamId, b.datastreamId) || byKey(a.celsius, b.celsius);
}

/**
 * The summary of one path piece, pure. `streams` are the piece's datastreams
 * with their limits ({ datastreamId, thresholdProfileId, minTemp, maxTemp });
 * `readings` ({ timestamp, telemetryReadingId, datastreamId,
 * temperatureCelsius }) are those of [start, end), in any order. Each reading
 * is judged against its own datastream's limits. Readings sharing a timestamp
 * are one group: the group covers its interval once, and is outside when any
 * of its readings is.
 */
function computeSummary({
  specimenId, specimenContainerAssignmentId, containerPositionAssignmentId, rackLocationAssignmentId,
  storageLocationId, start, end, streams, readings, calculatedAt, telemetryExposureSummaryId,
}) {
  const startMs = new Date(start).getTime();
  const endMs = new Date(end).getTime();
  const limits = new Map(streams.map((stream) => [String(stream.datastreamId), stream]));
  const sorted = readings
    .map((reading) => ({
      t: new Date(reading.timestamp).getTime(),
      telemetryReadingId: reading.telemetryReadingId ?? null,
      datastreamId: String(reading.datastreamId),
      celsius: Number(reading.temperatureCelsius),
    }))
    .sort((a, b) => compareReadings(a, b));

  // One pass, no spread: a long exposure holds hundreds of thousands of readings.
  let minimum = Infinity;
  let maximum = -Infinity;
  let sum = 0;
  const groups = [];
  for (const reading of sorted) {
    const limit = limits.get(reading.datastreamId);
    const outside = reading.celsius < limit.minTemp || reading.celsius > limit.maxTemp;
    if (reading.celsius < minimum) minimum = reading.celsius;
    if (reading.celsius > maximum) maximum = reading.celsius;
    sum += reading.celsius;
    const last = groups[groups.length - 1];
    if (last && last.t === reading.t) last.outside = last.outside || outside;
    else groups.push({ t: reading.t, outside });
  }

  let coveredMs = 0;
  let outsideMs = 0;
  let excursionCount = 0;
  groups.forEach((group, index) => {
    const next = groups[index + 1];
    const previous = groups[index - 1];
    const until = Math.min(next ? next.t : Infinity, group.t + COVERAGE_GAP_MS, endMs);
    const covers = Math.max(0, until - group.t);
    coveredMs += covers;
    if (group.outside) {
      outsideMs += covers;
      const continues = previous && previous.outside && group.t - previous.t <= COVERAGE_GAP_MS;
      if (!continues) excursionCount += 1;
    }
  });

  const count = sorted.length;
  const datastreamIds = [...limits.keys()].sort();
  const windowStart = new Date(startMs).toISOString();
  const windowEnd = new Date(endMs).toISOString();
  const thresholds = [...streams]
    .map(({ datastreamId, thresholdProfileId, minTemp, maxTemp }) => ({ datastreamId: String(datastreamId), thresholdProfileId, minTemp, maxTemp }))
    .sort((a, b) => a.datastreamId.localeCompare(b.datastreamId));

  return TelemetryExposureSummaryModel.create({
    telemetryExposureSummaryId,
    specimenId,
    datastreamIds,
    windowStart: new Date(startMs),
    windowEnd: new Date(endMs),
    observationCount: count,
    minimumValue: count ? minimum : null,
    maximumValue: count ? maximum : null,
    meanValue: count ? sum / count : null,
    timeOutsideThresholdSeconds: Math.floor(outsideMs / 1000),
    excursionCount,
    coverageRatio: coveredMs / (endMs - startMs),
    sourceQueryHash: hashOf({
      storageLocationId, windowStart, windowEnd, measurements: MEASUREMENTS, datastreamIds, thresholds,
      coverageGapSeconds: COVERAGE_GAP_MS / 1000, calculationVersion: CALCULATION_VERSION,
    }),
    sourceReadingSetHash: hashOf(sorted.map((reading) => [
      new Date(reading.t).toISOString(), reading.telemetryReadingId, reading.datastreamId, reading.celsius,
    ])),
    calculationVersion: CALCULATION_VERSION,
    calculatedAt,
    specimenContainerAssignmentId,
    containerPositionAssignmentId,
    rackLocationAssignmentId,
    exposurePathHash: hashOf({
      specimenId, specimenContainerAssignmentId, containerPositionAssignmentId, rackLocationAssignmentId,
      storageLocationId, windowStart, windowEnd,
    }),
  });
}

async function summarizePiece(db, specimenId, piece, calculatedAt) {
  const storageLocationId = String(piece.rla.storageLocationId);
  const streams = await pieceStreams(db, storageLocationId, piece);
  const streamIds = new Set(streams.map((stream) => stream.datastreamId));
  const readings = (await influxRead.readingsAtLocation({ storageLocationId, start: piece.start, stop: piece.end }))
    .filter((reading) => {
      const t = new Date(reading.timestamp).getTime();
      return piece.start.getTime() <= t && t < piece.end.getTime() && String(reading.storageLocationId) === storageLocationId;
    });
  const foreign = readings.find((reading) => !streamIds.has(String(reading.datastreamId)));
  if (foreign) {
    throw notReproducible(`A leitura ${foreign.telemetryReadingId ?? foreign.timestamp} não pertence a um TelemetryDatastream do local ${storageLocationId}`);
  }
  try {
    return computeSummary({
      specimenId,
      specimenContainerAssignmentId: String(piece.sca.specimenContainerAssignmentId),
      containerPositionAssignmentId: String(piece.cpa.containerPositionAssignmentId),
      rackLocationAssignmentId: String(piece.rla.rackLocationAssignmentId),
      storageLocationId,
      start: piece.start,
      end: piece.end,
      streams,
      readings,
      calculatedAt,
    });
  } catch (error) {
    throw notReproducible(error.message);
  }
}

/**
 * RF009 AC5/AC6: summarizes the specimen's exposure over [windowStart,
 * windowEnd), one TelemetryExposureSummary per path piece, and stores them.
 * windowEnd defaults to now, windowStart to the epoch. 400 INVALID_INPUT for
 * a bad window, 422 EXPOSURE_PATH_EMPTY when no chain piece falls in it, 422
 * EXPOSURE_NOT_REPRODUCIBLE when a piece cannot name its datastreams, their
 * limits or its readings' datastreams. Nothing is stored unless every piece
 * is summarized.
 */
async function summarizeExposure(db, { specimenId, windowStart, windowEnd } = {}, { now = new Date() } = {}) {
  const window = windowOf(windowStart, windowEnd, now);
  const id = String(specimenId);
  await ensureExposureIndexes(db);
  const pieces = await pathPieces(db, id, window);
  if (pieces.length === 0) {
    throw new TelemetryExposureError(
      `Espécime ${id} não tem trecho de cadeia física (recipiente, posição e local) no intervalo`, 'EXPOSURE_PATH_EMPTY', 422
    );
  }
  const calculatedAt = new Date(now);
  const records = [];
  for (const piece of pieces) records.push(await summarizePiece(db, id, piece, calculatedAt));
  const collection = await getCollection(db, 'telemetryExposureSummaries');
  for (const record of records) await collection.insertOne({ ...record });
  return records;
}

module.exports = {
  TelemetryExposureError,
  COVERAGE_GAP_MS,
  computeSummary,
  summarizeExposure,
};
