import { test, expect } from '@playwright/test';
import { MongoClient, Db } from 'mongodb';
import { realLogin } from './helpers/realAuth';
import { createRealParticipant, closeSeedDb } from './helpers/seedParticipant';
import { watchAuditTrail, assertAuditEventRecorded } from './helpers/assertAuditEvent';

// #695: /api/diagnostic-reports creates, reads and lists dict-02
// P1X-0168..0174 DiagnosticReports. diagnostic-report.routes.api.test.js
// proves the handlers against a mocked db; this spec proves the same routes
// against the real stack, reading the persisted row from Mongo, because the
// stored document is what a later Condition, PhenotypeObservation or
// ClinicalObservation reference resolves against. The out-of-scope 403 stays
// with the mocked test: the real admin's scope admits every participant.
const apiBaseURL = process.env.PLAYWRIGHT_API_BASE_URL;
const mongoUri = process.env.E2E_MONGO_URI || 'mongodb://localhost:27017?directConnection=true';
const mongoDbName = process.env.E2E_MONGO_DB || 'bioavanced_test';

// collections.js: CANONICAL_COLLECTIONS.diagnosticReports and
// CANONICAL_COLLECTIONS.clinicalObservations.
const REPORTS = 'diagnosticReports';
const OBSERVATIONS = 'clinicalObservations';

test.skip(!apiBaseURL, 'PLAYWRIGHT_API_BASE_URL not set -- run via npm run test:e2e:docker');

let client: MongoClient | null = null;
let db: Db;
let token: string;
let participantId: string;
let createdReportId: string;
let reportWithResultsId: string;
const createdReportIds: string[] = [];
const seededObservationIds: string[] = [];

