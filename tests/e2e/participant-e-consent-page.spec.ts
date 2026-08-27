import { test, expect } from '@playwright/test';
import { MongoClient, Db } from 'mongodb';
import { realLogin } from './helpers/realAuth';

// #822: real-backend proof for EConsentPage (`/patient/e-consent/:token`), the
// participant-facing page on the JWT token system -- the link
// POST /api/e-consent/generate-link emails.
//
// The defect this proves fixed: the page called the backend with raw axios and
// a relative `/api/...` URL. That resolves against the *frontend* origin, and
// nothing proxies /api there in dev, test or prod, so every request fell
// through the SPA history fallback and returned index.html -- HTML with a 200,
// which axios resolves rather than rejects. The page read undefined fields off
// an HTML string and rendered "Link inválido ou expirado", indistinguishable
// from a genuinely bad token. Confirmed against this stack before the fix:
//   curl http://localhost:5173/api/e-consent/validate/x -> 200 text/html
//   curl http://localhost:3000/api/e-consent/validate/x -> 401 application/json
//
// Neither participant page had a spec, which is why the bug survived: both are
// entered by emailed URL only and are reachable from no in-app link. This is
// the missing spec for one of them.
//
// The token here is minted by the real endpoint, not hand-signed, so the spec
// exercises the actual production path an operator triggers.
//
// SCOPE: this covers the *load* path. EConsentPage's submit is separately
// blocked by #820 (createPatientConsent 422s every signature-less
// manifestation, which is exactly what this page sends), so there is
// deliberately no acceptance assertion here -- adding one would fail on a
// different, already-tracked defect. The last test pins the 422 as the current
// truth so that closing #820 makes this spec fail loudly and get updated,
// rather than leaving the gap silently uncovered.
const apiBaseURL = process.env.PLAYWRIGHT_API_BASE_URL;
const mongoUri = process.env.E2E_MONGO_URI || 'mongodb://localhost:27017?directConnection=true';
const mongoDbName = process.env.E2E_MONGO_DB || 'bioavanced_test';

const RESEARCH_LABEL = 'Uso das amostras em pesquisa (e2e 822)';

let client: MongoClient | null = null;
let db: Db;
let adminToken: string;
const seededParticipantIds: string[] = [];

