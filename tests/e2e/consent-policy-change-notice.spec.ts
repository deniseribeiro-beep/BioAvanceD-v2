import { test, expect } from '@playwright/test';
import { MongoClient, Db, ObjectId } from 'mongodb';
import crypto from 'crypto';
import { realAuthLogin, realLogin } from './helpers/realAuth';

// RF010 AC8 (LGPD art. 8 §6, art. 9 §2): publishing a new version of a
// consent term through the operator's builder sends each holder of a consent
// still in force under the old version a policy change notice, recorded as a
// ConsentCommunicationEvent linked to that consent. A revoked consent gets
// none. A holder the notice cannot reach (no email) is recorded `failed`, and
// the publication stands.
//
// The test stack sends email through its own SMTP catcher, so the reachable
// holder's notice is expected `delivered`.
const apiBaseURL = process.env.PLAYWRIGHT_API_BASE_URL;
const mongoUri = process.env.E2E_MONGO_URI || 'mongodb://localhost:27017?directConnection=true';
const mongoDbName = process.env.E2E_MONGO_DB || 'bioavanced_test';

const RUN = `${Date.now()}`;
const TITLE = `TCLE e2e 1351 ${RUN}`;
const versionGroupId = `e2e-1351-${RUN}`;

const reachable = String(crypto.randomInt(80_000_000, 81_000_000));
const unreachable = String(crypto.randomInt(81_000_000, 82_000_000));
const revoked = String(crypto.randomInt(82_000_000, 83_000_000));
const participantIds = [reachable, unreachable, revoked];
const consentIds = {
  reachable: `e2e-1351-reachable-${RUN}`,
  unreachable: `e2e-1351-unreachable-${RUN}`,
  revoked: `e2e-1351-revoked-${RUN}`,
};

let client: MongoClient | null = null;
let db: Db;
let v1Id: ObjectId;

