import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const collectionResolverModule = require('../../src/utils/collectionResolver');
const sampleMovementLedgerModule = require('../../src/utils/sampleMovementLedger');
const SampleMovementModel = require('../../src/models/SampleMovement');
const NormalizedPhysicalStorageStore = require('../../src/infrastructure/persistence/mongo/NormalizedPhysicalStorageStore');

// Spies must be set before first require of the service so its module-scope
// destructuring captures the spied versions (CJS require caches the binding).
vi.spyOn(collectionResolverModule, 'getCollection');
vi.spyOn(sampleMovementLedgerModule, 'appendMovementWithHashChain').mockResolvedValue(undefined);
vi.spyOn(SampleMovementModel, 'generateMovementID').mockResolvedValue('MOV-1');
vi.spyOn(SampleMovementModel, 'create').mockImplementation((payload) => payload);

const servicePath = require.resolve('../../src/services/equipment-sensor-quarantine.service');
const quarantineActionServicePath = require.resolve('../../src/services/quarantine-action.service');

function reloadServiceWithFreshBinding() {
  // quarantine-action.service.js also destructures `getCollection` at
  // module scope, and Node's real require cache (via createRequire) is
  // shared across test files in this worker — if it loaded before this
  // file's spy was installed, its binding stays unspied forever unless
  // busted here too, not just the service under test.
  delete require.cache[quarantineActionServicePath];
  delete require.cache[servicePath];
  service = require(servicePath);
}

