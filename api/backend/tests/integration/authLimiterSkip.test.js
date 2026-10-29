import { describe, it, expect } from 'vitest';
const express = require('express');
const rateLimit = require('express-rate-limit');
const request = require('supertest');
const { skipAuthBudget } = require('../../src/infrastructure/middleware/authLimiterSkip');

// #1253: GET /api/auth/password-policy is outside the strict auth budget, and
// every secret-verifying route stays inside it. app.js skips its limiters
// under NODE_ENV=test, so this mounts the real skip on a limiter of the same
// shape, at the same /api/auth prefix.
function buildApp() {
  const app = express();
  app.use('/api/auth', rateLimit({ windowMs: 60 * 1000, max: 1, standardHeaders: true, legacyHeaders: false, skip: skipAuthBudget }));
  app.get('/api/auth/password-policy', (req, res) => res.json({ ok: true }));
  app.post('/api/auth/login', (req, res) => res.json({ ok: true }));
  app.post('/api/auth/password-policy', (req, res) => res.json({ ok: true }));
  return app;
}

describe('authLimiter skip (#1253)', () => {
  it('does not count GET /password-policy, however often it is fetched', async () => {
    const app = buildApp();
    for (let i = 0; i < 3; i += 1) {
      expect((await request(app).get('/api/auth/password-policy')).status).toBe(200);
    }
    expect((await request(app).post('/api/auth/login')).status).toBe(200);
  });

  it('still counts the login, and any other method on the same path', async () => {
    const app = buildApp();
    expect((await request(app).post('/api/auth/login')).status).toBe(200);
    expect((await request(app).post('/api/auth/login')).status).toBe(429);
    expect((await request(app).post('/api/auth/password-policy')).status).toBe(429);
  });
});
