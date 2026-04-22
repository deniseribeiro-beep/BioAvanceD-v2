import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import router from '../../src/interface/routes/equipment.routes.js';

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
  return jwt.sign(
    { userID: 'admin-test', accessType: 4, roleName: 'Administrador' },
    process.env.JWT_SECRET
  );
}

describe('equipment.routes quarantine flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('Caminho feliz: status normal nao dispara quarentena', async () => {
    const foundEquipment = {
      _id: '507f1f77bcf86cd799439011',
      equipmentID: 101,
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
    const usersCollection = {
      findOne: vi.fn(async () => ({ _id: 'admin-test', anonId: 'anon-admin-test' }))
    };

    const startSession = vi.fn();
    const db = {
      collection: vi.fn((name) => {
        if (name === 'equipment') return equipmentCollection;
        if (name === 'sessions') return sessionsCollection;
        if (name === 'users') return usersCollection;
        if (name === 'logs') return logsCollection;
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
      .send({ status: 'active' });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.quarantine).toEqual({ triggered: false });

    expect(isQuarantineTriggerStatusMock).toHaveBeenCalledWith('active');
    expect(quarantineByEquipmentStatusMock).not.toHaveBeenCalled();
    expect(startSession).not.toHaveBeenCalled();
    expect(updateOne).toHaveBeenCalledTimes(1);
  });

  it('Gatilho: status offline dispara transacao e quarentena', async () => {
    const foundEquipment = {
      _id: '507f1f77bcf86cd799439011',
      equipmentID: 202,
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
    const usersCollection = {
      findOne: vi.fn(async () => ({ _id: 'admin-test', anonId: 'anon-admin-test' }))
    };

    const withTransaction = vi.fn(async (cb) => cb());
    const endSession = vi.fn(async () => undefined);
    const session = { withTransaction, endSession };
    const startSession = vi.fn(() => session);

    const db = {
      collection: vi.fn((name) => {
        if (name === 'equipment') return equipmentCollection;
        if (name === 'sessions') return sessionsCollection;
        if (name === 'users') return usersCollection;
        if (name === 'logs') return logsCollection;
        return logsCollection;
      }),
      client: { startSession }
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
      .send({ status: 'offline' });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.quarantine.triggered).toBe(true);

    expect(startSession).toHaveBeenCalledTimes(1);
    expect(withTransaction).toHaveBeenCalledTimes(1);
    expect(endSession).toHaveBeenCalledTimes(1);

    expect(isQuarantineTriggerStatusMock).toHaveBeenCalledWith('offline');
    expect(quarantineByEquipmentStatusMock).toHaveBeenCalledTimes(1);
    expect(quarantineByEquipmentStatusMock).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        _id: foundEquipment._id,
        equipmentID: foundEquipment.equipmentID,
        status: 'offline'
      }),
      'offline',
      expect.objectContaining({ session })
    );

    expect(updateOne).toHaveBeenCalledWith(
      { _id: expect.anything() },
      { $set: expect.objectContaining({ status: 'offline' }) },
      { session }
    );
  });
});
