import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import SampleWithdrawalReturnPage, { getPendingReturnQuantity, getStorageLabel } from './SampleWithdrawalReturnPage';

// #1443: the edges SampleWithdrawalReturnPage.behaviour.test.tsx leaves open
// -- legacy samples with no unit or current quantity, a sample without an id,
// a save the server does not confirm, the error fallbacks, sparse movements
// and an RCS grade without route or score.
const mocks = vi.hoisted(() => ({
  getByBarcode: vi.fn(),
  getMovements: vi.fn(),
  withdraw: vi.fn(),
  returnSample: vi.fn(),
  getSampleLocation: vi.fn(),
}));

vi.mock('../services/api', () => ({
  sampleService: {
    getByBarcode: (...args: unknown[]) => mocks.getByBarcode(...args),
    getMovements: (...args: unknown[]) => mocks.getMovements(...args),
    withdraw: (...args: unknown[]) => mocks.withdraw(...args),
    return: (...args: unknown[]) => mocks.returnSample(...args),
  },
}));

vi.mock('../services/storageApi', () => ({
  storageApi: {
    getSampleLocation: (...args: unknown[]) => mocks.getSampleLocation(...args),
  },
}));

// An empty translation renders the page's Portuguese fallback text.
vi.mock('../contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: () => '', language: 'pt-BR' }),
}));

// A legacy sample: no unit, no initial or current quantity, no ledger totals.
const LEGACY = { _id: 'S-9', barcode: 'BR-OLD', specimenStatus: 'available', quantityStatus: 'full', quantity: 5, quality: 'Q9' };
const LEGACY_PARTIAL = { _id: 'S-7', barcode: 'BR-P', specimenStatus: 'available', quantityStatus: 'partial', quantity: 3, totalWithdrawn: 2 };
const PARTIAL = {
  _id: 'S-1', barcode: 'BR-2026-001', unit: 'mL', initialQuantity: 10, currentQuantity: 6,
  totalWithdrawn: 4, totalReturned: 0, specimenStatus: 'available', quantityStatus: 'partial',
};

function found(sample: Record<string, unknown>) {
  return { data: { success: true, data: { sample, participant: null } } };
}

async function search(barcode = 'BR-2026-001') {
  fireEvent.change(screen.getByLabelText('Código de Barras'), { target: { value: barcode } });
  fireEvent.click(screen.getByRole('button', { name: 'Buscar' }));
  await screen.findByText('Dados da Amostra');
}

