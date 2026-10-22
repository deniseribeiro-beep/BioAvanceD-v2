import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
const request = require('supertest');
const jwt = require('jsonwebtoken');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'vitest-secret-key';

const app = require('../../app');
const sessionService = require('../../src/services/session.service');
const { createCollectionMock, createDbMock } = require('../factories/db.factory');
const { buildRbacCollections } = require('../factories/rbac.factory');

// RF020 AC5-AC7 (#1322): GET /api/biobanks/miabis/export reads every stored
// Biobank and Collection and answers the MIABIS export, its national
// extensions and its round-trip loss report. miabisExport.service.test.js
// covers the mapping itself; these tests cover the route.

const PATH = '/api/biobanks/miabis/export';

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

function storedRecords() {
  const biobanks = createCollectionMock({
    find: vi.fn(() => ({
      toArray: vi.fn().mockResolvedValue([{
        _id: 'm-1',
        biobankId: 'bb-1',
        biobankName: 'Biobanco Sintético',
        legalEntityId: 'org-1',
        countryCode: 'BR',
        biobankStatus: 'active',
      }]),
    })),
  });
  const collections = createCollectionMock({
    find: vi.fn(() => ({
      toArray: vi.fn().mockResolvedValue([{
        _id: 'm-2',
        collectionId: 'col-1',
        collectionName: 'Coleção',
        governanceRegime: 'biorepository',
      }]),
    })),
  });
  return { biobanks, collections };
}

beforeEach(() => { givenSession(); });
afterEach(() => { vi.restoreAllMocks(); });

describe(`GET ${PATH}`, () => {
  it('returns 401 without token', async () => {
    const res = await request(app).get(PATH);
    expect(res.status).toBe(401);
  });

  it('returns 403 for a Tecnico (accessType 2)', async () => {
    const { biobanks, collections } = storedRecords();
    app.locals.db = createDbMock({ biobanks, collections, ...rbacCollectionsTechnician });

    const res = await request(app).get(PATH).set('Authorization', `Bearer ${makeToken('qa-2', 2)}`);

    expect(res.status).toBe(403);
    expect(biobanks.find).not.toHaveBeenCalled();
  });

  it('answers the export of the stored biobanks and collections to an admin', async () => {
    const { biobanks, collections } = storedRecords();
    app.locals.db = createDbMock({ biobanks, collections, ...rbacCollectionsAdmin });

    const res = await request(app).get(PATH).set('Authorization', `Bearer ${makeToken('qa-1', 4)}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const { data } = res.body;
    expect(biobanks.find).toHaveBeenCalledWith({});
    expect(collections.find).toHaveBeenCalledWith({});
    expect(data.standard).toBe('MIABIS');
    expect(data.conformanceClaimed).toBe(false);
    expect(typeof data.generatedAt).toBe('string');
    expect(data.biobanks[0].miabis).toMatchObject({ id: 'bb-1', name: 'Biobanco Sintético', juristicPerson: 'org-1', country: 'BR' });
    expect(data.collections[0].miabis).toMatchObject({ id: 'col-1', name: 'Coleção' });
    expect(data.collections[0].nationalExtensions).toEqual({ governanceRegime: 'biorepository' });
    expect(data.roundTripLoss.dropped).toEqual([{ entity: 'Biobank', id: 'bb-1', field: 'biobankStatus' }]);
  });

  it('answers 500 when a read fails', async () => {
    const { collections } = storedRecords();
    const biobanks = createCollectionMock({
      find: vi.fn(() => ({ toArray: vi.fn().mockRejectedValue(new Error('mongo down')) })),
    });
    app.locals.db = createDbMock({ biobanks, collections, ...rbacCollectionsAdmin });

    const res = await request(app).get(PATH).set('Authorization', `Bearer ${makeToken('qa-1', 4)}`);

    expect(res.status).toBe(500);
    expect(res.body).toMatchObject({ success: false, error: 'Erro ao exportar MIABIS', message: 'mongo down' });
  });

  it('writes nothing to biobanks or collections', async () => {
    const { biobanks, collections } = storedRecords();
    app.locals.db = createDbMock({ biobanks, collections, ...rbacCollectionsAdmin });

    const res = await request(app).get(PATH).set('Authorization', `Bearer ${makeToken('qa-1', 4)}`);

    expect(res.status).toBe(200);
    for (const coll of [biobanks, collections]) {
      expect(coll.insertOne).not.toHaveBeenCalled();
      expect(coll.updateOne).not.toHaveBeenCalled();
      expect(coll.deleteOne).not.toHaveBeenCalled();
    }
  });
});
