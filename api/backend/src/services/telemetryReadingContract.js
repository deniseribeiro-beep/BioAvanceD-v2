const { createHash, randomUUID } = require('crypto');

/**
 * RF009 AC2/AC3/AC7 (#1317): the identity and time a telemetry reading
 * carries from the ingestion boundary, TelemetryReading V2E-0545..0556.
 *
 * - telemetryReadingId: a new uuid per stored reading.
 * - observedAt: the device's timestamp; without one, the receipt time.
 * - receivedAt: when the ingestion boundary received it.
 * - payloadHash: sha256 of the received payload's canonical form (keys
 *   sorted at every depth). The organizationId the server stamps is left
 *   out, since the device did not send it.
 * - idempotencyKey: the client's, when it sends one; only such a key
 *   dedupes, and a replay returns the stored reading. Without one the key
 *   is derived from sensor, observedAt and payloadHash and stored for
 *   reference, not enforced: `[inference]` a derived key would merge two
 *   readings a device sent with the same timestamp and value, and nothing
 *   tells those apart from a replay.
 * - clockStatus: `[inference]` the dictionary names only `synchronized`.
 *   `synchronized` when observedAt is within the configured limit
 *   (`telemetry.clockDriftLimitMinutes`, RNF025 AC6, #1520;
 *   CLOCK_SKEW_TOLERANCE_MS by default) of receipt, `drift` beyond it
 *   (either side), `unknown` with no device time. readingIdentityOf stamps
 *   it at the default limit, and screenReading re-derives it at the
 *   configured one.
 *
 * persistedAt (V2E-0550) is the confirmation of the authoritative InfluxDB
 * write, so the write path stamps it once that write returns.
 *
 * RF009 AC2's provenance (V2E-0551..0560):
 * - sourceEventId: the client's, else its deviceMessageId, else
 *   `[inference]` the telemetryReadingId, since the boundary is then the
 *   event's origin;
 * - deviceMessageId and sequenceNumber: kept when the device sends them;
 * - schemaVersion: this contract's, named like the audit trail's
 *   `audit.event.v2`;
 * - canonicalModelReleaseId: the release this build runs;
 * - ingestionService: the path that received the reading;
 * - traceId: the client's, else a new one; `[inference]` no request id
 *   reaches the services yet.
 */
const { CANONICAL_MODEL_RELEASE_ID } = require('../foundation/readiness');
const env = require('../config/env');
const { resolveReadingBinding } = require('./telemetryBinding.service');
const { deviceUsabilityRefusal } = require('./deviceLifecycle.service');
const TemperatureModel = require('../models/Temperature');
const TelemetryIngestionEventModel = require('../models/TelemetryIngestionEvent');
const TelemetryValidationIssueModel = require('../models/TelemetryValidationIssue');
const logger = require('../utils/logger');
const { findCompletedIdempotentResult, recordCompletedIdempotentResult } = require('../ingestion/idempotency');

const { DEFAULT_CLOCK_DRIFT_LIMIT_MS, resolveClockDriftLimitMs } = require('./clockDriftLimit');

const CLOCK_SKEW_TOLERANCE_MS = DEFAULT_CLOCK_DRIFT_LIMIT_MS;
// RF009 AC7: a temperature outside this range, in Celsius, is not a
// physically possible reading of a storage environment. The floor is
// absolute zero. The ceiling is `[inference]`: no repo constant or profile
// names one, and 150 °C is far above any storage, transport or incubation
// set point (the coldest is liquid nitrogen, -196 °C), so a value past it is
// a sensor fault, not an excursion. Policy limits, not this range, decide
// what an excursion is.
const ABSOLUTE_ZERO_CELSIUS = -273.15;
const MAX_PLAUSIBLE_CELSIUS = 150;
// RF009 AC9's protocols, by the ingestion path that received the reading.
// `[inference]` the queued stream path (`iot-queue`) is the approved adapter.
const PROTOCOL_BY_SERVICE = { mqtt: 'mqtt', 'iot-api': 'https', 'temperature-api': 'https', 'iot-queue': 'adapter' };
const MAX_IDEMPOTENCY_KEY_LENGTH = 200;
const TELEMETRY_READING_SCHEMA_VERSION = 'telemetry.reading.v1';
// Every ingestion path receives temperature readings, the observed property
// their datastreams bind (V2E-0566's example).
const READING_OBSERVED_PROPERTY = 'temperature';

