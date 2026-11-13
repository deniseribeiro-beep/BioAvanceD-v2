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

// #1468 (RNF015 C3): the backend's WELL_FORMED request-id pattern
// (api/backend/src/utils/requestContext.js), copied here because the image
// holds this one file. An id that does not match is never logged, so a
// header cannot inject a forged line into the log.
const WELL_FORMED_REQUEST_ID = /^[A-Za-z0-9._-]{8,128}$/;

function callerIdOf(req) {
  const id = req.headers['x-request-id'];
  return typeof id === 'string' && WELL_FORMED_REQUEST_ID.test(id) ? id : null;
}

function defaultLog(entry) {
  process.stdout.write(`${JSON.stringify(entry)}\n`);
}

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

function readBody(req, maxBodyBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > maxBodyBytes) {
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

async function processTimestampQuery(queryBuffer, { opensslBin, tsaConfig, tsaSection }) {
  const workDir = await mkdtemp(path.join(tmpdir(), 'tsa-'));
  const queryPath = path.join(workDir, 'request.tsq');
  const responsePath = path.join(workDir, 'response.tsr');
  try {
    await writeFile(queryPath, queryBuffer);
    await execFileAsync(opensslBin, ['ts', '-reply', '-config', tsaConfig, '-section', tsaSection, '-queryfile', queryPath, '-out', responsePath], {
      windowsHide: true,
      env: {
        ...process.env,
        OPENSSL_CONF: tsaConfig,
      },
    });
    return await readFile(responsePath);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

// #1468 (RNF015 C3): built by a factory, not at module load, so a test can
// start it on any port with its own log. Every request but GET /health (the
// healthcheck polls it) logs one line with the caller's id when it finishes.
function createTsaServer({ log = defaultLog, opensslBin = OPENSSL_BIN, tsaConfig = TSA_CONFIG, tsaSection = TSA_SECTION, maxBodyBytes = MAX_BODY_BYTES } = {}) {
  return http.createServer(async (req, res) => {
    const isHealth = req.method === 'GET' && req.url === '/health';
    if (!isHealth) {
      const started = process.hrtime.bigint();
      let logged = false;
      // 'close' covers a response whose socket is destroyed before it
      // finishes (the 413 path destroys the request); one line either way.
      const logOnce = () => {
        if (logged) return;
        logged = true;
        const durationMs = Math.round(Number(process.hrtime.bigint() - started) / 1e3) / 1e3;
        // A client that hung up before any response was sent got no answer:
        // res.statusCode is still Node's default 200 there, so the line says
        // aborted with no status rather than record a success.
        if (!res.writableFinished && !res.headersSent) {
          log({ service: 'tsa', method: req.method, path: req.url, status: null, aborted: true, requestId: callerIdOf(req), durationMs });
          return;
        }
        log({ service: 'tsa', method: req.method, path: req.url, status: res.statusCode, requestId: callerIdOf(req), durationMs });
      };
      res.on('finish', logOnce);
      res.on('close', logOnce);
    }
    try {
      if (isHealth) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, service: 'tsa' }));
        return;
      }

      if (req.method !== 'POST' || req.url !== '/tsa') {
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'not_found' }));
        return;
      }

      const body = await readBody(req, maxBodyBytes);
      const token = await processTimestampQuery(body, { opensslBin, tsaConfig, tsaSection });
      res.writeHead(200, { 'content-type': 'application/timestamp-reply', 'cache-control': 'no-store' });
      res.end(token);
    } catch (error) {
      const status = error.message === 'request_too_large' ? 413 : 500;
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: error.message }));
    }
  });
}

if (require.main === module) {
  createTsaServer().listen(PORT, '0.0.0.0', () => {
    process.stdout.write(`tsa listening on ${PORT}\n`);
  });
}

module.exports = { createTsaServer, callerIdOf };
