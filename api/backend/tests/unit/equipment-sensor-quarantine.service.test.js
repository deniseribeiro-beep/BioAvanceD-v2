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
      expect(service.isQuarantineTriggerStatus('repair')).toBe(true);
      expect(service.isQuarantineTriggerStatus('awaiting repair')).toBe(true);
    });

    it('returns false for non-trigger statuses and nullish input', () => {
      expect(service.isQuarantineTriggerStatus('operational')).toBe(false);
      expect(service.isQuarantineTriggerStatus(undefined)).toBe(false);
      expect(service.isQuarantineTriggerStatus(null)).toBe(false);
    });

    // #883: routine maintenance/inactive states are not quarantine triggers
    // -- only failure states (offline/repair) are.
    it('does not treat routine Maintenance/Inactive states as triggers', () => {
      expect(service.isQuarantineTriggerStatus('Maintenance')).toBe(false);
      expect(service.isQuarantineTriggerStatus('maintenance')).toBe(false);
      expect(service.isQuarantineTriggerStatus('Inactive')).toBe(false);
      expect(service.isQuarantineTriggerStatus('inativo')).toBe(false);
      expect(service.isQuarantineTriggerStatus('  Manutenção ')).toBe(false);
    });

    it('still treats failure states as triggers', () => {
      expect(service.isQuarantineTriggerStatus('offline')).toBe(true);
      expect(service.isQuarantineTriggerStatus('repair')).toBe(true);
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
        barcode: 'BC-1',
        currentQuantity: 5,
        unit: 'mL',
        storageLocation: { boxId, position: 'A1' }
      };
      const samplesCursor = { toArray: vi.fn(async () => [sample]) };
      const samplesCollection = {
        find: vi.fn(() => samplesCursor),
        updateOne: vi.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }))
      };
      const movementsCollection = { insertOne: vi.fn(async () => ({ insertedId: 'M1' })) };
      const quarantineActionsCollection = { insertOne: vi.fn(async () => ({ insertedId: 'QA1' })) };
      const decisionsCollection = { insertOne: vi.fn(async () => ({ insertedId: 'D1' })) };

      collectionResolverModule.getCollection.mockImplementation(async (_db, key) => {
        if (key === 'samples') return samplesCollection;
        if (key === 'sampleMovements') return movementsCollection;
        if (key === 'quarantineActions') return quarantineActionsCollection;
        throw new Error(`unexpected key ${key}`);
      });

      const db = {
        collection: vi.fn((name) => {
          if (name === 'storageContainers') return storageContainersCollection;
          if (name === 'storageBoxes') return storageBoxesCollection;
          // RF006 AC7 (#1315): the decision service resolves its own collection.
          if (name === 'operationalStateDecisions') return decisionsCollection;
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
            { 'storageLocation.boxId': { $in: [boxId] } },
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
          specimenIds: ['S1'],
          reasonCodes: ['equipment'],
          actionStatus: 'active'
        }),
        undefined
      );
      expect(decisionsCollection.insertOne).toHaveBeenCalledWith(
        expect.objectContaining({ specimenId: 'S1', newStatus: 'quarantined', rulesApplied: ['sensor_equipment_quarantine'], reasonCodes: ['equipment'] }),
        undefined
      );

      // #1369: without a session the counter is bumped with no session, as
      // before; the model sends the same options for an undefined one.
      expect(SampleMovementModel.generateMovementID).toHaveBeenCalledTimes(1);
      const [counterDb, counterSession] = SampleMovementModel.generateMovementID.mock.calls[0];
      expect(counterDb).toBe(db);
      expect(counterSession).toBeUndefined();
      expect(sampleMovementLedgerModule.appendMovementWithHashChain).toHaveBeenCalledWith(
        movementsCollection,
        expect.objectContaining({
          specimenId: 'S1',
          type: 'adjust',
          purpose: 'sensor_equipment_quarantine',
          quantity: 5
        }),
        {}
      );
    });

    // #883: `quarantined` reflects whether the update actually changed the
    // document, not just that a matching sample was found.
    it('records nothing for a sample whose update reports modifiedCount 0', async () => {
      const freezerId = 'FRZ-2';
      const shelfId = 'SHF-2';
      const rackId = 'RCK-2';
      const boxId = 'BOX-2';

      const storageContainersCollection = {
        find: vi.fn((filter) => {
          if (filter.containerType === 'FREEZER') {
            return { toArray: vi.fn(async () => [{ _id: freezerId, containerID: 43 }]) };
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
        _id: 'S2',
        barcode: 'BC-2',
        currentQuantity: 5,
        unit: 'mL',
        storageLocation: { boxId, position: 'A1' }
      };
      const samplesCursor = { toArray: vi.fn(async () => [sample]) };
      const samplesCollection = {
        find: vi.fn(() => samplesCursor),
        updateOne: vi.fn(async () => ({ matchedCount: 1, modifiedCount: 0 }))
      };
      const movementsCollection = { insertOne: vi.fn(async () => ({ insertedId: 'M3' })) };
      const quarantineActionsCollection = { insertOne: vi.fn(async () => ({ insertedId: 'QA3' })) };

      collectionResolverModule.getCollection.mockImplementation(async (_db, key) => {
        if (key === 'samples') return samplesCollection;
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

      const result = await service.quarantineByEquipmentStatus(db, { equipmentID: 43 }, 'offline');

      expect(result.matched).toBe(1);
      expect(result.quarantined).toBe(0);
      // #883: a no-op update (a concurrent writer already quarantined it)
      // records no second QuarantineAction and no second ledger movement.
      expect(result.movements).toBe(0);
      expect(quarantineActionsCollection.insertOne).not.toHaveBeenCalled();
      expect(movementsCollection.insertOne).not.toHaveBeenCalled();
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

      const result = await service.quarantineByEquipmentStatus(db, {}, 'offline');

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

      const sample = { _id: 'S9', quantity: 3 };
      const samplesCursor = { toArray: vi.fn(async () => [sample]) };
      const samplesCollection = {
        find: vi.fn(() => samplesCursor),
        updateOne: vi.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }))
      };
      const movementsCollection = { insertOne: vi.fn(async () => ({ insertedId: 'M2' })) };
      const quarantineActionsCollection = { insertOne: vi.fn(async () => ({ insertedId: 'QA2' })) };
      const decisionsCollection = { insertOne: vi.fn(async () => ({ insertedId: 'D2' })) };

      collectionResolverModule.getCollection.mockImplementation(async (_db, key) => {
        if (key === 'samples') return samplesCollection;
        if (key === 'sampleMovements') return movementsCollection;
        if (key === 'quarantineActions') return quarantineActionsCollection;
        throw new Error(`unexpected key ${key}`);
      });

      const db = {
        collection: vi.fn((name) => {
          if (name === 'storageContainers') return storageContainersCollection;
          if (name === 'storageBoxes') return storageBoxesCollection;
          // RF006 AC7 (#1315): the decision service resolves its own collection.
          if (name === 'operationalStateDecisions') return decisionsCollection;
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

  // RF026 AC7: closed is final. A bulk quarantine never selects a closed
  // specimen and, should one still reach it, moves it nowhere and records no
  // OperationalStateDecision for it; an open specimen beside it is still
  // quarantined.
  describe('a closed specimen', () => {
    it('is excluded from the quarantine query and is neither moved nor given a decision, while an open one is quarantined', async () => {
      const closedSample = { _id: 'S-CLOSED', specimenId: 'SP-CLOSED', specimenStatus: 'closed', quantity: 0 };
      const openSample = { _id: 'S-OPEN', specimenId: 'SP-OPEN', specimenStatus: 'available', quantity: 2 };
      const samplesCollection = {
        // Returns both, as a read racing a close could: the loop must still skip it.
        find: vi.fn(() => ({ toArray: vi.fn(async () => [closedSample, openSample]) })),
        updateOne: vi.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }))
      };
      const movementsCollection = { insertOne: vi.fn(async () => ({ insertedId: 'M-NC' })) };
      const quarantineActionsCollection = { insertOne: vi.fn(async () => ({ insertedId: 'QA-NC' })) };
      const decisionsCollection = { insertOne: vi.fn(async () => ({ insertedId: 'D-NC' })) };

      collectionResolverModule.getCollection.mockImplementation(async (_db, key) => {
        if (key === 'samples') return samplesCollection;
        if (key === 'sampleMovements') return movementsCollection;
        if (key === 'quarantineActions') return quarantineActionsCollection;
        throw new Error(`unexpected key ${key}`);
      });
      const db = {
        collection: vi.fn((name) => {
          if (name === 'operationalStateDecisions') return decisionsCollection;
          throw new Error(`unexpected collection ${name}`);
        })
      };

      const result = await service.quarantineByNonconformance(db, {
        nonconformanceId: 'NC-1',
        nonconformanceType: 'process',
        affectedEntityIds: ['SP-CLOSED', 'SP-OPEN']
      });

      const query = samplesCollection.find.mock.calls[0][0];
      expect(query.$and).toContainEqual({ specimenStatus: { $nin: expect.arrayContaining(['closed', 'destroyed', 'disposed']) } });

      expect(result.quarantined).toBe(1);
      expect(samplesCollection.updateOne).toHaveBeenCalledTimes(1);
      expect(samplesCollection.updateOne).toHaveBeenCalledWith(
        { _id: 'S-OPEN' },
        { $set: expect.objectContaining({ specimenStatus: 'quarantined' }) },
        undefined
      );
      expect(decisionsCollection.insertOne).toHaveBeenCalledTimes(1);
      expect(decisionsCollection.insertOne).toHaveBeenCalledWith(
        expect.objectContaining({ specimenId: 'SP-OPEN', newStatus: 'quarantined' }),
        undefined
      );
      expect(decisionsCollection.insertOne).not.toHaveBeenCalledWith(
        expect.objectContaining({ specimenId: 'SP-CLOSED' }),
        expect.anything()
      );
    });
  });

  // #1369: the automatic quarantine runs inside its caller's transaction when
  // given a session; its movement id is then drawn in that session, beside
  // the in-session append, so the counter bump does not write-conflict.
  describe('inside a session', () => {
    it("takes the movement id and makes every write in the session it is given", async () => {
      const session = { id: 'sess-1369' };
      const sample = { _id: 'S-SESS', specimenId: 'SP-SESS', specimenStatus: 'available', quantity: 3 };
      const samplesCollection = {
        find: vi.fn(() => ({ toArray: vi.fn(async () => [sample]) })),
        updateOne: vi.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }))
      };
      const movementsCollection = { insertOne: vi.fn(async () => ({ insertedId: 'M-SESS' })) };
      const quarantineActionsCollection = { insertOne: vi.fn(async () => ({ insertedId: 'QA-SESS' })) };
      const decisionsCollection = { insertOne: vi.fn(async () => ({ insertedId: 'D-SESS' })) };

      collectionResolverModule.getCollection.mockImplementation(async (_db, key) => {
        if (key === 'samples') return samplesCollection;
        if (key === 'sampleMovements') return movementsCollection;
        if (key === 'quarantineActions') return quarantineActionsCollection;
        throw new Error(`unexpected key ${key}`);
      });
      const db = {
        collection: vi.fn((name) => {
          if (name === 'operationalStateDecisions') return decisionsCollection;
          throw new Error(`unexpected collection ${name}`);
        })
      };

      const result = await service.quarantineByNonconformance(db, {
        nonconformanceId: 'NC-1369',
        nonconformanceType: 'process',
        affectedEntityIds: ['SP-SESS']
      }, { session });

      expect(result.movements).toBe(1);
      expect(SampleMovementModel.generateMovementID.mock.calls).toStrictEqual([[db, session]]);
      expect(sampleMovementLedgerModule.appendMovementWithHashChain).toHaveBeenCalledWith(
        movementsCollection,
        expect.objectContaining({ specimenId: 'SP-SESS', movementID: 'MOV-1' }),
        { session }
      );
      expect(samplesCollection.updateOne.mock.calls[0][2]).toStrictEqual({ session });
      expect(quarantineActionsCollection.insertOne.mock.calls[0][1]).toStrictEqual({ session });
      expect(decisionsCollection.insertOne.mock.calls[0][1]).toStrictEqual({ session });
    });
  });
});

// #1505 (RF019 AC6): recordAction appends a QUARANTINE_APPLIED outbox event;
// this file's fake db has no outbox, and the event's contract is pinned in
// quarantine-action.service.test.js.
beforeEach(() => {
  const { GraphProjectionService } = require('../../src/services/graphProjection.service');
  vi.spyOn(GraphProjectionService.prototype, 'appendQuarantineApplyEvent').mockResolvedValue(null);
});
