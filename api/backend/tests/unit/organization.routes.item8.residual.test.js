import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';
import express from 'express';
import request from 'supertest';

const require = createRequire(import.meta.url);

const authPath = require.resolve('../../src/infrastructure/middleware/auth');
const rbacPath = require.resolve('../../src/infrastructure/middleware/rbac');
const collectionResolverPath = require.resolve('../../src/utils/collectionResolver');
const routePath = require.resolve('../../src/interface/routes/organization.routes.js');

const authModule = require(authPath);
const rbacModule = require(rbacPath);
const collectionResolverModule = require(collectionResolverPath);

const originalAuthenticate = authModule.authenticate;
const originalRequirePermission = rbacModule.requirePermission;
const originalGetCollection = collectionResolverModule.getCollection;

let currentGetCollection;

authModule.authenticate = (req, res, next) => {
  req.user = { userID: 'operator-1' };
  next();
};
rbacModule.requirePermission = () => (req, res, next) => next();
collectionResolverModule.getCollection = (...args) => currentGetCollection(...args);

delete require.cache[routePath];
const router = require(routePath);

function buildApp(db) {
  const app = express();
  app.use(express.json());
  app.locals.db = db;
  app.use('/api/organizations', router);
  return app;
}

function makeCursor(items) {
  const cursor = {
    sort: vi.fn(() => cursor),
    limit: vi.fn(() => cursor),
    toArray: vi.fn().mockResolvedValue(items),
  };
  return cursor;
}

function validPayload(overrides = {}) {
  return {
    officialName: 'Hospital BioAvanceD',
    countryCode: 'BR',
    ...overrides,
  };
}

function makeCollection(overrides = {}) {
  const cursor = makeCursor([]);
  return {
    createIndex: vi.fn().mockResolvedValue('idx'),
    find: vi.fn(() => cursor),
    findOne: vi.fn().mockResolvedValue(null),
    insertOne: vi.fn().mockResolvedValue({ insertedId: '507f1f77bcf86cd799439011' }),
    findOneAndUpdate: vi.fn().mockResolvedValue(null),
    deleteOne: vi.fn().mockResolvedValue({ deletedCount: 0 }),
    cursor,
    ...overrides,
  };
}

beforeEach(() => {
  currentGetCollection = vi.fn();
});

afterAll(() => {
  authModule.authenticate = originalAuthenticate;
  rbacModule.requirePermission = originalRequirePermission;
  collectionResolverModule.getCollection = originalGetCollection;
  delete require.cache[routePath];
});

