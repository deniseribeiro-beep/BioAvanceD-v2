import { describe, it, expect, afterEach } from 'vitest';
import net from 'net';
import path from 'path';

// #1468 (RNF015 C3): the TSA logs one line per call with the caller's
// X-Request-Id, so a timestamp can be tied to the request or job that asked.
const { createTsaServer } = require(path.resolve(__dirname, '../../../../../infra/tsa/tsa-server.js'));

let server;
let entries;

async function start(options = {}) {
  entries = [];
  server = createTsaServer({ log: (entry) => entries.push(entry), opensslBin: 'openssl-missing-1468', ...options });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${server.address().port}`;
}

async function waitForEntries(count) {
  const deadline = Date.now() + 2000;
  while (entries.length < count && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

// A raw socket that sends the headers and the first bodyBytes of a body it
// declares as contentLength long, then hangs up after holdMs.
async function rawPostThenHangUp(baseUrl, urlPath, { contentLength, bodyBytes, holdMs = 100 }) {
  const { port } = new URL(baseUrl);
  const socket = net.connect(Number(port), '127.0.0.1');
  socket.on('error', () => {});
  await new Promise((resolve) => socket.on('connect', resolve));
  socket.write(
    `POST ${urlPath} HTTP/1.1\r\nHost: 127.0.0.1\r\nX-Request-Id: req-1468-aborted\r\nContent-Length: ${contentLength}\r\n\r\n`,
  );
  socket.write(Buffer.alloc(bodyBytes, 0x61));
  await new Promise((resolve) => setTimeout(resolve, holdMs));
  socket.destroy();
}

function postTsa(baseUrl, headers = {}) {
  return fetch(`${baseUrl}/tsa`, {
    method: 'POST',
    headers: { 'content-type': 'application/timestamp-query', ...headers },
    body: Buffer.from('fake-tsq'),
  });
}

afterEach(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  server = undefined;
});

describe('infra tsa-server', () => {
  it("logs the caller's id with the service, path and status of the call", async () => {
    const baseUrl = await start();
    const response = await postTsa(baseUrl, { 'X-Request-Id': 'req-1468-abcdef' });
    expect(response.status).toBe(500);
    await waitForEntries(1);

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ service: 'tsa', method: 'POST', path: '/tsa', status: 500, requestId: 'req-1468-abcdef' });
    expect(typeof entries[0].durationMs).toBe('number');
  });

  it('logs a call that answers 500 (openssl missing) with status 500', async () => {
    const baseUrl = await start();
    const response = await postTsa(baseUrl);
    expect(response.status).toBe(500);
    await waitForEntries(1);

    expect(entries).toEqual([expect.objectContaining({ service: 'tsa', path: '/tsa', status: 500 })]);
  });

  it('logs requestId null for a malformed id: too short, or characters outside the id set', async () => {
    const baseUrl = await start();
    await postTsa(baseUrl, { 'X-Request-Id': 'abc1234' });
    await postTsa(baseUrl, { 'X-Request-Id': 'abc [ERROR] forged line' });
    await waitForEntries(2);

    expect(entries.map((entry) => entry.requestId)).toEqual([null, null]);
  });

  it('logs requestId null when no X-Request-Id is sent', async () => {
    const baseUrl = await start();
    await postTsa(baseUrl);
    await waitForEntries(1);

    expect(entries).toHaveLength(1);
    expect(entries[0].requestId).toBeNull();
  });

  it('logs a call the client hangs up on before any answer as aborted, never as 200', async () => {
    const baseUrl = await start();
    await rawPostThenHangUp(baseUrl, '/tsa', { contentLength: 100, bodyBytes: 4 });
    await waitForEntries(1);
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(entries).toEqual([
      expect.objectContaining({ service: 'tsa', path: '/tsa', status: null, aborted: true, requestId: 'req-1468-aborted' }),
    ]);
  });

  it('logs a body over the size limit once, as 413', async () => {
    const baseUrl = await start({ maxBodyBytes: 16 });
    await rawPostThenHangUp(baseUrl, '/tsa', { contentLength: 64, bodyBytes: 64 });
    await waitForEntries(1);
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(entries).toEqual([expect.objectContaining({ service: 'tsa', path: '/tsa', status: 413, requestId: 'req-1468-aborted' })]);
    expect(entries[0]).not.toHaveProperty('aborted');
  });

  it('GET /health logs nothing', async () => {
    const baseUrl = await start();
    const response = await fetch(`${baseUrl}/health`, { headers: { 'X-Request-Id': 'req-1468-health' } });
    expect(response.status).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(entries).toEqual([]);
  });

  it('logs an unknown path as a 404 entry', async () => {
    const baseUrl = await start();
    const response = await fetch(`${baseUrl}/nope`, { headers: { 'X-Request-Id': 'req-1468-notfound' } });
    expect(response.status).toBe(404);
    await waitForEntries(1);

    expect(entries).toEqual([
      expect.objectContaining({ service: 'tsa', method: 'GET', path: '/nope', status: 404, requestId: 'req-1468-notfound' }),
    ]);
  });
});
