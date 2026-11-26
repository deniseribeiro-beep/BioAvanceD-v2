import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import AnalysisUploadModal from './AnalysisUploadModal';
import { equipmentService, resultService } from '../services/api';

// #898: the backend wraps /equipment/analytical in a { success, data }
// envelope, but the component used to assume a bare array and silently
// fell back to an empty list on every real call. These mocks isolate
// loadAnalyticalEquipment's unwrapping from the modal's other data hooks.
vi.mock('../services/api', () => ({
  equipmentService: {
    getAnalytical: vi.fn(),
    getAll: vi.fn().mockResolvedValue({ data: { success: true, data: [] } }),
  },
  resultService: {
    upload: vi.fn(),
  },
}));

// Mutable per-test state behind the hook mocks. The user object must keep
// its identity across renders: the modal's reset effect depends on `user`,
// so a fresh object per render would wipe every typed value.
const state = vi.hoisted(() => ({
  samples: [] as any[],
  types: [] as any[],
  typesLoading: false,
  typesError: null as string | null,
  user: { name: 'Test User' } as any,
  isAdmin: false,
}));

vi.mock('../hooks/useSamples', () => ({
  useSamples: () => ({ samples: state.samples }),
}));

vi.mock('../hooks/useAnalysisTypes', () => ({
  useAnalysisTypes: () => ({ types: state.types, loading: state.typesLoading, error: state.typesError }),
}));

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ user: state.user, hasRole: () => state.isAdmin }),
}));

function resetState() {
  state.samples = [];
  state.types = [];
  state.typesLoading = false;
  state.typesError = null;
  state.user = { name: 'Test User' };
  state.isAdmin = false;
}

const HPLC = { equipmentID: 1, name: 'HPLC', serialNumber: 'SN-1', status: 'Active' };

// The three Selects share the aria-label 'Campo de seleção', in DOM order:
// analysis type, equipment, method.
function selects() {
  const [typeSelect, equipmentSelect, methodSelect] = screen.getAllByLabelText('Campo de seleção') as HTMLSelectElement[];
  return { typeSelect, equipmentSelect, methodSelect };
}

function optionLabels(select: HTMLSelectElement) {
  return Array.from(select.options).map((o) => o.textContent);
}

async function fillValidForm({ withSample = true } = {}) {
  await waitFor(() => expect(screen.getByText('HPLC (SN-1)')).toBeInTheDocument());
  const { typeSelect, equipmentSelect, methodSelect } = selects();
  const file = new File(['abc'], 'result.csv', { type: 'text/csv' });
  fireEvent.change(screen.getByLabelText('Arquivo'), { target: { files: [file] } });
  fireEvent.change(typeSelect, { target: { value: 'PCR' } });
  fireEvent.change(equipmentSelect, { target: { value: '1' } });
  fireEvent.change(methodSelect, { target: { value: 'ELISA' } });
  fireEvent.change(screen.getByPlaceholderText('Observações'), { target: { value: '  some notes  ' } });
  if (withSample) {
    fireEvent.change(screen.getByPlaceholderText('Digite ou selecione a amostra'), { target: { value: 'SP-7' } });
  }
  return file;
}

