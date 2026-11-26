import { test, expect, type APIRequestContext } from '@playwright/test';
import { realLogin } from './helpers/realAuth';
import { deleteOrganizations } from './helpers/listOrganizations';
import { completeFirstLoginMfa } from './helpers/completeFirstLoginMfa';
import {
  seedCustodyFixture,
  cleanupCustodyFixture,
  closeCustodyDb,
  findExposureSummaries,
  type CustodyFixture,
} from './helpers/seedCustody';
import {
  seedSensorWithPolicy,
  bindSensor,
  unbindSensor,
  removeSeededSensor,
  closeSeedSensorDb,
  type SeededSensor,
} from './helpers/seedSensor';

// Real-backend proof of RF009 AC5/AC6 and RULE-027 (#1392): a specimen's
// temperature exposure is computed only through its specimen -> container
// -> position -> rack -> location chain, over the half-open intersection
// of the three intervals, from the readings tagged with the rack's
// StorageLocation, and stored as one TelemetryExposureSummary per piece.
// Two organizations, a Coordenador and a Tecnico in the first, a Tecnico in
// the second.
const apiBaseURL = process.env.PLAYWRIGHT_API_BASE_URL;

test.skip(!apiBaseURL, 'PLAYWRIGHT_API_BASE_URL not set — run via npm run test:e2e:docker');

