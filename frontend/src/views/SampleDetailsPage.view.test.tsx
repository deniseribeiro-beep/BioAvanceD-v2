import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

// Behaviour of the sample detail view once the sample resolves: the page states,
// the compliance graph card, storage, editing, results and the child actions.
const h = vi.hoisted(() => ({
  // An empty string for a key with no fallback, so the page's own `|| '...'` text shows.
  t: (_k: string, fb?: string) => fb ?? '',
  canEdit: false,
  samplesState: { samples: [] as unknown[] | undefined, loading: false, error: null as string | null },
  results: [] as unknown[],
  equipment: [] as unknown[],
  updateSample: vi.fn(),
  loadSamples: vi.fn(),
  loadResults: vi.fn(),
  navigate: vi.fn(),
  getById: vi.fn(),
  getComplianceGraph: vi.fn(),
  getGraphStatus: vi.fn(),
  getSampleLocation: vi.fn(),
  download: vi.fn(),
}));

vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router-dom')>()),
  useNavigate: () => h.navigate,
}));
vi.mock('../contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: h.t, language: 'pt-BR' }),
}));
vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { roleName: h.canEdit ? 'Coordenador' : 'Tecnico' },
    hasRole: () => false,
  }),
}));
vi.mock('../hooks/useSamples', () => ({
  useSamples: () => ({ ...h.samplesState, updateSample: h.updateSample, loadSamples: h.loadSamples }),
}));
vi.mock('../hooks/useResults', () => ({
  useResults: () => ({ results: h.results, loadResults: h.loadResults }),
}));
vi.mock('../hooks/useEquipment', () => ({
  useEquipment: () => ({ equipment: h.equipment }),
}));
vi.mock('../components/AnalysisUploadModal', () => ({
  default: (p: { isOpen: boolean; sampleId: string; onClose: () => void; onSuccess: () => void }) =>
    p.isOpen ? (
      <div data-testid="upload-modal">
        {p.sampleId}
        <button onClick={p.onClose}>modal-close</button>
        <button onClick={p.onSuccess}>modal-success</button>
      </div>
    ) : null,
}));
vi.mock('../components/SampleFilesSection', () => ({
  default: (p: { sampleID: string }) => <div data-testid="files-section">{p.sampleID}</div>,
}));
vi.mock('../components/samples/InlineStorageMovementPanel', () => ({
  default: (p: { sample: { id: string }; t: (k: string) => string; onCancel: () => void; onCompleted: () => void }) => (
    <div data-testid="storage-panel">
      {p.sample.id}|{p.t('panel.key')}
      <button onClick={p.onCancel}>panel-cancel</button>
      <button onClick={p.onCompleted}>panel-done</button>
    </div>
  ),
}));
vi.mock('../components/samples/CloseSpecimenAction', () => ({
  default: (p: { onClosed: (r: { specimenStatus: string; quantityStatus: string }) => void }) => (
    <button onClick={() => p.onClosed({ specimenStatus: 'closed', quantityStatus: 'full' })}>close-specimen</button>
  ),
}));
vi.mock('../services/storageApi', () => ({
  storageApi: { getSampleLocation: h.getSampleLocation },
}));
vi.mock('../services/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/api')>()),
  sampleService: { getById: h.getById, getComplianceGraph: h.getComplianceGraph, getGraphStatus: h.getGraphStatus },
  resultService: { download: h.download },
}));

import SampleDetailsPage from './SampleDetailsPage';

const baseSample = {
  _id: 'oid-1',
  specimenId: 'SPC-1',
  barcode: 'BC-1',
  sampleType: 'Sangue',
  sampleOrigin: 'Hospital A',
  extractionProtocol: 'Prot-1',
  linkedProject: 'Projeto Z',
  participantId: 'PAT-9',
  initialQuantity: 10,
  currentQuantity: 10,
};

const graph = (isReleasable: boolean) => ({
  sampleId: 'oid-1',
  isReleasable,
  suggestedStatus: isReleasable ? 'AVAILABLE' : 'BLOCKED',
  graphPath: {
    ethics: { valid: true, reason: 'TCLE assinado' },
    quality: { valid: isReleasable },
    clinical: { valid: true, reason: 'Dados clínicos ok' },
    integrity: { valid: true, reason: 'Hash ok' },
  },
});