function setField(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

function infoValue(label: string) {
  return screen.getByText(label).closest('.info-row')!.querySelector('.info-value')!.textContent;
}

function modalLine(label: string) {
  return screen.getByText(label, { selector: 'strong' }).parentElement!.textContent;
}

function fillTotalWithdrawal() {
  setField('Tipo de Retirada *', 'Total');
  setField('Responsável pela Retirada *', 'Ana Souza');
  setField('Destino da Amostra *', 'Lab A');
  setField('Projeto Vinculado *', 'Projeto Novo');
}

beforeEach(() => {
  Object.values(mocks).forEach((mock) => mock.mockReset());
  mocks.getMovements.mockResolvedValue({ data: { success: true, data: [] } });
  mocks.getSampleLocation.mockResolvedValue({ success: false });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('SampleWithdrawalReturnPage helpers', () => {
  it('falls back to the plain quantity, then 0, for a legacy depleted sample with no ledger total', () => {
    expect(getPendingReturnQuantity({ specimenStatus: 'available', quantityStatus: 'depleted', totalWithdrawn: 0, quantity: 7 })).toBe(7);
    expect(getPendingReturnQuantity({ specimenStatus: 'available', quantityStatus: 'depleted', totalWithdrawn: 0 })).toBe(0);
  });

  it('names a path or a box alone when the location has no position', () => {
    const box = { boxId: 'box-1', boxName: null, position: null };
    expect(getStorageLabel({ specimenId: 'S', box, path: 'F1/S1', fullHierarchy: null })).toBe('F1/S1');
    expect(getStorageLabel({ specimenId: 'S', box: { ...box, boxName: 'BOX_01' }, path: '', fullHierarchy: null })).toBe('BOX_01');
  });
});

describe('SampleWithdrawalReturnPage legacy samples', () => {
  it('reads an unwrapped lookup answer and shows a legacy sample in µL from its plain quantity', async () => {
    mocks.getByBarcode.mockResolvedValue({ data: { sample: LEGACY } });
    render(<SampleWithdrawalReturnPage />);
    await search('BR-OLD');
    expect(infoValue('Tipo:')).toBe('-');
    expect(infoValue('Quantidade Original:')).toBe('5 µL');
    expect(infoValue('Quantidade Disponível:')).toBe('5 µL');
    expect(infoValue('Total Retirado:')).toBe('0 µL');
    expect(infoValue('Pendente Devolução:')).toBe('0 µL');
    expect(infoValue('Qualidade:')).toBe('Q9');

    setField('Tipo de Retirada *', 'Parcial');
    const quantity = screen.getByLabelText('Quantidade a Retirar (µL) *');
    expect(quantity).toHaveAttribute('max', '5');
    expect(screen.getByText('Disponível: 5 µL')).toBeInTheDocument();
    setField('Quantidade a Retirar (µL) *', '9');
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar Retirada' }));
    expect(screen.getByText('Quantidade indisponível. Disponível: 5 µL')).toBeInTheDocument();
  });

  it('withdraws a legacy sample in full, says "-" when the server names no quantity, and clears the typed project', async () => {
    mocks.getByBarcode.mockResolvedValue(found(LEGACY));
    mocks.withdraw.mockResolvedValue({ data: { success: true, data: {} } });
    render(<SampleWithdrawalReturnPage />);
    await search('BR-OLD');
    fillTotalWithdrawal();
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar Retirada' }));
    expect(modalLine('Quantidade:')).toBe('Quantidade: 5 µL');

    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }));
    expect(await screen.findByText('Retirada registrada com sucesso! Quantidade retirada: - µL')).toBeInTheDocument();
    expect(mocks.withdraw).toHaveBeenCalledWith('S-9', expect.objectContaining({ withdrawalType: 'Total', linkedProject: 'Projeto Novo' }));
    await waitFor(() => expect(screen.getByLabelText('Projeto Vinculado *')).toHaveValue(''));
  });

  it('shows dashes for a sample with no barcode or quantity, and refuses any partial amount', async () => {
    mocks.getByBarcode.mockResolvedValue(found({ _id: 'S-8', specimenStatus: 'available', quantityStatus: 'full' }));
    render(<SampleWithdrawalReturnPage />);
    await search('X');
    expect(infoValue('Código de Barras:')).toBe('-');
    expect(infoValue('Quantidade Original:')).toBe('- µL');
    expect(infoValue('Quantidade Disponível:')).toBe('- µL');
    setField('Tipo de Retirada *', 'Parcial');
    setField('Quantidade a Retirar (µL) *', '1');
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar Retirada' }));
    expect(screen.getByText('Quantidade indisponível. Disponível: 0 µL')).toBeInTheDocument();
  });

  it('returns part of a legacy sample in µL and says "-" when the server names no quantity', async () => {
    mocks.getByBarcode.mockResolvedValue(found(LEGACY_PARTIAL));
    mocks.returnSample.mockResolvedValue({ data: { success: true, data: {} } });
    render(<SampleWithdrawalReturnPage />);
    await search('BR-P');
    expect(screen.getByRole('option', { name: 'Total (2 µL)' })).toBeInTheDocument();
    setField('Tipo de Devolução *', 'Parcial');
    expect(screen.getByText('Pendente: 2 µL')).toBeInTheDocument();
    setField('Quantidade a Devolver (µL) *', '5');
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar Devolução' }));
    expect(screen.getByText('Quantidade excede o pendente. Pendente: 2 µL')).toBeInTheDocument();

    setField('Quantidade a Devolver (µL) *', '1');
    setField('Responsável pela Devolução *', 'João Lima');
    setField('Condição da Amostra *', 'Íntegra');
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar Devolução' }));
    expect(modalLine('Quantidade:')).toBe('Quantidade: 1 µL');
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }));
    expect(await screen.findByText('Devolução registrada com sucesso! Quantidade devolvida: - µL')).toBeInTheDocument();
  });
});

