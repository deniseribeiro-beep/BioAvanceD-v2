import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const express = require('express');
const request = require('supertest');
const { ObjectId } = require('mongodb');

const modulePaths = {
  auth: require.resolve('../../src/infrastructure/middleware/auth'),
  rbac: require.resolve('../../src/infrastructure/middleware/rbac'),
  assignments: require.resolve('../../src/services/rbac-assignment.service'),
  route: require.resolve('../../src/interface/routes/reports.routes'),
};

function setCachedModule(modulePath, exportsObject) {
  require.cache[modulePath] = {
    id: modulePath,
    filename: modulePath,
    loaded: true,
    exports: exportsObject,
  };
}

function cursor(rows = []) {
  return {
    sort() { return this; },
    limit() { return this; },
    async toArray() { return rows; },
  };
}

describe('reports.routes item 8 more residual canonical branches', () => {
  let scope;
  let scopeUsable;
  let auditReader;

  beforeEach(() => {
    vi.clearAllMocks();
    scope = { scope: 'global', organizationIds: [] };
    scopeUsable = true;
    auditReader = true;

    for (const modulePath of Object.values(modulePaths)) {
      delete require.cache[modulePath];
    }

    setCachedModule(modulePaths.auth, {
      authenticate: (req, _res, next) => {
        req.user = { userID: 'user-1' };
        next();
      },
    });
    setCachedModule(modulePaths.rbac, {
      requirePermission: () => (_req, _res, next) => next(),
    });
    setCachedModule(modulePaths.assignments, {
      resolveUserOrganizationScope: vi.fn(async () => scope),
      isOrganizationScopeUsable: vi.fn(() => scopeUsable),
      applyOrganizationScopeFilter: vi.fn((query, currentScope, field) => (
        currentScope.scope === 'global'
          ? query
          : { ...query, [field]: { $in: currentScope.organizationIds } }
      )),
      isRecordInOrganizationScope: vi.fn((record, currentScope, field) => {
        if (currentScope.scope === 'global') return true;
        const value = record?.[field];
        return Array.isArray(value)
          ? value.some((v) => currentScope.organizationIds.includes(v))
          : Boolean(value) && currentScope.organizationIds.includes(value);
      }),
      isAuditReader: vi.fn(async () => auditReader),
    });
  });

  afterEach(() => {
    for (const modulePath of Object.values(modulePaths)) {
      delete require.cache[modulePath];
    }
  });

  function buildApp(db) {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.app.locals.db = db;
      next();
    });
    app.use('/api/reports', require(modulePaths.route));
    return app;
  }

  const noDbCases = [
    ['get', '/api/reports'],
    ['get', `/api/reports/${new ObjectId().toString()}`],
    ['post', '/api/reports/generate'],
    ['delete', `/api/reports/${new ObjectId().toString()}`],
    ['get', '/api/reports/samples/filters'],
    ['post', '/api/reports/samples/preview'],
    ['get', '/api/reports/samples/export'],
    ['get', '/api/reports/samples/export/pdf'],
  ];

  it.each(noDbCases)('%s %s returns 503 when the database is unavailable', async (verb, url) => {
    const app = buildApp(undefined);
    const req = request(app)[verb](url);
    if (verb === 'post') req.send({ reportType: 'samples', filters: {} });
    const res = await req;
    expect(res.status).toBe(503);
  });

  it('GET / refuses a caller whose organization scope is unusable', async () => {
    scopeUsable = false;
    const db = { collection: vi.fn(() => { throw new Error('must not query reports'); }) };

    const res = await request(buildApp(db)).get('/api/reports');

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Sem organização atribuída');
  });

  it('GET / applies organizationIds scoping for a usable organization caller', async () => {
    scope = { scope: 'organization', organizationIds: ['org-1'] };
    const find = vi.fn((query) => {
      expect(query).toEqual({ organizationIds: { $in: ['org-1'] } });
      return cursor([{ reportID: 7, reportType: 'samples', organizationIds: ['org-1'] }]);
    });
    const db = {
      collection(name) {
        expect(name).toBe('reports');
        return { find };
      },
    };

    const res = await request(buildApp(db)).get('/api/reports');

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].reportID).toBe(7);
  });

  it('GET /:id resolves a numeric reportID and returns it when in scope', async () => {
    scope = { scope: 'organization', organizationIds: ['org-1'] };
    const findOne = vi.fn(async (query) => {
      expect(query).toEqual({ reportID: 17 });
      return { reportID: 17, reportType: 'samples', organizationIds: ['org-1'] };
    });
    const db = { collection: vi.fn(() => ({ findOne })) };

    const res = await request(buildApp(db)).get('/api/reports/17');

    expect(res.status).toBe(200);
    expect(res.body.reportID).toBe(17);
  });

  it('GET /:id falls back to ObjectId after a non-numeric identifier', async () => {
    const id = new ObjectId().toString();
    const findOne = vi.fn(async (query) => {
      expect(String(query._id)).toBe(id);
      return { _id: new ObjectId(id), reportID: 18, reportType: 'samples', organizationIds: [] };
    });
    const db = { collection: vi.fn(() => ({ findOne })) };

    const res = await request(buildApp(db)).get(`/api/reports/${id}`);

    expect(res.status).toBe(200);
    expect(findOne).toHaveBeenCalledTimes(1);
  });

  it('GET /:id returns 404 for a valid ObjectId with no report', async () => {
    const id = new ObjectId().toString();
    const db = { collection: vi.fn(() => ({ findOne: vi.fn().mockResolvedValue(null) })) };

    const res = await request(buildApp(db)).get(`/api/reports/${id}`);

    expect(res.status).toBe(404);
  });

  it('GET /:id returns 403 when a report belongs only to another organization', async () => {
    scope = { scope: 'organization', organizationIds: ['org-1'] };
    const db = {
      collection: vi.fn(() => ({
        findOne: vi.fn().mockResolvedValue({
          reportID: 19,
          reportType: 'samples',
          organizationIds: ['org-2'],
        }),
      })),
    };

    const res = await request(buildApp(db)).get('/api/reports/19');

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Acesso negado');
  });

  it('POST /generate rejects a missing reportType before preview work', async () => {
    const db = { collection: vi.fn(() => ({ })) };

    const res = await request(buildApp(db)).post('/api/reports/generate').send({ filters: {} });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('reportType é obrigatório');
  });

  function auditDeniedDb() {
    return {
      collection(name) {
        if (name === 'reportTemplates') {
          return {
            findOne: vi.fn().mockResolvedValue({
              code: 'access_logs',
              handlerKey: 'accessLogs',
              templateStatus: 'active',
            }),
          };
        }
        throw new Error(`collection ${name} must not be reached after audit authorization denial`);
      },
    };
  }

  it('POST /generate maps the audit-reader governance denial to HTTP 403', async () => {
    auditReader = false;

    const res = await request(buildApp(auditDeniedDb()))
      .post('/api/reports/generate')
      .send({ reportType: 'access_logs', filters: {} });

    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/Admin ou Auditor/);
  });

  it('POST /:type/preview maps the audit-reader governance denial to HTTP 403', async () => {
    auditReader = false;

    const res = await request(buildApp(auditDeniedDb()))
      .post('/api/reports/access_logs/preview')
      .send({ filters: {} });

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toMatch(/Admin ou Auditor/);
  });

  it('GET /:type/export maps the audit-reader governance denial to HTTP 403', async () => {
    auditReader = false;

    const res = await request(buildApp(auditDeniedDb())).get('/api/reports/access_logs/export');

    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/Admin ou Auditor/);
  });

  it('GET /:type/export/pdf maps the audit-reader governance denial to HTTP 403', async () => {
    auditReader = false;

    const res = await request(buildApp(auditDeniedDb())).get('/api/reports/access_logs/export/pdf');

    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/Admin ou Auditor/);
  });

  it('GET /:type/filters returns 404 for a normalized code with no active template', async () => {
    const db = {
      collection(name) {
        expect(name).toBe('reportTemplates');
        return { findOne: vi.fn().mockResolvedValue(null) };
      },
    };

    const res = await request(buildApp(db)).get('/api/reports/not_configured/filters');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      error: 'Tipo de relatório desconhecido',
      reportType: 'not_configured',
    });
  });

  it('DELETE /:id returns 404 when a numeric reportID does not match', async () => {
    const deleteOne = vi.fn().mockResolvedValue({ deletedCount: 0 });
    const db = { collection: vi.fn(() => ({ deleteOne })) };

    const res = await request(buildApp(db)).delete('/api/reports/77');

    expect(res.status).toBe(404);
    expect(deleteOne).toHaveBeenCalledWith({ reportID: 77 });
  });
});
