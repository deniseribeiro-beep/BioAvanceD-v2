import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRequire } from 'module';
import express from 'express';
import request from 'supertest';

const require = createRequire(import.meta.url);
const { createFakeDb } = require('./foundation/helpers/fake-db');

const notificationServicePath = require.resolve('../../src/services/notification.service');
const patientIdentityServicePath = require.resolve('../../src/services/PatientIdentityService');
const merkleServicePath = require.resolve('../../src/services/MerkleService');
const collectionResolverPath = require.resolve('../../src/utils/collectionResolver');
const auditLoggerPath = require.resolve('../../src/utils/auditLogger');
const qualityDomainPath = require.resolve('../../src/services/quality-domain.service');
const sampleServicePath = require.resolve('../../src/services/sample.service');
const storageServicePath = require.resolve('../../src/services/storageService');
const rcsAssessmentServicePath = require.resolve('../../src/services/rcs-assessment.service');
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
  routePath,
];

function makeCursor(rows) {
  const cursor = {
    sort: () => cursor,
    limit: () => cursor,
    toArray: async () => rows,
  };
  return cursor;
}

function clearCache() {
  for (const p of allPaths) delete require.cache[p];
}

// #1394: the first require of these modules' trees costs seconds under load
// (the route's services, and notification.service's, which the route does
// not reach), so it is paid here, at import time, as #1389 did, rather than
// inside the first case's timeout. clearCache() drops only allPaths, so each
// loadRoute() re-requires just those ten.
for (const p of allPaths) require(p);
clearCache();

function loadRoute({
  buildConsentMetadata,
  buildConsentLink,
  sendConsentEmail,
  matchOrUpsertParticipant,
  generateSampleHash,
  getCollectionImpl,
  resolveMethodologicalQuality,
} = {}) {
  clearCache();

  const notificationServiceModule = require(notificationServicePath);
  notificationServiceModule.buildConsentMetadata = buildConsentMetadata || vi.fn(() => ({ token: 'tok-1' }));
  notificationServiceModule.buildConsentLink = buildConsentLink || vi.fn(() => 'https://consent.link/tok-1');
  notificationServiceModule.sendConsentEmail = sendConsentEmail || vi.fn().mockResolvedValue({ success: true, channel: 'email' });

  const patientIdentityServiceModule = require(patientIdentityServicePath);
  vi.spyOn(patientIdentityServiceModule, 'matchOrUpsertParticipant').mockImplementation(
    matchOrUpsertParticipant || vi.fn().mockResolvedValue({
      created: true,
      matchType: 'new',
      patient: { _id: 'patient-obj-1', participantId: '12345678' },
    })
  );

  const merkleServiceModule = require(merkleServicePath);
  merkleServiceModule.generateSampleHash = generateSampleHash || vi.fn(() => 'hash-1');

  const collectionResolverModule = require(collectionResolverPath);
  collectionResolverModule.getCollection = getCollectionImpl || vi.fn();

  const auditLoggerModule = require(auditLoggerPath);
  auditLoggerModule.init = vi.fn();
  auditLoggerModule.log = vi.fn().mockResolvedValue(undefined);

  const qualityDomainModule = require(qualityDomainPath);
  qualityDomainModule.resolveMethodologicalQuality = resolveMethodologicalQuality || vi.fn(() => ({
    score: 80,
    category: 'B',
    label: 'Boa qualidade',
    forcedQuarantine: false,
    penaltyLog: [],
    reasons: [],
    matrixType: 'fluid',
    source: 'RCS-GOV',
    version: '1.0',
    quarantineReason: null,
  }));

  const rcsAssessmentServiceModule = require(rcsAssessmentServicePath);
  rcsAssessmentServiceModule.recordAssessment = vi.fn().mockResolvedValue({ _id: 'assessment-1' });

  const router = require(routePath);
  return { router, notificationServiceModule, patientIdentityServiceModule, merkleServiceModule, collectionResolverModule, auditLoggerModule, qualityDomainModule, rcsAssessmentServiceModule };
}

function buildApp(router, db = {}) {
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
  specimen: { specimenId: 'spec-1', participantId: '12345678', sampleType: 'Sangue', sampleOrigin: 'Hospital A', extractionProtocol: 'EDTA', quantity: 2 },
  diagnosis: { orphaCode: 'ORPHA:123' },
  clinical: {},
  biomarkers: [],
};

