import { test, expect } from '@playwright/test';
import { mockLogin } from './helpers/mockAuth';
import { realLogin } from './helpers/realAuth';
import { createRealParticipant, closeSeedDb } from './helpers/seedParticipant';
import { MongoClient } from 'mongodb';

const mongoUri = process.env.E2E_MONGO_URI || 'mongodb://localhost:27017?directConnection=true';
const mongoDbName = process.env.E2E_MONGO_DB || 'bioavanced_test';

// Real backend only — see specimen-quality-inventory.spec.ts for the same
// skip rationale. Run via `npm run test:e2e:docker` (or a locally running
// backend), never the mocked suite above.
const apiBaseURL = process.env.PLAYWRIGHT_API_BASE_URL;

test.describe('Intake wizard (/next/intake)', () => {
  test.beforeEach(async ({ page }) => {
    await mockLogin(page);

    // useIntakeDictionaryData loads this once on mount; an empty-but-valid
    // response is enough for the demographic step to render.
    await page.route('**/api/terminologies**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: [] }),
      });
    });
  });

  test('renders the demographic step and accepts patient data entry', async ({ page }) => {
    await page.goto('/next/intake');

    await expect(page.getByTestId('intake-wizard-root')).toBeVisible();
    await expect(page.getByTestId('wizard-title')).toBeVisible();

    await page.getByTestId('wizard-full-name').fill('Paciente Teste E2E');
    await page.getByTestId('wizard-birth-date').fill('01/01/1990');
    await page.getByTestId('wizard-gender').selectOption('F');

    await expect(page.getByTestId('wizard-full-name')).toHaveValue('Paciente Teste E2E');
    await expect(page.getByTestId('wizard-gender')).toHaveValue('F');
  });

  test('advancing past the demographic step requires the required fields', async ({ page }) => {
    await page.goto('/next/intake');
    await expect(page.getByTestId('wizard-next-button')).toBeVisible();

    // No fields filled in — clicking next must not silently advance past
    // required-field validation on the demographic step.
    await page.getByTestId('wizard-next-button').click();
    await expect(page.getByTestId('wizard-full-name')).toBeVisible();
  });

  // #395: ClinicalIntakeWizard prefetches consent templates on mount (for the
  // later consent step) via consentService, which — unlike the wizard's other
  // background loaders (terminologies, patient-match) — uses the strict `api`
  // instance that force-logs-out the user on any 401. A stale/rejected token
  // on this unrelated background call must not evict the user from the
  // demographic step they're actively filling in.
  test('a failed background consent-template prefetch does not force-logout the user mid-step (#395)', async ({ page }) => {
    await page.route('**/api/e-consent/consent-templates**', async (route) => {
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ success: false, message: 'Unauthorized' }),
      });
    });

    await page.goto('/next/intake');

    await expect(page.getByTestId('intake-wizard-root')).toBeVisible();
    await page.getByTestId('wizard-full-name').fill('Paciente Teste E2E');
    await expect(page.getByTestId('wizard-full-name')).toHaveValue('Paciente Teste E2E');

    // Give the (now-suppressed) refresh/redirect cascade time to run if it
    // were still wired up — before the fix this fired a real navigation
    // to /login within a few seconds even with no backend listening.
    await page.waitForTimeout(3000);
    await expect(page).toHaveURL(/\/next\/intake/);
  });
});

test.describe('Participant identity segregation (RF005/RNF007) — real backend (#327, entity+read-path landed in #363)', () => {
  test.skip(!apiBaseURL, 'PLAYWRIGHT_API_BASE_URL not set — run via npm run test:e2e:docker');

  test.afterAll(async () => {
    await closeSeedDb();
  });

  // dict-07_ALINHAMENTO_CODIGO.md row 1 / migration table row 2: the
  // target model requires patientName/birthDate/identityDocument to live
  // in a segregated ParticipantIdentity entity, not as direct fields on
  // the scientific Participant record — "Segregar, cifrar e não projetar
  // ao grafo". #363 landed the ParticipantIdentity entity/collection and
  // stripped these fields from GET /api/patients/:id's response; the
  // Patient document itself still carries them internally pending a
  // larger follow-up migrating its other ~20 consumers off it.
  test('AC#1/AC#2: patientName/birthDate are not returned as direct fields on the participant resource', async ({
    request,
  }) => {
    const admin = await realLogin(request);
    const participant = await createRealParticipant(request, apiBaseURL!, admin.token);

    const get = await request.get(`${apiBaseURL}/api/patients/${participant.participantId}`, {
      headers: { Authorization: `Bearer ${admin.token}` },
    });
    expect(get.status()).toBe(200);
    const resource = (await get.json()).data;

    // AC#1: participantId is the canonical research identifier — it must
    // still be present on the participant resource.
    expect(resource.participantId).toBeTruthy();

    // AC#2: civil identity (name, exact birth date, contacts, civil
    // identifiers) belongs in ParticipantIdentity under reinforced
    // controls, not as direct fields alongside the scientific record.
    expect(resource.patientName).toBeUndefined();
    expect(resource.birthDate).toBeUndefined();
    expect(resource.identityDocument).toBeUndefined();
  });

  // RNF007 AC#3: ParticipantIdentity must never be projected to Neo4j.
  // Today's outbox projections (neo4jCanonicalProjection.service.js) only
  // ever carry a pseudonymized Donor.id derived from participantId — this
  // sub-assertion is expected to already hold, unlike AC#1/AC#2 above, and
  // documents that the eventual ParticipantIdentity build must preserve it.
  test('AC#3: no participant identity fields appear in the Neo4j-facing outbox payload', async ({ request }) => {
    const admin = await realLogin(request);
    const participant = await createRealParticipant(request, apiBaseURL!, admin.token);
    const participantId = participant.participantId;

    // No API surface exists to inspect the outbox (same gap
    // seedParticipant.ts documents for consent/location fixtures) — read
    // the `graph_projection_outbox` collection directly, the same one
    // neo4jOutbox.service.js's COLLECTION_NAME writes to.
    const client = new MongoClient(mongoUri);
    await client.connect();
    try {
      const events = await client
        .db(mongoDbName)
        .collection('graph_projection_outbox')
        .find({ $or: [{ aggregateId: participantId }, { 'payload.participantId': participantId }] })
        .toArray();

      for (const event of events) {
        const serialized = JSON.stringify(event.payload || {});
        expect(serialized).not.toMatch(/patientName/);
        expect(serialized).not.toMatch(/birthDate/);
        expect(serialized).not.toMatch(/identityDocument/);
      }
    } finally {
      await client.close();
    }
  });
});
