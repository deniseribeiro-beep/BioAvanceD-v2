import { test, expect, type APIRequestContext } from '@playwright/test';
import { realLogin, type RealAuthSession } from './helpers/realAuth';
import { watchAuditTrail, assertAuditEventRecorded } from './helpers/assertAuditEvent';
import { completeFirstLoginMfa } from './helpers/completeFirstLoginMfa';
import {
  findIngestionIdempotencyKey,
  findIngestionQuarantineRecord,
  findIngestedRecord,
  countIngestedBySourceRecordId,
  findOutboxEvents,
  findIngestionAuditRows,
  findCanonicalModelRelease,
  findMissingDataReasons,
  findDataQualityAssessment,
  countDataQualityAssessmentsByScope,
  findIngestionRefusalRows,
  countAccessDenialRows,
  ingestionDb,
  deleteIngestedParticipants,
  deleteIngestedConsents,
  findConsentDecisionEvents,
  closeIngestionDb,
} from './helpers/queryIngestion';
import {
  createRealParticipant,
  seedStorageBoxLocation,
  cleanupStorageBoxLocation,
  seedStudy,
  seedProtocol,
  seedActiveConsent,
  seedActiveConsentTemplate,
  closeSeedDb,
  type SeededStorageBox,
} from './helpers/seedParticipant';
import { deleteOrganizations } from './helpers/listOrganizations';
import { waitForEthicalConsentStatus, readConsentProjection, closeNeo4jDriver } from './helpers/queryNeo4j';

// RF029 (#1318): POST /api/ingestion/records against the real backend, its
// writes read back from the stack's Mongo. Real backend only — see
// backend-integration.spec.ts for the same skip rationale. Run via
// `npm run test:e2e:docker` against the compose test stack.
const apiBaseURL = process.env.PLAYWRIGHT_API_BASE_URL;

test.skip(!apiBaseURL, 'PLAYWRIGHT_API_BASE_URL not set — run via npm run test:e2e:docker');

