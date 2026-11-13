import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SamplesPageView from './SamplesPageView';
import type { SampleWithId } from '../../hooks/samples/useSamplesPage';

const t = (key: string, fallback?: string) => fallback || key;
const noop = () => {};
const asyncNoop = async () => {};

function makeSamples(count: number): SampleWithId[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `oid-${index + 1}`,
    specimenId: `SPC-${String(index + 1).padStart(3, '0')}`,
    sampleType: 'PLASMA',
    sampleOrigin: 'VENOUS_BLOOD',
  })) as SampleWithId[];
}

function renderPaged(opts: {
  filtered: SampleWithId[];
  paged: SampleWithId[];
  currentPage: number;
  totalPages: number;
  onPageChange?: (page: number) => void;
}) {
  return render(
    <SamplesPageView
      t={t}
      language="pt-BR"
      loading={false}
      error={null}
      search=""
      selectedSampleIds={[]}
      filteredSamples={opts.filtered}
      pagedSamples={opts.paged}
      selectedSamples={[]}
      allSelected={false}
      canEdit={false}
      printModalOpen={false}
      currentPage={opts.currentPage}
      totalPages={opts.totalPages}
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
      onPageChange={opts.onPageChange || noop}
    />
  );
}

describe('SamplesPageView pagination', () => {
  it('shows at most 10 table rows and the page range for 11 samples', () => {
    const filtered = makeSamples(11);
    renderPaged({
      filtered,
      paged: filtered.slice(0, 10),
      currentPage: 1,
      totalPages: 2,
    });

    expect(screen.getAllByTestId(/sample-row-/)).toHaveLength(10);
    expect(screen.getByTestId('samples-page-summary')).toHaveTextContent('Mostrando 1–10 de 11');
    expect(screen.getByTestId('samples-pagination-page')).toHaveTextContent('Página 1 de 2');
    expect(screen.getByTestId('samples-pagination-prev')).toBeDisabled();
    expect(screen.getByTestId('samples-pagination-next')).toBeEnabled();
  });

  it('advances to the next page when Próxima is pressed', async () => {
    const user = userEvent.setup();
    const onPageChange = vi.fn();
    const filtered = makeSamples(11);

    renderPaged({
      filtered,
      paged: filtered.slice(0, 10),
      currentPage: 1,
      totalPages: 2,
      onPageChange,
    });

    await user.click(screen.getByTestId('samples-pagination-next'));
    expect(onPageChange).toHaveBeenCalledWith(2);
  });
});
