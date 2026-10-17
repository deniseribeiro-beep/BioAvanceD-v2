const logger = require('./logger');

/**
 * #941: build one non-unique LOOKUP index, best-effort, with its own catch.
 *
 * Shared by `sampleIndexes.js`, `sessionIndexes.js` and `storageIndexes.js`
 * rather than copied into each, because the failure MESSAGE is the part that matters and a
 * second copy of it would drift.
 *
 * ## Why this is separate from the unique-index builders
 *
 * A failed UNIQUE build is a data problem worth naming: an `E11000` there
 * means duplicates are already written and the constraint cannot hold until
 * they are repaired. A failed LOOKUP build costs a query plan and nothing
 * else — the queries stay correct, they just stop being served from an
 * index. Those need different words, so they get different functions; a
 * lookup failure must never read as though data were corrupted.
 *
 * ## Where a lookup index is ensured: at the READ path (#1163)
 *
 * A unique index is wired where its collection is WRITTEN, because that is
 * where a violation happens. A lookup index exists to serve a read, so it is
 * wired where that read runs. Wired only at a write path, a process that
 * never writes never builds it: the storage parent_id indexes were once
 * ensured only by a one-time backfill, so a fresh stack walked its freezer
 * trees, per telemetry reading, from a collection scan. A reader that is also
 * a writer can ensure both. Ensure un-awaited, behind the helper's own
 * per-collection latch, so the call costs one `Set.has` after the first.
 *
 * ## Why each build gets its own try/catch
 *
 * One shared catch around several `createIndex` calls reports the first
 * failure and skips every build after it, silently. That is the shape #1027
 * corrected in `create-db.js`, where a single throw cost 46 index builds.
 *
 * @param {object} collection - a native driver collection handle
 * @param {object} keys - the index key spec
 * @param {string} name - the index name, versioned `_v1` per repo convention
 * @param {string} tag - log prefix, e.g. 'STORAGE'
 */
async function buildLookupIndex(collection, keys, name, tag) {
  try {
    await collection.createIndex(keys, { name });
  } catch (error) {
    logger.warn(
      '[' + tag + '][INDEX] Não foi possível criar ' + name + ' (#941). '
        + 'Índice apenas de desempenho: as consultas continuam corretas, '
        + 'porém sem o plano indexado: '
        + (error?.message || error)
    );
  }
}

module.exports = { buildLookupIndex };
