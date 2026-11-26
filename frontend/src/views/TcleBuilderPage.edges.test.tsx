import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import TcleBuilderPage from './TcleBuilderPage';
import { consentService } from '../services/api';

// #1443: the edges TcleBuilderPage.test.tsx leaves open -- a response that
// lands after the page moved on, the editor across a tab switch, the id
// fallback without crypto.randomUUID, and the print frame without a window.
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

// A stable showToast: the page's load effect depends on it.
vi.mock('../components/UI/ToastContainer', () => ({
  useToast: () => ({ showToast }),
}));

const mocked = vi.mocked(consentService);

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
}

function GoTo({ to }: { to: string }) {
  const navigate = useNavigate();
  return <button type="button" onClick={() => navigate(to)}>{`go ${to}`}</button>;
}

function renderPage(path = '/admin/tcle/new') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/admin/tcle/new" element={<TcleBuilderPage />} />
        <Route path="/admin/tcle/edit/:templateId" element={<TcleBuilderPage />} />
      </Routes>
      <LocationProbe />
      <GoTo to="/admin/tcle/edit/B" />
    </MemoryRouter>
  );
}

function editor() {
  return screen.getByRole('textbox', { name: 'Editor do corpo do TCLE' });
}

function template(id: string, title: string) {
  return { data: { success: true, data: { _id: id, title, htmlContent: `<p>${title}</p>` } } };
}

function historyTab() {
  return screen.getByRole('tab', { name: /Histórico de Versões/i });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocked.getPurposeCodes.mockResolvedValue({ data: { success: true, data: [] } } as any);
  mocked.getTemplates.mockResolvedValue({ data: { success: true, data: [] } } as any);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('TcleBuilderPage when the edited template changes mid-load', () => {
  it('keeps the newer template and its loading state when the older one answers last', async () => {
    const a = deferred<any>();
    const b = deferred<any>();
    mocked.getTemplateById.mockImplementation(((id: string) => (id === 'A' ? a.promise : b.promise)) as any);
    renderPage('/admin/tcle/edit/A');
    fireEvent.click(screen.getByRole('button', { name: 'go /admin/tcle/edit/B' }));
    await waitFor(() => expect(mocked.getTemplateById).toHaveBeenCalledWith('B'));

    await act(async () => a.resolve(template('A', 'Modelo A')));
    expect(screen.getByLabelText('Nome do Modelo')).toHaveValue('');
    expect(screen.getByText('Carregando TCLE...')).toBeInTheDocument();

    await act(async () => b.resolve(template('B', 'Modelo B')));
    expect(screen.getByLabelText('Nome do Modelo')).toHaveValue('Modelo B');
    expect(screen.queryByText('Carregando TCLE...')).toBeNull();
  });

  it('drops the older template failure: no toast and no redirect', async () => {
    const a = deferred<any>();
    const b = deferred<any>();
    mocked.getTemplateById.mockImplementation(((id: string) => (id === 'A' ? a.promise : b.promise)) as any);
    renderPage('/admin/tcle/edit/A');
    fireEvent.click(screen.getByRole('button', { name: 'go /admin/tcle/edit/B' }));
    await waitFor(() => expect(mocked.getTemplateById).toHaveBeenCalledWith('B'));

    await act(async () => a.reject(new Error('Falha antiga')));
    expect(showToast).not.toHaveBeenCalled();
    expect(screen.getByTestId('location')).toHaveTextContent('/admin/tcle/edit/B');

    await act(async () => b.resolve(template('B', 'Modelo B')));
    expect(screen.getByLabelText('Nome do Modelo')).toHaveValue('Modelo B');
  });

  it('starts from one empty item when a template has neither permissions field', async () => {
    mocked.getTemplateById.mockResolvedValue(template('bare', 'Sem permissões') as any);
    renderPage('/admin/tcle/edit/bare');
    expect(await screen.findByDisplayValue('Sem permissões')).toBeInTheDocument();
    expect(screen.getAllByLabelText('Texto do consentimento')).toHaveLength(1);
    expect(screen.getByLabelText('Texto do consentimento')).toHaveValue('');
    expect(showToast).not.toHaveBeenCalled();
  });
});

describe('TcleBuilderPage history when the model changes mid-load', () => {
  it('keeps the newer list and its loading state when the older list answers last', async () => {
    const first = deferred<any>();
    const second = deferred<any>();
    mocked.getTemplates.mockReturnValueOnce(first.promise as any).mockReturnValueOnce(second.promise as any);
    renderPage();
    await waitFor(() => expect(mocked.getTemplates).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText('Nome do Modelo'), { target: { value: 'Modelo B' } });
    await waitFor(() => expect(mocked.getTemplates).toHaveBeenCalledTimes(2));
    fireEvent.click(historyTab());

    await act(async () => first.resolve({ data: [{ _id: 'a', title: 'Outro', version: 'v1', active: true }] }));
    expect(screen.queryByText('v1')).toBeNull();
    expect(screen.getByText('Carregando histórico...')).toBeInTheDocument();

    await act(async () => second.resolve({ data: [{ _id: 'b', title: 'Modelo B', version: 'v2', active: true }] }));
    expect(screen.getByText('v2')).toBeInTheDocument();
    expect(screen.queryByText('Carregando histórico...')).toBeNull();
  });

  it('drops the older list failure', async () => {
    const first = deferred<any>();
    const second = deferred<any>();
    mocked.getTemplates.mockReturnValueOnce(first.promise as any).mockReturnValueOnce(second.promise as any);
    renderPage();
    await waitFor(() => expect(mocked.getTemplates).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText('Nome do Modelo'), { target: { value: 'Modelo B' } });
    await waitFor(() => expect(mocked.getTemplates).toHaveBeenCalledTimes(2));
    fireEvent.click(historyTab());

    await act(async () => first.reject(new Error('Lista antiga indisponível')));
    expect(screen.queryByText('Lista antiga indisponível')).toBeNull();

    await act(async () => second.resolve({ data: [{ _id: 'b', title: 'Modelo B', version: 'v2', active: true }] }));
    expect(screen.getByText('v2')).toBeInTheDocument();
  });

  it('shows only the loaded version family, leaving out a same-title template with no group', async () => {
    mocked.getTemplateById.mockResolvedValue({
      data: { success: true, data: { _id: 'g1', title: 'TCLE Biobanco', htmlContent: '<p>x</p>', versionGroupId: 'group-1' } },
    } as any);
    mocked.getTemplates.mockResolvedValue({
      data: [
        { _id: 'g1', title: 'TCLE Biobanco', version: 'v5', versionGroupId: 'group-1', active: true, createdAt: '2026-02-01' },
        { _id: 'u1', title: 'TCLE Biobanco', version: 'v4', active: false, createdAt: '2026-01-01' },
      ],
    } as any);
    renderPage('/admin/tcle/edit/g1');
    await screen.findByDisplayValue('TCLE Biobanco');
    fireEvent.click(historyTab());
    expect(await screen.findByText('v5')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('v4')).toBeNull());
  });

  it('lists undated versions after the dated ones', async () => {
    mocked.getTemplates.mockResolvedValue({
      data: [
        { _id: 'x', title: 'X', version: 'vx', active: false },
        { _id: 'y', title: 'Y', version: 'vy', active: false },
        { _id: 'z', title: 'Z', version: 'vz', active: true, createdAt: '2026-01-01' },
      ],
    } as any);
    renderPage();
    fireEvent.click(historyTab());
    const rows = (await screen.findAllByRole('row')).slice(1);
    expect(rows.map((row) => within(row).getAllByRole('cell')[0].textContent)).toEqual(['vz', 'vx', 'vy']);
  });
});

