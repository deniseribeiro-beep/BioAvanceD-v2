import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
const request = require('supertest');
const jwt = require('jsonwebtoken');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'vitest-secret-key';

const app = require('../../app');
const sessionService = require('../../src/services/session.service');
const { createCollectionMock, createDbMock } = require('../factories/db.factory');
const { buildRbacCollections } = require('../factories/rbac.factory');

// RNF003 C1, C2, C4 (#1468): the Administrador records outages and announced
// maintenance windows and reads the monthly availability report.

const RECORDS = '/api/availability/records';
const REPORT = '/api/availability/report';

const rbacCollectionsAdmin = buildRbacCollections([{ userAccountId: 'qa-1', accessType: 4 }]);
const rbacCollectionsCoordinator = buildRbacCollections([{ userAccountId: 'qa-3', accessType: 3 }]);

function makeToken(userID, accessType) {
  return jwt.sign(
    { userID, accessType, roleName: accessType >= 4 ? 'Administrador' : 'Coordenador', name: 'QA', mfaVerified: true },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
}

const asAdmin = (req) => req.set('Authorization', `Bearer ${makeToken('qa-1', 4)}`);
const asCoordinator = (req) => req.set('Authorization', `Bearer ${makeToken('qa-3', 3)}`);

function givenSession() {
  vi.spyOn(sessionService, 'verifySession').mockResolvedValue({ valid: true, session: { sessionID: 'sess-1' } });
  vi.spyOn(sessionService, 'updateActivity').mockResolvedValue({ sessionID: 'sess-1' });
}

beforeEach(() => { givenSession(); });
afterEach(() => { vi.restoreAllMocks(); });

const OUTAGE = {
  kind: 'outage',
  startedAt: '2000-02-15T10:00:00.000Z',
  endedAt: '2000-02-15T11:00:00.000Z',
  cause: 'Falha do banco',
  impact: 'API indisponível',
};
const MAINTENANCE = {
  kind: 'maintenance',
  startedAt: '2000-02-10T02:00:00.000Z',
  endedAt: '2000-02-10T04:00:00.000Z',
  announcedAt: '2000-02-01T00:00:00.000Z',
  cause: 'Atualização',
  impact: 'Plataforma fora do ar',
};

describe('POST /api/availability/records', () => {
  it('answers 201 with the stored record for an Administrador', async () => {
    const availabilityRecords = createCollectionMock();
    app.locals.db = createDbMock({ availabilityRecords, ...rbacCollectionsAdmin });

    const res = await asAdmin(request(app).post(RECORDS).send({ ...MAINTENANCE, extra: 'ignored' }));

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({ ...MAINTENANCE, createdBy: 'qa-1' });
    expect(typeof res.body.data.recordId).toBe('string');
    expect(res.body.data).not.toHaveProperty('_id');
    expect(res.body.data).not.toHaveProperty('extra');
    expect(availabilityRecords.insertOne).toHaveBeenCalledTimes(1);
    expect(availabilityRecords.insertOne.mock.calls[0][0]).not.toHaveProperty('extra');
  });

  it('answers 422 with a details array for an invalid record', async () => {
    const availabilityRecords = createCollectionMock();
    app.locals.db = createDbMock({ availabilityRecords, ...rbacCollectionsAdmin });

    const res = await asAdmin(request(app).post(RECORDS).send({ ...OUTAGE, announcedAt: '2000-02-01T00:00:00Z' }));

    expect(res.status).toBe(422);
    expect(res.body).toEqual({
      success: false,
      error: 'Dados inválidos',
      message: 'announcedAt não se aplica a indisponibilidade',
      details: ['announcedAt não se aplica a indisponibilidade'],
    });
    expect(availabilityRecords.insertOne).not.toHaveBeenCalled();
  });

  it('refuses a Coordenador with 403', async () => {
    app.locals.db = createDbMock({ ...rbacCollectionsCoordinator });

    const res = await asCoordinator(request(app).post(RECORDS).send(OUTAGE));

    expect(res.status).toBe(403);
  });
});

describe('GET /api/availability/records', () => {
  it('answers 200 with the month records for an Administrador', async () => {
    const availabilityRecords = createCollectionMock({
      find: vi.fn(() => {
        const cursor = {};
        cursor.sort = vi.fn(() => cursor);
        cursor.limit = vi.fn(() => cursor);
        cursor.toArray = vi.fn().mockResolvedValue([{ recordId: 'r-1', ...OUTAGE }]);
        return cursor;
      }),
    });
    app.locals.db = createDbMock({ availabilityRecords, ...rbacCollectionsAdmin });

    const res = await asAdmin(request(app).get(RECORDS).query({ month: '2000-02' }));

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([{ recordId: 'r-1', ...OUTAGE }]);
    const [filter, options] = availabilityRecords.find.mock.calls[0];
    expect(filter).toEqual({
      startedAt: { $lt: new Date('2000-03-01T00:00:00Z') },
      endedAt: { $gt: new Date('2000-02-01T00:00:00Z') },
    });
    expect(options.projection).toEqual({ _id: 0 });
  });

  it('answers 400 on a missing month', async () => {
    app.locals.db = createDbMock({ ...rbacCollectionsAdmin });

    const res = await asAdmin(request(app).get(RECORDS));

    expect(res.status).toBe(400);
  });

  it('refuses a Coordenador with 403', async () => {
    app.locals.db = createDbMock({ ...rbacCollectionsCoordinator });

    const res = await asCoordinator(request(app).get(RECORDS).query({ month: '2000-02' }));

    expect(res.status).toBe(403);
  });
});

describe('GET /api/availability/report', () => {
  it('answers 200 with the computed availability over the month records', async () => {
    const availabilityRecords = createCollectionMock({
      find: vi.fn(() => {
        const cursor = {};
        cursor.sort = vi.fn(() => cursor);
        cursor.limit = vi.fn(() => cursor);
        cursor.toArray = vi.fn().mockResolvedValue([MAINTENANCE, OUTAGE]);
        return cursor;
      }),
    });
    app.locals.db = createDbMock({ availabilityRecords, ...rbacCollectionsAdmin });

    const res = await asAdmin(request(app).get(REPORT).query({ month: '2000-02' }));

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      month: '2000-02',
      partial: false,
      asOf: '2000-03-01T00:00:00.000Z',
      periodMinutes: 41760,
      maintenanceMinutes: 120,
      maintenanceLimitMinutes: 240,
      maintenanceWithinLimit: true,
      outageMinutes: 60,
      availabilityPercent: 99.8559,
      targetPercent: 99.5,
      met: true,
      evaluable: true,
      records: [MAINTENANCE, OUTAGE],
    });
  });

  it('answers 422 on a month that has not started', async () => {
    const availabilityRecords = createCollectionMock();
    app.locals.db = createDbMock({ availabilityRecords, ...rbacCollectionsAdmin });
    const now = new Date();
    const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    const month = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}`;

    const res = await asAdmin(request(app).get(REPORT).query({ month }));

    expect(res.status).toBe(422);
    expect(res.body).toEqual({
      success: false,
      error: 'Parâmetro inválido',
      message: `Mês ainda não iniciado: ${month}`,
      details: [`Mês ainda não iniciado: ${month}`],
    });
    expect(availabilityRecords.find).not.toHaveBeenCalled();
  });

  it('answers 400 on month=2000-13', async () => {
    app.locals.db = createDbMock({ ...rbacCollectionsAdmin });

    const res = await asAdmin(request(app).get(REPORT).query({ month: '2000-13' }));

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ success: false, error: 'Parâmetro inválido', message: 'month deve estar no formato YYYY-MM' });
  });

  it('refuses a Coordenador with 403', async () => {
    app.locals.db = createDbMock({ ...rbacCollectionsCoordinator });

    const res = await asCoordinator(request(app).get(REPORT).query({ month: '2000-02' }));

    expect(res.status).toBe(403);
  });
});