// One array per test: the page's lookup effect depends on `samples`.
function renderWith(sample: Record<string, unknown> | null, path = `/samples/${sample?.specimenId ?? 'SPC-1'}`) {
  h.samplesState.samples = sample ? [sample] : h.samplesState.samples;
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/samples/:id" element={<SampleDetailsPage />} />
      </Routes>
    </MemoryRouter>
  );
}

const title = () => screen.findByTestId('sample-detail-page-title');

beforeEach(() => {
  h.canEdit = false;
  h.samplesState = { samples: [], loading: false, error: null };
  h.results = [];
  h.equipment = [];
  for (const fn of [h.updateSample, h.loadSamples, h.loadResults, h.navigate, h.getById, h.getComplianceGraph, h.getGraphStatus, h.getSampleLocation, h.download]) {
    fn.mockReset();
  }
  h.getComplianceGraph.mockResolvedValue({ data: null });
  h.getGraphStatus.mockResolvedValue({ data: { success: true, data: { sampleId: 'oid-1', projected: false, status: null, compromisedAt: null, compromiseFreezerKey: null, compromiseBreachedSince: null } } });
  h.getSampleLocation.mockResolvedValue({ success: false });
  h.getById.mockRejectedValue(new Error('404'));
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('SampleDetailsPage page states', () => {
  it('shows the loading text while samples load', () => {
    h.samplesState = { samples: [], loading: true, error: null };
    renderWith(null);
    expect(screen.getByText('Carregando...')).toBeInTheDocument();
    expect(h.getById).not.toHaveBeenCalled();
  });

  it('shows the hook error with a back button to the list', () => {
    h.samplesState = { samples: [], loading: false, error: 'falha de rede' };
    renderWith(null);
    expect(screen.getByText(/falha de rede/)).toHaveTextContent('Erro: falha de rede');
    fireEvent.click(screen.getByRole('button', { name: /Voltar/ }));
    expect(h.navigate).toHaveBeenCalledWith('/samples');
  });

  it('waits on the loading text while the samples list is still undefined', () => {
    h.samplesState = { samples: undefined, loading: false, error: null };
    renderWith(null);
    expect(screen.getByText('Carregando...')).toBeInTheDocument();
    expect(h.getById).not.toHaveBeenCalled();
  });

  it('the not-found state names the searched id and goes back to the list', async () => {
    renderWith(null, '/samples/SPC-NONE');
    expect(await screen.findByText('Amostra não encontrada')).toBeInTheDocument();
    expect(screen.getByText(/ID buscado/)).toHaveTextContent('SPC-NONE');
    expect(screen.queryByText(/Total de amostras carregadas/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Voltar/ }));
    expect(h.navigate).toHaveBeenCalledWith('/samples');
  });

  it('matches the route id case-insensitively and reads participantId from patientID', async () => {
    h.canEdit = true;
    renderWith({ ...baseSample, participantId: undefined, patientID: 'LEG-7' }, '/samples/spc-1');
    expect(await title()).toHaveTextContent('SPC-1');
    fireEvent.click(screen.getByTestId('sample-detail-edit-button'));
    expect(screen.getByDisplayValue('LEG-7')).toBeInTheDocument();
    expect(h.getById).not.toHaveBeenCalled();
  });
});

describe('SampleDetailsPage id fallbacks', () => {
  it('reads a getById payload under `sample` and an unwrapped one', async () => {
    h.getById.mockResolvedValueOnce({ data: { sample: { _id: 'r-1', specimenId: 'SPC-R1' } } });
    renderWith(null, '/samples/SPC-R1');
    expect(await title()).toHaveTextContent('SPC-R1');
    cleanup();

    h.getById.mockResolvedValueOnce({ _id: 'r-2', specimenId: 'SPC-R2' });
    renderWith(null, '/samples/SPC-R2');
    expect(await title()).toHaveTextContent('SPC-R2');
  });

  it('keeps the not-found state when getById returns a record with no id', async () => {
    h.getById.mockResolvedValue({ data: { data: { barcode: 'NO-ID' } } });
    renderWith(null, '/samples/SPC-BLANK');
    expect(await screen.findByText('Amostra não encontrada')).toBeInTheDocument();
  });

  it('uses the specimenId as the target id of a sample with no _id', async () => {
    h.canEdit = true;
    h.updateSample.mockResolvedValue(null);
    renderWith({ specimenId: 'SPC-8' });
    expect(await title()).toHaveTextContent('SPC-8');
    await waitFor(() => expect(h.getSampleLocation).toHaveBeenCalledWith('SPC-8'));
    expect(screen.getByTestId('files-section')).toHaveTextContent('SPC-8');

    fireEvent.click(screen.getByText('Gerenciar Armazenagem'));
    expect(screen.getByTestId('storage-panel')).toHaveTextContent('SPC-8|');
    fireEvent.click(screen.getByText('panel-done'));
    expect(h.getSampleLocation).toHaveBeenLastCalledWith('SPC-8');

    fireEvent.click(screen.getByText('Enviar Arquivo'));
    expect(screen.getByTestId('upload-modal')).toHaveTextContent('SPC-8');
    fireEvent.click(screen.getByText('modal-close'));

    fireEvent.click(screen.getByTestId('sample-detail-edit-button'));
    fireEvent.click(screen.getByTestId('sample-detail-cancel-button'));
    fireEvent.click(screen.getByTestId('sample-detail-edit-button'));
    fireEvent.click(screen.getByTestId('sample-detail-save-button'));
    await waitFor(() => expect(h.updateSample).toHaveBeenCalledWith('SPC-8', expect.any(Object)));
  });

  it('uses the route id for a sample listed only under `id`', async () => {
    h.canEdit = true;
    h.updateSample.mockResolvedValue(null);
    renderWith({ id: 'legacy-9', barcode: 'BC-L' }, '/samples/legacy-9');
    expect(await title()).toHaveTextContent('legacy-9');
    expect(screen.getByTestId('files-section')).toHaveTextContent('legacy-9');
    fireEvent.click(screen.getByText('Gerenciar Armazenagem'));
    expect(screen.getByTestId('storage-panel')).toHaveTextContent('legacy-9|');
    fireEvent.click(screen.getByTestId('sample-detail-edit-button'));
    fireEvent.click(screen.getByTestId('sample-detail-save-button'));
    await waitFor(() => expect(h.updateSample).toHaveBeenCalledWith('legacy-9', expect.any(Object)));
  });
});

describe('SampleDetailsPage read-only view', () => {
  it('renders the sample fields, quantities and status for a non-editor', async () => {
    renderWith({ ...baseSample, currentQuantity: 4, quantityStatus: 'partial', registeredAt: '2026-01-15T12:00:00Z' });
    expect(await title()).toHaveTextContent('Detalhes da Amostra - SPC-1');
    expect(screen.getByText('SPC-1')).toBeInTheDocument();
    expect(screen.getByText('Sangue')).toBeInTheDocument();
    expect(screen.getByText('Hospital A')).toBeInTheDocument();
    expect(screen.getByText('Prot-1')).toBeInTheDocument();
    expect(screen.getByText('Projeto Z')).toBeInTheDocument();
    expect(screen.getByText('PAT-9')).toBeInTheDocument();
    expect(screen.getByText('10,0 µL')).toBeInTheDocument();
    expect(screen.getByText('4,0 µL')).toBeInTheDocument();
    expect(screen.getByText('Parcialmente Retirada')).toBeInTheDocument();
    expect(screen.getByText(new Date('2026-01-15T12:00:00Z').toLocaleDateString('pt-BR'))).toBeInTheDocument();
    expect(screen.queryByTestId('sample-detail-edit-button')).not.toBeInTheDocument();
    expect(screen.queryByText('Gerenciar Armazenagem')).not.toBeInTheDocument();
    expect(screen.queryByText('Enviar Arquivo')).not.toBeInTheDocument();
    expect(screen.getByTestId('files-section')).toHaveTextContent('oid-1');
  });

  it('reads the available amount and the status from the same canonical quantities', async () => {
    // A stale volume* alias on the record must not override currentQuantity.
    renderWith({ ...baseSample, initialQuantity: 10, currentQuantity: 4, volumeInitial: 10, volumeCurrent: 10 });
    expect(await title()).toHaveTextContent('SPC-1');
    expect(screen.getByText('10,0 µL')).toBeInTheDocument();
    expect(screen.getByText('4,0 µL')).toBeInTheDocument();
    expect(screen.getByText('Parcialmente Retirada')).toBeInTheDocument();
  });

  it('falls back to N/A for missing fields and to registrationDate', async () => {
    renderWith({ _id: 'oid-2', specimenId: 'SPC-2', registrationDate: '2025-06-01T12:00:00Z', currentQuantity: 0 });
    expect(await title()).toHaveTextContent('SPC-2');
    expect(screen.getAllByText('N/A').length).toBeGreaterThanOrEqual(6);
    expect(screen.getByText(new Date('2025-06-01T12:00:00Z').toLocaleDateString('pt-BR'))).toBeInTheDocument();
    expect(screen.getAllByText('0,0 µL')).toHaveLength(2);
  });

  it('shows N/A for a sample with no registration date', async () => {
    renderWith({ _id: 'oid-3', specimenId: 'SPC-3' });
    expect(await title()).toHaveTextContent('SPC-3');
    const dateRow = screen.getByText('Data de Registro:').parentElement!;
    expect(within(dateRow).getByText('N/A')).toBeInTheDocument();
  });

  it('shows — and Não registrada when quantity fields are absent (#1436)', async () => {
    renderWith({
      _id: 'oid-unknown',
      specimenId: 'SPC-UNK',
      barcode: 'BC-UNK',
      sampleType: 'Plasma',
    });
    expect(await title()).toHaveTextContent('SPC-UNK');
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('Não registrada')).toBeInTheDocument();
    expect(screen.queryByText('0,0 µL')).not.toBeInTheDocument();
    expect(screen.queryByText('Disponível')).not.toBeInTheDocument();
    expect(screen.queryByText('Indisponível')).not.toBeInTheDocument();
  });

  it('navigates to the chain, the label and back to the list', async () => {
    renderWith(baseSample);
    await title();
    fireEvent.click(screen.getByTestId('sample-detail-chain-button'));
    fireEvent.click(screen.getByTestId('sample-detail-label-button'));
    fireEvent.click(screen.getByTestId('sample-detail-back-button'));
    expect(h.navigate.mock.calls).toEqual([['/samples/SPC-1/chain'], ['/samples/SPC-1/label'], ['/samples']]);
  });

  it('updates the status label when the specimen is closed', async () => {
    renderWith(baseSample);
    await title();
    expect(screen.getByText('Disponível')).toBeInTheDocument();
    fireEvent.click(screen.getByText('close-specimen'));
    expect(await screen.findByText('Encerrada')).toBeInTheDocument();
  });

  it('shows the lineage card for a derivative', async () => {
    renderWith({ ...baseSample, parentSpecimenIds: ['SPC-0'] });
    await title();
    expect(screen.getByTestId('sample-lineage-parent-link-SPC-0')).toHaveAttribute('href', '/samples/SPC-0');
  });
});

