import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

// NOTE: incident.controller.js destructures both `connectMongoDB` and
// `sendIncidentAlertEmail` at module load time (`const { connectMongoDB } =
// require(...)`), so `vi.spyOn` on those modules only affects the
// controller's internal calls if the spy is installed *before* the
// controller module is first required (otherwise the controller already
// holds a direct reference to the real, unpatched function). Hence the
// require order below is deliberate.
const connectionModule = require('../../src/infrastructure/database/mongodb/connection');
const sendIncidentAlertEmailModule = require('../../src/services/sendIncidentAlertEmail');

function buildRes() {
  const res = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

function buildFindChain(toArrayResult) {
  return {
    sort: vi.fn().mockReturnThis(),
    skip: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    project: vi.fn().mockReturnThis(),
    toArray: vi.fn().mockResolvedValue(toArrayResult),
  };
}

// Shared mock collections. `getCollections()` in the controller caches these
// at the module level after the first call, so we set up `connectMongoDB`
// to resolve to this fake db exactly once (for the whole file) and then
// reconfigure the individual collection methods per-test.
const tempCollection = {
  findOne: vi.fn(),
  insertOne: vi.fn(),
  updateOne: vi.fn(),
  countDocuments: vi.fn(),
  find: vi.fn(),
};

const userCollection = {
  find: vi.fn(),
};

// #301: resolveIncident's closeEnvironmentalExcursion looks up sensorMetadata
// -> devices -> environmentalExcursions by plain collection, mirroring how
// tempCollection/userCollection are faked above (no real Mongo/Mongoose
// connection in this unit suite).
const sensorMetadataCollection = {
  findOne: vi.fn(),
};
const deviceCollection = {
  findOne: vi.fn(),
};
const excursionCollection = {
  findOne: vi.fn(),
  updateOne: vi.fn(),
};
// #1392: closeEnvironmentalExcursion reads the sensor's temperature
// datastream valid now first; by default there is none, so the #301 cases
// keep the device path.
const datastreamCollection = {
  find: vi.fn(),
};

// #426: getAlertRecipients now resolves notifiable users via
// UserRoleAssignment -> Role instead of accessType directly. These two
// collections back that lookup; the default beforeEach setup grants a
// single active `technician` assignment to NOTIFIABLE_USER_ID so
// downstream tests that only configure `userCollection.find` (the actual
// email projection) keep working unchanged.
const rolesCollection = {
  find: vi.fn(),
};
const assignmentsCollection = {
  find: vi.fn(),
};
const NOTIFIABLE_USER_ID = '507f1f77bcf86cd799439011';

const fakeDb = {
  collection: vi.fn((name) => {
    if (name === 'temperatureIncidents') return tempCollection;
    if (name === 'users') return userCollection;
    if (name === 'sensorMetadata') return sensorMetadataCollection;
    if (name === 'devices') return deviceCollection;
    if (name === 'environmentalExcursions') return excursionCollection;
    if (name === 'telemetryDatastreams') return datastreamCollection;
    if (name === 'roles') return rolesCollection;
    if (name === 'userRoleAssignments') return assignmentsCollection;
    throw new Error(`unexpected collection name: ${name}`);
  }),
};

// These spies must be installed BEFORE the controller module is required
// (see note above) so that the controller's destructured local references
// point at these mock functions rather than the real implementations.
// They are intentionally never `vi.restoreAllMocks()`-ed for the rest of
// the file, since restoring would revert the module's exported property
// but NOT the controller's already-destructured reference, leaving the
// controller calling a spy stuck in some earlier state - simplest/safest
// is to keep reconfiguring the same spy instances via mockReset/mockResolvedValue.
const connectMongoDBSpy = vi.spyOn(connectionModule, 'connectMongoDB').mockResolvedValue(fakeDb);
const sendEmailSpy = vi
  .spyOn(sendIncidentAlertEmailModule, 'sendIncidentAlertEmail')
  .mockResolvedValue();

const incidentController = require('../../src/controllers/incident.controller');
const { createFakeDb } = require('./foundation/helpers/fake-db');

beforeEach(() => {
  tempCollection.findOne.mockReset();
  tempCollection.insertOne.mockReset();
  tempCollection.updateOne.mockReset();
  tempCollection.countDocuments.mockReset();
  tempCollection.find.mockReset();
  userCollection.find.mockReset();
  sensorMetadataCollection.findOne.mockReset().mockResolvedValue(null);
  deviceCollection.findOne.mockReset().mockResolvedValue(null);
  excursionCollection.findOne.mockReset().mockResolvedValue(null);
  excursionCollection.updateOne.mockReset();
  datastreamCollection.find.mockReset().mockReturnValue(buildFindChain([]));
  // default: no alert recipients unless a test overrides it
  userCollection.find.mockReturnValue(buildFindChain([]));
  rolesCollection.find.mockReset().mockReturnValue(
    buildFindChain([{ roleId: 'role-tech', roleCode: 'technician', roleStatus: 'active' }])
  );
  assignmentsCollection.find.mockReset().mockReturnValue(
    buildFindChain([{ userAccountId: NOTIFIABLE_USER_ID, roleId: 'role-tech', assignmentStatus: 'active', validUntil: null }])
  );

  connectMongoDBSpy.mockClear().mockResolvedValue(fakeDb);
  sendEmailSpy.mockClear().mockResolvedValue();
});

afterEach(() => {
  // Deliberately not vi.restoreAllMocks() here: it would restore the real
  // (destructured-away) implementations on the module exports but the
  // controller keeps calling its own destructured spy references, so
  // per-test overrides (mockRejectedValueOnce etc.) are cleaned up above
  // via mockClear()/mockResolvedValue() in beforeEach instead.
});

describe('incident.controller.getAlertRecipients', () => {
  it('returns emails of active recipients with accessType 2/3/4, filtering out falsy emails', async () => {
    userCollection.find.mockReturnValue(
      buildFindChain([{ email: 'a@x.com' }, { email: null }, { email: 'b@x.com' }])
    );

    const result = await incidentController.getAlertRecipients();

    // #426: recipients are resolved via UserRoleAssignment -> Role (the
    // default beforeEach setup grants NOTIFIABLE_USER_ID an active
    // `technician` assignment) rather than an accessType $in query.
    const [userQuery] = userCollection.find.mock.calls[0];
    // #1386: active under the canonical accountStatus only.
    expect(userQuery.accountStatus).toBe('active');
    expect(userQuery).not.toHaveProperty('$or');
    expect(userQuery._id.$in.map((id) => id.toString())).toEqual([NOTIFIABLE_USER_ID]);
    expect(result).toEqual(['a@x.com', 'b@x.com']);
  });

  it('returns [] and swallows the error when the query throws', async () => {
    userCollection.find.mockImplementation(() => {
      throw new Error('db down');
    });

    const result = await incidentController.getAlertRecipients();

    expect(result).toEqual([]);
  });

  it('#651: resolves recipients via mongoose.Types.ObjectId without hitting the foreign-bson error on the mongoose-backed find', async () => {
    const { createForeignBsonGuardCollectionMock } = require('../factories/db.factory');
    const loggerModule = require('../../src/utils/logger');
    const errorSpy = vi.spyOn(loggerModule, 'error').mockImplementation(() => undefined);

    // Guarded find rejects any foreign `require('mongodb').ObjectId` instance
    // in the filter (mirroring mongoose's bson 7 codec), the way the real
    // mongoose-backed `users` collection would. If getAlertRecipients still
    // built ObjectId from the top-level `mongodb` package, this throws,
    // getAlertRecipients' catch swallows it, and this would fail silently
    // with an empty-array result instead of surfacing the real error.
    const guardedUsers = createForeignBsonGuardCollectionMock({
      find: vi.fn().mockReturnValue(buildFindChain([{ email: 'guarded@x.com' }])),
    });
    userCollection.find = guardedUsers.find;

    const result = await incidentController.getAlertRecipients();

    // Fail loudly with the real production error string, not with a silent
    // "0 recipients" side effect -- that silence is exactly what let #651
    // survive undetected.
    expect(errorSpy).not.toHaveBeenCalledWith(
      '[INCIDENT] Erro ao buscar destinatários de alertas:',
      'Unsupported BSON version, bson types must be from bson 7.x.x'
    );
    expect(result).toEqual(['guarded@x.com']);

    errorSpy.mockRestore();
  });
});

describe('incident.controller.createOrUpdateIncident', () => {
  it('returns 422 with validation errors when the body is invalid', async () => {
    const req = { body: { sensorKey: '', sensorName: '' } };
    const res = buildRes();

    await incidentController.createOrUpdateIncident(req, res);

    expect(res.status).toHaveBeenCalledWith(422);
    const payload = res.json.mock.calls[0][0];
    expect(payload.success).toBe(false);
    expect(payload.error).toBe('Validação falhou');
    expect(payload.details.length).toBeGreaterThan(0);
    // DB should never have been touched for an invalid payload.
    expect(tempCollection.findOne).not.toHaveBeenCalled();
  });

  it('creates a new incident, sends alert email when recipients exist', async () => {
    tempCollection.findOne.mockResolvedValue(null);
    tempCollection.insertOne.mockResolvedValue({ insertedId: 'new-id-1' });
    userCollection.find.mockReturnValue(buildFindChain([{ email: 'alert@x.com' }]));
    
    const req = {
      body: {
        sensorKey: 'sensor-1',
        sensorName: 'Freezer 1',
        currentTemperature: 10,
        maxTemperature: 10,
        minTemperature: 2,
        samplesOutOfRange: 3,
      },
    };
    const res = buildRes();

    await incidentController.createOrUpdateIncident(req, res);

    expect(tempCollection.insertOne).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    const payload = res.json.mock.calls[0][0];
    expect(payload.success).toBe(true);
    expect(payload.incident._id).toBe('new-id-1');

    // allow the fire-and-forget promise chain to flush
    await Promise.resolve();
    await Promise.resolve();
    expect(sendEmailSpy).toHaveBeenCalledWith(
      expect.objectContaining({ _id: 'new-id-1' }),
      ['alert@x.com'],
      0
    );
  });

  it('does not attempt to send an email for a new incident when there are no recipients', async () => {
    tempCollection.findOne.mockResolvedValue(null);
    tempCollection.insertOne.mockResolvedValue({ insertedId: 'new-id-2' });
    userCollection.find.mockReturnValue(buildFindChain([]));
    
    const req = {
      body: {
        sensorKey: 'sensor-2',
        sensorName: 'Freezer 2',
        currentTemperature: 10,
        maxTemperature: 10,
        minTemperature: 2,
        samplesOutOfRange: 1,
      },
    };
    const res = buildRes();

    await incidentController.createOrUpdateIncident(req, res);

    await Promise.resolve();
    expect(sendEmailSpy).not.toHaveBeenCalled();
  });

  it('merges maxTemperature/minTemperature/samplesOutOfRange onto an existing open incident', async () => {
    const existingIncident = {
      _id: 'existing-1',
      sensorKey: 'sensor-3',
      maxTemperature: 8,
      minTemperature: 1,
      samplesOutOfRange: 5,
    };
    tempCollection.findOne.mockResolvedValue(existingIncident);
    tempCollection.updateOne.mockResolvedValue({ matchedCount: 1 });

    const req = {
      body: {
        sensorKey: 'sensor-3',
        sensorName: 'Freezer 3',
        currentTemperature: 12,
        maxTemperature: 15, // greater than existing 8 -> should win
        minTemperature: 3, // greater than existing 1 -> existing 1 should win (Math.min)
        samplesOutOfRange: 2, // should accumulate: 5 + 2 = 7
      },
    };
    const res = buildRes();

    await incidentController.createOrUpdateIncident(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const payload = res.json.mock.calls[0][0];
    expect(payload.incident.maxTemperature).toBe(15);
    expect(payload.incident.minTemperature).toBe(1);
    expect(payload.incident.samplesOutOfRange).toBe(7);
    // Merge path must not insert a brand new document.
    expect(tempCollection.insertOne).not.toHaveBeenCalled();
  });

  it('returns 500 with the error message when the DB throws unexpectedly', async () => {
    tempCollection.findOne.mockRejectedValue(new Error('mongo exploded'));

    const req = {
      body: {
        sensorKey: 'sensor-4',
        sensorName: 'Freezer 4',
        currentTemperature: 10,
        maxTemperature: 10,
        minTemperature: 2,
        samplesOutOfRange: 1,
      },
    };
    const res = buildRes();

    await incidentController.createOrUpdateIncident(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'Erro ao processar incidente',
      details: 'mongo exploded',
    });
  });
});

describe('incident.controller.getIncidents', () => {
  it('applies status/sensorKey filters and defaults limit/skip', async () => {
    tempCollection.find.mockReturnValue(buildFindChain([{ _id: 'i1' }]));
    tempCollection.countDocuments.mockResolvedValue(1);

    const req = { query: { status: 'open', sensorKey: 'sensor-1' } };
    const res = buildRes();

    await incidentController.getIncidents(req, res);

    expect(tempCollection.find).toHaveBeenCalledWith({ status: 'open', sensorKey: 'sensor-1' });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      incidents: [{ _id: 'i1' }],
      total: 1,
      limit: 50,
      skip: 0,
    });
  });

  // #1332: the chain above returns whatever it is handed, so it cannot see
  // the sort. Here the incidents sit, out of order, in a store that sorts.
  it('pages incidents by opening time, newest first', async () => {
    const store = createFakeDb().collection('temperatureIncidents');
    await store.insertOne({ _id: 'mid', openedAt: new Date('2026-02-02') });
    await store.insertOne({ _id: 'newest', openedAt: new Date('2026-02-03') });
    await store.insertOne({ _id: 'oldest', openedAt: new Date('2026-02-01') });
    tempCollection.find.mockImplementation((filter) => store.find(filter));
    tempCollection.countDocuments.mockImplementation((filter) => store.countDocuments(filter));

    const res = buildRes();
    await incidentController.getIncidents({ query: { limit: '2', skip: '1' } }, res);

    expect(res.json.mock.calls[0][0].incidents.map((incident) => incident._id)).toEqual(['mid', 'oldest']);
  });

  it('counts only unresolved incidents when excludeResolved is set', async () => {
    tempCollection.find.mockReturnValue(buildFindChain([{ _id: 'open-1' }]));
    tempCollection.countDocuments.mockResolvedValue(12);

    const res = buildRes();
    await incidentController.getIncidents({ query: { limit: '3', excludeResolved: 'true' } }, res);

    expect(tempCollection.find).toHaveBeenCalledWith({ status: { $ne: 'resolved' } });
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      incidents: [{ _id: 'open-1' }],
      total: 12,
      limit: 3,
      skip: 0,
    });
  });

  it('honors explicit limit/skip query params, coercing to numbers', async () => {
    const chain = buildFindChain([]);
    tempCollection.find.mockReturnValue(chain);
    tempCollection.countDocuments.mockResolvedValue(0);

    const req = { query: { limit: '5', skip: '10' } };
    const res = buildRes();

    await incidentController.getIncidents(req, res);

    expect(chain.skip).toHaveBeenCalledWith(10);
    expect(chain.limit).toHaveBeenCalledWith(5);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      incidents: [],
      total: 0,
      limit: 5,
      skip: 10,
    });
  });

  it('returns 500 with the error message when the DB throws', async () => {
    tempCollection.find.mockImplementation(() => {
      throw new Error('list exploded');
    });

    const req = { query: {} };
    const res = buildRes();

    await incidentController.getIncidents(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'Erro ao listar incidentes',
      details: 'list exploded',
    });
  });
});

