import { test, expect } from '@playwright/test';
import { realLogin } from './helpers/realAuth';
import { createRealParticipant, closeSeedDb } from './helpers/seedParticipant';
import { waitForEthicalConsentStatus, closeNeo4jDriver } from './helpers/queryNeo4j';

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

  // POST /api/consents (consent.service.js's createPatientConsent) appends a
  // CONSENT_UPSERTED event to graph_projection_outbox on the same request
  // (recordConsentProjectionEvent) — proving the pipeline means polling the
  // real Neo4j instance for the projected :EthicalConsent node, not trusting
  // the 201 response (the projection itself is asynchronous, see
  // neo4jProjection.worker.js).
  test('a signed consent projects into Neo4j as an ACTIVE EthicalConsent node', async ({ request }) => {
    const admin = await realLogin(request);
    const participant = await createRealParticipant(request, apiBaseURL!, admin.token);

    const response = await request.post(`${apiBaseURL}/api/consents`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: {
        participantId: participant.participantId,
        consentTemplateId: participant.consentTemplateId,
        responses: {},
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

    const create = await request.post(`${apiBaseURL}/api/consents`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: {
        participantId: participant.participantId,
        consentTemplateId: participant.consentTemplateId,
        responses: {},
      },
    });
    expect(create.ok()).toBe(true);
    const createBody = await create.json();
    const consentId = createBody?.data?._id;
    expect(consentId).toBeTruthy();

    await waitForEthicalConsentStatus(consentId, 'ACTIVE');

    const revoke = await request.post(`${apiBaseURL}/api/consents/${consentId}/revoke`, {
      headers: { Authorization: `Bearer ${admin.token}` },
    });
    expect(revoke.ok()).toBe(true);

    await waitForEthicalConsentStatus(consentId, 'REVOKED');
  });
});
