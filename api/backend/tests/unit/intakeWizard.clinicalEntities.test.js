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
const storageServicePath = require.resolve('../../src/services/storageService');
const rcsAssessmentServicePath = require.resolve('../../src/services/rcs-assessment.service');
const encounterServicePath = require.resolve('../../src/services/encounter.service');
const conditionServicePath = require.resolve('../../src/services/condition.service');
const phenotypeObservationServicePath = require.resolve('../../src/services/phenotype-observation.service');
const medicationExposureServicePath = require.resolve('../../src/services/medication-exposure.service');
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
  ];
  const referenceDatasetReleases = [
    { referenceDatasetReleaseId: 'release-orpha', datasetCode: 'ORPHA', releaseStatus: 'active' },
    { referenceDatasetReleaseId: 'release-hpo', datasetCode: 'HPO', releaseStatus: 'active' },
    { referenceDatasetReleaseId: 'release-omim', datasetCode: 'OMIM', releaseStatus: 'active' },
  ];
  return {
    terminologyConcepts: {
      findOne: async (filter) => terminologyConcepts.find((c) => c.systemUri === filter.systemUri && c.code === filter.code && (!filter.version || c.version === filter.version)) || null,
      find: async (filter) => ({
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
  async function runIntake(payload) {
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
      ...makeActiveCodeCollections(),
    };

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
});
