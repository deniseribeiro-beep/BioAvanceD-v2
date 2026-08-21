import { test, expect } from '@playwright/test';
import { realLogin } from './helpers/realAuth';
import { createRealParticipant, seedRawSpecimen, seedStudy, seedAssay, closeSeedDb } from './helpers/seedParticipant';
import { waitForEthicalConsentStatus, waitForTerminologyConceptNode, waitForTerminologyRelation, closeNeo4jDriver } from './helpers/queryNeo4j';
import {
  countEssentialReferenceDocs,
  countFoundationDataRuns,
  countReferenceDatasetReleases,
  countTerminologyConcepts,
  countReferenceDatasetReleasesByDatasetCode,
  countTerminologyConceptsBySystemUri,
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
});

// RF028 AC9 ("Persistir primeiro no MongoDB e projetar no Neo4j
// exclusivamente pelo outbox", #552): reference-imports/pipeline.js's
// promote() now appends a TERMINOLOGY_CONCEPT_PROMOTED/
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
// is a one-shot, idempotent bootstrap of the full 929-element dictionary
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

  test('reference data is populated automatically, without running the manual seed script', async () => {
    const count = await countEssentialReferenceDocs();
    expect(count).toBeGreaterThan(0);
  });

  test('the bootstrap records an idempotent FoundationDataRun, not just ad-hoc upserts', async () => {
    const runs = await countFoundationDataRuns();
    expect(runs).toBeGreaterThan(0);
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
