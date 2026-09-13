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

function getPrivateKeyPem() {
  return readFileSync(PRIVATE_KEY_PEM_FILE, 'utf8');
}

function signReceipt(payload) {
  const privateKeyPem = getPrivateKeyPem();
  if (!privateKeyPem) throw new Error('missing_private_key');
  return crypto.sign(null, Buffer.from(payload, 'utf8'), privateKeyPem).toString('base64');
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, service: 'witness', witnessId: WITNESS_ID }));
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
      witnessId: WITNESS_ID,
      logId: body.logId,
      treeSize: body.treeSize,
      rootHash: body.rootHash,
      sthDigest: body.sthDigest,
      signatureDigest: body.signatureDigest,
      timestampTokenDigest: body.timestampTokenDigest,
      publishedAt: body.publishedAt,
    });
    const receipt = {
      witnessId: WITNESS_ID,
      receiptId: crypto.randomUUID(),
      payloadDigest: crypto.createHash('sha256').update(payload).digest('hex'),
      signature: signReceipt(payload),
      issuedAt: new Date().toISOString(),
    };
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, witnessId: WITNESS_ID, receipt: receipt.receiptId, receiptEnvelope: receipt }));
  } catch (error) {
    res.writeHead(500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: error.message }));
  }
});

server.listen(PORT, '0.0.0.0', () => {
  process.stdout.write(`witness listening on ${PORT}\n`);
});
