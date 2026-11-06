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
    // #1227: the driver's default server selection waits 30 s, the same as a
    // Playwright hook's budget, so a stalled connect surfaced as an anonymous
    // "afterAll hook timeout" instead of the driver's own error. 10 s leaves
    // the hook time to report what actually stalled. socketTimeoutMS covers
    // the same class once connected (a hung deleteOne never finishing).
    client = new MongoClient(mongoUri, {
      serverSelectionTimeoutMS: 10_000,
      socketTimeoutMS: 10_000,
    });
    await client.connect();
  }
  return client.db(mongoDbName);
}

/** Closes the shared Mongo connection — call once from a suite's afterAll. */
export async function closeSeedDb(): Promise<void> {
  if (!client) return;
  const closing = client;
  client = null;
  try {
    // #1227: client.close() has no driver-side budget; a stuck topology close
    // would otherwise burn the whole afterAll timeout with no [e2e-cleanup] line.
    await Promise.race([
      closing.close(),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('closeSeedDb timed out after 5000 ms')), 5_000);
      }),
    ]);
  } catch (error) {
    const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    console.error(`[e2e-cleanup] ${new Date().toISOString()} closeSeedDb failed: ${message}`);
  }
}

/**
 * RF007 AC2 / RNF016 C4 (#1419): reads where a sample_files row says its
 * binary lives. A row the S3 store wrote has storagePath null; one the
 * filesystem store wrote names a local path.
 */
export interface SampleFileStorage {
  storagePath?: string | null;
  storageUri?: string | null;
  storageObjectVersion?: string | null;
}

export async function readSampleFileStorage(fileId: string): Promise<SampleFileStorage | null> {
  const db = await getDb();
  return db.collection('sample_files').findOne<SampleFileStorage>(
    { _id: new ObjectId(fileId) },
    { projection: { _id: 0, storagePath: 1, storageUri: 1, storageObjectVersion: 1 } },
  );
}

/**
 * RF007 AC3-6, RNF029 (#1477): the whole sample_files row, so a spec can show
 * its retention policy, its malware verdict, its logical delete and that it
 * holds no file bytes. No route returns the row as stored.
 */
export async function readSampleFileRow(fileId: string): Promise<Record<string, any> | null> {
  const db = await getDb();
  return db.collection('sample_files').findOne({ _id: new ObjectId(fileId) });
}

/** RF007 AC4 (#1477): a file's DataFileVersion rows, oldest first. No route lists them. */
export async function readDataFileVersions(fileId: string): Promise<Array<Record<string, any>>> {
  const db = await getDb();
  return db.collection('dataFileVersions').find({ fileId }).sort({ versionNumber: 1 }).toArray();
}

/** RF007 AC6/AC7 (#1477): the audit rows one file action wrote, e.g. FILE_DELETE. */
export async function findSampleFileAuditRows(action: string, fileId: string): Promise<Array<Record<string, any>>> {
  const db = await getDb();
  return db.collection('logs').find({ action, resourceType: 'SampleFile', resourceId: fileId }).toArray();
}

/** Removes the retention policies a spec created, so a kept volume does not gather them. */
export async function deleteRetentionPolicies(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const db = await getDb();
  await db.collection('retentionPolicies').deleteMany({ _id: { $in: ids.map((id) => new ObjectId(id)) } });
}

export async function seedActiveConsentTemplate(db: Db): Promise<string> {
  // Canonical name is `consent_templates` (snake_case), not the
  // `consentTemplates` field/param name used throughout the API layer —
  // see api/backend/src/config/collections.js's CANONICAL_COLLECTIONS map.
  //
  // One shared fixture, upserted, not a fresh insert per call: every caller
  // only needs *an* active template id, and a per-call insert with no
  // cleanup left 1317 active templates on the kept test volume, all served
  // by GET /api/e-consent/consent-templates (~345 KB) on every wizard load.
  const templates = db.collection('consent_templates');
  const now = new Date();
  const doc = await templates.findOneAndUpdate(
    { e2eFixture: 'rf004-shared-consent-template' },
    {
      $setOnInsert: {
        title: 'RF004 e2e consent template',
        content: 'Termo de Consentimento Livre e Esclarecido para testes e2e (RF004).',
        version: 'v1',
        createdAt: now,
      },
      $set: { active: true, updatedAt: now },
    },
    { upsert: true, returnDocument: 'after' }
  );
  return String(doc?._id);
}

