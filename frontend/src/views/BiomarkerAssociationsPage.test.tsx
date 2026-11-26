import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import BiomarkerAssociationsPage, { matchesBiomarkerAssociationSearch } from './BiomarkerAssociationsPage';
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

function makeRow(overrides: Partial<BiomarkerAssociation> & Pick<BiomarkerAssociation, 'biomarkerId'>): BiomarkerAssociation {
  return {
    _id: `id-${overrides.biomarkerId}`,
    analyte: { systemUri: 'http://loinc.org', code: '2857-1', display: 'PSA' },
    associatedCondition: [{ systemUri: ORPHA, code: 'ORPHA:1331', display: 'Câncer de próstata' }],
    biomarkerRole: 'diagnostic',
    contextOfUse: 'Rastreamento',
    evidenceReferences: [{ system: 'PMID', value: '12345' }],
    createdAt: '2026-10-01T12:00:00.000Z',
    updatedAt: '2026-10-01T12:00:00.000Z',
    ...overrides,
  };
}

const stored = makeRow({ biomarkerId: 'bm-1' });

const mocked = vi.mocked(biomarkerAssociationService);

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/biomarker-associations']}>
      <BiomarkerAssociationsPage />
    </MemoryRouter>
  );
}

describe('matchesBiomarkerAssociationSearch', () => {
  it('matches analyte display and ORPHA condition code', () => {
    expect(matchesBiomarkerAssociationSearch(stored, 'psa')).toBe(true);
    expect(matchesBiomarkerAssociationSearch(stored, 'ORPHA:1331')).toBe(true);
    expect(matchesBiomarkerAssociationSearch(stored, 'fabry')).toBe(false);
  });
});

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

  it('shows import CTA when the catalog is empty', async () => {
    mocked.getAll.mockResolvedValue({ data: { success: true, data: [] } } as any);
    renderPage();
    const empty = await screen.findByTestId('biomarker-associations-empty');
    expect(empty).toHaveTextContent('reference:import:biomarker-associations');
    expect(empty).toHaveTextContent('Nova Associação');
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

  it('filters by search query and shows no-matches state', async () => {
    const user = userEvent.setup({ delay: null });
    renderPage();
    await screen.findByText('bm-1');
    const search = screen.getByTestId('biomarker-associations-search');
    await user.clear(search);
    await user.type(search, 'fabry');
    expect(await screen.findByTestId('biomarker-associations-no-matches')).toBeInTheDocument();
    expect(screen.queryByText('bm-1')).not.toBeInTheDocument();
  });

  it('paginates when there are more than LIST_PAGE_SIZE rows', async () => {
    const user = userEvent.setup({ delay: null });
    const many = Array.from({ length: 12 }, (_, index) =>
      makeRow({
        biomarkerId: `bm-${index + 1}`,
        analyte: { systemUri: 'https://www.genenames.org', code: `HGNC:${index + 1}`, display: `GENE${index + 1}` },
      }),
    );
    mocked.getAll.mockResolvedValue({ data: { success: true, data: many } } as any);
    renderPage();
    expect(await screen.findByText('bm-1')).toBeInTheDocument();
    expect(screen.queryByText('bm-11')).not.toBeInTheDocument();
    expect(screen.getByTestId('biomarker-associations-pagination-summary')).toHaveTextContent('Mostrando 1–10 de 12');
    await user.click(screen.getByTestId('biomarker-associations-pagination-next'));
    expect(await screen.findByText('bm-11')).toBeInTheDocument();
    expect(screen.queryByText('bm-1')).not.toBeInTheDocument();
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
