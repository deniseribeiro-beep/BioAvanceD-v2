import { APIRequestContext } from '@playwright/test';
import { MongoClient, Db, ObjectId } from 'mongodb';

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

// directConnection=true (#297): mongodb-test is now a single-node replica
// set, so a plain localhost URI triggers topology discovery against the
// hosts advertised in rs.status() (mongodb-test:27017) — a hostname the
// host machine can't resolve outside the compose network. Forcing a direct
// connection to the published port skips that discovery.
const mongoUri = process.env.E2E_MONGO_URI || 'mongodb://localhost:27017?directConnection=true';
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

export interface SeededStorageBox {
  boxId: string;
  positionCode: string;
}

/**
 * Seeds a usable StorageBox -> RACK -> SHELF -> FREEZER hierarchy plus an
 * operational equipment + sensor pair — sample.service.js's createSample
 * (#462) requires boxId/positionCode to resolve through
 * resolveStorageHierarchyForBox to a FREEZER whose containerID matches a
 * non-blocked-status Equipment doc and a non-critical-status Sensor doc.
 * Supersedes the pre-#462 `seedOperationalLocation` (legacy `locationID` ->
 * `locations` doc), which sample.service.js no longer reads at all
 * (`delete sampleData.locationID` happens unconditionally on create).
 */
export async function seedStorageBoxLocation(): Promise<SeededStorageBox> {
  const db = await getDb();
  const suffix = Date.now();
  const containerID = `RF004-e2e-EQ-${suffix}`;
  const positionCode = 'A1';

  const freezerResult = await db.collection('storageContainers').insertOne({
    name: `RF004 e2e freezer ${suffix}`,
    containerType: 'FREEZER',
    containerID,
    // #598: a raw insertOne bypasses StorageContainer.js's Mongoose
    // default (`status: 'OPERATIONAL'`) — without this explicit field,
    // MongoStorageTopologyReadRepository.listOperationalFreezers() (GET
    // /api/storage/freezers, the real freezer picker) never returns this
    // freezer, even though createSample's own storage resolution doesn't
    // check status at all. Matches seedSensor.ts's seedFreezerContainer().
    status: 'OPERATIONAL',
    parent_id: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const shelfResult = await db.collection('storageContainers').insertOne({
    name: `RF004 e2e shelf ${suffix}`,
    containerType: 'SHELF',
    parent_id: freezerResult.insertedId,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const rackResult = await db.collection('storageContainers').insertOne({
    name: `RF004 e2e rack ${suffix}`,
    containerType: 'RACK',
    parent_id: shelfResult.insertedId,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const boxResult = await db.collection('storageBoxes').insertOne({
    name: `RF004 e2e box ${suffix}`,
    parent_id: rackResult.insertedId,
    // #474: allocateSamplePosition's in-bounds check needs this — 'A1'
    // (rowIndex 0, column 1) is within an 8x12 box.
    dimension: { rows: 8, cols: 12 },
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  await db.collection('equipment').insertOne({
    equipmentID: containerID,
    status: 'operational',
    createdAt: new Date(),
  });
  await db.collection('sensors').insertOne({
    locationId: containerID,
    status: 'ok',
    createdAt: new Date(),
  });

  return { boxId: boxResult.insertedId.toString(), positionCode };
}

/**
 * Sets an already-seeded StorageBox's status to RETIRED (#646 Wave 3,
 * RF017 AC#7) — StorageBox.js's Mongoose default is ACTIVE and
 * seedStorageBoxLocation doesn't set status at all, so this is the only
 * way to get a real, hierarchy-complete box into the RETIRED state a
 * spec needs to prove MongoStorageRepository.checkLocationBlocked's
 * box-level rejection against the real backend.
 */
export async function retireStorageBox(boxId: string): Promise<void> {
  const db = await getDb();
  await db.collection('storageBoxes').updateOne(
    { _id: new ObjectId(boxId) },
    { $set: { status: 'RETIRED' } }
  );
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
/**
 * RF004 AC#3 (#295) fixtures: seeds a real Study/Protocol/Collection
 * document directly against Mongo — there's no CRUD API for any of the
 * three yet (only sample.service.js's createSample resolves them by
 * business id), so specs proving the linkage-must-resolve requirement
 * seed the referent directly, the same way seedOperationalLocation does
 * for locations/sensors.
 */
// studyStatus defaults to 'active' (StudyModel.create's own default) —
// pass an override to seed a study RF021 AC#5's enforcement path (#591,
// #596) must reject linkage against.
export async function seedStudy(studyId: string, options: { studyStatus?: string } = {}): Promise<void> {
  const db = await getDb();
  await db.collection('studies').insertOne({
    studyId,
    studyTitle: `RF004 e2e study ${studyId}`,
    studyStatus: options.studyStatus || 'active',
    ethicsApprovalId: [`CAAE-${studyId}`],
    createdAt: new Date(),
  });
}

// approvalStatus defaults to 'approved' (ProtocolModel.create's own
// default) — pass an override to seed a protocol RF021 AC#5's enforcement
// path (#591) must reject linkage against.
export async function seedProtocol(protocolId: string, options: { approvalStatus?: string } = {}): Promise<void> {
  const db = await getDb();
  await db.collection('protocols').insertOne({
    protocolId,
    protocolName: `RF004 e2e protocol ${protocolId}`,
    approvalStatus: options.approvalStatus || 'approved',
    effectivePeriod: { start: new Date('2026-01-01'), end: null },
    createdAt: new Date(),
  });
}

export async function seedCollectionEntity(collectionId: string): Promise<void> {
  const db = await getDb();
  await db.collection('collections').insertOne({
    collectionId,
    collectionName: `RF004 e2e collection ${collectionId}`,
    collectionStatus: 'active',
    createdAt: new Date(),
  });
}

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
