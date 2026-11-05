// #1447: tests/vitest.setup.js routes request(app) over one listening server
// and keep-alive sockets, instead of a fresh server and connection per
// request. These cases pin that, and that the app still sees the request
// as the test sent it.
const express = require('express');
const request = require('supertest');

function socketRecorder() {
  const seen = [];
  const app = express();
  app.use(express.json());
  app.all('/echo', (req, res) => {
    seen.push(req);
    res.json({
      url: req.originalUrl,
      method: req.method,
      body: req.body,
      custom: req.headers['x-case'] || null,
      headerNames: Object.keys(req.headers),
      rawHeaderNames: req.rawHeaders.filter((_, i) => i % 2 === 0).map((h) => h.toLowerCase()),
    });
  });
  return { app, seen };
}

describe('supertest loopback (#1447)', () => {
  it('reuses one connection for sequential requests to a fresh request(app) each time', async () => {
    const { app, seen } = socketRecorder();
    await request(app).get('/echo').expect(200);
    await request(app).get('/echo').expect(200);
    await request(app).get('/echo').expect(200);
    expect(seen).toHaveLength(3);
    expect(seen[1].socket).toBe(seen[0].socket);
    expect(seen[2].socket).toBe(seen[0].socket);
  });

  it('reuses the connection across two different apps', async () => {
    const first = socketRecorder();
    const second = socketRecorder();
    await request(first.app).get('/echo').expect(200);
    await request(second.app).get('/echo').expect(200);
    expect(first.seen).toHaveLength(1);
    expect(second.seen).toHaveLength(1);
    expect(second.seen[0].socket).toBe(first.seen[0].socket);
  });

  it('hands each app only its own requests when they run concurrently', async () => {
    const first = socketRecorder();
    const second = socketRecorder();
    const results = await Promise.all([
      request(first.app).post('/echo?n=1').set('x-case', 'a').send({ n: 1 }),
      request(second.app).post('/echo?n=2').set('x-case', 'b').send({ n: 2 }),
      request(first.app).put('/echo?n=3').set('x-case', 'c').send({ n: 3 }),
    ]);
    expect(results.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(first.seen.map((r) => r.headers['x-case'])).toEqual(['a', 'c']);
    expect(second.seen.map((r) => r.headers['x-case'])).toEqual(['b']);
    expect(results[0].body).toMatchObject({ url: '/echo?n=1', method: 'POST', body: { n: 1 }, custom: 'a' });
    expect(results[2].body).toMatchObject({ url: '/echo?n=3', method: 'PUT', body: { n: 3 }, custom: 'c' });
  });

  it('leaves no routing header in req.headers or req.rawHeaders', async () => {
    const { app } = socketRecorder();
    const res = await request(app).get('/echo').expect(200);
    const names = [...res.body.headerNames, ...res.body.rawHeaderNames];
    expect(names.filter((n) => n.includes('loopback'))).toEqual([]);
  });
});