describe('SampleDetailsPage compliance graph', () => {
  it('shows a releasable report with each node and the suggested status', async () => {
    h.getComplianceGraph.mockResolvedValue({ data: { data: graph(true) } });
    renderWith(baseSample);
    expect(await screen.findByText('Amostra liberável')).toBeInTheDocument();
    expect(h.getComplianceGraph).toHaveBeenCalledWith('oid-1');
    expect(screen.getByText('TCLE assinado')).toBeInTheDocument();
    expect(screen.getByText('Hash ok')).toBeInTheDocument();
    expect(screen.getByText('Sem detalhes')).toBeInTheDocument();
    expect(screen.getByText('AVAILABLE')).toBeInTheDocument();
  });

  it('shows a blocked report read from an unwrapped response', async () => {
    h.getComplianceGraph.mockResolvedValue({ data: graph(false) });
    renderWith(baseSample);
    expect(await screen.findByText('Amostra bloqueada para liberação')).toBeInTheDocument();
    expect(screen.getByText('BLOCKED')).toBeInTheDocument();
  });

  it('shows the empty-report text when the graph has no data', async () => {
    renderWith(baseSample);
    expect(await screen.findByText('Sem relatório de conformidade disponível.')).toBeInTheDocument();
  });

  // The graph effect runs once per resolved id (route id, then _id), so each
  // render rejects every call rather than only the first.
  it('shows the server message, then the error message, then the default text on failure', async () => {
    h.getComplianceGraph.mockRejectedValue({ response: { data: { message: 'grafo indisponível' } } });
    renderWith(baseSample);
    expect(await screen.findByText('grafo indisponível')).toBeInTheDocument();
    cleanup();

    h.getComplianceGraph.mockRejectedValue(new Error('timeout'));
    renderWith(baseSample);
    expect(await screen.findByText('timeout')).toBeInTheDocument();
    cleanup();

    h.getComplianceGraph.mockRejectedValue({});
    renderWith(baseSample);
    expect(await screen.findByText('Erro ao carregar grafo de conformidade')).toBeInTheDocument();
  });
});

