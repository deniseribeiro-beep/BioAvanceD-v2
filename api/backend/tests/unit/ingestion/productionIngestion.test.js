import { describe, it, expect, vi, afterEach } from 'vitest';
const { ingestAndPersist } = require('../../../src/ingestion/productionIngestion');
const { findCompletedIdempotentResult } = require('../../../src/ingestion/idempotency');
const { createFakeDb } = require('./testHelpers');
const { createMatchingCollection } = require('../../factories/filter.factory');

// RF029 (#1318): the production ingestion path. createFakeDb has no client,
// so it takes the sequential path; the replica-set cases attach a client
// shaped like graphProjection.service.test.js's own.

afterEach(() => { vi.restoreAllMocks(); });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function seededDb({ release = { canonicalModelReleaseId: 'release-2.0.0', releaseStatus: 'active' }, config = { _id: 'main', configurationReleaseId: 'cfg-release-7' } } = {}) {
  return createFakeDb({
    canonicalModelReleases: release ? [release] : [],
    security_config: config ? [config] : [],
    datasets: [],
    workflowRuns: [],
    omicsQualifications: [],
    omicsRuns: [],
    samples: [],
    patients: [],
    patientConsents: [],
    organizations: [],
    ingestionQuarantineRecords: [],
    ingestionIdempotencyKeys: [],
    missingDataReasons: [],
    dataQualityAssessments: [],
  });
}

function onReplicaSet(db) {
  const session = { withTransaction: vi.fn(async (fn) => { await fn(); }), endSession: vi.fn(async () => {}) };
  db.client = {
    db: () => ({ command: async () => ({ setName: 'rs0' }) }),
    startSession: () => session,
  };
  return session;
}

function fakeOutbox() {
  return { appendEvent: vi.fn(async (_db, event) => ({ eventId: 'evt-1', ...event })) };
}

function provenance() {
  return {
    sourceSystem: 'urn:system:lims',
    retrievedAt: '2026-10-01T12:00:00.000Z',
    purpose: 'operational_registration',
    sourceRecordId: 'LIMS-DS-42',
  };
}

const DATASET = { datasetTitle: 'Coorte A', datasetVersion: '1.0', creators: ['Equipe A'], license: 'CC-BY-4.0' };
const WORKFLOW_RUN = {
  workflowId: 'variant-calling',
  workflowVersion: '2.3.1',
  createdBy: 'User/client-claimed',
  startedAt: '2026-10-01T10:00:00.000Z',
  runStatus: 'succeeded',
  hardwareProfile: { cpu: 'synthetic' },
  environmentManifestUri: 'object://synthetic/environment.json',
};
const OMICS_QUALIFICATION = { targetAssay: 'assay-wgs-1', qcRuleSetVersion: 'qc-1.0', qcMetrics: [{ name: 'q30', value: 0.92 }], qualificationDecision: 'eligible' };

function ingest(db, overrides = {}) {
  return ingestAndPersist({
    db,
    entityType: 'Dataset',
    payload: DATASET,
    provenance: provenance(),
    actorId: 'u-1',
    outbox: fakeOutbox(),
    ...overrides,
  });
}

