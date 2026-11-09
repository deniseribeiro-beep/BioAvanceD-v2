import { test, expect } from '@playwright/test';
import { MongoClient } from 'mongodb';
import { realLogin, seedRealAuth } from './helpers/realAuth';
import { completeFirstLoginMfa } from './helpers/completeFirstLoginMfa';
import { watchAuditTrail, assertAuditEventRecorded } from './helpers/assertAuditEvent';
import {
  createRealParticipant,
  seedRawSpecimen,
  seedStudy,
  seedAssay,
  seedStorageBoxLocation,
  cleanupStorageBoxLocation,
  closeSeedDb,
  type SeededStorageBox,
} from './helpers/seedParticipant';
import {
  waitForEthicalConsentStatus,
  waitForTerminologyConceptNode,
  waitForTerminologyRelation,
  waitForSampleGovernedBy,
  countSampleNodes,
  countGraph,
  closeNeo4jDriver,
  readConsentProjection,
  readStoredAtEdges,
  waitForStoredAtEdge,
} from './helpers/queryNeo4j';
import {
  consentOutboxEvents,
  projectionCheckpoint,
  requeueOutboxEvents,
  waitForOutboxEventsProjected,
  closeOutboxDb,
} from './helpers/queryOutbox';
import { countAllPoints } from './helpers/queryInflux';
import {
  countEssentialReferenceDocs,
  essentialReferenceImportRuns,
  countFoundationDataRuns,
  latestFoundationDataRun,
  latestReadinessReport,
  governanceRegistry,
  indexNamesOf,
  countReferenceDatasetReleases,
  countTerminologyConcepts,
  countReferenceDatasetReleasesByDatasetCode,
  countActiveReferenceDatasetReleasesByDatasetCode,
  countTerminologyConceptsBySystemUri,
  findReferenceRelease,
  referenceImportRunsForRelease,
  referenceImportIssuesForRun,
  countReferenceImportStagingForRun,
  findReferenceCoverageManifest,
  findDataQualityAssessment,
  terminologyConceptsBySystemUri,
  countTerminologyRelationsByRelease,
  findAuditLog,
  insertScratchFoundationDataRun,
  scratchFoundationDataRun,
  countScratchFoundationEvidence,
  setScratchGovernanceChecksum,
  dropScratchFoundationDb,
  closeFoundationDb,
} from './helpers/queryFoundationData';
import {
  findIngestionQuarantineRecord,
  countIngestionQuarantineRecordsByIdempotencyKey,
  findIngestionIdempotencyKey,
  closeIngestionDb,
} from './helpers/queryIngestion';
import { seedSensorWithPolicy, closeSeedSensorDb } from './helpers/seedSensor';

// Real backend only — see backend-integration.spec.ts for the same skip
// rationale. Run via `npm run test:e2e:docker` against the compose test
// stack: this spec additionally needs neo4j-projection-worker-test
// (compose.test.yml, #292) actually running, since nothing else in the
// stack drains graph_projection_outbox.
const apiBaseURL = process.env.PLAYWRIGHT_API_BASE_URL;

test.skip(!apiBaseURL, 'PLAYWRIGHT_API_BASE_URL not set — run via npm run test:e2e:docker');

