import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { ObjectId } = require('mongodb');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'vitest-secret-key';

const app = require('../../app');
const sessionService = require('../../src/services/session.service');
const consentValidator = require('../../src/services/consent.validator');
const { createCollectionMock, createDbMock } = require('../factories/db.factory');
const { buildRbacCollections } = require('../factories/rbac.factory');

// RF011 AC4 (#1322): GET /api/export/fhir/... answers one stored WorkflowRun,
// Study, audit event or sample file as a FHIR R4 collection Bundle in the
// export envelope. fhir.service.unit.test.js covers the transforms and the
// envelope; these tests cover the routes, their lookups and their gates.

const ORG = 'org-fhir-a';
const OTHER_ORG = 'org-fhir-b';
const rbacCollections = buildRbacCollections([
  { userAccountId: 'qa-admin', accessType: 4 },
  { userAccountId: 'qa-coord', accessType: 3, organizationId: ORG },
  { userAccountId: 'qa-tech', accessType: 2, organizationId: ORG },
]);

function makeToken(userID, accessType) {
  return jwt.sign(
    { userID, accessType, roleName: accessType >= 3 ? 'Coordenador' : 'Tecnico', name: 'QA', mfaVerified: true },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
}

const ADMIN = `Bearer ${makeToken('qa-admin', 4)}`;
const COORD = `Bearer ${makeToken('qa-coord', 3)}`;
const TECH = `Bearer ${makeToken('qa-tech', 2)}`;

function givenSession() {
  vi.spyOn(sessionService, 'verifySession').mockResolvedValue({ valid: true, session: { sessionID: 'sess-1' } });
  vi.spyOn(sessionService, 'updateActivity').mockResolvedValue({ sessionID: 'sess-1' });
}

function findOneReturning(record) {
  return createCollectionMock({ findOne: vi.fn().mockResolvedValue(record) });
}

function givenDb(collections) {
  app.locals.db = createDbMock({ ...collections, ...rbacCollections });
}

beforeEach(() => { givenSession(); });
afterEach(() => { vi.restoreAllMocks(); });

function expectSingleResource(res, resourceType, mappingId) {
  expect(res.status).toBe(200);
  expect(res.body.success).toBe(true);
  const { data } = res.body;
  expect(data.mapping.mappingId).toBe(mappingId);
  expect(data.mappingReleaseId).toBeNull();
  expect(data.conformanceClaimed).toBe(false);
  expect(data.bundle.type).toBe('collection');
  expect(data.bundle.timestamp).toBe(data.generatedAt);
  expect(data.bundle.entry).toHaveLength(1);
  expect(data.bundle.entry[0].resource.resourceType).toBe(resourceType);
  return data.bundle.entry[0].resource;
}

describe('GET /api/export/fhir/workflow-runs/:workflowRunId', () => {
  const PATH = '/api/export/fhir/workflow-runs/WFR-1';
  const run = { _id: new ObjectId(), workflowRunId: 'WFR-1', createdBy: 'user-9', inputFileIds: ['f-in'], outputFileIds: ['f-out'] };

  it('returns 401 without token', async () => {
    const res = await request(app).get(PATH);
    expect(res.status).toBe(401);
  });

  it('returns 403 for a Tecnico (accessType 2)', async () => {
    const workflowRuns = findOneReturning(run);
    givenDb({ workflowRuns });

    const res = await request(app).get(PATH).set('Authorization', TECH);

    expect(res.status).toBe(403);
    expect(workflowRuns.findOne).not.toHaveBeenCalled();
  });

  it('returns 404 for an unknown run', async () => {
    givenDb({ workflowRuns: findOneReturning(null) });

    const res = await request(app).get('/api/export/fhir/workflow-runs/WFR-404').set('Authorization', ADMIN);

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ success: false, error: 'WFR-404 não encontrado' });
  });

  it('answers the run as a Provenance under MAP-V2-008, looked up by _id or workflowRunId', async () => {
    const workflowRuns = findOneReturning(run);
    givenDb({ workflowRuns });
    const oid = run._id.toString();

    const res = await request(app).get(`/api/export/fhir/workflow-runs/${oid}`).set('Authorization', COORD);

    const resource = expectSingleResource(res, 'Provenance', 'MAP-V2-008');
    expect(resource.id).toBe('WFR-1');
    expect(resource.target).toEqual([{ reference: 'DocumentReference/f-out' }]);
    expect(workflowRuns.findOne).toHaveBeenCalledWith({ $or: [{ _id: new ObjectId(oid) }, { workflowRunId: oid }] });
  });

  it('answers 500 when the read fails', async () => {
    givenDb({ workflowRuns: createCollectionMock({ findOne: vi.fn().mockRejectedValue(new Error('mongo down')) }) });

    const res = await request(app).get(PATH).set('Authorization', ADMIN);

    expect(res.status).toBe(500);
    expect(res.body).toMatchObject({ success: false, error: 'Erro ao exportar FHIR', message: 'mongo down' });
  });
});