let service = require(servicePath);
reloadServiceWithFreshBinding();

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

    // #464: equipment -> FREEZER StorageContainer (containerID join) ->
    // SHELF -> RACK -> StorageBox, mirroring #462/#463's upward walk.
    it('resolves the freezer by equipmentID, walks down to its boxes, quarantines matching samples, and records a movement', async () => {
      const freezerId = 'FRZ-1';
      const shelfId = 'SHF-1';
      const rackId = 'RCK-1';
      const boxId = 'BOX-1';

      const storageContainersCollection = {
        find: vi.fn((filter) => {
          if (filter.containerType === 'FREEZER') {
            return { toArray: vi.fn(async () => [{ _id: freezerId, containerID: 42 }]) };
          }
          if (filter.containerType === 'SHELF') {
            return { toArray: vi.fn(async () => (filter.parent_id === freezerId ? [{ _id: shelfId }] : [])) };
          }
          if (filter.containerType === 'RACK') {
            return { toArray: vi.fn(async () => (filter.parent_id.$in.includes(shelfId) ? [{ _id: rackId }] : [])) };
          }
          if (filter.containerType === 'DRAWER') {
            return { toArray: vi.fn(async () => []) };
          }
          return { toArray: vi.fn(async () => []) };
        })
      };
      const storageBoxesCollection = {
        find: vi.fn((filter) => ({
          toArray: vi.fn(async () => (filter.parent_id.$in.includes(rackId) ? [{ _id: boxId }] : []))
        }))
      };

      const sample = {
        _id: 'S1',
        specimenId: 'SPEC-S1',
        barcode: 'BC-1',
        currentQuantity: 5,
        unit: 'mL',
        specimenStatus: 'available'
      };
      vi.spyOn(NormalizedPhysicalStorageStore.prototype, 'findSpecimenIdsByLocation').mockResolvedValue(['SPEC-S1']);
      const samplesCursor = { toArray: vi.fn(async () => [sample]) };
      const samplesCollection = {
        find: vi.fn(() => samplesCursor),
        updateOne: vi.fn(async () => ({ matchedCount: 1 }))
      };
      const movementsCollection = { insertOne: vi.fn(async () => ({ insertedId: 'M1' })) };
      const quarantineActionsCollection = { insertOne: vi.fn(async () => ({ insertedId: 'QA1' })) };

      collectionResolverModule.getCollection.mockImplementation(async (_db, key) => {
        if (key === 'Specimen' || key === 'samples' || key === 'specimens') return samplesCollection;
        if (key === 'sampleMovements') return movementsCollection;
        if (key === 'quarantineActions') return quarantineActionsCollection;
        throw new Error(`unexpected key ${key}`);
      });

      const db = {
        collection: vi.fn((name) => {
          if (name === 'storageContainers') return storageContainersCollection;
          if (name === 'storageBoxes') return storageBoxesCollection;
          throw new Error(`unexpected collection ${name}`);
        })
      };

      const result = await service.quarantineByEquipmentStatus(db, { equipmentID: 42 }, 'offline');

      expect(result.triggered).toBe(true);
      expect(result.matched).toBe(1);
      expect(result.quarantined).toBe(1);
      expect(result.movements).toBe(1);
      expect(result.boxIds).toEqual([boxId]);
      expect(result.reason).toMatch(/Quarentena automática por equipamento 42 com status offline/);

      expect(samplesCollection.find).toHaveBeenCalledWith(
        expect.objectContaining({
          $and: expect.arrayContaining([
            { specimenId: { $in: ['SPEC-S1'] } },
            // #540: the "not already quarantined" guard reads the canonical
            // specimenStatus field now, not the legacy status/currentStatus pair.
            { specimenStatus: { $ne: 'quarantined' } }
          ])
        }),
        undefined
      );

      expect(samplesCollection.updateOne).toHaveBeenCalledWith(
        { _id: 'S1' },
        {
          $set: expect.objectContaining({
            specimenStatus: 'quarantined',
            quarantineSource: 'equipment',
            quarantineSourceId: '42',
            locationStatus: 'Quarantine'
          })
        },
        undefined
      );
      // #540: status/currentStatus are legacy fields canonical-data-contract-v1.md
      // bans on the Sample document — specimenStatus is the sole persisted signal.
      const persistedSet = samplesCollection.updateOne.mock.calls[0][1].$set;
      expect(persistedSet.status).toBeUndefined();
      expect(persistedSet.currentStatus).toBeUndefined();

      expect(quarantineActionsCollection.insertOne).toHaveBeenCalledWith(
        expect.objectContaining({
          specimenIds: ['SPEC-S1'],
          reasonCodes: ['equipment'],
          actionStatus: 'active'
        }),
        undefined
      );

      expect(SampleMovementModel.generateMovementID).toHaveBeenCalledWith(db);
      expect(sampleMovementLedgerModule.appendMovementWithHashChain).toHaveBeenCalledWith(
        movementsCollection,
        expect.objectContaining({
          specimenId: 'SPEC-S1',
          type: 'adjust',
          purpose: 'sensor_equipment_quarantine',
          quantity: 5
        }),
        {}
      );
    });

    it('resolves equipment identifiers from the bare `id` field when `_id`/`equipmentID` are absent', async () => {
      const storageContainersCollection = { find: vi.fn(() => ({ toArray: vi.fn(async () => []) })) };
      const db = { collection: vi.fn(() => storageContainersCollection) };

      await service.quarantineByEquipmentStatus(db, { id: 'EQ-BARE' }, 'offline');

      expect(storageContainersCollection.find).toHaveBeenCalledWith(
        {
          containerType: 'FREEZER',
          containerID: { $in: ['EQ-BARE'] }
        },
        undefined
      );
    });

    it('passes options.session through to the freezer lookup', async () => {
      const session = { id: 'sess-1' };
      const storageContainersCollection = { find: vi.fn(() => ({ toArray: vi.fn(async () => []) })) };
      const db = { collection: vi.fn(() => storageContainersCollection) };

      await service.quarantineByEquipmentStatus(db, { equipmentID: 1 }, 'offline', { session });

      expect(storageContainersCollection.find).toHaveBeenCalledWith(expect.anything(), { session });
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
        boxIds: []
      });
      expect(db.collection).not.toHaveBeenCalled();
    });
  });

  describe('quarantineBySensorStatus', () => {
    it('short-circuits when status is not a trigger', async () => {
      const result = await service.quarantineBySensorStatus({}, { sensorId: 'SEN-1' }, 'ok');
      expect(result).toEqual({ triggered: false, matched: 0, quarantined: 0, movements: 0 });
    });

    // #464: sensorContext.locationId/locationID (and options.updateData's
    // mirror fields) are equipment-level identifiers (#462/#463's
    // interim call), matched straight against FREEZER.containerID.
    it('derives equipment candidates from sensorContext and options.updateData, resolves their freezers boxes, quarantines samples without a location object', async () => {
      const boxId = 'BOX-9';
      const storageContainersCollection = {
        find: vi.fn((filter) => {
          if (filter.containerType === 'FREEZER') {
            const variants = filter.containerID.$in;
            if (variants.includes(5) || variants.includes(7)) {
              return { toArray: vi.fn(async () => [{ _id: 'FRZ-9', containerID: 5 }]) };
            }
            return { toArray: vi.fn(async () => []) };
          }
          if (filter.containerType === 'SHELF') {
            return { toArray: vi.fn(async () => (filter.parent_id === 'FRZ-9' ? [{ _id: 'SHF-9' }] : [])) };
          }
          if (filter.containerType === 'RACK') {
            return { toArray: vi.fn(async () => (filter.parent_id.$in.includes('SHF-9') ? [{ _id: 'RCK-9' }] : [])) };
          }
          return { toArray: vi.fn(async () => []) };
        })
      };
      const storageBoxesCollection = {
        find: vi.fn((filter) => ({
          toArray: vi.fn(async () => (filter.parent_id.$in.includes('RCK-9') ? [{ _id: boxId }] : []))
        }))
      };

      const sample = { _id: 'S9', specimenId: 'SPEC-S9', specimenStatus: 'available', quantity: 3 };
      vi.spyOn(NormalizedPhysicalStorageStore.prototype, 'findSpecimenIdsByLocation').mockResolvedValue(['SPEC-S9']);
      const samplesCursor = { toArray: vi.fn(async () => [sample]) };
      const samplesCollection = {
        find: vi.fn(() => samplesCursor),
        updateOne: vi.fn(async () => ({ matchedCount: 1 }))
      };
      const movementsCollection = { insertOne: vi.fn(async () => ({ insertedId: 'M2' })) };
      const quarantineActionsCollection = { insertOne: vi.fn(async () => ({ insertedId: 'QA2' })) };

      collectionResolverModule.getCollection.mockImplementation(async (_db, key) => {
        if (key === 'Specimen' || key === 'samples' || key === 'specimens') return samplesCollection;
        if (key === 'sampleMovements') return movementsCollection;
        if (key === 'quarantineActions') return quarantineActionsCollection;
        throw new Error(`unexpected key ${key}`);
      });

      const db = {
        collection: vi.fn((name) => {
          if (name === 'storageContainers') return storageContainersCollection;
          if (name === 'storageBoxes') return storageBoxesCollection;
          throw new Error(`unexpected collection ${name}`);
        })
      };

      const result = await service.quarantineBySensorStatus(
        db,
        { sensorId: 'SEN-1', locationId: '5' },
        'repair',
        { updateData: { locationID: '7' } }
      );

      expect(result.triggered).toBe(true);
      expect(result.matched).toBe(1);
      expect(result.boxIds).toEqual([boxId]);
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

    it('returns no-op result when no equipment candidates resolve to a usable filter', async () => {
      const db = {};

      const result = await service.quarantineBySensorStatus(db, {}, 'offline', {});

      expect(result).toEqual({
        triggered: true,
        matched: 0,
        quarantined: 0,
        movements: 0,
        reason: expect.stringContaining('desconhecido'),
        boxIds: []
      });
      expect(collectionResolverModule.getCollection).not.toHaveBeenCalled();
    });
  });
});


