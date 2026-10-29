/**
 * RNF002 C1, C3, C4 (#1324): records the execution plan, the indexes and
 * the load profile of the operational identifier lookups (specimenId,
 * pseudonymised participantId, indexed LabelIdentifier), and their p95
 * latency against the 3 s budget.
 *
 *   node scripts/identifier-lookup-explain.js --out <file> [--seed <n>] [--runs <k>]
 *
 * The record is written only to --out: the Mongo connection logs to stdout,
 * so a record printed there would not read back as JSON.
 *
 * `--seed n` writes n synthetic documents per lookup collection, only into
 * a database whose lookup collections are empty, then builds the Foundation
 * indexes. Exit code 1 when a lookup has no probe value, is not served by
 * its expected index, or has no p95 within budget.
 *
 * A row names the filter's fields and never an identifier value.
 */
const { performance } = require('perf_hooks');
const { connectNewDB, closeConnection } = require('../src/database/mongo');
const { CANONICAL_COLLECTIONS } = require('../src/config/collections');
const { buildFoundationIndexes, verifyFoundationIndexes } = require('../src/foundation/indexes');

const BUDGET_MS = 3000;
const DEFAULT_RUNS = 200;
const SEED_BATCH = 1000;
const USAGE = 'usage: node scripts/identifier-lookup-explain.js --out <file> [--seed <n>] [--runs <k>]';

const IDENTIFIER_LOOKUPS = [
  {
    id: 'participant',
    requirement: 'RNF002 C1',
    collection: CANONICAL_COLLECTIONS.patients,
    field: 'participantId',
    filter: (v) => ({ participantId: v }),
    index: 'patients_participantid_idx_v1',
    site: 'paciente.controller.js:879',
  },
  {
    id: 'participant-identity',
    requirement: 'RNF002 C1',
    collection: CANONICAL_COLLECTIONS.participantIdentities,
    field: 'participantId',
    filter: (v) => ({ participantId: v }),
    index: 'participant_identities_participant_id_idx_v1',
    site: 'eConsent.js:95',
  },
  {
    id: 'specimen',
    requirement: 'RNF002 C1',
    collection: CANONICAL_COLLECTIONS.samples,
    field: 'specimenId',
    filter: (v) => ({ specimenId: v }),
    index: 'samples_specimenid_idx_v1',
    site: null,
  },
  {
    id: 'sample-barcode',
    requirement: 'RNF002 C1',
    collection: CANONICAL_COLLECTIONS.samples,
    field: 'barcode',
    filter: (v) => ({ barcode: String(v) }),
    index: 'samples_barcode_unique_v2',
    site: 'labelResolver.service.js:68',
  },
  {
    id: 'label',
    requirement: 'RNF002 C1',
    collection: CANONICAL_COLLECTIONS.labelIdentifiers,
    field: 'encodedValue',
    filter: (v) => ({ encodedValue: v, status: 'active' }),
    index: 'label_identifiers_encoded_value_active_idx_v1',
    site: 'labelResolver.service.js:105',
  },
];

function lookupCollections() {
  return [...new Set(IDENTIFIER_LOOKUPS.map((lookup) => lookup.collection))];
}

/** The Foundation build that serves `lookup`, or null. */
function coveringBuild(builds, lookup) {
  const filterFields = Object.keys(lookup.filter('x'));
  return builds.find((build) => build.collection === lookup.collection
    && build.name === lookup.index
    && filterFields.includes(Object.keys(build.keys || {})[0])) || null;
}

/** Reads the plan tree and the execution counts out of an explain. */
function summarizeExplain(explain) {
  const stages = [];
  let indexName = null;
  let collscan = false;
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (node.stage) stages.push(node.stage);
    if (node.stage === 'COLLSCAN') collscan = true;
    if (indexName === null && node.indexName) indexName = node.indexName;
    walk(node.queryPlan);
    walk(node.inputStage);
    if (Array.isArray(node.inputStages)) node.inputStages.forEach(walk);
  };
  walk(explain?.queryPlanner?.winningPlan);
  const stats = explain?.executionStats || {};
  const count = (value) => (typeof value === 'number' ? value : null);
  return {
    stages,
    indexName,
    indexed: indexName !== null && !collscan,
    keysExamined: count(stats.totalKeysExamined),
    docsExamined: count(stats.totalDocsExamined),
    nReturned: count(stats.nReturned),
    executionTimeMillis: count(stats.executionTimeMillis),
  };
}

/** Nearest-rank percentile; null for an empty list. */
function percentile(values, p) {
  if (!values || values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(Math.ceil(p * sorted.length) - 1, 0)];
}

