import { test, expect } from '@playwright/test';
import { mockLogin } from './helpers/mockAuth';
import { SIGNATURE_PNG_DATA_URL } from './helpers/consentSignature';
import { realLogin, realAuthLogin, seedRealAuth } from './helpers/realAuth';
import { completeFirstLoginMfa } from './helpers/completeFirstLoginMfa';
import { deleteOrganizations } from './helpers/listOrganizations';
import {
  closeSeedDb,
  seedActiveConsentTemplate,
  seedActiveTerminologyConcept,
  cleanupActiveTerminologyConcepts,
  seedLegacyDiagnosisTerminology,
  seedDiseaseDictionaryPhenotypes,
  seedMedicationDictionaryEntry,
  seedStorageBoxLocation,
  cleanupStorageBoxLocation,
} from './helpers/seedParticipant';
import type { SeededStorageBox } from './helpers/seedParticipant';
import {
  seedOrphaPhenotypeGraph,
  removeOrphaPhenotypeGraph,
  closeNeo4jDriver,
} from './helpers/queryNeo4j';
import { generateValidCpf } from './helpers/cpf';
import { waitForIntakeWizardReady } from './helpers/waitForIntakeWizardReady';
import {
  seedGovernedCollection,
  cleanupGovernedCollection,
  closeGovernedCollectionDb,
  type GovernedCollection,
} from './helpers/seedGovernedCollection';
import { MongoClient, ObjectId } from 'mongodb';

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

    // #1357: the mocked token has no refresh cookie, so a refresh 401s on the
    // real backend at once. Without a backend it dies on a network error and
    // the client's port scan delays the logout past a case's end, so a host
    // run passed what the Docker gate failed. Answering 401 here makes an
    // unfulfilled route fail the same way on both.
    await page.route('**/api/auth/refresh', async (route) => {
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ success: false, message: 'Unauthorized' }),
      });
    });

    // #1357: useCreateOrganizationChoice looks up the caller's scope on
    // mount. Unfulfilled, it reaches the real backend with the mocked token,
    // 401s, and the client ends the session. One organization means no
    // picker, so the demographic step renders as before.
    await page.route('**/api/organizations/mine', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: { scope: 'organization', organizations: [{ organizationId: 'org-e2e-mock', officialName: 'Mock Org' }] },
        }),
      });
    });

    // RF004 AC2 (#1497): the wizard lists the collections a specimen may be
    // registered into on mount. Unfulfilled, the mocked token 401s on the
    // real backend and the client ends the session, as #1357 says above.
    await page.route('**/api/collections', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: [{ collectionId: 'COL-E2E-MOCK', collectionName: 'Mock Collection' }] }),
      });
    });
  });

  test('renders the demographic step and accepts patient data entry', async ({ page }) => {
    await page.goto('/next/intake');

    await waitForIntakeWizardReady(page);
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

    await waitForIntakeWizardReady(page);
    await page.getByTestId('wizard-full-name').fill('Paciente Teste E2E');
    await expect(page.getByTestId('wizard-full-name')).toHaveValue('Paciente Teste E2E');

    // Give the (now-suppressed) refresh/redirect cascade time to run if it
    // were still wired up — before the fix this fired a real navigation
    // to /login within a few seconds even with no backend listening.
    await page.waitForTimeout(3000);
    await expect(page).toHaveURL(/\/next\/intake/);
  });
});

