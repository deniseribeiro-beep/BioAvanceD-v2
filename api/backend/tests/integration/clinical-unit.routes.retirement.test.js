import { describe, it, expect } from 'vitest';
const request = require('supertest');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'vitest-secret-key';

const app = require('../../app');

describe('legacy /api/clinical-units surface (#357: retired, no code reads the clinicalUnits collection anymore)', () => {
  it('no longer routes GET /api/clinical-units', async () => {
    const res = await request(app).get('/api/clinical-units');
    expect(res.status).toBe(404);
  });

  it('no longer routes GET /api/clinical-units/search', async () => {
    const res = await request(app).get('/api/clinical-units/search?q=onco');
    expect(res.status).toBe(404);
  });

  it('no longer routes POST /api/clinical-units', async () => {
    const res = await request(app).post('/api/clinical-units').send({ name: 'Cardiologia' });
    expect(res.status).toBe(404);
  });
});
