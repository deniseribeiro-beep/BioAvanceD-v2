import { test, expect } from '@playwright/test';
import { realLogin } from './helpers/realAuth';
import { closeAuditEventsDb, latestChainEvents, rewriteEventField } from './helpers/queryAuditEvents';
import { closeIngestionDb, findIngestionAuditRows } from './helpers/queryIngestion';

/**
 * #1307: RF012 AC3, AC4 and AC6, RNF009 C4 and C5, against the real stack.
 * Audited actions append to one hash-linked chain, POST /api/audit/anchor
 * seals it as a signed tree head, and POST /api/audit/verify proves an event
 * against that head and detects an event rewritten after sealing.
 *
 * The tamper case rewrites one event in Mongo and restores it in a finally
 * block. Until the restore, verifying any later event of the chain reads
 * INVALID; no other spec verifies the chain.
 *
 * #1455: RF012 AC1, AC2 and AC5, RNF009 AC2 and AC6. An ingestion's audit
 * event names its action, target, result, both times, its request and the
 * canonical release, and its audit record names the configuration release
 * in force. No route edits or deletes an audit event.
 */

const apiBaseURL = process.env.PLAYWRIGHT_API_BASE_URL;
const CHAIN = 'audit-events';
const CANONICAL_MODEL_RELEASE_ID = 'release-2.0.0';
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

