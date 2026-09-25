import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const ObjectId = require('mongodb').ObjectId;
const MongoStorageTopologyReadRepository = require('../../src/infrastructure/persistence/mongo/MongoStorageTopologyReadRepository');
const NormalizedPhysicalStorageStore = require('../../src/infrastructure/persistence/mongo/NormalizedPhysicalStorageStore');

afterEach(() => {
  vi.restoreAllMocks();
});

describe('MongoStorageTopologyReadRepository item 8 residual integrity branches', () => {
  it('defaults a missing occupancyGrid and uses sample._id when specimenId is absent', async () => {
    const sampleId = new ObjectId();
    const boxId = new ObjectId();
    const storageBoxes = {
      findOne: vi.fn().mockResolvedValue({ _id: boxId }),
    };
    const samples = {
      findOne: vi.fn().mockResolvedValue({ _id: sampleId }),
    };
    const db = {
      collection: vi.fn((name) => {
        if (name === 'storageBoxes') return storageBoxes;
        if (name === 'Specimen' || name === 'samples') return samples;
        return { findOne: vi.fn(), find: vi.fn() };
      }),
    };

    vi.spyOn(NormalizedPhysicalStorageStore.prototype, 'findCurrentBySpecimen')
      .mockResolvedValue(null);

    const repo = new MongoStorageTopologyReadRepository(db);
    const result = await repo.checkBoxIntegrity({ boxId: String(boxId) });

    // Empty/default occupancyGrid => no orphan checks; still a valid empty box.
    expect(result.valid).toBe(true);
    expect(storageBoxes.findOne).toHaveBeenCalled();
  });

  it('flags a sample without active physical placement using specimenId fallback to _id', async () => {
    const sampleId = new ObjectId();
    const boxId = new ObjectId();
    const storageBoxes = {
      findOne: vi.fn().mockResolvedValue({
        _id: boxId,
        occupancyGrid: { A1: String(sampleId) },
      }),
    };
    const samples = {
      findOne: vi.fn().mockResolvedValue({ _id: sampleId }),
    };
    const db = {
      collection: vi.fn((name) => {
        if (name === 'storageBoxes') return storageBoxes;
        return samples;
      }),
    };

    const findCurrent = vi.spyOn(NormalizedPhysicalStorageStore.prototype, 'findCurrentBySpecimen')
      .mockResolvedValue(null);

    const repo = new MongoStorageTopologyReadRepository(db);
    const result = await repo.checkBoxIntegrity({ boxId: String(boxId) });

    expect(findCurrent).toHaveBeenCalledWith(sampleId);
    expect(result.valid).toBe(false);
    expect(result.errors.some((msg) => msg.includes('posicionamento físico'))).toBe(true);
  });
});
