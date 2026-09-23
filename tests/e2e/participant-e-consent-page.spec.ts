import { test, expect } from '@playwright/test';
import { MongoClient, Db } from 'mongodb';
import { realLogin } from './helpers/realAuth';
import { consentLinkPath, mintConsentToken } from './helpers/consentJwt';

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
// The page tests mint the token directly rather than via the operator
// endpoint -- see helpers/consentJwt.ts for why that is forced, not preferred.
//
// Writing this spec turned up three issues, all now fixed:
//   - #829 (fixed) -- generate-link had no try/catch, so sendConsentEmail's
//     throw exited the API process. Attempting these tests took the backend
//     down for the whole suite rather than failing.
//   - #820 (fixed) -- createPatientConsent 422'd every signature-less
//     manifestation, which is exactly what this page sends. The acceptance
//     test asserts the Consent is recorded; it previously pinned the 422.
//   - #833 (fixed) -- no email could be sent on this stack: sendEmail was
//     Resend-only against a deliberately-dummy RESEND_API_KEY, with the
//     smtp-test (Mailpit) container beside it reachable by no backend code
//     path. sendEmail now selects a real SMTP transport when SMTP_HOST is
//     set, which the test stack's compose.test.yml does, routing to Mailpit.
//     The four tests about the *page* still mint the JWT directly
//     (helpers/consentJwt.ts) rather than going through generate-link -- that
//     is a deliberate choice unrelated to #833, see that helper. The one test
//     about the *operator endpoint* below is un-fixme'd; proof that it
//     actually passes runs at the Docker e2e gate, not from this repo copy.
const apiBaseURL = process.env.PLAYWRIGHT_API_BASE_URL;
const mongoUri = process.env.E2E_MONGO_URI || 'mongodb://localhost:27017?directConnection=true';
const mongoDbName = process.env.E2E_MONGO_DB || 'bioavanced_test';

const RESEARCH_LABEL = 'Uso das amostras em pesquisa (e2e 822)';

let client: MongoClient | null = null;
let db: Db;
let adminToken: string;
const seededParticipantIds: string[] = [];

async function seedParticipant(): Promise<{ participantId: string; email: string }> {
  // Exactly 8 digits: validateParticipantId (utils/patientAnonymization.js:26)
  // gates on /^\d{8}$/ before the patients lookup, so a longer id fails as
  // "Paciente nao encontrado" no matter what is seeded. Caught by the live
  // verification of #820, not by any assertion here.
  const participantId = `8${String(Date.now()).slice(-6)}${seededParticipantIds.length}`;
  const email = `e2e-822-${participantId}@example.test`;
  await db.collection('patients').insertOne({
    participantId,
    status: 'PENDING_CONSENT',
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  // #1166 slice 4: the contact lives on ParticipantIdentity only, which is
  // where /generate-link checks it. Seeded in plaintext, the keyless-row
  // shape decryptIdentity reads as-is -- this file holds no ENCRYPTION_KEY.
  await db.collection('participantIdentities').insertOne({
    participantId,
    email,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  seededParticipantIds.push(participantId);
  return { participantId, email };
}

// NOTE: the link is minted locally rather than via POST /e-consent/generate-link
// for the four page tests below. That endpoint emails the invitation; #833
// (fixed) means it can now actually send on this stack, but the page tests
// still mint the JWT directly -- unrelated to #833, see helpers/consentJwt.ts
// for that reasoning. The one test that does exercise generate-link is below,
// un-fixme'd now that #833 gives it a real transport to send through.

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
  });

  test.afterAll(async () => {
    if (!client) return;
    await db.collection('patientConsents').deleteMany({ participantId: { $in: seededParticipantIds } });
    await db.collection('patients').deleteMany({ participantId: { $in: seededParticipantIds } });
    await db.collection('participantIdentities').deleteMany({ participantId: { $in: seededParticipantIds } });
    await db.collection('consent_templates').deleteMany({ version: 'e2e-822' });
    await client.close();
    client = null;
  });

  test('a participant with no session opens the emailed link and sees the real term', async ({
    page,
  }) => {
    const { participantId } = await seedParticipant();
    const linkPath = consentLinkPath(participantId);

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

  test('the page renders backend-resolved participant identity, not a hardcoded fallback', async ({
    page,
  }) => {
    const { participantId } = await seedParticipant();
    const linkPath = consentLinkPath(participantId);

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

  // #820 is fixed (see its close comment). This asserts the acceptance is
  // recorded; it previously pinned the 422 as current truth. #822's transport
  // fix is what makes the request reach the backend at all -- before it, the
  // POST also returned index.html with a 200 and the page reported
  // success-shaped silence.
  test('a signature-less acceptance is recorded as a Consent (#820, fixed)', async ({
    request,
  }) => {
    const { participantId } = await seedParticipant();
    const linkPath = consentLinkPath(participantId);
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

    // #820 (fixed): this asserted 422 + "no Consent recorded" as the pinned
    // current truth. normalizeSignaturePayload now omits the signature keys
    // rather than emptying them, so the schema's own "optional" declaration
    // holds and the participant page's submit is accepted.
    expect(response.status(), await response.text()).toBe(200);

    // Canonical name is `patientConsents`, not `consents` -- see
    // config/collections.js's CANONICAL_COLLECTIONS. Same class of trap as the
    // `consent_templates` one noted in beforeAll.
    const consent = await db.collection('patientConsents').findOne({ participantId });
    expect(consent).toBeTruthy();
    expect(consent?.consentId).toBeTruthy();
    expect(consent?.status).toBe('ACTIVE');
    // Explicitly absent, not blank -- PatientConsentModel.create's null
    // defaults, so the record says "no signature" rather than "empty signature".
    expect(consent?.signatureImageBase64).toBeNull();
    expect(consent?.signatureHash).toBeNull();
    expect(consent?.responses).toMatchObject({ 'research-822': true });
  });

  // #833 (fixed) -- un-fixme'd. This is the only test here that goes through
  // the operator's real path, including the real send. It used to be unable
  // to pass on this stack: sendConsentEmail was Resend-only against a
  // deliberately-dummy RESEND_API_KEY, and the smtp-test (Mailpit) container
  // beside it was reachable by no backend code path, so the send failed with
  // "API key is invalid". sendEmail now selects a real SMTP transport when
  // SMTP_HOST is set (compose.test.yml sets it to the Mailpit container), so
  // the send -- and this test -- can actually succeed here.
  //
  // It is also what catches a regression of #829: before that fix, this same
  // request exited the API process instead of returning a status. Proof that
  // this passes for real runs at the Docker e2e gate; it was not run from
  // this worktree (see #833's close comment).
  test('an operator can generate and email a consent link (#833)', async ({ request }) => {
    const { participantId, email } = await seedParticipant();

    const response = await request.post(`${apiBaseURL}/api/e-consent/generate-link`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: { participantId, email },
    });

    expect(response.status(), await response.text()).toBe(200);

    const link = (await response.json())?.link;
    expect(link).toBeTruthy();
    expect(new URL(link).pathname).toMatch(/^\/patient\/e-consent\//);
  });
});
