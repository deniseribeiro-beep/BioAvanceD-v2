import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
const request = require('supertest');
const jwt = require('jsonwebtoken');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'vitest-secret-key';

const app = require('../../app');
const sessionService = require('../../src/services/session.service');
const { createCollectionMock, createDbMock } = require('../factories/db.factory');
const { buildRbacCollections } = require('../factories/rbac.factory');

// RF020 AC1 (#1322): Biobank and Network are mounted via
// createMasterDataRouter -- master-data.api.test.js covers the shared
// router's own branches. These tests cover what is specific to these two
// mounts: each model's validate() gates the POST, and legalEntityId /
// juristicPerson must name an existing Organization.

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

// Answers the organization only for its own organizationId, so a lookup on
// the wrong key or value drives the not-found path.
function organizationsWith(organizationId) {
  return createCollectionMock({
    findOne: vi.fn(async (filter = {}) => (filter.organizationId === organizationId ? { organizationId } : null)),
  });
}

const MOUNTS = [
  {
    entity: 'Biobank',
    path: '/api/biobanks',
    collection: 'biobanks',
    referenceField: 'legalEntityId',
    nameField: 'biobankName',
    valid: {
      biobankName: 'Biobanco Sintético',
      biobankDescription: 'Biobanco de teste',
      legalEntityId: 'org-1',
      biobankStatus: 'active',
      countryCode: 'br',
      contactInformation: { email: 'contato@example.org' },
    },
  },
  {
    entity: 'Network',
    path: '/api/networks',
    collection: 'networks',
    referenceField: 'juristicPerson',
    nameField: 'name',
    valid: {
      name: 'Rede Sintética',
      description: 'Rede de teste',
      juristicPerson: 'org-1',
      networkStatus: 'active',
      countryCodes: ['BR'],
      contactInformation: { email: 'rede@example.org' },
    },
  },
];

describe.each(MOUNTS)('$entity mount ($path)', ({ entity, path, collection, referenceField, nameField, valid }) => {
  it('returns 401 without token', async () => {
    const res = await request(app).get(path);
    expect(res.status).toBe(401);
  });

  it(`creates a ${entity} whose ${referenceField} names an existing organization`, async () => {
    const coll = createCollectionMock({ insertOne: vi.fn().mockResolvedValue({ insertedId: '507f1f77bcf86cd799439011' }) });
    const organizations = organizationsWith('org-1');
    app.locals.db = createDbMock({ [collection]: coll, organizations, ...rbacCollectionsAdmin });

    const res = await request(app).post(path).set('Authorization', `Bearer ${makeToken('qa-1', 4)}`).send(valid);

    expect(res.status).toBe(201);
    expect(organizations.findOne).toHaveBeenCalledWith({ organizationId: 'org-1' });
    expect(coll.insertOne).toHaveBeenCalledTimes(1);
    const stored = coll.insertOne.mock.calls[0][0];
    expect(stored[nameField]).toBe(valid[nameField]);
    expect(stored[referenceField]).toBe('org-1');
    expect(stored.contactInformation).toEqual(valid.contactInformation);
  });

  it('returns 422 with details when a required field is missing', async () => {
    const coll = createCollectionMock();
    app.locals.db = createDbMock({ [collection]: coll, organizations: organizationsWith('org-1'), ...rbacCollectionsAdmin });

    const res = await request(app)
      .post(path)
      .set('Authorization', `Bearer ${makeToken('qa-1', 4)}`)
      .send({ ...valid, [nameField]: '' });

    expect(res.status).toBe(422);
    expect(res.body.details.join(' | ')).toContain(nameField);
    expect(coll.insertOne).not.toHaveBeenCalled();
  });

  it(`returns 404 when ${referenceField} names no organization, and stores nothing`, async () => {
    const coll = createCollectionMock();
    app.locals.db = createDbMock({ [collection]: coll, organizations: organizationsWith('org-1'), ...rbacCollectionsAdmin });

    const res = await request(app)
      .post(path)
      .set('Authorization', `Bearer ${makeToken('qa-1', 4)}`)
      .send({ ...valid, [referenceField]: 'org-missing' });

    expect(res.status).toBe(404);
    expect(res.body.error).toBe(`${referenceField} org-missing não encontrado`);
    expect(coll.insertOne).not.toHaveBeenCalled();
  });

  it('returns 403 for a Tecnico (accessType 2)', async () => {
    app.locals.db = createDbMock({ ...rbacCollectionsTechnician });

    const res = await request(app).post(path).set('Authorization', `Bearer ${makeToken('qa-2', 2)}`).send(valid);

    expect(res.status).toBe(403);
  });

  it(`updates ${nameField} alone without an organizations lookup`, async () => {
    const coll = createCollectionMock({
      findOne: vi.fn().mockResolvedValue({ ...valid }),
      findOneAndUpdate: vi.fn().mockResolvedValue({ [nameField]: 'Novo nome' }),
    });
    const organizations = organizationsWith('org-1');
    app.locals.db = createDbMock({ [collection]: coll, organizations, ...rbacCollectionsAdmin });

    const res = await request(app)
      .put(`${path}/record-1`)
      .set('Authorization', `Bearer ${makeToken('qa-1', 4)}`)
      .send({ [nameField]: 'Novo nome' });

    expect(res.status).toBe(200);
    expect(organizations.findOne).not.toHaveBeenCalled();
    expect(coll.findOneAndUpdate.mock.calls[0][1].$set[nameField]).toBe('Novo nome');
  });
});
