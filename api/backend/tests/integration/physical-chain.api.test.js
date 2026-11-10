import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { ObjectId } = require('mongodb');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'vitest-secret-key';

const app = require('../../app');
const sessionService = require('../../src/services/session.service');
const influxRead = require('../../src/infrastructure/persistence/influxdb/InfluxTelemetryReadRepository');
const sensorDatastream = require('../../src/services/sensorDatastream.service');
const auditLogger = require('../../src/utils/auditLogger');
const { createDbMock } = require('../factories/db.factory');
const { buildRbacCollections } = require('../factories/rbac.factory');

// #1314, #1316: the physical-chain and custody routes against the real app
// and RBAC middleware. The domain collections are query-matching fakes, so
// the overlap checks and the chain walk read what a real query returns.

function matches(doc, filter) {
  return Object.entries(filter).every(([key, value]) => {
    if (key === '$or') return value.some((branch) => matches(doc, branch));
    if (value instanceof ObjectId) return String(doc[key]) === String(value);
    return doc[key] === value;
  });
}

function fakeCollection() {
  const docs = [];
  return {
    docs,
    createIndex: async () => undefined,
    insertOne: async (doc) => { docs.push(structuredClone(doc)); return { insertedId: docs.length }; },
    insertMany: async (rows) => { for (const doc of rows) docs.push(structuredClone(doc)); return { insertedCount: rows.length }; },
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
  'labelIdentifiers', 'scanEvents', 'devices', 'storageLocations', 'legalHolds', 'telemetryDatastreams', 'telemetryExposureSummaries',
  'storageRacks', 'storagePositions',
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
  await domain.devices.insertOne({ deviceId: 'scanner-1', deviceType: 'scanner', qualificationStatus: 'qualified', retiredAt: null });
  app.locals.db = createDbMock({ ...domain, ...buildRbacCollections(USERS) });
});

afterEach(() => { vi.restoreAllMocks(); });

const post = (path, user, body = {}) => request(app).post(`/api/physical-chain${path}`).set('Authorization', token(user)).send(body);
const get = (path, user) => request(app).get(`/api/physical-chain${path}`).set('Authorization', token(user));
const custody = (over = {}) => ({ specimenId: 'SPC-1', custodianOrganizationId: 'org-A', authorizationId: 'appr-1', effectivePeriod: { start: '2026-01-01T00:00:00Z' }, ...over });

