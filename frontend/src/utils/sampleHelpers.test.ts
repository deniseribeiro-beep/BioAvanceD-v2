import { describe, expect, it } from 'vitest';
import {
  getQuantityStatusColor,
  getSpecimenStatusColor,
  isSpecimenBlocked,
  readSampleQuantities,
  resolveQuantityStatus,
  resolveSpecimenStatus,
  translateQuantityStatus,
  translateSpecimenStatus,
} from './sampleHelpers';

// #539: shared specimenStatus derivation extracted from
// SampleWithdrawalReturnPage.tsx's #538 Phase A fix so every reader derives
// display state from the canonical `specimenStatus` (V2E-0544)
// instead of the legacy `currentStatus`/`status` fields
// canonical-data-contract-v1.md bans. RF006 AC2/AC3 split the quantity out
// into quantityStatus.
describe('resolveSpecimenStatus', () => {
  it('defaults to available when specimenStatus is absent, matching the backend default', () => {
    expect(resolveSpecimenStatus(null)).toBe('available');
    expect(resolveSpecimenStatus(undefined)).toBe('available');
    expect(resolveSpecimenStatus({})).toBe('available');
  });

  it('case-folds whatever value is present', () => {
    expect(resolveSpecimenStatus({ specimenStatus: 'CLOSED' })).toBe('closed');
    expect(resolveSpecimenStatus({ specimenStatus: 'Quarantined' })).toBe('quarantined');
  });

  it('folds the v1.3.0 values the way the backend reads them', () => {
    expect(resolveSpecimenStatus({ specimenStatus: 'DEPLETED' })).toBe('available');
    expect(resolveSpecimenStatus({ specimenStatus: 'Partial' })).toBe('available');
    expect(resolveSpecimenStatus({ specimenStatus: 'destroyed' })).toBe('unavailable');
    expect(resolveSpecimenStatus({ specimenStatus: 'disposed' })).toBe('unavailable');
  });
});

describe('resolveQuantityStatus', () => {
  it('returns the quantityStatus the API sent, case-folded', () => {
    expect(resolveQuantityStatus({ quantityStatus: 'partial', initialQuantity: 100, currentQuantity: 100 })).toBe('partial');
    expect(resolveQuantityStatus({ quantityStatus: 'DEPLETED' })).toBe('depleted');
  });

  it('derives it from the quantities when the record carries none', () => {
    expect(resolveQuantityStatus({ initialQuantity: 100, currentQuantity: 100 })).toBe('full');
    expect(resolveQuantityStatus({ initialQuantity: 100, currentQuantity: 30 })).toBe('partial');
    expect(resolveQuantityStatus({ initialQuantity: 100, currentQuantity: 0 })).toBe('depleted');
    expect(resolveQuantityStatus({ quantity: 50 })).toBe('full');
  });

  it('reads a record with no quantity at all as unknown (#1436)', () => {
    expect(resolveQuantityStatus(null)).toBe('unknown');
    expect(resolveQuantityStatus({})).toBe('unknown');
    expect(resolveQuantityStatus({ initialQuantity: null, currentQuantity: null })).toBe('unknown');
  });
});

describe('readSampleQuantities', () => {
  it('keeps null when nothing was recorded (#1436)', () => {
    expect(readSampleQuantities(null)).toEqual({ initial: null, current: null });
    expect(readSampleQuantities({})).toEqual({ initial: null, current: null });
  });

  it('prefers *Quantity over volume* aliases, then quantity', () => {
    expect(readSampleQuantities({
      initialQuantity: 10,
      currentQuantity: 4,
      volumeInitial: 10,
      volumeCurrent: 10,
    })).toEqual({ initial: 10, current: 4 });
    expect(readSampleQuantities({ volumeInitial: 10, volumeCurrent: 7 })).toEqual({ initial: 10, current: 7 });
    expect(readSampleQuantities({ quantity: 15 })).toEqual({ initial: 15, current: 15 });
  });
});

describe('isSpecimenBlocked', () => {
  it('is true for unavailable, quarantined and closed only', () => {
    expect(isSpecimenBlocked({ specimenStatus: 'unavailable' })).toBe(true);
    expect(isSpecimenBlocked({ specimenStatus: 'quarantined' })).toBe(true);
    expect(isSpecimenBlocked({ specimenStatus: 'closed' })).toBe(true);
    expect(isSpecimenBlocked({ specimenStatus: 'available', quantityStatus: 'depleted' })).toBe(false);
    expect(isSpecimenBlocked({ specimenStatus: 'reserved' })).toBe(false);
  });
});

describe('translateSpecimenStatus', () => {
  it('translates every v2 specimenStatus to a Portuguese label', () => {
    expect(translateSpecimenStatus('available')).toBe('Disponível');
    expect(translateSpecimenStatus('reserved')).toBe('Reservada');
    expect(translateSpecimenStatus('checked_out')).toBe('Retirada (Check-out)');
    expect(translateSpecimenStatus('quarantined')).toBe('Em Quarentena');
    expect(translateSpecimenStatus('unavailable')).toBe('Indisponível');
    expect(translateSpecimenStatus('closed')).toBe('Encerrada');
  });

  it('falls back to the raw value for an unrecognized status', () => {
    expect(translateSpecimenStatus('something-new')).toBe('something-new');
    expect(translateSpecimenStatus(undefined)).toBe('-');
  });
});

describe('translateQuantityStatus', () => {
  it('translates every quantityStatus to a Portuguese label', () => {
    expect(translateQuantityStatus('full')).toBe('Íntegra');
    expect(translateQuantityStatus('partial')).toBe('Parcialmente Retirada');
    expect(translateQuantityStatus('depleted')).toBe('Totalmente Retirada');
    expect(translateQuantityStatus('unknown')).toBe('Não registrada');
    expect(translateQuantityStatus(undefined)).toBe('-');
  });
});

describe('getSpecimenStatusColor / getQuantityStatusColor', () => {
  it('returns danger for blocked and depleted, and text for an unrecognized value', () => {
    expect(getSpecimenStatusColor('closed')).toBe('var(--danger)');
    expect(getSpecimenStatusColor('available')).toBe('var(--success)');
    expect(getSpecimenStatusColor('something-new')).toBe('var(--text)');
    expect(getQuantityStatusColor('depleted')).toBe('var(--danger)');
    expect(getQuantityStatusColor('partial')).toBe('var(--warning)');
    expect(getQuantityStatusColor('something-new')).toBe('var(--text)');
  });
});
