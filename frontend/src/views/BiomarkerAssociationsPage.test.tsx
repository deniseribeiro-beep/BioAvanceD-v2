import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import BiomarkerAssociationsPage from './BiomarkerAssociationsPage';
import { biomarkerAssociationService } from '../services/api';
import type { BiomarkerAssociation } from '../types/models';

const navigate = vi.hoisted(() => vi.fn());

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => navigate };
});

vi.mock('../services/api', () => ({
  biomarkerAssociationService: { getAll: vi.fn(), create: vi.fn(), update: vi.fn() },
}));

const ORPHA = 'http://www.orpha.net';

const stored: BiomarkerAssociation = {
  _id: '68ab12cd34ef56ab78cd90ef',
  biomarkerId: 'bm-1',
  analyte: { systemUri: 'http://loinc.org', code: '2857-1', display: 'PSA' },
  associatedCondition: [{ systemUri: ORPHA, code: 'ORPHA:1331', display: 'Câncer de próstata' }],
  biomarkerRole: 'diagnostic',
  contextOfUse: 'Rastreamento',
  evidenceReferences: [{ system: 'PMID', value: '12345' }],
  cutoff: { value: 4 },
  createdAt: '2026-10-01T12:00:00.000Z',
  updatedAt: '2026-10-01T12:00:00.000Z',
};

const mocked = vi.mocked(biomarkerAssociationService);

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/biomarker-associations']}>
      <BiomarkerAssociationsPage />
    </MemoryRouter>
  );
}

describe('BiomarkerAssociationsPage (#1402, ELM-0275..0285)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    navigate.mockReset();
    mocked.getAll.mockResolvedValue({ data: { success: true, data: [stored] } } as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('lists the stored associations', async () => {
    renderPage();
    expect(await screen.findByText('bm-1')).toBeInTheDocument();
    expect(screen.getByText('PSA')).toBeInTheDocument();
    expect(screen.getByText('PMID:12345')).toBeInTheDocument();
  });

  it('navigates to Nova Associação', async () => {
    const user = userEvent.setup({ delay: null });
    renderPage();
    await screen.findByText('bm-1');
    await user.click(screen.getByRole('button', { name: 'Nova Associação' }));
    expect(navigate).toHaveBeenCalledWith('/biomarker-associations/new');
  });

  it('navigates to edit with state', async () => {
    const user = userEvent.setup({ delay: null });
    renderPage();
    await screen.findByText('bm-1');
    await user.click(screen.getByTitle('Editar'));
    expect(navigate).toHaveBeenCalledWith('/biomarker-associations/bm-1/edit', {
      state: { association: stored },
    });
  });

  it('lists each load error reading, object details by their message', async () => {
    mocked.getAll.mockRejectedValue({
      response: { status: 500, data: { message: 'Falha no banco', details: [{ message: 'detalhe 1' }, null, 'detalhe 2'] } },
    });
    renderPage();
    expect(await screen.findByText('Erro: Falha no banco')).toBeInTheDocument();
    expect(screen.getByText('Erro: detalhe 1')).toBeInTheDocument();
    expect(screen.getByText('Erro: detalhe 2')).toBeInTheDocument();
    expect(screen.getAllByText(/^Erro: /)).toHaveLength(3);
    expect(screen.queryByText('Carregando...')).not.toBeInTheDocument();
    expect(screen.queryByTitle('Editar')).not.toBeInTheDocument();
  });

  it('shows a bare Error message when the load fails without a response', async () => {
    mocked.getAll.mockRejectedValue(new Error('Network Error'));
    renderPage();
    expect(await screen.findByText('Erro: Network Error')).toBeInTheDocument();
    expect(screen.getAllByText(/^Erro: /)).toHaveLength(1);
  });

  it('lists a stored row that lacks its fields and opens it with its own state', async () => {
    const codeOnly = { biomarkerId: 'bm-2', analyte: { systemUri: 'http://loinc.org', code: '2345-7' } };
    const bare = { biomarkerId: 'bm-3' };
    mocked.getAll.mockResolvedValue({ data: { success: true, data: [codeOnly, bare] } } as any);
    const user = userEvent.setup({ delay: null });
    renderPage();

    const codeRow = (await screen.findByText('bm-2')).closest('tr') as HTMLTableRowElement;
    expect(within(codeRow).getByText('2345-7')).toBeInTheDocument();
    const bareRow = screen.getByText('bm-3').closest('tr') as HTMLTableRowElement;
    const cells = within(bareRow).getAllByRole('cell').map((cell) => cell.textContent);
    expect(cells.slice(0, 6)).toEqual(['bm-3', '-', '', '', '', '']);

    await user.click(within(bareRow).getByTitle('Editar'));
    expect(navigate).toHaveBeenCalledWith('/biomarker-associations/bm-3/edit', {
      state: { association: bare },
    });
  });
});