const locationBody = (over = {}) => ({ storageLocationId: 'loc-1', locationType: 'freezer', name: 'Freezer 1', code: 'FZ-1', organizationId: 'org-A', ...over });

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

  // #1192: with no custody yet, the holder is the sample's organization
  // (organizationId), not the recorded collection site.
  it("lets the sample's organization assign the first custody of a specimen collected elsewhere", async () => {
    await domain.samples.insertOne({ specimenId: 'SPC-ORG', collectionId: 'COL-1', organizationId: 'org-A', collectionSite: 'org-B' });
    const first = custody({ specimenId: 'SPC-ORG' });

    expect((await post('/custody', 'coord-b', { ...first, custodianOrganizationId: 'org-B' })).body.error).toBe('SPECIMEN_OUT_OF_SCOPE');
    const res = await post('/custody', 'coord-a', first);
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ specimenId: 'SPC-ORG', custodianOrganizationId: 'org-A' });
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

  it('refuses loading a specimen under an active legal hold, and loads it once released (RF006 AC6)', async () => {
    await withCustodyAndContainer();
    await domain.legalHolds.insertOne({ legalHoldId: 'hold-1', targetEntityType: 'Specimen', targetEntityIds: ['SPC-1'], status: 'active' });
    const held = await post('/containers/CT-1/specimens', 'tech-a', { specimenId: 'SPC-1' });
    expect(held.status).toBe(409);
    expect(held.body).toMatchObject({ error: 'LEGAL_HOLD_ACTIVE', message: expect.stringContaining('hold-1') });
    expect(domain.specimenContainerAssignments.docs).toHaveLength(0);
    await domain.legalHolds.updateOne({ legalHoldId: 'hold-1' }, { $set: { status: 'released' } });
    expect((await post('/containers/CT-1/specimens', 'tech-a', { specimenId: 'SPC-1' })).status).toBe(201);
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
    expect((await post('/racks/rack-96-001/location', 'coord-a', { storageLocationId: 'loc-1' })).body.error).toBe('LOCATION_NOT_FOUND');
    expect((await post('/locations', 'coord-a', locationBody())).status).toBe(201);
    expect((await post('/racks/rack-96-001/location', 'coord-b', { storageLocationId: 'loc-1' })).body.error).toBe('LOCATION_OUT_OF_SCOPE');
    expect((await post('/racks/rack-96-001/location', 'coord-a', { storageLocationId: 'loc-1' })).status).toBe(201);

    const location = await get('/specimens/SPC-1/location', 'tech-a');
    expect(location.status).toBe(200);
    expect(location.body.data).toMatchObject({ containerId: 'CT-1', storagePositionId: 'rack-96-001:A01', storageRackId: 'rack-96-001', storageLocationId: 'loc-1' });
    expect((await get('/specimens/SPC-1/location', 'tech-b')).status).toBe(403);
  });

  it('closes each link only for its holder', async () => {
    await withCustodyAndContainer();
    const load = (await post('/containers/CT-1/specimens', 'tech-a', { specimenId: 'SPC-1' })).body.data;
    const place = (await post('/containers/CT-1/position', 'tech-a', { storagePositionId: 'rack-96-001:A01' })).body.data;
    await post('/locations', 'coord-a', locationBody());
    const rack = (await post('/racks/rack-96-001/location', 'coord-a', { storageLocationId: 'loc-1' })).body.data;

    expect((await post(`/position-assignments/${place.containerPositionAssignmentId}/remove`, 'tech-b')).status).toBe(403);
    expect((await post(`/position-assignments/${place.containerPositionAssignmentId}/remove`, 'tech-a')).status).toBe(200);
    expect((await post(`/specimen-assignments/${load.specimenContainerAssignmentId}/unload`, 'tech-b')).status).toBe(403);
    expect((await post(`/specimen-assignments/${load.specimenContainerAssignmentId}/unload`, 'tech-a')).status).toBe(200);
    expect(domain.containers.docs[0].emptyStatus).toBe('empty');
    expect((await post(`/rack-assignments/${rack.rackLocationAssignmentId}/remove`, 'coord-b')).status).toBe(403);
    expect((await post(`/rack-assignments/${rack.rackLocationAssignmentId}/remove`, 'coord-a')).status).toBe(200);
    expect((await post('/specimen-assignments/nope/unload', 'tech-a')).status).toBe(404);
  });

  it("resolves a scan for the custodian, and refuses another organization's tube with no ScanEvent (RF016 AC6)", async () => {
    await withCustodyAndContainer();
    await post('/containers/CT-1/specimens', 'tech-a', { specimenId: 'SPC-1' });
    await domain.labelIdentifiers.insertOne({ encodedValue: 'BVA2:synthetic:8K3M', status: 'active', targetType: 'container', targetId: 'CT-1' });
    const scan = { rawValue: ']d2BVA2:synthetic:8K3M', symbology: 'data_matrix', deviceId: 'scanner-1' };

    expect((await post('/scan', 'tech-a', { rawValue: 'x' })).status).toBe(400);
    // RF017 AC8: an unregistered or unhomologated scanner is refused.
    expect((await post('/scan', 'tech-a', { ...scan, deviceId: 'scanner-unknown' })).body.error).toBe('DEVICE_UNUSABLE');
    await domain.devices.insertOne({ deviceId: 'scanner-pending', deviceType: 'scanner', qualificationStatus: 'pending', retiredAt: null });
    expect((await post('/scan', 'tech-a', { ...scan, deviceId: 'scanner-pending' })).body.error).toBe('DEVICE_UNUSABLE');
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

describe('telemetry exposure summaries (#1392, RF009 AC5/AC6)', () => {
  const at = (iso) => `2026-02-0${iso}Z`;
  const exposure = (specimenId, user, body = { windowStart: at('1T00:00:00'), windowEnd: at('5T00:00:00') }) => (
    post(`/specimens/${specimenId}/telemetry-exposure-summaries`, user, body)
  );

  beforeEach(async () => {
    await domain.telemetryDatastreams.insertOne({
      telemetryDatastreamId: 'ds-1', sensorId: 'S1', storageLocationId: 'loc-1', observedProperty: 'temperature',
      thresholdProfileId: 'pol-1', validityPeriod: { start: new Date('2026-01-01T00:00:00Z'), end: null },
    });
    const reading = (iso, celsius) => ({
      timestamp: new Date(at(iso)), telemetryReadingId: `R-${iso}`, datastreamId: 'ds-1', storageLocationId: 'loc-1', temperatureCelsius: celsius,
    });
    vi.spyOn(influxRead, 'readingsAtLocation').mockResolvedValue([
      reading('2T12:00:00', -20), reading('3T00:00:00', -80), reading('4T00:00:00', -82), reading('5T00:00:00', -20),
    ]);
    vi.spyOn(sensorDatastream, 'policiesByProfileId').mockResolvedValue(new Map([['pol-1', { _id: 'pol-1', minTemp: -90, maxTemp: -70 }]]));
  });

  it("summarizes a chained specimen over its path's interval only, for its custodian's organization, and audits it", async () => {
    await withCustodyAndContainer();
    expect((await post('/containers/CT-1/specimens', 'tech-a', { specimenId: 'SPC-1', loadedAt: at('1T00:00:00') })).status).toBe(201);
    expect((await post('/containers/CT-1/position', 'tech-a', { storagePositionId: 'rack-96-001:A01', placedAt: at('2T00:00:00') })).status).toBe(201);
    expect((await post('/locations', 'coord-a', locationBody())).status).toBe(201);
    expect((await post('/racks/rack-96-001/location', 'coord-a', { storageLocationId: 'loc-1', placedAt: at('3T00:00:00') })).status).toBe(201);

    expect((await exposure('SPC-1', 'tech-b')).status).toBe(403);
    const res = await exposure('SPC-1', 'tech-a');

    expect(res.status).toBe(201);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toMatchObject({
      specimenId: 'SPC-1', storageAssignmentId: null, datastreamIds: ['ds-1'],
      windowStart: '2026-02-03T00:00:00.000Z', windowEnd: '2026-02-05T00:00:00.000Z',
      observationCount: 2, minimumValue: -82, maximumValue: -80, excursionCount: 0,
    });
    expect(domain.telemetryExposureSummaries.docs).toHaveLength(1);
    expect(auditLogger.log).toHaveBeenCalledWith(expect.objectContaining({
      resourceType: 'TelemetryExposureSummary', resourceId: res.body.data[0].telemetryExposureSummaryId,
    }));
  });

  it('answers a specimen in custody but never loaded with 422 EXPOSURE_PATH_EMPTY and a details list', async () => {
    expect((await post('/custody', 'coord-a', custody())).status).toBe(201);

    const res = await exposure('SPC-1', 'tech-a');

    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ error: 'EXPOSURE_PATH_EMPTY', details: [expect.any(String)] });
    expect(domain.telemetryExposureSummaries.docs).toHaveLength(0);
  });
});