function canonicalJson(value) {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort()
      .filter((key) => value[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value === undefined ? null : value);
}

function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}

function validationError(message) {
  return Object.assign(new Error(message), { statusCode: 422, auditReason: 'invalid_payload' });
}

function clockStatusOf(deviceTime, receivedAt, limitMs = CLOCK_SKEW_TOLERANCE_MS) {
  if (!deviceTime) return 'unknown';
  return Math.abs(receivedAt.getTime() - deviceTime.getTime()) <= limitMs ? 'synchronized' : 'drift';
}

/**
 * The reading's v4 identity and time. Throws a 422 for a timestamp that is
 * not a date, or an idempotencyKey that is not a non-empty string.
 */
function optionalText(received, field) {
  const value = received[field];
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || !value.trim() || value.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
    throw validationError(`${field} deve ser um texto não vazio de até ${MAX_IDEMPOTENCY_KEY_LENGTH} caracteres`);
  }
  return value.trim();
}

function readingIdentityOf(payload, receivedAt = new Date(), { ingestionService = 'temperature-api' } = {}) {
  const { organizationId: _stamped, ...received } = payload || {};

  let deviceTime = null;
  if (received.timestamp !== undefined && received.timestamp !== null && received.timestamp !== '') {
    deviceTime = received.timestamp instanceof Date ? received.timestamp : new Date(received.timestamp);
    if (Number.isNaN(deviceTime.getTime())) throw validationError('timestamp deve ser uma data ISO 8601 válida');
  }

  const clientKey = received.idempotencyKey;
  if (clientKey !== undefined && (typeof clientKey !== 'string' || !clientKey.trim() || clientKey.length > MAX_IDEMPOTENCY_KEY_LENGTH)) {
    throw validationError(`idempotencyKey deve ser um texto não vazio de até ${MAX_IDEMPOTENCY_KEY_LENGTH} caracteres`);
  }

  const sourceEventId = optionalText(received, 'sourceEventId');
  const deviceMessageId = optionalText(received, 'deviceMessageId');
  const traceId = optionalText(received, 'traceId');
  const { sequenceNumber } = received;
  if (sequenceNumber !== undefined && sequenceNumber !== null && !(Number.isInteger(sequenceNumber) && sequenceNumber >= 0)) {
    throw validationError('sequenceNumber deve ser um inteiro não negativo');
  }

  const observedAt = deviceTime || receivedAt;
  const payloadHash = sha256(canonicalJson(received));
  const sensorId = String(received.sensorId || received.sensorID || '');
  const telemetryReadingId = randomUUID();
  return {
    telemetryReadingId,
    sourceEventId: sourceEventId || deviceMessageId || telemetryReadingId,
    deviceMessageId,
    sequenceNumber: sequenceNumber ?? null,
    schemaVersion: TELEMETRY_READING_SCHEMA_VERSION,
    canonicalModelReleaseId: CANONICAL_MODEL_RELEASE_ID,
    ingestionService,
    traceId: traceId || randomUUID(),
    observedAt,
    receivedAt,
    clockStatus: clockStatusOf(deviceTime, receivedAt),
    payloadHash,
    idempotencyKey: clientKey ? clientKey.trim() : sha256(`${sensorId}\n${observedAt.toISOString()}\n${payloadHash}`),
    idempotencyKeySource: clientKey ? 'client' : 'derived',
  };
}

/**
 * RF009 AC7 (#1317, #1391): the RF029 key-store scope a client key replays
 * from, or null for a derived key, which never dedupes. It is
 * `POST /api/iot/telemetry`'s scope for the same sensor, trimmed and as
 * text, so one client key per sensor replays across the temperature route,
 * MQTT, the queue and that route, and a numeric 101 and "101" share it
 * (RULE-024, V2E-0554). The sensor is the one the reading is stored under,
 * Temperature's `sensorId || sensorID`. `[inference]` the key goes in RF029's
 * ingestionIdempotencyKeys, not in a reading copy, as that route already
 * does: InfluxDB has no unique constraint, and the resultRef holds
 * identifiers and times only, never the value.
 */
