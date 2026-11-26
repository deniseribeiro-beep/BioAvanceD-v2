import { test, expect } from '@playwright/test';
import { MongoClient, Db } from 'mongodb';
import crypto from 'crypto';

// #809: real-backend proof for the bulk consent-token page.
//
// This is the flow every bulk invitation actually uses: template publication,
// both LGPD import paths, the CSV/FHIR import, patient creation and
// resendConsentNotification all call NotificationService.buildConsentLink,
// which emails `${FRONTEND_URL}/patients/<participantId>/consent?token=<hex>`.
// Until this spec there was no page behind that URL at all -- the route
// pointed at the JWT page (an alias import), behind ProtectedRoute.
//
// Nothing here logs in. That is the point: a participant following an emailed
// invitation has no account, so any redirect to /login is a failure of the
// requirement, not of the fixture.
const apiBaseURL = process.env.PLAYWRIGHT_API_BASE_URL;
const mongoUri = process.env.E2E_MONGO_URI || 'mongodb://localhost:27017?directConnection=true';
const mongoDbName = process.env.E2E_MONGO_DB || 'bioavanced_test';

const TERM_CONTENT =
  'Termo de Consentimento Livre e Esclarecido para o teste e2e do link de convite em massa (#809).';

let client: MongoClient | null = null;
let db: Db;
const seededParticipantIds: string[] = [];
let templateId: string;

