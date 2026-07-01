import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
const request = require('supertest');
const jwt = require('jsonwebtoken');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'vitest-secret-key';

const app = require('../../app');
const sessionService = require('../../src/services/session.service');
const { createCollectionMock, createDbMock } = require('../factories/db.factory');

function makeToken(accessType = 2) {
  return jwt.sign(
    { userID: 'qa-1', accessType, roleName: 'Técnico', name: 'QA', mfaVerified: true },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
}

function givenSession() {
  vi.spyOn(sessionService, 'verifySession').mockResolvedValue({ valid: true, session: { sessionID: 'sess-1' } });
  vi.spyOn(sessionService, 'updateActivity').mockResolvedValue({ sessionID: 'sess-1' });
}

const FAKE_CODE = { _id: '507f1f77bcf86cd799439011', countryName: 'Brazil', iso2: 'BR', dialCode: '+55' };

beforeEach(() => { givenSession(); });
afterEach(() => { vi.restoreAllMocks(); });

describe('GET /api/phone-codes/search', () => {
  it('returns 401 without token', async () => {
    const res = await request(app).get('/api/phone-codes/search');
    expect(res.status).toBe(401);
  });

  it('returns all phone codes when no query term', async () => {
    const coll = createCollectionMock({
      find: vi.fn().mockReturnValue({
        sort: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        toArray: vi.fn().mockResolvedValue([FAKE_CODE]),
      }),
      createIndex: vi.fn().mockResolvedValue('ok'),
    });
    app.locals.db = createDbMock({ phoneCodes: coll });

    const res = await request(app)
      .get('/api/phone-codes/search')
      .set('Authorization', `Bearer ${makeToken()}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('returns filtered results when query term provided', async () => {
    const coll = createCollectionMock({
      find: vi.fn().mockReturnValue({
        sort: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        toArray: vi.fn().mockResolvedValue([FAKE_CODE]),
        project: vi.fn().mockReturnThis(),
      }),
      createIndex: vi.fn().mockResolvedValue('ok'),
    });
    app.locals.db = createDbMock({ phoneCodes: coll });

    const res = await request(app)
      .get('/api/phone-codes/search?q=Bra')
      .set('Authorization', `Bearer ${makeToken()}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('returns empty array when no codes match', async () => {
    const coll = createCollectionMock({
      find: vi.fn().mockReturnValue({
        sort: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        toArray: vi.fn().mockResolvedValue([]),
      }),
      createIndex: vi.fn().mockResolvedValue('ok'),
    });
    app.locals.db = createDbMock({ phoneCodes: coll });

    const res = await request(app)
      .get('/api/phone-codes/search')
      .set('Authorization', `Bearer ${makeToken()}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });
});
