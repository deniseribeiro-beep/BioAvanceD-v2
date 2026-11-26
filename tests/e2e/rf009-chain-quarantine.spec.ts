import { test, expect, type APIRequestContext } from '@playwright/test';
import { MongoClient, type Db } from 'mongodb';
import { realLogin } from './helpers/realAuth';
import { deleteOrganizations } from './helpers/listOrganizations';
import { completeFirstLoginMfa } from './helpers/completeFirstLoginMfa';
import {
  seedCustodyFixture,
  cleanupCustodyFixture,
  closeCustodyDb,
  type CustodyFixture,
} from './helpers/seedCustody';
import {
  seedSensorWithPolicy,
  findTemperatureIncident,
  removeSeededSensor,
  closeSeedSensorDb,
  type SeededSensor,
} from './helpers/seedSensor';

// Real-backend proof of RF009 AC5/AC6 and RULE-027 (#1392): a sustained
// cold-chain excursion quarantines the specimen the physical chain
// (specimen -> container -> position -> rack -> location) puts at the
// sensor datastream's storageLocationId during the excursion. Neither
// specimen sits in a box under a sensor's freezer, so only the chain can
// select it. A control specimen left that location before the excursion
// started, and stays unquarantined.
const apiBaseURL = process.env.PLAYWRIGHT_API_BASE_URL;
const mongoUri = process.env.E2E_MONGO_URI || 'mongodb://localhost:27017?directConnection=true';
const mongoDbName = process.env.E2E_MONGO_DB || 'bioavanced_test';

// #1091: POST /api/iot/telemetry is gated by the machine ingest secret.
const ingestHeaders = () => ({ 'x-telemetry-ingest-secret': process.env.TELEMETRY_INGEST_SECRET ?? '' });

test.skip(!apiBaseURL, 'PLAYWRIGHT_API_BASE_URL not set — run via npm run test:e2e:docker');

