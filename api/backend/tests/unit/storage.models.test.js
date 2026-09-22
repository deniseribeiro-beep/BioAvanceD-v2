import { describe, it, expect } from 'vitest';
const mongoose = require('mongoose');

const StorageContainer = require('../../src/models/StorageContainer');
const StorageBox = require('../../src/models/StorageBox');

describe('StorageContainer model', () => {
  it('valida payload mínimo de container', () => {
    const result = StorageContainer.validate({
      name: 'Ultra-Freezer 01',
      containerType: 'FREEZER',
    });

    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('rejeita container sem name ou tipo inválido', () => {
    const result = StorageContainer.validate({
      name: '',
      containerType: 'INVALID',
    });

    expect(result.isValid).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      'name é obrigatório',
      'containerType inválido',
    ]));
  });
});

describe('StorageBox model', () => {
  it('gera posições válidas e valida coordenadas dentro do grid', () => {
    const box = new StorageBox({
      name: 'Box A1-01',
      parent_id: new mongoose.Types.ObjectId(),
      dimension: { rows: 2, cols: 3 },
      occupancyGrid: new Map(),
    });

    expect(box.getAllValidPositions()).toEqual(['A1', 'A2', 'A3', 'B1', 'B2', 'B3']);
    expect(box.isValidPosition('A1')).toBe(true);
    expect(box.isValidPosition('C1')).toBe(false);
    expect(box.checkPositionOccupancy('C1')).toEqual({ occupied: null, error: 'INVALID_POSITION', specimenObjectId: null });
  });

  it('serializa occupancyGrid e calcula posições disponíveis', () => {
    const occupiedSampleId = new mongoose.Types.ObjectId();
    const box = new StorageBox({
      name: 'Box B1-01',
      parent_id: new mongoose.Types.ObjectId(),
      dimension: { rows: 2, cols: 2 },
      occupancyGrid: new Map([
        ['A1', occupiedSampleId],
      ]),
      currentOccupancy: 1,
    });

    const json = box.toJSON();

    expect(json.capacityTotal).toBe(4);
    expect(json.availablePositions).toBe(3);
    expect(json.occupancyGrid.A1).toBeDefined();
  });
});
