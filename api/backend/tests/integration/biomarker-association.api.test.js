import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
const request = require('supertest');
const jwt = require('jsonwebtoken');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'vitest-secret-key';

const app = require('../../app');
const sessionService = require('../../src/services/session.service');
const { createCollectionMock, createDbMock } = require('../factories/db.factory');
const { buildRbacCollections } = require('../factories/rbac.factory');

// ELM-0275..0285 (#1206): BiomarkerAssociation is mounted via
// createMasterDataRouter -- master-data.api.test.js covers the shared
// router's own branches. These tests cover what is specific to this mount:
// the model gates the POST, and a PUT cannot empty a required list, blank a
// required field or store an unnormalised biomarkerRole.

const PATH = '/api/biomarker-associations';

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
  analyte: { systemUri: 'http://www.genenames.org', code: 'HGNC:1100', display: 'BRCA1' },
  associatedCondition: [{ systemUri: 'http://www.orpha.net', code: 'ORPHA:145' }],
  biomarkerRole: 'risk',
  contextOfUse: 'Avaliação de risco hereditário.',
  evidenceReferences: [{ system: 'PMID', value: '12345678' }],
};

const post = (body) => request(app).post(PATH).set('Authorization', `Bearer ${makeToken('qa-1', 4)}`).send(body);
const put = (body) => request(app).put(`${PATH}/bm-1`).set('Authorization', `Bearer ${makeToken('qa-1', 4)}`).send(body);

function associations(overrides = {}) {
  return createCollectionMock({
    findOne: vi.fn().mockResolvedValue({ biomarkerId: 'bm-1', ...valid }),
    findOneAndUpdate: vi.fn().mockResolvedValue({ biomarkerId: 'bm-1', ...valid }),
    ...overrides,
  });
}

