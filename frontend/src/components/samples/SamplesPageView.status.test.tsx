import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import SampleStatusBadge from '../SampleStatusBadge';
import { isQuarantined, mapStatus, renderSampleBadges } from './SamplesPageView';

const t = (_key: string, fallback?: string) => fallback || _key;
const row = (fields: Record<string, unknown>) => ({ id: 'row-1', ...fields }) as any;

// RF006 AC2/AC3: the list badge reads the operational state from
// specimenStatus and PARTIAL/DEPLETED from quantityStatus; a closed
// specimen (RF026 AC7) shows its own label and offers no release actions.
describe('mapStatus', () => {
  it('reads PARTIAL and DEPLETED from quantityStatus while specimenStatus stays available', () => {
    expect(mapStatus(row({ specimenStatus: 'available', quantityStatus: 'partial' }))).toBe('PARTIAL');
    expect(mapStatus(row({ specimenStatus: 'available', quantityStatus: 'depleted' }))).toBe('DEPLETED');
    expect(mapStatus(row({ specimenStatus: 'available', quantityStatus: 'full' }))).toBe('AVAILABLE');
  });

  it('derives the quantity when quantityStatus is absent', () => {
    expect(mapStatus(row({ specimenStatus: 'available', initialQuantity: 100, currentQuantity: 0 }))).toBe('DEPLETED');
  });

  it('shows closed as CLOSED and quarantined/unavailable or pending consent as QUARANTINED', () => {
    expect(mapStatus(row({ specimenStatus: 'closed', quantityStatus: 'depleted' }))).toBe('CLOSED');
    expect(mapStatus(row({ specimenStatus: 'quarantined', quantityStatus: 'full' }))).toBe('QUARANTINED');
    expect(mapStatus(row({ specimenStatus: 'unavailable', quantityStatus: 'partial' }))).toBe('QUARANTINED');
    expect(mapStatus(row({ specimenStatus: 'available', consentStatus: 'PENDING' }))).toBe('QUARANTINED');
  });

  it('no longer reads the retired status/currentStatus fields', () => {
    expect(mapStatus(row({ specimenStatus: 'available', quantityStatus: 'full', status: 'DEPLETED' }))).toBe('AVAILABLE');
  });
});

describe('SampleStatusBadge', () => {
  it('labels CLOSED as Encerrada', () => {
    render(<SampleStatusBadge status="CLOSED" />);
    expect(screen.getByText('Encerrada')).toBeInTheDocument();
  });
});

describe('renderSampleBadges / isQuarantined', () => {
  it('gives a closed specimen an Encerrada badge, not quarantine or released, and no release actions', () => {
    const closed = row({ specimenStatus: 'closed', quantityStatus: 'depleted' });
    render(<div>{renderSampleBadges(closed, t)}</div>);
    expect(screen.getByText('Encerrada')).toBeInTheDocument();
    expect(screen.queryByText('Quarentena')).toBeNull();
    expect(screen.queryByText('Liberada')).toBeNull();
    expect(isQuarantined(closed)).toBe(false);
  });

  it('keeps the quarantine badge and actions for quarantined and unavailable specimens', () => {
    const quarantined = row({ specimenStatus: 'quarantined' });
    render(<div>{renderSampleBadges(quarantined, t)}</div>);
    expect(screen.getByText('Quarentena')).toBeInTheDocument();
    expect(isQuarantined(quarantined)).toBe(true);
    expect(isQuarantined(row({ specimenStatus: 'unavailable' }))).toBe(true);
  });

  it('releases an available specimen whatever its quantity', () => {
    const depleted = row({ specimenStatus: 'available', quantityStatus: 'depleted' });
    render(<div>{renderSampleBadges(depleted, t)}</div>);
    expect(screen.getByText('Liberada')).toBeInTheDocument();
    expect(isQuarantined(depleted)).toBe(false);
  });
});
