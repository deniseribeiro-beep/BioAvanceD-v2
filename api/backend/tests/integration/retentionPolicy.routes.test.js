import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { randomUUID } = require('crypto');
const { ObjectId } = require('mongodb');

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

// Real query-matching semantics for retentionPolicies (find/findOne honor
// filters, updateMany actually flips `active`), not a canned-response
// stub -- this is what proves the versioning behavior (RF014 #5) and lets
// getActivePolicy/getAllPolicies genuinely exercise the service's queries.
function statefulRetentionPoliciesMock() {
  const docs = [];
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

// Stateful `logs`/`audit_events` mocks so the test can assert the critical
// AuditEvent (RF014 #7) actually lands, mirrored into the hash-chained
// audit_events collection via log.service.js -> audit-v2.service.js.
function statefulLogsMock() {
  const docs = [];
  return { collectionName: 'logs', docs, mock: createCollectionMock({
    insertOne: vi.fn(async (doc) => {
      const _id = randomUUID();
      docs.push({ _id, ...doc });
      return { insertedId: _id };
    }),
  }) };
}

function statefulAuditEventsMock() {
  const docs = [];
  return { docs, mock: createCollectionMock({
    createIndex: vi.fn().mockResolvedValue(null),
    insertOne: vi.fn(async (doc) => {
      docs.push(doc);
      return { insertedId: randomUUID() };
    }),
    find: vi.fn(() => ({
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      toArray: vi.fn(async () => docs),
    })),
  }) };
}

const VALID_PAYLOAD = {
  applicableEntityTypes: ['AuditEvent'],
  triggerEvent: 'creation',
  postRetentionAction: 'archive',
  retentionPeriod: 'P365D',
  effectivePeriod: { start: '2026-01-01T00:00:00.000Z' },
};

describe('POST /api/retention-policies', () => {
  beforeEach(() => { givenSession(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('returns 401 without token', async () => {
    const res = await request(app).post('/api/retention-policies').send(VALID_PAYLOAD);
    expect(res.status).toBe(401);
  });

  it('returns 403 for a non-administrator', async () => {
    app.locals.db = createDbMock({ retentionPolicies: statefulRetentionPoliciesMock(), ...rbacFor(3) });

    const res = await request(app)
      .post('/api/retention-policies')
      .set('Authorization', `Bearer ${makeToken(3)}`)
      .send(VALID_PAYLOAD);

    expect(res.status).toBe(403);
  });

  it('rejects a target collection outside the audit-trail scope', async () => {
    app.locals.db = createDbMock({ retentionPolicies: statefulRetentionPoliciesMock(), ...rbacFor(4) });

    const res = await request(app)
      .post('/api/retention-policies')
      .set('Authorization', `Bearer ${makeToken(4)}`)
      .send({ ...VALID_PAYLOAD, applicableEntityTypes: ['Patient'] });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/applicableEntityTypes/);
  });

  it('rejects postRetentionAction=destroy for AuditEvent scope (#443: sweep would silently no-op instead)', async () => {
    app.locals.db = createDbMock({ retentionPolicies: statefulRetentionPoliciesMock(), ...rbacFor(4) });

    const res = await request(app)
      .post('/api/retention-policies')
      .set('Authorization', `Bearer ${makeToken(4)}`)
      .send({ ...VALID_PAYLOAD, applicableEntityTypes: ['AuditEvent'], postRetentionAction: 'destroy' });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/postRetentionAction/);
  });

  it('creates a versioned policy and registers a critical AuditEvent mirrored into audit_events', async () => {
    const logs = statefulLogsMock();
    const auditEvents = statefulAuditEventsMock();
    app.locals.db = createDbMock({
      retentionPolicies: statefulRetentionPoliciesMock(),
      logs: logs.mock,
      audit_events: auditEvents.mock,
      ...rbacFor(4),
    });

    const res = await request(app)
      .post('/api/retention-policies')
      .set('Authorization', `Bearer ${makeToken(4)}`)
      .send(VALID_PAYLOAD);

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.version).toBe('v1');
    expect(res.body.data.active).toBe(true);

    // Criterion 7: the change was registered as a critical AuditEvent.
    const auditLog = logs.docs.find((d) => d.entity === 'RetentionPolicy' && d.action === 'CREATE');
    expect(auditLog).toBeTruthy();
    expect(auditLog.severity).toBe('critical');

    // Mirrored into the hash-chained trail, not just the plain Log collection
    // (the global audit.middleware also mirrors its own per-request log, so
    // more than one audit_events row for the call is expected).
    const mirroredEvent = auditEvents.docs.find((d) => d.entityType === 'RetentionPolicy');
    expect(mirroredEvent).toBeTruthy();
  });

  it('versions an update instead of overwriting, deactivating the previous revision', async () => {
    const policies = statefulRetentionPoliciesMock();
    app.locals.db = createDbMock({
      retentionPolicies: policies,
      logs: statefulLogsMock().mock,
      audit_events: statefulAuditEventsMock().mock,
      ...rbacFor(4),
    });

    const createRes = await request(app)
      .post('/api/retention-policies')
      .set('Authorization', `Bearer ${makeToken(4)}`)
      .send(VALID_PAYLOAD);
    const firstId = createRes.body.data._id;

    const updateRes = await request(app)
      .put(`/api/retention-policies/${firstId}`)
      .set('Authorization', `Bearer ${makeToken(4)}`)
      .send({ ...VALID_PAYLOAD, retentionPeriod: 'P730D' });

    expect(updateRes.status).toBe(200);
    expect(updateRes.body.data.version).toBe('v2');
    expect(updateRes.body.data.previousPolicyId).toBe(firstId);
    expect(updateRes.body.data.retentionPeriod).toBe('P730D');

    const activeRes = await request(app)
      .get('/api/retention-policies/active')
      .set('Authorization', `Bearer ${makeToken(4)}`);

    expect(activeRes.status).toBe(200);
    expect(activeRes.body.data.version).toBe('v2');
    expect(activeRes.body.data._id).not.toBe(firstId);
  });
});
