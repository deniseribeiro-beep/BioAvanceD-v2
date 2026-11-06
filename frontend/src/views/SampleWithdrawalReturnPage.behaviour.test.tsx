import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import SampleWithdrawalReturnPage from './SampleWithdrawalReturnPage';

// #1337: the page as an operator uses it -- the barcode search and what it
// shows, the withdrawal and return forms with their validation, the
// confirmation modal and the calls it makes, and the movement history.
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

// The page writes `t(key) || '<Portuguese fallback>'`, so an empty
// translation renders the fallback text an operator reads.
vi.mock('../contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: () => '', language: 'pt-BR' }),
}));

const FULL_SAMPLE = {
  _id: 'S-1',
  barcode: 'BR-2026-001',
  sampleType: 'Sangue',
  linkedProject: 'Projeto XYZ',
  unit: 'mL',
  initialQuantity: 10,
  currentQuantity: 10,
  totalWithdrawn: 0,
  totalReturned: 0,
  specimenStatus: 'available',
  quantityStatus: 'full',
  quality: 'GOOD',
};

const PARTIAL_SAMPLE = {
  ...FULL_SAMPLE,
  currentQuantity: 6,
  totalWithdrawn: 4,
  totalReturned: 0,
  quantityStatus: 'partial',
};

function found(sample: Record<string, unknown>, participant: Record<string, unknown> | null = null) {
  return { data: { success: true, data: { sample, participant } } };
}

async function search(barcode = 'BR-2026-001') {
  fireEvent.change(screen.getByLabelText('Código de Barras'), { target: { value: barcode } });
  fireEvent.click(screen.getByRole('button', { name: 'Buscar' }));
  await screen.findByText('Dados da Amostra');
}

