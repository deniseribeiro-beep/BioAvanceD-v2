const { getCollection } = require('../utils/collectionResolver');
const { withTransactionWhereSupported } = require('../utils/mongoTransaction');
const logger = require('../utils/logger');
const DeviceLifecycleEventModel = require('../models/DeviceLifecycleEvent');

// #1316 (RF017 AC6/AC8): device registration and its lifecycle history. A
// Device row (ELM-0305..0315) carries the derived state of its events:
// currentLocationId, qualificationStatus and retiredAt. Events are
// append-only; the row is rewritten only from them.

class DeviceError extends Error {
  constructor(message, code, statusCode) {
    super(message);
    this.name = 'DeviceError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

const DEVICE_FIELDS = [
  'deviceType', 'manufacturer', 'modelNumber', 'serialNumber', 'firmwareVersion', 'softwareVersion',
  'calibrationDate', 'calibrationDueDate',
];
const ensuredDbs = new WeakSet();

async function ensureDeviceIndexes(db) {
  if (!db || ensuredDbs.has(db)) return;
  ensuredDbs.add(db);
  try {
    await (await getCollection(db, 'devices')).createIndex({ deviceId: 1 }, { unique: true, name: 'uniq_deviceId' });
    await (await getCollection(db, 'deviceLifecycleEvents')).createIndex({ deviceId: 1, occurredAt: 1 });
  } catch (error) {
    logger.warn(`[DEVICE] Falha ao criar índices: ${error.message}`);
  }
}

function sessionOptions(session) {
  return session ? { session } : undefined;
}

function toDateOrNull(value, field) {
  if (value === undefined || value === null || value === '') return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new DeviceError(`${field} deve ser uma data ISO 8601`, 'VALIDATION_ERROR', 422);
  return date;
}

// A registered device starts not homologated (`pending`): RF017 AC8 blocks
// it until a `qualified` event records its homologation.
async function registerDevice(db, data = {}) {
  await ensureDeviceIndexes(db);
  const deviceId = data.deviceId ? String(data.deviceId).trim() : '';
  if (!deviceId) throw new DeviceError('deviceId é obrigatório (ELM-0305)', 'VALIDATION_ERROR', 422);
  if (!data.deviceType) throw new DeviceError('deviceType é obrigatório (ELM-0306)', 'VALIDATION_ERROR', 422);
  if (data.maintenanceRecords !== undefined && !Array.isArray(data.maintenanceRecords)) {
    throw new DeviceError('maintenanceRecords deve ser uma lista de referências (ELM-0315)', 'VALIDATION_ERROR', 422);
  }
  const now = new Date();
  const device = { deviceId };
  for (const field of DEVICE_FIELDS) {
    device[field] = data[field] === undefined || data[field] === '' ? null : data[field];
  }
  device.calibrationDate = toDateOrNull(data.calibrationDate, 'calibrationDate');
  device.calibrationDueDate = toDateOrNull(data.calibrationDueDate, 'calibrationDueDate');
  Object.assign(device, {
    deviceType: String(data.deviceType),
    maintenanceRecords: (data.maintenanceRecords || []).map(String),
    qualificationStatus: 'pending',
    currentLocationId: null,
    retiredAt: null,
    createdAt: now,
    updatedAt: now,
  });
  try {
    await (await getCollection(db, 'devices')).insertOne(device);
  } catch (error) {
    if (error?.code === 11000) throw new DeviceError(`Dispositivo ${deviceId} já registrado`, 'DEVICE_EXISTS', 409);
    throw error;
  }
  return device;
}

async function findDevice(db, deviceId, session) {
  const device = await (await getCollection(db, 'devices')).findOne({ deviceId: String(deviceId) }, sessionOptions(session));
  if (!device) throw new DeviceError(`Dispositivo ${deviceId} não encontrado`, 'DEVICE_NOT_FOUND', 404);
  return device;
}

// Appends one event and stamps the state it derives, in one transaction
// where one runs. The update is guarded by the state it was derived from,
// so a concurrent event makes this one a 409 rather than a lost write.
async function recordEvent(db, deviceId, data = {}) {
  await ensureDeviceIndexes(db);
  let event;
  try {
    event = DeviceLifecycleEventModel.create({ ...data, deviceId });
  } catch (error) {
    throw new DeviceError(error.message, 'VALIDATION_ERROR', 422);
  }
  return withTransactionWhereSupported(db, async (session) => {
    const device = await findDevice(db, deviceId, session);
    const prior = {
      currentLocationId: device.currentLocationId ?? null,
      qualificationStatus: device.qualificationStatus ?? null,
      retiredAt: device.retiredAt ?? null,
    };
    let next;
    try {
      next = DeviceLifecycleEventModel.apply(prior, event);
    } catch (error) {
      throw new DeviceError(error.message, 'LIFECYCLE_CONFLICT', 409);
    }
    const update = await (await getCollection(db, 'devices')).updateOne(
      { deviceId: device.deviceId, ...prior },
      { $set: { ...next, updatedAt: new Date() } },
      sessionOptions(session)
    );
    if (!update || update.matchedCount === 0) {
      throw new DeviceError(`Dispositivo ${deviceId} mudou durante a operação; tente novamente`, 'LIFECYCLE_CONFLICT', 409);
    }
    await (await getCollection(db, 'deviceLifecycleEvents')).insertOne(event, sessionOptions(session));
    return { device: { ...device, ...next }, event };
  });
}

async function getDevice(db, deviceId) {
  const device = await findDevice(db, deviceId);
  const history = await (await getCollection(db, 'deviceLifecycleEvents')).find({ deviceId: device.deviceId }).toArray();
  history.sort((a, b) => new Date(a.occurredAt) - new Date(b.occurredAt));
  return { ...device, history };
}

async function listDevices(db) {
  return (await getCollection(db, 'devices')).find({}).toArray();
}

// RF017 AC8: why the named device may not be used now, or null.
async function deviceUsabilityRefusal(db, deviceId) {
  const device = deviceId
    ? await (await getCollection(db, 'devices')).findOne({ deviceId: String(deviceId) })
    : null;
  return DeviceLifecycleEventModel.usabilityRefusal(device);
}

module.exports = {
  DeviceError,
  ensureDeviceIndexes,
  registerDevice,
  recordEvent,
  getDevice,
  listDevices,
  deviceUsabilityRefusal,
};