// find and findOne evaluate their filters: the walk's `{ field: { $in } }`
// levels and `$or` root lookup, and the route's `$or` of `workflowRunId`
// and `_id` `$in` reads.
function workflowRunsCollection(docs) {
  const matchesIn = (doc, filter) => Object.entries(filter).every(([field, condition]) => (
    (Array.isArray(doc[field]) ? doc[field] : [doc[field]]).some((value) => (
      condition.$in.some((wanted) => String(wanted) === String(value))
    ))
  ));
  const matchesLookup = (doc, clause) => (
    ('_id' in clause && String(doc._id) === String(clause._id))
    || ('workflowRunId' in clause && doc.workflowRunId === clause.workflowRunId)
  );
  const matches = (doc, filter) => (filter.$or
    ? filter.$or.some((clause) => (Object.values(clause)[0]?.$in ? matchesIn(doc, clause) : matchesLookup(doc, clause)))
    : matchesIn(doc, filter));
  return createCollectionMock({
    findOne: vi.fn(async (filter) => docs.find((doc) => matches(doc, filter)) || null),
    find: vi.fn((filter) => ({ toArray: async () => docs.filter((doc) => matches(doc, filter)) })),
  });
}

describe('GET /api/export/fhir/workflow-runs/:workflowRunId/lineage', () => {
  const chain = [
    { _id: new ObjectId(), workflowRunId: 'run-A', inputFileIds: [], outputFileIds: ['f1'] },
    { _id: new ObjectId(), workflowRunId: 'run-B', inputFileIds: ['f1'], outputFileIds: ['f2'] },
    { _id: new ObjectId(), workflowRunId: 'run-C', inputFileIds: ['f2'], outputFileIds: [] },
  ];

  it('lineage returns 401 without token', async () => {
    const res = await request(app).get('/api/export/fhir/workflow-runs/run-B/lineage');
    expect(res.status).toBe(401);
  });

  it('lineage returns 403 for a Tecnico (accessType 2)', async () => {
    const workflowRuns = workflowRunsCollection(chain);
    givenDb({ workflowRuns });

    const res = await request(app).get('/api/export/fhir/workflow-runs/run-B/lineage').set('Authorization', TECH);

    expect(res.status).toBe(403);
    expect(workflowRuns.findOne).not.toHaveBeenCalled();
  });

  it('lineage returns 404 for an unknown run', async () => {
    givenDb({ workflowRuns: workflowRunsCollection(chain) });

    const res = await request(app).get('/api/export/fhir/workflow-runs/run-404/lineage').set('Authorization', ADMIN);

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ success: false, error: 'run-404 não encontrado' });
  });

  it('lineage answers the chain as one Provenance per run, root first', async () => {
    givenDb({ workflowRuns: workflowRunsCollection(chain) });

    const res = await request(app).get('/api/export/fhir/workflow-runs/run-B/lineage').set('Authorization', COORD);

    expect(res.status).toBe(200);
    const { data } = res.body;
    expect(data.mapping.mappingId).toBe('MAP-V2-008');
    expect(data.bundle.entry).toHaveLength(3);
    expect(data.bundle.entry.map((entry) => entry.resource.id)).toEqual(['run-B', 'run-A', 'run-C']);
    const runB = data.bundle.entry[0].resource;
    expect(runB.entity[0].what.reference).toBe('DocumentReference/f1');
    expect(runB.target[0].reference).toBe('DocumentReference/f2');
    expect(data.lineage).toEqual({ workflowRunId: 'run-B', truncated: false });
  });

  it('lineage carries a truncated walk', async () => {
    const runs = [];
    for (let k = 0; k < 23; k += 1) {
      runs.push({ _id: new ObjectId(), workflowRunId: `run-${k}`, inputFileIds: [`f${k - 1}`], outputFileIds: [`f${k}`] });
    }
    givenDb({ workflowRuns: workflowRunsCollection(runs) });

    const res = await request(app).get('/api/export/fhir/workflow-runs/run-0/lineage').set('Authorization', COORD);

    expect(res.status).toBe(200);
    expect(res.body.data.lineage.truncated).toBe(true);
    expect(res.body.data.bundle.entry.length).toBe(21);
  });

  it('lineage answers 500 when the read fails', async () => {
    givenDb({ workflowRuns: createCollectionMock({ findOne: vi.fn().mockRejectedValue(new Error('mongo down')) }) });

    const res = await request(app).get('/api/export/fhir/workflow-runs/run-B/lineage').set('Authorization', ADMIN);

    expect(res.status).toBe(500);
    expect(res.body).toMatchObject({ success: false, error: 'Erro ao exportar FHIR', message: 'mongo down' });
  });
});

