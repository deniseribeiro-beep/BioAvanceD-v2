import { test, expect } from '@playwright/test';
import { realLogin } from './helpers/realAuth';
import { createRealParticipant, closeSeedDb } from './helpers/seedParticipant';
import { waitForEthicalConsentStatus, closeNeo4jDriver } from './helpers/queryNeo4j';
import {
  countEssentialReferenceDocs,
  countFoundationDataRuns,
  countReferenceDatasetReleases,
  countTerminologyConcepts,
  closeFoundationDb,
} from './helpers/queryFoundationData';

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

// dict-07/dict-08 (#329, "Gap crítico"): the target Foundation Data Pipeline
// is a one-shot, idempotent bootstrap of the full 929-element dictionary
// across six technical entities, executed automatically after the stack's
// healthchecks pass — not a script a human has to remember to run.
// api/backend/scripts/seed-essential-reference-data.js is wired as exactly
// that (#366) for compose.dev.yml's `foundation-bootstrap` one-shot service,
// writing one FoundationDataRun document per run (#370) instead of the
// per-manifest-entry `referenceSeedRuns` rows #366 started with. Cutting
// compose.test.yml/CI over to the same bootstrap is #371 — until that
// lands, current-state:ci only ever runs the script with --dry-run
// (api/backend/package.json's current-state:ci) and compose.test.yml never
// invokes it at all, so these assertions (read directly from Mongo — there's
// no API surface for any of this) still fail against a freshly-booted test
// stack, only passing against the dev stack today.
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
});
