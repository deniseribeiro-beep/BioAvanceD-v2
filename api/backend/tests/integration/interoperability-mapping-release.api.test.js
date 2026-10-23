import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
const request = require('supertest');
const jwt = require('jsonwebtoken');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'vitest-secret-key';

const app = require('../../app');
const sessionService = require('../../src/services/session.service');
const { createCollectionMock, createDbMock } = require('../factories/db.factory');
const { buildRbacCollections } = require('../factories/rbac.factory');

// RF011 AC2, RULE-035 (#1322): InteroperabilityMappingRelease and
// FHIRProfileRegistry are mounted via createMasterDataRouter --
// master-data.api.test.js covers the shared router's own branches. These
// tests cover what is specific to these mounts: the models gate the POST, a
// release's namespaces and superseded release and a profile's release must
// be stored, the url/version key and mappingVersion are immutable on PUT, and
// a PUT sets no key outside the allowlist.

const RELEASES = '/api/interoperability-mapping-releases';
const PROFILES = '/api/fhir-profiles';
const DIGEST = `sha256:${'a'.repeat(64)}`;

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

const release = {
  standard: 'FHIR R4',
  mappingVersion: '1.0.0',
  mappingUri: 'https://id.bioadvanced.dev/mapping/1.0.0',
  checksum: DIGEST,
  authorId: 'user-1',
  status: 'approved',
  roundTripLossReportUri: 'https://id.bioadvanced.dev/mapping/1.0.0/losses',
  canonicalModelReleaseId: 'cmr-2.0.0',
  fhirVersion: '4.0.1',
  profileRegistryIds: ['prof-1'],
  resourceTypes: ['Patient'],
  identifierNamespaceRegistryIds: ['ns-1'],
  mappingDefinitionUri: 'https://id.bioadvanced.dev/mapping/1.0.0/definition',
  mappingDefinitionHash: DIGEST,
  conformanceTestReportUri: 'https://id.bioadvanced.dev/mapping/1.0.0/conformance',
  coverageNumerator: 9,
  coverageDenominator: 10,
  coverageRatio: 0.9,
  roundTripLossesPresent: false,
  approvedBy: ['user-2'],
  approvedAt: '2026-10-01T00:00:00.000Z',
  effectivePeriod: { start: '2026-10-01T00:00:00.000Z' },
};

const profile = {
  canonicalUrl: 'https://id.bioadvanced.dev/fhir/StructureDefinition/patient',
  fhirVersion: '4.0.1',
  profileVersion: '1.0.0',
  mappingReleaseId: 'rel-1',
  status: 'active',
};

// A collection whose findOne answers the first stored row matching every key
// of a plain filter; a filter with $or (the router's id query) answers `existing`.
function collectionWith(rows, { existing = null, ...overrides } = {}) {
  return createCollectionMock({
    findOne: vi.fn((filter = {}) => {
      if (filter.$or) return Promise.resolve(existing);
      return Promise.resolve(rows.find((row) => Object.entries(filter).every(([key, value]) => row[key] === value)) || null);
    }),
    ...overrides,
  });
}

const storedNamespaces = () => collectionWith([{ identifierNamespaceRegistryId: 'ns-1' }]);
const storedReleases = (options) => collectionWith([{ interoperabilityMappingReleaseId: 'rel-1' }], options);

const asAdmin = (req) => req.set('Authorization', `Bearer ${makeToken('qa-1', 4)}`);

