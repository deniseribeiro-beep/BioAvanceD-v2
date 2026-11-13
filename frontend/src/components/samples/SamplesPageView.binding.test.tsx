import type { ComponentProps } from 'react';
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
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

// #1443: the list's states (loading, error, empty with and without a search),
// the scan toggle, the volume column, the print labels' fallbacks, and the
// consent badges a signed or externally documented sample carries.
describe('SamplesPageView list states', () => {
  it('shows the loading row instead of samples', () => {
    renderList([{ id: 'x' } as SampleWithId], { loading: true });
    expect(screen.getByTestId('samples-table')).toHaveTextContent('common.loading');
    expect(screen.queryByTestId('sample-row-x')).toBeNull();
  });

  it('shows the error row instead of samples', () => {
    renderList([{ id: 'x' } as SampleWithId], { error: 'API fora do ar' });
    expect(screen.getByTestId('samples-table')).toHaveTextContent('API fora do ar');
    expect(screen.queryByTestId('sample-row-x')).toBeNull();
  });

  it('tells an empty inventory from an empty search', () => {
    const { unmount } = renderList([]);
    expect(screen.getByText('Nenhuma amostra carregada')).toBeInTheDocument();
    expect(screen.getByText('Lista completa de amostras carregadas no inventário.')).toBeInTheDocument();
    expect(screen.getByTestId('samples-page-summary')).toHaveTextContent('Nenhuma amostra exibida');
    unmount();
    renderList([], { search: '  BR-9  ' });
    expect(screen.getByText('Nenhuma amostra encontrada')).toBeInTheDocument();
    expect(screen.getByText('Tente outro código de barras, ID ou nome de paciente.')).toBeInTheDocument();
    expect(screen.getByText('Resultado da pesquisa para "BR-9".')).toBeInTheDocument();
  });

  it('summarises a single displayed sample as the range 1–1 of 1', () => {
    renderList([{ id: 'x' } as SampleWithId]);
    expect(screen.getByTestId('samples-page-summary')).toHaveTextContent('Mostrando 1–1 de 1');
  });

  it('shows the batch toolbar only when samples are selected', () => {
    const { unmount } = renderList([{ id: 'x' } as SampleWithId]);
    expect(screen.queryByTestId('samples-batch-delete')).toBeNull();
    unmount();
    renderList([{ id: 'x' } as SampleWithId], { selectedSampleIds: ['x', 'y'] });
    expect(screen.getByTestId('samples-batch-delete')).toBeInTheDocument();
    expect(screen.getByText(/2 samples.selectedItems/)).toBeInTheDocument();
  });

  it('toggles scan mode on and off', () => {
    renderList([]);
    const scan = screen.getByTestId('samples-scan-button');
    expect(scan).toHaveTextContent('Barcode/QR');
    expect(screen.getByTestId('samples-search-input')).toHaveAttribute('placeholder', 'samples.searchPlaceholder');
    fireEvent.click(scan);
    expect(scan).toHaveTextContent('Leitura ativa');
    expect(scan).toHaveClass('active');
    expect(screen.getByTestId('samples-search-input')).toHaveAttribute('placeholder', 'Escaneie barcode/QR code e pressione pesquisar');
    expect(screen.getByText(/Modo leitura ativo/)).toBeInTheDocument();
    fireEvent.click(scan);
    expect(scan).toHaveTextContent('Barcode/QR');
    expect(scan).not.toHaveClass('active');
  });
});