function setField(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

beforeEach(() => {
  Object.values(mocks).forEach((mock) => mock.mockReset());
  mocks.getMovements.mockResolvedValue({ data: { success: true, data: [] } });
  mocks.getSampleLocation.mockResolvedValue({ success: false });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('SampleWithdrawalReturnPage search', () => {
  it('asks for a barcode before searching', () => {
    render(<SampleWithdrawalReturnPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Buscar' }));
    expect(screen.getByText('Código de barras é obrigatório')).toBeInTheDocument();
    expect(mocks.getByBarcode).not.toHaveBeenCalled();
  });

  it('shows the sample, its patient, storage, quality and movements on Enter', async () => {
    mocks.getByBarcode.mockResolvedValue(
      found({ ...FULL_SAMPLE, withdrawalDate: '2026-01-02T10:00:00Z' }, { participantId: 42, patientName: 'Maria Silva' })
    );
    mocks.getSampleLocation.mockResolvedValue({
      success: true,
      data: { specimenId: 'S-1', box: { boxId: 'b', boxName: 'BOX_01', position: 'A1' }, path: 'F1/S1/BOX_01' },
    });
    mocks.getMovements.mockResolvedValue({
      data: {
        success: true,
        data: [
          { movementID: 1, sampleID: 'S-1', type: 'withdraw', quantity: 2, unit: 'mL', responsible: 'Ana Souza', destination: 'Lab A', previousQuantity: 10, newQuantity: 8, timestamp: '2026-01-02T10:00:00Z' },
          { movementID: 2, sampleID: 'S-1', type: 'return', quantity: 1, responsible: '', userName: 'joao', condition: 'Íntegra', timestamp: '2026-01-03T10:00:00Z', observations: 'ok' },
          { movementID: 3, sampleID: 'S-1', type: 'adjust', quantity: null, responsible: '', timestamp: '2026-01-04T10:00:00Z' },
          { movementID: 4, sampleID: 'S-1', type: 'recount', responsible: 'X Y', timestamp: '' },
        ],
      },
    });
    render(<SampleWithdrawalReturnPage />);
    const input = screen.getByLabelText('Código de Barras');
    fireEvent.change(input, { target: { value: '  BR-2026-001  ' } });
    fireEvent.keyPress(input, { key: 'Enter', code: 'Enter', charCode: 13 });

    await screen.findByText('Dados da Amostra');
    expect(mocks.getByBarcode).toHaveBeenCalledWith('BR-2026-001');
    expect(mocks.getMovements).toHaveBeenCalledWith('S-1');
    expect(mocks.getSampleLocation).toHaveBeenCalledWith('S-1');
    expect(screen.getByText('42 - Maria Silva')).toBeInTheDocument();
    expect(screen.getByText('F1/S1/BOX_01 / Posição A1')).toBeInTheDocument();
    expect(screen.getByText('Adequada / Boa Qualidade')).toBeInTheDocument();
    expect(screen.getByText('Disponível')).toBeInTheDocument();
    expect(screen.getByTestId('withdrawal-quantity-status')).toHaveTextContent('Íntegra');
    expect(screen.getByText('Última Retirada:')).toBeInTheDocument();
    expect(screen.queryByTestId('rcs-scope-notice')).not.toBeInTheDocument();
    // Movement history: type labels, the withdraw destination, the return
    // condition, the user name fallback and the unknown type shown raw.
    expect(screen.getByText('Retirada')).toBeInTheDocument();
    expect(screen.getByText('Devolução')).toBeInTheDocument();
    expect(screen.getByText('Ajuste')).toBeInTheDocument();
    expect(screen.getByText('recount')).toBeInTheDocument();
    expect(screen.getByText('Lab A')).toBeInTheDocument();
    expect(screen.getByText('joao')).toBeInTheDocument();
    expect(screen.getByText('8 mL')).toBeInTheDocument();
    // A full specimen opens on the withdraw tab with the project prefilled.
    expect(screen.getByText('Formulário de Retirada')).toBeInTheDocument();
    expect(screen.getByLabelText('Projeto Vinculado *')).toHaveValue('Projeto XYZ');
  });

  it('shows the RCS grade, its route, the governance failures and the scope notice', async () => {
    mocks.getByBarcode.mockResolvedValue(
      found({
        ...FULL_SAMPLE,
        rcs_evaluation: {
          final_grade: 'C',
          rcs_score: 61,
          grade_route: 'governance',
          governance_status: 0,
          governance_failure_reasons: ['tcle ausente', '', 'sem coleta'],
        },
      })
    );
    render(<SampleWithdrawalReturnPage />);
    await search();
    expect(screen.getByText('Grade C | RCS 61 | governance: tcle ausente; sem coleta')).toBeInTheDocument();
    expect(screen.getByTestId('rcs-scope-notice')).toBeInTheDocument();
  });

  it('reports a sample that is not found, and an API error', async () => {
    mocks.getByBarcode.mockResolvedValueOnce({ data: { success: true, data: {} } });
    render(<SampleWithdrawalReturnPage />);
    fireEvent.change(screen.getByLabelText('Código de Barras'), { target: { value: 'NOPE' } });
    fireEvent.click(screen.getByRole('button', { name: 'Buscar' }));
    expect(await screen.findByText('Amostra não encontrada')).toBeInTheDocument();

    mocks.getByBarcode.mockRejectedValueOnce({ response: { data: { error: 'Falha no servidor' } } });
    fireEvent.click(screen.getByRole('button', { name: 'Buscar' }));
    expect(await screen.findByText('Falha no servidor')).toBeInTheDocument();
    expect(screen.queryByText('Dados da Amostra')).not.toBeInTheDocument();
  });

  it('keeps the sample when the movement history fails to load', async () => {
    mocks.getByBarcode.mockResolvedValue(found({ ...FULL_SAMPLE, quality: undefined, linkedProject: undefined }));
    mocks.getMovements.mockRejectedValue(new Error('boom'));
    render(<SampleWithdrawalReturnPage />);
    await search();
    expect(screen.getByText('Nenhuma movimentação registrada')).toBeInTheDocument();
    expect(screen.getByText('Aguardando Armazenagem')).toBeInTheDocument();
  });
});

describe('SampleWithdrawalReturnPage withdrawal', () => {
  it('validates the withdrawal form one rule at a time', async () => {
    mocks.getByBarcode.mockResolvedValue(found({ ...FULL_SAMPLE, linkedProject: '' }));
    render(<SampleWithdrawalReturnPage />);
    await search();
    const confirm = () => fireEvent.click(screen.getByRole('button', { name: 'Confirmar Retirada' }));

    confirm();
    expect(screen.getByText('Tipo de retirada é obrigatório')).toBeInTheDocument();

    setField('Tipo de Retirada *', 'Parcial');
    confirm();
    expect(screen.getByText('Quantidade é obrigatória para retirada parcial')).toBeInTheDocument();

    setField('Quantidade a Retirar (mL) *', '50');
    confirm();
    expect(screen.getByText('Quantidade indisponível. Disponível: 10 mL')).toBeInTheDocument();

    setField('Quantidade a Retirar (mL) *', '2');
    setField('Responsável pela Retirada *', 'Ana');
    confirm();
    expect(screen.getByText('Nome do responsável deve conter nome e sobrenome')).toBeInTheDocument();

    setField('Responsável pela Retirada *', 'Ana Souza');
    confirm();
    expect(screen.getByText('Destino da amostra é obrigatório')).toBeInTheDocument();

    setField('Destino da Amostra *', 'Lab A');
    confirm();
    expect(screen.getByText('Projeto vinculado é obrigatório')).toBeInTheDocument();
    expect(mocks.withdraw).not.toHaveBeenCalled();
  });

  it('confirms a partial withdrawal, sends it and searches the sample again', async () => {
    mocks.getByBarcode.mockResolvedValue(found(FULL_SAMPLE));
    mocks.withdraw.mockResolvedValue({ data: { success: true, data: { withdrawnQuantity: 2 } } });
    render(<SampleWithdrawalReturnPage />);
    await search();

    setField('Tipo de Retirada *', 'Parcial');
    setField('Quantidade a Retirar (mL) *', '2');
    setField('Responsável pela Retirada *', 'Ana Souza');
    setField('Destino da Amostra *', 'Lab A');
    setField('Finalidade da Retirada', 'DNA');
    setField('Observações', 'urgente');
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar Retirada' }));

    expect(screen.getByText('Confirmar Retirada', { selector: 'h3' })).toBeInTheDocument();
    expect(screen.getByText(/retirada parcial da amostra BR-2026-001/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }));
    await waitFor(() => expect(mocks.getByBarcode).toHaveBeenCalledTimes(2));
    expect(mocks.withdraw).toHaveBeenCalledWith('S-1', {
      withdrawalType: 'Parcial',
      withdrawalQuantity: 2,
      withdrawalResponsible: 'Ana Souza',
      sampleDestination: 'Lab A',
      purpose: 'DNA',
      linkedProject: 'Projeto XYZ',
      observations: 'urgente',
    });
    await waitFor(() => expect(screen.getByLabelText('Responsável pela Retirada *')).toHaveValue(''));
    // #1431: the reload after the save used to clear this message.
    expect(screen.getByText('Retirada registrada com sucesso! Quantidade retirada: 2 mL')).toBeInTheDocument();
  });

  it('cancels the confirmation modal without sending, and reports a refused total withdrawal', async () => {
    mocks.getByBarcode.mockResolvedValue(found(FULL_SAMPLE));
    mocks.withdraw.mockRejectedValue({ response: { data: { message: 'Amostra bloqueada' } } });
    render(<SampleWithdrawalReturnPage />);
    await search();

    setField('Tipo de Retirada *', 'Total');
    setField('Responsável pela Retirada *', 'Ana Souza');
    setField('Destino da Amostra *', 'Lab A');
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar Retirada' }));
    expect(screen.getByText(/retirada total da amostra BR-2026-001/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByText('Confirmar Retirada', { selector: 'h3' })).not.toBeInTheDocument();
    expect(mocks.withdraw).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Confirmar Retirada' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }));
    expect(await screen.findByText('Amostra bloqueada')).toBeInTheDocument();
    expect(mocks.withdraw).toHaveBeenCalledWith('S-1', expect.objectContaining({ withdrawalType: 'Total', withdrawalQuantity: undefined }));
  });

  it('disables both tabs for a quarantined specimen', async () => {
    mocks.getByBarcode.mockResolvedValue(found({ ...PARTIAL_SAMPLE, specimenStatus: 'quarantined' }));
    render(<SampleWithdrawalReturnPage />);
    await search();
    expect(screen.getByRole('button', { name: 'Retirar Amostra' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Registrar Devolução' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Confirmar Retirada' })).toBeDisabled();
  });
});

describe('SampleWithdrawalReturnPage return', () => {
  it('opens on the return tab for a partly withdrawn sample and validates the return form', async () => {
    mocks.getByBarcode.mockResolvedValue(found(PARTIAL_SAMPLE));
    render(<SampleWithdrawalReturnPage />);
    await search();
    expect(screen.getByText('Formulário de Devolução')).toBeInTheDocument();
    const confirm = () => fireEvent.click(screen.getByRole('button', { name: 'Confirmar Devolução' }));

    confirm();
    expect(screen.getByText('Tipo de devolução é obrigatório')).toBeInTheDocument();

    setField('Tipo de Devolução *', 'Parcial');
    confirm();
    expect(screen.getByText('Quantidade é obrigatória para devolução parcial')).toBeInTheDocument();

    setField('Quantidade a Devolver (mL) *', '9');
    confirm();
    expect(screen.getByText('Quantidade excede o pendente. Pendente: 4 mL')).toBeInTheDocument();

    setField('Quantidade a Devolver (mL) *', '1');
    setField('Responsável pela Devolução *', 'Jo');
    confirm();
    expect(screen.getByText('Responsável pela devolução é obrigatório')).toBeInTheDocument();

    setField('Responsável pela Devolução *', 'João Lima');
    confirm();
    expect(screen.getByText('Condição da amostra é obrigatória')).toBeInTheDocument();

    setField('Condição da Amostra *', 'Inutilizada');
    expect(screen.getByText(/NÃO retornam ao estoque disponível/)).toBeInTheDocument();
    confirm();
    expect(screen.getByText('Observações são obrigatórias quando a condição não é Íntegra')).toBeInTheDocument();
    expect(mocks.returnSample).not.toHaveBeenCalled();
  });

  it('confirms a total return of the pending quantity and reloads the sample', async () => {
    mocks.getByBarcode.mockResolvedValue(found(PARTIAL_SAMPLE));
    mocks.returnSample.mockResolvedValue({ data: { success: true, data: { returnedQuantity: 4 } } });
    render(<SampleWithdrawalReturnPage />);
    await search();

    setField('Tipo de Devolução *', 'Total');
    setField('Responsável pela Devolução *', 'João Lima');
    setField('Condição da Amostra *', 'Inutilizada');
    setField('Observações *', 'tubo rachado');
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar Devolução' }));
    expect(screen.getByText('Esta quantidade NÃO retornará ao estoque!', { exact: false })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }));
    await waitFor(() => expect(mocks.getByBarcode).toHaveBeenCalledTimes(2));
    expect(mocks.returnSample).toHaveBeenCalledWith('S-1', {
      returnType: 'Total',
      returnQuantity: 4,
      returnResponsible: 'João Lima',
      condition: 'Inutilizada',
      observations: 'tubo rachado',
    });
    await waitFor(() => expect(screen.getByLabelText('Responsável pela Devolução *')).toHaveValue(''));
    // #1431: the reload after the save used to clear this message.
    expect(screen.getByText('Devolução registrada com sucesso! Quantidade devolvida: 4 mL')).toBeInTheDocument();
  });

  it('reports a refused partial return', async () => {
    mocks.getByBarcode.mockResolvedValue(found(PARTIAL_SAMPLE));
    mocks.returnSample.mockRejectedValue(new Error('Rede indisponível'));
    render(<SampleWithdrawalReturnPage />);
    await search();

    setField('Tipo de Devolução *', 'Parcial');
    setField('Quantidade a Devolver (mL) *', '1');
    setField('Responsável pela Devolução *', 'João Lima');
    setField('Condição da Amostra *', 'Íntegra');
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar Devolução' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }));
    expect(await screen.findByText('Rede indisponível')).toBeInTheDocument();
    expect(mocks.returnSample).toHaveBeenCalledWith('S-1', expect.objectContaining({ returnType: 'Parcial', returnQuantity: 1 }));
  });
});
