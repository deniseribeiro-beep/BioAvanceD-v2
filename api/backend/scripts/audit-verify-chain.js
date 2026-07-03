const { connectDB, closeConnection } = require('../src/database/mongo');
const auditTreeService = require('../src/services/audit-tree.service');

async function main() {
  const db = await connectDB();
  try {
    const heads = await db.collection('audit_tree_heads').find({}).sort({ logId: 1, treeSize: 1 }).toArray();
    const failures = [];
    for (let i = 1; i < heads.length; i += 1) {
      const prev = heads[i - 1];
      const current = heads[i];
      if (current.logId === prev.logId && current.previousTreeHeadHash !== prev.rootHash) {
        failures.push({ logId: current.logId, treeSize: current.treeSize, reason: 'previousTreeHeadHash mismatch' });
      }
      const leaves = await db.collection('audit_events').find({ logId: current.logId, sequenceNumber: { $lte: current.treeSize } }).sort({ sequenceNumber: 1 }).toArray();
      if (!auditTreeService.verifyConsistency(Math.max(0, current.treeSize - 1), prev.rootHash, leaves.map((item) => item.canonicalLeaf))) {
        failures.push({ logId: current.logId, treeSize: current.treeSize, reason: 'consistency failed' });
      }
    }
    process.stdout.write(`${JSON.stringify({ ok: failures.length === 0, failures }, null, 2)}\n`);
  } finally {
    await closeConnection();
  }
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
