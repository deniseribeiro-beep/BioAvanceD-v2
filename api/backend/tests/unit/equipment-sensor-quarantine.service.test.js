import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const collectionResolverModule = require('../../src/utils/collectionResolver');
const sampleMovementLedgerModule = require('../../src/utils/sampleMovementLedger');
const SampleMovementModel = require('../../src/models/SampleMovement');

// Spies must be set before first require of the service so its module-scope
// destructuring captures the spied versions (CJS require caches the binding).
vi.spyOn(collectionResolverModule, 'getCollection');
vi.spyOn(sampleMovementLedgerModule, 'appendMovementWithHashChain').mockResolvedValue(undefined);
vi.spyOn(SampleMovementModel, 'generateMovementID').mockResolvedValue('MOV-1');
vi.spyOn(SampleMovementModel, 'create').mockImplementation((payload) => payload);

const servicePath = require.resolve('../../src/services/equipment-sensor-quarantine.service');
let service = require(servicePath);

function reloadServiceWithFreshBinding() {
  delete require.cache[servicePath];
  service = require(servicePath);
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(collectionResolverModule, 'getCollection');
  vi.spyOn(sampleMovementLedgerModule, 'appendMovementWithHashChain').mockResolvedValue(undefined);
  vi.spyOn(SampleMovementModel, 'generateMovementID').mockResolvedValue('MOV-1');
  vi.spyOn(SampleMovementModel, 'create').mockImplementation((payload) => payload);
  reloadServiceWithFreshBinding();
});

