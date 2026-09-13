const fs = require('fs');
const path = require('path');
const env = require('../config/env');

/**
 * #490 — retire the legacy `locations` collection itself, split off #460
 * (which removed all code-level consumers except the one-time backfill
 * tool, `location-storage-backfill.service.js`). Destructive: always
 * exports every document to a timestamped JSON backup before dropping,
 * so the drop is reversible via restore even though Mongo's own
 * `drop()` is not. No-op (skips the drop) if the collection doesn't
 * exist, so this is safe to run against a fresh dev database too.
 */
async function dropLegacyLocationsCollection(db, { backupDir } = {}) {
  const locationsCollection = db.collection('locations');
  const documents = await locationsCollection.find({}).toArray();

  // #893: consult env.BACKUP_DIR before the __dirname-relative fallback,
  // mirroring backup.service.js#getBackupBaseDir -- a hardened production
  // container runs with `read_only: true` and this root moved outside
  // /app, so writing under __dirname here would fail EROFS even though
  // every other writable root was already made env-configurable.
  const resolvedBackupDir = backupDir || env.BACKUP_DIR || path.join(__dirname, '..', '..', 'backups');
  fs.mkdirSync(resolvedBackupDir, { recursive: true });
  const backupPath = path.join(
    resolvedBackupDir,
    `locations-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
  );
  fs.writeFileSync(backupPath, JSON.stringify(documents, null, 2));

  const collectionNames = await db.listCollections({ name: 'locations' }).toArray();
  const collectionExists = collectionNames.length > 0;
  if (collectionExists) {
    await locationsCollection.drop();
  }

  return {
    backedUpCount: documents.length,
    backupPath,
    dropped: collectionExists,
  };
}

module.exports = { dropLegacyLocationsCollection };
