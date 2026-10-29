import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
const request = require('supertest');
const jwt = require('jsonwebtoken');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'vitest-secret-key';

const app = require('../../app');
const sessionService = require('../../src/services/session.service');
const auditLogger = require('../../src/utils/auditLogger');
const { createDbMock } = require('../factories/db.factory');
const { buildRbacCollections } = require('../factories/rbac.factory');
const { createMatchingCollection } = require('../factories/filter.factory');

// #695: /api/diagnostic-reports creates, reads and lists dict-02
// P1X-0168..0174 DiagnosticReports. The createPatient gate on POST is proved
// by tests/rbac-pins/diagnostic-report.pins.js in rbac-gate-pins.test.js;
// these cases prove the handlers: the server-assigned id, the 422 refusals
// with `details` (RNF018), and the #626 out-of-scope 403.

const RBAC_TEST_USERS = [{ userAccountId: 'qa-coord-1', accessType: 3 }];

const IN_SCOPE_PATIENT = { participantId: '12345678', clinicalUnitId: 'test-org-default' };
const OTHER_ORG_PATIENT = { participantId: '87654321', clinicalUnitId: 'other-org' };

function seeded(docs = []) {
  return Object.assign(createMatchingCollection(docs), { createIndex: vi.fn().mockResolvedValue(null) });
}

function buildDb({ diagnosticReports = [], clinicalObservations = [] } = {}) {
  const collections = {
    patients: seeded([IN_SCOPE_PATIENT, OTHER_ORG_PATIENT]),
    diagnosticReports: seeded(diagnosticReports),
    clinicalObservations: seeded(clinicalObservations),
  };
  return {
    db: createDbMock({ ...collections, ...buildRbacCollections(RBAC_TEST_USERS) }),
    reports: collections.diagnosticReports,
  };
}

