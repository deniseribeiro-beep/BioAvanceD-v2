const { buildLookupIndex } = require('./lookupIndex');

/**
 * #941: the `facilities.name` and `rooms.{facilityId,name}` lookup indexes.
 *
 * `Facility.js` and `Room.js` have declared these all along and neither
 * declaration ever reached Mongo: the mongoose connection is opened with
 * `autoIndex: false` and nothing anywhere calls `syncIndexes()` or
 * `createIndexes()`. This is the native-driver equivalent, on the
 * `utils/storageIndexes.js` precedent.
 *
 * ## Both are BUILD decisions taken from the planner
 *
 * Measured on mongo:7 with 40 facilities and 1000 rooms, running the query
 * shapes in `facility.routes.js` and `room.routes.js`:
 *
 * - `find({deletedAt:null}).sort({name:1})` on facilities -> `{name:1}` is
 *   the winning plan, and the in-memory SORT stage disappears.
 * - `find({deletedAt:null,facilityId}).sort({name:1})` on rooms ->
 *   `{facilityId:1,name:1}` wins, examining 25 documents where the
 *   unindexed form scanned all 1000.
 *
 * The key ORDER on the rooms index is the design: the equality field has to
 * precede the sort field, or one index cannot serve filter-then-sort.
 *
 * ## Why this is the opposite verdict to the two deleted {name:1} indexes
 *
 * `StorageContainer.js` and `StorageBox.js` declared standalone `{name:1}`
 * indexes that this issue DELETED, on the same kind of measurement. The
 * difference is selectivity, not the field. Those collections' sorts follow
 * a selective filter (`parent_id`, `containerType`), so the planner takes
 * the compound index and sorts a handful of rows in memory. Here the filter
 * is `deletedAt: null`, which nearly every row satisfies, so the sort is the
 * dominant cost and the index serving it wins.
 *
 * ## Wired at the READ path, deliberately
 *
 * The unique-constraint helpers in this repo are wired where their
 * collection is WRITTEN, because that is where a uniqueness violation
 * happens. These two serve READS, so they are ensured in the list handlers
 * that issue the queries above. Wiring a read-serving index only at a write
 * path means a process that never writes never builds it — and for
 * `facilities`/`rooms`, whose writes are rare admin actions and whose reads
 * are the hot path, that is the likely case rather than the corner one.
 *
 * ## Failure posture
 *
 * Best-effort and un-awaited at the call site: a failed lookup-index build
 * must not take down a list endpoint. It logs, because silently serving
 * every list from a collection scan is the thing this issue exists to stop
 * being invisible.
 */

// #941: collection names whose indexes have already been ensured this
// process, one Set per collection kind so a facilities name and a rooms name
// never shadow one another.
const facilitiesIndexed = new Set();
const roomsIndexed = new Set();

async function ensureFacilityIndexes(collection) {
  if (!collection || typeof collection.createIndex !== 'function') return;

  const name = collection.collectionName;
  if (facilitiesIndexed.has(name)) return;
  facilitiesIndexed.add(name);

  await buildLookupIndex(collection, { name: 1 }, 'facilities_name_idx_v1', 'FACILITY');
}

async function ensureRoomIndexes(collection) {
  if (!collection || typeof collection.createIndex !== 'function') return;

  const name = collection.collectionName;
  if (roomsIndexed.has(name)) return;
  roomsIndexed.add(name);

  await buildLookupIndex(
    collection,
    { facilityId: 1, name: 1 },
    'rooms_facility_name_idx_v1',
    'ROOM'
  );
}

module.exports = {
  ensureFacilityIndexes,
  ensureRoomIndexes
};
