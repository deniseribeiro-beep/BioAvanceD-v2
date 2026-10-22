import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
const request = require('supertest');
const jwt = require('jsonwebtoken');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'vitest-secret-key';

const app = require('../../app');
const sessionService = require('../../src/services/session.service');
const { createCollectionMock, createDbMock } = require('../factories/db.factory');
const { createMatchingCollection } = require('../factories/filter.factory');
const { buildRbacCollections } = require('../factories/rbac.factory');
const { createFakeCollection } = require('../unit/ingestion/testHelpers');
const auditLogger = require('../../src/utils/auditLogger');

// RF029 (#1318): POST /api/ingestion/records through the mounted app, with a
// Coordenador (role 3) caller and a transaction-capable db mock.

const USER = 'ingest-coord';
const TECNICO = 'ingest-tecnico';

function token({ userID = USER, accessType = 3, roleName = 'Coordenador' } = {}) {
  return jwt.sign(
    { userID, accessType, roleName, name: 'QA', mfaVerified: true },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
}

let auditLog;
beforeEach(() => {
  vi.spyOn(sessionService, 'verifySession').mockResolvedValue({ valid: true, session: { sessionID: 'sess-ingest' } });
  vi.spyOn(sessionService, 'updateActivity').mockResolvedValue({ sessionID: 'sess-ingest' });
  auditLog = vi.spyOn(auditLogger, 'log').mockResolvedValue(undefined);
});
afterEach(() => { vi.restoreAllMocks(); });

// RF029 AC10: the one INGESTION_* audit row the route writes per request.
function ingestionAuditRows() {
  return auditLog.mock.calls.map(([entry]) => entry).filter((entry) => String(entry.action).startsWith('INGESTION_'));
}

function givenDb({ extraUsers = [], releaseStatus = 'active' } = {}) {
  const stores = {
    canonicalModelReleases: createMatchingCollection([{ canonicalModelReleaseId: 'release-2.0.0', releaseStatus }]),
    security_config: createMatchingCollection([{ _id: 'main', configurationReleaseId: 'cfg-release-7' }]),
    datasets: createMatchingCollection([]),
    omicsQualifications: createMatchingCollection([]),
    ingestionQuarantineRecords: createMatchingCollection([]),
    ingestionIdempotencyKeys: createFakeCollection([]),
    missingDataReasons: createMatchingCollection([]),
    dataQualityAssessments: createMatchingCollection([]),
    graph_projection_outbox: createCollectionMock(),
  };
  app.locals.db = createDbMock({ ...stores, ...buildRbacCollections([{ userAccountId: USER, accessType: 3 }, ...extraUsers]) });
  return stores;
}

const PROVENANCE = {
  sourceSystem: 'urn:system:lims',
  retrievedAt: '2026-10-01T12:00:00.000Z',
  purpose: 'operational_registration',
  sourceRecordId: 'LIMS-DS-42',
};
const DATASET = { datasetTitle: 'Coorte A', datasetVersion: '1.0', creators: ['Equipe A'], license: 'CC-BY-4.0' };
const OMICS_QUALIFICATION = { targetAssay: 'assay-wgs-1', qcRuleSetVersion: 'qc-1.0', qcMetrics: [{ name: 'q30', value: 0.92 }], qualificationDecision: 'eligible' };

function post(body, caller) {
  return request(app).post('/api/ingestion/records').set('Authorization', `Bearer ${token(caller)}`).send(body);
}

// RF029 AC10: a 401 or 403 never reaches the route, so its audit row is the
// global auditRequest one, written in a setImmediate after the response.
function accessDenialRow(action, statusCode) {
  return expect.objectContaining({ action, payload: expect.objectContaining({ path: '/api/ingestion/records', statusCode }) });
}

describe('POST /api/ingestion/records (RF029, #1318)', () => {
  it('201: an accepted Dataset is persisted with its outbox event in one session', async () => {
    const stores = givenDb();

    const res = await post({ entityType: 'Dataset', payload: DATASET, provenance: PROVENANCE });

    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({ success: true, status: 'accepted', entityType: 'Dataset', canonicalModelReleaseId: 'release-2.0.0', configurationReleaseId: 'cfg-release-7' });
    expect(stores.datasets.docs).toHaveLength(1);
    expect(stores.datasets.docs[0]).toMatchObject({ datasetId: res.body.entityId, createdBy: `Actor/${USER}` });
    // RNF011 C3: the record's DataQualityAssessment is named in the body.
    expect(stores.dataQualityAssessments.docs.map((d) => [d.dataQualityAssessmentId, d.scopeId])).toEqual([[res.body.dataQualityAssessmentId, `Dataset/${res.body.entityId}`]]);
    const session = app.locals.db.session;
    expect(stores.datasets.insertOne).toHaveBeenCalledWith(expect.any(Object), { session });
    const appended = stores.graph_projection_outbox.updateOne.mock.calls.find(([, update]) => update?.$setOnInsert?.eventType === 'INGESTION_RECORD_PERSISTED');
    expect(appended[1].$setOnInsert).toMatchObject({ aggregateType: 'Dataset', aggregateId: res.body.entityId, canonicalModelReleaseId: 'release-2.0.0' });
    expect(appended[2]).toEqual({ upsert: true, session });
    expect(ingestionAuditRows()).toEqual([expect.objectContaining({
      action: 'INGESTION_ACCEPTED',
      severity: 'info',
      status: 'success',
      resourceType: 'Dataset',
      resourceId: res.body.entityId,
      payload: expect.objectContaining({ canonicalModelReleaseId: 'release-2.0.0', configurationReleaseId: 'cfg-release-7' }),
    })]);
  });

  it('201: a declared MissingDataReason is stored in the session and named in the body (RF029 AC7)', async () => {
    const stores = givenDb();

    const res = await post({ entityType: 'Dataset', payload: DATASET, provenance: PROVENANCE, missingDataReasons: [{ fieldPath: 'doi', reasonCode: 'not_collected' }] });

    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const rows = stores.missingDataReasons.docs;
    expect(rows.map((r) => [r.fieldPath, r.reasonCode])).toEqual([['doi', 'not_collected'], ['distributionFiles', 'unknown'], ['roCrateManifest', 'unknown']]);
    expect(rows.every((r) => r.entityType === 'Dataset' && r.entityId === res.body.entityId && r.canonicalModelReleaseId === 'release-2.0.0')).toBe(true);
    expect(stores.missingDataReasons.insertOne).toHaveBeenCalledWith(expect.any(Object), { session: app.locals.db.session });
    expect(res.body.missingDataReasons).toEqual(rows.map(({ missingDataReasonId, fieldPath, reasonCode }) => ({ missingDataReasonId, fieldPath, reasonCode })));
  });

  it('201: an accepted OmicsQualification is persisted with its outbox event in one session and one INGESTION_ACCEPTED row (RF029 AC10)', async () => {
    const stores = givenDb();

    const res = await post({ entityType: 'OmicsQualification', payload: OMICS_QUALIFICATION, provenance: PROVENANCE });

    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({ success: true, status: 'accepted', entityType: 'OmicsQualification' });
    expect(stores.omicsQualifications.docs.map((d) => d.omicsQualificationId)).toEqual([res.body.entityId]);
    const session = app.locals.db.session;
    expect(stores.omicsQualifications.insertOne).toHaveBeenCalledWith(expect.any(Object), { session });
    const appended = stores.graph_projection_outbox.updateOne.mock.calls.find(([, update]) => update?.$setOnInsert?.eventType === 'INGESTION_RECORD_PERSISTED');
    expect(appended[1].$setOnInsert).toMatchObject({ aggregateType: 'OmicsQualification', aggregateId: res.body.entityId });
    expect(ingestionAuditRows()).toEqual([expect.objectContaining({
      action: 'INGESTION_ACCEPTED',
      resourceType: 'OmicsQualification',
      resourceId: res.body.entityId,
    })]);
  });

  it('422: an OmicsQualification without qcRuleSetVersion quarantines, persists no document, and writes one INGESTION_QUARANTINED row', async () => {
    const stores = givenDb();
    const { qcRuleSetVersion, ...withoutQcRuleSetVersion } = OMICS_QUALIFICATION;

    const res = await post({ entityType: 'OmicsQualification', payload: withoutQcRuleSetVersion, provenance: PROVENANCE });

    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ success: false, error: 'INGESTION_QUARANTINED' });
    expect(stores.omicsQualifications.docs).toHaveLength(0);
    expect(ingestionAuditRows()).toEqual([expect.objectContaining({
      action: 'INGESTION_QUARANTINED',
      resourceType: 'OmicsQualification',
      resourceId: res.body.ingestionQuarantineRecordId,
    })]);
  });

  it('422: a missing provenance field quarantines, with details and the quarantine record id', async () => {
    const stores = givenDb();

    const res = await post({ entityType: 'Dataset', payload: DATASET, provenance: { ...PROVENANCE, purpose: undefined } });

    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ success: false, error: 'INGESTION_QUARANTINED' });
    expect(res.body.details).toEqual(['provenance.purpose é obrigatório']);
    expect(res.body.ingestionQuarantineRecordId).toBe(stores.ingestionQuarantineRecords.docs[0].ingestionQuarantineRecordId);
    expect(stores.dataQualityAssessments.docs.map((d) => [d.dataQualityAssessmentId, d.scopeId]))
      .toEqual([[res.body.dataQualityAssessmentId, `IngestionQuarantineRecord/${res.body.ingestionQuarantineRecordId}`]]);
    expect(stores.datasets.docs).toHaveLength(0);
    expect(ingestionAuditRows()).toEqual([expect.objectContaining({
      action: 'INGESTION_QUARANTINED',
      severity: 'warning',
      status: 'warning',
      resourceId: res.body.ingestionQuarantineRecordId,
      payload: expect.objectContaining({ violationCount: 1, canonicalModelReleaseId: 'release-2.0.0', configurationReleaseId: 'cfg-release-7' }),
    })]);
  });

  it('422: a quarantined record retried with the same key answers as the first call did, and audits the replay', async () => {
    const stores = givenDb();
    const body = { entityType: 'Dataset', payload: DATASET, provenance: { ...PROVENANCE, purpose: undefined }, idempotencyKey: 'key-q' };

    const first = await post(body);
    const second = await post(body);

    expect(first.status).toBe(422);
    expect(second.status).toBe(422);
    expect(second.body).toEqual({
      success: false,
      error: 'INGESTION_QUARANTINED',
      message: first.body.message,
      details: ['provenance.purpose é obrigatório'],
      ingestionQuarantineRecordId: first.body.ingestionQuarantineRecordId,
    });
    expect(stores.ingestionQuarantineRecords.docs).toHaveLength(1);
    expect(ingestionAuditRows()[1]).toEqual(expect.objectContaining({
      action: 'INGESTION_REPLAYED',
      severity: 'warning',
      status: 'warning',
      resourceId: first.body.ingestionQuarantineRecordId,
      payload: expect.objectContaining({ status: 'idempotent_replay', outcome: 'quarantined', violationCount: 1, canonicalModelReleaseId: 'release-2.0.0', configurationReleaseId: 'cfg-release-7' }),
    }));
  });

  it('500: a failing persist is refused and audited as an error, with the releases in force', async () => {
    const stores = givenDb();
    stores.datasets.insertOne.mockRejectedValue(new Error('disk full'));

    const res = await post({ entityType: 'Dataset', payload: DATASET, provenance: PROVENANCE });

    expect(res.status).toBe(500);
    expect(res.body).toMatchObject({ success: false, error: 'INGESTION_FAILED' });
    expect(ingestionAuditRows()).toEqual([expect.objectContaining({
      action: 'INGESTION_REFUSED',
      severity: 'error',
      status: 'error',
      payload: expect.objectContaining({ canonicalModelReleaseId: 'release-2.0.0', configurationReleaseId: 'cfg-release-7' }),
    })]);
  });

  it('422: an unsupported entityType is refused with details and nothing written', async () => {
    const stores = givenDb();

    const res = await post({ entityType: 'Telemetry', payload: {}, provenance: PROVENANCE });

    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ success: false, error: 'INGESTION_TARGET_UNSUPPORTED' });
    expect(res.body.details).toEqual([expect.stringContaining('Telemetry')]);
    expect(stores.ingestionQuarantineRecords.docs).toHaveLength(0);
    expect(stores.datasets.docs).toHaveLength(0);
    // Refused before the releases are read, so the row names none.
    expect(ingestionAuditRows()).toEqual([expect.objectContaining({
      action: 'INGESTION_REFUSED',
      severity: 'warning',
      status: 'warning',
      resourceType: 'Telemetry',
      payload: expect.objectContaining({ canonicalModelReleaseId: null, configurationReleaseId: null }),
    })]);
  });

  it('401 without a token', async () => {
    givenDb();

    const res = await request(app).post('/api/ingestion/records').send({ entityType: 'Dataset', payload: DATASET, provenance: PROVENANCE });

    expect(res.status).toBe(401);
    // RF029 AC10: the access denial is audited, and the route writes no row.
    await vi.waitFor(() => expect(auditLog).toHaveBeenCalledWith(accessDenialRow('UNAUTHORIZED', 401)));
    expect(ingestionAuditRows()).toEqual([]);
  });

  it('403: a Técnico (role 2) is refused by requireRole, audited as FORBIDDEN, and nothing is written (RF029 AC10)', async () => {
    const stores = givenDb({ extraUsers: [{ userAccountId: TECNICO, accessType: 2 }] });

    const res = await post({ entityType: 'Dataset', payload: DATASET, provenance: PROVENANCE }, { userID: TECNICO, accessType: 2, roleName: 'Técnico' });

    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(res.body.error).toBe('Acesso negado');
    expect(stores.datasets.docs).toHaveLength(0);
    expect(stores.ingestionQuarantineRecords.docs).toHaveLength(0);
    await vi.waitFor(() => expect(auditLog).toHaveBeenCalledWith(accessDenialRow('FORBIDDEN', 403)));
    expect(ingestionAuditRows()).toEqual([]);
  });

  it('503: a canonical release that is not active is refused, audited as a warning, and nothing is written (RF029 AC10)', async () => {
    const stores = givenDb({ releaseStatus: 'draft' });

    const res = await post({ entityType: 'Dataset', payload: DATASET, provenance: PROVENANCE });

    expect(res.status, JSON.stringify(res.body)).toBe(503);
    expect(res.body).toMatchObject({ success: false, error: 'CANONICAL_RELEASE_NOT_ACTIVE' });
    expect(stores.datasets.docs).toHaveLength(0);
    expect(stores.ingestionQuarantineRecords.docs).toHaveLength(0);
    expect(ingestionAuditRows()).toEqual([expect.objectContaining({
      action: 'INGESTION_REFUSED',
      severity: 'warning',
      status: 'warning',
      resourceType: 'Dataset',
    })]);
  });
});
