import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
const request = require('supertest');
const jwt = require('jsonwebtoken');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'vitest-secret-key';

const app = require('../../app');
const sessionService = require('../../src/services/session.service');
const { createCollectionMock, createDbMock } = require('../factories/db.factory');
const {
  makeAuthToken,
  makeLegacyClaimsToken,
  buildAuthenticatedCollections,
  userForAccessType,
  TEST_USER_ACCOUNT_IDS,
} = require('../factories/auth.factory');


function makeToken(accessType = 2) {
  return makeAuthToken(accessType);
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

  it('returns 503 when db is unavailable', async () => {
    app.locals.db = null;

    const res = await request(app)
      .get('/api/phone-codes/search')
      .set('Authorization', `Bearer ${makeToken()}`);
    expect(res.status).toBe(503);
    expect(res.body.success).toBe(false);
  });

  it('returns 500 when the search query throws', async () => {
    const coll = createCollectionMock({
      find: vi.fn().mockImplementation(() => {
        throw new Error('boom');
      }),
      createIndex: vi.fn().mockResolvedValue('ok'),
    });
    app.locals.db = createDbMock({ phoneCodes: coll });

    const res = await request(app)
      .get('/api/phone-codes/search')
      .set('Authorization', `Bearer ${makeToken()}`);
    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toBe('boom');
  });

  it('skips text search and uses regex-only matching for a single-character term', async () => {
    const findSpy = vi.fn().mockReturnValue({
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([FAKE_CODE]),
      project: vi.fn().mockReturnThis(),
    });
    const coll = createCollectionMock({
      find: findSpy,
      createIndex: vi.fn().mockResolvedValue('ok'),
    });
    app.locals.db = createDbMock({ phoneCodes: coll });

    const res = await request(app)
      .get('/api/phone-codes/search?q=B')
      .set('Authorization', `Bearer ${makeToken()}`);
    expect(res.status).toBe(200);
    // one call for the (skipped) empty textMatches path never queries $text;
    // the single find() invocation here is the regex fallback.
    expect(findSpy).toHaveBeenCalledTimes(1);
    expect(findSpy.mock.calls[0][0]).not.toHaveProperty('$text');
  });

  it('deduplicates documents appearing in both text and regex matches', async () => {
    const cursor = () => ({
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([FAKE_CODE]),
      project: vi.fn().mockReturnThis(),
    });
    const coll = createCollectionMock({
      find: vi.fn().mockImplementation(() => cursor()),
      createIndex: vi.fn().mockResolvedValue('ok'),
    });
    app.locals.db = createDbMock({ phoneCodes: coll });

    const res = await request(app)
      .get('/api/phone-codes/search?q=Br&limit=1')
      .set('Authorization', `Bearer ${makeToken()}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });

  it('filters out normalized documents missing a dial code or country name', async () => {
    const incomplete = { _id: '507f1f77bcf86cd799439012', countryName: 'NoDial', dialCode: '' };
    const coll = createCollectionMock({
      find: vi.fn().mockReturnValue({
        sort: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        toArray: vi.fn().mockResolvedValue([incomplete]),
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

  it('normalizes country name and dial code from alternate field names', async () => {
    const altDoc = { _id: '507f1f77bcf86cd799439013', name: 'Testland', code: '99', countryCode: 'tl' };
    const coll = createCollectionMock({
      find: vi.fn().mockReturnValue({
        sort: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        toArray: vi.fn().mockResolvedValue([altDoc]),
      }),
      createIndex: vi.fn().mockResolvedValue('ok'),
    });
    app.locals.db = createDbMock({ phoneCodes: coll });

    const res = await request(app)
      .get('/api/phone-codes/search')
      .set('Authorization', `Bearer ${makeToken()}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([{
      _id: altDoc._id,
      countryName: 'Testland',
      iso2: 'TL',
      dialCode: '+99',
      searchLabel: 'Testland (+99)',
    }]);
  });

  it('clamps an out-of-range limit query param to the 1-50 bounds', async () => {
    const limitSpy = vi.fn().mockReturnThis();
    const coll = createCollectionMock({
      find: vi.fn().mockReturnValue({
        sort: vi.fn().mockReturnThis(),
        limit: limitSpy,
        toArray: vi.fn().mockResolvedValue([]),
      }),
      createIndex: vi.fn().mockResolvedValue('ok'),
    });
    app.locals.db = createDbMock({ phoneCodes: coll });

    await request(app)
      .get('/api/phone-codes/search?limit=-5')
      .set('Authorization', `Bearer ${makeToken()}`);
    expect(limitSpy).toHaveBeenCalledWith(1);

    await request(app)
      .get('/api/phone-codes/search?limit=9999')
      .set('Authorization', `Bearer ${makeToken()}`);
    expect(limitSpy).toHaveBeenCalledWith(50);

    await request(app)
      .get('/api/phone-codes/search?limit=notanumber')
      .set('Authorization', `Bearer ${makeToken()}`);
    expect(limitSpy).toHaveBeenCalledWith(20);
  });
});
