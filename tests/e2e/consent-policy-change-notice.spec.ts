import { test, expect } from '@playwright/test';
import { MongoClient, Db, ObjectId } from 'mongodb';
import crypto from 'crypto';
import { realAuthLogin } from './helpers/realAuth';

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
