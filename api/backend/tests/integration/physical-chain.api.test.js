import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
const request = require('supertest');
const jwt = require('jsonwebtoken');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'vitest-secret-key';

const app = require('../../app');
const sessionService = require('../../src/services/session.service');
const auditLogger = require('../../src/utils/auditLogger');
const { createDbMock } = require('../factories/db.factory');
const { buildRbacCollections } = require('../factories/rbac.factory');

// #1314, #1316: the physical-chain and custody routes against the real app
// and RBAC middleware. The domain collections are query-matching fakes, so
// the overlap checks and the chain walk read what a real query returns.

function matches(doc, filter) {
  return Object.entries(filter).every(([key, value]) => {
    if (key === '$or') return value.some((branch) => matches(doc, branch));
    return doc[key] === value;
  });
}

function fakeCollection() {
  const docs = [];
  return {
    docs,
    createIndex: async () => undefined,
    insertOne: async (doc) => { docs.push(structuredClone(doc)); return { insertedId: docs.length }; },
    findOne: async (filter) => docs.find((doc) => matches(doc, filter)) || null,
    find: (filter = {}) => ({ toArray: async () => docs.filter((doc) => matches(doc, filter)) }),
    updateOne: async (filter, update) => {
      const doc = docs.find((row) => matches(row, filter));
      if (doc) {
        for (const [key, value] of Object.entries(update.$set)) {
          const path = key.split('.');
          const last = path.pop();
          path.reduce((node, part) => node[part], doc)[last] = value;
        }
      }
      return { matchedCount: doc ? 1 : 0 };
    },
  };
}

const DOMAIN = [
  'samples', 'collections', 'organizations', 'collectionGovernanceApprovals', 'custodianshipAssignments',
  'containers', 'specimenContainerAssignments', 'containerPositionAssignments', 'rackLocationAssignments',
  'labelIdentifiers', 'scanEvents',
];

// Users: Coordenador and Técnico in org-A, the same pair in org-B, and an
// Administrador (global).
const USERS = [
  { userAccountId: 'coord-a', accessType: 3, organizationId: 'org-A' },
  { userAccountId: 'tech-a', accessType: 2, organizationId: 'org-A' },
  { userAccountId: 'coord-b', accessType: 3, organizationId: 'org-B' },
  { userAccountId: 'tech-b', accessType: 2, organizationId: 'org-B' },
  { userAccountId: 'admin', accessType: 4 },
];

function token(userId) {
  const { accessType } = USERS.find((u) => u.userAccountId === userId);
  return `Bearer ${jwt.sign({ userID: userId, accessType, name: userId, mfaVerified: true }, process.env.JWT_SECRET, { expiresIn: '1h' })}`;
}

let domain;

beforeEach(async () => {
  vi.spyOn(sessionService, 'verifySession').mockResolvedValue({ valid: true, session: { sessionID: 'sess-chain' } });
  vi.spyOn(sessionService, 'updateActivity').mockResolvedValue({ sessionID: 'sess-chain' });
  vi.spyOn(auditLogger, 'init').mockImplementation(() => undefined);
  vi.spyOn(auditLogger, 'log').mockResolvedValue(undefined);

  domain = Object.fromEntries(DOMAIN.map((name) => [name, fakeCollection()]));
  await domain.samples.insertOne({ specimenId: 'SPC-1', collectionId: 'COL-1', collectionSite: 'org-A' });
  await domain.collections.insertOne({ collectionId: 'COL-1', governanceRegime: 'biobank', governanceContext: {} });
  await domain.organizations.insertOne({ organizationId: 'org-A' });
  await domain.organizations.insertOne({ organizationId: 'org-B' });
  await domain.collectionGovernanceApprovals.insertOne({ approvalId: 'appr-1', collectionId: 'COL-1', status: 'active', effectivePeriod: { start: '2025-01-01T00:00:00Z', end: null } });
  app.locals.db = createDbMock({ ...domain, ...buildRbacCollections(USERS) });
});

afterEach(() => { vi.restoreAllMocks(); });

const post = (path, user, body = {}) => request(app).post(`/api/physical-chain${path}`).set('Authorization', token(user)).send(body);
const get = (path, user) => request(app).get(`/api/physical-chain${path}`).set('Authorization', token(user));
const custody = (over = {}) => ({ specimenId: 'SPC-1', custodianOrganizationId: 'org-A', authorizationId: 'appr-1', effectivePeriod: { start: '2026-01-01T00:00:00Z' }, ...over });

async function withCustodyAndContainer() {
  expect((await post('/custody', 'coord-a', custody())).status).toBe(201);
  expect((await post('/containers', 'coord-a', { containerId: 'CT-1', containerType: 'cryovial' })).status).toBe(201);
}

