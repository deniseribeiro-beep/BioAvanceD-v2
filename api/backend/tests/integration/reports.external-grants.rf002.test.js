import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
const request = require('supertest');
const jwt = require('jsonwebtoken');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'vitest-secret-key';

const app = require('../../app');
const sessionService = require('../../src/services/session.service');
const { createCollectionMock, createDbMock } = require('../factories/db.factory');
const { buildRbacCollections } = require('../factories/rbac.factory');

// RF002 AC4 (Requisitos v4.0.0): "O Usuário Externo visualiza somente dados e
// relatórios previamente autorizados." An external user (hierarchy level 1)
// reads a stored report only when an active grant in `access` names its
// reportID, and builds a report type only when a grant names that type. A
// Técnico with the same permission and organization is not restricted.

const ORG = 'org-1';
const GRANT_REFUSAL = 'Relatório não autorizado para este usuário.';

const REPORTS = [
  { _id: 'r1', reportID: 1, reportType: 'equipment', organizationIds: [ORG], generatedAt: new Date('2026-10-01') },
  { _id: 'r2', reportID: 2, reportType: 'sensor', organizationIds: [ORG], generatedAt: new Date('2026-10-02') },
];
const TEMPLATES = [
  { code: 'equipment', handlerKey: 'equipment', templateStatus: 'active' },
  { code: 'sensor', handlerKey: 'sensor', templateStatus: 'active' },
];

// #1201: a grant names its beneficiary under userAccountId (dict-02
// P1X-0239); legacyGrant is one written before the rename, under userId.
function grant(overrides = {}) {
  return { userAccountId: 'ext-1', resourceType: 'report', reportID: 1, reportType: 'equipment', grantStatus: 'active', expiresAt: null, revokedAt: null, ...overrides };
}

function legacyGrant(overrides = {}) {
  const { userAccountId, ...rest } = grant(overrides);
  return { ...rest, userId: userAccountId };
}

function matches(doc, query = {}) {
  return Object.entries(query).every(([key, cond]) => {
    if (key === '$or') return cond.some((branch) => matches(doc, branch));
    if (cond && typeof cond === 'object' && '$in' in cond) {
      const values = Array.isArray(doc[key]) ? doc[key] : [doc[key]];
      return values.some((value) => cond.$in.includes(value));
    }
    return doc[key] === cond;
  });
}

function listing(docs) {
  return vi.fn((query = {}) => {
    const hits = docs.filter((d) => matches(d, query));
    return { sort: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue(hits) }), toArray: vi.fn().mockResolvedValue(hits) };
  });
}

function dbFor(userAccountId, accessType, grants) {
  return createDbMock({
    reports: createCollectionMock({ find: listing(REPORTS), findOne: vi.fn(async (q) => REPORTS.find((d) => matches(d, q)) || null) }),
    access: createCollectionMock({ find: listing(grants) }),
    reportTemplates: createCollectionMock({ findOne: vi.fn(async (q) => TEMPLATES.find((d) => matches(d, q)) || null) }),
    ...buildRbacCollections([{ userAccountId, accessType, organizationId: ORG }]),
  });
}

function as(userAccountId, accessType) {
  return `Bearer ${jwt.sign({ userID: userAccountId, accessType, name: 'T', mfaVerified: true }, process.env.JWT_SECRET, { expiresIn: '1h' })}`;
}

beforeEach(() => {
  vi.spyOn(sessionService, 'verifySession').mockResolvedValue({ valid: true, session: { sessionID: 'sess-1' } });
  vi.spyOn(sessionService, 'updateActivity').mockResolvedValue({ sessionID: 'sess-1' });
});
afterEach(() => { vi.restoreAllMocks(); });