describe('intakeWizard routes', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    clearCache();
  });

  describe('POST / (handleIntakeWizard)', () => {
    it('returns 400 when the body is missing/invalid', async () => {
      const { router } = loadRoute();
      const app = buildApp(router, {});

      const res = await request(app).post('/api/intake-wizard').send();

      expect(res.status).toBe(400);
    });

    it('returns 503 when db is unavailable', async () => {
      const { router } = loadRoute();
      const app = buildApp(router, null);

      const res = await request(app).post('/api/intake-wizard').send(VALID_PAYLOAD);

      expect(res.status).toBe(503);
    });

    it('happy path: persists the sample, links the patient, and returns 200', async () => {
      const insertOne = vi.fn().mockResolvedValue({ insertedId: 'sample-1' });
      const findOne = vi.fn().mockResolvedValue({ _id: 'sample-1', participantId: '12345678' });
      const samplesCollection = { insertOne, findOne, updateOne: vi.fn().mockResolvedValue({ matchedCount: 1 }) };
      const updateOne = vi.fn().mockResolvedValue({ matchedCount: 1 });
      const patientsCollection = { updateOne };
      const consentsCollection = { findOne: vi.fn().mockResolvedValue(null) };

      const getCollectionImpl = vi.fn(async (_db, key) => {
        if (key === 'samples') return samplesCollection;
        if (key === 'patients') return patientsCollection;
        if (key === 'consents') return consentsCollection;
        throw new Error(`unexpected key ${key}`);
      });

      const db = {
        collection: (name) => {
          if (name === 'sensors') return { find: () => makeCursor([{ sensorId: 'SEN-1', sensorType: 'temperature', locationId: 'EQ-1', maintenanceStatus: 'operational' }]) };
          if (name === 'equipment') return { findOne: vi.fn().mockResolvedValue({ equipmentID: 'EQ-1', status: 'active' }) };
          if (name === 'storageBoxes') {
            return {
              find: () => makeCursor([{
                _id: 'box-1',
                name: 'Box A',
                status: 'ACTIVE',
                dimension: { rows: 1, cols: 1 },
                currentOccupancy: 0,
                occupancyGrid: {},
                parent_id: 'rack-1',
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

      const { router, auditLoggerModule } = loadRoute({ getCollectionImpl });

      const sampleServiceModule = require(sampleServicePath);
      vi.spyOn(sampleServiceModule, 'createSample').mockResolvedValue({ _id: 'sample-1', participantId: '12345678' });

      const StorageService = require(storageServicePath);
      vi.spyOn(StorageService.prototype, 'autoAssignSampleToBox').mockResolvedValue({
        success: true,
        sampleLocation: { boxId: 'box-1', position: 'A1' },
      });

      const app = buildApp(router, db);

      const res = await request(app).post('/api/intake-wizard').send(VALID_PAYLOAD);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.patientMatch.patientID).toBe('12345678');
      expect(res.body.qualityAssessment.score).toBe(80);
      expect(sampleServiceModule.createSample).toHaveBeenCalledTimes(1);
      // #569: the sample document must never carry a denormalized civil-identity
      // name -- it's unprotected plaintext PII with no gate, no audit trail, and
      // no relationship to the reidentifyParticipant-gated flow (#560).
      const persistedSample = sampleServiceModule.createSample.mock.calls[0][1];
      expect(persistedSample).not.toHaveProperty('participantName');
      expect(updateOne).toHaveBeenCalledWith(
        { _id: 'patient-obj-1' },
        expect.objectContaining({
          $set: expect.objectContaining({ lastClinicalData: expect.objectContaining({ orphaCode: 'ORPHA:123' }) }),
          $addToSet: { linkedSampleIds: 'sample-1' },
        })
      );
      expect(auditLoggerModule.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'PATIENT_MATCH_UPSERT' })
      );
    });

    // #1371: a derivative names its parents as specimen.parentSpecimenIds
    // (dict-02 ELM-0120), and the wizard hands them to createSample, which
    // validates them and registers the lineage.
    describe('parentSpecimenIds (#1371)', () => {
      function parentsFixture() {
        const samplesCollection = {
          insertOne: vi.fn().mockResolvedValue({ insertedId: 'sample-1' }),
          findOne: vi.fn().mockResolvedValue({ _id: 'sample-1', participantId: '12345678' }),
          updateOne: vi.fn().mockResolvedValue({ matchedCount: 1 }),
        };
        const getCollectionImpl = vi.fn(async (_db, key) => {
          if (key === 'samples') return samplesCollection;
          if (key === 'patients') return { updateOne: vi.fn().mockResolvedValue({ matchedCount: 1 }) };
          if (key === 'consents') return { findOne: vi.fn().mockResolvedValue(null) };
          throw new Error(`unexpected key ${key}`);
        });
        const db = {
          collection: (name) => {
            if (name === 'sensors') return { find: () => makeCursor([{ sensorId: 'SEN-1', sensorType: 'temperature', locationId: 'EQ-1', maintenanceStatus: 'operational' }]) };
            if (name === 'equipment') return { findOne: vi.fn().mockResolvedValue({ equipmentID: 'EQ-1', status: 'active' }) };
            if (name === 'storageBoxes') {
              return {
                find: () => makeCursor([{
                  _id: 'box-1',
                  name: 'Box A',
                  status: 'ACTIVE',
                  dimension: { rows: 1, cols: 1 },
                  currentOccupancy: 0,
                  occupancyGrid: {},
                  parent_id: 'rack-1',
                }]),
              };
            }
            if (name === 'storageContainers') return { findOne: vi.fn(async (query) => defaultStorageContainersFindOne(query)) };
            throw new Error(`unexpected collection ${name}`);
          },
        };

        const { router } = loadRoute({ getCollectionImpl });
        const sampleServiceModule = require(sampleServicePath);
        vi.spyOn(sampleServiceModule, 'createSample').mockResolvedValue({ _id: 'sample-1', participantId: '12345678' });
        const StorageService = require(storageServicePath);
        vi.spyOn(StorageService.prototype, 'autoAssignSampleToBox').mockResolvedValue({
          success: true,
          sampleLocation: { boxId: 'box-1', position: 'A1' },
        });

        return { app: buildApp(router, db), sampleServiceModule };
      }

      it('hands the named parents to createSample and answers 200', async () => {
        const { app, sampleServiceModule } = parentsFixture();

        const res = await request(app).post('/api/intake-wizard').send({
          ...VALID_PAYLOAD,
          specimen: { ...VALID_PAYLOAD.specimen, parentSpecimenIds: ['SPC-PARENT'] },
        });

        expect(res.status).toBe(200);
        expect(sampleServiceModule.createSample).toHaveBeenCalledTimes(1);
        expect(sampleServiceModule.createSample.mock.calls[0][1].parentSpecimenIds).toEqual(['SPC-PARENT']);
      });

      it('returns 422 NON_CANONICAL_FIELD for a single string instead of a list, and creates nothing', async () => {
        const { app, sampleServiceModule } = parentsFixture();

        const res = await request(app).post('/api/intake-wizard').send({
          ...VALID_PAYLOAD,
          specimen: { ...VALID_PAYLOAD.specimen, parentSpecimenIds: 'SPC-PARENT' },
        });

        expect(res.status).toBe(422);
        expect(res.body.error).toBe('NON_CANONICAL_FIELD');
        expect(res.body.fields).toContain('specimen.parentSpecimenIds');
        expect(sampleServiceModule.createSample).not.toHaveBeenCalled();
      });
    });

    // #1355: the intake stamps the caller's organization on the sample and on
    // a participant it creates, resolved before anything is written.
    describe('organization scope (#1355)', () => {
      function scopedApp(router, db, organizationScope) {
        const app = express();
        app.use(express.json());
        app.locals.db = db;
        app.use((req, _res, next) => { req.organizationScope = organizationScope; next(); });
        app.use('/api/intake-wizard', router);
        return app;
      }

      function placementDb() {
        return {
          collection: (name) => {
            if (name === 'sensors') return { find: () => makeCursor([{ sensorId: 'SEN-1', sensorType: 'temperature', locationId: 'EQ-1', maintenanceStatus: 'operational' }]) };
            if (name === 'equipment') return { findOne: vi.fn().mockResolvedValue({ equipmentID: 'EQ-1', status: 'active' }) };
            if (name === 'storageBoxes') return { find: () => makeCursor([{ _id: 'box-1', name: 'Box A', status: 'ACTIVE', dimension: { rows: 1, cols: 1 }, currentOccupancy: 0, occupancyGrid: {}, parent_id: 'rack-1' }]) };
            if (name === 'storageContainers') {
              return {
                findOne: vi.fn(async ({ _id }) => ({
                  'rack-1': { _id: 'rack-1', containerType: 'RACK', parent_id: 'shelf-1' },
                  'shelf-1': { _id: 'shelf-1', containerType: 'SHELF', parent_id: 'freezer-1' },
                  'freezer-1': { _id: 'freezer-1', containerType: 'FREEZER', containerID: 'EQ-1' },
                })[_id] || null),
              };
            }
            throw new Error(`unexpected collection ${name}`);
          },
        };
      }

      it("stamps a single-organization caller's organization as collectionSite and on the participant match", async () => {
        const patients = { updateOne: vi.fn().mockResolvedValue({ matchedCount: 1 }) };
        const getCollectionImpl = vi.fn(async (_db, key) => ({
          samples: { findOne: vi.fn().mockResolvedValue({ _id: 'sample-1', participantId: '12345678' }), updateOne: vi.fn().mockResolvedValue({ matchedCount: 1 }) },
          patients,
          consents: { findOne: vi.fn().mockResolvedValue(null) },
        })[key]);
        const { router, patientIdentityServiceModule } = loadRoute({ getCollectionImpl });
        const sampleServiceModule = require(sampleServicePath);
        vi.spyOn(sampleServiceModule, 'createSample').mockResolvedValue({ _id: 'sample-1', participantId: '12345678' });
        const scope = { scope: 'organization', organizationIds: ['org-a'] };

        const res = await request(scopedApp(router, placementDb(), scope)).post('/api/intake-wizard').send(VALID_PAYLOAD);

        expect(res.status).toBe(200);
        expect(sampleServiceModule.createSample.mock.calls[0][1].collectionSite).toBe('org-a');
        expect(sampleServiceModule.createSample.mock.calls[0][2].organizationId).toBe('org-a');
        const [, payload, options] = patientIdentityServiceModule.matchOrUpsertParticipant.mock.calls[0];
        expect(payload.clinicalUnitId).toBe('org-a');
        expect(options).toEqual({ organizationScope: scope });
        // The participant is in the caller's scope, so it is updated.
        expect(patients.updateOne).toHaveBeenCalledTimes(1);
      });

      it("links the sample to a participant matched outside the caller's scope but writes nothing on that participant (#1356)", async () => {
        const patients = { updateOne: vi.fn().mockResolvedValue({ matchedCount: 1 }) };
        const getCollectionImpl = vi.fn(async (_db, key) => ({
          samples: { findOne: vi.fn().mockResolvedValue({ _id: 'sample-1', participantId: '12345678' }), updateOne: vi.fn().mockResolvedValue({ matchedCount: 1 }) },
          patients,
          consents: { findOne: vi.fn().mockResolvedValue(null) },
        })[key]);
        const { router } = loadRoute({
          getCollectionImpl,
          matchOrUpsertParticipant: vi.fn().mockResolvedValue({
            created: false,
            matchType: 'participantId',
            outOfScope: true,
            patient: { _id: 'patient-b', participantId: '12345678' },
          }),
        });
        const sampleServiceModule = require(sampleServicePath);
        vi.spyOn(sampleServiceModule, 'createSample').mockResolvedValue({ _id: 'sample-1', participantId: '12345678' });
        const scope = { scope: 'organization', organizationIds: ['org-a'] };

        const res = await request(scopedApp(router, placementDb(), scope)).post('/api/intake-wizard').send(VALID_PAYLOAD);

        expect(res.status).toBe(200);
        expect(sampleServiceModule.createSample).toHaveBeenCalledTimes(1);
        expect(sampleServiceModule.createSample.mock.calls[0][1].participantId).toBe('12345678');
        expect(patients.updateOne).not.toHaveBeenCalled();
      });

      it('refuses a multi-organization caller who names no organizationId, writing nothing', async () => {
        const { router, patientIdentityServiceModule } = loadRoute();
        const sampleServiceModule = require(sampleServicePath);
        vi.spyOn(sampleServiceModule, 'createSample');

        const res = await request(scopedApp(router, placementDb(), { scope: 'organization', organizationIds: ['org-a', 'org-b'] }))
          .post('/api/intake-wizard').send(VALID_PAYLOAD);

        expect(res.status).toBe(400);
        expect(patientIdentityServiceModule.matchOrUpsertParticipant).not.toHaveBeenCalled();
        expect(sampleServiceModule.createSample).not.toHaveBeenCalled();
      });

      // #1376: the organization is named in the intake's top-level
      // organizationId only; specimen.collectionSite (ELM-0128) is data.
      async function postMultiOrganization(payload) {
        const getCollectionImpl = vi.fn(async (_db, key) => ({
          samples: { findOne: vi.fn().mockResolvedValue({ _id: 'sample-1', participantId: '12345678' }), updateOne: vi.fn().mockResolvedValue({ matchedCount: 1 }) },
          patients: { updateOne: vi.fn().mockResolvedValue({ matchedCount: 1 }) },
          consents: { findOne: vi.fn().mockResolvedValue(null) },
        })[key]);
        const { router } = loadRoute({ getCollectionImpl });
        const sampleServiceModule = require(sampleServicePath);
        vi.spyOn(sampleServiceModule, 'createSample').mockResolvedValue({ _id: 'sample-1', participantId: '12345678' });
        const res = await request(scopedApp(router, placementDb(), { scope: 'organization', organizationIds: ['org-a', 'org-b'] }))
          .post('/api/intake-wizard').send(payload);
        return { res, createSample: sampleServiceModule.createSample };
      }

      it('takes a top-level organizationId as the pick (#1376)', async () => {
        const { res, createSample } = await postMultiOrganization({ ...VALID_PAYLOAD, organizationId: 'org-b' });

        expect(res.status).toBe(200);
        expect(createSample.mock.calls[0][2].organizationId).toBe('org-b');
        expect(createSample.mock.calls[0][1].collectionSite).toBe('org-b');
      });

      it('refuses a multi-organization caller who names only specimen.collectionSite, as one naming nothing (#1376)', async () => {
        const { res, createSample } = await postMultiOrganization({ ...VALID_PAYLOAD, specimen: { ...VALID_PAYLOAD.specimen, collectionSite: 'org-b' } });

        expect(res.status).toBe(400);
        expect(createSample).not.toHaveBeenCalled();
      });

      it('lets organizationId win over specimen.collectionSite and keeps the site (#1376)', async () => {
        const { res, createSample } = await postMultiOrganization({
          ...VALID_PAYLOAD,
          organizationId: 'org-a',
          specimen: { ...VALID_PAYLOAD.specimen, collectionSite: 'partner-x' },
        });

        expect(res.status).toBe(200);
        expect(createSample.mock.calls[0][2].organizationId).toBe('org-a');
        expect(createSample.mock.calls[0][1].collectionSite).toBe('partner-x');
        expect(createSample.mock.calls[0][1]).not.toHaveProperty('organizationId');
      });
    });

    // #1332: the consent decision names one consent; with several, it must
    // be the newest. The consents sit out of order in a store that sorts.
    async function postIntakeWithConsents(consentRows) {
      const consents = createFakeDb().collection('consents');
      consentRows.forEach((row) => consents.docs.push(row));
      const samplesCollection = {
        insertOne: vi.fn().mockResolvedValue({ insertedId: 'sample-1' }),
        findOne: vi.fn().mockResolvedValue({ _id: 'sample-1', participantId: '12345678' }),
        updateOne: vi.fn().mockResolvedValue({ matchedCount: 1 }),
      };
      const getCollectionImpl = vi.fn(async (_db, key) => {
        if (key === 'samples') return samplesCollection;
        if (key === 'patients') return { updateOne: vi.fn().mockResolvedValue({ matchedCount: 1 }) };
        if (key === 'consents') return consents;
        throw new Error(`unexpected key ${key}`);
      });
      const db = {
        collection: (name) => {
          if (name === 'sensors') return { find: () => makeCursor([{ sensorId: 'SEN-1', sensorType: 'temperature', locationId: 'EQ-1', maintenanceStatus: 'operational' }]) };
          if (name === 'equipment') return { findOne: vi.fn().mockResolvedValue({ equipmentID: 'EQ-1', status: 'active' }) };
          if (name === 'storageBoxes') {
            return { find: () => makeCursor([{ _id: 'box-1', name: 'Box A', status: 'ACTIVE', dimension: { rows: 1, cols: 1 }, currentOccupancy: 0, occupancyGrid: {}, parent_id: 'rack-1' }]) };
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
      const { router } = loadRoute({ getCollectionImpl });
      vi.spyOn(require(sampleServicePath), 'createSample').mockResolvedValue({ _id: 'sample-1', participantId: '12345678' });
      vi.spyOn(require(storageServicePath).prototype, 'autoAssignSampleToBox').mockResolvedValue({
        success: true,
        sampleLocation: { boxId: 'box-1', position: 'A1' },
      });
      return request(buildApp(router, db)).post('/api/intake-wizard').send(VALID_PAYLOAD);
    }

    it('names the newest active consent of the participant (#1332)', async () => {
      const res = await postIntakeWithConsents([
        { _id: 'c-mid', participantId: '12345678', status: 'ACTIVE', signedAt: new Date('2026-01-02') },
        { _id: 'c-new', participantId: '12345678', status: 'ACTIVE', signedAt: new Date('2026-01-03') },
        { _id: 'c-old', participantId: '12345678', status: 'ACTIVE', signedAt: new Date('2026-01-01') },
      ]);

      expect(res.status).toBe(200);
      expect(res.body.consent).toEqual(expect.objectContaining({ active: true, consentId: 'c-new' }));
    });

    it('names the newest revoked consent when none is active (#1332)', async () => {
      const res = await postIntakeWithConsents([
        { _id: 'r-mid', participantId: '12345678', status: 'REVOKED', revokedAt: new Date('2026-01-02') },
        { _id: 'r-new', participantId: '12345678', status: 'REVOKED', revokedAt: new Date('2026-01-03') },
        { _id: 'r-old', participantId: '12345678', status: 'REVOKED', revokedAt: new Date('2026-01-01') },
      ]);

      expect(res.status).toBe(200);
      expect(res.body.consent).toEqual(expect.objectContaining({ active: false, status: 'REVOKED', consentId: 'r-new' }));
    });

    // #511: sample.service.js#createSample (#510) additively exposes the
    // canonical StorageAssignment on its return value alongside the legacy
    // storageLocation field. intakeWizard's own response builder (lines
    // ~579-609) must forward it the same way, not just the legacy shape it
    // reconstructs from local box/position variables.
    it('exposes the canonical storageAssignment on the response, per #510 (#511)', async () => {
      const insertOne = vi.fn().mockResolvedValue({ insertedId: 'sample-1' });
      const findOne = vi.fn().mockResolvedValue({ _id: 'sample-1', participantId: '12345678' });
      const samplesCollection = { insertOne, findOne, updateOne: vi.fn().mockResolvedValue({ matchedCount: 1 }) };
      const updateOne = vi.fn().mockResolvedValue({ matchedCount: 1 });
      const patientsCollection = { updateOne };
      const consentsCollection = { findOne: vi.fn().mockResolvedValue(null) };

      const getCollectionImpl = vi.fn(async (_db, key) => {
        if (key === 'samples') return samplesCollection;
        if (key === 'patients') return patientsCollection;
        if (key === 'consents') return consentsCollection;
        throw new Error(`unexpected key ${key}`);
      });

      const db = {
        collection: (name) => {
          if (name === 'sensors') return { find: () => makeCursor([{ sensorId: 'SEN-1', sensorType: 'temperature', locationId: 'EQ-1', maintenanceStatus: 'operational' }]) };
          if (name === 'equipment') return { findOne: vi.fn().mockResolvedValue({ equipmentID: 'EQ-1', status: 'active' }) };
          if (name === 'storageBoxes') {
            return {
              find: () => makeCursor([{
                _id: 'box-1',
                name: 'Box A',
                status: 'ACTIVE',
                dimension: { rows: 1, cols: 1 },
                currentOccupancy: 0,
                occupancyGrid: {},
                parent_id: 'rack-1',
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

      const { router } = loadRoute({ getCollectionImpl });

      const sampleServiceModule = require(sampleServicePath);
      const canonicalStorageAssignment = {
        _id: 'assignment-1',
        sampleId: 'sample-1',
        boxId: 'box-1',
        position: 'A1',
        status: 'ACTIVE',
      };
      vi.spyOn(sampleServiceModule, 'createSample').mockResolvedValue({
        _id: 'sample-1',
        participantId: '12345678',
        storageAssignment: canonicalStorageAssignment,
      });

      const StorageService = require(storageServicePath);
      vi.spyOn(StorageService.prototype, 'autoAssignSampleToBox').mockResolvedValue({
        success: true,
        sampleLocation: { boxId: 'box-1', position: 'A1' },
      });

      const app = buildApp(router, db);

      const res = await request(app).post('/api/intake-wizard').send(VALID_PAYLOAD);

      expect(res.status).toBe(200);
      expect(res.body.storageAssignment).toEqual(canonicalStorageAssignment);
      expect(res.body.storageLocation).toBeTruthy();
    });

    // #505: intakeWizard already computed RCS via qualidade but never
    // recorded a queryable RcsAssessment snapshot — mirrors #492's pattern
    // in sample.service.js#createSample.
    describe('RCS assessment recording (#505)', () => {
      it('records an RcsAssessment and pins sealedRcsAssessmentId after a successful create', async () => {
        const insertOne = vi.fn().mockResolvedValue({ insertedId: 'sample-1' });
        const findOne = vi.fn().mockResolvedValue({ _id: 'sample-1', specimenId: 'spec-1', participantId: '12345678' });
        const updateOne = vi.fn().mockResolvedValue({ matchedCount: 1 });
        const samplesCollection = { insertOne, findOne, updateOne };
        const patientsCollection = { updateOne: vi.fn().mockResolvedValue({ matchedCount: 1 }) };
        const consentsCollection = { findOne: vi.fn().mockResolvedValue(null) };

        const getCollectionImpl = vi.fn(async (_db, key) => {
          if (key === 'samples') return samplesCollection;
          if (key === 'patients') return patientsCollection;
          if (key === 'consents') return consentsCollection;
          throw new Error(`unexpected key ${key}`);
        });

        const { db } = buildHappyPathDb();

        const { router, rcsAssessmentServiceModule } = loadRoute({
          getCollectionImpl,
          resolveMethodologicalQuality: () => ({ governance_status: 1, final_grade: 'A', rcs_score: 87.5 }),
        });

        const sampleServiceModule = require(sampleServicePath);
        vi.spyOn(sampleServiceModule, 'createSample').mockResolvedValue({ _id: 'sample-1', specimenId: 'spec-1', participantId: '12345678' });

        const StorageService = require(storageServicePath);
        vi.spyOn(StorageService.prototype, 'autoAssignSampleToBox').mockResolvedValue({
          success: true,
          sampleLocation: { boxId: 'box-1', position: 'A1' },
        });

        const app = buildApp(router, db);
        const res = await request(app).post('/api/intake-wizard').send(VALID_PAYLOAD);

        expect(res.status).toBe(200);
        expect(rcsAssessmentServiceModule.recordAssessment).toHaveBeenCalledWith(
          db,
          'spec-1',
          expect.objectContaining({ final_grade: 'A', rcs_score: 87.5 })
        );
        expect(updateOne).toHaveBeenCalledWith(
          { _id: 'sample-1' },
          { $set: { sealedRcsAssessmentId: 'assessment-1' } }
        );
        expect(res.body.sample.sealedRcsAssessmentId).toBe('assessment-1');
      });

      it('does not fail the intake when recording the RcsAssessment snapshot rejects', async () => {
        const insertOne = vi.fn().mockResolvedValue({ insertedId: 'sample-1' });
        const findOne = vi.fn().mockResolvedValue({ _id: 'sample-1', specimenId: 'spec-1', participantId: '12345678' });
        const updateOne = vi.fn().mockResolvedValue({ matchedCount: 1 });
        const samplesCollection = { insertOne, findOne, updateOne };
        const patientsCollection = { updateOne: vi.fn().mockResolvedValue({ matchedCount: 1 }) };
        const consentsCollection = { findOne: vi.fn().mockResolvedValue(null) };

        const getCollectionImpl = vi.fn(async (_db, key) => {
          if (key === 'samples') return samplesCollection;
          if (key === 'patients') return patientsCollection;
          if (key === 'consents') return consentsCollection;
          throw new Error(`unexpected key ${key}`);
        });

        const { db } = buildHappyPathDb();

        const { router, rcsAssessmentServiceModule } = loadRoute({ getCollectionImpl });
        rcsAssessmentServiceModule.recordAssessment = vi.fn().mockRejectedValue(new Error('mongo down'));

        const sampleServiceModule = require(sampleServicePath);
        vi.spyOn(sampleServiceModule, 'createSample').mockResolvedValue({ _id: 'sample-1', specimenId: 'spec-1', participantId: '12345678' });

        const StorageService = require(storageServicePath);
        vi.spyOn(StorageService.prototype, 'autoAssignSampleToBox').mockResolvedValue({
          success: true,
          sampleLocation: { boxId: 'box-1', position: 'A1' },
        });

        const app = buildApp(router, db);
        const res = await request(app).post('/api/intake-wizard').send(VALID_PAYLOAD);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(updateOne).not.toHaveBeenCalledWith(
          expect.anything(),
          expect.objectContaining({ $set: expect.objectContaining({ sealedRcsAssessmentId: expect.anything() }) })
        );
      });
    });

    it('returns 500 when persisting the sample throws', async () => {
      const getCollectionImpl = vi.fn().mockRejectedValue(new Error('db down'));
      const { router } = loadRoute({ getCollectionImpl });
      const app = buildApp(router, {});

      const res = await request(app).post('/api/intake-wizard').send(VALID_PAYLOAD);

      expect(res.status).toBe(500);
    });

    it('returns 422 NON_CANONICAL_FIELD when a legacy alias field is present', async () => {
      const { router } = loadRoute();
      const app = buildApp(router, {});

      const payload = {
        ...VALID_PAYLOAD,
        participant: { ...VALID_PAYLOAD.participant, patientID: '99999999' },
      };

      const res = await request(app).post('/api/intake-wizard').send(payload);

      expect(res.status).toBe(422);
      expect(res.body.error).toBe('NON_CANONICAL_FIELD');
      expect(res.body.fields).toContain('patientID');
    });

    // #1368: dict-02 ELM-0120 is the plural parentSpecimenIds; either
    // singular name is refused by name, as POST /api/samples refuses it.
    it.each(['parentSpecimenId', 'parentSampleId'])('returns 422 NON_CANONICAL_FIELD naming the singular parent name %s', async (alias) => {
      const { router } = loadRoute();
      const app = buildApp(router, {});

      const payload = {
        ...VALID_PAYLOAD,
        specimen: { ...VALID_PAYLOAD.specimen, [alias]: 'SPC-PARENT' },
      };

      const res = await request(app).post('/api/intake-wizard').send(payload);

      expect(res.status).toBe(422);
      expect(res.body.error).toBe('NON_CANONICAL_FIELD');
      expect(res.body.fields).toEqual([alias]);
    });

    it('returns 422 NON_CANONICAL_FIELD when the payload fails canonical schema validation', async () => {
      const { router } = loadRoute();
      const app = buildApp(router, {});

      const payload = {
        ...VALID_PAYLOAD,
        specimen: { ...VALID_PAYLOAD.specimen, participantId: undefined },
      };
      delete payload.specimen.participantId;

      const res = await request(app).post('/api/intake-wizard').send(payload);

      expect(res.status).toBe(422);
      expect(res.body.error).toBe('NON_CANONICAL_FIELD');
      expect(res.body.fields).toContain('specimen');
    });

function defaultStorageContainersFindOne({ _id }) {
      if (_id === 'rack-1') return { _id: 'rack-1', containerType: 'RACK', parent_id: 'shelf-1' };
      if (_id === 'shelf-1') return { _id: 'shelf-1', containerType: 'SHELF', parent_id: 'freezer-1' };
      if (_id === 'freezer-1') return { _id: 'freezer-1', containerType: 'FREEZER', containerID: 'EQ-1' };
      return null;
    }

    function buildHappyPathDb({ sensorsFind, equipmentFindOne, storageBoxesFind, storageContainersFindOne, consentsFindOneQueue } = {}) {
      const consentsCollection = {
        findOne: consentsFindOneQueue
          ? vi.fn(() => Promise.resolve(consentsFindOneQueue.shift() ?? null))
          : vi.fn().mockResolvedValue(null),
      };

      const db = {
        collection: (name) => {
          if (name === 'sensors') return { find: sensorsFind || (() => makeCursor([{ sensorId: 'SEN-1', sensorType: 'temperature', locationId: 'EQ-1', maintenanceStatus: 'operational' }])) };
          if (name === 'equipment') return { findOne: equipmentFindOne || vi.fn().mockResolvedValue({ equipmentID: 'EQ-1', status: 'active' }) };
          if (name === 'storageBoxes') {
            return {
              find: storageBoxesFind || (() => makeCursor([{
                _id: 'box-1',
                name: 'Box A',
                status: 'ACTIVE',
                dimension: { rows: 1, cols: 1 },
                currentOccupancy: 0,
                occupancyGrid: {},
                parent_id: 'rack-1',
              }])),
            };
          }
          if (name === 'storageContainers') {
            return { findOne: storageContainersFindOne ? vi.fn(storageContainersFindOne) : vi.fn(async (query) => defaultStorageContainersFindOne(query)) };
          }
          throw new Error(`unexpected collection ${name}`);
        },
      };

      return { db, consentsCollection };
    }

    function setupHappyMocks({ getCollectionImplExtra, allocationResult, resolveMethodologicalQuality } = {}) {
      const insertOne = vi.fn().mockResolvedValue({ insertedId: 'sample-1' });
      const findOne = vi.fn().mockResolvedValue({ _id: 'sample-1', participantId: '12345678' });
      const samplesCollection = { insertOne, findOne, updateOne: vi.fn().mockResolvedValue({ matchedCount: 1 }) };
      const updateOne = vi.fn().mockResolvedValue({ matchedCount: 1 });
      const patientsCollection = { updateOne };

      return { samplesCollection, patientsCollection, updateOne };
    }

    it('releases the sample when an ACTIVE consent exists and quality allows release', async () => {
      const { db, consentsCollection } = buildHappyPathDb({
        consentsFindOneQueue: [{ _id: 'consent-1', participantId: '12345678', signedAt: new Date() }],
      });
      const { samplesCollection, patientsCollection } = setupHappyMocks();

      const getCollectionImpl = vi.fn(async (_db, key) => {
        if (key === 'samples') return samplesCollection;
        if (key === 'patients') return patientsCollection;
        if (key === 'consents') return consentsCollection;
        throw new Error(`unexpected key ${key}`);
      });

      const { router } = loadRoute({
        getCollectionImpl,
        resolveMethodologicalQuality: () => ({ governance_status: 1, final_grade: 'A', sprec: {} }),
      });

      const sampleServiceModule = require(sampleServicePath);
      vi.spyOn(sampleServiceModule, 'createSample').mockResolvedValue({ _id: 'sample-1', participantId: '12345678' });

      const StorageService = require(storageServicePath);
      vi.spyOn(StorageService.prototype, 'autoAssignSampleToBox').mockResolvedValue({
        success: true,
        sampleLocation: { boxId: 'box-1', position: 'A1' },
      });

      const app = buildApp(router, db);
      const res = await request(app).post('/api/intake-wizard').send(VALID_PAYLOAD);

      expect(res.status).toBe(200);
      expect(res.body.consent.active).toBe(true);
      expect(res.body.storageLocation.position).toBe('A1');
      expect(consentsCollection.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          participantId: { $in: expect.arrayContaining(['12345678']) },
          status: 'ACTIVE',
        }),
        expect.anything()
      );
    });

    it('blocks the sample when consent is REVOKED', async () => {
      const { db, consentsCollection } = buildHappyPathDb({
        consentsFindOneQueue: [null, { _id: 'consent-revoked', participantId: '12345678', revokedAt: new Date() }],
      });
      const { samplesCollection, patientsCollection } = setupHappyMocks();

      const getCollectionImpl = vi.fn(async (_db, key) => {
        if (key === 'samples') return samplesCollection;
        if (key === 'patients') return patientsCollection;
        if (key === 'consents') return consentsCollection;
        throw new Error(`unexpected key ${key}`);
      });

      const { router } = loadRoute({ getCollectionImpl });

      const sampleServiceModule = require(sampleServicePath);
      vi.spyOn(sampleServiceModule, 'createSample').mockResolvedValue({ _id: 'sample-1', participantId: '12345678' });

      const StorageService = require(storageServicePath);
      vi.spyOn(StorageService.prototype, 'autoAssignSampleToBox').mockResolvedValue({
        success: true,
        sampleLocation: { boxId: 'box-1', position: 'A1' },
      });

      const app = buildApp(router, db);
      const res = await request(app).post('/api/intake-wizard').send(VALID_PAYLOAD);

      expect(res.status).toBe(200);
      expect(res.body.consent.active).toBe(false);
      expect(res.body.consent.status).toBe('REVOKED');
      expect(res.body.sample).toBeDefined();
    });

    it('skips a box whose freezer sensor is not operational and uses the next one', async () => {
      const storageBoxesFind = () => makeCursor([
        { _id: 'box-1', name: 'Box A', status: 'ACTIVE', dimension: { rows: 1, cols: 1 }, currentOccupancy: 0, occupancyGrid: {}, parent_id: 'rack-1' },
        { _id: 'box-2', name: 'Box B', status: 'ACTIVE', dimension: { rows: 1, cols: 1 }, currentOccupancy: 0, occupancyGrid: {}, parent_id: 'rack-2' },
      ]);
      const storageContainersFindOne = async ({ _id }) => {
        if (_id === 'rack-1') return { _id: 'rack-1', containerType: 'RACK', parent_id: 'shelf-1' };
        if (_id === 'shelf-1') return { _id: 'shelf-1', containerType: 'SHELF', parent_id: 'freezer-1' };
        if (_id === 'freezer-1') return { _id: 'freezer-1', containerType: 'FREEZER', containerID: 'EQ-1' };
        if (_id === 'rack-2') return { _id: 'rack-2', containerType: 'RACK', parent_id: 'shelf-2' };
        if (_id === 'shelf-2') return { _id: 'shelf-2', containerType: 'SHELF', parent_id: 'freezer-2' };
        if (_id === 'freezer-2') return { _id: 'freezer-2', containerType: 'FREEZER', containerID: 'EQ-2' };
        return null;
      };
      const sensorsFind = vi.fn((query) => {
        const variants = query.$or[0].locationId.$in;
        if (variants.includes('EQ-1')) return makeCursor([{ locationId: 'EQ-1', status: 'maintenance' }]);
        return makeCursor([{ locationId: 'EQ-2', status: 'ok' }]);
      });
      const equipmentFindOne = vi.fn().mockResolvedValue({ equipmentID: 'EQ-1', status: 'active' });

      const { db, consentsCollection } = buildHappyPathDb({ sensorsFind, storageBoxesFind, storageContainersFindOne, equipmentFindOne });
      const { samplesCollection, patientsCollection } = setupHappyMocks();

      const getCollectionImpl = vi.fn(async (_db, key) => {
        if (key === 'samples') return samplesCollection;
        if (key === 'patients') return patientsCollection;
        if (key === 'consents') return consentsCollection;
        throw new Error(`unexpected key ${key}`);
      });

      const { router } = loadRoute({ getCollectionImpl });

      const sampleServiceModule = require(sampleServicePath);
      vi.spyOn(sampleServiceModule, 'createSample').mockResolvedValue({ _id: 'sample-1', participantId: '12345678' });

      const StorageService = require(storageServicePath);
      vi.spyOn(StorageService.prototype, 'autoAssignSampleToBox').mockResolvedValue({
        success: true,
        sampleLocation: { boxId: 'box-2', position: 'A1' },
      });

      const app = buildApp(router, db);
      const res = await request(app).post('/api/intake-wizard').send(VALID_PAYLOAD);

      expect(res.status).toBe(200);
      expect(res.body.storageLocation.equipmentID).toBe('EQ-2');
    });

    it('skips a box whose linked equipment is blocked and uses the next one', async () => {
      const storageBoxesFind = () => makeCursor([
        { _id: 'box-1', name: 'Box A', status: 'ACTIVE', dimension: { rows: 1, cols: 1 }, currentOccupancy: 0, occupancyGrid: {}, parent_id: 'rack-1' },
        { _id: 'box-2', name: 'Box B', status: 'ACTIVE', dimension: { rows: 1, cols: 1 }, currentOccupancy: 0, occupancyGrid: {}, parent_id: 'rack-2' },
      ]);
      const storageContainersFindOne = async ({ _id }) => {
        if (_id === 'rack-1') return { _id: 'rack-1', containerType: 'RACK', parent_id: 'shelf-1' };
        if (_id === 'shelf-1') return { _id: 'shelf-1', containerType: 'SHELF', parent_id: 'freezer-1' };
        if (_id === 'freezer-1') return { _id: 'freezer-1', containerType: 'FREEZER', containerID: 'EQ-1' };
        if (_id === 'rack-2') return { _id: 'rack-2', containerType: 'RACK', parent_id: 'shelf-2' };
        if (_id === 'shelf-2') return { _id: 'shelf-2', containerType: 'SHELF', parent_id: 'freezer-2' };
        if (_id === 'freezer-2') return { _id: 'freezer-2', containerType: 'FREEZER', containerID: 'EQ-2' };
        return null;
      };
      const equipmentFindOne = vi.fn((query) => {
        const variants = query.equipmentID.$in;
        if (variants.includes('EQ-1')) return Promise.resolve({ equipmentID: 'EQ-1', status: 'maintenance' });
        return Promise.resolve({ equipmentID: 'EQ-2', status: 'active' });
      });

      const { db, consentsCollection } = buildHappyPathDb({ equipmentFindOne, storageBoxesFind, storageContainersFindOne });
      const { samplesCollection, patientsCollection } = setupHappyMocks();

      const getCollectionImpl = vi.fn(async (_db, key) => {
        if (key === 'samples') return samplesCollection;
        if (key === 'patients') return patientsCollection;
        if (key === 'consents') return consentsCollection;
        throw new Error(`unexpected key ${key}`);
      });

      const { router } = loadRoute({ getCollectionImpl });

      const sampleServiceModule = require(sampleServicePath);
      vi.spyOn(sampleServiceModule, 'createSample').mockResolvedValue({ _id: 'sample-1', participantId: '12345678' });

      const StorageService = require(storageServicePath);
      vi.spyOn(StorageService.prototype, 'autoAssignSampleToBox').mockResolvedValue({
        success: true,
        sampleLocation: { boxId: 'box-2', position: 'A1' },
      });

      const app = buildApp(router, db);
      const res = await request(app).post('/api/intake-wizard').send(VALID_PAYLOAD);

      expect(res.status).toBe(200);
      expect(res.body.storageLocation.equipmentID).toBe('EQ-2');
    });

    it('returns 422 when no box has both operational equipment and sensor', async () => {
      const equipmentFindOne = vi.fn().mockResolvedValue(null);

      const { db, consentsCollection } = buildHappyPathDb({ equipmentFindOne });
      const getCollectionImpl = vi.fn(async (_db, key) => {
        if (key === 'consents') return consentsCollection;
        throw new Error(`unexpected key ${key}`);
      });
      const { router } = loadRoute({ getCollectionImpl });

      const app = buildApp(router, db);
      const res = await request(app).post('/api/intake-wizard').send(VALID_PAYLOAD);

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
    });

    it('returns 409 when a qualifying location has no available storage box', async () => {
      const storageBoxesFind = () => makeCursor([]);
      const { db, consentsCollection } = buildHappyPathDb({ storageBoxesFind });
      const getCollectionImpl = vi.fn(async (_db, key) => {
        if (key === 'consents') return consentsCollection;
        throw new Error(`unexpected key ${key}`);
      });
      const { router } = loadRoute({ getCollectionImpl });

      const app = buildApp(router, db);
      const res = await request(app).post('/api/intake-wizard').send(VALID_PAYLOAD);

      expect(res.status).toBe(409);
      expect(res.body.success).toBe(false);
    });

    it('returns 400 when the matched patient has no usable identifier for consent lookup', async () => {
      const { db, consentsCollection } = buildHappyPathDb();
      const getCollectionImpl = vi.fn(async (_db, key) => {
        if (key === 'consents') return consentsCollection;
        throw new Error(`unexpected key ${key}`);
      });

      const { router } = loadRoute({
        getCollectionImpl,
        matchOrUpsertParticipant: vi.fn().mockResolvedValue({ created: true, matchType: 'new', patient: {} }),
      });

      const app = buildApp(router, db);
      const res = await request(app).post('/api/intake-wizard').send(VALID_PAYLOAD);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toMatch(/identificador/);
    });

    it('treats a sensor identified only by maintenanceStatus as non-operational and skips its box', async () => {
      const storageBoxesFind = () => makeCursor([
        { _id: 'box-1', name: 'Box A', status: 'ACTIVE', dimension: { rows: 1, cols: 1 }, currentOccupancy: 0, occupancyGrid: {}, parent_id: 'rack-1' },
        { _id: 'box-2', name: 'Box B', status: 'ACTIVE', dimension: { rows: 1, cols: 1 }, currentOccupancy: 0, occupancyGrid: {}, parent_id: 'rack-2' },
      ]);
      const storageContainersFindOne = async ({ _id }) => {
        if (_id === 'rack-1') return { _id: 'rack-1', containerType: 'RACK', parent_id: 'shelf-1' };
        if (_id === 'shelf-1') return { _id: 'shelf-1', containerType: 'SHELF', parent_id: 'freezer-1' };
        if (_id === 'freezer-1') return { _id: 'freezer-1', containerType: 'FREEZER', containerID: 'EQ-1' };
        if (_id === 'rack-2') return { _id: 'rack-2', containerType: 'RACK', parent_id: 'shelf-2' };
        if (_id === 'shelf-2') return { _id: 'shelf-2', containerType: 'SHELF', parent_id: 'freezer-2' };
        if (_id === 'freezer-2') return { _id: 'freezer-2', containerType: 'FREEZER', containerID: 'EQ-2' };
        return null;
      };
      const sensorsFind = vi.fn((query) => {
        const variants = query.$or[0].locationId.$in;
        if (variants.includes('EQ-1')) return makeCursor([{ locationId: 'EQ-1', maintenanceStatus: 'calibration' }]);
        return makeCursor([{ locationId: 'EQ-2', operationalStatus: 'ok' }]);
      });
      const equipmentFindOne = vi.fn().mockResolvedValue({ equipmentID: 'EQ-1', status: 'active' });

      const { db, consentsCollection } = buildHappyPathDb({ sensorsFind, storageBoxesFind, storageContainersFindOne, equipmentFindOne });
      const { samplesCollection, patientsCollection } = setupHappyMocks();

      const getCollectionImpl = vi.fn(async (_db, key) => {
        if (key === 'samples') return samplesCollection;
        if (key === 'patients') return patientsCollection;
        if (key === 'consents') return consentsCollection;
        throw new Error(`unexpected key ${key}`);
      });

      const { router } = loadRoute({ getCollectionImpl });

      const sampleServiceModule = require(sampleServicePath);
      vi.spyOn(sampleServiceModule, 'createSample').mockResolvedValue({ _id: 'sample-1', participantId: '12345678' });

      const StorageService = require(storageServicePath);
      vi.spyOn(StorageService.prototype, 'autoAssignSampleToBox').mockResolvedValue({
        success: true,
        sampleLocation: { boxId: 'box-2', position: 'A1' },
      });

      const app = buildApp(router, db);
      const res = await request(app).post('/api/intake-wizard').send(VALID_PAYLOAD);

      expect(res.status).toBe(200);
      expect(res.body.storageLocation.equipmentID).toBe('EQ-2');
    });

    it('skips a storage box that is BLOCKED/RETIRED/INACTIVE and one at full occupancy', async () => {
      const storageBoxesFind = () => makeCursor([
        { _id: 'box-blocked', name: 'Blocked Box', status: 'RETIRED', dimension: { rows: 1, cols: 1 }, currentOccupancy: 0, occupancyGrid: {}, parent_id: 'rack-1' },
        { _id: 'box-full', name: 'Full Box', status: 'ACTIVE', dimension: { rows: 1, cols: 1 }, currentOccupancy: 1, occupancyGrid: {}, parent_id: 'rack-1' },
        { _id: 'box-ok', name: 'OK Box', status: 'ACTIVE', dimension: { rows: 1, cols: 1 }, currentOccupancy: 0, occupancyGrid: {}, parent_id: 'rack-1' },
      ]);

      const { db, consentsCollection } = buildHappyPathDb({ storageBoxesFind });
      const { samplesCollection, patientsCollection } = setupHappyMocks();

      const getCollectionImpl = vi.fn(async (_db, key) => {
        if (key === 'samples') return samplesCollection;
        if (key === 'patients') return patientsCollection;
        if (key === 'consents') return consentsCollection;
        throw new Error(`unexpected key ${key}`);
      });

      const { router } = loadRoute({ getCollectionImpl });

      const sampleServiceModule = require(sampleServicePath);
      vi.spyOn(sampleServiceModule, 'createSample').mockResolvedValue({ _id: 'sample-1', participantId: '12345678' });

      const StorageService = require(storageServicePath);
      vi.spyOn(StorageService.prototype, 'autoAssignSampleToBox').mockResolvedValue({
        success: true,
        sampleLocation: { boxId: 'box-ok', position: 'A1' },
      });

      const app = buildApp(router, db);
      const res = await request(app).post('/api/intake-wizard').send(VALID_PAYLOAD);

      expect(res.status).toBe(200);
      expect(res.body.storageLocation.boxName).toBe('OK Box');
    });

    it('finds the next free position using a Map-based occupancyGrid', async () => {
      const occupancyGrid = new Map([['A1', true]]);
      const storageBoxesFind = () => makeCursor([
        { _id: 'box-1', name: 'Box A', status: 'ACTIVE', dimension: { rows: 1, cols: 2 }, currentOccupancy: 1, occupancyGrid, parent_id: 'rack-1' },
      ]);

      const { db, consentsCollection } = buildHappyPathDb({ storageBoxesFind });
      const { samplesCollection, patientsCollection } = setupHappyMocks();

      const getCollectionImpl = vi.fn(async (_db, key) => {
        if (key === 'samples') return samplesCollection;
        if (key === 'patients') return patientsCollection;
        if (key === 'consents') return consentsCollection;
        throw new Error(`unexpected key ${key}`);
      });

      const { router } = loadRoute({ getCollectionImpl });

      const sampleServiceModule = require(sampleServicePath);
      vi.spyOn(sampleServiceModule, 'createSample').mockResolvedValue({ _id: 'sample-1', participantId: '12345678' });

      const StorageService = require(storageServicePath);
      vi.spyOn(StorageService.prototype, 'autoAssignSampleToBox').mockResolvedValue({
        success: true,
        sampleLocation: { boxId: 'box-1', position: 'A2' },
      });

      const app = buildApp(router, db);
      const res = await request(app).post('/api/intake-wizard').send(VALID_PAYLOAD);

      expect(res.status).toBe(200);
      expect(res.body.storageLocation.position).toBe('A2');
    });

    it('returns 422 NON_CANONICAL_FIELD early when a nested payload section is not an object', async () => {
      const { router } = loadRoute();
      const app = buildApp(router, {});

      const payload = { ...VALID_PAYLOAD, participant: 'not-an-object' };

      const res = await request(app).post('/api/intake-wizard').send(payload);

      expect(res.status).toBe(422);
      expect(res.body.error).toBe('NON_CANONICAL_FIELD');
    });

    it('returns 409 when box allocation fails, per issue #474 (allocation now happens inside createSample itself)', async () => {
      const { db, consentsCollection } = buildHappyPathDb();
      const { samplesCollection, patientsCollection } = setupHappyMocks();

      const getCollectionImpl = vi.fn(async (_db, key) => {
        if (key === 'samples') return samplesCollection;
        if (key === 'patients') return patientsCollection;
        if (key === 'consents') return consentsCollection;
        throw new Error(`unexpected key ${key}`);
      });

      const { router } = loadRoute({ getCollectionImpl });

      // #474: sampleService.createSample now routes storage allocation
      // through AllocateSampleUseCase as part of the create call itself —
      // it already deletes the inserted sample and rejects with a 409-coded
      // error on a collision, so the route no longer runs a separate
      // assignSampleToBox/deleteSample cleanup step.
      const sampleServiceModule = require(sampleServicePath);
      const allocationError = new Error('Falha ao alocar amostra na posição de armazenamento: STORAGE_COLLISION: posição já ocupada');
      allocationError.statusCode = 409;
      vi.spyOn(sampleServiceModule, 'createSample').mockRejectedValue(allocationError);

      const app = buildApp(router, db);
      const res = await request(app).post('/api/intake-wizard').send(VALID_PAYLOAD);

      expect(res.status).toBe(409);
      expect(res.body.success).toBe(false);
    });
  });

  describe('GET /patient-match', () => {
    it('returns 503 when db is unavailable', async () => {
      const { router } = loadRoute();
      const app = buildApp(router, null);

      const res = await request(app).get('/api/intake-wizard/patient-match');

      expect(res.status).toBe(503);
    });

    it('returns 400 when neither identityDocument, patientID nor patientName+birthDate are provided', async () => {
      const { router } = loadRoute();
      const app = buildApp(router, {});

      const res = await request(app).get('/api/intake-wizard/patient-match');

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/identityDocument/i);
    });

    // #562: matching resolves via ParticipantIdentity (identityFindOne for
    // an ID lookup, identityFind for the name+birthDate fallback), not
    // Patient's own patientNameNormalized/birthDateKey fields — same pattern
    // #561 applied to PatientIdentityService.js. A second `patients` lookup
    // (by the resolved participantId) fills in `status`.
    function makeIdentityCollectionRouter({
      identityFindOne = vi.fn().mockResolvedValue(null),
      identityCandidates = [],
      patientRecord = null,
      sampleRows = [],
    } = {}) {
      const identityFind = vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue(identityCandidates) });
      const patientsFindOne = vi.fn().mockResolvedValue(patientRecord);
      const samplesFind = vi.fn().mockReturnValue({
        sort: vi.fn().mockReturnValue({
          limit: vi.fn().mockReturnValue({
            toArray: vi.fn().mockResolvedValue(sampleRows),
          }),
        }),
      });
      const getCollectionImpl = vi.fn((db, key) => {
        if (key === 'participantIdentities') {
          return Promise.resolve({ findOne: identityFindOne, find: identityFind });
        }
        if (key === 'samples') {
          return Promise.resolve({ find: samplesFind });
        }
        return Promise.resolve({ findOne: patientsFindOne });
      });
      return { getCollectionImpl, identityFindOne, identityFind, patientsFindOne, samplesFind };
    }

    it('returns matched:false when no patient is found by patientID', async () => {
      const { getCollectionImpl } = makeIdentityCollectionRouter();
      const { router } = loadRoute({ getCollectionImpl });
      const app = buildApp(router, {});

      const res = await request(app).get('/api/intake-wizard/patient-match').query({ patientID: '12345678' });

      expect(res.status).toBe(200);
      expect(res.body.matched).toBe(false);
      expect(res.body.patient).toBeNull();
    });

    it('returns matched:true with the patient data when found', async () => {
      const { getCollectionImpl } = makeIdentityCollectionRouter({
        identityFindOne: vi.fn().mockResolvedValue({ participantId: '12345678', patientName: 'Paciente Teste', birthDate: '2000-01-01' }),
        patientRecord: { status: 'ACTIVE' },
      });
      const { router } = loadRoute({ getCollectionImpl });
      const app = buildApp(router, {});

      const res = await request(app).get('/api/intake-wizard/patient-match').query({ patientID: '12345678' });

      expect(res.status).toBe(200);
      expect(res.body.matched).toBe(true);
      expect(res.body.patient).toEqual(
        expect.objectContaining({ patientID: '12345678', patientName: 'Paciente Teste', status: 'ACTIVE' })
      );
    });

    // #1104: the name+birthDate branch below decrypts its candidates (see the
    // birthDateHash test), but this participantId branch did not -- twenty
    // lines apart in the same handler, which is why grepping decryptIdentity
    // made this file look fully repointed. A ciphertext-only row came back
    // with null patientName/birthDate.
    it('#1104: decrypts a ciphertext-only identity found by patientID, not just the name+birthDate candidates', async () => {
      const participantIdentityService = require('../../src/services/participantIdentity.service');
      const birthDate = new Date(2000, 0, 1);
      const encrypted = participantIdentityService.encryptIdentityFields({
        participantId: '12345678',
        patientName: 'Paciente Teste',
        birthDate,
      });
      const { getCollectionImpl } = makeIdentityCollectionRouter({
        identityFindOne: vi.fn().mockResolvedValue({ ...encrypted, patientName: null, birthDate: null }),
        patientRecord: { status: 'ACTIVE' },
      });
      const { router } = loadRoute({ getCollectionImpl });
      const app = buildApp(router, {});

      const res = await request(app).get('/api/intake-wizard/patient-match').query({ patientID: '12345678' });

      expect(res.status).toBe(200);
      expect(res.body.matched).toBe(true);
      expect(res.body.patient).toEqual(
        expect.objectContaining({ patientID: '12345678', patientName: 'Paciente Teste', status: 'ACTIVE' })
      );
      expect(res.body.patient.birthDate).toBeTruthy();
    });

    it('matches by identityDocument blind index and returns parent-sample candidates', async () => {
      const participantIdentityService = require('../../src/services/participantIdentity.service');
      const encrypted = participantIdentityService.encryptIdentityFields({
        participantId: '11223344',
        patientName: 'Maria Documento',
        birthDate: new Date(1990, 4, 15),
        identityDocument: '11144477735',
        email: 'maria@example.com',
      });
      const { getCollectionImpl, identityFind, samplesFind } = makeIdentityCollectionRouter({
        identityCandidates: [{ ...encrypted, participantId: '11223344' }],
        patientRecord: { status: 'ACTIVE', sex: 'F', clinicalUnitId: null },
        sampleRows: [
          {
            specimenId: 'SP-PRIM-1',
            sampleType: 'PLASMA',
            sampleOrigin: 'VENOUS_BLOOD',
            matrixType: 'fluid',
            registeredAt: new Date('2026-01-10T12:00:00Z'),
            quantity: 2,
            unit: 'mL',
          },
        ],
      });
      const { router } = loadRoute({ getCollectionImpl });
      const app = buildApp(router, {});

      const res = await request(app)
        .get('/api/intake-wizard/patient-match')
        .query({ identityDocument: '111.444.777-35' });

      expect(res.status).toBe(200);
      expect(res.body.matched).toBe(true);
      expect(res.body.matchType).toBe('identityDocument');
      expect(res.body.patient).toEqual(
        expect.objectContaining({
          patientID: '11223344',
          patientName: 'Maria Documento',
          sex: 'F',
        })
      );
      expect(res.body.samples).toEqual([
        expect.objectContaining({ specimenId: 'SP-PRIM-1', sampleType: 'PLASMA' }),
      ]);
      expect(identityFind).toHaveBeenCalledWith(
        expect.objectContaining({
          $or: expect.arrayContaining([
            expect.objectContaining({ identityDocumentHash: expect.objectContaining({ $in: expect.any(Array) }) }),
          ]),
        })
      );
      expect(samplesFind).toHaveBeenCalled();
    });

    it('matches by normalized name + birthDate when patientID is absent', async () => {
      const { getCollectionImpl, identityFind } = makeIdentityCollectionRouter({
        identityCandidates: [{ participantId: '87654321', patientName: 'João Ção', birthDate: new Date(2000, 1, 1) }],
      });
      const { router } = loadRoute({ getCollectionImpl });
      const app = buildApp(router, {});

      const res = await request(app)
        .get('/api/intake-wizard/patient-match')
        .query({ patientName: 'João Ção', birthDate: '01/02/2000' });

      expect(res.status).toBe(200);
      expect(res.body.matched).toBe(true);
      // RF005/RNF007 (#574, done for birthDate in #1104): birthDate is
      // ciphertext-only, so the query narrows on the blind index alone. The
      // plaintext day-range branch is gone -- keeping it would have made this
      // an unindexable $or (#1102), and it could never match a row written
      // since the cutover.
      const participantIdentityServiceForQuery = require('../../src/services/participantIdentity.service');
      expect(identityFind).toHaveBeenCalledWith(
        expect.objectContaining({
          $or: expect.arrayContaining([
            expect.objectContaining({ birthDateHash: expect.objectContaining({ $in: expect.any(Array) }) }),
          ]),
        })
      );
      const identityQuery = identityFind.mock.calls[0][0];
      expect(identityQuery.$or.some((clause) => clause.birthDate)).toBe(false);
      expect(participantIdentityServiceForQuery.getCiphertextOnlyFields()).toContain('birthDate');
    });

    it('matches by birthDateHash (RF005/RNF007 #574) when the candidate has no plaintext-queryable birthDate range hit needed', async () => {
      const participantIdentityService = require('../../src/services/participantIdentity.service');
      const birthDate = new Date(2000, 1, 1);
      const expectedHash = participantIdentityService.computeBlindIndex('birthDate', birthDate);
      const encrypted = participantIdentityService.encryptIdentityFields({
        participantId: '87654321',
        patientName: 'João Ção',
        birthDate,
      });
      const { getCollectionImpl, identityFind } = makeIdentityCollectionRouter({
        identityCandidates: [{ ...encrypted, patientName: null, birthDate: null }],
      });
      const { router } = loadRoute({ getCollectionImpl });
      const app = buildApp(router, {});

      const res = await request(app)
        .get('/api/intake-wizard/patient-match')
        .query({ patientName: 'João Ção', birthDate: '01/02/2000' });

      expect(res.status).toBe(200);
      expect(res.body.matched).toBe(true);
      expect(identityFind).toHaveBeenCalledWith(
        expect.objectContaining({
          // #1099: matched under every registered key, via $in.
          $or: expect.arrayContaining([{ birthDateHash: { $in: expect.arrayContaining([expectedHash]) } }]),
        })
      );
    });

    it('returns 500 when the query throws', async () => {
      const getCollectionImpl = vi.fn().mockRejectedValue(new Error('db down'));
      const { router } = loadRoute({ getCollectionImpl });
      const app = buildApp(router, {});

      const res = await request(app).get('/api/intake-wizard/patient-match').query({ patientID: '12345678' });

      expect(res.status).toBe(500);
    });

    it('matches by patientID first, falling back to name+birthDate only when the ID lookup misses', async () => {
      const { getCollectionImpl, identityFind } = makeIdentityCollectionRouter({
        identityFindOne: vi.fn().mockResolvedValue({ participantId: '12345678', patientName: 'Paciente Teste' }),
      });
      const { router } = loadRoute({ getCollectionImpl });
      const app = buildApp(router, {});

      const res = await request(app)
        .get('/api/intake-wizard/patient-match')
        .query({ patientID: '12345678', patientName: 'Paciente Teste', birthDate: '01/02/2000' });

      expect(res.status).toBe(200);
      expect(res.body.matched).toBe(true);
      expect(identityFind).not.toHaveBeenCalled();
    });

    it('falls back to status ACTIVE and empty patientName/patientID when the stored identity lacks them', async () => {
      const { getCollectionImpl } = makeIdentityCollectionRouter({
        identityFindOne: vi.fn().mockResolvedValue({ birthDate: '2000-01-01' }),
      });
      const { router } = loadRoute({ getCollectionImpl });
      const app = buildApp(router, {});

      const res = await request(app).get('/api/intake-wizard/patient-match').query({ patientID: '12345678' });

      expect(res.status).toBe(200);
      expect(res.body.patient.status).toBe('ACTIVE');
      expect(res.body.patient.patientID).toBe('');
      expect(res.body.patient.patientName).toBe('');
    });

    // #1377: the lookup applies the scope rule matchOrUpsertParticipant
    // applies (#1356) to the Patient record's clinicalUnitId. A match outside
    // the caller's organizations answers as a non-match, so neither its civil
    // fields nor its existence reach the caller; the audit keeps the truth.
    describe('organization scope (#1377)', () => {
      function scopedApp(router, organizationScope) {
        const app = express();
        app.use(express.json());
        app.locals.db = {};
        app.use((req, _res, next) => { req.organizationScope = organizationScope; next(); });
        app.use('/api/intake-wizard', router);
        return app;
      }

      const SCOPED = { scope: 'organization', organizationIds: ['ORG-A'] };

      function matchIn(clinicalUnitId) {
        return makeIdentityCollectionRouter({
          identityFindOne: vi.fn().mockResolvedValue({ participantId: '12345678', patientName: 'Paciente Teste', birthDate: '2000-01-01' }),
          patientRecord: { status: 'ACTIVE', clinicalUnitId },
        });
      }

      it('answers a scoped caller as a non-match when the matched patient belongs to another organization', async () => {
        const { getCollectionImpl, patientsFindOne } = matchIn('ORG-B');
        const { router, auditLoggerModule } = loadRoute({ getCollectionImpl });
        const app = scopedApp(router, SCOPED);

        const res = await request(app).get('/api/intake-wizard/patient-match').query({ patientID: '12345678' });

        expect(res.status).toBe(200);
        expect(res.body).toEqual({ success: true, matched: false, patient: null, message: '' });
        expect(JSON.stringify(res.body)).not.toMatch(/Paciente Teste|2000-01-01/);
        expect(patientsFindOne.mock.calls[0][1].projection).toEqual(expect.objectContaining({ clinicalUnitId: 1 }));
        const audit = auditLoggerModule.log.mock.calls[0][0];
        expect(audit.payload).toEqual(expect.objectContaining({ matched: false, outOfScope: true }));
      });

      it('returns the match to a scoped caller when the matched patient belongs to its organization', async () => {
        const { getCollectionImpl } = matchIn('ORG-A');
        const { router } = loadRoute({ getCollectionImpl });
        const app = scopedApp(router, SCOPED);

        const res = await request(app).get('/api/intake-wizard/patient-match').query({ patientID: '12345678' });

        expect(res.status).toBe(200);
        expect(res.body.matched).toBe(true);
        expect(res.body.patient).toEqual(
          expect.objectContaining({ patientID: '12345678', patientName: 'Paciente Teste', status: 'ACTIVE' })
        );
      });

      it('returns another organization\'s match to a global caller', async () => {
        const { getCollectionImpl } = matchIn('ORG-B');
        const { router } = loadRoute({ getCollectionImpl });
        const app = scopedApp(router, { scope: 'global', organizationIds: [] });

        const res = await request(app).get('/api/intake-wizard/patient-match').query({ patientID: '12345678' });

        expect(res.status).toBe(200);
        expect(res.body.matched).toBe(true);
        expect(res.body.patient).toEqual(
          expect.objectContaining({ patientID: '12345678', patientName: 'Paciente Teste' })
        );
      });
    });
  });
});

// #1337: the fallbacks the intake takes on sparse rows (a consent, a patient,
// a box, a container chain, a stored sample) and on errors with no message,
// each pinned by what the response or the write carries.
describe('intakeWizard routes: fallbacks on sparse rows (#1337)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    clearCache();
  });

  const BOX = {
    _id: 'box-1', name: 'Box A', status: 'ACTIVE', dimension: { rows: 1, cols: 1 },
    currentOccupancy: 0, occupancyGrid: {}, parent_id: 'rack-1',
  };
  const CHAIN = {
    'rack-1': { _id: 'rack-1', containerType: 'RACK', parent_id: 'shelf-1' },
    'shelf-1': { _id: 'shelf-1', containerType: 'SHELF', parent_id: 'freezer-1' },
    'freezer-1': { _id: 'freezer-1', containerType: 'FREEZER', containerID: 'EQ-1' },
  };

  async function postIntake({
    payload = VALID_PAYLOAD,
    boxes = [BOX],
    containers = CHAIN,
    equipment = { equipmentID: 'EQ-1', status: 'active' },
    consents = [],
    matchOrUpsertParticipant,
    resolveMethodologicalQuality,
    createdSample = { _id: 'sample-1', participantId: '12345678' },
    storedSample = { _id: 'sample-1', participantId: '12345678' },
    recordAssessment,
    organizationsFindOne = vi.fn().mockResolvedValue({ organizationId: 'org-1' }),
  } = {}) {
    const samplesCollection = { findOne: vi.fn().mockResolvedValue(storedSample), updateOne: vi.fn().mockResolvedValue({ matchedCount: 1 }) };
    const patientsCollection = { updateOne: vi.fn().mockResolvedValue({ matchedCount: 1 }) };
    const consentQueue = [...consents];
    const consentsCollection = { findOne: vi.fn(async () => consentQueue.shift() ?? null) };
    const getCollectionImpl = vi.fn(async (_db, key) => {
      if (key === 'samples') return samplesCollection;
      if (key === 'patients') return patientsCollection;
      if (key === 'consents') return consentsCollection;
      throw new Error(`unexpected key ${key}`);
    });
    const storageContainersFindOne = vi.fn(async ({ _id }) => containers[_id] || null);
    const db = {
      collection: (name) => {
        if (name === 'sensors') return { find: () => makeCursor([{ sensorId: 'SEN-1', locationId: 'EQ-1', maintenanceStatus: 'operational' }]) };
        if (name === 'equipment') return { findOne: vi.fn().mockResolvedValue(equipment) };
        if (name === 'storageBoxes') return { find: () => makeCursor(boxes) };
        if (name === 'storageContainers') return { findOne: storageContainersFindOne };
        if (name === 'organizations') return { findOne: organizationsFindOne };
        throw new Error(`unexpected collection ${name}`);
      },
    };

    const loaded = loadRoute({ getCollectionImpl, matchOrUpsertParticipant, resolveMethodologicalQuality });
    if (recordAssessment) loaded.rcsAssessmentServiceModule.recordAssessment = recordAssessment;
    const sampleServiceModule = require(sampleServicePath);
    const createSample = vi.spyOn(sampleServiceModule, 'createSample').mockResolvedValue(createdSample);

    const res = await request(buildApp(loaded.router, db)).post('/api/intake-wizard').send(payload);
    return { res, createSample, storageContainersFindOne, consentsCollection, samplesCollection, patientsCollection, ...loaded };
  }

  it('answers an active consent row with no id or participant as null ids', async () => {
    const { res } = await postIntake({ consents: [{ status: 'ACTIVE' }] });

    expect(res.status).toBe(200);
    expect(res.body.consent).toEqual({ active: true, status: 'SIGNED', consentId: null, patientId: null, reason: null });
  });

  it('answers a revoked consent row with no id or participant as null ids', async () => {
    const { res } = await postIntake({ consents: [null, { status: 'REVOKED' }] });

    expect(res.status).toBe(200);
    expect(res.body.consent).toEqual({ active: false, status: 'REVOKED', consentId: null, patientId: null, reason: 'Consentimento revogado.' });
  });

  it('logs an existing in-scope match as updated, and reports no patientID or matchType when the match has none', async () => {
    const { res, auditLoggerModule, createSample } = await postIntake({
      matchOrUpsertParticipant: async () => ({ created: false, patient: { _id: 'patient-obj-9' } }),
    });

    expect(res.status).toBe(200);
    expect(res.body.patientMatch).toEqual({ matched: true, created: false, patientID: null });
    expect(auditLoggerModule.log).toHaveBeenCalledWith(expect.objectContaining({
      resourceId: null,
      message: 'Paciente existente identificado e atualizado durante intake wizard.',
      payload: expect.objectContaining({ created: false, outOfScope: false, matched: true, matchType: null, patientID: null }),
    }));
    // No participantId on the match: the sample takes the payload's own.
    expect(createSample.mock.calls[0][1].participantId).toBe('12345678');
  });

  it('looks up consent by the patient _id alone when its participantId is blank', async () => {
    const { res, consentsCollection } = await postIntake({
      matchOrUpsertParticipant: async () => ({ created: false, matchType: 'exact', patient: { _id: 'patient-obj-9', participantId: '   ' } }),
    });

    expect(res.status).toBe(200);
    expect(consentsCollection.findOne.mock.calls[0][0]).toEqual({ participantId: { $in: ['patient-obj-9'] }, status: 'ACTIVE' });
  });

  it('persists the SPREC the quality assessment returns over the specimen one', async () => {
    const { res, createSample } = await postIntake({
      resolveMethodologicalQuality: () => ({ governance_status: 1, final_grade: 'A', sprec: { sampleType: 'BLD' } }),
    });

    expect(res.status).toBe(200);
    expect(createSample.mock.calls[0][1].sprec).toEqual({ sampleType: 'BLD' });
  });

  it('answers with the created sample and its allocated position when the stored row is not found', async () => {
    const created = { _id: 'sample-1', participantId: '12345678', storageLocation: { boxId: 'box-1', position: 'B2' } };
    const { res } = await postIntake({ createdSample: created, storedSample: null });

    expect(res.status).toBe(200);
    expect(res.body.sample).toMatchObject({ _id: 'sample-1' });
    expect(res.body.storageLocation).toMatchObject({ boxId: 'box-1', position: 'B2', readable: 'equipamento EQ-1 / box Box A / posição B2' });
  });

  it('builds the label links from sampleID and barcode when the stored sample has no _id', async () => {
    const { res } = await postIntake({ storedSample: { sampleID: 'S-77', barcode: 'BC 01', participantId: '12345678' } });

    expect(res.status).toBe(200);
    expect(res.body.label).toEqual({
      sampleId: 'S-77',
      symbologyAssetsUrl: '/api/samples/by-barcode/BC%2001/symbology-assets',
      printJobUrl: '/api/samples/S-77/label/print-job',
    });
  });

  it('builds the label id from the barcode when the stored sample has neither _id nor sampleID', async () => {
    const { res } = await postIntake({ storedSample: { barcode: 'BC-9', participantId: '12345678' } });

    expect(res.status).toBe(200);
    expect(res.body.label.sampleId).toBe('BC-9');
    expect(res.body.label.printJobUrl).toBe('/api/samples/BC-9/label/print-job');
  });

  it('names a box by its boxID when it has no name', async () => {
    const { res } = await postIntake({ boxes: [{ ...BOX, name: undefined, boxID: 'BX-1' }] });

    expect(res.status).toBe(200);
    expect(res.body.storageLocation).toMatchObject({ boxName: 'BX-1', readable: 'equipamento EQ-1 / box BX-1' });
  });

  it('leaves the box out of the readable location when it has neither name nor boxID', async () => {
    const { res } = await postIntake({ boxes: [{ ...BOX, name: undefined }] });

    expect(res.status).toBe(200);
    expect(res.body.storageLocation).toMatchObject({ boxName: null, readable: 'equipamento EQ-1' });
  });

  it('walks a box in a DRAWER up through its rack to the freezer', async () => {
    const containers = { ...CHAIN, 'drawer-1': { _id: 'drawer-1', containerType: 'DRAWER', parent_id: 'rack-1' } };
    const { res, storageContainersFindOne } = await postIntake({ boxes: [{ ...BOX, parent_id: 'drawer-1' }], containers });

    expect(res.status).toBe(200);
    expect(storageContainersFindOne.mock.calls.map(([query]) => query._id)).toEqual(['drawer-1', 'rack-1', 'shelf-1', 'freezer-1']);
    expect(res.body.storageLocation.equipmentID).toBe('EQ-1');
  });

  it('skips boxes with no capacity, no free position or a broken container chain, and takes the first whole one', async () => {
    const containers = {
      ...CHAIN,
      'drawer-orphan': { _id: 'drawer-orphan', containerType: 'DRAWER' },
      'rack-orphan': { _id: 'rack-orphan', containerType: 'RACK' },
      'rack-2': { _id: 'rack-2', containerType: 'RACK', parent_id: 'shelf-orphan' },
      'shelf-orphan': { _id: 'shelf-orphan', containerType: 'SHELF' },
      'rack-3': { _id: 'rack-3', containerType: 'RACK', parent_id: 'shelf-3' },
      'shelf-3': { _id: 'shelf-3', containerType: 'SHELF', parent_id: 'freezer-nocid' },
      'freezer-nocid': { _id: 'freezer-nocid', containerType: 'FREEZER' },
    };
    const boxes = [
      { ...BOX, _id: 'box-nodim', dimension: undefined },
      { ...BOX, _id: 'box-negdim', dimension: { rows: -1, cols: -1 } },
      { ...BOX, _id: 'box-noparent', parent_id: undefined },
      { ...BOX, _id: 'box-drawer-orphan', parent_id: 'drawer-orphan' },
      { ...BOX, _id: 'box-rack-orphan', parent_id: 'rack-orphan' },
      { ...BOX, _id: 'box-shelf-orphan', parent_id: 'rack-2' },
      { ...BOX, _id: 'box-freezer-nocid', parent_id: 'rack-3' },
      { ...BOX, _id: 'box-ok', occupancyGrid: undefined },
    ];

    const { res } = await postIntake({ boxes, containers });

    expect(res.status).toBe(200);
    expect(res.body.storageLocation).toMatchObject({ boxId: 'box-ok', position: 'A1' });
  });

  it('reads equipment readiness from operationalStatus when status and maintenanceStatus are absent', async () => {
    const ready = await postIntake({ equipment: { equipmentID: 'EQ-1', operationalStatus: 'active' } });
    expect(ready.res.status).toBe(200);

    vi.restoreAllMocks();
    const blocked = await postIntake({ equipment: { equipmentID: 'EQ-1', operationalStatus: 'maintenance' } });
    expect(blocked.res.status).toBe(422);
  });

  it('names a missing top-level section by its missingProperty', async () => {
    const { participant, ...withoutParticipant } = VALID_PAYLOAD;
    const { res, createSample } = await postIntake({ payload: withoutParticipant });

    expect(participant).toBeDefined();
    expect(res.status).toBe(422);
    expect(res.body.error).toBe('NON_CANONICAL_FIELD');
    expect(res.body.fields).toEqual(['participant']);
    expect(createSample).not.toHaveBeenCalled();
  });

  it('refuses an unknown top-level property as NON_CANONICAL_FIELD, creating nothing', async () => {
    const { res, createSample } = await postIntake({ payload: { ...VALID_PAYLOAD, bogus: 1 } });

    expect(res.status).toBe(422);
    expect(res.body.error).toBe('NON_CANONICAL_FIELD');
    expect(createSample).not.toHaveBeenCalled();
  });

  it('refuses with 403 when the organization lookup fails with no status, creating nothing', async () => {
    const { res, createSample } = await postIntake({
      payload: { ...VALID_PAYLOAD, organizationId: 'org-1' },
      organizationsFindOne: vi.fn().mockRejectedValue(new Error('falha ao consultar organizações')),
    });

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ success: false, error: 'falha ao consultar organizações' });
    expect(createSample).not.toHaveBeenCalled();
  });

  it('still answers 200 when recording the RcsAssessment rejects with no message', async () => {
    const { res, samplesCollection } = await postIntake({ recordAssessment: vi.fn().mockRejectedValue(new Error('')) });

    expect(res.status).toBe(200);
    expect(samplesCollection.updateOne).not.toHaveBeenCalled();
    expect(res.body.sample.sealedRcsAssessmentId).toBeUndefined();
  });

  it('answers 500 with the generic message when a step throws an error with no message or status', async () => {
    const { res, createSample } = await postIntake({ matchOrUpsertParticipant: async () => { throw {}; } });

    expect(res.status).toBe(500);
    expect(res.body).toMatchObject({ success: false, error: 'Erro desconhecido ao finalizar o Intake Wizard.' });
    expect(createSample).not.toHaveBeenCalled();
  });

  describe('GET /patient-match', () => {
    function identityRouter({ candidates = [], getCollectionImpl } = {}) {
      const identityFind = vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue(candidates) });
      const impl = getCollectionImpl || vi.fn(async (_db, key) => (key === 'participantIdentities'
        ? { findOne: vi.fn().mockResolvedValue(null), find: identityFind }
        : { findOne: vi.fn().mockResolvedValue(null) }));
      const loaded = loadRoute({ getCollectionImpl: impl });
      return { app: buildApp(loaded.router, {}), identityFind, ...loaded };
    }

    it('narrows by the plaintext day range when no blind-index key is registered, and answers no match by another name', async () => {
      const participantIdentityService = require('../../src/services/participantIdentity.service');
      vi.spyOn(participantIdentityService, 'computeBlindIndexCandidates').mockReturnValue([]);
      const { app, identityFind, auditLoggerModule } = identityRouter({
        candidates: [{ participantId: '87654321', patientName: 'Outra Pessoa', birthDate: new Date(2000, 1, 1) }],
      });

      const res = await request(app).get('/api/intake-wizard/patient-match').query({ patientName: 'João Ção', birthDate: '01/02/2000' });

      expect(res.status).toBe(200);
      expect(res.body.matched).toBe(false);
      expect(res.body.patient).toBeNull();
      const [clause] = identityFind.mock.calls[0][0].$or;
      expect(clause.birthDate).toEqual({ $gte: expect.any(Date), $lt: expect.any(Date) });
      expect(auditLoggerModule.log).toHaveBeenCalledWith(expect.objectContaining({ resourceId: null }));
    });

    it('answers 500 with the generic message when the lookup throws an error with no message', async () => {
      const { app } = identityRouter({ getCollectionImpl: vi.fn().mockRejectedValue({}) });

      const res = await request(app).get('/api/intake-wizard/patient-match').query({ patientID: '12345678' });

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ success: false, error: 'Falha ao consultar paciente.' });
    });
  });
});