test.describe('RF012 audit event chain (real backend)', () => {
  test.skip(!apiBaseURL, 'needs the real backend (PLAYWRIGHT_API_BASE_URL)');

  test.afterAll(async () => {
    await closeAuditEventsDb();
    await closeIngestionDb();
  });

  test('chains audited actions, seals them, verifies an event and detects a rewritten one', async ({ request }) => {
    const { token } = await realLogin(request);
    const auth = { Authorization: `Bearer ${token}` };

    // The login above is itself audited, so the chain holds at least one
    // event. Take the newest and the one before it.
    const [newest, previous] = await latestChainEvents(CHAIN, 2);
    expect(newest, 'the login appended an event to the chain').toBeTruthy();
    expect(newest.sequenceNumber).toBeGreaterThan(1);
    expect(newest.previousEventHash).toBe(previous.eventHash);
    expect(newest.canonicalEventHash).toBe(newest.eventHash);
    expect(newest.actorPseudonym).toMatch(/^USR-/);
    expect(newest.purpose).toBeTruthy();
    expect(newest.policyVersion).toBeTruthy();
    expect(newest.canonicalModelReleaseId).toMatch(/^release-/);

    const anchor = await request.post(`${apiBaseURL}/api/audit/anchor`, {
      headers: auth,
      data: { date: new Date().toISOString().slice(0, 10) },
    });
    const anchorBody = await anchor.json();
    expect(anchor.status(), JSON.stringify(anchorBody)).toBe(200);
    const sealed = anchorBody.data.eventChain;
    expect(sealed.logId).toBe(CHAIN);
    expect(sealed.treeSize).toBeGreaterThanOrEqual(newest.sequenceNumber);

    const verify = async () => {
      const response = await request.post(`${apiBaseURL}/api/audit/verify`, { headers: auth, data: { eventId: newest.eventId } });
      const body = await response.json();
      expect(response.status(), JSON.stringify(body)).toBe(200);
      return body.data;
    };

    const intact = await verify();
    expect(intact).toMatchObject({
      eventIntegrity: true,
      inclusionValid: true,
      chainValid: true,
      consistencyValid: true,
      treeHeadSignatureValid: true,
    });
    expect(intact.overallStatus).not.toBe('INVALID');

    const original = await rewriteEventField(newest.eventId, 'result', 'tampered');
    try {
      const tampered = await verify();
      expect(tampered.overallStatus).toBe('INVALID');
      expect(tampered.eventIntegrity).toBe(false);
      expect(tampered.chainValid).toBe(false);
      expect(tampered.chainBrokenAt).toBe(newest.sequenceNumber);
      expect(tampered.failures).toEqual(expect.arrayContaining(['eventIntegrity', 'chain']));
    } finally {
      await rewriteEventField(newest.eventId, 'result', original);
    }

    expect((await verify()).chainValid).toBe(true);
  });

  // #1308: RNF020 C6 and RF012 AC1 -- the request's id is echoed and becomes
  // the correlationId of the audit event the request produced.
  test('a login carries its X-Request-Id into its audit event', async ({ request }) => {
    const requestId = `e2e-corr-${Date.now()}`;
    const response = await request.post(`${apiBaseURL}/api/auth/login`, {
      headers: { 'X-Request-Id': requestId },
      data: { username: process.env.TEST_USER || 'admin', password: process.env.TEST_PASS || 'Admin@123-e2e-stack' },
    });
    expect(response.status()).toBe(200);
    expect(response.headers()['x-request-id']).toBe(requestId);

    // The audit write may finish after the response is sent.
    await expect.poll(async () => {
      const recent = await latestChainEvents(CHAIN, 50);
      return recent.filter((event) => event.correlationId === requestId).length;
    }, { message: 'the login wrote an audit event under its request id', timeout: 10_000 }).toBeGreaterThan(0);
  });

  test('an ingestion writes an audit event with its action, target, result, times and releases', async ({ request }) => {
    const { token } = await realLogin(request);
    const auth = { Authorization: `Bearer ${token}` };

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
    const inForce: string = config.configurationReleaseId;
    expect(typeof inForce).toBe('string');
    expect(inForce).not.toBe('');

    const requestId = `e2e-audit-fields-${Date.now()}`;
    const response = await request.post(`${apiBaseURL}/api/ingestion/records`, {
      headers: { ...auth, 'X-Request-Id': requestId },
      data: {
        entityType: 'Dataset',
        payload: {
          datasetTitle: `RF012 e2e audit fields ${Date.now()}`,
          datasetVersion: '1.0.0',
          creators: [{ name: 'RF012 e2e suite' }],
          license: 'CC BY 4.0',
        },
        provenance: {
          sourceSystem: 'urn:system:audit-chain-e2e',
          retrievedAt: new Date().toISOString(),
          purpose: 'e2e_proof',
          sourceRecordId: `rf012-e2e-${Date.now()}`,
        },
      },
    });
    expect(response.status(), await response.text()).toBe(201);
    const body = await response.json();
    expect(typeof body.entityId).toBe('string');

    // RF012 AC2: the audit record names the configuration release in force.
    const rows = await findIngestionAuditRows('INGESTION_ACCEPTED', body.entityId);
    expect(rows).toHaveLength(1);
    expect(rows[0].payload.configurationReleaseId).toBe(inForce);
    expect(rows[0].payload.canonicalModelReleaseId).toBe(CANONICAL_MODEL_RELEASE_ID);

    // RF012 AC1 / RNF009 AC2: the chained event carries every field.
    let event: any;
    await expect.poll(async () => {
      const recent = await latestChainEvents(CHAIN, 200);
      event = recent.find((e) => e.correlationId === requestId && e.action === 'INGESTION_ACCEPTED');
      return Boolean(event);
    }, { message: 'the ingestion wrote an INGESTION_ACCEPTED event under its request id', timeout: 10_000 }).toBe(true);

    expect(event).toMatchObject({
      action: 'INGESTION_ACCEPTED',
      entityType: 'Dataset',
      entityId: body.entityId,
      result: 'success',
      correlationId: requestId,
      canonicalModelReleaseId: CANONICAL_MODEL_RELEASE_ID,
    });
    expect(event.actorPseudonym).toMatch(/^USR-/);
    expect(event.purpose).toBeTruthy();
    expect(event.policyVersion).toBeTruthy();
    expect(event.occurredAt).toMatch(ISO_INSTANT);
    expect(event.recordedAt).toMatch(ISO_INSTANT);
  });

  test('no route edits or deletes an audit event, and the event is unchanged after the attempts', async ({ request }) => {
    const { token } = await realLogin(request);
    const auth = { Authorization: `Bearer ${token}` };

    const [target] = await latestChainEvents(CHAIN, 1);
    expect(target, 'the login appended an event to the chain').toBeTruthy();
    const before = JSON.stringify(target);

    // RF012 AC5 / RNF009 AC6: the audit router mounts reads, verify and
    // anchor only, so every edit or delete of an event is refused.
    for (const path of [`/api/audit/events/${target.eventId}`, `/api/audit/${target.eventId}`]) {
      const attempts = [
        ['PUT', () => request.put(`${apiBaseURL}${path}`, { headers: auth, data: { result: 'tampered' } })],
        ['PATCH', () => request.patch(`${apiBaseURL}${path}`, { headers: auth, data: { result: 'tampered' } })],
        ['DELETE', () => request.delete(`${apiBaseURL}${path}`, { headers: auth })],
      ] as const;
      for (const [method, send] of attempts) {
        const response = await send();
        expect(response.status(), `${method} ${path}`).toBe(404);
      }
    }

    const after = (await latestChainEvents(CHAIN, 200)).find((e) => e.eventId === target.eventId);
    expect(after, 'the event is still stored').toBeTruthy();
    expect(JSON.stringify(after)).toBe(before);
  });
});