describe('ingestion/productionIngestion ingestAndPersist (RF029, #1318)', () => {
  it('1. an accepted Dataset is inserted with a server uuid, its provenance and release ids, and one INGESTION_RECORD_PERSISTED append', async () => {
    const db = seededDb();
    const outbox = fakeOutbox();

    const result = await ingest(db, { outbox });

    expect(result).toMatchObject({ status: 'accepted', entityType: 'Dataset', outboxEventId: 'evt-1', canonicalModelReleaseId: 'release-2.0.0', configurationReleaseId: 'cfg-release-7' });
    expect(result.entityId).toMatch(UUID);
    expect(db.collections.datasets.docs).toHaveLength(1);
    expect(db.collections.datasets.docs[0]).toMatchObject({
      datasetId: result.entityId,
      datasetTitle: 'Coorte A',
      sourceSystem: 'urn:system:lims',
      sourceRecordId: 'LIMS-DS-42',
      createdBy: 'Actor/u-1',
      canonicalModelReleaseId: 'release-2.0.0',
      schemaVersion: '2.0.0',
      configurationReleaseId: 'cfg-release-7',
    });
    expect(db.collections.datasets.docs[0].retrievedAt).toEqual(new Date('2026-10-01T12:00:00.000Z'));
    expect(outbox.appendEvent).toHaveBeenCalledTimes(1);
    expect(outbox.appendEvent.mock.calls[0][1]).toEqual({
      eventType: 'INGESTION_RECORD_PERSISTED',
      aggregateType: 'Dataset',
      aggregateId: result.entityId,
      canonicalModelReleaseId: 'release-2.0.0',
      payload: { entityType: 'Dataset', entityId: result.entityId, configurationReleaseId: 'cfg-release-7' },
      sourceService: 'ingestion-gateway',
      schemaVersion: 1,
    });
    // RF029 AC7, RNF011 C5: each absent field is stored as null or [], never
    // 0, and gets one MissingDataReason row in the document's write.
    expect(db.collections.datasets.docs[0]).toMatchObject({ doi: null, roCrateManifest: null, distributionFiles: [] });
    const rows = db.collections.missingDataReasons.docs;
    expect(rows.map((r) => [r.fieldPath, r.reasonCode])).toEqual([['doi', 'unknown'], ['distributionFiles', 'unknown'], ['roCrateManifest', 'unknown']]);
    for (const row of rows) {
      expect(row).toEqual({
        missingDataReasonId: expect.stringMatching(UUID),
        entityType: 'Dataset',
        entityId: result.entityId,
        fieldPath: row.fieldPath,
        reasonCode: 'unknown',
        recordedAt: expect.any(Date),
        sourceEventId: 'evt-1',
        canonicalModelReleaseId: 'release-2.0.0',
        configurationReleaseId: 'cfg-release-7',
      });
    }
    expect(result.missingDataReasons).toEqual(rows.map(({ missingDataReasonId, fieldPath, reasonCode }) => ({ missingDataReasonId, fieldPath, reasonCode })));
  });

  it('2. on a replica set, the insert and the append receive the same session', async () => {
    const db = seededDb();
    const session = onReplicaSet(db);
    const insertOne = vi.spyOn(db.collection('datasets'), 'insertOne');
    const outbox = fakeOutbox();

    const result = await ingest(db, { outbox });

    expect(result.status).toBe('accepted');
    expect(session.withTransaction).toHaveBeenCalledTimes(1);
    expect(insertOne).toHaveBeenCalledWith(expect.objectContaining({ datasetId: result.entityId }), { session });
    expect(outbox.appendEvent).toHaveBeenCalledWith(db, expect.objectContaining({ aggregateId: result.entityId }), { session });
  });

  it('2b. on a replica set, every MissingDataReason insert receives the same session', async () => {
    const db = seededDb();
    const session = onReplicaSet(db);
    const insertOne = vi.spyOn(db.collection('missingDataReasons'), 'insertOne');

    const result = await ingest(db);

    expect(result.status).toBe('accepted');
    expect(insertOne).toHaveBeenCalledTimes(3);
    for (const call of insertOne.mock.calls) {
      expect(call).toEqual([expect.objectContaining({ entityId: result.entityId }), { session }]);
    }
  });

  it('3. on the session path a failing append rejects, with the insert and the append in the same session', async () => {
    const db = seededDb();
    const session = onReplicaSet(db);
    const insertOne = vi.spyOn(db.collection('datasets'), 'insertOne');
    const outbox = { appendEvent: vi.fn().mockRejectedValue(new Error('outbox down')) };

    await expect(ingest(db, { outbox })).rejects.toThrow('outbox down');
    expect(insertOne).toHaveBeenCalledWith(expect.any(Object), { session });
    expect(outbox.appendEvent).toHaveBeenCalledWith(db, expect.any(Object), { session });
    expect(db.collections.missingDataReasons.docs).toHaveLength(0);
  });

  it('4. a missing provenance field quarantines, with no insert and no append', async () => {
    const db = seededDb();
    const outbox = fakeOutbox();

    const result = await ingest(db, { outbox, provenance: { ...provenance(), sourceSystem: undefined } });

    expect(result.status).toBe('quarantined');
    expect(result.violations.map((v) => v.field)).toContain('provenance.sourceSystem');
    expect(result.ingestionQuarantineRecordId).toBe(db.collections.ingestionQuarantineRecords.docs[0].ingestionQuarantineRecordId);
    expect(result).toMatchObject({ canonicalModelReleaseId: 'release-2.0.0', configurationReleaseId: 'cfg-release-7' });
    expect(db.collections.datasets.docs).toHaveLength(0);
    expect(outbox.appendEvent).not.toHaveBeenCalled();
  });

  it('5. a WorkflowRun that passes the schema but fails the model quarantines with ENTITY_VALIDATION_FAILED', async () => {
    const db = seededDb();
    const outbox = fakeOutbox();

    const result = await ingest(db, { outbox, entityType: 'WorkflowRun', payload: { ...WORKFLOW_RUN, startedAt: 'not-a-date' } });

    expect(result.status).toBe('quarantined');
    expect(result.violations).toEqual([
      { code: 'ENTITY_VALIDATION_FAILED', field: null, message: 'startedAt é obrigatório e deve ser uma data válida' },
    ]);
    expect(db.collections.workflowRuns.docs).toHaveLength(0);
    expect(outbox.appendEvent).not.toHaveBeenCalled();
  });

  it.each(['Telemetry', '__proto__', 'toString'])('6. entityType %s throws 422 INGESTION_TARGET_UNSUPPORTED with no write', async (entityType) => {
    const db = seededDb();
    const outbox = fakeOutbox();

    await expect(ingest(db, { outbox, entityType })).rejects.toMatchObject({
      statusCode: 422,
      code: 'INGESTION_TARGET_UNSUPPORTED',
      details: [expect.stringContaining(entityType)],
    });
    expect(db.collections.ingestionQuarantineRecords.docs).toHaveLength(0);
    expect(db.collections.datasets.docs).toHaveLength(0);
    expect(outbox.appendEvent).not.toHaveBeenCalled();
  });

  it.each([
    ['missing', null],
    ['retired', { canonicalModelReleaseId: 'release-2.0.0', releaseStatus: 'retired' }],
  ])('7. a %s CanonicalModelRelease throws 503 with no write', async (_label, release) => {
    const db = seededDb({ release });
    const outbox = fakeOutbox();

    await expect(ingest(db, { outbox })).rejects.toMatchObject({ statusCode: 503, code: 'CANONICAL_RELEASE_NOT_ACTIVE' });
    expect(db.collections.ingestionQuarantineRecords.docs).toHaveLength(0);
    expect(db.collections.datasets.docs).toHaveLength(0);
    expect(outbox.appendEvent).not.toHaveBeenCalled();
  });

  it('8. a second call with the same idempotencyKey replays the first entityId and inserts once', async () => {
    const db = seededDb();
    const outbox = fakeOutbox();

    const first = await ingest(db, { outbox, idempotencyKey: 'key-1' });
    const second = await ingest(db, { outbox, idempotencyKey: 'key-1' });

    expect(first.status).toBe('accepted');
    expect(second).toEqual({ status: 'idempotent_replay', outcome: 'accepted', entityType: 'Dataset', resultRef: first.entityId, canonicalModelReleaseId: 'release-2.0.0', configurationReleaseId: 'cfg-release-7' });
    expect(db.collections.datasets.docs).toHaveLength(1);
    expect(outbox.appendEvent).toHaveBeenCalledTimes(1);
  });

  it('9. configurationReleaseId comes from security_config, and is null when the config is absent', async () => {
    const configured = await ingest(seededDb());
    const unconfigured = seededDb({ config: null });
    const bare = await ingest(unconfigured);

    expect(configured.configurationReleaseId).toBe('cfg-release-7');
    expect(bare.configurationReleaseId).toBeNull();
    expect(unconfigured.collections.datasets.docs[0].configurationReleaseId).toBeNull();
  });

  it('10. without a session, a failing insert rejects and leaves no completed key', async () => {
    const db = seededDb();
    vi.spyOn(db.collection('datasets'), 'insertOne').mockRejectedValue(new Error('insert failed'));

    await expect(ingest(db, { idempotencyKey: 'key-1' })).rejects.toThrow('insert failed');
    await expect(findCompletedIdempotentResult(db, { idempotencyKey: 'key-1', scope: 'Dataset' })).resolves.toBeNull();
  });

  it('11. a payload createdBy and a body id are overridden by Actor/<actorId> and the server uuid', async () => {
    const db = seededDb();

    const result = await ingest(db, { entityType: 'WorkflowRun', payload: { ...WORKFLOW_RUN, workflowRunId: 'client-chosen-id' } });

    expect(result.status).toBe('accepted');
    expect(result.entityId).toMatch(UUID);
    expect(result.entityId).not.toBe('client-chosen-id');
    expect(db.collections.workflowRuns.docs[0]).toMatchObject({ workflowRunId: result.entityId, createdBy: 'Actor/u-1' });
  });

  it('12. a quarantined record retried with the same idempotencyKey replays as a quarantine, with its record id and violations', async () => {
    const db = seededDb();
    const unprovenanced = { ...provenance(), purpose: undefined };

    const first = await ingest(db, { provenance: unprovenanced, idempotencyKey: 'key-q' });
    const second = await ingest(db, { provenance: unprovenanced, idempotencyKey: 'key-q' });

    expect(first.status).toBe('quarantined');
    expect(second).toEqual({
      status: 'idempotent_replay',
      outcome: 'quarantined',
      entityType: 'Dataset',
      resultRef: first.ingestionQuarantineRecordId,
      ingestionQuarantineRecordId: first.ingestionQuarantineRecordId,
      violations: first.violations,
      canonicalModelReleaseId: 'release-2.0.0',
      configurationReleaseId: 'cfg-release-7',
    });
    expect(db.collections.ingestionQuarantineRecords.docs).toHaveLength(1);
  });

  it('13. a key stored before outcomes were recorded replays as a bare replay', async () => {
    const db = seededDb();
    db.collections.ingestionIdempotencyKeys.docs.push({ idempotencyKey: 'key-old', scope: 'Dataset', status: 'completed', resultRef: 'ds-old' });

    await expect(ingest(db, { idempotencyKey: 'key-old' })).resolves.toEqual({
      status: 'idempotent_replay',
      outcome: null,
      entityType: 'Dataset',
      resultRef: 'ds-old',
      canonicalModelReleaseId: 'release-2.0.0',
      configurationReleaseId: 'cfg-release-7',
    });
    expect(db.collections.datasets.docs).toHaveLength(0);
  });

  // Two concurrent calls with one key on the sequential path.
  async function raceOnOneKey({ entityType = 'Dataset', payload = DATASET, collection = 'datasets', seed = () => {}, overrides = {} } = {}) {
    const db = seededDb();
    seed(db);
    db.collections.datasets = createMatchingCollection([]);
    db.collections.omicsQualifications = createMatchingCollection([]);
    db.collections.omicsRuns = createMatchingCollection([]);
    db.collections.samples = createMatchingCollection([]);
    db.collections.graph_projection_outbox = createMatchingCollection([]);
    db.collections.missingDataReasons = createMatchingCollection([]);
    db.collections.dataQualityAssessments = createMatchingCollection([]);
    let next = 0;
    const outbox = {
      getCollection: (target) => target.collection('graph_projection_outbox'),
      appendEvent: vi.fn(async (target, event) => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        const doc = { eventId: `evt-${++next}`, ...event };
        await target.collection('graph_projection_outbox').insertOne(doc);
        return doc;
      }),
    };

    const [a, b] = await Promise.all([
      ingest(db, { outbox, entityType, payload, idempotencyKey: 'key-race', ...overrides }),
      ingest(db, { outbox, entityType, payload, idempotencyKey: 'key-race', ...overrides }),
    ]);
    const [winner, loser] = a.status === 'accepted' ? [a, b] : [b, a];
    return { db, winner, loser, docs: db.collections[collection].docs };
  }

  it('14. without a session, two concurrent calls with one key leave one document and one outbox event, and the loser replays the winner', async () => {
    const { db, winner, loser } = await raceOnOneKey();

    expect(winner.status).toBe('accepted');
    expect(loser).toEqual({ status: 'idempotent_replay', outcome: 'accepted', entityType: 'Dataset', resultRef: winner.entityId, canonicalModelReleaseId: 'release-2.0.0', configurationReleaseId: 'cfg-release-7' });
    expect(db.collections.datasets.docs.map((d) => d.datasetId)).toEqual([winner.entityId]);
    expect(db.collections.graph_projection_outbox.docs.map((e) => e.eventId)).toEqual([winner.outboxEventId]);
    expect(db.collections.missingDataReasons.docs.map((r) => r.entityId)).toEqual([winner.entityId, winner.entityId, winner.entityId]);
  });

  it('14b. without a session, the concurrent loser leaves no DataQualityAssessment of its own', async () => {
    const { db, winner } = await raceOnOneKey();

    expect(winner.status).toBe('accepted');
    expect(db.collections.dataQualityAssessments.docs.map((d) => [d.dataQualityAssessmentId, d.scopeId]))
      .toEqual([[winner.dataQualityAssessmentId, `Dataset/${winner.entityId}`]]);
  });

  it('14c. without a session, a concurrent OmicsQualification loser leaves no document, event, MissingDataReason or assessment of its own', async () => {
    const { db, winner, loser, docs } = await raceOnOneKey({ entityType: 'OmicsQualification', payload: OMICS_QUALIFICATION, collection: 'omicsQualifications' });

    expect(winner.status).toBe('accepted');
    expect(loser).toEqual({ status: 'idempotent_replay', outcome: 'accepted', entityType: 'OmicsQualification', resultRef: winner.entityId, canonicalModelReleaseId: 'release-2.0.0', configurationReleaseId: 'cfg-release-7' });
    expect(docs.map((d) => d.omicsQualificationId)).toEqual([winner.entityId]);
    expect(db.collections.graph_projection_outbox.docs.map((e) => e.eventId)).toEqual([winner.outboxEventId]);
    expect(db.collections.missingDataReasons.docs.map((r) => r.entityId)).toEqual([winner.entityId]);
    expect(db.collections.dataQualityAssessments.docs.map((d) => [d.dataQualityAssessmentId, d.scopeId]))
      .toEqual([[winner.dataQualityAssessmentId, `OmicsQualification/${winner.entityId}`]]);
  });

  it('15. a declared reasonCode is stored as declared, the other absent fields as unknown', async () => {
    const db = seededDb();

    const result = await ingest(db, { missingDataReasons: [{ fieldPath: 'doi', reasonCode: 'withheld' }] });

    expect(result.status).toBe('accepted');
    expect(db.collections.missingDataReasons.docs.map((r) => [r.fieldPath, r.reasonCode])).toEqual([['doi', 'withheld'], ['distributionFiles', 'unknown'], ['roCrateManifest', 'unknown']]);
    expect(result.missingDataReasons.map((r) => [r.fieldPath, r.reasonCode])).toEqual([['doi', 'withheld'], ['distributionFiles', 'unknown'], ['roCrateManifest', 'unknown']]);
  });

  it.each([
    ['a present field', 'Dataset', { ...DATASET, doi: '10.1/x' }, { fieldPath: 'doi', reasonCode: 'withheld' }, 'MISSING_REASON_FIELD_PRESENT'],
    ['a required field', 'Dataset', DATASET, { fieldPath: 'datasetTitle', reasonCode: 'withheld' }, 'MISSING_REASON_FIELD_NOT_APPLICABLE'],
    ['the code zero', 'Dataset', DATASET, { fieldPath: 'doi', reasonCode: 'zero' }, 'MISSING_REASON_CODE_INVALID'],
    ['a completedAt of 0', 'WorkflowRun', { ...WORKFLOW_RUN, completedAt: 0 }, { fieldPath: 'completedAt', reasonCode: 'not_applicable' }, 'MISSING_REASON_FIELD_PRESENT'],
  ])('16. a declaration on %s quarantines with its code, with no insert and no rows', async (_label, entityType, payload, declaration, code) => {
    const db = seededDb();
    const outbox = fakeOutbox();

    const result = await ingest(db, { outbox, entityType, payload, missingDataReasons: [declaration] });

    expect(result.status).toBe('quarantined');
    expect(result.violations).toEqual(expect.arrayContaining([expect.objectContaining({ code, field: 'missingDataReasons[0]' })]));
    expect(db.collections.datasets.docs).toHaveLength(0);
    expect(db.collections.workflowRuns.docs).toHaveLength(0);
    expect(db.collections.missingDataReasons.docs).toHaveLength(0);
    expect(outbox.appendEvent).not.toHaveBeenCalled();
  });

  // RNF011 C3: one DataQualityAssessment per ingested record.
  const resultOf = (doc, metric) => doc.results.find((r) => r.metric === metric);

  it('17. an accepted Dataset leaves one passed assessment scoped to it, with completeness 4/4', async () => {
    const db = seededDb();

    const result = await ingest(db);

    const docs = db.collections.dataQualityAssessments.docs;
    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({
      dataQualityAssessmentId: result.dataQualityAssessmentId,
      scopeType: 'ingested_record',
      scopeId: `Dataset/${result.entityId}`,
      status: 'passed',
      entityType: 'Dataset',
      canonicalModelReleaseId: 'release-2.0.0',
      configurationReleaseId: 'cfg-release-7',
      createdBy: 'Actor/u-1',
    });
    expect(resultOf(docs[0], 'completeness')).toEqual({ metric: 'completeness', value: 1, numerator: 4, denominator: 4 });
    expect(resultOf(docs[0], 'uniqueness').value).toBe(1);
  });

  it('18. a quarantined Dataset without license leaves one failed assessment scoped to its quarantine record, with completeness 3/4', async () => {
    const db = seededDb();
    const { license, ...withoutLicense } = DATASET;

    const result = await ingest(db, { payload: withoutLicense });

    expect(result.status).toBe('quarantined');
    const docs = db.collections.dataQualityAssessments.docs;
    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({
      dataQualityAssessmentId: result.dataQualityAssessmentId,
      scopeId: `IngestionQuarantineRecord/${result.ingestionQuarantineRecordId}`,
      status: 'failed',
    });
    expect(resultOf(docs[0], 'completeness')).toEqual({ metric: 'completeness', value: 0.75, numerator: 3, denominator: 4 });
  });

  it('19. a replay, accepted or quarantined, records no new assessment', async () => {
    const db = seededDb();
    const unprovenanced = { ...provenance(), purpose: undefined };

    await ingest(db, { idempotencyKey: 'key-a' });
    await ingest(db, { idempotencyKey: 'key-a' });
    await ingest(db, { provenance: unprovenanced, idempotencyKey: 'key-q' });
    await ingest(db, { provenance: unprovenanced, idempotencyKey: 'key-q' });

    expect(db.collections.dataQualityAssessments.docs.map((d) => d.scopeId.split('/')[0])).toEqual(['Dataset', 'IngestionQuarantineRecord']);
  });

  it('20. on a replica set, the assessment insert receives the record transaction session', async () => {
    const db = seededDb();
    const session = onReplicaSet(db);
    const insertOne = vi.spyOn(db.collection('dataQualityAssessments'), 'insertOne');

    const result = await ingest(db);

    expect(insertOne).toHaveBeenCalledTimes(1);
    expect(insertOne).toHaveBeenCalledWith(expect.objectContaining({ dataQualityAssessmentId: result.dataQualityAssessmentId }), { session });
  });

  it('21. a second record with the same sourceSystem and sourceRecordId under another key gets uniqueness 0', async () => {
    const db = seededDb();

    const first = await ingest(db, { idempotencyKey: 'key-1' });
    const second = await ingest(db, { idempotencyKey: 'key-2' });

    expect(second.status).toBe('accepted');
    const byId = Object.fromEntries(db.collections.dataQualityAssessments.docs.map((d) => [d.dataQualityAssessmentId, d]));
    expect(resultOf(byId[first.dataQualityAssessmentId], 'uniqueness').value).toBe(1);
    expect(resultOf(byId[second.dataQualityAssessmentId], 'uniqueness').value).toBe(0);
    expect(byId[second.dataQualityAssessmentId].status).toBe('failed');
  });

  it('22. an accepted OmicsQualification is inserted with a server uuid, a MissingDataReason for limitations and a 4/4 assessment', async () => {
    const db = seededDb();
    const outbox = fakeOutbox();

    const result = await ingest(db, { outbox, entityType: 'OmicsQualification', payload: OMICS_QUALIFICATION });

    expect(result).toMatchObject({ status: 'accepted', entityType: 'OmicsQualification', outboxEventId: 'evt-1' });
    expect(result.entityId).toMatch(UUID);
    expect(db.collections.omicsQualifications.docs).toHaveLength(1);
    expect(db.collections.omicsQualifications.docs[0]).toMatchObject({
      omicsQualificationId: result.entityId,
      targetAssay: 'assay-wgs-1',
      createdBy: 'Actor/u-1',
      canonicalModelReleaseId: 'release-2.0.0',
      configurationReleaseId: 'cfg-release-7',
      limitations: null,
    });
    expect(outbox.appendEvent).toHaveBeenCalledTimes(1);
    expect(outbox.appendEvent.mock.calls[0][1]).toMatchObject({ eventType: 'INGESTION_RECORD_PERSISTED', aggregateType: 'OmicsQualification', aggregateId: result.entityId });
    const rows = db.collections.missingDataReasons.docs;
    expect(rows.map((r) => [r.fieldPath, r.reasonCode])).toEqual([['limitations', 'unknown']]);
    expect(rows[0]).toMatchObject({ entityType: 'OmicsQualification', entityId: result.entityId, sourceEventId: 'evt-1' });
    const docs = db.collections.dataQualityAssessments.docs;
    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({ dataQualityAssessmentId: result.dataQualityAssessmentId, scopeId: `OmicsQualification/${result.entityId}`, status: 'passed' });
    expect(resultOf(docs[0], 'completeness')).toEqual({ metric: 'completeness', value: 1, numerator: 4, denominator: 4 });
  });

  it('23. a declared reasonCode on an OmicsQualification\'s limitations is stored as declared', async () => {
    const db = seededDb();

    const result = await ingest(db, { entityType: 'OmicsQualification', payload: OMICS_QUALIFICATION, missingDataReasons: [{ fieldPath: 'limitations', reasonCode: 'not_applicable' }] });

    expect(result.status).toBe('accepted');
    expect(db.collections.missingDataReasons.docs.map((r) => [r.fieldPath, r.reasonCode])).toEqual([['limitations', 'not_applicable']]);
    expect(result.missingDataReasons.map((r) => [r.fieldPath, r.reasonCode])).toEqual([['limitations', 'not_applicable']]);
  });

  it('24. an OmicsQualification declaring a reason on a present limitations quarantines with MISSING_REASON_FIELD_PRESENT, with no insert, no append and no rows', async () => {
    const db = seededDb();
    const outbox = fakeOutbox();

    const result = await ingest(db, { outbox, entityType: 'OmicsQualification', payload: { ...OMICS_QUALIFICATION, limitations: 'n/a' }, missingDataReasons: [{ fieldPath: 'limitations', reasonCode: 'not_applicable' }] });

    expect(result.status).toBe('quarantined');
    expect(result.violations).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'MISSING_REASON_FIELD_PRESENT', field: 'missingDataReasons[0]' })]));
    expect(db.collections.omicsQualifications.docs).toHaveLength(0);
    expect(db.collections.missingDataReasons.docs).toHaveLength(0);
    expect(outbox.appendEvent).not.toHaveBeenCalled();
  });

  it('24b. an OmicsQualification without qcRuleSetVersion quarantines with no insert, no append and no rows, and a failed 3/4 assessment', async () => {
    const db = seededDb();
    const outbox = fakeOutbox();
    const { qcRuleSetVersion, ...withoutQcRuleSetVersion } = OMICS_QUALIFICATION;

    const result = await ingest(db, { outbox, entityType: 'OmicsQualification', payload: withoutQcRuleSetVersion });

    expect(result.status).toBe('quarantined');
    expect(db.collections.omicsQualifications.docs).toHaveLength(0);
    expect(db.collections.missingDataReasons.docs).toHaveLength(0);
    expect(outbox.appendEvent).not.toHaveBeenCalled();
    const docs = db.collections.dataQualityAssessments.docs;
    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({ scopeId: `IngestionQuarantineRecord/${result.ingestionQuarantineRecordId}`, status: 'failed' });
    expect(resultOf(docs[0], 'completeness')).toEqual({ metric: 'completeness', value: 0.75, numerator: 3, denominator: 4 });
  });

  it('24c. case 24\'s quarantine record keeps the declaration and the payload as sent', async () => {
    const db = seededDb();
    const payload = { ...OMICS_QUALIFICATION, limitations: 'n/a' };

    const result = await ingest(db, { entityType: 'OmicsQualification', payload, missingDataReasons: [{ fieldPath: 'limitations', reasonCode: 'not_applicable' }] });

    expect(result.status).toBe('quarantined');
    const records = db.collections.ingestionQuarantineRecords.docs;
    expect(records).toHaveLength(1);
    expect(records[0].missingDataReasons).toEqual([{ fieldPath: 'limitations', reasonCode: 'not_applicable' }]);
    expect(records[0].payload).toEqual({ ...OMICS_QUALIFICATION, limitations: 'n/a' });
  });

  it('24d. a Dataset quarantined for a provenance without purpose keeps its valid declaration on the record, with no rows', async () => {
    const db = seededDb();
    const { purpose, ...withoutPurpose } = provenance();

    const result = await ingest(db, { provenance: withoutPurpose, missingDataReasons: [{ fieldPath: 'doi', reasonCode: 'not_collected' }] });

    expect(result.status).toBe('quarantined');
    const records = db.collections.ingestionQuarantineRecords.docs;
    expect(records).toHaveLength(1);
    expect(records[0].missingDataReasons).toEqual([{ fieldPath: 'doi', reasonCode: 'not_collected' }]);
    expect(db.collections.missingDataReasons.docs).toHaveLength(0);
  });

  // #1318: Assay, the fourth target, runs its master mount's reference check
  // (assayReferenceValidator.js, #1219) and #1182 organization scope on
  // laboratoryId. createFakeDb compares with ===, so the samples lookup by a
  // 24-hex _id is answered here by String(_id), as the driver matches it.
  const SPECIMEN_HEX = '507f1f77bcf86cd799439011';
  const ASSAY = {
    studyId: 'study-1',
    specimenIds: ['SPC-1'],
    assayType: 'RNA sequencing',
    protocolId: 'protocol-1',
    operatorId: 'op-1',
    laboratoryId: 'org-lab-1',
    assayDateTime: '2026-10-01T09:00:00.000Z',
    intendedUse: 'RF029 ingestion proof',
  };
  const GLOBAL_SCOPE = async () => ({ scope: 'global', organizationIds: [] });
  const orgScope = (...organizationIds) => async () => ({ scope: 'organization', organizationIds });

  function assayDb({ samples = [{ specimenId: 'SPC-1', specimenStatus: 'available' }] } = {}) {
    const db = seededDb();
    for (const [name, docs] of Object.entries({
      samples,
      protocols: [{ protocolId: 'protocol-1' }],
      users: [{ _id: 'op-1' }],
      organizations: [{ organizationId: 'org-lab-1' }],
      assays: [],
    })) {
      db.collection(name).docs.push(...docs);
    }
    const sampleCollection = db.collection('samples');
    const byField = sampleCollection.findOne.bind(sampleCollection);
    sampleCollection.findOne = async (filter = {}) => ('_id' in filter
      ? sampleCollection.docs.find((doc) => doc._id !== undefined && String(doc._id) === String(filter._id)) || null
      : byField(filter));
    return db;
  }

  function ingestAssay(db, overrides = {}) {
    return ingest(db, { entityType: 'Assay', payload: ASSAY, resolveOrganizationScope: GLOBAL_SCOPE, ...overrides });
  }

  it('25. an accepted Assay from a global caller lands in assays with its outbox event, five MissingDataReason rows and an assessment', async () => {
    const db = assayDb();
    const outbox = fakeOutbox();

    const result = await ingestAssay(db, { outbox });

    expect(result).toMatchObject({ status: 'accepted', entityType: 'Assay', outboxEventId: 'evt-1' });
    expect(result.entityId).toMatch(UUID);
    expect(db.collections.assays.docs).toHaveLength(1);
    expect(db.collections.assays.docs[0]).toMatchObject({
      assayId: result.entityId,
      specimenIds: ['SPC-1'],
      laboratoryId: 'org-lab-1',
      createdBy: 'Actor/u-1',
      canonicalModelReleaseId: 'release-2.0.0',
      omicsDomain: null,
      assayBatchId: null,
      controls: [],
      reagentLotIds: [],
      equipmentIds: [],
    });
    expect(outbox.appendEvent).toHaveBeenCalledTimes(1);
    expect(outbox.appendEvent.mock.calls[0][1]).toMatchObject({ eventType: 'INGESTION_RECORD_PERSISTED', aggregateType: 'Assay', aggregateId: result.entityId });
    const rows = db.collections.missingDataReasons.docs;
    expect(rows.map((r) => [r.fieldPath, r.reasonCode])).toEqual([['omicsDomain', 'unknown'], ['assayBatchId', 'unknown'], ['controls', 'unknown'], ['reagentLotIds', 'unknown'], ['equipmentIds', 'unknown']]);
    expect(rows.every((r) => r.entityType === 'Assay' && r.entityId === result.entityId && r.sourceEventId === 'evt-1')).toBe(true);
    const docs = db.collections.dataQualityAssessments.docs;
    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({ dataQualityAssessmentId: result.dataQualityAssessmentId, scopeId: `Assay/${result.entityId}`, status: 'passed' });
  });

  it('26. an Assay naming its specimen by _id is stored with the canonical specimenId (#1219)', async () => {
    const { ObjectId } = require('mongodb');
    const db = assayDb({ samples: [{ _id: new ObjectId(SPECIMEN_HEX), specimenId: 'SPC-CANON', specimenStatus: 'available' }] });
    const payload = { ...ASSAY, specimenIds: [SPECIMEN_HEX] };

    const result = await ingestAssay(db, { payload });

    expect(result.status).toBe('accepted');
    expect(db.collections.assays.docs.map((d) => d.specimenIds)).toEqual([['SPC-CANON']]);
    expect(payload.specimenIds).toEqual([SPECIMEN_HEX]);
  });

  it('27. an Assay naming an unresolved specimen quarantines with REFERENCE_NOT_FOUND and the original payload, and writes no assays document', async () => {
    const db = assayDb({ samples: [] });
    const outbox = fakeOutbox();

    const result = await ingestAssay(db, { outbox });

    expect(result.status).toBe('quarantined');
    expect(result.violations).toEqual([{ code: 'REFERENCE_NOT_FOUND', field: null, message: 'specimenIds: SPC-1 não encontrado' }]);
    expect(db.collections.ingestionQuarantineRecords.docs).toHaveLength(1);
    expect(db.collections.ingestionQuarantineRecords.docs[0].payload).toEqual(ASSAY);
    expect(db.collections.assays.docs).toHaveLength(0);
    expect(db.collections.missingDataReasons.docs).toHaveLength(0);
    expect(outbox.appendEvent).not.toHaveBeenCalled();
    expect(db.collections.dataQualityAssessments.docs.map((d) => d.status)).toEqual(['failed']);
  });

  it('28. an Assay naming a quarantined specimen quarantines with REFERENCE_NOT_USABLE (RF019)', async () => {
    const db = assayDb({ samples: [{ specimenId: 'SPC-1', specimenStatus: 'quarantined' }] });

    const result = await ingestAssay(db);

    expect(result.status).toBe('quarantined');
    expect(result.violations).toEqual([expect.objectContaining({ code: 'REFERENCE_NOT_USABLE', field: null, message: expect.stringMatching(/quarentena/) })]);
    expect(db.collections.assays.docs).toHaveLength(0);
  });

  it('29. an organization caller whose organizationIds include the laboratoryId is accepted', async () => {
    const db = assayDb();

    const result = await ingestAssay(db, { resolveOrganizationScope: orgScope('org-other', 'org-lab-1') });

    expect(result.status).toBe('accepted');
    expect(db.collections.assays.docs.map((d) => d.laboratoryId)).toEqual(['org-lab-1']);
  });

  const { laboratoryId: _laboratoryId, ...ASSAY_WITHOUT_LABORATORY } = ASSAY;
  it.each([
    ['an organization caller outside the laboratoryId', { resolveOrganizationScope: orgScope('org-other') }],
    ['an organization caller sending no laboratoryId', { resolveOrganizationScope: orgScope('org-lab-1'), payload: ASSAY_WITHOUT_LABORATORY }],
    ['a caller with none scope', { resolveOrganizationScope: async () => ({ scope: 'none', organizationIds: [] }) }],
    ['a call with no resolver', { resolveOrganizationScope: undefined }],
  ])('30. %s is refused 403 INGESTION_OUT_OF_SCOPE and writes nothing (#1182)', async (_label, overrides) => {
    const db = assayDb();
    const outbox = fakeOutbox();

    const error = await ingestAssay(db, { outbox, idempotencyKey: 'assay-key-1', ...overrides }).catch((e) => e);

    expect(error).toMatchObject({ statusCode: 403, code: 'INGESTION_OUT_OF_SCOPE', canonicalModelReleaseId: 'release-2.0.0', configurationReleaseId: 'cfg-release-7' });
    expect(db.collections.assays.docs).toHaveLength(0);
    expect(db.collections.ingestionQuarantineRecords.docs).toHaveLength(0);
    expect(db.collections.ingestionIdempotencyKeys.docs).toHaveLength(0);
    expect(db.collections.missingDataReasons.docs).toHaveLength(0);
    expect(db.collections.dataQualityAssessments.docs).toHaveLength(0);
    expect(outbox.appendEvent).not.toHaveBeenCalled();
  });

  it('31. a Dataset ingested with no resolver is accepted, and a passed resolver is never called', async () => {
    const resolver = vi.fn(GLOBAL_SCOPE);

    expect((await ingest(seededDb())).status).toBe('accepted');
    expect((await ingest(seededDb(), { resolveOrganizationScope: resolver })).status).toBe('accepted');
    expect(resolver).not.toHaveBeenCalled();
  });

  // #1318: OmicsRun, the fifth target, is ingested only for the modalities
  // whose v2 entity is stored in MongoDB (dict-ENTIDADES GenomicsRun,
  // MicrobiomeRun); the three Object Storage ones are refused (RF029 AC4).
  const OMICS_RUN = { modality: 'genomics' };

  it('32. an accepted genomics OmicsRun is inserted with a server uuid, three MissingDataReason rows and an assessment', async () => {
    const db = seededDb();
    const outbox = fakeOutbox();

    const result = await ingest(db, { outbox, entityType: 'OmicsRun', payload: OMICS_RUN });

    expect(result).toMatchObject({ status: 'accepted', entityType: 'OmicsRun', outboxEventId: 'evt-1' });
    expect(result.entityId).toMatch(UUID);
    expect(db.collections.omicsRuns.docs).toHaveLength(1);
    expect(db.collections.omicsRuns.docs[0]).toMatchObject({
      omicsRunId: result.entityId,
      modality: 'genomics',
      createdBy: 'Actor/u-1',
      canonicalModelReleaseId: 'release-2.0.0',
      configurationReleaseId: 'cfg-release-7',
      referenceAssembly: null,
      mixsChecklist: null,
      fileLinks: [],
    });
    expect(outbox.appendEvent).toHaveBeenCalledTimes(1);
    expect(outbox.appendEvent.mock.calls[0][1]).toMatchObject({ eventType: 'INGESTION_RECORD_PERSISTED', aggregateType: 'OmicsRun', aggregateId: result.entityId });
    const rows = db.collections.missingDataReasons.docs;
    expect(rows.map((r) => [r.fieldPath, r.reasonCode])).toEqual([['referenceAssembly', 'unknown'], ['mixsChecklist', 'unknown'], ['fileLinks', 'unknown']]);
    expect(rows.every((r) => r.entityType === 'OmicsRun' && r.entityId === result.entityId && r.sourceEventId === 'evt-1')).toBe(true);
    const docs = db.collections.dataQualityAssessments.docs;
    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({ dataQualityAssessmentId: result.dataQualityAssessmentId, scopeId: `OmicsRun/${result.entityId}`, status: 'passed' });
  });

  it('33. a microbiome OmicsRun is accepted', async () => {
    const db = seededDb();

    const result = await ingest(db, { entityType: 'OmicsRun', payload: { modality: 'microbiome', mixsChecklist: 'MIMARKS-survey' } });

    expect(result.status).toBe('accepted');
    expect(db.collections.omicsRuns.docs.map((d) => [d.omicsRunId, d.modality, d.mixsChecklist])).toEqual([[result.entityId, 'microbiome', 'MIMARKS-survey']]);
    expect(db.collections.missingDataReasons.docs.map((r) => r.fieldPath)).toEqual(['referenceAssembly', 'fileLinks']);
  });

  it.each(['transcriptomics', 'proteomics', 'metabolomics'])('34. a %s OmicsRun, an Object Storage entity, is refused 422 INGESTION_STORE_UNSUPPORTED and writes nothing (RF029 AC4)', async (modality) => {
    const db = seededDb();
    const outbox = fakeOutbox();

    const error = await ingest(db, { outbox, entityType: 'OmicsRun', payload: { modality }, idempotencyKey: 'omics-run-key-1' }).catch((e) => e);

    expect(error).toMatchObject({
      statusCode: 422,
      code: 'INGESTION_STORE_UNSUPPORTED',
      details: [expect.stringContaining(modality)],
      canonicalModelReleaseId: 'release-2.0.0',
      configurationReleaseId: 'cfg-release-7',
    });
    for (const [name, collection] of Object.entries(db.collections)) {
      if (name === 'canonicalModelReleases' || name === 'security_config') continue;
      expect(collection.docs, name).toHaveLength(0);
    }
    expect(outbox.appendEvent).not.toHaveBeenCalled();
  });

  it('35. an OmicsRun with an unknown modality quarantines rather than being refused', async () => {
    const db = seededDb();
    const outbox = fakeOutbox();

    const result = await ingest(db, { outbox, entityType: 'OmicsRun', payload: { modality: 'foo' } });

    expect(result.status).toBe('quarantined');
    expect(db.collections.ingestionQuarantineRecords.docs.map((r) => r.payload)).toEqual([{ modality: 'foo' }]);
    expect(db.collections.omicsRuns.docs).toHaveLength(0);
    expect(db.collections.missingDataReasons.docs).toHaveLength(0);
    expect(outbox.appendEvent).not.toHaveBeenCalled();
  });

  it('36. without a session, a concurrent OmicsRun loser leaves no document, event, MissingDataReason or assessment of its own', async () => {
    const { db, winner, loser, docs } = await raceOnOneKey({ entityType: 'OmicsRun', payload: OMICS_RUN, collection: 'omicsRuns' });

    expect(winner.status).toBe('accepted');
    expect(loser).toEqual({ status: 'idempotent_replay', outcome: 'accepted', entityType: 'OmicsRun', resultRef: winner.entityId, canonicalModelReleaseId: 'release-2.0.0', configurationReleaseId: 'cfg-release-7' });
    expect(docs.map((d) => d.omicsRunId)).toEqual([winner.entityId]);
    expect(db.collections.graph_projection_outbox.docs.map((e) => e.eventId)).toEqual([winner.outboxEventId]);
    expect(db.collections.missingDataReasons.docs.map((r) => r.entityId)).toEqual([winner.entityId, winner.entityId, winner.entityId]);
    expect(db.collections.dataQualityAssessments.docs.map((d) => [d.dataQualityAssessmentId, d.scopeId]))
      .toEqual([[winner.dataQualityAssessmentId, `OmicsRun/${winner.entityId}`]]);
  });

  // #1318: Specimen, the sixth target, runs the sample mount's participant,
  // consent, site, parent and barcode gates (specimenTarget.js) and #1182
  // scope on collectionSite. samples is a matching collection, so an insert
  // gets the driver's _id, the key SPECIMEN_UPSERTED carries.
  const PARTICIPANT = '12345678';
  const SPECIMEN = {
    specimenId: 'client-claimed',
    participantId: PARTICIPANT,
    sampleType: 'PLASMA',
    sampleOrigin: 'VENOUS_BLOOD',
    extractionProtocol: 'TUBE_EDTA',
    quantity: 5,
    registeredAt: '2026-10-01T09:00:00.000Z',
    collectionSite: 'org-site-1',
  };

  function seedSpecimenReferences(db, { consents = [{ participantId: PARTICIPANT, status: 'ACTIVE' }] } = {}) {
    db.collection('patients').docs.push({ participantId: PARTICIPANT });
    db.collection('patientConsents').docs.push(...consents);
    db.collection('organizations').docs.push({ organizationId: 'org-site-1' });
  }

  function specimenDb(options = {}) {
    const db = seededDb();
    seedSpecimenReferences(db, options);
    db.collections.samples = createMatchingCollection(options.samples || []);
    return db;
  }

  function ingestSpecimen(db, overrides = {}) {
    return ingest(db, { entityType: 'Specimen', payload: SPECIMEN, resolveOrganizationScope: GLOBAL_SCOPE, ...overrides });
  }

  it('37. an accepted Specimen lands in samples with a 7-digit server specimenId, organizationId stamped from collectionSite, five MissingDataReason rows and SPECIMEN_UPSERTED', async () => {
    const db = specimenDb();
    const outbox = fakeOutbox();

    const result = await ingestSpecimen(db, { outbox });

    expect(result).toMatchObject({ status: 'accepted', entityType: 'Specimen', outboxEventId: 'evt-1' });
    expect(result.entityId).toMatch(/^\d{7}$/);
    const docs = db.collections.samples.docs;
    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({
      specimenId: result.entityId,
      participantId: PARTICIPANT,
      collectionSite: 'org-site-1',
      organizationId: 'org-site-1',
      specimenStatus: 'available',
      unit: 'µL',
      locationID: null,
      storageLocation: null,
      createdBy: 'Actor/u-1',
      sourceRecordId: 'LIMS-DS-42',
      canonicalModelReleaseId: 'release-2.0.0',
    });
    expect(outbox.appendEvent.mock.calls.map(([, event]) => [event.eventType, event.aggregateId]))
      .toEqual([['INGESTION_RECORD_PERSISTED', result.entityId], ['SPECIMEN_UPSERTED', String(docs[0]._id)]]);
    expect(outbox.appendEvent.mock.calls[1][1]).toMatchObject({ payload: { specimenId: String(docs[0]._id), participantId: PARTICIPANT }, sourceService: 'ingestion-gateway' });
    const rows = db.collections.missingDataReasons.docs;
    expect(rows.map((r) => [r.fieldPath, r.reasonCode])).toEqual([['barcode', 'unknown'], ['linkedProject', 'unknown'], ['parentSpecimenIds', 'unknown'], ['merkleRoot', 'unknown'], ['sprec', 'unknown']]);
    expect(rows.every((r) => r.entityType === 'Specimen' && r.entityId === result.entityId)).toBe(true);
    expect(db.collections.dataQualityAssessments.docs.map((d) => [d.scopeId, d.status])).toEqual([[`Specimen/${result.entityId}`, 'passed']]);
    expect(db.collection('labelIdentifiers').docs).toHaveLength(0);
    expect(db.collection('containers').docs).toHaveLength(0);
  });

  it('37b. an accepted Specimen with a barcode has it issued as its one active label, on the container of its one load, and stays unallocated (#1378)', async () => {
    const db = specimenDb();

    const result = await ingestSpecimen(db, { payload: { ...SPECIMEN, barcode: 'BC-PROBE-1' } });

    expect(result.status).toBe('accepted');
    const [stored] = db.collections.samples.docs;
    expect(stored).toMatchObject({ barcode: 'BC-PROBE-1', storageLocation: null });
    const loads = db.collection('specimenContainerAssignments').docs;
    expect(loads).toHaveLength(1);
    expect(loads[0].specimenId).toBe(result.entityId);
    const labels = db.collection('labelIdentifiers').docs.filter((label) => label.status === 'active');
    expect(labels).toHaveLength(1);
    expect(labels[0]).toMatchObject({ encodedValue: 'BC-PROBE-1', targetType: 'container', targetId: loads[0].containerId, issuedBy: 'u-1', printBatchId: null });
    expect(db.collection('containers').docs.map((container) => container.containerId)).toEqual([loads[0].containerId]);
    expect(db.collection('containerPositionAssignments').docs).toHaveLength(0);
  });

  it('38. on a replica set, SPECIMEN_UPSERTED and LINEAGE_REGISTERED are appended in the sample insert\'s session (#1313)', async () => {
    const { ObjectId } = require('mongodb');
    const parentOid = new ObjectId(SPECIMEN_HEX);
    const db = specimenDb({ samples: [{ _id: parentOid, specimenId: '1111111', participantId: PARTICIPANT, specimenStatus: 'available' }] });
    const session = onReplicaSet(db);
    const outbox = fakeOutbox();

    const result = await ingestSpecimen(db, { outbox, payload: { ...SPECIMEN, parentSpecimenIds: ['1111111'] } });

    expect(result.status).toBe('accepted');
    const stored = db.collections.samples.docs.find((d) => d.specimenId === result.entityId);
    expect(db.collections.samples.insertOne).toHaveBeenCalledWith(stored, { session });
    expect(outbox.appendEvent.mock.calls.map(([, event, opts]) => [event.eventType, event.payload.parentSpecimenId ?? null, opts]))
      .toEqual([['INGESTION_RECORD_PERSISTED', null, { session }], ['SPECIMEN_UPSERTED', null, { session }], ['LINEAGE_REGISTERED', SPECIMEN_HEX, { session }]]);
    expect(stored.parentSpecimenIds).toEqual(['1111111']);
  });

  it.each([
    ['no consent', []],
    ['a revoked consent', [{ participantId: PARTICIPANT, status: 'REVOKED' }]],
  ])('39. a Specimen whose participant has %s quarantines with CONSENT_NOT_ACTIVE and writes nothing to samples (RF029 AC2)', async (_label, consents) => {
    const db = specimenDb({ consents });
    const outbox = fakeOutbox();

    const result = await ingestSpecimen(db, { outbox });

    expect(result.status).toBe('quarantined');
    expect(result.violations).toEqual([expect.objectContaining({ code: 'CONSENT_NOT_ACTIVE', field: null })]);
    expect(db.collections.samples.docs).toHaveLength(0);
    expect(db.collections.missingDataReasons.docs).toHaveLength(0);
    expect(outbox.appendEvent).not.toHaveBeenCalled();
  });

  it('40. a Specimen naming an unknown participant quarantines with REFERENCE_NOT_FOUND', async () => {
    const db = specimenDb();

    const result = await ingestSpecimen(db, { payload: { ...SPECIMEN, participantId: '87654321' } });

    expect(result.status).toBe('quarantined');
    expect(result.violations).toEqual([{ code: 'REFERENCE_NOT_FOUND', field: null, message: 'participantId 87654321 não encontrado' }]);
    expect(db.collections.samples.docs).toHaveLength(0);
  });

  it('40b. a Specimen whose participant lookup fails rejects, and writes no sample, quarantine record or idempotency key', async () => {
    const db = specimenDb();
    const outage = new Error('connection reset');
    db.collection('patients').findOne = async () => { throw outage; };
    const outbox = fakeOutbox();

    await expect(ingestSpecimen(db, { outbox, idempotencyKey: 'specimen-key-1' })).rejects.toBe(outage);

    expect(db.collections.samples.docs).toHaveLength(0);
    expect(db.collections.ingestionQuarantineRecords.docs).toHaveLength(0);
    expect(db.collections.ingestionIdempotencyKeys.docs).toHaveLength(0);
    expect(outbox.appendEvent).not.toHaveBeenCalled();
  });

  it('41. a Specimen whose barcode samples already holds quarantines with DUPLICATE_BARCODE', async () => {
    const db = specimenDb({ samples: [{ specimenId: '2222222', participantId: PARTICIPANT, barcode: 'BC-1' }] });

    const result = await ingestSpecimen(db, { payload: { ...SPECIMEN, barcode: 'BC-1' } });

    expect(result.status).toBe('quarantined');
    expect(result.violations).toEqual([expect.objectContaining({ code: 'DUPLICATE_BARCODE' })]);
    expect(db.collections.samples.docs).toHaveLength(1);
  });

  it('41b. a Specimen whose barcode is already an active label quarantines with DUPLICATE_BARCODE and writes no sample, label or container (#1378)', async () => {
    const db = specimenDb();
    db.collection('labelIdentifiers').docs.push({ namespaceRegistryId: 'legacy-sample-barcode', encodedValue: 'BC-1', status: 'active', targetType: 'container', targetId: 'ctr-old' });

    const result = await ingestSpecimen(db, { payload: { ...SPECIMEN, barcode: 'BC-1' } });

    expect(result.status).toBe('quarantined');
    expect(result.violations).toEqual([expect.objectContaining({ code: 'DUPLICATE_BARCODE' })]);
    expect(db.collections.samples.docs).toHaveLength(0);
    expect(db.collection('labelIdentifiers').docs).toHaveLength(1);
    expect(db.collection('containers').docs).toHaveLength(0);
  });

  it.each([
    ['whitespace', 'BC 1', 'texto livre'],
    ['an e-mail', 'a@b.co', 'e-mail'],
    ['a CPF', '52998224725', 'CPF'],
  ])('41c. a Specimen whose barcode carries %s is refused 422 BARCODE_PERSONAL_DATA before the gateway, naming the kind and never the value, and writes no sample, label, container or quarantine record (RULE-012)', async (_label, barcode, kind) => {
    const db = specimenDb();
    const outbox = fakeOutbox();

    const error = await ingestSpecimen(db, { outbox, payload: { ...SPECIMEN, barcode }, idempotencyKey: 'specimen-key-1' }).catch((e) => e);

    expect(error).toMatchObject({ statusCode: 422, code: 'BARCODE_PERSONAL_DATA', canonicalModelReleaseId: 'release-2.0.0', configurationReleaseId: 'cfg-release-7' });
    expect(error.message).toContain(kind);
    expect(JSON.stringify({ message: error.message, details: error.details })).not.toContain(barcode);
    expect(db.collections.samples.docs).toHaveLength(0);
    expect(db.collection('labelIdentifiers').docs).toHaveLength(0);
    expect(db.collection('containers').docs).toHaveLength(0);
    expect(db.collections.ingestionQuarantineRecords.docs).toHaveLength(0);
    expect(db.collections.ingestionIdempotencyKeys.docs).toHaveLength(0);
    expect(db.collections.dataQualityAssessments.docs).toHaveLength(0);
    expect(outbox.appendEvent).not.toHaveBeenCalled();
  });

  it('41d. a model-invalid Specimen with a CPF barcode is refused 422 too, never quarantined with the value as sent (RULE-012)', async () => {
    const db = specimenDb();
    const { sampleType: _sampleType, ...invalid } = SPECIMEN;

    const error = await ingestSpecimen(db, { payload: { ...invalid, barcode: '52998224725' } }).catch((e) => e);

    expect(error).toMatchObject({ statusCode: 422, code: 'BARCODE_PERSONAL_DATA' });
    expect(db.collections.ingestionQuarantineRecords.docs).toHaveLength(0);
    expect(db.collections.samples.docs).toHaveLength(0);
  });

  it('41d2. a CPF barcode is refused under a key already recorded, never replayed (RULE-012)', async () => {
    const db = specimenDb();
    const first = await ingestSpecimen(db, { idempotencyKey: 'specimen-key-1' });
    expect(first.status).toBe('accepted');

    const error = await ingestSpecimen(db, { payload: { ...SPECIMEN, barcode: '52998224725' }, idempotencyKey: 'specimen-key-1' }).catch((e) => e);

    expect(error).toMatchObject({ statusCode: 422, code: 'BARCODE_PERSONAL_DATA' });
    expect(db.collections.samples.docs.map((d) => d.specimenId)).toEqual([first.entityId]);
    expect(db.collections.samples.docs[0].barcode ?? null).toBeNull();
  });

  it('41e. a Specimen with the all-digit barcode 0001234 is no personal data and is accepted with it as its label', async () => {
    const db = specimenDb();

    const result = await ingestSpecimen(db, { payload: { ...SPECIMEN, barcode: '0001234' } });

    expect(result.status).toBe('accepted');
    expect(db.collection('labelIdentifiers').docs.map((label) => label.encodedValue)).toEqual(['0001234']);
  });

  it('42. a Specimen sending organizationId quarantines: tenancy is stamped by the server, never taken from a body (#1192)', async () => {
    const db = specimenDb();

    const result = await ingestSpecimen(db, { payload: { ...SPECIMEN, organizationId: 'org-site-1' } });

    expect(result.status).toBe('quarantined');
    expect(db.collections.samples.docs).toHaveLength(0);
  });

  const { collectionSite: _collectionSite, ...SPECIMEN_WITHOUT_SITE } = SPECIMEN;
  it.each([
    ['an organization caller outside the collectionSite', { resolveOrganizationScope: orgScope('org-other') }],
    ['a global caller sending no collectionSite', { payload: SPECIMEN_WITHOUT_SITE }],
  ])('43. %s is refused 403 INGESTION_OUT_OF_SCOPE and writes nothing (#1182)', async (_label, overrides) => {
    const db = specimenDb();
    const outbox = fakeOutbox();

    const error = await ingestSpecimen(db, { outbox, ...overrides }).catch((e) => e);

    expect(error).toMatchObject({ statusCode: 403, code: 'INGESTION_OUT_OF_SCOPE' });
    expect(db.collections.samples.docs).toHaveLength(0);
    expect(db.collections.ingestionQuarantineRecords.docs).toHaveLength(0);
    expect(outbox.appendEvent).not.toHaveBeenCalled();
  });

  it('44. without a session, a concurrent Specimen loser leaves no document and none of its own events, SPECIMEN_UPSERTED included', async () => {
    const { db, winner, loser, docs } = await raceOnOneKey({
      entityType: 'Specimen',
      payload: SPECIMEN,
      collection: 'samples',
      seed: (target) => seedSpecimenReferences(target),
      overrides: { resolveOrganizationScope: GLOBAL_SCOPE },
    });

    expect(winner.status).toBe('accepted');
    expect(loser).toMatchObject({ status: 'idempotent_replay', outcome: 'accepted', entityType: 'Specimen', resultRef: winner.entityId });
    expect(docs.map((d) => d.specimenId)).toEqual([winner.entityId]);
    expect(db.collections.graph_projection_outbox.docs.map((e) => [e.eventType, e.aggregateId]))
      .toEqual([['INGESTION_RECORD_PERSISTED', winner.entityId], ['SPECIMEN_UPSERTED', String(docs[0]._id)]]);
    expect(db.collections.missingDataReasons.docs.every((r) => r.entityId === winner.entityId)).toBe(true);
  });

  // #1318: Participant, the seventh target, runs the participant mount's
  // clinical unit, deceased and consent template gates (participantTarget.js)
  // and #1182 scope on clinicalUnitId, and refuses a record carrying civil
  // identity, which lives on ParticipantIdentity alone (#575).
  // consent_templates is a matching collection: its _id is an ObjectId.
  const TEMPLATE_HEX = '64b7f0c2a1b2c3d4e5f60718';
  const PARTICIPANT_RECORD = { participantId: 'client-claimed', sex: 'F', clinicalUnitId: 'org-unit-1', consentTemplateId: TEMPLATE_HEX };

  function participantDb({ templates = null } = {}) {
    const { ObjectId } = require('mongodb');
    const db = seededDb();
    db.collection('organizations').docs.push({ organizationId: 'org-unit-1', officialName: 'Hospital Central', acronym: 'HC' });
    db.collections.consent_templates = createMatchingCollection(templates || [{ _id: new ObjectId(TEMPLATE_HEX), title: 'TCLE' }]);
    return db;
  }

  function ingestParticipant(db, overrides = {}) {
    return ingest(db, { entityType: 'Participant', payload: PARTICIPANT_RECORD, resolveOrganizationScope: GLOBAL_SCOPE, ...overrides });
  }

  function expectNothingWritten(db) {
    expect(db.collections.patients.docs).toHaveLength(0);
    expect(db.collections.ingestionQuarantineRecords.docs).toHaveLength(0);
    expect(db.collections.ingestionIdempotencyKeys.docs).toHaveLength(0);
    expect(db.collections.missingDataReasons.docs).toHaveLength(0);
    expect(db.collections.dataQualityAssessments.docs).toHaveLength(0);
  }

  it('45. an accepted Participant lands in patients with an 8-digit server participantId, PENDING_CONSENT, the unit\'s snapshot, its outbox event and no MissingDataReason row', async () => {
    const db = participantDb();
    const outbox = fakeOutbox();

    const result = await ingestParticipant(db, { outbox });

    expect(result).toMatchObject({ status: 'accepted', entityType: 'Participant', outboxEventId: 'evt-1', missingDataReasons: [] });
    expect(result.entityId).toMatch(/^[1-9]\d{7}$/);
    const docs = db.collections.patients.docs;
    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({
      participantId: result.entityId,
      sex: 'F',
      status: 'PENDING_CONSENT',
      isDeceased: false,
      clinicalUnitId: 'org-unit-1',
      clinicalUnit: 'Hospital Central',
      unitAcronym: 'HC',
      consentTemplateId: TEMPLATE_HEX,
      consentTokenHash: null,
      createdBy: 'Actor/u-1',
      sourceRecordId: 'LIMS-DS-42',
      canonicalModelReleaseId: 'release-2.0.0',
      configurationReleaseId: 'cfg-release-7',
    });
    expect(outbox.appendEvent.mock.calls.map(([, event]) => [event.eventType, event.aggregateType, event.aggregateId]))
      .toEqual([['INGESTION_RECORD_PERSISTED', 'Participant', result.entityId]]);
    expect(db.collections.missingDataReasons.docs).toHaveLength(0);
    expect(db.collections.dataQualityAssessments.docs.map((d) => [d.scopeId, d.status])).toEqual([[`Participant/${result.entityId}`, 'passed']]);
  });

  it.each([
    ['an unknown clinicalUnitId', { clinicalUnitId: 'org-other' }, {}, 'REFERENCE_NOT_FOUND'],
    ['a deceased participant', { isDeceased: true }, {}, 'DECEASED_REPRESENTATIVE_REQUIRED'],
    ['an unknown consentTemplateId', {}, { templates: [] }, 'REFERENCE_NOT_FOUND'],
    ['a consentTemplateId that is not an ObjectId', { consentTemplateId: 'tcle-1' }, {}, 'REFERENCE_NOT_FOUND'],
  ])('46. a Participant with %s quarantines with its violation code and writes nothing to patients', async (_label, change, dbOptions, code) => {
    const db = participantDb(dbOptions);
    const outbox = fakeOutbox();

    const result = await ingestParticipant(db, { outbox, payload: { ...PARTICIPANT_RECORD, ...change } });

    expect(result.status).toBe('quarantined');
    expect(result.violations).toEqual([expect.objectContaining({ code, field: null })]);
    expect(db.collections.patients.docs).toHaveLength(0);
    expect(outbox.appendEvent).not.toHaveBeenCalled();
  });

  it('47. a Participant declaring a MissingDataReason quarantines with MISSING_REASON_FIELD_NOT_APPLICABLE: no field takes one', async () => {
    const db = participantDb();

    const result = await ingestParticipant(db, { missingDataReasons: [{ fieldPath: 'isDeceased', reasonCode: 'unknown' }] });

    expect(result.status).toBe('quarantined');
    expect(result.violations.map((v) => v.code)).toEqual(['MISSING_REASON_FIELD_NOT_APPLICABLE']);
  });

  it.each([
    ['patientName', { patientName: 'Maria Silva' }, ['patientName'], 'Maria Silva'],
    ['email null', { email: null }, ['email'], null],
    ['recordNumber', { recordNumber: 'PRONT-0042' }, ['recordNumber'], 'PRONT-0042'],
    ['an empty birthDate and a representativeName', { birthDate: '', representativeName: 'José Souza' }, ['birthDate', 'representativeName'], 'José Souza'],
  ])('48. a Participant carrying %s is refused 422 INGESTION_STORE_UNSUPPORTED, naming the fields and never their values, and writes nothing', async (_label, identity, fields, value) => {
    const db = participantDb();
    const outbox = fakeOutbox();

    const error = await ingestParticipant(db, { outbox, payload: { ...PARTICIPANT_RECORD, ...identity }, idempotencyKey: 'participant-key-1' }).catch((e) => e);

    expect(error).toMatchObject({ statusCode: 422, code: 'INGESTION_STORE_UNSUPPORTED', canonicalModelReleaseId: 'release-2.0.0', configurationReleaseId: 'cfg-release-7' });
    expect(error.details).toEqual([`Participant com ${fields.join(', ')}: identidade civil é armazenada em ParticipantIdentity, não suportado pela ingestão`]);
    if (value) expect(error.message).not.toContain(value);
    expectNothingWritten(db);
    expect(outbox.appendEvent).not.toHaveBeenCalled();
  });

  it('49. an identity-bearing Participant is refused even under a key already recorded, never replayed', async () => {
    const db = participantDb();
    const first = await ingestParticipant(db, { idempotencyKey: 'participant-key-1' });
    expect(first.status).toBe('accepted');

    const error = await ingestParticipant(db, { payload: { ...PARTICIPANT_RECORD, patientName: 'Maria Silva' }, idempotencyKey: 'participant-key-1' }).catch((e) => e);

    expect(error).toMatchObject({ statusCode: 422, code: 'INGESTION_STORE_UNSUPPORTED' });
    expect(db.collections.patients.docs.map((d) => d.participantId)).toEqual([first.entityId]);
    expect(db.collections.patients.docs[0]).not.toHaveProperty('patientName');
  });

  it.each(['organizations', 'consent_templates'])('50. a Participant whose %s lookup fails rejects, and writes no participant, quarantine record or idempotency key', async (collection) => {
    const db = participantDb();
    const outage = new Error('connection reset');
    db.collection(collection).findOne = async () => { throw outage; };
    const outbox = fakeOutbox();

    await expect(ingestParticipant(db, { outbox, idempotencyKey: 'participant-key-1' })).rejects.toBe(outage);

    expectNothingWritten(db);
    expect(outbox.appendEvent).not.toHaveBeenCalled();
  });

  const { clinicalUnitId: _clinicalUnitId, ...PARTICIPANT_WITHOUT_UNIT } = PARTICIPANT_RECORD;
  it.each([
    ['an organization caller outside the clinicalUnitId', { resolveOrganizationScope: orgScope('org-other') }],
    ['a global caller sending no clinicalUnitId', { payload: PARTICIPANT_WITHOUT_UNIT }],
  ])('51. %s is refused 403 INGESTION_OUT_OF_SCOPE and writes nothing (#1182)', async (_label, overrides) => {
    const db = participantDb();
    const outbox = fakeOutbox();

    const error = await ingestParticipant(db, { outbox, ...overrides }).catch((e) => e);

    expect(error).toMatchObject({ statusCode: 403, code: 'INGESTION_OUT_OF_SCOPE' });
    expectNothingWritten(db);
    expect(outbox.appendEvent).not.toHaveBeenCalled();
  });

  // #1318: Consent, the eighth target, runs the consent mount's participant,
  // template, validity and responses gates and its own granted, decision
  // time and no-consent-in-force gates (consentTarget.js), stores its
  // evidence, and writes its permissions, decision event and
  // CONSENT_UPSERTED in the insert's transaction. A signer's name or image
  // is refused, never quarantined as sent. The consent collections are
  // matching ones: an inserted consent gets the driver's _id, which the
  // recomputed state and CONSENT_UPSERTED key on.
  const DAY = 24 * 60 * 60 * 1000;
  const CONSENT_ACCEPTED_AT = new Date(Date.now() - DAY).toISOString();
  const CONSENT_RECORD = {
    participantId: PARTICIPANT,
    consentTemplateId: TEMPLATE_HEX,
    responses: { storage: true, recontact: false },
    consentGranted: true,
    consentAcceptedAt: CONSENT_ACCEPTED_AT,
  };
  const CONSENT_EVIDENCE = {
    evidenceDocumentUri: 'objstore://consents/stub/evidence.json',
    evidenceHash: `sha256:${'0'.repeat(64)}`,
    evidenceMimeType: 'application/json',
    evidenceEncryption: null,
  };

  function consentTemplate(overrides = {}) {
    const { ObjectId } = require('mongodb');
    return {
      _id: new ObjectId(TEMPLATE_HEX),
      title: 'TCLE',
      active: true,
      version: 3,
      consentModel: 'broad',
      validFrom: new Date(Date.now() - 30 * DAY).toISOString(),
      permissions: [{ key: 'storage', required: true, label: 'Armazenamento' }, { key: 'recontact', required: false, label: 'Recontato' }],
      ...overrides,
    };
  }

  function seedConsentReferences(db, { templates = [consentTemplate()], consents = [] } = {}) {
    db.collection('patients').docs.push({ participantId: PARTICIPANT });
    db.collections.consent_templates = createMatchingCollection(templates);
    db.collections.patientConsents = createMatchingCollection(consents);
    db.collections.consentPermissions = createMatchingCollection([]);
    db.collections.consentDecisionEvents = createMatchingCollection([]);
    db.collections.consentRevocations = createMatchingCollection([]);
  }

  function consentDb(options = {}) {
    const db = seededDb();
    seedConsentReferences(db, options);
    return db;
  }

  function stubConsentEvidence() {
    const consentEvidence = require('../../../src/services/consentEvidence.service');
    return vi.spyOn(consentEvidence, 'storeConsentEvidence').mockReturnValue(CONSENT_EVIDENCE);
  }

  function ingestConsent(db, overrides = {}) {
    return ingest(db, { entityType: 'Consent', payload: CONSENT_RECORD, ...overrides });
  }

  it('52. an accepted Consent lands in patientConsents with a uuid consentId, ACTIVE, signed at the sent time, its evidence, permissions, decision event, INGESTION_RECORD_PERSISTED then CONSENT_UPSERTED, and no MissingDataReason row', async () => {
    const store = stubConsentEvidence();
    const db = consentDb();
    const outbox = fakeOutbox();

    const result = await ingestConsent(db, { outbox });

    expect(result).toMatchObject({ status: 'accepted', entityType: 'Consent', outboxEventId: 'evt-1', missingDataReasons: [] });
    expect(result.entityId).toMatch(UUID);
    const docs = db.collections.patientConsents.docs;
    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({
      consentId: result.entityId,
      participantId: PARTICIPANT,
      consentTemplateId: TEMPLATE_HEX,
      consentVersion: '3',
      consentModel: 'broad',
      status: 'ACTIVE',
      currentStateDerived: 'active',
      signedAt: new Date(CONSENT_ACCEPTED_AT),
      responses: { storage: true, recontact: false },
      signatureName: null,
      signatureImageBase64: null,
      ...CONSENT_EVIDENCE,
      createdBy: 'Actor/u-1',
      sourceRecordId: 'LIMS-DS-42',
      canonicalModelReleaseId: 'release-2.0.0',
      configurationReleaseId: 'cfg-release-7',
    });
    expect(store).toHaveBeenCalledTimes(1);
    expect(store.mock.calls[0][0]).toMatchObject({ consentId: result.entityId, participantId: PARTICIPANT, decisionDateTime: new Date(CONSENT_ACCEPTED_AT) });
    expect(outbox.appendEvent.mock.calls.map(([, event]) => [event.eventType, event.aggregateId]))
      .toEqual([['INGESTION_RECORD_PERSISTED', result.entityId], ['CONSENT_UPSERTED', String(docs[0]._id)]]);
    expect(outbox.appendEvent.mock.calls[1][1]).toMatchObject({ payload: { participantId: PARTICIPANT, status: 'ACTIVE' }, sourceService: 'ingestion-gateway' });
    expect(db.collections.consentPermissions.docs.map((row) => [row.consentId, row.permissionCode, row.decision]))
      .toEqual([[result.entityId, 'storage', 'permit'], [result.entityId, 'recontact', 'deny']]);
    expect(db.collections.consentDecisionEvents.docs.map((row) => [row.consentId, row.decision, row.channel])).toEqual([[result.entityId, 'accepted', 'staff_portal']]);
    expect(db.collections.missingDataReasons.docs).toHaveLength(0);
    expect(db.collections.dataQualityAssessments.docs.map((d) => [d.scopeId, d.status])).toEqual([[`Consent/${result.entityId}`, 'passed']]);
  });

  it('53. on a replica set, the consent, its permissions, its decision event and CONSENT_UPSERTED share the insert\'s session (#1313)', async () => {
    stubConsentEvidence();
    const db = consentDb();
    const session = onReplicaSet(db);
    const outbox = fakeOutbox();

    const result = await ingestConsent(db, { outbox });

    expect(result.status).toBe('accepted');
    const stored = db.collections.patientConsents.docs[0];
    expect(db.collections.patientConsents.insertOne).toHaveBeenCalledWith(stored, { session });
    expect(db.collections.consentPermissions.insertMany).toHaveBeenCalledWith(expect.any(Array), { session });
    expect(db.collections.consentDecisionEvents.insertOne).toHaveBeenCalledWith(expect.objectContaining({ decision: 'accepted' }), { session });
    expect(outbox.appendEvent.mock.calls.map(([, event, opts]) => [event.eventType, opts]))
      .toEqual([['INGESTION_RECORD_PERSISTED', { session }], ['CONSENT_UPSERTED', { session }]]);
  });

  it.each([
    ['an unknown participant', { participantId: '87654321' }, {}, 'REFERENCE_NOT_FOUND'],
    ['an unknown consentTemplateId', {}, { templates: [] }, 'REFERENCE_NOT_FOUND'],
    ['an inactive template', {}, { templates: [consentTemplate({ active: false })] }, 'REFERENCE_NOT_USABLE'],
    ['an expired template', {}, { templates: [consentTemplate({ validTo: new Date(Date.now() - 2 * DAY).toISOString() })] }, 'REFERENCE_NOT_USABLE'],
    ['a required permission refused', { responses: { storage: false, recontact: true } }, {}, 'CONSENT_RESPONSES_INVALID'],
    ['consentGranted false', { consentGranted: false }, {}, 'CONSENT_NOT_GRANTED'],
    ['no consentAcceptedAt', { consentAcceptedAt: undefined }, {}, 'CONSENT_DECISION_TIME_INVALID'],
    ['a consentAcceptedAt after now', { consentAcceptedAt: new Date(Date.now() + DAY).toISOString() }, {}, 'CONSENT_DECISION_TIME_INVALID'],
    ['a consent already in force', {}, { consents: [{ participantId: PARTICIPANT, status: 'ACTIVE' }] }, 'CONSENT_ALREADY_ACTIVE'],
  ])('54. a Consent with %s quarantines with its violation code and writes nothing to patientConsents', async (_label, change, dbOptions, code) => {
    const store = stubConsentEvidence();
    const db = consentDb(dbOptions);
    const seeded = db.collections.patientConsents.docs.length;
    const outbox = fakeOutbox();

    const result = await ingestConsent(db, { outbox, payload: { ...CONSENT_RECORD, ...change } });

    expect(result.status).toBe('quarantined');
    expect(result.violations).toEqual([expect.objectContaining({ code, field: null })]);
    expect(db.collections.patientConsents.docs).toHaveLength(seeded);
    expect(db.collections.consentPermissions.docs).toHaveLength(0);
    expect(db.collections.consentDecisionEvents.docs).toHaveLength(0);
    expect(store).not.toHaveBeenCalled();
    expect(outbox.appendEvent).not.toHaveBeenCalled();
  });

  it('55. a Consent declaring a MissingDataReason quarantines with MISSING_REASON_FIELD_NOT_APPLICABLE: no field takes one', async () => {
    stubConsentEvidence();
    const db = consentDb();

    const result = await ingestConsent(db, { missingDataReasons: [{ fieldPath: 'consentAcceptedAt', reasonCode: 'unknown' }] });

    expect(result.status).toBe('quarantined');
    expect(result.violations.map((v) => v.code)).toEqual(['MISSING_REASON_FIELD_NOT_APPLICABLE']);
  });

  function expectNoConsentWritten(db) {
    expect(db.collections.patientConsents.docs).toHaveLength(0);
    expect(db.collections.consentPermissions.docs).toHaveLength(0);
    expect(db.collections.consentDecisionEvents.docs).toHaveLength(0);
    expect(db.collections.ingestionQuarantineRecords.docs).toHaveLength(0);
    expect(db.collections.ingestionIdempotencyKeys.docs).toHaveLength(0);
    expect(db.collections.missingDataReasons.docs).toHaveLength(0);
    expect(db.collections.dataQualityAssessments.docs).toHaveLength(0);
  }

  it.each([
    ['signatureName', 'Maria Silva'],
    ['patientName', 'Maria Silva'],
    ['signatureImageBase64', 'iVBORw0KGgoAAAANSUhEUg'],
    ['signatureBase64', 'iVBORw0KGgoAAAANSUhEUg'],
  ])('56. a Consent carrying %s is refused 422 INGESTION_STORE_UNSUPPORTED, naming the field and never its value, and writes nothing', async (field, value) => {
    const store = stubConsentEvidence();
    const db = consentDb();
    const outbox = fakeOutbox();

    const error = await ingestConsent(db, { outbox, payload: { ...CONSENT_RECORD, [field]: value }, idempotencyKey: 'consent-key-1' }).catch((e) => e);

    expect(error).toMatchObject({ statusCode: 422, code: 'INGESTION_STORE_UNSUPPORTED', canonicalModelReleaseId: 'release-2.0.0', configurationReleaseId: 'cfg-release-7' });
    expect(error.details).toEqual([`Consent com ${field}: identidade civil é armazenada em ParticipantIdentity, não suportado pela ingestão`]);
    expect(error.message).not.toContain(value);
    expectNoConsentWritten(db);
    expect(store).not.toHaveBeenCalled();
    expect(outbox.appendEvent).not.toHaveBeenCalled();
  });

  it.each(['signatureName', 'patientName'])('57. a Consent carrying %s is refused even under a key already recorded, never replayed', async (field) => {
    stubConsentEvidence();
    const db = consentDb();
    const first = await ingestConsent(db, { idempotencyKey: 'consent-key-1' });
    expect(first.status).toBe('accepted');

    const error = await ingestConsent(db, { payload: { ...CONSENT_RECORD, [field]: 'Maria Silva' }, idempotencyKey: 'consent-key-1' }).catch((e) => e);

    expect(error).toMatchObject({ statusCode: 422, code: 'INGESTION_STORE_UNSUPPORTED', details: [expect.stringContaining(field)] });
    expect(error.message).not.toContain('Maria Silva');
    expect(db.collections.patientConsents.docs.map((d) => d.consentId)).toEqual([first.entityId]);
    expect(db.collections.ingestionQuarantineRecords.docs).toHaveLength(0);
  });

  it.each(['patients', 'consent_templates', 'patientConsents'])('58. a Consent whose %s lookup fails rejects, and writes no consent, quarantine record or idempotency key', async (collection) => {
    stubConsentEvidence();
    const db = consentDb();
    const outage = new Error('connection reset');
    // patientConsents is read again for a source duplicate (RNF011 C3), so
    // only its in-force lookup, a find, fails: the gate's own rethrow is
    // what rejects.
    if (collection === 'patientConsents') {
      const find = db.collection(collection).find;
      db.collection(collection).find = (filter, ...rest) => (filter?.status ? { toArray: async () => { throw outage; } } : find(filter, ...rest));
    } else {
      db.collection(collection).findOne = async () => { throw outage; };
    }
    const outbox = fakeOutbox();

    await expect(ingestConsent(db, { outbox, idempotencyKey: 'consent-key-1' })).rejects.toBe(outage);

    expectNoConsentWritten(db);
    expect(outbox.appendEvent).not.toHaveBeenCalled();
  });

  it('59. without a session, a concurrent Consent loser leaves no consent and none of its own events, permission or decision rows', async () => {
    stubConsentEvidence();
    const { db, winner, loser, docs } = await raceOnOneKey({
      entityType: 'Consent',
      payload: CONSENT_RECORD,
      collection: 'patientConsents',
      seed: (target) => seedConsentReferences(target),
    });

    expect(winner.status).toBe('accepted');
    expect(loser).toMatchObject({ status: 'idempotent_replay', outcome: 'accepted', entityType: 'Consent', resultRef: winner.entityId });
    expect(docs.map((d) => d.consentId)).toEqual([winner.entityId]);
    expect(db.collections.graph_projection_outbox.docs.map((e) => [e.eventType, e.aggregateId]))
      .toEqual([['INGESTION_RECORD_PERSISTED', winner.entityId], ['CONSENT_UPSERTED', String(docs[0]._id)]]);
    expect(db.collections.consentPermissions.docs.map((row) => row.consentId)).toEqual([winner.entityId, winner.entityId]);
    expect(db.collections.consentDecisionEvents.docs.map((row) => row.consentId)).toEqual([winner.entityId]);
    expect(db.collections.dataQualityAssessments.docs.map((d) => d.scopeId)).toEqual([`Consent/${winner.entityId}`]);
  });

  // #1318, RF010 AC5: a Consent naming the participant's one consent in
  // force supersedes it through its history, only once the record has won
  // its idempotency key (consentTarget.js supersedeConsentInForce).
  function priorConsent() {
    const { ObjectId } = require('mongodb');
    return {
      _id: new ObjectId(),
      consentId: 'consent-prior',
      participantId: PARTICIPANT,
      consentTemplateId: TEMPLATE_HEX,
      responses: { storage: true, recontact: false },
      signedAt: new Date(Date.now() - 10 * DAY),
      status: 'ACTIVE',
    };
  }
  const SUPERSEDING_RECORD = { ...CONSENT_RECORD, supersedesConsentId: 'consent-prior' };

  it('59b. an accepted Consent naming the consent in force carries supersedesConsentId, and the prior is superseded through one superseded decision event', async () => {
    stubConsentEvidence();
    const prior = priorConsent();
    const db = consentDb({ consents: [prior] });

    const result = await ingestConsent(db, { payload: SUPERSEDING_RECORD });

    expect(result.status).toBe('accepted');
    const [storedPrior, stored] = db.collections.patientConsents.docs;
    expect(stored).toMatchObject({ consentId: result.entityId, supersedesConsentId: 'consent-prior', status: 'ACTIVE', currentStateDerived: 'active' });
    expect(storedPrior).toMatchObject({ consentId: 'consent-prior', supersededByConsentId: result.entityId, status: 'REVOKED', currentStateDerived: 'superseded' });
    expect(db.collections.consentDecisionEvents.docs.map((row) => [row.consentId, row.decision]))
      .toEqual([[result.entityId, 'accepted'], ['consent-prior', 'superseded']]);
  });

  it('59c. on a replica set, the supersession\'s claim, decision event and recomputed state share the insert\'s session', async () => {
    stubConsentEvidence();
    const prior = priorConsent();
    const db = consentDb({ consents: [prior] });
    const session = onReplicaSet(db);

    const result = await ingestConsent(db, { payload: SUPERSEDING_RECORD });

    expect(result.status).toBe('accepted');
    const updates = db.collections.patientConsents.updateOne;
    expect(updates).toHaveBeenCalledWith(
      { _id: prior._id, status: { $in: ['ACTIVE', 'VALID', 'GRANTED'] }, supersededByConsentId: null },
      { $set: { supersededByConsentId: result.entityId } },
      { session },
    );
    expect(updates.mock.calls.filter(([filter]) => String(filter._id) === String(prior._id)).length).toBeGreaterThan(1);
    expect(updates.mock.calls.every(([, , opts]) => opts?.session === session)).toBe(true);
    expect(db.collections.consentDecisionEvents.insertOne).toHaveBeenCalledWith(expect.objectContaining({ consentId: 'consent-prior', decision: 'superseded' }), { session });
  });

  it('59d. without a session, two concurrent Consents with one key naming the consent in force supersede it once, for the winner, and the loser never claims it', async () => {
    stubConsentEvidence();
    const { db, winner, loser, docs } = await raceOnOneKey({
      entityType: 'Consent',
      payload: SUPERSEDING_RECORD,
      collection: 'patientConsents',
      seed: (target) => seedConsentReferences(target, { consents: [priorConsent()] }),
    });

    expect(winner.status).toBe('accepted');
    expect(loser).toMatchObject({ status: 'idempotent_replay', outcome: 'accepted', entityType: 'Consent', resultRef: winner.entityId });
    // The loser never even attempts the claim, whichever request reached the key first.
    const claims = db.collections.patientConsents.updateOne.mock.calls
      .filter(([, update]) => update?.$set && 'supersededByConsentId' in update.$set);
    expect(claims.length).toBeGreaterThan(0);
    expect(claims.map(([, update]) => update.$set.supersededByConsentId)).toEqual(claims.map(() => winner.entityId));
    expect(docs.map((d) => d.consentId)).toEqual(['consent-prior', winner.entityId]);
    expect(docs[0]).toMatchObject({ supersededByConsentId: winner.entityId, status: 'REVOKED', currentStateDerived: 'superseded' });
    expect(db.collections.consentDecisionEvents.docs.map((row) => [row.consentId, row.decision]))
      .toEqual([[winner.entityId, 'accepted'], ['consent-prior', 'superseded']]);
    expect(db.collections.consentPermissions.docs.map((row) => row.consentId)).toEqual([winner.entityId, winner.entityId]);
  });

  const TELEMETRY_READING = { sensorId: 'sensor-1', metricType: 'temperature', timestamp: '2026-10-01T12:00:00.000Z', value: -80.1, unit: 'Cel', idempotencyKey: 'reading-key-1' };

  it.each([
    ['an empty', {}],
    ['a schema-valid telemetry', TELEMETRY_READING],
  ])('60. a TelemetryReading with %s payload, an InfluxDB entity, is refused 422 INGESTION_STORE_UNSUPPORTED naming the telemetry route, and writes nothing (RF029 AC4)', async (_label, payload) => {
    const db = seededDb();
    const outbox = fakeOutbox();

    const error = await ingest(db, { outbox, entityType: 'TelemetryReading', payload, idempotencyKey: 'telemetry-key-1' }).catch((e) => e);

    expect(error).toMatchObject({
      statusCode: 422,
      code: 'INGESTION_STORE_UNSUPPORTED',
      details: [expect.stringMatching(/^TelemetryReading .*InfluxDB.*POST \/api\/temperature\/reading$/)],
      canonicalModelReleaseId: 'release-2.0.0',
      configurationReleaseId: 'cfg-release-7',
    });
    expect(error.details[0]).not.toContain('sensor-1');
    for (const [name, collection] of Object.entries(db.collections)) {
      if (name === 'canonicalModelReleases' || name === 'security_config') continue;
      expect(collection.docs, name).toHaveLength(0);
    }
    expect(outbox.appendEvent).not.toHaveBeenCalled();
  });

  it.each([
    ['missing', null],
    ['retired', { canonicalModelReleaseId: 'release-2.0.0', releaseStatus: 'retired' }],
  ])('61. a TelemetryReading under a %s CanonicalModelRelease throws 503, not the store refusal', async (_label, release) => {
    const db = seededDb({ release });
    const outbox = fakeOutbox();

    await expect(ingest(db, { outbox, entityType: 'TelemetryReading', payload: TELEMETRY_READING })).rejects.toMatchObject({ statusCode: 503, code: 'CANONICAL_RELEASE_NOT_ACTIVE' });
    expect(db.collections.ingestionQuarantineRecords.docs).toHaveLength(0);
    expect(outbox.appendEvent).not.toHaveBeenCalled();
  });

  const FILE_METADATA = { fileUri: 'objstore://x/y/sha256/ab', checksum: 'ab', fileSizeBytes: 10 };

  it.each([
    ['DataFile', 'an empty', {}],
    ['DataFile', 'a schema-shaped', FILE_METADATA],
    ['DataFileVersion', 'an empty', {}],
    ['DataFileVersion', 'a schema-shaped', FILE_METADATA],
  ])('62. a %s with %s payload, an Object Storage binary, is refused 422 INGESTION_STORE_UNSUPPORTED naming the trusted file routes, and writes nothing (RF007 AC2, RF029 AC4)', async (entityType, _label, payload) => {
    const db = seededDb();
    const outbox = fakeOutbox();

    const error = await ingest(db, { outbox, entityType, payload, idempotencyKey: 'file-key-1' }).catch((e) => e);

    expect(error).toMatchObject({
      statusCode: 422,
      code: 'INGESTION_STORE_UNSUPPORTED',
      details: [expect.stringMatching(/^DataFile(Version)? tem seu binário no Object Storage.*(POST|PUT) \/api\/samples\//)],
      canonicalModelReleaseId: 'release-2.0.0',
      configurationReleaseId: 'cfg-release-7',
    });
    expect(error.details[0].startsWith(`${entityType} `)).toBe(true);
    expect(error.details[0]).not.toContain('objstore://');
    for (const [name, collection] of Object.entries(db.collections)) {
      if (name === 'canonicalModelReleases' || name === 'security_config') continue;
      expect(collection.docs, name).toHaveLength(0);
    }
    expect(outbox.appendEvent).not.toHaveBeenCalled();
  });

  it.each([
    ['DataFile', 'missing', null],
    ['DataFile', 'retired', { canonicalModelReleaseId: 'release-2.0.0', releaseStatus: 'retired' }],
    ['DataFileVersion', 'missing', null],
    ['DataFileVersion', 'retired', { canonicalModelReleaseId: 'release-2.0.0', releaseStatus: 'retired' }],
  ])('63. a %s under a %s CanonicalModelRelease throws 503, not the store refusal', async (entityType, _label, release) => {
    const db = seededDb({ release });
    const outbox = fakeOutbox();

    await expect(ingest(db, { outbox, entityType, payload: FILE_METADATA })).rejects.toMatchObject({ statusCode: 503, code: 'CANONICAL_RELEASE_NOT_ACTIVE' });
    expect(db.collections.ingestionQuarantineRecords.docs).toHaveLength(0);
    expect(outbox.appendEvent).not.toHaveBeenCalled();
  });
});
