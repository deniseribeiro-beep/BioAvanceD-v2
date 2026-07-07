const { connectDB, closeConnection } = require('../src/database/mongo');

async function main() {
  const db = await connectDB();
  try {
    const witnesses = await db.collection('audit_witnesses').find({}).toArray();
    const failures = witnesses.filter((item) => !item.receipt).map((item) => ({ logId: item.logId, treeSize: item.treeSize, reason: 'missing receipt' }));
    process.stdout.write(`${JSON.stringify({ ok: failures.length === 0, failures }, null, 2)}\n`);
  } finally {
    await closeConnection();
  }
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
