import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';
import express from 'express';
import request from 'supertest';

const require = createRequire(import.meta.url);

const authPath = require.resolve('../../src/infrastructure/middleware/auth');
const routePath = require.resolve('../../src/interface/routes/phone-codes.routes');

const allPaths = [authPath, routePath];

function clearCache() {
  for (const p of allPaths) delete require.cache[p];
}

function loadRoute() {
  clearCache();
  const authModule = require(authPath);
  authModule.authenticate = (req, _res, next) => {
    req.user = { userID: 'user-1' };
    next();
  };
  return require(routePath);
}

function buildApp(router, docs) {
  const app = express();
  app.use(express.json());
  app.locals.db = {
    collection: vi.fn(() => ({
      createIndex: vi.fn().mockResolvedValue('ok'),
      find: vi.fn((query = {}) => {
        const filtered = docs.filter((doc) => {
          if (query.$or) {
            return query.$or.some((clause) => {
              const [field, condition] = Object.entries(clause)[0];
              const value = String(doc[field] || '');
              if (condition?.$regex) {
                return new RegExp(condition.$regex, condition.$options || '').test(value);
              }
              return false;
            });
          }
          if (query.$text) return false;
          return true;
        });
        return {
          sort: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          toArray: vi.fn().mockResolvedValue(filtered),
        };
      }),
    })),
  };
  app.use('/api/phone-codes', router);
  return app;
}

describe('phone-codes.routes item 8 residual branches', () => {
  beforeEach(() => {
    clearCache();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    clearCache();
  });

  it('maps name/label aliases and drops rows without dial digits', async () => {
    const docs = [
      { _id: '1', name: 'Nameland', dialCode: '+11' },
      { _id: '2', label: 'Labelland', phoneCode: '22' },
      { _id: '3', country: 'NoDigits', dialCode: 'abc' },
    ];

    const res = await request(buildApp(loadRoute(), docs)).get('/api/phone-codes/search');

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ countryName: 'Nameland', dialCode: '+11' }),
      expect.objectContaining({ countryName: 'Labelland', dialCode: '+22' }),
    ]));
    expect(res.body.data.find((row) => row.countryName === 'NoDigits')).toBeUndefined();
  });

  it('deduplicates merged search hits that share the same _id', async () => {
    const duplicate = { _id: 'dup-1', countryName: 'Dupland', dialCode: '+99' };
    const docs = [duplicate, { ...duplicate }];

    const app = express();
    app.use(express.json());
    const find = vi.fn((query = {}) => {
      if (query.$text) {
        return {
          sort: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          toArray: vi.fn().mockResolvedValue([duplicate]),
        };
      }
      return {
        sort: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        toArray: vi.fn().mockResolvedValue(docs),
      };
    });
    app.locals.db = {
      collection: vi.fn(() => ({
        createIndex: vi.fn().mockResolvedValue('ok'),
        find,
      })),
    };
    clearCache();
    const authModule = require(authPath);
    authModule.authenticate = (req, _res, next) => next();
    app.use('/api/phone-codes', require(routePath));

    const res = await request(app).get('/api/phone-codes/search').query({ q: 'Dup' });

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toEqual(expect.objectContaining({
      countryName: 'Dupland',
      dialCode: '+99',
    }));
  });
});
