import { test, expect } from '@playwright/test';
import { realLogin } from './helpers/realAuth';
import { computeTotp } from './helpers/totp';
import { auditEventsForRequests, closeLogRedactionDb, logRowsSince } from './helpers/queryLogRedaction';
import { clearLoginAttempts, closeLoginAttemptsDb } from './helpers/queryLoginAttempts';

/**
 * #1457: RNF009 C3 ("Sanitizar payloads e impedir segredos/PII
 * desnecessaria"), RNF020 C6 ("Segredos e valores sensiveis nao aparecem em
 * logs") and the logs and exports leg of RNF007 C5, against the real stack.
 *
 * An administrator creates a user, the user fails a login with a wrong
 * password and then enrols MFA. Every value those requests carried that must
 * never be kept -- both passwords, the TOTP secret, the session tokens, the
 * user's name and e-mail -- is then searched for in what the backend stored
 * (the `logs` rows and their `audit_events` mirror), in the Logs screen's
 * list (GET /api/logs) and in its export (GET /api/logs/export/xlsx).
 *
 * Each request sends its own X-Request-Id, so the audit events it produced
 * are found by correlationId and the spec first proves the trail recorded
 * the three actions: an absence check over rows that were never written
 * would pass for nothing.
 */

const apiBaseURL = process.env.PLAYWRIGHT_API_BASE_URL;

// A JWT (three base64url segments, a JSON header first) and a bcrypt hash.
const JWT_SHAPE = /eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/;
const BCRYPT_SHAPE = /\$2[aby]\$\d{2}\$/;

