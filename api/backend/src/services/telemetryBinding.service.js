const { getCollection } = require('../utils/collectionResolver');
const { withTransactionWhereSupported } = require('../utils/mongoTransaction');
const logger = require('../utils/logger');
const TelemetryDatastreamModel = require('../models/TelemetryDatastream');
const DeviceRegistrationModel = require('../models/DeviceRegistration');

// RF009 AC4, RF017 AC5/AC7 (#1317): the TelemetryDatastreams that bind a
// sensor to what it watches, and the DeviceRegistrations that enrol it.
//
// A datastream's binding is never rewritten in place: a change of
// equipment, location, unit or profile is a new datastream, after the old
// one's validity is ended. A reading is interpreted through the datastream
// valid at its observedAt, so the history stays readable.
//
// A registration is never edited either; it is deactivated (`suspended` or
// `revoked`) and a new one is created.

class TelemetryBindingError extends Error {
  constructor(message, code, statusCode) {
    super(message);
    this.name = 'TelemetryBindingError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

const ensuredDbs = new WeakSet();

async function ensureTelemetryBindingIndexes(db) {
  if (!db || ensuredDbs.has(db)) return;
  ensuredDbs.add(db);
  try {
    const streams = await getCollection(db, 'telemetryDatastreams');
    await streams.createIndex({ telemetryDatastreamId: 1 }, { unique: true, name: 'uniq_telemetryDatastreamId' });
    await streams.createIndex({ sensorId: 1, observedProperty: 1, 'validityPeriod.start': 1 });
    const registrations = await getCollection(db, 'deviceRegistrations');
    await registrations.createIndex({ deviceRegistrationId: 1 }, { unique: true, name: 'uniq_deviceRegistrationId' });
    await registrations.createIndex({ deviceId: 1, status: 1 });
  } catch (error) {
    logger.warn(`[TELEMETRY_BINDING] Falha ao criar índices: ${error.message}`);
  }
}

function sessionOptions(session) {
  return session ? { session } : undefined;
}

function validation(error) {
  return new TelemetryBindingError(error.message, 'VALIDATION_ERROR', 422);
}

// Creates a datastream, refused when it overlaps another of the same sensor
// and property (one datastream per sensor and property at a time).
async function createDatastream(db, data = {}) {
  await ensureTelemetryBindingIndexes(db);
  let stream;
  try {
    stream = TelemetryDatastreamModel.create({ ...data, telemetryDatastreamId: undefined, status: undefined });
  } catch (error) {
    throw validation(error);
  }
  return withTransactionWhereSupported(db, async (session) => {
    const collection = await getCollection(db, 'telemetryDatastreams');
    const existing = await collection.find({ sensorId: stream.sensorId, observedProperty: stream.observedProperty }, sessionOptions(session)).toArray();
    try {
      TelemetryDatastreamModel.assertNoOverlap(stream, existing);
    } catch (error) {
      throw new TelemetryBindingError(error.message, 'DATASTREAM_OVERLAP', 409);
    }
    await collection.insertOne({ ...stream, createdAt: new Date() }, sessionOptions(session));
    return stream;
  });
}

async function listDatastreams(db, { sensorId } = {}) {
  const filter = sensorId ? { sensorId: String(sensorId) } : {};
  return (await getCollection(db, 'telemetryDatastreams')).find(filter).toArray();
}

async function getDatastream(db, telemetryDatastreamId) {
  const stream = await (await getCollection(db, 'telemetryDatastreams')).findOne({ telemetryDatastreamId: String(telemetryDatastreamId) });
  if (!stream) throw new TelemetryBindingError(`TelemetryDatastream ${telemetryDatastreamId} não encontrado`, 'DATASTREAM_NOT_FOUND', 404);
  return stream;
}

// Ends an open datastream's validity at `end` (exclusive), default now. Its
// binding is left as it was; the update matches only a still-open stream,
// so a concurrent end is a 409 rather than a lost write.
async function endDatastreamValidity(db, telemetryDatastreamId, { end } = {}) {
  const stream = await getDatastream(db, telemetryDatastreamId);
  if (stream.validityPeriod?.end) {
    throw new TelemetryBindingError(`TelemetryDatastream ${telemetryDatastreamId} já tem a validade encerrada`, 'DATASTREAM_ENDED', 409);
  }
  const endAt = end === undefined || end === null || end === '' ? new Date() : new Date(end);
  if (Number.isNaN(endAt.getTime())) throw new TelemetryBindingError('end deve ser uma data ISO 8601', 'VALIDATION_ERROR', 422);
  if (endAt <= new Date(stream.validityPeriod.start)) {
    throw new TelemetryBindingError('end deve ser posterior a validityPeriod.start ([start, end))', 'VALIDATION_ERROR', 422);
  }
  const update = await (await getCollection(db, 'telemetryDatastreams')).updateOne(
    { telemetryDatastreamId: stream.telemetryDatastreamId, 'validityPeriod.end': null },
    { $set: { 'validityPeriod.end': endAt, status: 'retired', updatedAt: new Date() } }
  );
  if (!update || update.matchedCount === 0) {
    throw new TelemetryBindingError(`TelemetryDatastream ${telemetryDatastreamId} mudou durante a operação; tente novamente`, 'DATASTREAM_ENDED', 409);
  }
  return { ...stream, validityPeriod: { ...stream.validityPeriod, end: endAt }, status: 'retired' };
}

async function createRegistration(db, data = {}) {
  await ensureTelemetryBindingIndexes(db);
  let registration;
  try {
    registration = DeviceRegistrationModel.create({ ...data, deviceRegistrationId: undefined, status: undefined });
  } catch (error) {
    throw validation(error);
  }
  await (await getCollection(db, 'deviceRegistrations')).insertOne({ ...registration, createdAt: new Date() });
  return registration;
}

async function listRegistrations(db, { deviceId } = {}) {
  const filter = deviceId ? { deviceId: String(deviceId) } : {};
  return (await getCollection(db, 'deviceRegistrations')).find(filter).toArray();
}

async function getRegistration(db, deviceRegistrationId) {
  const registration = await (await getCollection(db, 'deviceRegistrations')).findOne({ deviceRegistrationId: String(deviceRegistrationId) });
  if (!registration) throw new TelemetryBindingError(`DeviceRegistration ${deviceRegistrationId} não encontrado`, 'REGISTRATION_NOT_FOUND', 404);
  return registration;
}

// Moves an active registration to `suspended` or `revoked` (the default).
async function deactivateRegistration(db, deviceRegistrationId, { status = 'revoked' } = {}) {
  const next = String(status).toLowerCase();
  if (!['suspended', 'revoked'].includes(next)) {
    throw new TelemetryBindingError(`status deve ser suspended ou revoked: ${status}`, 'VALIDATION_ERROR', 422);
  }
  const registration = await getRegistration(db, deviceRegistrationId);
  if (registration.status !== 'active') {
    throw new TelemetryBindingError(`DeviceRegistration ${deviceRegistrationId} não está ativo (${registration.status})`, 'REGISTRATION_INACTIVE', 409);
  }
  const update = await (await getCollection(db, 'deviceRegistrations')).updateOne(
    { deviceRegistrationId: registration.deviceRegistrationId, status: 'active' },
    { $set: { status: next, updatedAt: new Date() } }
  );
  if (!update || update.matchedCount === 0) {
    throw new TelemetryBindingError(`DeviceRegistration ${deviceRegistrationId} mudou durante a operação; tente novamente`, 'REGISTRATION_INACTIVE', 409);
  }
  return { ...registration, status: next };
}

// RF009 AC4: the datastream of `sensorId` and `observedProperty` valid at
// `observedAt`, and the sensor's active DeviceRegistration (its deviceId is
// the sensor's id: V2E-0563 and V2E-0619 both reference Device). Either is
// null when there is none.
async function resolveReadingBinding(db, { sensorId, observedProperty, observedAt }) {
  const candidates = await (await getCollection(db, 'telemetryDatastreams')).find({
    sensorId: String(sensorId),
    observedProperty,
    'validityPeriod.start': { $lte: observedAt },
  }).toArray();
  const datastream = candidates.find((stream) => TelemetryDatastreamModel.validAt(stream, observedAt)) || null;
  const registration = await (await getCollection(db, 'deviceRegistrations')).findOne({ deviceId: String(sensorId), status: 'active' });
  return { datastream, registration: registration || null };
}

module.exports = {
  TelemetryBindingError,
  ensureTelemetryBindingIndexes,
  createDatastream,
  listDatastreams,
  getDatastream,
  endDatastreamValidity,
  createRegistration,
  listRegistrations,
  getRegistration,
  deactivateRegistration,
  resolveReadingBinding,
};