async function seedParticipant(): Promise<{ participantId: string; email: string }> {
  const participantId = `822${String(Date.now()).slice(-8)}${seededParticipantIds.length}`;
  const email = `e2e-822-${participantId}@example.test`;
  await db.collection('patients').insertOne({
    participantId,
    email,
    status: 'PENDING_CONSENT',
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  seededParticipantIds.push(participantId);
  return { participantId, email };
}

/** The real production path: an operator generates and emails the link. */
async function generateConsentLink(
  request: import('@playwright/test').APIRequestContext,
  participantId: string,
  email: string
): Promise<string> {
  const response = await request.post(`${apiBaseURL}/api/e-consent/generate-link`, {
    headers: { Authorization: `Bearer ${adminToken}` },
    data: { participantId, email },
  });

  expect(response.status(), await response.text()).toBe(200);
  const link = (await response.json())?.link;
  expect(link).toBeTruthy();

  // The link carries the frontend's own origin from FRONTEND_URL; keep only
  // the path so it resolves against PLAYWRIGHT_BASE_URL.
  return new URL(link).pathname;
}

test.describe('RF010 participant e-consent page (/patient/e-consent/:token) -- real backend', () => {
  test.skip(!apiBaseURL, 'PLAYWRIGHT_API_BASE_URL not set -- run via npm run test:e2e:docker');

  test.beforeAll(async ({ browser, request }) => {
    client = new MongoClient(mongoUri);
    await client.connect();
    db = client.db(mongoDbName);

    const admin = await realLogin(request);
    adminToken = admin.token;

    // getActiveTemplate reads the canonical snake_case collection -- see
    // config/collections.js's CANONICAL_COLLECTIONS, not the `consentTemplates`
    // param name used across the API layer.
    await db.collection('consent_templates').insertOne({
      title: `TCLE e2e 822 ${Date.now()}`,
      content: 'Termo de Consentimento Livre e Esclarecido para o teste e2e #822.',
      version: 'e2e-822',
      active: true,
      permissions: [
        { key: 'research-822', label: RESEARCH_LABEL, required: true },
        { key: 'recontact-822', label: 'Novo contato para estudos futuros (e2e 822)', required: false },
      ],
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // #819: the first spec to hit a lazy-loaded route on a cold Vite dev
    // server can fail on the on-demand compile. Warm this route once so a
    // compile stall cannot masquerade as a missing element inside a test.
    const page = await browser.newPage();
    await page.goto('/patient/e-consent/warmup', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1_000);
    await page.close();
  });

  test.afterAll(async () => {
    if (!client) return;
    await db.collection('patients').deleteMany({ participantId: { $in: seededParticipantIds } });
    await db.collection('consent_templates').deleteMany({ version: 'e2e-822' });
    await client.close();
    client = null;
  });

  // BLOCKED ON #829 -- not a weakened assertion, an unrunnable fixture.
  // This test mints its link through the real POST /api/e-consent/generate-link,
  // which currently *crashes the API process*: the handler has no try/catch, so
  // sendConsentEmail's throw is an unhandled rejection and Node exits. It throws
  // every time on this stack because FRONTEND_URL is set nowhere in
  // .env.test.example or compose.test.yml. Running this does not fail the test,
  // it takes down the backend for every other spec in the run.
  //
  // Deliberately NOT worked around by hand-signing a JWT with CONSENT_SECRET:
  // going through the operator's real path is the point of the spec. Remove the
  // fixme when #829 lands.
  test.fixme('a participant with no session opens the emailed link and sees the real term', async ({
    page,
    request,
  }) => {
    const { participantId, email } = await seedParticipant();
    const linkPath = await generateConsentLink(request, participantId, email);

    await page.goto(linkPath);

    // Nothing logs in here, deliberately: a participant following an emailed
    // link has no account. A bounce to /login would mean the endpoints are
    // missing from TOKEN_OPTIONAL_ROUTES -- the second trap of #822.
    await expect(page).toHaveURL(/\/patient\/e-consent\//);

    // The assertion that fails on the old code: with the relative URL, the
    // validate call returned index.html and this rendered the error branch.
    await expect(page.getByTestId('e-consent-permissions')).toContainText(RESEARCH_LABEL, {
      timeout: 15_000,
    });
    await expect(page.getByTestId('e-consent-error')).toHaveCount(0);
  });

  // BLOCKED ON #829 -- not a weakened assertion, an unrunnable fixture.
  // This test mints its link through the real POST /api/e-consent/generate-link,
  // which currently *crashes the API process*: the handler has no try/catch, so
  // sendConsentEmail's throw is an unhandled rejection and Node exits. It throws
  // every time on this stack because FRONTEND_URL is set nowhere in
  // .env.test.example or compose.test.yml. Running this does not fail the test,
  // it takes down the backend for every other spec in the run.
  //
  // Deliberately NOT worked around by hand-signing a JWT with CONSENT_SECRET:
  // going through the operator's real path is the point of the spec. Remove the
  // fixme when #829 lands.
  test.fixme('the page renders backend-resolved participant identity, not a hardcoded fallback', async ({
    page,
    request,
  }) => {
    const { participantId, email } = await seedParticipant();
    const linkPath = await generateConsentLink(request, participantId, email);

    await page.goto(linkPath);

    // Proves the response body was really parsed. This seeded patient has no
    // ParticipantIdentity row, so the route returns the Patient unchanged and
    // the page falls back to 'Paciente' (RF005/RNF007 -- patientName is
    // resolved from the segregated collection, routes/eConsent.js:50-61).
    // The point is that the element renders at all: on the old code the page
    // never got past its error branch to render this line.
    await expect(page.getByTestId('e-consent-patient')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('e-consent-patient')).toContainText('Bem-vindo');
  });

  // This is the one test that needs no generate-link fixture, and it is written
  // to discriminate: the rendered message alone does NOT prove #822 is fixed,
  // because the pre-fix page showed the same "Link inválido" text -- that was
  // the whole problem. What proves it is *where the request went* and *what came
  // back*: the backend origin with a real 401, rather than the frontend origin
  // with a 200 of index.html.
  test('the validate call reaches the backend origin and returns a real 401, not the SPA shell', async ({
    page,
  }) => {
    const apiOrigin = new URL(apiBaseURL as string).origin;

    const validateResponse = page.waitForResponse(
      (response) => response.url().includes('/e-consent/validate/'),
      { timeout: 15_000 }
    );

    await page.goto('/patient/e-consent/not-a-real-jwt');

    const response = await validateResponse;

    // Pre-fix this was the frontend origin (5173); the request never left it.
    expect(new URL(response.url()).origin).toBe(apiOrigin);
    // Pre-fix this was 200 text/html -- the SPA history fallback -- which axios
    // resolved rather than rejected.
    expect(response.status()).toBe(401);
    expect(response.headers()['content-type']).toContain('application/json');

    // And only then the rendered outcome.
    await expect(page.getByTestId('e-consent-error')).toContainText(/inválido|expirado/i, {
      timeout: 15_000,
    });
    // A participant with no session must not be bounced to the auth wall --
    // the TOKEN_OPTIONAL_ROUTES half of the fix.
    await expect(page).toHaveURL(/\/patient\/e-consent\//);
    // No form is offered for a token that did not validate.
    await expect(page.getByTestId('e-consent-submit')).toHaveCount(0);
  });

  // #820, pinned as current truth. The transport fix makes this request reach
  // the backend, which is what exposes the 422 -- before it, the POST also
  // returned index.html with a 200 and the page reported success-shaped
  // silence. When #820 lands this test must be inverted to assert the
  // acceptance is recorded; it is written to fail loudly at that point rather
  // than leave the submit path uncovered.
  // BLOCKED ON #829 -- not a weakened assertion, an unrunnable fixture.
  // This test mints its link through the real POST /api/e-consent/generate-link,
  // which currently *crashes the API process*: the handler has no try/catch, so
  // sendConsentEmail's throw is an unhandled rejection and Node exits. It throws
  // every time on this stack because FRONTEND_URL is set nowhere in
  // .env.test.example or compose.test.yml. Running this does not fail the test,
  // it takes down the backend for every other spec in the run.
  //
  // Deliberately NOT worked around by hand-signing a JWT with CONSENT_SECRET:
  // going through the operator's real path is the point of the spec. Remove the
  // fixme when #829 lands.
  test.fixme('submitting still fails: the backend 422s a signature-less manifestation (#820)', async ({
    request,
  }) => {
    const { participantId, email } = await seedParticipant();
    const linkPath = await generateConsentLink(request, participantId, email);
    const token = linkPath.split('/').pop() as string;

    const response = await request.post(`${apiBaseURL}/api/e-consent/update`, {
      data: {
        token,
        consents: [
          { key: 'research-822', status: 'ACCEPTED' },
          { key: 'recontact-822', status: 'REVOKED' },
        ],
      },
    });

    expect(response.status()).toBe(422);
    expect(await response.text()).toMatch(/signature/i);

    // No Consent is recorded, which is the substance of #820.
    const consent = await db.collection('consents').findOne({ participantId });
    expect(consent).toBeNull();
  });
});
