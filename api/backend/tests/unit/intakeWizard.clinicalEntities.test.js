import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { createRequire } from 'module';
import express from 'express';
import request from 'supertest';

const require = createRequire(import.meta.url);

const notificationServicePath = require.resolve('../../src/services/notification.service');
const patientIdentityServicePath = require.resolve('../../src/services/PatientIdentityService');
const merkleServicePath = require.resolve('../../src/services/MerkleService');
const collectionResolverPath = require.resolve('../../src/utils/collectionResolver');
const auditLoggerPath = require.resolve('../../src/utils/auditLogger');
const qualityDomainPath = require.resolve('../../src/services/quality-domain.service');
const sampleServicePath = require.resolve('../../src/services/sample.service');
const storageServicePath = require.resolve('../../src/services/storageService');
const rcsAssessmentServicePath = require.resolve('../../src/services/rcs-assessment.service');
const encounterServicePath = require.resolve('../../src/services/encounter.service');
const conditionServicePath = require.resolve('../../src/services/condition.service');
const phenotypeObservationServicePath = require.resolve('../../src/services/phenotype-observation.service');
const medicationExposureServicePath = require.resolve('../../src/services/medication-exposure.service');
const allergyIntoleranceServicePath = require.resolve('../../src/services/allergy-intolerance.service');
const familyHistoryServicePath = require.resolve('../../src/services/family-history.service');
const procedureServicePath = require.resolve('../../src/services/procedure.service');
const clinicalObservationServicePath = require.resolve('../../src/services/clinical-observation.service');
const clinicalOutcomeServicePath = require.resolve('../../src/services/clinical-outcome.service');
const derivedScoreServicePath = require.resolve('../../src/services/derived-score.service');
const activeCodeValidatorPath = require.resolve('../../src/ingestion/activeCodeValidator');
const routePath = require.resolve('../../src/routes/intakeWizard.js');

// #1428: warm the intakeWizard route graph once at file load so #782 cases
// under a full coverage run do not pay cold-require inside the it() budget.
require(routePath);

const allPaths = [
  notificationServicePath,
  patientIdentityServicePath,
  merkleServicePath,
  collectionResolverPath,
  auditLoggerPath,
  qualityDomainPath,
  sampleServicePath,
  storageServicePath,
  rcsAssessmentServicePath,
  // #693's own 4 new services (plus activeCodeValidator, which
  // condition.service.js/phenotype-observation.service.js call directly)
  // destructure `getCollection` from collectionResolver at require time --
  // if these stay cached across tests in this file, they keep whichever
  // test's mock was live when they were first `require`d, so later tests'
  // `collectionResolverModule.getCollection` reassignment never reaches
  // them. Must be cleared every test alongside routePath.
  encounterServicePath,
  conditionServicePath,
  phenotypeObservationServicePath,
  medicationExposureServicePath,
  allergyIntoleranceServicePath,
  familyHistoryServicePath,
  procedureServicePath,
  clinicalObservationServicePath,
  clinicalOutcomeServicePath,
  derivedScoreServicePath,
  activeCodeValidatorPath,
  routePath,
];

function makeCursor(rows) {
  const cursor = { sort: () => cursor, limit: () => cursor, toArray: async () => rows };
  return cursor;
}

function clearCache() {
  for (const p of allPaths) delete require.cache[p];
}

const ORPHA_SYSTEM_URI = 'http://www.orpha.net';
const HPO_SYSTEM_URI = 'http://purl.obolibrary.org/obo/hp.owl';
const OMIM_SYSTEM_URI = 'https://www.omim.org';
const DCB_SYSTEM_URI = 'https://www.gov.br/anvisa/pt-br/assuntos/farmacopeia/dcb';
const ICD10_SYSTEM_URI = 'http://hl7.org/fhir/sid/icd-10';

/**
 * Real query-matching fake for the two RF029 active-code-check collections
 * (activeCodeValidator.js calls db.collection(...) directly, not through
 * the mocked collectionResolver) -- same "real semantics, not a stub" bar
 * as tests/unit/ingestion/testHelpers.js.
 */
