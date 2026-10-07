import { test, expect } from '@playwright/test';
import { MongoClient, Db, ObjectId } from 'mongodb';
import crypto from 'crypto';
import { realAuthLogin } from './helpers/realAuth';

// #824: real-backend proof that publishing a TCLE revision through the
// operator UI -- the builder at /admin/tcle/edit/:id, the only UI that
// publishes a term -- invites the participants still pending on the version it
// revises.
//
// Before #824 the builder's save went to updateTemplate, which created the new
// version and notified nobody: the invitation sweep lived only in
// createPolicy, whose frontend client is commented out. dict-07 row 39 makes
// ConsentPolicy/ConsentTemplate one entity, so both now share one sweep.
//
// No email can be delivered on the test stack (#833), so the observable is the
// minted consentToken the invitation link carries, plus the builder's own
// report of the sweep -- not a delivered message.
const apiBaseURL = process.env.PLAYWRIGHT_API_BASE_URL;
const mongoUri = process.env.E2E_MONGO_URI || 'mongodb://localhost:27017?directConnection=true';
const mongoDbName = process.env.E2E_MONGO_DB || 'bioavanced_test';

const RUN = `${Date.now()}`;
const TITLE = `TCLE e2e 824 ${RUN}`;

let client: MongoClient | null = null;
let db: Db;
let v1Id: ObjectId;
const versionGroupId = `e2e-824-${RUN}`;
const participantId = String(crypto.randomInt(70_000_000, 80_000_000));

test.describe('#824 TCLE builder revision runs the consent-invitation sweep -- real backend', () => {
  test.skip(!apiBaseURL, 'PLAYWRIGHT_API_BASE_URL not set -- run via npm run test:e2e:docker');

  test.beforeAll(async () => {
    client = new MongoClient(mongoUri);
    await client.connect();
    db = client.db(mongoDbName);

    const inserted = await db.collection('consent_templates').insertOne({
      title: TITLE,
      content: '<p>Versão 1 do termo e2e 824.</p>',
      htmlContent: '<p>Versão 1 do termo e2e 824.</p>',
      version: 'v1',
      versionGroupId,
      caae: '',
      active: true,
      permissions: [{ key: 'research-824', label: 'Uso das amostras em pesquisa', required: true }],
      validFrom: new Date('2026-01-01T00:00:00.000Z'),
      validTo: new Date('2027-12-31T23:59:59.000Z'),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    v1Id = inserted.insertedId;

    // Pending on v1, never invited: no token yet.
    await db.collection('patients').insertOne({
      participantId,
      status: 'PENDING_CONSENT',
      consentTemplateId: v1Id.toString(),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  });

  test.afterAll(async () => {
    if (!client) return;
    await db.collection('patients').deleteMany({ participantId });
    await db.collection('consent_templates').deleteMany({ versionGroupId });
    await client.close();
    client = null;
  });

  test('saving a new version in the builder invites the participant pending on the old one', async ({ page, request }) => {
    await realAuthLogin(request, page);

    await page.goto(`/admin/tcle/edit/${v1Id.toString()}`);
    const editor = page.getByRole('textbox', { name: 'Editor do corpo do TCLE' });
    await expect(editor).toContainText('Versão 1 do termo e2e 824', { timeout: 15_000 });
    await editor.fill('Versão 2 do termo e2e 824, revisada pelo operador.');

    await page.getByRole('button', { name: 'Salvar nova versão do TCLE' }).click();

    // The builder reports the sweep (#810's partial-sweep signal, now visible).
    await expect(page.getByRole('alert').filter({ hasText: 'Nova versão criada' }))
      .toContainText('de 1 participantes pendentes', { timeout: 15_000 });

    // The revision continues the lineage with the canonical fields.
    const v2 = await db.collection('consent_templates').findOne({ versionGroupId, _id: { $ne: v1Id } });
    expect(v2?.previousPolicyId).toBe(v1Id.toString());
    expect(v2?.revisionType).toBe('update');
    expect(v2?.version).toBe('v2');
    // The validity period survives the builder's path (dropped before #824).
    expect(v2?.validTo).toBeTruthy();

    // The invitation: a consent token minted for the pending participant.
    const patient = await db.collection('patients').findOne({ participantId });
    // #1049: stored as the token's SHA-256, never the token itself.
    expect(patient?.consentTokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(patient?.consentToken).toBeUndefined();
    expect(patient?.consentTokenExpiresAt).toBeTruthy();
  });
});
