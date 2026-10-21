import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import express from 'express';
import request from 'supertest';

const require = createRequire(import.meta.url);

// #1394: the first require of the route's module tree costs seconds, so it is
// paid here, at import time, rather than inside the first case's timeout.
require('../../src/interface/routes/dictionary.routes');

// #1301: /api/dictionary was mounted with no authentication. The mount
// module app.js uses now runs `authenticate` ahead of every dictionary route,
// so an anonymous request is refused before the route (and its Neo4j, Redis
// and release lookups) runs.
function buildApp() {
  const app = express();
  app.use('/api/dictionary', require('../../src/interface/routes/dictionary.routes'));
  return app;
}

describe('/api/dictionary requires authentication (#1301)', () => {
  it.each([
    '/api/dictionary/suggest?orphaCode=558',
    '/api/dictionary/search?query=fabry',
    '/api/dictionary/disease-profile?orphaCode=558',
  ])('GET %s without a token answers 401', async (path) => {
    const res = await request(buildApp()).get(path);

    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ success: false, error: 'Token não fornecido' });
  });

  it('a malformed Authorization header is refused the same way', async () => {
    const res = await request(buildApp())
      .get('/api/dictionary/suggest?orphaCode=558')
      .set('Authorization', 'Basic abc');

    expect(res.status).toBe(401);
  });
});