describe('storage locations (#1314, RF017 AC1/AC3/AC8)', () => {
  it("creates a location only under the caller's organization, and lists each organization its own", async () => {
    expect((await post('/locations', 'coord-a', locationBody({ organizationId: 'org-B' }))).body.error).toBe('LOCATION_OUT_OF_SCOPE');
    expect((await post('/locations', 'tech-a', locationBody())).status).toBe(403);
    expect((await post('/locations', 'admin', locationBody({ organizationId: 'org-Z' }))).body.error).toBe('ORGANIZATION_NOT_FOUND');
    const created = await post('/locations', 'coord-a', locationBody());
    expect(created.status).toBe(201);
    expect(auditLogger.log).toHaveBeenCalledWith(expect.objectContaining({ resourceType: 'StorageLocation', resourceId: 'loc-1' }));
    expect((await post('/locations', 'coord-a', locationBody())).status).toBe(409);
    await post('/locations', 'coord-b', locationBody({ storageLocationId: 'loc-b', organizationId: 'org-B' }));

    expect((await get('/locations', 'tech-a')).body.data.map((l) => l.storageLocationId)).toEqual(['loc-1']);
    expect((await get('/locations', 'tech-b')).body.data.map((l) => l.storageLocationId)).toEqual(['loc-b']);
    expect((await get('/locations', 'admin')).body.data).toHaveLength(2);
  });

  it("builds the hierarchy inside one organization (AC1): an unknown or another organization's parent is refused", async () => {
    await post('/locations', 'coord-a', locationBody({ storageLocationId: 'room-1', locationType: 'room', code: 'R-1' }));
    await post('/locations', 'coord-b', locationBody({ storageLocationId: 'room-b', organizationId: 'org-B', code: 'R-B' }));
    expect((await post('/locations', 'coord-a', locationBody({ parentLocationId: 'nope' }))).body.error).toBe('LOCATION_NOT_FOUND');
    const foreign = await post('/locations', 'admin', locationBody({ parentLocationId: 'room-b' }));
    expect(foreign.status).toBe(422);
    expect(foreign.body.details).toEqual([expect.stringContaining('outra organização')]);
    expect((await post('/locations', 'coord-a', locationBody({ parentLocationId: 'room-1' }))).status).toBe(201);
  });

  it('refuses a rack at a location, or under an ancestor, that is not active, and audits each status change (AC8)', async () => {
    await post('/locations', 'coord-a', locationBody({ storageLocationId: 'room-1', locationType: 'room', code: 'R-1' }));
    await post('/locations', 'coord-a', locationBody({ parentLocationId: 'room-1' }));

    expect((await post('/locations/room-1/status', 'coord-b', { locationStatus: 'interdicted' })).status).toBe(403);
    expect((await post('/locations/room-1/status', 'coord-a', { locationStatus: 'lost' })).status).toBe(422);
    const interdicted = await post('/locations/room-1/status', 'coord-a', { locationStatus: 'interdicted', reason: 'vazamento' });
    expect(interdicted.status).toBe(200);
    expect(interdicted.body.data).toMatchObject({ locationStatus: 'interdicted', previousStatus: 'active' });
    expect(auditLogger.log).toHaveBeenCalledWith(expect.objectContaining({
      resourceType: 'StorageLocation',
      resourceId: 'room-1',
      payload: expect.objectContaining({ locationStatus: 'interdicted', previousStatus: 'active', reason: 'vazamento' }),
    }));

    const blocked = await post('/racks/rack-96-001/location', 'coord-a', { storageLocationId: 'loc-1' });
    expect(blocked.status).toBe(422);
    expect(blocked.body).toMatchObject({ error: 'LOCATION_UNUSABLE', details: [expect.stringContaining('ancestral room-1')] });
    expect(domain.rackLocationAssignments.docs).toHaveLength(0);

    await post('/locations/room-1/status', 'coord-a', { locationStatus: 'active' });
    await post('/locations/loc-1/status', 'coord-a', { locationStatus: 'unavailable' });
    expect((await post('/racks/rack-96-001/location', 'coord-a', { storageLocationId: 'loc-1' })).body.details).toEqual([expect.stringContaining('Local loc-1 está unavailable')]);
    await post('/locations/loc-1/status', 'coord-a', { locationStatus: 'active' });
    expect((await post('/racks/rack-96-001/location', 'coord-a', { storageLocationId: 'loc-1' })).status).toBe(201);
  });
});

