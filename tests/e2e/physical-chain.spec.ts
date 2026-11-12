import { test, expect, type APIRequestContext } from '@playwright/test';
import { realLogin } from './helpers/realAuth';
import { deleteOrganizations } from './helpers/listOrganizations';
import { completeFirstLoginMfa } from './helpers/completeFirstLoginMfa';
import {
  seedCustodyFixture,
  cleanupValidationProtocols,
  seedEthicsApproval,
  setApprovalStatus,
  countScanEvents,
  countSamples,
  containerContent,
  cleanupCustodyFixture,
  closeCustodyDb,
  type CustodyFixture,
} from './helpers/seedCustody';

// Real-backend proof for #1314 and #1316: custody as its own assignment
// (RF021 AC4-AC6), the specimen -> container -> position and rack ->
// location chain (RF016 AC3, RF017 AC3/AC4) over StorageLocation records
// (RF017 AC1/AC8), the label route and the scan resolver (RF016 AC4/AC6),
// all scoped by the specimen's custodian, and a scanner's lifecycle
// (RF017 AC6/AC8). Also: an occupied position refuses a second container
// and rack, position and container stay apart (RF017 AC2, RF016 AC2); a
// specimen loaded twice or over a back-dated interval is checked half-open
// (RF017 AC4); code_128 and qr_code labels resolve and a rack's linear code
// is not a container, issued through the rack label route (RF016 AC5); an empty tube creates no Specimen (RF016
// AC1); and the rack's 8x12 grid is prepared as 96 StoragePosition rows and
// read back (RF016 AC2, #1513). Two organizations, a Coordenador and a
// Tecnico in the first, a Tecnico in the second.
// An ex ante validation protocol runs only once approved_for_execution
// (RF016 AC7, RULE-037, #1514).
const apiBaseURL = process.env.PLAYWRIGHT_API_BASE_URL;

test.skip(!apiBaseURL, 'PLAYWRIGHT_API_BASE_URL not set — run via npm run test:e2e:docker');

