const crypto = require('crypto');
const manifest = require('./canonical-index-manifest.v2.json');
const { LEGACY_RENAMES } = require('./mongoTopologyV2');

const activeConstraints = Object.freeze(manifest.constraints.filter((entry) => entry.applyNow));
const sourceByTarget = new Map();
for (const { source, target } of LEGACY_RENAMES) {
  if (!sourceByTarget.has(target)) sourceByTarget.set(target, []);
  sourceByTarget.get(target).push(source);
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  }
  return value;
}

function equivalent(expected, actual) {
  const keysMatch = JSON.stringify(Object.entries(expected.physicalKeys)) === JSON.stringify(Object.entries(actual.key || {}));
  if (!keysMatch) return false;
  for (const option of ['unique', 'sparse', 'partialFilterExpression', 'collation']) {
    if (JSON.stringify(stable(expected.options[option] ?? null)) !== JSON.stringify(stable(actual[option] ?? null))) {
      // MongoDB omits false flags in the catalog.
      if (!(expected.options[option] === false && actual[option] == null)) return false;
    }
  }
  return true;
}

function indexName(constraintId) {
  return `canonical_v2_${crypto.createHash('sha256').update(constraintId).digest('hex').slice(0, 20)}`;
}

async function discoverIndexes(db, topologyPlan = null) {
  const collections = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map((row) => row.name));
  const catalog = new Map();
  for (const name of new Set(activeConstraints.map((entry) => entry.collection))) {
    let physical = name;
    if (!collections.has(name) && topologyPlan) {
      const presentSources = (sourceByTarget.get(name) || []).filter((source) => collections.has(source));
      if (presentSources.length === 1) physical = presentSources[0];
    }
    catalog.set(name, collections.has(physical)
      ? { physical, indexes: await db.collection(physical).listIndexes().toArray() }
      : { physical: null, indexes: [] });
  }
  return catalog;
}

function planIndexes(catalog) {
  const entries = manifest.constraints.map((constraint) => {
    if (!constraint.applyNow) return { constraint, state: 'DEFERRED' };
    const actual = catalog.get(constraint.collection)?.indexes || [];
    const matching = actual.find((index) => equivalent(constraint, index));
    if (matching) return { constraint, state: 'PRESENT_VALID', indexName: matching.name };
    const sameKeys = actual.find((index) => JSON.stringify(Object.entries(index.key || {}))
      === JSON.stringify(Object.entries(constraint.physicalKeys)));
    const sameName = actual.find((index) => index.name === indexName(constraint.constraintId));
    if (sameKeys || sameName) return { constraint, state: 'MISMATCH', migrationRequired: true };
    return { constraint, state: 'MISSING' };
  });
  const managedNames = new Set(entries.filter((entry) => entry.indexName).map((entry) => `${entry.constraint.collection}:${entry.indexName}`));
  const unmanaged = [];
  for (const [collection, { indexes }] of catalog) {
    for (const index of indexes) {
      if (index.name === '_id_' || managedNames.has(`${collection}:${index.name}`)) continue;
      unmanaged.push({ collection, name: index.name, state: 'UNMANAGED_EXISTING' });
    }
  }
  return { entries, unmanaged };
}

async function preflightIndexes(db, plan, catalog) {
  const conflicts = [];
  for (const entry of plan.entries) {
    if (entry.state !== 'MISSING' || !entry.constraint.options.unique) continue;
    const { constraint } = entry;
    const physical = catalog.get(constraint.collection)?.physical;
    if (!physical) continue;
    const pipeline = [];
    if (constraint.options.partialFilterExpression) pipeline.push({ $match: constraint.options.partialFilterExpression });
    if (constraint.options.sparse) {
      pipeline.push({ $match: { $or: Object.keys(constraint.physicalKeys).map((field) => ({ [field]: { $exists: true } })) } });
    }
    pipeline.push({ $group: {
      _id: Object.fromEntries(Object.keys(constraint.physicalKeys).map((field, index) => [`k${index}`, { $ifNull: [`$${field}`, null] }])),
      count: { $sum: 1 },
    } });
    pipeline.push({ $match: { count: { $gt: 1 } } }, { $count: 'duplicateGroupCount' });
    const rows = await db.collection(physical).aggregate(pipeline).toArray();
    const duplicateGroupCount = rows[0]?.duplicateGroupCount || 0;
    if (duplicateGroupCount) conflicts.push({ constraintId: constraint.constraintId, collection: physical, duplicateGroupCount });
  }
  return { passed: conflicts.length === 0, conflicts };
}

async function runIndexLifecycle(db, { mode = 'apply', topologyPlan = null } = {}) {
  if (!['apply', 'dry-run'].includes(mode)) throw new Error('Invalid index lifecycle mode');
  const initialCatalog = await discoverIndexes(db, topologyPlan);
  const initialPlan = planIndexes(initialCatalog);
  const preflight = await preflightIndexes(db, initialPlan, initialCatalog);
  const dataConflicts = new Set(preflight.conflicts.map((item) => item.constraintId));
  const planned = initialPlan.entries.map((entry) => ({
    constraintId: entry.constraint.constraintId,
    collection: entry.constraint.collection,
    state: dataConflicts.has(entry.constraint.constraintId) ? 'DATA_CONFLICT' : entry.state,
    requiredForReadiness: entry.constraint.requiredForReadiness,
  }));
  if (mode === 'dry-run') return {
    mode, planned, preflight, created: [],
    wouldCreate: planned.filter((entry) => entry.state === 'MISSING').map((entry) => entry.constraintId),
    wouldBlock: planned.some((entry) => entry.requiredForReadiness && entry.state !== 'PRESENT_VALID'),
    migrationRequired: planned.some((entry) => ['MISMATCH', 'DATA_CONFLICT'].includes(entry.state)),
    verified: false,
  };

  const created = [];
  const errors = [];
  for (const entry of initialPlan.entries) {
    if (entry.state !== 'MISSING' || dataConflicts.has(entry.constraint.constraintId)) continue;
    const constraint = entry.constraint;
    if (!initialCatalog.get(constraint.collection)?.physical) {
      errors.push({ constraintId: constraint.constraintId, code: 'REQUIRED_COLLECTION_MISSING' });
      continue;
    }
    try {
      await db.collection(constraint.collection).createIndex(constraint.physicalKeys, {
        ...constraint.options,
        name: indexName(constraint.constraintId),
      });
      created.push(constraint.constraintId);
    } catch (error) {
      errors.push({ constraintId: constraint.constraintId, code: error?.code || 'INDEX_APPLY_FAILED' });
    }
  }

  const finalPlan = planIndexes(await discoverIndexes(db));
  const verified = finalPlan.entries.filter((entry) => entry.state === 'PRESENT_VALID' && entry.constraint.requiredForReadiness).length;
  const blocked = finalPlan.entries.filter((entry) => entry.constraint.requiredForReadiness && entry.state !== 'PRESENT_VALID')
    .map((entry) => ({ constraintId: entry.constraint.constraintId, state: dataConflicts.has(entry.constraint.constraintId) ? 'DATA_CONFLICT' : entry.state }));
  return {
    mode, planned, preflight, created, errors, verified,
    blocked,
    ready: blocked.length === 0 && errors.length === 0 && verified === activeConstraints.length,
    migrationRequired: blocked.some((entry) => ['MISMATCH', 'DATA_CONFLICT'].includes(entry.state)),
  };
}

module.exports = { manifest, activeConstraints, equivalent, indexName, discoverIndexes, planIndexes, preflightIndexes, runIndexLifecycle };