function clientReplayScopeOf(identity, payload) {
  if (identity.idempotencyKeySource !== 'client') return null;
  const sensorId = String(payload.sensorId || payload.sensorID || '').trim();
  return sensorId ? `TelemetryReading:${sensorId}` : null;
}

/**
 * RF009 AC7 (#1391): the resultRef a client key already recorded for this
 * sensor, or null. `[inference]` a failed lookup is logged and the reading
 * goes on, since cold-chain availability wins (the ingest audit's Axis E
 * decision).
 */
async function findClientReplay(db, identity, payload) {
  const scope = clientReplayScopeOf(identity, payload);
  if (!scope) return null;
  try {
    return await findCompletedIdempotentResult(db, { idempotencyKey: identity.idempotencyKey, scope });
  } catch (error) {
    logger.error('[ISO20387][TELEMETRY] Falha ao consultar idempotencyKey da telemetria:', error.message || error);
    return null;
  }
}

/**
 * RF009 AC7 (#1391): records a persisted reading's client key with
 * `POST /api/iot/telemetry`'s resultRef. Returns the stored resultRef when
 * a concurrent send of the same key recorded first (this send then answers
 * the winner's reading), else null. A failed record is
 * logged and the reading goes on, as a failed lookup does.
 */
async function recordClientReplay(db, identity, payload, persistedAt) {
  const scope = clientReplayScopeOf(identity, payload);
  if (!scope) return null;
  try {
    const stored = await recordCompletedIdempotentResult(db, {
      idempotencyKey: identity.idempotencyKey,
      scope,
      resultRef: {
        telemetryReadingId: identity.telemetryReadingId,
        observedAt: identity.observedAt,
        receivedAt: identity.receivedAt,
        persistedAt,
        clockStatus: identity.clockStatus,
      },
    });
    return stored && stored.telemetryReadingId !== identity.telemetryReadingId ? stored : null;
  } catch (error) {
    logger.error('[ISO20387][TELEMETRY] Falha ao registrar idempotencyKey da telemetria:', error.message || error);
    return null;
  }
}

const CLIENT_TEXT_FIELDS = ['idempotencyKey', 'sourceEventId', 'deviceMessageId', 'traceId'];

// What readingIdentityOf accepts for each field: a non-blank text up to
// MAX_IDEMPOTENCY_KEY_LENGTH, and a non-negative integer sequenceNumber.
function acceptedContractValue(field, value) {
  if (field === 'sequenceNumber') return Number.isInteger(value) && value >= 0;
  return typeof value === 'string' && value.trim() !== '' && value.length <= MAX_IDEMPOTENCY_KEY_LENGTH;
}

/**
 * RF009 AC2/AC7 (#1317): the contract fields a client sent, for a path that
 * maps its payload onto a new object (MQTT, the socket stream). An absent or
 * null field adds no key, so the payloadHash is unchanged. A value
 * readingIdentityOf would refuse with a 422 is dropped with a warning naming
 * the field and the sensor, never the value: these paths have no caller to
 * answer, and cold-chain availability wins, so the reading is stored without
 * it, as it was before the fields were passed on.
 */
function clientContractFieldsOf(payload) {
  const fields = {};
  for (const field of [...CLIENT_TEXT_FIELDS, 'sequenceNumber']) {
    const value = payload?.[field];
    if (value === undefined || value === null) continue;
    if (acceptedContractValue(field, value)) {
      fields[field] = value;
    } else {
      const sensor = payload.sensorId || payload.sensorID || payload.deviceId || 'desconhecido';
      logger.warn(`[TELEMETRY] Campo ${field} inválido descartado da leitura do sensor ${sensor}`);
    }
  }
  return fields;
}

// RF009 AC8, RNF004 C7 (#1540): the top-level fields POST /api/iot/telemetry
// reads into a reading (readingIdentityOf, validationIssuesOf and the
// route's own sensorId and temperature), and organizationId, V2E-0561.
const IOT_API_READING_FIELDS = [
  'sensorId', 'sensorID', 'temperature', 'temperatureValue', 'temperatureUnit', 'timestamp',
  ...CLIENT_TEXT_FIELDS, 'sequenceNumber', 'organizationId',
];
// A field name the issue may list. Any other name is counted, never written.
const LISTABLE_FIELD_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;

