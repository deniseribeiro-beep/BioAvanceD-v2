const request = require('supertest');
const jwt = require('jsonwebtoken');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'vitest-secret-key';

const app = require('../../app');
const sampleService = require('../../src/services/sample.service');
const sessionService = require('../../src/services/session.service');

function createToken(payload) {
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '1h' });
}

describe('RNF008 - RBAC (Least Privilege) em DELETE /api/samples/:id', () => {
  beforeEach(() => {
    app.locals.db = {
      collection: () => ({
        insertOne: vi.fn(),
        updateOne: vi.fn(),
        findOne: vi.fn(),
      }),
    };

    vi.spyOn(sessionService, 'verifySession').mockResolvedValue({ valid: true, session: { sessionID: 'session-rbac-1' } });
    vi.spyOn(sessionService, 'updateActivity').mockResolvedValue({ sessionID: 'session-rbac-1' });
    vi.spyOn(sampleService, 'deleteSample').mockResolvedValue({ deletedCount: 1 });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('deve retornar 403 para perfil Pesquisador', async () => {
    const token = createToken({
      userID: 'qa-pesquisador-1',
      accessType: 1,
      roleName: 'Pesquisador',
      mfaVerified: true,
    });

    const response = await request(app)
      .delete('/api/samples/507f1f77bcf86cd799439011')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);
    expect(sampleService.deleteSample).not.toHaveBeenCalled();
  });

  it('deve retornar 403 para perfil Técnico', async () => {
    const token = createToken({
      userID: 'qa-tecnico-1',
      accessType: 2,
      roleName: 'Técnico',
      mfaVerified: true,
    });

    const response = await request(app)
      .delete('/api/samples/507f1f77bcf86cd799439011')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);
    expect(sampleService.deleteSample).not.toHaveBeenCalled();
  });

  it('deve permitir exclusão para perfil Admin', async () => {
    const token = createToken({
      userID: 'qa-admin-1',
      accessType: 4,
      roleName: 'Administrador',
      mfaVerified: true,
    });

    const response = await request(app)
      .delete('/api/samples/507f1f77bcf86cd799439011')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(sampleService.deleteSample).toHaveBeenCalledTimes(1);
  });
});
