import { test, expect } from '@playwright/test';
import { mockLogin } from './helpers/mockAuth';
import { realLogin, realAuthLogin } from './helpers/realAuth';
import {
  createRealParticipant,
  closeSeedDb,
  seedActiveConsentTemplate,
  seedActiveTerminologyConcept,
  seedLegacyDiagnosisTerminology,
  seedDiseaseDictionaryPhenotypes,
  seedMedicationDictionaryEntry,
} from './helpers/seedParticipant';
import { seedOrphaPhenotypeGraph, removeOrphaPhenotypeGraph, closeNeo4jDriver } from './helpers/queryNeo4j';
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

test.describe('Clinical-entity wiring — real backend (#696, proving #693\'s RF005 AC4-6 wiring against a live stack)', () => {
  test.skip(!apiBaseURL, 'PLAYWRIGHT_API_BASE_URL not set — run via npm run test:e2e:docker');

  const orphaCode = 'ORPHA:558';
  const orphaNumeric = '558';
  // RF028's real OMIM importer stores bare digits (no "OMIM:" prefix) —
  // reference-data/reference-imports/sources/omim.js's fixture id is
  // literally "154700" for Marfan syndrome. Seeded here in that same real
  // format on purpose, not the wizard's own "OMIM:154700" — see #698.
  const omimCodeAsImported = '154700';
  const cidCode = 'C50';
  const hpoCode = 'HP:0001250';
  const atcCode = 'C09AA01';
  const diseaseLabel = `RF005 e2e Marfan-like disease ${Date.now()}`;
  const phenotypeLabel = 'Seizure';
  const medicationName = `rf005-e2e-captopril-${Date.now()}`;

  let mongoClient: MongoClient;

  test.beforeAll(async () => {
    mongoClient = new MongoClient(mongoUri);
    await mongoClient.connect();
    const db = mongoClient.db(mongoDbName);

    await seedActiveConsentTemplate(db);

    // UI-facing legacy collections (terminologies.routes.js / dictionary.js)
    // — a different set of collections from RF028's canonical
    // TerminologyConcept pipeline below; both are needed for the wizard's
    // own search/suggest UI to surface real, selectable results.
    await seedLegacyDiagnosisTerminology({
      orphaCode,
      cidCode,
      omimCode: `OMIM:${omimCodeAsImported}`,
      description: diseaseLabel,
    });
    await seedDiseaseDictionaryPhenotypes(orphaNumeric, [{ hpoId: hpoCode, label: phenotypeLabel }]);
    await seedMedicationDictionaryEntry({ name: medicationName, atcCode });
    // GET /api/dictionary/suggest queries Neo4j directly and only falls back
    // to the Mongo disease_dictionary doc above if the Neo4j call itself
    // throws (dictionary.js:298 returns 404 on a merely-empty result) — so
    // the phenotype cascade needs a real graph fixture too.
    await seedOrphaPhenotypeGraph(orphaNumeric, diseaseLabel, [{ hpoCode, label: phenotypeLabel }]);

    // RF028 canonical TerminologyConcept/ReferenceDatasetRelease fixtures
    // (activeCodeValidator's own lookup) — ORPHA and ICD-10 seeded in the
    // exact format the wizard itself sends (matches real RF028 importer
    // output for these two). OMIM is deliberately seeded in RF028's real
    // bare-digit format, NOT the wizard's always-prefixed "OMIM:154700" —
    // this is what #698 proves out below. MedicationExposure's ATC code is
    // not gated by activeCodeValidator at all (medication-exposure.service.js
    // never calls it — only condition.service.js/phenotype-observation.
    // service.js do), so no ATC TerminologyConcept fixture is needed for
    // MedicationExposure to be created.
    await seedActiveTerminologyConcept('http://www.orpha.net', orphaCode, diseaseLabel, { datasetCode: 'ORPHA' });
    await seedActiveTerminologyConcept('http://hl7.org/fhir/sid/icd-10', cidCode, 'malignant neoplasm of breast', { datasetCode: 'ICD10' });
    await seedActiveTerminologyConcept('https://www.omim.org', omimCodeAsImported, 'marfan syndrome', { datasetCode: 'OMIM' });
    await seedActiveTerminologyConcept('http://purl.obolibrary.org/obo/hp.owl', hpoCode, phenotypeLabel, { datasetCode: 'HPO' });
  });

  test.afterAll(async () => {
    await removeOrphaPhenotypeGraph(orphaNumeric);
    await closeNeo4jDriver();
    await mongoClient.close();
    await closeSeedDb();
  });

  test('a real submission through the intake wizard creates Encounter/Condition/PhenotypeObservation/MedicationExposure with terminology coding (#693)', async ({ page, request }) => {
    await realAuthLogin(request, page);
    await page.goto('/next/intake');
    await expect(page.getByTestId('intake-wizard-root')).toBeVisible();

    // Step 1 — demographics. "11144477735" is a checksum-valid CPF (a
    // commonly used test value — 111.444.777-35) since a purely numeric
    // document is always routed through the CPF checksum check, never the
    // passport branch, regardless of digit count.
    const suffix = Date.now();
    await page.getByTestId('wizard-full-name').fill(`RF005 e2e #696 patient ${suffix}`);
    await page.getByTestId('wizard-birth-date').fill('01/01/1990');
    await page.getByTestId('wizard-gender').selectOption('F');
    await page.getByTestId('wizard-email').fill(`e2e-696-${suffix}@example.com`);
    await page.getByTestId('wizard-document').fill('11144477735');
    await page.getByTestId('wizard-next-button').click();

    // Step 2 — pre-analytical sample. SPREC axis option lists come from a
    // static local dictionary (not backend-fetched), so selecting by index
    // (skipping each list's own empty placeholder at index 0) needs no
    // fixture data. "Processing information unknown" auto-fills axes 3-6.
    await expect(page.getByTestId('wizard-sprec-axis-1')).toBeVisible();
    await page.getByTestId('wizard-sprec-matrix').selectOption('fluid');
    // MIABIS-coded classification (#701) -- a distinct, fixed id list from
    // the SPREC axis fields below, selected by index like them.
    await page.getByTestId('wizard-sample-type').selectOption({ index: 1 });
    await page.getByTestId('wizard-sample-origin').selectOption({ index: 1 });
    await page.getByTestId('wizard-extraction-protocol').selectOption({ index: 1 });
    await page.getByTestId('wizard-sprec-axis-1').selectOption({ index: 1 });
    await page.getByTestId('wizard-sprec-axis-2').selectOption({ index: 1 });
    await page.getByTestId('wizard-processing-unknown').check();
    await page.getByTestId('wizard-sprec-axis-7').selectOption({ index: 1 });
    await page.getByTestId('wizard-quantity').fill('5');
    await page.getByTestId('wizard-linked-project').fill(`RF005-E2E-696-${suffix}`);
    await page.getByTestId('wizard-institution-name').fill('Hospital E2E 696');
    await page.getByTestId('wizard-next-button').click();

    // Step 3 — diagnosis search & select (fills ORPHA/OMIM/CID-10 readonly
    // fields and triggers the disease-phenotype cascade automatically —
    // there is no separate "add phenotype" UI, see #696's own research).
    await expect(page.getByTestId('wizard-diagnosis-search')).toBeVisible();
    await page.getByTestId('wizard-diagnosis-search').fill(diseaseLabel);
    await expect(page.getByTestId('wizard-diagnosis-option-0')).toBeVisible({ timeout: 10_000 });
    await page.getByTestId('wizard-diagnosis-option-0').click();
    await expect(page.locator('.phenotype-card', { hasText: phenotypeLabel })).toBeVisible({ timeout: 10_000 });

    // Medication/pharmacology.
    await page.getByTestId('wizard-treatment-status').selectOption('TREATED');
    await page.getByTestId('wizard-medication-search').fill(medicationName);
    await expect(page.getByTestId('wizard-medication-option-0')).toBeVisible({ timeout: 10_000 });
    await page.getByTestId('wizard-medication-option-0').click();
    await page.locator('input[type="date"]').first().fill('2026-01-15');

    const submissionResponse = page.waitForResponse((response) => response.url().includes('/intake-wizard') && response.request().method() === 'POST');
    await page.getByTestId('wizard-submit-button').click();
    const response = await submissionResponse;
    // #699 (fixed): this used to 422 with NON_CANONICAL_FIELD -- the
    // wizard's real payload never matched the canonical.v1.intake AJV
    // contract. #701 (fixed): sampleType/sampleOrigin/extractionProtocol
    // sent real SPREC axis codes, not the closed MIABIS enum
    // SampleModel.validate() requires -- the wizard now collects real
    // MIABIS-coded selections separately from the SPREC axis fields. #703
    // (fixed): matchOrUpsertParticipant treated the wizard's placeholder
    // participantId ('placeholder', sent for every new patient per #699's
    // own precedent) as a real, literal id instead of generating one, so
    // the specimen-creation step's /^\d{8}$/ format check failed -- it now
    // treats any non-/^\d{8}$/ participantId the same as no participantId
    // supplied.
    expect(response.ok()).toBe(true);
    const body = await response.json();
    expect(body.success).toBe(true);
    // #704: the route's success response has no `data` wrapper --
    // `patientMatch` is a top-level key (intakeWizard.js's res.json()
    // literal, ~line 724).
    const participantId = body?.patientMatch?.patientID;
    expect(participantId).toBeTruthy();

    const db = mongoClient.db(mongoDbName);

    const encounters = await db.collection('encounters').find({ participantId: String(participantId) }).toArray();
    expect(encounters).toHaveLength(1);
    expect(encounters[0].encounterType).toBe('collection');

    const conditions = await db.collection('conditions').find({ participantId: String(participantId) }).toArray();
    expect(conditions).toHaveLength(1);
    const conditionCodings = conditions[0].conditionCoding.map((coding: { systemUri: string; code: string }) => `${coding.systemUri}|${coding.code}`);
    expect(conditionCodings).toContain(`http://www.orpha.net|${orphaCode}`);
    expect(conditionCodings).toContain(`http://hl7.org/fhir/sid/icd-10|${cidCode}`);
    // #698: the wizard always sends "OMIM:154700" (normalizeOmimCode's own
    // always-prefixed format), which never matches RF028's real bare-digit
    // TerminologyConcept ("154700") — so activeCodeValidator resolves it as
    // unknown and condition.service.js silently drops the OMIM coding from
    // conditionCoding. Asserted here as the real (buggy) behavior, not
    // weakened to look like a pass — the code above intentionally seeds the
    // OMIM concept in RF028's real format specifically to prove this gap.
    expect(conditionCodings.some((entry: string) => entry.startsWith('https://www.omim.org|'))).toBe(false);

    const phenotypeObservations = await db.collection('phenotypeObservations').find({ participantId: String(participantId) }).toArray();
    expect(phenotypeObservations).toHaveLength(1);
    expect(phenotypeObservations[0].hpoCoding.systemUri).toBe('http://purl.obolibrary.org/obo/hp.owl');
    expect(phenotypeObservations[0].hpoCoding.code).toBe(hpoCode);

    const medicationExposures = await db.collection('medicationExposures').find({
      'medicationCoding.display': medicationName,
    }).toArray();
    expect(medicationExposures).toHaveLength(1);
    expect(medicationExposures[0].medicationCoding[0]).toMatchObject({
      systemUri: 'http://www.whocc.no/atc',
      code: atcCode,
      display: medicationName,
    });
    expect(medicationExposures[0].medicationStatus).toBe('active');
  });
});
