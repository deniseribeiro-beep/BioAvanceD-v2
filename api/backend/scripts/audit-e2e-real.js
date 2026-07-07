const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { connectDB, closeConnection } = require('../src/database/mongo');
const env = require('../src/config/env');
const auditV2 = require('../src/services/audit-v2.service');
const auditController = require('../src/controllers/audit.controller');
const tree = require('../src/services/audit-tree.service');

function makeRes() {
  const payload = { statusCode: 200, body: null };
  return {
    payload,
    status(code) {
      payload.statusCode = code;
      return this;
    },
    json(body) {
      payload.body = body;
      return this;
    },
  };
}

async function main() {
  const logId = 'e2e-real';
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  const privateKeyPath = path.join(os.tmpdir(), `audit-signing-${Date.now()}.pem`);
  fs.writeFileSync(privateKeyPath, privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(), { mode: 0o600 });

  env.AUDIT_MERKLE_SIGN_PRIVATE_KEY_FILE = privateKeyPath;
  env.AUDIT_MERKLE_SIGN_KEY_ID = 'e2e-key';
  env.AUDIT_MERKLE_SIGN_PUBLIC_KEYS_JSON = JSON.stringify({ 'e2e-key': publicKey.export({ format: 'pem', type: 'spki' }).toString() });
  env.AUDIT_RFC3161_TSA_URL = process.env.AUDIT_RFC3161_TSA_URL || 'http://tsa:8095/tsa';
  env.AUDIT_EXTERNAL_WITNESS_URL = process.env.AUDIT_EXTERNAL_WITNESS_URL || 'http://witness:8096/witness';

  const db = await connectDB();
  try {
    await Promise.all([
      db.collection('audit_events').deleteMany({ logId }),
      db.collection('audit_tree_heads').deleteMany({ logId }),
      db.collection('audit_timestamp_tokens').deleteMany({ logId }),
      db.collection('audit_witnesses').deleteMany({ logId }),
    ]);

    const event = await auditV2.createEvent({
      logId,
      occurredAt: '2026-07-03T00:00:00.000Z',
      recordedAt: '2026-07-03T00:00:00.000Z',
      actorPseudonym: 'USR-E2E',
      action: 'CREATE',
      entityType: 'Sample',
      entityId: 'SAMPLE-001',
      result: 'success',
      source: 'e2e-test',
      correlationId: 'corr-e2e-1',
      payload: { synthetic: true, value: 1 },
    }, db);

    const rootHash = tree.buildTree([event.canonicalLeaf]).rootHash;
    const head = await auditV2.createTreeHead({
      logId,
      treeSize: 1,
      rootHash,
      previousTreeHeadHash: null,
      periodStart: '2026-07-03T00:00:00.000Z',
      periodEnd: '2026-07-03T23:59:59.999Z',
      createdAt: '2026-07-03T00:00:00.000Z',
    }, db);

    const verifyRes = makeRes();
    await auditController.verifyAudit({ body: { eventId: event.eventId, treeHeadId: head._id }, app: { locals: { db } } }, verifyRes);

    const result = {
      eventId: event.eventId,
      treeHeadId: head._id,
      treeHeadStatus: head.status,
      verify: verifyRes.payload.body,
    };
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);

    const data = verifyRes.payload.body?.data || {};
    const required = [
      data.eventIntegrity === true,
      data.inclusionValid === true,
      data.treeHeadSignatureValid === true,
      data.timestampValid === true,
      data.externalWitnessValid === true,
      data.consistencyValid === true,
      data.overallStatus === 'VALID',
    ];
    if (required.some((ok) => !ok)) {
      throw new Error(`audit_e2e_failed:${JSON.stringify(data)}`);
    }
  } finally {
    await closeConnection();
    try { fs.unlinkSync(privateKeyPath); } catch (error) {}
  }
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