test.describe('Physical chain and custody (#1314, #1316) — real backend', () => {
  const organizationIds: string[] = [];
  const protocolVersions: string[] = [];
  let fixture: CustodyFixture | null = null;
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const containerId = `CT-CHAIN-${suffix}`;
  const rackId = `rack-chain-${suffix}`;
  const tubeCode = `BVA2:synthetic:${suffix}`;
  const scannerId = `scanner-chain-${suffix}`;
  const roomId = `room-chain-${suffix}`;
  const freezerId = `freezer-chain-${suffix}`;
  const emptyContainerId = `CT-EMPTY-${suffix}`;
  const emptyRackId = `rack-empty-${suffix}`;
  const emptyLocationId = `freezer-empty-${suffix}`;
  const emptyTubeCode = `BVA2:synthetic:empty-${suffix}`;
  const secondContainerId = `CT-CHAIN2-${suffix}`;
  const code128Value = `BVA2:synthetic:c128-${suffix}`;
  const qrValue = `BVA2:synthetic:qr-${suffix}`;
  const rackCode = `BVA2:synthetic:rack-${suffix}`;
  const emptyScannerId = `scanner-empty-${suffix}`;
  const iso = (ms: number) => new Date(ms).toISOString();

  test.afterAll(async ({ request }) => {
    // The empty-tube case seeds no specimen; its rows go with the same sweep.
    const swept = fixture ?? { specimenId: `none-${suffix}`, collectionId: `none-${suffix}`, approvalId: `none-${suffix}` };
    await cleanupCustodyFixture(
      swept, [containerId, emptyContainerId, secondContainerId], [rackId, emptyRackId],
      [tubeCode, emptyTubeCode, code128Value, qrValue, rackCode], [scannerId, emptyScannerId],
      [roomId, freezerId, `${freezerId}-x`, emptyLocationId],
    ).catch(() => {});
    await cleanupValidationProtocols(protocolVersions).catch(() => {});
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
    const placedAt = (await placed.json()).data.placedAt as string;
    const room =await post('/locations', coordA, { storageLocationId: roomId, locationType: 'room', name: 'Sala criogenica', code: `R-${suffix}`, organizationId: orgA });
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

    // RF016 AC2 (#1513): the located rack's approved 8x12 grid is prepared
    // as 96 StoragePosition rows, by the topology manager only and once, and
    // read back in top_left_origin order by its location's organization only.
    expect((await post('/racks', techA, { storageRackId: rackId })).status()).toBe(403);
    const rack = await post('/racks', coordA, { storageRackId: rackId, storageLocationId: freezerId });
    expect(rack.status(), await rack.text()).toBe(201);
    expect((await rack.json()).data).toMatchObject({ storageRackId: rackId, rowCount: 8, columnCount: 12, positionCount: 96 });
    expect((await (await post('/racks', coordA, { storageRackId: rackId, storageLocationId: freezerId })).json()).error).toBe('RACK_EXISTS');
    const grid = await get(`/racks/${rackId}/positions`, techA);
    expect(grid.status(), await grid.text()).toBe(200);
    const cells = (await grid.json()).data as Array<{ storagePositionId: string; storageRackId: string; positionCode: string }>;
    expect(cells).toHaveLength(96);
    expect(new Set(cells.map((cell) => cell.storagePositionId)).size).toBe(96);
    expect(cells.every((cell) => cell.storageRackId === rackId)).toBe(true);
    expect(cells.map((cell) => cell.storagePositionId)).toContain(`${rackId}:A01`);
    expect(cells[0].positionCode).toBe('A01');
    expect(cells[95].positionCode).toBe('H12');
    expect((await get(`/racks/${rackId}/positions`, techB)).status()).toBe(403);

    // RF016 AC3: the chain resolves link by link, for the custodian only.
    const location = await get(`/specimens/${specimenId}/location`, techA);
    expect(location.status(), await location.text()).toBe(200);
    expect((await location.json()).data).toMatchObject({ containerId, storagePositionId: `${rackId}:A01`, storageRackId: rackId, storageLocationId: freezerId });
    expect((await get(`/specimens/${specimenId}/location`, techB)).status()).toBe(403);

    // RF017 AC2, RULE-030, RF016 AC2: an occupied position refuses a second
    // container over any interval that meets the open placement, checked
    // half-open; rack, position and container stay separate records. The
    // rack is located above, so the empty, unplaced container is in scope.
    const P = Date.parse(placedAt);
    const second = await post('/containers', coordA, { containerId: secondContainerId, containerType: 'cryovial' });
    expect(second.status(), await second.text()).toBe(201);
    const occupied = await post(`/containers/${secondContainerId}/position`, techA, { storagePositionId: `${rackId}:A01` });
    expect(occupied.status(), await occupied.text()).toBe(409);
    expect((await occupied.json()).error).toBe('ASSIGNMENT_OVERLAP');
    const straddling = await post(`/containers/${secondContainerId}/position`, techA, {
      storagePositionId: `${rackId}:A01`, placedAt: iso(P - 3_600_000), removedAt: iso(P + 1_000),
    });
    expect(straddling.status(), await straddling.text()).toBe(409);
    expect((await straddling.json()).error).toBe('ASSIGNMENT_OVERLAP');
    const before = await post(`/containers/${secondContainerId}/position`, techA, {
      storagePositionId: `${rackId}:A01`, placedAt: iso(P - 3_600_000), removedAt: placedAt,
    });
    expect(before.status(), await before.text()).toBe(201);
    expect((await before.json()).data.assignmentStatus).toBe('ended');
    const besides = await post(`/containers/${secondContainerId}/position`, techA, { storagePositionId: `${rackId}:A02` });
    expect(besides.status(), await besides.text()).toBe(201);
    expect((await besides.json()).data).toMatchObject({ containerId: secondContainerId, storagePositionId: `${rackId}:A02` });
    const stillA01 = await get(`/specimens/${specimenId}/location`, techA);
    expect(stillA01.status(), await stillA01.text()).toBe(200);
    expect((await stillA01.json()).data).toMatchObject({ containerId, storagePositionId: `${rackId}:A01`, storageRackId: rackId, storageLocationId: freezerId });

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

    // RF016 AC5: code_128 and qr_code labels on the tube resolve like its
    // Data Matrix, another symbology is refused, and a rack's linear code
    // reads as a rack, not a container, leaving no ScanEvent.
    for (const [encodedValue, symbology] of [[code128Value, 'code_128'], [qrValue, 'qr_code']]) {
      const extra = await post(`/containers/${containerId}/labels`, coordA, { ...labelBody, encodedValue, symbology, printBatchId: `batch-${symbology}-${suffix}` });
      expect(extra.status(), await extra.text()).toBe(201);
      expect((await extra.json()).data).toMatchObject({ symbology, targetType: 'container', targetId: containerId });
    }
    const ean = await post(`/containers/${containerId}/labels`, coordA, { ...labelBody, encodedValue: `BVA2:synthetic:ean-${suffix}`, symbology: 'ean_13' });
    expect(ean.status(), await ean.text()).toBe(422);
    expect((await ean.json()).error).toBe('VALIDATION_ERROR');
    for (const linear of [
      { rawValue: `]C1${code128Value}`, symbology: 'code_128', deviceId: scannerId },
      { rawValue: `]Q1${qrValue}`, symbology: 'qr_code', deviceId: scannerId },
    ]) {
      const read = await post('/scan', techA, linear);
      expect(read.status(), await read.text()).toBe(200);
      expect((await read.json()).data).toMatchObject({ resolved: true, specimenId, containerId });
    }
    expect(await countScanEvents(specimenId)).toBe(3);
    // #1528: the rack's code is issued through its own route, in code_128
    // only, and a container's id is not a rack.
    const rackLabelBody = { ...labelBody, encodedValue: rackCode, symbology: 'code_128', carrierPlacement: 'front', printBatchId: `batch-rack-${suffix}` };
    const notRack = await post(`/racks/${containerId}/labels`, coordA, rackLabelBody);
    expect(notRack.status(), await notRack.text()).toBe(404);
    expect((await notRack.json()).error).toBe('RACK_NOT_FOUND');
    const rackMatrix = await post(`/racks/${rackId}/labels`, coordA, { ...rackLabelBody, symbology: 'data_matrix' });
    expect(rackMatrix.status(), await rackMatrix.text()).toBe(422);
    expect((await rackMatrix.json()).error).toBe('VALIDATION_ERROR');
    const rackIssued = await post(`/racks/${rackId}/labels`, coordA, rackLabelBody);
    expect(rackIssued.status(), await rackIssued.text()).toBe(201);
    expect((await rackIssued.json()).data).toMatchObject({ targetType: 'storage_rack', targetId: rackId, symbology: 'code_128', status: 'active' });
    const rackScan = await post('/scan', techA, { rawValue: `]C1${rackCode}`, symbology: 'code_128', deviceId: scannerId });
    expect(rackScan.status(), await rackScan.text()).toBe(200);
    const rackRead = (await rackScan.json()).data;
    expect(rackRead).toMatchObject({ resolved: false, reason: 'NOT_A_CONTAINER' });
    expect(rackRead.label).toMatchObject({ targetType: 'storage_rack', targetId: rackId, symbology: 'code_128' });
    expect(await countScanEvents(specimenId)).toBe(3);

    // RF017 AC6/AC8: the scanner is moved, then retired; its history keeps
    // all four events in order, and a retired scanner is refused.
    const moved = await device(`/${scannerId}/events`, { eventType: 'moved', locationId: roomId });
    expect(moved.status(), await moved.text()).toBe(201);
    const retired = await device(`/${scannerId}/events`, { eventType: 'retired', reason: 'synthetic e2e' });
    expect(retired.status(), await retired.text()).toBe(201);
    const fullRead = await request.get(`${apiBaseURL}/api/devices/${scannerId}`, { headers: techA });
    expect(fullRead.status(), await fullRead.text()).toBe(200);
    const fullDevice = (await fullRead.json()).data;
    const fullHistory = fullDevice.history as Array<{ eventType: string; locationId?: string }>;
    expect(fullHistory.map((e) => e.eventType)).toEqual(['installed', 'qualified', 'moved', 'retired']);
    expect(fullHistory[2]).toMatchObject({ eventType: 'moved', locationId: roomId });
    expect(fullDevice.currentLocationId).toBeNull();
    expect(fullDevice.retiredAt).toBeTruthy();
    const afterRetire = await post('/scan', techA, scan);
    expect(afterRetire.status(), await afterRetire.text()).toBe(422);
    expect((await afterRetire.json()).error).toBe('DEVICE_UNUSABLE');
    expect(await countScanEvents(specimenId)).toBe(3);

    // RF021 AC6: with the approval suspended, the specimen cannot be loaded
    // again; restored, it can.
    const unloaded = await post(`/specimen-assignments/${load.specimenContainerAssignmentId}/unload`, techA);
    expect(unloaded.status(), await unloaded.text()).toBe(200);
    const unload = (await unloaded.json()).data;
    await setApprovalStatus(fixture.approvalId, 'suspended');
    const inactive = await post(`/containers/${containerId}/specimens`, techA, { specimenId });
    expect(inactive.status(), await inactive.text()).toBe(422);
    expect((await inactive.json()).error).toBe('CUSTODY_INACTIVE');
    await setApprovalStatus(fixture.approvalId, 'active');

    // RF006 AC6: an active legal hold on the specimen stops loading it;
    // released, it loads.
    const holdRes = await request.post(`${apiBaseURL}/api/legal-holds`, {
      headers: coordA,
      data: { targetEntityType: 'Specimen', targetEntityIds: [specimenId], reason: 'synthetic e2e hold' },
    });
    expect(holdRes.status(), await holdRes.text()).toBe(201);
    const hold = (await holdRes.json()).data as { legalHoldId: string };
    const heldLoad = await post(`/containers/${containerId}/specimens`, techA, { specimenId });
    expect(heldLoad.status(), await heldLoad.text()).toBe(409);
    expect((await heldLoad.json()).error).toBe('LEGAL_HOLD_ACTIVE');
    const released = await request.post(`${apiBaseURL}/api/legal-holds/${hold.legalHoldId}/release`, { headers: coordA, data: { releaseReason: 'synthetic e2e release' } });
    expect(released.status(), await released.text()).toBe(200);

    const reloaded = await post(`/containers/${containerId}/specimens`, techA, { specimenId });
    expect(reloaded.status(), await reloaded.text()).toBe(201);

    // RF017 AC4: a specimen is in one container at a time, checked
    // half-open: the open reload and the closed first load each refuse a
    // second container; an interval ending where the first load starts fits.
    const L = load.loadedAt as string;
    const U = unload.unloadedAt as string;
    const twice = await post(`/containers/${secondContainerId}/specimens`, techA, { specimenId });
    expect(twice.status(), await twice.text()).toBe(409);
    expect((await twice.json()).error).toBe('ASSIGNMENT_OVERLAP');
    const sameInterval = await post(`/containers/${secondContainerId}/specimens`, techA, { specimenId, loadedAt: L, unloadedAt: U });
    expect(sameInterval.status(), await sameInterval.text()).toBe(409);
    expect((await sameInterval.json()).error).toBe('ASSIGNMENT_OVERLAP');
    const backDated = await post(`/containers/${secondContainerId}/specimens`, techA, { specimenId, loadedAt: iso(Date.parse(L) - 3_600_000), unloadedAt: L });
    expect(backDated.status(), await backDated.text()).toBe(201);
    expect((await backDated.json()).data.assignmentStatus).toBe('ended');
  });

  // #1314: an empty tube holds no specimen, so it is in scope through the
  // location its rack is at (P1X-0103). The Tecnico places it and the
  // Coordenador labels it; another organization's are refused.
  test("an empty tube is placed and labelled by the holder of its rack's location only", async ({ request }) => {
    const admin = await realLogin(request);
    const adminAuth = { Authorization: `Bearer ${admin.token}` };
    const makeOrg = async (label: string) => {
      const res = await request.post(`${apiBaseURL}/api/organizations`, {
        headers: adminAuth,
        data: { officialName: `#1314 empty ${label} ${suffix}`, countryCode: 'BR' },
      });
      expect(res.ok(), await res.text()).toBeTruthy();
      const organizationId = (await res.json()).data.organizationId as string;
      organizationIds.push(organizationId);
      return organizationId;
    };
    const orgA = await makeOrg('A');
    const orgB = await makeOrg('B');
    const coordA = await registerUser(request, adminAuth, 'emptyCoordA', 3, 'Coordenador', orgA);
    const coordB = await registerUser(request, adminAuth, 'emptyCoordB', 3, 'Coordenador', orgB);
    const techA = await registerUser(request, adminAuth, 'emptyTechA', 2, 'Técnico', orgA);
    const techB = await registerUser(request, adminAuth, 'emptyTechB', 2, 'Técnico', orgB);
    const samplesBefore = await countSamples();
    const post = (path: string, headers: Record<string, string>, data: Record<string, unknown> = {}) =>
      request.post(`${apiBaseURL}/api/physical-chain${path}`, { headers, data });

    const location = await post('/locations', coordA, { storageLocationId: emptyLocationId, locationType: 'freezer', name: 'Freezer vazio', code: `FZE-${suffix}`, organizationId: orgA });
    expect(location.status(), await location.text()).toBe(201);
    const located = await post(`/racks/${emptyRackId}/location`, coordA, { storageLocationId: emptyLocationId });
    expect(located.status(), await located.text()).toBe(201);
    const created = await post('/containers', coordA, { containerId: emptyContainerId, containerType: 'cryovial' });
    expect(created.status(), await created.text()).toBe(201);

    const foreignPlace = await post(`/containers/${emptyContainerId}/position`, techB, { storagePositionId: `${emptyRackId}:A01` });
    expect(foreignPlace.status(), await foreignPlace.text()).toBe(403);
    expect((await foreignPlace.json()).error).toBe('CONTAINER_OUT_OF_SCOPE');
    const placed = await post(`/containers/${emptyContainerId}/position`, techA, { storagePositionId: `${emptyRackId}:A01` });
    expect(placed.status(), await placed.text()).toBe(201);

    const labelBody = {
      encodedValue: emptyTubeCode, symbology: 'data_matrix', identifierOrigin: 'institution_applied', namespaceRegistryId: 'ns-chain',
      carrierPlacement: 'side', immutableAtSource: true, templateVersionId: 'tpl-chain', printBatchId: `batch-empty-${suffix}`,
    };
    const foreignLabel = await post(`/containers/${emptyContainerId}/labels`, coordB, labelBody);
    expect(foreignLabel.status(), await foreignLabel.text()).toBe(403);
    expect((await foreignLabel.json()).error).toBe('CONTAINER_OUT_OF_SCOPE');
    const issued = await post(`/containers/${emptyContainerId}/labels`, coordA, labelBody);
    expect(issued.status(), await issued.text()).toBe(201);
    expect((await issued.json()).data).toMatchObject({ targetType: 'container', targetId: emptyContainerId, status: 'active' });

    // RF016 AC1: the empty tube's code reads as an empty container; no
    // Specimen exists for it and none is created.
    const device = (path: string, data: Record<string, unknown>) => request.post(`${apiBaseURL}/api/devices${path}`, { headers: coordA, data });
    const registered = await device('', { deviceId: emptyScannerId, deviceType: 'scanner', maintenanceRecords: ['maint-chain'] });
    expect(registered.status(), await registered.text()).toBe(201);
    const installed = await device(`/${emptyScannerId}/events`, { eventType: 'installed', locationId: emptyLocationId });
    expect(installed.status(), await installed.text()).toBe(201);
    const qualified = await device(`/${emptyScannerId}/events`, { eventType: 'qualified', evidenceUri: 'object://synthetic/scanner-pq.pdf' });
    expect(qualified.status(), await qualified.text()).toBe(201);
    const scanned = await post('/scan', techA, { rawValue: `]d2${emptyTubeCode}`, symbology: 'data_matrix', deviceId: emptyScannerId });
    expect(scanned.status(), await scanned.text()).toBe(200);
    const read = (await scanned.json()).data;
    expect(read).toMatchObject({ resolved: false, reason: 'EMPTY_CONTAINER', containerId: emptyContainerId });
    expect(read.specimenId).toBeUndefined();
    expect(await containerContent(emptyContainerId)).toEqual({ emptyStatus: 'empty', specimenAssignments: 0 });
    expect(await countSamples()).toBe(samplesBefore);
  });

  // #1514: a run of the ex ante protocol is authorized only once the stored
  // protocol is approved_for_execution, on synthetic data (RF016 AC7,
  // RULE-037). Registering it is topology work, the Coordenador's.
  test('an ex ante protocol runs only once approved_for_execution (RF016 AC7, RULE-037)', async ({ request }) => {
    const admin = await realLogin(request);
    const adminAuth = { Authorization: `Bearer ${admin.token}` };
    const makeOrg = async (label: string) => {
      const res = await request.post(`${apiBaseURL}/api/organizations`, {
        headers: adminAuth,
        data: { officialName: `#1514 protocol ${label} ${suffix}`, countryCode: 'BR' },
      });
      expect(res.ok(), await res.text()).toBeTruthy();
      const organizationId = (await res.json()).data.organizationId as string;
      organizationIds.push(organizationId);
      return organizationId;
    };
    const org = await makeOrg('P');
    const protoCoord = await registerUser(request, adminAuth, 'protoCoord', 3, 'Coordenador', org);
    const protoTech = await registerUser(request, adminAuth, 'protoTech', 2, 'Técnico', org);
    const post = (path: string, headers: Record<string, string>, data: Record<string, unknown> = {}) =>
      request.post(`${apiBaseURL}/api/physical-chain${path}`, { headers, data });

    const draftVersion = `1.0.0-e2e.draft.${suffix}`;
    const approvedVersion = `1.0.0-e2e.approved.${suffix}`;
    protocolVersions.push(draftVersion, approvedVersion);
    const protocolBody = (over: Record<string, unknown>) => ({
      scope: 'ex_ante_synthetic',
      evidenceUri: 'object://evidence/BioAvanceD_Protocolo_Avaliacao_Ex_Ante_Identificacao_Fisica_v1.0.0.docx',
      evidenceHash: '6ce782d763976a8ec4a106e6a212d13b2e838a0bd5b19db146418472a7c787f1',
      approvedSymbologies: ['data_matrix'],
      fixtureCatalogRefs: ['catalog:vial:synthetic-001'],
      realSpecimenUse: false,
      ...over,
    });

    const refused = await post('/validation-protocols', protoTech, protocolBody({ protocolVersion: draftVersion }));
    expect(refused.status(), await refused.text()).toBe(403);

    const draft = await post('/validation-protocols', protoCoord, protocolBody({ protocolVersion: draftVersion }));
    expect(draft.status(), await draft.text()).toBe(201);
    const draftId = (await draft.json()).data.physicalIdentificationValidationProtocolId as string;
    const draftRun = await post(`/validation-protocols/${draftId}/executions`, protoTech);
    expect(draftRun.status(), await draftRun.text()).toBe(409);
    expect((await draftRun.json()).error).toBe('PROTOCOL_NOT_EXECUTABLE');

    const approved = await post('/validation-protocols', protoCoord, protocolBody({
      protocolVersion: approvedVersion, approvalStatus: 'approved_for_execution', approvedAt: '2026-09-12T20:00:00.000Z',
    }));
    expect(approved.status(), await approved.text()).toBe(201);
    const approvedId = (await approved.json()).data.physicalIdentificationValidationProtocolId as string;
    const run = await post(`/validation-protocols/${approvedId}/executions`, protoTech);
    expect(run.status(), await run.text()).toBe(200);
    expect((await run.json()).data).toMatchObject({ approvalStatus: 'approved_for_execution', realSpecimenUse: false });
  });
});

