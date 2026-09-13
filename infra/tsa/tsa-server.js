const http = require('http');
const { mkdtemp, writeFile, readFile, rm } = require('fs/promises');
const { tmpdir } = require('os');
const path = require('path');
const { execFile } = require('child_process');

// #981: TSA_PORT first. compose.test.yml sets TSA_PORT and this read was
// PORT-only, so the variable that looks like the knob was inert -- changing
// it moved nothing, the server kept listening on 8095, and the healthcheck
// (which hardcoded 8095 too) kept passing. The failure would have surfaced
// as a connection refused from a different container. PORT is kept as a
// fallback so any caller relying on the generic name still works.
const PORT = Number(process.env.TSA_PORT || process.env.PORT || 8095);
const MAX_BODY_BYTES = Number(process.env.TSA_MAX_BODY_BYTES || 1024 * 1024);
const OPENSSL_BIN = process.env.OPENSSL_BIN || 'openssl';
const TSA_CONFIG = process.env.TSA_CONFIG || '/etc/tsa/openssl-ts.cnf';
const TSA_SECTION = process.env.TSA_SECTION || 'tsa_config';

function execFileAsync(file, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(file, args, options, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        reject(new Error('request_too_large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function processTimestampQuery(queryBuffer) {
  const workDir = await mkdtemp(path.join(tmpdir(), 'tsa-'));
  const queryPath = path.join(workDir, 'request.tsq');
  const responsePath = path.join(workDir, 'response.tsr');
  try {
    await writeFile(queryPath, queryBuffer);
    await execFileAsync(OPENSSL_BIN, ['ts', '-reply', '-config', TSA_CONFIG, '-section', TSA_SECTION, '-queryfile', queryPath, '-out', responsePath], {
      windowsHide: true,
      env: {
        ...process.env,
        OPENSSL_CONF: TSA_CONFIG,
      },
    });
    return readFile(responsePath);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, service: 'tsa' }));
      return;
    }

    if (req.method !== 'POST' || req.url !== '/tsa') {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'not_found' }));
      return;
    }

    const body = await readBody(req);
    const token = await processTimestampQuery(body);
    res.writeHead(200, { 'content-type': 'application/timestamp-reply', 'cache-control': 'no-store' });
    res.end(token);
  } catch (error) {
    const status = error.message === 'request_too_large' ? 413 : 500;
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: error.message }));
  }
});

server.listen(PORT, '0.0.0.0', () => {
  process.stdout.write(`tsa listening on ${PORT}\n`);
});
