import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import TcleBuilderPage from './TcleBuilderPage';
import { consentService } from '../services/api';

const { showToast } = vi.hoisted(() => ({ showToast: vi.fn() }));

vi.mock('../services/api', () => ({
  consentService: {
    getPurposeCodes: vi.fn(),
    getTemplateById: vi.fn(),
    getTemplates: vi.fn(),
    createTemplate: vi.fn(),
    updateTemplate: vi.fn(),
  },
}));

// A stable showToast: the page's load effect depends on it, so a new
// function per render would re-run the load on every render.
vi.mock('../components/UI/ToastContainer', () => ({
  useToast: () => ({ showToast }),
}));

const mocked = vi.mocked(consentService);

const PURPOSES = [{ code: 'DUO:0000006', display: 'Pesquisa biomédica' }];

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
}

function renderPage(path = '/admin/tcle/new') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/admin/tcle/new" element={<TcleBuilderPage />} />
        <Route path="/admin/tcle/edit/:templateId" element={<TcleBuilderPage />} />
      </Routes>
      <LocationProbe />
    </MemoryRouter>
  );
}

function editor() {
  return screen.getByRole('textbox', { name: 'Editor do corpo do TCLE' });
}

function typeBody(html: string) {
  const node = editor();
  node.innerHTML = html;
  fireEvent.input(node);
}

function fillRequiredFields({ from = '2026-01-01', to = '2026-12-31' } = {}) {
  fireEvent.change(screen.getByLabelText('Nome do Modelo'), { target: { value: 'TCLE Biobanco' } });
  fireEvent.change(screen.getByLabelText('Data de Início da Vigência'), { target: { value: from } });
  fireEvent.change(screen.getByLabelText('Data Final de Vigência'), { target: { value: to } });
  typeBody('<p>Corpo do termo</p>');
}

// jsdom's Blob has no text(); FileReader reads it.
function readBlob(blob: Blob) {
  return new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.readAsText(blob);
  });
}

function submitForm() {
  fireEvent.submit(document.getElementById('tcle-builder-form') as HTMLFormElement);
}

const savedTemplate = {
  _id: 'tpl-new',
  title: 'TCLE Biobanco',
  caae: '12345678.9.0000.0000',
  consentModel: 'broad',
  htmlContent: '<p>Corpo do termo</p>',
  validFrom: '2026-01-01T12:00:00.000Z',
  validTo: '2026-12-31T23:59:59.999Z',
  versionGroupId: 'group-1',
  granularPermissions: [{ key: 'consent_x', label: 'Aceito o armazenamento', required: true, purposeCode: 'DUO:0000006' }],
};

