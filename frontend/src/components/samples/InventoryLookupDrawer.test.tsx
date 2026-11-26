import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import InventoryLookupDrawer from './InventoryLookupDrawer';
import type { SampleWithId } from '../../hooks/samples/useSamplesPage';

const t = (key: string, fallback?: string) => fallback || key;

const sample: SampleWithId = {
  id: 's-1',
  specimenId: 'SP-1',
  barcode: 'BC-1',
  sampleType: 'PLASMA',
} as SampleWithId;

describe('InventoryLookupDrawer', () => {
  it('renders nothing when closed', () => {
    const { container } = render(
      <InventoryLookupDrawer
        open={false}
        t={t}
        loading={false}
        searchInput=""
        searchApplied=""
        filteredSamples={[]}
        onClose={vi.fn()}
        onSearchChange={vi.fn()}
        onSearchSubmit={vi.fn()}
        onOpenDetail={vi.fn()}
        onOpenStorage={vi.fn()}
        onOpenLabel={vi.fn()}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('reuses search state and deep-links to detail, storage and label', () => {
    const onOpenDetail = vi.fn();
    const onOpenStorage = vi.fn();
    const onOpenLabel = vi.fn();
    const onSearchSubmit = vi.fn();

    render(
      <InventoryLookupDrawer
        open
        t={t}
        loading={false}
        searchInput="BC-1"
        searchApplied="BC-1"
        filteredSamples={[sample]}
        onClose={vi.fn()}
        onSearchChange={vi.fn()}
        onSearchSubmit={onSearchSubmit}
        onOpenDetail={onOpenDetail}
        onOpenStorage={onOpenStorage}
        onOpenLabel={onOpenLabel}
      />,
    );

    expect(screen.getByTestId('inventory-lookup-search-input')).toHaveValue('BC-1');
    fireEvent.click(screen.getByTestId('inventory-lookup-search-button'));
    expect(onSearchSubmit).toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('lookup-detail-s-1'));
    fireEvent.click(screen.getByTestId('lookup-storage-s-1'));
    fireEvent.click(screen.getByTestId('lookup-label-s-1'));
    expect(onOpenDetail).toHaveBeenCalledWith('s-1');
    expect(onOpenStorage).toHaveBeenCalledWith(sample);
    expect(onOpenLabel).toHaveBeenCalledWith('s-1');
  });
});