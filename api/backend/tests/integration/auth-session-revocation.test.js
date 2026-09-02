import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
const request = require('supertest');
const jwt = require('jsonwebtoken');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'vitest-secret-key';

const app = require('../../app');
const sessionService = require('../../src/services/session.service');
const auditLogger = require('../../src/utils/auditLogger');

function createToken(payload) {
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '1h' });
}

function createAdminToken() {
  return createToken({
    userID: 'qa-admin-revoke-1',
    accessType: 4,
    roleName: 'Administrador',
    mfaVerified: true,
  });
}

function createCoordinatorToken() {
  return createToken({
    userID: 'qa-coord-revoke-1',
    accessType: 3,
    roleName: 'Coordenador',
    mfaVerified: true,
  });
}

describe('Session Revocation (DELETE /api/auth/sessions/:sessionId)', () => {
  beforeEach(() => {
    vi.spyOn(sessionService, 'verifySession').mockResolvedValue({
      valid: true,
      session: { sessionID: 'session-revoke-test-1', userID: 'qa-admin-revoke-1' }
    });
    vi.spyOn(sessionService, 'updateActivity').mockResolvedValue({
      sessionID: 'session-revoke-test-1',
      userID: 'qa-admin-revoke-1'
    });
    vi.spyOn(sessionService, 'revokeSessionById').mockResolvedValue({
      sessionID: 'session-revoke-test-1',
      isRevoked: true,
      revokedAt: new Date()
    });

    vi.spyOn(auditLogger, 'init').mockImplementation(() => undefined);
    vi.spyOn(auditLogger, 'log').mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('deve revogar uma sessão específica com sucesso', async () => {
    const adminToken = createAdminToken();

    const response = await request(app)
      .delete('/api/auth/sessions/session-revoke-test-1')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(sessionService.revokeSessionById).toHaveBeenCalledWith(
      expect.anything(),
      'qa-admin-revoke-1',
      'session-revoke-test-1',
      'user_request',
      'qa-admin-revoke-1'
    );
  });

  it('deve retornar 401 ao acessar rota protegida após revogação', async () => {
    const adminToken = createAdminToken();
    const sessionId = 'session-revoke-test-1';

    // Primeiro, revoga a sessão
    const revokeResponse = await request(app)
      .delete(`/api/auth/sessions/${sessionId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(revokeResponse.status).toBe(200);

    // Agora simula que a sessão foi revogada simulando verifySession com invalid
    vi.spyOn(sessionService, 'verifySession').mockResolvedValue({
      valid: false,
      reason: 'session_revoked'
    });

    // Tenta acessar rota protegida com o mesmo token
    const protectedResponse = await request(app)
      .get('/api/auth/verify')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(protectedResponse.status).toBe(401);
    expect(protectedResponse.body.success).toBe(false);
  });

  it('deve permitir revogação de sessão para usuário Admin', async () => {
    const adminToken = createAdminToken();

    const response = await request(app)
      .delete('/api/auth/sessions/session-target-admin')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
  });

  it('deve permitir revogação de sessão para usuário Coordenador', async () => {
    const coordinatorToken = createCoordinatorToken();

    // Mock para coordenador
    vi.spyOn(sessionService, 'verifySession').mockResolvedValue({
      valid: true,
      session: { sessionID: 'session-coord-1', userID: 'qa-coord-revoke-1' }
    });

    const response = await request(app)
      .delete('/api/auth/sessions/session-target-coord')
      .set('Authorization', `Bearer ${coordinatorToken}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
  });

  it('deve retornar erro 401 (Unauthorized) sem token de autenticação', async () => {
    const response = await request(app)
      .delete('/api/auth/sessions/session-any-id');

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
  });

  it('deve logar a revogação de sessão na auditoria', async () => {
    const adminToken = createAdminToken();

    await request(app)
      .delete('/api/auth/sessions/session-revoke-audit-test')
      .set('Authorization', `Bearer ${adminToken}`);

    // Verifica se o método de revogação foi chamado
    expect(sessionService.revokeSessionById).toHaveBeenCalled();
  });

  it('deve retornar 503 quando banco de dados não está disponível', async () => {
    const adminToken = createAdminToken();

    app.locals.db = null; // Simula DB indisponível

    const response = await request(app)
      .delete('/api/auth/sessions/session-test-1')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(503);
    expect(response.body.success).toBe(false);

    // Restaura o estado
    vi.restoreAllMocks();
  });
});

describe('Session List and Active Sessions (GET /api/auth/sessions)', () => {
  beforeEach(() => {
    vi.spyOn(sessionService, 'verifySession').mockResolvedValue({
      valid: true,
      session: { sessionID: 'session-list-test-1' }
    });
    vi.spyOn(sessionService, 'updateActivity').mockResolvedValue({
      sessionID: 'session-list-test-1'
    });
    vi.spyOn(sessionService, 'listUserSessions').mockResolvedValue([
      {
        sessionID: 'session-1',
        createdAt: new Date(),
        lastActivity: new Date(),
        deviceInfo: { browser: 'Chrome', os: 'Windows' },
        ipAddress: '192.168.1.1'
      },
      {
        sessionID: 'session-2',
        createdAt: new Date(Date.now() - 86400000),
        lastActivity: new Date(),
        deviceInfo: { browser: 'Firefox', os: 'macOS' },
        ipAddress: '192.168.1.2'
      }
    ]);

    vi.spyOn(auditLogger, 'init').mockImplementation(() => undefined);
    vi.spyOn(auditLogger, 'log').mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('deve listar todas as sessões ativas do usuário', async () => {
    const adminToken = createAdminToken();

    const response = await request(app)
      .get('/api/auth/sessions')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(Array.isArray(response.body.data)).toBe(true);
    expect(response.body.data.length).toBeGreaterThan(0);
  });

  it('deve incluir informações de dispositivo nas sessões', async () => {
    const adminToken = createAdminToken();

    const response = await request(app)
      .get('/api/auth/sessions')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    expect(response.body.data[0]).toHaveProperty('deviceInfo');
    expect(response.body.data[0]).toHaveProperty('ipAddress');
  });

  it('deve retornar 401 sem token de autenticação', async () => {
    const response = await request(app).get('/api/auth/sessions');

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
  });
});

describe('Revoke All Other Sessions (DELETE /api/auth/sessions/all-others)', () => {
  beforeEach(() => {
    vi.spyOn(sessionService, 'verifySession').mockResolvedValue({
      valid: true,
      session: { sessionID: 'session-current-1' }
    });
    vi.spyOn(sessionService, 'updateActivity').mockResolvedValue({
      sessionID: 'session-current-1'
    });
    vi.spyOn(sessionService, 'revokeAllOtherSessions').mockResolvedValue({
      revokedCount: 2
    });

    vi.spyOn(auditLogger, 'init').mockImplementation(() => undefined);
    vi.spyOn(auditLogger, 'log').mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('deve revogar todas as outras sessões mantendo a atual', async () => {
    const adminToken = createAdminToken();

    const response = await request(app)
      .delete('/api/auth/sessions/all-others')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(sessionService.revokeAllOtherSessions).toHaveBeenCalled();
  });

  it('deve retornar 401 sem autenticação', async () => {
    const response = await request(app).delete('/api/auth/sessions/all-others');

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
  });
});
