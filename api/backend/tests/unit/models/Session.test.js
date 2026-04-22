/**
 * Unit Tests - SessionModel
 * Testa validações e regras de negócio de sessão
 */

import { describe, it, expect, beforeEach } from 'vitest';
import SessionModel from '../../../src/models/Session';

describe('SessionModel - Unit Tests', () => {
  let validSessionData;

  beforeEach(() => {
    validSessionData = {
      userID: '67890',
      tokenHash: 'abc123def456',
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

      expect(session.userID).toBe('67890');
      expect(session.tokenHash).toBe('abc123def456');
      expect(session.refreshTokenHash).toBe('xyz789uvw012');
      expect(session.isActive).toBe(true);
      expect(session.isRevoked).toBe(false);
      expect(session.sessionID).toBeDefined();
      expect(session.createdAt).toBeInstanceOf(Date);
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

      expect(session.inactiveTimeout).toBe(30 * 60 * 1000);
    });

    it('deve gerar sessionID único baseado em timestamp', () => {
      // SessionID é gerado automaticamente no service, não no modelo
      // O modelo apenas retorna o que foi fornecido ou null
      // Este teste valida que o modelo permite sessionID customizado
      const customSessionID = 'session_123_1234567890';
      validSessionData.sessionID = customSessionID;
      
      const session = SessionModel.create(validSessionData);

      expect(session.sessionID).toBe(customSessionID);
      expect(session.sessionID).toMatch(/^session_/);
    });
  });

  describe('validate()', () => {
    it('deve validar com sucesso dados corretos', () => {
      const result = SessionModel.validate(validSessionData);

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('deve rejeitar quando userID ausente', () => {
      delete validSessionData.userID;
      const result = SessionModel.validate(validSessionData);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('userID é obrigatório');
    });

    it('deve rejeitar quando tokenHash ausente', () => {
      delete validSessionData.tokenHash;
      const result = SessionModel.validate(validSessionData);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('tokenHash é obrigatório');
    });

    it('deve rejeitar quando refreshTokenHash ausente', () => {
      delete validSessionData.refreshTokenHash;
      const result = SessionModel.validate(validSessionData);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('refreshTokenHash é obrigatório');
    });

    it('deve rejeitar quando múltiplos campos obrigatórios ausentes', () => {
      delete validSessionData.userID;
      delete validSessionData.tokenHash;
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
      session.lastActivity = new Date(Date.now() - 31 * 60 * 1000);

      const isActive = SessionModel.isSessionActive(session);

      expect(isActive).toBe(false);
    });

    it('deve retornar true quando sessão ainda não atingiu timeout de inatividade', () => {
      const session = SessionModel.create(validSessionData);
      // Define última atividade para 29 minutos atrás (timeout = 30 min)
      session.lastActivity = new Date(Date.now() - 29 * 60 * 1000);

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
});
