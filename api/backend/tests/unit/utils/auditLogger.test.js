import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const logService = require('../../../src/services/log.service');
const auditLogger = require('../../../src/utils/auditLogger');
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
      ['/assistant', 'IA Assistente'],
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
      await auditLogger.log({ action: 'CREATE', entity: 'Patient' });
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
        entity: 'Patient',
        entityID: 'e1',
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

    it('uses the provided module over the auto-determined one', async () => {
      auditLogger.init({});
      await auditLogger.log({ action: 'X', entity: 'Y', module: 'Custom', req: { headers: {} } });
      const [, logData] = logService.createLog.mock.calls[0];
      expect(logData.module).toBe('Custom');
    });

    it('falls back to Sistema module when there is no req', async () => {
      auditLogger.init({});
      await auditLogger.log({ action: 'X', entity: 'Y' });
      const [, logData] = logService.createLog.mock.calls[0];
      expect(logData.module).toBe('Sistema');
      expect(logData.userID).toMatch(ANON_ID_RE);
    });

    it('builds errorStack and default message when an error is passed without a message', async () => {
      auditLogger.init({});
      const error = { message: 'boom', stack: 'l1\nl2' };
      await auditLogger.log({ action: 'ERROR', entity: 'Sistema', error });
      const [, logData] = logService.createLog.mock.calls[0];
      expect(logData.errorStack).toBe('l1\nl2');
      expect(logData.message).toBe('ERROR em Sistema');
    });

    it('uses result as a fallback for status', async () => {
      auditLogger.init({});
      await auditLogger.log({ action: 'X', entity: 'Y', result: 'error' });
      const [, logData] = logService.createLog.mock.calls[0];
      expect(logData.status).toBe('error');
      expect(logData.result).toBe('error');
    });

    it('catches and logs an error thrown mid-log without rejecting', async () => {
      auditLogger.init({});
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      logService.createLog.mockRejectedValueOnce(new Error('createLog failed'));

      await expect(auditLogger.log({ action: 'X', entity: 'Y' })).resolves.toBeUndefined();
      expect(errSpy).toHaveBeenCalledWith(
        'Erro ao registrar log de auditoria:',
        'createLog failed'
      );
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

    it('logAssistant', async () => {
      await auditLogger.logAssistant({ headers: {} }, 'question?', 'an answer');
      const [, logData] = logService.createLog.mock.calls[0];
      expect(logData.action).toBe('QUERY');
      expect(logData.payload.questionLength).toBe(9);
      expect(logData.payload.responseLength).toBe(9);
    });

    it('logAssistant with undefined question/response falls back to 0 length', async () => {
      await auditLogger.logAssistant({ headers: {} }, undefined, undefined);
      const [, logData] = logService.createLog.mock.calls[0];
      expect(logData.payload.questionLength).toBe(0);
      expect(logData.payload.responseLength).toBe(0);
    });
  });

  describe('formatEntity (via log() entity/resourceType fields)', () => {
    beforeEach(() => {
      auditLogger.init({});
    });

    it('capitalizes the first letter of the entity', async () => {
      await auditLogger.log({ action: 'X', entity: 'patient' });
      const [, logData] = logService.createLog.mock.calls[0];
      expect(logData.entity).toBe('Patient');
      expect(logData.resourceType).toBe('Patient');
    });

    it('defaults to Unknown when entity is missing', async () => {
      await auditLogger.log({ action: 'X', entity: undefined });
      const [, logData] = logService.createLog.mock.calls[0];
      expect(logData.entity).toBe('Unknown');
    });

    it('defaults to Unknown when entity is an empty string', async () => {
      await auditLogger.log({ action: 'X', entity: '   ' });
      const [, logData] = logService.createLog.mock.calls[0];
      expect(logData.entity).toBe('Unknown');
    });

    it('preserves an explicit resourceType over the derived entity name', async () => {
      await auditLogger.log({ action: 'X', entity: 'sample', resourceType: 'CustomType' });
      const [, logData] = logService.createLog.mock.calls[0];
      expect(logData.entity).toBe('Sample');
      expect(logData.resourceType).toBe('CustomType');
    });
  });
});
