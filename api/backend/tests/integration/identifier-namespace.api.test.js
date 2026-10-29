import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
const request = require('supertest');
const jwt = require('jsonwebtoken');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'vitest-secret-key';

const app = require('../../app');
const sessionService = require('../../src/services/session.service');
const { createCollectionMock, createDbMock } = require('../factories/db.factory');
const { buildRbacCollections } = require('../factories/rbac.factory');

// RF011 AC3, RNF024 C2, RULE-036 (#1322): IdentifierNamespaceRegistry is
// mounted via createMasterDataRouter -- master-data.api.test.js covers the
// shared router's own branches. These tests cover what is specific to this
// mount: the model's RULE-036 checks gate the POST, a namespaceKey keeps its
// systemUri across versions, and a PUT neither moves the URI nor sets a key
// outside the allowlist.

const PATH = '/api/identifier-namespaces';
const SYSTEM_URI = 'https://id.bioadvanced.dev/ns/specimen';

const rbacCollectionsAdmin = buildRbacCollections([{ userAccountId: 'qa-1', accessType: 4 }]);
const rbacCollectionsTechnician = buildRbacCollections([{ userAccountId: 'qa-2', accessType: 2 }]);

function makeToken(userID, accessType) {
  return jwt.sign(
    { userID, accessType, roleName: accessType >= 3 ? 'Coordenador' : 'Tecnico', name: 'QA', mfaVerified: true },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
}

function givenSession() {
  vi.spyOn(sessionService, 'verifySession').mockResolvedValue({ valid: true, session: { sessionID: 'sess-1' } });
  vi.spyOn(sessionService, 'updateActivity').mockResolvedValue({ sessionID: 'sess-1' });
}

beforeEach(() => { givenSession(); });
afterEach(() => { vi.restoreAllMocks(); });

const valid = {
  namespaceKey: 'specimen',
  systemUri: SYSTEM_URI,
  authorityDomain: 'bioadvanced.dev',
  targetTypes: ['specimen'],
  semanticVersion: '1.0.0',
  status: 'active',
  effectivePeriod: { start: '2026-01-01' },
  configurationReleaseId: 'cfg-2026-10',
};

// Answers the stored rows whose namespaceKey matches the filter's.
function namespacesWith(rows, overrides = {}) {
  return createCollectionMock({
    find: vi.fn((filter = {}) => ({
      toArray: vi.fn().mockResolvedValue(rows.filter((row) => !filter.namespaceKey || row.namespaceKey === filter.namespaceKey)),
    })),
    ...overrides,
  });
}

const post = (body) => request(app).post(PATH).set('Authorization', `Bearer ${makeToken('qa-1', 4)}`).send(body);

describe('IdentifierNamespaceRegistry mount (/api/identifier-namespaces)', () => {
  it('returns 401 without token', async () => {
    const res = await request(app).get(PATH);
    expect(res.status).toBe(401);
  });

  it('creates a valid namespace row', async () => {
    const coll = namespacesWith([], { insertOne: vi.fn().mockResolvedValue({ insertedId: '507f1f77bcf86cd799439011' }) });
    app.locals.db = createDbMock({ identifierNamespaceRegistries: coll, ...rbacCollectionsAdmin });

    const res = await post(valid);

    expect(res.status).toBe(201);
    expect(coll.insertOne).toHaveBeenCalledTimes(1);
    const stored = coll.insertOne.mock.calls[0][0];
    expect(stored).toMatchObject({ namespaceKey: 'specimen', systemUri: SYSTEM_URI, semanticVersion: '1.0.0', status: 'active' });
    expect(typeof stored.identifierNamespaceRegistryId).toBe('string');
  });

  it.each([
    ['an http: URI', { systemUri: 'http://id.bioadvanced.dev/ns/specimen' }, /HTTPS \(RULE-036\)/],
    ['a host outside bioadvanced.dev', { systemUri: 'https://bioadvanced.dev.evil.org/ns/specimen' }, /fora de bioadvanced\.dev.*\(RULE-036\)/],
    ['no configurationReleaseId', { configurationReleaseId: undefined }, /configurationReleaseId/],
  ])('returns 422 for %s, and stores nothing', async (_label, change, message) => {
    const coll = namespacesWith([]);
    app.locals.db = createDbMock({ identifierNamespaceRegistries: coll, ...rbacCollectionsAdmin });

    const res = await post({ ...valid, ...change });

    expect(res.status).toBe(422);
    expect(res.body.details.join(' | ')).toMatch(message);
    expect(coll.insertOne).not.toHaveBeenCalled();
  });

  it('returns 409 for an existing namespaceKey under another systemUri, and stores nothing', async () => {
    const coll = namespacesWith([{ ...valid, systemUri: 'https://id.bioadvanced.dev/ns/other' }]);
    app.locals.db = createDbMock({ identifierNamespaceRegistries: coll, ...rbacCollectionsAdmin });

    const res = await post({ ...valid, semanticVersion: '1.1.0' });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('systemUri do namespace specimen não pode mudar entre versões (RULE-036)');
    expect(coll.insertOne).not.toHaveBeenCalled();
  });

  it.each([
    ['an array systemUri', { systemUri: ['https://id.bioadvanced.dev/ns/other'] }, 'systemUri'],
    ['a numeric namespaceKey', { namespaceKey: 7 }, 'namespaceKey'],
  ])('returns 422 for %s, and stores nothing', async (_label, change, field) => {
    const coll = namespacesWith([{ ...valid, namespaceKey: change.namespaceKey ?? valid.namespaceKey }]);
    app.locals.db = createDbMock({ identifierNamespaceRegistries: coll, ...rbacCollectionsAdmin });

    const res = await post({ ...valid, ...change });

    expect(res.status).toBe(422);
    expect(res.body.error).toBe(`${field} deve ser um texto não vazio para IdentifierNamespaceRegistry (RULE-036)`);
    expect(coll.insertOne).not.toHaveBeenCalled();
  });

  it('returns 403 for a Tecnico (accessType 2)', async () => {
    app.locals.db = createDbMock({ ...rbacCollectionsTechnician });

    const res = await request(app).post(PATH).set('Authorization', `Bearer ${makeToken('qa-2', 2)}`).send(valid);

    expect(res.status).toBe(403);
  });

  it('returns 422 for a PUT that changes systemUri, and updates nothing', async () => {
    const coll = namespacesWith([], {
      findOne: vi.fn().mockResolvedValue({ identifierNamespaceRegistryId: 'ns-1', ...valid }),
    });
    app.locals.db = createDbMock({ identifierNamespaceRegistries: coll, ...rbacCollectionsAdmin });

    const res = await request(app)
      .put(`${PATH}/ns-1`)
      .set('Authorization', `Bearer ${makeToken('qa-1', 4)}`)
      .send({ systemUri: 'https://id.bioadvanced.dev/ns/other' });

    expect(res.status).toBe(422);
    expect(res.body.message).toBe('systemUri não pode ser alterado por edição');
    expect(coll.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('a PUT of semanticVersion sets only allowlisted keys', async () => {
    const coll = namespacesWith([], {
      findOne: vi.fn().mockResolvedValue({ identifierNamespaceRegistryId: 'ns-1', ...valid }),
      findOneAndUpdate: vi.fn().mockResolvedValue({ identifierNamespaceRegistryId: 'ns-1', ...valid, semanticVersion: '1.1.0' }),
    });
    app.locals.db = createDbMock({ identifierNamespaceRegistries: coll, ...rbacCollectionsAdmin });

    const res = await request(app)
      .put(`${PATH}/ns-1`)
      .set('Authorization', `Bearer ${makeToken('qa-1', 4)}`)
      .send({ semanticVersion: '1.1.0', identifierNamespaceRegistryId: 'ns-2', injected: 'x' });

    expect(res.status).toBe(200);
    const $set = coll.findOneAndUpdate.mock.calls[0][1].$set;
    expect(Object.keys($set).sort()).toEqual(['semanticVersion', 'updatedAt']);
    expect($set.semanticVersion).toBe('1.1.0');
  });
});
