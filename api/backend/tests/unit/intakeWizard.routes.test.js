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
          if (name === 'sensors') return { find: () => makeCursor([{ locationId: 'EQ-1', status: 'ok' }]) };
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
          if (name === 'sensors') return { find: () => makeCursor([{ locationId: 'EQ-1', status: 'ok' }]) };
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
          if (name === 'sensors') return { find: sensorsFind || (() => makeCursor([{ locationId: 'EQ-1', status: 'ok' }])) };
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

    it('returns 400 when neither patientID nor patientName+birthDate are provided', async () => {
      const { router } = loadRoute();
      const app = buildApp(router, {});

      const res = await request(app).get('/api/intake-wizard/patient-match');

      expect(res.status).toBe(400);
    });

    // #562: matching resolves via ParticipantIdentity (identityFindOne for
    // an ID lookup, identityFind for the name+birthDate fallback), not
    // Patient's own patientNameNormalized/birthDateKey fields — same pattern
    // #561 applied to PatientIdentityService.js. A second `patients` lookup
    // (by the resolved participantId) fills in `status`.
    function makeIdentityCollectionRouter({ identityFindOne = vi.fn().mockResolvedValue(null), identityCandidates = [], patientRecord = null } = {}) {
      const identityFind = vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue(identityCandidates) });
      const patientsFindOne = vi.fn().mockResolvedValue(patientRecord);
      const getCollectionImpl = vi.fn((db, key) =>
        Promise.resolve(
          key === 'participantIdentities'
            ? { findOne: identityFindOne, find: identityFind }
            : { findOne: patientsFindOne }
        )
      );
      return { getCollectionImpl, identityFindOne, identityFind, patientsFindOne };
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
      expect(identityFind).toHaveBeenCalledWith(
        expect.objectContaining({ birthDate: expect.objectContaining({ $gte: expect.any(Date), $lt: expect.any(Date) }) })
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
  });
});