describe('custody routes (#1316, RF021 AC4-AC6)', () => {
  it('lets the collection site assign the first custody, and audits it', async () => {
    const res = await post('/custody', 'coord-a', custody());
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ specimenId: 'SPC-1', custodianOrganizationId: 'org-A', assignmentStatus: 'active' });
    expect(auditLogger.log).toHaveBeenCalledWith(expect.objectContaining({ resourceType: 'CustodianshipAssignment', action: 'CREATE' }));
  });

  it("refuses another organization's specimen, a custodian outside the caller's scope, and a Técnico", async () => {
    expect((await post('/custody', 'coord-b', custody({ custodianOrganizationId: 'org-B' }))).body.error).toBe('SPECIMEN_OUT_OF_SCOPE');
    expect((await post('/custody', 'coord-a', custody({ custodianOrganizationId: 'org-B' }))).body.error).toBe('CUSTODIAN_OUT_OF_SCOPE');
    expect((await post('/custody', 'tech-a', custody())).status).toBe(403);
    expect(domain.custodianshipAssignments.docs).toHaveLength(0);
  });

  it('hands custody over: the holder ends it, then the next holder is assigned by the old one', async () => {
    const first = (await post('/custody', 'coord-a', custody())).body.data;
    expect((await post(`/custody/${first.custodianshipAssignmentId}/end`, 'coord-b', { endAt: '2026-03-01T00:00:00Z' })).status).toBe(403);
    expect((await post(`/custody/${first.custodianshipAssignmentId}/end`, 'coord-a', { endAt: '2026-03-01T00:00:00Z' })).status).toBe(200);
    // Admin assigns org-B (the specimen now has no custody after 2026-03-01).
    expect((await post('/custody', 'admin', custody({ custodianOrganizationId: 'org-B', effectivePeriod: { start: '2026-03-01T00:00:00Z' } }))).status).toBe(201);
    expect((await get('/specimens/SPC-1/custody?at=2026-02-01T00:00:00Z', 'tech-a')).body.data.custodianOrganizationId).toBe('org-A');
    expect((await get('/specimens/SPC-1/custody', 'tech-a')).status).toBe(403);
    expect((await get('/specimens/SPC-1/custody', 'tech-b')).body.data.custodianOrganizationId).toBe('org-B');
  });

  it('answers a service validation failure with 422 and a details list (RNF018)', async () => {
    const res = await post('/custody', 'coord-a', custody({ authorizationId: '' }));
    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ error: 'VALIDATION_ERROR', details: [expect.stringContaining('authorizationId')] });
  });

  it('refuses an overlapping custody with 409 (AC5)', async () => {
    await post('/custody', 'coord-a', custody());
    expect((await post('/custody', 'admin', custody({ custodianOrganizationId: 'org-B' }))).status).toBe(409);
  });

  it('rejects an unparseable instant with 400', async () => {
    await post('/custody', 'coord-a', custody());
    expect((await get('/specimens/SPC-1/custody?at=yesterday', 'tech-a')).status).toBe(400);
  });
});

