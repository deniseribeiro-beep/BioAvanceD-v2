import { describe, it, expect } from 'vitest';
const auditLogger = require('../../src/utils/auditLogger');

describe('AuditLogger.sanitizePayload', () => {
  it('returns non-object unchanged', () => {
    expect(auditLogger.sanitizePayload('string', 'Sample')).toBe('string');
    expect(auditLogger.sanitizePayload(null, 'Sample')).toBeNull();
  });

  it('removes sensitive fields', () => {
    const payload = {
      action: 'CREATE',
      password: 'secret',
      email: 'user@test.com',
      cpf: '123.456.789-00',
      token: 'abc',
      name: 'João',
    };
    const result = auditLogger.sanitizePayload(payload, 'User');
    expect(result.action).toBe('CREATE');
    expect(result.password).toBeUndefined();
    expect(result.email).toBeUndefined();
    expect(result.cpf).toBeUndefined();
    expect(result.token).toBeUndefined();
    expect(result.name).toBeUndefined();
  });

  it('preserves non-sensitive fields', () => {
    const payload = { entity: 'Sample', entityID: 'SMP-001', count: 5 };
    const result = auditLogger.sanitizePayload(payload, 'Sample');
    expect(result).toMatchObject(payload);
  });

  it('sanitizes Patient entity with participantId to just participantId', () => {
    const payload = { participantId: '12345678', patientName: 'João', extra: 'data' };
    const result = auditLogger.sanitizePayload(payload, 'Patient');
    expect(result.participantId).toBe('12345678');
    expect(result.patientName).toBeUndefined();
    expect(result.extra).toBeUndefined();
  });

  it('does not apply Patient sanitization when entity is not Patient', () => {
    const payload = { participantId: '12345678', status: 'active' };
    const result = auditLogger.sanitizePayload(payload, 'Sample');
    expect(result.participantId).toBe('12345678');
    expect(result.status).toBe('active');
  });

  // RF005/RNF007 (#363/#564): identityDocument is the canonical
  // ParticipantIdentity field name — must be redacted like any other
  // sensitive field even outside the Patient-specific allowlist branch
  // (e.g. a non-Patient entity payload that happens to carry it).
  it('removes identityDocument for a non-Patient entity payload', () => {
    const payload = { entity: 'Sample', identityDocument: '11144477735', count: 5 };
    const result = auditLogger.sanitizePayload(payload, 'Sample');
    expect(result.identityDocument).toBeUndefined();
    expect(result.count).toBe(5);
  });
});

describe('AuditLogger.extractErrorStack', () => {
  it('returns null for null error', () => {
    expect(auditLogger.extractErrorStack(null)).toBeNull();
  });

  it('returns null for error without stack', () => {
    expect(auditLogger.extractErrorStack({})).toBeNull();
  });

  it('returns first 5 lines of stack', () => {
    const err = new Error('test error');
    const result = auditLogger.extractErrorStack(err);
    expect(typeof result).toBe('string');
    expect(result.split('\n').length).toBeLessThanOrEqual(5);
  });
});

describe('AuditLogger.determineModule', () => {
  it('returns Sistema for null path', () => {
    expect(auditLogger.determineModule(null)).toBe('Sistema');
  });

  it('returns Autenticação for /auth path', () => {
    expect(auditLogger.determineModule('/api/auth/login')).toBe('Autenticação');
  });

  it('returns Cadastro for /patient path', () => {
    expect(auditLogger.determineModule('/api/patient/create')).toBe('Cadastro');
  });

  it('returns Amostras for /sample path', () => {
    expect(auditLogger.determineModule('/api/sample')).toBe('Amostras');
  });

  it('returns Importação for /import path (no other keywords)', () => {
    expect(auditLogger.determineModule('/api/import/data')).toBe('Importação');
  });

  it('returns Usuários for /user path', () => {
    expect(auditLogger.determineModule('/api/user/profile')).toBe('Usuários');
  });

  it('returns Configurações for /config path', () => {
    expect(auditLogger.determineModule('/api/config/settings')).toBe('Configurações');
  });

  it('returns IA Assistente for /assistant path', () => {
    expect(auditLogger.determineModule('/api/assistant/chat')).toBe('IA Assistente');
  });

  it('returns Segurança for /security path', () => {
    expect(auditLogger.determineModule('/api/security/mfa')).toBe('Segurança');
  });

  it('returns Backup for /backup path', () => {
    expect(auditLogger.determineModule('/api/backup')).toBe('Backup');
  });

  it('returns Relatórios for /report path', () => {
    expect(auditLogger.determineModule('/api/reports/summary')).toBe('Relatórios');
  });

  it('returns Sistema for unknown path', () => {
    expect(auditLogger.determineModule('/api/unknown/endpoint')).toBe('Sistema');
  });
});