describe('SampleDetailsPage storage', () => {
  it('shows the awaiting banner when the sample has no location', async () => {
    renderWith(baseSample);
    await title();
    await waitFor(() => expect(h.getSampleLocation).toHaveBeenCalledWith('oid-1'));
    expect(screen.getAllByText(/Aguardando Armazenagem/).length).toBe(2);
  });

  it('shows the path and well of a stored sample, without the banner', async () => {
    h.getSampleLocation.mockResolvedValue({
      success: true,
      data: { box: { boxId: 'b1', boxName: 'Caixa A', position: 'A1' }, path: 'Freezer 1 > Rack 2' },
    });
    renderWith(baseSample);
    expect(await screen.findByText('Freezer 1 > Rack 2 / Poço A1')).toBeInTheDocument();
    expect(screen.queryByText(/Aguardando Armazenagem/)).not.toBeInTheDocument();
  });

  it('falls back to the box name when the location has no path or position', async () => {
    h.getSampleLocation.mockResolvedValue({ success: true, data: { box: { boxId: 'b2', boxName: 'Caixa B' } } });
    renderWith(baseSample);
    expect(await screen.findByText('Caixa B')).toBeInTheDocument();
  });

  it('an editor opens, cancels and completes the storage panel, which reloads samples and location', async () => {
    h.canEdit = true;
    renderWith(baseSample);
    await title();
    fireEvent.click(screen.getByText('Gerenciar Armazenagem'));
    expect(screen.getByTestId('storage-panel')).toHaveTextContent('oid-1|panel.key');
    fireEvent.click(screen.getByText('panel-cancel'));
    expect(screen.queryByTestId('storage-panel')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('Gerenciar Armazenagem'));
    const callsBefore = h.getSampleLocation.mock.calls.length;
    fireEvent.click(screen.getByText('panel-done'));
    expect(screen.queryByTestId('storage-panel')).not.toBeInTheDocument();
    expect(h.loadSamples).toHaveBeenCalledTimes(1);
    expect(h.getSampleLocation.mock.calls.length).toBe(callsBefore + 1);
  });
});

