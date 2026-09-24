import { describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const registry = require('../../../src/config/canonicalEntityCollections.v2');
const topology = require('../../../src/foundation/mongoTopologyV2');

function fakeDb(initial = {}) {
  const collections = new Map(Object.entries(initial).map(([name, records]) => [name, [...records]]));
  const rename = vi.fn(async (source, target, options) => {
    if (options.dropTarget !== false || collections.has(target)) throw new Error('Unsafe rename');
    collections.set(target, collections.get(source));
    collections.delete(source);
  });
  const createCollection = vi.fn(async (name) => {
    if (collections.has(name)) throw new Error('Duplicate collection');
    collections.set(name, []);
  });
  return {
    collections,
    rename,
    createCollection,
    db: {
      listCollections: vi.fn(() => ({ toArray: async () => [...collections.keys()].map((name) => ({ name })) })),
      collection: (source) => ({
        rename: (target, options) => rename(source, target, options),
        find: () => ({ toArray: async () => structuredClone(collections.get(source) || []) }),
        countDocuments: async (query) => {
          const rows = collections.get(source) || [];
          if (query.$or) {
            const field = Object.keys(query.$or[0])[0];
            return rows.filter((row) => row[field] == null).length;
          }
          const field = Object.keys(query)[0];
          return rows.filter((row) => !query[field].$not.test(String(row[field] || ''))).length;
        },
      }),
      createCollection,
    },
  };
}

describe('canonical MongoDB topology v2', () => {
  it('resolves all 140 workbook entities and rejects collection aliases', () => {
    expect(Object.keys(registry.ENTITY_LOCATIONS)).toHaveLength(140);
    expect(registry.getCanonicalCollectionName('Participant')).toBe('participants');
    expect(registry.getCanonicalCollectionName('Specimen')).toBe('specimens');
    expect(registry.getCanonicalCollectionName('RCSAssessment')).toBe('rcsAssessments');
    expect(registry.getCanonicalCollectionName('SpecimenPreanalytics')).toBe('specimenPreanalytics');
    expect(registry.getCanonicalLocation('ContactInformation')).toMatchObject({ storageMode: 'EMBEDDED', fieldPrefix: 'contactInformation' });
    expect(registry.getCanonicalLocation('GovernanceInvariant')).toMatchObject({ storageMode: 'EMBEDDED', ownerEntity: 'GovernanceInvariantCatalog' });
    expect(registry.getCanonicalLocation('BaseRecord').storageMode).toBe('SHARED');
    expect(() => registry.getCanonicalCollectionName('patients')).toThrow();
    expect(() => registry.getCanonicalCollectionName('StorageAssignment')).toThrow();
  });

  it('plans migration and structural collections without mutating during dry-run', async () => {
    const state = fakeDb({ patients: [{ participantId: '550e8400-e29b-41d4-a716-446655440000' }] });
    const result = await topology.runTopology(state.db, { mode: 'dry-run' });
    expect(result.plan.renames).toContainEqual({ source: 'patients', target: 'participants' });
    expect(result.plan.toCreate).toContain('specimens');
    expect(result.plan.toCreate).not.toContain('modelArtifacts');
    expect(state.rename).not.toHaveBeenCalled();
    expect(state.createCollection).not.toHaveBeenCalled();
  });

  it('renames safely, keeps documents and is idempotent', async () => {
    const record = { participantId: '550e8400-e29b-41d4-a716-446655440000' };
    const state = fakeDb({ patients: [record] });
    const first = await topology.runTopology(state.db);
    expect(first.verification.verified).toBe(true);
    expect(state.collections.get('participants')).toEqual([record]);
    expect(state.collections.has('patients')).toBe(false);
    expect(state.rename).toHaveBeenCalledWith('patients', 'participants', { dropTarget: false });
    const second = await topology.runTopology(state.db);
    expect(second.plan.renames).toEqual([]);
    expect(second.plan.toCreate).toEqual([]);
    expect(state.rename).toHaveBeenCalledTimes(1);
  });

  it('blocks both source and target without merge, overwrite, or deletion', async () => {
    const state = fakeDb({ patients: [{ participantId: 'legacy' }], participants: [{ participantId: 'current' }] });
    await expect(topology.runTopology(state.db)).rejects.toMatchObject({ code: 'COLLECTION_MIGRATION_CONFLICT' });
    expect(state.rename).not.toHaveBeenCalled();
    expect(state.createCollection).not.toHaveBeenCalled();
    expect(state.collections.get('patients')).toHaveLength(1);
    expect(state.collections.get('participants')).toHaveLength(1);
  });

  it('blocks two legacy sources for the same target', async () => {
    const state = fakeDb({ samples: [{}], amostras: [{}] });
    await expect(topology.runTopology(state.db)).rejects.toMatchObject({ code: 'COLLECTION_MIGRATION_CONFLICT' });
    expect(state.rename).not.toHaveBeenCalled();
  });

  it('blocks a historical user without deterministic Actor mapping before renaming it', async () => {
    const state = fakeDb({ users: [{ _id: '507f1f77bcf86cd799439011' }] });
    await expect(topology.runTopology(state.db)).rejects.toMatchObject({
      code: 'DATA_MIGRATION_CONFLICT',
    });
    expect(state.rename).not.toHaveBeenCalled();
    expect(state.collections.has('users')).toBe(true);
  });
});
