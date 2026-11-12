import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { ObjectId } = require('mongodb');

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

// #1318: a Specimen needs a known participant with an active consent.
const CONSENTED_PARTICIPANT = '12345678';
const UNCONSENTED_PARTICIPANT = '23456789';
// #1318: a Participant needs a known consent template.
const TEMPLATE_HEX = '64b7f0c2a1b2c3d4e5f60718';

function givenDb({ extraUsers = [], releaseStatus = 'active' } = {}) {
  const stores = {
    canonicalModelReleases: createMatchingCollection([{ canonicalModelReleaseId: 'release-2.0.0', releaseStatus }]),
    security_config: createMatchingCollection([{ _id: 'main', configurationReleaseId: 'cfg-release-7' }]),
    datasets: createMatchingCollection([]),
    omicsQualifications: createMatchingCollection([]),
    assays: createMatchingCollection([]),
    omicsRuns: createMatchingCollection([]),
    samples: createMatchingCollection([{ specimenId: 'SPC-1', specimenStatus: 'available' }]),
    protocols: createMatchingCollection([{ protocolId: 'protocol-1' }]),
    users: createMatchingCollection([{ _id: 'op-1' }]),
    organizations: createMatchingCollection([{ organizationId: 'test-org-default' }, { organizationId: 'org-other' }]),
    patients: createMatchingCollection([{ participantId: CONSENTED_PARTICIPANT }, { participantId: UNCONSENTED_PARTICIPANT }]),
    patientConsents: createMatchingCollection([{ participantId: CONSENTED_PARTICIPANT, status: 'ACTIVE' }]),
    // RF004 AC2 (#1538): a biobank collection with an approval in force, the Specimen's collectionId.
    collections: createMatchingCollection([{ collectionId: 'COL-GOV-1', governanceRegime: 'biobank', governanceContext: { biobankGovernanceContextId: 'BGC-1' } }]),
    collectionGovernanceApprovals: createMatchingCollection([{ collectionId: 'COL-GOV-1', approvalId: 'APPR-GOV-1', status: 'active', effectivePeriod: { start: '2020-01-01', end: null }, createdAt: new Date('2020-01-01') }]),
    consent_templates: createMatchingCollection([{ _id: new ObjectId(TEMPLATE_HEX), title: 'TCLE', active: true, version: 1 }]),
    consentPermissions: createMatchingCollection([]),
    consentDecisionEvents: createMatchingCollection([]),
    consentRevocations: createMatchingCollection([]),
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
// The Coordenador caller resolves to organization scope test-org-default
// (rbac.factory.js), the laboratory this Assay names.
const ASSAY = {
  studyId: 'study-1',
  specimenIds: ['SPC-1'],
  assayType: 'RNA sequencing',
  protocolId: 'protocol-1',
  operatorId: 'op-1',
  laboratoryId: 'test-org-default',
  assayDateTime: '2026-10-01T09:00:00.000Z',
  intendedUse: 'RF029 ingestion proof',
};
// The collectionSite is the Coordenador's organization, as for the Assay.
const SPECIMEN = {
  specimenId: 'client-claimed',
  participantId: CONSENTED_PARTICIPANT,
  sampleType: 'PLASMA',
  sampleOrigin: 'VENOUS_BLOOD',
  extractionProtocol: 'TUBE_EDTA',
  quantity: 5,
  registeredAt: '2026-10-01T09:00:00.000Z',
  collectionSite: 'test-org-default',
  collectionId: 'COL-GOV-1',
};
// The clinicalUnitId is the Coordenador's organization too.
const PARTICIPANT = { participantId: 'client-claimed', sex: 'F', clinicalUnitId: 'test-org-default', consentTemplateId: TEMPLATE_HEX };
// #1318: a Consent for the participant with no consent in force, under the
// active template, which asks for no permission.
const CONSENT_ACCEPTED_AT = new Date(Date.now() - 60 * 60 * 1000).toISOString();
const CONSENT = { participantId: UNCONSENTED_PARTICIPANT, consentTemplateId: TEMPLATE_HEX, responses: {}, consentGranted: true, consentAcceptedAt: CONSENT_ACCEPTED_AT };

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

  it('201: an accepted Assay in the caller\'s organization is persisted with one INGESTION_ACCEPTED row (#1182)', async () => {
    const stores = givenDb();

    const res = await post({ entityType: 'Assay', payload: ASSAY, provenance: PROVENANCE });

    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({ success: true, status: 'accepted', entityType: 'Assay' });
    expect(stores.assays.docs.map((d) => [d.assayId, d.laboratoryId])).toEqual([[res.body.entityId, 'test-org-default']]);
    expect(ingestionAuditRows()).toEqual([expect.objectContaining({
      action: 'INGESTION_ACCEPTED',
      resourceType: 'Assay',
      resourceId: res.body.entityId,
    })]);
  });

  it('403: an Assay naming a laboratory outside the caller\'s organization is refused, writes nothing, and one INGESTION_REFUSED row (#1182)', async () => {
    const stores = givenDb();

    const res = await post({ entityType: 'Assay', payload: { ...ASSAY, laboratoryId: 'org-other' }, provenance: PROVENANCE });

    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(res.body).toMatchObject({ success: false, error: 'INGESTION_OUT_OF_SCOPE' });
    expect(stores.assays.docs).toHaveLength(0);
    expect(stores.ingestionQuarantineRecords.docs).toHaveLength(0);
    expect(stores.dataQualityAssessments.docs).toHaveLength(0);
    expect(ingestionAuditRows()).toEqual([expect.objectContaining({
      action: 'INGESTION_REFUSED',
      severity: 'warning',
      resourceType: 'Assay',
      payload: expect.objectContaining({ canonicalModelReleaseId: 'release-2.0.0', configurationReleaseId: 'cfg-release-7' }),
    })]);
  });

  it('201: an accepted Specimen is persisted in samples with its SPECIMEN_UPSERTED event in one session and one INGESTION_ACCEPTED row (#1318)', async () => {
    const stores = givenDb();

    const res = await post({ entityType: 'Specimen', payload: SPECIMEN, provenance: PROVENANCE });

    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({ success: true, status: 'accepted', entityType: 'Specimen' });
    expect(res.body.entityId).toMatch(/^\d{7}$/);
    const stored = stores.samples.docs.find((d) => d.specimenId === res.body.entityId);
    expect(stored).toMatchObject({ participantId: CONSENTED_PARTICIPANT, collectionSite: 'test-org-default', organizationId: 'test-org-default' });
    const session = app.locals.db.session;
    expect(stores.samples.insertOne).toHaveBeenCalledWith(stored, { session });
    const upserted = stores.graph_projection_outbox.updateOne.mock.calls.find(([, update]) => update?.$setOnInsert?.eventType === 'SPECIMEN_UPSERTED');
    expect(upserted[1].$setOnInsert).toMatchObject({ aggregateType: 'Sample', aggregateId: String(stored._id) });
    expect(upserted[2]).toEqual({ upsert: true, session });
    expect(ingestionAuditRows()).toEqual([expect.objectContaining({
      action: 'INGESTION_ACCEPTED',
      resourceType: 'Specimen',
      resourceId: res.body.entityId,
    })]);
  });

  it('422: a Specimen whose participant has no active consent quarantines CONSENT_NOT_ACTIVE, persists no sample, and writes one INGESTION_QUARANTINED row (RF029 AC2)', async () => {
    const stores = givenDb();

    const res = await post({ entityType: 'Specimen', payload: { ...SPECIMEN, participantId: UNCONSENTED_PARTICIPANT }, provenance: PROVENANCE });

    expect(res.status, JSON.stringify(res.body)).toBe(422);
    expect(res.body).toMatchObject({ success: false, error: 'INGESTION_QUARANTINED' });
    const record = stores.ingestionQuarantineRecords.docs.find((d) => d.ingestionQuarantineRecordId === res.body.ingestionQuarantineRecordId);
    expect(record.violations.map((v) => v.code)).toEqual(['CONSENT_NOT_ACTIVE']);
    expect(stores.samples.docs.map((d) => d.specimenId)).toEqual(['SPC-1']);
    expect(ingestionAuditRows()).toEqual([expect.objectContaining({
      action: 'INGESTION_QUARANTINED',
      resourceType: 'Specimen',
      resourceId: res.body.ingestionQuarantineRecordId,
    })]);
  });

  it('422: a Specimen whose barcode is a CPF is refused BARCODE_PERSONAL_DATA, persists nothing, and one INGESTION_REFUSED row without the CPF (RULE-012, #1318)', async () => {
    const stores = givenDb();

    const res = await post({ entityType: 'Specimen', payload: { ...SPECIMEN, barcode: '52998224725' }, provenance: PROVENANCE, idempotencyKey: 'specimen-key-1' });

    expect(res.status, JSON.stringify(res.body)).toBe(422);
    expect(res.body).toMatchObject({ success: false, error: 'BARCODE_PERSONAL_DATA' });
    expect(res.body.details).toEqual([expect.stringContaining('CPF')]);
    expect(JSON.stringify(res.body)).not.toContain('52998224725');
    expect(stores.samples.docs.map((d) => d.specimenId)).toEqual(['SPC-1']);
    expect(stores.ingestionQuarantineRecords.docs).toHaveLength(0);
    expect(stores.ingestionIdempotencyKeys.docs).toHaveLength(0);
    expect(stores.dataQualityAssessments.docs).toHaveLength(0);
    const rows = ingestionAuditRows();
    expect(rows).toEqual([expect.objectContaining({ action: 'INGESTION_REFUSED', severity: 'warning', resourceType: 'Specimen' })]);
    // The row is stored without the request, which auditLogger reads only for its network metadata.
    const { req: _req, ...row } = rows[0];
    expect(JSON.stringify(row)).not.toContain('52998224725');
  });

  it('201: an accepted Participant is persisted in patients with a server participantId, PENDING_CONSENT, in one session and one INGESTION_ACCEPTED row (#1318)', async () => {
    const stores = givenDb();

    const res = await post({ entityType: 'Participant', payload: PARTICIPANT, provenance: PROVENANCE });

    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({ success: true, status: 'accepted', entityType: 'Participant' });
    expect(res.body.entityId).toMatch(/^[1-9]\d{7}$/);
    const stored = stores.patients.docs.find((d) => d.participantId === res.body.entityId);
    expect(stored).toMatchObject({ sex: 'F', status: 'PENDING_CONSENT', clinicalUnitId: 'test-org-default', consentTemplateId: TEMPLATE_HEX });
    expect(stores.patients.insertOne).toHaveBeenCalledWith(stored, { session: app.locals.db.session });
    expect(ingestionAuditRows()).toEqual([expect.objectContaining({
      action: 'INGESTION_ACCEPTED',
      resourceType: 'Participant',
      resourceId: res.body.entityId,
    })]);
  });

  it('422: a Participant carrying patientName is refused INGESTION_STORE_UNSUPPORTED, writes nothing, and one INGESTION_REFUSED row without the name (#575)', async () => {
    const stores = givenDb();

    const res = await post({ entityType: 'Participant', payload: { ...PARTICIPANT, patientName: 'Maria Silva' }, provenance: PROVENANCE, idempotencyKey: 'participant-key-1' });

    expect(res.status, JSON.stringify(res.body)).toBe(422);
    expect(res.body).toMatchObject({ success: false, error: 'INGESTION_STORE_UNSUPPORTED' });
    expect(res.body.details).toEqual([expect.stringContaining('patientName')]);
    expect(JSON.stringify(res.body)).not.toContain('Maria Silva');
    expect(stores.patients.docs.map((d) => d.participantId)).toEqual([CONSENTED_PARTICIPANT, UNCONSENTED_PARTICIPANT]);
    expect(stores.ingestionQuarantineRecords.docs).toHaveLength(0);
    expect(stores.ingestionIdempotencyKeys.docs).toHaveLength(0);
    expect(stores.dataQualityAssessments.docs).toHaveLength(0);
    const rows = ingestionAuditRows();
    expect(rows).toEqual([expect.objectContaining({ action: 'INGESTION_REFUSED', severity: 'warning', resourceType: 'Participant' })]);
    // The row is stored without the request, which auditLogger reads only for its network metadata.
    const { req: _req, ...row } = rows[0];
    expect(JSON.stringify(row)).not.toContain('Maria Silva');
  });

  it('201: an accepted Consent is persisted in patientConsents with a server consentId, ACTIVE, its decision event and CONSENT_UPSERTED, in one session and one INGESTION_ACCEPTED row (#1318)', async () => {
    const stores = givenDb();
    const consentEvidence = require('../../src/services/consentEvidence.service');
    vi.spyOn(consentEvidence, 'storeConsentEvidence').mockReturnValue({
      evidenceDocumentUri: 'objstore://consents/stub/evidence.json',
      evidenceHash: `sha256:${'0'.repeat(64)}`,
      evidenceMimeType: 'application/json',
      evidenceEncryption: null,
    });

    const res = await post({ entityType: 'Consent', payload: CONSENT, provenance: PROVENANCE });

    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({ success: true, status: 'accepted', entityType: 'Consent' });
    const stored = stores.patientConsents.docs.find((d) => d.consentId === res.body.entityId);
    expect(stored).toMatchObject({ participantId: UNCONSENTED_PARTICIPANT, consentTemplateId: TEMPLATE_HEX, status: 'ACTIVE', signedAt: new Date(CONSENT_ACCEPTED_AT), consentVersion: '1' });
    expect(stores.patientConsents.insertOne).toHaveBeenCalledWith(stored, { session: app.locals.db.session });
    expect(stores.consentDecisionEvents.docs.map((d) => [d.consentId, d.decision])).toEqual([[res.body.entityId, 'accepted']]);
    expect(stores.graph_projection_outbox.updateOne.mock.calls.map(([, update]) => update?.$setOnInsert?.eventType)).toEqual(['INGESTION_RECORD_PERSISTED', 'CONSENT_UPSERTED']);
    expect(ingestionAuditRows()).toEqual([expect.objectContaining({
      action: 'INGESTION_ACCEPTED',
      resourceType: 'Consent',
      resourceId: res.body.entityId,
    })]);
  });

  it('422: a Consent carrying signatureName is refused INGESTION_STORE_UNSUPPORTED, writes nothing, and one INGESTION_REFUSED row without the name (#1318)', async () => {
    const stores = givenDb();

    const res = await post({ entityType: 'Consent', payload: { ...CONSENT, signatureName: 'Maria Silva' }, provenance: PROVENANCE, idempotencyKey: 'consent-key-1' });

    expect(res.status, JSON.stringify(res.body)).toBe(422);
    expect(res.body).toMatchObject({ success: false, error: 'INGESTION_STORE_UNSUPPORTED' });
    expect(res.body.details).toEqual([expect.stringContaining('signatureName')]);
    expect(JSON.stringify(res.body)).not.toContain('Maria Silva');
    expect(stores.patientConsents.docs.map((d) => d.participantId)).toEqual([CONSENTED_PARTICIPANT]);
    expect(stores.consentDecisionEvents.docs).toHaveLength(0);
    expect(stores.ingestionQuarantineRecords.docs).toHaveLength(0);
    expect(stores.ingestionIdempotencyKeys.docs).toHaveLength(0);
    expect(stores.dataQualityAssessments.docs).toHaveLength(0);
    const rows = ingestionAuditRows();
    expect(rows).toEqual([expect.objectContaining({ action: 'INGESTION_REFUSED', severity: 'warning', resourceType: 'Consent' })]);
    const { req: _req, ...row } = rows[0];
    expect(JSON.stringify(row)).not.toContain('Maria Silva');
  });

  it('201: an accepted genomics OmicsRun is persisted in omicsRuns with one INGESTION_ACCEPTED row', async () => {
    const stores = givenDb();

    const res = await post({ entityType: 'OmicsRun', payload: { modality: 'genomics' }, provenance: PROVENANCE });

    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({ success: true, status: 'accepted', entityType: 'OmicsRun' });
    expect(stores.omicsRuns.docs.map((d) => [d.omicsRunId, d.modality])).toEqual([[res.body.entityId, 'genomics']]);
    expect(stores.omicsRuns.insertOne).toHaveBeenCalledWith(expect.any(Object), { session: app.locals.db.session });
    expect(ingestionAuditRows()).toEqual([expect.objectContaining({
      action: 'INGESTION_ACCEPTED',
      resourceType: 'OmicsRun',
      resourceId: res.body.entityId,
    })]);
  });

  it('422: a proteomics OmicsRun, an Object Storage entity, is refused INGESTION_STORE_UNSUPPORTED, writes nothing, and one INGESTION_REFUSED row (RF029 AC4)', async () => {
    const stores = givenDb();

    const res = await post({ entityType: 'OmicsRun', payload: { modality: 'proteomics' }, provenance: PROVENANCE, idempotencyKey: 'omics-run-key-1' });

    expect(res.status, JSON.stringify(res.body)).toBe(422);
    expect(res.body).toMatchObject({ success: false, error: 'INGESTION_STORE_UNSUPPORTED' });
    expect(res.body.details).toEqual([expect.stringContaining('proteomics')]);
    expect(stores.omicsRuns.docs).toHaveLength(0);
    expect(stores.ingestionQuarantineRecords.docs).toHaveLength(0);
    expect(stores.ingestionIdempotencyKeys.docs).toHaveLength(0);
    expect(stores.missingDataReasons.docs).toHaveLength(0);
    expect(stores.dataQualityAssessments.docs).toHaveLength(0);
    expect(ingestionAuditRows()).toEqual([expect.objectContaining({
      action: 'INGESTION_REFUSED',
      severity: 'warning',
      status: 'warning',
      resourceType: 'OmicsRun',
      payload: expect.objectContaining({ canonicalModelReleaseId: 'release-2.0.0', configurationReleaseId: 'cfg-release-7' }),
    })]);
  });

  it('422: a TelemetryReading, an InfluxDB entity, is refused INGESTION_STORE_UNSUPPORTED naming the telemetry route, writes nothing, and one INGESTION_REFUSED row (RF029 AC4)', async () => {
    const stores = givenDb();
    const payload = { sensorId: 'sensor-1', metricType: 'temperature', timestamp: '2026-10-01T12:00:00.000Z', value: -80.1, unit: 'Cel' };

    const res = await post({ entityType: 'TelemetryReading', payload, provenance: PROVENANCE, idempotencyKey: 'telemetry-key-1' });

    expect(res.status, JSON.stringify(res.body)).toBe(422);
    expect(res.body).toMatchObject({ success: false, error: 'INGESTION_STORE_UNSUPPORTED' });
    expect(res.body.details).toEqual([expect.stringMatching(/InfluxDB.*\/api\/temperature\/reading/)]);
    expect(res.body.details[0]).not.toContain('sensor-1');
    expect(stores.ingestionQuarantineRecords.docs).toHaveLength(0);
    expect(stores.ingestionIdempotencyKeys.docs).toHaveLength(0);
    expect(stores.missingDataReasons.docs).toHaveLength(0);
    expect(stores.dataQualityAssessments.docs).toHaveLength(0);
    expect(stores.graph_projection_outbox.updateOne).not.toHaveBeenCalled();
    expect(ingestionAuditRows()).toEqual([expect.objectContaining({
      action: 'INGESTION_REFUSED',
      severity: 'warning',
      status: 'warning',
      resourceType: 'TelemetryReading',
      payload: expect.objectContaining({ canonicalModelReleaseId: 'release-2.0.0', configurationReleaseId: 'cfg-release-7' }),
    })]);
  });

  it('422: a DataFile, an Object Storage binary, is refused INGESTION_STORE_UNSUPPORTED naming the trusted upload routes, writes nothing, and one INGESTION_REFUSED row (RF007 AC2, RF029 AC4)', async () => {
    const stores = givenDb();
    const payload = { fileUri: 'objstore://x/y/sha256/ab', checksum: 'ab', fileSizeBytes: 10 };

    const res = await post({ entityType: 'DataFile', payload, provenance: PROVENANCE, idempotencyKey: 'file-key-1' });

    expect(res.status, JSON.stringify(res.body)).toBe(422);
    expect(res.body).toMatchObject({ success: false, error: 'INGESTION_STORE_UNSUPPORTED' });
    expect(res.body.details).toEqual([expect.stringMatching(/^DataFile tem seu binário no Object Storage, .*POST \/api\/samples\/:specimenId\/files\/upload/)]);
    expect(res.body.details[0]).not.toContain('objstore://');
    expect(stores.ingestionQuarantineRecords.docs).toHaveLength(0);
    expect(stores.ingestionIdempotencyKeys.docs).toHaveLength(0);
    expect(stores.missingDataReasons.docs).toHaveLength(0);
    expect(stores.dataQualityAssessments.docs).toHaveLength(0);
    expect(stores.graph_projection_outbox.updateOne).not.toHaveBeenCalled();
    expect(ingestionAuditRows()).toEqual([expect.objectContaining({
      action: 'INGESTION_REFUSED',
      severity: 'warning',
      status: 'warning',
      resourceType: 'DataFile',
      payload: expect.objectContaining({ canonicalModelReleaseId: 'release-2.0.0', configurationReleaseId: 'cfg-release-7' }),
    })]);
  });

  it('503: a TelemetryReading under a canonical release that is not active answers 503, not the store refusal', async () => {
    givenDb({ releaseStatus: 'draft' });

    const res = await post({ entityType: 'TelemetryReading', payload: {}, provenance: PROVENANCE });

    expect(res.status, JSON.stringify(res.body)).toBe(503);
    expect(res.body).toMatchObject({ success: false, error: 'CANONICAL_RELEASE_NOT_ACTIVE' });
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
