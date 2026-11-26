import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { SampleCustodyRow, SampleMovementState } from '@/hooks/samples/useSampleCustodyReports';
import SampleCustodyReportsView from './SampleCustodyReportsView';

const t = (key: string, fallback?: string) => fallback ?? key;

function row(fields: Record<string, unknown>): SampleCustodyRow {
  return fields as unknown as SampleCustodyRow;
}

function movementState(fields: Partial<SampleMovementState>): SampleMovementState {
  return { isOpen: true, isLoading: false, error: null, errorCode: null, items: [], ...fields };
}

function renderView(props: {
  loading?: boolean;
  rows?: SampleCustodyRow[];
  movementBySampleId?: Record<string, SampleMovementState>;
  onToggleMovements?: (sample: SampleCustodyRow) => Promise<void>;
}) {
  const onToggleMovements = props.onToggleMovements ?? vi.fn().mockResolvedValue(undefined);
  render(
    <SampleCustodyReportsView
      t={t}
      loading={props.loading ?? false}
      rows={props.rows ?? []}
      movementBySampleId={props.movementBySampleId ?? {}}
      onToggleMovements={onToggleMovements}
    />,
  );
  return { onToggleMovements };
}

// The data row a sample renders: the <tr> whose first cell is its id.
function dataRow(id: string) {
  return screen.getByRole('cell', { name: id }).closest('tr') as HTMLTableRowElement;
}

const S1 = row({ _id: 'm1', specimenId: 'SP-1', participantId: 'P-1', sampleType: 'Sangue', barcode: 'BR-2026-001' });

describe('SampleCustodyReportsView', () => {
  it('shows the loading text and no table while loading', () => {
    renderView({ loading: true, rows: [S1] });
    expect(screen.getByText('Carregando...')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('shows the empty notice when there are no samples', () => {
    renderView({ rows: [] });
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByText('Nenhuma amostra encontrada')).toBeInTheDocument();
  });

  it('renders a sample row with its ids, type and barcode, and no empty notice', () => {
    renderView({ rows: [S1] });
    const cells = within(dataRow('SP-1')).getAllByRole('cell').map((c) => c.textContent);
    expect(cells).toEqual(['SP-1', 'P-1', 'Sangue', 'BR-2026-001', 'Ver movimentos da amostra']);
    expect(screen.queryByText('Nenhuma amostra encontrada')).not.toBeInTheDocument();
  });

  it('falls back to the code, then a dash, for the barcode, and a dash for a missing type', () => {
    renderView({
      rows: [
        row({ specimenId: 'SP-2', participantId: 'P-2', code: 'C-22' }),
        row({ specimenId: 'SP-3', participantId: 'P-3' }),
      ],
    });
    const two = within(dataRow('SP-2')).getAllByRole('cell').map((c) => c.textContent);
    const three = within(dataRow('SP-3')).getAllByRole('cell').map((c) => c.textContent);
    expect(two.slice(2, 4)).toEqual(['—', 'C-22']);
    expect(three.slice(2, 4)).toEqual(['—', '—']);
  });

  it('calls onToggleMovements with the clicked row sample', () => {
    const S2 = row({ specimenId: 'SP-2', participantId: 'P-2' });
    const { onToggleMovements } = renderView({ rows: [S1, S2] });
    fireEvent.click(within(dataRow('SP-2')).getByRole('button', { name: 'Ver movimentos da amostra' }));
    expect(onToggleMovements).toHaveBeenCalledTimes(1);
    expect(onToggleMovements).toHaveBeenCalledWith(S2);
  });

  it('keeps a closed row collapsed with no movement panel', () => {
    renderView({ rows: [S1], movementBySampleId: { 'SP-1': movementState({ isOpen: false, items: [{ id: 'mv1', timestamp: 'T1', type: 'withdraw', responsible: 'Ana', details: 'd' }] }) } });
    expect(screen.getByRole('button', { name: 'Ver movimentos da amostra' })).toBeInTheDocument();
    expect(screen.queryByText('Ana')).not.toBeInTheDocument();
    expect(screen.getAllByRole('table')).toHaveLength(1);
  });

  it('shows the hide label and a loading line for an open row still loading', () => {
    renderView({ rows: [S1], movementBySampleId: { 'SP-1': movementState({ isLoading: true }) } });
    expect(screen.getByRole('button', { name: 'Ocultar movimentos' })).toBeInTheDocument();
    expect(screen.getByText('Carregando...')).toBeInTheDocument();
    expect(screen.getAllByRole('table')).toHaveLength(1);
  });

  it('shows the error and its audit code for an open row that failed', () => {
    renderView({ rows: [S1], movementBySampleId: { 'SP-1': movementState({ error: 'Acesso bloqueado', errorCode: 'CONSENT_REVOKED' }) } });
    expect(screen.getByText('Acesso bloqueado')).toBeInTheDocument();
    expect(screen.getByText('Código de auditoria: CONSENT_REVOKED')).toBeInTheDocument();
    expect(screen.getAllByRole('table')).toHaveLength(1);
  });

  it('shows the error without an audit line when the failure has no code', () => {
    renderView({ rows: [S1], movementBySampleId: { 'SP-1': movementState({ error: 'Erro ao carregar movimentos' }) } });
    expect(screen.getByText('Erro ao carregar movimentos')).toBeInTheDocument();
    expect(screen.queryByText(/Código de auditoria/)).not.toBeInTheDocument();
  });

  it('shows the no-movements line for an open row with no items', () => {
    renderView({ rows: [S1], movementBySampleId: { 'SP-1': movementState({}) } });
    expect(screen.getAllByRole('table')).toHaveLength(2);
    expect(screen.getByText('Nenhuma movimentação registrada')).toBeInTheDocument();
  });

  it('lists each movement with its date, mapped type, responsible and details', () => {
    renderView({
      rows: [S1],
      movementBySampleId: {
        'SP-1': movementState({
          items: [
            { id: 'mv1', timestamp: '2026-01-01', type: 'withdraw', responsible: 'Ana', details: 'saída' },
            { id: 'mv2', timestamp: '2026-01-02', type: 'audit', responsible: 'Bia', details: 'conferência' },
          ],
        }),
      },
    });
    const inner = screen.getAllByRole('table')[1];
    const bodyRows = within(inner).getAllByRole('row').slice(1);
    expect(bodyRows.map((r) => within(r).getAllByRole('cell').map((c) => c.textContent))).toEqual([
      ['2026-01-01', 'Retirada', 'Ana', 'saída'],
      ['2026-01-02', 'audit', 'Bia', 'conferência'],
    ]);
    expect(screen.queryByText('Nenhuma movimentação registrada')).not.toBeInTheDocument();
  });
});
