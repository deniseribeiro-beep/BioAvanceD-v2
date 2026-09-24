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
});