test.describe('Telemetry exposure through the physical chain (#1392, RF009 AC5/AC6) — real backend', () => {
  const organizationIds: string[] = [];
  let fixture: CustodyFixture | null = null;
  let sensor: SeededSensor | null = null;
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const containerId = `CT-EXPO-${suffix}`;
  const rackId = `rack-expo-${suffix}`;
  const roomId = `room-expo-${suffix}`;
  const freezerId = `freezer-expo-${suffix}`;
  const elsewhereId = `rf009-expo-elsewhere-${suffix}`;

  test.afterAll(async ({ request }) => {
    if (fixture) await cleanupCustodyFixture(fixture, [containerId], [rackId], [], [], [roomId, freezerId]).catch(() => {});
    if (sensor) await removeSeededSensor(sensor).catch(() => {});
    await unbindSensor(elsewhereId).catch(() => {});
    await deleteOrganizations(request, apiBaseURL!, organizationIds).catch(() => {});
    await closeCustodyDb().catch(() => {});
    await closeSeedSensorDb().catch(() => {});
  });

  async function registerUser(request: APIRequestContext, adminAuth: Record<string, string>, label: string, accessType: number, roleName: string, organizationId: string) {
    const username = `expo.${label}.${Date.now()}`;
    const password = 'Cadeia@12345-forte';
    const res = await request.post(`${apiBaseURL}/api/users/register`, {
      headers: adminAuth,
      data: { name: `#1392 ${label}`, email: `${username}@example.com`, username, password, accessType, roleName, organizationId },
    });
    expect(res.ok(), await res.text()).toBeTruthy();
    const session = await completeFirstLoginMfa(request, apiBaseURL!, username, password);
    return { Authorization: `Bearer ${session.token}` };
  }

  test('the summary counts only the readings at the rack location inside the chain intersection, and is scoped by custody', async ({ request }) => {
    const N = Math.floor(Date.now() / 1000) * 1000;
    const m = (k: number) => new Date(N - k * 60_000);

    const admin = await realLogin(request);
    const adminAuth = { Authorization: `Bearer ${admin.token}` };
    const makeOrg = async (label: string) => {
      const res = await request.post(`${apiBaseURL}/api/organizations`, {
        headers: adminAuth,
        data: { officialName: `#1392 ${label} ${suffix}`, countryCode: 'BR' },
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

    const assigned = await post('/custody', coordA, {
      specimenId, custodianOrganizationId: orgA, authorizationId: fixture.approvalId, responsibleInvestigatorId: 'inv-expo',
      effectivePeriod: { start: '2026-01-01T00:00:00.000Z' },
    });
    expect(assigned.status(), await assigned.text()).toBe(201);
    const created = await post('/containers', coordA, { containerId, containerType: 'cryovial' });
    expect(created.status(), await created.text()).toBe(201);
    const room = await post('/locations', coordA, { storageLocationId: roomId, locationType: 'room', name: 'Sala criogenica', code: `R-EXPO-${suffix}`, organizationId: orgA });
    expect(room.status(), await room.text()).toBe(201);
    const freezer = await post('/locations', coordA, { storageLocationId: freezerId, locationType: 'freezer', name: 'Freezer -80', code: `FZ-EXPO-${suffix}`, organizationId: orgA, parentLocationId: roomId });
    expect(freezer.status(), await freezer.text()).toBe(201);

    // Each link bounds the piece once: it starts when the rack is located
    // (m60) and ends when the container leaves its position (m20).
    const loaded = await post(`/containers/${containerId}/specimens`, techA, { specimenId, loadedAt: m(100).toISOString() });
    expect(loaded.status(), await loaded.text()).toBe(201);
    const prepared = await post('/racks', coordA, { storageRackId: rackId });
    expect(prepared.status(), await prepared.text()).toBe(201);
    const placed = await post(`/containers/${containerId}/position`, techA, {
      storagePositionId: `${rackId}:A01`, placedAt: m(80).toISOString(), removedAt: m(20).toISOString(),
    });
    expect(placed.status(), await placed.text()).toBe(201);
    const located = await post(`/racks/${rackId}/location`, coordA, { storageLocationId: freezerId, placedAt: m(60).toISOString() });
    expect(located.status(), await located.text()).toBe(201);
    const chainIds = {
      specimenContainerAssignmentId: (await loaded.json()).data.specimenContainerAssignmentId,
      containerPositionAssignmentId: (await placed.json()).data.containerPositionAssignmentId,
      rackLocationAssignmentId: (await located.json()).data.rackLocationAssignmentId,
    };

    // One datastream at the freezer, and one of another sensor at its own
    // location, under the same -90..-60 policy.
    sensor = await seedSensorWithPolicy(-90, -60, { storageLocationId: freezerId });
    await bindSensor(elsewhereId, { thresholdProfileId: sensor.policyId });

    // Every reading is inside -90..-60, so no incident opens.
    const send = async (sensorId: string, k: number, temperatureValue: number) => {
      const res = await request.post(`${apiBaseURL}/api/temperature/reading`, {
        headers: adminAuth, data: { sensorId, temperatureValue, timestamp: m(k).toISOString() },
      });
      expect(res.status(), await res.text()).toBe(201);
      return (await res.json()).data;
    };
    await send(sensor.sensorId, 70, -70); // before the rack is located
    const atStart = await send(sensor.sensorId, 60, -80); // the piece start: counts
    expect(atStart.storageLocationId).toBe(freezerId);
    expect(atStart.datastreamId).toBeTruthy();
    await send(sensor.sensorId, 40, -65); // counts
    await send(sensor.sensorId, 20, -61); // the piece end: excluded
    await send(sensor.sensorId, 10, -62); // after
    const elsewhere = await send(elsewhereId, 40, -89); // inside the interval, at another location
    expect(elsewhere.storageLocationId).toBe(`${elsewhereId}-loc`);

    const summarize = (headers: Record<string, string>, data: Record<string, unknown>) =>
      post(`/specimens/${specimenId}/telemetry-exposure-summaries`, headers, data);
    const hash = /^sha256:[0-9a-f]{64}$/;

    // RF009 AC5/AC6: [m60, m20), two readings, each covering 20 minutes.
    const whole = await summarize(techA, {});
    expect(whole.status(), await whole.text()).toBe(201);
    const wholeSummaries = (await whole.json()).data;
    expect(wholeSummaries).toHaveLength(1);
    const summary = wholeSummaries[0];
    expect(summary).toMatchObject({
      specimenId,
      ...chainIds,
      storageAssignmentId: null,
      windowStart: m(60).toISOString(),
      windowEnd: m(20).toISOString(),
      observationCount: 2,
      minimumValue: -80,
      maximumValue: -65,
      meanValue: -72.5,
      timeOutsideThresholdSeconds: 0,
      excursionCount: 0,
      coverageRatio: 1,
      calculationVersion: '1.0.0',
    });
    expect(summary.datastreamIds).toEqual([atStart.datastreamId]);
    expect(summary.exposurePathHash).toMatch(hash);
    expect(summary.sourceQueryHash).toMatch(hash);
    expect(summary.sourceReadingSetHash).toMatch(hash);

    // A window clips the piece, and is part of its path hash.
    const clipped = await summarize(techA, { windowStart: m(50).toISOString() });
    expect(clipped.status(), await clipped.text()).toBe(201);
    const clippedSummaries = (await clipped.json()).data;
    expect(clippedSummaries).toHaveLength(1);
    expect(clippedSummaries[0]).toMatchObject({
      ...chainIds,
      windowStart: m(50).toISOString(),
      windowEnd: m(20).toISOString(),
      observationCount: 1,
      minimumValue: -65,
    });
    expect(clippedSummaries[0].exposurePathHash).not.toBe(summary.exposurePathHash);

    // Before the rack was located there is no piece.
    const empty = await summarize(techA, { windowEnd: m(70).toISOString() });
    expect(empty.status(), await empty.text()).toBe(422);
    expect((await empty.json()).error).toBe('EXPOSURE_PATH_EMPTY');

    // Another organization's Tecnico is out of the specimen's custody.
    const foreign = await summarize(techB, {});
    expect(foreign.status(), await foreign.text()).toBe(403);

    const stored = await findExposureSummaries(specimenId);
    expect(stored).toHaveLength(2);
    expect(stored[0].telemetryExposureSummaryId).toBe(summary.telemetryExposureSummaryId);
  });
});
