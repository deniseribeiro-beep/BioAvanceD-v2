import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const indexes = require('../../../src/utils/physicalChainIndexes');
const physicalChain = require('../../../src/services/physicalChain.service');
const storageLocations = require('../../../src/services/storageLocation.service');

function recordingCollection() {
  const calls = [];
  return { calls, async createIndex(keys, options) { calls.push(options === undefined ? [keys] : [keys, options]); } };
}

function recordingDb() {
  const collections = {};
  return {
    collections,
    collection(name) {
      collections[name] = collections[name] || recordingCollection();
      return collections[name];
    },
  };
}

const OPEN = { assignmentStatus: 'active' };

// #1314: the specs the services built before the helpers existed, verbatim.
const EXPECTED = {
  containers: [[{ containerId: 1 }, { unique: true, name: 'uniq_containerId' }]],
  specimenContainerAssignments: [
    [{ specimenId: 1 }, { unique: true, name: 'uniq_open_specimen', partialFilterExpression: OPEN }],
    [{ containerId: 1 }],
  ],
  containerPositionAssignments: [
    [{ containerId: 1 }, { unique: true, name: 'uniq_open_container', partialFilterExpression: OPEN }],
    [{ storagePositionId: 1 }, { unique: true, name: 'uniq_open_position', partialFilterExpression: OPEN }],
  ],
  rackLocationAssignments: [[{ storageRackId: 1 }, { unique: true, name: 'uniq_open_rack', partialFilterExpression: OPEN }]],
  storageLocations: [
    [{ storageLocationId: 1 }, { unique: true, name: 'uniq_storageLocationId' }],
    [{ organizationId: 1 }],
  ],
};

// #1513 (RF016 AC2): the rack grid's own specs, built by the rack service
// and never by ensurePhysicalChainIndexes.
const RACK_EXPECTED = {
  storageRacks: [[{ storageRackId: 1 }, { unique: true, name: 'uniq_storageRackId' }]],
  storagePositions: [
    [{ storagePositionId: 1 }, { unique: true, name: 'uniq_storagePositionId' }],
    [{ storageRackId: 1 }],
  ],
};

const HELPERS = {
  containers: indexes.ensureContainerIndexes,
  specimenContainerAssignments: indexes.ensureSpecimenContainerAssignmentIndexes,
  containerPositionAssignments: indexes.ensureContainerPositionAssignmentIndexes,
  rackLocationAssignments: indexes.ensureRackLocationAssignmentIndexes,
  storageLocations: indexes.ensureStorageLocationIndexes,
  storageRacks: indexes.ensureStorageRackIndexes,
  storagePositions: indexes.ensureStoragePositionIndexes,
};

describe('physicalChainIndexes (#1314)', () => {
  for (const [name, helper] of Object.entries(HELPERS)) {
    it(`${name}: keys, names and partial filters as the services built them`, async () => {
      const collection = recordingCollection();
      await helper(collection);
      expect(collection.calls).toEqual({ ...EXPECTED, ...RACK_EXPECTED }[name]);
    });
  }

  it('skips a value that is not a collection', async () => {
    for (const helper of Object.values(HELPERS)) {
      await expect(helper(null)).resolves.toBeUndefined();
      await expect(helper({})).resolves.toBeUndefined();
    }
  });

  it('ensurePhysicalChainIndexes and ensureLocationIndexes build exactly these specs, once per db', async () => {
    const db = recordingDb();
    await physicalChain.ensurePhysicalChainIndexes(db);
    await physicalChain.ensurePhysicalChainIndexes(db);
    await storageLocations.ensureLocationIndexes(db);
    await storageLocations.ensureLocationIndexes(db);
    expect(Object.fromEntries(Object.entries(db.collections).map(([name, collection]) => [name, collection.calls]))).toEqual(EXPECTED);
  });
});
