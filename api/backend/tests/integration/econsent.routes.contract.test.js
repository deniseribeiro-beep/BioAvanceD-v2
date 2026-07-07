import { createRequire } from 'module';
import { describe, expect, it, beforeEach } from 'vitest';

const require = createRequire(import.meta.url);
const express = require('express');
const request = require('supertest');

const routePath = require.resolve('../../src/routes/eConsent');
const notificationPath = require.resolve('../../src/services/notification.service');
const patientModelPath = require.resolve('../../src/models/Patient');

function loadRouter() {
  delete require.cache[routePath];
  delete require.cache[notificationPath];
  delete require.cache[patientModelPath];

  require.cache[notificationPath] = {
    id: notificationPath,
    filename: notificationPath,
    loaded: true,
    exports: {
      sendConsentLink: async () => undefined,
    },
  };

  require.cache[patientModelPath] = {
    id: patientModelPath,
    filename: patientModelPath,
    loaded: true,
    exports: {
      findOne: async () => null,
    },
  };

  return require('../../src/routes/eConsent');
}

function buildApp() {
  const app = express();
  app.use(express.json());
  app.locals.db = {};
  app.use('/api/econsent', loadRouter());
  return app;
}

describe('eConsent contract', () => {
  beforeEach(() => {
    process.env.CONSENT_SECRET = 'test-consent-secret';
  });

  it('POST /api/econsent/generate-link rejeita payload incompleto', async () => {
    const response = await request(buildApp())
      .post('/api/econsent/generate-link')
      .send({ patientId: '12345678' });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      error: 'patientId e email obrigatórios',
    });
  });

  it('GET /api/econsent/validate/:token rejeita token invalido sem depender do banco', async () => {
    const response = await request(buildApp()).get('/api/econsent/validate/token-invalido');

    expect(response.status).toBe(401);
    expect(response.body).toMatchObject({
      error: 'Token inválido ou expirado',
    });
  });
});