describe('TcleBuilderPage editor and ids', () => {
  it('keeps the typed body when the operator goes to the history tab and back', async () => {
    renderPage();
    fireEvent.focus(editor());
    editor().innerHTML = '<p>Corpo do termo</p>';
    fireEvent.input(editor());
    expect(screen.getByText('14 caracteres')).toBeInTheDocument();

    await userEvent.click(historyTab());
    await userEvent.click(screen.getByRole('tab', { name: /Edição do TCLE/i }));
    expect(editor().innerHTML).toBe('<p>Corpo do termo</p>');
    fireEvent.blur(editor());
    expect(screen.getByText('14 caracteres')).toBeInTheDocument();
  });

  it('keeps items apart without crypto.randomUUID', async () => {
    vi.stubGlobal('crypto', {});
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /Adicionar consentimento/ }));
    const [firstItem, secondItem] = screen.getAllByLabelText('Texto do consentimento');
    fireEvent.change(firstItem, { target: { value: 'Item A' } });
    fireEvent.change(secondItem, { target: { value: 'Item B' } });
    fireEvent.click(screen.getAllByRole('button', { name: /Remover item/ })[1]);
    expect(screen.getAllByLabelText('Texto do consentimento').map((input) => (input as HTMLInputElement).value)).toEqual(['Item A']);
  });

  it('removes the print frame when it has no window', async () => {
    mocked.getTemplates.mockResolvedValue({ data: [{ _id: 'p1', title: 'T', version: 'v1', active: true }] } as any);
    const revokeObjectURL = vi.fn();
    Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:tcle'), revokeObjectURL });
    renderPage();
    fireEvent.click(historyTab());
    fireEvent.click(await screen.findByRole('button', { name: /PDF/ }));
    const frame = document.querySelector('iframe[aria-hidden="true"]') as HTMLIFrameElement;
    Object.defineProperty(frame, 'contentWindow', { value: null, configurable: true });
    (frame.onload as () => void)();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:tcle');
    expect(document.querySelector('iframe[aria-hidden="true"]')).toBeNull();
  });
});