describe('BiomarkerAssociation mount (/api/biomarker-associations)', () => {
  it('returns 401 without token', async () => {
    const res = await request(app).get(PATH);
    expect(res.status).toBe(401);
  });

  it('returns 403 for a Tecnico (accessType 2)', async () => {
    app.locals.db = createDbMock({ ...rbacCollectionsTechnician });

    const res = await request(app).post(PATH).set('Authorization', `Bearer ${makeToken('qa-2', 2)}`).send(valid);

    expect(res.status).toBe(403);
  });

  it('creates a valid association carrying all 11 fields', async () => {
    const coll = associations({ insertOne: vi.fn().mockResolvedValue({ insertedId: '507f1f77bcf86cd799439011' }) });
    app.locals.db = createDbMock({ biomarkerAssociations: coll, ...rbacCollectionsAdmin });

    const res = await post(valid);

    expect(res.status).toBe(201);
    expect(coll.insertOne).toHaveBeenCalledTimes(1);
    const stored = coll.insertOne.mock.calls[0][0];
    for (const field of [
      'biomarkerId', 'analyte', 'associatedCondition', 'biospecimenMatrix', 'biomarkerRole', 'contextOfUse',
      'assayMethod', 'cutoff', 'evidenceLevel', 'regulatoryStatus', 'evidenceReferences',
    ]) {
      expect(stored).toHaveProperty(field);
    }
    expect(stored).toMatchObject({ biomarkerRole: 'risk', evidenceReferences: valid.evidenceReferences });
    expect(typeof stored.biomarkerId).toBe('string');
  });

  // #1402: the uniq_biomarkerId index refuses a second row with E11000.
  it('answers 409 when the store refuses a duplicate biomarkerId (#1402)', async () => {
    const duplicate = Object.assign(
      new Error('E11000 duplicate key error collection: biomarkerAssociations index: uniq_biomarkerId'),
      { code: 11000 }
    );
    const coll = associations({ insertOne: vi.fn().mockRejectedValue(duplicate) });
    app.locals.db = createDbMock({ biomarkerAssociations: coll, ...rbacCollectionsAdmin });

    const res = await post({ biomarkerId: 'bm-1', ...valid });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('Registro duplicado');
  });

  it('still answers 500 when the insert fails without a duplicate-key code (#1402)', async () => {
    const coll = associations({ insertOne: vi.fn().mockRejectedValue(new Error('boom')) });
    app.locals.db = createDbMock({ biomarkerAssociations: coll, ...rbacCollectionsAdmin });

    const res = await post({ biomarkerId: 'bm-1', ...valid });

    expect(res.status).toBe(500);
  });

  it('returns 422 for a POST without evidenceReferences, and stores nothing', async () => {
    const coll = associations();
    app.locals.db = createDbMock({ biomarkerAssociations: coll, ...rbacCollectionsAdmin });

    const res = await post({ ...valid, evidenceReferences: undefined });

    expect(res.status).toBe(422);
    expect(res.body.details.join(' | ')).toMatch(/evidenceReferences/);
    expect(coll.insertOne).not.toHaveBeenCalled();
  });

  it('returns 422 for a PUT that empties evidenceReferences, and updates nothing', async () => {
    const coll = associations();
    app.locals.db = createDbMock({ biomarkerAssociations: coll, ...rbacCollectionsAdmin });

    const res = await put({ evidenceReferences: [] });

    expect(res.status).toBe(422);
    expect(res.body.error).toBe('Payload inválido');
    expect(res.body.details.join(' | ')).toMatch(/evidenceReferences é obrigatório/);
    expect(coll.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('returns 422 for a POST whose evidence system is an array, and stores nothing', async () => {
    const coll = associations();
    app.locals.db = createDbMock({ biomarkerAssociations: coll, ...rbacCollectionsAdmin });

    const res = await post({ ...valid, evidenceReferences: [{ system: ['DOI'], value: '10.1234/a' }] });

    expect(res.status).toBe(422);
    expect(res.body.details.join(' | ')).toMatch(/evidenceReferences.*DOI\|PMID/);
    expect(coll.insertOne).not.toHaveBeenCalled();
  });

  it('returns 422 for a PUT whose evidence system is an array, and updates nothing', async () => {
    const coll = associations();
    app.locals.db = createDbMock({ biomarkerAssociations: coll, ...rbacCollectionsAdmin });

    const res = await put({ evidenceReferences: [{ system: ['DOI'], value: '10.1234/a' }] });

    expect(res.status).toBe(422);
    expect(res.body.error).toBe('Payload inválido');
    expect(res.body.details.join(' | ')).toMatch(/evidenceReferences.*DOI\|PMID/);
    expect(coll.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('returns 422 for a PUT that empties associatedCondition, and updates nothing', async () => {
    const coll = associations();
    app.locals.db = createDbMock({ biomarkerAssociations: coll, ...rbacCollectionsAdmin });

    const res = await put({ associatedCondition: [] });

    expect(res.status).toBe(422);
    expect(res.body.error).toBe('Payload inválido');
    expect(res.body.details.join(' | ')).toMatch(/associatedCondition é obrigatório/);
    expect(coll.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('a PUT of contextOfUse alone answers 200', async () => {
    const coll = associations();
    app.locals.db = createDbMock({ biomarkerAssociations: coll, ...rbacCollectionsAdmin });

    const res = await put({ contextOfUse: 'novo' });

    expect(res.status).toBe(200);
    expect(coll.findOneAndUpdate.mock.calls[0][1].$set.contextOfUse).toBe('novo');
  });

  it('a PUT of biomarkerRole " Diagnostic " stores diagnostic', async () => {
    const coll = associations();
    app.locals.db = createDbMock({ biomarkerAssociations: coll, ...rbacCollectionsAdmin });

    const res = await put({ biomarkerRole: ' Diagnostic ' });

    expect(res.status).toBe(200);
    expect(coll.findOneAndUpdate.mock.calls[0][1].$set.biomarkerRole).toBe('diagnostic');
  });
});
