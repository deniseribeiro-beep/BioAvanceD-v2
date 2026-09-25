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
  const updateOne = vi.fn(async (source, query, update) => {
    const rows = collections.get(source) || [];
    const row = rows.find((item) =>
      String(item._id) === String(query._id) &&
      (!Object.hasOwn(query, 'userAccountId') || item.userAccountId == null));
    if (!row) return { matchedCount: 0 };
    Object.assign(row, update.$set);
    return { matchedCount: 1 };
  });
  let forceInvalidUserAccountIds = false;
  return {
    collections,
    rename,
    createCollection,
    updateOne,
    forceInvalidUserAccountIdsAfterMigration() {
      forceInvalidUserAccountIds = true;
    },
    db: {
      listCollections: vi.fn(() => ({ toArray: async () => [...collections.keys()].map((name) => ({ name })) })),
      collection: (source) => ({
        rename: (target, options) => rename(source, target, options),
        find: () => ({ toArray: async () => structuredClone(collections.get(source) || []) }),
        updateOne: (query, update) => updateOne(source, query, update),
        countDocuments: async (query) => {
          if (forceInvalidUserAccountIds && source === 'users' && query.userAccountId) return 1;
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

  it('rejects an invalid topology mode', async () => {
    const state = fakeDb();
    await expect(topology.runTopology(state.db, { mode: 'rebuild' }))
      .rejects.toThrow('Invalid topology mode');
  });

  it('skips UserAccount identifier checks when skipAccount is set', async () => {
    const state = fakeDb({
      users: [{ _id: '507f1f77bcf86cd799439011', userAccountId: 'not-a-uuid' }],
    });
    const plan = topology.planTopology(state.collections.keys());
    const preflight = await topology.preflightTopology(state.db, plan, { skipAccount: true });
    expect(preflight.valid).toBe(true);
    expect(preflight.invalidIdentifiers).toEqual([]);
  });

  it('counts non-uuid primary identifiers with the exists/null query shape', async () => {
    const state = fakeDb({
      imagingStudies: [{ dicomStudyUid: null }, { dicomStudyUid: '1.2.840' }],
    });
    const preflight = await topology.preflightTopology(state.db, {
      renames: [],
      alreadyMigrated: ['imagingStudies'],
      toCreate: [],
      conflicts: [],
    });
    expect(preflight.valid).toBe(false);
    expect(preflight.invalidIdentifiers).toContainEqual(expect.objectContaining({
      collection: 'imagingStudies',
      entity: 'ImagingStudy',
      invalidIdCount: 1,
    }));
  });

  it('continues past rename targets that are not registered as canonical entities', async () => {
    const state = fakeDb({ sample_movements: [{ any: 1 }] });
    const plan = topology.planTopology(state.collections.keys());
    expect(plan.renames).toContainEqual({ source: 'sample_movements', target: 'sampleMovements' });
    const preflight = await topology.preflightTopology(state.db, plan);
    expect(preflight.valid).toBe(true);
  });

  it('blocks apply when structural identifiers are invalid', async () => {
    const state = fakeDb({
      patients: [{ participantId: 'legacy-not-uuid' }],
    });
    await expect(topology.runTopology(state.db)).rejects.toMatchObject({
      code: 'STRUCTURAL_MIGRATION_REQUIRED',
    });
    expect(state.rename).not.toHaveBeenCalled();
  });

  it('blocks apply when UserAccount identifiers remain invalid after account migration', async () => {
    const actorId = '550e8400-e29b-41d4-a716-446655440001';
    const state = fakeDb({
      patients: [{ participantId: '550e8400-e29b-41d4-a716-446655440000' }],
      users: [{ _id: '507f1f77bcf86cd799439011', actorId }],
      actors: [{ actorId }],
    });
    state.updateOne.mockImplementation(async (source, query, update) => {
      const rows = state.collections.get(source) || [];
      const row = rows.find((item) =>
        String(item._id) === String(query._id) &&
        (!Object.hasOwn(query, 'userAccountId') || item.userAccountId == null));
      if (!row) return { matchedCount: 0 };
      Object.assign(row, update.$set);
      if (source === 'users' && update.$set?.userAccountId) {
        state.forceInvalidUserAccountIdsAfterMigration();
      }
      return { matchedCount: 1 };
    });
    await expect(topology.runTopology(state.db)).rejects.toMatchObject({
      code: 'STRUCTURAL_MIGRATION_REQUIRED',
    });
    expect(state.rename).not.toHaveBeenCalled();
  });

  it('blocks apply when verification still sees missing required collections', async () => {
    const record = { participantId: '550e8400-e29b-41d4-a716-446655440000' };
    const state = fakeDb({ patients: [record] });
    state.createCollection.mockImplementation(async (name) => {
      if (name === 'specimens') return;
      if (state.collections.has(name)) throw new Error('Duplicate collection');
      state.collections.set(name, []);
    });
    await expect(topology.runTopology(state.db)).rejects.toMatchObject({
      code: 'TOPOLOGY_VERIFY_FAILED',
    });
  });
});
