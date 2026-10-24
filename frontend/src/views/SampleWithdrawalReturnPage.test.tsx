import { describe, expect, it } from 'vitest';
import {
  canWithdrawSample,
  getPendingReturnQuantity,
  getSpecimenStatusColor,
  getStorageLabel,
  isRcsGradeShown,
  resolveInitialTab,
  resolveSpecimenStatus,
  translateSpecimenStatus,
} from './SampleWithdrawalReturnPage';
import type { Sample, SampleStorageLocationDTO } from '../types/models';

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
// sets. RF006 AC2/AC3: the operational gate reads specimenStatus, and how
// much is left reads quantityStatus; withdraw and return no longer move
// specimenStatus.
describe('resolveSpecimenStatus', () => {
  it('defaults to available when specimenStatus is absent, matching the backend default', () => {
    expect(resolveSpecimenStatus(null)).toBe('available');
    expect(resolveSpecimenStatus({})).toBe('available');
  });

  it('lowercases whatever specimenStatus carries', () => {
    expect(resolveSpecimenStatus({ specimenStatus: 'CLOSED' })).toBe('closed');
  });
});

describe('canWithdrawSample', () => {
  it('allows withdrawal for an available specimen with a full or partial quantity', () => {
    expect(canWithdrawSample({ specimenStatus: 'available', quantityStatus: 'full' })).toBe(true);
    expect(canWithdrawSample({ specimenStatus: 'available', quantityStatus: 'partial' })).toBe(true);
  });

  it('blocks withdrawal when quantityStatus is depleted, though specimenStatus stays available', () => {
    expect(canWithdrawSample({ specimenStatus: 'available', quantityStatus: 'depleted' })).toBe(false);
    expect(canWithdrawSample({ specimenStatus: 'available', initialQuantity: 100, currentQuantity: 0 })).toBe(false);
  });

  it('blocks withdrawal for quarantined, unavailable and closed specimens', () => {
    expect(canWithdrawSample({ specimenStatus: 'quarantined', quantityStatus: 'full' })).toBe(false);
    expect(canWithdrawSample({ specimenStatus: 'unavailable', quantityStatus: 'full' })).toBe(false);
    expect(canWithdrawSample({ specimenStatus: 'closed', quantityStatus: 'depleted' })).toBe(false);
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
    expect(getPendingReturnQuantity({ specimenStatus: 'available', quantityStatus: 'partial', totalWithdrawn: 30, totalReturned: 10 })).toBe(20);
  });

  it('falls back to the original quantity for legacy depleted samples with no ledger total', () => {
    expect(
      getPendingReturnQuantity({ specimenStatus: 'available', quantityStatus: 'depleted', totalWithdrawn: 0, totalReturned: 0, initialQuantity: 500 })
    ).toBe(500);
  });

  it('does not apply the legacy fallback once a ledger total exists', () => {
    expect(
      getPendingReturnQuantity({ specimenStatus: 'available', quantityStatus: 'depleted', totalWithdrawn: 500, totalReturned: 500, initialQuantity: 500 })
    ).toBe(0);
  });

  it('offers no return for a closed specimen, whatever the ledger says', () => {
    expect(
      getPendingReturnQuantity({ specimenStatus: 'closed', quantityStatus: 'depleted', totalWithdrawn: 500, totalReturned: 0, initialQuantity: 500 })
    ).toBe(0);
  });
});

describe('resolveInitialTab', () => {
  it('opens the return tab when quantityStatus is partial or depleted', () => {
    expect(resolveInitialTab({ specimenStatus: 'available', quantityStatus: 'partial' })).toBe('return');
    expect(resolveInitialTab({ specimenStatus: 'available', quantityStatus: 'depleted' })).toBe('return');
  });

  it('opens the withdraw tab for a full quantity, a blocked or closed specimen, and no sample', () => {
    expect(resolveInitialTab({ specimenStatus: 'available', quantityStatus: 'full' })).toBe('withdraw');
    expect(resolveInitialTab({ specimenStatus: 'quarantined', quantityStatus: 'partial' })).toBe('withdraw');
    expect(resolveInitialTab({ specimenStatus: 'closed', quantityStatus: 'depleted' })).toBe('withdraw');
    expect(resolveInitialTab(null)).toBe('withdraw');
  });
});

describe('getSpecimenStatusColor / translateSpecimenStatus', () => {
  it('maps every v2 specimenStatus value to a color and a Portuguese label', () => {
    const values = ['available', 'reserved', 'checked_out', 'quarantined', 'unavailable', 'closed'];
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

// RF018 AC11 (#1320): the scope notice follows the quality row only when it
// shows an RCS grade.
describe('isRcsGradeShown', () => {
  it('is true when the sample carries an RCS final grade', () => {
    expect(isRcsGradeShown({ final_grade: 'B' } as Sample)).toBe(true);
    expect(isRcsGradeShown({ rcs_evaluation: { final_grade: 'A' } } as Sample)).toBe(true);
  });

  it('is false when no RCS grade is shown', () => {
    expect(isRcsGradeShown(null)).toBe(false);
    expect(isRcsGradeShown({} as Sample)).toBe(false);
    expect(isRcsGradeShown({ final_grade: '  ' } as Sample)).toBe(false);
    expect(isRcsGradeShown({ quality: '1' } as Sample)).toBe(false);
  });
});