test.describe('Outbox → Neo4j projection (RF023) — real backend', () => {
  test.afterAll(async () => {
    await closeSeedDb();
    await closeNeo4jDriver();
    await closeOutboxDb();
  });

  // POST /api/e-consent/consents (consent.service.js's createPatientConsent,
  // mounted under /api/e-consent — see eConsent.js/app.js) appends a
  // CONSENT_UPSERTED event to graph_projection_outbox on the same request
  // (recordConsentProjectionEvent) — proving the pipeline means polling the
  // real Neo4j instance for the projected :EthicalConsent node, not trusting
  // the 201 response (the projection itself is asynchronous, see
  // neo4jProjection.worker.js). signatureName/signatureImageBase64 are
  // required by normalizeSignaturePayload's schema validation (minLength 1
  // once the keys are present, even though they're not in the schema's
  // `required` array) — any non-empty string passes, no real image needed.
  function signatureFields() {
    return { signatureName: 'RF023 e2e signer', signatureImageBase64: 'e2e-fixture-signature' };
  }

  test('a signed consent projects into Neo4j as an ACTIVE EthicalConsent node', async ({ request }) => {
    const admin = await realLogin(request);
    const participant = await createRealParticipant(request, apiBaseURL!, admin.token);

    const response = await request.post(`${apiBaseURL}/api/e-consent/consents`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: {
        participantId: participant.participantId,
        consentTemplateId: participant.consentTemplateId,
        responses: {},
        ...signatureFields(),
      },
    });

    expect(response.ok()).toBe(true);
    const body = await response.json();
    const consentId = body?.data?._id;
    expect(consentId).toBeTruthy();

    await waitForEthicalConsentStatus(consentId, 'ACTIVE');
  });

  // POST /api/consents/:id/revoke (consent.service.js's revokeConsent)
  // appends a CONSENT_REVOKED event for the same aggregate — the projected
  // node's status must actually flip, not just get a second untouched node.
  test('a revoked consent projects into Neo4j as a REVOKED EthicalConsent node', async ({ request }) => {
    const admin = await realLogin(request);
    const participant = await createRealParticipant(request, apiBaseURL!, admin.token);

    const create = await request.post(`${apiBaseURL}/api/e-consent/consents`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: {
        participantId: participant.participantId,
        consentTemplateId: participant.consentTemplateId,
        responses: {},
        ...signatureFields(),
      },
    });
    expect(create.ok()).toBe(true);
    const createBody = await create.json();
    const consentId = createBody?.data?._id;
    expect(consentId).toBeTruthy();

    await waitForEthicalConsentStatus(consentId, 'ACTIVE');

    const revoke = await request.post(`${apiBaseURL}/api/e-consent/consents/${consentId}/revoke`, {
      headers: { Authorization: `Bearer ${admin.token}` },
    });
    expect(revoke.ok()).toBe(true);

    await waitForEthicalConsentStatus(consentId, 'REVOKED');
  });

  // #1225: LineageRepository's consent gate reads
  // (sample)-[:GOVERNED_BY]->(consent), MERGEing the sample under its Mongo
  // _id. The consent projection used to fall back to the consent's own id for
  // the missing specimenId, so every GOVERNED_BY edge landed on a phantom
  // Sample keyed by the consent id and no real sample was ever governed.
  // Both orders are covered: consent first, then sample, and the reverse.
  const seededBoxes: SeededStorageBox[] = [];
  test.afterAll(async () => {
    await Promise.all(seededBoxes.map((box) => cleanupStorageBoxLocation(box).catch(() => {})));
  });

  async function signConsent(request: any, token: string, participant: { participantId: string; consentTemplateId: string }) {
    const response = await request.post(`${apiBaseURL}/api/e-consent/consents`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        participantId: participant.participantId,
        consentTemplateId: participant.consentTemplateId,
        responses: {},
        ...signatureFields(),
      },
    });
    expect(response.ok()).toBe(true);
    const consentId = String((await response.json())?.data?._id || '');
    expect(consentId).toBeTruthy();
    return consentId;
  }

  async function createSampleMongoId(request: any, token: string, participantId: string) {
    const box = await seedStorageBoxLocation();
    seededBoxes.push(box);
    const create = await request.post(`${apiBaseURL}/api/samples`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        participantId,
        sampleType: 'PLASMA',
        sampleOrigin: 'VENOUS_BLOOD',
        extractionProtocol: 'TUBE_EDTA',
        quantity: 5,
        quality: 'GOOD',
        linkedProject: 'RF023 #1225 consent-governance e2e fixture',
        registeredAt: new Date().toISOString(),
        boxId: box.boxId,
        positionCode: box.positionCode,
      },
    });
    expect([201, 202]).toContain(create.status());
    const specimenId = (await create.json()).data.specimenId;
    const read = await request.get(`${apiBaseURL}/api/samples/${specimenId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(read.status()).toBe(200);
    return String((await read.json()).data._id);
  }

  test('a sample created after its donor consented is GOVERNED_BY that consent, and no phantom Sample carries the consent id (#1225)', async ({ request }) => {
    const admin = await realLogin(request);
    const participant = await createRealParticipant(request, apiBaseURL!, admin.token);
    const consentId = await signConsent(request, admin.token, participant);
    await waitForEthicalConsentStatus(consentId, 'ACTIVE');

    const sampleMongoId = await createSampleMongoId(request, admin.token, participant.participantId);

    await waitForSampleGovernedBy(sampleMongoId, consentId);
    expect(await countSampleNodes(consentId)).toBe(0);
  });

  test('a sample created before its donor consented becomes GOVERNED_BY the consent once it is signed (#1225)', async ({ request }) => {
    const admin = await realLogin(request);
    const participant = await createRealParticipant(request, apiBaseURL!, admin.token);
    const sampleMongoId = await createSampleMongoId(request, admin.token, participant.participantId);

    const consentId = await signConsent(request, admin.token, participant);

    await waitForSampleGovernedBy(sampleMongoId, consentId);
    expect(await countSampleNodes(consentId)).toBe(0);
  });

  async function revokeConsent(request: any, token: string, consentId: string) {
    const revoke = await request.post(`${apiBaseURL}/api/e-consent/consents/${consentId}/revoke`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(revoke.ok()).toBe(true);
  }

  // #1500 (RF023 AC4, RNF019 C4): the revoke is sent without waiting for the
  // create's projection, so both events may share one lease batch; the
  // projector must still apply v1 before v2. The node turns REVOKED inside
  // the apply, before the checkpoint and the PROJECTED mark are written, so
  // the outbox and checkpoint are read only once both events are PROJECTED.
  test("a consent's create and revoke apply in aggregateVersion order and leave the projector's checkpoint at the revoke (RF023 AC4, RNF019 C4)", async ({ request }) => {
    const admin = await realLogin(request);
    const participant = await createRealParticipant(request, apiBaseURL!, admin.token);
    const consentId = await signConsent(request, admin.token, participant);
    await revokeConsent(request, admin.token, consentId);

    await waitForEthicalConsentStatus(consentId, 'REVOKED');
    const queued = await consentOutboxEvents(consentId);
    await waitForOutboxEventsProjected(queued.map((e) => String(e.eventId)));

    const events = await consentOutboxEvents(consentId);
    expect(events).toHaveLength(2);
    expect(events.map((e) => e.aggregateVersion)).toEqual([1, 2]);
    expect(events.map((e) => e.eventType)).toEqual(['CONSENT_UPSERTED', 'CONSENT_REVOKED']);
    expect(events.map((e) => e.status)).toEqual(['PROJECTED', 'PROJECTED']);
    expect(new Date(events[0].projectedAt).getTime()).toBeLessThanOrEqual(new Date(events[1].projectedAt).getTime());

    const checkpoint = await projectionCheckpoint('EthicalConsent:' + consentId);
    expect(checkpoint).not.toBeNull();
    expect(checkpoint!.lastAggregateVersion).toBe(2);
    expect(checkpoint!.lastEventId).toBe(events[1].eventId);
    expect(checkpoint!.partitionKey).toBe('EthicalConsent:' + consentId);
    expect(checkpoint!.projectorName).toBe('neo4j-canonical-projection');
  });

  // #1500 (RF023 AC6, RNF019 C3): delivery is at-least-once, so an applied
  // event can come back. The projector must mark it PROJECTED again without
  // re-applying it: a re-apply would rewrite the node's updatedAt and
  // lastProjectionAt, and move the checkpoint's updatedAt.
  test('re-queuing an applied consent event leaves the projected node and the checkpoint unchanged (RF023 AC6, RNF019 C3)', async ({ request }) => {
    const admin = await realLogin(request);
    const participant = await createRealParticipant(request, apiBaseURL!, admin.token);
    const consentId = await signConsent(request, admin.token, participant);
    await waitForEthicalConsentStatus(consentId, 'ACTIVE');
    await revokeConsent(request, admin.token, consentId);
    await waitForEthicalConsentStatus(consentId, 'REVOKED');

    const events = await consentOutboxEvents(consentId);
    expect(events).toHaveLength(2);
    const eventIds = events.map((e) => String(e.eventId));
    await waitForOutboxEventsProjected(eventIds);

    const before = await readConsentProjection(consentId);
    expect(before.consent?.status).toBe('REVOKED');
    const cpBefore = await projectionCheckpoint('EthicalConsent:' + consentId);
    expect(cpBefore).not.toBeNull();

    await requeueOutboxEvents(eventIds);
    await waitForOutboxEventsProjected(eventIds);

    const after = await readConsentProjection(consentId);
    expect(after).toEqual(before);
    expect(after.consent?.status).toBe('REVOKED');
    expect(after.consent?.lastProjectionEventId).toBe(eventIds[1]);

    const cpAfter = await projectionCheckpoint('EthicalConsent:' + consentId);
    expect(cpAfter).not.toBeNull();
    expect(cpAfter!.lastAggregateVersion).toBe(2);
    expect(cpAfter!.lastEventId).toBe(cpBefore!.lastEventId);
    expect(cpAfter!.updatedAt).toEqual(cpBefore!.updatedAt);
  });

  // #1500 (RF023 AC5): a placement projects as a STORED_AT edge carrying
  // validTime [validFrom, validTo) and the projection's transactionTime; the
  // next placement closes the open edge at its own validFrom instead of
  // deleting it. Each edge is read by the box it points into, since the
  // event keys the Sample by the id auto-assign received.
  test('a placement projects as a STORED_AT edge with validTime [from,to) and transactionTime, closed by the next placement (RF023 AC5)', async ({ request }) => {
    const admin = await realLogin(request);
    const participant = await createRealParticipant(request, apiBaseURL!, admin.token);
    const homeBox = await seedStorageBoxLocation();
    seededBoxes.push(homeBox);
    const boxA = await seedStorageBoxLocation();
    seededBoxes.push(boxA);
    const boxB = await seedStorageBoxLocation();
    seededBoxes.push(boxB);

    const create = await request.post(`${apiBaseURL}/api/samples`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: {
        participantId: participant.participantId,
        sampleType: 'PLASMA',
        sampleOrigin: 'VENOUS_BLOOD',
        extractionProtocol: 'TUBE_EDTA',
        quantity: 5,
        quality: 'GOOD',
        linkedProject: 'RF023 #1500 placement validTime e2e fixture',
        registeredAt: new Date().toISOString(),
        boxId: homeBox.boxId,
        positionCode: homeBox.positionCode,
      },
    });
    expect([201, 202]).toContain(create.status());
    const specimenId = (await create.json()).data.specimenId;
    expect(specimenId).toBeTruthy();

    async function placeInto(boxId: string) {
      const release = await request.delete(`${apiBaseURL}/api/storage/release/${specimenId}`, {
        headers: { Authorization: `Bearer ${admin.token}` },
      });
      expect(release.status()).toBe(200);
      const assign = await request.post(`${apiBaseURL}/api/storage/allocate/auto`, {
        headers: { Authorization: `Bearer ${admin.token}` },
        data: { sampleId: specimenId, boxId },
      });
      expect(assign.status()).toBe(201);
      expect((await assign.json()).success).toBe(true);
    }

    await placeInto(boxA.boxId);
    const edgesA = await waitForStoredAtEdge(boxA.boxId);
    expect(edgesA).toHaveLength(1);
    expect(edgesA[0].validFrom).not.toBeNull();
    expect(edgesA[0].transactionTime).not.toBeNull();
    expect(edgesA[0].validTo).toBeNull();

    await placeInto(boxB.boxId);
    const edgesB = await waitForStoredAtEdge(boxB.boxId);
    expect(edgesB).toHaveLength(1);
    await expect
      .poll(async () => (await readStoredAtEdges(boxA.boxId))[0]?.validTo ?? null, { timeout: 15_000 })
      .not.toBeNull();

    const [edgeA] = await readStoredAtEdges(boxA.boxId);
    const [edgeB] = await readStoredAtEdges(boxB.boxId);
    expect(edgeA.validTo).toBe(edgeB.validFrom);
    expect(Date.parse(edgeA.validFrom!)).toBeLessThan(Date.parse(edgeA.validTo!));
    expect(edgeB.validTo).toBeNull();
    expect(edgeB.transactionTime).not.toBeNull();
    expect(edgeB.sampleId).toBe(edgeA.sampleId);
  });
});

// RF028 AC9 ("Persistir primeiro no MongoDB e projetar no Neo4j
// exclusivamente pelo outbox", #552): services/referenceRelease.service.js's
// promoteRelease now appends a TERMINOLOGY_CONCEPT_PROMOTED/
// TERMINOLOGY_RELATION_PROMOTED event to graph_projection_outbox on the same
// write that inserts a TerminologyConcept/TerminologyRelation, same pattern
// RF023 uses above — the generic neo4jProjection.worker.js drains both. HPO
// is imported automatically as part of the Foundation Data Pipeline
// bootstrap (RF022/#367), so this test doesn't trigger a promotion itself —
// it only waits for HP:0000001 ("All", the bundled fixture's root concept)
// and its HP:0000118→HP:0000001 is_a relation to already be there. Same
// bootstrap-dependency caveat as "Reference data importers (RF028)" below:
// #371 wired the bootstrap into compose.test.yml, so this is now proven
// against the test stack too, not just the dev stack.
test.describe('Outbox → Neo4j projection (RF028 AC9) — real backend', () => {
  test.afterAll(async () => {
    await closeNeo4jDriver();
  });

  test('a bootstrapped HPO concept projects into Neo4j as a TerminologyConcept node', async () => {
    await waitForTerminologyConceptNode('HP:0000001', 'http://purl.obolibrary.org/obo/hp.owl', 'All');
  });

  test('a bootstrapped HPO is_a relation projects into Neo4j as a TERMINOLOGY_RELATION edge', async () => {
    await waitForTerminologyRelation('HP:0000118', 'HP:0000001', 'http://purl.obolibrary.org/obo/hp.owl', 'is_a');
  });
});

// dict-07/dict-08 (#329, "Gap crítico"): the target Foundation Data Pipeline
// is a one-shot, idempotent bootstrap of the full canonical dictionary
// across six technical entities, executed automatically after the stack's
// healthchecks pass — not a script a human has to remember to run.
// api/backend/scripts/seed-essential-reference-data.js is wired as exactly
// that (#366) for compose.dev.yml's `foundation-bootstrap` one-shot service,
// writing one FoundationDataRun document per run (#370) instead of the
// per-manifest-entry `referenceSeedRuns` rows #366 started with. #371 cut
// compose.test.yml over to the same bootstrap (`foundation-bootstrap-test`,
// mirroring the dev service) — these assertions (read directly from Mongo —
// there's no API surface for any of this) now pass against a freshly-booted
// test stack too, not just the dev stack.
test.describe('Foundation Data Pipeline bootstrap (RF022) — real backend', () => {
  test.afterAll(async () => {
    await closeFoundationDb();
  });

  // RF022 AC7: Foundation prepares the reference loaders and populates none
  // of them; the Phase 2 job loads the essential set before the API, one
  // ReferenceImportRun per entry, each naming the Foundation run that let it.
  test('the essential reference set is loaded by the Phase 2 job, not by Foundation', async () => {
    expect(await countEssentialReferenceDocs()).toBeGreaterThan(0);

    const foundationRun = await latestFoundationDataRun();
    const miabisStep = foundationRun!.steps.find((step: any) => step.step === 'miabis-minimal');
    expect(miabisStep).toMatchObject({ status: 'prepared', keyless: 0 });
    expect(miabisStep.checkpoint).toBeUndefined();

    const runs = await essentialReferenceImportRuns();
    for (const key of ['miabis-minimal', 'sprec-minimal', 'rcs-gov-1.0']) {
      expect(runs.find((run) => run.datasetCode === key)).toMatchObject({
        importMode: 'full',
        runStatus: 'completed',
        foundationDataRunId: foundationRun!.foundationDataRunId,
        referenceDatasetReleaseId: expect.any(String),
      });
      expect(await countActiveReferenceDatasetReleasesByDatasetCode(key)).toBe(1);
    }
  });

  test('the bootstrap records an idempotent FoundationDataRun, not just ad-hoc upserts', async () => {
    const runs = await countFoundationDataRuns();
    expect(runs).toBeGreaterThan(0);
  });

  // RF022 AC1 (Requisitos v4.0.0): Foundation validates the approved v2.0.0
  // dictionary, 1644 elements including the 929 historical ones, in the 146
  // entities/artefacts of plano F1.3 (RNF031 AC1).
  test('the bootstrap run validated the v2.0.0 dictionary: 1644 elements in 146 entities, 929 historical', async () => {
    const run = await latestFoundationDataRun();
    expect(run).not.toBeNull();
    expect(run!.dictionaryVersion).toBe('2.0.0');
    expect(run!.validationSummary.dictionaryCompleteness).toMatchObject({
      dictionaryVersion: '2.0.0',
      loadedTotal: 1644,
      uniqueTotal: 1644,
      historicalTotal: 929,
      expectedEntityTotal: 146,
      entityTotal: 146,
      missingHistoricalIds: [],
      verified: true,
    });
  });

  // RF022 AC5, RNF031 C4: one apply run does dry-run, apply and verify, and
  // records each result with the v2.0.0 run fields.
  test('the bootstrap run recorded dry-run, apply and verify, each passing', async () => {
    const run = await latestFoundationDataRun();
    expect(run).toMatchObject({
      executionMode: 'apply',
      runStatus: 'completed',
      dryRunResult: 'pass',
      applyResult: 'pass',
      verifyResult: 'pass',
      rollbackResult: 'not_required',
      canonicalModelReleaseId: 'release-2.0.0',
      migrationPlanId: 'migration-1.3.0-to-2.0.0',
    });
    expect(run!.reportUri).toMatch(/^urn:bioavanced:foundation-data-run:[0-9a-f-]{36}#sha256=[0-9a-f]{64}$/);
  });

  // RF022 AC4/AC9, RNF014 C6/C7: the job ran before the API and wrote a
  // ready ReadinessReport for that run. backend-app-test starts only on it
  // (FOUNDATION_READINESS_REQUIRED), so this suite running at all is the API
  // having passed that gate.
  test('a ready ReadinessReport for the bootstrap run gates the API', async () => {
    const run = await latestFoundationDataRun();
    const report = await latestReadinessReport('test');
    expect(report).toMatchObject({
      status: 'ready',
      blockers: [],
      foundationDataRunId: run!.foundationDataRunId,
      canonicalModelReleaseId: 'release-2.0.0',
    });
    const results = Object.fromEntries(report!.gateResults.map((gate: any) => [gate.gate, gate.result]));
    expect(results).toMatchObject({
      version: 'pass',
      schemas: 'pass',
      'reference-mechanisms': 'pass',
      'storage-constraints': 'pass',
      'zero-operational-data': 'pass',
      'zero-reference-data': 'pass',
      'governance-registry': 'pass',
      configuration: 'pass',
      rcs: 'pass',
    });
    expect(report!.p0Coverage).toBeGreaterThan(0);
    expect(report!.p0Coverage).toBeLessThan(1);
  });

  // RF022 AC3, RNF031 AC3: the rcs gate is P0 and its evidence reads the
  // rule package, the axes, the governance evidence, the input snapshot and
  // the recalculation of the golden vectors.
  test('the bootstrap ReadinessReport carries the P0 rcs gate with its five passing checks', async () => {
    const report = await latestReadinessReport('test');
    const rcs = report!.gateResults.find((gate: any) => gate.gate === 'rcs');
    expect(rcs).toMatchObject({ result: 'pass', p0: true });
    expect(rcs.evidence.error).toBeUndefined();
    expect(rcs.evidence.checks.map((entry: any) => [entry.check, entry.passed])).toEqual([
      ['releases', true], ['axes', true], ['governance-evidence', true], ['input-snapshot', true], ['golden-vectors', true],
    ]);
    for (const key of ['rulePackage', 'governanceRuleSet', 'matrixMappingRelease', 'sprecMappingRelease']) {
      expect(rcs.evidence[key]).not.toBeNull();
    }
  });

  // #1304, plano §4 F1.2: the job registered the release this build follows,
  // once, with the invariant catalog bound to it (RF014 AC6, CFG-003).
  test('the bootstrap registered the CanonicalModelRelease and its invariant catalog', async () => {
    const { release, catalogs } = await governanceRegistry('release-2.0.0');
    expect(release).toMatchObject({ semanticVersion: '2.0.0', releaseStatus: 'active' });
    expect(release!.checksum).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(release!.artifactManifest.map((entry: any) => entry.artifact)).toContain('catalog.2.0.0.json');
    expect(catalogs).toHaveLength(1);
    expect(catalogs[0]).toMatchObject({ semanticVersion: '1.0.0', status: 'active' });
    expect(catalogs[0].invariants.map((invariant: any) => invariant.invariantId)).toEqual(
      expect.arrayContaining(['INV-AUDIT-001', 'INV-CONSENT-001', 'INV-SCOPE-001']),
    );
  });

  // RF022 AC2: Foundation builds the model indexes before the API serves its
  // first request, and they are on the real collections.
  test('the bootstrap built the model indexes on the real collections', async () => {
    const report = await latestReadinessReport('test');
    const constraints = report!.gateResults.find((gate: any) => gate.gate === 'storage-constraints');
    expect(constraints.evidence.built).toBeGreaterThan(0);
    expect(constraints.evidence.failed).toEqual([]);
    expect(await indexNamesOf('samples')).toContain('samples_barcode_unique_v2');
    expect(await indexNamesOf('sessions')).toContain('sessions_accessTokenHash_v1');
  });

  // RF022 AC2/AC5, RNF031 AC2: the run records a step per preparation, the
  // ones a later phase brings as deferred, and a checkpoint on each step it
  // completed, in the order it completed them.
  test('the bootstrap run records a step per preparation and a checkpoint per completed step', async () => {
    const run = await latestFoundationDataRun();
    const steps = run!.steps;
    const byName = Object.fromEntries(steps.map((step: any) => [step.step, step]));
    expect(steps.map((step: any) => step.step)).toEqual([
      'entities', 'miabis-minimal', 'sprec-minimal', 'rcs-gov-1.0',
      'governance-registry', 'rbac-catalog', 'report-templates', 'indexes',
      'quarantine', 'outbox', 'audit', 'tests', 'rollback',
    ]);
    expect(byName.entities).toMatchObject({ status: 'completed', plannedCounts: { elements: 1644, entities: 146, historical: 929 } });
    for (const key of ['miabis-minimal', 'sprec-minimal', 'rcs-gov-1.0']) {
      expect(byName[key]).toMatchObject({ status: 'prepared', keyless: 0 });
    }
    for (const key of ['governance-registry', 'rbac-catalog', 'report-templates', 'indexes']) {
      expect(byName[key].status).toBe('completed');
    }
    expect(byName.indexes.plannedCounts.indexes).toBeGreaterThan(0);
    for (const key of ['quarantine', 'outbox', 'audit']) {
      expect(byName[key]).toMatchObject({ status: 'deferred', builtIn: expect.any(String) });
    }
    expect(byName.tests).toMatchObject({ status: 'completed', plannedCounts: { failed: 0 } });
    expect(byName.rollback).toMatchObject({ status: 'prepared', plannedCounts: { removable: 0 } });

    const completed = steps.filter((step: any) => step.status === 'completed');
    expect(completed.map((step: any) => step.step)).toEqual([
      'entities', 'governance-registry', 'rbac-catalog', 'report-templates', 'indexes', 'tests',
    ]);
    expect(completed.map((step: any) => step.checkpoint.sequence)).toEqual([1, 2, 3, 4, 5, 6]);
    for (const step of completed) {
      expect(Number.isNaN(new Date(step.checkpoint.completedAt).getTime())).toBe(false);
    }
  });
});

// RF022 AC5/AC9/AC10, RNF031 AC4/AC6 (#1485): the one-shot runs once before
// the API, and a rollback or a failing gate on the stack's database would
// block its ReadinessReport. The test-support route runs the job's own
// runSeed() against an e2e_foundation_ scratch database on the same Mongo,
// which these tests drop afterwards.
async function postFoundationRun(request: import('@playwright/test').APIRequestContext, database: string, mode: string) {
  const response = await request.post(`${apiBaseURL}/api/_test-support/foundation-runs/run`, {
    headers: { 'x-test-support-secret': process.env.TEST_SUPPORT_SECRET ?? '' },
    data: { database, mode },
  });
  expect(response.status()).toBe(200);
  return (await response.json()).data;
}

function gateResultsByName(report: any): Record<string, string> {
  return Object.fromEntries(report.gateResults.map((gate: any) => [gate.gate, gate.result]));
}

test.describe('Foundation job modes on a scratch database (RF022 AC5 AC9 AC10, RNF031 AC4 AC6) — real backend', () => {
  test.describe.configure({ mode: 'serial' });
  const suffix = `${Date.now()}`;
  const cycleDb = `e2e_foundation_${suffix}_cycle`;
  const driftDb = `e2e_foundation_${suffix}_drift`;
  const registryDb = `e2e_foundation_${suffix}_registry`;
  let applyRunId: string;

  test.afterAll(async () => {
    for (const database of [cycleDb, driftDb, registryDb]) await dropScratchFoundationDb(database);
    await closeFoundationDb();
  });

  test('dry-run, apply and verify each leave their checkpoint and a ready report naming the rcs gate (RNF031 AC4, RF022 AC5)', async ({ request }) => {
    const dry = await postFoundationRun(request, cycleDb, 'dry_run');
    expect(dry.run).toMatchObject({
      executionMode: 'dry_run', runStatus: 'completed', dryRunResult: 'pass', applyResult: 'not_run', verifyResult: 'not_run', rollbackResult: 'not_required',
    });
    expect(dry.run.steps.map((step: any) => [step.step, step.status])).toEqual([
      ['miabis-minimal', 'planned'], ['sprec-minimal', 'planned'], ['rcs-gov-1.0', 'planned'],
    ]);
    expect(dry.report).toBeNull();
    expect(dry.exitCode).toBe(0);

    // The apply's steps and checkpoints are the bootstrap run's shape (RF022 AC2/AC5).
    const applied = await postFoundationRun(request, cycleDb, 'apply');
    expect(applied.run).toMatchObject({
      executionMode: 'apply', runStatus: 'completed', dryRunResult: 'pass', applyResult: 'pass', verifyResult: 'pass', rollbackResult: 'not_required',
      previousRunId: dry.run.foundationDataRunId,
    });
    expect(applied.run.steps.map((step: any) => [step.step, step.status])).toEqual([
      ['entities', 'completed'],
      ['miabis-minimal', 'prepared'], ['sprec-minimal', 'prepared'], ['rcs-gov-1.0', 'prepared'],
      ['governance-registry', 'completed'], ['rbac-catalog', 'completed'], ['report-templates', 'completed'], ['indexes', 'completed'],
      ['quarantine', 'deferred'], ['outbox', 'deferred'], ['audit', 'deferred'],
      ['tests', 'completed'], ['rollback', 'prepared'],
    ]);
    expect(applied.run.steps.filter((step: any) => step.checkpoint).map((step: any) => [step.step, step.checkpoint.sequence])).toEqual([
      ['entities', 1], ['governance-registry', 2], ['rbac-catalog', 3], ['report-templates', 4], ['indexes', 5], ['tests', 6],
    ]);
    expect(applied.report).toMatchObject({ status: 'ready', blockers: [], foundationDataRunId: applied.run.foundationDataRunId });
    expect(gateResultsByName(applied.report)).toMatchObject({ rcs: 'pass' });
    expect(applied.exitCode).toBe(0);
    applyRunId = applied.run.foundationDataRunId;

    const verified = await postFoundationRun(request, cycleDb, 'validate');
    expect(verified.run).toMatchObject({ executionMode: 'validate', verifyResult: 'pass', applyResult: 'not_run', previousRunId: applyRunId });
    expect(verified.run.steps.map((step: any) => [step.step, step.status])).toEqual([['verify', 'completed']]);
    expect(verified.report.status).toBe('ready');
  });

  test('a rollback undoes the newest apply, blocks promotion and leaves the evidence append-only, and only a new apply promotes again (RF022 AC5 AC10)', async ({ request }) => {
    const before = await scratchFoundationDataRun(cycleDb, applyRunId);
    const rolled = await postFoundationRun(request, cycleDb, 'rollback');
    expect(rolled.run).toMatchObject({
      executionMode: 'rollback', runStatus: 'rolled_back', rollbackResult: 'pass', dryRunResult: 'not_run', applyResult: 'not_run', verifyResult: 'not_run',
    });
    expect(rolled.run.validationSummary.rollbackTargetRunId).toBe(applyRunId);
    expect(rolled.run.steps).toEqual([{ step: 'rollback', status: 'pass', removed: {} }]);
    expect(rolled.report).toMatchObject({ status: 'blocked', blockers: [`rolled_back:${applyRunId}`] });
    expect(gateResultsByName(rolled.report)).toMatchObject({ rollback: 'pass' });
    expect(rolled.exitCode).toBe(0);

    // RF022 AC10: the apply run is never edited; dry_run writes no report.
    expect(await scratchFoundationDataRun(cycleDb, applyRunId)).toEqual(before);
    expect(await countScratchFoundationEvidence(cycleDb)).toEqual({ runs: 4, reports: 3 });

    const reapplied = await postFoundationRun(request, cycleDb, 'apply');
    expect(reapplied.report.status).toBe('ready');
    expect(reapplied.run.previousRunId).toBe(rolled.run.foundationDataRunId);
  });

  test('an apply whose release arrives with a different dictionary checksum is blocked before it applies (RF022 AC9, RNF031 AC6)', async ({ request }) => {
    await insertScratchFoundationDataRun(driftDb, {
      environment: 'test', runStatus: 'completed', startedAt: new Date(0), canonicalModelReleaseId: 'release-2.0.0', dictionaryChecksum: 'a-different-catalog',
    });
    const { run, report, exitCode } = await postFoundationRun(request, driftDb, 'apply');
    expect(run).toMatchObject({ runStatus: 'failed', dryRunResult: 'fail', applyResult: 'not_run' });
    expect(report.status).toBe('blocked');
    expect(report.blockers).toEqual(expect.arrayContaining(['gate:version', 'dry_run_failed']));
    expect(report.gateResults.find((gate: any) => gate.gate === 'version')).toMatchObject({ result: 'fail', p0: true });
    expect(exitCode).toBe(2);
  });

  test('an apply whose registered release and invariant catalog carry a different checksum is blocked on the governance registry (RF022 AC9, RNF031 AC6)', async ({ request }) => {
    await postFoundationRun(request, registryDb, 'apply');
    await setScratchGovernanceChecksum(registryDb, 'canonicalModelReleases', 'release-2.0.0', 'sha256:registered-elsewhere');
    await setScratchGovernanceChecksum(registryDb, 'governanceInvariantCatalogs', 'release-2.0.0', 'sha256:registered-elsewhere');
    const { report, exitCode } = await postFoundationRun(request, registryDb, 'apply');
    expect(report.status).toBe('blocked');
    expect(report.blockers).toEqual(['gate:governance-registry']);
    expect(report.gateResults.find((gate: any) => gate.gate === 'governance-registry').evidence.failures).toEqual([
      'checksum da canonicalModelRelease diverge', 'checksum do governanceInvariantCatalog diverge',
    ]);
    expect(exitCode).toBe(2);
  });
});

// dict-08 (#330, "Reference data pipeline" row, "Importadores ausentes ou
// placeholders"): RF028 requires explicit Fase 2 pipelines that download,
// parse, validate, stage and promote reference datasets (MONDO, HPO, ORPHA,
// LOINC, etc. — AC 2), recording every release in ReferenceDatasetRelease
// (AC 1) and every persisted concept in TerminologyConcept linked to that
// release (AC 6). No such importer exists in api/backend/src today — only
// Fase 3 operational import.controller.js/import.service.js, which have
// nothing to do with reference datasets — so these collections are read
// directly from Mongo, same no-API-surface pattern as RF022 above, and are
// expected to stay empty against the real backend.
test.describe('Reference data importers (RF028) — real backend', () => {
  test.afterAll(async () => {
    await closeFoundationDb();
  });

  test('at least one reference dataset release has been registered', async () => {
    const releases = await countReferenceDatasetReleases();
    expect(releases).toBeGreaterThan(0);
  });

  test('imported terminology concepts are persisted and linked to a release', async () => {
    const concepts = await countTerminologyConcepts();
    expect(concepts).toBeGreaterThan(0);
  });

  // #548: HPO alone (#367) already satisfies the two generic assertions
  // above, so they can't prove MONDO specifically landed. This checks the
  // MONDO release and its concepts by name, per §7.4 step 3 ("Importar
  // MONDO e suas relações de doença").
  test('the MONDO release and its terminology concepts are persisted', async () => {
    const releases = await countReferenceDatasetReleasesByDatasetCode('MONDO');
    expect(releases).toBeGreaterThan(0);

    const concepts = await countTerminologyConceptsBySystemUri('http://purl.obolibrary.org/obo/mondo.owl');
    expect(concepts).toBeGreaterThan(0);
  });

  // #549: same rationale as the MONDO assertion above — the generic checks
  // are already satisfied by HPO/MONDO and can't prove ORPHA specifically
  // landed. Checks the ORPHA release and its concepts by name, per §7.4
  // step 4 ("Importar ORPHA, CID-11, CID-10 e OMIM...").
  test('the ORPHA release and its terminology concepts are persisted', async () => {
    const releases = await countReferenceDatasetReleasesByDatasetCode('ORPHA');
    expect(releases).toBeGreaterThan(0);

    const concepts = await countTerminologyConceptsBySystemUri('http://www.orpha.net');
    expect(concepts).toBeGreaterThan(0);
  });

  // #549: same rationale as the MONDO/ORPHA assertions above — the generic
  // checks can't prove ICD-11 specifically landed. Checks the ICD11
  // release and its concepts by name, per §7.4 step 4 (second member of
  // the "ORPHA, CID-11, CID-10 e OMIM" group, right after ORPHA).
  test('the ICD-11 release and its terminology concepts are persisted', async () => {
    const releases = await countReferenceDatasetReleasesByDatasetCode('ICD11');
    expect(releases).toBeGreaterThan(0);

    const concepts = await countTerminologyConceptsBySystemUri('http://id.who.int/icd/release/11/mms');
    expect(concepts).toBeGreaterThan(0);
  });

  // #549: same rationale as the MONDO/ORPHA/ICD-11 assertions above — the
  // generic checks can't prove ICD-10 specifically landed. Checks the
  // ICD10 release and its concepts by name, per §7.4 step 4 (third member
  // of the "ORPHA, CID-11, CID-10 e OMIM" group, right after ICD-11).
  test('the ICD-10 release and its terminology concepts are persisted', async () => {
    const releases = await countReferenceDatasetReleasesByDatasetCode('ICD10');
    expect(releases).toBeGreaterThan(0);

    const concepts = await countTerminologyConceptsBySystemUri('http://hl7.org/fhir/sid/icd-10');
    expect(concepts).toBeGreaterThan(0);
  });

  // #549: same rationale as the MONDO/ORPHA/ICD-11/ICD-10 assertions above —
  // the generic checks can't prove OMIM specifically landed. Checks the
  // OMIM release and its concepts by name, per §7.4 step 4 (fourth and
  // final member of the "ORPHA, CID-11, CID-10 e OMIM" group, right after
  // ICD-10).
  test('the OMIM release and its terminology concepts are persisted', async () => {
    const releases = await countReferenceDatasetReleasesByDatasetCode('OMIM');
    expect(releases).toBeGreaterThan(0);

    const concepts = await countTerminologyConceptsBySystemUri('https://www.omim.org');
    expect(concepts).toBeGreaterThan(0);
  });

  // #549: same rationale as the prior per-source assertions above — the
  // generic checks can't prove HGNC specifically landed. Checks the HGNC
  // release and its concepts by name, per §7.4 step 5 ("Importar HGNC e
  // relações gene-fenótipo/doença"), right after the step 4 group closes
  // out with OMIM.
  test('the HGNC release and its terminology concepts are persisted', async () => {
    const releases = await countReferenceDatasetReleasesByDatasetCode('HGNC');
    expect(releases).toBeGreaterThan(0);

    const concepts = await countTerminologyConceptsBySystemUri('https://www.genenames.org');
    expect(concepts).toBeGreaterThan(0);
  });

  // #549: same rationale as the prior per-source assertions above — the
  // generic checks can't prove LOINC specifically landed. Checks the LOINC
  // release and its concepts by name, per §7.4 step 6 ("Importar LOINC e
  // UCUM"), leading the pair right after HGNC.
  test('the LOINC release and its terminology concepts are persisted', async () => {
    const releases = await countReferenceDatasetReleasesByDatasetCode('LOINC');
    expect(releases).toBeGreaterThan(0);

    const concepts = await countTerminologyConceptsBySystemUri('http://loinc.org');
    expect(concepts).toBeGreaterThan(0);
  });

  // #549: same rationale as the prior per-source assertions above — the
  // generic checks can't prove UCUM specifically landed. Checks the UCUM
  // release and its concepts by name, per §7.4 step 6, closing out the
  // "LOINC e UCUM" pair right after LOINC.
  test('the UCUM release and its terminology concepts are persisted', async () => {
    const releases = await countReferenceDatasetReleasesByDatasetCode('UCUM');
    expect(releases).toBeGreaterThan(0);

    const concepts = await countTerminologyConceptsBySystemUri('http://unitsofmeasure.org');
    expect(concepts).toBeGreaterThan(0);
  });

  // #549: same rationale as the prior per-source assertions above — the
  // generic checks can't prove DCB specifically landed. Checks the DCB
  // release and its concepts by name, per §7.4 step 7 ("Importar DCB e
  // ATC/DDD"), leading the pair right after UCUM.
  test('the DCB release and its terminology concepts are persisted', async () => {
    const releases = await countReferenceDatasetReleasesByDatasetCode('DCB');
    expect(releases).toBeGreaterThan(0);

    const concepts = await countTerminologyConceptsBySystemUri('https://www.gov.br/anvisa/pt-br/assuntos/farmacopeia/dcb');
    expect(concepts).toBeGreaterThan(0);
  });

  // #549: same rationale as the prior per-source assertions above — the
  // generic checks can't prove ATC specifically landed. Checks the ATC
  // release and its concepts by name, per §7.4 step 7, closing out the
  // "DCB e ATC/DDD" pair right after DCB.
  test('the ATC release and its terminology concepts are persisted', async () => {
    const releases = await countReferenceDatasetReleasesByDatasetCode('ATC');
    expect(releases).toBeGreaterThan(0);

    const concepts = await countTerminologyConceptsBySystemUri('http://www.whocc.no/atc');
    expect(concepts).toBeGreaterThan(0);
  });

  // #549: same rationale as the prior per-source assertions above — the
  // generic checks can't prove DUO specifically landed. Checks the DUO
  // release and its concepts by name, per §7.4 step 8 ("Importar DUO,
  // Uberon, NCBI Taxonomy, Cell Ontology e EDAM"), leading the final group
  // right after ATC closes out step 7.
  test('the DUO release and its terminology concepts are persisted', async () => {
    const releases = await countReferenceDatasetReleasesByDatasetCode('DUO');
    expect(releases).toBeGreaterThan(0);

    const concepts = await countTerminologyConceptsBySystemUri('http://purl.obolibrary.org/obo/duo.owl');
    expect(concepts).toBeGreaterThan(0);
  });

  // #549: same rationale as the prior per-source assertions above — the
  // generic checks can't prove Uberon specifically landed. Checks the
  // Uberon release and its concepts by name, per §7.4 step 8 ("Importar
  // DUO, Uberon, NCBI Taxonomy, Cell Ontology e EDAM"), second of the
  // final five-source group right after DUO.
  test('the Uberon release and its terminology concepts are persisted', async () => {
    const releases = await countReferenceDatasetReleasesByDatasetCode('UBERON');
    expect(releases).toBeGreaterThan(0);

    const concepts = await countTerminologyConceptsBySystemUri('http://purl.obolibrary.org/obo/uberon.owl');
    expect(concepts).toBeGreaterThan(0);
  });

  // #549: same rationale as the prior per-source assertions above — the
  // generic checks can't prove NCBI Taxonomy specifically landed. Checks
  // the NCBI Taxonomy release and its concepts by name, per §7.4 step 8
  // ("Importar DUO, Uberon, NCBI Taxonomy, Cell Ontology e EDAM"), third of
  // the final five-source group right after Uberon.
  test('the NCBI Taxonomy release and its terminology concepts are persisted', async () => {
    const releases = await countReferenceDatasetReleasesByDatasetCode('NCBITAX');
    expect(releases).toBeGreaterThan(0);

    const concepts = await countTerminologyConceptsBySystemUri('http://purl.obolibrary.org/obo/ncbitaxon.owl');
    expect(concepts).toBeGreaterThan(0);
  });

  // #549: same rationale as the prior per-source assertions above — the
  // generic checks can't prove Cell Ontology specifically landed. Checks
  // the Cell Ontology release and its concepts by name, per §7.4 step 8
  // ("Importar DUO, Uberon, NCBI Taxonomy, Cell Ontology e EDAM"), fourth of
  // the final five-source group right after NCBI Taxonomy.
  test('the Cell Ontology release and its terminology concepts are persisted', async () => {
    const releases = await countReferenceDatasetReleasesByDatasetCode('CL');
    expect(releases).toBeGreaterThan(0);

    const concepts = await countTerminologyConceptsBySystemUri('http://purl.obolibrary.org/obo/cl.owl');
    expect(concepts).toBeGreaterThan(0);
  });

  // #549: same rationale as the prior per-source assertions above — the
  // generic checks can't prove EDAM specifically landed. Checks the EDAM
  // release and its concepts by name, per §7.4 step 8 ("Importar DUO,
  // Uberon, NCBI Taxonomy, Cell Ontology e EDAM"), fifth and last of the
  // final five-source group right after Cell Ontology, closing out the
  // entire 16-source Fase 2 group.
  test('the EDAM release and its terminology concepts are persisted', async () => {
    const releases = await countReferenceDatasetReleasesByDatasetCode('EDAM');
    expect(releases).toBeGreaterThan(0);

    const concepts = await countTerminologyConceptsBySystemUri('http://edamontology.org/EDAM.owl');
    expect(concepts).toBeGreaterThan(0);
  });
});

// RF028 AC1-9, RNF032 AC1-9 (#1476): imports run only in the stack's one-shot
// bootstrap jobs, and promoting or rolling back a bootstrapped dataset on
// persistent volumes would break every test that relies on it. So the
// test-support route /api/_test-support/reference-import-runs (same gates as the ingestion
// probe below) runs the real import pipeline into a fresh E2E_ dataset, and
// the release it registers is promoted and rolled back through the real
// Administrador routes. No cleanup: release history is never deleted, and
// the unique E2E_ code and systemUri touch no other test's data.
async function postReferenceImportSupport(
  request: import('@playwright/test').APIRequestContext,
  path: string,
  body: Record<string, unknown>,
) {
  return request.post(`${apiBaseURL}/api/_test-support/reference-import-runs/${path}`, {
    headers: { 'x-test-support-secret': process.env.TEST_SUPPORT_SECRET ?? '' },
    data: body,
  });
}

// The ten lines of api/backend/src/reference-data/reference-imports/fixtures/hpo-sample.jsonl:
// eight valid terms with seven is_a relations, one without a code and one without a label.
const HPO_SAMPLE_RECORDS: Record<string, unknown>[] = [
  { id: 'HP:0000001', lbl: 'All', is_a: [], synonyms: [], obsolete: false },
  { id: 'HP:0000118', lbl: 'Phenotypic abnormality', is_a: ['HP:0000001'], synonyms: [], obsolete: false },
  { id: 'HP:0000707', lbl: 'Abnormality of the nervous system', is_a: ['HP:0000118'], synonyms: [], obsolete: false },
  { id: 'HP:0012638', lbl: 'Abnormal nervous system physiology', is_a: ['HP:0000707'], synonyms: [], obsolete: false },
  { id: 'HP:0001250', lbl: 'Seizure', is_a: ['HP:0012638'], synonyms: ['Seizures', 'Epileptic seizure'], obsolete: false },
  { id: 'HP:0002133', lbl: 'Status epilepticus', is_a: ['HP:0001250'], synonyms: [], obsolete: false },
  { id: 'HP:0007359', lbl: 'Focal seizure', is_a: ['HP:0001250'], synonyms: [], obsolete: false },
  { id: 'HP:0001251', lbl: 'Ataxia', is_a: ['HP:0012638'], synonyms: [], obsolete: false },
  { id: '', lbl: 'Missing code term', is_a: [], synonyms: [], obsolete: false },
  { id: 'HP:9999999', lbl: '', is_a: [], synonyms: [], obsolete: false },
];

test.describe('Reference release lifecycle (RF028 AC1-9, RNF032 AC1-9) — real backend', () => {
  test.describe.configure({ mode: 'serial' });

  test.afterAll(async () => {
    await closeFoundationDb();
    await closeNeo4jDriver();
  });

  const suffix = `${Date.now()}`;
  const datasetCode = `E2E_RF028_${suffix}`;
  const systemUri = `urn:bioavanced:e2e:${datasetCode}`;
  let firstReleaseId: string;

  test('an import registers its release before the load, stages, quarantines and checkpoints, keeps its asset and writes its coverage manifest and quality assessment (RF028 AC1-7, RNF032 AC1-7)', async ({ request }) => {
    const response = await postReferenceImportSupport(request, 'run', {
      datasetCode,
      datasetVersion: 'e2e-v1',
      records: HPO_SAMPLE_RECORDS,
    });
    expect(response.status(), await response.text()).toBe(200);
    const { data } = await response.json();
    expect(data.approved).toBe(true);
    expect(data.idempotent).toBe(false);
    expect(data.run.runStatus).toBe('completed');
    firstReleaseId = data.releaseId;

    // RF028 AC1: the release is registered with its origin before the load.
    const release = await findReferenceRelease(firstReleaseId);
    expect(release).not.toBeNull();
    expect(release!.releaseStatus).toBe('approved');
    expect(release!.datasetVersion).toBe('e2e-v1');
    expect(release!.sourceChecksum).toMatch(/^[0-9a-f]{64}$/);
    expect(release!.sourceFormat).toEqual(['JSONL']);
    for (const field of ['sourceId', 'license', 'retrievalUri', 'parserVersion', 'mappingVersion', 'coverageManifestId', 'dataQualityAssessmentId']) {
      expect(release![field], field).toBeTruthy();
    }

    // RF028 AC3/AC4, RNF032 AC3/AC4: the full run read, validated, rejected,
    // staged in batches and checkpointed its offset.
    const runs = await referenceImportRunsForRelease(firstReleaseId);
    const run = runs.find((candidate) => candidate.referenceImportRunId === data.run.referenceImportRunId);
    expect(run).toBeDefined();
    expect(new Date(release!.createdAt).getTime()).toBeLessThanOrEqual(new Date(run!.startedAt).getTime());
    expect(run!.importMode).toBe('full');
    expect(run!.recordsRead).toBe(10);
    expect(run!.recordsValidated).toBe(8);
    expect(run!.recordsRejected).toBe(2);
    expect(run!.checkpoint.offset).toBe(15);
    expect(run!.batchSize).toBe(500);
    expect(run!.validationSummary.approved).toBe(true);
    expect(await countReferenceImportStagingForRun(run!.referenceImportRunId)).toBe(15);

    // RF028 AC5, RNF032 AC5: the two bad rows are quarantined as open issues.
    const issues = await referenceImportIssuesForRun(run!.referenceImportRunId);
    expect(issues.map((issue) => issue.errorCode).sort()).toEqual(['MISSING_CODE', 'MISSING_DISPLAY']);
    for (const issue of issues) {
      expect(issue.resolutionStatus).toBe('open');
      expect(issue.referenceDatasetReleaseId).toBe(firstReleaseId);
    }

    // RF028 AC2, RNF032 AC2: the source asset is kept, byte for byte.
    expect(data.assetUri).toBe(`objstore://reference-releases/${datasetCode}/sha256/${release!.sourceChecksum}`);
    const assetResponse = await postReferenceImportSupport(request, 'asset', { datasetCode, checksum: release!.sourceChecksum });
    expect(assetResponse.status(), await assetResponse.text()).toBe(200);
    const asset = (await assetResponse.json()).data;
    expect(asset.exists).toBe(true);
    expect(asset.sha256).toBe(release!.sourceChecksum);

    // RF028 AC6/AC7, RNF032 AC6/AC7: the coverage manifest explains every
    // missing row, and the quality assessment of the release passed.
    const manifest = await findReferenceCoverageManifest(release!.coverageManifestId);
    expect(manifest).not.toBeNull();
    expect(manifest!.referenceDatasetReleaseId).toBe(firstReleaseId);
    expect(manifest!.assets).toEqual([data.assetUri]);
    expect(manifest!.expectedCount).toBe(10);
    expect(manifest!.obtainedCount).toBe(8);
    expect(manifest!.exclusions).toHaveLength(2);
    expect(manifest!.coverageResult).toBe('justified');
    const assessment = await findDataQualityAssessment(release!.dataQualityAssessmentId);
    expect(assessment).not.toBeNull();
    expect(assessment!.status).toBe('passed');
    expect(assessment!.scopeType).toBe('dataset_release');
    expect(assessment!.scopeId).toBe(firstReleaseId);

    // RF028 AC8: an approved release writes no records before its promotion.
    expect(await countTerminologyConceptsBySystemUri(systemUri)).toBe(0);
  });

  test('promotion and rollback are explicit Administrador calls, publish to the outbox and are audited (RF028 AC5, AC8, AC9, RNF032 AC6, AC8, AC9)', async ({ request }) => {
    const promoteUrl = (releaseId: string) => `${apiBaseURL}/api/reference-releases/${releaseId}/promote`;

    const unauthenticated = await request.post(promoteUrl(firstReleaseId));
    expect(unauthenticated.status(), await unauthenticated.text()).toBe(401);

    const admin = await realLogin(request);
    const auth = { Authorization: `Bearer ${admin.token}` };

    const promoted = await request.post(promoteUrl(firstReleaseId), { headers: auth });
    expect(promoted.status(), await promoted.text()).toBe(200);
    const promotion = (await promoted.json()).data;
    expect(promotion.promoted).toBe(true);
    expect(promotion.previousReleaseId).toBeNull();
    expect(promotion.recordsInserted).toBe(15);

    const active = await findReferenceRelease(firstReleaseId);
    expect(active!.releaseStatus).toBe('active');
    expect(typeof active!.promotionApprovedBy).toBe('string');
    expect(active!.promotionApprovedBy).not.toBe('');
    expect(active!.promotionApprovedBy).not.toBe('system:reference-data-bootstrap');

    const concepts = await terminologyConceptsBySystemUri(systemUri);
    expect(concepts).toHaveLength(8);
    for (const concept of concepts) {
      expect(concept.referenceDatasetReleaseId).toBe(firstReleaseId);
    }
    expect(await countTerminologyRelationsByRelease(firstReleaseId)).toBe(7);

    // RF028 AC9: the promoted records reach Neo4j through the outbox.
    await waitForTerminologyConceptNode('HP:0000118', systemUri, 'Phenotypic abnormality');
    await waitForTerminologyRelation('HP:0000118', 'HP:0000001', systemUri, 'is_a');

    const promoteAudit = await findAuditLog('PROMOTE', firstReleaseId);
    expect(promoteAudit).not.toBeNull();
    expect(promoteAudit!.status).toBe('success');

    const again = await request.post(promoteUrl(firstReleaseId), { headers: auth });
    expect(again.status(), await again.text()).toBe(409);
    expect((await again.json()).error).toBe('release_not_approved');

    const unknown = await request.post(promoteUrl(`no-such-release-${suffix}`), { headers: auth });
    expect(unknown.status(), await unknown.text()).toBe(404);
    expect((await unknown.json()).error).toBe('release_not_found');

    const secondImport = await postReferenceImportSupport(request, 'run', {
      datasetCode,
      datasetVersion: 'e2e-v2',
      records: HPO_SAMPLE_RECORDS,
    });
    expect(secondImport.status(), await secondImport.text()).toBe(200);
    const second = (await secondImport.json()).data;
    expect(second.approved).toBe(true);
    const secondReleaseId: string = second.releaseId;
    expect(secondReleaseId).not.toBe(firstReleaseId);

    const promotedSecond = await request.post(promoteUrl(secondReleaseId), { headers: auth });
    expect(promotedSecond.status(), await promotedSecond.text()).toBe(200);
    expect((await promotedSecond.json()).data.previousReleaseId).toBe(firstReleaseId);
    expect((await findReferenceRelease(firstReleaseId))!.releaseStatus).toBe('superseded');
    expect((await findReferenceRelease(secondReleaseId))!.releaseStatus).toBe('active');

    const rollbackUrl = `${apiBaseURL}/api/reference-releases/datasets/${datasetCode}/rollback`;
    const rolledBack = await request.post(rollbackUrl, { headers: auth });
    expect(rolledBack.status(), await rolledBack.text()).toBe(200);
    const rollback = (await rolledBack.json()).data;
    expect(rollback.rolledBack).toBe(true);
    expect(rollback.activeReleaseId).toBe(firstReleaseId);
    expect(rollback.rolledBackReleaseId).toBe(secondReleaseId);

    const rolledBackRelease = await findReferenceRelease(secondReleaseId);
    expect(rolledBackRelease!.releaseStatus).toBe('rolled_back');
    expect(rolledBackRelease!.rollbackTargetId).toBe(firstReleaseId);
    expect((await findReferenceRelease(firstReleaseId))!.releaseStatus).toBe('active');
    const firstRuns = await referenceImportRunsForRelease(firstReleaseId);
    expect(firstRuns.some((run) => run.importMode === 'rollback' && run.runStatus === 'rolled_back')).toBe(true);
    expect(await findAuditLog('ROLLBACK', secondReleaseId)).not.toBeNull();

    const rollbackAgain = await request.post(rollbackUrl, { headers: auth });
    expect(rollbackAgain.status(), await rollbackAgain.text()).toBe(409);
    expect((await rollbackAgain.json()).error).toBe('no_previous_release');
  });

  test('a release whose coverage leaves a gap no exclusion explains is refused promotion (RF028 AC7, RNF032 AC7)', async ({ request }) => {
    const gapCode = `E2E_RF028_GAP_${suffix}`;
    const gapSystemUri = `urn:bioavanced:e2e:${gapCode}`;
    // A duplicated code consumes a row and stages nothing new, with no issue.
    const response = await postReferenceImportSupport(request, 'run', {
      datasetCode: gapCode,
      datasetVersion: 'e2e-v1',
      records: [HPO_SAMPLE_RECORDS[0], HPO_SAMPLE_RECORDS[1], HPO_SAMPLE_RECORDS[2], HPO_SAMPLE_RECORDS[1]],
    });
    expect(response.status(), await response.text()).toBe(200);
    const { data } = await response.json();
    expect(data.approved).toBe(true);

    const release = await findReferenceRelease(data.releaseId);
    expect(release!.releaseStatus).toBe('approved');
    const manifest = await findReferenceCoverageManifest(release!.coverageManifestId);
    expect(manifest!.expectedCount).toBe(4);
    expect(manifest!.obtainedCount).toBe(3);
    expect(manifest!.coverageResult).toBe('incomplete');
    const assessment = await findDataQualityAssessment(release!.dataQualityAssessmentId);
    expect(assessment!.status).toBe('failed');

    const admin = await realLogin(request);
    const promoted = await request.post(`${apiBaseURL}/api/reference-releases/${data.releaseId}/promote`, {
      headers: { Authorization: `Bearer ${admin.token}` },
    });
    expect(promoted.status(), await promoted.text()).toBe(409);
    expect((await promoted.json()).error).toBe('coverage_incomplete');
    expect((await findReferenceRelease(data.releaseId))!.releaseStatus).toBe('approved');
    expect(await countTerminologyConceptsBySystemUri(gapSystemUri)).toBe(0);
  });
});

