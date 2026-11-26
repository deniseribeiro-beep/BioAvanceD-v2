/**
 * Migration: historical StorageAssignment rows into the physical chain
 * (#1314, ELM-0167..0178 kept for historical reads only).
 *
 * Each specimen's storageAssignments rows become one container loaded from
 * the earliest placement, one ContainerPositionAssignment per row over
 * [placedAt, removedAt), and each box located in its mirrored storage tree,
 * one specimen per transaction where the deployment runs one. The chain's
 * indexes are built before the first transaction. storageAssignments is
 * only read: no row is written or deleted.
 *
 * Idempotent: a second run finds what the first wrote, adopts nothing and
 * counts the specimen in alreadyMigrated. A row whose sample is not found,
 * or that has no boxId, positionCode or placedAt, is listed in skipped with
 * the reason.
 *
 * One-way: no rollback. storageAssignments is only read, so its rows stay,
 * but the chain records this run writes are the ones
 * legacyPlacementChain.service.js (adoptLegacyPlacement) writes at run time
 * when a specimen not yet adopted is moved, released or labelled, and a
 * ContainerPositionAssignment carries no sourceEventId, so nothing tells
 * this run's records from those. Every move since is written to the chain
 * alone (no backend code writes storageAssignments, RULE-026) and builds on
 * the adopted container, so deleting the adopted records would lose it.
 * Undo it by restoring containers, specimenContainerAssignments,
 * containerPositionAssignments, rackLocationAssignments and storageLocations
 * from a backup taken before the run.
 *
 * Usage (from api/backend):
 *   npm run migrate:storage-assignments-to-chain               applies
 *   npm run migrate:storage-assignments-to-chain -- --dry-run  counts, writes nothing
 */

const { connectDB, closeConnection } = require('../database/mongo');
const { migrateStorageAssignmentsToChain } = require('../services/storageAssignmentChainMigration.service');

async function run(argv = process.argv.slice(2)) {
  const db = await connectDB();
  const dryRun = argv.includes('--dry-run');
  const summary = await migrateStorageAssignmentsToChain(db, { dryRun });
  console.log(`StorageAssignment -> cadeia física (${dryRun ? 'dry-run' : 'apply'}):`, JSON.stringify(summary, null, 2));
  return summary;
}

if (require.main === module) {
  run()
    .catch((error) => {
      console.error('Erro na migração StorageAssignment -> cadeia física:', error.message);
      process.exitCode = 1;
    })
    .finally(async () => {
      await closeConnection();
    });
}

module.exports = { run };
