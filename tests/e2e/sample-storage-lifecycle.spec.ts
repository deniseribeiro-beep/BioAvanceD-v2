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
    const sampleId = (await create.json()).data.sampleID;
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
    const sample2Id = (await create2.json()).data.sampleID;

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
});