describe('SampleDetailsPage editing', () => {
  it('saves the edited fields and shows the record the backend returns', async () => {
    h.canEdit = true;
    h.updateSample.mockResolvedValue({ ...baseSample, sampleOrigin: 'Do servidor', currentQuantity: 7 });
    renderWith(baseSample);
    await title();
    fireEvent.click(screen.getByTestId('sample-detail-edit-button'));

    fireEvent.change(screen.getByDisplayValue('Hospital A'), { target: { value: 'Hospital B' } });
    fireEvent.change(screen.getByDisplayValue('Prot-1'), { target: { value: 'Prot-2' } });
    fireEvent.change(screen.getByDisplayValue('Projeto Z'), { target: { value: 'Projeto Y' } });
    fireEvent.change(screen.getByDisplayValue('PAT-9'), { target: { value: 'PAT-10' } });
    fireEvent.change(screen.getByDisplayValue('10'), { target: { value: '7' } });
    fireEvent.click(screen.getByTestId('sample-detail-save-button'));

    expect(await screen.findByText('Do servidor')).toBeInTheDocument();
    expect(h.updateSample).toHaveBeenCalledWith('oid-1', {
      linkedProject: 'Projeto Y',
      sampleOrigin: 'Hospital B',
      extractionProtocol: 'Prot-2',
      participantId: 'PAT-10',
      currentQuantity: 7,
    });
    expect(screen.queryByTestId('sample-detail-save-button')).not.toBeInTheDocument();
  });

  it('keeps the local edit when the backend returns nothing, and sends no quantity when it is blank', async () => {
    h.canEdit = true;
    h.updateSample.mockResolvedValue(undefined);
    renderWith(baseSample);
    await title();
    fireEvent.click(screen.getByTestId('sample-detail-edit-button'));
    fireEvent.change(screen.getByDisplayValue('Hospital A'), { target: { value: 'Hospital C' } });
    fireEvent.change(screen.getByDisplayValue('10'), { target: { value: '' } });
    fireEvent.click(screen.getByTestId('sample-detail-save-button'));

    expect(await screen.findByText('Hospital C')).toBeInTheDocument();
    expect(h.updateSample.mock.calls[0][1]).not.toHaveProperty('currentQuantity');
    expect(screen.getAllByText('10,0 µL')).toHaveLength(2);
  });

  it('rejects a negative quantity without calling the backend', async () => {
    h.canEdit = true;
    renderWith(baseSample);
    await title();
    fireEvent.click(screen.getByTestId('sample-detail-edit-button'));
    fireEvent.change(screen.getByDisplayValue('10'), { target: { value: '-1' } });
    fireEvent.click(screen.getByTestId('sample-detail-save-button'));

    expect(await screen.findByText('Quantidade disponível inválida')).toBeInTheDocument();
    expect(h.updateSample).not.toHaveBeenCalled();
  });

  it('shows the save error message, or the default text, when the update fails', async () => {
    h.canEdit = true;
    h.updateSample.mockRejectedValueOnce(new Error('conflito')).mockRejectedValueOnce({});
    renderWith(baseSample);
    await title();
    fireEvent.click(screen.getByTestId('sample-detail-edit-button'));
    fireEvent.click(screen.getByTestId('sample-detail-save-button'));
    expect(await screen.findByText('conflito')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('sample-detail-save-button'));
    expect(await screen.findByText('Erro ao salvar alterações')).toBeInTheDocument();
    expect(screen.getByTestId('sample-detail-save-button')).toBeEnabled();
  });

  it('shows Salvando... and disables both buttons while the save is in flight', async () => {
    h.canEdit = true;
    let finish: (v: unknown) => void = () => {};
    h.updateSample.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    renderWith(baseSample);
    await title();
    fireEvent.click(screen.getByTestId('sample-detail-edit-button'));
    fireEvent.click(screen.getByTestId('sample-detail-save-button'));

    expect(await screen.findByText('Salvando...')).toBeInTheDocument();
    expect(screen.getByTestId('sample-detail-cancel-button')).toBeDisabled();
    finish(null);
    await waitFor(() => expect(screen.queryByTestId('sample-detail-save-button')).not.toBeInTheDocument());
  });

  it('cancel drops the edits and the save error', async () => {
    h.canEdit = true;
    renderWith(baseSample);
    await title();
    fireEvent.click(screen.getByTestId('sample-detail-edit-button'));
    fireEvent.change(screen.getByDisplayValue('Hospital A'), { target: { value: 'Rascunho' } });
    fireEvent.change(screen.getByDisplayValue('10'), { target: { value: '-5' } });
    fireEvent.click(screen.getByTestId('sample-detail-save-button'));
    await screen.findByText('Quantidade disponível inválida');

    fireEvent.click(screen.getByTestId('sample-detail-cancel-button'));
    expect(screen.queryByText('Quantidade disponível inválida')).not.toBeInTheDocument();
    expect(screen.getByText('Hospital A')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('sample-detail-edit-button'));
    expect(screen.getByDisplayValue('Hospital A')).toBeInTheDocument();
    expect(screen.getByDisplayValue('10')).toBeInTheDocument();
  });
});