test.describe('RNF009 C3 / RNF020 C6 log and audit redaction (real backend)', () => {
  test.skip(!apiBaseURL, 'needs the real backend (PLAYWRIGHT_API_BASE_URL)');

  test.afterAll(async () => {
    await closeLogRedactionDb();
    // The wrong-password login counts against the runner's source row, which
    // every spec shares; give the failure back.
    await clearLoginAttempts();
    await closeLoginAttemptsDb();
  });

  test('a wrong-password login, a user create and an MFA enrolment leave no password, token, secret or civil identifier in the stored audit trail, the log view or the log export', async ({
    request,
  }) => {
    // Clock slack between the runner and the API container.
    const since = new Date(Date.now() - 5_000);
    const stamp = Date.now();
    const admin = await realLogin(request);
    const adminAuth = { Authorization: `Bearer ${admin.token}` };

    const username = `redaction.${stamp}`;
    const email = `${username}@example.com`;
    const name = `Redaction Fixture ${stamp}`;
    const password = `Redact@${stamp}-forte`;
    const wrongPassword = `Wrong@${stamp}-forte`;
    const ids = {
      create: `e2e-redact-${stamp}-create`,
      wrongLogin: `e2e-redact-${stamp}-wrong`,
      mfaSetup: `e2e-redact-${stamp}-qr`,
      mfaEnable: `e2e-redact-${stamp}-enable`,
    };

    const created = await request.post(`${apiBaseURL}/api/users/register`, {
      headers: { ...adminAuth, 'X-Request-Id': ids.create },
      data: { name, email, username, password, accessType: 2, roleName: 'Técnico' },
    });
    expect(created.ok(), await created.text()).toBeTruthy();
    const createdBody = await created.json();
    const userID = String(createdBody.data?._id || createdBody.data?.id);

    const wrong = await request.post(`${apiBaseURL}/api/auth/login`, {
      headers: { 'X-Request-Id': ids.wrongLogin },
      data: { username, password: wrongPassword },
    });
    expect(wrong.status()).toBe(401);

    const setup = await request.post(`${apiBaseURL}/api/auth/two-factor/qr-first-login`, {
      headers: { 'X-Request-Id': ids.mfaSetup },
      data: { username, password },
    });
    expect(setup.ok(), await setup.text()).toBeTruthy();
    const secret: string = (await setup.json()).data?.secret;
    expect(secret, 'qr-first-login returned the TOTP secret').toBeTruthy();

    const enable = await request.post(`${apiBaseURL}/api/auth/two-factor/enable-first-login`, {
      headers: { 'X-Request-Id': ids.mfaEnable },
      data: { username, password, code: computeTotp(secret) },
    });
    expect(enable.ok(), await enable.text()).toBeTruthy();
    const enableBody = await enable.json();

    const forbidden: Record<string, string> = {
      password,
      wrongPassword,
      totpSecret: secret,
      adminToken: admin.token,
      name,
      email,
    };
    // A forced or expired password issues no session; otherwise the access
    // token is in the body and the refresh token only in its cookie.
    const refreshToken = /refresh_token=([^;]+)/.exec(enable.headers()['set-cookie'] || '')?.[1];
    for (const [label, value] of [
      ['userToken', enableBody.data?.token],
      ['userRefreshToken', refreshToken],
    ]) {
      if (typeof value === 'string' && value) forbidden[label] = value;
    }
    const expectClean = (where: string, text: string) => {
      for (const [label, value] of Object.entries(forbidden)) {
        expect(text.includes(value), `${where} carries the ${label}`).toBe(false);
      }
    };

    // The trail recorded all three actions, under their request ids. The
    // audit write may finish after the response is sent.
    let events: Array<Record<string, any>> = [];
    await expect
      .poll(
        async () => {
          events = await auditEventsForRequests(Object.values(ids));
          return [ids.create, ids.wrongLogin, ids.mfaEnable].filter((id) => events.some((e) => e.correlationId === id)).length;
        },
        { message: 'the create, the failed login and the enrolment each wrote an audit event', timeout: 10_000 }
      )
      .toBe(3);
    expect(events.find((e) => e.correlationId === ids.create)?.action).toBe('CREATE');
    expect(events.find((e) => e.correlationId === ids.wrongLogin)).toMatchObject({ action: 'LOGIN', result: 'error' });
    expect(events.find((e) => e.correlationId === ids.mfaEnable)?.action).toBe('CONFIG');

    // RNF009 C3: the stored audit payloads.
    for (const event of events) {
      const text = JSON.stringify(event);
      expectClean(`audit event ${event.eventId} (${event.action})`, text);
      expect(text, `audit event ${event.eventId} carries a JWT`).not.toMatch(JWT_SHAPE);
      expect(text, `audit event ${event.eventId} carries a bcrypt hash`).not.toMatch(BCRYPT_SHAPE);
    }

    // RNF020 C6: every row the primary trail kept since the spec began,
    // this spec's own among them. Only this spec's own values are searched
    // here: rows other specs write meanwhile are not this test's to judge by
    // shape, while none of them can know a value this spec made up.
    const rows = await logRowsSince(since);
    expect(rows.some((row) => String(row.resourceId) === userID && row.action === 'CREATE'), 'the create is in logs').toBe(true);
    for (const row of rows) {
      const text = JSON.stringify(row);
      expectClean(`logs row ${row._id} (${row.action})`, text);
    }

    // The log view: what the Logs screen lists, newest first.
    const view = await request.get(`${apiBaseURL}/api/logs?limit=1000`, { headers: adminAuth });
    expect(view.ok(), await view.text()).toBeTruthy();
    const viewText = await view.text();
    const viewLogs: Array<Record<string, any>> = JSON.parse(viewText).data.logs;
    expect(viewLogs.some((log) => String(log.resourceId) === userID && log.action === 'CREATE'), 'the create is in the log view').toBe(true);
    expectClean('the log view', viewText);

    // RNF007 C5, exports: the Logs screen's export. The route serves the
    // CSV text under the XLSX name; a change of format must fail here rather
    // than pass on bytes the text search cannot read.
    const exported = await request.get(`${apiBaseURL}/api/logs/export/xlsx?limit=1000`, { headers: adminAuth });
    expect(exported.ok()).toBeTruthy();
    const exportText = (await exported.body()).toString('utf8');
    expect(exportText.startsWith('timestamp,userName,action,entity,result,severity,module,ipSource,message')).toBe(true);
    expect(exportText).toContain('Usuário registrado com sucesso');
    expectClean('the log export', exportText);

    // The text above is met by any earlier spec's create too, and the CSV
    // timestamp column reads "[object Object]", so the export is asked again
    // for CREATE rows at or after `since` only: this spec's own create.
    const ownExport = await request.get(
      `${apiBaseURL}/api/logs/export/xlsx?limit=1000&action=CREATE&startDate=${encodeURIComponent(since.toISOString())}`,
      { headers: adminAuth }
    );
    expect(ownExport.ok()).toBeTruthy();
    const ownExportText = (await ownExport.body()).toString('utf8');
    expect(
      ownExportText.split('\n').some((line) => line.includes('"CREATE"') && line.includes('"Usuário registrado com sucesso"')),
      'the export holds a create written since the spec began'
    ).toBe(true);
    expectClean('the filtered log export', ownExportText);
  });
});
