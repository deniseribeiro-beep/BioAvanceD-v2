import { describe, expect, it } from 'vitest';
import { resolveLegacySampleStatus, resolveSampleLifecycleStatus } from './contracts';

// #539: bucketing a specimen down to the legacy `Sample.currentStatus`
// vocabulary, used by readers that still need that shape. RF006 AC2/AC3:
// the operational state reads specimenStatus, and PARTIAL/DEPLETED read
// quantityStatus (or the quantities when a record carries none).
describe('resolveSampleLifecycleStatus', () => {
  it('buckets available/reserved/checked_out with a full quantity into AVAILABLE', () => {
    expect(resolveSampleLifecycleStatus({ specimenStatus: 'available', quantityStatus: 'full' })).toBe('AVAILABLE');
    expect(resolveSampleLifecycleStatus({ specimenStatus: 'reserved', quantityStatus: 'full' })).toBe('AVAILABLE');
    expect(resolveSampleLifecycleStatus({ specimenStatus: 'checked_out', quantityStatus: 'full' })).toBe('AVAILABLE');
  });

  it('reads PARTIAL and DEPLETED from quantityStatus, not specimenStatus', () => {
    expect(resolveSampleLifecycleStatus({ specimenStatus: 'available', quantityStatus: 'partial' })).toBe('PARTIAL');
    expect(resolveSampleLifecycleStatus({ specimenStatus: 'available', quantityStatus: 'depleted' })).toBe('DEPLETED');
    expect(resolveSampleLifecycleStatus({ specimenStatus: 'available', quantityStatus: 'DEPLETED' })).toBe('DEPLETED');
  });

  it('derives the quantity from initialQuantity/currentQuantity when quantityStatus is absent', () => {
    expect(resolveSampleLifecycleStatus({ specimenStatus: 'available', initialQuantity: 100, currentQuantity: 40 })).toBe('PARTIAL');
    expect(resolveSampleLifecycleStatus({ specimenStatus: 'available', initialQuantity: 100, currentQuantity: 0 })).toBe('DEPLETED');
    expect(resolveSampleLifecycleStatus({ specimenStatus: 'available', initialQuantity: 100, currentQuantity: 100 })).toBe('AVAILABLE');
  });

  it('reads a v1.3.0 partial/depleted specimenStatus as available, its quantity coming from quantityStatus', () => {
    expect(resolveSampleLifecycleStatus({ specimenStatus: 'depleted', quantityStatus: 'full' })).toBe('AVAILABLE');
    expect(resolveSampleLifecycleStatus({ specimenStatus: 'partial', quantityStatus: 'full' })).toBe('AVAILABLE');
  });

  it('buckets quarantined/unavailable (and v1.3.0 destroyed/disposed) into UNAVAILABLE, whatever the quantity', () => {
    expect(resolveSampleLifecycleStatus({ specimenStatus: 'quarantined', quantityStatus: 'depleted' })).toBe('UNAVAILABLE');
    expect(resolveSampleLifecycleStatus({ specimenStatus: 'unavailable', quantityStatus: 'partial' })).toBe('UNAVAILABLE');
    expect(resolveSampleLifecycleStatus({ specimenStatus: 'destroyed' })).toBe('UNAVAILABLE');
    expect(resolveSampleLifecycleStatus({ specimenStatus: 'disposed' })).toBe('UNAVAILABLE');
  });

  it('buckets closed into CLOSED, whatever the quantity', () => {
    expect(resolveSampleLifecycleStatus({ specimenStatus: 'closed', quantityStatus: 'depleted' })).toBe('CLOSED');
    expect(resolveSampleLifecycleStatus({ specimenStatus: 'CLOSED' })).toBe('CLOSED');
  });

  it('defaults missing quantities to UNKNOWN instead of AVAILABLE (#1436)', () => {
    expect(resolveSampleLifecycleStatus(null)).toBe('UNKNOWN');
    expect(resolveSampleLifecycleStatus(undefined)).toBe('UNKNOWN');
    expect(resolveSampleLifecycleStatus({})).toBe('UNKNOWN');
    expect(resolveSampleLifecycleStatus({ specimenStatus: 'available' })).toBe('UNKNOWN');
    expect(resolveSampleLifecycleStatus({ specimenStatus: 'available', quantityStatus: 'unknown' })).toBe('UNKNOWN');
  });
});

describe('resolveLegacySampleStatus', () => {
  it('maps every bucket onto the legacy currentStatus vocabulary', () => {
    expect(resolveLegacySampleStatus({ specimenStatus: 'available', quantityStatus: 'full' })).toBe('Available');
    expect(resolveLegacySampleStatus({ specimenStatus: 'available', quantityStatus: 'partial' })).toBe('PartiallyWithdrawn');
    expect(resolveLegacySampleStatus({ specimenStatus: 'available', quantityStatus: 'depleted' })).toBe('TotallyWithdrawn');
    expect(resolveLegacySampleStatus({ specimenStatus: 'quarantined' })).toBe('Unusable');
    expect(resolveLegacySampleStatus({ specimenStatus: 'closed', quantityStatus: 'depleted' })).toBe('Closed');
    expect(resolveLegacySampleStatus({ specimenStatus: 'available', quantityStatus: 'unknown' })).toBe('Unknown');
  });

  it('defaults missing quantities to Unknown (#1436)', () => {
    expect(resolveLegacySampleStatus(undefined)).toBe('Unknown');
  });
});
