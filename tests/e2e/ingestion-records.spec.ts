import { test, expect, type APIRequestContext } from '@playwright/test';
import { realLogin, type RealAuthSession } from './helpers/realAuth';
import { watchAuditTrail, assertAuditEventRecorded } from './helpers/assertAuditEvent';
import {
  findIngestionIdempotencyKey,
  findIngestedRecord,
  countIngestedBySourceRecordId,
  findOutboxEvents,
  findIngestionAuditRows,
  findCanonicalModelRelease,
  findMissingDataReasons,
  findDataQualityAssessment,
  countDataQualityAssessmentsByScope,
  closeIngestionDb,
} from './helpers/queryIngestion';

// RF029 (#1318): POST /api/ingestion/records against the real backend, its
// writes read back from the stack's Mongo. Real backend only — see
// backend-integration.spec.ts for the same skip rationale. Run via
// `npm run test:e2e:docker` against the compose test stack.
const apiBaseURL = process.env.PLAYWRIGHT_API_BASE_URL;

test.skip(!apiBaseURL, 'PLAYWRIGHT_API_BASE_URL not set — run via npm run test:e2e:docker');

const CANONICAL_MODEL_RELEASE_ID = 'release-2.0.0';

test.describe('POST /api/ingestion/records (RF029, #1318) — real backend', () => {
  let admin: RealAuthSession;
  let auth: { Authorization: string };
  // CFG-004: the configuration release every outcome must name.
  let inForce: string;

  test.beforeAll(async ({ request }) => {
    admin = await realLogin(request);
    auth = { Authorization: `Bearer ${admin.token}` };

    // The route fails closed with a 503 when the canonical release is not
    // active, so assert the precondition rather than read that as a
    // regression (the pipeline-continuity #722 pattern).
    const release = await findCanonicalModelRelease(CANONICAL_MODEL_RELEASE_ID);
    const hint = [
      `RF029 ingestion needs CanonicalModelRelease ${CANONICAL_MODEL_RELEASE_ID} active; this stack has`,
      `${release ? `releaseStatus ${release.releaseStatus}` : 'none'}.`,
      'A 503 CANONICAL_RELEASE_NOT_ACTIVE means foundation-bootstrap-test did not run against these volumes:',
      'an environment gap, not a regression in the ingestion route.',
    ].join(' ');
    expect(release?.releaseStatus, hint).toBe('active');

    // A fresh stack has no configuration release until PUT
    // /api/security/config activates one. Re-sending the current
    // passwordRules.expirationDays changes nothing and ends no session.
    const readConfig = async () => {
      const res = await request.get(`${apiBaseURL}/api/security/config`, { headers: auth });
      expect(res.ok(), await res.text()).toBeTruthy();
      return (await res.json()).data;
    };
    let config = await readConfig();
    if (!config.configurationReleaseId) {
      const put = await request.put(`${apiBaseURL}/api/security/config`, {
        headers: auth,
        data: { passwordRules: { expirationDays: config.passwordRules.expirationDays } },
      });
      expect(put.ok(), await put.text()).toBeTruthy();
      config = await readConfig();
    }
    expect(typeof config.configurationReleaseId).toBe('string');
    expect(config.configurationReleaseId).not.toBe('');
    inForce = config.configurationReleaseId;
  });

  test.afterAll(async () => {
    await closeIngestionDb();
  });

  function provenance(sourceRecordId: string) {
    return {
      sourceSystem: 'urn:system:ingestion-records-e2e',
      retrievedAt: new Date().toISOString(),
      purpose: 'e2e_proof',
      sourceRecordId,
    };
  }

  function datasetPayload() {
    return {
      datasetTitle: `RF029 e2e dataset ${Date.now()}`,
      datasetVersion: '1.0.0',
      creators: [{ name: 'RF029 e2e suite' }],
      license: 'CC BY 4.0',
    };
  }

  function ingest(request: APIRequestContext, body: Record<string, unknown>) {
    return request.post(`${apiBaseURL}/api/ingestion/records`, { headers: auth, data: body });
  }

  test('an accepted Dataset is persisted with its outbox event and one INGESTION_ACCEPTED row', async ({ request }) => {
    const sourceRecordId = `rf029-e2e-${Date.now()}-dataset`;

    const res = await ingest(request, { entityType: 'Dataset', payload: datasetPayload(), provenance: provenance(sourceRecordId) });

    expect(res.status(), await res.text()).toBe(201);
    const body = await res.json();
    expect(body).toMatchObject({
      success: true,
      status: 'accepted',
      entityType: 'Dataset',
      canonicalModelReleaseId: CANONICAL_MODEL_RELEASE_ID,
      configurationReleaseId: inForce,
    });
    expect(typeof body.entityId).toBe('string');
    expect(typeof body.outboxEventId).toBe('string');

    const stored = await findIngestedRecord('datasets', 'datasetId', body.entityId);
    expect(stored).toMatchObject({
      createdBy: `Actor/${admin.user._id}`,
      sourceRecordId,
      canonicalModelReleaseId: CANONICAL_MODEL_RELEASE_ID,
      configurationReleaseId: inForce,
    });

    const events = await findOutboxEvents(body.entityId);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      eventId: body.outboxEventId,
      aggregateType: 'Dataset',
      canonicalModelReleaseId: CANONICAL_MODEL_RELEASE_ID,
    });
    expect(events[0].payload.configurationReleaseId).toBe(inForce);

    const rows = await findIngestionAuditRows('INGESTION_ACCEPTED', body.entityId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ resourceType: 'Dataset', status: 'success', severity: 'info' });
    expect(rows[0].payload.configurationReleaseId).toBe(inForce);
  });

  test('an accepted WorkflowRun is stored with the server actor as createdBy, not the payload value', async ({ request }) => {
    const sourceRecordId = `rf029-e2e-${Date.now()}-workflow`;

    const res = await ingest(request, {
      entityType: 'WorkflowRun',
      payload: {
        workflowId: 'rf029-e2e-variant-calling-pipeline',
        workflowVersion: '2.3.1',
        createdBy: 'User/e2e-suite',
        startedAt: new Date().toISOString(),
        runStatus: 'succeeded',
      },
      provenance: provenance(sourceRecordId),
    });

    expect(res.status(), await res.text()).toBe(201);
    const body = await res.json();
    expect(body).toMatchObject({ success: true, status: 'accepted', entityType: 'WorkflowRun' });

    const stored = await findIngestedRecord('workflowRuns', 'workflowRunId', body.entityId);
    expect(stored?.createdBy).toBe(`Actor/${admin.user._id}`);

    const events = await findOutboxEvents(body.entityId);
    expect(events).toHaveLength(1);
    expect(events[0].aggregateType).toBe('WorkflowRun');

    expect(await findIngestionAuditRows('INGESTION_ACCEPTED', body.entityId)).toHaveLength(1);
  });

  test('a quarantined record retried with the same key answers 422 again and writes no second quarantine record', async ({ request }) => {
    const sourceRecordId = `rf029-e2e-${Date.now()}-quarantine`;
    const idempotencyKey = `rf029-e2e-q-${Date.now()}`;
    const { purpose: _omitted, ...withoutPurpose } = provenance(sourceRecordId);
    const body = { entityType: 'Dataset', payload: datasetPayload(), provenance: withoutPurpose, idempotencyKey };

    const first = await ingest(request, body);
    expect(first.status(), await first.text()).toBe(422);
    const firstBody = await first.json();
    expect(firstBody.error).toBe('INGESTION_QUARANTINED');
    expect(firstBody.details).toContain('provenance.purpose é obrigatório');
    expect(typeof firstBody.ingestionQuarantineRecordId).toBe('string');
    expect(await countIngestedBySourceRecordId('datasets', sourceRecordId)).toBe(0);

    const second = await ingest(request, body);
    expect(second.status(), await second.text()).toBe(422);
    const secondBody = await second.json();
    expect(secondBody.error).toBe('INGESTION_QUARANTINED');
    expect(secondBody.ingestionQuarantineRecordId).toBe(firstBody.ingestionQuarantineRecordId);
    // Counted by sourceRecordId: the production path stores the quarantine
    // record with idempotencyKey null (productionIngestion.js).
    expect(await countIngestedBySourceRecordId('ingestionQuarantineRecords', sourceRecordId)).toBe(1);

    const keyDoc = await findIngestionIdempotencyKey(idempotencyKey, 'Dataset');
    expect(keyDoc).toMatchObject({ status: 'completed', outcome: 'quarantined' });

    const quarantined = await findIngestionAuditRows('INGESTION_QUARANTINED', firstBody.ingestionQuarantineRecordId);
    expect(quarantined).toHaveLength(1);
    expect(quarantined[0].payload.configurationReleaseId).toBe(inForce);
    const replayed = await findIngestionAuditRows('INGESTION_REPLAYED', firstBody.ingestionQuarantineRecordId);
    expect(replayed).toHaveLength(1);
    expect(replayed[0].status).toBe('warning');
    expect(replayed[0].payload.outcome).toBe('quarantined');
    expect(replayed[0].payload.configurationReleaseId).toBe(inForce);
  });

  test('an accepted record retried with the same key replays 200 and persists once', async ({ request }) => {
    const sourceRecordId = `rf029-e2e-${Date.now()}-retry`;
    const idempotencyKey = `rf029-e2e-a-${Date.now()}`;
    const body = { entityType: 'Dataset', payload: datasetPayload(), provenance: provenance(sourceRecordId), idempotencyKey };

    const first = await ingest(request, body);
    expect(first.status(), await first.text()).toBe(201);
    const firstBody = await first.json();

    const second = await ingest(request, body);
    expect(second.status(), await second.text()).toBe(200);
    expect(await second.json()).toMatchObject({
      success: true,
      status: 'idempotent_replay',
      outcome: 'accepted',
      resultRef: firstBody.entityId,
    });

    expect(await countIngestedBySourceRecordId('datasets', sourceRecordId)).toBe(1);
    expect(await findOutboxEvents(firstBody.entityId)).toHaveLength(1);

    const keyDoc = await findIngestionIdempotencyKey(idempotencyKey, 'Dataset');
    expect(keyDoc).toMatchObject({ outcome: 'accepted', resultRef: firstBody.entityId });

    const replayed = await findIngestionAuditRows('INGESTION_REPLAYED', firstBody.entityId);
    expect(replayed).toHaveLength(1);
    expect(replayed[0].status).toBe('success');
  });

  test('RF012: an accepted ingestion appends to the audit trail', async ({ request }) => {
    const sourceRecordId = `rf029-e2e-${Date.now()}-audit`;
    const watch = await watchAuditTrail(request, apiBaseURL!, admin.token);

    const res = await ingest(request, { entityType: 'Dataset', payload: datasetPayload(), provenance: provenance(sourceRecordId) });

    expect(res.status(), await res.text()).toBe(201);
    await assertAuditEventRecorded(request, apiBaseURL!, admin.token, watch);
  });

  test('RF029 AC7: an accepted Dataset gets a MissingDataReason per absent field, declared or unknown, and no absence becomes 0', async ({ request }) => {
    const sourceRecordId = `rf029-e2e-${Date.now()}-missing`;

    const res = await ingest(request, {
      entityType: 'Dataset',
      payload: datasetPayload(),
      provenance: provenance(sourceRecordId),
      missingDataReasons: [{ fieldPath: 'doi', reasonCode: 'withheld' }],
    });

    expect(res.status(), await res.text()).toBe(201);
    const body = await res.json();
    expect(body.missingDataReasons).toHaveLength(3);

    const rows = await findMissingDataReasons('Dataset', body.entityId);
    expect(rows).toHaveLength(3);
    const byField = Object.fromEntries(rows.map((row) => [row.fieldPath, row.reasonCode]));
    expect(byField).toEqual({ doi: 'withheld', distributionFiles: 'unknown', roCrateManifest: 'unknown' });
    for (const row of rows) {
      expect(row.sourceEventId).toBe(body.outboxEventId);
    }

    const stored = await findIngestedRecord('datasets', 'datasetId', body.entityId);
    expect(stored).toMatchObject({ doi: null, roCrateManifest: null, distributionFiles: [] });
  });

  test('RF029 AC7: a MissingDataReason declared on a field that holds a value quarantines the record', async ({ request }) => {
    const sourceRecordId = `rf029-e2e-${Date.now()}-present`;

    const res = await ingest(request, {
      entityType: 'Dataset',
      payload: { ...datasetPayload(), doi: '10.1234/rf029-e2e' },
      provenance: provenance(sourceRecordId),
      missingDataReasons: [{ fieldPath: 'doi', reasonCode: 'withheld' }],
    });

    expect(res.status(), await res.text()).toBe(422);
    const body = await res.json();
    expect(body.error).toBe('INGESTION_QUARANTINED');
    expect(body.details).toContain('doi tem valor e não pode ter MissingDataReason');
    expect(await countIngestedBySourceRecordId('datasets', sourceRecordId)).toBe(0);
  });

  test('RNF011 C3: an accepted record gets a DataQualityAssessment, and a second record from the same source scores uniqueness 0', async ({ request }) => {
    const sourceRecordId = `rf029-e2e-${Date.now()}-dqa`;

    const first = await ingest(request, { entityType: 'Dataset', payload: datasetPayload(), provenance: provenance(sourceRecordId) });
    expect(first.status(), await first.text()).toBe(201);
    const firstBody = await first.json();
    expect(typeof firstBody.dataQualityAssessmentId).toBe('string');

    const assessment = await findDataQualityAssessment(firstBody.dataQualityAssessmentId);
    expect(assessment).toMatchObject({
      scopeType: 'ingested_record',
      scopeId: `Dataset/${firstBody.entityId}`,
      status: 'passed',
    });
    expect(assessment.results).toHaveLength(6);
    const results = Object.fromEntries(assessment.results.map((result: any) => [result.metric, result]));
    expect(results.completeness).toMatchObject({ numerator: 4, denominator: 4 });
    expect(results.uniqueness.value).toBe(1);

    const second = await ingest(request, { entityType: 'Dataset', payload: datasetPayload(), provenance: provenance(sourceRecordId) });
    expect(second.status(), await second.text()).toBe(201);
    const secondBody = await second.json();

    const duplicate = await findDataQualityAssessment(secondBody.dataQualityAssessmentId);
    expect(duplicate.scopeId).toBe(`Dataset/${secondBody.entityId}`);
    expect(duplicate.status).toBe('failed');
    const duplicateResults = Object.fromEntries(duplicate.results.map((result: any) => [result.metric, result]));
    expect(duplicateResults.uniqueness.value).toBe(0);
  });

  test('RNF011 C3: a quarantined record gets a failed DataQualityAssessment, and its replay records none', async ({ request }) => {
    const sourceRecordId = `rf029-e2e-${Date.now()}-dqa-quarantine`;
    const idempotencyKey = `rf029-e2e-dqa-q-${Date.now()}`;
    const { purpose: _omitted, ...withoutPurpose } = provenance(sourceRecordId);
    const body = { entityType: 'Dataset', payload: datasetPayload(), provenance: withoutPurpose, idempotencyKey };

    const first = await ingest(request, body);
    expect(first.status(), await first.text()).toBe(422);
    const firstBody = await first.json();
    expect(typeof firstBody.dataQualityAssessmentId).toBe('string');

    const scopeId = `IngestionQuarantineRecord/${firstBody.ingestionQuarantineRecordId}`;
    const assessment = await findDataQualityAssessment(firstBody.dataQualityAssessmentId);
    expect(assessment).toMatchObject({ scopeType: 'ingested_record', scopeId, status: 'failed' });
    const results = Object.fromEntries(assessment.results.map((result: any) => [result.metric, result]));
    expect(results.provenance).toMatchObject({ numerator: 3, denominator: 4 });

    const second = await ingest(request, body);
    expect(second.status(), await second.text()).toBe(422);
    expect(await countDataQualityAssessmentsByScope(scopeId)).toBe(1);
  });
});