// RF029 slice 1/6 (#669): the ingestion gateway foundation — no entity slice
// (#670-673) has a real route wired to it yet, so
// interface/routes/ingestionTestSupport.routes.js's test-support-only
// /api/_test-support/ingestion/probe (NODE_ENV+shared-secret gated, same
// shape as iot.routes.js's telemetry-monitor routes) is this milestone's own
// real-backend trigger — same rationale interop-monitoring.spec.ts already
// uses for triggerMonitorCycle. Exercises the real ingestRecord() (real
// Mongo reads/writes, no faked behavior): missing provenance -> quarantine,
// a resolving reference + an active code (HPO's bootstrapped HP:0000001,
// same fixture the RF028 AC9 block above already relies on) -> accepted,
// and a repeated idempotencyKey -> replay without a second quarantine row.
// Shared by every RF029 slice's describe block below (slice 1's own
// generic proof plus each entity slice's) — the probe route itself is
// entity-agnostic, so one helper covers all of them.
// #722: the two tests below that assert `accepted` do so with
// HP:0000001, the Foundation Data Pipeline bootstrap's own bundled root HPO
// concept. That is a deliberate choice -- it is backed by a real, non-
// fabricated ReferenceDatasetRelease, unlike a hand-seeded concept doc --
// but it is only true on a stack where the reference-data bootstrap chain
// has actually run. That chain is a separate, much more expensive set of
// one-shot services (compose.test.yml's `reference-data-bootstrap-*-test`)
// and is NOT part of the core bring-up recipe.
//
// Without it these tests failed as `expected 'accepted', received
// 'quarantined'`, which reads as a regression in the ingestion gateway and
// was briefly mistaken for one during #674's verification. The dependency
// is real and worth keeping; what was missing is it being *stated*.
//
// Deliberately NOT solved by seeding a fixture release for HPO:
// seedActiveTerminologyConcept supersedes whatever release is currently
// active for its datasetCode, and #745 is the incident where doing exactly
// that against a bootstrapped stack left HPO with zero active releases
// permanently on a persistent volume -- breaking this very block. Asserting
// the precondition is safe; manufacturing it is not.
async function assertReferenceDataBootstrapped(datasetCode = 'HPO') {
  const active = await countActiveReferenceDatasetReleasesByDatasetCode(datasetCode);
  const hint = [
    `RF029 ingestion probes need an active ${datasetCode} ReferenceDatasetRelease; this stack has ${active}.`,
    'The reference-data bootstrap chain has not been run against these volumes.',
    'This is an environment gap, not a regression in the ingestion gateway.',
    'Bring the chain up with a single compose command naming every',
    "reference-data-bootstrap-*-test service (grep compose.test.yml for",
    "'^  reference-data-bootstrap' for the current list); each exits 0 in ~1-2 min.",
    'See #722.',
  ].join(' ');
  expect(active, hint).toBeGreaterThan(0);
}