describe('AnalysisUploadModal — analytical equipment loading (#898)', () => {
  beforeEach(() => {
    resetState();
    vi.mocked(equipmentService.getAnalytical).mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('populates the dropdown from the { success, data } envelope the backend actually sends', async () => {
    vi.mocked(equipmentService.getAnalytical).mockResolvedValue({
      data: {
        success: true,
        data: [{ equipmentID: 1, name: 'HPLC', serialNumber: 'SN-1', status: 'Active' }],
      },
    } as any);

    render(<AnalysisUploadModal isOpen={true} onClose={() => {}} />);

    await waitFor(() => {
      expect(screen.getByText('HPLC (SN-1)')).toBeInTheDocument();
    });
  });

  it('still supports a bare array response (backward compatibility)', async () => {
    vi.mocked(equipmentService.getAnalytical).mockResolvedValue({
      data: [{ equipmentID: 2, name: 'Centrifuge', serialNumber: 'SN-2', status: 'Active' }],
    } as any);

    render(<AnalysisUploadModal isOpen={true} onClose={() => {}} />);

    await waitFor(() => {
      expect(screen.getByText('Centrifuge (SN-2)')).toBeInTheDocument();
    });
  });

  it('does not silently populate the list for an unrecognised response shape, and logs it instead', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(equipmentService.getAnalytical).mockResolvedValue({
      data: { unexpected: 'shape' },
    } as any);

    render(<AnalysisUploadModal isOpen={true} onClose={() => {}} />);

    await waitFor(() => {
      expect(screen.getByText('Nenhum equipamento analítico disponível')).toBeInTheDocument();
    });
    expect(consoleErrorSpy).toHaveBeenCalled();
  });

  it('shows a loading option and disables the equipment select while the list is in flight', () => {
    vi.mocked(equipmentService.getAnalytical).mockReturnValue(new Promise(() => {}) as any);

    render(<AnalysisUploadModal isOpen={true} onClose={() => {}} />);

    const { equipmentSelect } = selects();
    expect(optionLabels(equipmentSelect)).toEqual(['Carregando equipamentos...']);
    expect(equipmentSelect).toBeDisabled();
  });

  it('logs a failed equipment request and falls back to the empty-list option', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(equipmentService.getAnalytical).mockRejectedValue(new Error('boom'));

    render(<AnalysisUploadModal isOpen={true} onClose={() => {}} />);

    await waitFor(() => {
      expect(optionLabels(selects().equipmentSelect)).toEqual(['Nenhum equipamento analítico disponível']);
    });
    expect(consoleErrorSpy).toHaveBeenCalledWith('Erro ao carregar equipamentos analíticos:', expect.any(Error));
    expect(selects().equipmentSelect).toBeDisabled();
  });

  it('labels each item by name, then description, then a generic word, and hides equipment under maintenance', async () => {
    vi.mocked(equipmentService.getAnalytical).mockResolvedValue({
      data: [
        { equipmentID: 1, name: 'HPLC', serialNumber: 'SN-1', status: 'Active' },
        { equipmentID: 2, equipmentDescription: 'Leitor de placas', status: 'Active' },
        { equipmentID: 3, status: 'Active' },
        { equipmentID: 4, name: 'Old PCR', serialNumber: 'SN-4', status: 'Maintenance' },
      ],
    } as any);

    render(<AnalysisUploadModal isOpen={true} onClose={() => {}} />);

    await waitFor(() => {
      expect(optionLabels(selects().equipmentSelect)).toEqual([
        'Selecione o equipamento',
        'HPLC (SN-1)',
        'Leitor de placas',
        'Equipamento',
      ]);
    });
    expect(Array.from(selects().equipmentSelect.options).map((o) => o.value)).toEqual(['', '1', '2', '3']);
    expect(screen.getByText(/Equipamentos em manutenção não estão disponíveis/)).toBeInTheDocument();
  });

  it('shows no maintenance notice when no item is under maintenance', async () => {
    vi.mocked(equipmentService.getAnalytical).mockResolvedValue({ data: [HPLC] } as any);

    render(<AnalysisUploadModal isOpen={true} onClose={() => {}} />);

    await waitFor(() => expect(screen.getByText('HPLC (SN-1)')).toBeInTheDocument());
    expect(screen.queryByText(/Equipamentos em manutenção/)).not.toBeInTheDocument();
  });

  it('renders nothing and loads nothing while closed', () => {
    const { container } = render(<AnalysisUploadModal isOpen={false} onClose={() => {}} />);

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByText('Enviar Arquivo de Análise')).not.toBeInTheDocument();
    expect(equipmentService.getAnalytical).not.toHaveBeenCalled();
  });
});