function coordinatorToken() {
  return jwt.sign(
    { userID: 'qa-coord-1', accessType: 3, roleName: 'Coordenador', name: 'QA Coordenador', mfaVerified: true },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
}

function storedReport(overrides = {}) {
  return {
    diagnosticReportId: 'dr-1',
    participantId: IN_SCOPE_PATIENT.participantId,
    encounterId: null,
    reportStatus: 'final',
    issuedDateTime: null,
    resultIds: [],
    documentUri: null,
    ...overrides,
  };
}

const OUT_OF_SCOPE_BODY = {
  success: false,
  error: 'Acesso negado',
  message: 'Este paciente pertence a outra organização',
};

describe('/api/diagnostic-reports (#695)', () => {
  beforeEach(() => {
    vi.spyOn(sessionService, 'verifySession').mockResolvedValue({
      valid: true,
      session: { sessionID: 'session-test-1', userID: 'qa-coord-1' },
    });
    vi.spyOn(sessionService, 'updateActivity').mockResolvedValue({ sessionID: 'session-test-1' });
    vi.spyOn(auditLogger, 'init').mockImplementation(() => undefined);
    vi.spyOn(auditLogger, 'log').mockResolvedValue(undefined);
    vi.spyOn(auditLogger, 'logError').mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('answers 401 without a token', async () => {
    app.locals.db = buildDb().db;

    const response = await request(app).get('/api/diagnostic-reports?participantId=12345678');

    expect(response.status).toBe(401);
  });

  describe('POST /', () => {
    it('stores the report under a generated id, ignoring a body diagnosticReportId', async () => {
      const { db, reports } = buildDb();
      app.locals.db = db;

      const response = await request(app)
        .post('/api/diagnostic-reports')
        .set('Authorization', `Bearer ${coordinatorToken()}`)
        .send({ diagnosticReportId: 'dr-chosen-by-client', participantId: '12345678', reportStatus: 'final', extra: 'x' });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data.diagnosticReportId).toMatch(/^[0-9a-f-]{36}$/);
      expect(response.body.data.diagnosticReportId).not.toBe('dr-chosen-by-client');
      expect(response.body.data).not.toHaveProperty('extra');
      expect(reports.docs).toHaveLength(1);
      expect(reports.docs[0].diagnosticReportId).toBe(response.body.data.diagnosticReportId);
      expect(reports.docs[0].participantId).toBe('12345678');
    });

    it('answers 422 with a details list and stores nothing when reportStatus is missing', async () => {
      const { db, reports } = buildDb();
      app.locals.db = db;

      const response = await request(app)
        .post('/api/diagnostic-reports')
        .set('Authorization', `Bearer ${coordinatorToken()}`)
        .send({ participantId: '12345678' });

      expect(response.status).toBe(422);
      expect(response.body.details).toEqual(['reportStatus é obrigatório para DiagnosticReport']);
      expect(reports.docs).toHaveLength(0);
    });

    it('answers 422 with a details list and stores nothing when a resultId resolves to no clinical observation', async () => {
      const { db, reports } = buildDb();
      app.locals.db = db;

      const response = await request(app)
        .post('/api/diagnostic-reports')
        .set('Authorization', `Bearer ${coordinatorToken()}`)
        .send({ participantId: '12345678', reportStatus: 'final', resultIds: ['  obs-missing'] });

      expect(response.status).toBe(422);
      expect(Array.isArray(response.body.details)).toBe(true);
      expect(response.body.details).toHaveLength(1);
      expect(response.body.details[0]).toMatch(/resultIds\[0\]="obs-missing"/);
      expect(reports.docs).toHaveLength(0);
    });

    it('stores a trimmed resultId that resolves to a real clinical observation', async () => {
      const { db, reports } = buildDb({ clinicalObservations: [{ observationId: 'obs-1' }] });
      app.locals.db = db;

      const response = await request(app)
        .post('/api/diagnostic-reports')
        .set('Authorization', `Bearer ${coordinatorToken()}`)
        .send({ participantId: '12345678', reportStatus: 'final', resultIds: [' obs-1 '] });

      expect(response.status).toBe(201);
      expect(response.body.data.resultIds).toEqual(['obs-1']);
      expect(reports.docs).toHaveLength(1);
    });

    it('answers 422 and stores nothing when resultIds is a string, not a list', async () => {
      const { db, reports } = buildDb();
      app.locals.db = db;

      const response = await request(app)
        .post('/api/diagnostic-reports')
        .set('Authorization', `Bearer ${coordinatorToken()}`)
        .send({ participantId: '12345678', reportStatus: 'final', resultIds: 'obs-missing' });

      expect(response.status).toBe(422);
      expect(response.body.details).toEqual(['resultIds deve ser uma lista']);
      expect(reports.docs).toHaveLength(0);
    });

    it('answers 422 and stores nothing when reportStatus is an object, not text', async () => {
      const { db, reports } = buildDb();
      app.locals.db = db;

      const response = await request(app)
        .post('/api/diagnostic-reports')
        .set('Authorization', `Bearer ${coordinatorToken()}`)
        .send({ participantId: '12345678', reportStatus: { a: 1 } });

      expect(response.status).toBe(422);
      expect(response.body.details).toEqual(['reportStatus deve ser texto']);
      expect(reports.docs).toHaveLength(0);
    });

    it('answers 422 and stores nothing when issuedDateTime does not parse to a date', async () => {
      const { db, reports } = buildDb();
      app.locals.db = db;

      const response = await request(app)
        .post('/api/diagnostic-reports')
        .set('Authorization', `Bearer ${coordinatorToken()}`)
        .send({ participantId: '12345678', reportStatus: 'final', issuedDateTime: 'not-a-date' });

      expect(response.status).toBe(422);
      expect(response.body.details).toEqual(['issuedDateTime inválido']);
      expect(reports.docs).toHaveLength(0);
    });

    it('answers 403 and stores nothing for a patient of another organization', async () => {
      const { db, reports } = buildDb();
      app.locals.db = db;

      const response = await request(app)
        .post('/api/diagnostic-reports')
        .set('Authorization', `Bearer ${coordinatorToken()}`)
        .send({ participantId: OTHER_ORG_PATIENT.participantId, reportStatus: 'final' });

      expect(response.status).toBe(403);
      expect(response.body).toEqual(OUT_OF_SCOPE_BODY);
      expect(reports.docs).toHaveLength(0);
    });
  });

  describe('GET /:diagnosticReportId', () => {
    it('answers 200 with the report', async () => {
      app.locals.db = buildDb({ diagnosticReports: [storedReport()] }).db;

      const response = await request(app)
        .get('/api/diagnostic-reports/dr-1')
        .set('Authorization', `Bearer ${coordinatorToken()}`);

      expect(response.status).toBe(200);
      expect(response.body.data.diagnosticReportId).toBe('dr-1');
      expect(response.body.data.reportStatus).toBe('final');
    });

    it('answers 404 for an unknown id', async () => {
      app.locals.db = buildDb({ diagnosticReports: [storedReport()] }).db;

      const response = await request(app)
        .get('/api/diagnostic-reports/dr-unknown')
        .set('Authorization', `Bearer ${coordinatorToken()}`);

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Registro não encontrado');
    });

    it('answers 403 for a report whose participant is of another organization', async () => {
      app.locals.db = buildDb({
        diagnosticReports: [storedReport({ diagnosticReportId: 'dr-other', participantId: OTHER_ORG_PATIENT.participantId })],
      }).db;

      const response = await request(app)
        .get('/api/diagnostic-reports/dr-other')
        .set('Authorization', `Bearer ${coordinatorToken()}`);

      expect(response.status).toBe(403);
      expect(response.body).toEqual(OUT_OF_SCOPE_BODY);
    });
  });

  describe('GET /?participantId=', () => {
    it('answers 400 without a participantId', async () => {
      app.locals.db = buildDb({ diagnosticReports: [storedReport()] }).db;

      const response = await request(app)
        .get('/api/diagnostic-reports')
        .set('Authorization', `Bearer ${coordinatorToken()}`);

      expect(response.status).toBe(400);
      expect(response.body.data).toBeUndefined();
    });

    it('answers 200 with only that participant\'s reports', async () => {
      app.locals.db = buildDb({
        diagnosticReports: [
          storedReport({ diagnosticReportId: 'dr-1' }),
          storedReport({ diagnosticReportId: 'dr-2' }),
          storedReport({ diagnosticReportId: 'dr-3', participantId: '11112222' }),
        ],
      }).db;

      const response = await request(app)
        .get('/api/diagnostic-reports?participantId=12345678')
        .set('Authorization', `Bearer ${coordinatorToken()}`);

      expect(response.status).toBe(200);
      expect(response.body.data.map((report) => report.diagnosticReportId).sort()).toEqual(['dr-1', 'dr-2']);
    });

    it('answers 403 for a participant of another organization', async () => {
      app.locals.db = buildDb({
        diagnosticReports: [storedReport({ diagnosticReportId: 'dr-other', participantId: OTHER_ORG_PATIENT.participantId })],
      }).db;

      const response = await request(app)
        .get(`/api/diagnostic-reports?participantId=${OTHER_ORG_PATIENT.participantId}`)
        .set('Authorization', `Bearer ${coordinatorToken()}`);

      expect(response.status).toBe(403);
      expect(response.body).toEqual(OUT_OF_SCOPE_BODY);
    });
  });
});
