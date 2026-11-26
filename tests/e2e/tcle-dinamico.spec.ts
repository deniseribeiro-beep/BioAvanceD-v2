import { test, expect } from '@playwright/test';
import { mockLogin } from './helpers/mockAuth';
import { realLogin } from './helpers/realAuth';
import { createRealParticipant, closeSeedDb } from './helpers/seedParticipant';
import { MongoClient, ObjectId } from 'mongodb';
import { createHash } from 'crypto';

// Real backend only — see specimen-quality-inventory.spec.ts for the same
// skip rationale. Run via `npm run test:e2e:docker` (or a locally running
// backend), never the mocked suite above.
const apiBaseURL = process.env.PLAYWRIGHT_API_BASE_URL;
const mongoUri = process.env.E2E_MONGO_URI || 'mongodb://localhost:27017?directConnection=true';
const mongoDbName = process.env.E2E_MONGO_DB || 'bioavanced_test';

test.describe('TCLE builder (/admin/tcle/new)', () => {
  test.beforeEach(async ({ page }) => {
    await mockLogin(page);
    // #1349: the builder loads the DUO purposes a permission may name. With
    // mockLogin's unsigned token the real route answers 401, and api.ts's
    // interceptor would log the session out mid-test.
    await page.route('**/api/e-consent/purpose-codes', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: [{ code: 'DUO:0000006', display: 'health or medical or biomedical research use' }] }),
      });
    });
  });

  test('renders the builder form and accepts template metadata', async ({ page }) => {
    await page.goto('/admin/tcle/new');

    const nameInput = page.getByLabel('Nome do Modelo');
    const caaeInput = page.getByLabel('CAAE');

    await expect(nameInput).toBeVisible();
    await nameInput.fill('TCLE E2E Teste');
    await caaeInput.fill('12345678.9.0000.0000');

    await expect(nameInput).toHaveValue('TCLE E2E Teste');
    await expect(caaeInput).toHaveValue('12345678.9.0000.0000');
  });

  test('creating a template posts the filled-in metadata', async ({ page }) => {
    let createdPayload: Record<string, unknown> | null = null;
    await page.route('**/api/e-consent/consent-templates', async (route) => {
      if (route.request().method() !== 'POST') {
        // TcleBuilderPage debounces a GET here (version-history lookup,
        // keyed off the title field) on every keystroke — unmocked, it
        // hits the real backend with mockLogin's unsigned token, 401s, and
        // api.ts's global interceptor force-logs-out the session mid-test
        // (same shape as #611).
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, data: [] }),
        });
        return;
      }
      createdPayload = route.request().postDataJSON();
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { _id: 'tcle-e2e-1', ...createdPayload } }),
      });
    });

    await page.goto('/admin/tcle/new');
    await page.getByLabel('Nome do Modelo').fill('TCLE E2E Teste');
    await page.getByLabel('CAAE').fill('12345678.9.0000.0000');
    await page.getByLabel('Modalidade de Consentimento').selectOption('broad');
    await page.getByLabel('Data de Início da Vigência').fill('2026-01-01');
    await page.getByLabel('Data Final de Vigência').fill('2027-01-01');

    // Submit stays disabled until the rich-text body and at least one
    // granular consent item are filled in too (see disabled= condition on
    // the submit Button in TcleBuilderPage.tsx) — drive both.
    await page.getByRole('textbox', { name: 'Editor do corpo do TCLE' }).fill('Corpo do termo de consentimento para o teste e2e.');
    // A default consent item already exists on a fresh template — just fill it in.
    await page.getByPlaceholder('Ex.: Aceito ceder minhas amostras para estudos genéticos').first().fill('Aceito participar do estudo e2e');
    // RF010 AC3 (#1349): the item names the governed purpose it covers.
    await page.getByTestId('consent-purpose-1').selectOption('DUO:0000006');

    await page.getByRole('button', { name: 'Criar versão do TCLE' }).click();

    await expect.poll(() => createdPayload?.title ?? (createdPayload as any)?.name).toBeTruthy();
    // RF010 AC1: the builder sends the modality it offers.
    expect(createdPayload!.consentModel).toBe('broad');
    // RF010 AC3 (#1349): and each permission's governed purpose.
    expect((createdPayload!.permissions as Array<Record<string, unknown>>)[0]).toMatchObject({
      label: 'Aceito participar do estudo e2e',
      purposeCode: 'DUO:0000006',
    });
  });
});

