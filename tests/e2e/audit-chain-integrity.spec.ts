import { test, expect } from '@playwright/test';
import { realLogin } from './helpers/realAuth';
import { closeAuditEventsDb, latestChainEvents, rewriteEventField } from './helpers/queryAuditEvents';

/**
 * #1307: RF012 AC3, AC4 and AC6, RNF009 C4 and C5, against the real stack.
 * Audited actions append to one hash-linked chain, POST /api/audit/anchor
 * seals it as a signed tree head, and POST /api/audit/verify proves an event
 * against that head and detects an event rewritten after sealing.
 *
 * The tamper case rewrites one event in Mongo and restores it in a finally
 * block. Until the restore, verifying any later event of the chain reads
 * INVALID; no other spec verifies the chain.
 */

const apiBaseURL = process.env.PLAYWRIGHT_API_BASE_URL;
const CHAIN = 'audit-events';

test.describe('RF012 audit event chain (real backend)', () => {
  test.skip(!apiBaseURL, 'needs the real backend (PLAYWRIGHT_API_BASE_URL)');

  test.afterAll(async () => {
    await closeAuditEventsDb();
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
});
