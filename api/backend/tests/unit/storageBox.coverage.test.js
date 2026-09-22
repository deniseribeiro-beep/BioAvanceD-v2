import { describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import StorageBox from '../../src/models/StorageBox.js';

function makeBox() {
  return new StorageBox({
    name: 'Box item8',
    parent_id: new mongoose.Types.ObjectId(),
    dimension: { rows: 2, cols: 2 },
  });
}

describe('StorageBox item 8 simple branches', () => {
  it('covers invalid position input, syntax, row and column bounds', () => {
    const box = makeBox();
    expect(box.isValidPosition(null)).toBe(false);
    expect(box.isValidPosition(123)).toBe(false);
    expect(box.isValidPosition('bad')).toBe(false);
    expect(box.isValidPosition('C1')).toBe(false);
    expect(box.isValidPosition('A0')).toBe(false);
    expect(box.isValidPosition('A3')).toBe(false);
    expect(box.isValidPosition('B2')).toBe(true);
  });

  it('covers invalid occupancy requests and a missing occupancy grid', () => {
    const box = makeBox();
    expect(box.checkPositionOccupancy('bad')).toEqual({
      occupied: null,
      error: 'INVALID_POSITION',
      specimenObjectId: null,
    });

    box.occupancyGrid = undefined;
    expect(box.checkPositionOccupancy('A1')).toEqual({ occupied: false, specimenObjectId: null });

    const json = box.toJSON();
    expect(json.capacityTotal).toBe(4);
    expect(json.availablePositions).toBe(4);
  });

  it('static validation reports a missing name and required structure', () => {
    const result = StorageBox.validate({});
    expect(result.isValid).toBe(false);
    expect(result.errors).toContain('name é obrigatório');
    expect(result.errors).toContain('parent_id é obrigatório');
    expect(result.errors).toContain('dimension.rows é obrigatório');
    expect(result.errors).toContain('dimension.cols é obrigatório');
  });

  it('covers capacity, position enumeration, occupancy mutations and stats through the public model API', () => {
    const box = makeBox();
    const sampleA = new mongoose.Types.ObjectId();
    const sampleB = new mongoose.Types.ObjectId();

    expect(box.capacityTotal).toBe(4);
    expect(box.getAllValidPositions()).toEqual(['A1', 'A2', 'B1', 'B2']);

    expect(box.addSample('bad', sampleA)).toEqual({ success: false, error: 'INVALID_POSITION' });
    expect(box.addSample('A1', sampleA)).toEqual({ success: true });
    expect(box.currentOccupancy).toBe(1);
    expect(box.checkPositionOccupancy('A1')).toEqual({ occupied: true, specimenObjectId: sampleA });

    expect(box.addSample('A1', sampleB)).toEqual({
      success: false,
      error: 'POSITION_OCCUPIED',
      specimenObjectId: sampleA,
    });

    expect(box.getAvailablePositions()).toEqual(['A2', 'B1', 'B2']);

    expect(box.removeSample('bad')).toEqual({ success: false, error: 'INVALID_POSITION' });
    expect(box.removeSample('A2')).toEqual({ success: false, error: 'POSITION_EMPTY' });
    expect(box.removeSample('A1')).toEqual({ success: true, specimenObjectId: sampleA });
    expect(box.currentOccupancy).toBe(0);

    expect(box.getStats()).toEqual({
      boxID: box.boxID,
      name: 'Box item8',
      dimension: expect.objectContaining({ rows: 2, cols: 2 }),
      capacity: 4,
      occupied: 0,
      available: 4,
      occupancyPercent: 0,
      status: 'ACTIVE',
    });
  });

  it('serializes a populated occupancy map and reports derived availability', () => {
    const box = makeBox();
    const sample = new mongoose.Types.ObjectId();
    box.occupancyGrid.set('A1', sample);
    box.currentOccupancy = 1;

    const json = box.toJSON();

    expect(json.occupancyGrid).toEqual({ A1: sample });
    expect(json.capacityTotal).toBe(4);
    expect(json.availablePositions).toBe(3);
  });

  it('covers static row and column boundary validation as well as a valid structure', () => {
    const parentId = new mongoose.Types.ObjectId();

    const lowRows = StorageBox.validate({
      name: 'Box',
      parent_id: parentId,
      dimension: { rows: -1, cols: 2 },
    });
    expect(lowRows.errors).toContain('rows deve estar entre 1 e 26');

    const highRows = StorageBox.validate({
      name: 'Box',
      parent_id: parentId,
      dimension: { rows: 27, cols: 2 },
    });
    expect(highRows.errors).toContain('rows deve estar entre 1 e 26');

    const lowCols = StorageBox.validate({
      name: 'Box',
      parent_id: parentId,
      dimension: { rows: 2, cols: -1 },
    });
    expect(lowCols.errors).toContain('cols deve estar entre 1 e 100');

    const highCols = StorageBox.validate({
      name: 'Box',
      parent_id: parentId,
      dimension: { rows: 2, cols: 101 },
    });
    expect(highCols.errors).toContain('cols deve estar entre 1 e 100');

    const valid = StorageBox.validate({
      name: 'Box',
      parent_id: parentId,
      dimension: { rows: 2, cols: 2 },
    });
    expect(valid).toEqual({ isValid: true, errors: [] });
  });

  it('caps generated row labels at Z even if a non-persisted in-memory dimension exceeds the schema maximum', () => {
    const box = makeBox();
    box.dimension = { rows: 30, cols: 1 };

    const positions = box.getAllValidPositions();

    expect(positions).toHaveLength(26);
    expect(positions[0]).toBe('A1');
    expect(positions[25]).toBe('Z1');
  });

});
