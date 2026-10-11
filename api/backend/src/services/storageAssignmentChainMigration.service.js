const { ObjectId } = require('mongodb');
const { getCollection, resolveCollectionName } = require('../utils/collectionResolver');
const { withTransactionWhereSupported } = require('../utils/mongoTransaction');
const { ensurePhysicalChainIndexes } = require('./physicalChain.service');
const { ensureLocationIndexes } = require('./storageLocation.service');
const { adoptLegacyPlacement, storagePositionIdFor } = require('./legacyPlacementChain.service');

// #1314: the historical StorageAssignment rows (ELM-0167..0178, kept for
// historical reads only) decomposed into the physical chain, one specimen
// per transaction, through adoptLegacyPlacement. A second run adopts
// nothing new. storageAssignments is only read: no row is written or
// deleted.
//
// The chain's indexes are built once, before any transaction opens: an
// index build next to an open transaction is a write conflict. The samples
// collection is resolved by name, so its unawaited index build does not
// start beside one either.

const LEGACY_ASSIGNMENT_EVENT_PREFIX = 'legacy-storage-assignment:';

function idCandidates(id) {
  const raw = String(id);
  return ObjectId.isValid(raw) && raw.length === 24 ? [new ObjectId(raw), raw] : [raw];
}

// The rows adoptLegacyPlacement decomposes: complete, earliest first.
function completeRows(rows) {
  return rows
    .filter((row) => row.boxId && row.positionCode && row.placedAt)
    .sort((a, b) => new Date(a.placedAt) - new Date(b.placedAt));
}

// The sample a row names: by _id, as the rows' writers key them, or by its
// canonical specimenId.
async function resolveSample(samples, specimenId) {
  const byId = await samples.findOne({ _id: { $in: idCandidates(specimenId) } });
  if (byId) return { sample: byId, keyedBy: '_id' };
  const bySpecimenId = await samples.findOne({ specimenId: String(specimenId) });
  return bySpecimenId ? { sample: bySpecimenId, keyedBy: 'specimenId' } : null;
}

// Read-only: how many of the specimen's rows adoptLegacyPlacement would
// still place, and whether its container is already loaded from them.
async function pendingPlacements(db, sample, rows) {
  const loads = await getCollection(db, 'specimenContainerAssignments');
  const specimenId = String(sample.specimenId);
  const loaded = await loads.findOne({ specimenId, sourceEventId: `${LEGACY_ASSIGNMENT_EVENT_PREFIX}${rows[0].storageAssignmentId}` })
    || await loads.findOne({ specimenId, assignmentStatus: 'active' });
  if (!loaded) return { loaded: false, pending: rows.length };
  const existing = await (await getCollection(db, 'containerPositionAssignments')).find({ containerId: loaded.containerId }).toArray();
  const pending = rows.filter((row) => !existing.some((cpa) => cpa.storagePositionId === storagePositionIdFor(row.boxId, row.positionCode)
    && new Date(cpa.placedAt).getTime() === new Date(row.placedAt).getTime())).length;
  return { loaded: true, pending };
}

async function migrateStorageAssignmentsToChain(db, { dryRun = false } = {}) {
  const summary = { specimensMigrated: 0, assignmentsDecomposed: 0, alreadyMigrated: 0, skipped: [] };
  const storageAssignments = db.collection('storageAssignments');
  const samples = db.collection(resolveCollectionName(db, 'samples'));

  if (!dryRun) {
    await ensurePhysicalChainIndexes(db);
    await ensureLocationIndexes(db);
  }

  const specimenIds = (await storageAssignments.distinct('specimenId')).filter((id) => id !== null && id !== undefined && id !== '');
  for (const specimenId of specimenIds) {
    const resolved = await resolveSample(samples, specimenId);
    if (!resolved) {
      summary.skipped.push({ specimenId: String(specimenId), reason: 'sample not found by _id or specimenId' });
      continue;
    }
    const { sample, keyedBy } = resolved;
    // adoptLegacyPlacement reads the rows keyed by the sample's _id.
    if (keyedBy === 'specimenId') {
      summary.skipped.push({ specimenId: String(specimenId), reason: 'rows keyed by the canonical specimenId; adoptLegacyPlacement reads rows keyed by the sample _id' });
      continue;
    }
    if (!sample.specimenId) {
      summary.skipped.push({ specimenId: String(specimenId), reason: 'sample has no specimenId' });
      continue;
    }
    const rows = completeRows(await storageAssignments.find({ specimenId: String(sample._id) }).toArray());
    if (!rows.length) {
      summary.skipped.push({ specimenId: String(specimenId), reason: 'no row with boxId, positionCode and placedAt' });
      continue;
    }

    if (dryRun) {
      const { loaded, pending } = await pendingPlacements(db, sample, rows);
      if (loaded && pending === 0) {
        summary.alreadyMigrated += 1;
      } else {
        summary.specimensMigrated += 1;
        summary.assignmentsDecomposed += pending;
      }
      continue;
    }

    let result;
    try {
      result = await withTransactionWhereSupported(db, (session) => adoptLegacyPlacement(db, sample, session));
    } catch (error) {
      summary.skipped.push({ specimenId: String(specimenId), reason: error.message });
      continue;
    }
    if (result.positionAssignments === 0 && result.rackLocations === 0) {
      summary.alreadyMigrated += 1;
    } else {
      summary.specimensMigrated += 1;
      summary.assignmentsDecomposed += result.positionAssignments;
    }
  }

  return summary;
}

module.exports = { migrateStorageAssignmentsToChain };