// #1363 (RF026 AC6): a specimen's destruction or transfer executes only when
// compatible with custody, the collection's ethics approval and, for a
// transfer, the participant's consent. The fixture specimen names no
// participant, so its transfer can never pass the consent rule. The
// collection names an ethics approval (#1509): suspended, it refuses the
// destruction with the ethics rule; restored, the destruction executes. Each
// action is approved first, as a policy with review requires (RNF022 AC4).
test.describe('Disposition compatibility (#1363, RF026 AC6) — real backend', () => {
  const organizationIds: string[] = [];
  let fixture: CustodyFixture | null = null;
  const suffix = `disp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  test.afterAll(async ({ request }) => {
    if (fixture) await cleanupCustodyFixture(fixture, [], [], [], []).catch(() => {});
    await deleteOrganizations(request, apiBaseURL!, organizationIds);
    await closeCustodyDb();
  });

  test('a specimen destruction waits for custody and the collection\'s ethics approval, and a transfer without consent is refused', async ({ request }) => {
    const admin = await realLogin(request);
    const auth = { Authorization: `Bearer ${admin.token}` };
    const org = await request.post(`${apiBaseURL}/api/organizations`, { headers: auth, data: { officialName: `#1363 custodian ${suffix}`, countryCode: 'BR' } });
    expect(org.ok(), await org.text()).toBeTruthy();
    const organizationId = (await org.json()).data.organizationId as string;
    organizationIds.push(organizationId);
    fixture = await seedCustodyFixture(suffix, organizationId);
    const ethicsApprovalId = await seedEthicsApproval(fixture);
    const { specimenId, approvalId } = fixture;

    const policy = await request.post(`${apiBaseURL}/api/retention-policies`, {
      headers: auth,
      data: {
        applicableEntityTypes: ['Specimen'],
        triggerEvent: 'creation',
        postRetentionAction: 'destroy',
        retentionPeriod: 'P365D',
        jurisdiction: 'BR',
        retentionBasis: ['RF026 AC6 e2e fixture basis'],
        legalHoldRules: [{ when: 'legalHold=true', block: 'destroy' }],
        reviewRequired: true,
      },
    });
    expect(policy.status(), await policy.text()).toBe(201);
    const retentionPolicyId = String((await policy.json()).data._id);
    const plan = async (dispositionAction: string) => {
      const res = await request.post(`${apiBaseURL}/api/disposition-actions`, {
        headers: auth,
        data: { retentionPolicyId, entityType: 'Specimen', affectedRecordIds: [specimenId], dispositionAction },
      });
      expect(res.status(), await res.text()).toBe(201);
      const base = `${apiBaseURL}/api/disposition-actions/${(await res.json()).data.dispositionActionId}`;
      const approved = await request.post(`${base}/approve`, { headers: auth });
      expect(approved.status(), await approved.text()).toBe(200);
      return base;
    };
    const execute = (base: string) => request.post(`${base}/execute`, { headers: auth, data: { evidenceIds: ['file-rf026-ac6'] } });

    // No custody holds the specimen: the destruction is refused and stays approved.
    const destroy = await plan('destroy');
    const refused = await execute(destroy);
    expect(refused.status(), await refused.text()).toBe(409);
    const refusedBody = await refused.json();
    expect(refusedBody.code).toBe('DISPOSITION_INCOMPATIBLE');
    expect(refusedBody.unsatisfied).toEqual([expect.objectContaining({ specimenId, rule: 'custody' })]);
    expect((await (await request.get(destroy, { headers: auth })).json()).data.actionStatus).toBe('approved');

    const custody = await request.post(`${apiBaseURL}/api/physical-chain/custody`, {
      headers: auth,
      data: { specimenId, custodianOrganizationId: organizationId, authorizationId: approvalId, responsibleInvestigatorId: 'inv-disp' },
    });
    expect(custody.status(), await custody.text()).toBe(201);

    // In custody, a transfer still needs the participant's consent.
    const transfer = await execute(await plan('transfer'));
    expect(transfer.status(), await transfer.text()).toBe(409);
    expect((await transfer.json()).unsatisfied).toEqual([expect.objectContaining({ specimenId, rule: 'consent' })]);

    // In custody, a suspended ethics approval still refuses the destruction,
    // naming the approval, and the action stays approved.
    await setApprovalStatus(ethicsApprovalId, 'suspended');
    const unethical = await execute(destroy);
    expect(unethical.status(), await unethical.text()).toBe(409);
    const unethicalBody = await unethical.json();
    expect(unethicalBody.code).toBe('DISPOSITION_INCOMPATIBLE');
    expect(unethicalBody.unsatisfied).toEqual([
      expect.objectContaining({ specimenId, rule: 'ethics', message: expect.stringContaining(ethicsApprovalId) }),
    ]);
    expect((await (await request.get(destroy, { headers: auth })).json()).data.actionStatus).toBe('approved');

    await setApprovalStatus(ethicsApprovalId, 'active');
    const executed = await execute(destroy);
    expect(executed.status(), await executed.text()).toBe(200);
    expect((await executed.json()).data.actionStatus).toBe('executed');
  });
});
