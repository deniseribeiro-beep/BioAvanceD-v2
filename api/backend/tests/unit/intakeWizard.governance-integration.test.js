// backend/tests/unit/intakeWizard.governance-integration.test.js
//
// #409 file 3: api/backend/src/routes/intakeWizard.js has its own quarantine
// write logic (quarantineStatus/quarantineReason/availabilityStatus/lifecycleStatus)
// when it creates a brand-new sample. Unlike the other #409 write sites, this
// file is never mounted on its own — it's only reachable through
// interface/routes/intakeWizard.routes.js's intakeGovernanceResponseGuard,
// which (per #409 file 2) already re-derives specimenStatus + records/releases
// a QuarantineAction on every POST response. This test composes both real
// routers together (no stub inner router, unlike
// intakeWizard.routes.governance.test.js) to prove the write site is already
// governed end-to-end, rather than assuming it from reading the code.
import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest';
import { createRequire } from 'module';
import express from 'express';
import request from 'supertest';

const require = createRequire(import.meta.url);

const routePath = require.resolve('../../src/interface/routes/intakeWizard.routes.js');
const authPath = require.resolve('../../src/infrastructure/middleware/auth.js');
const rbacPath = require.resolve('../../src/infrastructure/middleware/rbac.js');
const innerRoutePath = require.resolve('../../src/routes/intakeWizard.js');
const collectionResolverPath = require.resolve('../../src/utils/collectionResolver.js');
const quarantineActionServicePath = require.resolve('../../src/services/quarantine-action.service.js');
const notificationServicePath = require.resolve('../../src/services/notification.service');
const patientIdentityServicePath = require.resolve('../../src/services/PatientIdentityService');
const merkleServicePath = require.resolve('../../src/services/MerkleService');
const auditLoggerPath = require.resolve('../../src/utils/auditLogger');
const qualityDomainPath = require.resolve('../../src/services/quality-domain.service');
const sampleServicePath = require.resolve('../../src/services/sample.service');
const storageServicePath = require.resolve('../../src/services/storageService');

// Same trap as intakeWizard.routes.governance.test.js: quarantine-action.service.js
// destructures getCollection from collectionResolver at require-time, so every
// transitively-required module that does the same has to be busted here too.
const allPaths = [
  routePath,
  authPath,
  rbacPath,
  innerRoutePath,
  collectionResolverPath,
  quarantineActionServicePath,
  notificationServicePath,
  patientIdentityServicePath,
  merkleServicePath,
  auditLoggerPath,
  qualityDomainPath,
  sampleServicePath,
  storageServicePath,
];

function clearCache() {
  for (const p of allPaths) delete require.cache[p];
}

function makeCursor(rows) {
  const cursor = {
    sort: () => cursor,
    limit: () => cursor,
    toArray: async () => rows,
  };
  return cursor;
}

function buildQuarantineActionsCollection() {
  return {
    insertOne: vi.fn().mockResolvedValue({ insertedId: 'qa-1' }),
    find: vi.fn().mockReturnValue({ sort: () => ({ toArray: async () => [] }) }),
    updateOne: vi.fn().mockResolvedValue({ matchedCount: 0 }),
  };
}

