import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import router from '../../src/interface/routes/equipment.routes.js';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { buildRbacCollections } = require('../factories/rbac.factory');
const {
  makeAuthToken,
  makeLegacyClaimsToken,
  buildAuthenticatedCollections,
  userForAccessType,
  TEST_USER_ACCOUNT_IDS,
} = require('../factories/auth.factory');


const isQuarantineTriggerStatusMock = vi.fn();
const quarantineByEquipmentStatusMock = vi.fn();

function buildAppWithDb(db) {
  const app = express();
  app.use(express.json());
  app.locals.db = db;
  app.locals.quarantineService = {
    isQuarantineTriggerStatus: isQuarantineTriggerStatusMock,
    quarantineByEquipmentStatus: quarantineByEquipmentStatusMock
  };
  app.use('/equipment', router);
  return app;
}

function buildAdminToken() {
  return makeAuthToken(4);
}

describe('equipment.routes quarantine flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('Caminho feliz: status normal nao dispara quarentena', async () => {
    const foundEquipment = {
      _id: '507f1f77bcf86cd799439011',
      equipmentID: 101,
      equipmentDescription: 'Freezer de teste',
      status: 'Active'
    };

    const updateOne = vi.fn(async () => ({ matchedCount: 1 }));
    const findOne = vi.fn(async () => foundEquipment);

    const logsCollection = { insertOne: vi.fn(async () => ({ insertedId: 'log-1' })) };
    const equipmentCollection = { findOne, updateOne };
    const sessionsCollection = {
      findOne: vi.fn(async () => ({
        sessionID: 'session-1',
        tokenHash: 'mock-token-hash',
        refreshTokenHash: 'mock-refresh-hash',
        lastActivity: new Date(),
        expiresAt: new Date(Date.now() + 60_000),
        refreshExpiresAt: new Date(Date.now() + 60_000),
        inactiveTimeout: 60_000,
        isActive: true,
        isRevoked: false
      })),
      updateOne: vi.fn(async () => ({ matchedCount: 1 }))
    };
    const authCols = buildAuthenticatedCollections([4]);
    const admin = userForAccessType(4);
    const startSession = vi.fn();
    const rbacCollections = buildRbacCollections([{ userAccountId: admin.userAccountId, accessType: 4 }]);
    const db = {
      collection: vi.fn((name) => {
        if (name === 'equipment') return equipmentCollection;
        if (name === 'sessions') return sessionsCollection;
        if (name === 'userAccounts') return authCols.userAccounts;
        if (name === 'actors') return authCols.actors;
        if (name === 'logs') return logsCollection;
        if (rbacCollections[name]) return rbacCollections[name];
        return logsCollection;
      }),
      client: { startSession }
    };

    isQuarantineTriggerStatusMock.mockReturnValue(false);

    const app = buildAppWithDb(db);
    const token = buildAdminToken();

    const response = await request(app)
      .put('/equipment/507f1f77bcf86cd799439011')
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'Active' });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.quarantine).toEqual({ triggered: false });

    expect(isQuarantineTriggerStatusMock).toHaveBeenCalledWith('Active');
    expect(quarantineByEquipmentStatusMock).not.toHaveBeenCalled();
    expect(startSession).not.toHaveBeenCalled();
    expect(updateOne).toHaveBeenCalledTimes(1);
  });

  // #883: Maintenance is a valid Equipment status but must NOT cascade
  // quarantine (routine maintenance ≠ fault/offline/repair).
  it('Gatilho: status Maintenance NAO dispara quarentena (#883)', async () => {
    const foundEquipment = {
      _id: '507f1f77bcf86cd799439011',
      equipmentID: 202,
      equipmentDescription: 'Freezer de teste',
      status: 'Active'
    };

    const updateOne = vi.fn(async () => ({ matchedCount: 1 }));
    const findOne = vi.fn(async () => foundEquipment);

    const logsCollection = { insertOne: vi.fn(async () => ({ insertedId: 'log-2' })) };
    const equipmentCollection = { findOne, updateOne };
    const sessionsCollection = {
      findOne: vi.fn(async () => ({
        sessionID: 'session-2',
        tokenHash: 'mock-token-hash',
        refreshTokenHash: 'mock-refresh-hash',
        lastActivity: new Date(),
        expiresAt: new Date(Date.now() + 60_000),
        refreshExpiresAt: new Date(Date.now() + 60_000),
        inactiveTimeout: 60_000,
        isActive: true,
        isRevoked: false
      })),
      updateOne: vi.fn(async () => ({ matchedCount: 1 }))
    };
    const authCols = buildAuthenticatedCollections([4]);
    const admin = userForAccessType(4);

    const withTransaction = vi.fn(async (cb) => cb());
    const endSession = vi.fn(async () => undefined);
    const session = { withTransaction, endSession };
    const startSession = vi.fn(() => session);
    const helloCommand = vi.fn(async () => ({ setName: 'rs0' }));

    const rbacCollections = buildRbacCollections([{ userAccountId: admin.userAccountId, accessType: 4 }]);
    const db = {
      collection: vi.fn((name) => {
        if (name === 'equipment') return equipmentCollection;
        if (name === 'sessions') return sessionsCollection;
        if (name === 'userAccounts') return authCols.userAccounts;
        if (name === 'actors') return authCols.actors;
        if (name === 'logs') return logsCollection;
        if (rbacCollections[name]) return rbacCollections[name];
        return logsCollection;
      }),
      client: { startSession, db: vi.fn(() => ({ command: helloCommand })) }
    };

    isQuarantineTriggerStatusMock.mockReturnValue(false);

    const app = buildAppWithDb(db);
    const token = buildAdminToken();

    const response = await request(app)
      .put('/equipment/507f1f77bcf86cd799439011')
      .set('Authorization', `Bearer ${token}`)
      .set('user-agent', 'vitest-agent')
      .send({ status: 'Maintenance' });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.quarantine).toEqual({ triggered: false });

    expect(startSession).not.toHaveBeenCalled();
    expect(isQuarantineTriggerStatusMock).toHaveBeenCalledWith('Maintenance');
    expect(quarantineByEquipmentStatusMock).not.toHaveBeenCalled();

    expect(updateOne).toHaveBeenCalledWith(
      { _id: expect.anything() },
      { $set: expect.objectContaining({ status: 'Maintenance' }) }
    );
  });

  // #951 + #883: when the quarantine service reports a real trigger
  // (offline/repair — not Maintenance/Inactive), a standalone topology
  // falls back to sequential write without startSession.
  it('Gatilho sem suporte a transacao: standalone topology falls back to sequential write', async () => {
    const foundEquipment = {
      _id: '507f1f77bcf86cd799439011',
      equipmentID: 303,
      equipmentDescription: 'Freezer de teste',
      status: 'Active'
    };

    const updateOne = vi.fn(async () => ({ matchedCount: 1 }));
    const findOne = vi.fn(async () => foundEquipment);

    const logsCollection = { insertOne: vi.fn(async () => ({ insertedId: 'log-3' })) };
    const equipmentCollection = { findOne, updateOne };
    const sessionsCollection = {
      findOne: vi.fn(async () => ({
        sessionID: 'session-3',
        tokenHash: 'mock-token-hash',
        refreshTokenHash: 'mock-refresh-hash',
        lastActivity: new Date(),
        expiresAt: new Date(Date.now() + 60_000),
        refreshExpiresAt: new Date(Date.now() + 60_000),
        inactiveTimeout: 60_000,
        isActive: true,
        isRevoked: false
      })),
      updateOne: vi.fn(async () => ({ matchedCount: 1 }))
    };
    const authCols = buildAuthenticatedCollections([4]);
    const admin = userForAccessType(4);
    const startSession = vi.fn();
    const helloCommand = vi.fn(async () => ({}));

    const rbacCollections = buildRbacCollections([{ userAccountId: admin.userAccountId, accessType: 4 }]);
    const db = {
      collection: vi.fn((name) => {
        if (name === 'equipment') return equipmentCollection;
        if (name === 'sessions') return sessionsCollection;
        if (name === 'userAccounts') return authCols.userAccounts;
        if (name === 'actors') return authCols.actors;
        if (name === 'logs') return logsCollection;
        if (rbacCollections[name]) return rbacCollections[name];
        return logsCollection;
      }),
      client: { startSession, db: vi.fn(() => ({ command: helloCommand })) }
    };

    // Mock simulates a remaining product trigger (offline/repair). Status
    // body stays model-valid; trigger decision comes from the service.
    isQuarantineTriggerStatusMock.mockReturnValue(true);
    quarantineByEquipmentStatusMock.mockResolvedValue({
      triggered: true,
      matched: 1,
      quarantined: 1,
      movements: 1,
      reason: 'status:offline'
    });

    const app = buildAppWithDb(db);
    const token = buildAdminToken();

    const response = await request(app)
      .put('/equipment/507f1f77bcf86cd799439011')
      .set('Authorization', `Bearer ${token}`)
      .set('user-agent', 'vitest-agent')
      .send({ status: 'Active' });

    expect(response.status).toBe(200);
    expect(response.body.quarantine.triggered).toBe(true);

    expect(startSession).not.toHaveBeenCalled();
    expect(quarantineByEquipmentStatusMock).toHaveBeenCalledTimes(1);
    expect(quarantineByEquipmentStatusMock.mock.calls[0][3]).not.toHaveProperty('session');

    expect(updateOne).toHaveBeenCalledWith(
      { _id: expect.anything() },
      { $set: expect.objectContaining({ status: 'Active' }) }
    );
  });

  // #868 + #951: transaction path when quarantineService reports a trigger
  // (not Maintenance/Inactive — those no longer cascade per #883).
  it('Gatilho com replica set: status trigger dispara transacao e quarentena', async () => {
    const foundEquipment = {
      _id: '507f1f77bcf86cd799439011',
      equipmentID: 202,
      equipmentDescription: 'Freezer de teste',
      status: 'Active'
    };

    const updateOne = vi.fn(async () => ({ matchedCount: 1 }));
    const findOne = vi.fn(async () => foundEquipment);

    const logsCollection = { insertOne: vi.fn(async () => ({ insertedId: 'log-2b' })) };
    const equipmentCollection = { findOne, updateOne };
    const sessionsCollection = {
      findOne: vi.fn(async () => ({
        sessionID: 'session-2b',
        tokenHash: 'mock-token-hash',
        refreshTokenHash: 'mock-refresh-hash',
        lastActivity: new Date(),
        expiresAt: new Date(Date.now() + 60_000),
        refreshExpiresAt: new Date(Date.now() + 60_000),
        inactiveTimeout: 60_000,
        isActive: true,
        isRevoked: false
      })),
      updateOne: vi.fn(async () => ({ matchedCount: 1 }))
    };
    const authCols = buildAuthenticatedCollections([4]);
    const admin = userForAccessType(4);

    const withTransaction = vi.fn(async (cb) => cb());
    const endSession = vi.fn(async () => undefined);
    const session = { withTransaction, endSession };
    const startSession = vi.fn(() => session);
    const helloCommand = vi.fn(async () => ({ setName: 'rs0' }));

    const rbacCollections = buildRbacCollections([{ userAccountId: admin.userAccountId, accessType: 4 }]);
    const db = {
      collection: vi.fn((name) => {
        if (name === 'equipment') return equipmentCollection;
        if (name === 'sessions') return sessionsCollection;
        if (name === 'userAccounts') return authCols.userAccounts;
        if (name === 'actors') return authCols.actors;
        if (name === 'logs') return logsCollection;
        if (rbacCollections[name]) return rbacCollections[name];
        return logsCollection;
      }),
      client: { startSession, db: vi.fn(() => ({ command: helloCommand })) }
    };

    isQuarantineTriggerStatusMock.mockReturnValue(true);
    quarantineByEquipmentStatusMock.mockResolvedValue({
      triggered: true,
      matched: 2,
      quarantined: 2,
      movements: 2,
      reason: 'status:offline'
    });

    const app = buildAppWithDb(db);
    const token = buildAdminToken();

    const response = await request(app)
      .put('/equipment/507f1f77bcf86cd799439011')
      .set('Authorization', `Bearer ${token}`)
      .set('user-agent', 'vitest-agent')
      .send({ status: 'Active' });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.quarantine.triggered).toBe(true);

    expect(startSession).toHaveBeenCalledTimes(1);
    expect(withTransaction).toHaveBeenCalledTimes(1);
    expect(endSession).toHaveBeenCalledTimes(1);

    expect(isQuarantineTriggerStatusMock).toHaveBeenCalledWith('Active');
    expect(quarantineByEquipmentStatusMock).toHaveBeenCalledTimes(1);
    expect(quarantineByEquipmentStatusMock).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        _id: foundEquipment._id,
        equipmentID: foundEquipment.equipmentID,
        status: 'Active'
      }),
      'Active',
      expect.objectContaining({ session })
    );

    expect(updateOne).toHaveBeenCalledWith(
      { _id: expect.anything() },
      { $set: expect.objectContaining({ status: 'Active' }) },
      { session }
    );
  });
});
