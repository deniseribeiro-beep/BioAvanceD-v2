import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { ObjectId } = require('mongodb');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'vitest-secret-key';

const app = require('../../app');
const sessionService = require('../../src/services/session.service');
const { createCollectionMock, createDbMock } = require('../factories/db.factory');
const { buildRbacCollections } = require('../factories/rbac.factory');

// #1462 (RNF022 AC1): GET /api/retention-policies/data-classes joins each data
// class to its family's active RetentionPolicy.

function rbacFor(accessType) {
  return buildRbacCollections([{ userAccountId: 'qa-user-1', accessType }]);
}

function makeToken(accessType = 4) {
  return jwt.sign(
    { userID: 'qa-user-1', accessType, roleName: 'Administrador', name: 'QA User', mfaVerified: true },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
}

function givenSession() {
  vi.spyOn(sessionService, 'verifySession').mockResolvedValue({ valid: true, session: { sessionID: 'session-1' } });
  vi.spyOn(sessionService, 'updateActivity').mockResolvedValue({ sessionID: 'session-1' });
}

// Real query-matching semantics for retentionPolicies, so getActivePolicy's
// `active: true` and `$in` filters genuinely pick a family's policy.
function statefulRetentionPoliciesMock(docs = []) {
  const matches = (doc, query = {}) =>
    Object.entries(query).every(([key, cond]) => {
      if (cond && typeof cond === 'object' && '$in' in cond) {
        return Array.isArray(doc[key]) ? doc[key].some((value) => cond.$in.includes(value)) : cond.$in.includes(doc[key]);
      }
      if (cond instanceof ObjectId || doc[key] instanceof ObjectId) {
        return String(doc[key]) === String(cond);
      }
      return doc[key] === cond;
    });

  return createCollectionMock({
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

describe('GET /api/retention-policies/data-classes (RNF022 AC1, #1462)', () => {
  beforeEach(() => { givenSession(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('GET /api/retention-policies/data-classes returns 403 for a non-administrator', async () => {
    app.locals.db = createDbMock({ retentionPolicies: statefulRetentionPoliciesMock(), ...rbacFor(3) });

    const res = await request(app)
      .get('/api/retention-policies/data-classes')
      .set('Authorization', `Bearer ${makeToken(3)}`);

    expect(res.status).toBe(403);
  });

  it('GET /api/retention-policies/data-classes joins each class to its family\'s active policy', async () => {
    const specimenPolicyId = new ObjectId();
    app.locals.db = createDbMock({
      retentionPolicies: statefulRetentionPoliciesMock([{
        _id: specimenPolicyId,
        applicableEntityTypes: ['Specimen'],
        retentionPeriod: 'P365D',
        active: true,
        createdAt: new Date('2026-11-01T00:00:00.000Z'),
      }]),
      ...rbacFor(4),
    });

    const res = await request(app)
      .get('/api/retention-policies/data-classes')
      .set('Authorization', `Bearer ${makeToken(4)}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(3);
    const byCode = (code) => res.body.data.find((entry) => entry.code === code);

    expect(byCode('specimen').retentionPolicyId).toBe(String(specimenPolicyId));
    expect(byCode('specimen').retentionPeriod).toBe('P365D');
    for (const code of ['auditTrail', 'dataFile']) {
      expect(byCode(code).retentionPolicyId).toBeNull();
      expect(byCode(code).retentionPeriod).toBeNull();
    }
    for (const entry of res.body.data) {
      expect(entry.purpose).toEqual(expect.any(String));
      expect(entry.sensitivity).toEqual(expect.any(String));
      expect(entry.ownerRole).toEqual(expect.any(String));
    }
  });
});
