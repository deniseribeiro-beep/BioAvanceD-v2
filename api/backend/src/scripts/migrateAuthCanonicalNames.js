/**
 * Migration: `users` and `sessions` documents still carrying a legacy name
 * are moved to their dict-02 names (UserAccount P1X-0182..0208, Session
 * P1X-0251..0267, #1330).
 *
 * Every write already stores the canonical names, and readers fall back to
 * the legacy ones (docs/decisions/2026-10-11-user-account-names.md,
 * docs/decisions/2026-10-11-session-names.md). A document that is never
 * rewritten keeps the legacy names: a dormant user, a revoked or expired
 * session. Both records leave this move to a one-off migration, so that the
 * fallbacks can go later. Per document with a legacy name:
 *
 * - users: UserModel.canonicalMoveOf moves each legacy value whose canonical
 *   name is absent (a canonical null stays null, as storedValueOf reads it),
 *   and a legacy name whose canonical name is present is removed.
 * - sessions: SessionModel.canonicalMoveOf moves each legacy value whose
 *   canonical name is null or absent (the readers use `??`), and removes a
 *   legacy name whose canonical value is set.
 *
 * Each move is one guarded updateOne. A document a live write changed since
 * it was read fails the filter: it is counted as raced, not retried, and the
 * next run picks it up. The rules are
 * docs/decisions/2026-10-16-auth-legacy-name-migration.md.
 *
 * Idempotent: a moved document carries no legacy name, so the second run
 * finds nothing. `remaining` counts the documents still carrying one.
 *
 * One-way: no rollback. A moved document cannot be told from one a live write
 * stored under the canonical names, and where both names were present the
 * legacy value is removed, not kept. Nothing needs it undone, and putting the
 * legacy names back would leave those fields unread: the readers read the
 * canonical name only, and every write stores only it. Undo is restoring users
 * and sessions from a backup.
 *
 * Usage (from api/backend):
 *   npm run migrate:auth-canonical-names               applies
 *   npm run migrate:auth-canonical-names -- --dry-run  counts, writes nothing
 */

const { connectDB, closeConnection } = require('../database/mongo');
const UserModel = require('../models/User');
const SessionModel = require('../models/Session');

function anyLegacyName(renamed) {
  return { $or: Object.values(renamed).map((legacy) => ({ [legacy]: { $exists: true } })) };
}

// canonicalMoveOf skips a legacy name whose canonical name is present; the
// fallback cannot go while it remains, so it is removed here.
function userMoveOf(user) {
  const move = UserModel.canonicalMoveOf(user);
  const $unset = {};
  for (const [canonical, legacy] of Object.entries(UserModel.RENAMED)) {
    if (user[canonical] !== undefined && user[legacy] !== undefined) $unset[legacy] = '';
  }
  if (!move) return { filter: { _id: user._id }, update: { $unset } };
  return { filter: move.filter, update: { ...move.update, $unset: { ...move.update.$unset, ...$unset } } };
}

async function migrateCollection(collection, query, moveOf, dryRun) {
  const counts = { scanned: 0, moved: 0, raced: 0 };
  const docs = await collection.find(query).toArray();
  for (const doc of docs) {
    counts.scanned += 1;
    const move = moveOf(doc);
    if (!move) continue;
    if (dryRun) {
      counts.moved += 1;
      continue;
    }
    const result = await collection.updateOne(move.filter, move.update);
    // A live write converted or changed the document since it was read.
    if (result.matchedCount === 0) counts.raced += 1;
    else counts.moved += 1;
  }
  return counts;
}

async function migrateAuthCanonicalNames(db, { dryRun = false } = {}) {
  const users = db.collection('users');
  const sessions = db.collection('sessions');
  const userQuery = anyLegacyName(UserModel.RENAMED);
  const sessionQuery = anyLegacyName(SessionModel.RENAMED);

  const summary = {
    mode: dryRun ? 'dry-run' : 'apply',
    users: await migrateCollection(users, userQuery, userMoveOf, dryRun),
    sessions: await migrateCollection(sessions, sessionQuery, (session) => SessionModel.canonicalMoveOf(session), dryRun),
  };
  summary.remaining = {
    users: await users.countDocuments(userQuery),
    sessions: await sessions.countDocuments(sessionQuery),
  };
  return summary;
}

async function run(argv = process.argv.slice(2)) {
  const db = await connectDB();
  const summary = await migrateAuthCanonicalNames(db, { dryRun: argv.includes('--dry-run') });
  console.log('users/sessions legacy names -> dict-02 names:', JSON.stringify(summary, null, 2));
  return summary;
}

if (require.main === module) {
  run()
    .catch((error) => {
      console.error('Erro na migração dos nomes legados de users/sessions:', error.message);
      process.exitCode = 1;
    })
    .finally(async () => {
      await closeConnection();
    });
}

module.exports = { migrateAuthCanonicalNames, run };