/**
 * RF009 AC8, RNF004 C7 (#1540): splits a received payload into the reading
 * (its contract fields) and the names of the other top-level fields, sorted.
 * Those fields may carry personal data, so they are stripped before the
 * reading is hashed, screened or stored; an absent or null one is not
 * counted. A payload that is not a plain object has no fields.
 */
function splitContractFields(payload, contractFields) {
  const reading = {};
  const strippedFields = [];
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return { reading, strippedFields };
  const allowed = new Set(contractFields);
  for (const [field, value] of Object.entries(payload)) {
    if (allowed.has(field)) reading[field] = value;
    else if (value !== undefined && value !== null) strippedFields.push(field);
  }
  return { reading, strippedFields: strippedFields.sort() };
}

// RF009 AC8 (#1540): the issue that flags a reading whose non-contract
// fields were stripped. The reading is kept (quarantined, as a clock drift
// is), since cold-chain availability wins over refusing it.
function personalDataDraftsOf(strippedFields = []) {
  if (!strippedFields.length) return [];
  const listed = strippedFields.filter((field) => LISTABLE_FIELD_NAME.test(field));
  const unlisted = strippedFields.length - listed.length;
  const names = [...listed, ...(unlisted ? [`${unlisted} campo(s) de nome não listável`] : [])].join(', ');
  return [{
    issueCode: 'personal_data_stripped',
    severity: 'error',
    fieldPath: listed.length ? listed.join(',') : null,
    details: `Campos fora do contrato da leitura descartados sem armazenamento, por poderem conter dados pessoais: ${names} (RF009 AC8, RNF004 C7)`,
    disposition: 'quarantined',
  }];
}

/**
 * RF009 AC7 (#1317): the TelemetryValidationIssues a reading carries, as
 * drafts without their ingestion event.
 *
 * - A clock drift is quarantined: the reading is still stored and its
 *   excursion check still runs, since cold-chain availability wins over
 *   refusing a reading and an excursion is never silenced. The issue, and
 *   the point's clockStatus tag, flag it.
 * - A value that is not a finite number, or a temperature outside the
 *   plausible range, is rejected: it is a sensor fault, not a measurement,
 *   and storing it would feed a false number into excursion checks and
 *   exposure statistics. It is never stored as a zero, so the reading is
 *   a gap the missing-reading monitoring sees.
 * A payload without a value is left to the path's own required-field check.
 */
function validationIssuesOf(identity, payload = {}, { clockDriftLimitMs = CLOCK_SKEW_TOLERANCE_MS } = {}) {
  const issues = [];
  if (identity?.clockStatus === 'drift') {
    issues.push({
      issueCode: 'clock_drift',
      severity: 'error',
      fieldPath: 'observedAt',
      details: `observedAt ${identity.observedAt.toISOString()} difere de receivedAt ${identity.receivedAt.toISOString()} além da tolerância de ${clockDriftLimitMs / 60000} minutos`,
      disposition: 'quarantined',
    });
  }

  const fieldPath = payload.temperatureValue !== undefined ? 'temperatureValue' : 'temperature';
  const raw = payload[fieldPath];
  if (raw !== undefined && raw !== null) {
    const value = typeof raw === 'number' ? raw : Number(raw);
    const unit = payload.temperatureUnit || '°C';
    const celsius = TemperatureModel.toCelsius(value, unit);
    if (!Number.isFinite(value)) {
      issues.push({
        issueCode: 'invalid_value', severity: 'error', fieldPath, details: `${fieldPath} não é um número finito`, disposition: 'rejected',
      });
    } else if (celsius < ABSOLUTE_ZERO_CELSIUS || celsius > MAX_PLAUSIBLE_CELSIUS) {
      issues.push({
        issueCode: 'invalid_value',
        severity: 'error',
        fieldPath,
        details: `${fieldPath} ${value} ${unit} está fora da faixa fisicamente plausível (${ABSOLUTE_ZERO_CELSIUS} a ${MAX_PLAUSIBLE_CELSIUS} °C)`,
        disposition: 'rejected',
      });
    }
  }
  return issues;
}