test.describe('RF010 Consent versioned by consentId — real backend, red-first (#328)', () => {
  test.skip(!apiBaseURL, 'PLAYWRIGHT_API_BASE_URL not set — run via npm run test:e2e:docker');

  test.afterAll(async () => {
    await closeSeedDb();
  });

  // dict-07_ALINHAMENTO_CODIGO.md row 3 / dict-02_DICIONARIO.md ELM-0088: the
  // target model requires each consent manifestation to be identified by an
  // internal `consentId` distinct from the Mongo `_id` (`Identidade interna
  // da instância de consentimento`). consent.service.js's
  // createPatientConsent (PatientConsentModel.create, models/PatientConsent.js)
  // never assigns such a field — the API/collection only ever expose Mongo's
  // `_id`. Expected to fail against current main; the failure is the proof
  // of the gap (RF010 AC#2). Do not weaken this assertion to make it pass —
  // file the consentId model/migration as a separate follow-up once it's red.
  test('AC#2: a signed consent is identified by an explicit consentId distinct from _id', async ({ request }) => {
    const admin = await realLogin(request);
    const participant = await createRealParticipant(request, apiBaseURL!, admin.token);

    const consentResponse = await request.post(`${apiBaseURL}/api/e-consent/consents`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: {
        participantId: participant.participantId,
        consentTemplateId: participant.consentTemplateId,
        responses: {},
        signatureName: 'RF010 e2e signatory',
        // 1x1 transparent PNG — normalizeSignaturePayload (consent.service.js)
        // requires a valid image/* payload once signatureImageBase64 is present.
        signatureImageBase64:
          'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      },
    });
    expect(consentResponse.status()).toBe(201);
    const consent = (await consentResponse.json()).data;

    expect(consent.consentId).toBeTruthy();
    expect(consent.consentId).not.toBe(String(consent._id));

    // Confirm the field is actually persisted on the document, not just
    // synthesized in the API response.
    const client = new MongoClient(mongoUri);
    await client.connect();
    try {
      const stored = await client.db(mongoDbName).collection('patientConsents').findOne({ _id: new ObjectId(consent._id) });
      expect(stored?.consentId).toBeTruthy();
    } finally {
      await client.close();
    }
  });

  // RNF018 (multi-layer validation, bucket A for this spec per the
  // traceability plan): a malformed consent payload must be rejected with
  // 422, not a generic 400. consent.controller.js's createPatientConsent
  // catches every validation error (missing participantId, bad
  // consentTemplateId, schema failures) and always responds 400 — expected
  // to fail against current main.
  test('RNF018: a malformed consent payload (missing participantId) is rejected with 422', async ({ request }) => {
    const admin = await realLogin(request);
    const participant = await createRealParticipant(request, apiBaseURL!, admin.token);

    const response = await request.post(`${apiBaseURL}/api/e-consent/consents`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: {
        consentTemplateId: participant.consentTemplateId,
        responses: {},
      },
    });

    expect(response.status()).toBe(422);
  });

  // RF010 AC1: a term records its language, jurisdiction, consent modality,
  // CAAE (P1X-0367), the URI of its controlled document (P1X-0095, #1492)
  // and the checksum of its exact text, computed by the server. Posted
  // inactive, so no other spec's active term changes.
  test('AC1: a published term records language, jurisdiction, modality, CAAE, document URI and its text checksum', async ({ request }) => {
    const admin = await realLogin(request);
    const auth = { Authorization: `Bearer ${admin.token}` };
    const htmlContent = `<p>Termo RF010 AC1 ${Date.now()}</p>`;
    const caae = `RF010-AC1-${Date.now()}`;
    const documentUri = 'https://example.org/tcle/rf010-ac1.pdf';

    const created = await request.post(`${apiBaseURL}/api/e-consent/consent-templates`, {
      headers: auth,
      data: {
        title: 'RF010 AC1 e2e term',
        // The template schema requires `content`; the builder sends both.
        content: htmlContent,
        htmlContent,
        active: false,
        language: 'en-US',
        consentModel: 'broad',
        caae,
        documentUri,
        checksum: 'sha256:forged',
        permissions: [{ key: 'storage', label: 'Armazenamento', required: false }],
      },
    });
    expect(created.status()).toBe(201);
    const term = (await created.json()).data;
    try {
      const expected = createHash('sha256').update(htmlContent, 'utf8').digest('hex');
      expect(term).toMatchObject({
        language: 'en-US', jurisdiction: 'BR', consentModel: 'broad', caae, documentUri, checksum: `sha256:${expected}`,
      });

      // The stored term keeps both, read back through the API.
      const stored = await request.get(`${apiBaseURL}/api/e-consent/consent-templates/${term._id}`, { headers: auth });
      expect(stored.status()).toBe(200);
      expect((await stored.json()).data).toMatchObject({ caae, documentUri });
    } finally {
      // GET /consent-templates lists every term on the kept test volume, so
      // this one does not outlive the test.
      const client = new MongoClient(mongoUri);
      await client.connect();
      try {
        await client.db(mongoDbName).collection('consent_templates').deleteOne({ _id: new ObjectId(term._id) });
      } finally {
        await client.close();
      }
    }

    const refused = await request.post(`${apiBaseURL}/api/e-consent/consent-templates`, {
      headers: auth,
      data: { title: 'RF010 AC1 refused', content: htmlContent, htmlContent, active: false, consentModel: 'implied' },
    });
    expect(refused.status()).toBe(422);
    // Refused for its modality, not for a missing field.
    expect((await refused.json()).message).toContain('consentModel');

    const refusedUri = await request.post(`${apiBaseURL}/api/e-consent/consent-templates`, {
      headers: auth,
      data: { title: 'RF010 AC1 refused URI', content: htmlContent, htmlContent, active: false, documentUri: 'not a uri' },
    });
    expect(refusedUri.status()).toBe(422);
    expect((await refusedUri.json()).message).toContain('documentUri');
  });

  // RF010 AC4-AC6: every manifestation is an appended ConsentDecisionEvent, a
  // revocation carries its scope as a ConsentRevocation, and the consent's
  // state is derived from that history -- a scoped revocation narrows it, a
  // newer consent supersedes it, and the responses as given never change.
  test('AC4-AC6: acceptance, scoped revocation, supersession and revocation are appended history the state derives from', async ({ request }) => {
    const admin = await realLogin(request);
    const participant = await createRealParticipant(request, apiBaseURL!, admin.token);
    const auth = { Authorization: `Bearer ${admin.token}` };

    // A term with two granular permissions. Its createdAt is old, so it is
    // never the newest active term other specs read as "the" active one.
    const client = new MongoClient(mongoUri);
    await client.connect();
    try {
      const db = client.db(mongoDbName);
      const template = await db.collection('consent_templates').findOneAndUpdate(
        { e2eFixture: 'rf010-consent-history-template' },
        {
          $setOnInsert: {
            title: 'RF010 e2e consent history template',
            content: 'Termo com permissões granulares para o teste de histórico (RF010).',
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
      const templateId = String(template?._id);

      const sign = async () => {
        const response = await request.post(`${apiBaseURL}/api/e-consent/consents`, {
          headers: auth,
          data: { participantId: participant.participantId, consentTemplateId: templateId, responses: { storage: true, contact: true } },
        });
        expect(response.status()).toBe(201);
        return (await response.json()).data;
      };
      const history = async (id: string) => {
        const response = await request.get(`${apiBaseURL}/api/e-consent/consents/${id}/history`, { headers: auth });
        expect(response.status()).toBe(200);
        return (await response.json()).data;
      };
      const revoke = (id: string, data: Record<string, unknown>) =>
        request.post(`${apiBaseURL}/api/e-consent/consents/${id}/revoke`, { headers: auth, data });

      // AC4: the acceptance is an event naming channel, signer and evidence.
      const first = await sign();
      expect(first.currentStateDerived).toBe('active');
      const accepted = await history(first._id);
      expect(accepted.decisionEvents).toHaveLength(1);
      expect(accepted.decisionEvents[0]).toMatchObject({
        consentId: first.consentId,
        decision: 'accepted',
        channel: 'staff_portal',
        signerRole: 'participant',
        signerId: participant.participantId,
        authenticationLevel: 'session',
        evidenceUri: first.evidenceDocumentUri,
      });
      expect(accepted.decisionEvents[0].evidenceHash).toMatch(/^sha256:[a-f0-9]{64}$/);
      // AC3: each answered permission is a computable ConsentPermission.
      expect(accepted.permissions.map((row: { permissionCode: string; decision: string }) => [row.permissionCode, row.decision]).sort())
        .toEqual([['contact', 'permit'], ['storage', 'permit']]);

      // AC6: a scoped revocation blocks only its permission, from now on.
      const scoped = await revoke(first._id, { scope: ['contact'], reason: 'Não deseja contato futuro' });
      expect(scoped.status()).toBe(200);
      const narrowed = (await scoped.json()).data;
      expect(narrowed).toMatchObject({
        status: 'ACTIVE',
        currentStateDerived: 'partially_revoked',
        responses: { storage: true, contact: true },
        effectivePermissions: { storage: true, contact: false },
        withdrawalScope: ['contact'],
      });

      // A scope naming no permission of the consent is refused, and appends nothing.
      const unknown = await revoke(first._id, { scope: ['genetic'] });
      expect(unknown.status()).toBe(422);
      expect(Array.isArray((await unknown.json()).details)).toBe(true);

      // AC5: a newer consent supersedes the first through its history.
      const second = await sign();
      expect(second.supersedesConsentId).toBe(first.consentId);
      const superseded = await history(first._id);
      expect(superseded.currentStateDerived).toBe('superseded');
      expect(superseded.supersededByConsentId).toBe(second.consentId);
      expect(superseded.decisionEvents.map((event: { decision: string }) => event.decision))
        .toEqual(['accepted', 'revoked', 'superseded']);
      expect(superseded.revocations).toHaveLength(1);
      expect(superseded.revocations[0]).toMatchObject({ scope: ['contact'], priorUseDisposition: 'retain_history' });

      // AC6: revoking every use revokes the consent; the revocation names its event.
      const full = await revoke(second._id, {});
      expect(full.status()).toBe(200);
      expect((await full.json()).data).toMatchObject({ status: 'REVOKED', currentStateDerived: 'revoked' });
      const revoked = await history(second._id);
      const revokedEvent = revoked.decisionEvents.find((event: { decision: string }) => event.decision === 'revoked');
      expect(revoked.revocations[0]).toMatchObject({ scope: ['all'], decisionEventId: revokedEvent.consentDecisionEventId });

      // A repeat revokes nothing more and appends nothing.
      expect((await revoke(second._id, {})).status()).toBe(200);
      expect((await history(second._id)).decisionEvents).toHaveLength(revoked.decisionEvents.length);

      // No manifestation was overwritten.
      const stored = await db.collection('patientConsents').findOne({ _id: new ObjectId(first._id) });
      expect(stored?.responses).toEqual({ storage: true, contact: true });
    } finally {
      await client.close();
    }
  });
});
