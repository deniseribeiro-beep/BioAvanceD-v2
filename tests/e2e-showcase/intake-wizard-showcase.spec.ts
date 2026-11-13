import { type Page } from '@playwright/test';
import { MongoClient, ObjectId } from 'mongodb';
import { test, expect } from './showcaseFixtures';
import { realLogin, seedRealAuth } from '../e2e/helpers/realAuth';
import { SIGNATURE_PNG_DATA_URL } from '../e2e/helpers/consentSignature';
import {
  closeSeedDb,
  seedActiveConsentTemplate,
  seedActiveTerminologyConcept,
  cleanupActiveTerminologyConcepts,
  seedLegacyDiagnosisTerminology,
  seedStorageBoxLocation,
  cleanupStorageBoxLocation,
  type SeededStorageBox,
} from '../e2e/helpers/seedParticipant';
import { seedOrphaPhenotypeGraph, removeOrphaPhenotypeGraph, closeNeo4jDriver } from '../e2e/helpers/queryNeo4j';
import { generateValidCpf } from '../e2e/helpers/cpf';
import { waitForIntakeWizardReady } from '../e2e/helpers/waitForIntakeWizardReady';
import {
  seedGovernedCollection,
  cleanupGovernedCollection,
  closeGovernedCollectionDb,
  type GovernedCollection,
} from '../e2e/helpers/seedGovernedCollection';

// Showcase scene for #1543, not a coverage spec: the intake wizard's main
// flow as the repo owner asked to see it, recorded by
// playwright.showcase.config.ts (video on, one worker, real backend). Its own
// file, so it runs alone and depends on no other scene:
//   npx playwright test --config=playwright.showcase.config.ts intake-wizard-showcase
// against a live stack. The three steps, the SPREC code built on step 2, the
// backend's RCS quality decision and the automatic freezer allocation, then
// the registered specimen's page. The participant and her signed consent are
// made off camera first (the #1371 path), so the intake reads an active
// consent and the specimen is released rather than held for CONSENT_PENDING.
// Every value that reaches the screen is readable copy; uniqueness lives in
// the birth date and in fields the camera does not show.

const apiBaseURL = process.env.PLAYWRIGHT_API_BASE_URL;
const mongoUri = process.env.E2E_MONGO_URI || 'mongodb://localhost:27017?directConnection=true';
const mongoDbName = process.env.E2E_MONGO_DB || 'bioavanced_test';
test.skip(!apiBaseURL, 'PLAYWRIGHT_API_BASE_URL not set — run via npm run test:e2e:docker against the real stack');

// Pauses scaled to how much changes on screen, as in human-showcase.spec.ts.
const SMALL = 1_000;
const MEDIUM = 2_000;
const LARGE = 3_000;

async function beat(page: Page, ms: number) {
  await page.waitForTimeout(ms);
}

// Rewrites the lower-third caption showcaseFixtures mounts, one per stage.
async function caption(page: Page, heading: string, sub: string) {
  await page.evaluate(([h, s]) => {
    const el = document.getElementById('__sc_caption');
    if (!el) return;
    el.textContent = h;
    if (s) {
      const small = document.createElement('small');
      small.textContent = s;
      el.appendChild(small);
    }
  }, [heading, sub]);
}

const patientName = 'Maria Aparecida Souza';
// The scene's own disease and codes: no other spec seeds them, so no row an
// earlier run leaves in the terminology index shares this ORPHA number and
// wins the wizard's per-ORPHA consolidation (tests/e2e/intake-wizard.spec.ts
// seeds ORPHA:558 on every run and keeps it).
const diseaseLabel = 'Doença de Pompe';
const diseaseSearch = 'Pompe';
const orphaCode = 'ORPHA:365';
const orphaNumeric = '365';
const cidCode = 'E74.0';
const omimCode = '232300';
const hpoCode = 'HP:0003198';
const phenotypeLabel = 'Miopatia';
const collectionName = 'Biobanco de Doenças Raras';
const freezerName = 'Freezer -80 °C · Sala 1';
const shelfName = 'Prateleira 1';
const rackName = 'Rack A';
// The wizard allocates the first box by name with a free position
// (intakeWizard.js resolveAutomaticLocation), so this name sorts before the
// "RF004 e2e box" fixtures other specs leave.
const boxName = 'Caixa 01';
// seedActiveConsentTemplate's shared fixture key and title (seedParticipant.ts).
const sharedTemplateKey = 'rf004-shared-consent-template';
const sharedTemplateTitle = 'RF004 e2e consent template';
const consentTitle = 'TCLE — Biobanco de Doenças Raras';

