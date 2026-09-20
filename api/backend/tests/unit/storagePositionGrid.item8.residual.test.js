import { describe, expect, it } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const {
  isPositionOccupied,
  getAllValidPositions,
  findFirstAvailablePosition,
} = require('../../src/utils/storagePositionGrid');

describe('storagePositionGrid item 8 residual branches', () => {
  it('treats a missing occupancy grid as empty', () => {
    expect(isPositionOccupied(null, 'A1')).toBe(false);
  });

  it('supports Map-like occupancy grids using both has and get', () => {
    const occupied = new Map([['A1', { specimenId: 'S-1' }], ['A2', null]]);

    expect(isPositionOccupied(occupied, 'A1')).toBe(true);
    expect(isPositionOccupied(occupied, 'A2')).toBe(false);
    expect(isPositionOccupied(occupied, 'A3')).toBe(false);
  });

  it('supports plain-object occupancy grids', () => {
    expect(isPositionOccupied({ A1: 'S-1', A2: null }, 'A1')).toBe(true);
    expect(isPositionOccupied({ A1: 'S-1', A2: null }, 'A2')).toBe(false);
  });

  it('enumerates every row/column position in canonical order', () => {
    expect(getAllValidPositions({ rows: 2, cols: 3 })).toEqual([
      'A1', 'A2', 'A3', 'B1', 'B2', 'B3',
    ]);
  });

  it('returns null for missing or non-positive box dimensions', () => {
    expect(findFirstAvailablePosition({})).toBeNull();
    expect(findFirstAvailablePosition({ dimension: { rows: 0, cols: 12 } })).toBeNull();
    expect(findFirstAvailablePosition({ dimension: { rows: 8, cols: 0 } })).toBeNull();
  });

  it('returns the first unoccupied position and null when the box is full', () => {
    const partial = {
      dimension: { rows: 1, cols: 3 },
      occupancyGrid: { A1: 'S-1', A2: null },
    };
    expect(findFirstAvailablePosition(partial)).toBe('A2');

    const full = {
      dimension: { rows: 1, cols: 2 },
      occupancyGrid: { A1: 'S-1', A2: 'S-2' },
    };
    expect(findFirstAvailablePosition(full)).toBeNull();
  });
});
