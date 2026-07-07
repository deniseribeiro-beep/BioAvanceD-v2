const { connectDB, closeConnection } = require('../src/database/mongo');
const auditController = require('../src/controllers/audit.controller');

async function main() {
  const eventIdIndex = process.argv.indexOf('--event-id');
  const eventId = eventIdIndex >= 0 ? process.argv[eventIdIndex + 1] : null;
  if (!eventId) {
    throw new Error('Uso: npm run audit:verify -- --event-id <id>');
  }
  const db = await connectDB();
  try {
    const event = await db.collection('audit_events').findOne({ eventId });
    if (!event) throw new Error('event not found');
    const req = { body: { eventId }, app: { locals: { db } } };
    const result = { statusCode: 200, payload: null, status(code) { this.statusCode = code; return this; }, json(payload) { this.payload = payload; return this; } };
    await auditController.verifyAudit(req, result);
    process.stdout.write(`${JSON.stringify(result.payload, null, 2)}\n`);
  } finally {
    await closeConnection();
  }
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
