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
  async function raceOnOneKey({ entityType = 'Dataset', payload = DATASET, collection = 'datasets' } = {}) {
    const db = seededDb();
    db.collections.datasets = createMatchingCollection([]);
    db.collections.omicsQualifications = createMatchingCollection([]);
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
      ingest(db, { outbox, entityType, payload, idempotencyKey: 'key-race' }),
      ingest(db, { outbox, entityType, payload, idempotencyKey: 'key-race' }),
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
});
