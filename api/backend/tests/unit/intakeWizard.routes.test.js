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
const routePath = require.resolve('../../src/routes/intakeWizard.js');

const allPaths = [
  notificationServicePath,
  patientIdentityServicePath,
  merkleServicePath,
  collectionResolverPath,
  auditLoggerPath,
  qualityDomainPath,
  routePath,
];

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

  const router = require(routePath);
  return { router, notificationServiceModule, patientIdentityServiceModule, merkleServiceModule, collectionResolverModule, auditLoggerModule, qualityDomainModule };
}

function buildApp(router, db = {}) {
  const app = express();
  app.use(express.json());
  app.locals.db = db;
  app.use('/api/intake-wizard', router);
  return app;
}

const VALID_PAYLOAD = {
  demographic: { patientName: 'Paciente Teste', participantId: '12345678', email: 'paciente@example.test' },
  consent: { tcle_template_id: 'template-1' },
  sample: { sampleType: 'Sangue', sampleOrigin: 'Hospital A', extractionProtocol: 'EDTA', quantity: 2 },
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

    it('returns 400 when the consent email cannot be sent because templateId is missing', async () => {
      const { router } = loadRoute();
      const app = buildApp(router, {});
      const { consent, ...withoutConsent } = VALID_PAYLOAD;

      const res = await request(app).post('/api/intake-wizard').send(withoutConsent);

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/TCLE/);
    });

    it('returns 502 when the consent email provider fails', async () => {
      const sendConsentEmail = vi.fn().mockResolvedValue({ success: false });
      const { router } = loadRoute({ sendConsentEmail });
      const app = buildApp(router, {});

      const res = await request(app).post('/api/intake-wizard').send(VALID_PAYLOAD);

      expect(res.status).toBe(502);
    });

    it('happy path: persists the sample, links the patient, and returns 200', async () => {
      const insertOne = vi.fn().mockResolvedValue({ insertedId: 'sample-1' });
      const findOne = vi.fn().mockResolvedValue({ _id: 'sample-1', patientID: '12345678' });
      const samplesCollection = { insertOne, findOne };
      const updateOne = vi.fn().mockResolvedValue({ matchedCount: 1 });
      const patientsCollection = { updateOne };

      const getCollectionImpl = vi.fn(async (_db, key) => {
        if (key === 'samples') return samplesCollection;
        if (key === 'patients') return patientsCollection;
        throw new Error(`unexpected key ${key}`);
      });

      const { router, auditLoggerModule } = loadRoute({ getCollectionImpl });
      const app = buildApp(router, {});

      const res = await request(app).post('/api/intake-wizard').send(VALID_PAYLOAD);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.patientMatch.patientID).toBe('12345678');
      expect(res.body.qualityAssessment.score).toBe(80);
      expect(insertOne).toHaveBeenCalledTimes(1);
      expect(updateOne).toHaveBeenCalledWith(
        { _id: 'patient-obj-1' },
        expect.objectContaining({ $addToSet: { linkedSampleIds: 'sample-1' } })
      );
      expect(auditLoggerModule.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'PATIENT_MATCH_UPSERT' })
      );
    });

    it('returns 502 when persisting the sample throws', async () => {
      const getCollectionImpl = vi.fn().mockRejectedValue(new Error('db down'));
      const { router } = loadRoute({ getCollectionImpl });
      const app = buildApp(router, {});

      const res = await request(app).post('/api/intake-wizard').send(VALID_PAYLOAD);

      expect(res.status).toBe(502);
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

    it('returns matched:false when no patient is found by patientID', async () => {
      const findOne = vi.fn().mockResolvedValue(null);
      const getCollectionImpl = vi.fn().mockResolvedValue({ findOne });
      const { router } = loadRoute({ getCollectionImpl });
      const app = buildApp(router, {});

      const res = await request(app).get('/api/intake-wizard/patient-match').query({ patientID: '12345678' });

      expect(res.status).toBe(200);
      expect(res.body.matched).toBe(false);
      expect(res.body.patient).toBeNull();
    });

    it('returns matched:true with the patient data when found', async () => {
      const findOne = vi.fn().mockResolvedValue({
        patientID: '12345678',
        patientName: 'Paciente Teste',
        birthDate: '2000-01-01',
        status: 'ACTIVE',
      });
      const getCollectionImpl = vi.fn().mockResolvedValue({ findOne });
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
      const findOne = vi.fn().mockResolvedValue(null);
      const getCollectionImpl = vi.fn().mockResolvedValue({ findOne });
      const { router } = loadRoute({ getCollectionImpl });
      const app = buildApp(router, {});

      const res = await request(app)
        .get('/api/intake-wizard/patient-match')
        .query({ patientName: 'João Ção', birthDate: '01/02/2000' });

      expect(res.status).toBe(200);
      expect(findOne).toHaveBeenCalledWith(
        expect.objectContaining({ patientNameNormalized: 'joao cao', birthDateKey: '2000-02-01' }),
        expect.anything()
      );
    });

    it('returns 500 when the query throws', async () => {
      const getCollectionImpl = vi.fn().mockRejectedValue(new Error('db down'));
      const { router } = loadRoute({ getCollectionImpl });
      const app = buildApp(router, {});

      const res = await request(app).get('/api/intake-wizard/patient-match').query({ patientID: '12345678' });

      expect(res.status).toBe(500);
    });
  });
});
