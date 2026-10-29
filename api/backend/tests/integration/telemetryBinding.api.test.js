import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
const request = require('supertest');
const jwt = require('jsonwebtoken');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'vitest-secret-key';

const app = require('../../app');
const sessionService = require('../../src/services/session.service');
const auditLogger = require('../../src/utils/auditLogger');
const { createDbMock } = require('../factories/db.factory');
const { buildRbacCollections } = require('../factories/rbac.factory');

// #1317, RF009 AC4 and RF017 AC5/AC7: the TelemetryDatastream and
// DeviceRegistration routes against the real app and RBAC middleware, over
// query-matching fake collections.

function valueAt(doc, path) {
  return path.split('.').reduce((value, key) => (value == null ? undefined : value[key]), doc);
}

function matches(doc, filter) {
  return Object.entries(filter).every(([path, expected]) => {
    const actual = valueAt(doc, path);
    return expected === null ? actual == null : actual === expected;
  });
}

function fakeCollection() {
  const docs = [];
  return {
    docs,
    createIndex: async () => undefined,
    insertOne: async (doc) => { docs.push(structuredClone(doc)); return { insertedId: docs.length }; },
    findOne: async (filter) => docs.find((doc) => matches(doc, filter)) || null,
    find: (filter = {}) => ({ toArray: async () => docs.filter((doc) => matches(doc, filter)) }),
    updateOne: async (filter, update) => {
      const doc = docs.find((row) => matches(row, filter));
      if (doc) {
        for (const [path, value] of Object.entries(update.$set)) {
          const keys = path.split('.');
          const last = keys.pop();
          keys.reduce((node, key) => node[key], doc)[last] = value;
        }
      }
      return { matchedCount: doc ? 1 : 0 };
    },
  };
}

const USERS = [
  { userAccountId: 'coord', accessType: 3, organizationId: 'org-A' },
  { userAccountId: 'tech', accessType: 2, organizationId: 'org-A' },
];

function token(userId) {
  const { accessType } = USERS.find((u) => u.userAccountId === userId);
  return `Bearer ${jwt.sign({ userID: userId, accessType, name: userId, mfaVerified: true }, process.env.JWT_SECRET, { expiresIn: '1h' })}`;
}

let domain;

beforeEach(() => {
  vi.spyOn(sessionService, 'verifySession').mockResolvedValue({ valid: true, session: { sessionID: 'sess-tb' } });
  vi.spyOn(sessionService, 'updateActivity').mockResolvedValue({ sessionID: 'sess-tb' });
  vi.spyOn(auditLogger, 'init').mockImplementation(() => undefined);
  vi.spyOn(auditLogger, 'log').mockResolvedValue(undefined);
  domain = { telemetryDatastreams: fakeCollection(), deviceRegistrations: fakeCollection() };
  app.locals.db = createDbMock({ ...domain, ...buildRbacCollections(USERS) });
});

afterEach(() => { vi.restoreAllMocks(); });

const post = (path, user, body = {}) => request(app).post(path).set('Authorization', token(user)).send(body);
const get = (path, user) => request(app).get(path).set('Authorization', token(user));

const STREAM = {
  sensorId: 'sensor-1', equipmentId: 'freezer-1', storageLocationId: 'loc-1', observedProperty: 'temperature', unit: 'Cel',
  samplingPolicyId: 'sampling-1', thresholdProfileId: 'threshold-1', validityPeriod: { start: '2026-10-01T00:00:00.000Z' },
};

describe('telemetry datastream routes (#1317, RF017 AC5)', () => {
  it('lets a Coordenador create, list and get a datastream, and refuses a Técnico the create', async () => {
    expect((await post('/api/telemetry-datastreams', 'tech', STREAM)).status).toBe(403);
    const created = await post('/api/telemetry-datastreams', 'coord', STREAM);
    expect(created.status).toBe(201);
    const id = created.body.data.telemetryDatastreamId;
    expect(created.body.data).toMatchObject({ sensorId: 'sensor-1', status: 'active', validityPeriod: { end: null } });
    expect(auditLogger.log).toHaveBeenCalledWith(expect.objectContaining({ resourceType: 'TelemetryDatastream', action: 'CREATE' }));

    const list = await get('/api/telemetry-datastreams?sensorId=sensor-1', 'tech');
    expect(list.status).toBe(200);
    expect(list.body.data.map((row) => row.telemetryDatastreamId)).toEqual([id]);
    expect((await get(`/api/telemetry-datastreams/${id}`, 'tech')).body.data.telemetryDatastreamId).toBe(id);
    expect((await get('/api/telemetry-datastreams/missing', 'tech')).status).toBe(404);
  });

  it('changes a binding only by ending the old validity and creating a successor', async () => {
    const id = (await post('/api/telemetry-datastreams', 'coord', STREAM)).body.data.telemetryDatastreamId;
    const successor = { ...STREAM, equipmentId: 'freezer-2', validityPeriod: { start: '2026-10-05T00:00:00.000Z' } };
    expect((await post('/api/telemetry-datastreams', 'coord', successor)).status).toBe(409);

    expect((await post(`/api/telemetry-datastreams/${id}/end`, 'tech', { end: '2026-10-05T00:00:00.000Z' })).status).toBe(403);
    const ended = await post(`/api/telemetry-datastreams/${id}/end`, 'coord', { end: '2026-10-05T00:00:00.000Z' });
    expect(ended.status).toBe(200);
    expect(ended.body.data).toMatchObject({ status: 'retired', validityPeriod: { end: '2026-10-05T00:00:00.000Z' } });
    expect((await post('/api/telemetry-datastreams', 'coord', successor)).status).toBe(201);
    expect(domain.telemetryDatastreams.docs.find((row) => row.telemetryDatastreamId === id).equipmentId).toBe('freezer-1');
  });

  it('refuses a datastream whose unit is not a UCUM code with 422', async () => {
    const res = await post('/api/telemetry-datastreams', 'coord', { ...STREAM, unit: 'graus C' });
    expect(res.status).toBe(422);
  });
});

describe('device registration routes (#1317, RF017 AC7)', () => {
  const REGISTRATION = { deviceId: 'sensor-1', communicationProfileId: 'mqtt-profile-1', credentialReference: 'secret-manager:device/sensor-1' };

  it('registers a device with an opaque credential reference, refuses a credential and a Técnico', async () => {
    expect((await post('/api/device-registrations', 'tech', REGISTRATION)).status).toBe(403);
    expect((await post('/api/device-registrations', 'coord', { ...REGISTRATION, password: 'hunter2' })).status).toBe(422);
    const created = await post('/api/device-registrations', 'coord', REGISTRATION);
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({ deviceId: 'sensor-1', status: 'active' });
    expect(domain.deviceRegistrations.docs).toHaveLength(1);
    expect((await get('/api/device-registrations?deviceId=sensor-1', 'tech')).body.data).toHaveLength(1);
  });

  it('deactivates an active registration once', async () => {
    const id = (await post('/api/device-registrations', 'coord', REGISTRATION)).body.data.deviceRegistrationId;
    const revoked = await post(`/api/device-registrations/${id}/deactivate`, 'coord', {});
    expect(revoked.status).toBe(200);
    expect(revoked.body.data.status).toBe('revoked');
    expect((await post(`/api/device-registrations/${id}/deactivate`, 'coord', {})).status).toBe(409);
    expect((await get(`/api/device-registrations/${id}`, 'tech')).body.data.status).toBe('revoked');
  });
});
