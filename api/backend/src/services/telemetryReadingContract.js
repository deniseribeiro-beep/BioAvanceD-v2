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
 *   `synchronized` when observedAt is within CLOCK_SKEW_TOLERANCE_MS of
 *   receipt, `drift` beyond it (either side), `unknown` with no device time.
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

const CLOCK_SKEW_TOLERANCE_MS = 5 * 60 * 1000;
const MAX_IDEMPOTENCY_KEY_LENGTH = 200;
const TELEMETRY_READING_SCHEMA_VERSION = 'telemetry.reading.v1';

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

function clockStatusOf(deviceTime, receivedAt) {
  if (!deviceTime) return 'unknown';
  return Math.abs(receivedAt.getTime() - deviceTime.getTime()) <= CLOCK_SKEW_TOLERANCE_MS ? 'synchronized' : 'drift';
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

module.exports = { readingIdentityOf, canonicalJson, CLOCK_SKEW_TOLERANCE_MS, MAX_IDEMPOTENCY_KEY_LENGTH, TELEMETRY_READING_SCHEMA_VERSION };
