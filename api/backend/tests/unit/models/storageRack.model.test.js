// RF016 AC2: rack, position and container modelled apart, and the approved
// fixture's 8 by 12 grid with 96 unique positions.
const StorageRackModel = require('../../../src/models/StorageRack');
const StoragePositionModel = require('../../../src/models/StoragePosition');

describe('StorageRackModel', () => {
  it('builds the approved fixture: 8 rows by 12 columns, 96 unique positions A01 to H12', () => {
    const rack = StorageRackModel.createApprovedFixture({ storageRackId: 'rack-96-001' });
    const positions = StorageRackModel.positionsOf(rack);

    expect(rack).toMatchObject({ rowCount: 8, columnCount: 12, coordinateScheme: 'alpha_numeric', orientationRule: 'top_left_origin' });
    expect(positions).toHaveLength(96);
    expect(new Set(positions.map((p) => p.positionCode)).size).toBe(96);
    expect(new Set(positions.map((p) => p.storagePositionId)).size).toBe(96);
    expect(positions[0]).toEqual({
      storagePositionId: 'rack-96-001:A01', storageRackId: 'rack-96-001', rowIndex: 1, columnIndex: 1, positionCode: 'A01', status: 'available',
    });
    expect(positions[11].positionCode).toBe('A12');
    expect(positions[12].positionCode).toBe('B01');
    expect(positions[95]).toMatchObject({ positionCode: 'H12', rowIndex: 8, columnIndex: 12 });
  });

  it('derives the grid from the rack, whatever its size', () => {
    const rack = StorageRackModel.create({ storageRackId: 'rack-small', rackType: 'box', rowCount: 2, columnCount: 3 });
    expect(StorageRackModel.positionsOf(rack).map((p) => p.positionCode)).toEqual(['A01', 'A02', 'A03', 'B01', 'B02', 'B03']);
  });

  it('refuses a rack with no type, a grid the scheme cannot code, or an unknown scheme, orientation or status', () => {
    const ok = { rackType: 'cryogenic_rack', rowCount: 8, columnCount: 12 };
    expect(() => StorageRackModel.create({ ...ok, rackType: undefined })).toThrow('rackType');
    expect(() => StorageRackModel.create({ ...ok, rowCount: 0 })).toThrow('rowCount');
    expect(() => StorageRackModel.create({ ...ok, rowCount: 27 })).toThrow('rowCount');
    expect(() => StorageRackModel.create({ ...ok, columnCount: 100 })).toThrow('columnCount');
    expect(() => StorageRackModel.create({ ...ok, rowCount: 8.5 })).toThrow('rowCount');
    expect(() => StorageRackModel.create({ ...ok, coordinateScheme: 'numeric' })).toThrow('coordinateScheme');
    expect(() => StorageRackModel.create({ ...ok, orientationRule: 'bottom_left_origin' })).toThrow('orientationRule');
    expect(() => StorageRackModel.create({ ...ok, status: 'lost' })).toThrow('status');
  });
});

describe('StoragePositionModel', () => {
  it('requires its rack, code and 1-based indexes', () => {
    const ok = { storageRackId: 'rack-1', positionCode: 'A01', rowIndex: 1, columnIndex: 1 };
    expect(StoragePositionModel.create(ok).storagePositionId).toBe('rack-1:A01');
    expect(() => StoragePositionModel.create({ ...ok, storageRackId: undefined })).toThrow('storageRackId');
    expect(() => StoragePositionModel.create({ ...ok, rowIndex: 0 })).toThrow('rowIndex');
    expect(() => StoragePositionModel.create({ ...ok, status: 'occupied' })).toThrow('status');
  });
});