async function probeIngestionGateway(request: import('@playwright/test').APIRequestContext, body: Record<string, unknown>) {
  const response = await request.post(`${apiBaseURL}/api/_test-support/ingestion/probe`, {
    headers: { 'x-test-support-secret': process.env.TEST_SUPPORT_SECRET ?? '' },
    data: body,
  });
  expect(response.ok()).toBe(true);
  return response.json();
}

test.describe('Ingestion gateway foundation (RF029 slice 1/6) — real backend', () => {
  test.afterAll(async () => {
    await closeSeedDb();
    await closeIngestionDb();
  });

  test('a record with no provenance envelope is quarantined, not silently accepted or corrected', async ({ request }) => {
    const outcome = await probeIngestionGateway(request, {
      entityType: 'IngestionFoundationProbe',
      payload: { probe: 'missing-provenance' },
      provenance: {},
    });

    expect(outcome.status).toBe('quarantined');
    expect(outcome.violations.some((v: { code: string }) => v.code === 'PROVENANCE_FIELD_MISSING')).toBe(true);

    const persisted = await findIngestionQuarantineRecord(outcome.quarantineRecord.ingestionQuarantineRecordId);
    expect(persisted).toBeTruthy();
    expect(persisted.resolutionStatus).toBe('open');
  });

  test('a record whose reference and reference code both resolve against real data is accepted', async ({ request }) => {
    const admin = await realLogin(request);
    const participant = await createRealParticipant(request, apiBaseURL!, admin.token);

    await assertReferenceDataBootstrapped();

    const outcome = await probeIngestionGateway(request, {
      entityType: 'IngestionFoundationProbe',
      payload: { probe: 'accepted', participantId: participant.participantId },
      provenance: {
        sourceSystem: 'urn:system:pipeline-continuity-e2e',
        createdBy: 'Actor/e2e-suite',
        retrievedAt: new Date().toISOString(),
        purpose: 'e2e_proof',
      },
      references: [{ collection: 'patients', field: 'participantId', value: participant.participantId, label: 'participantId' }],
      // HP:0000001 ("All"): the Foundation Data Pipeline bootstrap's own
      // bundled fixture root concept, same one the RF028 AC9 block above
      // waits for in Neo4j — guaranteed active with a real, non-fabricated
      // ReferenceDatasetRelease behind it, unlike a hand-seeded concept doc.
      // Its precondition is asserted above (#722).
      referenceCodes: [{ systemUri: 'http://purl.obolibrary.org/obo/hp.owl', code: 'HP:0000001', label: 'probeCode' }],
    });

    expect(outcome.status).toBe('accepted');
    expect(outcome.violations).toEqual([]);
  });

  test('a repeated idempotencyKey replays the first outcome instead of quarantining a second time', async ({ request }) => {
    const idempotencyKey = `rf029-e2e-${Date.now()}`;
    const body = {
      entityType: 'IngestionFoundationProbe',
      payload: { probe: 'idempotency' },
      provenance: {},
      idempotencyKey,
    };

    const first = await probeIngestionGateway(request, body);
    expect(first.status).toBe('quarantined');

    const second = await probeIngestionGateway(request, body);
    expect(second.status).toBe('idempotent_replay');
    expect(second.resultRef).toBe(first.quarantineRecord.ingestionQuarantineRecordId);

    const keyDoc = await findIngestionIdempotencyKey(idempotencyKey, 'IngestionFoundationProbe');
    expect(keyDoc?.status).toBe('completed');

    const quarantineCount = await countIngestionQuarantineRecordsByIdempotencyKey(idempotencyKey);
    expect(quarantineCount).toBe(1);
  });
});

