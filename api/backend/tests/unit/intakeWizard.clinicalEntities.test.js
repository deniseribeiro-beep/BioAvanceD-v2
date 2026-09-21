import { describe, it, expect, vi, afterEach } from 'vitest';
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
const consentServicePath = require.resolve('../../src/services/consent.service');
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

const allPaths = [
  notificationServicePath,
  patientIdentityServicePath,
  merkleServicePath,
  collectionResolverPath,
  auditLoggerPath,
  qualityDomainPath,
  sampleServicePath,
  consentServicePath,
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
    { systemUri: 'http://hl7.org/fhir/sid/icd-10', code: 'A00', version: '2026-01', conceptStatus: 'active', referenceDatasetReleaseId: 'release-icd10' },
  ];
  const referenceDatasetReleases = [
    { referenceDatasetReleaseId: 'release-orpha', datasetCode: 'ORPHA', releaseStatus: 'active' },
    { referenceDatasetReleaseId: 'release-hpo', datasetCode: 'HPO', releaseStatus: 'active' },
    { referenceDatasetReleaseId: 'release-omim', datasetCode: 'OMIM', releaseStatus: 'active' },
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
 * fakes, not canned stubs) is this repo's own build-loop overlay bar for a
 * backend-internal slice; the literal real-backend Playwright e2e proof is
 * tracked separately (see #693's close comment for the follow-up number).
 */
describe('intakeWizard clinical-entity recording (#693)', () => {
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
  async function runIntake(payload, {
    failCollections = [],
    failureValueByCollection = {},
    consentRecord = null,
    matchOutcome = null,
    assessmentFailure = null,
  } = {}) {
    clearCache();

    const notificationServiceModule = require(notificationServicePath);
    notificationServiceModule.buildConsentMetadata = vi.fn(() => ({ token: 'tok-1' }));
    notificationServiceModule.buildConsentLink = vi.fn(() => 'https://consent.link/tok-1');
    notificationServiceModule.sendConsentEmail = vi.fn().mockResolvedValue({ success: true, channel: 'email' });

    const patientIdentityServiceModule = require(patientIdentityServicePath);
    vi.spyOn(patientIdentityServiceModule, 'matchOrUpsertParticipant').mockResolvedValue(
      matchOutcome || {
        created: true,
        matchType: 'new',
        patient: { _id: 'patient-obj-1', participantId: '12345678' },
      }
    );

    const merkleServiceModule = require(merkleServicePath);
    merkleServiceModule.generateSampleHash = vi.fn(() => 'hash-1');

    const auditLoggerModule = require(auditLoggerPath);
    auditLoggerModule.init = vi.fn();
    auditLoggerModule.log = vi.fn().mockResolvedValue(undefined);

    const qualityDomainModule = require(qualityDomainPath);
    qualityDomainModule.resolveMethodologicalQuality = vi.fn(() => ({
      score: 80, category: 'B', label: 'Boa qualidade', forcedQuarantine: false, penaltyLog: [], reasons: [],
      matrixType: 'fluid', source: 'RCS-GOV', version: '1.0', quarantineReason: null,
    }));

    const rcsAssessmentServiceModule = require(rcsAssessmentServicePath);
    rcsAssessmentServiceModule.recordAssessment = assessmentFailure
      ? vi.fn().mockRejectedValue(assessmentFailure)
      : vi.fn().mockResolvedValue({ _id: 'assessment-1' });

    const consentServiceModule = require(consentServicePath);
    consentServiceModule.getPatientConsent = vi.fn().mockResolvedValue(consentRecord);

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
          if (Object.prototype.hasOwnProperty.call(failureValueByCollection, key)) {
            throw failureValueByCollection[key];
          }
          throw new Error(`insert rejeitado (${key})`);
        }),
      };
    }

    const collectionResolverModule = require(collectionResolverPath);
    collectionResolverModule.getCollection = vi.fn(async (_db, key) => {
      if (collections[key]) return collections[key];
      throw new Error(`unexpected key ${key}`);
    });

    const sampleServiceModule = require(sampleServicePath);
    vi.spyOn(sampleServiceModule, 'createSample').mockImplementation(async (_db, sample) => ({
      _id: 'sample-1',
      specimenId: sample.specimenId || 'spec-1',
      participantId: '12345678',
      currentStoragePlacement: {
        specimenId: sample.specimenId || 'spec-1',
        boxId: String(sample.boxId),
        positionCode: sample.positionCode,
      },
    }));

    const router = require(routePath);

    const db = {
      collection: (name) => {
        if (collections[name]) return collections[name];
        if (name === 'sensors') return { find: () => makeCursor([{ locationId: 'EQ-1', status: 'ok' }]) };
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

  describe('item 8 residual clinical branch closure', () => {
    it('covers alternate medication status/period and optional clinical display branches', async () => {
      const payload = {
        ...VALID_PAYLOAD,
        clinical: {
          ...VALID_PAYLOAD.clinical,
          diseasePhenotypes: [
            { hpoId: '', label: 'ignored' },
            { hpoId: 'HP:0000822', label: '' },
          ],
          pharmacologyData: {
            treatmentStatus: 'WASHOUT',
            medicationName: 'Metformin',
            atcCode: 'A10BA02',
            washoutStartDate: '2026-01-10',
          },
          allergies: [{ allergenName: '', allergenCode: '03730', reaction: '' }],
          familyHistories: [{ relationship: 'father', conditionName: '', orphaCode: '', onset: '' }],
          procedures: [{ procedureName: '', procedureCode: 'LOCAL-002', performed: '2026-01-15', bodySite: '' }],
          observationRecords: [{ testName: '', loincCode: '718-7', value: '', unit: '', effectiveDate: '2026-01-15' }],
        },
      };

      const { res, collections } = await runIntake(payload);

      expect(res.status).toBe(200);
      expect(collections.phenotypeObservations.docs).toHaveLength(1);
      expect(collections.phenotypeObservations.docs[0].hpoCoding.display).toBeUndefined();

      expect(collections.medicationExposures.docs).toHaveLength(1);
      expect(collections.medicationExposures.docs[0]).toMatchObject({
        medicationStatus: 'stopped',
        medicationPeriod: { start: new Date('2026-01-10T00:00:00.000Z'), end: null },
      });

      expect(collections.allergyIntolerances.docs[0]).toMatchObject({
        allergenCoding: { code: '03730' },
        reaction: [],
      });
      expect(collections.allergyIntolerances.docs[0].allergenCoding.display).toBeUndefined();

      expect(collections.familyHistories.docs[0]).toMatchObject({
        relationship: 'father',
        familyCondition: [],
      });

      expect(collections.procedures.docs[0]).toMatchObject({
        performed: '2026-01-15',
        bodySite: [],
      });
      expect(collections.procedures.docs[0].procedureCoding[0].display).toBeUndefined();

      expect(collections.clinicalObservations.docs[0]).toMatchObject({
        value: null,
        unit: null,
      });
      expect(collections.clinicalObservations.docs[0].observationCoding.display).toBeUndefined();
    });

    it('covers the medication unknown/no-period branch without inventing a treatment state', async () => {
      const payload = {
        ...VALID_PAYLOAD,
        clinical: {
          ...VALID_PAYLOAD.clinical,
          pharmacologyData: {
            treatmentStatus: 'NAIVE',
            medicationName: 'Metformin',
            atcCode: 'A10BA02',
          },
        },
      };

      const { res, collections } = await runIntake(payload);

      expect(res.status).toBe(200);
      expect(collections.medicationExposures.docs).toHaveLength(1);
      expect(collections.medicationExposures.docs[0]).toMatchObject({
        medicationStatus: 'unknown',
        medicationPeriod: null,
      });
    });

    it('reports failures for each additive clinical entity branch that previously had no executed catch path', async () => {
      const payload = {
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

      const { res } = await runIntake(payload, {
        failCollections: [
          'allergyIntolerances',
          'familyHistories',
          'procedures',
          'clinicalObservations',
          'clinicalOutcomes',
          'derivedScores',
        ],
      });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.clinicalEntities.failed.map((entry) => entry.entity)).toEqual(
        expect.arrayContaining([
          'AllergyIntolerance',
          'FamilyHistory',
          'Procedure',
          'ClinicalObservation',
          'ClinicalOutcome',
          'DerivedScore',
        ])
      );
      expect(res.body.clinicalEntities.failed).toHaveLength(6);
    });
  });


  describe('item 8 legitimate intake clinical alternates', () => {
    it('records every supported diagnosis coding and the conditionName-only family-history form', async () => {
      const payload = {
        ...VALID_PAYLOAD,
        diagnosis: {
          orphaCode: 'ORPHA:558',
          omimCode: 'OMIM:154700',
          icdCode: 'A00',
        },
        clinical: {
          ...VALID_PAYLOAD.clinical,
          familyHistories: [{
            relationship: 'sibling',
            conditionName: 'Synthetic family condition',
            orphaCode: '',
            onset: '',
          }],
        },
      };

      const { res, collections } = await runIntake(payload);

      expect(res.status).toBe(200);
      expect(collections.conditions.docs[0].conditionCoding).toEqual(expect.arrayContaining([
        expect.objectContaining({ systemUri: ORPHA_SYSTEM_URI, code: 'ORPHA:558' }),
        expect.objectContaining({ systemUri: OMIM_SYSTEM_URI, code: '154700' }),
        expect.objectContaining({ systemUri: 'http://hl7.org/fhir/sid/icd-10', code: 'A00' }),
      ]));
      expect(collections.familyHistories.docs[0]).toMatchObject({
        relationship: 'sibling',
        familyCondition: [{
          condition: { display: 'Synthetic family condition' },
        }],
      });
      expect(collections.familyHistories.docs[0].familyCondition[0].onset).toBeUndefined();
    });

    it('covers end-only washout periods and the complementary required-field skip guards', async () => {
      const payload = {
        ...VALID_PAYLOAD,
        clinical: {
          ...VALID_PAYLOAD.clinical,
          pharmacologyData: {
            treatmentStatus: 'WASHOUT',
            medicationName: 'Metformin',
            atcCode: 'A10BA02',
            washoutEndDate: '2026-01-20',
          },
          procedures: [{
            procedureName: 'Missing performed',
            procedureCode: 'LOCAL-003',
            performed: '',
          }],
          observationRecords: [{
            testName: 'No effective date',
            loincCode: '718-7',
            value: '12',
            unit: 'g/dL',
            effectiveDate: '',
          }],
          clinicalOutcomes: [{
            outcomeType: 'stable',
            outcomeDate: '',
          }],
        },
      };

      const { res, collections } = await runIntake(payload);

      expect(res.status).toBe(200);
      expect(collections.medicationExposures.docs[0].medicationPeriod).toEqual({
        start: null,
        end: new Date('2026-01-20T00:00:00.000Z'),
      });
      expect(collections.procedures.docs).toHaveLength(0);
      expect(collections.clinicalObservations.docs).toHaveLength(0);
      expect(collections.clinicalOutcomes.docs).toHaveLength(0);
    });

    it('keeps best-effort reporting stable when every clinical integration rejects with a non-Error value', async () => {
      const payload = {
        ...VALID_PAYLOAD,
        diagnosis: {
          orphaCode: 'ORPHA:558',
          omimCode: 'OMIM:154700',
          icdCode: 'A00',
        },
        clinical: {
          ...VALID_PAYLOAD.clinical,
          allergies: [{ allergenName: 'Dipirona', allergenCode: '03730', reaction: 'Urticária' }],
          familyHistories: [{
            relationship: 'sibling',
            conditionName: 'Synthetic family condition',
            orphaCode: '',
            onset: '',
          }],
          procedures: [{
            procedureName: 'Liver biopsy',
            procedureCode: 'LOCAL-001',
            performed: '2026-01-15',
            bodySite: 'Liver',
          }],
          observationRecords: [{
            testName: 'Hemoglobina',
            loincCode: '718-7',
            value: '13.2',
            unit: 'g/dL',
            effectiveDate: '2026-01-15',
          }],
          clinicalOutcomes: [{
            outcomeType: 'remission',
            outcomeDate: '2026-02-01',
          }],
          charlsonConditions: ['copd'],
        },
      };

      const failCollections = [
        'encounters',
        'conditions',
        'phenotypeObservations',
        'medicationExposures',
        'allergyIntolerances',
        'familyHistories',
        'procedures',
        'clinicalObservations',
        'clinicalOutcomes',
        'derivedScores',
      ];
      const failureValueByCollection = Object.fromEntries(
        failCollections.map((key) => [key, `non-error failure: ${key}`])
      );

      const { res } = await runIntake(payload, {
        failCollections,
        failureValueByCollection,
      });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.clinicalEntities.recorded).toEqual({});
      expect(res.body.clinicalEntities.failed).toHaveLength(10);

      for (const entry of res.body.clinicalEntities.failed) {
        expect(entry.error).toMatch(/^non-error failure: /);
      }

      expect(res.body.clinicalEntities.failed.map((entry) => entry.entity).sort()).toEqual([
        'AllergyIntolerance',
        'ClinicalObservation',
        'ClinicalOutcome',
        'Condition',
        'DerivedScore',
        'Encounter',
        'FamilyHistory',
        'MedicationExposure',
        'PhenotypeObservation',
        'Procedure',
      ]);
    });
  });


  describe('item 8 governance and response alternates', () => {
    it('releases the specimen when consent is ACTIVE and returns a consent identifier from _id fallback', async () => {
      const { res } = await runIntake(VALID_PAYLOAD, {
        consentRecord: { _id: 'consent-object-id', status: 'ACTIVE' },
        matchOutcome: {
          created: false,
          matchType: 'participantId',
          patient: { _id: 'patient-obj-1', participantId: '12345678' },
        },
      });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.patientMatch).toMatchObject({
        matched: true,
        created: false,
        matchType: 'participantId',
      });
      expect(res.body.consent).toMatchObject({
        active: true,
        status: 'SIGNED',
        consentId: 'consent-object-id',
        patientId: '12345678',
        reason: null,
      });
    });

    it('keeps the specimen quarantined when consent is REVOKED and surfaces the governed reason', async () => {
      const { res } = await runIntake(VALID_PAYLOAD, {
        consentRecord: { consentId: 'CONSENT-REVOKED', status: 'REVOKED' },
      });

      expect(res.status).toBe(200);
      expect(res.body.consent).toMatchObject({
        active: false,
        status: 'REVOKED',
        consentId: 'CONSENT-REVOKED',
        reason: 'Consentimento revogado.',
      });
      // This suite mounts the raw intake router to exercise clinical-entity
      // recording. Persisted specimenStatus is enforced by the interface
      // governance wrapper and is covered by intakeWizard governance suites.
      expect(res.body.message).toContain('permanece bloqueada');
    });

    it('keeps intake successful when the referenced RCS assessment snapshot fails best-effort', async () => {
      const { res } = await runIntake(VALID_PAYLOAD, {
        assessmentFailure: new Error('assessment unavailable'),
      });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.sample).toBeDefined();
    });

    it('rejects non-canonical top-level section shapes before touching persistence', async () => {
      clearCache();
      const router = require(routePath);
      const app = buildApp(router, { collection: vi.fn() });

      const participantArray = await request(app)
        .post('/api/intake-wizard')
        .send({ ...VALID_PAYLOAD, participant: [] });
      expect(participantArray.status).toBe(422);
      expect(participantArray.body).toMatchObject({
        error: 'NON_CANONICAL_FIELD',
        fields: expect.arrayContaining(['participant']),
      });

      const specimenWithoutParticipant = await request(app)
        .post('/api/intake-wizard')
        .send({ ...VALID_PAYLOAD, specimen: { sampleType: 'PLASMA' } });
      expect(specimenWithoutParticipant.status).toBe(422);
      expect(specimenWithoutParticipant.body.fields).toEqual(expect.arrayContaining(['specimen']));
    });

    it('rejects canonical-v1 aliases at the intake boundary', async () => {
      clearCache();
      const router = require(routePath);
      const app = buildApp(router, { collection: vi.fn() });
      const payload = {
        ...VALID_PAYLOAD,
        participant: { ...VALID_PAYLOAD.participant, patientID: '87654321' },
        specimen: {
          ...VALID_PAYLOAD.specimen,
          sampleID: 'legacy',
          registrationDate: '2026-01-01',
          lifecycleStatus: 'AVAILABLE',
        },
      };

      const res = await request(app).post('/api/intake-wizard').send(payload);

      expect(res.status).toBe(422);
      expect(res.body.error).toBe('NON_CANONICAL_FIELD');
      expect(res.body.fields).toEqual(expect.arrayContaining([
        'patientID',
        'sampleID',
        'registrationDate',
        'lifecycleStatus',
      ]));
    });

    it('fails closed with 503 when the intake database is unavailable', async () => {
      clearCache();
      const router = require(routePath);
      const app = buildApp(router, null);

      const res = await request(app).post('/api/intake-wizard').send(VALID_PAYLOAD);

      expect(res.status).toBe(503);
      expect(res.body.success).toBe(false);
    });
  });

});