function bindingMode() {
  return String(env.TELEMETRY_BINDING_MODE || 'enforce').toLowerCase() === 'record' ? 'record' : 'enforce';
}

/**
 * RF009 AC4, RF017 AC5 (#1317): binds a reading to the TelemetryDatastream
 * of its sensor valid at its observedAt, and checks the sensor has an active
 * DeviceRegistration. Returns the reading's datastreamId (V2E-0546) and
 * storageLocationId (V2E-0547), both null without a datastream, and the
 * issue drafts for what is missing: under TELEMETRY_BINDING_MODE `enforce`
 * (the default) they reject the reading, under `record` they quarantine it,
 * so it is stored and flagged. A lookup that fails is logged; under
 * `enforce` it refuses the reading with a 503, since the binding cannot be
 * shown, and under `record` the reading goes on unbound and unflagged.
 *
 * [inference] The location is the storageLocationId of the datastream valid
 * at observedAt: V2E-0547 is the location monitored at the instant of
 * observation, and that datastream is the one binding of sensor to location
 * over time (V2E-0565, 1..1). A payload's own storageLocationId is never read.
 *
 * RF017 AC8: the sensor's Device must also be registered, homologated and
 * unretired (deviceUsabilityRefusal, as the scan route checks it), else a
 * `device_unusable` draft under the same mode. Its lookup is separate: when
 * it fails under `record` the datastream stamp already resolved is kept.
 * A failed binding lookup under `record` skips this check too.
 *
 * [inference] The sensor is checked as a Device under its own sensorId, the
 * identity resolveReadingBinding already uses for DeviceRegistration
 * (V2E-0563 and V2E-0619 both reference Device). The AC8 gap is its own
 * issue code beside `device_not_registered` because the two read different
 * records, an active DeviceRegistration and the Device lifecycle's
 * homologation and retirement, so a sensor with neither gets both issues.
 */
function bindingUnverifiableError() {
  return Object.assign(new Error('Vínculo da leitura a TelemetryDatastream e DeviceRegistration não verificável'), {
    statusCode: 503, code: 'TELEMETRY_BINDING_UNVERIFIABLE', auditReason: 'telemetry_binding_unverifiable',
  });
}

async function readingBindingOf(storeOf, identity, payload = {}) {
  const mode = bindingMode();
  const sensorId = String(payload.sensorId || payload.sensorID || '').trim();
  let binding;
  try {
    binding = await resolveReadingBinding(await storeOf(), {
      sensorId, observedProperty: READING_OBSERVED_PROPERTY, observedAt: identity.observedAt,
    });
  } catch (error) {
    logger.error(`[ISO20387][TELEMETRY] Falha ao resolver o TelemetryDatastream da leitura: ${error.message || error}`);
    if (mode === 'enforce') throw bindingUnverifiableError();
    return { datastreamId: null, storageLocationId: null, drafts: [] };
  }

  const disposition = mode === 'enforce' ? 'rejected' : 'quarantined';
  const drafts = [];
  if (!binding.datastream) {
    drafts.push({
      issueCode: 'unbound_datastream',
      severity: 'error',
      fieldPath: 'sensorId',
      details: `Sensor ${sensorId} não tem TelemetryDatastream de ${READING_OBSERVED_PROPERTY} válido em ${identity.observedAt.toISOString()} (RF009 AC4, RF017 AC5)`,
      disposition,
    });
  }
  if (!binding.registration) {
    drafts.push({
      issueCode: 'device_not_registered',
      severity: 'error',
      fieldPath: 'sensorId',
      details: `Sensor ${sensorId} não tem DeviceRegistration ativo (RF009 AC4)`,
      disposition,
    });
  }
  try {
    const refusal = await deviceUsabilityRefusal(await storeOf(), sensorId);
    if (refusal) {
      drafts.push({
        issueCode: 'device_unusable',
        severity: 'error',
        fieldPath: 'sensorId',
        details: `Sensor ${sensorId}: ${refusal} (RF017 AC8)`,
        disposition,
      });
    }
  } catch (error) {
    logger.error(`[ISO20387][TELEMETRY] Falha ao verificar o Device do sensor da leitura: ${error.message || error}`);
    if (mode === 'enforce') throw bindingUnverifiableError();
  }
  return {
    datastreamId: binding.datastream?.telemetryDatastreamId || null,
    storageLocationId: binding.datastream?.storageLocationId || null,
    drafts,
  };
}

