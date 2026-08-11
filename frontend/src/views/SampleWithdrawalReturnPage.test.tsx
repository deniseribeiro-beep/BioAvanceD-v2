import { describe, expect, it } from 'vitest';
import { getStorageLabel } from './SampleWithdrawalReturnPage';
import type { SampleStorageLocationDTO } from '../types/models';

function makeLocation(overrides: Partial<SampleStorageLocationDTO> = {}): SampleStorageLocationDTO {
  return {
    specimenId: 'SPEC-1',
    box: { boxId: 'box-1', boxName: null, position: null },
    path: '',
    fullHierarchy: null,
    ...overrides,
  };
}

describe('getStorageLabel', () => {
  it('reports awaiting storage when no resolved location exists', () => {
    expect(getStorageLabel(null)).toBe('Aguardando Armazenagem');
  });

  it('reports awaiting storage when the resolved location has no box/path/position', () => {
    expect(getStorageLabel(makeLocation())).toBe('Aguardando Armazenagem');
  });

  it('prefers the readable path over the box name when both are present', () => {
    const location = makeLocation({
      path: 'FREEZER_01/SHELF_1/RACK_A/BOX_01',
      box: { boxId: 'box-1', boxName: 'BOX_01', position: 'A1' },
    });
    expect(getStorageLabel(location)).toBe('FREEZER_01/SHELF_1/RACK_A/BOX_01 / Posição A1');
  });

  it('falls back to the box name when there is no path', () => {
    const location = makeLocation({ box: { boxId: 'box-1', boxName: 'BOX_01', position: 'A1' } });
    expect(getStorageLabel(location)).toBe('BOX_01 / Posição A1');
  });

  it('falls back to just the position when neither path nor box name is present', () => {
    const location = makeLocation({ box: { boxId: 'box-1', boxName: null, position: 'A1' } });
    expect(getStorageLabel(location)).toBe('Posição A1');
  });
});
