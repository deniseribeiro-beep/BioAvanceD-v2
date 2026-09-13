import { describe, expect, it } from 'vitest';
import { getSpecimenStatusColor, resolveSpecimenStatus, translateSpecimenStatus } from './sampleHelpers';

// #539: shared specimenStatus derivation extracted from
// SampleWithdrawalReturnPage.tsx's #538 Phase A fix so every reader derives
// display state from the canonical `specimenStatus` (dict-02 ELM-0123)
// instead of the legacy `currentStatus`/`status` fields
// canonical-data-contract-v1.md bans.
describe('resolveSpecimenStatus', () => {
  it('defaults to available when specimenStatus is absent, matching the backend default', () => {
    expect(resolveSpecimenStatus(null)).toBe('available');
    expect(resolveSpecimenStatus(undefined)).toBe('available');
    expect(resolveSpecimenStatus({})).toBe('available');
  });

  it('case-folds whatever value is present', () => {
    expect(resolveSpecimenStatus({ specimenStatus: 'DEPLETED' })).toBe('depleted');
    expect(resolveSpecimenStatus({ specimenStatus: 'Partial' })).toBe('partial');
  });
});

describe('translateSpecimenStatus', () => {
  it('translates every dict-02 ELM-0123 state to a Portuguese label', () => {
    expect(translateSpecimenStatus('available')).toBe('Disponível');
    expect(translateSpecimenStatus('reserved')).toBe('Reservada');
    expect(translateSpecimenStatus('checked_out')).toBe('Retirada (Check-out)');
    expect(translateSpecimenStatus('partial')).toBe('Parcialmente Retirada');
    expect(translateSpecimenStatus('depleted')).toBe('Totalmente Retirada');
    expect(translateSpecimenStatus('quarantined')).toBe('Em Quarentena');
    expect(translateSpecimenStatus('destroyed')).toBe('Destruída');
    expect(translateSpecimenStatus('unavailable')).toBe('Indisponível');
    expect(translateSpecimenStatus('disposed')).toBe('Descartada');
  });

  it('falls back to the raw value for an unrecognized status', () => {
    expect(translateSpecimenStatus('something-new')).toBe('something-new');
    expect(translateSpecimenStatus(undefined)).toBe('-');
  });
});

describe('getSpecimenStatusColor', () => {
  it('returns danger for blocked states and text for an unrecognized value', () => {
    expect(getSpecimenStatusColor('depleted')).toBe('var(--danger)');
    expect(getSpecimenStatusColor('available')).toBe('var(--success)');
    expect(getSpecimenStatusColor('something-new')).toBe('var(--text)');
  });
});
