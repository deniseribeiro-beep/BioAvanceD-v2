const logger = require('./logger');

/**
 * #1164: drop an index that a new versioned name supersedes, best-effort.
 *
 * Changing an index's `partialFilterExpression` makes it a DIFFERENT index,
 * even over the same keys: Mongo builds the new name alongside the old one,
 * and the old one lingers until something drops it. Callers build the
 * replacement FIRST and drop second, so the constraint never has a gap.
 *
 * `IndexNotFound` is the normal case -- every collection that never held the
 * old name, which is every fresh stack -- so it is silent. Anything else is
 * logged and swallowed: a leftover index costs write overhead, never
 * correctness, so it must not take down the caller. Same posture and
 * message-drift reasoning as `lookupIndex.js`.
 *
 * @param {object} collection - a native driver collection handle
 * @param {string} name - the superseded index name
 * @param {string} tag - log prefix, e.g. 'SAMPLES'
 */
async function dropLegacyIndex(collection, name, tag) {
  if (!collection || typeof collection.dropIndex !== 'function') return;

  try {
    await collection.dropIndex(name);
  } catch (error) {
    if (error?.codeName === 'IndexNotFound' || error?.code === 27) return;
    logger.warn(
      '[' + tag + '][INDEX] Não foi possível remover o índice substituído ' + name + ' (#1164): '
        + (error?.message || error)
    );
  }
}

module.exports = { dropLegacyIndex };