describe('incident.controller.acknowledgeIncident', () => {
  it('returns 404 when no incident matches', async () => {
    tempCollection.updateOne.mockResolvedValue({ matchedCount: 0 });

    const req = { params: { incidentId: '507f1f77bcf86cd799439011' }, body: { userId: 'u1' } };
    const res = buildRes();

    await incidentController.acknowledgeIncident(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('returns 200 and acknowledges the incident when found', async () => {
    tempCollection.updateOne.mockResolvedValue({ matchedCount: 1 });

    const req = {
      params: { incidentId: '507f1f77bcf86cd799439011' },
      body: { userId: 'u1', notes: 'checked' },
    };
    const res = buildRes();

    await incidentController.acknowledgeIncident(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ success: true, message: 'Incidente reconhecido' });
    const [, update] = tempCollection.updateOne.mock.calls[0];
    expect(update.$set.status).toBe('acknowledged');
    expect(update.$push.notes.message).toBe('checked');
  });

  it('returns 500 when the incidentId is not a valid ObjectId', async () => {
    const req = { params: { incidentId: 'not-a-valid-id' }, body: { userId: 'u1' } };
    const res = buildRes();

    await incidentController.acknowledgeIncident(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json.mock.calls[0][0].success).toBe(false);
    expect(res.json.mock.calls[0][0].error).toBe('Erro ao reconhecer incidente');
  });
});

describe('incident.controller.resolveIncident', () => {
  it('returns 404 when no incident matches the pre-check findOne', async () => {
    tempCollection.findOne.mockResolvedValue(null);

    const req = { params: { incidentId: '507f1f77bcf86cd799439011' }, body: { userId: 'u1' } };
    const res = buildRes();

    await incidentController.resolveIncident(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('returns 404 when the update matches nothing after the findOne pre-check passed', async () => {
    tempCollection.findOne.mockResolvedValue({ _id: '507f1f77bcf86cd799439011', sensorKey: 's1' });
    tempCollection.updateOne.mockResolvedValue({ matchedCount: 0 });

    const req = { params: { incidentId: '507f1f77bcf86cd799439011' }, body: { userId: 'u1' } };
    const res = buildRes();

    await incidentController.resolveIncident(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('returns 200 and resolves the incident when found', async () => {
    tempCollection.findOne.mockResolvedValue({ _id: '507f1f77bcf86cd799439011', sensorKey: 's1' });
    tempCollection.updateOne.mockResolvedValue({ matchedCount: 1 });

    const req = { params: { incidentId: '507f1f77bcf86cd799439011' }, body: { userId: 'u1' } };
    const res = buildRes();

    await incidentController.resolveIncident(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const payload = res.json.mock.calls[0][0];
    expect(payload.success).toBe(true);
    expect(payload.message).toBe('Incidente resolvido; amostras afetadas permanecem bloqueadas para revisão pós-incidente.');
    expect(payload.postIncidentReview).toBeDefined();
    const [, update] = tempCollection.updateOne.mock.calls[0];
    expect(update.$set.status).toBe('resolved');
  });

  it('returns 500 when the findOne pre-check rejects', async () => {
    tempCollection.findOne.mockRejectedValue(new Error('write failed'));

    const req = { params: { incidentId: '507f1f77bcf86cd799439011' }, body: { userId: 'u1' } };
    const res = buildRes();

    await incidentController.resolveIncident(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'Erro ao resolver incidente',
      details: 'write failed',
    });
  });

  it('#301: closes the matching open EnvironmentalExcursion (endDateTime/excursionStatus) when the incident resolves', async () => {
    tempCollection.findOne.mockResolvedValue({ _id: '507f1f77bcf86cd799439011', sensorKey: 's1' });
    tempCollection.updateOne.mockResolvedValue({ matchedCount: 1 });
    sensorMetadataCollection.findOne.mockResolvedValue({ sensorId: 's1', device: 'device-oid-1' });
    deviceCollection.findOne.mockResolvedValue({ _id: 'device-oid-1', deviceId: 'device-1' });
    excursionCollection.findOne.mockResolvedValue({
      _id: 'excursion-1',
      equipmentId: 'device-1',
      excursionStatus: 'open',
      startDateTime: new Date('2026-01-01T00:00:00.000Z'),
    });

    const req = { params: { incidentId: '507f1f77bcf86cd799439011' }, body: { userId: 'u1' } };
    const res = buildRes();

    await incidentController.resolveIncident(req, res);

    expect(deviceCollection.findOne).toHaveBeenCalledWith({ _id: 'device-oid-1' });
    expect(excursionCollection.findOne).toHaveBeenCalledWith({
      equipmentId: 'device-1',
      excursionStatus: { $in: ['open', 'under_assessment'] },
    });
    const [filter, update] = excursionCollection.updateOne.mock.calls[0];
    expect(filter).toEqual({ _id: 'excursion-1' });
    expect(update.$set.excursionStatus).toBe('resolved');
    expect(update.$set.endDateTime).toBeInstanceOf(Date);
    expect(update.$set.duration).toBeGreaterThan(0);

    const payload = res.json.mock.calls[0][0];
    expect(payload.environmentalExcursion.excursionStatus).toBe('resolved');
  });

  it('#301: leaves postIncidentReview/response intact when the sensor has no linked device (no excursion to close)', async () => {
    tempCollection.findOne.mockResolvedValue({ _id: '507f1f77bcf86cd799439011', sensorKey: 's1' });
    tempCollection.updateOne.mockResolvedValue({ matchedCount: 1 });
    sensorMetadataCollection.findOne.mockResolvedValue(null);

    const req = { params: { incidentId: '507f1f77bcf86cd799439011' }, body: { userId: 'u1' } };
    const res = buildRes();

    await incidentController.resolveIncident(req, res);

    expect(excursionCollection.updateOne).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    const payload = res.json.mock.calls[0][0];
    expect(payload.environmentalExcursion).toBeNull();
  });

  // #1392: the excursion key is the equipmentId of the sensor's temperature
  // datastream valid now, SensorMetadata's device the fallback.
  function bindS1To(equipmentId) {
    datastreamCollection.find.mockReturnValue(buildFindChain([{
      telemetryDatastreamId: 'ds-1',
      sensorId: 's1',
      equipmentId,
      observedProperty: 'temperature',
      validityPeriod: { start: new Date('2026-01-01T00:00:00.000Z'), end: null },
    }]));
  }

  function openExcursionsByKey(byKey) {
    excursionCollection.findOne.mockImplementation(async (filter) => byKey[filter.equipmentId] || null);
  }

  function openExcursion(_id, equipmentId) {
    return { _id, equipmentId, excursionStatus: 'open', startDateTime: new Date('2026-01-01T00:00:00.000Z') };
  }

  it('#1392: a bound sensor closes the excursion under its datastream equipmentId', async () => {
    tempCollection.findOne.mockResolvedValue({ _id: '507f1f77bcf86cd799439011', sensorKey: 's1' });
    tempCollection.updateOne.mockResolvedValue({ matchedCount: 1 });
    bindS1To('equip-ds');
    sensorMetadataCollection.findOne.mockResolvedValue({ sensorId: 's1', device: 'device-oid-1' });
    deviceCollection.findOne.mockResolvedValue({ _id: 'device-oid-1', deviceId: 'device-1' });
    openExcursionsByKey({ 'equip-ds': openExcursion('excursion-ds', 'equip-ds') });

    const res = buildRes();
    await incidentController.resolveIncident({ params: { incidentId: '507f1f77bcf86cd799439011' }, body: { userId: 'u1' } }, res);

    expect(excursionCollection.findOne).toHaveBeenCalledWith({
      equipmentId: 'equip-ds',
      excursionStatus: { $in: ['open', 'under_assessment'] },
    });
    expect(excursionCollection.updateOne).toHaveBeenCalledTimes(1);
    expect(excursionCollection.updateOne.mock.calls[0][0]).toEqual({ _id: 'excursion-ds' });
    const payload = res.json.mock.calls[0][0];
    expect(payload.environmentalExcursion).toMatchObject({ _id: 'excursion-ds', excursionStatus: 'resolved' });
  });

  it('#1392: a bound sensor also closes the excursion opened under its device before it was bound', async () => {
    tempCollection.findOne.mockResolvedValue({ _id: '507f1f77bcf86cd799439011', sensorKey: 's1' });
    tempCollection.updateOne.mockResolvedValue({ matchedCount: 1 });
    bindS1To('equip-ds');
    sensorMetadataCollection.findOne.mockResolvedValue({ sensorId: 's1', device: 'device-oid-1' });
    deviceCollection.findOne.mockResolvedValue({ _id: 'device-oid-1', deviceId: 'device-1' });
    openExcursionsByKey({
      'equip-ds': openExcursion('excursion-ds', 'equip-ds'),
      'device-1': openExcursion('excursion-device', 'device-1'),
    });

    const res = buildRes();
    await incidentController.resolveIncident({ params: { incidentId: '507f1f77bcf86cd799439011' }, body: { userId: 'u1' } }, res);

    const closedIds = excursionCollection.updateOne.mock.calls.map(([filter]) => filter._id);
    expect(closedIds).toEqual(['excursion-ds', 'excursion-device']);
    for (const [, update] of excursionCollection.updateOne.mock.calls) {
      expect(update.$set.excursionStatus).toBe('resolved');
    }
    const payload = res.json.mock.calls[0][0];
    expect(payload.environmentalExcursion._id).toBe('excursion-ds');
  });

  it('#1392: a bound sensor with no sensorMetadata row still closes its excursion', async () => {
    tempCollection.findOne.mockResolvedValue({ _id: '507f1f77bcf86cd799439011', sensorKey: 's1' });
    tempCollection.updateOne.mockResolvedValue({ matchedCount: 1 });
    bindS1To('equip-ds');
    sensorMetadataCollection.findOne.mockResolvedValue(null);
    openExcursionsByKey({ 'equip-ds': openExcursion('excursion-ds', 'equip-ds') });

    const res = buildRes();
    await incidentController.resolveIncident({ params: { incidentId: '507f1f77bcf86cd799439011' }, body: { userId: 'u1' } }, res);

    expect(excursionCollection.updateOne.mock.calls.map(([filter]) => filter._id)).toEqual(['excursion-ds']);
    expect(deviceCollection.findOne).not.toHaveBeenCalled();
    const payload = res.json.mock.calls[0][0];
    expect(payload.environmentalExcursion._id).toBe('excursion-ds');
  });
});

describe('incident.controller.escalateIncident', () => {
  it('returns 404 when the incident does not exist', async () => {
    tempCollection.findOne.mockResolvedValue(null);

    const req = { params: { incidentId: '507f1f77bcf86cd799439011' }, body: { userId: 'u1' } };
    const res = buildRes();

    await incidentController.escalateIncident(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('increments escalationLevel by 1 for a normal escalation and emails recipients', async () => {
    tempCollection.findOne.mockResolvedValue({ _id: 'inc-1', escalationLevel: 0 });
    tempCollection.updateOne.mockResolvedValue({ matchedCount: 1 });
    userCollection.find.mockReturnValue(buildFindChain([{ email: 'esc@x.com' }]));
    
    const req = { params: { incidentId: '507f1f77bcf86cd799439011' }, body: { userId: 'u1' } };
    const res = buildRes();

    await incidentController.escalateIncident(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      message: 'Incidente escalado para nível 1',
      escalationLevel: 1,
    });

    await Promise.resolve();
    await Promise.resolve();
    expect(sendEmailSpy).toHaveBeenCalledWith(
      expect.objectContaining({ _id: 'inc-1' }),
      ['esc@x.com'],
      1
    );
  });

  it('clamps escalationLevel at 2 when already at max', async () => {
    tempCollection.findOne.mockResolvedValue({ _id: 'inc-2', escalationLevel: 2 });
    tempCollection.updateOne.mockResolvedValue({ matchedCount: 1 });
    userCollection.find.mockReturnValue(buildFindChain([]));

    const req = { params: { incidentId: '507f1f77bcf86cd799439011' }, body: { userId: 'u1' } };
    const res = buildRes();

    await incidentController.escalateIncident(req, res);

    expect(res.json).toHaveBeenCalledWith({
      success: true,
      message: 'Incidente escalado para nível 2',
      escalationLevel: 2,
    });
  });

  it('returns 500 when the incidentId is not a valid ObjectId', async () => {
    const req = { params: { incidentId: 'not-a-valid-id' }, body: { userId: 'u1' } };
    const res = buildRes();

    await incidentController.escalateIncident(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json.mock.calls[0][0].error).toBe('Erro ao escalar incidente');
  });
});

describe('incident.controller.addNoteToIncident', () => {
  it('returns 400 when message is missing', async () => {
    const req = { params: { incidentId: '507f1f77bcf86cd799439011' }, body: { userId: 'u1' } };
    const res = buildRes();

    await incidentController.addNoteToIncident(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ success: false, error: 'message é obrigatório' });
  });

  it('returns 400 when message is not a string', async () => {
    const req = { params: { incidentId: '507f1f77bcf86cd799439011' }, body: { userId: 'u1', message: 123 } };
    const res = buildRes();

    await incidentController.addNoteToIncident(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 404 when no incident matches', async () => {
    tempCollection.updateOne.mockResolvedValue({ matchedCount: 0 });

    const req = {
      params: { incidentId: '507f1f77bcf86cd799439011' },
      body: { userId: 'u1', message: 'a note' },
    };
    const res = buildRes();

    await incidentController.addNoteToIncident(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('returns 200 and adds the note when the incident exists', async () => {
    tempCollection.updateOne.mockResolvedValue({ matchedCount: 1 });

    const req = {
      params: { incidentId: '507f1f77bcf86cd799439011' },
      body: { userId: 'u1', message: 'a note' },
    };
    const res = buildRes();

    await incidentController.addNoteToIncident(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ success: true, message: 'Nota adicionada ao incidente' });
    const [, update] = tempCollection.updateOne.mock.calls[0];
    expect(update.$push.notes.message).toBe('a note');
  });

  it('returns 500 when the incidentId is not a valid ObjectId', async () => {
    const req = {
      params: { incidentId: 'not-a-valid-id' },
      body: { userId: 'u1', message: 'a note' },
    };
    const res = buildRes();

    await incidentController.addNoteToIncident(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json.mock.calls[0][0].error).toBe('Erro ao adicionar nota');
  });
});