describe('RF002 AC4: GET /api/reports for an external user', () => {
  it('lists only the reports an active grant names', async () => {
    app.locals.db = dbFor('ext-1', 1, [grant()]);
    const res = await request(app).get('/api/reports').set('Authorization', as('ext-1', 1));
    expect(res.status).toBe(200);
    expect(res.body.map((r) => r.reportID)).toEqual([1]);
  });

  it('lists nothing when every grant is revoked or expired', async () => {
    app.locals.db = dbFor('ext-1', 1, [
      grant({ grantStatus: 'revoked', revokedAt: new Date() }),
      grant({ reportID: 2, expiresAt: new Date('2020-01-01') }),
    ]);
    const res = await request(app).get('/api/reports').set('Authorization', as('ext-1', 1));
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('#1201: lists the report a grant stored under userAccountId names', async () => {
    app.locals.db = dbFor('ext-1', 1, [grant({ reportID: 2, userAccountId: 'other' }), grant()]);
    const res = await request(app).get('/api/reports').set('Authorization', as('ext-1', 1));
    expect(res.status).toBe(200);
    expect(res.body.map((r) => r.reportID)).toEqual([1]);
  });

  it('#1201: lists the report a grant written before the rename, under userId, names', async () => {
    app.locals.db = dbFor('ext-1', 1, [legacyGrant({ reportID: 2, userAccountId: 'other' }), legacyGrant()]);
    const res = await request(app).get('/api/reports').set('Authorization', as('ext-1', 1));
    expect(res.status).toBe(200);
    expect(res.body.map((r) => r.reportID)).toEqual([1]);
  });

  it('leaves a Técnico in the same organization unrestricted', async () => {
    app.locals.db = dbFor('tec-1', 2, []);
    const res = await request(app).get('/api/reports').set('Authorization', as('tec-1', 2));
    expect(res.status).toBe(200);
    expect(res.body.map((r) => r.reportID).sort()).toEqual([1, 2]);
  });
});

describe('RF002 AC4: GET /api/reports/:id for an external user', () => {
  it('reads a granted report', async () => {
    app.locals.db = dbFor('ext-1', 1, [grant()]);
    const res = await request(app).get('/api/reports/1').set('Authorization', as('ext-1', 1));
    expect(res.status).toBe(200);
    expect(res.body.reportID).toBe(1);
  });

  it('is refused a report no grant names', async () => {
    app.locals.db = dbFor('ext-1', 1, [grant()]);
    const res = await request(app).get('/api/reports/2').set('Authorization', as('ext-1', 1));
    expect(res.status).toBe(403);
    expect(res.body.message).toBe(GRANT_REFUSAL);
  });
});

describe('RF002 AC4: building a report type', () => {
  it('refuses an external user a preview of a type no grant names', async () => {
    app.locals.db = dbFor('ext-1', 1, [grant()]);
    const res = await request(app).post('/api/reports/sensor/preview').set('Authorization', as('ext-1', 1)).send({});
    expect(res.status).toBe(403);
    expect(res.body.message).toBe(GRANT_REFUSAL);
  });

  it('refuses an external user generating a type no grant names', async () => {
    app.locals.db = dbFor('ext-1', 1, [grant()]);
    const res = await request(app).post('/api/reports/generate').set('Authorization', as('ext-1', 1)).send({ reportType: 'sensor' });
    expect(res.status).toBe(403);
    expect(res.body.message).toBe(GRANT_REFUSAL);
  });

  it('lets an external user past the grant check for a granted type', async () => {
    app.locals.db = dbFor('ext-1', 1, [grant()]);
    const res = await request(app).post('/api/reports/equipment/preview').set('Authorization', as('ext-1', 1)).send({});
    expect(res.body.message).not.toBe(GRANT_REFUSAL);
  });

  it('does not restrict a Técnico by grants', async () => {
    app.locals.db = dbFor('tec-1', 2, []);
    const res = await request(app).post('/api/reports/sensor/preview').set('Authorization', as('tec-1', 2)).send({});
    expect(res.body.message).not.toBe(GRANT_REFUSAL);
  });
});