describe('SamplesPageView row cells', () => {
  const cell = (id: string, index: number) => screen.getByTestId(`sample-row-${id}`).querySelectorAll('td')[index];

  it('formats current / initial volume in the page language, or a dash when none was recorded', () => {
    renderList([
      { id: 'v1', initialQuantity: 2, currentQuantity: 1.5 } as SampleWithId,
      { id: 'v2', volumeInitial: 3, volumeCurrent: 0.25 } as unknown as SampleWithId,
      { id: 'v3', quantity: 4 } as SampleWithId,
      { id: 'v4' } as SampleWithId,
    ]);
    expect(cell('v1', 6)).toHaveTextContent('1,5 / 2,0');
    expect(cell('v2', 6)).toHaveTextContent('0,3 / 3,0');
    expect(cell('v3', 6)).toHaveTextContent('4,0 / 4,0');
    expect(cell('v4', 6)).toHaveTextContent('— / —');
  });

  it('falls back to N/A and to the patient participant id', () => {
    renderList([
      { id: 'n1', barcode: 'BC-1', patient: { participantId: 'P-55' } } as unknown as SampleWithId,
      { id: 'n2' } as SampleWithId,
    ]);
    expect(cell('n1', 1)).toHaveTextContent('N/A');
    expect(cell('n1', 2)).toHaveTextContent('N/A');
    expect(cell('n1', 3)).toHaveTextContent('N/ABC-1');
    expect(cell('n1', 7)).toHaveTextContent('P-55');
    expect(cell('n2', 7)).toHaveTextContent('N/A');
  });

  it('gives a signed sample the signed badge and an externally documented one the attached badge', () => {
    renderList([
      { id: 'c1', consentStatus: 'SIGNED' } as unknown as SampleWithId,
      { id: 'c2', consentStatus: 'EXTERNAL_ATTACHED' } as unknown as SampleWithId,
      { id: 'c3', consentStatus: 'WAIVED_TRANSFER' } as unknown as SampleWithId,
      { id: 'c4' } as SampleWithId,
    ]);
    expect(within(cell('c1', 5)).getByText('TCLE assinado')).toBeInTheDocument();
    expect(within(cell('c2', 5)).getByText('Documento anexado')).toBeInTheDocument();
    expect(within(cell('c3', 5)).getByText('Documento anexado')).toBeInTheDocument();
    expect(within(cell('c4', 5)).getByText('Liberada')).toHaveAttribute('title', 'Sem bloqueios de quarentena');
  });

  it('titles the quarantine actions by consent message and permission', () => {
    renderList([
      { id: 'q1', specimenStatus: 'quarantined', consentMessage: 'Aguardando TCLE' } as SampleWithId,
    ]);
    expect(screen.getByTestId('sample-resend-consent-button-q1')).toHaveAttribute('title', 'Aguardando TCLE');
    expect(screen.getByTestId('sample-attach-external-button-q1')).toHaveAttribute('title', 'samples.editTooltip.noPermission');
    expect(screen.getByTestId('sample-attach-external-button-q1')).toBeDisabled();
  });

  it('disables storage and edit for an unusable sample, and titles edit by the reason', () => {
    renderList(
      [
        { id: 'u1', canUse: false } as SampleWithId,
        { id: 'u2' } as SampleWithId,
      ],
      { canEdit: true },
    );
    expect(screen.getByTestId('sample-storage-button-u1')).toBeDisabled();
    expect(screen.getByTestId('sample-storage-button-u1')).toHaveAttribute('title', 'samples.editTooltip.consentPending');
    expect(screen.getByTestId('sample-edit-button-u1')).toBeDisabled();
    expect(screen.getByTestId('sample-edit-button-u1')).toHaveAttribute('title', 'samples.editTooltip.consentPending');
    expect(screen.getByTestId('sample-attach-external-button-u1')).toHaveAttribute('title', 'Anexar documentação externa e liberar amostra');
    expect(screen.getByTestId('sample-storage-button-u2')).not.toBeDisabled();
    expect(screen.getByTestId('sample-edit-button-u2')).not.toBeDisabled();
    expect(screen.getByTestId('sample-edit-button-u2')).toHaveAttribute('title', 'samples.editTooltip.edit');
  });
});

describe('SamplesPageView print labels', () => {
  it('labels each selected sample by barcode then specimen id then id', () => {
    renderList([], {
      printModalOpen: true,
      selectedSamples: [
        { id: 'p1', barcode: 'BC-1', sampleType: 'PLASMA', participantId: 'P-1' } as SampleWithId,
        { id: 'p2', specimenId: 'SP-2' } as SampleWithId,
        { id: 'p3' } as SampleWithId,
      ],
    });
    const labels = document.querySelectorAll('.qr-label');
    expect(labels).toHaveLength(3);
    expect(labels[0].querySelector('.qr-label__code')).toHaveTextContent('BC-1');
    expect(labels[0].querySelector('.qr-label__title')).toHaveTextContent('PLASMA');
    expect(labels[0].querySelector('.qr-label__patient')).toHaveTextContent('P-1');
    expect(labels[1].querySelector('.qr-label__code')).toHaveTextContent('SP-2');
    expect(labels[1].querySelector('.qr-label__title')).toHaveTextContent('samples.sampleFallback');
    expect(labels[2].querySelector('.qr-label__code')).toHaveTextContent('p3');
    expect(labels[2].querySelector('.qr-label__patient')).toHaveTextContent('N/A');
  });
});