// RF029 slice 2/6 (#670): wires participants/consents/specimens/clinical
// data through slice 1's generic gateway, proving it against their real
// canonical.v1 schemas and real reference data — not the synthetic
// IngestionFoundationProbe shape slice 1's own tests used. Scope note (see
// #670's own scope-correction comment): this does NOT add new production
// ingestion routes or persist through the gateway — the app's existing
// creation paths (POST /api/patients, /api/e-consent/consents, intake-
// wizard) are untouched, same "leave the existing path alone" call #669
// made for intakeWizard.js itself. "Clinical data" has no standalone
// entity yet (dict-02's 10-entity "Dados clínicos" domain is unbuilt,
// tracked as #677) — canonical.v1.clinicalData (newly extracted from
// intakeSchema's own inline shape, contracts/canonical/v1/index.js) proves
// the gateway's contract+reference validation for it regardless.
test.describe('Ingestion gateway — participants, consents, specimens, clinical data (RF029 slice 2/6) — real backend', () => {
  test.afterAll(async () => {
    await closeSeedDb();
    await closeIngestionDb();
  });

  function provenance() {
    return {
      sourceSystem: 'urn:system:pipeline-continuity-e2e',
      createdBy: 'Actor/e2e-suite',
      retrievedAt: new Date().toISOString(),
      purpose: 'e2e_proof',
    };
  }

  test('a participant payload matching canonical.v1.participant is accepted', async ({ request }) => {
    const outcome = await probeIngestionGateway(request, {
      entityType: 'Participant',
      schemaId: 'canonical.v1.participant',
      payload: { participantId: `rf029-e2e-participant-${Date.now()}` },
      provenance: provenance(),
    });

    expect(outcome.status).toBe('accepted');
    expect(outcome.violations).toEqual([]);
  });

  // sampleID is routes/intakeWizard.js's own documented legacy alias for
  // specimenId (collectCanonicalViolations' aliasMap) — proving the
  // generalized alias check (ingestion/canonicalGateway.js) rejects it
  // too, for a real entity type beyond slice 1's own synthetic tests. No
  // real participant/reference needed here — this is isolating the alias
  // check itself, not the reference check.
  test('a specimen payload with a legacy alias field is quarantined, not silently normalized', async ({ request }) => {
    const outcome = await probeIngestionGateway(request, {
      entityType: 'Specimen',
      schemaId: 'canonical.v1.specimen',
      aliasMap: { specimenId: ['sampleID', 'sampleId', 'specimenID', 'mongoSampleId'] },
      payload: { sampleID: 'S-1', participantId: 'irrelevant-for-this-test' },
      provenance: provenance(),
    });

    expect(outcome.status).toBe('quarantined');
    expect(
      outcome.violations.some((v: { code: string; field: string }) => v.code === 'NON_CANONICAL_FIELD' && v.field === 'sampleID')
    ).toBe(true);
  });

  test('a specimen payload referencing a real participant, with a real active code, is accepted', async ({ request }) => {
    await assertReferenceDataBootstrapped();

    const admin = await realLogin(request);
    const participant = await createRealParticipant(request, apiBaseURL!, admin.token);

    const outcome = await probeIngestionGateway(request, {
      entityType: 'Specimen',
      schemaId: 'canonical.v1.specimen',
      payload: { specimenId: `rf029-e2e-specimen-${Date.now()}`, participantId: participant.participantId },
      provenance: provenance(),
      references: [{ collection: 'patients', field: 'participantId', value: participant.participantId, label: 'participantId' }],
      // Same bootstrapped HPO fixture the RF029 slice 1/6 block above uses
      // — proving active-code validation composes correctly for a real
      // entity type, not asserting HP:0000001 is semantically a SPREC code.
      referenceCodes: [{ systemUri: 'http://purl.obolibrary.org/obo/hp.owl', code: 'HP:0000001', label: 'probeCode' }],
    });

    expect(outcome.status).toBe('accepted');
    expect(outcome.violations).toEqual([]);
  });

  test('a consent payload referencing a nonexistent participant is quarantined', async ({ request }) => {
    const outcome = await probeIngestionGateway(request, {
      entityType: 'Consent',
      schemaId: 'canonical.v1.consent',
      payload: { consentTemplateId: 'rf029-e2e-template-x', consentGranted: true },
      provenance: provenance(),
      references: [{ collection: 'patients', field: 'participantId', value: 'rf029-e2e-nonexistent-participant', label: 'participantId' }],
    });

    expect(outcome.status).toBe('quarantined');
    expect(outcome.violations.some((v: { code: string }) => v.code === 'REFERENCE_NOT_FOUND')).toBe(true);
  });

  test('a consent payload referencing a real participant is accepted', async ({ request }) => {
    const admin = await realLogin(request);
    const participant = await createRealParticipant(request, apiBaseURL!, admin.token);

    const outcome = await probeIngestionGateway(request, {
      entityType: 'Consent',
      schemaId: 'canonical.v1.consent',
      payload: { consentTemplateId: participant.consentTemplateId, consentGranted: true },
      provenance: provenance(),
      references: [{ collection: 'patients', field: 'participantId', value: participant.participantId, label: 'participantId' }],
    });

    expect(outcome.status).toBe('accepted');
    expect(outcome.violations).toEqual([]);
  });

  test('a clinical data payload referencing a real participant is accepted', async ({ request }) => {
    const admin = await realLogin(request);
    const participant = await createRealParticipant(request, apiBaseURL!, admin.token);

    const outcome = await probeIngestionGateway(request, {
      entityType: 'ClinicalData',
      schemaId: 'canonical.v1.clinicalData',
      payload: { participantId: participant.participantId, bloodPressure: '120/80' },
      provenance: provenance(),
      references: [{ collection: 'patients', field: 'participantId', value: participant.participantId, label: 'participantId' }],
    });

    expect(outcome.status).toBe('accepted');
    expect(outcome.violations).toEqual([]);
  });

  test('a clinical data payload with an unknown field is quarantined', async ({ request }) => {
    const outcome = await probeIngestionGateway(request, {
      entityType: 'ClinicalData',
      schemaId: 'canonical.v1.clinicalData',
      payload: { unknownField: 'x' },
      provenance: provenance(),
    });

    expect(outcome.status).toBe('quarantined');
    expect(outcome.violations.some((v: { code: string }) => v.code === 'CONTRACT_VIOLATION')).toBe(true);
  });
});

