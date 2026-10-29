import { describe, it, expect } from 'vitest';
const {
  IDENTIFIER_LOOKUPS,
  coveringBuild,
  summarizeExplain,
  percentile,
  assertSeedable,
  explainLookups,
  parseArgs,
  exitCodeFor,
} = require('../../../scripts/identifier-lookup-explain');
const { buildFoundationIndexes } = require('../../../src/foundation/indexes');
const { CANONICAL_COLLECTIONS } = require('../../../src/config/collections');
const { createFakeDb } = require('../foundation/helpers/fake-db');

/**
 * RNF002 C1, C3, C4 (#1324): each operational identifier lookup is served
 * by an index the Foundation job builds, and the explain record reads a
 * plan as indexed only when no stage of it scans the collection.
 */
const STATS = { totalKeysExamined: 1, totalDocsExamined: 1, nReturned: 1, executionTimeMillis: 0 };

const IXSCAN_EXPLAIN = {
  queryPlanner: {
    winningPlan: {
      stage: 'LIMIT',
      inputStage: { stage: 'FETCH', inputStage: { stage: 'IXSCAN', indexName: 'samples_specimenid_idx_v1' } },
    },
  },
  executionStats: STATS,
};

const COLLSCAN_EXPLAIN = {
  queryPlanner: {
    winningPlan: {
      stage: 'OR',
      inputStages: [
        { stage: 'FETCH', inputStage: { stage: 'IXSCAN', indexName: 'samples_specimenid_idx_v1' } },
        { stage: 'COLLSCAN' },
      ],
    },
  },
  executionStats: { totalKeysExamined: 1, totalDocsExamined: 100000, nReturned: 1, executionTimeMillis: 40 },
};

const SBE_EXPLAIN = {
  queryPlanner: {
    winningPlan: {
      queryPlan: { stage: 'FETCH', inputStage: { stage: 'IXSCAN', indexName: 'patients_participantid_idx_v1' } },
      slotBasedPlan: { slots: '', stages: '' },
    },
  },
  executionStats: STATS,
};

describe('identifier lookup explain record', () => {
  for (const lookup of IDENTIFIER_LOOKUPS) {
    it(`${lookup.id} is served by ${lookup.index}`, async () => {
      const builds = await buildFoundationIndexes(createFakeDb());
      expect(coveringBuild(builds, lookup)).toMatchObject({ ok: true });
    });
  }

  it('builds the label lookup index when the unique label constraint fails', async () => {
    const db = createFakeDb({
      [CANONICAL_COLLECTIONS.labelIdentifiers]: () => ({
        createIndex: async (keys, options) => {
          if (options.unique) throw new Error('E11000 duplicate key error');
        },
      }),
    });
    const builds = await buildFoundationIndexes(db);
    const label = IDENTIFIER_LOOKUPS.find((lookup) => lookup.id === 'label');
    expect(coveringBuild(builds, label)).toMatchObject({ ok: true });
    expect(builds.find((build) => build.name === 'uniq_active_label_value')).toMatchObject({ ok: false });
  });

  it('reads an IXSCAN under FETCH as indexed', () => {
    expect(summarizeExplain(IXSCAN_EXPLAIN)).toEqual({
      stages: ['LIMIT', 'FETCH', 'IXSCAN'],
      indexName: 'samples_specimenid_idx_v1',
      indexed: true,
      keysExamined: 1,
      docsExamined: 1,
      nReturned: 1,
      executionTimeMillis: 0,
    });
  });

  it('reads a COLLSCAN as not indexed', () => {
    expect(summarizeExplain(COLLSCAN_EXPLAIN)).toMatchObject({
      indexName: 'samples_specimenid_idx_v1',
      indexed: false,
      docsExamined: 100000,
    });
  });

  it('reads an SBE queryPlan as indexed', () => {
    expect(summarizeExplain(SBE_EXPLAIN)).toMatchObject({
      stages: ['FETCH', 'IXSCAN'],
      indexName: 'patients_participantid_idx_v1',
      indexed: true,
    });
  });

  it('reads an explain without executionStats as null counts', () => {
    const { executionStats, ...plannerOnly } = IXSCAN_EXPLAIN;
    expect(summarizeExplain(plannerOnly)).toMatchObject({
      indexed: true, keysExamined: null, docsExamined: null, nReturned: null, executionTimeMillis: null,
    });
  });

  it('p95 of 1..100 is 95', () => {
    const values = Array.from({ length: 100 }, (_, i) => 100 - i);
    expect(percentile(values, 0.95)).toBe(95);
    expect(percentile([], 0.95)).toBeNull();
  });

  it('refuses to seed a database whose lookup collections hold documents', async () => {
    await expect(assertSeedable(createFakeDb())).resolves.toBeUndefined();

    const db = createFakeDb();
    await db.collection(CANONICAL_COLLECTIONS.patients).insertOne({ participantId: 'P-1' });
    await expect(assertSeedable(db)).rejects.toThrow(`refusing to seed: ${CANONICAL_COLLECTIONS.patients} holds 1 documents`);
  });

  it('rejects --runs 0, an empty --runs and a negative --runs', () => {
    for (const runs of ['0', '', '-1']) {
      expect(() => parseArgs(['--out', 'record.json', '--runs', runs]), runs).toThrow('--runs takes an integer of at least 1');
    }
    expect(parseArgs(['--out', 'record.json', '--runs', '1'])).toEqual({ seed: null, runs: 1, out: 'record.json' });
  });

  it('requires --out', () => {
    expect(() => parseArgs(['--runs', '5'])).toThrow('--out <file> is required');
  });

  it('fails a row whose p95 was never measured', async () => {
    const [row] = await explainLookups(stubDb(), { runs: 0 });
    expect(row).toMatchObject({ p95Ms: null, withinBudget: null, indexed: true });
    const measured = { ...row, indexName: row.expectedIndex, p95Ms: 1, withinBudget: true };
    expect(exitCodeFor({ lookups: [measured] })).toBe(0);
    expect(exitCodeFor({ lookups: [{ ...measured, p95Ms: null, withinBudget: null }] })).toBe(1);
  });

  it('records one row per lookup with field names and no values', async () => {
    const rows = await explainLookups(stubDb(), { runs: 3 });

    expect(rows).toHaveLength(IDENTIFIER_LOOKUPS.length);
    expect(rows).toHaveLength(5);
    rows.forEach((row, i) => {
      expect(row.fields).toEqual(Object.keys(IDENTIFIER_LOOKUPS[i].filter('x')));
      expect(row).toMatchObject({ id: IDENTIFIER_LOOKUPS[i].id, indexed: true, runs: 3, budgetMs: 3000, withinBudget: true });
    });
    expect(JSON.stringify(rows)).not.toContain('BENCH-');
  });
});

// A db whose every lookup finds a document and explains as an IXSCAN.
function stubDb() {
  return {
    collection: () => ({
      findOne: async () => ({
        participantId: 'BENCH-P-000001',
        specimenId: 'BENCH-S-000001',
        barcode: 'BENCH-B-000001',
        encodedValue: 'BENCH-E-000001',
      }),
      find: () => ({ limit: () => ({ explain: async () => IXSCAN_EXPLAIN }) }),
    }),
  };
}
