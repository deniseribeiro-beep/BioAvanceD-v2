import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { ObjectId } = require('mongodb');
const {
  StorageTopologyAuthoringService,
  topologyError,
} = require('../../src/services/storage-topology-authoring.service');

function collection(overrides = {}) {
  return {
    findOne: vi.fn().mockResolvedValue(null),
    insertOne: vi.fn().mockResolvedValue({ insertedId: new ObjectId('507f1f77bcf86cd799439011') }),
    ...overrides,
  };
}

function fixture(overrides = {}) {
  const collections = {
    storageContainers: collection(),
    storageBoxes: collection(),
    equipment: collection(),
    rooms: collection(),
    ...overrides,
  };
  const db = {
    collection: vi.fn((name) => {
      if (!collections[name]) collections[name] = collection();
      return collections[name];
    }),
  };
  const service = new StorageTopologyAuthoringService(db);
  vi.spyOn(service, 'ensureLayoutIndexes').mockResolvedValue(undefined);
  return { db, collections, service };
}

async function expectTopologyError(promise, code, statusCode = 400) {
  try {
    await promise;
    throw new Error('expected rejection');
  } catch (error) {
    expect(error.code).toBe(code);
    expect(error.statusCode).toBe(statusCode);
  }
}

describe('storage-topology-authoring.service item 8 coverage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('topologyError attaches code and HTTP status with the default and explicit status', () => {
    const defaultError = topologyError('X', 'message');
    expect(defaultError).toMatchObject({ code: 'X', statusCode: 400, message: 'message' });

    const notFound = topologyError('NF', 'missing', 404);
    expect(notFound).toMatchObject({ code: 'NF', statusCode: 404, message: 'missing' });
  });

  describe('createContainer', () => {
    it('requires a nonblank name and container type', async () => {
      const { service } = fixture();

      await expectTopologyError(service.createContainer({ containerType: 'FREEZER' }), 'INVALID_INPUT');
      await expectTopologyError(service.createContainer({ name: 'Freezer' }), 'INVALID_INPUT');
    });

    it('rejects unknown container type and status', async () => {
      let f = fixture();
      await expectTopologyError(
        f.service.createContainer({ name: 'X', containerType: 'BIN' }),
        'INVALID_CONTAINER_TYPE'
      );

      f = fixture();
      await expectTopologyError(
        f.service.createContainer({ name: 'X', containerType: 'FREEZER', status: 'broken' }),
        'INVALID_STATUS'
      );
    });

    it('rejects invalid parentId and roomId ObjectId syntax', async () => {
      let f = fixture();
      await expectTopologyError(
        f.service.createContainer({ name: 'Shelf', containerType: 'SHELF', parentId: 'bad' }),
        'INVALID_INPUT'
      );

      f = fixture();
      await expectTopologyError(
        f.service.createContainer({
          name: 'Freezer',
          containerType: 'FREEZER',
          equipmentId: 'EQ-1',
          roomId: 'bad',
        }),
        'INVALID_INPUT'
      );
    });

    it('enforces FREEZER root hierarchy and child parent requirements', async () => {
      const parentId = '507f1f77bcf86cd799439011';

      let f = fixture();
      await expectTopologyError(
        f.service.createContainer({
          name: 'Freezer',
          containerType: 'FREEZER',
          equipmentId: 'EQ-1',
          parentId,
        }),
        'INVALID_HIERARCHY'
      );

      f = fixture();
      await expectTopologyError(
        f.service.createContainer({ name: 'Shelf', containerType: 'SHELF' }),
        'INVALID_HIERARCHY'
      );
    });

    it('returns 404 when a child parent is absent and rejects the wrong parent type', async () => {
      const parentId = '507f1f77bcf86cd799439011';

      let f = fixture({
        storageContainers: collection({ findOne: vi.fn().mockResolvedValue(null) }),
      });
      await expectTopologyError(
        f.service.createContainer({ name: 'Shelf', containerType: 'SHELF', parentId }),
        'PARENT_NOT_FOUND',
        404
      );

      f = fixture({
        storageContainers: collection({
          findOne: vi.fn().mockResolvedValue({ _id: new ObjectId(parentId), containerType: 'RACK' }),
        }),
      });
      await expectTopologyError(
        f.service.createContainer({ name: 'Shelf', containerType: 'SHELF', parentId }),
        'INVALID_HIERARCHY'
      );
    });

    it('enforces room and temperature scope on non-FREEZER containers', async () => {
      const parentId = '507f1f77bcf86cd799439011';
      const roomId = '507f191e810c19729de860ea';

      let f = fixture({
        storageContainers: collection({
          findOne: vi.fn().mockResolvedValue({ containerType: 'FREEZER' }),
        }),
      });
      await expectTopologyError(
        f.service.createContainer({
          name: 'Shelf',
          containerType: 'SHELF',
          parentId,
          roomId,
        }),
        'INVALID_ROOM_SCOPE'
      );

      f = fixture({
        storageContainers: collection({
          findOne: vi.fn().mockResolvedValue({ containerType: 'FREEZER' }),
        }),
      });
      await expectTopologyError(
        f.service.createContainer({
          name: 'Shelf',
          containerType: 'SHELF',
          parentId,
          temperature: -80,
        }),
        'INVALID_TEMPERATURE_SCOPE'
      );
    });

    it('requires a FREEZER equipment identifier and registered equipment', async () => {
      let f = fixture();
      await expectTopologyError(
        f.service.createContainer({ name: 'Freezer', containerType: 'FREEZER' }),
        'INVALID_INPUT'
      );

      f = fixture({
        equipment: collection({ findOne: vi.fn().mockResolvedValue(null) }),
      });
      await expectTopologyError(
        f.service.createContainer({
          name: 'Freezer',
          containerType: 'FREEZER',
          equipmentId: 'EQ-404',
        }),
        'EQUIPMENT_NOT_FOUND',
        404
      );
      expect(f.collections.equipment.findOne).toHaveBeenCalledWith({
        equipmentID: { $in: ['EQ-404'] },
        deletedAt: null,
      });
    });

    it('builds numeric equipment identifier variants and requires a valid referenced room', async () => {
      const roomId = '507f191e810c19729de860ea';
      const equipment = collection({
        findOne: vi.fn().mockResolvedValue({ equipmentID: 123 }),
      });
      const rooms = collection({ findOne: vi.fn().mockResolvedValue(null) });
      const f = fixture({ equipment, rooms });

      await expectTopologyError(
        f.service.createContainer({
          name: 'Freezer',
          containerType: 'FREEZER',
          equipmentId: '123',
          roomId,
        }),
        'ROOM_NOT_FOUND',
        404
      );

      expect(equipment.findOne).toHaveBeenCalledWith({
        equipmentID: { $in: ['123', 123] },
        deletedAt: null,
      });
    });

    it('validates temperature unit, numeric temperature and nonnegative capacity', async () => {
      const registeredEquipment = collection({
        findOne: vi.fn().mockResolvedValue({ equipmentID: 'EQ-1' }),
      });

      let f = fixture({ equipment: registeredEquipment });
      await expectTopologyError(
        f.service.createContainer({
          name: 'Freezer',
          containerType: 'FREEZER',
          equipmentId: 'EQ-1',
          temperatureUnit: 'kelvin',
        }),
        'INVALID_TEMPERATURE_UNIT'
      );

      f = fixture({
        equipment: collection({ findOne: vi.fn().mockResolvedValue({ equipmentID: 'EQ-1' }) }),
      });
      await expectTopologyError(
        f.service.createContainer({
          name: 'Freezer',
          containerType: 'FREEZER',
          equipmentId: 'EQ-1',
          temperature: 'not-number',
        }),
        'INVALID_TEMPERATURE'
      );

      f = fixture({
        equipment: collection({ findOne: vi.fn().mockResolvedValue({ equipmentID: 'EQ-1' }) }),
      });
      await expectTopologyError(
        f.service.createContainer({
          name: 'Freezer',
          containerType: 'FREEZER',
          equipmentId: 'EQ-1',
          capacity: -1,
        }),
        'INVALID_CAPACITY'
      );

      f = fixture({
        equipment: collection({ findOne: vi.fn().mockResolvedValue({ equipmentID: 'EQ-1' }) }),
      });
      await expectTopologyError(
        f.service.createContainer({
          name: 'Freezer',
          containerType: 'FREEZER',
          equipmentId: 'EQ-1',
          capacity: 'NaN',
        }),
        'INVALID_CAPACITY'
      );
    });

    it('creates a full FREEZER document with room, explicit status and Fahrenheit temperature', async () => {
      const roomId = '507f191e810c19729de860ea';
      const storageContainers = collection();
      const equipment = collection({
        findOne: vi.fn().mockResolvedValue({ equipmentID: 'EQ-99' }),
      });
      const rooms = collection({
        findOne: vi.fn().mockResolvedValue({ _id: new ObjectId(roomId) }),
      });
      const f = fixture({ storageContainers, equipment, rooms });

      const result = await f.service.createContainer({
        name: '  Freezer A  ',
        description: '  Main freezer  ',
        containerType: 'freezer',
        equipmentId: 'EQ-99',
        roomId,
        temperature: '-80',
        temperatureUnit: 'fahrenheit',
        capacity: '120',
        status: 'maintenance',
      }, 'actor-1');

      expect(result).toMatchObject({
        name: 'Freezer A',
        description: 'Main freezer',
        containerType: 'FREEZER',
        parent_id: null,
        temperature: -80,
        temperatureUnit: 'FAHRENHEIT',
        capacity: 120,
        status: 'MAINTENANCE',
        createdBy: 'actor-1',
        containerID: 'EQ-99',
      });
      expect(result.roomId).toBeInstanceOf(ObjectId);
      expect(storageContainers.insertOne).toHaveBeenCalledTimes(1);
      expect(f.service.ensureLayoutIndexes).toHaveBeenCalledTimes(1);
    });

    it('creates child SHELF/RACK/DRAWER containers with canonical parent hierarchy and defaults', async () => {
      const parentId = '507f1f77bcf86cd799439011';

      for (const [containerType, expectedParentType] of [
        ['SHELF', 'FREEZER'],
        ['RACK', 'SHELF'],
        ['DRAWER', 'RACK'],
      ]) {
        const storageContainers = collection({
          findOne: vi.fn().mockResolvedValue({ containerType: expectedParentType }),
        });
        const f = fixture({ storageContainers });

        const result = await f.service.createContainer({
          name: `${containerType} A`,
          containerType,
          parent_id: parentId,
          description: '',
          capacity: null,
        });

        expect(result).toMatchObject({
          name: `${containerType} A`,
          description: null,
          containerType,
          roomId: null,
          temperature: null,
          temperatureUnit: 'CELSIUS',
          capacity: null,
          status: 'OPERATIONAL',
          createdBy: null,
        });
        expect(result.parent_id).toBeInstanceOf(ObjectId);
        expect(result).not.toHaveProperty('containerID');
      }
    });

    it('maps duplicate-key inserts to a 409 conflict and rethrows ordinary database errors', async () => {
      const duplicate = Object.assign(new Error('duplicate'), { code: 11000 });
      let f = fixture({
        equipment: collection({ findOne: vi.fn().mockResolvedValue({ equipmentID: 'EQ-1' }) }),
        storageContainers: collection({ insertOne: vi.fn().mockRejectedValue(duplicate) }),
      });
      await expectTopologyError(
        f.service.createContainer({
          name: 'Freezer',
          containerType: 'FREEZER',
          equipmentId: 'EQ-1',
        }),
        'STORAGE_CONTAINER_CONFLICT',
        409
      );

      f = fixture({
        equipment: collection({ findOne: vi.fn().mockResolvedValue({ equipmentID: 'EQ-1' }) }),
        storageContainers: collection({ insertOne: vi.fn().mockRejectedValue(new Error('db down')) }),
      });
      await expect(
        f.service.createContainer({
          name: 'Freezer',
          containerType: 'FREEZER',
          equipmentId: 'EQ-1',
        })
      ).rejects.toThrow('db down');
    });
  });

  describe('createBox', () => {
    it('requires name, parentId and a registered RACK/DRAWER parent', async () => {
      let f = fixture();
      await expectTopologyError(f.service.createBox({}), 'INVALID_INPUT');

      f = fixture();
      await expectTopologyError(f.service.createBox({ name: 'Box A' }), 'INVALID_HIERARCHY');

      const parentId = '507f1f77bcf86cd799439011';
      f = fixture({
        storageContainers: collection({ findOne: vi.fn().mockResolvedValue(null) }),
      });
      await expectTopologyError(
        f.service.createBox({ name: 'Box A', parentId, dimension: { rows: 1, cols: 1 } }),
        'PARENT_NOT_FOUND',
        404
      );

      f = fixture({
        storageContainers: collection({ findOne: vi.fn().mockResolvedValue({ containerType: 'SHELF' }) }),
      });
      await expectTopologyError(
        f.service.createBox({ name: 'Box A', parentId, dimension: { rows: 1, cols: 1 } }),
        'INVALID_HIERARCHY'
      );
    });

    it('validates row and column integer bounds', async () => {
      const parentId = '507f1f77bcf86cd799439011';
      const make = () => fixture({
        storageContainers: collection({ findOne: vi.fn().mockResolvedValue({ containerType: 'RACK' }) }),
      });

      for (const rows of [0, 27, 1.5, undefined]) {
        const f = make();
        await expectTopologyError(
          f.service.createBox({ name: 'Box', parentId, dimension: { rows, cols: 1 } }),
          'INVALID_DIMENSION'
        );
      }

      for (const cols of [0, 101, 1.5, undefined]) {
        const f = make();
        await expectTopologyError(
          f.service.createBox({ name: 'Box', parentId, dimension: { rows: 1, cols } }),
          'INVALID_DIMENSION'
        );
      }
    });

    it('rejects invalid status', async () => {
      const parentId = '507f1f77bcf86cd799439011';
      const f = fixture({
        storageContainers: collection({ findOne: vi.fn().mockResolvedValue({ containerType: 'RACK' }) }),
      });
      await expectTopologyError(
        f.service.createBox({
          name: 'Box',
          parentId,
          dimension: { rows: 1, cols: 1 },
          status: 'BROKEN',
        }),
        'INVALID_STATUS'
      );
    });

    it('creates canonical StorageBox documents for RACK and DRAWER parents with optional boxID branches', async () => {
      const parentId = '507f1f77bcf86cd799439011';

      let storageBoxes = collection();
      let f = fixture({
        storageContainers: collection({ findOne: vi.fn().mockResolvedValue({ containerType: 'RACK' }) }),
        storageBoxes,
      });
      let result = await f.service.createBox({
        name: '  Box A ',
        description: '  Rack box  ',
        parentId,
        dimension: { rows: '8', cols: '12' },
        boxID: 'BOX-1',
        status: 'full',
      }, 'actor-1');

      expect(result).toMatchObject({
        boxID: 'BOX-1',
        name: 'Box A',
        description: 'Rack box',
        dimension: { rows: 8, cols: 12 },
        occupancyGrid: {},
        capacity: 96,
        currentOccupancy: 0,
        status: 'FULL',
        createdBy: 'actor-1',
      });
      expect(result.parent_id).toBeInstanceOf(ObjectId);
      expect(result.createdAt).toBeInstanceOf(Date);
      expect(result.updatedAt).toBeInstanceOf(Date);
      expect(result.lastModified).toBeInstanceOf(Date);

      storageBoxes = collection();
      f = fixture({
        storageContainers: collection({ findOne: vi.fn().mockResolvedValue({ containerType: 'DRAWER' }) }),
        storageBoxes,
      });
      result = await f.service.createBox({
        name: 'Box B',
        description: '',
        parent_id: parentId,
        dimension: { rows: 1, cols: 1 },
        boxID: '',
      });

      expect(result.description).toBeNull();
      expect(result.status).toBe('ACTIVE');
      expect(result.createdBy).toBeNull();
      expect(result).not.toHaveProperty('boxID');
      expect(storageBoxes.insertOne).toHaveBeenCalledTimes(1);
    });
  });
});
