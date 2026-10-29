const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/**
 * RNF004 C1 (#1392): the durable edge buffer of a telemetry device. The edge
 * is the device itself, which posts directly to the platform with no gateway
 * between (persistencia-poliglota 4.3); V2E-0616 bufferingPolicyId is the
 * platform's reference to this buffer's policy.
 *
 * - C1: each reading is written to disk before any send, with sourceEventId,
 *   observedAt, deviceId, sequenceNumber and payloadHash.
 * - C2: an entry leaves the buffer only on a 2xx, which the server answers
 *   only after the InfluxDB write; a resend reuses the stored body, so its
 *   idempotencyKey makes the server answer it as a replay, never a duplicate.
 * - C3: the drain stops on the first unconfirmed entry, so no reading
 *   overtakes an earlier one, and sequenceNumber orders them without relying
 *   on the device clock.
 * - C7: only MEASUREMENT_FIELDS enter the buffer, so no PII can.
 *
 * Layout under `dir`: state.json ({ deviceId, nextSequenceNumber }),
 * pending/<seq>.json and dead-letter/<seq>.json, seq zero-padded to 12 digits
 * so a name sort is a sequence sort.
 */
const MEASUREMENT_FIELDS = ['sensorId', 'temperature', 'temperatureUnit', 'timestamp'];
const SEQUENCE_DIGITS = 12;
const ENTRY_FILE = /^(\d{12})\.json$/;

// The server's canonical form (telemetryReadingContract.js): keys sorted at
// every depth, undefined keys dropped, so both sides hash the same bytes.
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
  return crypto.createHash('sha256').update(text).digest('hex');
}

// 2xx confirms; 400 and 422 refuse the payload for good, so retrying it would
// block every later reading; anything else (a thrown error is null) retries.
function classifyStatus(status) {
  if (Number.isInteger(status) && status >= 200 && status <= 299) return 'ack';
  if (status === 400 || status === 422) return 'dead-letter';
  return 'retry';
}

// A torn write leaves only a *.tmp file, which no reader lists. A directory
// is not fsynced, since Windows refuses it.
function writeDurably(target, value) {
  const tmp = `${target}.tmp`;
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeSync(fd, JSON.stringify(value));
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, target);
}

function entryFileName(sequenceNumber) {
  return `${String(sequenceNumber).padStart(SEQUENCE_DIGITS, '0')}.json`;
}

function entryNamesOf(folder) {
  return fs.readdirSync(folder).filter((name) => ENTRY_FILE.test(name)).sort();
}

function readEntries(folder) {
  return entryNamesOf(folder).map((name) => JSON.parse(fs.readFileSync(path.join(folder, name), 'utf8')));
}

function highestSequenceIn(folder) {
  const names = entryNamesOf(folder);
  return names.length ? Number(ENTRY_FILE.exec(names[names.length - 1])[1]) : -1;
}

function createEdgeBuffer({ dir, deviceId, now = () => new Date(), uuid = crypto.randomUUID }) {
  if (typeof deviceId !== 'string' || !deviceId) throw new Error('deviceId deve ser um texto não vazio');
  const pendingDir = path.join(dir, 'pending');
  const deadLetterDir = path.join(dir, 'dead-letter');
  const statePath = path.join(dir, 'state.json');
  fs.mkdirSync(pendingDir, { recursive: true });
  fs.mkdirSync(deadLetterDir, { recursive: true });

  let storedNext = 0;
  if (fs.existsSync(statePath)) {
    const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    if (state.deviceId !== deviceId) {
      throw new Error(`O buffer em ${dir} pertence ao dispositivo ${state.deviceId}, não a ${deviceId}`);
    }
    storedNext = Number.isInteger(state.nextSequenceNumber) ? state.nextSequenceNumber : 0;
  }
  // A crash between writing an entry and writing state never reuses a number.
  let nextSequenceNumber = Math.max(
    storedNext,
    highestSequenceIn(pendingDir) + 1,
    highestSequenceIn(deadLetterDir) + 1,
    0,
  );

  function enqueue(measurement) {
    const reading = measurement || {};
    const extra = Object.keys(reading).filter((key) => !MEASUREMENT_FIELDS.includes(key));
    if (extra.length) throw new Error(`Campos não permitidos no buffer: ${extra.join(', ')}`);
    if (typeof reading.sensorId !== 'string' || !reading.sensorId) throw new Error('sensorId deve ser um texto não vazio');
    if (typeof reading.temperature !== 'number' || !Number.isFinite(reading.temperature)) {
      throw new Error('temperature deve ser um número finito');
    }
    let observedAt;
    if (reading.timestamp !== undefined) {
      const deviceTime = new Date(reading.timestamp);
      if (reading.timestamp === null || Number.isNaN(deviceTime.getTime())) throw new Error('timestamp deve ser uma data válida');
      observedAt = deviceTime.toISOString();
    } else {
      observedAt = now().toISOString();
    }

    const sequenceNumber = nextSequenceNumber;
    const sourceEventId = uuid();
    const body = {};
    for (const field of MEASUREMENT_FIELDS) {
      if (reading[field] !== undefined) body[field] = reading[field];
    }
    Object.assign(body, { timestamp: observedAt, sourceEventId, idempotencyKey: sourceEventId, sequenceNumber });
    const entry = {
      sourceEventId,
      observedAt,
      deviceId,
      sequenceNumber,
      payloadHash: sha256(canonicalJson(body)),
      enqueuedAt: now().toISOString(),
      body,
    };
    writeDurably(path.join(pendingDir, entryFileName(sequenceNumber)), entry);
    writeDurably(statePath, { deviceId, nextSequenceNumber: sequenceNumber + 1 });
    nextSequenceNumber = sequenceNumber + 1;
    return entry;
  }

  const pending = () => readEntries(pendingDir);
  const deadLetters = () => readEntries(deadLetterDir);

  async function walk(send) {
    const entries = pending();
    const result = { acked: 0, deadLettered: 0, retained: 0, stoppedOn: null };
    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index];
      let status = null;
      try {
        ({ status } = await send(entry.body));
      } catch {
        status = null;
      }
      const outcome = classifyStatus(status);
      const pendingPath = path.join(pendingDir, entryFileName(entry.sequenceNumber));
      if (outcome === 'ack') {
        fs.unlinkSync(pendingPath);
        result.acked += 1;
      } else if (outcome === 'dead-letter') {
        writeDurably(
          path.join(deadLetterDir, entryFileName(entry.sequenceNumber)),
          { ...entry, refusedStatus: status, refusedAt: now().toISOString() },
        );
        fs.unlinkSync(pendingPath);
        result.deadLettered += 1;
      } else {
        result.retained = entries.length - index;
        result.stoppedOn = status === null ? 'error' : status;
        break;
      }
    }
    return result;
  }

  // Not reentrant: a drain called while one runs gets the running one's
  // promise, since two walks would send the same entry twice.
  let running = null;
  function drain(send) {
    if (running) return running;
    running = walk(send).finally(() => { running = null; });
    return running;
  }

  return { enqueue, pending, deadLetters, drain };
}

function httpSender({ endpoint, secret, fetchImpl = fetch, timeoutMs = 10000 }) {
  return async (body) => {
    const headers = { 'Content-Type': 'application/json' };
    if (secret) headers['x-telemetry-ingest-secret'] = secret;
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    return { status: response.status };
  };
}

module.exports = { createEdgeBuffer, httpSender, canonicalJson, MEASUREMENT_FIELDS, classifyStatus };