describe('SampleDetailsPage analysis files', () => {
  const results = [
    { _id: 'r1', resultID: 'RES-1', specimenId: 'SPC-1', fileType: 'PDF', method: 'PCR', responsibleResearcher: 'Ana', equipmentID: 3, description: 'Laudo' },
    { _id: 'r2', specimenId: 'SPC-1', fileType: 'CSV', equipmentID: 7 },
    { _id: 'r3', resultID: 'RES-3', specimenId: 'SPC-1', fileType: 'TXT', equipmentName: 'Leitor manual' },
    { _id: 'r4', resultID: 'RES-4', specimenId: 'SPC-1', fileType: 'XML' },
    { _id: 'r5', resultID: 'RES-5', specimenId: 'SPC-OTHER', fileType: 'PDF' },
  ];

  it('shows the empty text when no result belongs to the sample', async () => {
    h.results = [results[4]];
    renderWith(baseSample);
    expect(await screen.findByText('Nenhum arquivo associado a esta amostra')).toBeInTheDocument();
  });

  it('shows no results for a sample without a specimenId', async () => {
    h.results = results;
    renderWith({ _id: 'oid-x', barcode: 'BC-X' }, '/samples/oid-x');
    expect(await title()).toHaveTextContent('oid-x');
    expect(screen.getByText('Nenhum arquivo associado a esta amostra')).toBeInTheDocument();
  });

  it('lists the sample results with their equipment labels', async () => {
    h.results = results;
    h.equipment = [{ equipmentID: 3, equipmentDescription: 'Termociclador' }];
    renderWith(baseSample);
    expect(await screen.findByText('RES-1')).toBeInTheDocument();
    expect(screen.getByText('r2')).toBeInTheDocument();
    expect(screen.queryByText('RES-5')).not.toBeInTheDocument();
    expect(screen.getByText('Termociclador')).toBeInTheDocument();
    expect(screen.getByText('Equipamento #7')).toBeInTheDocument();
    expect(screen.getByText('Leitor manual')).toBeInTheDocument();
    expect(screen.getByText('Não informado')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Download/ })).toHaveLength(4);
  });

  it('downloads a result and alerts when the download fails', async () => {
    h.results = [results[0], results[1]];
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    h.download.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('expirado')).mockRejectedValueOnce({});
    renderWith(baseSample);
    await screen.findByText('RES-1');
    const [first, second] = screen.getAllByRole('button', { name: /Download/ });

    fireEvent.click(first);
    await waitFor(() => expect(h.download).toHaveBeenCalledWith('r1'));
    expect(alertSpy).not.toHaveBeenCalled();

    fireEvent.click(second);
    await waitFor(() => expect(alertSpy).toHaveBeenCalledWith('Erro ao fazer download: expirado'));
    fireEvent.click(second);
    await waitFor(() => expect(alertSpy).toHaveBeenLastCalledWith('Erro ao fazer download: Erro desconhecido'));
  });

  it('an editor opens the upload modal, and a successful upload reloads results and closes it', async () => {
    h.canEdit = true;
    renderWith(baseSample);
    await title();
    fireEvent.click(screen.getByText('Enviar Arquivo'));
    expect(screen.getByTestId('upload-modal')).toHaveTextContent('oid-1');
    fireEvent.click(screen.getByText('modal-close'));
    expect(screen.queryByTestId('upload-modal')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('Enviar Arquivo'));
    fireEvent.click(screen.getByText('modal-success'));
    expect(h.loadResults).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('upload-modal')).not.toBeInTheDocument();
  });
});
