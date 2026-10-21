/**
 * Unit Tests - SessionModel
 * Testa validações e regras de negócio de sessão
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const SessionModel = require('../../../src/models/Session');

describe('SessionModel - Unit Tests', () => {
  let validSessionData;

  beforeEach(() => {
    validSessionData = {
      userAccountId: '67890',
      accessTokenHash: 'abc123def456',
      refreshTokenHash: 'xyz789uvw012',
      userAgent: 'Mozilla/5.0',
      ipAddress: '192.168.1.1',
      deviceInfo: {
        browser: 'Chrome',
        os: 'Windows',
        deviceName: 'Desktop'
      }
    };
  });

  describe('create()', () => {
    it('deve criar sessão válida com todos os campos obrigatórios', () => {
      const session = SessionModel.create(validSessionData);

      expect(session.userAccountId).toBe('67890');
      expect(session.accessTokenHash).toBe('abc123def456');
      expect(session.refreshTokenHash).toBe('xyz789uvw012');
      expect(session.isActive).toBe(true);
      expect(session.isRevoked).toBe(false);
      expect(session.sessionId).toBeDefined();
      expect(session.sessionStartedAt).toBeInstanceOf(Date);
      expect(session.lastActivityAt).toBeInstanceOf(Date);
      expect(session.expiresAt).toBeInstanceOf(Date);
      expect(session.refreshExpiresAt).toBeInstanceOf(Date);
    });

    it('deve gerar expiração padrão de 12 horas quando não fornecido', () => {
      delete validSessionData.expiresAt;
      const beforeCreate = Date.now();
      const session = SessionModel.create(validSessionData);
      const afterCreate = Date.now();

      const expectedMinExpires = new Date(beforeCreate + 12 * 60 * 60 * 1000);
      const expectedMaxExpires = new Date(afterCreate + 12 * 60 * 60 * 1000);

      expect(session.expiresAt.getTime()).toBeGreaterThanOrEqual(expectedMinExpires.getTime());
      expect(session.expiresAt.getTime()).toBeLessThanOrEqual(expectedMaxExpires.getTime());
    });

    it('deve usar expiração customizada quando fornecida', () => {
      const customExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000);
      validSessionData.expiresAt = customExpiry;

      const session = SessionModel.create(validSessionData);

      expect(session.expiresAt).toBe(customExpiry);
    });

    it('deve gerar timeout de inatividade padrão de 30 minutos', () => {
      const session = SessionModel.create(validSessionData);

      expect(session.inactivityTimeoutMs).toBe(30 * 60 * 1000);
    });

    it('#1330: writes the canonical names only, none of the legacy ones', () => {
      const session = SessionModel.create(validSessionData);

      for (const legacy of SessionModel.LEGACY_FIELDS) {
        expect(session).not.toHaveProperty(legacy);
      }
    });

    it('deve usar null como padrão quando userAgent/ipAddress/deviceInfo ausentes', () => {
      delete validSessionData.userAgent;
      delete validSessionData.ipAddress;
      delete validSessionData.deviceInfo;

      const session = SessionModel.create(validSessionData);

      expect(session.userAgent).toBeNull();
      expect(session.ipAddress).toBeNull();
      expect(session.deviceInfo).toBeNull();
    });

    it('deve gerar sessionId único baseado em timestamp', () => {
      // sessionId é gerado automaticamente no service, não no modelo
      // O modelo apenas retorna o que foi fornecido ou null
      // Este teste valida que o modelo permite sessionId customizado
      const customSessionId = 'session_123_1234567890';
      validSessionData.sessionId = customSessionId;

      const session = SessionModel.create(validSessionData);

      expect(session.sessionId).toBe(customSessionId);
      expect(session.sessionId).toMatch(/^session_/);
    });

    it('#974: inicializa revokedBy e revocationReason como null em uma sessão nova', () => {
      const session = SessionModel.create(validSessionData);

      expect(session).toHaveProperty('revokedBy', null);
      expect(session).toHaveProperty('revocationReason', null);
    });
  });

  describe('validate()', () => {
    it('deve validar com sucesso dados corretos', () => {
      const result = SessionModel.validate(validSessionData);

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('deve rejeitar quando userAccountId ausente', () => {
      delete validSessionData.userAccountId;
      const result = SessionModel.validate(validSessionData);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('userAccountId é obrigatório');
    });

    it('deve rejeitar quando accessTokenHash ausente', () => {
      delete validSessionData.accessTokenHash;
      const result = SessionModel.validate(validSessionData);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('accessTokenHash é obrigatório');
    });

    it('deve rejeitar quando refreshTokenHash ausente', () => {
      delete validSessionData.refreshTokenHash;
      const result = SessionModel.validate(validSessionData);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('refreshTokenHash é obrigatório');
    });

    it('deve rejeitar quando múltiplos campos obrigatórios ausentes', () => {
      delete validSessionData.userAccountId;
      delete validSessionData.accessTokenHash;
      const result = SessionModel.validate(validSessionData);

      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('isSessionActive()', () => {
    it('deve retornar true para sessão válida e ativa', () => {
      const session = SessionModel.create(validSessionData);

      const isActive = SessionModel.isSessionActive(session);

      expect(isActive).toBe(true);
    });

    it('deve retornar false para sessão revogada', () => {
      const session = SessionModel.create(validSessionData);
      session.isRevoked = true;

      const isActive = SessionModel.isSessionActive(session);

      expect(isActive).toBe(false);
    });

    it('deve retornar false para sessão inativa', () => {
      const session = SessionModel.create(validSessionData);
      session.isActive = false;

      const isActive = SessionModel.isSessionActive(session);

      expect(isActive).toBe(false);
    });

    it('deve retornar false quando sessão expirou por tempo total', () => {
      const session = SessionModel.create(validSessionData);
      // Define expiração no passado
      session.expiresAt = new Date(Date.now() - 1000);

      const isActive = SessionModel.isSessionActive(session);

      expect(isActive).toBe(false);
    });

    it('deve retornar false quando refresh token expirou', () => {
      const session = SessionModel.create(validSessionData);
      // Define refresh expiration no passado
      session.refreshExpiresAt = new Date(Date.now() - 1000);

      const isActive = SessionModel.isSessionActive(session);

      expect(isActive).toBe(false);
    });

    it('deve retornar false quando sessão ficou inativa por timeout', () => {
      const session = SessionModel.create(validSessionData);
      // Define última atividade para 31 minutos atrás (timeout = 30 min)
      session.lastActivityAt = new Date(Date.now() - 31 * 60 * 1000);

      const isActive = SessionModel.isSessionActive(session);

      expect(isActive).toBe(false);
    });

    it('deve retornar true quando sessão ainda não atingiu timeout de inatividade', () => {
      const session = SessionModel.create(validSessionData);
      // Define última atividade para 29 minutos atrás (timeout = 30 min)
      session.lastActivityAt = new Date(Date.now() - 29 * 60 * 1000);

      const isActive = SessionModel.isSessionActive(session);

      expect(isActive).toBe(true);
    });

    it('deve retornar false para null session', () => {
      const isActive = SessionModel.isSessionActive(null);

      expect(isActive).toBe(false);
    });

    it('deve retornar false para undefined session', () => {
      const isActive = SessionModel.isSessionActive(undefined);

      expect(isActive).toBe(false);
    });
  });

  // #1386: readers and filters use the canonical names only.
  describe('canonical-only readers and filters (#1386)', () => {
    it('ownerOf does not read the legacy userID', () => {
      expect(SessionModel.ownerOf({ userID: 'u' })).toBeUndefined();
    });

    it('idFilter matches the canonical sessionId only', () => {
      expect(SessionModel.idFilter('s')).toEqual({ sessionId: 's' });
    });

    it('notAccessTokenHash excludes by the canonical accessTokenHash only', () => {
      expect(SessionModel.notAccessTokenHash('h')).toEqual([{ accessTokenHash: { $ne: 'h' } }]);
    });
  });

  describe('canonicalMoveOf() (#1330)', () => {
    it('returns null for a document carrying no legacy name', () => {
      const canonical = {
        _id: 'id-1',
        sessionId: 'sess-1',
        userAccountId: 'user-1',
        accessTokenHash: 'hash-1',
        lastActivityAt: new Date(),
        sessionStartedAt: new Date(),
        inactivityTimeoutMs: 1000
      };

      expect(SessionModel.canonicalMoveOf(canonical)).toBeNull();
    });

    it('moves a legacy value over a null canonical name, guarded on it being still null or absent', () => {
      const move = SessionModel.canonicalMoveOf({ _id: 'id-1', sessionId: null, sessionID: 'x', userAccountId: 'user-1', userID: 'old' });

      expect(move).toEqual({
        filter: { _id: 'id-1', sessionId: null, sessionID: { $exists: true } },
        update: { $set: { sessionId: 'x' }, $unset: { sessionID: '', userID: '' } }
      });
    });
  });
});