describe('physical-chain routes (#1314, RF016 AC3/AC6, RF017 AC3/AC4)', () => {
  it('loads a specimen only for its custodian, and only under an approval in force (RF021 AC6)', async () => {
    expect((await post('/containers', 'coord-a', { containerId: 'CT-1', containerType: 'cryovial' })).status).toBe(201);
    // No custody yet: no organization's scope holds the specimen.
    expect((await post('/containers/CT-1/specimens', 'tech-a', { specimenId: 'SPC-1' })).body.error).toBe('SPECIMEN_OUT_OF_SCOPE');
    await post('/custody', 'coord-a', custody());
    expect((await post('/containers/CT-1/specimens', 'tech-b', { specimenId: 'SPC-1' })).status).toBe(403);
    await domain.collectionGovernanceApprovals.updateOne({ approvalId: 'appr-1' }, { $set: { status: 'suspended' } });
    const inactive = await post('/containers/CT-1/specimens', 'tech-a', { specimenId: 'SPC-1' });
    expect(inactive.status).toBe(422);
    expect(inactive.body).toMatchObject({ error: 'CUSTODY_INACTIVE', details: [expect.stringContaining('não está vigente')] });
    await domain.collectionGovernanceApprovals.updateOne({ approvalId: 'appr-1' }, { $set: { status: 'active' } });
    const res = await post('/containers/CT-1/specimens', 'tech-a', { specimenId: 'SPC-1' });
    expect(res.status).toBe(201);
    expect(res.body.data.sourceEventId).toEqual(expect.any(String));
    expect(domain.containers.docs[0].emptyStatus).toBe('occupied');
  });

  it('refuses a Técnico creating a container, and a second container for one specimen (409)', async () => {
    expect((await post('/containers', 'tech-a', { containerId: 'CT-X', containerType: 'cryovial' })).status).toBe(403);
    await withCustodyAndContainer();
    await post('/containers', 'coord-a', { containerId: 'CT-2', containerType: 'cryovial' });
    expect((await post('/containers/CT-1/specimens', 'tech-a', { specimenId: 'SPC-1' })).status).toBe(201);
    expect((await post('/containers/CT-2/specimens', 'tech-a', { specimenId: 'SPC-1' })).status).toBe(409);
  });

  it('places a container through the specimen it holds, and resolves the chain', async () => {
    await withCustodyAndContainer();
    expect((await post('/containers/CT-1/position', 'tech-a', { storagePositionId: 'rack-96-001:A01' })).body.error).toBe('CONTAINER_OUT_OF_SCOPE');
    await post('/containers/CT-1/specimens', 'tech-a', { specimenId: 'SPC-1' });
    expect((await post('/containers/CT-1/position', 'tech-b', { storagePositionId: 'rack-96-001:A01' })).status).toBe(403);
    expect((await post('/containers/CT-1/position', 'tech-a', { storagePositionId: 'rack-96-001:A01' })).status).toBe(201);
    expect((await post('/racks/rack-96-001/location', 'coord-a', { storageLocationId: 'loc-1' })).body.error).toBe('GLOBAL_SCOPE_REQUIRED');
    expect((await post('/racks/rack-96-001/location', 'admin', { storageLocationId: 'loc-1' })).status).toBe(201);

    const location = await get('/specimens/SPC-1/location', 'tech-a');
    expect(location.status).toBe(200);
    expect(location.body.data).toMatchObject({ containerId: 'CT-1', storagePositionId: 'rack-96-001:A01', storageRackId: 'rack-96-001', storageLocationId: 'loc-1' });
    expect((await get('/specimens/SPC-1/location', 'tech-b')).status).toBe(403);
  });

  it('closes each link only for its holder', async () => {
    await withCustodyAndContainer();
    const load = (await post('/containers/CT-1/specimens', 'tech-a', { specimenId: 'SPC-1' })).body.data;
    const place = (await post('/containers/CT-1/position', 'tech-a', { storagePositionId: 'rack-96-001:A01' })).body.data;
    const rack = (await post('/racks/rack-96-001/location', 'admin', { storageLocationId: 'loc-1' })).body.data;

    expect((await post(`/position-assignments/${place.containerPositionAssignmentId}/remove`, 'tech-b')).status).toBe(403);
    expect((await post(`/position-assignments/${place.containerPositionAssignmentId}/remove`, 'tech-a')).status).toBe(200);
    expect((await post(`/specimen-assignments/${load.specimenContainerAssignmentId}/unload`, 'tech-b')).status).toBe(403);
    expect((await post(`/specimen-assignments/${load.specimenContainerAssignmentId}/unload`, 'tech-a')).status).toBe(200);
    expect(domain.containers.docs[0].emptyStatus).toBe('empty');
    expect((await post(`/rack-assignments/${rack.rackLocationAssignmentId}/remove`, 'coord-a')).status).toBe(403);
    expect((await post(`/rack-assignments/${rack.rackLocationAssignmentId}/remove`, 'admin')).status).toBe(200);
    expect((await post('/specimen-assignments/nope/unload', 'tech-a')).status).toBe(404);
  });

  it("resolves a scan for the custodian, and refuses another organization's tube with no ScanEvent (RF016 AC6)", async () => {
    await withCustodyAndContainer();
    await post('/containers/CT-1/specimens', 'tech-a', { specimenId: 'SPC-1' });
    await domain.labelIdentifiers.insertOne({ encodedValue: 'BVA2:synthetic:8K3M', status: 'active', targetType: 'container', targetId: 'CT-1' });
    const scan = { rawValue: ']d2BVA2:synthetic:8K3M', symbology: 'data_matrix', deviceId: 'scanner-1' };

    expect((await post('/scan', 'tech-a', { rawValue: 'x' })).status).toBe(400);
    const denied = await post('/scan', 'tech-b', scan);
    expect(denied.status).toBe(403);
    expect(domain.scanEvents.docs).toHaveLength(0);

    const res = await post('/scan', 'tech-a', scan);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ resolved: true, specimenId: 'SPC-1', containerId: 'CT-1' });
    expect(domain.scanEvents.docs).toHaveLength(1);
    expect(domain.scanEvents.docs[0]).toMatchObject({ actorId: 'tech-a', targetId: 'SPC-1' });
  });
});
