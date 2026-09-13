import { describe, expect, it } from 'vitest';
import {
  canWithdrawSample,
  getPendingReturnQuantity,
  getSpecimenStatusColor,
  getStorageLabel,
  resolveInitialTab,
  resolveSpecimenStatus,
  translateSpecimenStatus,
} from './SampleWithdrawalReturnPage';
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

// #538: the withdraw/return gates used to read `sample.currentStatus`, a
// field the real withdraw/return write path (sample.service.js) never
// sets — these cover the fix, deriving from `specimenStatus` instead
// (dict-02 ELM-0123, the field Sample.js#computeStatus actually writes).
describe('resolveSpecimenStatus', () => {
  it('defaults to available when specimenStatus is absent, matching the backend default', () => {
    expect(resolveSpecimenStatus(null)).toBe('available');
    expect(resolveSpecimenStatus({})).toBe('available');
  });

  it('lowercases whatever specimenStatus carries', () => {
    expect(resolveSpecimenStatus({ specimenStatus: 'DEPLETED' as any })).toBe('depleted');
  });
});

describe('canWithdrawSample', () => {
  it('allows withdrawal for available and partial samples', () => {
    expect(canWithdrawSample({ specimenStatus: 'available' })).toBe(true);
    expect(canWithdrawSample({ specimenStatus: 'partial' })).toBe(true);
  });

  it('blocks withdrawal for depleted, quarantined, destroyed, unavailable, and disposed samples', () => {
    expect(canWithdrawSample({ specimenStatus: 'depleted' })).toBe(false);
    expect(canWithdrawSample({ specimenStatus: 'quarantined' })).toBe(false);
    expect(canWithdrawSample({ specimenStatus: 'destroyed' })).toBe(false);
    expect(canWithdrawSample({ specimenStatus: 'unavailable' })).toBe(false);
    expect(canWithdrawSample({ specimenStatus: 'disposed' })).toBe(false);
  });

  it('blocks withdrawal when there is no sample', () => {
    expect(canWithdrawSample(null)).toBe(false);
  });
});

describe('getPendingReturnQuantity', () => {
  it('returns 0 when there is no sample', () => {
    expect(getPendingReturnQuantity(null)).toBe(0);
  });

  it('returns totalWithdrawn minus totalReturned in the normal case', () => {
    expect(getPendingReturnQuantity({ specimenStatus: 'partial', totalWithdrawn: 30, totalReturned: 10 })).toBe(20);
  });

  it('falls back to the original quantity for legacy depleted samples with no ledger total', () => {
    expect(
      getPendingReturnQuantity({ specimenStatus: 'depleted', totalWithdrawn: 0, totalReturned: 0, initialQuantity: 500 })
    ).toBe(500);
  });

  it('does not apply the legacy fallback once a ledger total exists', () => {
    expect(
      getPendingReturnQuantity({ specimenStatus: 'depleted', totalWithdrawn: 500, totalReturned: 500, initialQuantity: 500 })
    ).toBe(0);
  });
});

describe('resolveInitialTab', () => {
  it('opens the return tab for partial and depleted samples', () => {
    expect(resolveInitialTab({ specimenStatus: 'partial' })).toBe('return');
    expect(resolveInitialTab({ specimenStatus: 'depleted' })).toBe('return');
  });

  it('opens the withdraw tab for available samples and anything else', () => {
    expect(resolveInitialTab({ specimenStatus: 'available' })).toBe('withdraw');
    expect(resolveInitialTab({ specimenStatus: 'quarantined' })).toBe('withdraw');
    expect(resolveInitialTab(null)).toBe('withdraw');
  });
});

describe('getSpecimenStatusColor / translateSpecimenStatus', () => {
  it('maps every canonical specimenStatus value to a color and a Portuguese label', () => {
    const values = ['available', 'reserved', 'checked_out', 'partial', 'depleted', 'quarantined', 'destroyed', 'unavailable', 'disposed'];
    for (const value of values) {
      expect(getSpecimenStatusColor(value)).not.toBe('var(--text)');
      expect(translateSpecimenStatus(value)).not.toBe(value);
    }
  });

  it('falls back gracefully for an unknown status', () => {
    expect(getSpecimenStatusColor('something-unknown')).toBe('var(--text)');
    expect(translateSpecimenStatus('something-unknown')).toBe('something-unknown');
    expect(translateSpecimenStatus(undefined)).toBe('-');
  });
});