describe('label issuing (#1314, RF016 AC4/AC5)', () => {
  const institutional = {
    encodedValue: 'BVA2:synthetic:9Q2X', symbology: 'data_matrix', identifierOrigin: 'institution_applied', namespaceRegistryId: 'ns-1',
    carrierPlacement: 'side', immutableAtSource: true, templateVersionId: 'tpl-1', printBatchId: 'batch-1',
  };

  it("issues a container's label for the holder of the specimen it holds, and the scan then resolves it", async () => {
    await withCustodyAndContainer();
    expect((await post('/containers/CT-404/labels', 'coord-a', institutional)).status).toBe(404);
    // Empty: no organization delimits it yet.
    expect((await post('/containers/CT-1/labels', 'coord-a', institutional)).body.error).toBe('CONTAINER_OUT_OF_SCOPE');
    await post('/containers/CT-1/specimens', 'tech-a', { specimenId: 'SPC-1' });
    expect((await post('/containers/CT-1/labels', 'coord-b', institutional)).status).toBe(403);
    expect((await post('/containers/CT-1/labels', 'tech-a', institutional)).status).toBe(403);

    const issued = await post('/containers/CT-1/labels', 'coord-a', { ...institutional, targetId: 'CT-OTHER', targetType: 'storage_rack' });
    expect(issued.status).toBe(201);
    expect(issued.body.data).toMatchObject({ targetType: 'container', targetId: 'CT-1', status: 'active', issuedBy: 'coord-a' });
    expect(issued.body.data.issuedAt).toEqual(expect.any(String));
    expect(auditLogger.log).toHaveBeenCalledWith(expect.objectContaining({ resourceType: 'LabelIdentifier' }));

    const scan = await post('/scan', 'tech-a', { rawValue: ']d2BVA2:synthetic:9Q2X', symbology: 'data_matrix', deviceId: 'scanner-1' });
    expect(scan.body.data).toMatchObject({ resolved: true, specimenId: 'SPC-1', containerId: 'CT-1' });
  });

  it('answers a value carrying personal data, or an institutional label without its batch, with 422 (RULE-012, AC4)', async () => {
    await withCustodyAndContainer();
    await post('/containers/CT-1/specimens', 'tech-a', { specimenId: 'SPC-1' });
    const cpf = await post('/containers/CT-1/labels', 'coord-a', { ...institutional, encodedValue: '123.456.789-09' });
    expect(cpf.status).toBe(422);
    expect(cpf.body).toMatchObject({ error: 'VALIDATION_ERROR', details: [expect.stringContaining('CPF')] });
    expect((await post('/containers/CT-1/labels', 'coord-a', { ...institutional, printBatchId: undefined })).body.details).toEqual([expect.stringContaining('printBatchId')]);
    expect(domain.labelIdentifiers.docs).toHaveLength(0);
  });
});

