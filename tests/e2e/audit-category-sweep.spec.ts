import { test, expect, APIRequestContext } from '@playwright/test';
import { MongoClient } from 'mongodb';
import { realLogin } from './helpers/realAuth';
import { closeAuditEventsDb, latestChainEvents } from './helpers/queryAuditEvents';
import { createRealParticipant, closeSeedDb } from './helpers/seedParticipant';
import { removeSensorRegistration, closeSeedSensorDb } from './helpers/seedSensor';

/**
 * #1455: RNF009 AC1 -- each audited category writes its own event to the
 * audit chain. Each case sends one request under its own X-Request-Id and
 * finds the event that request's handler wrote, by its correlationId, action
 * and entity. The global request audit also writes one row per request; each
 * case matches the handler's own event, never that row: a different action
 * or entity, or the target's id, which the request row never carries. A
 * login's request row is LOGIN / Authentication too, so that case counts
 * past it.
 */

const apiBaseURL = process.env.PLAYWRIGHT_API_BASE_URL;
const CHAIN = 'audit-events';
const mongoUri = process.env.E2E_MONGO_URI || 'mongodb://localhost:27017?directConnection=true';
const mongoDbName = process.env.E2E_MONGO_DB || 'bioavanced_test';
const CREDENTIALS = { username: process.env.TEST_USER || 'admin', password: process.env.TEST_PASS || 'Admin@123-e2e-stack' };

interface ExpectedEvent {
  action: string;
  entityType: string;
  // The target's id, or 'present' for any non-empty id.
  entityId: string;
}

function entityMatches(actual: unknown, expected: string): boolean {
  if (expected === 'present') return typeof actual === 'string' && actual !== '';
  return actual === expected;
}

function newRequestId(category: string): string {
  return `e2e-sweep-${category}-${Date.now()}`;
}

async function expectChainEvent(requestId: string, expected: ExpectedEvent): Promise<void> {
  await expect.poll(async () => {
    const recent = await latestChainEvents(CHAIN, 200);
    return recent.some((event) =>
      event.correlationId === requestId
      && event.action === expected.action
      && event.entityType === expected.entityType
      && entityMatches(event.entityId, expected.entityId));
  }, {
    message: `request ${requestId} wrote a ${expected.action} ${expected.entityType} event`,
    timeout: 10_000,
  }).toBe(true);
}

async function login(request: APIRequestContext, requestId?: string): Promise<string> {
  const response = await request.post(`${apiBaseURL}/api/auth/login`, {
    headers: requestId ? { 'X-Request-Id': requestId } : {},
    data: CREDENTIALS,
  });
  expect(response.status(), await response.text()).toBe(200);
  return (await response.json()).data.token;
}