test.describe('/api/diagnostic-reports (#695) — real backend', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async ({ request }) => {
    ({ token } = await realLogin(request));
    ({ participantId } = await createRealParticipant(request, apiBaseURL!, token));
    client = new MongoClient(mongoUri, { serverSelectionTimeoutMS: 10_000 });
    await client.connect();
    db = client.db(mongoDbName);
  });

  test.afterAll(async () => {
    if (client) {
      if (createdReportIds.length) {
        await db.collection(REPORTS).deleteMany({ diagnosticReportId: { $in: createdReportIds } });
      }
      if (seededObservationIds.length) {
        await db.collection(OBSERVATIONS).deleteMany({ observationId: { $in: seededObservationIds } });
      }
      await client.close();
      client = null;
    }
    // The participant stays, as in every spec that calls createRealParticipant.
    await closeSeedDb();
  });

  function auth() {
    return { Authorization: `Bearer ${token}` };
  }

  function countReports(): Promise<number> {
    return db.collection(REPORTS).countDocuments({ participantId });
  }

  test('answers 401 without a token', async ({ request }) => {
    const response = await request.get(`${apiBaseURL}/api/diagnostic-reports?participantId=${participantId}`);

    expect(response.status()).toBe(401);
  });

  test('POST stores the report under a server-assigned id and audits it', async ({ request }) => {
    const watch = await watchAuditTrail(request, apiBaseURL!, token);
    const issuedDateTime = '2026-10-01T10:00:00.000Z';

    const response = await request.post(`${apiBaseURL}/api/diagnostic-reports`, {
      headers: auth(),
      data: {
        diagnosticReportId: 'dr-chosen-by-client',
        participantId,
        reportStatus: 'final',
        issuedDateTime,
        documentUri: 'https://example.org/report.pdf',
        extra: 'x',
      },
    });

    expect(response.status()).toBe(201);
    const body = await response.json();
    createdReportId = body.data.diagnosticReportId;
    if (createdReportId) createdReportIds.push(createdReportId);
    expect(createdReportId).toMatch(/^[0-9a-f-]{36}$/);
    expect(createdReportId).not.toBe('dr-chosen-by-client');
    expect(body.data).not.toHaveProperty('extra');

    const rows = await db.collection(REPORTS).find({ diagnosticReportId: createdReportId }).toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0].participantId).toBe(participantId);
    expect(rows[0].reportStatus).toBe('final');
    expect(rows[0].issuedDateTime).toBeInstanceOf(Date);
    expect((rows[0].issuedDateTime as Date).toISOString()).toBe(issuedDateTime);

    await assertAuditEventRecorded(request, apiBaseURL!, token, watch);
  });

  test('POST stores a resultIds entry that resolves to a clinical observation', async ({ request }) => {
    const observationId = `e2e-695-obs-${Date.now()}`;
    // #906: a reference stub, not ClinicalObservation-model-clean on purpose.
    // assertReferencesExist resolves resultIds via findOne on observationId
    // and reads nothing else -- the same rationale as seedRawSpecimen.
    await db.collection(OBSERVATIONS).insertOne({ observationId, participantId, createdAt: new Date() });
    seededObservationIds.push(observationId);

    const response = await request.post(`${apiBaseURL}/api/diagnostic-reports`, {
      headers: auth(),
      data: { participantId, reportStatus: 'final', resultIds: [observationId] },
    });

    expect(response.status()).toBe(201);
    const body = await response.json();
    reportWithResultsId = body.data.diagnosticReportId;
    if (reportWithResultsId) createdReportIds.push(reportWithResultsId);

    const row = await db.collection(REPORTS).findOne({ diagnosticReportId: reportWithResultsId });
    expect(row).not.toBeNull();
    expect(row!.resultIds).toEqual([observationId]);
  });

  test('POST refuses an unresolved resultIds entry with 422 and stores nothing', async ({ request }) => {
    const before = await countReports();

    const response = await request.post(`${apiBaseURL}/api/diagnostic-reports`, {
      headers: auth(),
      data: { participantId, reportStatus: 'final', resultIds: [`e2e-695-missing-${Date.now()}`] },
    });

    expect(response.status()).toBe(422);
    const body = await response.json();
    expect(Array.isArray(body.details)).toBe(true);
    expect(body.details).toHaveLength(1);
    expect(body.details[0]).toMatch(/resultIds\[0\]="e2e-695-missing-/);
    expect(await countReports()).toBe(before);
  });

  test('POST refuses a missing reportStatus with 422 and stores nothing', async ({ request }) => {
    const before = await countReports();

    const response = await request.post(`${apiBaseURL}/api/diagnostic-reports`, {
      headers: auth(),
      data: { participantId },
    });

    expect(response.status()).toBe(422);
    const body = await response.json();
    expect(body.details).toEqual(['reportStatus é obrigatório para DiagnosticReport']);
    expect(await countReports()).toBe(before);
  });

  test('GET /:diagnosticReportId reads a stored report and answers 404 for an unknown id', async ({ request }) => {
    const response = await request.get(`${apiBaseURL}/api/diagnostic-reports/${createdReportId}`, { headers: auth() });

    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.data.diagnosticReportId).toBe(createdReportId);
    expect(body.data.participantId).toBe(participantId);
    expect(body.data.reportStatus).toBe('final');

    const unknown = await request.get(`${apiBaseURL}/api/diagnostic-reports/e2e-695-unknown-${Date.now()}`, {
      headers: auth(),
    });
    expect(unknown.status()).toBe(404);
  });

  test('GET ?participantId= lists the participant\'s reports and answers 400 without it', async ({ request }) => {
    const response = await request.get(`${apiBaseURL}/api/diagnostic-reports?participantId=${participantId}`, {
      headers: auth(),
    });

    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(Array.isArray(body.data)).toBe(true);
    const ids = (body.data as Array<{ diagnosticReportId: string }>).map((report) => report.diagnosticReportId);
    expect(ids).toEqual(expect.arrayContaining([createdReportId, reportWithResultsId]));
    for (const report of body.data as Array<{ participantId: string }>) {
      expect(report.participantId).toBe(participantId);
    }

    const missing = await request.get(`${apiBaseURL}/api/diagnostic-reports`, { headers: auth() });
    expect(missing.status()).toBe(400);
  });
});
