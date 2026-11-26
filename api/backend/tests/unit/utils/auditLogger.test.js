import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const logService = require('../../../src/services/log.service');
const auditLogger = require('../../../src/utils/auditLogger');
const securityAlertsService = require('../../../src/services/securityAlerts.service');
const { buildRbacCollections } = require('../../factories/rbac.factory');

const ANON_ID_RE = /^USR-[0-9A-F]{8}$/;

describe('auditLogger', () => {
  beforeEach(() => {
    auditLogger.db = null;
    vi.spyOn(logService, 'createLog').mockResolvedValue(undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('extractRequestInfo', () => {
    it('returns {} for a missing req', () => {
      expect(auditLogger.extractRequestInfo(null)).toEqual({});
    });

    it('prefers req.ip when present', () => {
      const info = auditLogger.extractRequestInfo({ ip: '1.2.3.4', headers: {} });
      expect(info.ip).toBe('1.2.3.4');
      expect(info.ipOriginal).toBe('1.2.3.4');
    });

    it('falls back to x-forwarded-for, taking the first IP', () => {
      const info = auditLogger.extractRequestInfo({
        headers: { 'x-forwarded-for': '5.6.7.8, 9.9.9.9' },
      });
      expect(info.ip).toBe('5.6.7.8');
      expect(info.forwardedFor).toBe('5.6.7.8, 9.9.9.9');
    });

    it('falls back to x-real-ip when no x-forwarded-for', () => {
      const info = auditLogger.extractRequestInfo({ headers: { 'x-real-ip': '10.0.0.1' } });
      expect(info.ip).toBe('10.0.0.1');
      expect(info.realIp).toBe('10.0.0.1');
    });

    it('falls back to req.connection.remoteAddress', () => {
      const info = auditLogger.extractRequestInfo({
        headers: {},
        connection: { remoteAddress: '192.168.1.1' },
      });
      expect(info.ip).toBe('192.168.1.1');
    });

    it('falls back to req.socket.remoteAddress', () => {
      const info = auditLogger.extractRequestInfo({
        headers: {},
        socket: { remoteAddress: '172.16.0.1' },
      });
      expect(info.ip).toBe('172.16.0.1');
    });

    it('defaults to N/A when nothing is available', () => {
      const info = auditLogger.extractRequestInfo({ headers: {} });
      expect(info.ip).toBe('N/A');
      expect(info.ipOriginal).toBe('N/A');
    });

    it('strips the port from a dotted IPv4 address', () => {
      const info = auditLogger.extractRequestInfo({ ip: '192.168.1.1:12345', headers: {} });
      expect(info.ip).toBe('192.168.1.1');
    });

    it('strips the port from a dotless host:port pair', () => {
      const info = auditLogger.extractRequestInfo({ ip: 'myhost:12345', headers: {} });
      expect(info.ip).toBe('myhost');
    });

    it('strips a trailing port from an IPv6 address with more than one colon', () => {
      const info = auditLogger.extractRequestInfo({ ip: '::ffff:192.168.1.1:12345', headers: {} });
      expect(info.ip).toBe('::ffff:192.168.1.1');
    });

    it('leaves a bare IPv6 loopback address untouched', () => {
      const info = auditLogger.extractRequestInfo({ ip: '::1', headers: {} });
      expect(info.ip).toBe('::1');
    });

    it('fills header/method/path/origin fields with defaults when absent', () => {
      const info = auditLogger.extractRequestInfo({ headers: {} });
      expect(info.userAgent).toBe('N/A');
      expect(info.method).toBe('N/A');
      expect(info.path).toBe('N/A');
      expect(info.origin).toBe('N/A');
      expect(info.referer).toBeNull();
      expect(info.host).toBe('N/A');
      expect(info.protocol).toBe('http');
      expect(info.secure).toBe(false);
    });

    it('prefers req.path over req.url, and reads referrer via headers.referrer', () => {
      const info = auditLogger.extractRequestInfo({
        headers: { referrer: 'https://ref.example' },
        path: '/foo',
        url: '/bar',
        method: 'POST',
        protocol: 'https',
        secure: true,
      });
      expect(info.path).toBe('/foo');
      expect(info.referer).toBe('https://ref.example');
      expect(info.method).toBe('POST');
      expect(info.protocol).toBe('https');
      expect(info.secure).toBe(true);
    });

    it('falls back to req.url when req.path is absent', () => {
      const info = auditLogger.extractRequestInfo({ headers: {}, url: '/bar' });
      expect(info.path).toBe('/bar');
    });
  });

  describe('extractUserInfo', () => {
    it('returns {} when there is no req', async () => {
      expect(await auditLogger.extractUserInfo(null)).toEqual({});
    });

    it('returns {} when req.user is absent', async () => {
      expect(await auditLogger.extractUserInfo({})).toEqual({});
    });

    it('anonymizes req.user.userID into a USR- identifier', async () => {
      const info = await auditLogger.extractUserInfo({ user: { userID: 'u1', accessType: 4 } });
      expect(info.userID).toMatch(ANON_ID_RE);
      expect(info.userName).toBe(info.userID);
      expect(info.userRole).toBe('Administrador');
    });

    it('falls back to req.user._id.toString() when userID is absent', async () => {
      const info = await auditLogger.extractUserInfo({
        user: { _id: { toString: () => 'oid1' } },
      });
      expect(info.userID).toMatch(ANON_ID_RE);
    });

    it('maps accessType 3 to Coordenador', async () => {
      const info = await auditLogger.extractUserInfo({ user: { userID: 'u', accessType: 3 } });
      expect(info.userRole).toBe('Coordenador');
    });

    it('maps accessType 2 to Técnico', async () => {
      const info = await auditLogger.extractUserInfo({ user: { userID: 'u', accessType: 2 } });
      expect(info.userRole).toBe('Técnico');
    });

    it('maps an unknown accessType to Usuário Externo', async () => {
      const info = await auditLogger.extractUserInfo({ user: { userID: 'u', accessType: 1 } });
      expect(info.userRole).toBe('Usuário Externo');
    });

    it('prefers req.user.roleName over the accessType mapping', async () => {
      const info = await auditLogger.extractUserInfo({
        user: { userID: 'u', roleName: 'CustomRole', accessType: 4 },
      });
      expect(info.userRole).toBe('CustomRole');
    });

    // #426: when a db with real RBAC collections is passed and req.user
    // carries no roleName, the label is resolved via UserRoleAssignment ->
    // Role instead of the JWT's accessType.
    it('resolves userRole via RBAC when db is available and roleName is absent', async () => {
      const rbac = buildRbacCollections([{ userAccountId: 'u1', accessType: 3 }]);
      const db = { collection: (name) => rbac[name] };
      const info = await auditLogger.extractUserInfo({ user: { userID: 'u1' } }, db);
      expect(info.userRole).toBe('Coordenador');
    });

    it('falls back to the accessType mapping when db has no matching assignment', async () => {
      const rbac = buildRbacCollections([]);
      const db = { collection: (name) => rbac[name] };
      const info = await auditLogger.extractUserInfo({ user: { userID: 'u1', accessType: 2 } }, db);
      expect(info.userRole).toBe('Técnico');
    });
  });

  describe('sanitizePayload', () => {
    it('returns the payload unchanged when not an object', () => {
      expect(auditLogger.sanitizePayload('str', 'Entity')).toBe('str');
      expect(auditLogger.sanitizePayload(null, 'Entity')).toBeNull();
      expect(auditLogger.sanitizePayload(undefined, 'Entity')).toBeUndefined();
    });

    it('strips sensitive fields', () => {
      const result = auditLogger.sanitizePayload(
        { password: 'p', email: 'e', keep: 'k' },
        'Other'
      );
      expect(result).toEqual({ keep: 'k' });
    });

    it('delegates to sanitizePatientForLogs for a Patient entity with participantId', () => {
      const result = auditLogger.sanitizePayload({ participantId: '123', name: 'John' }, 'Patient');
      expect(result).toEqual({ participantId: '123' });
    });

    it('does not delegate for Patient entity without participantId', () => {
      const result = auditLogger.sanitizePayload({ name: 'John' }, 'Patient');
      expect(result).toEqual({});
    });
  });

  describe('extractErrorStack', () => {
    it('returns null when there is no error', () => {
      expect(auditLogger.extractErrorStack(null)).toBeNull();
    });

    it('returns null when the error has no stack', () => {
      expect(auditLogger.extractErrorStack({})).toBeNull();
    });

    it('returns at most the first 5 lines of the stack', () => {
      const error = { stack: Array.from({ length: 10 }, (_, i) => `line${i}`).join('\n') };
      const result = auditLogger.extractErrorStack(error);
      expect(result.split('\n')).toHaveLength(5);
      expect(result).toContain('line0');
      expect(result).not.toContain('line5');
    });
  });

  describe('determineModule', () => {
    it('returns Sistema when path is absent', () => {
      expect(auditLogger.determineModule(null)).toBe('Sistema');
    });

    it.each([
      ['/auth/login', 'Autenticação'],
      ['/logout', 'Autenticação'],
      ['/patients/1', 'Cadastro'],
      ['/paciente/1', 'Cadastro'],
      ['/samples', 'Amostras'],
      ['/amostra', 'Amostras'],
      ['/import/csv', 'Importação'],
      ['/users', 'Usuários'],
      ['/config', 'Configurações'],
      ['/settings', 'Configurações'],
      ['/ia/chat', 'Sistema'],
      ['/security/mfa', 'Segurança'],
      ['/backup/run', 'Backup'],
      ['/reports/list', 'Relatórios'],
      ['/unmatched/path', 'Sistema'],
    ])('maps %s to %s', (path, expected) => {
      expect(auditLogger.determineModule(path)).toBe(expected);
    });

    it('is case-insensitive', () => {
      expect(auditLogger.determineModule('/AUTH/LOGIN')).toBe('Autenticação');
    });
  });

  describe('log', () => {
    it('logs an error to console and returns early when not initialized', async () => {
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      await auditLogger.log({ action: 'CREATE', resourceType: 'Patient' });
      expect(errSpy).toHaveBeenCalledWith(
        expect.stringContaining('AuditLogger não foi inicializado')
      );
      expect(logService.createLog).not.toHaveBeenCalled();
    });

    it('builds and persists a full log entry when initialized', async () => {
      const db = {};
      auditLogger.init(db);

      const req = {
        ip: '1.1.1.1',
        headers: { origin: 'https://x' },
        path: '/patients',
        user: { userID: 'u1', accessType: 4 },
      };

      await auditLogger.log({
        action: 'create',
        resourceType: 'Patient',
        resourceId: 'e1',
        payload: { name: 'John', keep: 'k' },
        req,
      });

      expect(logService.createLog).toHaveBeenCalledTimes(1);
      const [calledDb, logData, calledReq] = logService.createLog.mock.calls[0];
      expect(calledDb).toBe(db);
      expect(calledReq).toBe(req);
      expect(logData.action).toBe('CREATE');
      expect(logData.entity).toBe('Patient');
      expect(logData.module).toBe('Cadastro');
      expect(logData.status).toBe('success');
      expect(logData.payload).not.toHaveProperty('name');
      expect(logData.userID).toMatch(ANON_ID_RE);
      expect(logData.metadata.tracking.ip).toBe('1.1.1.1');
    });

    // #1094: AuditEvent.source is a 1..1 Core field with a CLOSED vocabulary
    // -- dict-02 P1X-0331: "api, frontend, worker, mqtt, scheduler ou system".
    // auditLogger stamped it from the HTTP Origin header instead, so a browser
    // row carried a URL and a machine-ingest row (no Origin header) carried the
    // literal string "N/A". Neither is in the vocabulary, and source is hashed
    // into the Merkle chain (integrityCheckService.js:60's buildHashPayload) on
    // immutable rows, so a wrong value is sealed in rather than correctable.
    it('stamps a canonical source, not the browser Origin URL (#1094)', async () => {
      auditLogger.init({});

      await auditLogger.log({
        action: 'X',
        resourceType: 'Y',
        req: { ip: '1.1.1.1', headers: { origin: 'https://app.example.com' }, path: '/patients' }
      });

      const [, logData] = logService.createLog.mock.calls[0];
      expect(logData.source).toBe('api');
    });

    // The sharper of the two: "N/A" is TRUTHY, so it actively suppressed
    // Log.js:124's `data.source || data.origin || 'api'` fallback rather than
    // merely being an odd value. This is the shape every machine-ingest route
    // produces (iot.controller.js, temperature.controller.js).
    it('stamps a canonical source for a request with no Origin header, not "N/A" (#1094)', async () => {
      auditLogger.init({});

      await auditLogger.log({ action: 'X', resourceType: 'Y', req: { ip: '1.1.1.1', headers: {} } });

      const [, logData] = logService.createLog.mock.calls[0];
      expect(logData.source).toBe('api');
      expect(logData.source).not.toBe('N/A');
    });

    // CONTROL (#695): the raw Origin header is not discarded by this fix -- it
    // already lives in metadata.request.origin and stays there. Same before and
    // after, so a red here is the setup rather than the bug. (#1094 said this
    // was metadata.TRACKING.origin; it is metadata.REQUEST.origin.)
    it('keeps the raw Origin header in metadata.request.origin', async () => {
      auditLogger.init({});

      await auditLogger.log({
        action: 'X',
        resourceType: 'Y',
        req: { ip: '1.1.1.1', headers: { origin: 'https://app.example.com' } }
      });

      const [, logData] = logService.createLog.mock.calls[0];
      expect(logData.metadata.request.origin).toBe('https://app.example.com');
    });

    // #1105: #1094 hardcoded source:'api' because every caller reaching it
    // WITH a req is an API request. The non-request-driven callers -- the
    // import worker and the cron-scheduled retention sweep -- were landing on
    // 'api' too, via Log.js:124's default, which is a canonical value that is
    // simply WRONG. dict-02 P1X-0331's six values are what make "show me
    // everything the import worker did" a query rather than a guess, and
    // mqtt-ingestion-audit.service.js already declares 'mqtt', so the MQTT
    // path was distinguishable and the worker path was not.
    it("#1105: stamps a caller-declared 'worker' source", async () => {
      auditLogger.init({});

      await auditLogger.log({ action: 'X', resourceType: 'Y', source: 'worker' });

      const [, logData] = logService.createLog.mock.calls[0];
      expect(logData.source).toBe('worker');
    });

    it("#1105: stamps a caller-declared 'scheduler' source", async () => {
      auditLogger.init({});

      await auditLogger.log({ action: 'X', resourceType: 'Y', source: 'scheduler' });

      const [, logData] = logService.createLog.mock.calls[0];
      expect(logData.source).toBe('scheduler');
    });

    // The validation is the part worth insisting on: without it this
    // reintroduces #1094's defect through a different door, since a caller
    // typo would write a non-vocabulary value with no gate anywhere between
    // auditLogger and the Merkle hash. Fail SAFE to a canonical value rather
    // than writing an invalid one.
    it("#1105: falls back to 'api' for a source outside the dict-02 vocabulary", async () => {
      auditLogger.init({});

      await auditLogger.log({ action: 'X', resourceType: 'Y', source: 'wokrer' });

      const [, logData] = logService.createLog.mock.calls[0];
      expect(logData.source).toBe('api');
    });

    // CONTROL (#695): a call declaring no source is unchanged by this fix --
    // 'api' before and after, so a red here is the setup, not the bug.
    it("#1105: still stamps 'api' when the caller declares nothing", async () => {
      auditLogger.init({});

      await auditLogger.log({ action: 'X', resourceType: 'Y', req: { ip: '1.1.1.1', headers: {} } });

      const [, logData] = logService.createLog.mock.calls[0];
      expect(logData.source).toBe('api');
    });

    // The two import-worker sites reach log() through these wrappers, so the
    // option has to be plumbed or it cannot be declared at all from there.
    it('#1105: logImport plumbs a declared source through to the row', async () => {
      auditLogger.init({});

      await auditLogger.logImport(null, 'Patient', 'completed', 3, 3, 0, { jobID: 'j1' }, { source: 'worker' });

      const [, logData] = logService.createLog.mock.calls[0];
      expect(logData.source).toBe('worker');
      // and the payload is untouched by the new option
      expect(logData.payload).toMatchObject({ total: 3, success: 3, jobID: 'j1' });
      expect(logData.payload).not.toHaveProperty('source');
    });

    it('#1105: logError plumbs a declared source through to the row', async () => {
      auditLogger.init({});

      await auditLogger.logError(null, 'Import', new Error('boom'), { jobID: 'j1' }, { source: 'worker' });

      const [, logData] = logService.createLog.mock.calls[0];
      expect(logData.source).toBe('worker');
      expect(logData.payload).not.toHaveProperty('source');
    });

    it('uses the provided module over the auto-determined one', async () => {
      auditLogger.init({});
      await auditLogger.log({ action: 'X', resourceType: 'Y', module: 'Custom', req: { headers: {} } });
      const [, logData] = logService.createLog.mock.calls[0];
      expect(logData.module).toBe('Custom');
    });

    it('falls back to Sistema module when there is no req', async () => {
      auditLogger.init({});
      await auditLogger.log({ action: 'X', resourceType: 'Y' });
      const [, logData] = logService.createLog.mock.calls[0];
      expect(logData.module).toBe('Sistema');
      expect(logData.userID).toBe('USR-SYSTEM');
    });

    it('builds errorStack and default message when an error is passed without a message', async () => {
      auditLogger.init({});
      const error = { message: 'boom', stack: 'l1\nl2' };
      await auditLogger.log({ action: 'ERROR', resourceType: 'Sistema', error });
      const [, logData] = logService.createLog.mock.calls[0];
      expect(logData.errorStack).toBe('l1\nl2');
      expect(logData.message).toBe('ERROR em Sistema');
    });

    it('writes status to both canonical status and legacy result dual-write fields', async () => {
      auditLogger.init({});
      await auditLogger.log({ action: 'X', resourceType: 'Y', status: 'error' });
      const [, logData] = logService.createLog.mock.calls[0];
      expect(logData.status).toBe('error');
      expect(logData.result).toBe('error');
    });

    it('catches and logs an error thrown mid-log without rejecting', async () => {
      auditLogger.init({});
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      logService.createLog.mockRejectedValueOnce(new Error('createLog failed'));

      await expect(auditLogger.log({ action: 'X', resourceType: 'Y' })).resolves.toBeUndefined();
      expect(errSpy).toHaveBeenCalledWith(
        'Erro ao registrar log de auditoria:',
        'createLog failed'
      );
    });

    // #1096: that console.error was the WHOLE response to a failed audit
    // write. log.service.js#createLog rethrows on purpose -- covering
    // validation, LogModel.create, computeAuditHash and the primary
    // logsCollection.insertOne, i.e. the audit row not being written at all
    // -- and this catch threw that away. Meanwhile log.service.js:124-140
    // raises a CRITICAL security alert for the narrower failure (a failed
    // audit_events MIRROR), with #369/#394 behind it: "A warn-level log line
    // alone was proven to hide that for ~4 weeks." The escalation guarded the
    // copy and not the original, and console.error is strictly quieter than
    // the logger.warn that case was judged insufficient by.
    it('raises the AUDIT_TRAIL_WRITE_FAILURE critical alert when the audit write fails (#1096)', async () => {
      auditLogger.init({});
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const alertSpy = vi.spyOn(securityAlertsService, 'logSecurityAlert').mockResolvedValue(undefined);
      logService.createLog.mockRejectedValueOnce(new Error('insert failed'));

      await expect(auditLogger.log({ action: 'X', resourceType: 'Patient' })).resolves.toBeUndefined();

      expect(alertSpy).toHaveBeenCalledTimes(1);
      const alert = alertSpy.mock.calls[0][0];
      expect(alert.type).toBe('AUDIT_TRAIL_WRITE_FAILURE');
      expect(alert.severity).toBe('critical');
    });

    // An alert that does not say WHAT was not audited is not much better than
    // the console.error -- integrityCheckService#buildMerkleForDate builds the
    // daily root from rows that EXIST, so a row never written is invisible to
    // the tamper-evidence check and the alert is the only record of it.
    it('names the lost event and the cause in the alert details (#1096)', async () => {
      auditLogger.init({});
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const alertSpy = vi.spyOn(securityAlertsService, 'logSecurityAlert').mockResolvedValue(undefined);
      logService.createLog.mockRejectedValueOnce(new Error('insert failed'));

      await auditLogger.log({ action: 'ingest', resourceType: 'Patient', resourceId: 'p1' });

      const alert = alertSpy.mock.calls[0][0];
      expect(alert.action).toBe('AUDIT_LOG_WRITE_FAILED');
      expect(alert.details.entity).toBe('Patient');
      expect(alert.details.attemptedAction).toBe('INGEST');
      expect(alert.details.error).toContain('insert failed');
    });

    // #1106 direction 3: the alert now says WHICH kind of failure it was, so
    // an operator can tell "page someone" from "file a bug". Both stay
    // CRITICAL deliberately -- the audit row is unwritten either way, which
    // is the whole #369/#394 lesson; only the diagnosis differs.
    it('marks an infrastructure failure as such, and keeps it critical (#1106)', async () => {
      auditLogger.init({});
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const alertSpy = vi.spyOn(securityAlertsService, 'logSecurityAlert').mockResolvedValue(undefined);
      logService.createLog.mockRejectedValueOnce(new Error('db down'));

      await auditLogger.log({ action: 'X', resourceType: 'Y' });

      const alert = alertSpy.mock.calls[0][0];
      expect(alert.details.failureKind).toBe('infrastructure');
      expect(alert.severity).toBe('critical');
    });

    it('marks a validation failure as a caller defect, and keeps it critical too (#1106)', async () => {
      auditLogger.init({});
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const alertSpy = vi.spyOn(securityAlertsService, 'logSecurityAlert').mockResolvedValue(undefined);
      const validationError = new Error('severity deve ser: info, warning, error ou critical');
      validationError.code = 'LOG_VALIDATION_FAILED';
      logService.createLog.mockRejectedValueOnce(validationError);

      await auditLogger.log({ action: 'X', resourceType: 'Y' });

      const alert = alertSpy.mock.calls[0][0];
      expect(alert.details.failureKind).toBe('validation');
      expect(alert.severity).toBe('critical');
    });

    // CONTROL (#695): same expectation before and after -- a red here is the
    // setup rather than the bug. Also the discriminator against an over-broad
    // fix that alerts on every write.
    it('raises no alert when the audit write succeeds', async () => {
      auditLogger.init({});
      const alertSpy = vi.spyOn(securityAlertsService, 'logSecurityAlert').mockResolvedValue(undefined);

      await auditLogger.log({ action: 'X', resourceType: 'Y' });

      expect(alertSpy).not.toHaveBeenCalled();
    });

    // The alert path must not become a second way for an audit failure to take
    // the request down. securityAlerts.service.js#logSecurityAlert already
    // returns early without a db and swallows its own errors, so this is
    // belt-and-braces -- but it is the trade #1096 flagged, so it is pinned.
    it('still does not reject when the alert itself fails', async () => {
      auditLogger.init({});
      vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.spyOn(securityAlertsService, 'logSecurityAlert').mockRejectedValue(new Error('alerts down'));
      logService.createLog.mockRejectedValueOnce(new Error('insert failed'));

      await expect(auditLogger.log({ action: 'X', resourceType: 'Y' })).resolves.toBeUndefined();
    });
  });

  describe('convenience methods', () => {
    beforeEach(() => {
      auditLogger.init({});
    });

    it('logLogin success', async () => {
      await auditLogger.logLogin({ headers: {} }, true);
      const [, logData] = logService.createLog.mock.calls[0];
      expect(logData.action).toBe('LOGIN');
      expect(logData.result).toBe('success');
      expect(logData.severity).toBe('info');
    });

    it('logLogin failure includes the error message', async () => {
      await auditLogger.logLogin({ headers: {} }, false, new Error('bad creds'));
      const [, logData] = logService.createLog.mock.calls[0];
      expect(logData.result).toBe('error');
      expect(logData.message).toContain('bad creds');
    });

    it('logLogin failure without an error uses the default message', async () => {
      await auditLogger.logLogin({ headers: {} }, false);
      const [, logData] = logService.createLog.mock.calls[0];
      expect(logData.message).toContain('Credenciais inválidas');
    });

    it('logLogout', async () => {
      await auditLogger.logLogout({ headers: {} });
      const [, logData] = logService.createLog.mock.calls[0];
      expect(logData.action).toBe('LOGOUT');
    });

    it('logCreate', async () => {
      await auditLogger.logCreate({ headers: {} }, 'Sample', 's1', { foo: 'bar' });
      const [, logData] = logService.createLog.mock.calls[0];
      expect(logData.action).toBe('CREATE');
      expect(logData.entityID).toBe('s1');
    });

    it('logUpdate', async () => {
      await auditLogger.logUpdate({ headers: {} }, 'Sample', 's1', { foo: 'bar' });
      const [, logData] = logService.createLog.mock.calls[0];
      expect(logData.action).toBe('UPDATE');
    });

    it('logDelete', async () => {
      await auditLogger.logDelete({ headers: {} }, 'Sample', 's1');
      const [, logData] = logService.createLog.mock.calls[0];
      expect(logData.action).toBe('DELETE');
      expect(logData.severity).toBe('warning');
    });

    it('logImport with errors uses warning severity/result', async () => {
      await auditLogger.logImport({ headers: {} }, 'Patient', 'done', 10, 8, 2, { jobID: 'j1' });
      const [, logData] = logService.createLog.mock.calls[0];
      expect(logData.result).toBe('warning');
      expect(logData.severity).toBe('warning');
      expect(logData.payload.jobID).toBe('j1');
      expect(logData.message).toContain('2 erro(s)');
      expect(logData.message).toContain('Job: j1');
    });

    it('logImport with pending result and no errors uses info', async () => {
      await auditLogger.logImport({ headers: {} }, 'Patient', 'pending', 10, 0, 0);
      const [, logData] = logService.createLog.mock.calls[0];
      expect(logData.result).toBe('info');
      expect(logData.severity).toBe('info');
    });

    it('logImport success (no errors, non-pending) uses success/info', async () => {
      await auditLogger.logImport({ headers: {} }, 'Patient', 'done', 10, 10, 0);
      const [, logData] = logService.createLog.mock.calls[0];
      expect(logData.result).toBe('success');
      expect(logData.severity).toBe('info');
    });

    it('logError', async () => {
      await auditLogger.logError({ headers: {} }, 'Sample', new Error('boom'), { ctx: 1 });
      const [, logData] = logService.createLog.mock.calls[0];
      expect(logData.action).toBe('ERROR');
      expect(logData.message).toContain('boom');
      expect(logData.payload.ctx).toBe(1);
    });

    it('logError with no entity falls back to Sistema', async () => {
      await auditLogger.logError({ headers: {} }, null, new Error('boom'));
      const [, logData] = logService.createLog.mock.calls[0];
      expect(logData.entity).toBe('Sistema');
    });

    it('logError with no error message uses default text', async () => {
      await auditLogger.logError({ headers: {} }, 'Sample', null);
      const [, logData] = logService.createLog.mock.calls[0];
      expect(logData.message).toContain('Erro desconhecido');
    });

    it('logLanguageChange', async () => {
      await auditLogger.logLanguageChange({ headers: {} }, 'pt-BR');
      const [, logData] = logService.createLog.mock.calls[0];
      expect(logData.action).toBe('CONFIG');
      expect(logData.payload.language).toBe('pt-BR');
    });

    it('logPermissionChange', async () => {
      await auditLogger.logPermissionChange({ headers: {} }, 'user1', { role: 'admin' });
      const [, logData] = logService.createLog.mock.calls[0];
      expect(logData.action).toBe('UPDATE');
      expect(logData.entityID).toBe('user1');
    });

  });

  describe('formatEntity (via log() resourceType field)', () => {
    beforeEach(() => {
      auditLogger.init({});
    });

    it('capitalizes the first letter of the entity', async () => {
      await auditLogger.log({ action: 'X', resourceType: 'patient' });
      const [, logData] = logService.createLog.mock.calls[0];
      expect(logData.entity).toBe('Patient');
      expect(logData.resourceType).toBe('Patient');
    });

    it('defaults to Unknown when resourceType is missing', async () => {
      await auditLogger.log({ action: 'X', resourceType: undefined });
      const [, logData] = logService.createLog.mock.calls[0];
      expect(logData.entity).toBe('Unknown');
    });

    it('defaults to Unknown when resourceType is an empty string', async () => {
      await auditLogger.log({ action: 'X', resourceType: '   ' });
      const [, logData] = logService.createLog.mock.calls[0];
      expect(logData.entity).toBe('Unknown');
    });

    it('derives entity/resourceType from a single canonical source, no independent override', async () => {
      await auditLogger.log({ action: 'X', resourceType: 'sample' });
      const [, logData] = logService.createLog.mock.calls[0];
      expect(logData.entity).toBe('Sample');
      expect(logData.resourceType).toBe('Sample');
    });
  });
});