describe('AnalysisUploadModal — form options and defaults', () => {
  beforeEach(() => {
    resetState();
    vi.mocked(equipmentService.getAnalytical).mockReset();
    vi.mocked(equipmentService.getAnalytical).mockResolvedValue({ data: [HPLC] } as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows a loading option and disables the type select while analysis types load', async () => {
    state.typesLoading = true;

    render(<AnalysisUploadModal isOpen={true} onClose={() => {}} />);

    await waitFor(() => expect(screen.getByText('HPLC (SN-1)')).toBeInTheDocument());
    const { typeSelect } = selects();
    expect(optionLabels(typeSelect)).toEqual(['Carregando opções...']);
    expect(typeSelect).toBeDisabled();
  });

  it('lists the analysis types by name with their code as value, and shows the types error', async () => {
    state.types = [{ code: 'PCR', name: 'PCR quantitativo' }, { code: 'SEQ', name: 'Sequenciamento' }];
    state.typesError = 'Falha ao carregar tipos';

    render(<AnalysisUploadModal isOpen={true} onClose={() => {}} />);

    await waitFor(() => expect(screen.getByText('HPLC (SN-1)')).toBeInTheDocument());
    const { typeSelect } = selects();
    expect(optionLabels(typeSelect)).toEqual(['Selecione o tipo', 'PCR quantitativo', 'Sequenciamento']);
    expect(Array.from(typeSelect.options).map((o) => o.value)).toEqual(['', 'PCR', 'SEQ']);
    expect(typeSelect).not.toBeDisabled();
    expect(screen.getByText('Falha ao carregar tipos')).toBeInTheDocument();
  });

  it('shows the empty-types option when no type exists', async () => {
    render(<AnalysisUploadModal isOpen={true} onClose={() => {}} />);

    await waitFor(() => expect(screen.getByText('HPLC (SN-1)')).toBeInTheDocument());
    expect(optionLabels(selects().typeSelect)).toEqual(['Nenhum tipo disponível']);
  });

  it('offers every analysis method after the placeholder', async () => {
    render(<AnalysisUploadModal isOpen={true} onClose={() => {}} />);

    await waitFor(() => expect(screen.getByText('HPLC (SN-1)')).toBeInTheDocument());
    expect(optionLabels(selects().methodSelect)).toEqual([
      'Selecione o método',
      'PCR em Tempo Real',
      'Sequenciamento NGS',
      'ELISA',
      'Espectrometria de Massa',
      'Microscopia',
    ]);
  });

  it('suggests each known sample by specimenId, then _id, with its barcode when present', async () => {
    state.samples = [
      { specimenId: 'SP-1', barcode: 'BC-1' },
      { _id: 'mongo-2' },
      {},
    ];

    render(<AnalysisUploadModal isOpen={true} onClose={() => {}} />);

    await waitFor(() => expect(screen.getByText('HPLC (SN-1)')).toBeInTheDocument());
    const options = Array.from(document.querySelectorAll('#sample-list option')) as HTMLOptionElement[];
    expect(options.map((o) => o.value)).toEqual(['SP-1', 'mongo-2', '']);
    expect(options[0].textContent).toBe('SP-1 • BC-1');
    expect(options[1].textContent).toBe('mongo-2 ');
  });

  it('prefills the researcher from the user name, read-only for a non-administrator', async () => {
    render(<AnalysisUploadModal isOpen={true} onClose={() => {}} />);

    await waitFor(() => expect(screen.getByText('HPLC (SN-1)')).toBeInTheDocument());
    const researcher = screen.getByPlaceholderText('Pesquisador');
    expect(researcher).toHaveValue('Test User');
    expect(researcher).toBeDisabled();
  });

  it('falls back to the username, then the email, for the researcher', async () => {
    state.user = { username: 'tuser', email: 't@example.org' };
    const { unmount } = render(<AnalysisUploadModal isOpen={true} onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText('HPLC (SN-1)')).toBeInTheDocument());
    expect(screen.getByPlaceholderText('Pesquisador')).toHaveValue('tuser');
    unmount();

    state.user = { email: 't@example.org' };
    render(<AnalysisUploadModal isOpen={true} onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText('HPLC (SN-1)')).toBeInTheDocument());
    expect(screen.getByPlaceholderText('Pesquisador')).toHaveValue('t@example.org');
  });

  it('leaves the researcher empty and read-only with no user', async () => {
    state.user = null;

    render(<AnalysisUploadModal isOpen={true} onClose={() => {}} />);

    await waitFor(() => expect(screen.getByText('HPLC (SN-1)')).toBeInTheDocument());
    const researcher = screen.getByPlaceholderText('Pesquisador');
    expect(researcher).toHaveValue('');
    expect(researcher).toBeDisabled();
  });

  it('lets an administrator by role check edit the researcher', async () => {
    state.isAdmin = true;

    render(<AnalysisUploadModal isOpen={true} onClose={() => {}} />);

    await waitFor(() => expect(screen.getByText('HPLC (SN-1)')).toBeInTheDocument());
    const researcher = screen.getByPlaceholderText('Pesquisador');
    expect(researcher).not.toBeDisabled();
    fireEvent.change(researcher, { target: { value: 'Outra Pessoa' } });
    expect(researcher).toHaveValue('Outra Pessoa');
  });

  it('lets an administrator by roleName edit the researcher', async () => {
    state.user = { name: 'Admin', roleName: 'Administrador' };

    render(<AnalysisUploadModal isOpen={true} onClose={() => {}} />);

    await waitFor(() => expect(screen.getByText('HPLC (SN-1)')).toBeInTheDocument());
    expect(screen.getByPlaceholderText('Pesquisador')).not.toBeDisabled();
  });

  it('shows a fixed sample id read-only and hides the sample picker', async () => {
    render(<AnalysisUploadModal isOpen={true} onClose={() => {}} sampleId="SP-FIXED" />);

    await waitFor(() => expect(screen.getByText('HPLC (SN-1)')).toBeInTheDocument());
    expect(screen.getByDisplayValue('SP-FIXED')).toBeDisabled();
    expect(screen.queryByPlaceholderText('Digite ou selecione a amostra')).not.toBeInTheDocument();
    expect(document.querySelector('#sample-list')).toBeNull();
  });

  it('renders inside a card with a hide button in inline mode', async () => {
    const onClose = vi.fn();
    render(<AnalysisUploadModal isOpen={true} onClose={onClose} inline />);

    await waitFor(() => expect(screen.getByText('HPLC (SN-1)')).toBeInTheDocument());
    expect(screen.getByRole('heading', { name: 'Enviar Arquivo de Análise' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Ocultar' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders inside a dialog in modal mode, and Cancelar closes it', async () => {
    const onClose = vi.fn();
    render(<AnalysisUploadModal isOpen={true} onClose={onClose} />);

    await waitFor(() => expect(screen.getByText('HPLC (SN-1)')).toBeInTheDocument());
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Enviar Arquivo de Análise')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ocultar' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('AnalysisUploadModal — submitting', () => {
  beforeEach(() => {
    resetState();
    state.types = [{ code: 'PCR', name: 'PCR quantitativo' }];
    vi.mocked(equipmentService.getAnalytical).mockReset();
    vi.mocked(equipmentService.getAnalytical).mockResolvedValue({ data: [HPLC] } as any);
    vi.mocked(resultService.upload).mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps Enviar disabled until every required field is filled', async () => {
    render(<AnalysisUploadModal isOpen={true} onClose={() => {}} />);

    await waitFor(() => expect(screen.getByText('HPLC (SN-1)')).toBeInTheDocument());
    const send = screen.getByRole('button', { name: 'Enviar' });
    expect(send).toBeDisabled();
    await fillValidForm({ withSample: false });
    expect(send).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText('Digite ou selecione a amostra'), { target: { value: 'SP-7' } });
    expect(send).not.toBeDisabled();
    fireEvent.change(screen.getByLabelText('Arquivo'), { target: { files: [] } });
    expect(send).toBeDisabled();
  });

  it('uploads the form as multipart fields with trimmed text, then reports success and closes', async () => {
    vi.mocked(resultService.upload).mockResolvedValue({} as any);
    const onClose = vi.fn();
    const onSuccess = vi.fn();
    render(<AnalysisUploadModal isOpen={true} onClose={onClose} onSuccess={onSuccess} />);

    const file = await fillValidForm();
    fireEvent.click(screen.getByRole('button', { name: 'Enviar' }));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(resultService.upload).toHaveBeenCalledTimes(1);
    const formData = vi.mocked(resultService.upload).mock.calls[0][0] as FormData;
    expect(formData.get('file')).toBe(file);
    expect(formData.get('analysisType')).toBe('PCR');
    expect(formData.get('specimenId')).toBe('SP-7');
    expect(formData.get('method')).toBe('ELISA');
    expect(formData.get('responsibleResearcher')).toBe('Test User');
    expect(formData.get('description')).toBe('some notes');
    expect(formData.get('equipmentID')).toBe('1');
    expect(screen.getByPlaceholderText('Digite ou selecione a amostra')).toHaveValue('');
  });

  it('sends the fixed sample id and closes without an onSuccess callback', async () => {
    vi.mocked(resultService.upload).mockResolvedValue({} as any);
    const onClose = vi.fn();
    render(<AnalysisUploadModal isOpen={true} onClose={onClose} sampleId="SP-FIXED" />);

    await fillValidForm({ withSample: false });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar' }));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    const formData = vi.mocked(resultService.upload).mock.calls[0][0] as FormData;
    expect(formData.get('specimenId')).toBe('SP-FIXED');
    expect(screen.getByDisplayValue('SP-FIXED')).toBeInTheDocument();
  });

  it('shows Enviando... and disables the buttons while the upload is in flight', async () => {
    let resolveUpload: (v: unknown) => void = () => {};
    vi.mocked(resultService.upload).mockReturnValue(new Promise((r) => { resolveUpload = r; }) as any);
    render(<AnalysisUploadModal isOpen={true} onClose={() => {}} inline />);

    await fillValidForm();
    fireEvent.click(screen.getByRole('button', { name: 'Enviar' }));

    expect(await screen.findByRole('button', { name: 'Enviando...' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Ocultar' })).toBeDisabled();
    expect(screen.getByLabelText('Arquivo')).toBeDisabled();
    resolveUpload({});
    await waitFor(() => expect(screen.getByRole('button', { name: 'Cancelar' })).not.toBeDisabled());
  });

  it('shows the upload error message and stays open on failure', async () => {
    vi.mocked(resultService.upload).mockRejectedValue(new Error('Arquivo grande demais'));
    const onClose = vi.fn();
    const onSuccess = vi.fn();
    render(<AnalysisUploadModal isOpen={true} onClose={onClose} onSuccess={onSuccess} />);

    await fillValidForm();
    fireEvent.click(screen.getByRole('button', { name: 'Enviar' }));

    expect(await screen.findByText('Arquivo grande demais')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(onSuccess).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Enviar' })).not.toBeDisabled();
  });

  it('falls back to a generic error when the failure has no message', async () => {
    vi.mocked(resultService.upload).mockRejectedValue({});
    render(<AnalysisUploadModal isOpen={true} onClose={() => {}} />);

    await fillValidForm();
    fireEvent.click(screen.getByRole('button', { name: 'Enviar' }));

    expect(await screen.findByText('Erro ao enviar arquivo')).toBeInTheDocument();
  });
});
