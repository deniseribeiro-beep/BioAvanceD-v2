const { connectDB, closeConnection } = require('../src/database/mongo');
const { canonicalize } = require('../src/services/audit-canonicalization.service');
const signingProvider = require('../src/services/audit-signing.provider');

function classifyLegacy(rootDoc) {
  if (!rootDoc) return 'LEGACY_UNSIGNED';
  if (!rootDoc.signature) return 'LEGACY_UNSIGNED';
  if (!rootDoc.timestamp || !rootDoc.timestamp.token) return 'SIGNED_NOT_TIMESTAMPED';
  return 'TIMESTAMPED';
}

async function main() {
  const db = await connectDB();
  try {
    const roots = await db.collection('audit_roots').find({}).sort({ chainIndex: 1 }).toArray();
    const heads = db.collection('audit_tree_heads');
    for (const rootDoc of roots) {
      const classification = classifyLegacy(rootDoc);
      const logId = `legacy-${rootDoc.date}`;
      const treeSize = Number(rootDoc.treeSize || 0);
      const envelope = {
        schemaVersion: 'audit.treehead.legacy.v1',
        logId,
        treeSize,
        rootHash: rootDoc.root,
        previousTreeHeadHash: rootDoc.previousRootHash || null,
        periodStart: `${rootDoc.date}T00:00:00.000Z`,
        periodEnd: `${rootDoc.date}T23:59:59.999Z`,
        createdAt: rootDoc.createdAt ? new Date(rootDoc.createdAt).toISOString() : new Date().toISOString(),
        hashAlgorithm: rootDoc.hashAlgorithm || 'SHA-256',
        merkleAlgorithm: rootDoc.merkleAlgorithm || 'BIOAVANCED-MERKLE-V1',
        signatureAlgorithm: rootDoc.signatureAlgorithm || null,
        keyId: rootDoc.keyId || null,
        status: classification,
      };
      const canonical = canonicalize(envelope);
      const record = {
        ...envelope,
        canonical,
        digestSha256: require('crypto').createHash('sha256').update(canonical).digest('hex'),
        signature: rootDoc.signature || null,
        publicKeyFingerprint: rootDoc.publicKeyFingerprint || null,
        legacySourceId: String(rootDoc._id || rootDoc.date),
        migratedFrom: 'audit_roots',
      };
      await heads.updateOne({ logId, treeSize }, { $setOnInsert: record }, { upsert: true });
    }
    process.stdout.write(`${JSON.stringify({ ok: true, migrated: roots.length }, null, 2)}\n`);
  } finally {
    await closeConnection();
  }
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
