import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import crypto from 'crypto';
import fs from 'fs';
import net from 'net';
import os from 'os';
import path from 'path';

// #1468 (RNF015 C3): the witness logs one line per call with the caller's
// X-Request-Id, so a receipt can be tied to the request or job that asked.
const { createWitnessServer } = require(path.resolve(__dirname, '../../../../../infra/witness/witness-server.js'));

let keyDir;
let keyFile;
let server;
let entries;

beforeAll(() => {
  const { privateKey } = crypto.generateKeyPairSync('ed25519');
  keyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'witness-key-1468-'));
  keyFile = path.join(keyDir, 'witness_key.pem');
  fs.writeFileSync(keyFile, privateKey.export({ type: 'pkcs8', format: 'pem' }));
});

afterAll(() => {
  fs.rmSync(keyDir, { recursive: true, force: true });
});

async function start() {
  entries = [];
  server = createWitnessServer({ log: (entry) => entries.push(entry), witnessId: 'witness-1468', privateKeyPemFile: keyFile });
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

function postWitness(baseUrl, headers = {}) {
  return fetch(`${baseUrl}/witness`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ logId: 'log-1', treeSize: 3, rootHash: 'a'.repeat(64) }),
  });
}

afterEach(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  server = undefined;
});

describe('infra witness-server', () => {
  it("logs the caller's id with the service, path and status of the call", async () => {
    const baseUrl = await start();
    const response = await postWitness(baseUrl, { 'X-Request-Id': 'req-1468-abcdef' });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ ok: true, witnessId: 'witness-1468' });
    expect(body.receipt).toBe(body.receiptEnvelope.receiptId);
    await waitForEntries(1);

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ service: 'witness', method: 'POST', path: '/witness', status: 200, requestId: 'req-1468-abcdef' });
    expect(typeof entries[0].durationMs).toBe('number');
  });

  it('logs requestId null for a malformed id: too short, or characters outside the id set', async () => {
    const baseUrl = await start();
    await postWitness(baseUrl, { 'X-Request-Id': 'abc1234' });
    await postWitness(baseUrl, { 'X-Request-Id': 'abc [ERROR] forged line' });
    await waitForEntries(2);

    expect(entries.map((entry) => entry.requestId)).toEqual([null, null]);
  });

  it('logs requestId null when no X-Request-Id is sent', async () => {
    const baseUrl = await start();
    await postWitness(baseUrl);
    await waitForEntries(1);

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ status: 200, requestId: null });
  });

  it('logs a call the client hangs up on before any answer as aborted, never as 200', async () => {
    const baseUrl = await start();
    await rawPostThenHangUp(baseUrl, '/witness', { contentLength: 100, bodyBytes: 4 });
    await waitForEntries(1);
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(entries).toEqual([
      expect.objectContaining({ service: 'witness', path: '/witness', status: null, aborted: true, requestId: 'req-1468-aborted' }),
    ]);
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
      expect.objectContaining({ service: 'witness', method: 'GET', path: '/nope', status: 404, requestId: 'req-1468-notfound' }),
    ]);
  });
});
