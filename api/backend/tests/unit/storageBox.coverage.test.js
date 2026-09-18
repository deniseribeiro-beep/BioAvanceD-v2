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
      sampleID: null,
    });

    box.occupancyGrid = undefined;
    expect(box.checkPositionOccupancy('A1')).toEqual({ occupied: false, sampleID: null });

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
});