test.describe('Clinical-entity wiring — real backend (#696, proving #693\'s RF005 AC4-6 wiring against a live stack; extended by #708 for AllergyIntolerance, #709 for FamilyHistory, #710 for Procedure, #711 for ClinicalObservation, #712 for ClinicalOutcome, #713 for the real Charlson Comorbidity Index/DerivedScore)', () => {
  test.skip(!apiBaseURL, 'PLAYWRIGHT_API_BASE_URL not set — run via npm run test:e2e:docker');

  const orphaCode = 'ORPHA:558';
  const orphaNumeric = '558';
  // RF028's real OMIM importer stores bare digits (no "OMIM:" prefix) —
  // reference-data/reference-imports/sources/omim.js's fixture id is
  // literally "154700" for Marfan syndrome. Seeded here in that same real
  // format on purpose, not the wizard's own "OMIM:154700" — see #698
  // (fixed: intakeWizard.js#buildClinicalData now strips that prefix).
  const omimCodeAsImported = '154700';
  const cidCode = 'C50';
  const hpoCode = 'HP:0001250';
  const atcCode = 'C09AA01';
  const diseaseLabel = `RF005 e2e Marfan-like disease ${Date.now()}`;
  const phenotypeLabel = 'Seizure';
  const medicationName = `rf005-e2e-captopril-${Date.now()}`;
  // #714: AllergyIntolerance's allergenCoding is DCB-coded and, like
  // Condition/PhenotypeObservation, allergy-intolerance.service.js now gates
  // it on activeCodeValidator -- a DCB TerminologyConcept/
  // ReferenceDatasetRelease fixture for this code is seeded below, alongside
  // a uniquely-named display value so this test's own assertion doesn't pick
  // up a prior run's fixture from the persistent test-stack Mongo volume.
  const allergenCode = '03730';
  const allergenName = `RF005 e2e allergen #708 ${Date.now()}`;
  const allergyReaction = 'Urticária';
  // #709: FamilyHistory -- same "no activeCodeValidator gate" shape as
  // AllergyIntolerance above (family-history.service.js never calls it
  // either), so no TerminologyConcept fixture is needed here either --
  // only a uniquely-named condition value for this test's own query.
  const familyRelationship = 'mother';
  const familyConditionOrphaCode = 'ORPHA:558';
  const familyConditionName = `RF005 e2e family condition #709 ${Date.now()}`;
  const familyConditionOnset = '30 anos';
  // #710: Procedure -- procedure.service.js also never calls
  // activeCodeValidator, same shape as the two above; no TerminologyConcept
  // fixture needed, only a uniquely-named display value.
  const procedureCode = `LOCAL-${Date.now()}`;
  const procedureName = `RF005 e2e procedure #710 ${Date.now()}`;
  const procedurePerformed = '2026-01-15';
  const procedureBodySite = 'Fígado';
  // #711: ClinicalObservation -- clinical-observation.service.js also
  // never calls activeCodeValidator, same shape as the above; no
  // TerminologyConcept fixture needed, only a uniquely-named display
  // value. A real LOINC code (718-7, Hemoglobin) is used since this repo
  // does have a genuine LOINC importer, unlike the other manually-coded
  // entities above -- but no active-release gate means the fixture isn't
  // required for this to persist either.
  const observationLoincCode = '718-7';
  const observationTestName = `RF005 e2e observation #711 ${Date.now()}`;
  const observationValue = '13.2';
  const observationUnit = 'g/dL';
  const observationEffectiveDate = '2026-01-15';
  // #712: ClinicalOutcome -- unlike the other 5 entities in this describe
  // block, dict-02's own row set for this entity has no free-text/display
  // field (only outcomeType, a 7-value CodeableConcept, and outcomeDate) to
  // disambiguate this run's fixture from a prior run's leftover row in the
  // persistent test-stack Mongo volume (the same fixture-accumulation
  // gotcha every other entity here works around via a uniquely-suffixed
  // display value). outcomeDate is instead derived from a timestamp into a
  // unique-per-run calendar date, since outcomeType alone can't disambiguate.
  const outcomeType = 'remission';
  const outcomeDateSeed = Date.now();
  const outcomeDate = new Date(Date.UTC(2020, 0, 1 + (outcomeDateSeed % 9000))).toISOString().slice(0, 10);

  let mongoClient: MongoClient;
  let seededStorageBox: SeededStorageBox;
  // RF004 AC2 (#1497): every wizard submission here picks this governed collection.
  let governedCollection: GovernedCollection | null = null;

  test.beforeAll(async () => {
    mongoClient = new MongoClient(mongoUri);
    await mongoClient.connect();
    const db = mongoClient.db(mongoDbName);

    governedCollection = await seedGovernedCollection(`intake-clinical-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);

    await seedActiveConsentTemplate(db);

    // #747: the wizard allocates a physical location automatically
    // (intakeWizard.js#resolveAutomaticLocation), which 409s unless some
    // StorageBox has free capacity in a hierarchy ending at a FREEZER with
    // a ready Equipment + operational Sensor. This block used to pass only
    // because another spec's seedStorageBoxLocation() debris happened to be
    // left on the shared volume -- until #730 wired cleanupStorageBoxLocation
    // into those specs. Seed (and release) our own instead of depending on
    // another spec's leftovers.
    seededStorageBox = await seedStorageBoxLocation();

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
    // output for these two). OMIM is seeded in RF028's real bare-digit
    // format, NOT the wizard's always-prefixed "OMIM:154700" — #698 (fixed)
    // strips that prefix server-side (intakeWizard.js#buildClinicalData)
    // before building conditionCoding, so this now resolves as active too.
    // MedicationExposure's ATC code is not gated by activeCodeValidator at all
    // (medication-exposure.service.js
    // never calls it — only condition.service.js/phenotype-observation.
    // service.js do), so no ATC TerminologyConcept fixture is needed for
    // MedicationExposure to be created.
    await seedActiveTerminologyConcept('http://www.orpha.net', orphaCode, diseaseLabel, { datasetCode: 'ORPHA' });
    await seedActiveTerminologyConcept('http://hl7.org/fhir/sid/icd-10', cidCode, 'malignant neoplasm of breast', { datasetCode: 'ICD10' });
    await seedActiveTerminologyConcept('https://www.omim.org', omimCodeAsImported, 'marfan syndrome', { datasetCode: 'OMIM' });
    await seedActiveTerminologyConcept('http://purl.obolibrary.org/obo/hp.owl', hpoCode, phenotypeLabel, { datasetCode: 'HPO' });
    // #714: AllergyIntolerance's allergenCoding is now gated the same way.
    await seedActiveTerminologyConcept(
      'https://www.gov.br/anvisa/pt-br/assuntos/farmacopeia/dcb',
      allergenCode,
      allergenName,
      { datasetCode: 'DCB' }
    );
  });

  test.afterAll(async () => {
    await removeOrphaPhenotypeGraph(orphaNumeric);
    await closeNeo4jDriver();
    await mongoClient.close();
    // #705: seedActiveTerminologyConcept's own e2e-696-* fixtures don't
    // get cleaned up by anything else — must run before closeSeedDb()
    // closes the connection cleanupActiveTerminologyConcepts reuses.
    await cleanupActiveTerminologyConcepts();
    // #747/#730: release this block's own storage fixture (and its
    // equipment/sensor rows) so it doesn't accumulate on the volume --
    // same ordering constraint as the cleanup above, before closeSeedDb().
    if (seededStorageBox) {
      await cleanupStorageBoxLocation(seededStorageBox);
    }
    await cleanupGovernedCollection(governedCollection);
    await closeGovernedCollectionDb();
    await closeSeedDb();
  });

  test('a real submission through the intake wizard creates Encounter/Condition/PhenotypeObservation/MedicationExposure with terminology coding (#693)', async ({ page, request }) => {
    await realAuthLogin(request, page);
    await page.goto('/next/intake');
    // #1222: fill only after mount-time dictionary/consent fetches settle.
    await waitForIntakeWizardReady(page);

    // Step 1 — demographics. The document must be a checksum-valid CPF (a
    // purely numeric document is always routed through the CPF checksum
    // check, never the passport branch, regardless of digit count) *and*
    // unique: #746 — RF005/RNF007 identity uniqueness makes the old fixed
    // "11144477735" 409 on every run after the first against the persistent
    // mongodb-test-data volume.
    const suffix = Date.now();
    await page.getByTestId('wizard-full-name').fill(`RF005 e2e #696 patient ${suffix}`);
    await page.getByTestId('wizard-birth-date').fill('01/01/1990');
    await page.getByTestId('wizard-gender').selectOption('F');
    await page.getByTestId('wizard-email').fill(`e2e-696-${suffix}@example.com`);
    await page.getByTestId('wizard-document').fill(generateValidCpf());
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
    await page.getByTestId('wizard-collection').selectOption(governedCollection!.collectionId);
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

    // Allergy/intolerance (#708) -- manual-entry, no dictionary picker.
    await page.getByTestId('wizard-allergy-name').fill(allergenName);
    await page.getByTestId('wizard-allergy-code').fill(allergenCode);
    await page.getByTestId('wizard-allergy-reaction').fill(allergyReaction);
    await page.getByTestId('wizard-add-allergy').click();
    await expect(page.getByTestId('wizard-allergy-item-0')).toBeVisible();

    // Family history (#709) -- manual-entry, ORPHA-coded condition.
    await page.getByTestId('wizard-family-relationship').selectOption(familyRelationship);
    await page.getByTestId('wizard-family-condition-name').fill(familyConditionName);
    await page.getByTestId('wizard-family-condition-orpha').fill(familyConditionOrphaCode);
    await page.getByTestId('wizard-family-condition-onset').fill(familyConditionOnset);
    await page.getByTestId('wizard-add-family-history').click();
    await expect(page.getByTestId('wizard-family-history-item-0')).toBeVisible();

    // Procedure (#710) -- manual-entry, locally-coded.
    await page.getByTestId('wizard-procedure-name').fill(procedureName);
    await page.getByTestId('wizard-procedure-code').fill(procedureCode);
    await page.getByTestId('wizard-procedure-performed').fill(procedurePerformed);
    await page.getByTestId('wizard-procedure-body-site').fill(procedureBodySite);
    await page.getByTestId('wizard-add-procedure').click();
    await expect(page.getByTestId('wizard-procedure-item-0')).toBeVisible();

    // Lab observation (#711) -- manual-entry, real LOINC-coded.
    await page.getByTestId('wizard-observation-test-name').fill(observationTestName);
    await page.getByTestId('wizard-observation-loinc').fill(observationLoincCode);
    await page.getByTestId('wizard-observation-value').fill(observationValue);
    await page.getByTestId('wizard-observation-unit').fill(observationUnit);
    await page.getByTestId('wizard-observation-effective-date').fill(observationEffectiveDate);
    await page.getByTestId('wizard-add-observation').click();
    await expect(page.getByTestId('wizard-observation-item-0')).toBeVisible();

    // Longitudinal outcome (#712) -- manual-entry, no dictionary picker
    // (no longitudinal-outcome UI existed in the wizard before this slice).
    await page.getByTestId('wizard-outcome-type').selectOption(outcomeType);
    await page.getByTestId('wizard-outcome-date').fill(outcomeDate);
    await page.getByTestId('wizard-add-outcome').click();
    await expect(page.getByTestId('wizard-outcome-item-0')).toBeVisible();

    // Comorbidities / CCI (#713) -- checks copd (real Charlson category,
    // weight 1) and ckd (weight 2), plus hypertension (NOT a real Charlson
    // category -- proves it's correctly excluded from the computed score,
    // same "real algorithm, not just wiring" bar the issue's own DoD sets).
    await page.getByTestId('wizard-comorbidity-copd').check();
    await page.getByTestId('wizard-comorbidity-ckd').check();
    await page.getByTestId('wizard-comorbidity-hypertension').check();

    // #1232: (outcomeType, outcomeDate) is drawn from 9000 dates and every
    // run's outcome stays on the volume, so count what is already there.
    const outcomesBefore = await mongoClient.db(mongoDbName).collection('clinicalOutcomes').countDocuments({
      'outcomeType.code': outcomeType,
      outcomeDate: new Date(outcomeDate),
    });

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
    // Playwright buffers the response body, so reading it as text here does
    // not consume it for the `.json()` below -- and a failed submission
    // otherwise reports only `expected true, received false` with no clue
    // which of the wizard's many server-side validations rejected it.
    const rawBody = await response.text();
    expect(response.ok(), `POST /intake-wizard -> ${response.status()}: ${rawBody.slice(0, 500)}`).toBe(true);
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
    // #698 (fixed): intakeWizard.js#buildClinicalData now strips the
    // wizard's always-prefixed "OMIM:" down to RF028's real bare-digit
    // format before building conditionCoding, so this resolves as active
    // and is stored bare -- not "OMIM:154700". #706 confirmed
    // condition.service.js#createCondition's all-or-nothing gate (any
    // invalid conditionCoding entry rejects the whole write) is RF005
    // AC#4's intended reading for a multi-coding entity, not a bug -- with
    // #698 fixed, all three codings resolve active here, so that gate
    // isn't exercised by this happy-path spec (see condition.service.
    // test.js for a dedicated multi-coding-rejection unit test).
    expect(conditionCodings).toContain(`https://www.omim.org|${omimCodeAsImported}`);

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

    // #708: AllergyIntolerance -- dict-02 ELM-0246..0248, DCB-coded,
    // manual-entry (no picker), same additive best-effort call as the
    // other 4 entities above.
    const allergyIntolerances = await db.collection('allergyIntolerances').find({
      'allergenCoding.display': allergenName,
    }).toArray();
    expect(allergyIntolerances).toHaveLength(1);
    expect(allergyIntolerances[0]).toMatchObject({
      allergenCoding: {
        systemUri: 'https://www.gov.br/anvisa/pt-br/assuntos/farmacopeia/dcb',
        code: allergenCode,
        display: allergenName,
      },
      reaction: [{ manifestation: allergyReaction }],
    });

    // #709: FamilyHistory -- dict-02 ELM-0249..0251, ORPHA-coded
    // familyCondition, manual-entry (no MONDO/ICD-11 picker in this
    // wizard), same additive best-effort call as the other entities above.
    const familyHistories = await db.collection('familyHistories').find({
      'familyCondition.condition.display': familyConditionName,
    }).toArray();
    expect(familyHistories).toHaveLength(1);
    expect(familyHistories[0]).toMatchObject({
      relationship: familyRelationship,
      familyCondition: [{
        condition: {
          systemUri: 'http://www.orpha.net',
          code: familyConditionOrphaCode,
          display: familyConditionName,
        },
        onset: familyConditionOnset,
      }],
    });

    // #710: Procedure -- dict-02 ELM-0242..0245, locally-coded
    // procedureCoding (no SNOMED importer in this repo), manual-entry, same
    // additive best-effort call as the other entities above.
    const procedures = await db.collection('procedures').find({
      'procedureCoding.display': procedureName,
    }).toArray();
    expect(procedures).toHaveLength(1);
    expect(procedures[0]).toMatchObject({
      procedureCoding: [{
        systemUri: 'urn:biobank:local-procedure-terminology',
        code: procedureCode,
        display: procedureName,
      }],
      performed: procedurePerformed,
      bodySite: [{ text: procedureBodySite }],
    });

    // #711: ClinicalObservation -- dict-02 ELM-0219..0232, real
    // LOINC-coded observationCoding, manual-entry, same additive
    // best-effort call as the other entities above.
    const observations = await db.collection('clinicalObservations').find({
      'observationCoding.display': observationTestName,
    }).toArray();
    expect(observations).toHaveLength(1);
    expect(observations[0]).toMatchObject({
      participantId: String(participantId),
      observationCoding: {
        systemUri: 'http://loinc.org',
        code: observationLoincCode,
        display: observationTestName,
      },
      value: observationValue,
      unit: { text: observationUnit },
      observationStatus: 'final',
    });

    // #712: ClinicalOutcome -- dict-02 ELM-0252..0254, manual-entry (no
    // longitudinal-outcome UI existed before this slice). No participantId
    // field exists on this entity (dict-02's own gap, matching #691's
    // model) and no free-text display field either -- queried by the
    // (outcomeType, outcomeDate) pair, counted against the rows that pair
    // already matched before this submission (#1232).
    const outcomes = await db.collection('clinicalOutcomes').find({
      'outcomeType.code': outcomeType,
      outcomeDate: new Date(outcomeDate),
    }).toArray();
    expect(outcomes).toHaveLength(outcomesBefore + 1);
    expect(outcomes[0]).toMatchObject({
      outcomeType: { code: outcomeType },
    });

    // #713: DerivedScore (CCI) -- dict-02 ELM-0255..0259, a real
    // original-1987 Charlson Comorbidity Index computed from copd (weight
    // 1) + ckd (weight 2) = 3; hypertension was also checked above but is
    // NOT a real Charlson category, proving it's correctly excluded rather
    // than silently inflating the score. Like ClinicalOutcome/DerivedScore
    // above, dict-02 defines no participantId field for this entity and
    // this run's fixture has no other unique discriminator either (every
    // field the algorithm produces is deterministic given the same
    // checked boxes) -- queried as the most recently created matching
    // record instead, immediately after this test's own submission
    // response was received.
    const derivedScores = await db.collection('derivedScores')
      .find({ 'scoreType.code': 'cci', algorithmVersion: 'CCI-original' })
      .sort({ createdAt: -1 })
      .limit(1)
      .toArray();
    expect(derivedScores).toHaveLength(1);
    expect(derivedScores[0]).toMatchObject({
      scoreType: { code: 'cci', display: 'Charlson Comorbidity Index' },
      scoreValue: 3,
      algorithmVersion: 'CCI-original',
    });
    const scoreComponentCodes = derivedScores[0].scoreComponents.map((c: { condition: { code: string } }) => c.condition.code);
    expect(scoreComponentCodes.sort()).toEqual(['chronicPulmonaryDisease', 'renalDisease']);
  });

  // #1354/#1355: the intake resolves one organization per submission and
  // stamps it as the sample's collectionSite and the created participant's
  // clinicalUnitId, the keys the scoped reads filter on. A caller assigned
  // to two organizations must name one, through the wizard's picker.
  const organizationIds: string[] = [];

  test.afterAll(async ({ request }) => {
    await deleteOrganizations(request, apiBaseURL!, organizationIds);
  });

  test('a Coordenador assigned to two organizations registers through the wizard, picks the second, and reads the sample and participant back (#1354, #1355)', async ({ page, request }) => {
    const admin = await realLogin(request);
    const adminAuth = { Authorization: `Bearer ${admin.token}` };
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const orgIds: string[] = [];
    for (const label of ['A', 'B']) {
      const orgRes = await request.post(`${apiBaseURL}/api/organizations`, {
        headers: adminAuth,
        data: { officialName: `#1354 intake ${label} ${suffix}`, countryCode: 'BR' },
      });
      expect(orgRes.ok(), await orgRes.text()).toBeTruthy();
      orgIds.push((await orgRes.json()).data.organizationId as string);
    }
    organizationIds.push(...orgIds);
    const [firstOrg, secondOrg] = orgIds;

    const username = `coord.1354.${Date.now()}`;
    const password = 'Coordenador@123';
    const registerRes = await request.post(`${apiBaseURL}/api/users/register`, {
      headers: adminAuth,
      data: {
        name: '#1354 Coordenador Fixture',
        email: `${username}@example.com`,
        username,
        password,
        accessType: 3,
        roleName: 'Coordenador',
        organizationId: firstOrg,
      },
    });
    expect(registerRes.ok(), await registerRes.text()).toBeTruthy();

    // #1358: the administrator gives the Coordenador the second organization
    // through its route, a second assignment of the same role.
    const db = mongoClient.db(mongoDbName);
    const user = await db.collection('users').findOne({ username });
    expect(user, 'the registered fixture user').toBeTruthy();
    const grantRes = await request.post(`${apiBaseURL}/api/users/${String(user!._id)}/organizations`, {
      headers: adminAuth,
      data: { organizationId: secondOrg },
    });
    expect(grantRes.status(), await grantRes.text()).toBe(201);
    expect((await grantRes.json()).data.organizationIds.sort()).toEqual([...orgIds].sort());
    const scopedAssignments = await db.collection('userRoleAssignments').find({
      userAccountId: String(user!._id),
      assignmentStatus: 'active',
      scopeType: 'organization',
    }).toArray();
    expect(scopedAssignments.map((doc) => doc.scopeId).sort()).toEqual([...orgIds].sort());

    const coordinator = await completeFirstLoginMfa(request, apiBaseURL!, username, password);
    const coordinatorAuth = { Authorization: `Bearer ${coordinator.token}` };

    const mine = await request.get(`${apiBaseURL}/api/organizations/mine`, { headers: coordinatorAuth });
    expect(mine.status(), await mine.text()).toBe(200);
    const mineData = (await mine.json()).data;
    expect(mineData.scope).toBe('organization');
    expect(mineData.organizations.map((org: { organizationId: string }) => org.organizationId).sort()).toEqual([...orgIds].sort());

    await seedRealAuth(page, coordinator);
    await page.goto('/next/intake');
    await waitForIntakeWizardReady(page);

    await page.getByTestId('wizard-full-name').fill(`#1354 e2e patient ${suffix}`);
    await page.getByTestId('wizard-birth-date').fill('01/01/1990');
    await page.getByTestId('wizard-gender').selectOption('F');
    await page.getByTestId('wizard-email').fill(`e2e-1354-${suffix}@example.com`);
    await page.getByTestId('wizard-document').fill(generateValidCpf());
    await page.getByTestId('wizard-next-button').click();

    await expect(page.getByTestId('wizard-sprec-axis-1')).toBeVisible();
    await page.getByTestId('wizard-sprec-matrix').selectOption('fluid');
    await page.getByTestId('wizard-sample-type').selectOption({ index: 1 });
    await page.getByTestId('wizard-sample-origin').selectOption({ index: 1 });
    await page.getByTestId('wizard-extraction-protocol').selectOption({ index: 1 });
    await page.getByTestId('wizard-sprec-axis-1').selectOption({ index: 1 });
    await page.getByTestId('wizard-sprec-axis-2').selectOption({ index: 1 });
    await page.getByTestId('wizard-processing-unknown').check();
    await page.getByTestId('wizard-sprec-axis-7').selectOption({ index: 1 });
    await page.getByTestId('wizard-quantity').fill('5');
    // Two organizations: the picker is shown, and a choice is required.
    await expect(page.getByTestId('wizard-organization')).toBeVisible();
    await page.getByTestId('wizard-organization').selectOption(secondOrg);
    await page.getByTestId('wizard-linked-project').fill(`E2E-1354-${suffix}`);
    await page.getByTestId('wizard-institution-name').fill('Hospital E2E 1354');
    await page.getByTestId('wizard-collection').selectOption(governedCollection!.collectionId);
    await page.getByTestId('wizard-next-button').click();

    await expect(page.getByTestId('wizard-diagnosis-search')).toBeVisible();
    await page.getByTestId('wizard-diagnosis-search').fill(diseaseLabel);
    await expect(page.getByTestId('wizard-diagnosis-option-0')).toBeVisible({ timeout: 10_000 });
    await page.getByTestId('wizard-diagnosis-option-0').click();
    await expect(page.locator('.phenotype-card', { hasText: phenotypeLabel })).toBeVisible({ timeout: 10_000 });
    // Required for a clinical sample (MIABIS); NAIVE needs no medication.
    await page.getByTestId('wizard-treatment-status').selectOption('NAIVE');

    const submissionResponse = page.waitForResponse((response) => response.url().includes('/intake-wizard') && response.request().method() === 'POST');
    await page.getByTestId('wizard-submit-button').click();
    const response = await submissionResponse;
    const rawBody = await response.text();
    expect(response.ok(), `POST /intake-wizard -> ${response.status()}: ${rawBody.slice(0, 500)}`).toBe(true);
    const participantId = String((await response.json())?.patientMatch?.patientID || '');
    expect(participantId).toBeTruthy();

    // Read back through the coordinator's own scoped reads: the sample list
    // filters on collectionSite, the participant read on clinicalUnitId.
    const list = await request.get(
      `${apiBaseURL}/api/samples?participantId=${encodeURIComponent(participantId)}&limit=200`,
      { headers: coordinatorAuth }
    );
    expect(list.status(), await list.text()).toBe(200);
    const listBody = await list.json();
    const samples = (listBody?.data?.samples ?? listBody?.data ?? []) as Array<Record<string, unknown>>;
    expect(samples, 'the scoped coordinator cannot read back the sample it registered').toHaveLength(1);
    expect(samples[0]).toMatchObject({ collectionSite: secondOrg });

    const participantRes = await request.get(`${apiBaseURL}/api/patients/${encodeURIComponent(participantId)}`, { headers: coordinatorAuth });
    expect(participantRes.status(), await participantRes.text()).toBe(200);
    const participant = await db.collection('patients').findOne({ participantId });
    expect(participant?.clinicalUnitId).toBe(secondOrg);
  });

  // #1371 (dict-02 ELM-0120): the wizard names a derivative's parents by
  // specimenId; the sample stores them and the outbox carries one
  // LINEAGE_REGISTERED per parent, keyed by each sample's _id.
  const lineageSamples: Array<{ mongoId: string; specimenId: string }> = [];

  test.afterAll(async () => {
    if (lineageSamples.length === 0) return;
    const mongoIds = lineageSamples.map((sample) => sample.mongoId);
    const specimenIds = lineageSamples.map((sample) => sample.specimenId);
    const client = new MongoClient(mongoUri);
    try {
      await client.connect();
      const db = client.db(mongoDbName);
      await Promise.all([
        db.collection('samples').deleteMany({ _id: { $in: mongoIds.map((id) => new ObjectId(id)) } }),
        db.collection('sample_movements').deleteMany({
          $or: [
            { specimenId: { $in: [...specimenIds, ...mongoIds] } },
            { sampleID: { $in: [...specimenIds, ...mongoIds] } },
          ],
        }),
        db.collection('storageAssignments').deleteMany({ specimenId: { $in: mongoIds } }),
        db.collection('graph_projection_outbox').deleteMany({ aggregateType: 'Sample', aggregateId: { $in: mongoIds } }),
        db.collection<{ _id: string }>('graph_projection_outbox_aggregate_versions').deleteMany({
          _id: { $in: mongoIds.map((id) => `Sample:${id}`) },
        }),
      ]);
    } finally {
      await client.close();
    }
  });

  test('a derivative registered through the wizard names its parent specimenId, stored on the sample and carried by a LINEAGE_REGISTERED outbox event (#1371)', async ({ page, request }) => {
    const admin = await realAuthLogin(request, page);
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const patientName = `#1371 e2e patient ${suffix}`;
    const document = generateValidCpf();

    // RF019 AC3 (#1510): a quarantined parent is refused for derivation, and
    // the wizard stores a specimen quarantined while its participant has no
    // ACTIVE consent (CONSENT_PENDING). So the participant exists, with a
    // signed consent, before the parent's intake, which matches it by name
    // and birth date.
    const consentTemplateId = await seedActiveConsentTemplate(mongoClient.db(mongoDbName));
    const createdParticipant = await request.post(`${apiBaseURL}/api/patients`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: { participantId: 'placeholder', patientName, birthDate: '1990-01-01', sex: 'F', consentTemplateId },
    });
    expect(createdParticipant.ok(), await createdParticipant.text()).toBe(true);
    const participantId = String((await createdParticipant.json())?.data?.participantId || '');
    expect(participantId).toBeTruthy();
    const signed = await request.post(`${apiBaseURL}/api/e-consent/consents`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: {
        participantId,
        consentTemplateId,
        responses: {},
        signatureName: '#1371 e2e signer',
        signatureImageBase64: SIGNATURE_PNG_DATA_URL,
      },
    });
    expect(signed.ok(), await signed.text()).toBe(true);

    // The #1354 path, less the organization picker.
    const registerThroughWizard = async (label: string, parentSpecimenIds?: string) => {
      await page.goto('/next/intake');
      await waitForIntakeWizardReady(page);

      await page.getByTestId('wizard-full-name').fill(patientName);
      await page.getByTestId('wizard-birth-date').fill('01/01/1990');
      // Same name and birth date: each intake matches the participant
      // created above.
      await expect(page.getByTestId('wizard-patient-match-alert')).toBeVisible({ timeout: 10_000 });
      await page.getByTestId('wizard-gender').selectOption('F');
      await page.getByTestId('wizard-email').fill(`e2e-1371-${suffix}@example.com`);
      await page.getByTestId('wizard-document').fill(document);
      await page.getByTestId('wizard-next-button').click();

      await expect(page.getByTestId('wizard-sprec-axis-1')).toBeVisible();
      await page.getByTestId('wizard-sprec-matrix').selectOption('fluid');
      await page.getByTestId('wizard-sample-type').selectOption({ index: 1 });
      await page.getByTestId('wizard-sample-origin').selectOption({ index: 1 });
      await page.getByTestId('wizard-extraction-protocol').selectOption({ index: 1 });
      await page.getByTestId('wizard-sprec-axis-1').selectOption({ index: 1 });
      await page.getByTestId('wizard-sprec-axis-2').selectOption({ index: 1 });
      // Known processing, not "processing unknown": that forces axes 3-6 to
      // X, which fails quality governance and quarantines the specimen
      // whatever its consent. The first code of each axis (U24-ACD-A-A-A-A-A)
      // reads governance_status 1, grade A.
      for (const axis of [3, 4, 5, 6]) {
        await page.getByTestId(`wizard-sprec-axis-${axis}`).selectOption({ index: 1 });
      }
      await page.getByTestId('wizard-sprec-axis-7').selectOption({ index: 1 });
      await page.getByTestId('wizard-quantity').fill('5');
      await page.getByTestId('wizard-linked-project').fill(`E2E-1371-${label}-${suffix}`);
      if (parentSpecimenIds) {
        await page.getByTestId('wizard-parent-specimen-ids').fill(parentSpecimenIds);
      }
      await page.getByTestId('wizard-institution-name').fill('Hospital E2E 1371');
      await page.getByTestId('wizard-collection').selectOption(governedCollection!.collectionId);
      await page.getByTestId('wizard-next-button').click();

      await expect(page.getByTestId('wizard-diagnosis-search')).toBeVisible();
      await page.getByTestId('wizard-diagnosis-search').fill(diseaseLabel);
      await expect(page.getByTestId('wizard-diagnosis-option-0')).toBeVisible({ timeout: 10_000 });
      await page.getByTestId('wizard-diagnosis-option-0').click();
      await expect(page.locator('.phenotype-card', { hasText: phenotypeLabel })).toBeVisible({ timeout: 10_000 });
      await page.getByTestId('wizard-treatment-status').selectOption('NAIVE');

      const submissionResponse = page.waitForResponse((response) => response.url().includes('/intake-wizard') && response.request().method() === 'POST');
      await page.getByTestId('wizard-submit-button').click();
      const response = await submissionResponse;
      const rawBody = await response.text();
      expect(response.ok(), `POST /intake-wizard (${label}) -> ${response.status()}: ${rawBody.slice(0, 500)}`).toBe(true);
      const body = JSON.parse(rawBody);
      const sample = {
        mongoId: String(body?.sample?._id || ''),
        specimenId: String(body?.sample?.specimenId || ''),
      };
      expect(sample.mongoId, `${label} sample _id`).toBeTruthy();
      expect(sample.specimenId, `${label} sample specimenId`).toBeTruthy();
      lineageSamples.push(sample);
      expect(body?.consent?.active, `${label} intake reads the signed consent`).toBe(true);
      expect(body?.qualityAssessment?.governance_status, `${label} quality governance`).toBe(1);
      return { sample, participantId: String(body?.patientMatch?.patientID || '') };
    };

    const db = mongoClient.db(mongoDbName);

    const parent = await registerThroughWizard('parent');
    expect(parent.participantId).toBe(participantId);
    // The parent is available, so the derivative's intake is not refused
    // under RF019 AC3.
    const storedParent = await db.collection('samples').findOne({ _id: new ObjectId(parent.sample.mongoId) });
    expect(storedParent?.specimenStatus).toBe('available');

    const derivative = await registerThroughWizard('derivative', parent.sample.specimenId);
    expect(derivative.participantId).toBe(parent.participantId);

    const stored = await db.collection('samples').findOne({ _id: new ObjectId(derivative.sample.mongoId) });
    expect(stored?.parentSpecimenIds).toEqual([parent.sample.specimenId]);

    const lineageEvents = await db.collection('graph_projection_outbox').find({
      eventType: 'LINEAGE_REGISTERED',
      aggregateType: 'Sample',
      aggregateId: derivative.sample.mongoId,
    }).toArray();
    expect(lineageEvents).toHaveLength(1);
    expect(lineageEvents[0].payload).toEqual({
      specimenId: String(derivative.sample.mongoId),
      parentSpecimenId: String(parent.sample.mongoId),
    });
  });
});
