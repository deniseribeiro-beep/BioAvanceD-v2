import { test, expect } from '@playwright/test';
import { realLogin } from './helpers/realAuth';
import {
  createRealParticipant,
  seedActiveConsent,
  seedStorageBoxLocation,
  cleanupStorageBoxLocation,
  closeSeedDb,
  type SeededStorageBox,
} from './helpers/seedParticipant';
import { watchAuditTrail, assertAuditEventRecorded } from './helpers/assertAuditEvent';

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

test.describe('Sample storage lifecycle (#321) — real backend, withTransaction proof', () => {
  const seededStorageBoxes: SeededStorageBox[] = [];

  test.afterAll(async () => {
    await Promise.all(
      seededStorageBoxes.map((box) => cleanupStorageBoxLocation(box).catch(() => {}))
    );
    await closeSeedDb();
  });

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

    const create = await request.post(`${apiBaseURL}/api/samples`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: {
        participantId: participant.participantId,
        ...validSampleFields(),
        boxId: boxA.boxId,
        positionCode: boxA.positionCode,
      },
    });
    expect([201, 202]).toContain(create.status());
    const sampleId = (await create.json()).data.specimenId;
    expect(sampleId).toBeTruthy();

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
    expect(moveBody.data.to).toEqual({ boxId: boxB.boxId, position: boxB.positionCode });
    await assertAuditEventRecorded(request, apiBaseURL!, admin.token, moveWatch);

    const afterMove = await request.get(`${apiBaseURL}/api/storage/sample/${sampleId}`, {
      headers: { Authorization: `Bearer ${admin.token}` },
    });
    expect(afterMove.status()).toBe(200);
    const afterMoveBody = await afterMove.json();
    expect(afterMoveBody.data.box.boxId).toBe(boxB.boxId);
    expect(afterMoveBody.data.box.position).toBe(boxB.positionCode);

    // --- ReleaseSampleUseCase#execute -> withTransaction ---
    const releaseWatch = await watchAuditTrail(request, apiBaseURL!, admin.token);
    const release = await request.delete(`${apiBaseURL}/api/storage/release/${sampleId}`, {
      headers: { Authorization: `Bearer ${admin.token}` },
    });
    expect(release.status()).toBe(200);
    const releaseBody = await release.json();
    expect(releaseBody.success).toBe(true);
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

  test('POST /allocate/auto (release -> auto-assign) commits through the real Mongo transaction, opens a StorageAssignment, and frees the slot on release (#1015)', async ({
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

    const create = await request.post(`${apiBaseURL}/api/samples`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: {
        participantId: participant.participantId,
        ...validSampleFields(),
        boxId: homeBox.boxId,
        positionCode: homeBox.positionCode,
      },
    });
    expect([201, 202]).toContain(create.status());
    const sampleId = (await create.json()).data.specimenId;
    expect(sampleId).toBeTruthy();

    // The only way to reach an unallocated sample: release it first, since
    // creation cannot skip boxId/positionCode.
    const release = await request.delete(`${apiBaseURL}/api/storage/release/${sampleId}`, {
      headers: { Authorization: `Bearer ${admin.token}` },
    });
    expect(release.status()).toBe(200);

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
    // The Neo4j hazard this assertion guards against: after the Mongo
    // transaction commits, storageService.js runs a Cypher MERGE against
    // the graph driver. If that driver is unhealthy or never wired up,
    // the MERGE throws, the Mongo write gets compensated via
    // rollbackAutoAssignedPosition, and the error is re-thrown into the
    // controller's catch block as a 500 -- which reads exactly like a
    // storage bug, not an absent graph driver. Without this assertion, a
    // stack with no working Neo4j would make this whole test fail at a
    // confusing, unrelated-looking step instead of failing exactly here
    // with a clear cause; asserting graphPersisted: true is what stops a
    // green run from silently meaning "no graph driver was wired".
    expect(autoAssignBody.graphPersisted).toBe(true);

    const afterAutoAssign = await request.get(`${apiBaseURL}/api/storage/sample/${sampleId}`, {
      headers: { Authorization: `Bearer ${admin.token}` },
    });
    expect(afterAutoAssign.status()).toBe(200);
    const afterAutoAssignBody = await afterAutoAssign.json();
    expect(afterAutoAssignBody.data.box.boxId).toBe(autoBox.boxId);
    expect(afterAutoAssignBody.data.box.position).toBe('A1');

    // #1015 / #1003: MongoStorageRepository's autoAssignSamplePosition now
    // calls openStorageAssignment inside the same transaction as the
    // occupancyGrid/sample write. Before that fix, releasing an
    // auto-assigned sample answered 400 RELEASE_ERROR, because
    // release-sample.controller.js's use case found no open
    // StorageAssignment to close. A 200 here is the actual invariant
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
  });
});
