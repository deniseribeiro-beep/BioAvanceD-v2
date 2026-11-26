import { test, expect } from '@playwright/test';
import { MongoClient, ObjectId } from 'mongodb';
import { realAuthLogin } from './helpers/realAuth';
import { createRealParticipant, closeSeedDb } from './helpers/seedParticipant';
import { watchAuditTrail, assertAuditEventRecorded } from './helpers/assertAuditEvent';

// RF010 AC5-AC6 (#1375): an operator revokes a consent from /consents, first
// one permission and then the whole consent, and reads each revocation in the
// consent's history. The responses as given are never overwritten.
const apiBaseURL = process.env.PLAYWRIGHT_API_BASE_URL;
const mongoUri = process.env.E2E_MONGO_URI || 'mongodb://localhost:27017?directConnection=true';
const mongoDbName = process.env.E2E_MONGO_DB || 'bioavanced_test';

let client: MongoClient | null = null;
let participantId: string | null = null;

test.describe('RF010 AC5-AC6 consent revocation screen (/consents) -- real backend', () => {
  test.describe.configure({ mode: 'serial' });
  test.skip(!apiBaseURL, 'PLAYWRIGHT_API_BASE_URL not set -- run via npm run test:e2e:docker');

  test.afterAll(async () => {
    if (client && participantId) {
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
        await db.collection(name).deleteMany({ participantId });
      }
    }
    await closeSeedDb();
    if (client) {
      await client.close();
      client = null;
    }
  });

  test('a permission and then the whole consent are revoked from the screen, and the history records both', async ({ page, request }) => {
    const admin = await realAuthLogin(request, page);
    const auth = { Authorization: `Bearer ${admin.token}` };
    const participant = await createRealParticipant(request, apiBaseURL!, admin.token);
    participantId = participant.participantId;

    // A term with two granular permissions. Its createdAt is old, so it is
    // never the newest active term other specs read as "the" active one.
    client = new MongoClient(mongoUri);
    await client.connect();
    const db = client.db(mongoDbName);
    const template = await db.collection('consent_templates').findOneAndUpdate(
      { e2eFixture: 'rf010-revocation-screen-template' },
      {
        $setOnInsert: {
          title: 'RF010 e2e revocation screen template',
          content: 'Termo com permissões granulares para o teste da tela de revogação (RF010).',
          version: 'v1',
          permissions: [
            { key: 'storage', label: 'Armazenamento', required: false },
            { key: 'contact', label: 'Contato futuro', required: false },
          ],
          createdAt: new Date('2000-01-01T00:00:00Z'),
        },
        $set: { active: true, updatedAt: new Date() },
      },
      { upsert: true, returnDocument: 'after' }
    );

    const signed = await request.post(`${apiBaseURL}/api/e-consent/consents`, {
      headers: auth,
      data: { participantId, consentTemplateId: String(template?._id), responses: { storage: true, contact: true } },
    });
    expect(signed.status()).toBe(201);
    const consentDbId: string = (await signed.json()).data._id;

    const history = async () => {
      const response = await request.get(`${apiBaseURL}/api/e-consent/consents/${consentDbId}/history`, { headers: auth });
      expect(response.status()).toBe(200);
      return (await response.json()).data;
    };

    // The screen confirms before each revocation.
    page.on('dialog', (dialog) => dialog.accept());

    // Opened the way the patients list links to it.
    await page.goto(`/consents?participantId=${participantId}`);
    await expect(page.getByTestId('consent-state')).toHaveText('Ativo', { timeout: 15_000 });
    await expect(page.getByTestId('consent-decision-events')).toContainText('accepted');
    await expect(page.getByTestId('consent-decision-events')).toContainText('staff_portal');

    // AC6: a scoped revocation narrows the consent to what is still permitted.
    const scopedWatch = await watchAuditTrail(request, apiBaseURL!, admin.token);
    await page.getByTestId('revoke-scope-contact').check();
    await page.getByLabel('Motivo').fill('Não deseja contato futuro');
    await page.getByTestId('revoke-selected-button').click();
    await expect(page.getByTestId('consent-notice')).toHaveText('Revogação registrada.');
    await expect(page.getByTestId('consent-state')).toHaveText('Parcialmente revogado');
    await expect(page.getByTestId('consent-revocations')).toContainText('Contato futuro');
    await assertAuditEventRecorded(request, apiBaseURL!, admin.token, scopedWatch);

    const narrowed = await history();
    expect(narrowed.revocations).toHaveLength(1);
    expect(narrowed.revocations[0]).toMatchObject({
      scope: ['contact'],
      priorUseDisposition: 'retain_history',
      reason: 'Não deseja contato futuro',
    });
    expect(narrowed.decisionEvents.map((event: { decision: string }) => event.decision)).toEqual(['accepted', 'revoked']);
    expect(narrowed.decisionEvents[1]).toMatchObject({ channel: 'staff_portal', signerRole: 'staff_on_behalf' });

    // AC6: only what is still permitted can be revoked; revoking every use revokes the consent.
    await expect(page.getByTestId('revoke-scope-storage')).toBeVisible();
    await expect(page.getByTestId('revoke-scope-contact')).toHaveCount(0);
    await page.getByTestId('revoke-all-button').click();
    await expect(page.getByTestId('consent-state')).toHaveText('Revogado');
    await expect(page.getByTestId('revoke-all-button')).toHaveCount(0);
    await expect(page.getByTestId('consent-revocations')).toContainText('Todos os usos');

    const revoked = await history();
    expect(revoked.revocations).toHaveLength(2);
    expect(revoked.revocations[1]).toMatchObject({ scope: ['all'] });

    // AC5: no manifestation was overwritten.
    const stored = await db.collection('patientConsents').findOne({ _id: new ObjectId(consentDbId) });
    expect(stored?.responses).toEqual({ storage: true, contact: true });
  });
});