test.describe('RNF009 AC1 audited categories (real backend)', () => {
  test.skip(!apiBaseURL, 'needs the real backend (PLAYWRIGHT_API_BASE_URL)');

  let client: MongoClient | null = null;
  const participantIds: string[] = [];
  const freezerIds: string[] = [];

  test.afterAll(async () => {
    await Promise.all(freezerIds.map((id) => removeSensorRegistration(`none-${id}`, id).catch(() => {})));
    if (participantIds.length) {
      if (!client) {
        client = new MongoClient(mongoUri);
        await client.connect();
      }
      const db = client.db(mongoDbName);
      for (const name of [
        'patientConsents',
        'consentDecisionEvents',
        'consentRevocations',
        'consentPermissions',
        'consentCommunicationEvents',
        'participantIdentities',
        'patients',
      ]) {
        await db.collection(name).deleteMany({ participantId: { $in: participantIds } });
      }
    }
    if (client) {
      await client.close();
      client = null;
    }
    await Promise.all([closeAuditEventsDb(), closeSeedDb(), closeSeedSensorDb()]);
  });

  test('authentication: a login writes a LOGIN event', async ({ request }) => {
    const requestId = newRequestId('auth');
    await login(request, requestId);
    // The request row is itself LOGIN / Authentication with no id, so only
    // the login handler's own events lift the count past one.
    await expect.poll(async () => {
      const recent = await latestChainEvents(CHAIN, 200);
      return recent.filter((event) =>
        event.correlationId === requestId
        && event.action === 'LOGIN'
        && event.entityType === 'Authentication').length;
    }, {
      message: `request ${requestId} wrote the login handler's LOGIN event beside the request row`,
      timeout: 10_000,
    }).toBeGreaterThanOrEqual(2);
  });

  test('sessions: a logout writes the revoked session event', async ({ request }) => {
    const token = await login(request);
    const requestId = newRequestId('sessions');
    const response = await request.post(`${apiBaseURL}/api/auth/logout`, {
      headers: { Authorization: `Bearer ${token}`, 'X-Request-Id': requestId },
    });
    expect(response.status(), await response.text()).toBe(200);
    await expectChainEvent(requestId, { action: 'UPDATE', entityType: 'Session', entityId: 'present' });
  });

  test('users: registering a user writes a CREATE User event', async ({ request }) => {
    const admin = await realLogin(request);
    const username = `tecnico.rnf009.${Date.now()}`;
    const requestId = newRequestId('users');
    const response = await request.post(`${apiBaseURL}/api/users/register`, {
      headers: { Authorization: `Bearer ${admin.token}`, 'X-Request-Id': requestId },
      data: {
        name: 'RNF009 Técnico Fixture',
        email: `${username}@example.com`,
        username,
        password: 'Tecnico@123-forte',
        accessType: 2,
        roleName: 'Técnico',
      },
    });
    expect(response.status(), await response.text()).toBe(201);
    await expectChainEvent(requestId, { action: 'CREATE', entityType: 'User', entityId: 'present' });
  });

  test('configuration: a security policy change writes an UPDATE SecurityConfiguration event', async ({ request }) => {
    const admin = await realLogin(request);
    const auth = { Authorization: `Bearer ${admin.token}` };
    const before = await request.get(`${apiBaseURL}/api/security/config`, { headers: auth });
    expect(before.ok(), await before.text()).toBeTruthy();
    const original: number = (await before.json()).data.authentication.maxLoginAttempts;

    // maxLoginAttempts is checked before authentication only, so changing it
    // ends no session; it is restored below.
    const requestId = newRequestId('config');
    try {
      const update = await request.put(`${apiBaseURL}/api/security/config`, {
        headers: { ...auth, 'X-Request-Id': requestId },
        data: { authentication: { maxLoginAttempts: original === 4 ? 5 : 4 } },
      });
      expect(update.ok(), await update.text()).toBeTruthy();
      await expectChainEvent(requestId, { action: 'UPDATE', entityType: 'SecurityConfiguration', entityId: 'main' });
    } finally {
      const restore = await request.put(`${apiBaseURL}/api/security/config`, {
        headers: auth,
        data: { authentication: { maxLoginAttempts: original } },
      });
      expect(restore.ok(), await restore.text()).toBeTruthy();
    }
  });

  test('ingestion: an accepted record writes an INGESTION_ACCEPTED event', async ({ request }) => {
    const admin = await realLogin(request);
    const requestId = newRequestId('ingestion');
    const response = await request.post(`${apiBaseURL}/api/ingestion/records`, {
      headers: { Authorization: `Bearer ${admin.token}`, 'X-Request-Id': requestId },
      data: {
        entityType: 'Dataset',
        payload: {
          datasetTitle: `RNF009 e2e sweep ${Date.now()}`,
          datasetVersion: '1.0.0',
          creators: [{ name: 'RNF009 e2e suite' }],
          license: 'CC BY 4.0',
        },
        provenance: {
          sourceSystem: 'urn:system:audit-sweep-e2e',
          retrievedAt: new Date().toISOString(),
          purpose: 'e2e_proof',
          sourceRecordId: `rnf009-e2e-${Date.now()}`,
        },
      },
    });
    expect(response.status(), await response.text()).toBe(201);
    const { entityId } = await response.json();
    await expectChainEvent(requestId, { action: 'INGESTION_ACCEPTED', entityType: 'Dataset', entityId });
  });

  test('storage: authoring a freezer writes a CREATE StorageContainerLayout event', async ({ request }) => {
    const admin = await realLogin(request);
    const auth = { Authorization: `Bearer ${admin.token}` };
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const equipmentRes = await request.post(`${apiBaseURL}/api/equipment`, {
      headers: auth,
      data: { equipmentDescription: `RNF009 freezer ${suffix}`, name: `UF ${suffix}`, type: 'Freezer', status: 'Active' },
    });
    expect(equipmentRes.status(), await equipmentRes.text()).toBe(201);
    const equipment = (await equipmentRes.json()).data;

    const requestId = newRequestId('storage');
    const created = await request.post(`${apiBaseURL}/api/storage/topology/containers`, {
      headers: { ...auth, 'X-Request-Id': requestId },
      data: { name: `RNF009 freezer ${suffix}`, containerType: 'FREEZER', equipmentId: String(equipment.equipmentID), temperature: -80 },
    });
    expect(created.status(), await created.text()).toBe(201);
    const freezerId = String((await created.json()).data._id);
    freezerIds.push(freezerId);
    await expectChainEvent(requestId, { action: 'CREATE', entityType: 'StorageContainerLayout', entityId: freezerId });
  });

  test('consent: signing a consent writes a SIGN PatientConsent event', async ({ request }) => {
    const admin = await realLogin(request);
    const auth = { Authorization: `Bearer ${admin.token}` };
    const participant = await createRealParticipant(request, apiBaseURL!, admin.token);
    participantIds.push(participant.participantId);

    // A term of its own with one optional permission, old enough that no
    // other spec reads it as the newest active term.
    client = new MongoClient(mongoUri);
    await client.connect();
    const template = await client.db(mongoDbName).collection('consent_templates').findOneAndUpdate(
      { e2eFixture: 'rnf009-audit-sweep-template' },
      {
        $setOnInsert: {
          title: 'RNF009 e2e audit sweep template',
          content: 'Termo com uma permissão opcional para o teste de auditoria por categoria (RNF009).',
          version: 'v1',
          permissions: [{ key: 'storage', label: 'Armazenamento', required: false }],
          createdAt: new Date('2000-01-01T00:00:00Z'),
        },
        $set: { active: true, updatedAt: new Date() },
      },
      { upsert: true, returnDocument: 'after' }
    );

    const requestId = newRequestId('consent');
    const signed = await request.post(`${apiBaseURL}/api/e-consent/consents`, {
      headers: { ...auth, 'X-Request-Id': requestId },
      data: { participantId: participant.participantId, consentTemplateId: String(template?._id), responses: { storage: true } },
    });
    expect(signed.status(), await signed.text()).toBe(201);
    const consentId = String((await signed.json()).data._id);
    await expectChainEvent(requestId, { action: 'SIGN', entityType: 'PatientConsent', entityId: consentId });
  });
});