describe('GET /api/export/fhir/studies/:studyId', () => {
  const PATH = '/api/export/fhir/studies/STU-1';
  const study = { studyId: 'STU-1', studyTitle: 'Estudo', studyStatus: 'active', protocolId: 'PROT-1' };

  it('returns 401 without token', async () => {
    const res = await request(app).get(PATH);
    expect(res.status).toBe(401);
  });

  it('returns 403 for a Tecnico (accessType 2)', async () => {
    const studies = findOneReturning(study);
    givenDb({ studies });

    const res = await request(app).get(PATH).set('Authorization', TECH);

    expect(res.status).toBe(403);
    expect(studies.findOne).not.toHaveBeenCalled();
  });

  it('returns 404 for an unknown study', async () => {
    givenDb({ studies: findOneReturning(null) });

    const res = await request(app).get('/api/export/fhir/studies/STU-404').set('Authorization', ADMIN);

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ success: false, error: 'STU-404 não encontrado' });
  });

  it('answers the study as a ResearchStudy under MAP-V2-009, looked up by studyId', async () => {
    const studies = findOneReturning(study);
    givenDb({ studies });

    const res = await request(app).get(PATH).set('Authorization', COORD);

    const resource = expectSingleResource(res, 'ResearchStudy', 'MAP-V2-009');
    expect(resource).toMatchObject({ id: 'STU-1', title: 'Estudo', status: 'active' });
    expect(studies.findOne).toHaveBeenCalledWith({ $or: [{ studyId: 'STU-1' }] });
  });
});

describe('GET /api/export/fhir/audit-events/:eventId', () => {
  const PATH = '/api/export/fhir/audit-events/EVT-1';
  const event = { eventId: 'EVT-1', action: 'READ', result: 'success', actorPseudonym: 'ps-1', actorId: 'user-1', eventHash: 'h' };

  it('returns 401 without token', async () => {
    const res = await request(app).get(PATH);
    expect(res.status).toBe(401);
  });

  it('returns 404 when the event is in neither the live nor the archive collection', async () => {
    const auditEvents = findOneReturning(null);
    const archive = findOneReturning(null);
    givenDb({ audit_events: auditEvents, audit_events_archive: archive });

    const res = await request(app).get('/api/export/fhir/audit-events/EVT-404').set('Authorization', ADMIN);

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ success: false, error: 'EVT-404 não encontrado' });
    expect(archive.findOne).toHaveBeenCalledWith({ eventId: 'EVT-404' });
  });

  it('answers a live event as an AuditEvent under MAP-V2-006', async () => {
    const auditEvents = findOneReturning(event);
    const archive = findOneReturning(null);
    givenDb({ audit_events: auditEvents, audit_events_archive: archive });

    const res = await request(app).get(PATH).set('Authorization', ADMIN);

    const resource = expectSingleResource(res, 'AuditEvent', 'MAP-V2-006');
    expect(resource).toMatchObject({ id: 'EVT-1', outcome: '0' });
    expect(JSON.stringify(resource)).not.toContain('user-1');
    expect(auditEvents.findOne).toHaveBeenCalledWith({ eventId: 'EVT-1' });
    expect(archive.findOne).not.toHaveBeenCalled();
  });

  it('answers an archived event', async () => {
    givenDb({ audit_events: findOneReturning(null), audit_events_archive: findOneReturning(event) });

    const res = await request(app).get(PATH).set('Authorization', ADMIN);

    expect(expectSingleResource(res, 'AuditEvent', 'MAP-V2-006').id).toBe('EVT-1');
  });
});

