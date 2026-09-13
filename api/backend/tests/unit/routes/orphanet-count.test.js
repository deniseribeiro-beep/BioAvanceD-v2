import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import router from '../../../src/routes/orphanet-count.js';

function buildApp(db) {
  const app = express();
  app.locals.db = db;
  app.use('/api/orphanet-count', router);
  return app;
}

function buildAppWithNoDb() {
  const app = express();
  app.use('/api/orphanet-count', router);
  return app;
}

describe('orphanet-count route GET /count', () => {
  it('returns aggregated counts from app.locals.db when present', async () => {
    const expectedCounts = [
      { _id: 'pt', count: 42 },
      { _id: 'en', count: 17 }
    ];
    const toArray = vi.fn(async () => expectedCounts);
    const aggregate = vi.fn(() => ({ toArray }));
    const collection = vi.fn(() => ({ aggregate }));
    const fakeDb = { collection };

    const app = buildApp(fakeDb);
    const res = await request(app).get('/api/orphanet-count/count');

    expect(res.status).toBe(200);
    expect(res.body).toEqual(expectedCounts);
    expect(collection).toHaveBeenCalledWith('orphanet_diseases');
    expect(aggregate).toHaveBeenCalledWith([
      { $group: { _id: '$lang', count: { $sum: 1 } } }
    ]);
  });

  it('returns 500 with the error message when aggregate rejects', async () => {
    const toArray = vi.fn(async () => {
      throw new Error('aggregate boom');
    });
    const aggregate = vi.fn(() => ({ toArray }));
    const collection = vi.fn(() => ({ aggregate }));
    const fakeDb = { collection };

    const app = buildApp(fakeDb);
    const res = await request(app).get('/api/orphanet-count/count');

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'aggregate boom' });
  });

  describe('fallback connection (no app.locals.db)', () => {
    let connect;
    let close;
    let toArray;
    let aggregate;
    let collection;
    let db;

    beforeEach(async () => {
      const expectedCounts = [{ _id: 'es', count: 5 }];
      toArray = vi.fn(async () => expectedCounts);
      aggregate = vi.fn(() => ({ toArray }));
      collection = vi.fn(() => ({ aggregate }));
      db = { collection };
      connect = vi.fn(async () => {});
      close = vi.fn(async () => {});

      const mongodb = await import('mongodb');
      vi.spyOn(mongodb, 'MongoClient').mockImplementation(function () {
        return { connect, close, db: vi.fn(() => db) };
      });
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('creates its own MongoClient, queries, and closes it when app.locals.db is absent', async () => {
      const app = buildAppWithNoDb();
      const res = await request(app).get('/api/orphanet-count/count');

      expect(res.status).toBe(200);
      expect(res.body).toEqual([{ _id: 'es', count: 5 }]);
      expect(connect).toHaveBeenCalledTimes(1);
      expect(close).toHaveBeenCalledTimes(1);
      expect(collection).toHaveBeenCalledWith('orphanet_diseases');
    });

    it('returns 500 and does not throw when the fallback connect() rejects', async () => {
      connect.mockImplementation(async () => {
        throw new Error('connect boom');
      });

      const app = buildAppWithNoDb();
      const res = await request(app).get('/api/orphanet-count/count');

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: 'connect boom' });
    });

    // Issue #13: fallback branch leaked the MongoClient connection when
    // aggregate().toArray() rejected, because close() was only called on
    // the success path before the try/catch's catch block.
    it('closes the fallback MongoClient even when aggregate() rejects', async () => {
      toArray.mockImplementation(async () => {
        throw new Error('aggregate boom');
      });

      const app = buildAppWithNoDb();
      const res = await request(app).get('/api/orphanet-count/count');

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: 'aggregate boom' });
      expect(close).toHaveBeenCalledTimes(1);
    });
  });
});