export interface SeededParticipant {
  participantId: string;
  consentTemplateId: string;
}

export interface SeededStorageBox {
  boxId: string;
  positionCode: string;
  rackId: string;
  shelfId: string;
  freezerId: string;
  equipmentId: string;
  /**
   * #757: numeric, not a string. StorageContainer.js declares
   * `containerID: { type: Number }` and Equipment.js rejects a
   * non-numeric `equipmentID` outright ("equipmentID deve ser um
   * número"); legacy-location-migration-mapping.md:26/97 settles that
   * the two are the same value ("keyed by `containerID` =
   * `Equipment.equipmentID`", "both plain numbers"). This fixture used
   * a `RF004-e2e-EQ-<ts>` string, which a raw insertOne let past both
   * schemas.
   */
  containerID: number;
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
  // #757: numeric -- see SeededStorageBox.containerID. The same value is
  // written to StorageContainer.containerID and Equipment.equipmentID
  // because sample.service.js's RF004 gate joins on exactly that equality
  // (`freezer.containerID === Equipment.equipmentID`, line 244), so the
  // two cannot be given different types independently.
  const containerID = suffix;
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

  const equipmentResult = await db.collection('equipment').insertOne({
    equipmentID: containerID,
    status: 'Active',
    // #774: this is a raw insertOne, so it bypasses Equipment.validate()
    // entirely -- which is exactly how this document spent a long time
    // carrying `status: 'operational'`, a value the model would have
    // refused and the RF004 gate passed only because it did not recognise
    // it. The status is fixed; `equipmentDescription` was the last field
    // the same validation run flagged. Running this document through
    // Equipment.validate() now returns isValid: true, so the fixture
    // finally describes something the product could actually have
    // persisted.
    // #886 item 2, resolved 2026-08-31: the raw insert STAYS, deliberately.
    // Equipment.create() does honour a caller-supplied numeric equipmentID
    // (Equipment.js:69-71 after #880's family of fixes), so constructing
    // through the model is possible -- but it would make this Playwright
    // helper import api/backend/src model internals across npm roots,
    // while the invariant the model would add is already enforced loudly
    // from the backend side: e2e-fixture-model-fidelity.arch.test.js
    // (f8443983) extracts THIS literal, runs it through
    // Equipment.validate(), and pins equipmentID === containerID for the
    // RF004 join. Change this document and that guard answers.
    equipmentDescription: `RF004 e2e freezer equipment ${suffix}`,
    createdAt: new Date(),
  });
  // #906: model-valid on purpose. The RF004 gates read this document's
  // fields (sample.service.js#isOperationalSensor and intakeWizard.js's
  // twin read status||maintenanceStatus), and the old shape
  // ({ status: 'ok' }, no sensorId/sensorType) was a value the Sensor
  // model refuses admitted only because the gate's check is permissive --
  // the exact #774/#886 mechanism one collection over. locationId must
  // stay === containerID (the gates join on the freezer's containerID).
  // e2e-fixture-model-fidelity.arch.test.js pins both.
  await db.collection('sensors').insertOne({
    sensorId: `e2e-sensor-${suffix}`,
    sensorType: 'temperature',
    maintenanceStatus: 'operational',
    locationId: containerID,
    createdAt: new Date(),
  });

  return {
    boxId: boxResult.insertedId.toString(),
    positionCode,
    rackId: rackResult.insertedId.toString(),
    shelfId: shelfResult.insertedId.toString(),
    freezerId: freezerResult.insertedId.toString(),
    equipmentId: equipmentResult.insertedId.toString(),
    containerID,
  };
}