async function seedPendingParticipant(): Promise<{ participantId: string; token: string }> {
  // #821: acceptance now goes through createPatientConsent, whose
  // validateParticipantId requires the canonical 8-digit shape.
  const participantId = String(crypto.randomInt(80_000_000, 90_000_000));
  const token = crypto.randomBytes(32).toString('hex');
  await db.collection('patients').insertOne({
    participantId,
    status: 'PENDING_CONSENT',
    // #1049: only the token's SHA-256 is stored; the link carries the token.
    consentTokenHash: crypto.createHash('sha256').update(token).digest('hex'),
    consentTokenCreatedAt: new Date(),
    consentTokenExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  seededParticipantIds.push(participantId);
  return { participantId, token };
}

test.describe('RF010 bulk consent-token page (/patients/:id/consent?token=) -- real backend', () => {
  test.skip(!apiBaseURL, 'PLAYWRIGHT_API_BASE_URL not set -- run via npm run test:e2e:docker');

  test.beforeAll(async ({ browser }) => {
    client = new MongoClient(mongoUri);
    await client.connect();
    db = client.db(mongoDbName);

    // Canonical collection name is `consent_templates` (snake_case), not the
    // `consentTemplates` param name used across the API layer -- see
    // api/backend/src/config/collections.js's CANONICAL_COLLECTIONS.
    const inserted = await db.collection('consent_templates').insertOne({
      title: `TCLE e2e 809 ${Date.now()}`,
      content: TERM_CONTENT,
      version: 'e2e-809',
      active: true,
      permissions: [
        { key: 'research-809', label: 'Uso das amostras em pesquisa', required: true },
        { key: 'recontact-809', label: 'Novo contato para estudos futuros', required: false },
      ],
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    templateId = inserted.insertedId.toString();
  });

  test.afterAll(async () => {
    if (!client) return;
    await db.collection('patients').deleteMany({ participantId: { $in: seededParticipantIds } });
    await db.collection('patientConsents').deleteMany({ participantId: { $in: seededParticipantIds } });
    await db.collection('consent_templates').deleteMany({ version: 'e2e-809' });
    await client.close();
    client = null;
  });

  test('a participant with no session can open the emailed link, read the term and accept it', async ({ page }) => {
    const { participantId, token } = await seedPendingParticipant();

    await page.goto(`/patients/${participantId}/consent?token=${token}`);

    // The auth wall is the failure #809 is about: this route used to sit
    // behind ProtectedRoute, and the shared API client cancels session-less
    // requests unless the endpoint is token-optional (#822).
    await expect(page).toHaveURL(new RegExp(`/patients/${participantId}/consent`));

    await expect(page.getByTestId('consent-token-content')).toContainText(TERM_CONTENT, {
      timeout: 15_000,
    });
    await expect(page.getByTestId('consent-token-permissions')).toContainText(
      'Uso das amostras em pesquisa'
    );

    // #821: the manifestation is granular -- the required purpose must be
    // accepted before the term can be, and the optional one stays declined.
    await expect(page.getByTestId('consent-token-accept')).toBeDisabled();
    await page.getByTestId('consent-token-permission-research-809').check();
    await page.getByTestId('consent-token-accept').click();
    await expect(page.getByTestId('consent-token-success')).toBeVisible();

    // The observable that matters is the persisted transition, not the banner.
    const stored = await db.collection('patients').findOne({ participantId });
    expect(stored?.status).toBe('ACTIVE');
    expect(stored?.consentAcceptedAt).toBeTruthy();
    // The accepted link stays the participant's panel (#1542): acceptance
    // keeps the token's hash, still only its SHA-256 (#1049), and the page
    // turns into the panel that revokes the term in whole or in part.
    expect(stored?.consentTokenHash).toBe(crypto.createHash('sha256').update(token).digest('hex'));
    await expect(page.getByTestId('consent-token-manage')).toBeVisible();
    await expect(page.getByTestId('consent-token-revoke-all')).toBeVisible();

    // #821 (RF010 AC#2-4): the acceptance is a recorded Consent, not only a
    // status flag -- bound to the term the page showed, with the answers given
    // and #827's version and evidence.
    const consents = await db.collection('patientConsents').find({ participantId }).toArray();
    expect(consents).toHaveLength(1);
    const [consent] = consents;
    expect(consent.status).toBe('ACTIVE');
    expect(consent.consentId).toMatch(/^[0-9a-f-]{36}$/);
    expect(consent.consentTemplateId).toBe(templateId);
    expect(consent.consentVersion).toBe('e2e-809');
    expect(consent.responses).toEqual({ 'research-809': true, 'recontact-809': false });
    expect(consent.evidenceDocumentUri).toBe(`objstore://consents/${consent.consentId}/evidence.json`);
    expect(consent.evidenceHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(consent.evidenceMimeType).toBe('application/json');
    expect(consent.evidenceEncryption?.algorithm).toBe('aes-256-gcm');

    // Opened again, the same emailed link still resolves, now to the panel:
    // the granted purpose is offered for revocation, the declined one is not,
    // and no second acceptance is offered.
    await page.goto(`/patients/${participantId}/consent?token=${token}`);
    await expect(page.getByTestId('consent-token-manage')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('consent-token-revoke-research-809')).toBeVisible();
    await expect(page.getByTestId('consent-token-revoke-recontact-809')).toHaveCount(0);
    await expect(page.getByTestId('consent-token-accept')).toHaveCount(0);
    await expect(page.getByTestId('consent-token-error')).toHaveCount(0);
  });

  // #1172 (#1152): in a real outage the request gets no response at all --
  // api.ts aborts at its own 10s timeout before the backend's 503 arrives. The
  // mapper copy is unit-tested; these prove the rendered page shows it through
  // the real api.ts client and its interceptors, in a real browser.
  test('a load that gets no response tells the participant the link still works', async ({ page }) => {
    const { participantId, token } = await seedPendingParticipant();
    await page.route('**/api/e-consent/consent-tokens/validate**', (route) => route.abort('timedout'));

    await page.goto(`/patients/${participantId}/consent?token=${token}`);

    await expect(page.getByTestId('consent-token-error')).toContainText(/link continua válido/i, {
      timeout: 15_000,
    });
    await expect(page).toHaveURL(new RegExp(`/patients/${participantId}/consent`));
  });

  test('an accept that gets no response tells the participant the link still works', async ({ page }) => {
    const { participantId, token } = await seedPendingParticipant();
    await page.route('**/api/e-consent/consent-tokens/accept**', (route) => route.abort('timedout'));

    await page.goto(`/patients/${participantId}/consent?token=${token}`);
    await expect(page.getByTestId('consent-token-content')).toContainText(TERM_CONTENT, {
      timeout: 15_000,
    });
    await page.getByTestId('consent-token-permission-research-809').check();
    await page.getByTestId('consent-token-accept').click();

    const error = page.getByTestId('consent-token-error');
    await expect(error).toContainText(/link continua válido/i);
    await expect(error).not.toContainText(/novo convite/i);
    // Nothing reached the backend, so the participant is still pending.
    const stored = await db.collection('patients').findOne({ participantId });
    expect(stored?.status).toBe('PENDING_CONSENT');
  });

  test('a wrong token is rejected and leaves the participant pending', async ({ page }) => {
    const { participantId } = await seedPendingParticipant();

    await page.goto(`/patients/${participantId}/consent?token=${'f'.repeat(64)}`);

    await expect(page.getByTestId('consent-token-error')).toContainText(/inválido|expirado/i, {
      timeout: 15_000,
    });
    // No accept button is offered for a token that did not validate.
    await expect(page.getByTestId('consent-token-accept')).toHaveCount(0);

    const stored = await db.collection('patients').findOne({ participantId });
    expect(stored?.status).toBe('PENDING_CONSENT');
    expect(stored?.consentAcceptedAt).toBeFalsy();
  });

  // #805 emailed `/patients/undefined/consent?token=...` from all four bulk
  // paths for as long as buildConsentLink read a field none of its callers
  // carried. Those links are still in participants' inboxes; they must not
  // reach the backend with the literal string, nor bounce to /login.
  test('a legacy 805 link with an undefined id reports an incomplete link, not a login wall', async ({ page }) => {
    await page.goto(`/patients/undefined/consent?token=${'a'.repeat(64)}`);

    await expect(page.getByTestId('consent-token-error')).toContainText(/incompleto/i, {
      timeout: 15_000,
    });
    await expect(page).not.toHaveURL(/\/login/);
  });

  test('the term rendered is the active template, carrying its own version', async ({ page }) => {
    const { participantId, token } = await seedPendingParticipant();

    await page.goto(`/patients/${participantId}/consent?token=${token}`);

    await expect(page.getByTestId('consent-token-title')).toContainText('TCLE e2e 809', {
      timeout: 15_000,
    });
    await expect(page.getByText('Versão e2e-809')).toBeVisible();
    expect(templateId).toBeTruthy();
  });

  // #1181: terms of different lineages (versionGroupId) are in force at once,
  // so the term a participant answers is the active term of the lineage they
  // were enrolled under, not the newest active term system-wide.
  test('a participant enrolled under one term lineage answers that lineage\'s term, not a newer one of another', async ({ page }) => {
    const run = Date.now();
    const lineageTerm = await db.collection('consent_templates').insertOne({
      title: `TCLE e2e 1181 linhagem A ${run}`,
      content: `Termo da linhagem A (#1181) ${run}.`,
      version: 'e2e-809',
      versionGroupId: `e2e-1181-a-${run}`,
      active: true,
      permissions: [{ key: 'research-1181a', label: 'Pesquisa na linhagem A', required: true }],
      createdAt: new Date(Date.now() - 60_000),
      updatedAt: new Date(),
    });
    const { participantId, token } = await seedPendingParticipant();
    await db.collection('patients').updateOne(
      { participantId },
      { $set: { consentTemplateId: lineageTerm.insertedId.toString() } }
    );
    // Another lineage publishes later: it is the newest active term of all.
    await db.collection('consent_templates').insertOne({
      title: `TCLE e2e 1181 linhagem B ${run}`,
      content: `Termo da linhagem B (#1181) ${run}.`,
      version: 'e2e-809',
      versionGroupId: `e2e-1181-b-${run}`,
      active: true,
      permissions: [{ key: 'research-1181b', label: 'Pesquisa na linhagem B', required: true }],
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await page.goto(`/patients/${participantId}/consent?token=${token}`);

    await expect(page.getByTestId('consent-token-content')).toContainText(`Termo da linhagem A (#1181) ${run}.`, {
      timeout: 15_000,
    });
    await expect(page.getByTestId('consent-token-content')).not.toContainText('linhagem B');
    await page.getByTestId('consent-token-permission-research-1181a').check();
    await page.getByTestId('consent-token-accept').click();
    await expect(page.getByTestId('consent-token-success')).toBeVisible();

    const consent = await db.collection('patientConsents').findOne({ participantId });
    expect(consent?.consentTemplateId).toBe(lineageTerm.insertedId.toString());
    expect(consent?.responses).toEqual({ 'research-1181a': true });
  });
});
