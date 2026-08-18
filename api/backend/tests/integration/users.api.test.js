import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
const request = require('supertest');
const jwt = require('jsonwebtoken');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'vitest-secret-key';

const app = require('../../app');
const sessionService = require('../../src/services/session.service');
const { createCollectionMock, createDbMock } = require('../factories/db.factory');
const { buildUser, buildUserRegistrationPayload } = require('../factories/user.factory');
const { buildRbacCollections } = require('../factories/rbac.factory');

function createCoordinatorToken() {
  return jwt.sign(
    {
      userID: 'qa-coord-1',
      accessType: 3,
      roleName: 'Coordenador',
      name: 'QA Coordenador',
      mfaVerified: true,
    },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
}

describe('RF003 - POST /api/users/register', () => {
  function givenAuthenticatedSession() {
    vi.spyOn(sessionService, 'verifySession').mockResolvedValue({ valid: true, session: { sessionID: 'session-1' } });
    vi.spyOn(sessionService, 'updateActivity').mockResolvedValue({ sessionID: 'session-1' });
  }

  function givenUsersCollection(overrides = {}) {
    const usersCollection = createCollectionMock(overrides);
    app.locals.db = createDbMock({
      users: usersCollection,
      ...buildRbacCollections([{ userAccountId: 'qa-coord-1', accessType: 3 }]),
    });
    return usersCollection;
  }

  async function whenRegisterUser(payload) {
    return request(app)
      .post('/api/users/register')
      .set('Authorization', `Bearer ${createCoordinatorToken()}`)
      .send(payload);
  }

  beforeEach(() => {
    givenAuthenticatedSession();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('deve bloquear criação de usuário com senha fraca (regex)', async () => {
    // Given
    givenUsersCollection({
      findOne: vi.fn().mockResolvedValue(null),
      insertOne: vi.fn(),
      updateOne: vi.fn(),
    });

    // When
    const response = await whenRegisterUser(
      buildUserRegistrationPayload({
        name: 'Usuário Fraco',
        email: 'fraco.qa@example.com',
        username: 'fraco.qa',
        password: '12345678',
      })
    );

    // Then
    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(String(response.body.message || '').toLowerCase()).toContain('password');
    expect(String(response.body.message || '').toLowerCase()).toContain('senha');
  });

  it('deve bloquear criação de usuário com e-mail já existente', async () => {
    // Given
    const findOne = vi.fn().mockResolvedValueOnce(
      buildUser({
        _id: 'existing-user-1',
        email: 'duplicado.qa@example.com',
        username: 'ja.existe',
      })
    );
    const insertOne = vi.fn();
    givenUsersCollection({ findOne, insertOne, updateOne: vi.fn() });

    // When
    const response = await whenRegisterUser(
      buildUserRegistrationPayload({
        name: 'Usuário Duplicado',
        email: 'duplicado.qa@example.com',
        username: 'novo.username',
      })
    );

    // Then
    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(String(response.body.message || '').toLowerCase()).toContain('já cadastrado');
    expect(insertOne).not.toHaveBeenCalled();
  });

  it('#615: cria a UserRoleAssignment com scopeType/scopeId a partir do organizationId do payload', async () => {
    // Given
    const usersCollection = createCollectionMock({
      findOne: vi.fn().mockResolvedValue(null),
      insertOne: vi.fn().mockResolvedValue({ insertedId: 'new-user-1' }),
      updateOne: vi.fn(),
    });
    const rbacCollections = buildRbacCollections([{ userAccountId: 'qa-coord-1', accessType: 3 }]);
    app.locals.db = createDbMock({ users: usersCollection, ...rbacCollections });

    // When
    const response = await whenRegisterUser(
      buildUserRegistrationPayload({
        name: 'Usuário Escopo',
        email: 'escopo.qa@example.com',
        username: 'escopo.qa',
        accessType: 2,
        organizationId: 'org-1',
      })
    );

    // Then
    expect(response.status).toBe(201);
    expect(rbacCollections.userRoleAssignments.insertOne).toHaveBeenCalledWith(
      expect.objectContaining({ scopeType: 'organization', scopeId: 'org-1' })
    );
  });
});