describe('an empty container and a load by any id (#1314)', () => {
  const institutional = {
    encodedValue: 'BVA2:synthetic:7E4P', symbology: 'data_matrix', identifierOrigin: 'institution_applied', namespaceRegistryId: 'ns-1',
    carrierPlacement: 'side', immutableAtSource: true, templateVersionId: 'tpl-1', printBatchId: 'batch-1',
  };

  // An empty tube placed by a global caller in a rack at org-A's location.
  async function emptyTubeInRackAt(organizationId) {
    expect((await post('/locations', 'admin', locationBody({ storageLocationId: `loc-${organizationId}`, code: `FZ-${organizationId}`, organizationId }))).status).toBe(201);
    expect((await post('/racks/rack-7/location', 'admin', { storageLocationId: `loc-${organizationId}` })).status).toBe(201);
    expect((await post('/containers', 'admin', { containerId: 'CT-E', containerType: 'cryovial' })).status).toBe(201);
  }

  it("labels and places an empty tube for the holder of its rack's location, and refuses another organization", async () => {
    await emptyTubeInRackAt('org-A');
    expect((await post('/containers/CT-E/position', 'tech-b', { storagePositionId: 'rack-7:A01' })).body.error).toBe('CONTAINER_OUT_OF_SCOPE');
    expect((await post('/containers/CT-E/position', 'tech-a', { storagePositionId: 'rack-7:A01' })).status).toBe(201);
    expect((await post('/containers/CT-E/labels', 'coord-b', institutional)).body.error).toBe('CONTAINER_OUT_OF_SCOPE');
    const issued = await post('/containers/CT-E/labels', 'coord-a', institutional);
    expect(issued.status).toBe(201);
    expect(issued.body.data).toMatchObject({ targetType: 'container', targetId: 'CT-E' });
    const placed = domain.containerPositionAssignments.docs[0];
    expect((await post(`/position-assignments/${placed.containerPositionAssignmentId}/remove`, 'tech-b')).status).toBe(403);
    expect((await post(`/position-assignments/${placed.containerPositionAssignmentId}/remove`, 'tech-a')).status).toBe(200);
  });

  it("refuses an empty tube in a rack at another organization's location", async () => {
    await emptyTubeInRackAt('org-B');
    expect((await post('/containers/CT-E/position', 'admin', { storagePositionId: 'rack-7:A01' })).status).toBe(201);
    const refused = await post('/containers/CT-E/labels', 'coord-a', institutional);
    expect(refused.status).toBe(403);
    expect(refused.body.error).toBe('CONTAINER_OUT_OF_SCOPE');
    expect((await post('/containers/CT-E/labels', 'coord-b', institutional)).status).toBe(201);
  });

  it('keeps an empty, unplaced tube global-only', async () => {
    expect((await post('/containers', 'admin', { containerId: 'CT-E', containerType: 'cryovial' })).status).toBe(201);
    expect((await post('/containers/CT-E/labels', 'coord-a', institutional)).body.error).toBe('CONTAINER_OUT_OF_SCOPE');
    // A rack located nowhere names no organization either.
    expect((await post('/containers/CT-E/position', 'tech-a', { storagePositionId: 'rack-nowhere:A01' })).body.error).toBe('CONTAINER_OUT_OF_SCOPE');
    expect((await post('/containers/CT-E/labels', 'admin', institutional)).status).toBe(201);
  });

  it('keys the chain by the business specimenId when the caller loads by Mongo _id', async () => {
    const _id = new ObjectId();
    domain.samples.docs.push({ _id, specimenId: 'SPC-OID', collectionId: 'COL-1', collectionSite: 'org-A' });
    expect((await post('/custody', 'coord-a', custody({ specimenId: 'SPC-OID' }))).status).toBe(201);
    expect((await post('/containers', 'coord-a', { containerId: 'CT-1', containerType: 'cryovial' })).status).toBe(201);
    const res = await post('/containers/CT-1/specimens', 'tech-a', { specimenId: String(_id) });
    expect(res.status).toBe(201);
    expect(res.body.data.specimenId).toBe('SPC-OID');
    expect(domain.specimenContainerAssignments.docs).toEqual([expect.objectContaining({ specimenId: 'SPC-OID', containerId: 'CT-1' })]);
  });

  it('answers an unknown specimen with 404', async () => {
    expect((await post('/containers', 'admin', { containerId: 'CT-1', containerType: 'cryovial' })).status).toBe(201);
    const res = await post('/containers/CT-1/specimens', 'admin', { specimenId: 'SPC-NOPE' });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('SPECIMEN_NOT_FOUND');
    expect(domain.specimenContainerAssignments.docs).toHaveLength(0);
  });
});