describe('GET /api/export/fhir/samples/:specimenId/files/:fileID', () => {
  const SAMPLE_OID = new ObjectId();
  const FILE_OID = new ObjectId();
  const PATH = `/api/export/fhir/samples/${SAMPLE_OID}/files/${FILE_OID}`;

  function sampleDoc(organizationId = ORG) {
    return { _id: SAMPLE_OID, specimenId: 'SPX-1', organizationId };
  }

  function fileDoc(overrides = {}) {
    return {
      _id: FILE_OID,
      specimenId: SAMPLE_OID.toString(),
      fileRole: 'raw',
      storageUri: 's3://bucket/raw.csv',
      storagePath: '/var/storage/raw.csv',
      mimeType: 'text/csv',
      fileSize: 10,
      checksum: 'ab'.repeat(32),
      checksumAlgorithm: 'SHA-256',
      ...overrides,
    };
  }

  function givenRecords({ file = fileDoc(), sample = sampleDoc() } = {}) {
    const sampleFiles = findOneReturning(file);
    const samples = createCollectionMock({
      findOne: vi.fn(async (query) => {
        if (!sample) return null;
        if (query._id && String(query._id) === String(sample._id)) return sample;
        if (query.specimenId && query.specimenId === sample.specimenId) return sample;
        return null;
      }),
    });
    givenDb({ sample_files: sampleFiles, samples });
    return { sampleFiles, samples };
  }

  beforeEach(() => {
    vi.spyOn(consentValidator, 'validateAccess').mockResolvedValue(true);
  });

  it('returns 401 without token', async () => {
    const res = await request(app).get(PATH);
    expect(res.status).toBe(401);
  });

  it('returns 404 for an unknown file', async () => {
    givenRecords({ file: null });

    const res = await request(app).get(PATH).set('Authorization', COORD);

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ success: false, error: `${FILE_OID} não encontrado` });
  });

  it('returns 404 for a non-ObjectId fileID without reading sample_files', async () => {
    const { sampleFiles } = givenRecords();

    const res = await request(app).get(`/api/export/fhir/samples/${SAMPLE_OID}/files/not-an-id`).set('Authorization', COORD);

    expect(res.status).toBe(404);
    expect(sampleFiles.findOne).not.toHaveBeenCalled();
  });

  it('returns 404 for a deleted file', async () => {
    givenRecords({ file: fileDoc({ deletedAt: new Date('2026-10-01') }) });

    const res = await request(app).get(PATH).set('Authorization', COORD);

    expect(res.status).toBe(404);
  });

  it('returns 400 for a file of another sample', async () => {
    givenRecords({ file: fileDoc({ specimenId: new ObjectId().toString() }) });

    const res = await request(app).get(PATH).set('Authorization', COORD);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Arquivo não está vinculado a esta amostra');
  });

  it('returns 403 for a sample outside the caller\'s organization', async () => {
    givenRecords({ sample: sampleDoc(OTHER_ORG) });

    const res = await request(app).get(PATH).set('Authorization', COORD);

    expect(res.status).toBe(403);
    expect(res.body.message).toBe('Esta amostra pertence a outra organização');
  });

  it('returns 403 when commercial consent is refused, before reading the file', async () => {
    consentValidator.validateAccess.mockRejectedValue(new Error('sem consentimento'));
    const { sampleFiles } = givenRecords();

    const res = await request(app).get(PATH).set('Authorization', COORD);

    expect(res.status).toBe(403);
    expect(res.body.message).toBe('sem consentimento');
    expect(consentValidator.validateAccess).toHaveBeenCalledWith(SAMPLE_OID.toString(), 'uso_comercial');
    expect(sampleFiles.findOne).not.toHaveBeenCalled();
  });

  it('answers the file as a DocumentReference under MAP-V2-007, without storagePath or checksum', async () => {
    givenRecords();

    const res = await request(app).get(PATH).set('Authorization', COORD);

    const resource = expectSingleResource(res, 'DocumentReference', 'MAP-V2-007');
    expect(resource.id).toBe(FILE_OID.toString());
    expect(resource.content[0].attachment).toEqual({ url: 's3://bucket/raw.csv', contentType: 'text/csv', size: 10 });
    expect(resource.content[0].attachment).not.toHaveProperty('hash');
    // The limitation prose names storagePath; the Bundle carries neither the key nor its value.
    expect(JSON.stringify(res.body.data.bundle)).not.toContain('storagePath');
    expect(JSON.stringify(res.body)).not.toContain('/var/storage/raw.csv');
    expect(JSON.stringify(res.body)).not.toContain('ab'.repeat(32));
  });

  it('answers a file named by the sample\'s specimenId', async () => {
    givenRecords();

    const res = await request(app).get(`/api/export/fhir/samples/SPX-1/files/${FILE_OID}`).set('Authorization', COORD);

    expect(expectSingleResource(res, 'DocumentReference', 'MAP-V2-007').id).toBe(FILE_OID.toString());
  });
});
