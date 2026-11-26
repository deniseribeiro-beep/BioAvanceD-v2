import { test, expect, type APIRequestContext } from '@playwright/test';
import { realLogin } from './helpers/realAuth';
import { deleteOrganizations } from './helpers/listOrganizations';
import {
  setEquipmentOrganization,
  specimenChainRows,
  rackLocationRows,
  storageLocationById,
  countStorageAssignments,
  cleanupSpecimenChains,
  closeChainDb,
  type ChainPositionRow,
} from './helpers/queryPhysicalChain';
import {
  createRealParticipant,
  seedActiveConsent,
  seedStorageBoxLocation,
  cleanupStorageBoxLocation,
  closeSeedDb,
  type SeededStorageBox,
} from './helpers/seedParticipant';
import { watchAuditTrail, assertAuditEventRecorded } from './helpers/assertAuditEvent';
import {
  seedGovernedCollection,
  cleanupGovernedCollection,
  closeGovernedCollectionDb,
  type GovernedCollection,
} from './helpers/seedGovernedCollection';
import {
  sampleMongoId,
  sampleOutboxEvents,
  expectedPayloadHash,
  expectedIdempotencyKey,
  seedActiveSpecimenLabel,
  removeSpecimenLabels,
  countAbortedWrites,
  closeOutboxDb,
} from './helpers/queryOutbox';

// Real backend only — see backend-integration.spec.ts for the same skip
// rationale. Run via `npm run test:e2e:docker` against the compose test
// stack (or a locally running backend), never the mocked suite.
const apiBaseURL = process.env.PLAYWRIGHT_API_BASE_URL;

test.skip(!apiBaseURL, 'PLAYWRIGHT_API_BASE_URL not set — run via npm run test:e2e:docker');

// #321: AllocateSampleUseCase/MoveSampleUseCase/ReleaseSampleUseCase
// (api/backend/src/core/use-cases/) all route their state + audit writes
// through MongoStorageRepository.withTransaction, which requires a replica
// set (mongodb-test has run one since #297 fixed RF006 AC#6 atomicity) —
// a standalone mongod rejects client.startSession() outright. No existing
// e2e spec drove any of these three use cases' execute() path before this
// file (confirmed: no route/UI flow other than storageApi.ts's allocate/
// move/release calls, and inline-storage-movement.spec.ts only mocks those
// HTTP calls, never exercising the real backend), so the transaction path
// was never proven against the real stack.
// #1220: the storage responses echo the canonical specimenId.

function validSampleFields() {
  return {
    sampleType: 'PLASMA',
    sampleOrigin: 'VENOUS_BLOOD',
    extractionProtocol: 'TUBE_EDTA',
    quantity: 5,
    quality: 'GOOD',
    linkedProject: 'RF006 storage-lifecycle e2e fixture',
    registeredAt: new Date().toISOString(),
  };
}

// #1499: the canonical model release every outbox event carries
// (foundation/readiness.js), the literal audit-chain-integrity.spec.ts uses.
const CANONICAL_MODEL_RELEASE_ID = 'release-2.0.0';

type OutboxEvent = Awaited<ReturnType<typeof sampleOutboxEvents>>[number];

// [aggregateVersion, eventType, payload.custodyEventType ?? null] per event.
function eventTuples(events: OutboxEvent[]) {
  return events.map((e) => [e.aggregateVersion, e.eventType, e.payload?.custodyEventType ?? null]);
}

// #1499 (RF023 AC1/AC2, RNF019 C2): every event carries the versioned
// contract, and its hash and key equal the outbox service's own formulas.
function expectEventContract(events: OutboxEvent[], mongoId: string) {
  for (const event of events) {
    expect(event.eventTypeVersion).toBe('1');
    expect(event.schemaVersion).toBe(1);
    expect(event.canonicalModelReleaseId).toBe(CANONICAL_MODEL_RELEASE_ID);
    expect(event.aggregateType).toBe('Sample');
    expect(event.aggregateId).toBe(mongoId);
    expect(event.payloadHash).toMatch(/^[0-9a-f]{64}$/);
    expect(event.payloadHash).toBe(expectedPayloadHash(event.payload));
    expect(event.idempotencyKey).toMatch(/^[0-9a-f]{64}$/);
    expect(event.idempotencyKey).toBe(expectedIdempotencyKey(event));
  }
  expect(new Set(events.map((e) => e.idempotencyKey)).size).toBe(events.length);
}

