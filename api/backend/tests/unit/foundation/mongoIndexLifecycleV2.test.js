import { describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const lifecycle = require('../../../src/foundation/mongoIndexLifecycleV2');

function fakeDb({ records = {}, indexes = {}, failCreate = null, omitCreated = false } = {}) {
  const names = new Set(lifecycle.activeConstraints.map((entry) => entry.collection));
  const documents = new Map([...names].map((name) => [name, [...(records[name] || [])]]));
  const catalog = new Map([...names].map((name) => [name, [
    { key: { _id: 1 }, name: '_id_' },
    ...(indexes[name] || []),
  ]]));
  const createIndex = vi.fn(async (name, keys, options) => {
    if (name === failCreate) throw Object.assign(new Error('index build failed'), { code: 11000 });
    if (!omitCreated) catalog.get(name).push({ key: { ...keys }, ...options });
    return options.name;
  });
  const aggregate = vi.fn(async (name, pipeline) => {
    const grouped = new Map();
    const group = pipeline.find((stage) => stage.$group).$group._id;
    for (const row of documents.get(name) || []) {
      const values = Object.values(group).map(({ $ifNull }) => row[$ifNull[0].slice(1)] ?? null);
      const key = JSON.stringify(values);
      grouped.set(key, (grouped.get(key) || 0) + 1);
    }
    return [{ duplicateGroupCount: [...grouped.values()].filter((count) => count > 1).length }];
  });
  return {
    documents,
    catalog,
    createIndex,
    aggregate,
    db: {
      listCollections: () => ({ toArray: async () => [...names].map((name) => ({ name })) }),
      collection: (name) => ({
        listIndexes: () => ({ toArray: async () => catalog.get(name) || [] }),
        aggregate: (pipeline) => ({ toArray: () => aggregate(name, pipeline) }),
        createIndex: (keys, options) => createIndex(name, keys, options),
      }),
    },
  };
}

describe('Foundation canonical MongoDB index lifecycle', () => {
  it('uses a reproducible manifest and excludes unresolved or legacy constraints', () => {
    const { manifest, activeConstraints } = lifecycle;
    expect(manifest.constraints).toHaveLength(80);
    expect(activeConstraints).toHaveLength(74);
    expect(manifest.constraints.filter((entry) => !entry.applyNow)).toHaveLength(6);
    expect(manifest.constraints.filter((entry) => entry.requiredForReadiness)).toHaveLength(74);
    expect(new Set(manifest.constraints.map((entry) => entry.constraintId)).size).toBe(80);
    expect(manifest.constraints.find((entry) => entry.constraintId === 'canonical-index:UserAccount:userAccountId'))
      .toMatchObject({ collection: 'userAccounts', physicalKeys: { userAccountId: 1 }, options: { unique: true }, applyNow: true, requiredForReadiness: true });
    expect(manifest.constraints.every((entry) => entry.collection && Object.keys(entry.physicalKeys).length)).toBe(true);
    expect(manifest.constraints.some((entry) => entry.entity === 'GovernanceInvariant')).toBe(false);
    expect(manifest.constraints.some((entry) => entry.entity === 'LabelDefinition' && entry.canonicalFields.includes('semanticVersion'))).toBe(false);
    expect(manifest.constraints.some((entry) => entry.entity === 'LabelTemplate' && entry.canonicalFields.includes('semanticVersion'))).toBe(false);
    expect(manifest.constraints.some((entry) => entry.canonicalFields.includes('terminologyValid'))).toBe(false);
    expect(manifest.constraints.some((entry) => entry.canonicalFields.includes('storageAssignmentId'))).toBe(false);
    expect(manifest.constraints.find((entry) => entry.entity === 'StoragePosition' && entry.canonicalFields.includes('positionCode')).physicalKeys)
      .toEqual({ storageRackId: 1, positionCode: 1 });
  });

  it('finds missing constraints without changing dry-run data or indexes', async () => {
    const state = fakeDb();
    const result = await lifecycle.runIndexLifecycle(state.db, { mode: 'dry-run' });
    expect(result.wouldCreate).toHaveLength(74);
    expect(result.wouldBlock).toBe(true);
    expect(result.verified).toBe(false);
    expect(state.createIndex).not.toHaveBeenCalled();
    expect(state.documents.get('canonicalModelReleases')).toEqual([]);
  });

  it('creates missing indexes once, verifies the real catalog and is idempotent', async () => {
    const state = fakeDb();
    const first = await lifecycle.runIndexLifecycle(state.db);
    expect(first.created).toHaveLength(74);
    expect(first.verified).toBe(74);
    expect(first.ready).toBe(true);
    const second = await lifecycle.runIndexLifecycle(state.db);
    expect(second.created).toEqual([]);
    expect(second.verified).toBe(74);
    expect(second.ready).toBe(true);
    expect(state.createIndex).toHaveBeenCalledTimes(74);
    expect(state.catalog.has('modelArtifacts')).toBe(false);
  });

  it('detects duplicate keys without modifying documents or creating that index', async () => {
    const state = fakeDb({ records: { canonicalModelReleases: [
      { canonicalModelReleaseId: 'same', semanticVersion: '2.0.0' },
      { canonicalModelReleaseId: 'same', semanticVersion: '2.0.0' },
    ] } });
    const before = JSON.stringify(state.documents.get('canonicalModelReleases'));
    const result = await lifecycle.runIndexLifecycle(state.db);
    expect(result.ready).toBe(false);
    expect(result.preflight.conflicts.some((item) => item.collection === 'canonicalModelReleases' && item.duplicateGroupCount === 1)).toBe(true);
    expect(state.createIndex.mock.calls.some(([name]) => name === 'canonicalModelReleases')).toBe(false);
    expect(JSON.stringify(state.documents.get('canonicalModelReleases'))).toBe(before);
  });

  it('blocks a divergent index without dropping it', async () => {
    const state = fakeDb({ indexes: { canonicalModelReleases: [
      { key: { semanticVersion: 1 }, name: 'existing_nonunique_semver' },
    ] } });
    const result = await lifecycle.runIndexLifecycle(state.db);
    expect(result.ready).toBe(false);
    expect(result.blocked).toContainEqual({ constraintId: 'canonical-index:CanonicalModelRelease:semanticVersion', state: 'MISMATCH' });
    expect(state.catalog.get('canonicalModelReleases').some((item) => item.name === 'existing_nonunique_semver')).toBe(true);
  });

  it('blocks failed creation and a success response not reflected in the catalog', async () => {
    const failed = fakeDb({ failCreate: 'canonicalModelReleases' });
    const failedResult = await lifecycle.runIndexLifecycle(failed.db);
    expect(failedResult.ready).toBe(false);
    expect(failedResult.errors.length).toBeGreaterThan(0);
    const unverified = fakeDb({ omitCreated: true });
    const unverifiedResult = await lifecycle.runIndexLifecycle(unverified.db);
    expect(unverifiedResult.created).toHaveLength(74);
    expect(unverifiedResult.verified).toBe(0);
    expect(unverifiedResult.ready).toBe(false);
  });

  it('preserves local unmanaged indexes', async () => {
    const state = fakeDb({ indexes: { canonicalModelReleases: [
      { key: { releaseStatus: 1 }, name: 'local_release_status' },
    ] } });
    const result = await lifecycle.runIndexLifecycle(state.db);
    expect(result.ready).toBe(true);
    expect(state.catalog.get('canonicalModelReleases').some((item) => item.name === 'local_release_status')).toBe(true);
  });

  it('stable()-normalizes nested option objects and arrays when comparing indexes', () => {
    const expected = {
      physicalKeys: { userAccountId: 1 },
      options: {
        unique: true,
        collation: { locale: 'en', strength: 2, alternate: ['non-ignorable', 'shifted'] },
        partialFilterExpression: { status: { $in: ['active', 'pending'] } },
      },
    };
    const actual = {
      key: { userAccountId: 1 },
      unique: true,
      collation: { strength: 2, alternate: ['non-ignorable', 'shifted'], locale: 'en' },
      partialFilterExpression: { status: { $in: ['active', 'pending'] } },
    };
    expect(lifecycle.equivalent(expected, actual)).toBe(true);
  });

  it('rejects indexes whose physical keys do not match', () => {
    expect(lifecycle.equivalent(
      { physicalKeys: { userAccountId: 1 }, options: { unique: true } },
      { key: { email: 1 }, unique: true },
    )).toBe(false);
  });

  it('rejects option mismatches that are not MongoDB false-flag omissions', () => {
    expect(lifecycle.equivalent(
      { physicalKeys: { userAccountId: 1 }, options: { unique: true, sparse: true } },
      { key: { userAccountId: 1 }, unique: true, sparse: false },
    )).toBe(false);
  });

  it('remaps a missing canonical collection to a single legacy source when topologyPlan is provided', async () => {
    const indexes = [{ key: { _id: 1 }, name: '_id_' }, { key: { userAccountId: 1 }, name: 'legacy_uuid', unique: true }];
    const db = {
      listCollections: () => ({ toArray: async () => [{ name: 'users' }] }),
      collection: (name) => ({
        listIndexes: () => ({
          toArray: async () => {
            if (name !== 'users') throw new Error(`unexpected collection ${name}`);
            return indexes;
          },
        }),
      }),
    };
    const catalog = await lifecycle.discoverIndexes(db, { remapped: true });
    expect(catalog.get('userAccounts')).toEqual({ physical: 'users', indexes });
  });

  it('leaves physical null when topologyPlan is set but no single legacy source is present', async () => {
    const db = {
      listCollections: () => ({ toArray: async () => [{ name: 'unrelated' }] }),
      collection: () => ({ listIndexes: () => ({ toArray: async () => [] }) }),
    };
    const catalog = await lifecycle.discoverIndexes(db, {});
    expect(catalog.get('userAccounts')).toEqual({ physical: null, indexes: [] });
  });

  it('skips unique preflight and records REQUIRED_COLLECTION_MISSING when physical is absent', async () => {
    const db = {
      listCollections: () => ({ toArray: async () => [] }),
      collection: () => ({
        listIndexes: () => ({ toArray: async () => [] }),
        aggregate: () => ({ toArray: async () => { throw new Error('aggregate should not run'); } }),
        createIndex: async () => { throw new Error('createIndex should not run'); },
      }),
    };
    const catalog = await lifecycle.discoverIndexes(db);
    expect([...catalog.values()].every((entry) => entry.physical === null)).toBe(true);
    const plan = lifecycle.planIndexes(catalog);
    const preflight = await lifecycle.preflightIndexes(db, plan, catalog);
    expect(preflight.passed).toBe(true);
    expect(preflight.conflicts).toEqual([]);
    const result = await lifecycle.runIndexLifecycle(db);
    expect(result.errors.some((item) => item.code === 'REQUIRED_COLLECTION_MISSING')).toBe(true);
  });

  it('preflight applies partialFilterExpression and sparse stages before duplicate grouping', async () => {
    const pipelines = [];
    const db = {
      collection: () => ({
        aggregate: (pipeline) => {
          pipelines.push(pipeline);
          return { toArray: async () => [] };
        },
      }),
    };
    const constraint = {
      constraintId: 'synthetic-sparse-partial',
      collection: 'userAccounts',
      physicalKeys: { userAccountId: 1 },
      options: {
        unique: true,
        sparse: true,
        partialFilterExpression: { status: 'active' },
      },
    };
    const plan = { entries: [{ constraint, state: 'MISSING' }] };
    const catalog = new Map([['userAccounts', { physical: 'userAccounts', indexes: [] }]]);
    const preflight = await lifecycle.preflightIndexes(db, plan, catalog);
    expect(preflight.passed).toBe(true);
    expect(pipelines).toHaveLength(1);
    expect(pipelines[0][0]).toEqual({ $match: { status: 'active' } });
    expect(pipelines[0][1]).toEqual({
      $match: { $or: [{ userAccountId: { $exists: true } }] },
    });
  });

  it('rejects an invalid index lifecycle mode', async () => {
    const state = fakeDb();
    await expect(lifecycle.runIndexLifecycle(state.db, { mode: 'wipe' }))
      .rejects.toThrow('Invalid index lifecycle mode');
  });

  it('records INDEX_APPLY_FAILED when createIndex throws without a driver code', async () => {
    const state = fakeDb();
    state.createIndex.mockImplementation(async () => {
      throw new Error('catalog write denied');
    });
    const result = await lifecycle.runIndexLifecycle(state.db);
    expect(result.ready).toBe(false);
    expect(result.errors.some((item) => item.code === 'INDEX_APPLY_FAILED')).toBe(true);
  });
});