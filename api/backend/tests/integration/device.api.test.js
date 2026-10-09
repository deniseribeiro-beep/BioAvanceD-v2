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

// #1316, RF017 AC6/AC8: the device routes against the real app and RBAC
// middleware, over query-matching fake collections.

function matches(doc, filter) {
  return Object.entries(filter).every(([key, value]) => (value === null ? doc[key] == null : doc[key] === value));
}

function fakeCollection() {
  const docs = [];
  return {
    docs,
    createIndex: async () => undefined,
    insertOne: async (doc) => {
      if (doc.deviceId && !doc.deviceLifecycleEventId && docs.some((row) => row.deviceId === doc.deviceId)) {
        throw Object.assign(new Error('E11000'), { code: 11000 });
      }
      docs.push({ ...doc });
      return { insertedId: docs.length };
    },
    findOne: async (filter) => docs.find((doc) => matches(doc, filter)) || null,
    find: (filter = {}) => ({ toArray: async () => docs.filter((doc) => matches(doc, filter)) }),
    updateOne: async (filter, update) => {
      const doc = docs.find((row) => matches(row, filter));
      if (doc) Object.assign(doc, update.$set);
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
  vi.spyOn(sessionService, 'verifySession').mockResolvedValue({ valid: true, session: { sessionID: 'sess-dev' } });
  vi.spyOn(sessionService, 'updateActivity').mockResolvedValue({ sessionID: 'sess-dev' });
  vi.spyOn(auditLogger, 'init').mockImplementation(() => undefined);
  vi.spyOn(auditLogger, 'log').mockResolvedValue(undefined);
  domain = { devices: fakeCollection(), deviceLifecycleEvents: fakeCollection() };
  app.locals.db = createDbMock({ ...domain, ...buildRbacCollections(USERS) });
});

afterEach(() => { vi.restoreAllMocks(); });

const post = (path, user, body = {}) => request(app).post(`/api/devices${path}`).set('Authorization', token(user)).send(body);
const get = (path, user) => request(app).get(`/api/devices${path}`).set('Authorization', token(user));

describe('device routes (#1316, RF017 AC6/AC8)', () => {
  it('lets a Coordenador register a device, not homologated, and refuses a Técnico', async () => {
    expect((await post('/', 'tech', { deviceId: 'dev-1', deviceType: 'freezer' })).status).toBe(403);
    const res = await post('/', 'coord', { deviceId: 'dev-1', deviceType: 'freezer', maintenanceRecords: ['maint-1'] });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ deviceId: 'dev-1', qualificationStatus: 'pending', maintenanceRecords: ['maint-1'] });
    expect((await post('/', 'coord', { deviceId: 'dev-1', deviceType: 'freezer' })).status).toBe(409);
    expect(auditLogger.log).toHaveBeenCalledWith(expect.objectContaining({ resourceType: 'Device' }));
  });

  it('appends lifecycle events and reads them back as history', async () => {
    await post('/', 'coord', { deviceId: 'dev-1', deviceType: 'freezer' });
    expect((await post('/dev-1/events', 'tech', { eventType: 'installed', locationId: 'room-1' })).status).toBe(403);
    expect((await post('/dev-1/events', 'coord', { eventType: 'installed', locationId: 'room-1' })).status).toBe(201);
    expect((await post('/dev-1/events', 'coord', { eventType: 'qualified', evidenceUri: 'object://pq.pdf' })).status).toBe(201);
    const read = await get('/dev-1', 'tech');
    expect(read.status).toBe(200);
    expect(read.body.data).toMatchObject({ qualificationStatus: 'qualified', currentLocationId: 'room-1' });
    expect(read.body.data.history.map((e) => e.eventType)).toEqual(['installed', 'qualified']);
    expect((await get('/', 'tech')).body.data).toHaveLength(1);
  });

  it('answers a conflict with 409, a bad event with 422 and details, and an unknown device with 404', async () => {
    await post('/', 'coord', { deviceId: 'dev-1', deviceType: 'freezer' });
    expect((await post('/dev-1/events', 'coord', { eventType: 'moved', locationId: 'room-2' })).body.error).toBe('LIFECYCLE_CONFLICT');
    const bad = await post('/dev-1/events', 'coord', { eventType: 'installed' });
    expect(bad.status).toBe(422);
    expect(bad.body.details).toEqual([expect.stringContaining('locationId')]);
    expect((await get('/dev-x', 'tech')).status).toBe(404);
  });
});
