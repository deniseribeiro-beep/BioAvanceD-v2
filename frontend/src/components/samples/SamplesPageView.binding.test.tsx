import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import SamplesPageView from './SamplesPageView';
import type { SampleWithId } from '../../hooks/samples/useSamplesPage';

const t = (key: string, fallback?: string) => fallback || key;
const noop = () => {};
const asyncNoop = async () => {};

function renderList(samples: SampleWithId[], overrides: Partial<ComponentProps<typeof SamplesPageView>> = {}) {
  return render(
    <SamplesPageView
      t={t}
      language="pt-BR"
      loading={false}
      error={null}
      search=""
      selectedSampleIds={[]}
      filteredSamples={samples}
      pagedSamples={samples}
      selectedSamples={[]}
      allSelected={false}
      canEdit={false}
      printModalOpen={false}
      currentPage={1}
      totalPages={1}
      pageSize={10}
      onSearchChange={noop}
      onSearchSubmit={noop}
      onToggleSelectAll={noop}
      onToggleSelect={noop}
      onBatchDelete={asyncNoop}
      onOpenPrintModal={noop}
      onClosePrintModal={noop}
      onPrint={noop}
      onEditSample={noop}
      onOpenStorage={noop}
      expandedStorageSample={null}
      onCloseExpandedStorage={noop}
      onStorageCompleted={noop}
      onResendConsent={noop}
      onAttachExternalDocument={noop}
      onViewPending={noop}
      onPageChange={noop}
      {...overrides}
    />
  );
}

describe('SamplesPageView ID column binding', () => {
  it('shows specimenId as the primary identifier and barcode as secondary text', () => {
    const sample = {
      id: 'oid-1',
      specimenId: '7654321',
      barcode: 'BR-2026-001',
      sampleType: 'PLASMA',
      sampleOrigin: 'VENOUS_BLOOD',
    } as SampleWithId;

    renderList([sample]);

    const row = screen.getByTestId('sample-row-oid-1');
    expect(row).toHaveTextContent('7654321');
    expect(row).toHaveTextContent('BR-2026-001');
    expect(row).toHaveTextContent('PLASMA');
  });

  it('does not repeat specimenId when barcode is absent or identical', () => {
    renderList([
      {
        id: 'oid-2',
        specimenId: '1111111',
        sampleType: 'SERUM',
      } as SampleWithId,
    ]);

    const row = screen.getByTestId('sample-row-oid-2');
    expect(row).toHaveTextContent('1111111');
    expect(row.querySelectorAll('td')[3]?.textContent).toBe('1111111');
  });
});