// #1508 (RF017 AC4): a container holds one position at a time, so no two of
// its position rows' half-open [placedAt, removedAt) intervals intersect, and
// each row closes no later than the next one opens.
function expectNoOverlappingPositions(positions: ChainPositionRow[]) {
  const end = (row: ChainPositionRow) => (row.removedAt === null ? Number.POSITIVE_INFINITY : Date.parse(row.removedAt));
  for (let i = 0; i + 1 < positions.length; i += 1) {
    expect(positions[i].removedAt).not.toBeNull();
    expect(Date.parse(positions[i].removedAt!)).toBeLessThanOrEqual(Date.parse(positions[i + 1].placedAt));
  }
  for (let i = 0; i < positions.length; i += 1) {
    for (let j = i + 1; j < positions.length; j += 1) {
      const intersects =
        Date.parse(positions[i].placedAt) < end(positions[j]) && Date.parse(positions[j].placedAt) < end(positions[i]);
      expect(intersects, `${positions[i].containerPositionAssignmentId} overlaps ${positions[j].containerPositionAssignmentId}`).toBe(false);
    }
  }
}

test.describe('Sample storage lifecycle (#321) — real backend, withTransaction proof', () => {
  const seededStorageBoxes: SeededStorageBox[] = [];
  const seededLabelCodes: string[] = [];
  // #1508: the organizations the seeded equipment is given, and the
  // specimens whose physical-chain rows the afterAll removes.
  const organizationIds: string[] = [];
  const chainSpecimenIds: string[] = [];
  // #1497 (RF004 AC2): the collection these specimens enter.
  let governed: GovernedCollection | null = null;

  test.beforeAll(async () => {
    governed = await seedGovernedCollection(`storage-lifecycle-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
  });

  test.afterAll(async ({ request }) => {
    await cleanupSpecimenChains(chainSpecimenIds, seededStorageBoxes).catch(() => {});
    await Promise.all(
      seededStorageBoxes.map((box) => cleanupStorageBoxLocation(box).catch(() => {}))
    );
    await removeSpecimenLabels(seededLabelCodes).catch(() => {});
    await deleteOrganizations(request, apiBaseURL!, organizationIds);
    await cleanupGovernedCollection(governed);
    await closeGovernedCollectionDb();
    await closeOutboxDb();
    await closeSeedDb();
    await closeChainDb();
  });

  // #1508: the legacy path resolves a rack's StorageLocation through the
  // freezer equipment's organization (P1X-0103), so each test gives its
  // seeded equipment one before the first placement.
  async function makeOrganization(request: APIRequestContext, token: string): Promise<string> {
    const res = await request.post(`${apiBaseURL}/api/organizations`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { officialName: `#1508 legacy chain ${Date.now()}`, countryCode: 'BR' },
    });
    expect(res.ok(), await res.text()).toBeTruthy();
    const organizationId = (await res.json()).data.organizationId as string;
    organizationIds.push(organizationId);
    return organizationId;
  }

  // RF016 AC3: where the chain says the specimen is, now or at `at`.
  async function readLocation(request: APIRequestContext, token: string, specimenId: string, at?: string) {
    const query = at ? `?at=${encodeURIComponent(at)}` : '';
    const res = await request.get(`${apiBaseURL}/api/physical-chain/specimens/${specimenId}/location${query}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status(), await res.text()).toBe(200);
    return (await res.json()).data;
  }

  test('allocate (at create) -> move -> release -> allocate all commit through the real Mongo replica-set transaction', async ({
    request,
  }) => {
    const admin = await realLogin(request);
    const participant = await createRealParticipant(request, apiBaseURL!, admin.token);
    await seedActiveConsent(participant.participantId);

    // Two independent box hierarchies so move has a genuinely different
    // target, and so re-allocating back to boxA later isn't blocked by
    // boxA's own A1 slot still being occupied.
    const boxA = await seedStorageBoxLocation();
    const boxB = await seedStorageBoxLocation();
    seededStorageBoxes.push(boxA, boxB);
    const org = await makeOrganization(request, admin.token);
    await setEquipmentOrganization(boxA.equipmentId, org);
    await setEquipmentOrganization(boxB.equipmentId, org);

    const create = await request.post(`${apiBaseURL}/api/samples`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: {
        participantId: participant.participantId,
        ...validSampleFields(),
        boxId: boxA.boxId,
        positionCode: boxA.positionCode,
        collectionId: governed!.collectionId,
      },
    });
    expect([201, 202]).toContain(create.status());
    const sampleId = (await create.json()).data.specimenId;
    expect(sampleId).toBeTruthy();
    chainSpecimenIds.push(sampleId);

    // #1508 (RF016 AC3): the allocation at create loads the specimen into a
    // container and places it at boxA's A01, the box (as a StorageRack)
    // located at its RACK storageContainer's StorageLocation.
    const atCreate = await readLocation(request, admin.token, sampleId);
    expect(atCreate).toMatchObject({ storagePositionId: `${boxA.boxId}:A01`, storageRackId: boxA.boxId });
    const containerId = atCreate.containerId as string;
    expect(containerId).toBeTruthy();
    const locationA = atCreate.storageLocationId as string;
    expect(locationA).toBeTruthy();
    expect(await storageLocationById(locationA)).toEqual({
      code: `legacy-storage-container:${boxA.rackId}`,
      organizationId: org,
    });
    const chainAtCreate = await specimenChainRows(sampleId);
    expect(chainAtCreate.positions).toHaveLength(1);

    // #1499 (RF023 AC1/AC2, RNF019 C2): the create appends exactly three
    // Sample events at versions 1..3 -- the allocation's custody event, the
    // SPECIMEN_UPSERTED, then the register custody event -- each with the
    // versioned contract.
    const mongoId = await sampleMongoId(sampleId);
    const createEvents = await sampleOutboxEvents(mongoId);
    const createTuples = [
      [1, 'CUSTODY_EVENT_RECORDED', 'allocate'],
      [2, 'SPECIMEN_UPSERTED', null],
      [3, 'CUSTODY_EVENT_RECORDED', 'register'],
    ];
    expect(eventTuples(createEvents)).toEqual(createTuples);
    expectEventContract(createEvents, mongoId);

    // --- MoveSampleUseCase#execute -> withTransaction ---
    const moveWatch = await watchAuditTrail(request, apiBaseURL!, admin.token);
    const move = await request.post(`${apiBaseURL}/api/storage/move`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: {
        sampleId,
        targetBoxId: boxB.boxId,
        targetPosition: boxB.positionCode,
        reason: 'e2e storage-lifecycle move',
      },
    });
    expect(move.status()).toBe(200);
    const moveBody = await move.json();
    expect(moveBody.success).toBe(true);
    expect(moveBody.data.specimenId).toBe(sampleId);
    expect(moveBody.data.to).toEqual({ boxId: boxB.boxId, position: boxB.positionCode });
    await assertAuditEventRecorded(request, apiBaseURL!, admin.token, moveWatch);

    const afterMove = await request.get(`${apiBaseURL}/api/storage/sample/${sampleId}`, {
      headers: { Authorization: `Bearer ${admin.token}` },
    });
    expect(afterMove.status()).toBe(200);
    const afterMoveBody = await afterMove.json();
    expect(afterMoveBody.data.box.boxId).toBe(boxB.boxId);
    expect(afterMoveBody.data.box.position).toBe(boxB.positionCode);

    // #1508 (RF017 AC3): the chain follows the legacy move, same container.
    const atMove = await readLocation(request, admin.token, sampleId);
    expect(atMove).toMatchObject({ containerId, storagePositionId: `${boxB.boxId}:A01`, storageRackId: boxB.boxId });
    const locationB = atMove.storageLocationId as string;
    expect(locationB).toBeTruthy();
    expect(locationB).not.toBe(locationA);
    expect((await storageLocationById(locationB))?.code).toBe(`legacy-storage-container:${boxB.rackId}`);

    // --- ReleaseSampleUseCase#execute -> withTransaction ---
    const releaseWatch = await watchAuditTrail(request, apiBaseURL!, admin.token);
    const release = await request.delete(`${apiBaseURL}/api/storage/release/${sampleId}`, {
      headers: { Authorization: `Bearer ${admin.token}` },
    });
    expect(release.status()).toBe(200);
    const releaseBody = await release.json();
    expect(releaseBody.success).toBe(true);
    expect(releaseBody.data.specimenId).toBe(sampleId);
    expect(releaseBody.data.boxId).toBe(boxB.boxId);
    await assertAuditEventRecorded(request, apiBaseURL!, admin.token, releaseWatch);

    const afterRelease = await request.get(`${apiBaseURL}/api/storage/sample/${sampleId}`, {
      headers: { Authorization: `Bearer ${admin.token}` },
    });
    // getSampleStorageLocation returns found:false (not a 404) once
    // storageLocation is unset — see GetSampleStorageLocationUseCase's
    // "no location" branch, distinct from SAMPLE_NOT_FOUND.
    expect(afterRelease.status()).toBe(400);
    const afterReleaseBody = await afterRelease.json();
    expect(afterReleaseBody.success).toBe(false);

    // #1508: the release takes the container off its position; the
    // specimen stays loaded in it.
    expect(await readLocation(request, admin.token, sampleId)).toMatchObject({
      containerId,
      storagePositionId: null,
      storageRackId: null,
      storageLocationId: null,
    });

    // --- AllocateSampleUseCase#execute -> withTransaction (re-allocate a released sample) ---
    const allocateWatch = await watchAuditTrail(request, apiBaseURL!, admin.token);
    const allocate = await request.post(`${apiBaseURL}/api/storage/allocate`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: {
        sampleId,
        boxId: boxA.boxId,
        position: boxA.positionCode,
      },
    });
    expect(allocate.status()).toBe(201);
    const allocateBody = await allocate.json();
    expect(allocateBody.success).toBe(true);
    expect(allocateBody.data).toEqual({
      specimenId: sampleId,
      boxId: boxA.boxId,
      position: boxA.positionCode,
    });
    await assertAuditEventRecorded(request, apiBaseURL!, admin.token, allocateWatch);

    const afterAllocate = await request.get(`${apiBaseURL}/api/storage/sample/${sampleId}`, {
      headers: { Authorization: `Bearer ${admin.token}` },
    });
    expect(afterAllocate.status()).toBe(200);
    const afterAllocateBody = await afterAllocate.json();
    expect(afterAllocateBody.data.box.boxId).toBe(boxA.boxId);
    expect(afterAllocateBody.data.box.position).toBe(boxA.positionCode);

    // #1508: the re-allocate places the same container back at boxA's A01,
    // under boxA's same StorageLocation.
    expect(await readLocation(request, admin.token, sampleId)).toMatchObject({
      containerId,
      storagePositionId: `${boxA.boxId}:A01`,
      storageRackId: boxA.boxId,
      storageLocationId: locationA,
    });

    // #1499: move, release and the re-allocate each add one custody event at
    // the next version, and the contract still holds across all six.
    const finalEvents = await sampleOutboxEvents(mongoId);
    expect(eventTuples(finalEvents)).toEqual([
      ...createTuples,
      [4, 'CUSTODY_EVENT_RECORDED', 'move'],
      [5, 'CUSTODY_EVENT_RECORDED', 'release'],
      [6, 'CUSTODY_EVENT_RECORDED', 'allocate'],
    ]);
    expectEventContract(finalEvents, mongoId);

    // #1508 (RF016 AC3, RF017 AC4): the chain is append-only and its
    // intervals never overlap. One load, opened once and still open; each
    // legacy call closed or opened a position row, never rewrote one.
    const chain = await specimenChainRows(sampleId);
    expect(chain.loads).toHaveLength(1);
    expect(chain.loads[0]).toMatchObject({ containerId, assignmentStatus: 'active' });
    const { positions } = chain;
    expect(positions.map((p) => [p.storagePositionId, p.assignmentStatus])).toEqual([
      [`${boxA.boxId}:A01`, 'ended'],
      [`${boxB.boxId}:A01`, 'ended'],
      [`${boxA.boxId}:A01`, 'active'],
    ]);
    expect(positions[2].removedAt).toBeNull();
    expectNoOverlappingPositions(positions);
    // The move closes the old row and opens the new one at one instant.
    expect(positions[0].removedAt).toBe(positions[1].placedAt);
    expect(positions[0]).toMatchObject({
      containerPositionAssignmentId: chainAtCreate.positions[0].containerPositionAssignmentId,
      storagePositionId: chainAtCreate.positions[0].storagePositionId,
      placedAt: chainAtCreate.positions[0].placedAt,
    });
    // No legacy call moves a box, so each rack was located once and stays.
    const rackRowsA = await rackLocationRows(boxA.boxId);
    expect(rackRowsA).toHaveLength(1);
    expect(rackRowsA[0]).toMatchObject({ assignmentStatus: 'active', storageLocationId: locationA });
    const rackRowsB = await rackLocationRows(boxB.boxId);
    expect(rackRowsB).toHaveLength(1);
    expect(rackRowsB[0]).toMatchObject({ assignmentStatus: 'active', storageLocationId: locationB });

    // The history through the API, half-open: at the move instant the
    // specimen is already in boxB.
    expect((await readLocation(request, admin.token, sampleId, positions[0].placedAt)).storagePositionId).toBe(
      `${boxA.boxId}:A01`
    );
    expect((await readLocation(request, admin.token, sampleId, positions[1].placedAt)).storagePositionId).toBe(
      `${boxB.boxId}:A01`
    );

    // Nothing wrote a legacy StorageAssignment row, under either key.
    expect(await countStorageAssignments([sampleId, mongoId])).toBe(0);
  });

  test('a create whose label issue fails rolls back its sample, movement, allocation and outbox events together (RF023 AC3, RNF019 C1)', async ({
    request,
  }) => {
    const admin = await realLogin(request);
    const participant = await createRealParticipant(request, apiBaseURL!, admin.token);
    await seedActiveConsent(participant.participantId);
    const box = await seedStorageBoxLocation();
    seededStorageBoxes.push(box);

    // Opaque E2E<digits>-... codes pass the personal-data guard on barcodes.
    const suffix = Date.now();
    const taken = `E2E1499-${suffix}-T`;
    const fresh = `E2E1499-${suffix}-F`;
    const linkedProject = `E2E-1499-${suffix}`;
    seededLabelCodes.push(taken, fresh);
    await seedActiveSpecimenLabel(taken);

    const createBody = (barcode: string) => ({
      participantId: participant.participantId,
      ...validSampleFields(),
      linkedProject,
      barcode,
      boxId: box.boxId,
      positionCode: box.positionCode,
      collectionId: governed!.collectionId,
    });

    // The barcode pre-check reads only samples.barcode, so it passes; the
    // transaction then inserts, moves, allocates and appends the allocate
    // custody event before the label insert hits the unique active-label
    // index. The label message tells this apart from a STORAGE_COLLISION 409.
    const failed = await request.post(`${apiBaseURL}/api/samples`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: createBody(taken),
    });
    expect(failed.status()).toBe(409);
    const failedBody = await failed.json();
    expect(failedBody.message).toMatch(
      /^Falha ao emitir a etiqueta da amostra: Valor E2E1499-\d+-T já ativo neste namespace$/
    );

    // Nothing the aborted transaction wrote is left; the only label is the seeded one.
    expect(await countAbortedWrites({ linkedProject, barcode: taken, boxId: box.boxId })).toEqual({
      samples: 0,
      movements: 0,
      birthMovements: 0,
      custodyToBox: 0,
      labels: 1,
    });

    // Control: the same position is free, so a fresh code creates, and the
    // same queries now see exactly one of each (they are not vacuous).
    const retried = await request.post(`${apiBaseURL}/api/samples`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: createBody(fresh),
    });
    expect([201, 202]).toContain(retried.status());
    expect(await countAbortedWrites({ linkedProject, barcode: fresh, boxId: box.boxId })).toEqual({
      samples: 1,
      movements: 2,
      birthMovements: 1,
      custodyToBox: 1,
      labels: 1,
    });
  });

  test('allocate rejects a target position already occupied by another sample (STORAGE_COLLISION)', async ({
    request,
  }) => {
    const admin = await realLogin(request);
    const participant = await createRealParticipant(request, apiBaseURL!, admin.token);
    await seedActiveConsent(participant.participantId);

    const occupiedBox = await seedStorageBoxLocation();
    const freeBox = await seedStorageBoxLocation();
    seededStorageBoxes.push(occupiedBox, freeBox);

    // Sample 1 occupies occupiedBox/A1 from creation onward.
    const create1 = await request.post(`${apiBaseURL}/api/samples`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: {
        participantId: participant.participantId,
        ...validSampleFields(),
        boxId: occupiedBox.boxId,
        positionCode: occupiedBox.positionCode,
        collectionId: governed!.collectionId,
      },
    });
    expect([201, 202]).toContain(create1.status());

    // Sample 2 starts elsewhere, then gets released so it's free to allocate.
    const create2 = await request.post(`${apiBaseURL}/api/samples`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: {
        participantId: participant.participantId,
        ...validSampleFields(),
        boxId: freeBox.boxId,
        positionCode: freeBox.positionCode,
        collectionId: governed!.collectionId,
      },
    });
    expect([201, 202]).toContain(create2.status());
    const sample2Id = (await create2.json()).data.specimenId;

    const release2 = await request.delete(`${apiBaseURL}/api/storage/release/${sample2Id}`, {
      headers: { Authorization: `Bearer ${admin.token}` },
    });
    expect(release2.status()).toBe(200);

    const collidingAllocate = await request.post(`${apiBaseURL}/api/storage/allocate`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: {
        sampleId: sample2Id,
        boxId: occupiedBox.boxId,
        position: occupiedBox.positionCode,
      },
    });
    expect(collidingAllocate.status()).toBe(409);
    const collidingBody = await collidingAllocate.json();
    expect(collidingBody.success).toBe(false);
    expect(collidingBody.message).toMatch(/STORAGE_COLLISION/);
  });

  test('POST /allocate/auto (release -> auto-assign) commits through the real Mongo transaction, places the specimen on the physical chain, and frees the slot on release (#1015, #1508)', async ({
    request,
  }) => {
    const admin = await realLogin(request);
    const participant = await createRealParticipant(request, apiBaseURL!, admin.token);
    await seedActiveConsent(participant.participantId);

    // Two independent boxes: homeBox is only where the sample is created --
    // POST /api/samples makes boxId/positionCode mandatory (see
    // sample.service.js's normalizeRequiredStorageBoxAssignment, which
    // throws LOCATION_REQUIRED otherwise), so there is no way to create an
    // unallocated sample directly. autoBox is the untouched target
    // auto-assign picks its first free slot in -- untouched also matters
    // for auto-assign's own ALREADY_ALLOCATED pre-check/re-check pair
    // (storageService.js and MongoStorageRepository.js), which would
    // refuse a box the sample is already sitting in.
    const homeBox = await seedStorageBoxLocation();
    const autoBox = await seedStorageBoxLocation();
    seededStorageBoxes.push(homeBox, autoBox);
    const org = await makeOrganization(request, admin.token);
    await setEquipmentOrganization(homeBox.equipmentId, org);
    await setEquipmentOrganization(autoBox.equipmentId, org);

    const create = await request.post(`${apiBaseURL}/api/samples`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: {
        participantId: participant.participantId,
        ...validSampleFields(),
        boxId: homeBox.boxId,
        positionCode: homeBox.positionCode,
        collectionId: governed!.collectionId,
      },
    });
    expect([201, 202]).toContain(create.status());
    const sampleId = (await create.json()).data.specimenId;
    expect(sampleId).toBeTruthy();
    chainSpecimenIds.push(sampleId);

    // The only way to reach an unallocated sample: release it first, since
    // creation cannot skip boxId/positionCode.
    const release = await request.delete(`${apiBaseURL}/api/storage/release/${sampleId}`, {
      headers: { Authorization: `Bearer ${admin.token}` },
    });
    expect(release.status()).toBe(200);

    // #1508: released, the container is off its position, the specimen still in it.
    const afterFirstRelease = await readLocation(request, admin.token, sampleId);
    expect(afterFirstRelease).toMatchObject({ storagePositionId: null, storageRackId: null, storageLocationId: null });
    const containerId = afterFirstRelease.containerId as string;
    expect(containerId).toBeTruthy();

    // --- POST /api/storage/allocate/auto -> withTransaction ---
    // The one storage mutation endpoint with no real-backend coverage
    // before this test: inline-storage-movement.spec.ts's "auto-assign
    // path" test only page.route-mocks this exact URL and never reaches
    // the backend.
    const autoWatch = await watchAuditTrail(request, apiBaseURL!, admin.token);
    const autoAssign = await request.post(`${apiBaseURL}/api/storage/allocate/auto`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: {
        sampleId,
        boxId: autoBox.boxId,
      },
    });
    expect(autoAssign.status()).toBe(201);
    const autoAssignBody = await autoAssign.json();
    expect(autoAssignBody.success).toBe(true);
    // storageService.js's autoAssignSampleToBox returns its result under
    // `sampleLocation: { specimenId, boxId, position }`, which
    // auto-assign-sample.controller.js passes straight through as `data`
    // -- the key is `specimenId`, not `sampleId`.
    expect(autoAssignBody.data).toEqual({
      specimenId: sampleId,
      boxId: autoBox.boxId,
      // autoBox is a fresh, empty 8x12 box. storagePositionGrid.js's
      // findFirstAvailablePosition scans getAllValidPositions row-major
      // starting at row index 0 ('A'), column 1 -- so the deterministic
      // first free slot in an empty grid is 'A1'.
      position: 'A1',
    });
    // #988: autoAssignSampleToBox is the fourth storage endpoint to run a
    // Mongo transaction, and appends its own `auto_allocate` audit row
    // inside it, mirroring allocate/move/release's own rows.
    await assertAuditEventRecorded(request, apiBaseURL!, admin.token, autoWatch);
    // graphPersisted lives at the top level of the response body, not
    // nested under `data` (auto-assign-sample.controller.js's success
    // response spreads `result.graphPersisted` alongside `data`).
    //
    // graphPersisted: true means the placement's STORAGE_POSITION_ASSIGNED
    // outbox event was appended inside the same Mongo transaction as the
    // placement (storageService.js, #1313); it is false only when no
    // position was assigned. No Neo4j write runs on this request (#1312,
    // RF023 AC8): the projector writes Sample-[:STORED_AT]->StoragePosition
    // later, from the outbox.
    expect(autoAssignBody.graphPersisted).toBe(true);

    const afterAutoAssign = await request.get(`${apiBaseURL}/api/storage/sample/${sampleId}`, {
      headers: { Authorization: `Bearer ${admin.token}` },
    });
    expect(afterAutoAssign.status()).toBe(200);
    const afterAutoAssignBody = await afterAutoAssign.json();
    expect(afterAutoAssignBody.data.box.boxId).toBe(autoBox.boxId);
    expect(afterAutoAssignBody.data.box.position).toBe('A1');

    // #1508 (RF016 AC3): the auto-assign placed the same container at
    // autoBox's A01, under autoBox's RACK StorageLocation.
    const afterAutoLocation = await readLocation(request, admin.token, sampleId);
    expect(afterAutoLocation).toMatchObject({
      containerId,
      storagePositionId: `${autoBox.boxId}:A01`,
      storageRackId: autoBox.boxId,
    });
    const autoLocation = afterAutoLocation.storageLocationId as string;
    expect(autoLocation).toBeTruthy();

    // #1015 / #1374: MongoStorageRepository's autoAssignSamplePosition
    // places the specimen's container on the physical chain inside the
    // same transaction as the occupancyGrid/sample write, which is why the
    // release below finds a placement to close. Before #1015, releasing an
    // auto-assigned sample answered 400 RELEASE_ERROR, because the release
    // found nothing open to close. A 200 here is the actual invariant
    // #1015 asks for.
    const releaseAfterAuto = await request.delete(`${apiBaseURL}/api/storage/release/${sampleId}`, {
      headers: { Authorization: `Bearer ${admin.token}` },
    });
    expect(releaseAfterAuto.status()).toBe(200);
    const releaseAfterAutoBody = await releaseAfterAuto.json();
    expect(releaseAfterAutoBody.success).toBe(true);
    expect(releaseAfterAutoBody.data.boxId).toBe(autoBox.boxId);

    const afterSecondRelease = await request.get(`${apiBaseURL}/api/storage/sample/${sampleId}`, {
      headers: { Authorization: `Bearer ${admin.token}` },
    });
    // Same "no location" shape as the first test's release assertion
    // above (:121-123) -- GetSampleStorageLocationUseCase's found:false
    // branch, distinct from SAMPLE_NOT_FOUND.
    expect(afterSecondRelease.status()).toBe(400);
    const afterSecondReleaseBody = await afterSecondRelease.json();
    expect(afterSecondReleaseBody.success).toBe(false);
    expect((await readLocation(request, admin.token, sampleId)).storagePositionId).toBeNull();

    // Proves the slot was genuinely freed (occupancyGrid entry removed),
    // not just the sample's own pointer cleared: re-auto-assigning into
    // the same, now-empty-again box lands at the same deterministic
    // first-free position once more.
    const secondAutoAssign = await request.post(`${apiBaseURL}/api/storage/allocate/auto`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: {
        sampleId,
        boxId: autoBox.boxId,
      },
    });
    expect(secondAutoAssign.status()).toBe(201);
    const secondAutoAssignBody = await secondAutoAssign.json();
    expect(secondAutoAssignBody.data).toEqual({
      specimenId: sampleId,
      boxId: autoBox.boxId,
      position: 'A1',
    });

    // #1508 (RF016 AC3, RF017 AC4): back at autoBox's A01, same location;
    // one load, and three position rows that never overlap.
    expect(await readLocation(request, admin.token, sampleId)).toMatchObject({
      containerId,
      storagePositionId: `${autoBox.boxId}:A01`,
      storageRackId: autoBox.boxId,
      storageLocationId: autoLocation,
    });
    const chain = await specimenChainRows(sampleId);
    expect(chain.loads).toHaveLength(1);
    expect(chain.loads[0]).toMatchObject({ containerId, assignmentStatus: 'active' });
    expect(chain.positions.map((p) => [p.storagePositionId, p.assignmentStatus])).toEqual([
      [`${homeBox.boxId}:A01`, 'ended'],
      [`${autoBox.boxId}:A01`, 'ended'],
      [`${autoBox.boxId}:A01`, 'active'],
    ]);
    expectNoOverlappingPositions(chain.positions);
    expect(await countStorageAssignments([sampleId])).toBe(0);
  });
});