function makeActiveCodeCollections() {
  const terminologyConcepts = [
    { systemUri: ORPHA_SYSTEM_URI, code: 'ORPHA:558', version: '2026-01', conceptStatus: 'active', referenceDatasetReleaseId: 'release-orpha' },
    { systemUri: HPO_SYSTEM_URI, code: 'HP:0000822', version: '2026-01', conceptStatus: 'active', referenceDatasetReleaseId: 'release-hpo' },
    // #698: RF028's real OMIM importer stores bare digits, no "OMIM:" prefix.
    { systemUri: OMIM_SYSTEM_URI, code: '154700', version: '2026-01', conceptStatus: 'active', referenceDatasetReleaseId: 'release-omim' },
    // #714: AllergyIntolerance's allergenCoding now goes through the same
    // active-release gate as Condition/PhenotypeObservation above.
    { systemUri: DCB_SYSTEM_URI, code: '03730', version: '2026-01', conceptStatus: 'active', referenceDatasetReleaseId: 'release-dcb' },
    // #1337: an ICD-10 code, so a Condition can carry all three codings.
    { systemUri: ICD10_SYSTEM_URI, code: 'E11', version: '2026-01', conceptStatus: 'active', referenceDatasetReleaseId: 'release-icd10' },
  ];
  const referenceDatasetReleases = [
    { referenceDatasetReleaseId: 'release-orpha', datasetCode: 'ORPHA', releaseStatus: 'active' },
    { referenceDatasetReleaseId: 'release-hpo', datasetCode: 'HPO', releaseStatus: 'active' },
    { referenceDatasetReleaseId: 'release-omim', datasetCode: 'OMIM', releaseStatus: 'active' },
    { referenceDatasetReleaseId: 'release-dcb', datasetCode: 'DCB', releaseStatus: 'active' },
    { referenceDatasetReleaseId: 'release-icd10', datasetCode: 'ICD10', releaseStatus: 'active' },
  ];
  return {
    terminologyConcepts: {
      findOne: async (filter) => terminologyConcepts.find((c) => c.systemUri === filter.systemUri && c.code === filter.code && (!filter.version || c.version === filter.version)) || null,
      // #763: synchronous and chainable, mirroring the real driver -- the
      // same correction #694 made to the shared ingestion fake. The old
      // `async find()` resolving to a bare `{ toArray }` only worked
      // against the two-step `await collection.find(f)` form, which is
      // what kept that workaround alive in product code long after #694.
      find: (filter) => ({
        toArray: async () => terminologyConcepts.filter((c) => c.systemUri === filter.systemUri && c.code === filter.code),
      }),
    },
    referenceDatasetReleases: { findOne: async (filter) => referenceDatasetReleases.find((r) => r.referenceDatasetReleaseId === filter.referenceDatasetReleaseId) || null },
  };
}

function makeInsertCapturingCollection() {
  const docs = [];
  return { docs, insertOne: vi.fn(async (doc) => { docs.push(doc); return { insertedId: `id-${docs.length}` }; }) };
}

function buildApp(router, db) {
  const app = express();
  app.use(express.json());
  app.locals.db = db;
  // #1355: the scope requireOrganizationScope supplies in front of this
  // router (intakeWizard.routes.js); global, as the fixtures' caller.
  app.use((req, _res, next) => { req.organizationScope = req.organizationScope || { scope: 'global', organizationIds: [] }; next(); });
  app.use('/api/intake-wizard', router);
  return app;
}

const VALID_PAYLOAD = {
  participant: { participantId: '12345678', patientName: 'Paciente Teste', email: 'paciente@example.test' },
  legalRepresentative: null,
  consent: { consentTemplateId: 'template-1' },
  specimen: { specimenId: 'spec-1', participantId: '12345678', sampleType: 'Sangue', sampleOrigin: 'Hospital A', extractionProtocol: 'EDTA', quantity: 2, registeredAt: '2026-01-15T00:00:00.000Z' },
  diagnosis: { orphaCode: 'ORPHA:558' },
  clinical: {
    diseasePhenotypes: [{ hpoId: 'HP:0000822', label: 'Hypertension' }],
    pharmacologyData: { treatmentStatus: 'ON_TREATMENT', medicationName: 'Metformin', atcCode: 'A10BA02' },
  },
  biomarkers: [],
};

/**
 * #693 (RF005 clinical-data slice 5/5): additive real-entity recording from
 * the intake wizard's own already-collected payload -- proves AC4-6's
 * structured-coding requirement is satisfied by a real write path, not just
 * schema-complete (#689-#692). Native-only proof (real query-matching
 * fakes, not canned stubs) is this repo's own proof bar for a
 * backend-internal slice; the literal real-backend Playwright e2e proof is
 * tracked separately (see #693's close comment for the follow-up number).
 */