function seedDocument(collection, i) {
  const n = String(i).padStart(6, '0');
  switch (collection) {
    case CANONICAL_COLLECTIONS.patients:
    case CANONICAL_COLLECTIONS.participantIdentities:
      return { participantId: `BENCH-P-${n}` };
    case CANONICAL_COLLECTIONS.samples:
      return { specimenId: `BENCH-S-${n}`, participantId: `BENCH-P-${n}`, barcode: `BENCH-B-${n}` };
    case CANONICAL_COLLECTIONS.labelIdentifiers:
      return {
        labelIdentifierId: `BENCH-L-${n}`,
        encodedValue: `BENCH-E-${n}`,
        status: 'active',
        namespaceRegistryId: 'BENCH-NS',
        targetType: 'container',
        targetId: `BENCH-C-${n}`,
      };
    default:
      throw new Error(`no seed document for ${collection}`);
  }
}

/** Seeding writes only into a database whose lookup collections are empty. */
async function assertSeedable(db) {
  for (const collection of lookupCollections()) {
    const n = await db.collection(collection).countDocuments({});
    if (n > 0) throw new Error(`refusing to seed: ${collection} holds ${n} documents`);
  }
}

async function seedLookups(db, n) {
  for (const collection of lookupCollections()) {
    for (let start = 0; start < n; start += SEED_BATCH) {
      const docs = [];
      for (let i = start; i < Math.min(start + SEED_BATCH, n); i += 1) docs.push(seedDocument(collection, i));
      await db.collection(collection).insertMany(docs, { ordered: false });
    }
  }
}

async function explainLookups(db, { runs = DEFAULT_RUNS } = {}) {
  const rows = [];
  for (const lookup of IDENTIFIER_LOOKUPS) {
    const collection = db.collection(lookup.collection);
    const probe = await collection.findOne({ [lookup.field]: { $exists: true } }, { projection: { [lookup.field]: 1 } });
    const base = {
      id: lookup.id,
      requirement: lookup.requirement,
      collection: lookup.collection,
      fields: Object.keys(lookup.filter('x')),
      expectedIndex: lookup.index,
    };
    if (!probe) {
      rows.push({ ...base, empty: true });
      continue;
    }
    const filter = lookup.filter(probe[lookup.field]);
    const explain = await collection.find(filter).limit(1).explain('executionStats');
    const timings = [];
    for (let run = 0; run < runs; run += 1) {
      const started = performance.now();
      await collection.findOne(filter);
      timings.push(performance.now() - started);
    }
    const p95Ms = percentile(timings, 0.95);
    rows.push({
      ...base,
      ...summarizeExplain(explain),
      p95Ms,
      runs,
      budgetMs: BUDGET_MS,
      // null: nothing was timed, so no budget claim either way.
      withinBudget: p95Ms === null ? null : p95Ms < BUDGET_MS,
    });
  }
  return rows;
}

class UsageError extends Error {}

function integerArg(flag, value, min) {
  if (!/^[0-9]+$/.test(value || '') || Number(value) < min) {
    throw new UsageError(`${flag} takes an integer of at least ${min}`);
  }
  return Number(value);
}

function parseArgs(argv) {
  const args = { seed: null, runs: DEFAULT_RUNS, out: null };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === '--seed') args.seed = integerArg(flag, argv[++i], 0);
    else if (flag === '--runs') args.runs = integerArg(flag, argv[++i], 1);
    else if (flag === '--out') args.out = argv[++i];
    else throw new UsageError(`unknown argument ${flag}`);
  }
  if (!args.out) throw new UsageError('--out <file> is required');
  return args;
}

function exitCodeFor(record) {
  const failed = (record?.lookups || []).some((row) => row.empty
    || !row.indexed
    || row.indexName !== row.expectedIndex
    || row.withinBudget !== true);
  return failed ? 1 : 0;
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    console.error(error.message);
    console.log(USAGE);
    process.exitCode = 1;
    return;
  }
  const db = await connectNewDB();
  try {
    if (args.seed !== null) {
      await assertSeedable(db);
      await seedLookups(db, args.seed);
      const builds = await buildFoundationIndexes(db);
      const missing = await verifyFoundationIndexes(db, builds);
      if (missing.length > 0) {
        console.error(JSON.stringify({ missingIndexes: missing.map(({ collection, name, error }) => ({ collection, name, error })) }));
        process.exitCode = 1;
        return;
      }
    }
    const lookups = await explainLookups(db, { runs: args.runs });
    const counts = {};
    const indexes = {};
    for (const collection of lookupCollections()) {
      counts[collection] = await db.collection(collection).estimatedDocumentCount();
      indexes[collection] = (await db.collection(collection).listIndexes().toArray()).map((index) => index.name);
    }
    const record = {
      generatedAt: new Date().toISOString(),
      serverVersion: (await db.command({ buildInfo: 1 })).version,
      loadProfile: { counts, runs: args.runs },
      indexes,
      lookups,
    };
    const json = JSON.stringify(record, null, 2);
    require('fs').writeFileSync(args.out, json + '\n');
    process.exitCode = exitCodeFor(record);
  } finally {
    await closeConnection().catch(() => {});
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message || error);
    process.exit(1);
  });
}

module.exports = {
  IDENTIFIER_LOOKUPS,
  coveringBuild,
  summarizeExplain,
  percentile,
  seedDocument,
  assertSeedable,
  explainLookups,
  parseArgs,
  exitCodeFor,
};
