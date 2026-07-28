import { APIRequestContext } from '@playwright/test';
import { MongoClient, Db } from 'mongodb';

/**
 * RF004 (#294) fixture: seeds a real participant with an active consent
 * template, for specs that need a genuine happy-path create (specimenId
 * generation, SPREC recording, consent-state blocking) rather than the
 * negative-path-only hardcoded participantId used elsewhere.
 *
 * There's no API to seed a consentTemplate (only the manual
 * api/backend/scripts/create-active-tcle.js dev script) or an active
 * consent (a separate `consents` collection, unrelated to Patient
 * status) — so this connects to the test stack's Mongo directly, the
 * same database backend-app-test itself uses. Requires
 * compose.test.yml's mongodb-test port published to the host (added in
 * #294) since `npm run test:e2e:docker` runs Playwright from the host,
 * not from inside the `playwright-runner` container.
 */

const mongoUri = process.env.E2E_MONGO_URI || 'mongodb://localhost:27017';
const mongoDbName = process.env.E2E_MONGO_DB || 'bioavanced_test';

let client: MongoClient | null = null;

async function getDb(): Promise<Db> {
  if (!client) {
    client = new MongoClient(mongoUri);
    await client.connect();
  }
  return client.db(mongoDbName);
}

/** Closes the shared Mongo connection — call once from a suite's afterAll. */
export async function closeSeedDb(): Promise<void> {
  if (client) {
    await client.close();
    client = null;
  }
}

async function seedActiveConsentTemplate(db: Db): Promise<string> {
  // Canonical name is `consent_templates` (snake_case), not the
  // `consentTemplates` field/param name used throughout the API layer —
  // see api/backend/src/config/collections.js's CANONICAL_COLLECTIONS map.
  const templates = db.collection('consent_templates');
  const result = await templates.insertOne({
    title: `RF004 e2e consent template ${Date.now()}`,
    content: 'Termo de Consentimento Livre e Esclarecido para testes e2e (RF004).',
    version: 'v1',
    active: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  return result.insertedId.toString();
}

export interface SeededParticipant {
  participantId: string;
  consentTemplateId: string;
}

/**
 * Seeds a usable physical location + operational sensor — sample.service.js's
 * createSample requires locationID to resolve to a `locations` doc with an
 * associated, non-critical-status `sensors` doc (no equipmentID here, so
 * the equipment check is skipped). Neither collection is seeded by the test
 * stack by default; every happy-path specimen create needs one.
 */
export async function seedOperationalLocation(): Promise<number> {
  const db = await getDb();
  const locationID = Date.now() % 1_000_000;

  await db.collection('locations').insertOne({
    locationID,
    name: `RF004 e2e location ${locationID}`,
    createdAt: new Date(),
  });
  await db.collection('sensors').insertOne({
    locationID,
    status: 'ok',
    createdAt: new Date(),
  });

  return locationID;
}

/**
 * Creates a real participant via POST /api/patients (server-generates
 * participantId), against a freshly-seeded active consent template.
 * `patientData` is not persisted anywhere PHI-sensitive gets logged —
 * the create response only ever echoes participantId back (LGPD).
 */
export async function createRealParticipant(
  request: APIRequestContext,
  apiBaseURL: string,
  token: string
): Promise<SeededParticipant> {
  const db = await getDb();
  const consentTemplateId = await seedActiveConsentTemplate(db);

  const response = await request.post(`${apiBaseURL}/api/patients`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      // participantId is required by PatientModel.validate even though
      // patient.service.js always discards and server-regenerates it
      // (validation runs before that regeneration step) — see
      // api/backend/src/services/patient.service.js:464,501.
      participantId: 'placeholder',
      patientName: `RF004 e2e participant ${Date.now()}`,
      birthDate: '1990-01-01',
      sex: 'F',
      consentTemplateId,
    },
  });

  if (!response.ok()) {
    const body = await response.text();
    throw new Error(`createRealParticipant: patient creation failed (${response.status()}): ${body}`);
  }

  const body = await response.json();
  const participantId = body?.data?.participantId;
  if (!participantId) {
    throw new Error(`createRealParticipant: response missing participantId: ${JSON.stringify(body)}`);
  }

  return { participantId, consentTemplateId };
}

/**
 * Seeds an ACTIVE consent record for a participant, the separate
 * `consents` collection consulted by consent.validator.js's
 * validateAccess (withdraw/return routes) — a participant created via
 * createRealParticipant has none by default, so operations against
 * their specimens stay blocked (AC#6) until this is called.
 */
export async function seedActiveConsent(
  participantId: string,
  responses: Record<string, boolean> = {}
): Promise<void> {
  const db = await getDb();
  // Canonical name is `patientConsents` — see collections.js's
  // CANONICAL_COLLECTIONS['consents'], consulted by consent.validator.js.
  await db.collection('patientConsents').insertOne({
    participantId: String(participantId),
    status: 'ACTIVE',
    responses,
    signedAt: new Date(),
    createdAt: new Date(),
  });
}
