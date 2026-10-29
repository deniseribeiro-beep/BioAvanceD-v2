import { describe, it, expect } from 'vitest';

const StorageLocationModel = require('../../../src/models/StorageLocation');

describe('StorageLocationModel (P1X-0098..0104, RF017 AC1/AC8)', () => {
  const ok = { locationType: 'Facility', name: 'Biobanco central', code: 'BB-01', organizationId: 'org-A' };

  it('creates an active location with an id, its type lowercased', () => {
    const location = StorageLocationModel.create(ok);
    expect(location).toMatchObject({ locationType: 'facility', name: 'Biobanco central', code: 'BB-01', organizationId: 'org-A', parentLocationId: null, locationStatus: 'active' });
    expect(location.storageLocationId).toEqual(expect.any(String));
  });

  it('requires type, name, code and organization (1..1)', () => {
    for (const field of ['locationType', 'name', 'code', 'organizationId']) {
      expect(() => StorageLocationModel.create({ ...ok, [field]: undefined })).toThrow(field);
    }
  });

  it('accepts active, unavailable and interdicted, and nothing else', () => {
    for (const locationStatus of ['active', 'unavailable', 'interdicted']) {
      expect(StorageLocationModel.create({ ...ok, locationStatus }).locationStatus).toBe(locationStatus);
    }
    expect(() => StorageLocationModel.create({ ...ok, locationStatus: 'lost' })).toThrow('locationStatus');
  });

  it('refuses a location that is its own parent', () => {
    expect(() => StorageLocationModel.create({ ...ok, storageLocationId: 'loc-1', parentLocationId: 'loc-1' })).toThrow('parentLocationId');
  });

  it("keeps a child in its parent's organization (RF017 AC1)", () => {
    const parent = StorageLocationModel.create({ ...ok, storageLocationId: 'loc-1' });
    expect(() => StorageLocationModel.assertParentCompatible(StorageLocationModel.create({ ...ok, organizationId: 'org-B', parentLocationId: 'loc-1' }), parent)).toThrow('outra organização');
    expect(() => StorageLocationModel.assertParentCompatible(StorageLocationModel.create({ ...ok, parentLocationId: 'loc-1' }), parent)).not.toThrow();
  });

  it('is usable only while active (RF017 AC8)', () => {
    expect(StorageLocationModel.isUsable({ locationStatus: 'active' })).toBe(true);
    expect(StorageLocationModel.isUsable({ locationStatus: 'interdicted' })).toBe(false);
    expect(StorageLocationModel.isUsable({ locationStatus: 'unavailable' })).toBe(false);
  });
});