// RF029 slice 3/6 (#671): wires telemetry through slice 1's gateway, same
// probe-only pattern slice 2 established (no new production ingestion
// routes — RF009's real POST /api/iot/telemetry stays untouched). AC#7
// ("telemetria de alta frequência no InfluxDB") is not re-proven here: it's
// already covered by interop-monitoring.spec.ts's "persists a valid reading
// to InfluxDB, tagged by sensorId" case, which posts to that same real
// endpoint and reads the point back from a real InfluxDB bucket — this
// block only proves the new envelope/contract/reference machinery around
// telemetry payloads, per AC#1-3/AC#5.
test.describe('Ingestion gateway — telemetry (RF029 slice 3/6) — real backend', () => {
  test.afterAll(async () => {
    await closeSeedSensorDb();
  });

  function provenance() {
    return {
      sourceSystem: 'urn:system:pipeline-continuity-e2e',
      createdBy: 'Actor/e2e-suite',
      retrievedAt: new Date().toISOString(),
      purpose: 'e2e_proof',
    };
  }

  test('a telemetry payload referencing a real sensor and device is accepted', async ({ request }) => {
    const sensor = await seedSensorWithPolicy(2, 8);

    const outcome = await probeIngestionGateway(request, {
      entityType: 'Telemetry',
      schemaId: 'canonical.v1.telemetry',
      payload: {
        sensorId: sensor.sensorId,
        equipmentId: sensor.deviceId,
        metricType: 'temperature',
        timestamp: new Date().toISOString(),
        value: 4.5,
        unit: 'Cel',
      },
      provenance: provenance(),
      references: [
        { collection: 'sensorMetadata', field: 'sensorId', value: sensor.sensorId, label: 'sensorId' },
        { collection: 'devices', field: 'deviceId', value: sensor.deviceId, label: 'equipmentId' },
      ],
    });

    expect(outcome.status).toBe('accepted');
    expect(outcome.violations).toEqual([]);
  });

  // RF009's real POST /api/iot/telemetry body shape -- {sensorId,
  // temperature, timestamp} -- uses `temperature` where the canonical
  // contract requires an explicit `value`. Same alias-discipline slice 2's
  // specimen test proved for sampleID -> specimenId, applied to telemetry's
  // own legacy field name.
  test('a telemetry payload using the legacy `temperature` field instead of canonical `value` is quarantined', async ({
    request,
  }) => {
    const sensor = await seedSensorWithPolicy(2, 8);

    const outcome = await probeIngestionGateway(request, {
      entityType: 'Telemetry',
      schemaId: 'canonical.v1.telemetry',
      aliasMap: { value: ['temperature'] },
      payload: { sensorId: sensor.sensorId, temperature: 4.5, timestamp: new Date().toISOString() },
      provenance: provenance(),
    });

    expect(outcome.status).toBe('quarantined');
    expect(
      outcome.violations.some((v: { code: string; field: string }) => v.code === 'NON_CANONICAL_FIELD' && v.field === 'temperature')
    ).toBe(true);
  });

  test('a telemetry payload referencing a nonexistent sensor is quarantined', async ({ request }) => {
    const outcome = await probeIngestionGateway(request, {
      entityType: 'Telemetry',
      schemaId: 'canonical.v1.telemetry',
      payload: {
        sensorId: 'rf029-e2e-nonexistent-sensor',
        metricType: 'temperature',
        timestamp: new Date().toISOString(),
        value: 4.5,
        unit: 'Cel',
      },
      provenance: provenance(),
      references: [
        { collection: 'sensorMetadata', field: 'sensorId', value: 'rf029-e2e-nonexistent-sensor', label: 'sensorId' },
      ],
    });

    expect(outcome.status).toBe('quarantined');
    expect(outcome.violations.some((v: { code: string }) => v.code === 'REFERENCE_NOT_FOUND')).toBe(true);
  });

  test('a telemetry payload with an unknown field is quarantined', async ({ request }) => {
    const outcome = await probeIngestionGateway(request, {
      entityType: 'Telemetry',
      schemaId: 'canonical.v1.telemetry',
      payload: { sensorId: 'irrelevant-for-this-test', unknownField: 'x' },
      provenance: provenance(),
    });

    expect(outcome.status).toBe('quarantined');
    expect(outcome.violations.some((v: { code: string }) => v.code === 'CONTRACT_VIOLATION')).toBe(true);
  });
});

// RF029 slice 4/6 (#672): wires scientific-file binaries through slice 1's
// gateway, same probe-only pattern slices 2-3 established (no new
// production ingestion routes — RF007's real file-upload path,
// sample-file.controller.js, stays untouched). AC#7 ("binários no Object
// Storage") is not re-proven here: scientific-data-access.spec.ts already
// covers real objstore:// persistence, checksum, and encryption-at-rest
// against that same real upload path — this block only proves the new
// envelope/contract/reference machinery around a canonical file payload.
test.describe('Ingestion gateway — files (RF029 slice 4/6) — real backend', () => {
  test.afterAll(async () => {
    await closeSeedDb();
  });

  function provenance() {
    return {
      sourceSystem: 'urn:system:pipeline-continuity-e2e',
      createdBy: 'Actor/e2e-suite',
      retrievedAt: new Date().toISOString(),
      purpose: 'e2e_proof',
    };
  }

  test('a file payload referencing a real specimen is accepted', async ({ request }) => {
    const specimenId = `rf029-e2e-specimen-${Date.now()}`;
    await seedRawSpecimen(specimenId);

    const outcome = await probeIngestionGateway(request, {
      entityType: 'File',
      schemaId: 'canonical.v1.file',
      payload: {
        fileId: `rf029-e2e-file-${Date.now()}`,
        specimenId,
        fileRole: 'raw',
        fileUri: `objstore://samples/${specimenId}/files/report.pdf`,
        fileFormat: 'PDF',
        fileSizeBytes: 102400,
        checksum: 'sha256:e2e-fixture-checksum',
      },
      provenance: provenance(),
      references: [{ collection: 'samples', field: 'specimenId', value: specimenId, label: 'specimenId' }],
    });

    expect(outcome.status).toBe('accepted');
    expect(outcome.violations).toEqual([]);
  });

  // SampleFile.js's real field is `storageUri`, not the canonical `fileUri`
  // -- same alias-discipline slice 2's specimen test proved for sampleID ->
  // specimenId, and slice 3's telemetry test proved for temperature -> value.
  test('a file payload using the legacy `storageUri` field instead of canonical `fileUri` is quarantined', async ({
    request,
  }) => {
    const outcome = await probeIngestionGateway(request, {
      entityType: 'File',
      schemaId: 'canonical.v1.file',
      aliasMap: { fileUri: ['storageUri'] },
      payload: {
        fileId: `rf029-e2e-file-${Date.now()}`,
        storageUri: 'objstore://samples/irrelevant/files/report.pdf',
        checksum: 'sha256:e2e-fixture-checksum',
      },
      provenance: provenance(),
    });

    expect(outcome.status).toBe('quarantined');
    expect(
      outcome.violations.some((v: { code: string; field: string }) => v.code === 'NON_CANONICAL_FIELD' && v.field === 'storageUri')
    ).toBe(true);
  });

  test('a file payload referencing a nonexistent specimen is quarantined', async ({ request }) => {
    const outcome = await probeIngestionGateway(request, {
      entityType: 'File',
      schemaId: 'canonical.v1.file',
      payload: {
        fileId: `rf029-e2e-file-${Date.now()}`,
        specimenId: 'rf029-e2e-nonexistent-specimen',
        fileUri: 'objstore://samples/rf029-e2e-nonexistent-specimen/files/report.pdf',
        fileSizeBytes: 102400,
        checksum: 'sha256:e2e-fixture-checksum',
      },
      provenance: provenance(),
      references: [
        { collection: 'samples', field: 'specimenId', value: 'rf029-e2e-nonexistent-specimen', label: 'specimenId' },
      ],
    });

    expect(outcome.status).toBe('quarantined');
    expect(outcome.violations.some((v: { code: string }) => v.code === 'REFERENCE_NOT_FOUND')).toBe(true);
  });

  test('a file payload with an unknown field is quarantined', async ({ request }) => {
    const outcome = await probeIngestionGateway(request, {
      entityType: 'File',
      schemaId: 'canonical.v1.file',
      payload: { fileId: 'irrelevant-for-this-test', unknownField: 'x' },
      provenance: provenance(),
    });

    expect(outcome.status).toBe('quarantined');
    expect(outcome.violations.some((v: { code: string }) => v.code === 'CONTRACT_VIOLATION')).toBe(true);
  });
});