describe('SampleWithdrawalReturnPage saves that do not go through', () => {
  it('sends nothing for a sample without an id, from either tab', async () => {
    const { _id: _omitted, ...noId } = PARTIAL;
    mocks.getByBarcode.mockResolvedValue(found(noId));
    render(<SampleWithdrawalReturnPage />);
    await search();
    expect(infoValue('ID Interno:')).toBe('-');
    expect(screen.getByText('Formulário de Devolução')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Retirar Amostra' }));
    expect(screen.getByText('Formulário de Retirada')).toBeInTheDocument();
    fillTotalWithdrawal();
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar Retirada' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }));
    expect(screen.getByText('Confirmar Retirada', { selector: 'h3' })).toBeInTheDocument();
    expect(mocks.withdraw).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));

    fireEvent.click(screen.getByRole('button', { name: 'Registrar Devolução' }));
    setField('Tipo de Devolução *', 'Total');
    setField('Responsável pela Devolução *', 'João Lima');
    setField('Condição da Amostra *', 'Íntegra');
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar Devolução' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }));
    expect(screen.getByText('Confirmar Devolução', { selector: 'h3' })).toBeInTheDocument();
    expect(mocks.returnSample).not.toHaveBeenCalled();
  });

  it('keeps the forms as typed when the server does not confirm the save', async () => {
    mocks.getByBarcode.mockResolvedValue(found(PARTIAL));
    mocks.withdraw.mockResolvedValue({ data: { success: false } });
    mocks.returnSample.mockResolvedValue({ data: { success: false } });
    render(<SampleWithdrawalReturnPage />);
    await search();

    fireEvent.click(screen.getByRole('button', { name: 'Retirar Amostra' }));
    fillTotalWithdrawal();
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar Retirada' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }));
    await waitFor(() => expect(mocks.withdraw).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Confirmar Retirada' })).toBeEnabled());
    expect(screen.getByLabelText('Responsável pela Retirada *')).toHaveValue('Ana Souza');

    fireEvent.click(screen.getByRole('button', { name: 'Registrar Devolução' }));
    setField('Tipo de Devolução *', 'Total');
    setField('Responsável pela Devolução *', 'João Lima');
    setField('Condição da Amostra *', 'Íntegra');
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar Devolução' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }));
    await waitFor(() => expect(mocks.returnSample).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Confirmar Devolução' })).toBeEnabled());
    expect(screen.getByLabelText('Responsável pela Devolução *')).toHaveValue('João Lima');
    expect(mocks.getByBarcode).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/registrada com sucesso/)).toBeNull();
  });

  it('reports a search, withdrawal or return error by its message, else a fallback', async () => {
    mocks.getByBarcode.mockRejectedValueOnce(new Error('Tempo esgotado')).mockRejectedValueOnce({});
    render(<SampleWithdrawalReturnPage />);
    fireEvent.change(screen.getByLabelText('Código de Barras'), { target: { value: 'BR-2026-001' } });
    fireEvent.click(screen.getByRole('button', { name: 'Buscar' }));
    expect(await screen.findByText('Tempo esgotado')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Buscar' }));
    expect(await screen.findByText('Erro ao buscar amostra')).toBeInTheDocument();

    mocks.getByBarcode.mockResolvedValue(found(PARTIAL));
    mocks.withdraw.mockRejectedValueOnce(new Error('Rede indisponível')).mockRejectedValueOnce({});
    mocks.returnSample.mockRejectedValueOnce({});
    await search();
    fireEvent.click(screen.getByRole('button', { name: 'Retirar Amostra' }));
    fillTotalWithdrawal();
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar Retirada' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }));
    expect(await screen.findByText('Rede indisponível')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar Retirada' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }));
    expect(await screen.findByText('Erro ao registrar retirada')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Registrar Devolução' }));
    setField('Tipo de Devolução *', 'Total');
    setField('Responsável pela Devolução *', 'João Lima');
    setField('Condição da Amostra *', 'Íntegra');
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar Devolução' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }));
    expect(await screen.findByText('Erro ao registrar devolução')).toBeInTheDocument();
  });
});

describe('SampleWithdrawalReturnPage history and quality', () => {
  it('shows no movement when the history answer carries no list', async () => {
    mocks.getByBarcode.mockResolvedValue(found(PARTIAL));
    mocks.getMovements.mockResolvedValue({ data: { success: true } });
    render(<SampleWithdrawalReturnPage />);
    await search();
    expect(screen.getByText('Nenhuma movimentação registrada')).toBeInTheDocument();
  });

  it('shows a withdrawal purpose when it has no destination, "-" for neither, and µL for unitless balances', async () => {
    mocks.getByBarcode.mockResolvedValue(found(PARTIAL));
    mocks.getMovements.mockResolvedValue({
      data: {
        success: true,
        data: [
          { movementID: 1, type: 'withdraw', quantity: 2, responsible: 'Ana Souza', purpose: 'DNA', previousQuantity: 5, newQuantity: 3, timestamp: '2026-01-02T10:00:00Z' },
          { movementID: 2, type: 'withdraw', quantity: 1, responsible: 'Ana Souza', previousQuantity: 3, newQuantity: 2, timestamp: '2026-01-03T10:00:00Z' },
        ],
      },
    });
    render(<SampleWithdrawalReturnPage />);
    await search();
    const [first, second] = screen.getAllByRole('row').slice(1).map((row) => within(row).getAllByRole('cell').map((cell) => cell.textContent));
    expect(first.slice(4, 7)).toEqual(['DNA', '5 µL', '3 µL']);
    expect(second.slice(4, 7)).toEqual(['-', '3 µL', '2 µL']);
  });

  it('shows an RCS grade alone when it has no score or route', async () => {
    mocks.getByBarcode.mockResolvedValue(found({ ...PARTIAL, rcs_evaluation: { final_grade: 'A' } }));
    render(<SampleWithdrawalReturnPage />);
    await search();
    expect(infoValue('Qualidade:')).toBe('Grade A');
  });

  it('names the governance failures only when governance failed', async () => {
    mocks.getByBarcode.mockResolvedValue(found({
      ...PARTIAL,
      rcs_evaluation: { final_grade: 'B', rcs_score: 72, grade_route: 'clinical', governance_status: 1, governance_failure_reasons: ['tcle ausente'] },
    }));
    render(<SampleWithdrawalReturnPage />);
    await search();
    expect(infoValue('Qualidade:')).toBe('Grade B | RCS 72 | clinical');
  });
});