const CANONICAL_MODEL_RELEASE_ID = 'release-2.0.0';
const INGESTION_PATH = '/api/ingestion/records';

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

  // #1318: what the Assay cases seed for their references.
  const seededStorageBoxes: SeededStorageBox[] = [];
  const organizationIdsToDelete: string[] = [];
  const participantIdsToDelete: string[] = [];
  const consentIdsToDelete: string[] = [];

  test.afterAll(async ({ request }) => {
    await Promise.all(
      seededStorageBoxes.map((box) => cleanupStorageBoxLocation(box).catch(() => {}))
    );
    await deleteIngestedConsents(consentIdsToDelete);
    // Before the organizations their clinicalUnitId names.
    await deleteIngestedParticipants(participantIdsToDelete);
    await deleteOrganizations(request, apiBaseURL!, organizationIdsToDelete);
    await closeSeedDb();
    await closeIngestionDb();
    await closeNeo4jDriver();
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
    // RNF023 AC1 (#1489): the document and its event carry schemaVersion beside the release id.
    expect(stored).toMatchObject({
      createdBy: `Actor/${admin.user._id}`,
      sourceRecordId,
      canonicalModelReleaseId: CANONICAL_MODEL_RELEASE_ID,
      schemaVersion: '2.0.0',
      configurationReleaseId: inForce,
    });

    const events = await findOutboxEvents(body.entityId);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      eventId: body.outboxEventId,
      aggregateType: 'Dataset',
      canonicalModelReleaseId: CANONICAL_MODEL_RELEASE_ID,
      schemaVersion: 1,
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
        hardwareProfile: { cpu: 'synthetic', gpu: null },
        randomSeed: 0,
        environmentManifestUri: 'object://synthetic/environment.json',
      },
      provenance: provenance(sourceRecordId),
    });

    expect(res.status(), await res.text()).toBe(201);
    const body = await res.json();
    expect(body).toMatchObject({ success: true, status: 'accepted', entityType: 'WorkflowRun' });

    const stored = await findIngestedRecord('workflowRuns', 'workflowRunId', body.entityId);
    expect(stored?.createdBy).toBe(`Actor/${admin.user._id}`);
    expect(stored?.hardwareProfile).toEqual({ cpu: 'synthetic', gpu: null });
    expect(stored?.environmentManifestUri).toBe('object://synthetic/environment.json');
    expect(stored?.randomSeed).toBe(0);

    const events = await findOutboxEvents(body.entityId);
    expect(events).toHaveLength(1);
    expect(events[0].aggregateType).toBe('WorkflowRun');

    expect(await findIngestionAuditRows('INGESTION_ACCEPTED', body.entityId)).toHaveLength(1);
  });

  test('an accepted OmicsQualification is stored in its collection with its outbox event, a MissingDataReason for limitations, and one INGESTION_ACCEPTED row', async ({ request }) => {
    const sourceRecordId = `rf029-e2e-${Date.now()}-omics-qualification`;

    const res = await ingest(request, {
      entityType: 'OmicsQualification',
      payload: {
        targetAssay: 'assay-wgs-1',
        qcRuleSetVersion: 'qc-1.0',
        qcMetrics: [{ name: 'q30', value: 0.92 }],
        qualificationDecision: 'eligible',
      },
      provenance: provenance(sourceRecordId),
    });

    expect(res.status(), await res.text()).toBe(201);
    const body = await res.json();
    expect(body).toMatchObject({ success: true, status: 'accepted', entityType: 'OmicsQualification' });

    const stored = await findIngestedRecord('omicsQualifications', 'omicsQualificationId', body.entityId);
    expect(stored).toMatchObject({ createdBy: `Actor/${admin.user._id}`, sourceRecordId, limitations: null });

    const events = await findOutboxEvents(body.entityId);
    expect(events).toHaveLength(1);
    expect(events[0].aggregateType).toBe('OmicsQualification');

    const reasons = await findMissingDataReasons('OmicsQualification', body.entityId);
    expect(reasons.map((row) => [row.fieldPath, row.reasonCode])).toEqual([['limitations', 'unknown']]);

    const assessment = await findDataQualityAssessment(body.dataQualityAssessmentId);
    expect(assessment?.scopeId).toBe(`OmicsQualification/${body.entityId}`);

    const rows = await findIngestionAuditRows('INGESTION_ACCEPTED', body.entityId);
    expect(rows).toHaveLength(1);
    expect(rows[0].resourceType).toBe('OmicsQualification');
  });

  test('#1318: an accepted genomics OmicsRun is stored in omicsRuns with its outbox event, three MissingDataReason rows, and one INGESTION_ACCEPTED row', async ({ request }) => {
    const sourceRecordId = `rf029-e2e-${Date.now()}-omics-run`;

    const res = await ingest(request, { entityType: 'OmicsRun', payload: { modality: 'genomics' }, provenance: provenance(sourceRecordId) });

    expect(res.status(), await res.text()).toBe(201);
    const body = await res.json();
    expect(body).toMatchObject({ success: true, status: 'accepted', entityType: 'OmicsRun' });

    const stored = await findIngestedRecord('omicsRuns', 'omicsRunId', body.entityId);
    expect(stored).toMatchObject({ modality: 'genomics', createdBy: `Actor/${admin.user._id}`, sourceRecordId, referenceAssembly: null, mixsChecklist: null, fileLinks: [] });

    const events = await findOutboxEvents(body.entityId);
    expect(events).toHaveLength(1);
    expect(events[0].aggregateType).toBe('OmicsRun');

    const reasons = await findMissingDataReasons('OmicsRun', body.entityId);
    expect(reasons.map((row) => [row.fieldPath, row.reasonCode])).toEqual([['referenceAssembly', 'unknown'], ['mixsChecklist', 'unknown'], ['fileLinks', 'unknown']]);

    const rows = await findIngestionAuditRows('INGESTION_ACCEPTED', body.entityId);
    expect(rows).toHaveLength(1);
    expect(rows[0].resourceType).toBe('OmicsRun');
  });

  test('#1318 RF029 AC4: a transcriptomics OmicsRun, an Object Storage entity, is refused 422 INGESTION_STORE_UNSUPPORTED, persists nothing, and writes one INGESTION_REFUSED row', async ({ request }) => {
    const sourceRecordId = `rf029-e2e-${Date.now()}-omics-run-transcriptomics`;
    // A delta, not an absolute: the stack's logs persist across runs.
    const before = (await findIngestionRefusalRows('OmicsRun')).length;

    const res = await ingest(request, { entityType: 'OmicsRun', payload: { modality: 'transcriptomics' }, provenance: provenance(sourceRecordId) });

    expect(res.status(), await res.text()).toBe(422);
    const body = await res.json();
    expect(body.error).toBe('INGESTION_STORE_UNSUPPORTED');
    expect(body.details).toEqual([expect.stringContaining('transcriptomics')]);
    expect(await countIngestedBySourceRecordId('omicsRuns', sourceRecordId)).toBe(0);
    expect(await countIngestedBySourceRecordId('ingestionQuarantineRecords', sourceRecordId)).toBe(0);

    // The route awaits this row before it answers.
    const rows = await findIngestionRefusalRows('OmicsRun');
    expect(rows).toHaveLength(before + 1);
  });

  test('#1318 RF029 AC4: a TelemetryReading, an InfluxDB entity, is refused 422 INGESTION_STORE_UNSUPPORTED naming the telemetry route, persists nothing, and writes one INGESTION_REFUSED row', async ({ request }) => {
    const sourceRecordId = `rf029-e2e-${Date.now()}-telemetry-reading`;
    // A delta, not an absolute: the stack's logs persist across runs.
    const before = (await findIngestionRefusalRows('TelemetryReading')).length;

    const payload = { sensorId: 'rf029-e2e-sensor', metricType: 'temperature', timestamp: new Date().toISOString(), value: -80.1, unit: 'Cel' };
    const res = await ingest(request, { entityType: 'TelemetryReading', payload, provenance: provenance(sourceRecordId) });

    expect(res.status(), await res.text()).toBe(422);
    const body = await res.json();
    expect(body.error).toBe('INGESTION_STORE_UNSUPPORTED');
    expect(body.details).toEqual([expect.stringContaining('InfluxDB')]);
    expect(await countIngestedBySourceRecordId('ingestionQuarantineRecords', sourceRecordId)).toBe(0);

    // The route awaits this row before it answers. The rows are unsorted,
    // so every one names the release in force rather than a newest one.
    const rows = await findIngestionRefusalRows('TelemetryReading');
    expect(rows).toHaveLength(before + 1);
    expect(rows.every((row) => row.payload.canonicalModelReleaseId === CANONICAL_MODEL_RELEASE_ID)).toBe(true);
  });

  test('#1318 RF029 AC4: a DataFile, an Object Storage binary, is refused 422 INGESTION_STORE_UNSUPPORTED naming the trusted upload routes, persists nothing, and writes one INGESTION_REFUSED row', async ({ request }) => {
    const sourceRecordId = `rf029-e2e-${Date.now()}-data-file`;
    // A delta, not an absolute: the stack's logs persist across runs.
    const before = (await findIngestionRefusalRows('DataFile')).length;

    const payload = { fileUri: 'objstore://rf029-e2e/data-file/sha256/ab', checksum: 'ab', fileSizeBytes: 10 };
    const res = await ingest(request, { entityType: 'DataFile', payload, provenance: provenance(sourceRecordId) });

    expect(res.status(), await res.text()).toBe(422);
    const body = await res.json();
    expect(body.error).toBe('INGESTION_STORE_UNSUPPORTED');
    expect(body.details).toEqual([expect.stringContaining('Object Storage')]);
    expect(await countIngestedBySourceRecordId('ingestionQuarantineRecords', sourceRecordId)).toBe(0);

    // The route awaits this row before it answers.
    const rows = await findIngestionRefusalRows('DataFile');
    expect(rows).toHaveLength(before + 1);
  });

  test('#1481 RF029 AC4: a DataFileVersion, an Object Storage binary, is refused 422 INGESTION_STORE_UNSUPPORTED naming the trusted replace routes, persists nothing, and writes one INGESTION_REFUSED row', async ({ request }) => {
    const sourceRecordId = `rf029-e2e-${Date.now()}-data-file-version`;
    // A delta, not an absolute: the stack's logs persist across runs.
    const before = (await findIngestionRefusalRows('DataFileVersion')).length;

    const payload = { fileUri: 'objstore://rf029-e2e/data-file/sha256/ab', checksum: 'ab', fileSizeBytes: 10 };
    const res = await ingest(request, { entityType: 'DataFileVersion', payload, provenance: provenance(sourceRecordId) });

    expect(res.status(), await res.text()).toBe(422);
    const body = await res.json();
    expect(body.error).toBe('INGESTION_STORE_UNSUPPORTED');
    expect(body.details).toEqual([expect.stringContaining('Object Storage')]);
    expect(body.details[0]).toContain('/replace');
    expect(await countIngestedBySourceRecordId('ingestionQuarantineRecords', sourceRecordId)).toBe(0);

    // The route awaits this row before it answers.
    const rows = await findIngestionRefusalRows('DataFileVersion');
    expect(rows).toHaveLength(before + 1);
  });

  test('#1481 RF029 AC4: a proteomics or metabolomics OmicsRun, an Object Storage entity, is refused 422 INGESTION_STORE_UNSUPPORTED and persists nothing', async ({ request }) => {
    for (const modality of ['proteomics', 'metabolomics']) {
      const sourceRecordId = `rf029-e2e-${Date.now()}-omics-run-${modality}`;
      // A delta, not an absolute: the stack's logs persist across runs.
      const before = (await findIngestionRefusalRows('OmicsRun')).length;

      const res = await ingest(request, { entityType: 'OmicsRun', payload: { modality }, provenance: provenance(sourceRecordId) });

      expect(res.status(), await res.text()).toBe(422);
      const body = await res.json();
      expect(body.error).toBe('INGESTION_STORE_UNSUPPORTED');
      expect(body.details).toEqual([expect.stringContaining(modality)]);
      expect(await countIngestedBySourceRecordId('omicsRuns', sourceRecordId)).toBe(0);
      expect(await countIngestedBySourceRecordId('ingestionQuarantineRecords', sourceRecordId)).toBe(0);

      // The route awaits this row before it answers.
      const rows = await findIngestionRefusalRows('OmicsRun');
      expect(rows).toHaveLength(before + 1);
    }
  });

  // #1318: an Assay's references resolve against real records (#664), so its
  // specimen, study, protocol and laboratory are seeded as
  // specimen-quality-inventory.spec.ts seeds an assay's, by the admin, whose
  // global scope holds any laboratory (#1182).
  async function seedAssayReferences(request: APIRequestContext) {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const studyId = `rf029-assay-study-${suffix}`;
    const protocolId = `rf029-assay-protocol-${suffix}`;
    await seedStudy(studyId);
    await seedProtocol(protocolId);

    const participant = await createRealParticipant(request, apiBaseURL!, admin.token);
    const seededStorageBox = await seedStorageBoxLocation();
    seededStorageBoxes.push(seededStorageBox);
    const { boxId, positionCode } = seededStorageBox;
    const sampleRes = await request.post(`${apiBaseURL}/api/samples`, {
      headers: auth,
      data: {
        participantId: participant.participantId,
        sampleType: 'PLASMA',
        sampleOrigin: 'VENOUS_BLOOD',
        extractionProtocol: 'TUBE_EDTA',
        quantity: 5,
        quality: 'GOOD',
        linkedProject: 'RF029 e2e fixture project',
        registeredAt: new Date().toISOString(),
        boxId,
        positionCode,
      },
    });
    expect(sampleRes.status(), await sampleRes.text()).toBe(201);
    const specimenId = String((await sampleRes.json()).data.specimenId);

    const orgRes = await request.post(`${apiBaseURL}/api/organizations`, {
      headers: auth,
      data: { officialName: `RF029 Lab ${suffix}`, acronym: 'RF029', organizationType: 'biobank', countryCode: 'BR' },
    });
    expect(orgRes.status(), await orgRes.text()).toBe(201);
    const organizationId = (await orgRes.json()).data.organizationId;
    organizationIdsToDelete.push(organizationId);

    return {
      studyId,
      specimenIds: [specimenId],
      assayType: 'RNA sequencing',
      protocolId,
      operatorId: String(admin.user._id),
      laboratoryId: organizationId,
      assayDateTime: new Date().toISOString(),
      intendedUse: 'RF029 e2e proof',
    };
  }

  test('#1318: an accepted Assay is stored in assays with its outbox event and one INGESTION_ACCEPTED row', async ({ request }) => {
    const sourceRecordId = `rf029-e2e-${Date.now()}-assay`;
    const payload = await seedAssayReferences(request);

    const res = await ingest(request, { entityType: 'Assay', payload, provenance: provenance(sourceRecordId) });

    expect(res.status(), await res.text()).toBe(201);
    const body = await res.json();
    expect(body).toMatchObject({ success: true, status: 'accepted', entityType: 'Assay' });

    const stored = await findIngestedRecord('assays', 'assayId', body.entityId);
    expect(stored).toMatchObject({
      createdBy: `Actor/${admin.user._id}`,
      sourceRecordId,
      specimenIds: payload.specimenIds,
      laboratoryId: payload.laboratoryId,
      omicsDomain: null,
      reagentLotIds: [],
    });

    const events = await findOutboxEvents(body.entityId);
    expect(events).toHaveLength(1);
    expect(events[0].aggregateType).toBe('Assay');

    const reasons = await findMissingDataReasons('Assay', body.entityId);
    expect(reasons.map((row) => row.fieldPath)).toEqual(['omicsDomain', 'assayBatchId', 'controls', 'reagentLotIds', 'equipmentIds']);

    const rows = await findIngestionAuditRows('INGESTION_ACCEPTED', body.entityId);
    expect(rows).toHaveLength(1);
    expect(rows[0].resourceType).toBe('Assay');
  });

  test('#1318: an Assay naming a nonexistent specimen answers 422 INGESTION_QUARANTINED with REFERENCE_NOT_FOUND and writes no assays document', async ({ request }) => {
    const sourceRecordId = `rf029-e2e-${Date.now()}-assay-unresolved`;
    const missingSpecimenId = `rf029-specimen-does-not-exist-${Date.now()}`;
    const payload = { ...(await seedAssayReferences(request)), specimenIds: [missingSpecimenId] };

    const res = await ingest(request, { entityType: 'Assay', payload, provenance: provenance(sourceRecordId) });

    expect(res.status(), await res.text()).toBe(422);
    const body = await res.json();
    expect(body).toMatchObject({ success: false, error: 'INGESTION_QUARANTINED' });
    expect(body.details).toEqual([`specimenIds: ${missingSpecimenId} não encontrado`]);

    const record = await findIngestionQuarantineRecord(body.ingestionQuarantineRecordId);
    expect(record?.violations?.map((v: { code: string }) => v.code)).toEqual(['REFERENCE_NOT_FOUND']);
    expect(await countIngestedBySourceRecordId('assays', sourceRecordId)).toBe(0);
  });

  // #1318: a Specimen runs the sample mount's gates against real records: a
  // real participant, an active consent unless the case leaves it out
  // (createRealParticipant seeds none), and a collection site the admin's
  // global scope holds.
  async function seedSpecimenReferences(request: APIRequestContext, { consent = true } = {}) {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const participant = await createRealParticipant(request, apiBaseURL!, admin.token);
    if (consent) await seedActiveConsent(participant.participantId);

    const orgRes = await request.post(`${apiBaseURL}/api/organizations`, {
      headers: auth,
      data: { officialName: `RF029 Site ${suffix}`, acronym: 'RF029', organizationType: 'biobank', countryCode: 'BR' },
    });
    expect(orgRes.status(), await orgRes.text()).toBe(201);
    const organizationId = (await orgRes.json()).data.organizationId;
    organizationIdsToDelete.push(organizationId);

    return {
      specimenId: 'client-claimed',
      participantId: participant.participantId,
      sampleType: 'PLASMA',
      sampleOrigin: 'VENOUS_BLOOD',
      extractionProtocol: 'TUBE_EDTA',
      quantity: 5,
      registeredAt: new Date().toISOString(),
      collectionSite: organizationId,
    };
  }

  test('#1318: an accepted Specimen is stored in samples with a server specimenId, its organizationId, its outbox event and one INGESTION_ACCEPTED row', async ({ request }) => {
    const sourceRecordId = `rf029-e2e-${Date.now()}-specimen`;
    const payload = await seedSpecimenReferences(request);

    const res = await ingest(request, { entityType: 'Specimen', payload, provenance: provenance(sourceRecordId) });

    expect(res.status(), await res.text()).toBe(201);
    const body = await res.json();
    expect(body).toMatchObject({ success: true, status: 'accepted', entityType: 'Specimen' });
    expect(body.entityId).toMatch(/^\d{7}$/);

    const stored = await findIngestedRecord('samples', 'specimenId', body.entityId);
    expect(stored).toMatchObject({
      createdBy: `Actor/${admin.user._id}`,
      sourceRecordId,
      participantId: payload.participantId,
      collectionSite: payload.collectionSite,
      organizationId: payload.collectionSite,
      specimenStatus: 'available',
    });

    const events = await findOutboxEvents(body.entityId);
    expect(events).toHaveLength(1);
    expect(events[0].aggregateType).toBe('Specimen');

    const reasons = await findMissingDataReasons('Specimen', body.entityId);
    expect(reasons.map((row) => row.fieldPath)).toEqual(['barcode', 'linkedProject', 'parentSpecimenIds', 'merkleRoot', 'sprec']);

    const rows = await findIngestionAuditRows('INGESTION_ACCEPTED', body.entityId);
    expect(rows).toHaveLength(1);
    expect(rows[0].resourceType).toBe('Specimen');
  });

  test('#1318 RF029 AC2: a Specimen whose participant has no active consent answers 422 INGESTION_QUARANTINED with CONSENT_NOT_ACTIVE and writes no sample', async ({ request }) => {
    const sourceRecordId = `rf029-e2e-${Date.now()}-specimen-no-consent`;
    const payload = await seedSpecimenReferences(request, { consent: false });

    const res = await ingest(request, { entityType: 'Specimen', payload, provenance: provenance(sourceRecordId) });

    expect(res.status(), await res.text()).toBe(422);
    const body = await res.json();
    expect(body).toMatchObject({ success: false, error: 'INGESTION_QUARANTINED' });

    const record = await findIngestionQuarantineRecord(body.ingestionQuarantineRecordId);
    expect(record?.violations?.map((v: { code: string }) => v.code)).toEqual(['CONSENT_NOT_ACTIVE']);
    expect(await countIngestedBySourceRecordId('samples', sourceRecordId)).toBe(0);
  });

  // #1318: a Participant runs the participant mount's clinical unit and
  // consent template gates against real records: an organization the admin's
  // global scope holds, and the shared consent template, which is never
  // removed because every spec upserts it.
  async function seedParticipantReferences(request: APIRequestContext) {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const consentTemplateId = await seedActiveConsentTemplate(await ingestionDb());

    const officialName = `RF029 Unit ${suffix}`;
    const orgRes = await request.post(`${apiBaseURL}/api/organizations`, {
      headers: auth,
      data: { officialName, acronym: 'RF029', organizationType: 'biobank', countryCode: 'BR' },
    });
    expect(orgRes.status(), await orgRes.text()).toBe(201);
    const organizationId = (await orgRes.json()).data.organizationId;
    organizationIdsToDelete.push(organizationId);

    return { officialName, payload: { participantId: 'client-claimed', sex: 'F', clinicalUnitId: organizationId, consentTemplateId } };
  }

  test('#1318: an accepted Participant is stored in patients with a server participantId, PENDING_CONSENT, its clinical unit, its outbox event and one INGESTION_ACCEPTED row', async ({ request }) => {
    const sourceRecordId = `rf029-e2e-${Date.now()}-participant`;
    const { officialName, payload } = await seedParticipantReferences(request);

    const res = await ingest(request, { entityType: 'Participant', payload, provenance: provenance(sourceRecordId) });

    expect(res.status(), await res.text()).toBe(201);
    const body = await res.json();
    participantIdsToDelete.push(body.entityId);
    expect(body).toMatchObject({ success: true, status: 'accepted', entityType: 'Participant', missingDataReasons: [] });
    expect(body.entityId).toMatch(/^[1-9]\d{7}$/);

    const stored = await findIngestedRecord('patients', 'participantId', body.entityId);
    expect(stored).toMatchObject({
      createdBy: `Actor/${admin.user._id}`,
      sourceRecordId,
      sex: 'F',
      status: 'PENDING_CONSENT',
      clinicalUnitId: payload.clinicalUnitId,
      clinicalUnit: officialName,
      unitAcronym: 'RF029',
      consentTemplateId: payload.consentTemplateId,
    });
    expect(stored).not.toHaveProperty('patientName');

    const events = await findOutboxEvents(body.entityId);
    expect(events).toHaveLength(1);
    expect(events[0].aggregateType).toBe('Participant');

    expect(await findMissingDataReasons('Participant', body.entityId)).toEqual([]);

    const rows = await findIngestionAuditRows('INGESTION_ACCEPTED', body.entityId);
    expect(rows).toHaveLength(1);
    expect(rows[0].resourceType).toBe('Participant');
  });

  test('#1318 #575: a Participant carrying patientName answers 422 INGESTION_STORE_UNSUPPORTED, persists nothing, and audits no name', async ({ request }) => {
    const sourceRecordId = `rf029-e2e-${Date.now()}-participant-identity`;
    const patientName = `RF029 e2e civil name ${Date.now()}`;
    const { payload } = await seedParticipantReferences(request);

    const res = await ingest(request, { entityType: 'Participant', payload: { ...payload, patientName }, provenance: provenance(sourceRecordId) });

    expect(res.status(), await res.text()).toBe(422);
    const body = await res.json();
    expect(body).toMatchObject({ success: false, error: 'INGESTION_STORE_UNSUPPORTED' });
    expect(body.details).toEqual([expect.stringContaining('patientName')]);
    expect(JSON.stringify(body)).not.toContain(patientName);

    expect(await countIngestedBySourceRecordId('patients', sourceRecordId)).toBe(0);
    expect(await countIngestedBySourceRecordId('ingestionQuarantineRecords', sourceRecordId)).toBe(0);
    const refusals = await findIngestionRefusalRows('Participant');
    expect(refusals.length).toBeGreaterThan(0);
    expect(JSON.stringify(refusals)).not.toContain(patientName);
  });

  // #1318: a Consent runs the consent mount's participant, template and
  // responses gates against real records: a real participant with no consent
  // (createRealParticipant seeds none) and the shared active template, which
  // asks for no permission, so the responses are empty.
  async function seedConsentReferences(request: APIRequestContext) {
    const participant = await createRealParticipant(request, apiBaseURL!, admin.token);
    const consentTemplateId = await seedActiveConsentTemplate(await ingestionDb());
    return {
      participantId: participant.participantId,
      consentTemplateId,
      responses: {},
      consentGranted: true,
      consentAcceptedAt: new Date(Date.now() - 60_000).toISOString(),
    };
  }

  test('#1318: an accepted Consent is stored in patientConsents with a server consentId, ACTIVE, its evidence, its decision event, its outbox event and one INGESTION_ACCEPTED row', async ({ request }) => {
    const sourceRecordId = `rf029-e2e-${Date.now()}-consent`;
    const payload = await seedConsentReferences(request);

    const res = await ingest(request, { entityType: 'Consent', payload, provenance: provenance(sourceRecordId) });

    expect(res.status(), await res.text()).toBe(201);
    const body = await res.json();
    consentIdsToDelete.push(body.entityId);
    expect(body).toMatchObject({ success: true, status: 'accepted', entityType: 'Consent', missingDataReasons: [] });
    expect(body.entityId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);

    const stored = await findIngestedRecord('patientConsents', 'consentId', body.entityId);
    expect(stored).toMatchObject({
      createdBy: `Actor/${admin.user._id}`,
      sourceRecordId,
      participantId: payload.participantId,
      consentTemplateId: payload.consentTemplateId,
      status: 'ACTIVE',
      currentStateDerived: 'active',
      signatureName: null,
    });
    expect(new Date(stored.signedAt).toISOString()).toBe(payload.consentAcceptedAt);
    expect(stored.evidenceHash).toMatch(/^sha256:[0-9a-f]{64}$/);

    const decisions = await findConsentDecisionEvents(body.entityId);
    expect(decisions.map((row: { decision: string }) => row.decision)).toEqual(['accepted']);

    const events = await findOutboxEvents(body.entityId);
    expect(events).toHaveLength(1);
    expect(events[0].aggregateType).toBe('Consent');

    const rows = await findIngestionAuditRows('INGESTION_ACCEPTED', body.entityId);
    expect(rows).toHaveLength(1);
    expect(rows[0].resourceType).toBe('Consent');
  });

  test('#1318 RF010 AC5: a Consent naming the participant\'s consent in force is accepted and supersedes it through its history', async ({ request }) => {
    const payload = await seedConsentReferences(request);

    const first = await ingest(request, { entityType: 'Consent', payload, provenance: provenance(`rf029-e2e-${Date.now()}-consent-prior`) });
    expect(first.status(), await first.text()).toBe(201);
    const priorId = (await first.json()).entityId;
    consentIdsToDelete.push(priorId);

    const successor = { ...payload, supersedesConsentId: priorId, consentAcceptedAt: new Date(Date.now() - 30_000).toISOString() };
    const res = await ingest(request, { entityType: 'Consent', payload: successor, provenance: provenance(`rf029-e2e-${Date.now()}-consent-successor`) });

    expect(res.status(), await res.text()).toBe(201);
    const body = await res.json();
    consentIdsToDelete.push(body.entityId);
    expect(body).toMatchObject({ success: true, status: 'accepted', entityType: 'Consent' });

    const stored = await findIngestedRecord('patientConsents', 'consentId', body.entityId);
    expect(stored).toMatchObject({ supersedesConsentId: priorId, status: 'ACTIVE', currentStateDerived: 'active' });
    const prior = await findIngestedRecord('patientConsents', 'consentId', priorId);
    expect(prior).toMatchObject({ status: 'REVOKED', currentStateDerived: 'superseded', supersededByConsentId: body.entityId });
    const priorDecisions = await findConsentDecisionEvents(priorId);
    expect(priorDecisions.map((row: { decision: string }) => row.decision).sort()).toEqual(['accepted', 'superseded']);
  });

  test('#1481 RF029 AC6: an ingested Consent projects into Neo4j as an ACTIVE EthicalConsent under a pseudonymized Donor, and its ingestion outbox event is consumed', async ({ request }) => {
    const sourceRecordId = `rf029-e2e-${Date.now()}-consent-graph`;
    const payload = await seedConsentReferences(request);

    const res = await ingest(request, { entityType: 'Consent', payload, provenance: provenance(sourceRecordId) });

    expect(res.status(), await res.text()).toBe(201);
    const body = await res.json();
    consentIdsToDelete.push(body.entityId);

    // The graph node's id is the consent's Mongo _id, not its consentId
    // (consentTarget.js, graphProjection.service.js).
    const stored = await findIngestedRecord('patientConsents', 'consentId', body.entityId);
    const consentNodeId = String(stored._id);
    await waitForEthicalConsentStatus(consentNodeId, 'ACTIVE');

    const { consent, donorIds } = await readConsentProjection(consentNodeId);
    expect(donorIds).toEqual([expect.stringMatching(/^DONOR_[0-9a-f]{24}$/)]);
    expect(consent).not.toBeNull();
    expect(Object.keys(consent!)).not.toContain('participantId');
    expect(Object.values(consent!).filter((v) => typeof v === 'string').some((v) => (v as string).includes(payload.participantId))).toBe(false);
    expect(donorIds.some((id) => id.includes(payload.participantId))).toBe(false);

    // The projector skips INGESTION_RECORD_PERSISTED, and the worker marks a
    // skipped event projected all the same.
    await expect.poll(async () => (await findOutboxEvents(body.entityId))[0]?.status, { timeout: 15_000 }).toBe('PROJECTED');
  });

  test('#1318: a Consent carrying signatureName answers 422 INGESTION_STORE_UNSUPPORTED, persists nothing, and audits no name', async ({ request }) => {
    const sourceRecordId = `rf029-e2e-${Date.now()}-consent-signature`;
    const signatureName = `RF029 e2e signer name ${Date.now()}`;
    const payload = await seedConsentReferences(request);

    const res = await ingest(request, { entityType: 'Consent', payload: { ...payload, signatureName }, provenance: provenance(sourceRecordId) });

    expect(res.status(), await res.text()).toBe(422);
    const body = await res.json();
    expect(body).toMatchObject({ success: false, error: 'INGESTION_STORE_UNSUPPORTED' });
    expect(body.details).toEqual([expect.stringContaining('signatureName')]);
    expect(JSON.stringify(body)).not.toContain(signatureName);

    expect(await countIngestedBySourceRecordId('patientConsents', sourceRecordId)).toBe(0);
    expect(await countIngestedBySourceRecordId('ingestionQuarantineRecords', sourceRecordId)).toBe(0);
    const refusals = await findIngestionRefusalRows('Consent');
    expect(refusals.length).toBeGreaterThan(0);
    expect(JSON.stringify(refusals)).not.toContain(signatureName);
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

    const record = await findIngestionQuarantineRecord(body.ingestionQuarantineRecordId);
    expect(record.missingDataReasons).toEqual([{ fieldPath: 'doi', reasonCode: 'withheld' }]);
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

  test('#1481 RF029 AC1: a Dataset with a non-canonical field name, no datasetTitle and empty creators is quarantined with its contract violations and a failed assessment', async ({ request }) => {
    const sourceRecordId = `rf029-e2e-${Date.now()}-dataset-alias`;
    const payload = { title: 'RF029 e2e alias', datasetVersion: '1.0.0', creators: [], license: 'CC BY 4.0' };

    const res = await ingest(request, { entityType: 'Dataset', payload, provenance: provenance(sourceRecordId) });

    expect(res.status(), await res.text()).toBe(422);
    const body = await res.json();
    expect(body.error).toBe('INGESTION_QUARANTINED');
    expect(body.details).toEqual([
      "must have required property 'datasetTitle'",
      'must NOT have additional properties',
      'must NOT have fewer than 1 items',
      'datasetTitle é obrigatório',
      'creators é obrigatório e deve ser um array não vazio',
    ]);

    const record = await findIngestionQuarantineRecord(body.ingestionQuarantineRecordId);
    expect(record?.violations?.map((v: any) => [v.code, v.field, v.ajvKeyword ?? null])).toEqual([
      ['CONTRACT_VIOLATION', 'datasetTitle', 'required'],
      ['CONTRACT_VIOLATION', 'title', 'additionalProperties'],
      ['CONTRACT_VIOLATION', 'creators', 'minItems'],
      ['ENTITY_VALIDATION_FAILED', null, null],
      ['ENTITY_VALIDATION_FAILED', null, null],
    ]);
    expect(await countIngestedBySourceRecordId('datasets', sourceRecordId)).toBe(0);

    const assessment = await findDataQualityAssessment(body.dataQualityAssessmentId);
    expect(assessment.status).toBe('failed');
    const results = Object.fromEntries(assessment.results.map((result: any) => [result.metric, result]));
    expect(results.completeness).toMatchObject({ numerator: 2, denominator: 4 });
    expect(results.validity.value).toBe(0);
    expect(results.consistency.value).toBe(0);
  });

  function workflowRunPayload() {
    return {
      workflowId: 'rf029-e2e-variant-calling-pipeline',
      workflowVersion: '2.3.1',
      createdBy: 'User/e2e-suite',
      startedAt: new Date().toISOString(),
      runStatus: 'succeeded',
      hardwareProfile: { cpu: 'synthetic', gpu: null },
      randomSeed: 0,
      environmentManifestUri: 'object://synthetic/environment.json',
    };
  }

  test('#1481 RNF011 AC1: a WorkflowRun with an unknown runStatus and a non-integer randomSeed is quarantined with its enum and type violations', async ({ request }) => {
    const sourceRecordId = `rf029-e2e-${Date.now()}-workflow-enum-type`;
    const payload = { ...workflowRunPayload(), runStatus: 'finished', randomSeed: '7' };

    const res = await ingest(request, { entityType: 'WorkflowRun', payload, provenance: provenance(sourceRecordId) });

    expect(res.status(), await res.text()).toBe(422);
    const body = await res.json();
    expect(body.error).toBe('INGESTION_QUARANTINED');
    expect(body.details).toEqual([
      'must be equal to one of the allowed values',
      'must be integer',
      'runStatus deve ser um de: queued, running, succeeded, failed, cancelled',
      'randomSeed deve ser um inteiro',
    ]);

    const record = await findIngestionQuarantineRecord(body.ingestionQuarantineRecordId);
    expect(record?.violations?.map((v: any) => [v.code, v.field, v.ajvKeyword ?? null])).toEqual([
      ['CONTRACT_VIOLATION', 'runStatus', 'enum'],
      ['CONTRACT_VIOLATION', 'randomSeed', 'type'],
      ['ENTITY_VALIDATION_FAILED', null, null],
      ['ENTITY_VALIDATION_FAILED', null, null],
    ]);
    expect(await countIngestedBySourceRecordId('workflowRuns', sourceRecordId)).toBe(0);
  });

  test('#1481 RNF011 AC1: a succeeded WorkflowRun carrying a failureReason is quarantined under the conditional rule', async ({ request }) => {
    const sourceRecordId = `rf029-e2e-${Date.now()}-workflow-conditional`;
    const payload = { ...workflowRunPayload(), failureReason: 'OOM' };

    const res = await ingest(request, { entityType: 'WorkflowRun', payload, provenance: provenance(sourceRecordId) });

    expect(res.status(), await res.text()).toBe(422);
    const body = await res.json();
    expect(body.error).toBe('INGESTION_QUARANTINED');
    // The canonical schema refuses the field itself; the second message is
    // the model's conditional rule on runStatus (WorkflowRun.js).
    expect(body.details).toEqual([
      'must NOT have additional properties',
      'failureReason só é permitido quando runStatus é failed ou cancelled',
    ]);
    expect(await countIngestedBySourceRecordId('workflowRuns', sourceRecordId)).toBe(0);
  });

  test('#1481 RF029 AC2: a record without provenance.sourceSystem or provenance.retrievedAt is quarantined, its assessment scoring provenance 2 of 4 and timeliness not assessed', async ({ request }) => {
    const sourceRecordId = `rf029-e2e-${Date.now()}-no-origin`;

    const res = await ingest(request, { entityType: 'Dataset', payload: datasetPayload(), provenance: { purpose: 'e2e_proof', sourceRecordId } });

    expect(res.status(), await res.text()).toBe(422);
    const body = await res.json();
    expect(body.error).toBe('INGESTION_QUARANTINED');
    expect(body.details).toEqual(['provenance.sourceSystem é obrigatório', 'provenance.retrievedAt é obrigatório']);

    const record = await findIngestionQuarantineRecord(body.ingestionQuarantineRecordId);
    expect(record?.violations?.map((v: { code: string }) => v.code)).toEqual(['PROVENANCE_FIELD_MISSING', 'PROVENANCE_FIELD_MISSING']);
    expect(await countIngestedBySourceRecordId('datasets', sourceRecordId)).toBe(0);

    const assessment = await findDataQualityAssessment(body.dataQualityAssessmentId);
    expect(assessment.status).toBe('failed');
    const results = Object.fromEntries(assessment.results.map((result: any) => [result.metric, result]));
    expect(results.provenance).toMatchObject({ numerator: 2, denominator: 4 });
    expect(results.timeliness).toMatchObject({ value: null, notAssessed: 'no_retrieved_at' });
  });

  test('#1481 RNF011 AC2: a Consent writing the derived currentStateDerived is quarantined and writes no consent', async ({ request }) => {
    const sourceRecordId = `rf029-e2e-${Date.now()}-consent-derived`;
    const payload = { ...(await seedConsentReferences(request)), currentStateDerived: 'active' };

    const res = await ingest(request, { entityType: 'Consent', payload, provenance: provenance(sourceRecordId) });

    expect(res.status(), await res.text()).toBe(422);
    const body = await res.json();
    expect(body.error).toBe('INGESTION_QUARANTINED');
    expect(body.details).toEqual(['must NOT have additional properties']);

    const record = await findIngestionQuarantineRecord(body.ingestionQuarantineRecordId);
    expect(record?.violations?.map((v: { code: string; field: string }) => [v.code, v.field])).toEqual([['CONTRACT_VIOLATION', 'currentStateDerived']]);
    expect(await countIngestedBySourceRecordId('patientConsents', sourceRecordId)).toBe(0);
  });

  test('RF029 AC10: an unsupported entityType is refused 422, persists nothing, and writes one INGESTION_REFUSED row', async ({ request }) => {
    const sourceRecordId = `rf029-e2e-${Date.now()}-unsupported`;
    // Unique per run, so the stack's persistent logs hold one row for it.
    // The first char is already upper case, so it is the row's resourceType.
    const entityType = `Rf029E2eUnsupported${Date.now()}`;

    const res = await ingest(request, { entityType, payload: datasetPayload(), provenance: provenance(sourceRecordId) });

    expect(res.status(), await res.text()).toBe(422);
    const body = await res.json();
    expect(body.error).toBe('INGESTION_TARGET_UNSUPPORTED');
    expect(body.details).toEqual(expect.arrayContaining([expect.stringContaining(entityType)]));
    expect(await countIngestedBySourceRecordId('datasets', sourceRecordId)).toBe(0);
    expect(await countIngestedBySourceRecordId('ingestionQuarantineRecords', sourceRecordId)).toBe(0);

    // The route awaits this row before it answers. Refused before the
    // releases are read, so the row names none.
    const rows = await findIngestionRefusalRows(entityType);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'warning', severity: 'warning' });
    expect(rows[0].payload.canonicalModelReleaseId).toBeNull();
    expect(rows[0].payload.configurationReleaseId).toBeNull();
  });

  test('RF029 AC10: a Técnico is refused 403, persists nothing, and the denial is audited as FORBIDDEN', async ({ request }) => {
    const sourceRecordId = `rf029-e2e-${Date.now()}-forbidden`;
    const username = `tecnico.rf029.${Date.now()}`;
    const password = 'Tecnico@123-forte';
    const registerResponse = await request.post(`${apiBaseURL}/api/users/register`, {
      headers: auth,
      data: {
        name: 'RF029 Técnico Fixture',
        email: `${username}@example.com`,
        username,
        password,
        accessType: 2,
        roleName: 'Técnico',
      },
    });
    expect(registerResponse.ok(), await registerResponse.text()).toBeTruthy();
    const tecnico = await completeFirstLoginMfa(request, apiBaseURL!, username, password);
    // A delta, not an absolute: the stack's logs persist across runs.
    const before = await countAccessDenialRows('FORBIDDEN', INGESTION_PATH);

    const res = await request.post(`${apiBaseURL}${INGESTION_PATH}`, {
      headers: { Authorization: `Bearer ${tecnico.token}` },
      data: { entityType: 'Dataset', payload: datasetPayload(), provenance: provenance(sourceRecordId) },
    });

    expect(res.status(), await res.text()).toBe(403);
    expect((await res.json()).error).toBe('Acesso negado');
    expect(await countIngestedBySourceRecordId('datasets', sourceRecordId)).toBe(0);
    // The global request audit writes this row after the response.
    await expect.poll(() => countAccessDenialRows('FORBIDDEN', INGESTION_PATH)).toBe(before + 1);
  });

  test('RF029 AC10: a call without a token is refused 401, persists nothing, and the denial is audited as UNAUTHORIZED', async ({ request }) => {
    const sourceRecordId = `rf029-e2e-${Date.now()}-unauthorized`;
    const before = await countAccessDenialRows('UNAUTHORIZED', INGESTION_PATH);

    const res = await request.post(`${apiBaseURL}${INGESTION_PATH}`, {
      data: { entityType: 'Dataset', payload: datasetPayload(), provenance: provenance(sourceRecordId) },
    });

    expect(res.status(), await res.text()).toBe(401);
    expect(await countIngestedBySourceRecordId('datasets', sourceRecordId)).toBe(0);
    await expect.poll(() => countAccessDenialRows('UNAUTHORIZED', INGESTION_PATH)).toBe(before + 1);
  });
});
