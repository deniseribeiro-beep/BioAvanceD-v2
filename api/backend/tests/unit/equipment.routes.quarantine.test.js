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

  // #868: 'offline' is a quarantine-trigger value but not one
  // EquipmentModel.validate accepts, so this test now exercises the fix
  // with 'Maintenance' -- valid per the model *and* a real trigger member
  // of QUARANTINE_TRIGGER_STATUSES (case-insensitively) -- to keep
  // covering the transaction/quarantine path without relying on a status
  // the PUT handler would now reject with 422 before ever reaching it.
  it('Gatilho: status Maintenance dispara transacao e quarentena', async () => {
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

    // #951: isTransactionCapable probes `hello` on the admin db, not just
    // the presence of startSession -- a replica set answer (setName) is
    // what makes this client transaction-capable.
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
      reason: 'status:maintenance'
    });

    const app = buildAppWithDb(db);
    const token = buildAdminToken();

    const response = await request(app)
      .put('/equipment/507f1f77bcf86cd799439011')
      .set('Authorization', `Bearer ${token}`)
      .set('user-agent', 'vitest-agent')
      .send({ status: 'Maintenance' });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.quarantine.triggered).toBe(true);

    expect(startSession).toHaveBeenCalledTimes(1);
    expect(withTransaction).toHaveBeenCalledTimes(1);
    expect(endSession).toHaveBeenCalledTimes(1);

    expect(isQuarantineTriggerStatusMock).toHaveBeenCalledWith('Maintenance');
    expect(quarantineByEquipmentStatusMock).toHaveBeenCalledTimes(1);
    expect(quarantineByEquipmentStatusMock).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        _id: foundEquipment._id,
        equipmentID: foundEquipment.equipmentID,
        status: 'Maintenance'
      }),
      'Maintenance',
      expect.objectContaining({ session })
    );

    expect(updateOne).toHaveBeenCalledWith(
      { _id: expect.anything() },
      { $set: expect.objectContaining({ status: 'Maintenance' }) },
      { session }
    );
  });

  // #951: `typeof client.startSession === 'function'` is true on a real
  // MongoClient against a standalone mongod too -- it is not sufficient to
  // gate transaction use. This client exposes startSession (like a real
  // MongoClient would) but `hello` answers standalone, so
  // isTransactionCapable must resolve false and the sequential fallback
  // must run without ever calling startSession.
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

    isQuarantineTriggerStatusMock.mockReturnValue(true);
    quarantineByEquipmentStatusMock.mockResolvedValue({
      triggered: true,
      matched: 1,
      quarantined: 1,
      movements: 1,
      reason: 'status:maintenance'
    });

    const app = buildAppWithDb(db);
    const token = buildAdminToken();

    const response = await request(app)
      .put('/equipment/507f1f77bcf86cd799439011')
      .set('Authorization', `Bearer ${token}`)
      .set('user-agent', 'vitest-agent')
      .send({ status: 'Maintenance' });

    expect(response.status).toBe(200);
    expect(response.body.quarantine.triggered).toBe(true);

    expect(startSession).not.toHaveBeenCalled();
    expect(quarantineByEquipmentStatusMock).toHaveBeenCalledTimes(1);
    expect(quarantineByEquipmentStatusMock.mock.calls[0][3]).not.toHaveProperty('session');

    expect(updateOne).toHaveBeenCalledWith(
      { _id: expect.anything() },
      { $set: expect.objectContaining({ status: 'Maintenance' }) }
    );
  });
});
