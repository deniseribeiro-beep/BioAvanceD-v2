
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
const request = require('supertest');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'vitest-secret-key';

const app = require('../../app');
const sampleService = require('../../src/services/sample.service');
const sessionService = require('../../src/services/session.service');
const { buildRbacCollections } = require('../factories/rbac.factory');
const {
  makeAuthToken,
  TEST_USER_ACCOUNT_IDS,
} = require('../factories/auth.factory');


const rbacCollections = buildRbacCollections([
  { userAccountId: TEST_USER_ACCOUNT_IDS[1], accessType: 1 },
  { userAccountId: TEST_USER_ACCOUNT_IDS[2], accessType: 2 },
  { userAccountId: TEST_USER_ACCOUNT_IDS[4], accessType: 4 },
]);

describe('RNF008 - RBAC (Least Privilege) em DELETE /api/samples/:id', () => {
  beforeEach(() => {
    app.locals.db = {
      collection: (name) => {
        if (rbacCollections[name]) return rbacCollections[name];
        return {
          insertOne: vi.fn(),
          updateOne: vi.fn(),
          findOne: vi.fn(),
        };
      },
    };

    vi.spyOn(sessionService, 'verifySession').mockResolvedValue({ valid: true, session: { sessionID: 'session-rbac-1' } });
    vi.spyOn(sessionService, 'updateActivity').mockResolvedValue({ sessionID: 'session-rbac-1' });
    vi.spyOn(sampleService, 'deleteSample').mockResolvedValue({ deletedCount: 1 });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('deve retornar 403 para perfil Pesquisador', async () => {
    const token = makeAuthToken(1);

    const response = await request(app)
      .delete('/api/samples/507f1f77bcf86cd799439011')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);
    expect(sampleService.deleteSample).not.toHaveBeenCalled();
  });

  it('deve retornar 403 para perfil Técnico', async () => {
    const token = makeAuthToken(2);

    const response = await request(app)
      .delete('/api/samples/507f1f77bcf86cd799439011')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);
    expect(sampleService.deleteSample).not.toHaveBeenCalled();
  });

  it('deve permitir exclusão para perfil Admin', async () => {
    const token = makeAuthToken(4);

    const response = await request(app)
      .delete('/api/samples/507f1f77bcf86cd799439011')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(sampleService.deleteSample).toHaveBeenCalledTimes(1);
  });
});