describe('equipment-sensor-quarantine item 8 canonical storage branches', () => {
  it('stops the freezer walk when no shelf exists', async () => {
    const storageContainers = {
      find: vi.fn((filter) => ({
        toArray: vi.fn(async () => filter.containerType === 'FREEZER'
          ? [{ _id: 'FRZ-NO-SHELF', containerID: 'EQ-NO-SHELF' }]
          : []),
      })),
    };
    const db = {
      collection: vi.fn((name) => {
        if (name === 'storageContainers') return storageContainers;
        if (name === 'storageBoxes') return { find: vi.fn() };
        throw new Error(`unexpected collection ${name}`);
      }),
    };

    const result = await service.quarantineByEquipmentStatus(
      db,
      { equipmentID: 'EQ-NO-SHELF' },
      'offline'
    );

    expect(result.boxIds).toEqual([]);
    expect(result.matched).toBe(0);
    expect(collectionResolverModule.getCollection).not.toHaveBeenCalled();
  });

  it('stops the freezer walk when shelves exist but no rack exists', async () => {
    const storageContainers = {
      find: vi.fn((filter) => ({
        toArray: vi.fn(async () => {
          if (filter.containerType === 'FREEZER') {
            return [{ _id: 'FRZ-NO-RACK', containerID: 'EQ-NO-RACK' }];
          }
          if (filter.containerType === 'SHELF') return [{ _id: 'SHELF-ONLY' }];
          if (filter.containerType === 'RACK') return [];
          return [];
        }),
      })),
    };
    const db = {
      collection: vi.fn((name) => {
        if (name === 'storageContainers') return storageContainers;
        if (name === 'storageBoxes') return { find: vi.fn() };
        throw new Error(`unexpected collection ${name}`);
      }),
    };

    const result = await service.quarantineByEquipmentStatus(
      db,
      { equipmentID: 'EQ-NO-RACK' },
      'maintenance'
    );

    expect(result.boxIds).toEqual([]);
    expect(result.matched).toBe(0);
  });

  it('walks sensor metadata/equipment aliases, arrays and drawer boxes, deduplicates boxes and records complete cold-chain context', async () => {
    const session = { id: 'cold-chain-session' };
    const freezerId = 'FRZ-COLD';
    const shelfId = 'SHF-COLD';
    const rackId = 'RCK-COLD';
    const drawerId = 'DRW-COLD';
    const boxId = 'BOX-COLD';

    const storageContainers = {
      find: vi.fn((filter, options) => ({
        toArray: vi.fn(async () => {
          expect(options).toEqual({ session });
          if (filter.containerType === 'FREEZER') {
            return [{ _id: freezerId, containerID: 'EQ-1' }];
          }
          if (filter.containerType === 'SHELF') return [{ _id: shelfId }];
          if (filter.containerType === 'RACK') return [{ _id: rackId }];
          if (filter.containerType === 'DRAWER') return [{ _id: drawerId }];
          return [];
        }),
      })),
    };
    const storageBoxes = {
      find: vi.fn((filter, options) => ({
        toArray: vi.fn(async () => {
          expect(options).toEqual({ session });
          expect(filter.parent_id.$in).toEqual(expect.arrayContaining([rackId, drawerId]));
          return [{ _id: boxId }];
        }),
      })),
    };
    const sensors = {
      find: vi.fn(() => ({
        toArray: vi.fn(async () => [{ sensorId: 'SEN-COLD', locationId: ['EQ-1', 'EQ-TEXT'] }]),
      })),
    };
    const sensorMetadata = {
      find: vi.fn(() => ({
        toArray: vi.fn(async () => [{
          sensorId: 'SEN-COLD',
          locationID: ['EQ-1', 'EQ-TEXT'],
          equipment: 'EQ-TEXT',
        }]),
      })),
    };
    const equipment = {
      findOne: vi.fn(async (_filter, options) => {
        expect(options).toEqual({ session });
        return { _id: 'mongo-eq-1', equipmentID: 'EQ-1' };
      }),
    };

    vi.spyOn(NormalizedPhysicalStorageStore.prototype, 'findSpecimenIdsByLocation')
      .mockResolvedValue(['SPEC-COLD']);

    const sample = {
      _id: 'SAMPLE-COLD-ID',
      quantity: 4,
      location: { freezer: freezerId, box: boxId },
      specimenStatus: 'available',
    };
    const samplesCollection = {
      find: vi.fn((_filter, options) => {
        expect(options).toEqual({ session });
        return { toArray: vi.fn(async () => [sample]) };
      }),
      updateOne: vi.fn(async () => ({ matchedCount: 1, modifiedCount: 1 })),
    };
    const movementsCollection = { insertOne: vi.fn() };
    const quarantineActionsCollection = {
      insertOne: vi.fn(async () => ({ insertedId: 'QA-COLD' })),
      findOne: vi.fn(async () => null),
    };

    collectionResolverModule.getCollection.mockImplementation(async (_db, key) => {
      if (key === 'Specimen' || key === 'samples' || key === 'specimens') return samplesCollection;
      if (key === 'sampleMovements') return movementsCollection;
      if (key === 'quarantineActions') return quarantineActionsCollection;
      throw new Error(`unexpected key ${key}`);
    });

    const quarantineActionService = require(quarantineActionServicePath);
    const recordActionSpy = vi.spyOn(quarantineActionService, 'recordAction')
      .mockResolvedValue({ quarantineActionId: 'QA-COLD' });

    const db = {
      collection: vi.fn((name) => {
        if (name === 'storageContainers') return storageContainers;
        if (name === 'storageBoxes') return storageBoxes;
        if (name === 'sensors') return sensors;
        if (name === 'sensorMetadata') return sensorMetadata;
        if (name === 'equipment') return equipment;
        throw new Error(`unexpected collection ${name}`);
      }),
    };

    const result = await service.quarantineByColdChainIncident(
      db,
      {
        sensorId: 'SEN-COLD',
        status: 'acknowledged',
        currentTemperature: 0,
      },
      {
        session,
        auditInfo: {
          userId: 'USR-1',
          userName: 'Operator',
          userRole: 'technician',
          ipAddress: '203.0.113.10',
          userAgent: 'item8-test',
        },
      }
    );

    expect(result).toMatchObject({
      triggered: true,
      matched: 1,
      quarantined: 1,
      movements: 1,
      boxIds: [boxId],
      incidentId: 'SEN-COLD',
      sensorKey: 'SEN-COLD',
    });
    expect(result.reason).toContain('temperatura=0');

    expect(samplesCollection.updateOne).toHaveBeenCalledWith(
      { _id: 'SAMPLE-COLD-ID' },
      {
        $set: expect.objectContaining({
          specimenStatus: 'quarantined',
          quarantineReasonCode: 'COLD_CHAIN_INCIDENT',
          coldChainIncidentId: 'SEN-COLD',
          coldChainSensorKey: 'SEN-COLD',
          coldChainStatus: 'INCIDENT_OPEN',
          coldChainReviewRequired: true,
          location: expect.objectContaining({
            freezer: freezerId,
            box: boxId,
            status: 'Quarantine',
            area: 'Quarentena',
          }),
        }),
      },
      { session }
    );

    expect(recordActionSpy).toHaveBeenCalledWith(
      db,
      {
        specimenIds: ['SAMPLE-COLD-ID'],
        reasonCodes: ['COLD_CHAIN_INCIDENT'],
      },
      session
    );

    expect(SampleMovementModel.create).toHaveBeenCalledWith(expect.objectContaining({
      specimenId: 'SAMPLE-COLD-ID',
      barcode: null,
      quantity: 4,
      unit: 'µL',
      purpose: 'cold_chain_incident_quarantine',
      linkedProject: null,
      userId: 'USR-1',
      userName: 'Operator',
      userRole: 'technician',
      ipAddress: '203.0.113.10',
      userAgent: 'item8-test',
    }));
    expect(sampleMovementLedgerModule.appendMovementWithHashChain)
      .toHaveBeenCalledWith(movementsCollection, expect.anything(), { session });
  });

  it('marks cold-chain samples for review using the sensorID alias and session, including zero-count fallbacks', async () => {
    const session = { id: 'review-session' };
    const samplesCollection = {
      find: vi.fn((_filter, options) => {
        expect(options).toEqual({ session });
        return { toArray: vi.fn(async () => [{ _id: 'SAMPLE-REVIEW' }]) };
      }),
      updateMany: vi.fn(async () => ({})),
    };
    collectionResolverModule.getCollection.mockImplementation(async (_db, key) => {
      if (key === 'Specimen' || key === 'samples' || key === 'specimens') return samplesCollection;
      throw new Error(`unexpected key ${key}`);
    });

    const quarantineActionService = require(quarantineActionServicePath);
    const pendingSpy = vi.spyOn(quarantineActionService, 'markPendingReview')
      .mockResolvedValue({ updated: true });

    const result = await service.markColdChainIncidentSamplesForReview(
      {},
      { sensorID: 'SEN-REVIEW' },
      { session }
    );

    expect(result).toEqual({
      matched: 0,
      modified: 0,
      reviewRequired: true,
      incidentId: 'SEN-REVIEW',
    });
    expect(pendingSpy).toHaveBeenCalledWith({}, 'SAMPLE-REVIEW', session);
  });
});
