import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import router from '../../../src/routes/orphanet-count.js';

function buildApp(db) {
  const app = express();
  app.locals.db = db;
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
});