describe('equipment-sensor-quarantine.service', () => {
  describe('isQuarantineTriggerStatus', () => {
    it('recognizes known trigger statuses case-insensitively and trimmed', () => {
      expect(service.isQuarantineTriggerStatus('OFFLINE')).toBe(true);
      expect(service.isQuarantineTriggerStatus('  Manutenção ')).toBe(true);
      expect(service.isQuarantineTriggerStatus('awaiting repair')).toBe(true);
    });

    it('returns false for non-trigger statuses and nullish input', () => {
      expect(service.isQuarantineTriggerStatus('operational')).toBe(false);
      expect(service.isQuarantineTriggerStatus(undefined)).toBe(false);
      expect(service.isQuarantineTriggerStatus(null)).toBe(false);
    });
  });

  describe('quarantineByEquipmentStatus', () => {
    it('short-circuits without querying anything when status is not a trigger', async () => {
      const db = { collection: vi.fn() };

      const result = await service.quarantineByEquipmentStatus(db, { _id: 'E1' }, 'operational');

      expect(result).toEqual({ triggered: false, matched: 0, quarantined: 0, movements: 0 });
      expect(db.collection).not.toHaveBeenCalled();
    });

    it('finds locations by equipment identifiers, quarantines matching samples, and records a movement', async () => {
      const locationsCursor = { toArray: vi.fn(async () => [{ locationID: 10 }, { locationID: 20 }]) };
      const locationsCollection = { find: vi.fn(() => locationsCursor) };

      const sample = {
        _id: 'S1',
        barcode: 'BC-1',
        availableQuantity: 5,
        unit: 'mL',
        location: { area: 'A1' }
      };
      const samplesCursor = { toArray: vi.fn(async () => [sample]) };
      const samplesCollection = {
        find: vi.fn(() => samplesCursor),
        updateOne: vi.fn(async () => ({ matchedCount: 1 }))
      };
      const movementsCollection = { insertOne: vi.fn(async () => ({ insertedId: 'M1' })) };

      collectionResolverModule.getCollection.mockImplementation(async (_db, key) => {
        if (key === 'samples') return samplesCollection;
        if (key === 'sampleMovements') return movementsCollection;
        throw new Error(`unexpected key ${key}`);
      });

      const db = { collection: vi.fn(() => locationsCollection) };

      const result = await service.quarantineByEquipmentStatus(db, { equipmentID: 42 }, 'offline');

      expect(result.triggered).toBe(true);
      expect(result.matched).toBe(1);
      expect(result.quarantined).toBe(1);
      expect(result.movements).toBe(1);
      expect(result.locationIds).toEqual([10, 20]);
      expect(result.reason).toMatch(/Quarentena automática por equipamento 42 com status offline/);

      expect(samplesCollection.updateOne).toHaveBeenCalledWith(
        { _id: 'S1' },
        {
          $set: expect.objectContaining({
            status: 'QUARANTINED',
            currentStatus: 'QUARANTINED',
            release_status: 'QUARANTINE',
            quarantineSource: 'equipment',
            quarantineSourceId: '42',
            location: expect.objectContaining({ area: 'Quarentena', status: 'Quarantine' })
          })
        },
        undefined
      );

      expect(SampleMovementModel.generateMovementID).toHaveBeenCalledWith(db);
      expect(sampleMovementLedgerModule.appendMovementWithHashChain).toHaveBeenCalledWith(
        movementsCollection,
        expect.objectContaining({
          sampleID: 'S1',
          type: 'adjust',
          purpose: 'sensor_equipment_quarantine',
          quantity: 5
        }),
        {}
      );
    });

    it('returns zero-matched result when equipment has no resolvable identifiers', async () => {
      const db = { collection: vi.fn() };

      const result = await service.quarantineByEquipmentStatus(db, {}, 'inactive');

      expect(result).toEqual({
        triggered: true,
        matched: 0,
        quarantined: 0,
        movements: 0,
        reason: expect.stringContaining('desconhecido'),
        locationIds: []
      });
      expect(db.collection).not.toHaveBeenCalled();
    });
  });

  describe('quarantineBySensorStatus', () => {
    it('short-circuits when status is not a trigger', async () => {
      const result = await service.quarantineBySensorStatus({}, { sensorId: 'SEN-1' }, 'ok');
      expect(result).toEqual({ triggered: false, matched: 0, quarantined: 0, movements: 0 });
    });

    it('derives location candidates from sensorContext and options.updateData, quarantines samples without a location object', async () => {
      const sample = { _id: 'S9', quantity: 3 };
      const samplesCursor = { toArray: vi.fn(async () => [sample]) };
      const samplesCollection = {
        find: vi.fn(() => samplesCursor),
        updateOne: vi.fn(async () => ({ matchedCount: 1 }))
      };
      const movementsCollection = { insertOne: vi.fn(async () => ({ insertedId: 'M2' })) };

      collectionResolverModule.getCollection.mockImplementation(async (_db, key) => {
        if (key === 'samples') return samplesCollection;
        if (key === 'sampleMovements') return movementsCollection;
        throw new Error(`unexpected key ${key}`);
      });

      const db = {};

      const result = await service.quarantineBySensorStatus(
        db,
        { sensorId: 'SEN-1', locationId: '5' },
        'repair',
        { updateData: { locationID: '7' } }
      );

      expect(result.triggered).toBe(true);
      expect(result.matched).toBe(1);
      expect(result.locationIds).toEqual([5, 7]);
      expect(result.reason).toMatch(/Quarentena automática por sensor SEN-1 com status repair/);

      expect(samplesCollection.updateOne).toHaveBeenCalledWith(
        { _id: 'S9' },
        {
          $set: expect.objectContaining({
            quarantineSource: 'sensor',
            quarantineSourceId: 'SEN-1',
            locationStatus: 'Quarantine'
          })
        },
        undefined
      );
    });

    it('returns no-op result when no location candidates resolve to a usable filter', async () => {
      const db = {};

      const result = await service.quarantineBySensorStatus(db, {}, 'offline', {});

      expect(result).toEqual({
        triggered: true,
        matched: 0,
        quarantined: 0,
        movements: 0,
        reason: expect.stringContaining('desconhecido'),
        locationIds: []
      });
      expect(collectionResolverModule.getCollection).not.toHaveBeenCalled();
    });
  });
});