describe('intakeWizard clinical-entity recording (#693)', () => {
  // #1238: the first require of the route pulls in its whole third-party and
  // service graph, 2+ s cold, which is load cost rather than anything a test
  // proves. clearCache() drops only this file's own modules, so the graph
  // stays warm after this hook and each test's 5 s budget covers its own work.
  beforeAll(() => {
    require(routePath);
    clearCache();
  }, 30000);

  afterEach(() => {
    vi.restoreAllMocks();
    clearCache();
  });

  /**
   * clearCache() (inside loadRoute, run first) discards the module instance
   * any earlier mock was set on -- collectionResolver's mock must be applied
   * to the FRESH post-clearCache instance intakeWizard.js itself will
   * `require`, not to a stale one, or the route silently falls back to the
   * real getCollection and every `getCollection(db, key)` call 404s against
   * this test's hand-built `db.collection()` raw fallback.
   */
  // #782: `failCollections` makes a named entity collection reject on insert,
  // so the outcome summary the wizard now returns can be asserted on a real
  // failure. Defaults to none, so every existing caller is unaffected.
  async function runIntake(payload, { failCollections = [], failWith } = {}) {
    clearCache();

    const notificationServiceModule = require(notificationServicePath);
    notificationServiceModule.buildConsentMetadata = vi.fn(() => ({ token: 'tok-1' }));
    notificationServiceModule.buildConsentLink = vi.fn(() => 'https://consent.link/tok-1');
    notificationServiceModule.sendConsentEmail = vi.fn().mockResolvedValue({ success: true, channel: 'email' });

    const patientIdentityServiceModule = require(patientIdentityServicePath);
    vi.spyOn(patientIdentityServiceModule, 'matchOrUpsertParticipant').mockResolvedValue({
      created: true,
      matchType: 'new',
      patient: { _id: 'patient-obj-1', participantId: '12345678' },
    });

    const merkleServiceModule = require(merkleServicePath);
    merkleServiceModule.generateSampleHashFromSample = vi.fn(async () => 'hash-1');

    const auditLoggerModule = require(auditLoggerPath);
    auditLoggerModule.init = vi.fn();
    auditLoggerModule.log = vi.fn().mockResolvedValue(undefined);

    const qualityDomainModule = require(qualityDomainPath);
    qualityDomainModule.resolveMethodologicalQuality = vi.fn(() => ({
      score: 80, category: 'B', label: 'Boa qualidade', forcedQuarantine: false, penaltyLog: [], reasons: [],
      matrixType: 'fluid', source: 'RCS-GOV', version: '1.0', quarantineReason: null,
    }));

    const rcsAssessmentServiceModule = require(rcsAssessmentServicePath);
    rcsAssessmentServiceModule.recordAssessment = vi.fn().mockResolvedValue({ _id: 'assessment-1' });

    const collections = {
      samples: {
        insertOne: vi.fn().mockResolvedValue({ insertedId: 'sample-1' }),
        findOne: vi.fn().mockResolvedValue({ _id: 'sample-1', specimenId: 'spec-1', participantId: '12345678' }),
        updateOne: vi.fn().mockResolvedValue({ matchedCount: 1 }),
      },
      patients: { updateOne: vi.fn().mockResolvedValue({ matchedCount: 1 }) },
      consents: { findOne: vi.fn().mockResolvedValue(null) },
      encounters: makeInsertCapturingCollection(),
      conditions: makeInsertCapturingCollection(),
      phenotypeObservations: makeInsertCapturingCollection(),
      medicationExposures: makeInsertCapturingCollection(),
      allergyIntolerances: makeInsertCapturingCollection(),
      familyHistories: makeInsertCapturingCollection(),
      procedures: makeInsertCapturingCollection(),
      clinicalObservations: makeInsertCapturingCollection(),
      clinicalOutcomes: makeInsertCapturingCollection(),
      derivedScores: makeInsertCapturingCollection(),
      ...makeActiveCodeCollections(),
    };

    for (const key of failCollections) {
      collections[key] = {
        docs: [],
        insertOne: vi.fn(async () => {
          throw failWith !== undefined ? failWith : new Error(`insert rejeitado (${key})`);
        }),
      };
    }

    const collectionResolverModule = require(collectionResolverPath);
    collectionResolverModule.getCollection = vi.fn(async (_db, key) => {
      if (collections[key]) return collections[key];
      throw new Error(`unexpected key ${key}`);
    });

    const sampleServiceModule = require(sampleServicePath);
    vi.spyOn(sampleServiceModule, 'createSample').mockResolvedValue({ _id: 'sample-1', participantId: '12345678' });

    const StorageService = require(storageServicePath);
    vi.spyOn(StorageService.prototype, 'autoAssignSampleToBox').mockResolvedValue({
      success: true,
      sampleLocation: { boxId: 'box-1', position: 'A1' },
    });

    const router = require(routePath);

    const db = {
      collection: (name) => {
        if (collections[name]) return collections[name];
        if (name === 'sensors') return { find: () => makeCursor([{ sensorId: 'SEN-1', sensorType: 'temperature', locationId: 'EQ-1', maintenanceStatus: 'operational' }]) };
        if (name === 'equipment') return { findOne: vi.fn().mockResolvedValue({ equipmentID: 'EQ-1', status: 'active' }) };
        if (name === 'storageBoxes') {
          return {
            find: () => makeCursor([{
              _id: 'box-1', name: 'Box A', status: 'ACTIVE', dimension: { rows: 1, cols: 1 },
              currentOccupancy: 0, occupancyGrid: {}, parent_id: 'rack-1',
            }]),
          };
        }
        if (name === 'storageContainers') {
          return {
            findOne: vi.fn(async ({ _id }) => {
              if (_id === 'rack-1') return { _id: 'rack-1', containerType: 'RACK', parent_id: 'shelf-1' };
              if (_id === 'shelf-1') return { _id: 'shelf-1', containerType: 'SHELF', parent_id: 'freezer-1' };
              if (_id === 'freezer-1') return { _id: 'freezer-1', containerType: 'FREEZER', containerID: 'EQ-1' };
              return null;
            }),
          };
        }
        throw new Error(`unexpected collection ${name}`);
      },
    };

    const app = buildApp(router, db);
    const res = await request(app).post('/api/intake-wizard').send(payload);
    return { res, collections };
  }

  it('creates an Encounter, a Condition, and a PhenotypeObservation from the intake payload', async () => {
    const { res, collections } = await runIntake(VALID_PAYLOAD);

    expect(res.status).toBe(200);
    expect(collections.encounters.docs).toHaveLength(1);
    expect(collections.encounters.docs[0]).toMatchObject({ participantId: '12345678', encounterType: 'collection' });

    expect(collections.conditions.docs).toHaveLength(1);
    expect(collections.conditions.docs[0]).toMatchObject({
      participantId: '12345678',
      conditionCoding: [{ systemUri: ORPHA_SYSTEM_URI, code: 'ORPHA:558' }],
    });

    expect(collections.phenotypeObservations.docs).toHaveLength(1);
    expect(collections.phenotypeObservations.docs[0]).toMatchObject({
      participantId: '12345678',
      hpoCoding: { systemUri: HPO_SYSTEM_URI, code: 'HP:0000822', display: 'Hypertension' },
      presenceStatus: 'present',
      encounterId: collections.encounters.docs[0].encounterId,
    });
  });

  it('creates a MedicationExposure from pharmacologyData when medicationName and atcCode are both present', async () => {
    const { collections } = await runIntake(VALID_PAYLOAD);

    expect(collections.medicationExposures.docs).toHaveLength(1);
    expect(collections.medicationExposures.docs[0]).toMatchObject({
      medicationCoding: [{ systemUri: 'http://www.whocc.no/atc', code: 'A10BA02', display: 'Metformin' }],
      recordType: 'reported',
      medicationStatus: 'active',
    });
  });

  it('skips MedicationExposure when no atcCode is present (no valid Coding to satisfy the 1..* requirement)', async () => {
    const payload = { ...VALID_PAYLOAD, clinical: { ...VALID_PAYLOAD.clinical, pharmacologyData: { treatmentStatus: 'ON_TREATMENT', medicationName: 'Metformin' } } };

    const { res, collections } = await runIntake(payload);

    expect(res.status).toBe(200);
    expect(collections.medicationExposures.docs).toHaveLength(0);
  });

  it('does not create a Condition when no diagnosis codes are present, and does not fail the intake', async () => {
    const payload = { ...VALID_PAYLOAD, diagnosis: {} };

    const { res, collections } = await runIntake(payload);

    expect(res.status).toBe(200);
    expect(collections.conditions.docs).toHaveLength(0);
    // Encounter still gets created -- it has no dependency on diagnosis data.
    expect(collections.encounters.docs).toHaveLength(1);
  });

  it('RF005 AC#4: does not persist a Condition whose code fails the active-release gate, and does not fail the intake', async () => {
    const payload = { ...VALID_PAYLOAD, diagnosis: { orphaCode: 'ORPHA:UNKNOWN' } };

    const { res, collections } = await runIntake(payload);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(collections.conditions.docs).toHaveLength(0);
  });

  it('#698: strips the wizard\'s always-prefixed "OMIM:<digits>" down to RF028\'s bare-digit storage format before building conditionCoding', async () => {
    const payload = { ...VALID_PAYLOAD, diagnosis: { orphaCode: 'ORPHA:558', omimCode: 'OMIM:154700' } };

    const { res, collections } = await runIntake(payload);

    expect(res.status).toBe(200);
    expect(collections.conditions.docs).toHaveLength(1);
    const omimCoding = collections.conditions.docs[0].conditionCoding.find((c) => c.systemUri === 'https://www.omim.org');
    expect(omimCoding).toMatchObject({ systemUri: 'https://www.omim.org', code: '154700' });
  });

  it('#708: creates an AllergyIntolerance from a wizard-collected allergen entry, DCB-coded', async () => {
    const payload = {
      ...VALID_PAYLOAD,
      clinical: {
        ...VALID_PAYLOAD.clinical,
        allergies: [{ allergenName: 'Dipirona', allergenCode: '03730', reaction: 'Urticária' }],
      },
    };

    const { res, collections } = await runIntake(payload);

    expect(res.status).toBe(200);
    expect(collections.allergyIntolerances.docs).toHaveLength(1);
    expect(collections.allergyIntolerances.docs[0]).toMatchObject({
      allergenCoding: { systemUri: 'https://www.gov.br/anvisa/pt-br/assuntos/farmacopeia/dcb', code: '03730', display: 'Dipirona' },
      reaction: [{ manifestation: 'Urticária' }],
    });
  });

  it('#708: skips an allergen entry with no DCB code, and does not fail the intake', async () => {
    const payload = {
      ...VALID_PAYLOAD,
      clinical: {
        ...VALID_PAYLOAD.clinical,
        allergies: [{ allergenName: 'Dipirona', allergenCode: '', reaction: 'Urticária' }],
      },
    };

    const { res, collections } = await runIntake(payload);

    expect(res.status).toBe(200);
    expect(collections.allergyIntolerances.docs).toHaveLength(0);
  });

  it('#709: creates a FamilyHistory from a wizard-collected family entry, ORPHA-coded condition', async () => {
    const payload = {
      ...VALID_PAYLOAD,
      clinical: {
        ...VALID_PAYLOAD.clinical,
        familyHistories: [{ relationship: 'mother', conditionName: 'Marfan syndrome', orphaCode: 'ORPHA:558', onset: '30 anos' }],
      },
    };

    const { res, collections } = await runIntake(payload);

    expect(res.status).toBe(200);
    expect(collections.familyHistories.docs).toHaveLength(1);
    expect(collections.familyHistories.docs[0]).toMatchObject({
      relationship: 'mother',
      familyCondition: [{
        condition: { systemUri: ORPHA_SYSTEM_URI, code: 'ORPHA:558', display: 'Marfan syndrome' },
        onset: '30 anos',
      }],
    });
  });

  it('#709: skips a family-history entry with no relationship, and does not fail the intake', async () => {
    const payload = {
      ...VALID_PAYLOAD,
      clinical: {
        ...VALID_PAYLOAD.clinical,
        familyHistories: [{ relationship: '', conditionName: 'Marfan syndrome', orphaCode: 'ORPHA:558' }],
      },
    };

    const { res, collections } = await runIntake(payload);

    expect(res.status).toBe(200);
    expect(collections.familyHistories.docs).toHaveLength(0);
  });

  it('#710: creates a Procedure from a wizard-collected entry, locally-coded', async () => {
    const payload = {
      ...VALID_PAYLOAD,
      clinical: {
        ...VALID_PAYLOAD.clinical,
        procedures: [{ procedureName: 'Liver biopsy', procedureCode: 'LOCAL-001', performed: '2026-01-15', bodySite: 'Liver' }],
      },
    };

    const { res, collections } = await runIntake(payload);

    expect(res.status).toBe(200);
    expect(collections.procedures.docs).toHaveLength(1);
    expect(collections.procedures.docs[0]).toMatchObject({
      procedureCoding: [{ systemUri: 'urn:biobank:local-procedure-terminology', code: 'LOCAL-001', display: 'Liver biopsy' }],
      performed: '2026-01-15',
      bodySite: [{ text: 'Liver' }],
    });
  });

  it('#710: skips a procedure entry with no code or no performed date, and does not fail the intake', async () => {
    const payload = {
      ...VALID_PAYLOAD,
      clinical: {
        ...VALID_PAYLOAD.clinical,
        procedures: [{ procedureName: 'Liver biopsy', procedureCode: '', performed: '2026-01-15' }],
      },
    };

    const { res, collections } = await runIntake(payload);

    expect(res.status).toBe(200);
    expect(collections.procedures.docs).toHaveLength(0);
  });

  it('#711: creates a ClinicalObservation from a wizard-collected entry, LOINC-coded', async () => {
    const payload = {
      ...VALID_PAYLOAD,
      clinical: {
        ...VALID_PAYLOAD.clinical,
        observationRecords: [{ testName: 'Hemoglobina', loincCode: '718-7', value: '13.2', unit: 'g/dL', effectiveDate: '2026-01-15' }],
      },
    };

    const { res, collections } = await runIntake(payload);

    expect(res.status).toBe(200);
    expect(collections.clinicalObservations.docs).toHaveLength(1);
    expect(collections.clinicalObservations.docs[0]).toMatchObject({
      participantId: '12345678',
      observationCoding: { systemUri: 'http://loinc.org', code: '718-7', display: 'Hemoglobina' },
      value: '13.2',
      unit: { text: 'g/dL' },
      observationStatus: 'final',
    });
  });

  it('#711: skips an observation entry with no LOINC code or no effective date, and does not fail the intake', async () => {
    const payload = {
      ...VALID_PAYLOAD,
      clinical: {
        ...VALID_PAYLOAD.clinical,
        observationRecords: [{ testName: 'Hemoglobina', loincCode: '', value: '13.2', unit: 'g/dL', effectiveDate: '2026-01-15' }],
      },
    };

    const { res, collections } = await runIntake(payload);

    expect(res.status).toBe(200);
    expect(collections.clinicalObservations.docs).toHaveLength(0);
  });

  it('#712: creates a ClinicalOutcome from a wizard-collected entry', async () => {
    const payload = {
      ...VALID_PAYLOAD,
      clinical: {
        ...VALID_PAYLOAD.clinical,
        clinicalOutcomes: [{ outcomeType: 'remission', outcomeDate: '2026-02-01' }],
      },
    };

    const { res, collections } = await runIntake(payload);

    expect(res.status).toBe(200);
    expect(collections.clinicalOutcomes.docs).toHaveLength(1);
    expect(collections.clinicalOutcomes.docs[0]).toMatchObject({
      outcomeType: { code: 'remission' },
    });
    expect(collections.clinicalOutcomes.docs[0].outcomeDate).toBeInstanceOf(Date);
  });

  it('#712: skips an outcome entry with no outcome type or no outcome date, and does not fail the intake', async () => {
    const payload = {
      ...VALID_PAYLOAD,
      clinical: {
        ...VALID_PAYLOAD.clinical,
        clinicalOutcomes: [{ outcomeType: '', outcomeDate: '2026-02-01' }],
      },
    };

    const { res, collections } = await runIntake(payload);

    expect(res.status).toBe(200);
    expect(collections.clinicalOutcomes.docs).toHaveLength(0);
  });

  it('#713: creates a DerivedScore (CCI) from wizard-collected charlsonConditions that map to real Charlson categories', async () => {
    const payload = {
      ...VALID_PAYLOAD,
      clinical: {
        ...VALID_PAYLOAD.clinical,
        charlsonConditions: ['copd', 'ckd', 'hypertension'],
      },
    };

    const { res, collections } = await runIntake(payload);

    expect(res.status).toBe(200);
    expect(collections.derivedScores.docs).toHaveLength(1);
    expect(collections.derivedScores.docs[0]).toMatchObject({
      scoreType: { code: 'cci', display: 'Charlson Comorbidity Index' },
      scoreValue: 3,
      algorithmVersion: 'CCI-original',
    });
    const componentCodes = collections.derivedScores.docs[0].scoreComponents.map((c) => c.condition.code);
    expect(componentCodes.sort()).toEqual(['chronicPulmonaryDisease', 'renalDisease']);
  });

  it('#713: does not create a DerivedScore when no reported condition maps to a real Charlson category, and does not fail the intake', async () => {
    const payload = {
      ...VALID_PAYLOAD,
      clinical: {
        ...VALID_PAYLOAD.clinical,
        charlsonConditions: ['hypertension', 'smoking'],
      },
    };

    const { res, collections } = await runIntake(payload);

    expect(res.status).toBe(200);
    expect(collections.derivedScores.docs).toHaveLength(0);
  });

  it('#713: does not create a DerivedScore when charlsonConditions is absent, and does not fail the intake', async () => {
    const { res, collections } = await runIntake(VALID_PAYLOAD);

    expect(res.status).toBe(200);
    expect(collections.derivedScores.docs).toHaveLength(0);
  });

  // #782: the wizard returned an unqualified 200 whether every clinical
  // entity recorded or none did -- each write is wrapped in its own
  // try/catch that logs and continues, and the response said nothing. For a
  // biobank the missing rows are clinical annotations on a specimen already
  // in a freezer, so the moment to re-enter them has passed by the time
  // anyone reads a server log.
  //
  // The best-effort design itself is deliberate and unchanged; what these
  // pin is that the outcome is now *reported*.
  it('#782: reports what was recorded on a clean intake', async () => {
    const { res } = await runIntake(VALID_PAYLOAD);

    expect(res.status).toBe(200);
    expect(res.body.clinicalEntities).toBeDefined();
    expect(res.body.clinicalEntities.failed).toEqual([]);
    expect(res.body.clinicalEntities.recorded).toMatchObject({
      Encounter: 1,
      Condition: 1,
      PhenotypeObservation: 1,
      MedicationExposure: 1,
    });
  });

  it('#782: reports a per-entity failure instead of an unqualified success', async () => {
    const { res, collections } = await runIntake(VALID_PAYLOAD, { failCollections: ['conditions'] });

    // Still a 200 and still a successful intake -- that is the deliberate
    // best-effort behaviour, and this fix does not change it.
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(collections.conditions.docs).toHaveLength(0);

    // ...but the caller is now told, rather than having to read a log line.
    expect(res.body.clinicalEntities.failed).toHaveLength(1);
    expect(res.body.clinicalEntities.failed[0]).toMatchObject({ entity: 'Condition' });
    expect(res.body.clinicalEntities.failed[0].error).toMatch(/insert rejeitado/);

    // The entities that did record are still reported as recorded, which is
    // what makes "specimen saved, 1 of 4 not recorded" expressible.
    expect(res.body.clinicalEntities.recorded).toMatchObject({ Encounter: 1, PhenotypeObservation: 1 });
    expect(res.body.clinicalEntities.recorded.Condition).toBeUndefined();
  });

  it('#782: reports every failure when all clinical entities fail, while the intake still returns 200', async () => {
    const { res } = await runIntake(VALID_PAYLOAD, {
      failCollections: ['encounters', 'conditions', 'phenotypeObservations', 'medicationExposures'],
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.clinicalEntities.recorded).toEqual({});
    expect(res.body.clinicalEntities.failed.map((f) => f.entity).sort()).toEqual([
      'Condition',
      'Encounter',
      'MedicationExposure',
      'PhenotypeObservation',
    ]);
  });
  // #1337: the optional fields and failure paths of each entity, so every
  // fallback the recording takes is pinned by what it writes or reports.
  it('#693: codes ORPHA, OMIM and ICD-10 together on one Condition', async () => {
    const payload = { ...VALID_PAYLOAD, diagnosis: { orphaCode: 'ORPHA:558', omimCode: 'OMIM:154700', icdCode: 'E11' } };

    const { res, collections } = await runIntake(payload);

    expect(res.status).toBe(200);
    expect(collections.conditions.docs).toHaveLength(1);
    expect(collections.conditions.docs[0].conditionCoding).toEqual([
      expect.objectContaining({ systemUri: ORPHA_SYSTEM_URI, code: 'ORPHA:558' }),
      expect.objectContaining({ systemUri: OMIM_SYSTEM_URI, code: '154700' }),
      expect.objectContaining({ systemUri: ICD10_SYSTEM_URI, code: 'E11' }),
    ]);
  });

  it('#693: skips a phenotype with no hpoId and records one with no label without a display', async () => {
    const payload = {
      ...VALID_PAYLOAD,
      clinical: { ...VALID_PAYLOAD.clinical, diseasePhenotypes: [{ label: 'sem código' }, { hpoId: 'HP:0000822' }] },
    };

    const { res, collections } = await runIntake(payload);

    expect(res.status).toBe(200);
    expect(collections.phenotypeObservations.docs).toHaveLength(1);
    expect(collections.phenotypeObservations.docs[0].hpoCoding).toMatchObject({ systemUri: HPO_SYSTEM_URI, code: 'HP:0000822' });
    expect(collections.phenotypeObservations.docs[0].hpoCoding.display).toBeUndefined();
    expect(res.body.clinicalEntities.recorded.PhenotypeObservation).toBe(1);
  });

  it('#693: records a WASHOUT medication as stopped, with the washout start as its period', async () => {
    const payload = {
      ...VALID_PAYLOAD,
      clinical: {
        ...VALID_PAYLOAD.clinical,
        pharmacologyData: { treatmentStatus: 'WASHOUT', medicationName: 'Metformin', atcCode: 'A10BA02', washoutStartDate: '2026-01-01' },
      },
    };

    const { collections } = await runIntake(payload);

    expect(collections.medicationExposures.docs).toHaveLength(1);
    expect(collections.medicationExposures.docs[0]).toMatchObject({
      medicationStatus: 'stopped',
      medicationPeriod: { start: new Date('2026-01-01'), end: null },
    });
  });

  it('#693: takes the washout end alone as the period when no start is given', async () => {
    const payload = {
      ...VALID_PAYLOAD,
      clinical: {
        ...VALID_PAYLOAD.clinical,
        pharmacologyData: { treatmentStatus: 'WASHOUT', medicationName: 'Metformin', atcCode: 'A10BA02', washoutEndDate: '2026-01-10' },
      },
    };

    const { collections } = await runIntake(payload);

    expect(collections.medicationExposures.docs[0]).toMatchObject({
      medicationStatus: 'stopped',
      medicationPeriod: { start: null, end: new Date('2026-01-10') },
    });
  });

  it('#693: records a NAIVE medication as unknown with no period', async () => {
    const payload = {
      ...VALID_PAYLOAD,
      clinical: {
        ...VALID_PAYLOAD.clinical,
        pharmacologyData: { treatmentStatus: 'NAIVE', medicationName: 'Metformin', atcCode: 'A10BA02' },
      },
    };

    const { collections } = await runIntake(payload);

    expect(collections.medicationExposures.docs).toHaveLength(1);
    expect(collections.medicationExposures.docs[0].medicationStatus).toBe('unknown');
    expect(collections.medicationExposures.docs[0].medicationPeriod ?? null).toBeNull();
  });

  it('#708: records an allergen with no name and no reaction without a display and with an empty reaction list', async () => {
    const payload = {
      ...VALID_PAYLOAD,
      clinical: { ...VALID_PAYLOAD.clinical, allergies: [{ allergenCode: '03730' }] },
    };

    const { res, collections } = await runIntake(payload);

    expect(res.status).toBe(200);
    expect(collections.allergyIntolerances.docs).toHaveLength(1);
    expect(collections.allergyIntolerances.docs[0].allergenCoding).toMatchObject({ code: '03730' });
    expect(collections.allergyIntolerances.docs[0].allergenCoding.display).toBeUndefined();
    expect(collections.allergyIntolerances.docs[0].reaction).toEqual([]);
  });

  it('#709: records an uncoded family condition by name, a coded one without a name, and an entry with neither as no condition', async () => {
    const payload = {
      ...VALID_PAYLOAD,
      clinical: {
        ...VALID_PAYLOAD.clinical,
        familyHistories: [
          { relationship: 'mother', conditionName: 'Diabetes' },
          { relationship: 'father', orphaCode: 'ORPHA:558' },
          { relationship: 'sibling' },
        ],
      },
    };

    const { res, collections } = await runIntake(payload);

    expect(res.status).toBe(200);
    expect(collections.familyHistories.docs).toHaveLength(3);
    const [mother, father, sibling] = collections.familyHistories.docs;
    expect(mother.familyCondition).toHaveLength(1);
    expect(mother.familyCondition[0].condition).toMatchObject({ display: 'Diabetes' });
    expect(mother.familyCondition[0].condition.code).toBeUndefined();
    expect(mother.familyCondition[0].onset).toBeUndefined();
    expect(father.familyCondition[0].condition).toMatchObject({ systemUri: ORPHA_SYSTEM_URI, code: 'ORPHA:558' });
    expect(father.familyCondition[0].condition.display).toBeUndefined();
    expect(sibling.familyCondition).toEqual([]);
  });

  it('#710: skips a procedure with no performed date and records one with no name or body site', async () => {
    const payload = {
      ...VALID_PAYLOAD,
      clinical: {
        ...VALID_PAYLOAD.clinical,
        procedures: [{ procedureCode: 'LOCAL-002' }, { procedureCode: 'LOCAL-001', performed: '2026-01-15' }],
      },
    };

    const { res, collections } = await runIntake(payload);

    expect(res.status).toBe(200);
    expect(collections.procedures.docs).toHaveLength(1);
    expect(collections.procedures.docs[0].procedureCoding[0]).toMatchObject({ code: 'LOCAL-001' });
    expect(collections.procedures.docs[0].procedureCoding[0].display).toBeUndefined();
    expect(collections.procedures.docs[0].bodySite).toEqual([]);
  });

  it('#711: skips an observation with no effective date and records one with no name, value or unit as nulls', async () => {
    const payload = {
      ...VALID_PAYLOAD,
      clinical: {
        ...VALID_PAYLOAD.clinical,
        observationRecords: [{ loincCode: '2345-7' }, { loincCode: '718-7', effectiveDate: '2026-01-15' }],
      },
    };

    const { res, collections } = await runIntake(payload);

    expect(res.status).toBe(200);
    expect(collections.clinicalObservations.docs).toHaveLength(1);
    expect(collections.clinicalObservations.docs[0].observationCoding).toMatchObject({ code: '718-7' });
    expect(collections.clinicalObservations.docs[0].observationCoding.display).toBeUndefined();
    expect(collections.clinicalObservations.docs[0].value ?? null).toBeNull();
    expect(collections.clinicalObservations.docs[0].unit ?? null).toBeNull();
  });

  it('#712: skips an outcome with a type but no date', async () => {
    const payload = {
      ...VALID_PAYLOAD,
      clinical: { ...VALID_PAYLOAD.clinical, clinicalOutcomes: [{ outcomeType: 'remission' }] },
    };

    const { res, collections } = await runIntake(payload);

    expect(res.status).toBe(200);
    expect(collections.clinicalOutcomes.docs).toHaveLength(0);
    expect(res.body.clinicalEntities.recorded.ClinicalOutcome).toBeUndefined();
  });

  const ALL_ENTITIES_PAYLOAD = {
    ...VALID_PAYLOAD,
    clinical: {
      ...VALID_PAYLOAD.clinical,
      allergies: [{ allergenName: 'Dipirona', allergenCode: '03730', reaction: 'Urticária' }],
      familyHistories: [{ relationship: 'mother', conditionName: 'Marfan syndrome', orphaCode: 'ORPHA:558', onset: '30 anos' }],
      procedures: [{ procedureName: 'Liver biopsy', procedureCode: 'LOCAL-001', performed: '2026-01-15', bodySite: 'Liver' }],
      observationRecords: [{ testName: 'Hemoglobina', loincCode: '718-7', value: '13.2', unit: 'g/dL', effectiveDate: '2026-01-15' }],
      clinicalOutcomes: [{ outcomeType: 'remission', outcomeDate: '2026-02-01' }],
      charlsonConditions: ['copd'],
    },
  };
  const ALL_ENTITY_COLLECTIONS = [
    'encounters', 'conditions', 'phenotypeObservations', 'medicationExposures', 'allergyIntolerances',
    'familyHistories', 'procedures', 'clinicalObservations', 'clinicalOutcomes', 'derivedScores',
  ];

  it('#782: names each list entity that failed by its reference, with the error message', async () => {
    const { res } = await runIntake(ALL_ENTITIES_PAYLOAD, {
      failCollections: ['allergyIntolerances', 'familyHistories', 'procedures', 'clinicalObservations', 'clinicalOutcomes', 'derivedScores'],
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const byEntity = Object.fromEntries(res.body.clinicalEntities.failed.map((f) => [f.entity, f]));
    expect(byEntity.AllergyIntolerance).toMatchObject({ reference: '03730', error: 'insert rejeitado (allergyIntolerances)' });
    expect(byEntity.FamilyHistory).toMatchObject({ reference: 'mother', error: 'insert rejeitado (familyHistories)' });
    expect(byEntity.Procedure).toMatchObject({ reference: 'LOCAL-001', error: 'insert rejeitado (procedures)' });
    expect(byEntity.ClinicalObservation).toMatchObject({ reference: '718-7', error: 'insert rejeitado (clinicalObservations)' });
    expect(byEntity.ClinicalOutcome).toMatchObject({ reference: 'remission', error: 'insert rejeitado (clinicalOutcomes)' });
    expect(byEntity.DerivedScore).toMatchObject({ error: 'insert rejeitado (derivedScores)' });
    expect(res.body.clinicalEntities.recorded).toMatchObject({ Encounter: 1, Condition: 1 });
  });

  it('#782: reports a failure whose error carries no message by the error itself', async () => {
    const { res } = await runIntake(ALL_ENTITIES_PAYLOAD, { failCollections: ALL_ENTITY_COLLECTIONS, failWith: new Error('') });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.clinicalEntities.recorded).toEqual({});
    expect(res.body.clinicalEntities.failed.map((f) => f.entity).sort()).toEqual([
      'AllergyIntolerance', 'ClinicalObservation', 'ClinicalOutcome', 'Condition', 'DerivedScore',
      'Encounter', 'FamilyHistory', 'MedicationExposure', 'PhenotypeObservation', 'Procedure',
    ]);
    for (const failure of res.body.clinicalEntities.failed) {
      expect(failure.error).toBe('Error');
    }
  });
});