// RF029 slice 5/6 (#673): wires Assay/Dataset through slice 1's gateway,
// same probe-only pattern slices 2-4 established (no new production
// ingestion routes — the existing /api/assays and /api/datasets
// master-data routes, createMasterDataRouter, stay untouched). #664
// (Assay's specimen/protocol/operator/laboratory/reagentLot/equipment
// links are format-only, no referential-integrity check on the real
// route) stays open and unaddressed here — this block only proves the
// gateway's own generic reference-checking machinery works for a
// studyId, via the one reference this slice's fixtures can cheaply seed
// (the existing seedStudy helper); it does not close #664's broader gap
// across all six of Assay's own link fields, and does not touch
// createMasterDataRouter at all, per #664's own "bigger than one slice"
// scope note.
test.describe('Ingestion gateway — datasets, assays (RF029 slice 5/6) — real backend', () => {
  test.afterAll(async () => {
    await closeSeedDb();
  });

  function provenance() {
    return {
      sourceSystem: 'urn:system:pipeline-continuity-e2e',
      createdBy: 'Actor/e2e-suite',
      retrievedAt: new Date().toISOString(),
      purpose: 'e2e_proof',
    };
  }

  test('an assay payload referencing a real study is accepted', async ({ request }) => {
    const studyId = `rf029-e2e-study-${Date.now()}`;
    await seedStudy(studyId);

    const outcome = await probeIngestionGateway(request, {
      entityType: 'Assay',
      schemaId: 'canonical.v1.assay',
      payload: {
        studyId,
        specimenIds: [`rf029-e2e-specimen-${Date.now()}`],
        assayType: 'RNA sequencing',
        protocolId: `rf029-e2e-protocol-${Date.now()}`,
        operatorId: `rf029-e2e-operator-${Date.now()}`,
        laboratoryId: `rf029-e2e-lab-${Date.now()}`,
        assayDateTime: new Date().toISOString(),
        intendedUse: 'RNA-seq discovery',
      },
      provenance: provenance(),
      references: [{ collection: 'studies', field: 'studyId', value: studyId, label: 'studyId' }],
    });

    expect(outcome.status).toBe('accepted');
    expect(outcome.violations).toEqual([]);
  });

  test('an assay payload referencing a nonexistent study is quarantined', async ({ request }) => {
    const outcome = await probeIngestionGateway(request, {
      entityType: 'Assay',
      schemaId: 'canonical.v1.assay',
      payload: {
        studyId: 'rf029-e2e-nonexistent-study',
        specimenIds: [`rf029-e2e-specimen-${Date.now()}`],
        assayType: 'RNA sequencing',
        protocolId: `rf029-e2e-protocol-${Date.now()}`,
        operatorId: `rf029-e2e-operator-${Date.now()}`,
        laboratoryId: `rf029-e2e-lab-${Date.now()}`,
        assayDateTime: new Date().toISOString(),
        intendedUse: 'RNA-seq discovery',
      },
      provenance: provenance(),
      references: [{ collection: 'studies', field: 'studyId', value: 'rf029-e2e-nonexistent-study', label: 'studyId' }],
    });

    expect(outcome.status).toBe('quarantined');
    expect(outcome.violations.some((v: { code: string }) => v.code === 'REFERENCE_NOT_FOUND')).toBe(true);
  });

  test('an assay payload with an empty specimenIds array is quarantined', async ({ request }) => {
    const outcome = await probeIngestionGateway(request, {
      entityType: 'Assay',
      schemaId: 'canonical.v1.assay',
      payload: {
        studyId: 'irrelevant-for-this-test',
        specimenIds: [],
        assayType: 'RNA sequencing',
        protocolId: 'irrelevant-for-this-test',
        operatorId: 'irrelevant-for-this-test',
        laboratoryId: 'irrelevant-for-this-test',
        assayDateTime: new Date().toISOString(),
        intendedUse: 'RNA-seq discovery',
      },
      provenance: provenance(),
    });

    expect(outcome.status).toBe('quarantined');
    expect(outcome.violations.some((v: { code: string }) => v.code === 'CONTRACT_VIOLATION')).toBe(true);
  });

  test('a dataset payload with the required fields is accepted, no reference needed', async ({ request }) => {
    const outcome = await probeIngestionGateway(request, {
      entityType: 'Dataset',
      schemaId: 'canonical.v1.dataset',
      payload: {
        datasetTitle: `RF029 e2e dataset ${Date.now()}`,
        datasetVersion: '1.0.0',
        creators: [{ name: 'RF029 e2e suite' }],
        license: 'CC BY 4.0',
      },
      provenance: provenance(),
    });

    expect(outcome.status).toBe('accepted');
    expect(outcome.violations).toEqual([]);
  });

  test('a dataset payload with an empty creators array is quarantined', async ({ request }) => {
    const outcome = await probeIngestionGateway(request, {
      entityType: 'Dataset',
      schemaId: 'canonical.v1.dataset',
      payload: {
        datasetTitle: `RF029 e2e dataset ${Date.now()}`,
        datasetVersion: '1.0.0',
        creators: [],
        license: 'CC BY 4.0',
      },
      provenance: provenance(),
    });

    expect(outcome.status).toBe('quarantined');
    expect(outcome.violations.some((v: { code: string }) => v.code === 'CONTRACT_VIOLATION')).toBe(true);
  });
});

// RF029 slice 6/6 (#674): wires WorkflowRun/OmicsQualification/OmicsRun
// (RF027, #716) through slice 1's gateway, same probe-only pattern
// slices 2-5 established — no new production ingestion routes, the
// existing /api/workflow-runs, /api/omics-qualifications and
// /api/omics-runs master-data routes stay untouched. workflowSchema has
// no reference field (workflowId/workflowVersion aren't rows in an
// existing collection — see contracts/canonical/v1's own comment), so
// this block's Workflow tests only cover accept/contract-violation, the
// same shape #673 used for Dataset's own no-reference-field case.
// omicsQualificationSchema's targetAssay is this slice's one
// FK-shaped/cheaply-seedable reference (via the new seedAssay helper,
// same "one reference this slice's fixtures can cheaply seed" scope
// #673 applied to Assay's own studyId) — omicsRunSchema's fileLinks
// stays unreferenced for the same cross-collection-resolution reason as
// canonical.v1.file's own out-of-scope note.
test.describe('Ingestion gateway — workflows, omics data (RF029 slice 6/6) — real backend', () => {
  test.afterAll(async () => {
    await closeSeedDb();
  });

  function provenance() {
    return {
      sourceSystem: 'urn:system:pipeline-continuity-e2e',
      createdBy: 'Actor/e2e-suite',
      retrievedAt: new Date().toISOString(),
      purpose: 'e2e_proof',
    };
  }

  test('a workflow payload with the required fields is accepted, no reference needed', async ({ request }) => {
    const outcome = await probeIngestionGateway(request, {
      entityType: 'WorkflowRun',
      schemaId: 'canonical.v1.workflow',
      payload: {
        workflowId: 'rf029-e2e-variant-calling-pipeline',
        workflowVersion: '2.3.1',
        createdBy: 'User/e2e-suite',
        startedAt: new Date().toISOString(),
        runStatus: 'succeeded',
        hardwareProfile: { cpu: 'synthetic' },
        environmentManifestUri: 'object://synthetic/environment.json',
      },
      provenance: provenance(),
    });

    expect(outcome.status).toBe('accepted');
    expect(outcome.violations).toEqual([]);
  });

  test('a workflow payload missing createdBy is quarantined (AC#4)', async ({ request }) => {
    const outcome = await probeIngestionGateway(request, {
      entityType: 'WorkflowRun',
      schemaId: 'canonical.v1.workflow',
      payload: {
        workflowId: 'rf029-e2e-variant-calling-pipeline',
        workflowVersion: '2.3.1',
        startedAt: new Date().toISOString(),
        runStatus: 'succeeded',
        hardwareProfile: { cpu: 'synthetic' },
        environmentManifestUri: 'object://synthetic/environment.json',
      },
      provenance: provenance(),
    });

    expect(outcome.status).toBe('quarantined');
    expect(outcome.violations.some((v: { code: string }) => v.code === 'CONTRACT_VIOLATION')).toBe(true);
  });

  test('an omics qualification payload referencing a real assay is accepted', async ({ request }) => {
    const assayId = `rf029-e2e-assay-${Date.now()}`;
    await seedAssay(assayId);

    const outcome = await probeIngestionGateway(request, {
      entityType: 'OmicsQualification',
      schemaId: 'canonical.v1.omicsQualification',
      payload: {
        targetAssay: assayId,
        qcRuleSetVersion: 'v2.1',
        qcMetrics: [{ metric: 'readDepth', value: 30 }],
        qualificationDecision: 'eligible',
      },
      provenance: provenance(),
      references: [{ collection: 'assays', field: 'assayId', value: assayId, label: 'targetAssay' }],
    });

    expect(outcome.status).toBe('accepted');
    expect(outcome.violations).toEqual([]);
  });

  test('an omics qualification payload referencing a nonexistent assay is quarantined', async ({ request }) => {
    const outcome = await probeIngestionGateway(request, {
      entityType: 'OmicsQualification',
      schemaId: 'canonical.v1.omicsQualification',
      payload: {
        targetAssay: 'rf029-e2e-nonexistent-assay',
        qcRuleSetVersion: 'v2.1',
        qcMetrics: [{ metric: 'readDepth', value: 30 }],
        qualificationDecision: 'eligible',
      },
      provenance: provenance(),
      references: [{ collection: 'assays', field: 'assayId', value: 'rf029-e2e-nonexistent-assay', label: 'targetAssay' }],
    });

    expect(outcome.status).toBe('quarantined');
    expect(outcome.violations.some((v: { code: string }) => v.code === 'REFERENCE_NOT_FOUND')).toBe(true);
  });

  test('an omics qualification payload with an empty qcMetrics array is quarantined', async ({ request }) => {
    const outcome = await probeIngestionGateway(request, {
      entityType: 'OmicsQualification',
      schemaId: 'canonical.v1.omicsQualification',
      payload: {
        targetAssay: 'irrelevant-for-this-test',
        qcRuleSetVersion: 'v2.1',
        qcMetrics: [],
        qualificationDecision: 'eligible',
      },
      provenance: provenance(),
    });

    expect(outcome.status).toBe('quarantined');
    expect(outcome.violations.some((v: { code: string }) => v.code === 'CONTRACT_VIOLATION')).toBe(true);
  });

  test('an omics run payload with a valid modality is accepted, no reference needed', async ({ request }) => {
    const outcome = await probeIngestionGateway(request, {
      entityType: 'OmicsRun',
      schemaId: 'canonical.v1.omicsRun',
      payload: {
        modality: 'genomics',
        referenceAssembly: 'GRCh38',
        fileLinks: [],
      },
      provenance: provenance(),
    });

    expect(outcome.status).toBe('accepted');
    expect(outcome.violations).toEqual([]);
  });

  test('an omics run payload with an invalid modality is quarantined', async ({ request }) => {
    const outcome = await probeIngestionGateway(request, {
      entityType: 'OmicsRun',
      schemaId: 'canonical.v1.omicsRun',
      payload: {
        modality: 'astrology',
      },
      provenance: provenance(),
    });

    expect(outcome.status).toBe('quarantined');
    expect(outcome.violations.some((v: { code: string }) => v.code === 'CONTRACT_VIOLATION')).toBe(true);
  });
});

