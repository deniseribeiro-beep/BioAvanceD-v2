import { test, expect, type APIRequestContext } from '@playwright/test';
import { realLogin } from './helpers/realAuth';
import { deleteOrganizations } from './helpers/listOrganizations';
import { completeFirstLoginMfa } from './helpers/completeFirstLoginMfa';
import {
  seedCustodyFixture,
  setApprovalStatus,
  countScanEvents,
  cleanupCustodyFixture,
  closeCustodyDb,
  type CustodyFixture,
} from './helpers/seedCustody';

// Real-backend proof for #1314 and #1316: custody as its own assignment
// (RF021 AC4-AC6), the specimen -> container -> position and rack ->
// location chain (RF016 AC3, RF017 AC3/AC4) over StorageLocation records
// (RF017 AC1/AC8), the label route and the scan resolver (RF016 AC4/AC6),
// all scoped by the specimen's custodian, and a scanner's lifecycle
// (RF017 AC6/AC8). Two organizations, a
// Coordenador and a Tecnico in the first, a Tecnico in the second.
const apiBaseURL = process.env.PLAYWRIGHT_API_BASE_URL;

test.skip(!apiBaseURL, 'PLAYWRIGHT_API_BASE_URL not set — run via npm run test:e2e:docker');

test.describe('Physical chain and custody (#1314, #1316) — real backend', () => {
  const organizationIds: string[] = [];
  let fixture: CustodyFixture | null = null;
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const containerId = `CT-CHAIN-${suffix}`;
  const rackId = `rack-chain-${suffix}`;
  const tubeCode = `BVA2:synthetic:${suffix}`;
  const scannerId = `scanner-chain-${suffix}`;
  const roomId = `room-chain-${suffix}`;
  const freezerId = `freezer-chain-${suffix}`;

  test.afterAll(async ({ request }) => {
    if (fixture) await cleanupCustodyFixture(fixture, [containerId], [rackId], [tubeCode], [scannerId], [roomId, freezerId, `${freezerId}-x`]).catch(() => {});
    await deleteOrganizations(request, apiBaseURL!, organizationIds);
    await closeCustodyDb();
  });

  async function registerUser(request: APIRequestContext, adminAuth: Record<string, string>, label: string, accessType: number, roleName: string, organizationId: string) {
    const username = `chain.${label}.${Date.now()}`;
    const password = 'Cadeia@12345-forte';
    const res = await request.post(`${apiBaseURL}/api/users/register`, {
      headers: adminAuth,
      data: { name: `#1314 ${label}`, email: `${username}@example.com`, username, password, accessType, roleName, organizationId },
    });
    expect(res.ok(), await res.text()).toBeTruthy();
    const session = await completeFirstLoginMfa(request, apiBaseURL!, username, password);
    return { Authorization: `Bearer ${session.token}` };
  }

  test('custody bounds who may load, place, read and scan a specimen, and an approval out of force stops it', async ({ request }) => {
    const admin = await realLogin(request);
    const adminAuth = { Authorization: `Bearer ${admin.token}` };
    const makeOrg = async (label: string) => {
      const res = await request.post(`${apiBaseURL}/api/organizations`, {
        headers: adminAuth,
        data: { officialName: `#1314 ${label} ${suffix}`, countryCode: 'BR' },
      });
      expect(res.ok(), await res.text()).toBeTruthy();
      const organizationId = (await res.json()).data.organizationId as string;
      organizationIds.push(organizationId);
      return organizationId;
    };
    const orgA = await makeOrg('A');
    const orgB = await makeOrg('B');
    fixture = await seedCustodyFixture(suffix, orgA);
    const { specimenId } = fixture;

    const coordA = await registerUser(request, adminAuth, 'coordA', 3, 'Coordenador', orgA);
    const techA = await registerUser(request, adminAuth, 'techA', 2, 'Técnico', orgA);
    const techB = await registerUser(request, adminAuth, 'techB', 2, 'Técnico', orgB);
    const post = (path: string, headers: Record<string, string>, data: Record<string, unknown> = {}) =>
      request.post(`${apiBaseURL}/api/physical-chain${path}`, { headers, data });
    const get = (path: string, headers: Record<string, string>) => request.get(`${apiBaseURL}/api/physical-chain${path}`, { headers });

    // RF021 AC4: the collection site's Coordenador assigns the first custody;
    // a Tecnico holds no manageCustody.
    const custodyBody = {
      specimenId, custodianOrganizationId: orgA, authorizationId: fixture.approvalId, responsibleInvestigatorId: 'inv-chain',
      effectivePeriod: { start: '2026-01-01T00:00:00.000Z' },
    };
    expect((await post('/custody', techA, custodyBody)).status()).toBe(403);
    const assigned = await post('/custody', coordA, custodyBody);
    expect(assigned.status(), await assigned.text()).toBe(201);
    expect((await assigned.json()).data).toMatchObject({ specimenId, custodianOrganizationId: orgA, assignmentStatus: 'active' });

    // RF021 AC5: a second custody overlapping the first is refused.
    const overlap = await post('/custody', adminAuth, { ...custodyBody, custodianOrganizationId: orgB });
    expect(overlap.status(), await overlap.text()).toBe(409);

    const created = await post('/containers', coordA, { containerId, containerType: 'cryovial' });
    expect(created.status(), await created.text()).toBe(201);

    // RF017 AC3: only the custodian's Tecnico loads the specimen.
    const foreignLoad = await post(`/containers/${containerId}/specimens`, techB, { specimenId });
    expect(foreignLoad.status(), await foreignLoad.text()).toBe(403);
    expect((await foreignLoad.json()).error).toBe('SPECIMEN_OUT_OF_SCOPE');
    const loaded = await post(`/containers/${containerId}/specimens`, techA, { specimenId });
    expect(loaded.status(), await loaded.text()).toBe(201);
    const load = (await loaded.json()).data;

    // RF017 AC2/AC3 and RULE-035: the container takes a position, and the
    // rack a StorageLocation of the custodian's organization (RF017 AC1:
    // a freezer inside a room). Another organization does not see it.
    const placed = await post(`/containers/${containerId}/position`, techA, { storagePositionId: `${rackId}:A01` });
    expect(placed.status(), await placed.text()).toBe(201);
    const room = await post('/locations', coordA, { storageLocationId: roomId, locationType: 'room', name: 'Sala criogenica', code: `R-${suffix}`, organizationId: orgA });
    expect(room.status(), await room.text()).toBe(201);
    const foreignLocation = await post('/locations', coordA, { storageLocationId: `${freezerId}-x`, locationType: 'freezer', name: 'Freezer B', code: `FZB-${suffix}`, organizationId: orgB });
    expect((await foreignLocation.json()).error).toBe('LOCATION_OUT_OF_SCOPE');
    const freezer = await post('/locations', coordA, { storageLocationId: freezerId, locationType: 'freezer', name: 'Freezer -80', code: `FZ-${suffix}`, organizationId: orgA, parentLocationId: roomId });
    expect(freezer.status(), await freezer.text()).toBe(201);
    const listedB = await get('/locations', techB);
    expect(listedB.status(), await listedB.text()).toBe(200);
    expect(((await listedB.json()).data as Array<{ storageLocationId: string }>).map((l) => l.storageLocationId)).not.toContain(freezerId);

    // RF017 AC8: an interdicted room blocks the freezer in it; restored, the
    // rack is located.
    const interdicted = await post(`/locations/${roomId}/status`, coordA, { locationStatus: 'interdicted', reason: 'synthetic e2e' });
    expect(interdicted.status(), await interdicted.text()).toBe(200);
    const blocked = await post(`/racks/${rackId}/location`, coordA, { storageLocationId: freezerId });
    expect(blocked.status(), await blocked.text()).toBe(422);
    expect((await blocked.json()).error).toBe('LOCATION_UNUSABLE');
    expect((await post(`/locations/${roomId}/status`, coordA, { locationStatus: 'active' })).status()).toBe(200);
    const located = await post(`/racks/${rackId}/location`, coordA, { storageLocationId: freezerId });
    expect(located.status(), await located.text()).toBe(201);

    // RF016 AC3: the chain resolves link by link, for the custodian only.
    const location = await get(`/specimens/${specimenId}/location`, techA);
    expect(location.status(), await location.text()).toBe(200);
    expect((await location.json()).data).toMatchObject({ containerId, storagePositionId: `${rackId}:A01`, storageRackId: rackId, storageLocationId: freezerId });
    expect((await get(`/specimens/${specimenId}/location`, techB)).status()).toBe(403);

    // RF016 AC4: the custodian's Coordenador issues the tube's institutional
    // label, which carries no personal data (RULE-012).
    const labelBody = {
      encodedValue: tubeCode, symbology: 'data_matrix', identifierOrigin: 'institution_applied', namespaceRegistryId: 'ns-chain',
      carrierPlacement: 'side', immutableAtSource: true, templateVersionId: 'tpl-chain', printBatchId: `batch-${suffix}`,
    };
    const personal = await post(`/containers/${containerId}/labels`, coordA, { ...labelBody, encodedValue: '123.456.789-09' });
    expect(personal.status(), await personal.text()).toBe(422);
    const issued = await post(`/containers/${containerId}/labels`, coordA, labelBody);
    expect(issued.status(), await issued.text()).toBe(201);
    expect((await issued.json()).data).toMatchObject({ targetType: 'container', targetId: containerId, status: 'active' });

    // RF016 AC6: the tube code resolves to the specimen; another
    // organization's scan is refused and leaves no ScanEvent.
    const scan = { rawValue: `]d2${tubeCode}`, symbology: 'data_matrix', deviceId: scannerId };

    // RF017 AC6/AC8: the scanner is registered not homologated, so it is
    // refused until the Coordenador records its homologation.
    const device = (path: string, data: Record<string, unknown>) => request.post(`${apiBaseURL}/api/devices${path}`, { headers: coordA, data });
    const registered = await device('', { deviceId: scannerId, deviceType: 'scanner', maintenanceRecords: ['maint-chain'] });
    expect(registered.status(), await registered.text()).toBe(201);
    const unqualified = await post('/scan', techA, scan);
    expect(unqualified.status(), await unqualified.text()).toBe(422);
    expect((await unqualified.json()).error).toBe('DEVICE_UNUSABLE');
    expect((await device(`/${scannerId}/events`, { eventType: 'installed', locationId: freezerId })).status()).toBe(201);
    const qualified = await device(`/${scannerId}/events`, { eventType: 'qualified', evidenceUri: 'object://synthetic/scanner-pq.pdf' });
    expect(qualified.status(), await qualified.text()).toBe(201);
    const history = await request.get(`${apiBaseURL}/api/devices/${scannerId}`, { headers: techA });
    expect(history.status(), await history.text()).toBe(200);
    expect(((await history.json()).data.history as Array<{ eventType: string }>).map((e) => e.eventType)).toEqual(['installed', 'qualified']);

    expect((await post('/scan', techB, scan)).status()).toBe(403);
    expect(await countScanEvents(specimenId)).toBe(0);
    const resolved = await post('/scan', techA, scan);
    expect(resolved.status(), await resolved.text()).toBe(200);
    expect((await resolved.json()).data).toMatchObject({ resolved: true, specimenId, containerId });
    expect(await countScanEvents(specimenId)).toBe(1);

    // RF021 AC6: with the approval suspended, the specimen cannot be loaded
    // again; restored, it can.
    const unloaded = await post(`/specimen-assignments/${load.specimenContainerAssignmentId}/unload`, techA);
    expect(unloaded.status(), await unloaded.text()).toBe(200);
    await setApprovalStatus(fixture.approvalId, 'suspended');
    const inactive = await post(`/containers/${containerId}/specimens`, techA, { specimenId });
    expect(inactive.status(), await inactive.text()).toBe(422);
    expect((await inactive.json()).error).toBe('CUSTODY_INACTIVE');
    await setApprovalStatus(fixture.approvalId, 'active');
    const reloaded = await post(`/containers/${containerId}/specimens`, techA, { specimenId });
    expect(reloaded.status(), await reloaded.text()).toBe(201);
  });
});