test.describe('Cold-chain quarantine through the physical chain (#1392, RF009 AC5/AC6) — real backend', () => {
  const organizationIds: string[] = [];
  const fixtures: CustodyFixture[] = [];
  let sensor: SeededSensor | null = null;
  let mongo: MongoClient | null = null;
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const heldContainerId = `CT-QUAR-HELD-${suffix}`;
  const leftContainerId = `CT-QUAR-LEFT-${suffix}`;
  const rackId = `rack-quar-${suffix}`;
  const roomId = `room-quar-${suffix}`;
  const freezerId = `freezer-quar-${suffix}`;

  async function getDb(): Promise<Db> {
    if (!mongo) {
      mongo = new MongoClient(mongoUri, { serverSelectionTimeoutMS: 10_000 });
      await mongo.connect();
    }
    return mongo.db(mongoDbName);
  }

  const findSample = async (specimenId: string) => (await getDb()).collection('samples').findOne({ specimenId });

  test.afterAll(async ({ request }) => {
    const specimenIds = fixtures.map((fixture) => fixture.specimenId);
    if (specimenIds.length) {
      const db = await getDb();
      const sampleIds = (await db.collection('samples').find({ specimenId: { $in: specimenIds } }).toArray())
        .map((sample) => String(sample._id));
      await Promise.all([
        db.collection('quarantineActions').deleteMany({ specimenIds: { $in: [...specimenIds, ...sampleIds] } }),
        db.collection('sample_movements').deleteMany({ sampleID: { $in: [...specimenIds, ...sampleIds] } }),
      ]).catch(() => {});
    }
    for (const [index, fixture] of fixtures.entries()) {
      await cleanupCustodyFixture(fixture, index === 0 ? [heldContainerId, leftContainerId] : [], index === 0 ? [rackId] : [], [], [], index === 0 ? [roomId, freezerId] : []).catch(() => {});
    }
    if (sensor) await removeSeededSensor(sensor).catch(() => {});
    await deleteOrganizations(request, apiBaseURL!, organizationIds).catch(() => {});
    await mongo?.close().catch(() => {});
    await closeCustodyDb().catch(() => {});
    await closeSeedSensorDb().catch(() => {});
  });

  async function registerUser(request: APIRequestContext, adminAuth: Record<string, string>, label: string, accessType: number, roleName: string, organizationId: string) {
    const username = `quar.${label}.${Date.now()}`;
    const password = 'Cadeia@12345-forte';
    const res = await request.post(`${apiBaseURL}/api/users/register`, {
      headers: adminAuth,
      data: { name: `#1392 ${label}`, email: `${username}@example.com`, username, password, accessType, roleName, organizationId },
    });
    expect(res.ok(), await res.text()).toBeTruthy();
    const session = await completeFirstLoginMfa(request, apiBaseURL!, username, password);
    return { Authorization: `Bearer ${session.token}` };
  }

  test('a sustained excursion quarantines the specimen the chain puts at the sensor location, not the one that left before it', async ({ request }) => {
    const N = Math.floor(Date.now() / 1000) * 1000;
    const m = (k: number) => new Date(N - k * 60_000);

    const admin = await realLogin(request);
    const adminAuth = { Authorization: `Bearer ${admin.token}` };
    const orgRes = await request.post(`${apiBaseURL}/api/organizations`, {
      headers: adminAuth,
      data: { officialName: `#1392 quarentena ${suffix}`, countryCode: 'BR' },
    });
    expect(orgRes.ok(), await orgRes.text()).toBeTruthy();
    const orgA = (await orgRes.json()).data.organizationId as string;
    organizationIds.push(orgA);

    const held = await seedCustodyFixture(`held-${suffix}`, orgA);
    fixtures.push(held);
    const left = await seedCustodyFixture(`left-${suffix}`, orgA);
    fixtures.push(left);

    const coordA = await registerUser(request, adminAuth, 'coordA', 3, 'Coordenador', orgA);
    const techA = await registerUser(request, adminAuth, 'techA', 2, 'Técnico', orgA);
    const post = (path: string, headers: Record<string, string>, data: Record<string, unknown> = {}) =>
      request.post(`${apiBaseURL}/api/physical-chain${path}`, { headers, data });
    const expectCreated = async (res: Awaited<ReturnType<typeof post>>) => expect(res.status(), await res.text()).toBe(201);

    for (const fixture of fixtures) {
      await expectCreated(await post('/custody', coordA, {
        specimenId: fixture.specimenId, custodianOrganizationId: orgA, authorizationId: fixture.approvalId, responsibleInvestigatorId: 'inv-quar',
        effectivePeriod: { start: '2026-01-01T00:00:00.000Z' },
      }));
    }
    await expectCreated(await post('/locations', coordA, { storageLocationId: roomId, locationType: 'room', name: 'Sala criogenica', code: `R-QUAR-${suffix}`, organizationId: orgA }));
    await expectCreated(await post('/locations', coordA, { storageLocationId: freezerId, locationType: 'freezer', name: 'Freezer -80', code: `FZ-QUAR-${suffix}`, organizationId: orgA, parentLocationId: roomId }));

    await expectCreated(await post('/racks', coordA, { storageRackId: rackId }));
    // Both containers sit in the rack at the freezer from m200. The held one
    // stays; the left one leaves its position at m130, before the excursion
    // starts at m121.
    for (const [containerId, specimenId, position, removedAt] of [
      [heldContainerId, held.specimenId, 'A01', undefined],
      [leftContainerId, left.specimenId, 'A02', m(130).toISOString()],
    ] as const) {
      await expectCreated(await post('/containers', coordA, { containerId, containerType: 'cryovial' }));
      await expectCreated(await post(`/containers/${containerId}/specimens`, techA, { specimenId, loadedAt: m(200).toISOString() }));
      await expectCreated(await post(`/containers/${containerId}/position`, techA, {
        storagePositionId: `${rackId}:${position}`, placedAt: m(200).toISOString(), ...(removedAt ? { removedAt } : {}),
      }));
    }
    await expectCreated(await post(`/racks/${rackId}/location`, coordA, { storageLocationId: freezerId, placedAt: m(200).toISOString() }));

    // The sensor's datastream monitors the freezer location. Its policy has
    // no minimumDuration, so the 2-hour fallback governs (#1207): the
    // reading at m121 opens the excursion, and the one now is past it.
    sensor = await seedSensorWithPolicy(-90, -60, { storageLocationId: freezerId });
    const postReading = async (temperature: number, at: Date) => {
      const res = await request.post(`${apiBaseURL}/api/iot/telemetry`, {
        headers: ingestHeaders(),
        data: { sensorId: sensor!.sensorId, temperature, timestamp: at.toISOString() },
      });
      expect(res.status(), await res.text()).toBe(200);
    };

    await postReading(-40, m(121));
    await expect
      .poll(async () => (await findTemperatureIncident(sensor!.sensorId))?.excursionStartedAt?.toISOString() ?? null, { timeout: 15_000 })
      .toBe(m(121).toISOString());
    expect((await findSample(held.specimenId))?.specimenStatus).not.toBe('quarantined');

    await postReading(-40, new Date());
    await expect
      .poll(async () => (await findSample(held.specimenId))?.specimenStatus ?? null, { timeout: 15_000 })
      .toBe('quarantined');
    const quarantined = await findSample(held.specimenId);
    expect(quarantined?.quarantineReasonCode).toBe('COLD_CHAIN_INCIDENT');
    expect(quarantined?.coldChainSensorKey).toBe(sensor.sensorId);
    expect(quarantined?.storageLocation?.boxId).toBeUndefined();

    // [m200, m130) ends before the window [m121, now] starts.
    expect((await findSample(left.specimenId))?.specimenStatus).not.toBe('quarantined');
  });
});