/**
 * #724: deletes every doc a single seedStorageBoxLocation() call created
 * -- storageContainers (freezer/shelf/rack), the storageBox, the
 * equipment row, and the sensor row -- by the ids/containerID that call
 * returned. Call from the owning spec's afterAll.
 *
 * Root cause of #724 (521+ accumulated `equipment` debris rows in the
 * shared mongodb-test-data volume): seedStorageBoxLocation() never
 * returned an id for the equipment/sensor docs it created, so no caller
 * could ever target them for cleanup -- unlike organization/collection
 * fixtures, which already clean up per-test (see human-showcase.spec.ts's
 * Wave 2 finally block). This is the missing counterpart.
 */
export async function cleanupStorageBoxLocation(seeded: SeededStorageBox): Promise<void> {
  // #1227: every caller but one swallows this function's rejection, so the
  // step that failed is logged here first, with the fixture it leaves behind.
  // A full run's output then says which call stalled: grep "[e2e-cleanup]".
  let step = 'connect';
  try {
    const db = await getDb();
    step = 'storageBoxes.deleteOne';
    await db.collection('storageBoxes').deleteOne({ _id: new ObjectId(seeded.boxId) });
    step = 'storageContainers.deleteMany';
    await db.collection('storageContainers').deleteMany({
      _id: { $in: [seeded.rackId, seeded.shelfId, seeded.freezerId].map((id) => new ObjectId(id)) },
    });
    step = 'equipment.deleteOne';
    await db.collection('equipment').deleteOne({ _id: new ObjectId(seeded.equipmentId) });
    // The sensor doc has no id of its own in SeededStorageBox -- it shares
    // containerID (via its locationId field) with the equipment doc, so
    // that's what identifies it for deletion instead.
    step = 'sensors.deleteMany';
    await db.collection('sensors').deleteMany({ locationId: seeded.containerID });
  } catch (error) {
    const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    console.error(
      `[e2e-cleanup] ${new Date().toISOString()} cleanupStorageBoxLocation failed at ${step} ` +
        `(box ${seeded.boxId}, containerID ${seeded.containerID}): ${message}`
    );
    throw error;
  }
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
 * Sets an already-seeded StorageContainer's (rack/shelf/freezer) status
 * (#655 fix for #654's own AC#7 scope gap) — proves
 * MongoStorageRepository.checkLocationBlocked's *ancestor*-level rejection
 * against the real backend for the first time: #654 found storagePaths is
 * never written anywhere, so this branch could only be unit-tested until
 * checkLocationBlocked's live parent_id-walk fallback landed.
 */
export async function setStorageContainerStatus(containerId: string, status: string): Promise<void> {
  const db = await getDb();
  await db.collection('storageContainers').updateOne(
    { _id: new ObjectId(containerId) },
    { $set: { status } }
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
export async function seedProtocol(
  protocolId: string,
  options: { approvalStatus?: string; protocolVersion?: string } = {}
): Promise<void> {
  const db = await getDb();
  await db.collection('protocols').insertOne({
    protocolId,
    protocolName: `RF004 e2e protocol ${protocolId}`,
    protocolType: 'processing',
    protocolVersion: options.protocolVersion ?? '1.0',
    documentUri: `object://protocols/${protocolId}.pdf`,
    approvalStatus: options.approvalStatus || 'approved',
    effectivePeriod: { start: new Date('2026-01-01'), end: null },
    createdAt: new Date(),
  });
}

/**
 * RF029 slice 4/6 (#672) fixture: seeds a bare `samples` doc with just a
 * `specimenId`, the same minimal-raw-insert shape as seedStudy/seedProtocol
 * above -- the ingestion gateway's assertReferencesExist only needs the id
 * to resolve via findOne, not a fully-formed specimen through the real
 * create-sample flow.
 */
export async function seedRawSpecimen(specimenId: string): Promise<void> {
  const db = await getDb();
  // #906: deliberately NOT Sample.validate()-clean, and excluded from
  // e2e-fixture-model-fidelity.arch.test.js by design. This is a
  // reference stub -- assertReferencesExist resolves the id via findOne
  // and reads nothing else -- and enriching it to model validity would
  // put a fully-shaped specimen into every list/count-sensitive spec's
  // dataset for zero product-path payoff.
  await db.collection('samples').insertOne({
    specimenId,
    createdAt: new Date(),
  });
}

/**
 * RF029 slice 6/6 (#674) fixture: seeds a bare `assays` doc with just an
 * `assayId`, same minimal-raw-insert shape as seedRawSpecimen above --
 * the ingestion gateway's assertReferencesExist only needs the id to
 * resolve via findOne, not a fully-formed assay through the real
 * POST /api/assays flow.
 */
export async function seedAssay(assayId: string): Promise<void> {
  const db = await getDb();
  // #906: deliberately not Assay.validate()-clean -- reference stub,
  // same rationale and guard exclusion as seedRawSpecimen above.
  await db.collection('assays').insertOne({
    assayId,
    createdAt: new Date(),
  });
}

export async function seedCollectionEntity(collectionId: string): Promise<void> {
  const db = await getDb();
  await db.collection('collections').insertOne({
    collectionId,
    collectionName: `RF004 e2e collection ${collectionId}`,
    collectionStatus: 'active',
    governanceRegime: 'biorepository',
    createdAt: new Date(),
  });
}

/**
 * A collection stored before RF004 AC2 required a regime: the same document
 * with governanceRegime removed, as a legacy row would read.
 */
export async function clearCollectionRegime(collectionId: string): Promise<void> {
  const db = await getDb();
  await db.collection('collections').updateOne({ collectionId }, { $unset: { governanceRegime: '' } });
}

export async function seedActiveConsent(
  participantId: string,
  responses: Record<string, boolean> = {}
): Promise<void> {
  const db = await getDb();
  // Canonical name is `patientConsents` — see collections.js's
  // CANONICAL_COLLECTIONS['consents'], consulted by consent.validator.js.
  // #906: deliberately not PatientConsent.validate()-clean (no
  // consentTemplateId) and excluded from the fidelity guard by design --
  // the consent validator queries {participantId, status} only, and
  // inventing a template id here would be false evidence data (#821/#827
  // own the real recorder's evidence fields).
  await db.collection('patientConsents').insertOne({
    participantId: String(participantId),
    status: 'ACTIVE',
    responses,
    signedAt: new Date(),
    createdAt: new Date(),
  });
}

/**
 * RF024 (#646 Wave 3) fixture: seeds a real DUO `TerminologyConcept` doc
 * directly against Mongo. There's no create API for this collection (only
 * the RF028 reference-import pipeline populates it) and specs shouldn't
 * depend on whether that pipeline has actually run against this stack —
 * same "seed the referent directly" rationale as seedStudy/seedProtocol.
 * `systemUri` matches sources/duo.js's own fixed DUO ontology URI.
 */
export async function seedDuoConcept(code: string, options: { conceptStatus?: string } = {}): Promise<void> {
  const db = await getDb();
  await db.collection('terminologyConcepts').insertOne({
    terminologyConceptId: `rf024-e2e-${code}-${Date.now()}`,
    systemUri: 'http://purl.obolibrary.org/obo/duo.owl',
    code,
    version: 'rf024-e2e',
    display: `RF024 e2e DUO concept ${code}`,
    conceptStatus: options.conceptStatus || 'active',
    sourceRecordId: code,
    referenceDatasetReleaseId: 'rf024-e2e',
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

/**
 * #696 (RF005 AC4-6 real-backend proof) fixture: seeds a
 * `TerminologyConcept` **and** its owning `ReferenceDatasetRelease`
 * (`releaseStatus: 'active'`) so `activeCodeValidator.checkActiveCode`
 * (condition.service.js/phenotype-observation.service.js's active-release
 * gate, reused from RF029/#669) resolves the code as active — unlike
 * `seedDuoConcept` above, which only inserts the concept row (fine for
 * RF024's own flow, which doesn't call activeCodeValidator, but not
 * enough for RF005's Condition/PhenotypeObservation writes, which do).
 * `code` must match exactly what a real RF028 importer would have stored
 * (see reference-imports/sources/*.js's own `raw.id`-verbatim
 * normalization) — not what the intake wizard's own code-formatting
 * helpers produce, which is what #696 found actually diverges for OMIM.
 */
/**
 * #745: marker stamped onto the real `referenceDatasetReleases` docs that
 * `seedActiveTerminologyConcept` supersedes, so `cleanupActiveTerminologyConcepts`
 * can restore exactly those (and nothing the real importer superseded).
 */
const SUPERSEDED_BY_E2E_MARK = 'e2e-696-seedActiveTerminologyConcept';

export async function seedActiveTerminologyConcept(
  systemUri: string,
  code: string,
  display: string,
  options: { datasetCode?: string } = {}
): Promise<void> {
  const db = await getDb();
  const datasetCode = options.datasetCode || 'E2E';
  const referenceDatasetReleaseId = `e2e-696-${datasetCode}-${Date.now()}`;

  // #705: activeCodeValidator.checkActiveCode fails closed
  // (`ambiguous_active_release`) on more than one `releaseStatus: 'active'`
  // release per datasetCode — an invariant the real importer's own
  // `promoteRelease` (services/referenceRelease.service.js) guarantees by superseding
  // the prior active release, never leaving two active at once. This
  // fixture skipped that step, so every run left the previous run's
  // release active too. Mirror promoteRelease's own supersede behavior here.
  //
  // #745: on a stack whose reference-data bootstrap chain has run, the
  // release this supersedes is the *real* HPO/ORPHA/ICD10/OMIM release,
  // and `cleanupActiveTerminologyConcepts` only deleted this fixture's own
  // rows -- leaving the datasetCode with zero active releases and every
  // later active-code check (`pipeline-continuity`'s RF029 block) failing
  // `inactive_release`, permanently on a persistent volume. Stamp what we
  // supersede so cleanup can flip it back. A stamp on the doc (not an
  // in-memory list) also lets a later run repair a crashed run that never
  // reached its `afterAll`.
  await db.collection('referenceDatasetReleases').updateMany(
    { datasetCode, releaseStatus: 'active' },
    { $set: { releaseStatus: 'superseded', supersededByE2E: SUPERSEDED_BY_E2E_MARK, updatedAt: new Date() } }
  );

  await db.collection('referenceDatasetReleases').insertOne({
    referenceDatasetReleaseId,
    sourceId: `SRC_${datasetCode}`,
    datasetCode,
    datasetName: `#696 e2e ${datasetCode} release`,
    systemUri,
    datasetVersion: 'e2e-696',
    retrievalUri: 'file://e2e-696-fixture',
    accessMethod: 'manual_upload',
    sourceFormat: ['JSON'],
    license: 'e2e-fixture',
    licenseUri: null,
    sourceChecksum: 'e2e-696',
    parserVersion: '1.0.0',
    mappingVersion: '1.0.0',
    releaseStatus: 'active',
    promotionApprovedBy: 'e2e-fixture',
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  await db.collection('terminologyConcepts').insertOne({
    terminologyConceptId: `e2e-696-${code}-${Date.now()}`,
    systemUri,
    code,
    version: 'e2e-696',
    display,
    conceptStatus: 'active',
    sourceRecordId: code,
    referenceDatasetReleaseId,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

/**
 * #705: deletes the `referenceDatasetReleases`/`terminologyConcepts` docs
 * `seedActiveTerminologyConcept` inserted this run (its own `e2e-696-`
 * prefixed ids) — call from the owning spec's `afterAll`. Without this,
 * repeated runs against a shared/persistent Docker volume keep
 * accumulating `superseded` releases and orphaned concepts indefinitely.
 * Superseded releases are inert for `checkActiveCode` (only `active` ones
 * count), so this is housekeeping, not a correctness fix on its own — the
 * supersede step above is what actually stops new `ambiguous_active_release`
 * failures.
 */
export async function cleanupActiveTerminologyConcepts(): Promise<void> {
  const db = await getDb();
  await db.collection('referenceDatasetReleases').deleteMany({
    referenceDatasetReleaseId: { $regex: /^e2e-696-/ },
  });
  await db.collection('terminologyConcepts').deleteMany({
    terminologyConceptId: { $regex: /^e2e-696-/ },
  });
  // #745: put back whatever real release(s) seedActiveTerminologyConcept
  // superseded, now that the fixture release that replaced them is gone.
  // Runs after the deleteMany above on purpose: a fixture release that
  // itself got superseded by a second seed call in the same run is stamped
  // too, and must not be resurrected. Matches every stamped doc (not only
  // this run's), so it also repairs a prior run that crashed before its
  // own afterAll.
  await db.collection('referenceDatasetReleases').updateMany(
    { supersededByE2E: SUPERSEDED_BY_E2E_MARK, releaseStatus: 'superseded' },
    { $set: { releaseStatus: 'active', updatedAt: new Date() }, $unset: { supersededByE2E: '' } }
  );
}

/**
 * #696 fixture: seeds the legacy `terminologies` doc the intake wizard's
 * own diagnosis-search UI reads (`GET /api/terminologies`,
 * terminologies.routes.js) — a different collection from
 * `terminologyConcepts` above (RF028's canonical import pipeline never
 * writes here; this is the older UI-facing search index).
 */
export async function seedLegacyDiagnosisTerminology(options: {
  orphaCode: string;
  cidCode: string;
  omimCode: string;
  description: string;
}): Promise<void> {
  const db = await getDb();
  await db.collection('terminologies').insertOne({
    sistema: 'ORPHA',
    codigo: options.orphaCode,
    descricao: options.description,
    label: options.description,
    sinonimos: [],
    aliases: [],
    relacoes: {
      cid: options.cidCode,
      cid10: options.cidCode,
      omim: options.omimCode,
      orpha: options.orphaCode,
      hpo: '',
    },
    ativo: true,
    sincronizadoEm: new Date(),
    updatedAt: new Date(),
    lang: 'pt',
    fonte: 'e2e-696-fixture',
  });
}

/**
 * #696 fixture: seeds the `disease_dictionary` doc `buildLocalSemanticSuggestions`
 * (dictionary.js) reads as its Mongo fallback for `GET /api/dictionary/suggest`
 * — only reached if the Neo4j query itself throws, not merely returns zero
 * rows (dictionary.js:298 returns 404 directly on an empty Neo4j result set),
 * so this alone isn't sufficient against a healthy Neo4j — see
 * `seedOrphaPhenotypeGraph` in queryNeo4j.ts for the graph-side fixture this
 * pairs with.
 */
export async function seedDiseaseDictionaryPhenotypes(
  orphaNumeric: string,
  phenotypes: Array<{ hpoId: string; label: string }>
): Promise<void> {
  const db = await getDb();
  await db.collection('disease_dictionary').insertOne({
    orpha_code: orphaNumeric,
    name: `#696 e2e disease ${orphaNumeric}`,
    active: true,
    phenotypes,
    createdAt: new Date(),
  });
}

/** #696 fixture: seeds a `medication_dictionary` doc for `GET /api/dictionary/atc/search` (DrugService.searchAndCacheDrug). */
export async function seedMedicationDictionaryEntry(options: {
  name: string;
  atcCode: string;
}): Promise<void> {
  const db = await getDb();
  await db.collection('medication_dictionary').insertOne({
    name: options.name,
    generic_name: options.name,
    atc_code: options.atcCode,
    active: true,
    createdAt: new Date(),
  });
}

/**
 * #1219 fixture: one QuarantineAction row naming the given specimen ids,
 * in QuarantineAction.create()'s full field shape. There is no route that
 * records an action with a chosen key, and the point of the fixture is to
 * write the legacy _id-keyed form that code no longer produces.
 */
export async function seedQuarantineAction(specimenIds: string[], reasonCode: string): Promise<string> {
  const db = await getDb();
  const now = new Date();
  const quarantineActionId = `e2e-1219-${reasonCode}-${now.getTime()}-${Math.random().toString(36).slice(2, 8)}`;
  await db.collection('quarantineActions').insertOne({
    quarantineActionId,
    specimenIds,
    reasonCodes: [reasonCode],
    actionStatus: 'active',
    authorizedBy: null,
    startedAt: now,
    releasedAt: null,
    createdAt: now,
  });
  return quarantineActionId;
}

export async function cleanupQuarantineActions(quarantineActionIds: string[]): Promise<void> {
  if (quarantineActionIds.length === 0) return;
  const db = await getDb();
  await db.collection('quarantineActions').deleteMany({ quarantineActionId: { $in: quarantineActionIds } });
}