describe('InteroperabilityMappingRelease mount (/api/interoperability-mapping-releases)', () => {
  it('returns 401 without token', async () => {
    const res = await request(app).get(RELEASES);
    expect(res.status).toBe(401);
  });

  it('creates a valid release whose namespaces and superseded release are stored', async () => {
    const releases = storedReleases();
    app.locals.db = createDbMock({
      interoperabilityMappingReleases: releases,
      identifierNamespaceRegistries: storedNamespaces(),
      ...rbacCollectionsAdmin,
    });

    const res = await asAdmin(request(app).post(RELEASES)).send({ ...release, mappingVersion: '1.1.0', supersedesReleaseId: 'rel-1' });

    expect(res.status).toBe(201);
    expect(releases.insertOne).toHaveBeenCalledTimes(1);
    const stored = releases.insertOne.mock.calls[0][0];
    expect(stored).toMatchObject({ mappingVersion: '1.1.0', status: 'approved', supersedesReleaseId: 'rel-1' });
    expect(typeof stored.interoperabilityMappingReleaseId).toBe('string');
  });

  it('returns 422 for an approved release with no approvedAt, and stores nothing', async () => {
    const releases = storedReleases();
    app.locals.db = createDbMock({
      interoperabilityMappingReleases: releases,
      identifierNamespaceRegistries: storedNamespaces(),
      ...rbacCollectionsAdmin,
    });

    const res = await asAdmin(request(app).post(RELEASES)).send({ ...release, approvedAt: undefined });

    expect(res.status).toBe(422);
    expect(res.body.details.join(' | ')).toMatch(/approvedAt é obrigatório quando status=approved \(RULE-035\)/);
    expect(releases.insertOne).not.toHaveBeenCalled();
  });

  it('returns 403 for a Tecnico (accessType 2)', async () => {
    app.locals.db = createDbMock({ ...rbacCollectionsTechnician });

    const res = await request(app).post(RELEASES).set('Authorization', `Bearer ${makeToken('qa-2', 2)}`).send(release);

    expect(res.status).toBe(403);
  });

  it('returns 404 for a release naming a namespace that is not stored, and stores nothing', async () => {
    const releases = storedReleases();
    app.locals.db = createDbMock({
      interoperabilityMappingReleases: releases,
      identifierNamespaceRegistries: storedNamespaces(),
      ...rbacCollectionsAdmin,
    });

    const res = await asAdmin(request(app).post(RELEASES)).send({ ...release, identifierNamespaceRegistryIds: ['ns-1', 'ns-9'] });

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('identifierNamespaceRegistryIds ns-9 não encontrado');
    expect(releases.insertOne).not.toHaveBeenCalled();
  });

  it('returns 404 for a release superseding a release that is not stored, and stores nothing', async () => {
    const releases = storedReleases();
    app.locals.db = createDbMock({
      interoperabilityMappingReleases: releases,
      identifierNamespaceRegistries: storedNamespaces(),
      ...rbacCollectionsAdmin,
    });

    const res = await asAdmin(request(app).post(RELEASES)).send({ ...release, supersedesReleaseId: 'rel-9' });

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('supersedesReleaseId rel-9 não encontrado');
    expect(releases.insertOne).not.toHaveBeenCalled();
  });

  it('returns 422 for a numeric supersedesReleaseId, and stores nothing', async () => {
    const releases = storedReleases();
    app.locals.db = createDbMock({
      interoperabilityMappingReleases: releases,
      identifierNamespaceRegistries: storedNamespaces(),
      ...rbacCollectionsAdmin,
    });

    const res = await asAdmin(request(app).post(RELEASES)).send({ ...release, supersedesReleaseId: 123 });

    expect(res.status).toBe(422);
    expect(res.body.error).toBe('supersedesReleaseId deve ser um texto não vazio para InteroperabilityMappingRelease');
    expect(releases.insertOne).not.toHaveBeenCalled();
  });

  it('returns 422 for a PUT that changes mappingVersion, and updates nothing', async () => {
    const releases = storedReleases({ existing: { interoperabilityMappingReleaseId: 'rel-1', ...release } });
    app.locals.db = createDbMock({ interoperabilityMappingReleases: releases, ...rbacCollectionsAdmin });

    const res = await asAdmin(request(app).put(`${RELEASES}/rel-1`)).send({ mappingVersion: '2.0.0' });

    expect(res.status).toBe(422);
    expect(res.body.message).toBe('mappingVersion não pode ser alterado por edição');
    expect(releases.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('a PUT of status sets only allowlisted keys', async () => {
    const existing = { interoperabilityMappingReleaseId: 'rel-1', ...release };
    const releases = storedReleases({
      existing,
      findOneAndUpdate: vi.fn().mockResolvedValue({ ...existing, status: 'active' }),
    });
    app.locals.db = createDbMock({ interoperabilityMappingReleases: releases, ...rbacCollectionsAdmin });

    const res = await asAdmin(request(app).put(`${RELEASES}/rel-1`))
      .send({ status: 'active', interoperabilityMappingReleaseId: 'rel-2', injected: 'x' });

    expect(res.status).toBe(200);
    const $set = releases.findOneAndUpdate.mock.calls[0][1].$set;
    expect(Object.keys($set).sort()).toEqual(['status', 'updatedAt']);
    expect($set.status).toBe('active');
  });
});

describe('FHIRProfileRegistry mount (/api/fhir-profiles)', () => {
  it('returns 401 without token', async () => {
    const res = await request(app).get(PROFILES);
    expect(res.status).toBe(401);
  });

  it('creates a valid profile whose mapping release is stored', async () => {
    const profiles = collectionWith([]);
    app.locals.db = createDbMock({
      fhirProfileRegistries: profiles,
      interoperabilityMappingReleases: storedReleases(),
      ...rbacCollectionsAdmin,
    });

    const res = await asAdmin(request(app).post(PROFILES)).send(profile);

    expect(res.status).toBe(201);
    expect(profiles.insertOne).toHaveBeenCalledTimes(1);
    const stored = profiles.insertOne.mock.calls[0][0];
    expect(stored).toMatchObject({ canonicalUrl: profile.canonicalUrl, profileVersion: '1.0.0', mappingReleaseId: 'rel-1', status: 'active' });
    expect(typeof stored.fhirProfileRegistryId).toBe('string');
  });

  it('returns 422 for a profile with fhirVersion 5.0.0, and stores nothing', async () => {
    const profiles = collectionWith([]);
    app.locals.db = createDbMock({
      fhirProfileRegistries: profiles,
      interoperabilityMappingReleases: storedReleases(),
      ...rbacCollectionsAdmin,
    });

    const res = await asAdmin(request(app).post(PROFILES)).send({ ...profile, fhirVersion: '5.0.0' });

    expect(res.status).toBe(422);
    expect(res.body.details).toContain('fhirVersion inválido: 5.0.0');
    expect(profiles.insertOne).not.toHaveBeenCalled();
  });

  it('returns 403 for a Tecnico (accessType 2)', async () => {
    app.locals.db = createDbMock({ ...rbacCollectionsTechnician });

    const res = await request(app).post(PROFILES).set('Authorization', `Bearer ${makeToken('qa-2', 2)}`).send(profile);

    expect(res.status).toBe(403);
  });

  it('returns 404 for a profile naming a mapping release that is not stored, and stores nothing', async () => {
    const profiles = collectionWith([]);
    app.locals.db = createDbMock({
      fhirProfileRegistries: profiles,
      interoperabilityMappingReleases: storedReleases(),
      ...rbacCollectionsAdmin,
    });

    const res = await asAdmin(request(app).post(PROFILES)).send({ ...profile, mappingReleaseId: 'rel-9' });

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('mappingReleaseId rel-9 não encontrado');
    expect(profiles.insertOne).not.toHaveBeenCalled();
  });

  it('returns 404 for a PUT that moves a profile to a mapping release that is not stored, and updates nothing', async () => {
    const profiles = collectionWith([], { existing: { fhirProfileRegistryId: 'prof-1', ...profile } });
    app.locals.db = createDbMock({
      fhirProfileRegistries: profiles,
      interoperabilityMappingReleases: storedReleases(),
      ...rbacCollectionsAdmin,
    });

    const res = await asAdmin(request(app).put(`${PROFILES}/prof-1`)).send({ mappingReleaseId: 'rel-9' });

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('mappingReleaseId rel-9 não encontrado');
    expect(profiles.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('returns 422 for a PUT that changes canonicalUrl, and updates nothing', async () => {
    const profiles = collectionWith([], { existing: { fhirProfileRegistryId: 'prof-1', ...profile } });
    app.locals.db = createDbMock({ fhirProfileRegistries: profiles, ...rbacCollectionsAdmin });

    const res = await asAdmin(request(app).put(`${PROFILES}/prof-1`))
      .send({ canonicalUrl: 'https://id.bioadvanced.dev/fhir/StructureDefinition/other' });

    expect(res.status).toBe(422);
    expect(res.body.message).toBe('canonicalUrl não pode ser alterado por edição');
    expect(profiles.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('a PUT of status sets only allowlisted keys', async () => {
    const existing = { fhirProfileRegistryId: 'prof-1', ...profile };
    const profiles = collectionWith([], {
      existing,
      findOneAndUpdate: vi.fn().mockResolvedValue({ ...existing, status: 'retired' }),
    });
    app.locals.db = createDbMock({ fhirProfileRegistries: profiles, ...rbacCollectionsAdmin });

    const res = await asAdmin(request(app).put(`${PROFILES}/prof-1`))
      .send({ status: 'retired', fhirProfileRegistryId: 'prof-2', profileVersion: '1.0.0', injected: 'x' });

    expect(res.status).toBe(200);
    const $set = profiles.findOneAndUpdate.mock.calls[0][1].$set;
    expect(Object.keys($set).sort()).toEqual(['status', 'updatedAt']);
    expect($set.status).toBe('retired');
  });
});