// RF013 (Backup e restauração) — Wave 4 kickoff (#723). backup.routes.js /
// backup.service.js already existed (manual perform, list, live restore);
// #723's docker-free sittings added the pieces the criteria needed
// (run-history + checksum, the sandboxed restore test #727, the audited
// BackupPolicy entity #728). This block proves the whole thing end to end
// against the real stack. Since #738 the backend image installs
// mongodb-tools, so a backup takes the intended mongodump path rather than
// the JSON fallback -- which means the backend image must be rebuilt
// (`--build`) for this block to pass, and a `json-fallback` mode here is a
// real signal that it wasn't.
test.describe('Backup and restore (RF013) — real backend', () => {
  test.afterAll(async () => {
    await closeNeo4jDriver();
  });

  async function listDatabaseNames(): Promise<string[]> {
    const client = new MongoClient(process.env.E2E_MONGO_URI || 'mongodb://localhost:27017?directConnection=true');
    try {
      await client.connect();
      const result = await client.db().admin().listDatabases();
      return result.databases.map((entry) => entry.name);
    } finally {
      await client.close();
    }
  }

  async function performBackup(request: any, token: string) {
    const response = await request.post(`${apiBaseURL}/api/backup/perform`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(response.status(), await response.text()).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    // #738: mongodump is now present in the image, so the fallback must not
    // be what runs. The fallback is no longer lossy either (it serializes
    // with canonical Extended JSON), but it is still the degraded path.
    expect(body.data.mode, 'backend image is missing mongodb-tools -- rebuild it').toBe('mongodump');
    expect(body.data.path).toBeTruthy();
    const fileName = String(body.data.path).split(/[\\/]/).pop()!;
    return { ...body.data, fileName };
  }

  async function listBackups(request: any, token: string) {
    const response = await request.get(`${apiBaseURL}/api/backup/list`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(response.status(), await response.text()).toBe(200);
    return (await response.json()).data as Array<{
      fileName: string;
      size: number;
      createdAt: string;
      status: string | null;
      checksum: string | null;
    }>;
  }

  // AC#2 (manual, authorized execution), AC#3 (checksum + completion
  // evidence) and AC#1 (state/date/result of executions surfaced) in one
  // real run: the checksum the run reports is the one the persisted
  // backupHistory record carries back through /list, alongside the run's
  // status -- not just a directory name on disk.
  test('an authorized manual backup records checksum + completion evidence and is listed with its state and result (AC#1, AC#2, AC#3)', async ({
    request,
  }) => {
    const admin = await realLogin(request);
    const watch = await watchAuditTrail(request, apiBaseURL!, admin.token);

    const run = await performBackup(request, admin.token);
    expect(run.checksum).toMatch(/^[0-9a-f]{64}$/);

    const listed = (await listBackups(request, admin.token)).find((entry) => entry.fileName === run.fileName);
    expect(listed, `backup ${run.fileName} missing from /list`).toBeTruthy();
    expect(listed!.status).toBe('success');
    expect(listed!.checksum).toBe(run.checksum);
    expect(listed!.size).toBeGreaterThan(0);
    expect(new Date(listed!.createdAt).getTime()).toBeGreaterThan(0);

    // The manual execution itself is on the audit trail (global
    // auditRequest middleware, POST /api/backup/perform).
    await assertAuditEventRecorded(request, apiBaseURL!, admin.token, watch);
  });

  // AC#4: "Permitir teste controlado de restauração." The controlled path
  // (#727) verifies the backup's own checksum against its manifest, restores
  // into a disposable `<db>_restoretest_<ts>` database and drops it -- the
  // live database is never the target. Proven three ways: the response
  // reports checksumVerified + the scratch name, the scratch database is
  // gone afterwards (direct Mongo listDatabases), and a document written to
  // the live database *after* the backup survives the restore test (a live
  // --drop / deleteMany restore of that backup would have erased it).
  test('a controlled restore test verifies the checksum, restores into a scratch database and leaves the live data untouched (AC#4)', async ({
    request,
  }) => {
    const admin = await realLogin(request);
    const run = await performBackup(request, admin.token);

    const markerCode = `rf013_marker_${Date.now()}`;
    const marker = await request.post(`${apiBaseURL}/api/report-templates`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: { code: markerCode, name: 'RF013 post-backup marker', handlerKey: 'sample', templateStatus: 'active' },
    });
    expect(marker.status(), await marker.text()).toBe(201);
    const markerId = (await marker.json()).data._id;

    try {
      const restoreTest = await request.post(`${apiBaseURL}/api/backup/restore-test/${run.fileName}`, {
        headers: { Authorization: `Bearer ${admin.token}` },
      });
      expect(restoreTest.status(), await restoreTest.text()).toBe(200);
      const result = (await restoreTest.json()).data;
      expect(result.success).toBe(true);
      // RNF010 "validado por checksum": the manifest's stored digest matches
      // the recomputed one (was structurally never true before #742 --
      // computeDirChecksum now excludes the top-level manifest.json on both
      // the write and verify sides).
      expect(result.checksumVerified).toBe(true);
      expect(result.scratchDb).toMatch(/_restoretest_\d+$/);
      expect(result.scratchDb).not.toBe(process.env.E2E_MONGO_DB || 'bioavanced_test');
      expect(result.restoredCollections ?? result.collections).toBeGreaterThan(0);
      // #766: the collection count alone is satisfied by a restore that
      // creates every collection and populates none -- one step milder than
      // the #765 no-op this assertion originally caught, and the same class
      // of silent success. The document count is what distinguishes them.
      expect(result.restoredDocuments ?? result.documents).toBeGreaterThan(0);

      const databases = await listDatabaseNames();
      expect(databases).not.toContain(result.scratchDb);
      expect(databases.filter((name) => name.includes('_restoretest_'))).toEqual([]);

      const survivor = await request.get(`${apiBaseURL}/api/report-templates/${markerId}`, {
        headers: { Authorization: `Bearer ${admin.token}` },
      });
      expect(survivor.status(), await survivor.text()).toBe(200);
      expect((await survivor.json()).data.code).toBe(markerCode);
    } finally {
      await request.delete(`${apiBaseURL}/api/report-templates/${markerId}`, {
        headers: { Authorization: `Bearer ${admin.token}` },
      });
    }
  });

  // #1325 (RNF010 C1): the same run exports Neo4j and InfluxDB beside the
  // MongoDB dump, encrypted, and the folder's checksum covers their files,
  // so a restore test of it still verifies. Other writers may run during the
  // backup, so the counts are bounds, never equalities. The restore test
  // also decrypts and parses both exports (RNF010 C5), and its counts must
  // equal the backup run's exactly.
  test('a backup also exports Neo4j and InfluxDB, encrypted and covered by the checksum, and a restore test verifies them (#1325)', async ({
    request,
  }) => {
    const admin = await realLogin(request);

    const graphBefore = await countGraph();
    const pointsBefore = await countAllPoints();
    const run = await performBackup(request, admin.token);
    const graphAfter = await countGraph();
    const pointsAfter = await countAllPoints();

    const { neo4j, influxdb } = run.stores;
    expect(neo4j.status).toBe('exported');
    expect(neo4j.nodes).toBeGreaterThanOrEqual(graphBefore.nodes);
    expect(neo4j.nodes).toBeLessThanOrEqual(graphAfter.nodes);
    expect(neo4j.relationships).toBeGreaterThanOrEqual(graphBefore.relationships);
    expect(neo4j.relationships).toBeLessThanOrEqual(graphAfter.relationships);
    expect(influxdb.status).toBe('exported');
    expect(influxdb.points).toBeGreaterThanOrEqual(pointsBefore);
    expect(influxdb.points).toBeLessThanOrEqual(pointsAfter);

    const files = [...neo4j.files, ...influxdb.files];
    expect(files.map((entry: { file: string }) => entry.file)).toEqual([
      'neo4j/nodes.ndjson',
      'neo4j/relationships.ndjson',
      'neo4j/schema.json',
      'influxdb/points.ndjson',
    ]);
    for (const entry of files) {
      expect(entry.encrypted, entry.file).toBe(true);
    }

    const restoreTest = await request.post(`${apiBaseURL}/api/backup/restore-test/${run.fileName}`, {
      headers: { Authorization: `Bearer ${admin.token}` },
    });
    expect(restoreTest.status(), await restoreTest.text()).toBe(200);
    const result = (await restoreTest.json()).data;
    expect(result.success, result.error).toBe(true);
    expect(result.checksumVerified).toBe(true);
    expect(result.stores.neo4j.status, result.stores.neo4j.error).toBe('verified');
    expect(result.stores.neo4j.nodes).toBe(neo4j.nodes);
    expect(result.stores.neo4j.relationships).toBe(neo4j.relationships);
    expect(result.stores.influxdb.status, result.stores.influxdb.error).toBe('verified');
    expect(result.stores.influxdb.points).toBe(influxdb.points);
  });

  // AC#2's "autorizada": every backup operation is behind the manageBackup
  // permission (#632) and the policy behind hierarchyLevel 4 (#728) -- a
  // real Técnico session, not just a missing token, is refused by the
  // backend's own RBAC gate.
  test('backup operations and the backup policy are refused for a non-admin session (AC#2, AC#5)', async ({ request }) => {
    const admin = await realLogin(request);

    const unauthenticated = await request.post(`${apiBaseURL}/api/backup/perform`);
    expect(unauthenticated.status()).toBe(401);

    const username = `tecnico.rf013.${Date.now()}`;
    const password = 'Tecnico@123-forte';
    const registerResponse = await request.post(`${apiBaseURL}/api/users/register`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: {
        name: 'RF013 Técnico Fixture',
        email: `${username}@example.com`,
        username,
        password,
        accessType: 2,
        roleName: 'Técnico',
      },
    });
    expect(registerResponse.ok(), await registerResponse.text()).toBeTruthy();
    const tecnico = await completeFirstLoginMfa(request, apiBaseURL!, username, password);
    const headers = { Authorization: `Bearer ${tecnico.token}` };

    expect((await request.post(`${apiBaseURL}/api/backup/perform`, { headers })).status()).toBe(403);
    expect((await request.get(`${apiBaseURL}/api/backup/list`, { headers })).status()).toBe(403);
    expect((await request.post(`${apiBaseURL}/api/backup/restore-test/does-not-matter`, { headers })).status()).toBe(403);
    expect((await request.post(`${apiBaseURL}/api/backup/restore/does-not-matter`, { headers })).status()).toBe(403);
    expect((await request.get(`${apiBaseURL}/api/backup-policy`, { headers })).status()).toBe(403);
    expect((await request.put(`${apiBaseURL}/api/backup-policy`, { headers, data: { retentionDays: 45 } })).status()).toBe(403);
  });

  // AC#5: "Auditar alterações da política de backup." AC#6: frequency /
  // retention / encryption / RPO / RTO are policy fields (BackupPolicy,
  // #728) rather than static env vars; the retention value is what the
  // next runBackup resolves (resolveRetentionDays) and cronExpression
  // hot-reloads the scheduler. The audit expectation is >= 2 new events:
  // the generic request log the global middleware writes for the PUT, plus
  // the explicit UPDATE record backup-policy.service.js writes itself --
  // a plain request log alone would not satisfy "auditar alterações".
  test('a backup-policy change is validated, persisted and audited (AC#5, AC#6)', async ({ request }) => {
    const admin = await realLogin(request);
    const headers = { Authorization: `Bearer ${admin.token}` };

    const current = await request.get(`${apiBaseURL}/api/backup-policy`, { headers });
    expect(current.status(), await current.text()).toBe(200);
    const original = (await current.json()).data;
    expect(original.cronExpression).toBeTruthy();
    expect(Number(original.retentionDays)).toBeGreaterThanOrEqual(30);
    for (const field of ['encryptionEnabled', 'rpoHours', 'rtoHours']) {
      expect(original, `policy is missing ${field}`).toHaveProperty(field);
    }

    // RNF010 AC#4: retention below 30 days is rejected outright.
    const tooShort = await request.put(`${apiBaseURL}/api/backup-policy`, { headers, data: { retentionDays: 7 } });
    expect(tooShort.status(), await tooShort.text()).toBe(422);

    const newRetention = Number(original.retentionDays) + 1;
    const watch = await watchAuditTrail(request, apiBaseURL!, admin.token);
    try {
      const update = await request.put(`${apiBaseURL}/api/backup-policy`, {
        headers,
        data: { retentionDays: newRetention },
      });
      expect(update.status(), await update.text()).toBe(200);
      expect(Number((await update.json()).data.retentionDays)).toBe(newRetention);

      const reread = await request.get(`${apiBaseURL}/api/backup-policy`, { headers });
      expect(Number((await reread.json()).data.retentionDays)).toBe(newRetention);

      await assertAuditEventRecorded(request, apiBaseURL!, admin.token, watch, 2);
    } finally {
      const restore = await request.put(`${apiBaseURL}/api/backup-policy`, {
        headers,
        data: { retentionDays: Number(original.retentionDays) },
      });
      expect(restore.status(), await restore.text()).toBe(200);
    }
  });

  // The Administrador-facing leg (RF013's primary actor): BackupPage drives
  // POST /perform and GET /list for real, and the policy section drives
  // PUT /backup-policy. Since #740 the table also renders the run's status
  // and checksum, so the UI proof reaches AC#1's "estado ... e resultado"
  // and AC#3's checksum evidence rather than stopping at row presence.
  test('an Administrador runs a backup and edits the policy through the real UI (/backup)', async ({ page, request }) => {
    const admin = await realLogin(request);
    const headers = { Authorization: `Bearer ${admin.token}` };
    const original = (await (await request.get(`${apiBaseURL}/api/backup-policy`, { headers })).json()).data;
    const newRetention = Number(original.retentionDays) + 2;

    await page.addInitScript(() => {
      window.localStorage.setItem('app_language', 'pt-BR');
    });
    await seedRealAuth(page, admin);

    try {
      await page.goto('/backup');
      await expect(page.getByRole('heading', { name: 'Gerenciamento de Backup' })).toBeVisible();

      const before = await listBackups(request, admin.token);
      await page.locator('.create-backup-button').click();
      await expect(page.locator('.status-message.success')).toBeVisible({ timeout: 15_000 });

      const after = await listBackups(request, admin.token);
      const newRuns = after.filter((entry) => !before.some((old) => old.fileName === entry.fileName));
      expect(newRuns.length).toBeGreaterThanOrEqual(1);
      expect(newRuns[0].status).toBe('success');
      const newRow = page.locator('.backups-table tbody tr', { hasText: newRuns[0].fileName });
      await expect(newRow).toBeVisible();

      // #740 (RF013 AC#1/AC#3): the run's state and its checksum evidence
      // must be visible to the Administrador, not merely present in the API
      // payload asserted above.
      await expect(newRow.locator('.backup-status-badge')).toHaveText('Sucesso');
      await expect(newRow.locator('.backup-status-badge')).toHaveAttribute('data-status', 'success');
      const checksumCell = newRow.locator('.backup-checksum');
      await expect(checksumCell).toHaveAttribute('title', newRuns[0].checksum);
      await expect(checksumCell).toHaveText(`${newRuns[0].checksum.slice(0, 12)}…`);

      await page.locator('#backup-policy-retention').fill(String(newRetention));
      await page.getByRole('button', { name: 'Salvar Política' }).click();
      await expect(page.getByText('Política de backup atualizada com sucesso!')).toBeVisible({ timeout: 10_000 });

      const reread = (await (await request.get(`${apiBaseURL}/api/backup-policy`, { headers })).json()).data;
      expect(Number(reread.retentionDays)).toBe(newRetention);
    } finally {
      await request.put(`${apiBaseURL}/api/backup-policy`, {
        headers,
        data: { retentionDays: Number(original.retentionDays) },
      });
    }
  });
});