test.describe('Showcase scene — intake wizard main flow (#1543)', () => {
  let mongo: MongoClient | null = null;
  let box: SeededStorageBox | null = null;
  let governed: GovernedCollection | null = null;
  let consentTemplateId = '';

  test.beforeAll(async () => {
    mongo = new MongoClient(mongoUri);
    await mongo.connect();
    const db = mongo.db(mongoDbName);

    // RF004 AC2 (#1497): every specimen names a governed collection.
    governed = await seedGovernedCollection(`showcase-intake-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
    await db.collection('collections').updateOne({ collectionId: governed.collectionId }, { $set: { collectionName } });
    consentTemplateId = await seedActiveConsentTemplate(db);
    // The TCLE select shows "<version> - <title>" on camera: the shared
    // template reads as a real form for the take, and its title is put back.
    await db.collection('consent_templates').updateOne({ e2eFixture: sharedTemplateKey }, { $set: { title: consentTitle } });

    // A freezer with free positions, named the way a biobank names them.
    box = await seedStorageBoxLocation();
    const containers = db.collection('storageContainers');
    await containers.updateOne({ _id: new ObjectId(box.freezerId) }, { $set: { name: freezerName } });
    await containers.updateOne({ _id: new ObjectId(box.shelfId) }, { $set: { name: shelfName } });
    await containers.updateOne({ _id: new ObjectId(box.rackId) }, { $set: { name: rackName } });
    await db.collection('storageBoxes').updateOne({ _id: new ObjectId(box.boxId) }, { $set: { name: boxName } });

    // The diagnosis the search finds (the legacy index, inserted once per
    // volume), its HPO phenotype in the graph, and active terminology
    // releases so the clinical entities record without a warning.
    const legacy = await db.collection('terminologies').findOne({ codigo: orphaCode, descricao: diseaseLabel });
    if (!legacy) {
      await seedLegacyDiagnosisTerminology({ orphaCode, cidCode, omimCode: `OMIM:${omimCode}`, description: diseaseLabel });
    }
    await seedOrphaPhenotypeGraph(orphaNumeric, diseaseLabel, [{ hpoCode, label: phenotypeLabel }]);
    await seedActiveTerminologyConcept('http://www.orpha.net', orphaCode, diseaseLabel, { datasetCode: 'ORPHA' });
    await seedActiveTerminologyConcept('http://hl7.org/fhir/sid/icd-10', cidCode, diseaseLabel, { datasetCode: 'ICD10' });
    await seedActiveTerminologyConcept('https://www.omim.org', omimCode, diseaseLabel, { datasetCode: 'OMIM' });
    await seedActiveTerminologyConcept('http://purl.obolibrary.org/obo/hp.owl', hpoCode, phenotypeLabel, { datasetCode: 'HPO' });
  });

  test.afterAll(async () => {
    await removeOrphaPhenotypeGraph(orphaNumeric).catch(() => {});
    await closeNeo4jDriver();
    await cleanupActiveTerminologyConcepts();
    if (box) await cleanupStorageBoxLocation(box).catch(() => {});
    await cleanupGovernedCollection(governed);
    await closeGovernedCollectionDb();
    await closeSeedDb();
    await mongo
      ?.db(mongoDbName)
      .collection('consent_templates')
      .updateOne({ e2eFixture: sharedTemplateKey }, { $set: { title: sharedTemplateTitle } })
      .catch(() => {});
    await mongo?.close();
  });

  test('Cadastro integrado: the three wizard steps, the SPREC and RCS quality result and the automatic freezer allocation', async ({ page, request }) => {
    const session = await realLogin(request);
    await page.addInitScript(() => {
      window.localStorage.setItem('app_language', 'pt-BR');
    });
    await seedRealAuth(page, session);
    const headers = { Authorization: `Bearer ${session.token}` };

    // The birth date carries the run's uniqueness: the intake matches a
    // participant by name and birth date.
    const stamp = Date.now();
    const birthIso = new Date(Date.UTC(1950, 0, 1) + (stamp % 18_000) * 86_400_000).toISOString().slice(0, 10);
    const birthBr = `${birthIso.slice(8, 10)}/${birthIso.slice(5, 7)}/${birthIso.slice(0, 4)}`;
    const email = `maria.souza.${String(stamp).slice(-4)}@exemplo.com.br`;

    // Off camera: the participant and her signed consent (the #1371 path).
    const created = await request.post(`${apiBaseURL}/api/patients`, {
      headers,
      data: { participantId: 'placeholder', patientName, birthDate: birthIso, sex: 'F', consentTemplateId },
    });
    expect(created.ok(), await created.text()).toBe(true);
    const participantId = String((await created.json())?.data?.participantId || '');
    expect(participantId).toBeTruthy();
    const signed = await request.post(`${apiBaseURL}/api/e-consent/consents`, {
      headers,
      data: { participantId, consentTemplateId, responses: {}, signatureName: patientName, signatureImageBase64: SIGNATURE_PNG_DATA_URL },
    });
    expect(signed.ok(), await signed.text()).toBe(true);

    // Step 1: the participant.
    await page.goto('/next/intake');
    await waitForIntakeWizardReady(page);
    await caption(page, 'Passo 1 de 3 · Participante', 'Nome e data de nascimento localizam a participante que já assinou o TCLE');
    await beat(page, LARGE);
    await page.getByTestId('wizard-full-name').pressSequentially(patientName, { delay: 60 });
    await beat(page, SMALL);
    await page.getByTestId('wizard-birth-date').fill(birthBr);
    await expect(page.getByTestId('wizard-patient-match-alert')).toBeVisible({ timeout: 10_000 });
    await beat(page, MEDIUM);
    await page.getByTestId('wizard-gender').selectOption('F');
    await beat(page, SMALL);
    await page.getByTestId('wizard-email').fill(email);
    await beat(page, SMALL);
    await page.getByTestId('wizard-document').fill(generateValidCpf());
    await beat(page, SMALL);
    await page.getByTestId('wizard-next-button').click();

    // Step 2: the specimen and its SPREC code. Known processing on every
    // axis (index 1 each), never "processing unknown", which forces axes 3-6
    // to X and fails quality governance.
    await expect(page.getByTestId('wizard-sprec-axis-1')).toBeVisible();
    await caption(page, 'Passo 2 de 3 · Amostra e código SPREC', 'Cada eixo pré-analítico compõe o código SPREC 2.0 da amostra');
    await beat(page, LARGE);
    await page.getByTestId('wizard-sprec-matrix').selectOption('fluid');
    await beat(page, SMALL);
    for (const field of ['wizard-sample-type', 'wizard-sample-origin', 'wizard-extraction-protocol']) {
      await page.getByTestId(field).selectOption({ index: 1 });
      await beat(page, SMALL);
    }
    for (const axis of [1, 2, 3, 4, 5, 6, 7]) {
      await page.getByTestId(`wizard-sprec-axis-${axis}`).selectOption({ index: 1 });
      await beat(page, SMALL);
    }
    const sprecCard = page.getByText('SPREC 2.0', { exact: true }).first().locator('xpath=..');
    await sprecCard.scrollIntoViewIfNeeded();
    await expect(sprecCard).not.toContainText('PENDENTE');
    await beat(page, MEDIUM);
    await page.getByTestId('wizard-quantity').fill('5');
    await beat(page, SMALL);
    await page.getByTestId('wizard-collection').selectOption(governed!.collectionId);
    await beat(page, SMALL);
    await page.getByTestId('wizard-linked-project').fill('Projeto Doenças Raras');
    await page.getByTestId('wizard-institution-name').fill('Hospital Universitário');
    await beat(page, SMALL);
    await page.getByTestId('wizard-next-button').click();

    // Step 3: the diagnosis, its suggested phenotype, the treatment status
    // and the consent form the participant signed.
    await expect(page.getByTestId('wizard-diagnosis-search')).toBeVisible();
    await caption(page, 'Passo 3 de 3 · Diagnóstico e TCLE', 'Doença ORPHA com CID-10 e OMIM, fenótipos HPO sugeridos e o TCLE vinculado');
    await beat(page, LARGE);
    await page.getByTestId('wizard-diagnosis-search').pressSequentially(diseaseSearch, { delay: 120 });
    const diagnosis = page.getByTestId('wizard-diagnosis-results').getByRole('button', { name: diseaseLabel }).first();
    await expect(diagnosis).toBeVisible({ timeout: 10_000 });
    await beat(page, MEDIUM);
    await diagnosis.click();
    const phenotype = page.locator('.phenotype-card', { hasText: phenotypeLabel });
    await expect(phenotype).toBeVisible({ timeout: 10_000 });
    await phenotype.scrollIntoViewIfNeeded();
    await beat(page, MEDIUM);
    await page.getByTestId('wizard-treatment-status').selectOption('NAIVE');
    await beat(page, SMALL);
    await page.getByLabel('TCLE vinculado', { exact: true }).selectOption(consentTemplateId);
    await beat(page, MEDIUM);

    const submission = page.waitForResponse((response) => response.url().includes('/intake-wizard') && response.request().method() === 'POST');
    await page.getByTestId('wizard-submit-button').click();
    const response = await submission;
    const raw = await response.text();
    expect(response.ok(), `POST /intake-wizard -> ${response.status()}: ${raw.slice(0, 500)}`).toBe(true);
    const body = JSON.parse(raw);
    expect(String(body?.patientMatch?.patientID || '')).toBe(participantId);
    expect(body?.consent?.active, 'the intake reads the signed consent').toBe(true);
    expect(body?.qualityAssessment?.governance_status, 'quality governance').toBe(1);
    expect(body?.sample?.specimenStatus).toBe('available');
    expect(body?.clinicalEntities?.failed ?? []).toEqual([]);
    expect(
      String(body?.storageLocation?.boxId || ''),
      'the wizard allocated another box: one sorts before "Caixa 01" by name on this volume (resolveAutomaticLocation)',
    ).toBe(box!.boxId);
    const specimenId = String(body?.sample?.specimenId || '');
    const grade = String(body?.qualityAssessment?.final_grade || '');
    const position = String(body?.storageAssignment?.positionCode || body?.storageLocation?.position || '');
    expect(specimenId).toBeTruthy();
    expect(grade).toMatch(/^[A-D]$/);
    expect(position).toMatch(/^[A-H]\d{1,2}$/);

    // The backend's decision: quality, release and the freezer position.
    // Each toast is drawn twice (Sonner and the legacy stack, ToastContainer.tsx),
    // so the alert role and its text pick one, as the coverage specs do.
    await expect(page.getByRole('alert').filter({ hasText: 'amostra validada e localização automática atribuída' }).first()).toBeVisible();
    await caption(page, 'Análise de qualidade e alocação no freezer', `Qualidade RCS grau ${grade}: amostra liberada e guardada na posição ${position}`);
    const label = page.getByTestId('sample-label');
    await expect(label).toBeVisible();
    await label.scrollIntoViewIfNeeded();
    await expect(page.getByTestId('sample-label-sample-id')).toContainText(specimenId);
    await expect(label).toContainText('Localização');
    await expect(label).toContainText(position);
    await beat(page, LARGE);

    // A reading for whoever cuts the reel, not a pass condition: the compliance graph the specimen page draws.
    const graph = await request.get(`${apiBaseURL}/api/samples/${encodeURIComponent(specimenId)}/compliance-graph`, { headers });
    console.log(`[showcase-1543] compliance-graph ${graph.status()}: ${(await graph.text()).slice(0, 800)}`);

    // The registered specimen: the RCS quality check, its SPREC code and
    // where it sits in the freezer.
    await page.goto(`/samples/${encodeURIComponent(specimenId)}`);
    await expect(page.getByTestId('sample-detail-root')).toBeVisible({ timeout: 20_000 });
    await caption(page, 'A amostra registrada', 'Validação de qualidade RCS, código SPREC e posição física no freezer');
    await beat(page, LARGE);
    const qualityRow = page.getByText('Qualidade', { exact: true }).locator('xpath=..');
    await expect(qualityRow).toContainText(`RCS-GOV ${grade} aprovado`, { timeout: 15_000 });
    await qualityRow.scrollIntoViewIfNeeded();
    await beat(page, LARGE);
    const sprecHeading = page.getByRole('heading', { name: 'SPREC', exact: true });
    await sprecHeading.scrollIntoViewIfNeeded();
    await beat(page, MEDIUM);
    const storage = page.getByText(`${freezerName}/${shelfName}/${rackName}/${boxName} / Poço ${position}`, { exact: true });
    await expect(storage).toBeVisible({ timeout: 15_000 });
    await storage.scrollIntoViewIfNeeded();
    await beat(page, LARGE);
  });
});