test.describe('RF010 AC8 policy change notice on a superseding TCLE version -- real backend', () => {
  test.skip(!apiBaseURL, 'PLAYWRIGHT_API_BASE_URL not set -- run via npm run test:e2e:docker');

  test.beforeAll(async () => {
    client = new MongoClient(mongoUri);
    await client.connect();
    db = client.db(mongoDbName);

    const inserted = await db.collection('consent_templates').insertOne({
      title: TITLE,
      content: '<p>Versão 1 do termo e2e 1351.</p>',
      htmlContent: '<p>Versão 1 do termo e2e 1351.</p>',
      version: 'v1',
      versionGroupId,
      caae: '',
      active: true,
      permissions: [{ key: 'research-1351', label: 'Uso das amostras em pesquisa', required: true }],
      validFrom: new Date('2026-01-01T00:00:00.000Z'),
      validTo: new Date('2027-12-31T23:59:59.000Z'),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    v1Id = inserted.insertedId;

    for (const participantId of participantIds) {
      await db.collection('patients').insertOne({
        participantId,
        status: 'ACTIVE',
        consentTemplateId: v1Id.toString(),
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }
    // The contact lives on ParticipantIdentity only, seeded in plaintext,
    // the keyless-row shape the backend reads as-is. `unreachable` has none.
    for (const participantId of [reachable, revoked]) {
      await db.collection('participantIdentities').insertOne({
        participantId,
        email: `e2e-1351-${participantId}@example.test`,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }

    const consentRow = (participantId: string, consentId: string, status: string) => ({
      consentId,
      participantId,
      consentTemplateId: v1Id.toString(),
      consentVersion: 'v1',
      responses: { 'research-1351': true },
      status,
      signedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await db.collection('patientConsents').insertMany([
      consentRow(reachable, consentIds.reachable, 'ACTIVE'),
      consentRow(unreachable, consentIds.unreachable, 'ACTIVE'),
      consentRow(revoked, consentIds.revoked, 'REVOKED'),
    ]);
  });

  test.afterAll(async () => {
    if (!client) return;
    await db.collection('consentCommunicationEvents').deleteMany({ consentId: { $in: Object.values(consentIds) } });
    await db.collection('patientConsents').deleteMany({ participantId: { $in: participantIds } });
    await db.collection('participantIdentities').deleteMany({ participantId: { $in: participantIds } });
    await db.collection('patients').deleteMany({ participantId: { $in: participantIds } });
    await db.collection('consent_templates').deleteMany({ versionGroupId });
    await client.close();
    client = null;
  });

  test('saving a new version notifies each holder in force, records each notice, and still publishes', async ({ page, request }) => {
    await realAuthLogin(request, page);

    await page.goto(`/admin/tcle/edit/${v1Id.toString()}`);
    const editor = page.getByRole('textbox', { name: 'Editor do corpo do TCLE' });
    await expect(editor).toContainText('Versão 1 do termo e2e 1351', { timeout: 15_000 });
    await editor.fill('Versão 2 do termo e2e 1351, revisada pelo operador.');
    await page.getByRole('button', { name: 'Salvar nova versão do TCLE' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Nova versão criada' })).toBeVisible({ timeout: 15_000 });

    // The publication stands, whatever the sends did.
    const v2 = await db.collection('consent_templates').findOne({ versionGroupId, _id: { $ne: v1Id } });
    expect(v2?.version).toBe('v2');
    expect(v2?.active).toBe(true);

    const events = await db.collection('consentCommunicationEvents')
      .find({ consentId: { $in: Object.values(consentIds) } })
      .toArray();
    const byConsent = Object.fromEntries(events.map((event) => [event.consentId, event]));

    // One notice per consent in force; none for the revoked one.
    expect(events).toHaveLength(2);
    expect(byConsent[consentIds.revoked]).toBeUndefined();
    for (const consentId of [consentIds.reachable, consentIds.unreachable]) {
      expect(byConsent[consentId]).toMatchObject({
        communicationType: 'policy_change_notice',
        channel: 'email',
        contentTemplateId: 'consent.policy_change_notice.v1',
        sourceEventType: 'ConsentTemplate',
        sourceEventId: String(v2?._id),
      });
      expect(byConsent[consentId].sentAt).toBeInstanceOf(Date);
    }
    expect(byConsent[consentIds.reachable].deliveryStatus).toBe('delivered');
    expect(byConsent[consentIds.unreachable]).toMatchObject({
      deliveryStatus: 'failed',
      failureReason: 'CONSENT_RECIPIENT_REQUIRED',
    });
  });
});

// RF010 AC8 (LGPD art. 8 §5, art. 18 IX): revoking a consent as a whole sends
// its holder a revocation confirmation, recorded as a ConsentCommunicationEvent
// of type `notice` linked to the consent and to its ConsentRevocation. A
// partial revocation leaves the consent in force and sends nothing.
const R_RUN = `${Date.now()}-r`;
const rVersionGroupId = `e2e-1351-revocation-${R_RUN}`;
const fullHolder = String(crypto.randomInt(83_000_000, 84_000_000));
const partialHolder = String(crypto.randomInt(84_000_000, 85_000_000));
const rParticipantIds = [fullHolder, partialHolder];
const rConsentIds = {
  full: `e2e-1351-full-${R_RUN}`,
  partial: `e2e-1351-partial-${R_RUN}`,
};

let rClient: MongoClient | null = null;
let rDb: Db;
let rTemplateId: ObjectId;
const rConsentObjectIds: Record<keyof typeof rConsentIds, ObjectId> = {} as Record<keyof typeof rConsentIds, ObjectId>;

test.describe('RF010 AC8 revocation confirmation to the holder -- real backend', () => {
  test.skip(!apiBaseURL, 'PLAYWRIGHT_API_BASE_URL not set -- run via npm run test:e2e:docker');

  test.beforeAll(async () => {
    rClient = new MongoClient(mongoUri);
    await rClient.connect();
    rDb = rClient.db(mongoDbName);

    const inserted = await rDb.collection('consent_templates').insertOne({
      title: `TCLE e2e 1351 revogação ${R_RUN}`,
      content: '<p>Termo e2e 1351, revogação.</p>',
      htmlContent: '<p>Termo e2e 1351, revogação.</p>',
      version: 'v1',
      versionGroupId: rVersionGroupId,
      caae: '',
      active: true,
      permissions: [
        { key: 'research-1351r', label: 'Uso das amostras em pesquisa', required: true },
        { key: 'contact-1351r', label: 'Contato futuro', required: false },
      ],
      validFrom: new Date('2026-01-01T00:00:00.000Z'),
      validTo: new Date('2027-12-31T23:59:59.000Z'),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    rTemplateId = inserted.insertedId;

    for (const participantId of rParticipantIds) {
      await rDb.collection('patients').insertOne({
        participantId,
        status: 'ACTIVE',
        consentTemplateId: rTemplateId.toString(),
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      await rDb.collection('participantIdentities').insertOne({
        participantId,
        email: `e2e-1351-${participantId}@example.test`,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }

    for (const [key, participantId] of [['full', fullHolder], ['partial', partialHolder]] as const) {
      const row = await rDb.collection('patientConsents').insertOne({
        consentId: rConsentIds[key],
        participantId,
        consentTemplateId: rTemplateId.toString(),
        consentVersion: 'v1',
        responses: { 'research-1351r': true, 'contact-1351r': true },
        status: 'ACTIVE',
        signedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      rConsentObjectIds[key] = row.insertedId;
    }
  });

  test.afterAll(async () => {
    if (!rClient) return;
    const ids = Object.values(rConsentIds);
    await rDb.collection('consentCommunicationEvents').deleteMany({ consentId: { $in: ids } });
    await rDb.collection('consentRevocations').deleteMany({ consentId: { $in: ids } });
    await rDb.collection('consentDecisionEvents').deleteMany({ consentId: { $in: ids } });
    await rDb.collection('patientConsents').deleteMany({ participantId: { $in: rParticipantIds } });
    await rDb.collection('participantIdentities').deleteMany({ participantId: { $in: rParticipantIds } });
    await rDb.collection('patients').deleteMany({ participantId: { $in: rParticipantIds } });
    await rDb.collection('consent_templates').deleteMany({ versionGroupId: rVersionGroupId });
    await rClient.close();
    rClient = null;
  });

  test('a full revocation confirms to the holder and records it; a partial one sends nothing', async ({ request }) => {
    const admin = await realLogin(request);
    const auth = { Authorization: `Bearer ${admin.token}` };
    const revoke = (id: ObjectId, data: Record<string, unknown>) =>
      request.post(`${apiBaseURL}/api/e-consent/consents/${id.toString()}/revoke`, { headers: auth, data });

    // Partial: the consent stays in force, and its holder is sent nothing.
    const partial = await revoke(rConsentObjectIds.partial, { scope: ['contact-1351r'], reason: 'Não deseja contato futuro' });
    expect(partial.status(), await partial.text()).toBe(200);
    expect((await partial.json()).data).toMatchObject({ status: 'ACTIVE', currentStateDerived: 'partially_revoked' });

    // Full: the consent is revoked, and its holder gets the confirmation.
    const full = await revoke(rConsentObjectIds.full, {});
    expect(full.status(), await full.text()).toBe(200);
    expect((await full.json()).data).toMatchObject({ status: 'REVOKED', currentStateDerived: 'revoked' });

    const revocation = await rDb.collection('consentRevocations').findOne({ consentId: rConsentIds.full });
    expect(revocation?.consentRevocationId).toBeTruthy();

    const events = await rDb.collection('consentCommunicationEvents')
      .find({ consentId: { $in: Object.values(rConsentIds) } })
      .toArray();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      consentId: rConsentIds.full,
      participantId: fullHolder,
      communicationType: 'notice',
      channel: 'email',
      contentTemplateId: 'consent.revocation_confirmation.v1',
      purpose: 'consent_revocation',
      sourceEventType: 'ConsentRevocation',
      sourceEventId: revocation?.consentRevocationId,
      // The test stack's SMTP catcher accepts the send.
      deliveryStatus: 'delivered',
    });
    expect(events[0].sentAt).toBeInstanceOf(Date);
  });
});