describe('rack grid (#1513, RF016 AC2)', () => {
  beforeEach(async () => {
    expect((await post('/locations', 'coord-a', locationBody())).status).toBe(201);
  });

  it('creates a rack and its 96 positions for the topology manager, and refuses a duplicate or an invalid grid', async () => {
    expect((await post('/racks', 'tech-a', { storageRackId: 'rack-96', storageLocationId: 'loc-1' })).status).toBe(403);
    const created = await post('/racks', 'coord-a', { storageRackId: 'rack-96', storageLocationId: 'loc-1' });
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({ storageRackId: 'rack-96', rowCount: 8, columnCount: 12, positionCount: 96 });
    expect(domain.storagePositions.docs).toHaveLength(96);
    const again = await post('/racks', 'coord-a', { storageRackId: 'rack-96', storageLocationId: 'loc-1' });
    expect(again.status).toBe(409);
    expect(again.body.error).toBe('RACK_EXISTS');
    const invalid = await post('/racks', 'coord-a', { storageRackId: 'rack-bad', rowCount: 0 });
    expect(invalid.status).toBe(422);
    expect(invalid.body.error).toBe('VALIDATION_ERROR');
    expect(Array.isArray(invalid.body.details)).toBe(true);
    expect(domain.storagePositions.docs).toHaveLength(96);
  });

  it("refuses a rack at another organization's location", async () => {
    const refused = await post('/racks', 'coord-b', { storageRackId: 'rack-x', storageLocationId: 'loc-1' });
    expect(refused.status).toBe(403);
    expect(refused.body.error).toBe('LOCATION_OUT_OF_SCOPE');
    expect(domain.storageRacks.docs).toHaveLength(0);
  });

  it("refuses the grid of a rack already located at another organization's location", async () => {
    expect((await post('/racks/rack-loc/location', 'coord-a', { storageLocationId: 'loc-1' })).status).toBe(201);
    const refused = await post('/racks', 'coord-b', { storageRackId: 'rack-loc' });
    expect(refused.status).toBe(403);
    expect(refused.body.error).toBe('LOCATION_OUT_OF_SCOPE');
    expect(domain.storageRacks.docs.some((rack) => rack.storageRackId === 'rack-loc')).toBe(false);
  });

  it("reads the grid back in order for the holder of the rack's location only", async () => {
    expect((await post('/racks', 'coord-a', { storageRackId: 'rack-96', storageLocationId: 'loc-1' })).status).toBe(201);
    const read = await get('/racks/rack-96/positions', 'tech-a');
    expect(read.status).toBe(200);
    expect(read.body.data).toHaveLength(96);
    expect(new Set(read.body.data.map((p) => p.storagePositionId)).size).toBe(96);
    expect(read.body.data[0].storagePositionId).toBe('rack-96:A01');
    expect(read.body.data[95].positionCode).toBe('H12');
    const refused = await get('/racks/rack-96/positions', 'tech-b');
    expect(refused.status).toBe(403);
    expect(refused.body.error).toBe('RACK_OUT_OF_SCOPE');
    const unknown = await get('/racks/nope/positions', 'tech-a');
    expect(unknown.status).toBe(404);
    expect(unknown.body.error).toBe('RACK_NOT_FOUND');
  });

  it('keeps the grid of a rack located nowhere global-only', async () => {
    expect((await post('/racks', 'admin', { storageRackId: 'rack-free' })).status).toBe(201);
    const refused = await get('/racks/rack-free/positions', 'coord-a');
    expect(refused.status).toBe(403);
    expect(refused.body.error).toBe('RACK_OUT_OF_SCOPE');
    expect((await get('/racks/rack-free/positions', 'admin')).status).toBe(200);
  });

  it('refuses another organization placing a rack whose record names a location of yours', async () => {
    expect((await post('/racks', 'coord-a', { storageRackId: 'rack-own', storageLocationId: 'loc-1' })).status).toBe(201);
    expect((await post('/locations', 'coord-b', locationBody({ storageLocationId: 'loc-2', code: 'FZ-2', organizationId: 'org-B' }))).status).toBe(201);
    const refused = await post('/racks/rack-own/location', 'coord-b', { storageLocationId: 'loc-2' });
    expect(refused.status).toBe(403);
    expect(refused.body.error).toBe('LOCATION_OUT_OF_SCOPE');
    expect(domain.rackLocationAssignments.docs).toHaveLength(0);
    expect((await get('/racks/rack-own/positions', 'tech-a')).status).toBe(200);
    expect((await post('/racks/rack-own/location', 'coord-a', { storageLocationId: 'loc-1' })).status).toBe(201);
  });

  it('refuses a rack at an unusable location and writes no row', async () => {
    expect((await post('/locations/loc-1/status', 'coord-a', { locationStatus: 'unavailable' })).status).toBe(200);
    const refused = await post('/racks', 'coord-a', { storageRackId: 'rack-r', storageLocationId: 'loc-1' });
    expect(refused.status).toBe(422);
    expect(refused.body).toMatchObject({ error: 'LOCATION_UNUSABLE', details: [expect.stringContaining('Local loc-1 está unavailable')] });
    expect(domain.storageRacks.docs).toHaveLength(0);
    expect(domain.storagePositions.docs).toHaveLength(0);
  });
});