function loadApp({ consentActive, samplesCollection, quarantineActionsCollection, patientsCollection }) {
  clearCache();

  const authModule = require(authPath);
  authModule.authenticate = (req, res, next) => {
    req.user = { userID: 'user-1', accessType: 3 };
    next();
  };

  const rbacModule = require(rbacPath);
  rbacModule.requirePermission = () => (req, res, next) => next();
  // #1355: the wrapper now mounts requireOrganizationScope too.
  rbacModule.requireOrganizationScope = (req, res, next) => { req.organizationScope = { scope: 'global', organizationIds: [] }; next(); };

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

  const consentsCollection = {
    findOne: vi.fn((query) => {
      if (query.status === 'ACTIVE') {
        return Promise.resolve(consentActive ? { _id: 'consent-1', participantId: '12345678', signedAt: new Date() } : null);
      }
      return Promise.resolve(null);
    }),
  };

  const collectionResolverModule = require(collectionResolverPath);
  collectionResolverModule.getCollection = vi.fn(async (_db, key) => {
    if (key === 'samples') return samplesCollection;
    if (key === 'patients') return patientsCollection;
    if (key === 'consents') return consentsCollection;
    if (key === 'quarantineActions') return quarantineActionsCollection;
    throw new Error(`unexpected key ${key}`);
  });

  const auditLoggerModule = require(auditLoggerPath);
  auditLoggerModule.init = vi.fn();
  auditLoggerModule.log = vi.fn().mockResolvedValue(undefined);

  const qualityDomainModule = require(qualityDomainPath);
  qualityDomainModule.resolveMethodologicalQuality = vi.fn(() => ({
    governance_status: 1,
    final_grade: 'A',
    sprec: {},
    score: 90,
  }));

  const sampleServiceModule = require(sampleServicePath);
  vi.spyOn(sampleServiceModule, 'createSample').mockResolvedValue({ _id: 'sample-1', participantId: '12345678' });

  const StorageService = require(storageServicePath);
  vi.spyOn(StorageService.prototype, 'autoAssignSampleToBox').mockResolvedValue({
    success: true,
    sampleLocation: { boxId: 'box-1', position: 'A1' },
  });

  const router = require(routePath);

  const app = express();
  app.use(express.json());
  app.locals.db = {
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
      if (name === 'rcsAssessments') {
        return { insertOne: vi.fn().mockResolvedValue({ insertedId: 'assessment-1' }) };
      }
      throw new Error(`unexpected collection ${name}`);
    },
  };
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

// Each case clears only the modules it mocks; the rest of the two routers'
// module graph loads once, cold, and that load used to land inside the first
// case's 5000 ms budget (1157 ms alone, over 5000 ms under five parallel
// workers, #1297). Compose the app once here, under its own timeout.
beforeAll(() => {
  loadApp({
    consentActive: true,
    samplesCollection: {},
    quarantineActionsCollection: buildQuarantineActionsCollection(),
    patientsCollection: {},
  });
  vi.restoreAllMocks();
  clearCache();
}, 30000);

describe('intake-wizard governance write path (real wrapper + real inner router composed)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    clearCache();
  });

  it('persists specimenStatus="available" and records no QuarantineAction when consent is active and quality allows release', async () => {
    const samplesCollection = {
      insertOne: vi.fn().mockResolvedValue({ insertedId: 'sample-1' }),
      findOne: vi.fn().mockResolvedValue({ _id: 'sample-1', specimenId: 'spec-1', participantId: '12345678', specimenStatus: 'available' }),
      updateOne: vi.fn().mockResolvedValue({ matchedCount: 1 }),
    };
    const quarantineActionsCollection = buildQuarantineActionsCollection();
    const patientsCollection = { updateOne: vi.fn().mockResolvedValue({ matchedCount: 1 }) };

    const app = loadApp({ consentActive: true, samplesCollection, quarantineActionsCollection, patientsCollection });

    const res = await request(app).post('/api/intake-wizard').send(VALID_PAYLOAD);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(samplesCollection.updateOne).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        $set: expect.objectContaining({ specimenStatus: 'available' }),
      })
    );
    expect(quarantineActionsCollection.insertOne).not.toHaveBeenCalled();
  });

  it('persists specimenStatus="quarantined" and records a QuarantineAction when consent is not active (governance-blocked create)', async () => {
    const samplesCollection = {
      insertOne: vi.fn().mockResolvedValue({ insertedId: 'sample-1' }),
      findOne: vi.fn().mockResolvedValue({ _id: 'sample-1', specimenId: 'spec-1', participantId: '12345678', specimenStatus: 'available' }),
      updateOne: vi.fn().mockResolvedValue({ matchedCount: 1 }),
    };
    const quarantineActionsCollection = buildQuarantineActionsCollection();
    const patientsCollection = { updateOne: vi.fn().mockResolvedValue({ matchedCount: 1 }) };

    const app = loadApp({ consentActive: false, samplesCollection, quarantineActionsCollection, patientsCollection });

    const res = await request(app).post('/api/intake-wizard').send(VALID_PAYLOAD);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.consent.active).toBe(false);
    expect(samplesCollection.updateOne).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        $set: expect.objectContaining({ specimenStatus: 'quarantined' }),
      })
    );
    expect(quarantineActionsCollection.insertOne).toHaveBeenCalledTimes(1);
  });
});