describe('TcleBuilderPage (#1337)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.getPurposeCodes.mockResolvedValue({ data: { success: true, data: PURPOSES } } as any);
    mocked.getTemplates.mockResolvedValue({ data: { success: true, data: [] } } as any);
    mocked.getTemplateById.mockResolvedValue({ data: { success: true, data: savedTemplate } } as any);
    mocked.createTemplate.mockResolvedValue({ data: { success: true, data: savedTemplate } } as any);
    mocked.updateTemplate.mockResolvedValue({ data: { success: true, data: savedTemplate } } as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('opens in creation mode with the submit disabled and lists the DUO purposes', async () => {
    renderPage();
    expect(screen.getByText('Criação da 1ª versão')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Criar versão do TCLE/ })).toBeDisabled();
    expect(await screen.findByRole('option', { name: 'Pesquisa biomédica (DUO:0000006)' })).toBeInTheDocument();
    expect(mocked.getTemplateById).not.toHaveBeenCalled();
  });

  it('keeps only the no-purpose option when the purpose codes fail to load', async () => {
    mocked.getPurposeCodes.mockRejectedValue(new Error('down'));
    renderPage();
    await waitFor(() => expect(mocked.getPurposeCodes).toHaveBeenCalled());
    const select = screen.getByLabelText('Finalidade (DUO)');
    expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual(['Sem finalidade codificada']);
  });

  it('creates the first version with the granular permission and goes to its edit route', async () => {
    renderPage();
    await screen.findByRole('option', { name: 'Pesquisa biomédica (DUO:0000006)' });
    fillRequiredFields();
    fireEvent.change(screen.getByLabelText('CAAE'), { target: { value: ' 12345678.9.0000.0000 ' } });
    fireEvent.change(screen.getByLabelText('Modalidade de Consentimento'), { target: { value: 'broad' } });
    fireEvent.change(screen.getByLabelText('Texto do consentimento'), { target: { value: 'Aceito o armazenamento' } });
    fireEvent.click(screen.getByLabelText('Checkbox obrigatório'));
    fireEvent.change(screen.getByLabelText('Finalidade (DUO)'), { target: { value: 'DUO:0000006' } });

    expect(screen.getByText('14 caracteres')).toBeInTheDocument();
    const shownKey = screen.getByText(/^Chave automática:/).textContent!.replace('Chave automática: ', '');

    const submit = screen.getByRole('button', { name: /Criar versão do TCLE/ });
    expect(submit).toBeEnabled();
    await userEvent.click(submit);

    await waitFor(() => expect(mocked.createTemplate).toHaveBeenCalledTimes(1));
    const payload = mocked.createTemplate.mock.calls[0][0] as any;
    expect(payload).toMatchObject({
      title: 'TCLE Biobanco',
      caae: '12345678.9.0000.0000',
      consentModel: 'broad',
      htmlContent: '<p>Corpo do termo</p>',
      content: '<p>Corpo do termo</p>',
      active: true,
      permissions: [{ key: shownKey, label: 'Aceito o armazenamento', required: true, purposeCode: 'DUO:0000006' }],
    });
    expect(shownKey).toMatch(/^consent_[a-z0-9]{1,8}$/);
    expect(payload.validFrom).toBe(new Date('2026-01-01T12:00:00.000').toISOString());
    expect(payload.validTo).toBe(new Date('2026-12-31T23:59:59.999').toISOString());
    expect(payload).not.toHaveProperty('version');
    expect(mocked.updateTemplate).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith('TCLE criado com sucesso.', 'success');
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/admin/tcle/edit/tpl-new'));
  });

  it('keeps the typed values when the server answers with only the new id, and keys duplicate labels apart', async () => {
    mocked.createTemplate.mockResolvedValue({ data: { _id: 'tpl-min' } } as any);
    mocked.getTemplateById.mockReturnValue(new Promise(() => {}) as any);
    renderPage();
    fillRequiredFields();
    await userEvent.click(screen.getByRole('button', { name: /Adicionar consentimento/ }));
    const labels = screen.getAllByLabelText('Texto do consentimento');
    fireEvent.change(labels[0], { target: { value: 'Mesmo texto' } });
    fireEvent.change(labels[1], { target: { value: 'Mesmo texto' } });
    submitForm();

    await waitFor(() => expect(mocked.createTemplate).toHaveBeenCalledTimes(1));
    const keys = (mocked.createTemplate.mock.calls[0][0] as any).permissions.map((p: any) => p.key);
    expect(keys[1]).toBe(`${keys[0]}_2`);
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/admin/tcle/edit/tpl-min'));
    expect(screen.getByLabelText('Nome do Modelo')).toHaveValue('TCLE Biobanco');
  });

  it('refuses to save without the required fields', async () => {
    renderPage();
    submitForm();
    expect(showToast).toHaveBeenCalledWith('Preencha o nome do modelo, as datas de vigência e o corpo do termo antes de salvar.', 'warning');
    expect(mocked.createTemplate).not.toHaveBeenCalled();
  });

  it('refuses an end date before the start date', async () => {
    renderPage();
    fillRequiredFields({ from: '2026-06-01', to: '2026-05-01' });
    submitForm();
    expect(showToast).toHaveBeenCalledWith('A data final de vigência deve ser maior ou igual à data inicial.', 'warning');
    expect(mocked.createTemplate).not.toHaveBeenCalled();
  });

  it('refuses to save without a labelled granular consent', async () => {
    renderPage();
    fillRequiredFields();
    expect(screen.getByRole('button', { name: /Criar versão do TCLE/ })).toBeDisabled();
    submitForm();
    expect(showToast).toHaveBeenCalledWith('Adicione ao menos um consentimento granular antes de salvar.', 'warning');
    expect(mocked.createTemplate).not.toHaveBeenCalled();
  });

  it('shows the server message when the save fails, and a fallback when no version comes back', async () => {
    mocked.createTemplate.mockRejectedValueOnce({ response: { data: { message: 'Título duplicado' } } });
    mocked.createTemplate.mockResolvedValueOnce({ data: { success: true, data: {} } } as any);
    mocked.createTemplate.mockRejectedValueOnce({});
    renderPage();
    fillRequiredFields();
    fireEvent.change(screen.getByLabelText('Texto do consentimento'), { target: { value: 'Aceito' } });
    submitForm();
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Título duplicado', 'error'));
    submitForm();
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('O servidor não retornou a nova versão do TCLE.', 'error'));
    submitForm();
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Não foi possível salvar o TCLE.', 'error'));
    expect(screen.getByTestId('location')).toHaveTextContent('/admin/tcle/new');
  });

  it('loads a template for editing and saves a new version over the active one', async () => {
    mocked.getTemplates.mockResolvedValue({
      data: {
        success: true,
        data: [
          { _id: 'old', title: 'TCLE Biobanco', version: 'v1', versionGroupId: 'group-1', active: false, createdAt: '2026-01-01' },
          { _id: 'cur', title: 'TCLE Biobanco', version: 'v2', versionGroupId: 'group-1', active: true, createdAt: '2026-02-01' },
          { _id: 'other', title: 'Outro', version: 'v9', versionGroupId: 'group-2', active: true, createdAt: '2026-03-01' },
        ],
      },
    } as any);
    mocked.updateTemplate.mockResolvedValue({
      data: { success: true, data: { ...savedTemplate, _id: 'tpl-1', consentNotifications: { total: 3, notified: 2, failed: 1 } } },
    } as any);
    renderPage('/admin/tcle/edit/tpl-1');

    expect(await screen.findByDisplayValue('TCLE Biobanco')).toBeInTheDocument();
    expect(mocked.getTemplateById).toHaveBeenCalledWith('tpl-1');
    expect(screen.getByText('Edição versionada')).toBeInTheDocument();
    expect(screen.getByLabelText('Texto do consentimento')).toHaveValue('Aceito o armazenamento');
    expect(screen.getByLabelText('Checkbox obrigatório')).toBeChecked();
    expect(screen.getByLabelText('Data de Início da Vigência')).toHaveValue('2026-01-01');
    expect(await screen.findByText('v2')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /Salvar nova versão do TCLE/ }));
    await waitFor(() => expect(mocked.updateTemplate).toHaveBeenCalledTimes(1));
    expect(mocked.updateTemplate.mock.calls[0][0]).toBe('tpl-1');
    expect(mocked.updateTemplate.mock.calls[0][1]).toMatchObject({ version: 'v2', title: 'TCLE Biobanco' });
    expect(showToast).toHaveBeenCalledWith(
      'Nova versão criada e a anterior foi desativada. Convites de consentimento enviados: 2 de 3 participantes pendentes. 1 falha(s) no envio -- reenvie pela lista de participantes pendentes.',
      'warning'
    );
    expect(mocked.createTemplate).not.toHaveBeenCalled();
  });

  it('returns to the new-term route when the template cannot be loaded', async () => {
    mocked.getTemplateById.mockRejectedValue(new Error('Falha de rede'));
    renderPage('/admin/tcle/edit/missing');
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Falha de rede', 'error'));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/admin/tcle/new'));
  });

  it('loads a legacy template from its content and permissions fields, dropping blank items', async () => {
    mocked.getTemplateById.mockResolvedValue({
      data: { data: { _id: 'legacy', content: '<p>Legado</p>', validFrom: 'not-a-date', permissions: [{ label: ' Antigo ' }, { label: '' }, null] } },
    } as any);
    renderPage('/admin/tcle/edit/legacy');
    await waitFor(() => expect(screen.getByLabelText('Texto do consentimento')).toHaveValue('Antigo'));
    expect(screen.getAllByLabelText('Texto do consentimento')).toHaveLength(1);
    expect(screen.getByLabelText('Checkbox obrigatório')).not.toBeChecked();
    expect(editor().innerHTML).toBe('<p>Legado</p>');
    expect(screen.getByLabelText('Nome do Modelo')).toHaveValue('');
    expect(screen.getByLabelText('Data de Início da Vigência')).toHaveValue('');
  });

  it('starts from one empty item when a template has no labelled permission', async () => {
    mocked.getTemplateById.mockResolvedValue({ data: { data: { _id: 'bare', title: 'Sem itens', granularPermissions: [{ label: '  ' }] } } } as any);
    renderPage('/admin/tcle/edit/bare');
    expect(await screen.findByDisplayValue('Sem itens')).toBeInTheDocument();
    expect(screen.getAllByLabelText('Texto do consentimento')).toHaveLength(1);
    expect(screen.getByLabelText('Texto do consentimento')).toHaveValue('');
  });

  it('treats an empty template response as not found', async () => {
    mocked.getTemplateById.mockResolvedValue({ data: null } as any);
    renderPage('/admin/tcle/edit/empty');
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('TCLE não encontrado para edição.', 'error'));
  });

  it('adds and removes granular consent items, always keeping one', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /Adicionar consentimento/ }));
    expect(screen.getAllByLabelText('Texto do consentimento')).toHaveLength(2);
    const removes = screen.getAllByRole('button', { name: /Remover item/ });
    await userEvent.click(removes[0]);
    await userEvent.click(screen.getByRole('button', { name: /Remover item/ }));
    expect(screen.getAllByLabelText('Texto do consentimento')).toHaveLength(1);
    expect(screen.getByText('Chave automática: consent_item_1')).toBeInTheDocument();
  });

  it('clears an item purpose back to none', async () => {
    renderPage();
    await screen.findByRole('option', { name: 'Pesquisa biomédica (DUO:0000006)' });
    const select = screen.getByLabelText('Finalidade (DUO)');
    fireEvent.change(select, { target: { value: 'DUO:0000006' } });
    expect(select).toHaveValue('DUO:0000006');
    fireEvent.change(select, { target: { value: '' } });
    expect(select).toHaveValue('');
  });

  it('keeps only the no-purpose option when the purpose codes come back malformed', async () => {
    mocked.getPurposeCodes.mockResolvedValue({ data: {} } as any);
    renderPage();
    await waitFor(() => expect(mocked.getPurposeCodes).toHaveBeenCalled());
    expect(within(screen.getByLabelText('Finalidade (DUO)')).getAllByRole('option')).toHaveLength(1);
  });

  it('runs each toolbar command on the editor', async () => {
    const execCommand = vi.fn(() => true);
    Object.defineProperty(document, 'execCommand', { value: execCommand, configurable: true, writable: true });
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /Negrito/ }));
    await userEvent.click(screen.getByRole('button', { name: /Itálico/ }));
    await userEvent.click(screen.getByRole('button', { name: /Sublinhado/ }));
    await userEvent.click(screen.getByRole('button', { name: /^Lista$/ }));
    await userEvent.click(screen.getByRole('button', { name: /Lista numerada/ }));
    await userEvent.click(screen.getByRole('button', { name: /Título/ }));
    expect(execCommand.mock.calls.map((call: any[]) => [call[0], call[2]])).toEqual([
      ['bold', undefined],
      ['italic', undefined],
      ['underline', undefined],
      ['insertUnorderedList', undefined],
      ['insertOrderedList', undefined],
      ['formatBlock', 'h2'],
    ]);
  });

  describe('history tab', () => {
    it('lists every persisted version, newest first, with status, CAAE and validity', async () => {
      mocked.getTemplates.mockResolvedValue({
        data: {
          success: true,
          data: {
            items: [
              { _id: 'a', title: 'A', version: 'v1', caae: '', active: false, createdAt: '2026-01-01', vigencia: { fim: '2026-12-31T12:00:00.000Z' } },
              { _id: 'b', title: 'B', version: 'v2', caae: '111', active: true, createdAt: '2026-02-01' },
              { _id: 'c', title: 'C', caae: '   ', active: false, validTo: '2027-03-01T12:00:00.000Z', vigencia: {} },
              { _id: 'd', title: 'D', version: 'v3', active: false, createdAt: '2026-01-15', vigencia: {} },
            ],
          },
        },
      } as any);
      renderPage();
      await userEvent.click(screen.getByRole('tab', { name: /Histórico de Versões/i }));
      const historyTab = screen.getByRole('tab', { name: /Histórico de Versões/i });
      expect(historyTab).toHaveAttribute('aria-selected', 'true');
      await userEvent.click(historyTab);
      expect(historyTab).toHaveAttribute('aria-selected', 'true');
      expect(screen.getByText(/Exibindo todas as versões persistidas/)).toBeInTheDocument();

      const rows = (await screen.findAllByRole('row')).slice(1);
      expect(rows.map((row) => within(row).getAllByRole('cell')[0].textContent)).toEqual(['v2', 'v3', 'v1', '--']);
      const undated = rows[3];
      expect(within(undated).getAllByText('--')).toHaveLength(2);
      expect(within(undated).getByText(new Date('2027-03-01T12:00:00.000Z').toLocaleDateString('pt-BR'))).toBeInTheDocument();
      expect(within(rows[1]).getByText('Sem validade definida')).toBeInTheDocument();
      expect(screen.getByText('4', { selector: 'strong' })).toBeInTheDocument();
      expect(screen.getByText('3', { selector: 'strong' })).toBeInTheDocument();
      expect(within(rows[0]).getByText('Ativo')).toBeInTheDocument();
      expect(within(rows[0]).getByText('111')).toBeInTheDocument();
      expect(within(rows[0]).getByText('Sem validade definida')).toBeInTheDocument();
      expect(within(rows[2]).getByText('Obsoleto')).toBeInTheDocument();
      expect(within(rows[2]).getByText('--')).toBeInTheDocument();
      expect(within(rows[2]).getByText(new Date('2026-12-31T12:00:00.000Z').toLocaleDateString('pt-BR'))).toBeInTheDocument();

      await userEvent.click(screen.getByRole('tab', { name: /Edição do TCLE/i }));
      const editorTab = screen.getByRole('tab', { name: /Edição do TCLE/i });
      await userEvent.click(editorTab);
      expect(editorTab).toHaveAttribute('aria-selected', 'true');
      expect(screen.getByLabelText('Nome do Modelo')).toBeInTheDocument();
    });

    it('says no version exists yet when the history is empty', async () => {
      mocked.getTemplates.mockResolvedValue({ data: { success: true, data: {} } } as any);
      renderPage();
      await userEvent.click(screen.getByRole('tab', { name: /Histórico de Versões/ }));
      // The list starts empty, so wait for the debounced load to settle first.
      await waitFor(() => expect(mocked.getTemplates).toHaveBeenCalled());
      await waitFor(() => expect(screen.queryByText('Carregando histórico...')).toBeNull());
      expect(screen.getByText('Nenhuma versão de TCLE encontrada.')).toBeInTheDocument();
    });

    it('shows only the versions whose title matches the named model', async () => {
      mocked.getTemplates.mockResolvedValue({
        data: [
          { _id: 'x', version: 'v1', active: true },
          { _id: 'y', title: 'Outro', version: 'v8', active: true },
          { _id: 'z', title: ' modelo a ', version: 'v7', active: true },
        ],
      } as any);
      renderPage();
      fireEvent.change(screen.getByLabelText('Nome do Modelo'), { target: { value: 'Modelo A' } });
      await userEvent.click(screen.getByRole('tab', { name: /Histórico de Versões/ }));
      expect(await screen.findByText('v7')).toBeInTheDocument();
      expect(screen.queryByText('v8')).toBeNull();
      expect(screen.queryByText('v1')).toBeNull();
      expect(screen.getByText(/Versões do mesmo modelo são exibidas/)).toBeInTheDocument();
    });

    it('says no version exists for the named model', async () => {
      mocked.getTemplates.mockResolvedValue({ data: [{ _id: 'y', title: 'Outro', version: 'v8', active: true }] } as any);
      renderPage();
      fireEvent.change(screen.getByLabelText('Nome do Modelo'), { target: { value: 'Sem versões' } });
      await userEvent.click(screen.getByRole('tab', { name: /Histórico de Versões/ }));
      await waitFor(() => expect(mocked.getTemplates).toHaveBeenCalled());
      await waitFor(() => expect(screen.queryByText('Carregando histórico...')).toBeNull());
      expect(screen.queryByText('v8')).toBeNull();
      expect(screen.getByText('Nenhuma versão encontrada para este modelo.')).toBeInTheDocument();
    });

    it('shows the load error', async () => {
      mocked.getTemplates.mockRejectedValue(new Error('Histórico indisponível'));
      renderPage();
      await userEvent.click(screen.getByRole('tab', { name: /Histórico de Versões/ }));
      expect(await screen.findByText('Histórico indisponível')).toBeInTheDocument();
    });

    it('falls back to a generic load error', async () => {
      mocked.getTemplates.mockRejectedValue({});
      renderPage();
      await userEvent.click(screen.getByRole('tab', { name: /Histórico de Versões/ }));
      expect(await screen.findByText('Não foi possível carregar o histórico de versões.')).toBeInTheDocument();
    });

    it('opens a version in a hidden print frame, and warns for a version without an id', async () => {
      mocked.getTemplates.mockResolvedValue({
        data: {
          success: true,
          data: [
            {
              _id: 'p1', title: 'T', version: 'v1', active: true, createdAt: '2026-02-01',
              htmlContent: '<p>{{tag_desconhecida}} {{ nome_participante }}</p>',
              granularPermissions: [{ key: 'k', label: 'L', required: true }, { key: 'm', label: 'M', required: false }],
            },
            { title: 'T', version: 'v0', active: false, createdAt: '2026-01-01' },
            { _id: 'p2', active: false, createdAt: '2025-12-01' },
          ],
        },
      } as any);
      const createObjectURL = vi.fn((_blob: Blob) => 'blob:tcle');
      const revokeObjectURL = vi.fn();
      Object.assign(URL, { createObjectURL, revokeObjectURL });

      renderPage();
      await userEvent.click(screen.getByRole('tab', { name: /Histórico de Versões/ }));
      const pdfButtons = await screen.findAllByRole('button', { name: /PDF/ });

      await userEvent.click(pdfButtons[1]);
      expect(showToast).toHaveBeenCalledWith('Não foi possível abrir a visualização em PDF.', 'warning');

      await userEvent.click(pdfButtons[0]);
      const frame = document.querySelector('iframe[aria-hidden="true"]') as HTMLIFrameElement;
      expect(frame).not.toBeNull();
      expect(frame.getAttribute('src')).toBe('blob:tcle');
      const html = await readBlob(createObjectURL.mock.calls[0][0]);
      expect(html).toContain('<title>v1 - T</title>');
      expect(html).toContain('[x] L');
      expect(html).toContain('[ ] M');
      expect(html).toContain('{{tag_desconhecida}}');
      expect(html).toContain('Consentimentos granulares');

      // jsdom implements neither focus nor print on a frame window.
      const firstWindow = frame.contentWindow!;
      const print = vi.fn();
      Object.defineProperty(firstWindow, 'focus', { value: vi.fn(), configurable: true });
      Object.defineProperty(firstWindow, 'print', { value: print, configurable: true });
      (frame.onload as () => void)();
      await waitFor(() => expect(print).toHaveBeenCalledTimes(1));
      firstWindow.dispatchEvent(new Event('afterprint'));
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:tcle');
      expect(document.querySelector('iframe[aria-hidden="true"]')).toBeNull();

      // A version with no title, version or permissions; its print call
      // throws, and the frame is removed anyway.
      await userEvent.click(pdfButtons[2]);
      const second = document.querySelector('iframe[aria-hidden="true"]') as HTMLIFrameElement;
      const secondHtml = await readBlob(createObjectURL.mock.calls[1][0]);
      expect(secondHtml).toContain('<title>v? - TCLE</title>');
      expect(secondHtml).not.toContain('Consentimentos granulares');
      Object.defineProperty(second.contentWindow!, 'focus', { value: vi.fn(), configurable: true });
      Object.defineProperty(second.contentWindow!, 'print', { value: () => { throw new Error('blocked'); }, configurable: true });
      (second.onload as () => void)();
      await waitFor(() => expect(document.querySelector('iframe[aria-hidden="true"]')).toBeNull());
      expect(revokeObjectURL).toHaveBeenCalledTimes(2);
    });
  });
});
