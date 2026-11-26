const http = require('http');
const { readFileSync } = require('fs');
const crypto = require('crypto');

// #981: WITNESS_PORT first, for the reason spelled out in
// infra/tsa/tsa-server.js -- compose sets WITNESS_PORT and this read was
// PORT-only, so the knob was inert. Its sibling WITNESS_ID below IS read,
// which is what made the whole block look correct by association.
const PORT = Number(process.env.WITNESS_PORT || process.env.PORT || 8096);
const WITNESS_ID = process.env.WITNESS_ID || 'bioavanced-local-witness';
const PRIVATE_KEY_PEM_FILE = process.env.WITNESS_PRIVATE_KEY_PEM_FILE || '/run/secrets/witness_key.pem';

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

function signReceipt(payload, privateKeyPemFile) {
  const privateKeyPem = readFileSync(privateKeyPemFile, 'utf8');
  if (!privateKeyPem) throw new Error('missing_private_key');
  return crypto.sign(null, Buffer.from(payload, 'utf8'), privateKeyPem).toString('base64');
}

// #1468 (RNF015 C3): built by a factory, not at module load, so a test can
// start it on any port with its own log. Every request but GET /health (the
// healthcheck polls it) logs one line with the caller's id when it finishes.
function createWitnessServer({ log = defaultLog, witnessId = WITNESS_ID, privateKeyPemFile = PRIVATE_KEY_PEM_FILE } = {}) {
  return http.createServer(async (req, res) => {
    const isHealth = req.method === 'GET' && req.url === '/health';
    if (!isHealth) {
      const started = process.hrtime.bigint();
      let logged = false;
      // 'close' covers a response whose socket is destroyed before it
      // finishes (a client that hangs up early); one line either way.
      const logOnce = () => {
        if (logged) return;
        logged = true;
        const durationMs = Math.round(Number(process.hrtime.bigint() - started) / 1e3) / 1e3;
        // A client that hung up before any response was sent got no answer:
        // res.statusCode is still Node's default 200 there, so the line says
        // aborted with no status rather than record a success.
        if (!res.writableFinished && !res.headersSent) {
          log({ service: 'witness', method: req.method, path: req.url, status: null, aborted: true, requestId: callerIdOf(req), durationMs });
          return;
        }
        log({ service: 'witness', method: req.method, path: req.url, status: res.statusCode, requestId: callerIdOf(req), durationMs });
      };
      res.on('finish', logOnce);
      res.on('close', logOnce);
    }
    try {
      if (isHealth) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, service: 'witness', witnessId }));
        return;
      }

      if (req.method !== 'POST' || req.url !== '/witness') {
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'not_found' }));
        return;
      }

      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
      const payload = JSON.stringify({
        witnessId,
        logId: body.logId,
        treeSize: body.treeSize,
        rootHash: body.rootHash,
        sthDigest: body.sthDigest,
        signatureDigest: body.signatureDigest,
        timestampTokenDigest: body.timestampTokenDigest,
        publishedAt: body.publishedAt,
      });
      const receipt = {
        witnessId,
        receiptId: crypto.randomUUID(),
        payloadDigest: crypto.createHash('sha256').update(payload).digest('hex'),
        signature: signReceipt(payload, privateKeyPemFile),
        issuedAt: new Date().toISOString(),
      };
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, witnessId, receipt: receipt.receiptId, receiptEnvelope: receipt }));
    } catch (error) {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: error.message }));
    }
  });
}

if (require.main === module) {
  createWitnessServer().listen(PORT, '0.0.0.0', () => {
    process.stdout.write(`witness listening on ${PORT}\n`);
  });
}

module.exports = { createWitnessServer, callerIdOf };
