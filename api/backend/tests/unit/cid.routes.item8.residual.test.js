import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';
import express from 'express';
import request from 'supertest';

const require = createRequire(import.meta.url);

const authPath = require.resolve('../../src/infrastructure/middleware/auth');
const rbacPath = require.resolve('../../src/infrastructure/middleware/rbac');
const cidControllerPath = require.resolve('../../src/controllers/cid.controller');
const routePath = require.resolve('../../src/interface/routes/cid.routes.js');

const allPaths = [authPath, rbacPath, cidControllerPath, routePath];

function clearCache() {
  for (const p of allPaths) delete require.cache[p];
}

function loadRoute() {
  clearCache();

  const authModule = require(authPath);
  authModule.authenticate = (req, _res, next) => {
    req.user = { id: 'user-1', roleLevel: 4 };
    next();
  };

  const rbacModule = require(rbacPath);
  rbacModule.requireRole = () => (_req, _res, next) => next();

  const cidControllerModule = require(cidControllerPath);
  cidControllerModule.search = (_req, res) => res.status(200).json({ success: true, data: [] });

  return require(routePath);
}

function buildApp(router, db = {}) {
  const app = express();
  app.use(express.json());
  app.locals.db = db;
  app.use('/api/cids', router);
  return app;
}

function listDb(docs) {
  const toArray = vi.fn().mockResolvedValue(docs);
  const sort = vi.fn().mockReturnValue({ toArray });
  const find = vi.fn().mockReturnValue({ sort });
  return { collection: vi.fn().mockReturnValue({ find }) };
}

describe('cid.routes item 8 residual branches', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    clearCache();
  });

  it('normalizes numeric active flags 1/0 and false-like strings', async () => {
    const db = listDb([
      { _id: 'n1', Capitulo: 'C', Codigo_Tabulacao: 'A01', Descricao: 'One', active: 1 },
      { _id: 'n0', Capitulo: 'C', Codigo_Tabulacao: 'A02', Descricao: 'Zero', active: 0 },
      { _id: 'f1', Capitulo: 'C', Codigo_Tabulacao: 'A03', Descricao: 'False', active: 'false' },
      { _id: 'f2', Capitulo: 'C', Codigo_Tabulacao: 'A04', Descricao: 'No', is_active: '0' },
      { _id: 'f3', Capitulo: 'C', Codigo_Tabulacao: 'A05', Descricao: 'Inactive', is_active: 'inactive' },
    ]);

    const res = await request(buildApp(loadRoute(), db)).get('/api/cids');

    expect(res.status).toBe(200);
    expect(res.body.data.map((row) => row.active)).toEqual([true, false, false, false, false]);
  });

  it('maps document aliases chapter/code/cid10/orpha_code onto the canonical CID shape', async () => {
    const db = listDb([
      {
        _id: 'alias-1',
        chapter: 'Cap X',
        code: 'Z99',
        description: 'Alias description',
        cid10: 'Z99.9',
        orpha_code: 'ORPHA999',
        active: 'sim',
      },
    ]);

    const res = await request(buildApp(loadRoute(), db)).get('/api/cids');

    expect(res.status).toBe(200);
    expect(res.body.data[0]).toEqual(expect.objectContaining({
      Capitulo: 'Cap X',
      Codigo_Tabulacao: 'Z99',
      Descricao: 'Alias description',
      Codigos_CID10: 'Z99.9',
      ORPHA: 'ORPHA999',
      active: true,
    }));
  });

  it('falls back Codigos_CID10 to code when only the code alias is present', async () => {
    const db = listDb([{ _id: 'code-only', code: 'C10', Descricao: 'Only code' }]);

    const res = await request(buildApp(loadRoute(), db)).get('/api/cids');

    expect(res.status).toBe(200);
    expect(res.body.data[0].Codigo_Tabulacao).toBe('C10');
    expect(res.body.data[0].Codigos_CID10).toBe('C10');
  });
});
