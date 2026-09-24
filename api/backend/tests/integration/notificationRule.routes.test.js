import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
const request = require('supertest');
const jwt = require('jsonwebtoken');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'vitest-secret-key';

const app = require('../../app');
const sessionService = require('../../src/services/session.service');
const { createCollectionMock, createDbMock } = require('../factories/db.factory');
const { buildRbacCollections } = require('../factories/rbac.factory');
const {
  makeAuthToken,
  makeLegacyClaimsToken,
  buildAuthenticatedCollections,
  userForAccessType,
  TEST_USER_ACCOUNT_IDS,
} = require('../factories/auth.factory');


// #646 Wave 3 (RF015/RNF026) -- mirrors retentionPolicy.routes.test.js's
// shape (RF014, #440/#441) for the same versioned-admin-policy pattern.

function rbacFor(accessType) {
  return buildRbacCollections([{ userAccountId: TEST_USER_ACCOUNT_IDS[4], accessType }]);
}

function makeToken(accessType = 4) {
  return makeAuthToken(accessType);
}

function givenSession() {
  vi.spyOn(sessionService, 'verifySession').mockResolvedValue({ valid: true, session: { sessionID: 'session-1' } });
  vi.spyOn(sessionService, 'updateActivity').mockResolvedValue({ sessionID: 'session-1' });
}

function statefulNotificationRulesMock() {
  const docs = [];
  const { ObjectId } = require('mongodb');
  const matches = (doc, query = {}) =>
    Object.entries(query).every(([key, cond]) => {
      if (cond && typeof cond === 'object' && '$in' in cond) return cond.$in.includes(doc[key]);
      if (cond instanceof ObjectId || doc[key] instanceof ObjectId) {
        return String(doc[key]) === String(cond);
      }
      return doc[key] === cond;
    });

  return createCollectionMock({
    insertOne: vi.fn(async (doc) => {
      const _id = new ObjectId();
      docs.push({ _id, ...doc });
      return { insertedId: _id };
    }),
    updateMany: vi.fn(async (filter, update) => {
      const matched = docs.filter((d) => matches(d, filter));
      matched.forEach((d) => Object.assign(d, update.$set));
      return { matchedCount: matched.length, modifiedCount: matched.length };
    }),
    findOne: vi.fn(async (query = {}) => docs.find((d) => matches(d, query)) || null),
    find: vi.fn((query = {}) => {
      let current = docs.filter((d) => matches(d, query));
      const cursor = {
        sort: vi.fn((criteria = {}) => {
          const [[field, direction = 1]] = Object.entries(criteria);
          current = [...current].sort((a, b) => {
            const left = a?.[field] ?? 0;
            const right = b?.[field] ?? 0;
            if (left === right) return 0;
            return direction >= 0 ? (left > right ? 1 : -1) : (left > right ? -1 : 1);
          });
          return cursor;
        }),
        limit: vi.fn((n) => {
          if (typeof n === 'number' && n >= 0) current = current.slice(0, n);
          return cursor;
        }),
        toArray: vi.fn(async () => current),
      };
      return cursor;
    }),
  });
}

const VALID_PAYLOAD = {
  eventType: 'environmental_excursion',
  channels: ['in_app'],
  recipientRoleCodes: ['administrator'],
  sensitiveFieldsAllowlist: ['sensorId'],
  maxDeliveryMinutes: 2,
};

describe('POST /api/notification-rules', () => {
  beforeEach(() => { givenSession(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('returns 401 without token', async () => {
    const res = await request(app).post('/api/notification-rules').send(VALID_PAYLOAD);
    expect(res.status).toBe(401);
  });

  it('returns 403 for a non-administrator', async () => {
    app.locals.db = createDbMock({ notificationRules: statefulNotificationRulesMock(), ...rbacFor(3) });

    const res = await request(app)
      .post('/api/notification-rules')
      .set('Authorization', `Bearer ${makeToken(3)}`)
      .send(VALID_PAYLOAD);

    expect(res.status).toBe(403);
  });

  it('rejects a channel outside the supported set', async () => {
    app.locals.db = createDbMock({ notificationRules: statefulNotificationRulesMock(), ...rbacFor(4) });

    const res = await request(app)
      .post('/api/notification-rules')
      .set('Authorization', `Bearer ${makeToken(4)}`)
      .send({ ...VALID_PAYLOAD, channels: ['sms'] });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/channels/);
  });

  it('creates a versioned rule (v1, active)', async () => {
    app.locals.db = createDbMock({ notificationRules: statefulNotificationRulesMock(), ...rbacFor(4) });

    const res = await request(app)
      .post('/api/notification-rules')
      .set('Authorization', `Bearer ${makeToken(4)}`)
      .send(VALID_PAYLOAD);

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.version).toBe('v1');
    expect(res.body.data.active).toBe(true);
    expect(res.body.data.eventType).toBe('environmental_excursion');
  });

  it('versions an update instead of overwriting, deactivating the previous revision, keeping eventType fixed', async () => {
    const rules = statefulNotificationRulesMock();
    app.locals.db = createDbMock({ notificationRules: rules, ...rbacFor(4) });

    const createRes = await request(app)
      .post('/api/notification-rules')
      .set('Authorization', `Bearer ${makeToken(4)}`)
      .send(VALID_PAYLOAD);
    const firstId = createRes.body.data._id;

    const updateRes = await request(app)
      .put(`/api/notification-rules/${firstId}`)
      .set('Authorization', `Bearer ${makeToken(4)}`)
      .send({ ...VALID_PAYLOAD, eventType: 'brute_force_lockout', maxDeliveryMinutes: 5 });

    expect(updateRes.status).toBe(200);
    expect(updateRes.body.data.version).toBe('v2');
    expect(updateRes.body.data.previousRuleId).toBe(firstId);
    // eventType is fixed per lineage -- the attempted override is ignored.
    expect(updateRes.body.data.eventType).toBe('environmental_excursion');
    expect(updateRes.body.data.maxDeliveryMinutes).toBe(5);

    const activeRes = await request(app)
      .get('/api/notification-rules/active?eventType=environmental_excursion')
      .set('Authorization', `Bearer ${makeToken(4)}`);

    expect(activeRes.status).toBe(200);
    expect(activeRes.body.data.version).toBe('v2');
    expect(activeRes.body.data._id).not.toBe(firstId);
  });
});