/**
 * Records a reading's validation issues and decides its fate. The reading
 * is first bound (readingBindingOf), and `identity.datastreamId` (V2E-0546)
 * and `identity.storageLocationId` (V2E-0547) are stamped from its
 * datastream, or null, so every path stores them with the reading. A reading with no issue writes nothing. Otherwise one
 * TelemetryIngestionEvent and its TelemetryValidationIssues are written to
 * MongoDB; a rejected reading then throws a 422 with nothing stored, and a
 * quarantined one returns its issues and goes on to be stored. A failed
 * issue write is logged and does not change the reading's fate.
 */
async function screenReading(db, identity, payload = {}, { strippedFields = [] } = {}) {
  // `db` may be a function resolving it, so a path that opens its
  // connection lazily opens it once, here.
  let store;
  const storeOf = async () => {
    if (!store) store = typeof db === 'function' ? await db() : db;
    return store;
  };

  const binding = await readingBindingOf(storeOf, identity, payload);
  identity.datastreamId = binding.datastreamId;
  identity.storageLocationId = binding.storageLocationId;
  // RNF025 AC6 (#1520): the clock status at the configured drift limit.
  // A reading with no device time stays `unknown` and reads no
  // configuration. storeOf, not db, so a lazy db still resolves once.
  let clockDriftLimitMs = CLOCK_SKEW_TOLERANCE_MS;
  if (identity.clockStatus !== 'unknown') {
    clockDriftLimitMs = await resolveClockDriftLimitMs(storeOf);
    identity.clockStatus = clockStatusOf(identity.observedAt, identity.receivedAt, clockDriftLimitMs);
  }
  const drafts = [...validationIssuesOf(identity, payload, { clockDriftLimitMs }), ...binding.drafts, ...personalDataDraftsOf(strippedFields)];
  if (!drafts.length) return [];

  const rejected = drafts.filter((draft) => draft.disposition === 'rejected');
  const ingestionEventId = randomUUID();
  const issues = drafts.map((draft) => TelemetryValidationIssueModel.create({ ...draft, ingestionEventId }));
  const event = TelemetryIngestionEventModel.create({
    telemetryIngestionEventId: ingestionEventId,
    sourceEventId: identity.sourceEventId,
    protocol: PROTOCOL_BY_SERVICE[identity.ingestionService] || 'https',
    receivedAt: identity.receivedAt,
    validationStatus: rejected.length ? 'rejected' : 'quarantined',
    telemetryReadingId: rejected.length ? null : identity.telemetryReadingId,
    issueIds: issues.map((issue) => issue.telemetryValidationIssueId),
    payloadHash: identity.payloadHash,
  });

  try {
    const resolved = await storeOf();
    await resolved.collection('telemetryIngestionEvents').insertOne(event);
    await resolved.collection('telemetryValidationIssues').insertMany(issues);
  } catch (error) {
    logger.error(`[ISO20387][TELEMETRY] Falha ao registrar TelemetryValidationIssue: ${error.message || error}`);
  }

  if (rejected.length) {
    const error = validationError(rejected.map((issue) => issue.details).join('; '));
    // The first rejecting issue's code: `invalid_value`, `unbound_datastream`,
    // `device_not_registered` or `device_unusable`.
    error.auditReason = rejected[0].issueCode;
    error.details = rejected.map((issue) => issue.details);
    throw error;
  }
  return issues;
}

module.exports = {
  readingIdentityOf,
  clientReplayScopeOf,
  findClientReplay,
  recordClientReplay,
  clientContractFieldsOf,
  splitContractFields,
  IOT_API_READING_FIELDS,
  validationIssuesOf,
  screenReading,
  canonicalJson,
  CLOCK_SKEW_TOLERANCE_MS,
  MAX_IDEMPOTENCY_KEY_LENGTH,
  TELEMETRY_READING_SCHEMA_VERSION,
  ABSOLUTE_ZERO_CELSIUS,
  MAX_PLAUSIBLE_CELSIUS,
};
