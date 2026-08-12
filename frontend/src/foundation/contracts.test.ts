import { describe, expect, it } from 'vitest';
import { resolveLegacySampleStatus, resolveSampleLifecycleStatus } from './contracts';

// #539: bucketing from the canonical specimenStatus enum (dict-02
// ELM-0123, 9 states) down to the legacy `Sample.currentStatus` vocabulary,
// used by readers that still need that shape (e.g. an editable form field).
describe('resolveSampleLifecycleStatus', () => {
  it('buckets available/reserved/checked_out into AVAILABLE', () => {
    expect(resolveSampleLifecycleStatus('available')).toBe('AVAILABLE');
    expect(resolveSampleLifecycleStatus('reserved')).toBe('AVAILABLE');
    expect(resolveSampleLifecycleStatus('checked_out')).toBe('AVAILABLE');
  });

  it('buckets partial and depleted onto their own states', () => {
    expect(resolveSampleLifecycleStatus('partial')).toBe('PARTIAL');
    expect(resolveSampleLifecycleStatus('depleted')).toBe('DEPLETED');
  });

  it('buckets quarantined/destroyed/unavailable/disposed into UNAVAILABLE', () => {
    expect(resolveSampleLifecycleStatus('quarantined')).toBe('UNAVAILABLE');
    expect(resolveSampleLifecycleStatus('destroyed')).toBe('UNAVAILABLE');
    expect(resolveSampleLifecycleStatus('unavailable')).toBe('UNAVAILABLE');
    expect(resolveSampleLifecycleStatus('disposed')).toBe('UNAVAILABLE');
  });

  it('defaults to AVAILABLE when specimenStatus is absent, matching the backend default', () => {
    expect(resolveSampleLifecycleStatus(null)).toBe('AVAILABLE');
    expect(resolveSampleLifecycleStatus(undefined)).toBe('AVAILABLE');
  });

  it('case-folds whatever value is present', () => {
    expect(resolveSampleLifecycleStatus('DEPLETED')).toBe('DEPLETED');
  });
});

describe('resolveLegacySampleStatus', () => {
  it('maps every bucket onto the legacy currentStatus vocabulary', () => {
    expect(resolveLegacySampleStatus('available')).toBe('Available');
    expect(resolveLegacySampleStatus('partial')).toBe('PartiallyWithdrawn');
    expect(resolveLegacySampleStatus('depleted')).toBe('TotallyWithdrawn');
    expect(resolveLegacySampleStatus('quarantined')).toBe('Unusable');
  });

  it('defaults to Available when specimenStatus is absent', () => {
    expect(resolveLegacySampleStatus(undefined)).toBe('Available');
  });
});