describe('organization.routes item 8 residual branches', () => {
  it('covers list db-unavailable, capped-limit success, index failure tolerance and list failure', async () => {
    const noDb = await request(buildApp(undefined)).get('/api/organizations');
    expect(noDb.status).toBe(503);

    const collection = makeCollection();
    collection.createIndex
      .mockRejectedValueOnce(new Error('index already racing'))
      .mockResolvedValueOnce('organizations_normalized_name_uq');
    collection.cursor.toArray.mockResolvedValueOnce([{ organizationId: 'org-1' }]);
    currentGetCollection = vi.fn().mockResolvedValue(collection);

    const ok = await request(buildApp({})).get('/api/organizations?limit=999');
    expect(ok.status).toBe(200);
    expect(ok.body.data).toEqual([{ organizationId: 'org-1' }]);
    expect(collection.cursor.limit).toHaveBeenCalledWith(500);
    expect(collection.createIndex).toHaveBeenCalledTimes(2);

    collection.cursor.toArray.mockRejectedValueOnce(new Error('mongo unavailable'));
    const failed = await request(buildApp({})).get('/api/organizations?limit=0');
    expect(failed.status).toBe(500);
    expect(failed.body).toMatchObject({
      success: false,
      error: 'Erro ao listar organizações',
      message: 'mongo unavailable',
    });
  });

  it('covers get-by-id ObjectId and organizationId query variants, success, not-found and failure', async () => {
    const collection = makeCollection();
    currentGetCollection = vi.fn().mockResolvedValue(collection);

    collection.findOne.mockResolvedValueOnce({ organizationId: 'org-1', officialName: 'Hospital A' });
    const byObjectId = await request(buildApp({})).get('/api/organizations/507f1f77bcf86cd799439011');
    expect(byObjectId.status).toBe(200);
    expect(collection.findOne.mock.calls[0][0].$or).toHaveLength(2);

    collection.findOne.mockResolvedValueOnce(null);
    const missing = await request(buildApp({})).get('/api/organizations/org-missing');
    expect(missing.status).toBe(404);
    expect(collection.findOne.mock.calls[1][0]).toEqual({
      $or: [{ organizationId: 'org-missing' }],
    });

    collection.findOne.mockRejectedValueOnce(new Error('read failed'));
    const failed = await request(buildApp({})).get('/api/organizations/org-error');
    expect(failed.status).toBe(500);
    expect(failed.body.message).toBe('read failed');
  });

  it('covers create validation, db guard, existing record and canonical creation defaults', async () => {
    const invalid = await request(buildApp({}))
      .post('/api/organizations')
      .send({ officialName: 'X', countryCode: 'BRA' });
    expect(invalid.status).toBe(422);

    const noDb = await request(buildApp(undefined))
      .post('/api/organizations')
      .send(validPayload());
    expect(noDb.status).toBe(503);

    const existing = { organizationId: 'org-existing', officialName: 'Hospital BioAvanceD' };
    const collection = makeCollection();
    currentGetCollection = vi.fn().mockResolvedValue(collection);
    collection.findOne.mockResolvedValueOnce(existing);

    const duplicate = await request(buildApp({}))
      .post('/api/organizations')
      .send(validPayload());
    expect(duplicate.status).toBe(200);
    expect(duplicate.body.message).toBe('Organização já existente');

    collection.findOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        organizationId: 'org-new',
        officialName: 'Hospital BioAvanceD',
        acronym: null,
        organizationType: null,
        countryCode: 'BR',
        website: null,
        contact: null,
        qualityStandards: [],
      });

    const created = await request(buildApp({}))
      .post('/api/organizations')
      .send(validPayload());
    expect(created.status).toBe(201);
    expect(collection.insertOne).toHaveBeenCalledWith(expect.objectContaining({
      officialName: 'Hospital BioAvanceD',
      normalizedName: 'HOSPITAL BIOAVANCED',
      acronym: null,
      organizationType: null,
      countryCode: 'BR',
      website: null,
      contact: null,
      qualityStandards: [],
    }));
  });

  it('covers duplicate-key create recovery with and without a recoverable existing record', async () => {
    const existing = { organizationId: 'org-existing', officialName: 'Hospital BioAvanceD' };
    const collection = makeCollection({
      insertOne: vi.fn().mockRejectedValue(Object.assign(new Error('duplicate'), { code: 11000 })),
    });
    currentGetCollection = vi.fn().mockResolvedValue(collection);

    collection.findOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(existing);
    const recovered = await request(buildApp({}))
      .post('/api/organizations')
      .send(validPayload());
    expect(recovered.status).toBe(200);
    expect(recovered.body.data).toEqual(existing);

    collection.findOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    const unrecovered = await request(buildApp({}))
      .post('/api/organizations')
      .send(validPayload());
    expect(unrecovered.status).toBe(500);
    expect(unrecovered.body.message).toBe('duplicate');
  });

  it('covers update db guard, missing record, invalid payload, defaults, success and both error classes', async () => {
    const noDb = await request(buildApp(undefined))
      .put('/api/organizations/org-1')
      .send({ officialName: 'Hospital A' });
    expect(noDb.status).toBe(503);

    const collection = makeCollection();
    currentGetCollection = vi.fn().mockResolvedValue(collection);

    collection.findOne.mockResolvedValueOnce(null);
    const missing = await request(buildApp({}))
      .put('/api/organizations/org-missing')
      .send(validPayload());
    expect(missing.status).toBe(404);

    const existing = {
      organizationId: 'org-1',
      officialName: 'Hospital Original',
      acronym: 'HO',
      organizationType: 'hospital',
      countryCode: 'BR',
      website: 'https://hospital.example.test',
      contact: { email: 'contact@example.test' },
      qualityStandards: ['ISO 20387'],
    };
    collection.findOne.mockResolvedValueOnce(existing);
    const invalid = await request(buildApp({}))
      .put('/api/organizations/org-1')
      .send({ countryCode: 'BRA' });
    expect(invalid.status).toBe(422);

    collection.findOne.mockResolvedValueOnce(existing);
    collection.findOneAndUpdate.mockResolvedValueOnce({
      ...existing,
      officialName: 'Hospital Atualizado',
      normalizedName: 'HOSPITAL ATUALIZADO',
      acronym: null,
      website: null,
      contact: null,
      qualityStandards: [],
    });
    const updated = await request(buildApp({}))
      .put('/api/organizations/org-1')
      .send({
        officialName: '  Hospital   Atualizado  ',
        acronym: '',
        website: '',
        contact: null,
        qualityStandards: null,
      });
    expect(updated.status).toBe(200);
    expect(collection.findOneAndUpdate).toHaveBeenCalledWith(
      expect.any(Object),
      { $set: expect.objectContaining({
        officialName: 'Hospital Atualizado',
        normalizedName: 'HOSPITAL ATUALIZADO',
        acronym: null,
        organizationType: 'hospital',
        countryCode: 'BR',
        website: null,
        contact: null,
        qualityStandards: [],
      }) },
      { returnDocument: 'after' }
    );

    collection.findOne.mockResolvedValueOnce(existing);
    collection.findOneAndUpdate.mockResolvedValueOnce(null);
    const disappeared = await request(buildApp({}))
      .put('/api/organizations/org-1')
      .send({});
    expect(disappeared.status).toBe(404);

    collection.findOne.mockResolvedValueOnce(existing);
    collection.findOneAndUpdate.mockRejectedValueOnce(Object.assign(new Error('duplicate'), { code: 11000 }));
    const duplicate = await request(buildApp({}))
      .put('/api/organizations/org-1')
      .send({});
    expect(duplicate.status).toBe(409);

    collection.findOne.mockRejectedValueOnce(new Error('update read failed'));
    const failed = await request(buildApp({}))
      .put('/api/organizations/org-1')
      .send({});
    expect(failed.status).toBe(500);
    expect(failed.body.message).toBe('update read failed');
  });

  it('covers delete db guard, missing/deleted variants, success and failure', async () => {
    const noDb = await request(buildApp(undefined)).delete('/api/organizations/org-1');
    expect(noDb.status).toBe(503);

    const collection = makeCollection();
    currentGetCollection = vi.fn().mockResolvedValue(collection);

    collection.deleteOne.mockResolvedValueOnce(null);
    const nullResult = await request(buildApp({})).delete('/api/organizations/org-1');
    expect(nullResult.status).toBe(404);

    collection.deleteOne.mockResolvedValueOnce({ deletedCount: 0 });
    const missing = await request(buildApp({})).delete('/api/organizations/org-1');
    expect(missing.status).toBe(404);

    collection.deleteOne.mockResolvedValueOnce({ deletedCount: 1 });
    const deleted = await request(buildApp({})).delete('/api/organizations/org-1');
    expect(deleted.status).toBe(200);
    expect(deleted.body.message).toBe('Organização removida');

    collection.deleteOne.mockRejectedValueOnce(new Error('delete failed'));
    const failed = await request(buildApp({})).delete('/api/organizations/org-1');
    expect(failed.status).toBe(500);
    expect(failed.body.message).toBe('delete failed');
  });
});
