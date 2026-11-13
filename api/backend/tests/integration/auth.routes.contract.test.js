import { createRequire } from 'module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const express = require('express');
const request = require('supertest');

const authControllerMock = new Proxy(
  {},
  {
    get: (_target, prop) => {
      if (prop === 'login') {
        return async (req, res) => {
          res.status(200).json({
            success: true,
            mappedEmail: req.body.email,
            mappedMfaCode: req.body.mfaCode,
          });
        };
      }

      return async (_req, res) => res.status(204).end();
    },
  }
);

const sessionServiceMock = {
  calls: [],
  returnNull: false,
  updateActivity: async (db, token) => {
    sessionServiceMock.calls.push({ db, token });
    if (sessionServiceMock.returnNull) {
      return null;
    }
    return { lastActivity: new Date().toISOString(), expiresAt: new Date().toISOString() };
  },
  verifySession: async () => ({ valid: false, session: null }),
  invalidateSession: async () => undefined,
};

const auditLoggerMock = {
  init: () => undefined,
  logLogout: async () => undefined,
  log: async () => undefined,
};

function loadRouter() {
  const routerPath = require.resolve('../../src/interface/routes/auth.routes');
  const authControllerPath = require.resolve('../../src/controllers/auth.controller');
  const authMiddlewarePath = require.resolve('../../src/infrastructure/middleware/auth');
  const auditLoggerPath = require.resolve('../../src/utils/auditLogger');
  const sessionServicePath = require.resolve('../../src/services/session.service');
  const loggerPath = require.resolve('../../src/utils/logger');

  delete require.cache[routerPath];
  delete require.cache[authControllerPath];
  delete require.cache[authMiddlewarePath];
  delete require.cache[auditLoggerPath];
  delete require.cache[sessionServicePath];
  delete require.cache[loggerPath];

  require.cache[authControllerPath] = {
    id: authControllerPath,
    filename: authControllerPath,
    loaded: true,
    exports: authControllerMock,
  };

  require.cache[authMiddlewarePath] = {
    id: authMiddlewarePath,
    filename: authMiddlewarePath,
    loaded: true,
    exports: {
      authenticate: (req, _res, next) => {
        req.user = { userID: 'user-123', accessType: 4 };
        next();
      },
    },
  };

  require.cache[auditLoggerPath] = {
    id: auditLoggerPath,
    filename: auditLoggerPath,
    loaded: true,
    exports: auditLoggerMock,
  };

  require.cache[sessionServicePath] = {
    id: sessionServicePath,
    filename: sessionServicePath,
    loaded: true,
    exports: sessionServiceMock,
  };

  require.cache[loggerPath] = {
    id: loggerPath,
    filename: loggerPath,
    loaded: true,
    exports: { info: () => undefined, error: () => undefined },
  };

  return require('../../src/interface/routes/auth.routes');
}

function buildApp(db) {
  const app = express();
  app.use(express.json());
  app.locals.db = db;
  app.use('/api/auth', loadRouter());
  return app;
}

describe('auth.routes contract', () => {
  it('POST /api/auth/login converte username e twoFactorCode antes de delegar ao controller', async () => {
    const response = await request(buildApp({})).post('/api/auth/login').send({
      username: 'alice',
      password: 'secret',
      twoFactorCode: '123456',
    });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      success: true,
      mappedEmail: 'alice',
      mappedMfaCode: '123456',
    });
  }, 20_000);

  it('POST /api/auth/keepalive retorna 503 quando o banco nao estiver disponivel', async () => {
    sessionServiceMock.calls = [];
    const response = await request(buildApp(null))
      .post('/api/auth/keepalive')
      .set('Authorization', 'Bearer token-real');

    expect(response.status).toBe(503);
    expect(response.body).toMatchObject({
      success: false,
      error: 'Banco de dados não disponível',
    });
    expect(sessionServiceMock.calls).toHaveLength(0);
  });

  it('POST /api/auth/keepalive retorna 401 quando a sessao expirar', async () => {
    sessionServiceMock.calls = [];
    sessionServiceMock.returnNull = true;

    const response = await request(buildApp({ collection: () => ({}) }))
      .post('/api/auth/keepalive')
      .set('Authorization', 'Bearer token-real');

    expect(response.status).toBe(401);
    expect(response.body).toMatchObject({
      success: false,
      sessionExpired: true,
    });
    expect(sessionServiceMock.calls).toHaveLength(1);
    expect(sessionServiceMock.calls[0].token).toBe('token-real');
    sessionServiceMock.returnNull = false;
  });
});
