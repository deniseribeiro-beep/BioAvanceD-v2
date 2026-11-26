import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
const request = require('supertest');
const jwt = require('jsonwebtoken');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'vitest-secret-key';

const app = require('../../app');
const sessionService = require('../../src/services/session.service');
const { createCollectionMock, createDbMock } = require('../factories/db.factory');
const { buildRbacCollections } = require('../factories/rbac.factory');

// RNF008 AC3 (#1496): ResearchResource, ResearchResourceCollection and
// ResearchResourceBiobank are mounted via createMasterDataRouter --
// master-data.api.test.js covers the shared router's own branches. These
// tests cover what is specific to these three mounts: each model's validate()
// gates the POST, and each link must name an existing ResearchResource and
// an existing Collection or Biobank.

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

// Answers a row only for its own key and value, so a lookup on the wrong key
// or value drives the not-found path.
function collectionWith(field, value) {
  return createCollectionMock({
    findOne: vi.fn(async (filter = {}) => (filter[field] === value ? { [field]: value } : null)),
  });
}

function referenceCollections() {
  return {
    researchResources: collectionWith('researchResourceId', 'rr-1'),
    collections: collectionWith('collectionId', 'col-1'),
    biobanks: collectionWith('biobankId', 'biobank-1'),
  };
}

const MOUNTS = [
  {
    entity: 'ResearchResource',
    path: '/api/research-resources',
    collection: 'researchResources',
    requiredField: 'name',
    valid: {
      name: 'Coorte Sintética',
      contactInformation: [{ email: 'contato@example.org' }],
      sexCategories: ['female'],
      sampleTypes: [{ coding: [{ code: 'blood' }] }],
    },
    stored: { name: 'Coorte Sintética', sexCategories: ['female'] },
    references: [],
  },
  {
    entity: 'ResearchResourceCollection',
    path: '/api/research-resource-collections',
    collection: 'researchResourceCollections',
    requiredField: 'collectionId',
    valid: { researchResourceId: 'rr-1', collectionId: 'col-1', effectivePeriod: { start: '2026-01-01T00:00:00Z' } },
    stored: { researchResourceId: 'rr-1', collectionId: 'col-1' },
    references: [['researchResourceId', 'researchResources'], ['collectionId', 'collections']],
  },
  {
    entity: 'ResearchResourceBiobank',
    path: '/api/research-resource-biobanks',
    collection: 'researchResourceBiobanks',
    requiredField: 'biobankId',
    valid: { researchResourceId: 'rr-1', biobankId: 'biobank-1', associationRole: 'holder' },
    stored: { researchResourceId: 'rr-1', biobankId: 'biobank-1' },
    references: [['researchResourceId', 'researchResources'], ['biobankId', 'biobanks']],
  },
];

describe.each(MOUNTS)('$entity mount ($path)', ({ entity, path, collection, requiredField, valid, stored, references }) => {
  it(`creates a valid ${entity} with 201 and stores its fields`, async () => {
    const coll = createCollectionMock({ insertOne: vi.fn().mockResolvedValue({ insertedId: '507f1f77bcf86cd799439011' }) });
    const refs = referenceCollections();
    app.locals.db = createDbMock({ ...refs, [collection]: coll,...rbacCollectionsAdmin });

    const res = await request(app).post(path).set('Authorization', `Bearer ${makeToken('qa-1', 4)}`).send(valid);

    expect(res.status).toBe(201);
    expect(coll.insertOne).toHaveBeenCalledTimes(1);
    expect(coll.insertOne.mock.calls[0][0]).toMatchObject(stored);
  });

  it(`returns 422 naming ${requiredField} when it is missing, and stores nothing`, async () => {
    const coll = createCollectionMock();
    app.locals.db = createDbMock({ ...referenceCollections(), [collection]: coll,...rbacCollectionsAdmin });

    const body = { ...valid };
    delete body[requiredField];
    const res = await request(app).post(path).set('Authorization', `Bearer ${makeToken('qa-1', 4)}`).send(body);

    expect(res.status).toBe(422);
    expect(res.body.details.join(' | ')).toContain(`${requiredField} é obrigatório para ${entity}`);
    expect(coll.insertOne).not.toHaveBeenCalled();
  });

  it.each(references)('returns 404 when %s resolves to nothing, and stores nothing', async (field) => {
    const coll = createCollectionMock();
    app.locals.db = createDbMock({ ...referenceCollections(), [collection]: coll,...rbacCollectionsAdmin });

    const res = await request(app)
      .post(path)
      .set('Authorization', `Bearer ${makeToken('qa-1', 4)}`)
      .send({ ...valid, [field]: 'missing-1' });

    expect(res.status).toBe(404);
    expect(res.body.error).toBe(`${field} missing-1 não encontrado`);
    expect(coll.insertOne).not.toHaveBeenCalled();
  });

  it('returns 403 for a Tecnico (accessType 2), and stores nothing', async () => {
    const coll = createCollectionMock();
    app.locals.db = createDbMock({ ...referenceCollections(), [collection]: coll,...rbacCollectionsTechnician });

    const res = await request(app).post(path).set('Authorization', `Bearer ${makeToken('qa-2', 2)}`).send(valid);

    expect(res.status).toBe(403);
    expect(coll.insertOne).not.toHaveBeenCalled();
  });
});
